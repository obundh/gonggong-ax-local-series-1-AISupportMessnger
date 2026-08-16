const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const { normalizeManifest } = require("../app/main/stt-runtime-manager.cjs");
const {
  STT_ASSETS,
  STT_MANIFEST,
  STT_TRUSTED_URL_PREFIXES,
} = require("../app/main/stt-catalog.cjs");
const {
  gemma4CapacityBillions,
  sttTurboPerformanceNotice,
} = require("../app/main/stt-performance-policy.cjs");

test("production STT catalog is pinned, checksummed, and separates VAD from selectable models", () => {
  const normalized = normalizeManifest(STT_MANIFEST, {
    trustedUrlPrefixes: STT_TRUSTED_URL_PREFIXES,
    requireRuntimeFileChecksums: true,
  });
  assert.equal(normalized.runtimes.length, 1);
  assert.equal(normalized.runtimes[0].version, "1.9.2");
  assert.equal(normalized.runtimes[0].artifact.sha256.length, 64);
  assert.equal(normalized.runtimes[0].fileChecksums[normalized.runtimes[0].executable].length, 64);
  for (const file of normalized.runtimes[0].requiredFiles) {
    assert.equal(normalized.runtimes[0].fileChecksums[file]?.length, 64, file);
  }
  assert.equal(normalized.models.filter((item) => item.modelKey !== "vad").length, 2);
  assert.equal(normalized.models.filter((item) => item.modelKey === "vad").length, 1);
  assert.deepEqual(STT_ASSETS.map((item) => item.id), [
    "runtime-whisper-cpp-1.9.2",
    "model-small-q5_1",
    "model-large-v3-turbo-q5_0",
    "vad-silero-6.2.0",
  ]);
});

test("Electron IPC binds local-file tokens to catalog IDs without renderer paths or URLs", () => {
  const main = read("app/main/main.cjs");
  const preload = read("app/main/preload.cjs");
  assert.match(main, /findSttAsset\(payload\?\.assetId\)/);
  assert.match(main, /transcribeSpeechAudio\([\s\S]*\{ managedRuntime, signal: controller\.signal \}/);
  assert.match(main, /selectManagedSttModelForPreset\(payload\?\.model\)/);
  assert.match(main, /if \(!desired\) \{[\s\S]*modelPath: ""[\s\S]*modelInstallationId: ""/);
  assert.match(main, /ipcMain\.handle\("stt:asset:file-select"/);
  assert.match(main, /issueSttAssetFileGrant\(event\.sender\.id, asset, result\.filePaths\[0\]\)/);
  assert.match(main, /consumeSttAssetFileGrant\(event\.sender\.id, asset\.id, payload\?\.fileToken\)/);
  assert.match(main, /manager\.importRuntimeFromFile\(asset\.catalogId, grantedFile\.path/);
  assert.match(main, /manager\.importModelFromFile\(asset\.catalogId, grantedFile\.path/);
  assert.doesNotMatch(main, /manager\.install(?:Runtime|Model)\(asset\.catalogId/);
  assert.match(main, /performanceNotice: sttTurboPerformanceNotice\(getLocalModelRuntimeConfig\(\)\.model\)/);
  assert.match(main, /stt:asset:install-progress/);
  assert.match(preload, /selectSttAssetFile\(payload\)/);
  assert.match(preload, /installSttAsset\(payload\)/);
  assert.match(preload, /cancelSttAssetInstall\(payload\)/);
  assert.match(preload, /onSttInstallProgress\(callback\)/);
  assert.match(main, /const activeSttTranscriptions = new Map\(\)/);
  assert.match(main, /activeSttTranscriptions\.has\(senderId\)/);
  assert.match(main, /sender\.once\("destroyed", abortWhenDestroyed\)/);
  assert.match(main, /ipcMain\.handle\("stt:transcribe-cancel"/);
  assert.match(preload, /cancelSpeechTranscription\(\)/);
});

test("packaged workspace and STT output opener stay in writable scoped directories", () => {
  const main = read("app/main/main.cjs");
  const workspaceAssignment = main.indexOf('process.env.HEYU_WORKSPACE_DIR = path.join(app.getPath("userData"), "workspace")');
  const workspaceRequire = main.indexOf('require("./workspace-tools.cjs")');
  assert.equal(workspaceAssignment > 0 && workspaceAssignment < workspaceRequire, true);
  assert.match(main, /fs\.realpathSync\.native\(WORKSPACE_DIR\)/);
  assert.match(main, /isExistingWorkspacePathInside\(WORKSPACE_DIR, fallbackDir\)/);
  assert.match(main, /isExistingWorkspacePathInside\(fallbackDir, requestedPath\) \|\| isExistingWorkspacePathInside\(stenoAudioDir, requestedPath\)/);
});

test("renderer exposes local-file install, VAD, glossary, Turbo default, warning, and export controls", () => {
  const html = read("app/renderer/chat.html");
  const renderer = read("app/renderer/chat.js");
  for (const id of [
    "sttRuntimeManager",
    "sttVad",
    "sttRetainAudio",
    "sttInitialPrompt",
    "sttResultMode",
    "sttOutputLinks",
    "sttCancelButton",
    "sttCapacityNote",
    "sttPerformanceWarning",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`), id);
  }
  assert.match(html, /value="lite"/);
  assert.match(html, /value="recommended"/);
  assert.match(renderer, /selectSttAssetFile\(\{ assetId \}\)/);
  assert.match(renderer, /installSttAsset\(\{ assetId, fileToken: selection\.file\.fileToken \}\)/);
  assert.doesNotMatch(renderer, /selection\.file\.path/);
  assert.match(renderer, /function handleChatLocalModelChanged[\s\S]*if \(isSttOfficer\(\)\) void refreshSttRuntimeStatus\(\)/);
  assert.match(renderer, /initialPrompt:/);
  assert.match(renderer, /resultMode:/);
  assert.match(renderer, /vad:\s*\{\s*enabled:/);
  assert.match(renderer, /retainOriginalAudio:/);
  assert.match(renderer, /isSttWhisperActive/);
  assert.match(renderer, /cancelSpeechTranscription/);
  assert.doesNotMatch(renderer, /STT_MAX_IN_MEMORY_SECONDS|probeSttAudioDuration/);
  assert.doesNotMatch(`${html}\n${renderer}`, /최대\s*15분|15분\s*제한|15분\s*이하/);
  assert.match(renderer, /assertSttAudioWithinByteLimit\(decoded\.wav\.byteLength/);
  assert.match(renderer, /estimateSttWavBytes\(elapsed\)[\s\S]*sttUploadLimitBytes\(\)/);
  assert.match(html, /value="recommended" selected/);
  assert.match(html, /large-v3-turbo-q5_0은 한국어 품질을 우선하지만 PC에 따라 무거울 수 있습니다/);
  assert.match(html, /small-q5_1은 로컬 파일로 설치할 수 있으며 Lite·영어 음성·저사양 PC에 권장/);
  assert.doesNotMatch(html, /선택 다운로드|공식 배포처에서 내려받/);
  assert.match(html, /녹음 시작 → 정지\+STT/);
  assert.match(html, /TXT·SRT·VTT·JSON/);
  assert.match(renderer, /asset\.verified === true \? "SHA-256 재검증 완료" : "설치 기록 확인 · 필요 시 재검증"/);
  assert.match(html, /외부 OpenAI 호환 서버를 설정했다면 그 서버로 전송될 수 있으며/);
});

test("Turbo warning requires a recognizably adequate Gemma4 tag", () => {
  assert.equal(gemma4CapacityBillions("gemma4:e4b"), 4);
  assert.equal(gemma4CapacityBillions("gemma4:12b-it-q4_K_M"), 12);
  assert.equal(sttTurboPerformanceNotice("gemma4:31b").adequate, true);
  for (const model of ["gemma4:e2b", "gemma4", "qwen3:8b", "", "not-gemma4:e12b"]) {
    const notice = sttTurboPerformanceNotice(model);
    assert.equal(notice.adequate, false, model);
    assert.match(notice.warning, /Turbo는 무거울 수 있으니 Lite\/영어용 small을 권장/);
  }
});

test("speaker diarization runtime and controls are not shipped", () => {
  const html = read("app/renderer/chat.html");
  const renderer = read("app/renderer/chat.js");
  const styles = read("app/renderer/styles.css");
  const sttTools = read("app/main/stt-tools.cjs");
  const packageJson = read("package.json");
  assert.doesNotMatch(html, /sttDiarization|sttSpeakerCount|data-stt-stage=["']speaker["']/);
  assert.doesNotMatch(renderer, /sttDiarization|sttSpeakerCount|diarization\s*:/);
  assert.match(styles, /\.stt-stage-strip\s*\{[\s\S]*?grid-template-columns:\s*repeat\(3,/);
  assert.doesNotMatch(styles, /\.stt-stage-strip span\[data-state=["']skipped["']\]/);
  assert.doesNotMatch(sttTools, /diarization-tools|runSpeakerDiarization|getDiarizationRuntimeStatus/);
  assert.doesNotMatch(packageJson, /sherpa-onnx|models\/diarization/);
});
