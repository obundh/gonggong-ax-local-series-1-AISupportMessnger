const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PREFERRED_EXECUTABLE,
  SERIES4_BUNDLE_DIRECTORY,
  SERIES4_RELEASE,
  createSeries4Integration,
  inspectZipArchive,
} = require("../app/main/series4-integration.cjs");

const projectRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(projectRoot, "vendor");
const bundlePath = path.join(vendorRoot, SERIES4_BUNDLE_DIRECTORY, SERIES4_RELEASE.assetName);

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

test("prepared Series 4 installer resource matches the pinned official archive", async () => {
  const stat = await fsp.lstat(bundlePath);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  assert.equal(stat.size, SERIES4_RELEASE.bytes);
  assert.equal(await sha256File(bundlePath), SERIES4_RELEASE.sha256);
  const archive = await inspectZipArchive(bundlePath);
  const files = archive.entries.filter((entry) => !entry.isDirectory).map((entry) => entry.name);
  assert.equal(files.some((name) => path.posix.basename(name).toLowerCase() === PREFERRED_EXECUTABLE.toLowerCase()), true);
  assert.equal(files.some((name) => /^(?:license|copying)(?:\.[a-z0-9]+)?$/i.test(path.posix.basename(name))), true);
  assert.equal(files.some((name) => path.posix.basename(name).toLowerCase() === "sbom.spdx.json"), true);
  assert.equal(files.some((name) => path.posix.basename(name).toLowerCase() === "open_source_components.md"), true);
});

test("fresh user data installs the real Series 4 bundle with zero network requests", { skip: process.platform !== "win32" }, async (t) => {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "heyu-series4-offline-"));
  const userDataDir = path.join(temporaryRoot, "user-data");
  const videosDir = path.join(temporaryRoot, "videos");
  const localAppDataDir = path.join(temporaryRoot, "local-app-data");
  await Promise.all([userDataDir, videosDir, localAppDataDir].map((directory) => fsp.mkdir(directory, { recursive: true })));
  t.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  assert.deepEqual(await fsp.readdir(userDataDir), []);

  let networkRequests = 0;
  const manager = createSeries4Integration({
    userDataDir,
    roots: { videosDir, localAppDataDir },
    resourcesPath: vendorRoot,
    fetchImpl: async () => {
      networkRequests += 1;
      throw new Error("network access is forbidden");
    },
  });

  const installed = await manager.install();
  assert.equal(installed.ok, true);
  assert.equal(installed.state, "ready");
  assert.equal(installed.packageSource, "bundled-installer-resource");
  assert.equal(networkRequests, 0);
  const status = await manager.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.launchable, true);
  assert.equal(status.package.source, "bundled-installer-resource");
  assert.equal(JSON.stringify(status).includes(temporaryRoot), false);
});
