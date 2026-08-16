const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { EventEmitter } = require("node:events");
const nodeFs = require("node:fs");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  PREFERRED_EXECUTABLE,
  SERIES4_APP_FOLDER,
  SERIES4_BUNDLE_DIRECTORY,
  SERIES4_RELEASE,
  Series4IntegrationError,
  TEST_ONLY,
  createSeries4Integration,
  inspectZipArchive,
  normalizeArchivePath,
} = require("../app/main/series4-integration.cjs");

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

function createStoredZip(entries) {
  const locals = [];
  const centrals = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const data = Buffer.from(entry.data || "");
    const checksum = crc32(data);
    const flags = entry.utf8 === false ? 0 : 0x800;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, data);

    const isDirectory = entry.name.endsWith("/");
    const unixMode = entry.unixMode ?? (isDirectory ? 0o040755 : 0o100644);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE((unixMode << 16) >>> 0, 38);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, nameBuffer);
    localOffset += local.length + nameBuffer.length + data.length;
  }
  const centralData = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralData.length, 12);
  end.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralData, end]);
}

async function temporaryLayout(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "heyu-series4-test-"));
  const layout = {
    base,
    userDataDir: path.join(base, "user-data"),
    videosDir: path.join(base, "videos"),
    localAppDataDir: path.join(base, "local-app-data"),
  };
  await Promise.all([layout.userDataDir, layout.videosDir, layout.localAppDataDir].map((directory) => fs.mkdir(directory, { recursive: true })));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  return layout;
}

function fakeRelease(zipBuffer, suffix = "success") {
  return {
    version: `9.9.${suffix.length}`,
    tag: "v-test",
    assetName: "series4-test.zip",
    bytes: zipBuffer.length,
    sha256: sha256(zipBuffer),
  };
}

async function extractFixtureFiles(destinationDir, files, extraFiles = {}) {
  for (const [relativePath, data] of Object.entries({ ...files, ...extraFiles })) {
    const target = path.join(destinationDir, ...relativePath.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, data);
  }
}

function createManager(layout, files, overrides = {}) {
  const entries = Object.entries(files).map(([name, data]) => ({ name, data }));
  const zip = overrides.zip || createStoredZip(entries);
  const release = overrides.release || fakeRelease(zip, overrides.releaseSuffix || "success");
  const resourcesPath = overrides.resourcesPath || path.join(layout.base, `resources-${crypto.randomUUID()}`);
  const bundleRoot = path.join(resourcesPath, SERIES4_BUNDLE_DIRECTORY);
  if (!overrides.missingBundle) {
    nodeFs.mkdirSync(bundleRoot, { recursive: true });
    nodeFs.writeFileSync(path.join(bundleRoot, release.assetName), overrides.bundleBytes || zip);
  }
  return {
    zip,
    release,
    manager: createSeries4Integration({
      userDataDir: layout.userDataDir,
      roots: { videosDir: layout.videosDir, localAppDataDir: layout.localAppDataDir },
      fs: nodeFs,
      spawnImpl: overrides.spawnImpl || (() => { throw new Error("real process launch forbidden in tests"); }),
      extractZip: overrides.extractZip || (async (_zipPath, destinationDir) => extractFixtureFiles(destinationDir, files)),
      platform: "win32",
      arch: "x64",
      resourcesPath,
      onProgress: overrides.onProgress,
      maxSidecarBytes: overrides.maxSidecarBytes,
      maxSidecarEvents: overrides.maxSidecarEvents,
      maxSidecarScanEntries: overrides.maxSidecarScanEntries,
      maxSessions: overrides.maxSessions,
      [TEST_ONLY]: { release },
    }),
  };
}

test("pins the official v4.1.1 portable release metadata exactly", () => {
  assert.deepEqual(SERIES4_RELEASE, {
    version: "4.1.1",
    tag: "v4.1.1",
    assetName: "GonggongAX-Series4-Portable-x64-v4.1.1.zip",
    bytes: 66_232_189,
    sha256: "1c7056b0fcad99c42ba85d9d9770e5b35e64207379b2fa20279365a2a052805f",
  });
  assert.equal(PREFERRED_EXECUTABLE, "공공AX-업무매크로.exe");
});

test("portable path validation blocks traversal, roots, ADS, device names, and trailing aliases", () => {
  assert.equal(normalizeArchivePath("bundle/공공AX-업무매크로.exe"), "bundle/공공AX-업무매크로.exe");
  for (const value of ["../escape.exe", "/rooted", "C:\\tool.exe", "folder/file:stream", "NUL.txt", "folder/COM1", "folder/alias. ", "folder\\..\\escape"]) {
    assert.throws(() => normalizeArchivePath(value), (error) => error instanceof Series4IntegrationError && error.code === "UNSAFE_PATH", value);
  }
});

test("ZIP preflight accepts a normal release and rejects traversal, ADS, devices, and symlinks", async (t) => {
  const layout = await temporaryLayout(t);
  const goodPath = path.join(layout.base, "good.zip");
  await fs.writeFile(goodPath, createStoredZip([{ name: `bundle/${PREFERRED_EXECUTABLE}`, data: "app" }]));
  const good = await inspectZipArchive(goodPath);
  assert.equal(good.entries[0].name, `bundle/${PREFERRED_EXECUTABLE}`);

  const unsafeCases = [
    [{ name: "../escape.exe", data: "x" }],
    [{ name: "bundle/file.txt:stream", data: "x" }],
    [{ name: "bundle/NUL.txt", data: "x" }],
    [{ name: "bundle/link", data: "target", unixMode: 0o120777 }],
  ];
  for (let index = 0; index < unsafeCases.length; index += 1) {
    const zipPath = path.join(layout.base, `unsafe-${index}.zip`);
    await fs.writeFile(zipPath, createStoredZip(unsafeCases[index]));
    await assert.rejects(inspectZipArchive(zipPath), (error) => error.code === "UNSAFE_ARCHIVE" || error.code === "UNSAFE_PATH");
  }
});

test("install verifies the bundled size, checksum, ZIP, extraction, and commits atomically", async (t) => {
  const layout = await temporaryLayout(t);
  const files = {
    [`portable/${PREFERRED_EXECUTABLE}`]: "fixture-executable",
    "portable/runtime.dll": "fixture-library",
  };
  const progress = [];
  const setup = createManager(layout, files, { onProgress: (event) => progress.push(event) });
  const manager = setup.manager;
  const installed = await manager.install();
  assert.equal(installed.ok, true);
  assert.equal(installed.alreadyInstalled, false);
  assert.deepEqual([...new Set(progress.map((event) => event.phase))], ["starting", "copying", "verifying", "extracting", "installing", "complete"]);
  const status = await manager.getStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.launchable, true);
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes(layout.base), false);
  assert.equal(serialized.includes(PREFERRED_EXECUTABLE), false);
  assert.equal(serialized.includes("github.com/"), false);
  const installedAgain = await manager.install();
  assert.equal(installedAgain.alreadyInstalled, true);
});

test("runtime source contains no network download path", () => {
  const source = nodeFs.readFileSync(path.join(__dirname, "..", "app", "main", "series4-integration.cjs"), "utf8");
  assert.doesNotMatch(source, /globalThis\.fetch|fetchImpl|https?:\/\//i);
  assert.doesNotMatch(source, /DOWNLOAD_FAILED|UNTRUSTED_URL/);
});

test("fresh installation stages the checksummed installer bundle", async (t) => {
  const layout = await temporaryLayout(t);
  const files = {
    [`portable/${PREFERRED_EXECUTABLE}`]: "fixture-executable",
    "portable/LICENSE": "MIT fixture",
  };
  const zip = createStoredZip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const release = fakeRelease(zip, "offline-bundle");
  const resourcesPath = path.join(layout.base, "resources");
  const bundleRoot = path.join(resourcesPath, SERIES4_BUNDLE_DIRECTORY);
  await fs.mkdir(bundleRoot, { recursive: true });
  await fs.writeFile(path.join(bundleRoot, release.assetName), zip);
  const progress = [];
  const manager = createSeries4Integration({
    userDataDir: layout.userDataDir,
    roots: { videosDir: layout.videosDir, localAppDataDir: layout.localAppDataDir },
    resourcesPath,
    fs: nodeFs,
    spawnImpl: () => { throw new Error("real process launch forbidden in tests"); },
    extractZip: async (_zipPath, destinationDir) => extractFixtureFiles(destinationDir, files),
    platform: "win32",
    arch: "x64",
    onProgress: (event) => progress.push(event),
    [TEST_ONLY]: { release },
  });

  const installed = await manager.install();
  assert.equal(installed.ok, true);
  assert.equal(installed.packageSource, "bundled-installer-resource");
  assert.equal(progress.some((event) => event.phase === "copying"), true);
  assert.equal(progress.some((event) => event.phase === "downloading"), false);
  const status = await manager.getStatus();
  assert.equal(status.state, "ready");
  assert.equal(status.package.source, "bundled-installer-resource");
  assert.equal(JSON.stringify(status).includes(resourcesPath), false);
});

test("production-style installation fails closed when its installer bundle is missing", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "fixture-executable" };
  const zip = createStoredZip(Object.entries(files).map(([name, data]) => ({ name, data })));
  const release = fakeRelease(zip, "missing-bundle");
  const manager = createSeries4Integration({
    userDataDir: layout.userDataDir,
    roots: { videosDir: layout.videosDir, localAppDataDir: layout.localAppDataDir },
    resourcesPath: path.join(layout.base, "empty-resources"),
    fs: nodeFs,
    spawnImpl: () => { throw new Error("real process launch forbidden in tests"); },
    extractZip: async () => { throw new Error("must not extract"); },
    platform: "win32",
    arch: "x64",
    [TEST_ONLY]: { release },
  });

  await assert.rejects(manager.install(), (error) => error.code === "BUNDLED_ASSET_MISSING");
  assert.equal((await manager.getStatus()).state, "not-installed");
});

test("checksum and size mismatches leave no committed runtime", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  const good = createManager(layout, files);
  const changed = Buffer.from(good.zip);
  changed[35] ^= 1;
  const badChecksum = createManager(layout, files, {
    zip: good.zip,
    release: good.release,
    bundleBytes: changed,
  });
  await assert.rejects(badChecksum.manager.install(), (error) => error.code === "CHECKSUM_MISMATCH");
  assert.equal((await badChecksum.manager.getStatus()).state, "not-installed");

  const badSize = createManager(layout, files, {
    zip: good.zip,
    release: good.release,
    bundleBytes: good.zip.subarray(0, good.zip.length - 1),
  });
  await assert.rejects(badSize.manager.install(), (error) => error.code === "SIZE_MISMATCH");
  assert.equal((await badSize.manager.getStatus()).state, "not-installed");
});

test("post-extraction inspection rejects files absent from the inspected ZIP", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  const setup = createManager(layout, files, {
    extractZip: async (_zipPath, destinationDir) => extractFixtureFiles(destinationDir, files, { "portable/unexpected.exe": "unexpected" }),
  });
  await assert.rejects(setup.manager.install(), (error) => error.code === "UNSAFE_ARCHIVE");
  assert.equal((await setup.manager.getStatus()).state, "not-installed");
});

test("bounded executable fallback supports a renamed Korean application executable", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { "portable/업무 자동화 도구.exe": "renamed-app", "portable/runtime.dll": "runtime" };
  const setup = createManager(layout, files);
  await setup.manager.install();
  assert.equal((await setup.manager.getStatus()).state, "ready");
});

test("install cancellation removes staging payload and does not commit", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  let manager;
  let cancelResult = null;
  const setup = createManager(layout, files, {
    onProgress(event) {
      if (!cancelResult && event.phase === "copying" && event.downloadedBytes > 0) cancelResult = manager.cancelInstall();
    },
  });
  manager = setup.manager;
  const installing = manager.install();
  await assert.rejects(installing, (error) => error.code === "OPERATION_CANCELED");
  assert.deepEqual(cancelResult, { ok: true, canceled: true });
  assert.equal((await manager.getStatus()).state, "not-installed");
  assert.deepEqual(manager.cancelInstall(), { ok: true, canceled: false });
});

test("launch uses only the verified internal executable with shell disabled and no arguments", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  const calls = [];
  const spawnImpl = (executable, args, options) => {
    calls.push({ executable, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => child.emit("spawn"));
    return child;
  };
  const setup = createManager(layout, files, { spawnImpl });
  await setup.manager.install();
  const launched = await setup.manager.launch({ executable: "ignored", args: ["ignored"] });
  assert.deepEqual(launched, { ok: true, started: true, version: setup.release.version });
  assert.equal(calls.length, 1);
  assert.equal(path.basename(calls[0].executable), PREFERRED_EXECUTABLE);
  assert.deepEqual(calls[0].args, []);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.cwd, path.dirname(calls[0].executable));
});

function sidecarDocument({ video = "fixture.mp4", count = 3, savedAt = "2026-08-15T01:02:03Z" } = {}) {
  const actionKinds = ["TextEntry", "KeyStroke", "MouseLeftClick", "MouseDrag", "MouseWheel"];
  return {
    version: 2,
    currentVideoPath: video,
    savedAtUtc: savedAt,
    status: "Completed",
    events: Array.from({ length: count }, (_value, index) => ({
      offsetTicks: index * 100_000,
      actionKind: actionKinds[index % actionKinds.length],
      actionText: "FIXTURE_TEXT_MUST_NOT_ESCAPE",
      message: "FIXTURE_MESSAGE_MUST_NOT_ESCAPE",
      keyCodes: ["KeyA"],
      modifierKeyCodes: ["ControlLeft"],
      screenX: index + 10,
      screenY: index + 20,
      dragDurationTicks: 50_000,
      isQuarantined: index === 1,
    })),
  };
}

async function writeSidecar(root, relativeFolder, document) {
  const folder = path.join(root, SERIES4_APP_FOLDER, relativeFolder);
  await fs.mkdir(folder, { recursive: true });
  const sidecarPath = path.join(folder, "fixture.mp4.series4.json");
  await fs.writeFile(sidecarPath, `${JSON.stringify(document)}\n`);
  if (!document.currentVideoPath.includes("..")) await fs.writeFile(path.join(folder, "fixture.mp4"), "fixture-video");
  return { folder, sidecarPath };
}

test("session discovery stays inside known roots and exposes metadata plus sanitized timelines only", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  const expected = await writeSidecar(layout.videosDir, "기록 저장소/2026/2026-08/2026-08-15", sidecarDocument({ count: 501 }));
  await writeSidecar(layout.localAppDataDir, "fallback", sidecarDocument({ count: 2, savedAt: "2026-08-14T01:02:03Z" }));
  const outside = path.join(layout.base, "outside");
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(outside, "outside.mp4.series4.json"), JSON.stringify(sidecarDocument()));
  const setup = createManager(layout, files);

  const listed = await setup.manager.listSessions({ limit: 10 });
  assert.equal(listed.sessions.length, 2);
  assert.equal(listed.sessions[0].eventCount, 501);
  assert.equal(Object.hasOwn(listed.sessions[0], "timeline"), false);
  const listText = JSON.stringify(listed);
  assert.equal(listText.includes(layout.base), false);
  assert.equal(listText.includes("FIXTURE_TEXT_MUST_NOT_ESCAPE"), false);
  assert.equal(listText.includes("KeyA"), false);

  const inspected = await setup.manager.inspectSession(listed.sessions[0].sessionId);
  assert.equal(inspected.timeline.length, 500);
  assert.equal(inspected.timelineTruncated, true);
  assert.deepEqual(Object.keys(inspected.timeline[0]), ["type", "actionKind", "offsetMs", "durationMs", "x", "y"]);
  const inspectText = JSON.stringify(inspected);
  assert.equal(inspectText.includes("FIXTURE_TEXT_MUST_NOT_ESCAPE"), false);
  assert.equal(inspectText.includes("FIXTURE_MESSAGE_MUST_NOT_ESCAPE"), false);
  assert.equal(inspectText.includes("KeyA"), false);
  assert.equal(inspectText.includes(layout.base), false);

  const imported = await setup.manager.importSession(listed.sessions[0].sessionId);
  assert.equal(imported.imported, true);
  assert.equal(JSON.stringify(imported).includes(layout.base), false);
  const video = await setup.manager.resolveArtifact(imported.importId, "video");
  const folder = await setup.manager.resolveArtifact(imported.importId, "folder");
  assert.equal(video.path, path.join(expected.folder, "fixture.mp4"));
  assert.equal(folder.path, expected.folder);
});

test("unsafe video references never escape known roots and opaque handles are required", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  await writeSidecar(layout.videosDir, "unsafe", sidecarDocument({ video: "../../../../outside.mp4" }));
  await fs.writeFile(path.join(layout.base, "outside.mp4"), "outside-video");
  const setup = createManager(layout, files);
  const listed = await setup.manager.listSessions();
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.sessions[0].videoAvailable, false);
  await assert.rejects(setup.manager.resolveArtifact(listed.sessions[0].sessionId, "video"), (error) => error.code === "ARTIFACT_NOT_FOUND");
  await assert.rejects(setup.manager.inspectSession(path.join(layout.base, "outside.mp4.series4.json")), (error) => error.code === "SESSION_NOT_FOUND");
});

test("session list limits and invalid sidecars are bounded without leaking parse details", async (t) => {
  const layout = await temporaryLayout(t);
  const files = { [`portable/${PREFERRED_EXECUTABLE}`]: "app" };
  await writeSidecar(layout.videosDir, "valid-a", sidecarDocument({ savedAt: "2026-08-15T00:00:00Z" }));
  await writeSidecar(layout.localAppDataDir, "valid-b", sidecarDocument({ savedAt: "2026-08-14T00:00:00Z" }));
  const invalidFolder = path.join(layout.videosDir, SERIES4_APP_FOLDER, "invalid");
  await fs.mkdir(invalidFolder, { recursive: true });
  await fs.writeFile(path.join(invalidFolder, "invalid.mp4.series4.json"), "{not-json");
  const setup = createManager(layout, files, { maxSessions: 1 });
  const listed = await setup.manager.listSessions({ limit: 50 });
  assert.equal(listed.sessions.length, 1);
  assert.equal(listed.truncated, true);
  assert.equal(listed.skippedCount, 1);
  assert.equal(JSON.stringify(listed).includes("not-json"), false);
  await assert.rejects(setup.manager.listSessions({ limit: 0 }), (error) => error.code === "INVALID_LIMIT");
});
