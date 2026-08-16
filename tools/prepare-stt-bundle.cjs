const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const { createSttRuntimeManager } = require("../app/main/stt-runtime-manager.cjs");
const {
  STT_MANIFEST,
  STT_TRUSTED_URL_PREFIXES,
} = require("../app/main/stt-catalog.cjs");
const { resolveBundledSttAssets } = require("../app/main/bundled-stt-assets.cjs");

const ROOT_DIR = path.resolve(__dirname, "..");
const VENDOR_DIR = path.join(ROOT_DIR, "vendor");
const TARGET_DIR = path.join(VENDOR_DIR, "stt-bundle");
const RUNTIME_ID = "whisper-cpp-win-x64";
const TURBO_MODEL_ID = "whisper-large-v3-turbo-q5-0";
const VAD_ID = "silero-vad-v6-2-0";

function assertInside(parent, candidate, label) {
  const root = path.resolve(parent);
  const target = path.resolve(candidate);
  if (target === root || !target.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${label} is outside its expected parent`);
  }
  return target;
}

async function copyFile(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  await fsp.copyFile(source, destination);
}

async function copyRuntimeFiles(sourceRoot, destinationRoot) {
  const entry = STT_MANIFEST.runtimes.find((item) => item.id === RUNTIME_ID);
  if (!entry) throw new Error("Bundled whisper.cpp catalog entry is missing");
  for (const relativePath of [...new Set([entry.executable, ...entry.requiredFiles])]) {
    const segments = String(relativePath).split("/");
    await copyFile(path.join(sourceRoot, ...segments), path.join(destinationRoot, ...segments));
  }
}

function renderProgress(label) {
  let lastPercent = -1;
  return (progress = {}) => {
    const total = Number(progress.totalBytes || 0);
    const current = Number(progress.downloadedBytes || 0);
    const percent = total > 0 ? Math.min(100, Math.floor((current / total) * 100)) : 0;
    if (percent === lastPercent && progress.phase === "downloading") return;
    lastPercent = percent;
    const suffix = total > 0 ? ` ${percent}%` : "";
    process.stdout.write(`[stt-bundle] ${label}: ${String(progress.phase || "working")}${suffix}\n`);
  };
}

async function isCompleteBundle(targetDir) {
  const result = await resolveBundledSttAssets({ rootDir: targetDir, force: true });
  return Boolean(result.runtime.ready && result.turboModel.ready && result.vad.ready);
}

async function replaceBundle(stagingDir) {
  const target = assertInside(VENDOR_DIR, TARGET_DIR, "STT bundle target");
  const backup = assertInside(VENDOR_DIR, `${TARGET_DIR}.previous-${crypto.randomUUID()}`, "STT bundle backup");
  let hadTarget = false;
  try {
    const stat = await fsp.lstat(target);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Existing STT bundle target is not a regular directory");
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
        throw new Error("STT bundle replacement failed and the previous bundle could not be restored");
      }
    }
    throw error;
  }
}

async function main() {
  if (await isCompleteBundle(TARGET_DIR)) {
    process.stdout.write("[stt-bundle] verified bundle already exists; download skipped\n");
    return;
  }

  await fsp.mkdir(VENDOR_DIR, { recursive: true });
  const stagingDir = assertInside(VENDOR_DIR, path.join(VENDOR_DIR, `.stt-bundle-stage-${crypto.randomUUID()}`), "STT staging directory");
  const temporaryUserData = await fsp.mkdtemp(path.join(os.tmpdir(), "heyu-stt-bundle-"));
  try {
    const manager = createSttRuntimeManager({
      userDataDir: temporaryUserData,
      manifest: STT_MANIFEST,
      trustedUrlPrefixes: STT_TRUSTED_URL_PREFIXES,
      requireRuntimeFileChecksums: true,
      allowNetworkInstall: true,
    });
    const runtime = await manager.installRuntime(RUNTIME_ID, { onProgress: renderProgress("whisper.cpp") });
    const turbo = await manager.installModel(TURBO_MODEL_ID, { onProgress: renderProgress("large-v3-turbo-q5_0") });
    const vad = await manager.installModel(VAD_ID, { onProgress: renderProgress("Silero VAD"), autoSelect: false });
    if (!runtime.valid || !turbo.valid || !vad.valid) throw new Error("A downloaded STT component failed validation");

    const runtimeRoot = path.dirname(path.dirname(runtime.executablePath));
    await copyRuntimeFiles(runtimeRoot, path.join(stagingDir, "runtime"));
    await copyFile(turbo.modelPath, path.join(stagingDir, "models", "ggml-large-v3-turbo-q5_0.bin"));
    await copyFile(vad.modelPath, path.join(stagingDir, "models", "ggml-silero-v6.2.0.bin"));

    if (!await isCompleteBundle(stagingDir)) throw new Error("Prepared STT bundle failed final SHA-256 verification");
    await replaceBundle(stagingDir);
    process.stdout.write("[stt-bundle] ready: whisper.cpp 1.9.2 + large-v3-turbo-q5_0 + Silero VAD\n");
  } finally {
    await fsp.rm(temporaryUserData, { recursive: true, force: true });
    if (fs.existsSync(stagingDir)) await fsp.rm(stagingDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`[stt-bundle] failed: ${error?.message || String(error)}\n`);
  process.exitCode = 1;
});
