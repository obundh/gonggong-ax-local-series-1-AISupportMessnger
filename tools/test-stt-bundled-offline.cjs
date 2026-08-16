const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..");
const bundleRoot = path.join(projectRoot, "vendor", "stt-bundle");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-stt-bundled-offline-"));
const freshUserData = path.join(temporaryRoot, "user-data");
const workspaceDir = path.join(freshUserData, "workspace");

fs.mkdirSync(freshUserData, { recursive: true });
assert.deepEqual(fs.readdirSync(freshUserData), []);
process.env.HEYU_WORKSPACE_DIR = workspaceDir;
delete process.env.HEYU_WHISPER_COMMAND;
delete process.env.HEYU_WHISPER_CPP;
delete process.env.HEYU_WHISPER_MODEL;
delete process.env.HEYU_WHISPER_VAD_MODEL;

const {
  mergeManagedAndBundledSttPaths,
  resolveBundledSttAssets,
} = require("../app/main/bundled-stt-assets.cjs");
const { STT_MANIFEST } = require("../app/main/stt-catalog.cjs");
const {
  getSttRuntimeStatus,
  transcribeSpeechAudio,
} = require("../app/main/stt-tools.cjs");

test.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

async function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function assertCatalogFile(filePath, expected) {
  const stat = fs.statSync(filePath);
  assert.equal(stat.isFile(), true, filePath);
  assert.equal(stat.size, expected.bytes, `${path.basename(filePath)} size`);
  assert.equal(await sha256File(filePath), expected.sha256, `${path.basename(filePath)} SHA-256`);
}

test("Electron installer copies the read-only STT bundle beside app.asar", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const extraResources = packageJson.build?.extraResources || [];
  const hasBundleRule = extraResources.some((entry) => {
    if (typeof entry === "string") return entry.replaceAll("\\", "/").includes("vendor/stt-bundle");
    const from = String(entry?.from || "").replaceAll("\\", "/").replace(/\/$/, "");
    const to = String(entry?.to || "").replaceAll("\\", "/").replace(/\/$/, "");
    return from === "vendor/stt-bundle" && to === "stt-bundle";
  });

  assert.equal(hasBundleRule, true);
  assert.equal(packageJson.build?.files?.includes("THIRD_PARTY_NOTICES.md"), true);
});

test("main combines bundled assets into both status and transcription paths", () => {
  const main = fs.readFileSync(path.join(projectRoot, "app", "main", "main.cjs"), "utf8");
  assert.match(main, /require\(["']\.\/bundled-stt-assets\.cjs["']\)/);
  assert.match(main, /async function resolveManagedSttPaths\(\)[\s\S]*?resolveBundledSttAssets\(\)[\s\S]*?mergeManagedAndBundledSttPaths\(selected, status, bundled\)/);
  assert.match(main, /async function buildSttRuntimeStatus\(\)[\s\S]*?resolveBundledSttAssets\(\)[\s\S]*?bundledAsset = bundled\.assets/);
  assert.match(main, /const managedRuntime = await selectManagedSttModelForPreset\(payload\?\.model\)[\s\S]*?transcribeSpeechAudio\([\s\S]*?\{ managedRuntime, signal: controller\.signal \}/);
});

test("bundled runtime, Turbo model, and VAD pass the pinned catalog hashes", async () => {
  const bundled = await resolveBundledSttAssets({ rootDir: bundleRoot, force: true });
  const runtimeCatalog = STT_MANIFEST.runtimes.find((item) => item.id === "whisper-cpp-win-x64");
  const turboCatalog = STT_MANIFEST.models.find((item) => item.id === "whisper-large-v3-turbo-q5-0");
  const vadCatalog = STT_MANIFEST.models.find((item) => item.id === "silero-vad-v6-2-0");

  assert.equal(bundled.rootDir, bundleRoot);
  for (const component of [bundled.runtime, bundled.turboModel, bundled.vad]) {
    assert.equal(component.ready, true);
    assert.equal(component.verified, true);
  }
  for (const catalogId of ["whisper-cpp-win-x64", "whisper-large-v3-turbo-q5-0", "silero-vad-v6-2-0"]) {
    assert.equal(bundled.assets[catalogId]?.ready, true, catalogId);
    assert.equal(bundled.assets[catalogId]?.verified, true, catalogId);
    assert.equal(bundled.assets[catalogId]?.source, "bundled", catalogId);
  }

  for (const [relativePath, expectedHash] of Object.entries(runtimeCatalog.fileChecksums)) {
    const runtimePath = path.join(bundleRoot, "runtime", ...relativePath.split("/"));
    assert.equal(fs.statSync(runtimePath).isFile(), true, relativePath);
    assert.equal(await sha256File(runtimePath), expectedHash, relativePath);
  }
  await assertCatalogFile(bundled.turboModel.modelPath, turboCatalog.artifact);
  await assertCatalogFile(bundled.vad.modelPath, vadCatalog.artifact);
});

test("fresh userData is ready and transcribes through packaged assets without network", async () => {
  assert.equal(fs.existsSync(path.join(freshUserData, "stt")), false);
  const bundled = await resolveBundledSttAssets({ rootDir: bundleRoot, force: true });
  const managedRuntime = mergeManagedAndBundledSttPaths(
    {
      executablePath: "",
      modelPath: "",
      modelKey: "",
      runtimeInstallationId: "",
      modelInstallationId: "",
    },
    { installed: { runtimes: [], models: [] } },
    bundled
  );

  assert.equal(managedRuntime.ok, true);
  assert.equal(managedRuntime.status, "ready");
  assert.equal(managedRuntime.runtimeSource, "bundled");
  assert.equal(managedRuntime.modelSource, "bundled");
  assert.equal(managedRuntime.vadSource, "bundled");

  const status = getSttRuntimeStatus({ managedRuntime });
  assert.equal(status.ok, true);
  assert.equal(status.runtimeReady, true);
  assert.equal(status.selectedModel, path.basename(bundled.turboModel.modelPath));
  assert.equal(status.vad.installed, true);
  assert.equal(status.presets.find((item) => item.value === "recommended")?.enabled, true);
  assert.equal(status.presets.find((item) => item.value === "lite")?.enabled, false);

  const previousFetch = globalThis.fetch;
  let networkRequests = 0;
  globalThis.fetch = async () => {
    networkRequests += 1;
    throw new Error("network access is forbidden in this test");
  };

  let invokedExecutable = "";
  let invokedArgs = [];
  try {
    const result = await transcribeSpeechAudio({
      base64: Buffer.from("synthetic non-WAV audio fixture").toString("base64"),
      mimeType: "audio/mpeg",
      language: "ko",
      model: "recommended",
      vad: { enabled: true },
      retainOriginalAudio: false,
    }, {
      managedRuntime,
      async runWhisper(executablePath, args) {
        invokedExecutable = executablePath;
        invokedArgs = [...args];
        const outputBase = args[args.indexOf("-of") + 1];
        fs.writeFileSync(`${outputBase}.txt`, "오프라인 받아쓰기 결과입니다.\n", "utf8");
        fs.writeFileSync(`${outputBase}.srt`, "1\n00:00:00,000 --> 00:00:01,000\n오프라인 받아쓰기 결과입니다.\n", "utf8");
        fs.writeFileSync(`${outputBase}.vtt`, "WEBVTT\n\n00:00.000 --> 00:01.000\n오프라인 받아쓰기 결과입니다.\n", "utf8");
        fs.writeFileSync(`${outputBase}.json`, JSON.stringify({
          transcription: [{ offsets: { from: 0, to: 1000 }, text: "오프라인 받아쓰기 결과입니다." }],
        }), "utf8");
        return { ok: true, stdout: "", stderr: "", errorText: "" };
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "transcribed");
    assert.equal(result.vad.enabled, true);
    assert.equal(result.vad.modelName, path.basename(bundled.vad.modelPath));
    assert.equal(invokedExecutable, bundled.runtime.executablePath);
    assert.equal(invokedArgs[invokedArgs.indexOf("-m") + 1], bundled.turboModel.modelPath);
    assert.equal(invokedArgs[invokedArgs.indexOf("--vad-model") + 1], bundled.vad.modelPath);
    assert.equal(networkRequests, 0);
    assert.equal(fs.existsSync(path.join(freshUserData, "stt")), false);
    assert.equal(fs.existsSync(path.join(workspaceDir, result.transcriptPath)), true);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
