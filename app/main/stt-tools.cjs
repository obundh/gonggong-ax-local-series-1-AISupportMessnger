const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { ensureWorkspace, WORKSPACE_DIR } = require("./workspace-tools.cjs");

const ROOT_DIR = path.join(__dirname, "..", "..");
const STT_AUDIO_DIR = path.join(WORKSPACE_DIR, "audio");
const STT_OUTPUT_DIR = path.join(WORKSPACE_DIR, "transcripts");
const WHISPER_MODEL_DIR = bundledAssetDir("models", "whisper");
const WHISPER_RUNTIME_DIR = bundledAssetDir("tools", "whisper");
const DEFAULT_MAX_AUDIO_MB = 120;
const STT_PRESETS = {
  lite: {
    label: "가벼움 · 영어 권장",
    modelKeys: ["small-q5-1", "small", "base", "tiny"],
    enabled: true,
    note: "저사양 CPU에서 빠른 초안을 만드는 프로필입니다. small-q5_1은 영어 음성에 권장하며 한국어 정확도는 상대적으로 낮을 수 있습니다.",
  },
  recommended: {
    label: "권장",
    modelKeys: ["large-v3-turbo-q5-0", "large", "small-q5-1", "small"],
    enabled: true,
    note: "한국어 회의용 large-v3-turbo q5_0 모델을 우선합니다.",
  },
  accurate: {
    label: "정확",
    modelKeys: ["large-v3", "large", "medium"],
    enabled: true,
    note: "설치된 고정밀 모델을 사용합니다. PC 성능에 따라 오래 걸릴 수 있습니다.",
  },
};

function bundledAssetDir(...segments) {
  const unpacked = path.join(process.resourcesPath || "", "app.asar.unpacked", ...segments);
  if (fs.existsSync(unpacked)) return unpacked;
  return path.join(ROOT_DIR, ...segments);
}

async function transcribeSpeechAudio(payload = {}, internalOptions = {}) {
  const signal = internalOptions?.signal;
  if (signal?.aborted) return sttCanceled();

  ensureWorkspace();
  fs.mkdirSync(STT_AUDIO_DIR, { recursive: true });
  fs.mkdirSync(STT_OUTPUT_DIR, { recursive: true });

  const base64 = String(payload.base64 || "");
  if (!base64) {
    return sttFailure("audio-missing", "녹음 데이터가 비어 있습니다.");
  }

  let audioBuffer;
  try {
    audioBuffer = Buffer.from(base64, "base64");
  } catch (_error) {
    return sttFailure("audio-invalid", "녹음 데이터 형식이 올바르지 않습니다.");
  }

  const maxAudioBytes = limitMbToBytes(payload?.limits?.sttAudioMb, DEFAULT_MAX_AUDIO_MB);
  if (!audioBuffer.length || audioBuffer.length > maxAudioBytes) {
    return sttFailure("audio-too-large", `녹음 파일 크기가 현재 처리 범위를 벗어났습니다. 현재 STT 용량 제한은 ${formatLimitMb(maxAudioBytes)}입니다.`);
  }

  const extension = audioExtension(payload.mimeType);
  const audioFileName = `sokgi-${timestampSlug()}${extension}`;
  const audioPath = path.join(STT_AUDIO_DIR, audioFileName);
  fs.writeFileSync(audioPath, audioBuffer);

  const runtime = detectSttRuntime(payload, internalOptions);
  const wantsVad = payload?.vad?.enabled !== false && payload?.vadEnabled !== false;
  const vadModelPath = wantsVad ? firstExisting([
    internalOptions?.managedRuntime?.vadModelPath,
    process.env.HEYU_WHISPER_VAD_MODEL,
    path.join(WHISPER_MODEL_DIR, "ggml-silero-v6.2.0.bin"),
    path.join(WHISPER_MODEL_DIR, "ggml-silero-v5.1.2.bin"),
  ]) : "";
  const initialPrompt = normalizeInitialPrompt(payload.initialPrompt || payload.glossary);
  const resultMode = normalizeResultMode(payload.resultMode);
  const base = {
    ok: false,
    status: runtime.executablePath && runtime.modelPath ? "ready" : runtime.executablePath ? "model-missing" : "runtime-missing",
    statusLabel: runtime.executablePath && runtime.modelPath ? "실행 가능" : runtime.executablePath ? "모델 없음" : "실행기 없음",
    provider: "whisper.cpp",
    transcript: "",
    language: normalizeLanguage(payload.language),
    modelName: runtime.modelName,
    preset: runtime.preset,
    presetLabel: runtime.presetLabel,
    resultMode,
    vad: {
      requested: wantsVad,
      enabled: Boolean(vadModelPath),
      modelName: vadModelPath ? path.basename(vadModelPath) : "",
    },
    audio: {
      fileName: audioFileName,
      workspacePath: path.relative(WORKSPACE_DIR, audioPath).replaceAll("\\", "/"),
      mimeType: String(payload.mimeType || "audio/wav"),
      durationSeconds: Number(payload.durationSeconds || 0),
      size: audioBuffer.length,
      sourceName: String(payload.fileName || payload.sourceName || "").slice(0, 180),
      sourceMimeType: String(payload.sourceMimeType || "").slice(0, 80),
      sourceSize: Number(payload.sourceSize || 0) || 0,
    },
    outputDir: "transcripts",
    suggestions: [],
    message: "",
  };

  if (!runtime.executablePath) {
    return {
      ...base,
      message: "녹음은 저장했지만 whisper.cpp 실행기를 찾지 못했습니다.",
      suggestions: [
        "김속기 설정에서 검증된 whisper.cpp 실행기를 설치해 주세요.",
      ],
    };
  }

  if (!runtime.modelPath) {
    return {
      ...base,
      message: "녹음은 저장했지만 Whisper 모델 파일을 찾지 못했습니다.",
      suggestions: [
        "김속기 설정에서 가벼움 또는 권장 모델을 설치해 주세요.",
      ],
    };
  }

  if (isLikelySilentWav(audioBuffer)) {
    return {
      ...base,
      status: "audio-silent",
      statusLabel: "음성 없음",
      message: "녹음은 저장했지만 음량이 거의 없어 Whisper 변환을 건너뛰었습니다.",
      suggestions: ["마이크 입력 장치와 녹음 음량을 확인한 뒤 다시 녹음해 주세요."],
    };
  }

  const outputBase = path.join(STT_OUTPUT_DIR, path.basename(audioPath, path.extname(audioPath)));
  const args = buildWhisperArgs(runtime.modelPath, audioPath, outputBase, base.language, {
    outputJson: true,
    outputSrt: true,
    outputVtt: true,
    timestamps: true,
    vadModelPath,
    initialPrompt,
  });
  const startedAt = Date.now();
  const whisperRunner = typeof internalOptions.runWhisper === "function" ? internalOptions.runWhisper : runWhisper;
  let result;
  try {
    result = await whisperRunner(runtime.executablePath, args, { signal });
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) {
      cleanupCanceledSttArtifacts(outputBase);
      return sttCanceled();
    }
    throw error;
  }
  if (signal?.aborted || result?.canceled) {
    cleanupCanceledSttArtifacts(outputBase);
    return sttCanceled();
  }
  const transcript = readTranscript(outputBase, result.stdout);

  if (!result.ok || !transcript) {
    return {
      ...base,
      status: "transcription-failed",
      statusLabel: "변환 실패",
      message: `Whisper 실행 중 문제가 생겼습니다.${result.errorText ? ` ${result.errorText}` : ""}`,
      suggestions: [
        "녹음이 너무 짧거나 무음이면 다시 녹음해 주세요.",
        "whisper.cpp 실행기가 WAV 입력을 받을 수 있는지 확인해 주세요.",
      ],
      runtimeMs: Date.now() - startedAt,
    };
  }

  const rawTranscriptPath = `${outputBase}.txt`;
  if (!fs.existsSync(rawTranscriptPath)) fs.writeFileSync(rawTranscriptPath, String(result.stdout || "").trim(), "utf8");
  const transcriptFileName = `${path.basename(outputBase)}-transcript.txt`;
  const transcriptPath = path.join(STT_OUTPUT_DIR, transcriptFileName);
  fs.writeFileSync(transcriptPath, transcript, "utf8");
  const exports = buildSttExports(outputBase, transcriptPath);
  const retainOriginalAudio = payload.retainOriginalAudio !== false;
  if (!retainOriginalAudio) {
    try {
      fs.unlinkSync(audioPath);
      base.audio.workspacePath = "";
      base.audio.retained = false;
    } catch (_error) {
      base.audio.retained = true;
    }
  } else {
    base.audio.retained = true;
  }

  return {
    ...base,
    ok: true,
    status: "transcribed",
    statusLabel: "받아쓰기 완료",
    transcript,
    displayTranscript: transcript,
    exports,
    transcriptFileName,
    transcriptPath: path.relative(WORKSPACE_DIR, transcriptPath).replaceAll("\\", "/"),
    workspacePath: path.relative(WORKSPACE_DIR, rawTranscriptPath).replaceAll("\\", "/"),
    transcriptWorkspacePath: path.relative(WORKSPACE_DIR, transcriptPath).replaceAll("\\", "/"),
    srtPath: exports.srt?.path || "",
    vttPath: exports.vtt?.path || "",
    jsonPath: exports.json?.path || "",
    message: [
      "Whisper 로컬 실행기로 받아쓰기를 완료했습니다.",
      wantsVad && !vadModelPath ? "Silero VAD가 설치되지 않아 전체 음성을 처리했습니다." : "",
      "TXT·SRT·VTT·JSON 결과를 각각 저장했습니다.",
    ].filter(Boolean).join(" "),
    runtimeMs: Date.now() - startedAt,
  };
}

function detectSttRuntime(payload = {}, internalOptions = {}) {
  const modelPreference = normalizeSttPreset(payload.model);
  const executablePath = firstExisting([
    internalOptions?.managedRuntime?.executablePath,
    process.env.HEYU_WHISPER_COMMAND,
    process.env.HEYU_WHISPER_CPP,
    path.join(WHISPER_RUNTIME_DIR, "whisper-cli.exe"),
    path.join(WHISPER_RUNTIME_DIR, "whisper-cli"),
    path.join(WHISPER_RUNTIME_DIR, "main.exe"),
    path.join(WHISPER_RUNTIME_DIR, "main"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "Release", "whisper-cli.exe"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "Release", "whisper-cli"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "Release", "main.exe"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "Release", "main"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "whisper-cli.exe"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "whisper-cli"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "main.exe"),
    path.join(WHISPER_RUNTIME_DIR, "whisper.cpp", "build", "bin", "main"),
  ]);
  const explicitModelPath = firstExisting([process.env.HEYU_WHISPER_MODEL]);
  const managedModelPath = firstExisting([internalOptions?.managedRuntime?.modelPath]);
  const modelPath = managedModelPath || explicitModelPath || selectWhisperModel(modelPreference, normalizeLanguage(payload.language));
  return {
    executablePath,
    modelPath,
    modelName: modelPath ? path.basename(modelPath) : "",
    preset: modelPreference,
    presetLabel: STT_PRESETS[modelPreference]?.label || "권장",
  };
}

function whisperPathArgument(cwd, targetPath) {
  const resolvedCwd = path.resolve(cwd);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedCwd, resolvedTarget);

  // whisper.cpp 1.9.2 on Windows can abort while decoding non-ASCII absolute
  // filesystem arguments. Keep the executable directory as cwd (also needed by
  // its sibling DLLs) and pass a round-trippable ASCII relative path whenever
  // both locations share a filesystem root.
  if (
    relative &&
    !path.isAbsolute(relative) &&
    /^[\x20-\x7e]+$/.test(relative) &&
    sameFilesystemPath(path.resolve(resolvedCwd, relative), resolvedTarget)
  ) {
    return relative;
  }
  return resolvedTarget;
}

function sameFilesystemPath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function buildWhisperSpawnArgs(args, cwd) {
  const pathFlags = new Set(["-m", "-f", "-of", "--vad-model"]);
  const spawnArgs = [...args];
  for (let index = 0; index < spawnArgs.length - 1; index += 1) {
    if (!pathFlags.has(spawnArgs[index])) continue;
    spawnArgs[index + 1] = whisperPathArgument(cwd, spawnArgs[index + 1]);
    index += 1;
  }
  return spawnArgs;
}

function hasUnsupportedWhisperPathArgument(args = []) {
  const pathFlags = new Set(["-m", "-f", "-of", "--vad-model"]);
  for (let index = 0; index < args.length - 1; index += 1) {
    if (!pathFlags.has(args[index])) continue;
    const value = String(args[index + 1] || "");
    if (path.isAbsolute(value) && /[^\x20-\x7e]/.test(value)) return true;
    index += 1;
  }
  return false;
}

function getSttRuntimeStatus(internalOptions = {}) {
  const runtime = detectSttRuntime({ model: "recommended" }, internalOptions);
  const models = listWhisperModels([internalOptions?.managedRuntime?.modelPath]);
  const hasKey = (key) => models.some((model) => model.key === key);
  const presetStatus = Object.entries(STT_PRESETS).map(([value, preset]) => {
    const hasRequiredModel = preset.modelKeys.some(hasKey);
    return {
      value,
      label: preset.label,
      enabled: Boolean(preset.enabled && hasRequiredModel),
      blockedByMemory: false,
      hasRequiredModel,
      note: hasRequiredModel ? preset.note : "해당 프로필 모델이 설치되지 않았습니다.",
      modelKeys: preset.modelKeys,
    };
  });
  return {
    ok: Boolean(runtime.executablePath),
    runtimeReady: Boolean(runtime.executablePath),
    selectedModel: runtime.modelName,
    models,
    presets: presetStatus,
    vad: {
      installed: Boolean(firstExisting([internalOptions?.managedRuntime?.vadModelPath])),
      modelName: internalOptions?.managedRuntime?.vadModelPath
        ? path.basename(internalOptions.managedRuntime.vadModelPath)
        : "",
    },
  };
}

function selectWhisperModel(preference, language = "ko") {
  const explicit = firstExisting([process.env.HEYU_WHISPER_MODEL]);
  if (explicit) return explicit;
  const files = listWhisperModels()
    .filter((model) => language === "en" || !/\.en(?:[-.]|$)/i.test(model.name))
    .map((model) => model.path);
  if (!files.length) return "";

  const preset = STT_PRESETS[normalizeSttPreset(preference)] || STT_PRESETS.recommended;
  for (const key of preset.modelKeys) {
    const preferred = files.find((file) => modelKeyFromName(path.basename(file)) === key || path.basename(file).toLowerCase().includes(key));
    if (preferred) return preferred;
  }

  const order = ["large-v3-turbo-q5-0", "small-q5-1", "small", "base", "medium", "tiny", "large"];
  for (const key of order) {
    const match = files.find((file) => path.basename(file).toLowerCase().includes(key));
    if (match) return match;
  }
  return files[0];
}

function listWhisperModels(extraPaths = []) {
  const candidates = [];
  if (fs.existsSync(WHISPER_MODEL_DIR)) {
    candidates.push(...fs.readdirSync(WHISPER_MODEL_DIR)
      .filter((name) => /\.(bin|gguf)$/i.test(name) && !/silero|vad/i.test(name))
      .map((name) => path.join(WHISPER_MODEL_DIR, name)));
  }
  candidates.push(...extraPaths.filter(Boolean));
  return [...new Set(candidates.map((item) => path.resolve(String(item))))]
    .filter((filePath) => firstExisting([filePath]))
    .map((filePath) => {
      const name = path.basename(filePath);
      const stat = fs.statSync(filePath);
      return {
        name,
        path: filePath,
        key: modelKeyFromName(name),
        size: stat.size,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function modelKeyFromName(name) {
  const text = String(name || "").toLowerCase();
  if (text.includes("large-v3-turbo-q5_0") || text.includes("large-v3-turbo-q5-0")) return "large-v3-turbo-q5-0";
  if (text.includes("small-q5_1") || text.includes("small-q5-1")) return "small-q5-1";
  if (text.includes("large-v3")) return "large-v3";
  if (text.includes("large")) return "large";
  if (text.includes("medium")) return "medium";
  if (text.includes("small")) return "small";
  if (text.includes("base")) return "base";
  if (text.includes("tiny")) return "tiny";
  return "custom";
}

function normalizeSttPreset(value) {
  const text = String(value || "recommended").trim().toLowerCase();
  if (["lite", "fast", "base", "tiny", "small", "small-q5_1", "small-q5-1"].includes(text)) return "lite";
  if (["accurate", "medium", "large", "large-v3", "high"].includes(text)) return "accurate";
  return "recommended";
}

function buildWhisperArgs(modelPath, audioPath, outputBase, language, options = {}) {
  const args = ["-m", modelPath, "-f", audioPath, "-otxt", "-of", outputBase, "-sns"];
  if (options.outputJson) args.push("-oj");
  if (options.outputSrt) args.push("-osrt");
  if (options.outputVtt) args.push("-ovtt");
  if (!options.timestamps) args.push("-nt");
  if (language && language !== "auto") args.push("-l", language);
  if (options.vadModelPath) args.push("--vad", "--vad-model", options.vadModelPath);
  if (options.initialPrompt) args.push("--prompt", options.initialPrompt, "--carry-initial-prompt");
  return args;
}

function runWhisper(executablePath, args, internalOptions = {}) {
  const signal = internalOptions?.signal;
  if (signal?.aborted) return Promise.resolve(whisperCanceledExecution());
  const cwd = path.dirname(path.resolve(executablePath));
  const spawnArgs = buildWhisperSpawnArgs(args, cwd);
  if (hasUnsupportedWhisperPathArgument(spawnArgs)) {
    return Promise.resolve({
      ok: false,
      stdout: "",
      stderr: "",
      errorText: "Windows 경로 호환성 때문에 받아쓰기를 시작하지 못했습니다. 앱 기본 설치 위치와 기본 작업공간을 사용해 주세요.",
    });
  }

  return new Promise((resolve) => {
    const child = spawn(executablePath, spawnArgs, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let canceled = false;
    let timer;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener?.("abort", onAbort);
      resolve(result);
    };
    const onAbort = () => {
      canceled = true;
      try {
        child.kill();
      } catch (_error) {
        finish(whisperCanceledExecution(stdout, stderr));
      }
    };
    timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_error) {
        // Best effort.
      }
    }, 20 * 60 * 1000);

    child.stdout.on("data", (chunk) => {
      stdout = `${stdout}${chunk.toString("utf8")}`.slice(-200000);
    });
    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-200000);
    });
    child.once("error", (error) => {
      if (canceled || signal?.aborted || isAbortError(error)) {
        finish(whisperCanceledExecution(stdout, stderr));
        return;
      }
      finish({ ok: false, stdout, stderr, errorText: safeWhisperError(error) });
    });
    child.once("exit", (code) => {
      if (canceled || signal?.aborted) {
        finish(whisperCanceledExecution(stdout, stderr));
        return;
      }
      finish({
        ok: code === 0,
        stdout,
        stderr,
        errorText: code === 0 ? "" : `whisper.cpp가 종료 코드 ${Number.isInteger(code) ? code : "unknown"}로 중단되었습니다.`,
      });
    });
    signal?.addEventListener?.("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

function whisperCanceledExecution(stdout = "", stderr = "") {
  return {
    ok: false,
    canceled: true,
    stdout,
    stderr,
    errorText: "",
  };
}

function cleanupCanceledSttArtifacts(outputBase) {
  const candidates = [
    `${outputBase}.txt`,
    `${outputBase}.srt`,
    `${outputBase}.vtt`,
    `${outputBase}.json`,
    `${outputBase}-transcript.txt`,
  ];
  for (const filePath of candidates) {
    try {
      fs.unlinkSync(filePath);
    } catch (_error) {
      // A canceled process may not have created every output.
    }
  }
}

function isAbortError(error) {
  return error?.name === "AbortError" || error?.code === "ABORT_ERR";
}

function limitMbToBytes(value, fallbackMb) {
  const mb = Number(value);
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : fallbackMb;
  return Math.max(1, Math.min(4096, safeMb)) * 1024 * 1024;
}

function formatLimitMb(bytes) {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10}MB`;
}

function readTranscript(outputBase, stdout) {
  const txtPath = `${outputBase}.txt`;
  const source = fs.existsSync(txtPath) ? fs.readFileSync(txtPath, "utf8") : String(stdout || "");
  return cleanWhisperTranscript(source);
}

function buildSttExports(outputBase, cleanedTranscriptPath) {
  const candidates = {
    rawTxt: `${outputBase}.txt`,
    cleanedTxt: cleanedTranscriptPath,
    srt: `${outputBase}.srt`,
    vtt: `${outputBase}.vtt`,
    json: `${outputBase}.json`,
  };
  return Object.fromEntries(Object.entries(candidates)
    .filter(([, filePath]) => filePath && fs.existsSync(filePath))
    .map(([key, filePath]) => [key, {
      path: path.relative(WORKSPACE_DIR, filePath).replaceAll("\\", "/"),
      fileName: path.basename(filePath),
    }]));
}

function normalizeInitialPrompt(value) {
  return [...String(value || "")
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()]
    .slice(0, 500)
    .join("");
}

function normalizeResultMode(value) {
  const mode = String(value || "cleanup").toLowerCase();
  return ["cleanup", "minutes", "tasks", "ppt"].includes(mode) ? mode : "cleanup";
}

function cleanWhisperTranscript(value) {
  const cleaned = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\[[^\]]+\]\s*/, "").trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (isLikelyNoiseTranscript(cleaned)) return "";
  return cleaned;
}

function isLikelySilentWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 64) return false;
  if (buffer.slice(0, 4).toString("ascii") !== "RIFF" || buffer.slice(8, 12).toString("ascii") !== "WAVE") return false;
  let offset = 12;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.slice(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    if (id === "data") {
      dataOffset = offset + 8;
      dataSize = Math.min(size, buffer.length - dataOffset);
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (dataOffset < 0 || dataSize < 3200) return false;
  let sumSquares = 0;
  let samples = 0;
  for (let index = dataOffset; index + 1 < dataOffset + dataSize; index += 2) {
    const sample = buffer.readInt16LE(index) / 32768;
    sumSquares += sample * sample;
    samples += 1;
  }
  if (!samples) return false;
  const rms = Math.sqrt(sumSquares / samples);
  return rms < 0.0025;
}

function isLikelyNoiseTranscript(value) {
  const compact = String(value || "").replace(/\s+/g, " ").trim();
  if (!compact) return true;
  const withoutBracketed = compact.replace(/\[[^\]]{1,24}\]/g, "").replace(/[?!.。·ㆍ\s]/g, "");
  if (!withoutBracketed) return true;
  const normalized = compact.replace(/[\[\]\s?!.。]/g, "");
  if (/^(뭐지|음|어|아|음음|응)+$/i.test(normalized)) return true;
  const tokens = compact.match(/[가-힣A-Za-z]+/g) || [];
  if (tokens.length >= 4 && new Set(tokens).size <= 1) return true;
  return false;
}

function normalizeLanguage(value) {
  const text = String(value || "ko").trim().toLowerCase();
  if (["auto", "ko", "en", "ja", "zh"].includes(text)) return text;
  if (/한국|korean/.test(text)) return "ko";
  if (/영어|english/.test(text)) return "en";
  return "ko";
}

function audioExtension(mimeType) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("webm")) return ".webm";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return ".mp3";
  return ".wav";
}

function firstExisting(candidates) {
  return candidates
    .filter(Boolean)
    .map((item) => String(item))
    .find((item) => {
      try {
        return fs.existsSync(item);
      } catch (_error) {
        return false;
      }
    }) || "";
}

function safeWhisperError(error) {
  const code = String(error?.code || "");
  if (code === "ENOENT") return "whisper.cpp 실행기를 찾지 못했습니다.";
  if (code === "EACCES" || code === "EPERM") return "whisper.cpp 실행 권한을 확인해 주세요.";
  return "whisper.cpp 실행을 시작하지 못했습니다.";
}

function sttFailure(status, message) {
  return {
    ok: false,
    status,
    statusLabel: "처리 불가",
    provider: "whisper.cpp",
    transcript: "",
    message,
    suggestions: [],
  };
}

function sttCanceled() {
  return {
    ok: false,
    canceled: true,
    status: "canceled",
    statusLabel: "받아쓰기 취소됨",
    errorCode: "STT_CANCELED",
    provider: "whisper.cpp",
    transcript: "",
    message: "받아쓰기를 취소했습니다.",
    suggestions: [],
  };
}

function timestampSlug() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

module.exports = {
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
};
