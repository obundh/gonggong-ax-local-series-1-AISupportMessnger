const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  SttRuntimeManagerError,
  createSttRuntimeManager,
  inspectZipArchive,
  normalizeManifest,
  normalizeRelativePath,
} = require("../app/main/stt-runtime-manager.cjs");

const TRUSTED_PREFIX = "https://downloads.example.test/stt/";

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createStoredZip(files) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const [name, rawData] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name, "utf8");
    const data = Buffer.from(rawData);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + data.length;
  }
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralData, end]);
}

function createManifest({ modelBuffer, runtimeZip, modelSha = sha256(modelBuffer), runtimeSha = sha256(runtimeZip) }) {
  return {
    schemaVersion: 1,
    generatedAt: "2026-08-15T00:00:00Z",
    runtimes: [
      {
        id: "whisper-cpp-win-x64",
        version: "v1.0.0",
        name: "whisper.cpp Windows x64",
        engine: "whisper.cpp",
        platforms: ["win32"],
        architectures: ["x64"],
        artifact: {
          type: "zip",
          url: `${TRUSTED_PREFIX}whisper-runtime.zip`,
          sha256: runtimeSha,
          bytes: runtimeZip.length,
        },
        executable: "Release/whisper-cli.exe",
        requiredFiles: ["Release/ggml.dll"],
      },
    ],
    models: [
      {
        id: "whisper-small-multilingual",
        version: "v1",
        name: "Whisper small multilingual",
        engine: "whisper.cpp",
        platforms: ["win32"],
        architectures: ["x64"],
        artifact: {
          type: "file",
          url: `${TRUSTED_PREFIX}ggml-small.bin`,
          sha256: modelSha,
          bytes: modelBuffer.length,
        },
        fileName: "ggml-small.bin",
        modelKey: "small",
        languages: ["multilingual", "ko"],
      },
    ],
  };
}

function responseFor(buffer, status = 200, headers = {}) {
  return new Response(buffer, {
    status,
    headers: { "Content-Length": String(buffer.length), ...headers },
  });
}

function managerFor(userDataDir, manifest, artifacts, overrides = {}) {
  return createSttRuntimeManager({
    userDataDir,
    manifest,
    trustedUrlPrefixes: [TRUSTED_PREFIX],
    platform: "win32",
    arch: "x64",
    allowNetworkInstall: true,
    fetchImpl: async (url) => {
      const artifact = artifacts.get(url);
      if (!artifact) return responseFor(Buffer.from("not found"), 404);
      return responseFor(artifact);
    },
    ...overrides,
  });
}

async function temporaryUserData(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "heyu-stt-manager-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test("manifest validation accepts only trusted checksummed catalog entries", () => {
  const modelBuffer = Buffer.from("model-contents");
  const runtimeZip = createStoredZip({
    "Release/whisper-cli.exe": "runtime",
    "Release/ggml.dll": "library",
  });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  const normalized = normalizeManifest(manifest, { trustedUrlPrefixes: [TRUSTED_PREFIX] });
  assert.equal(normalized.runtimes[0].installationId, "runtime:whisper-cpp-win-x64@v1.0.0");
  assert.equal(normalized.models[0].modelKey, "small");

  const unsafeUrl = structuredClone(manifest);
  unsafeUrl.models[0].artifact.url = "https://evil.example/model.bin";
  assert.throws(
    () => normalizeManifest(unsafeUrl, { trustedUrlPrefixes: [TRUSTED_PREFIX] }),
    (error) => error instanceof SttRuntimeManagerError && error.code === "UNTRUSTED_URL"
  );

  const missingChecksum = structuredClone(manifest);
  missingChecksum.models[0].artifact.sha256 = "";
  assert.throws(
    () => normalizeManifest(missingChecksum, { trustedUrlPrefixes: [TRUSTED_PREFIX] }),
    (error) => error.code === "INVALID_MANIFEST"
  );

  const unsafeExecutable = structuredClone(manifest);
  unsafeExecutable.runtimes[0].executable = "../../powershell.exe";
  assert.throws(
    () => normalizeManifest(unsafeExecutable, { trustedUrlPrefixes: [TRUSTED_PREFIX] }),
    (error) => error.code === "UNSAFE_PATH"
  );
});

test("path validation blocks traversal, absolute paths, ADS, and Windows device names", () => {
  assert.equal(normalizeRelativePath("Release/whisper-cli.exe"), "Release/whisper-cli.exe");
  for (const value of ["../escape.exe", "/rooted", "C:\\tool.exe", "folder/file:stream", "NUL.txt", "folder\\..\\escape"]) {
    assert.throws(() => normalizeRelativePath(value), (error) => error.code === "UNSAFE_PATH", value);
  }
});

test("runtime and model install under userData, auto-select, list, resolve, and verify", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("fake-whisper-model");
  const runtimeZip = createStoredZip({
    "Release/whisper-cli.exe": "fake-runtime",
    "Release/ggml.dll": "fake-library",
  });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  const artifacts = new Map([
    [`${TRUSTED_PREFIX}whisper-runtime.zip`, runtimeZip],
    [`${TRUSTED_PREFIX}ggml-small.bin`, modelBuffer],
  ]);
  const progress = [];
  const manager = managerFor(userDataDir, manifest, artifacts, { onProgress: (event) => progress.push(event) });

  const catalog = manager.getCatalog();
  assert.equal(catalog.runtimes[0].compatible, true);
  assert.equal(Object.hasOwn(catalog.runtimes[0], "artifact"), false);
  assert.equal(Object.hasOwn(catalog.models[0], "url"), false);

  const runtime = await manager.installRuntime("whisper-cpp-win-x64");
  const model = await manager.installModel("model:whisper-small-multilingual@v1");
  assert.equal(runtime.valid, true);
  assert.equal(model.valid, true);
  assert.equal(runtime.executablePath.startsWith(path.join(userDataDir, "stt", "runtimes")), true);
  assert.equal(model.modelPath.startsWith(path.join(userDataDir, "stt", "models")), true);
  assert.equal(progress.some((event) => event.phase === "extracting"), true);
  assert.equal(progress.some((event) => event.phase === "installing"), true);
  assert.equal(progress.some((event) => event.phase === "complete"), true);

  const status = await manager.getStatus();
  assert.equal(status.ok, true);
  assert.equal(status.status, "ready");
  assert.equal(status.runtime.selected, true);
  assert.equal(status.model.selected, true);
  const resolved = await manager.resolveSelectedPaths();
  assert.equal(resolved.ok, true);
  assert.equal(resolved.executablePath, runtime.executablePath);
  assert.equal(resolved.modelPath, model.modelPath);
  assert.deepEqual(await manager.verifyRuntime(runtime.installationId), {
    ok: true,
    installationId: runtime.installationId,
    errorCode: "",
  });
  assert.equal((await manager.verifyModel(model.installationId)).ok, true);

  const secondInstall = await manager.installModel("whisper-small-multilingual");
  assert.equal(secondInstall.alreadyInstalled, true);
});

test("checksum mismatch leaves no installed component or staging payload", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model-contents");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip, modelSha: "0".repeat(64) });
  const artifacts = new Map([[`${TRUSTED_PREFIX}ggml-small.bin`, modelBuffer]]);
  const manager = managerFor(userDataDir, manifest, artifacts);
  await assert.rejects(
    manager.installModel("whisper-small-multilingual"),
    (error) => error.code === "CHECKSUM_MISMATCH"
  );
  assert.deepEqual(await manager.listInstalled("model"), []);
  const staging = path.join(userDataDir, "stt", ".staging");
  assert.deepEqual(await fs.readdir(staging), []);
});

test("reinstall repairs only the exact incomplete catalog target", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model");
  const runtimeZip = createStoredZip({
    "Release/whisper-cli.exe": "runtime",
    "Release/ggml.dll": "library",
  });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  const manager = managerFor(
    userDataDir,
    manifest,
    new Map([[`${TRUSTED_PREFIX}whisper-runtime.zip`, runtimeZip]])
  );
  const targetDir = path.join(userDataDir, "stt", "runtimes", "whisper-cpp-win-x64", "v1.0.0");
  const siblingDir = path.join(userDataDir, "stt", "runtimes", "whisper-cpp-win-x64", "other-version");
  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(path.join(targetDir, "incomplete.marker"), "old incomplete install");
  await fs.mkdir(siblingDir, { recursive: true });
  await fs.writeFile(path.join(siblingDir, "keep.marker"), "do not touch");
  const progress = [];

  const result = await manager.installRuntime("whisper-cpp-win-x64", {
    onProgress: (event) => progress.push(event.phase),
  });
  assert.equal(result.valid, true);
  assert.equal(result.repaired, true);
  assert.equal(progress.includes("repairing"), true);
  assert.equal(progress.includes("complete"), true);
  await assert.rejects(fs.access(path.join(targetDir, "incomplete.marker")));
  await fs.access(result.executablePath);
  assert.equal(await fs.readFile(path.join(siblingDir, "keep.marker"), "utf8"), "do not touch");
  assert.deepEqual(await fs.readdir(path.join(userDataDir, "stt", ".staging")), []);
});

test("failed repair atomically restores the invalid target and previous selection", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("trusted-model-for-repair");
  const badModelBuffer = Buffer.from(modelBuffer);
  badModelBuffer[0] ^= 0xff;
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  let servedModel = modelBuffer;
  const manager = managerFor(userDataDir, manifest, new Map(), {
    fetchImpl: async (url) => {
      if (url === `${TRUSTED_PREFIX}ggml-small.bin`) return responseFor(servedModel);
      return responseFor(Buffer.from("not found"), 404);
    },
  });
  const installed = await manager.installModel("whisper-small-multilingual");
  const selectionPath = path.join(userDataDir, "stt", "selection.json");
  const previousSelection = JSON.parse(await fs.readFile(selectionPath, "utf8"));
  const targetDir = path.dirname(installed.modelPath);
  await fs.rm(installed.modelPath);
  await fs.writeFile(path.join(targetDir, "original.marker"), "restore me");
  servedModel = badModelBuffer;

  await assert.rejects(
    manager.installModel("whisper-small-multilingual"),
    (error) => error.code === "CHECKSUM_MISMATCH"
  );
  assert.deepEqual(JSON.parse(await fs.readFile(selectionPath, "utf8")), previousSelection);
  assert.equal(await fs.readFile(path.join(targetDir, "original.marker"), "utf8"), "restore me");
  await fs.access(path.join(targetDir, "receipt.json"));
  await assert.rejects(fs.access(installed.modelPath));
  const restored = await manager.listInstalled("model");
  assert.equal(restored[0].valid, false);
  assert.equal(restored[0].selected, true);
  assert.deepEqual(await fs.readdir(path.join(userDataDir, "stt", ".staging")), []);
});

test("explicit verification detects a same-size model replacement", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("trusted-model-bytes");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  const manager = managerFor(
    userDataDir,
    manifest,
    new Map([[`${TRUSTED_PREFIX}ggml-small.bin`, modelBuffer]])
  );
  const installed = await manager.installModel("whisper-small-multilingual");
  await fs.writeFile(installed.modelPath, Buffer.from("replaced-model-data"));
  const result = await manager.verifyModel(installed.installationId);
  assert.deepEqual(result, {
    ok: false,
    installationId: installed.installationId,
    errorCode: "INSTALLATION_TAMPERED",
  });
});

test("an ONNX VAD asset can install without replacing the selected Whisper model", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("whisper-model");
  const vadBuffer = Buffer.from("silero-vad-onnx");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  manifest.models.push({
    id: "vad-silero-6.2.0",
    version: "6.2.0",
    name: "Silero VAD",
    engine: "silero-vad",
    platforms: ["win32"],
    architectures: ["x64"],
    artifact: {
      type: "file",
      url: `${TRUSTED_PREFIX}silero-vad.onnx`,
      sha256: sha256(vadBuffer),
      bytes: vadBuffer.length,
    },
    fileName: "silero-vad.onnx",
    modelKey: "vad",
    languages: ["none"],
  });
  const manager = managerFor(userDataDir, manifest, new Map([
    [`${TRUSTED_PREFIX}ggml-small.bin`, modelBuffer],
    [`${TRUSTED_PREFIX}silero-vad.onnx`, vadBuffer],
  ]));
  const whisper = await manager.installModel("whisper-small-multilingual");
  const vad = await manager.installModel("vad-silero-6.2.0");
  assert.equal(vad.modelKey, "vad");
  assert.equal(vad.selected, false);
  await assert.rejects(manager.selectModel("vad-silero-6.2.0"), (error) => error.code === "COMPONENT_NOT_SELECTABLE");
  const status = await manager.getStatus();
  assert.equal(status.model.installationId, whisper.installationId);
  assert.equal(status.installed.models.some((item) => item.installationId === vad.installationId), true);
});

test("optional per-file runtime checksums protect the executable after extraction", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  manifest.runtimes[0].fileChecksums = {
    "Release/whisper-cli.exe": sha256(Buffer.from("different-runtime")),
  };
  const manager = managerFor(
    userDataDir,
    manifest,
    new Map([[`${TRUSTED_PREFIX}whisper-runtime.zip`, runtimeZip]]),
    { requireRuntimeFileChecksums: true }
  );
  await assert.rejects(
    manager.installRuntime("whisper-cpp-win-x64"),
    (error) => error.code === "CHECKSUM_MISMATCH"
  );
});

test("every redirect is checked against the fixed allowlist", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model-contents");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  let fetchCount = 0;
  const manager = managerFor(userDataDir, manifest, new Map(), {
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(null, { status: 302, headers: { Location: "https://evil.example/payload.bin" } });
    },
  });
  await assert.rejects(
    manager.installModel("whisper-small-multilingual"),
    (error) => error.code === "UNTRUSTED_URL"
  );
  assert.equal(fetchCount, 1);
});

test("ZIP preflight rejects traversal before extraction", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model");
  const unsafeZip = createStoredZip({
    "../escape.exe": "malicious",
    "Release/whisper-cli.exe": "runtime",
    "Release/ggml.dll": "library",
  });
  const manifest = createManifest({ modelBuffer, runtimeZip: unsafeZip });
  const zipPath = path.join(userDataDir, "unsafe.zip");
  await fs.writeFile(zipPath, unsafeZip);
  await assert.rejects(inspectZipArchive(zipPath), (error) => error.code === "UNSAFE_PATH");

  let extractorCalled = false;
  const manager = managerFor(userDataDir, manifest, new Map([[`${TRUSTED_PREFIX}whisper-runtime.zip`, unsafeZip]]), {
    extractZip: async () => {
      extractorCalled = true;
    },
  });
  await assert.rejects(manager.installRuntime("whisper-cpp-win-x64"), (error) => error.code === "UNSAFE_PATH");
  assert.equal(extractorCalled, false);
  await assert.rejects(fs.access(path.join(userDataDir, "escape.exe")));
});

test("cancel during extraction leaves no installed runtime or selection", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model");
  const runtimeZip = createStoredZip({
    "Release/whisper-cli.exe": "runtime",
    "Release/ggml.dll": "library",
  });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  const progress = [];
  let markExtractionStarted;
  const extractionStarted = new Promise((resolve) => {
    markExtractionStarted = resolve;
  });
  const manager = managerFor(
    userDataDir,
    manifest,
    new Map([[`${TRUSTED_PREFIX}whisper-runtime.zip`, runtimeZip]]),
    {
      extractZip: async (_zipPath, destinationDir, options) => {
        markExtractionStarted();
        await new Promise((resolve) => {
          if (options.signal.aborted) resolve();
          else options.signal.addEventListener("abort", resolve, { once: true });
        });
        const releaseDir = path.join(destinationDir, "Release");
        await fs.mkdir(releaseDir, { recursive: true });
        await fs.writeFile(path.join(releaseDir, "whisper-cli.exe"), "runtime");
        await fs.writeFile(path.join(releaseDir, "ggml.dll"), "library");
      },
    }
  );

  const pending = manager.installRuntime("whisper-cpp-win-x64", {
    onProgress: (event) => progress.push(event.phase),
  });
  await extractionStarted;
  assert.deepEqual(manager.cancelInstall("whisper-cpp-win-x64", "runtime"), { ok: true, canceled: true });
  await assert.rejects(pending, (error) => error.code === "INSTALL_CANCELED");

  assert.equal(progress.includes("extracting"), true);
  assert.equal(progress.includes("installing"), false);
  assert.equal(progress.includes("complete"), false);
  assert.deepEqual(await manager.listInstalled("runtime"), []);
  const status = await manager.getStatus();
  assert.equal(status.runtime, null);
  assert.equal(status.status, "not-installed");
  await assert.rejects(fs.access(path.join(userDataDir, "stt", "runtimes", "whisper-cpp-win-x64", "v1.0.0")));
  assert.deepEqual(await fs.readdir(path.join(userDataDir, "stt", ".staging")), []);
});

test("renderer-shaped values cannot inject a URL, command, or absent selection", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("model");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  let fetchCount = 0;
  const manager = managerFor(userDataDir, manifest, new Map(), {
    fetchImpl: async () => {
      fetchCount += 1;
      return responseFor(Buffer.from("unexpected"));
    },
  });
  for (const value of ["https://evil.example/tool.exe", "..\\tool.exe", "whisper-cpp-win-x64;calc.exe"] ) {
    await assert.rejects(manager.installRuntime(value), (error) => error.code === "CATALOG_ENTRY_NOT_FOUND");
  }
  await assert.rejects(manager.selectModel("whisper-small-multilingual"), (error) => error.code === "COMPONENT_NOT_INSTALLED");
  assert.equal(fetchCount, 0);
});

test("release manager disables HTTP installation by default", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("offline-model");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  let fetchCount = 0;
  const manager = createSttRuntimeManager({
    userDataDir,
    manifest,
    trustedUrlPrefixes: [TRUSTED_PREFIX],
    platform: "win32",
    arch: "x64",
    fetchImpl: async () => {
      fetchCount += 1;
      return responseFor(modelBuffer);
    },
  });

  await assert.rejects(
    manager.installModel("whisper-small-multilingual"),
    (error) => error.code === "NETWORK_INSTALL_DISABLED"
  );
  assert.equal(fetchCount, 0);
  assert.deepEqual(await manager.listInstalled("model"), []);
});

test("verified local files import without a network request and reject a wrong SHA", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("verified-offline-model");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manifest = createManifest({ modelBuffer, runtimeZip });
  const modelPath = path.join(userDataDir, "selected-model.bin");
  const runtimePath = path.join(userDataDir, "selected-runtime.zip");
  await fs.writeFile(modelPath, modelBuffer);
  await fs.writeFile(runtimePath, runtimeZip);
  let fetchCount = 0;
  const manager = createSttRuntimeManager({
    userDataDir,
    manifest,
    trustedUrlPrefixes: [TRUSTED_PREFIX],
    platform: "win32",
    arch: "x64",
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("release runtime must not fetch");
    },
  });

  const runtime = await manager.importRuntimeFromFile("whisper-cpp-win-x64", runtimePath);
  const model = await manager.importModelFromFile("whisper-small-multilingual", modelPath);
  assert.equal(runtime.valid, true);
  assert.equal(model.valid, true);
  assert.equal(fetchCount, 0);
  assert.equal((await manager.verifyRuntime(runtime.installationId)).ok, true);
  assert.equal((await manager.verifyModel(model.installationId)).ok, true);

  const wrongPath = path.join(userDataDir, "wrong-model.bin");
  await fs.writeFile(wrongPath, Buffer.from("wrong-size"));
  await assert.rejects(
    manager.importModelFromFile("whisper-small-multilingual", wrongPath),
    (error) => ["SIZE_MISMATCH", "CHECKSUM_MISMATCH"].includes(error.code)
  );
  assert.equal((await manager.verifyModel(model.installationId)).ok, true);
});

test("local import requires an absolute main-process path", async (t) => {
  const userDataDir = await temporaryUserData(t);
  const modelBuffer = Buffer.from("offline-model");
  const runtimeZip = createStoredZip({ "Release/whisper-cli.exe": "runtime", "Release/ggml.dll": "library" });
  const manager = createSttRuntimeManager({
    userDataDir,
    manifest: createManifest({ modelBuffer, runtimeZip }),
    trustedUrlPrefixes: [TRUSTED_PREFIX],
    platform: "win32",
    arch: "x64",
  });
  await assert.rejects(
    manager.importModelFromFile("whisper-small-multilingual", "selected-model.bin"),
    (error) => error.code === "LOCAL_FILE_REQUIRED"
  );
});
