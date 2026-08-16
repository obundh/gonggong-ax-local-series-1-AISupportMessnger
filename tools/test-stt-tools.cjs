const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-stt-tools-"));
process.env.HEYU_WORKSPACE_DIR = path.join(temporaryRoot, "workspace");
process.on("exit", () => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

const {
  buildWhisperArgs,
  buildWhisperSpawnArgs,
  detectSttRuntime,
  getSttRuntimeStatus,
  hasUnsupportedWhisperPathArgument,
  modelKeyFromName,
  normalizeInitialPrompt,
  normalizeSttPreset,
  runWhisper,
  sttCanceled,
  transcribeSpeechAudio,
} = require("../app/main/stt-tools.cjs");

function fixtureFile(name, contents = "fixture") {
  const filePath = path.join(temporaryRoot, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
  return filePath;
}

test("managed runtime paths override bundled discovery without renderer path fields", () => {
  const executablePath = fixtureFile("runtime/whisper-cli.exe");
  const modelPath = fixtureFile("models/ggml-large-v3-turbo-q5_0.bin");
  const legacyExecutable = fixtureFile("legacy/whisper-cli.exe");
  const legacyModel = fixtureFile("legacy/ggml-small.bin");
  const previousExecutable = process.env.HEYU_WHISPER_COMMAND;
  const previousModel = process.env.HEYU_WHISPER_MODEL;
  process.env.HEYU_WHISPER_COMMAND = legacyExecutable;
  process.env.HEYU_WHISPER_MODEL = legacyModel;
  try {
    const runtime = detectSttRuntime(
      { model: "recommended", language: "ko", executablePath: "ignored", modelPath: "ignored" },
      { managedRuntime: { executablePath, modelPath } }
    );
    assert.equal(runtime.executablePath, executablePath);
    assert.equal(runtime.modelPath, modelPath);
    assert.equal(runtime.preset, "recommended");
    assert.equal(modelKeyFromName(path.basename(modelPath)), "large-v3-turbo-q5-0");

    const status = getSttRuntimeStatus({ managedRuntime: { executablePath, modelPath } });
    assert.equal(status.ok, true);
    assert.equal(status.selectedModel, path.basename(modelPath));
    assert.equal(status.presets.find((item) => item.value === "recommended")?.enabled, true);
  } finally {
    if (previousExecutable === undefined) delete process.env.HEYU_WHISPER_COMMAND;
    else process.env.HEYU_WHISPER_COMMAND = previousExecutable;
    if (previousModel === undefined) delete process.env.HEYU_WHISPER_MODEL;
    else process.env.HEYU_WHISPER_MODEL = previousModel;
  }
});

test("profiles and glossary are normalized deterministically", () => {
  assert.equal(normalizeSttPreset("balanced"), "recommended");
  assert.equal(normalizeSttPreset("small-q5_1"), "lite");
  assert.equal(normalizeSttPreset("large-v3"), "accurate");
  const prompt = normalizeInitialPrompt(` 기관명\n${"가".repeat(700)}\u0000`);
  assert.equal([...prompt].length, 500);
  assert.equal(/[\x00-\x1f]/.test(prompt), false);
});

test("whisper arguments enable local VAD, glossary, and all export formats", () => {
  const args = buildWhisperArgs("model.bin", "audio.wav", "result", "ko", {
    outputJson: true,
    outputSrt: true,
    outputVtt: true,
    timestamps: true,
    vadModelPath: "vad.bin",
    initialPrompt: "기관명, 사업명",
  });
  for (const value of ["-oj", "-osrt", "-ovtt", "--vad", "--vad-model", "--prompt", "--carry-initial-prompt"]) {
    assert.equal(args.includes(value), true, value);
  }
  assert.deepEqual(args.slice(args.indexOf("--vad"), args.indexOf("--vad") + 3), ["--vad", "--vad-model", "vad.bin"]);
  assert.equal(args.includes("-nt"), false);
});

test("Korean absolute STT paths become ASCII argv relative to the executable cwd", () => {
  const cwd = path.join(temporaryRoot, "한국어 앱", "runtime", "Release");
  const modelPath = path.join(temporaryRoot, "한국어 앱", "models", "ggml-small-q5_1.bin");
  const audioPath = path.join(temporaryRoot, "workspace", "audio", "recording.wav");
  const outputBase = path.join(temporaryRoot, "workspace", "transcripts", "recording");
  const vadModelPath = path.join(temporaryRoot, "한국어 앱", "models", "ggml-silero-v6.2.0.bin");
  const originalArgs = buildWhisperArgs(modelPath, audioPath, outputBase, "ko", {
    outputJson: true,
    outputSrt: true,
    outputVtt: true,
    vadModelPath,
  });
  const spawnArgs = buildWhisperSpawnArgs(originalArgs, cwd);

  for (const flag of ["-m", "-f", "-of", "--vad-model"]) {
    const argument = spawnArgs[spawnArgs.indexOf(flag) + 1];
    assert.equal(path.isAbsolute(argument), false, `${flag} should be relative`);
    assert.match(argument, /^[\x20-\x7e]+$/, `${flag} should be ASCII`);
  }
  assert.equal(path.resolve(cwd, spawnArgs[spawnArgs.indexOf("-m") + 1]), modelPath);
  assert.equal(path.resolve(cwd, spawnArgs[spawnArgs.indexOf("-f") + 1]), audioPath);
  assert.equal(path.resolve(cwd, spawnArgs[spawnArgs.indexOf("--vad-model") + 1]), vadModelPath);
  assert.deepEqual(originalArgs.slice(0, 2), ["-m", modelPath], "caller args must not be mutated");
});

test("path argv fallback never invents a relative path across Unicode suffixes or Windows drives", (t) => {
  if (process.platform !== "win32") {
    t.skip("Windows path semantics only");
    return;
  }
  const cwd = "C:\\Program Files\\AI지원담당\\resources\\stt-bundle\\runtime\\Release";
  const unicodeUserPath = "C:\\Users\\홍길동\\AppData\\Roaming\\local-ai-messenger\\workspace\\audio\\recording.wav";
  const otherDrivePath = "D:\\heyu-workspace\\transcripts\\recording";
  const spawnArgs = buildWhisperSpawnArgs(["-f", unicodeUserPath, "-of", otherDrivePath], cwd);

  assert.equal(spawnArgs[1], unicodeUserPath);
  assert.equal(spawnArgs[3], otherDrivePath);
  assert.equal(hasUnsupportedWhisperPathArgument(spawnArgs), true);
});

test("runWhisper fails closed instead of spawning whisper.cpp with an unsupported Unicode absolute path", async () => {
  const result = await runWhisper(process.execPath, ["-f", "C:\\Users\\홍길동\\recording.wav"]);
  assert.equal(result.ok, false);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
  assert.match(result.errorText, /Windows 경로 호환성/);
});

test("pre-aborted transcription returns the fixed path-free canceled result", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await transcribeSpeechAudio({
    base64: Buffer.from("unused").toString("base64"),
  }, { signal: controller.signal });
  assert.deepEqual(result, sttCanceled());
  assert.equal("executablePath" in result, false);
  assert.equal("modelPath" in result, false);
});

test("duration metadata beyond 15 minutes is accepted while the byte limit remains enforced", async () => {
  const executablePath = fixtureFile("long-recording/Release/whisper-cli.exe");
  const modelPath = fixtureFile("long-recording/models/ggml-small-q5_1.bin");
  const durationSeconds = (15 * 60) + 37;
  const result = await transcribeSpeechAudio({
    base64: Buffer.from("long recording metadata fixture").toString("base64"),
    mimeType: "audio/wav",
    durationSeconds,
    language: "en",
    model: "lite",
    limits: { sttAudioMb: 1 },
  }, {
    managedRuntime: { executablePath, modelPath },
    async runWhisper(_executable, args) {
      const outputBase = args[args.indexOf("-of") + 1];
      fs.writeFileSync(`${outputBase}.txt`, "Long recording transcription completed.\n", "utf8");
      return { ok: true, stdout: "", stderr: "", errorText: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.audio.durationSeconds, durationSeconds);

  const oversized = await transcribeSpeechAudio({
    base64: Buffer.alloc((1024 * 1024) + 1, 1).toString("base64"),
    limits: { sttAudioMb: 1 },
  });
  assert.equal(oversized.ok, false);
  assert.equal(oversized.status, "audio-too-large");
});

test("runWhisper terminates its child when the internal signal is aborted", async () => {
  const controller = new AbortController();
  const running = runWhisper(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.canceled, true);
  assert.equal(result.errorText, "");
});

test("transcription writes raw, cleaned, SRT, VTT, and JSON while honoring audio retention", async () => {
  const executablePath = fixtureFile("managed/Release/whisper-cli.exe");
  const modelPath = fixtureFile("managed/models/ggml-large-v3-turbo-q5_0.bin");
  const vadModelPath = fixtureFile("managed/models/ggml-silero-v6.2.0.bin");
  let invokedArgs = [];
  const result = await transcribeSpeechAudio({
    base64: Buffer.from("synthetic audio fixture").toString("base64"),
    mimeType: "audio/mpeg",
    language: "ko",
    model: "recommended",
    initialPrompt: "기관명, 장비명",
    resultMode: "minutes",
    diarization: { enabled: true, speakerCount: 2 },
    vad: { enabled: true },
    retainOriginalAudio: false,
  }, {
    managedRuntime: { executablePath, modelPath, vadModelPath },
    async runWhisper(_executable, args) {
      invokedArgs = args;
      const outputBase = args[args.indexOf("-of") + 1];
      fs.writeFileSync(`${outputBase}.txt`, "안녕하세요. 장비 점검은 15시에 끝났습니다.\n", "utf8");
      fs.writeFileSync(`${outputBase}.srt`, "1\n00:00:00,000 --> 00:00:02,000\n안녕하세요.\n", "utf8");
      fs.writeFileSync(`${outputBase}.vtt`, "WEBVTT\n\n00:00.000 --> 00:02.000\n안녕하세요.\n", "utf8");
      fs.writeFileSync(`${outputBase}.json`, JSON.stringify({
        transcription: [{ offsets: { from: 0, to: 2000 }, text: "안녕하세요." }],
      }), "utf8");
      return { ok: true, stdout: "", stderr: "", errorText: "" };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.resultMode, "minutes");
  assert.equal(result.vad.enabled, true);
  assert.equal(result.audio.retained, false);
  assert.equal(result.audio.workspacePath, "");
  assert.equal(invokedArgs.includes(vadModelPath), true);
  assert.equal(invokedArgs.includes("기관명, 장비명"), true);
  assert.equal(Object.hasOwn(result, "diarization"), false);
  assert.equal(Object.hasOwn(result.exports, "speakers"), false);
  for (const key of ["rawTxt", "cleanedTxt", "srt", "vtt", "json"]) {
    const exportPath = result.exports[key]?.path;
    assert.equal(Boolean(exportPath), true, key);
    assert.equal(fs.existsSync(path.join(process.env.HEYU_WORKSPACE_DIR, exportPath)), true, key);
  }
});
