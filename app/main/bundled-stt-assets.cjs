const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");

const { STT_MANIFEST } = require("./stt-catalog.cjs");

const ROOT_DIR = path.join(__dirname, "..", "..");
const BUNDLE_DIRECTORY = "stt-bundle";
const RUNTIME_CATALOG_ID = "whisper-cpp-win-x64";
const SMALL_MODEL_CATALOG_ID = "whisper-small-q5-1";
const TURBO_MODEL_CATALOG_ID = "whisper-large-v3-turbo-q5-0";
const VAD_CATALOG_ID = "silero-vad-v6-2-0";

const verificationCache = new Map();

function bundleRootCandidates(options = {}) {
  if (options.rootDir) return [path.resolve(String(options.rootDir))];
  if (options.resourcesPath) return [path.join(path.resolve(String(options.resourcesPath)), BUNDLE_DIRECTORY)];
  const candidates = [];
  if (process.resourcesPath) candidates.push(path.join(path.resolve(process.resourcesPath), BUNDLE_DIRECTORY));
  candidates.push(path.join(ROOT_DIR, "vendor", BUNDLE_DIRECTORY));
  return [...new Set(candidates)];
}

function firstExistingDirectory(candidates) {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch (_error) {
      // Try the next fixed application-owned candidate.
    }
  }
  return "";
}

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyFile(filePath, expected = {}) {
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return { ready: false, verified: false, filePath: "" };
    if (Number.isSafeInteger(expected.bytes) && expected.bytes > 0 && stat.size !== expected.bytes) {
      return { ready: false, verified: false, filePath: "" };
    }
    const digest = await sha256File(filePath);
    if (expected.sha256 && digest !== String(expected.sha256).toLowerCase()) {
      return { ready: false, verified: false, filePath: "" };
    }
    return {
      ready: true,
      verified: true,
      filePath,
      bytes: stat.size,
      sha256: digest,
    };
  } catch (_error) {
    return { ready: false, verified: false, filePath: "" };
  }
}

async function verifyRuntime(bundleRoot, entry) {
  if (!entry) return { ready: false, verified: false, executablePath: "" };
  const runtimeRoot = path.join(bundleRoot, "runtime");
  const checks = [];
  const requiredFiles = [...new Set([entry.executable, ...(entry.requiredFiles || [])])];
  for (const relativePath of requiredFiles) {
    const expectedSha = entry.fileChecksums?.[relativePath] || "";
    if (!expectedSha) return { ready: false, verified: false, executablePath: "" };
    const filePath = path.join(runtimeRoot, ...String(relativePath).split("/"));
    checks.push(await verifyFile(filePath, { sha256: expectedSha }));
  }
  if (!checks.length || checks.some((item) => !item.ready || !item.verified)) {
    return { ready: false, verified: false, executablePath: "" };
  }
  const executablePath = path.join(runtimeRoot, ...String(entry.executable).split("/"));
  return {
    ready: true,
    verified: true,
    executablePath,
    installationId: `bundled:runtime:${entry.id}@${entry.version}`,
    id: entry.id,
    version: entry.version,
    name: entry.name,
  };
}

function mergeManagedAndBundledSttPaths(selected = {}, managedStatus = {}, bundled = emptyBundleResult()) {
  const managedVad = managedStatus?.installed?.models?.find(
    (item) => item.valid && item.compatible && item.modelKey === "vad"
  ) || null;
  const runtime = selected.executablePath
    ? {
      executablePath: selected.executablePath,
      installationId: selected.runtimeInstallationId || "",
      source: "managed",
    }
    : {
      executablePath: bundled.runtime?.ready ? bundled.runtime.executablePath : "",
      installationId: bundled.runtime?.ready ? bundled.runtime.installationId : "",
      source: bundled.runtime?.ready ? "bundled" : "",
    };
  const bundledDefaultModel = bundled.turboModel?.ready
    ? bundled.turboModel
    : bundled.smallModel?.ready
      ? bundled.smallModel
      : null;
  const model = selected.modelPath
    ? {
      modelPath: selected.modelPath,
      modelKey: selected.modelKey || "",
      installationId: selected.modelInstallationId || "",
      source: "managed",
    }
    : {
      modelPath: bundledDefaultModel?.modelPath || "",
      modelKey: bundledDefaultModel?.modelKey || "",
      installationId: bundledDefaultModel?.installationId || "",
      source: bundledDefaultModel ? "bundled" : "",
    };
  const vad = managedVad
    ? {
      modelPath: managedVad.modelPath,
      installationId: managedVad.installationId,
      source: "managed",
    }
    : {
      modelPath: bundled.vad?.ready ? bundled.vad.modelPath : "",
      installationId: bundled.vad?.ready ? bundled.vad.installationId : "",
      source: bundled.vad?.ready ? "bundled" : "",
    };
  return {
    ok: Boolean(runtime.executablePath && model.modelPath),
    status: runtime.executablePath && model.modelPath
      ? "ready"
      : runtime.executablePath
        ? "model-missing"
        : model.modelPath
          ? "runtime-missing"
          : "not-installed",
    executablePath: runtime.executablePath,
    modelPath: model.modelPath,
    modelKey: model.modelKey,
    runtimeInstallationId: runtime.installationId,
    modelInstallationId: model.installationId,
    vadModelPath: vad.modelPath,
    vadInstallationId: vad.installationId,
    runtimeSource: runtime.source,
    modelSource: model.source,
    vadSource: vad.source,
  };
}

async function verifyModel(bundleRoot, entry) {
  if (!entry) return { ready: false, verified: false, modelPath: "" };
  const modelPath = path.join(bundleRoot, "models", entry.fileName);
  const checked = await verifyFile(modelPath, entry.artifact);
  if (!checked.ready || !checked.verified) {
    return { ready: false, verified: false, modelPath: "" };
  }
  return {
    ...checked,
    modelPath,
    modelKey: entry.modelKey,
    installationId: `bundled:model:${entry.id}@${entry.version}`,
    id: entry.id,
    version: entry.version,
    name: entry.name,
  };
}

function emptyBundleResult() {
  return {
    rootDir: "",
    runtime: { ready: false, verified: false, executablePath: "" },
    smallModel: { ready: false, verified: false, modelPath: "" },
    turboModel: { ready: false, verified: false, modelPath: "" },
    vad: { ready: false, verified: false, modelPath: "" },
    assets: {},
  };
}

async function inspectBundle(bundleRoot) {
  if (!bundleRoot) return emptyBundleResult();
  const runtimeEntry = STT_MANIFEST.runtimes.find((item) => item.id === RUNTIME_CATALOG_ID);
  const smallEntry = STT_MANIFEST.models.find((item) => item.id === SMALL_MODEL_CATALOG_ID);
  const turboEntry = STT_MANIFEST.models.find((item) => item.id === TURBO_MODEL_CATALOG_ID);
  const vadEntry = STT_MANIFEST.models.find((item) => item.id === VAD_CATALOG_ID);
  const [runtime, smallModel, turboModel, vad] = await Promise.all([
    verifyRuntime(bundleRoot, runtimeEntry),
    verifyModel(bundleRoot, smallEntry),
    verifyModel(bundleRoot, turboEntry),
    verifyModel(bundleRoot, vadEntry),
  ]);
  return {
    rootDir: bundleRoot,
    runtime,
    smallModel,
    turboModel,
    vad,
    assets: {
      [RUNTIME_CATALOG_ID]: { ready: runtime.ready, verified: runtime.verified, source: "bundled" },
      [SMALL_MODEL_CATALOG_ID]: { ready: smallModel.ready, verified: smallModel.verified, source: "bundled" },
      [TURBO_MODEL_CATALOG_ID]: { ready: turboModel.ready, verified: turboModel.verified, source: "bundled" },
      [VAD_CATALOG_ID]: { ready: vad.ready, verified: vad.verified, source: "bundled" },
    },
  };
}

async function resolveBundledSttAssets(options = {}) {
  const bundleRoot = firstExistingDirectory(bundleRootCandidates(options));
  if (!bundleRoot) return emptyBundleResult();
  if (options.force === true) verificationCache.delete(bundleRoot);
  if (!verificationCache.has(bundleRoot)) {
    const pending = inspectBundle(bundleRoot).catch(() => emptyBundleResult());
    verificationCache.set(bundleRoot, pending);
  }
  return verificationCache.get(bundleRoot);
}

module.exports = {
  BUNDLE_DIRECTORY,
  RUNTIME_CATALOG_ID,
  SMALL_MODEL_CATALOG_ID,
  TURBO_MODEL_CATALOG_ID,
  VAD_CATALOG_ID,
  mergeManagedAndBundledSttPaths,
  resolveBundledSttAssets,
  sha256File,
};
