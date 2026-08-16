const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const {
  PREFERRED_EXECUTABLE,
  SERIES4_BUNDLE_DIRECTORY,
  SERIES4_RELEASE,
  inspectZipArchive,
} = require("../app/main/series4-integration.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(ROOT_DIR, "vendor");
const TARGET_DIR = path.join(VENDOR_DIR, SERIES4_BUNDLE_DIRECTORY);
const SERIES4_RELEASE_URL = "https://github.com/obundh/gonggong-ax-local-4/releases/download/v4.1.1/GonggongAX-Series4-Portable-x64-v4.1.1.zip";
const TRUSTED_REDIRECT_ORIGINS = new Set(["https://release-assets.githubusercontent.com"]);
const MAX_REDIRECTS = 6;

function assertInside(parent, candidate, label) {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) throw new Error(`${label} is outside its expected parent`);
  return target;
}

function trustedUrl(value, { initial = false } = {}) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) {
    throw new Error("Series 4 bundle URL must be credential-free HTTPS");
  }
  if (initial && url.href !== SERIES4_RELEASE_URL) throw new Error("Series 4 bundle URL is not the pinned release asset");
  if (!initial && url.href !== SERIES4_RELEASE_URL && !TRUSTED_REDIRECT_ORIGINS.has(url.origin)) {
    throw new Error("Series 4 bundle redirect left the trusted GitHub asset service");
  }
  return url;
}

async function fetchPinnedRelease() {
  let current = trustedUrl(SERIES4_RELEASE_URL, { initial: true });
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const response = await fetch(current.href, { method: "GET", redirect: "manual", cache: "no-store" });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel?.().catch(() => {});
      if (!location) throw new Error("Series 4 release redirect omitted its destination");
      current = trustedUrl(new URL(location, current).href);
      continue;
    }
    if (!response.ok || response.status !== 200 || !response.body) {
      throw new Error(`Series 4 release server returned HTTP ${response.status}`);
    }
    const contentLength = response.headers.get("content-length");
    if (contentLength && Number(contentLength) !== SERIES4_RELEASE.bytes) {
      await response.body.cancel?.().catch(() => {});
      throw new Error("Series 4 release Content-Length differs from the pinned size");
    }
    return response;
  }
  throw new Error("Series 4 release exceeded the redirect limit");
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyBundleFile(filePath) {
  const stat = await fsp.lstat(filePath).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size !== SERIES4_RELEASE.bytes) return false;
  if (await sha256File(filePath) !== SERIES4_RELEASE.sha256) return false;
  const archive = await inspectZipArchive(filePath);
  const files = archive.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  const hasPreferredExecutable = files.some((name) => path.posix.basename(name).toLowerCase() === PREFERRED_EXECUTABLE.toLowerCase());
  const hasLicense = files.some((name) => /^(?:license|copying)(?:\.[a-z0-9]+)?$/i.test(path.posix.basename(name)));
  const hasSbom = files.some((name) => path.posix.basename(name).toLowerCase() === "sbom.spdx.json");
  const hasOpenSourceNotices = files.some((name) => path.posix.basename(name).toLowerCase() === "open_source_components.md");
  if (!hasPreferredExecutable) throw new Error("Verified Series 4 ZIP does not contain the pinned application executable");
  if (!hasLicense) throw new Error("Verified Series 4 ZIP does not contain its redistribution license");
  if (!hasSbom || !hasOpenSourceNotices) throw new Error("Verified Series 4 ZIP does not contain its SBOM and open-source component notices");
  return true;
}

async function downloadTo(filePath) {
  const response = await fetchPinnedRelease();
  const handle = await fsp.open(filePath, "wx", 0o600);
  const hash = crypto.createHash("sha256");
  let downloadedBytes = 0;
  let lastPercent = -1;
  try {
    for await (const rawChunk of response.body) {
      const chunk = Buffer.from(rawChunk);
      downloadedBytes += chunk.length;
      if (downloadedBytes > SERIES4_RELEASE.bytes) throw new Error("Series 4 release exceeded the pinned size");
      hash.update(chunk);
      let written = 0;
      while (written < chunk.length) {
        const result = await handle.write(chunk, written, chunk.length - written);
        if (result.bytesWritten < 1) throw new Error("Series 4 release could not be written to staging");
        written += result.bytesWritten;
      }
      const percent = Math.floor((downloadedBytes / SERIES4_RELEASE.bytes) * 100);
      if (percent !== lastPercent) {
        lastPercent = percent;
        process.stdout.write(`[series4-bundle] download ${percent}%\n`);
      }
    }
  } finally {
    await handle.close();
  }
  if (downloadedBytes !== SERIES4_RELEASE.bytes) throw new Error("Series 4 release size differs from the pinned metadata");
  if (hash.digest("hex") !== SERIES4_RELEASE.sha256) throw new Error("Series 4 release SHA-256 differs from the pinned metadata");
}

async function replaceBundle(stagingDir) {
  const target = assertInside(VENDOR_DIR, TARGET_DIR, "Series 4 bundle target");
  const backup = assertInside(VENDOR_DIR, `${TARGET_DIR}.previous-${crypto.randomUUID()}`, "Series 4 bundle backup");
  let hadTarget = false;
  try {
    const stat = await fsp.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Existing Series 4 bundle target is not a regular directory");
    await fsp.rename(target, backup);
    hadTarget = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    await fsp.rename(stagingDir, target);
    if (hadTarget) await fsp.rm(backup, { recursive: true, force: true });
  } catch (error) {
    if (hadTarget) {
      try {
        await fsp.rename(backup, target);
      } catch (_rollbackError) {
        throw new Error("Series 4 bundle replacement failed and the previous bundle could not be restored");
      }
    }
    throw error;
  }
}

async function main() {
  const targetFile = path.join(TARGET_DIR, SERIES4_RELEASE.assetName);
  if (await verifyBundleFile(targetFile)) {
    process.stdout.write(`[series4-bundle] verified v${SERIES4_RELEASE.version} bundle already exists; download skipped\n`);
    return;
  }

  await fsp.mkdir(VENDOR_DIR, { recursive: true });
  const stagingDir = assertInside(VENDOR_DIR, path.join(VENDOR_DIR, `.series4-bundle-stage-${crypto.randomUUID()}`), "Series 4 staging directory");
  const stagingFile = path.join(stagingDir, SERIES4_RELEASE.assetName);
  await fsp.mkdir(stagingDir, { recursive: false, mode: 0o700 });
  try {
    await downloadTo(stagingFile);
    if (!await verifyBundleFile(stagingFile)) throw new Error("Prepared Series 4 bundle failed final verification");
    await replaceBundle(stagingDir);
    process.stdout.write(`[series4-bundle] ready: v${SERIES4_RELEASE.version}, ${SERIES4_RELEASE.bytes} bytes, SHA-256 ${SERIES4_RELEASE.sha256}\n`);
  } finally {
    if (fs.existsSync(stagingDir)) await fsp.rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[series4-bundle] failed: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
