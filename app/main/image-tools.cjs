const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const { WORKSPACE_DIR } = require("./workspace-tools.cjs");

const ROOT_DIR = path.join(__dirname, "..", "..");
const IMAGE_MODEL_DIR = path.join(ROOT_DIR, "models", "image");
const IMAGE_OUTPUT_DIR = path.join(WORKSPACE_DIR, "images");
const IMAGE_RUNTIME_DIR = path.join(ROOT_DIR, "tools", "image-runtime");
const COMFY_DIR = process.env.HEYU_COMFYUI_DIR || path.join(IMAGE_RUNTIME_DIR, "ComfyUI");
const COMFY_VENV_PYTHON = process.env.HEYU_COMFYUI_PYTHON || defaultComfyPythonPath();
const COMFY_LOG_DIR = path.join(IMAGE_RUNTIME_DIR, "logs");
const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
const MODEL_EXTENSIONS = new Set([".safetensors", ".ckpt", ".gguf", ".bin", ".onnx", ".pt"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const COMFY_EXTRA_MODEL_PATHS_FILE = path.join(IMAGE_MODEL_DIR, "comfy_extra_model_paths.yaml");

let comfyProcess = null;
let comfyStartPromise = null;

function defaultComfyPythonPath() {
  return process.platform === "win32"
    ? path.join(IMAGE_RUNTIME_DIR, ".venv", "Scripts", "python.exe")
    : path.join(IMAGE_RUNTIME_DIR, ".venv", "bin", "python");
}

async function buildImageGenerationArtifact({ prompt, llmText } = {}) {
  const sourcePrompt = String(prompt || "").trim();
  const backends = await detectImageBackends();
  const generationPrompt = extractGenerationPrompt(llmText, sourcePrompt);
  const negativePrompt = extractNegativePrompt(llmText) || defaultNegativePrompt();
  const preferredLocalModel = selectPreferredLocalModel(backends.localModels.files);
  const checkpointSelection = selectPreferredComfyCheckpoint(backends.comfy.checkpoints, preferredLocalModel);
  const intendedModelName = checkpointSelection?.name || preferredLocalModel?.name || "";
  const modelProfile = buildModelProfile(intendedModelName);
  const dimensions = normalizeDimensionsForProfile(inferImageDimensions(sourcePrompt), modelProfile);
  const base = {
    id: `image-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: inferImageTitle(sourcePrompt || generationPrompt),
    kind: "image-generation",
    sourcePrompt,
    prompt: generationPrompt,
    negativePrompt,
    width: dimensions.width,
    height: dimensions.height,
    settings: modelProfile.settings,
    modelDir: backends.modelDir,
    outputDir: backends.outputDir,
    extraModelPathsConfig: backends.extraModelPathsConfig,
    runtimeDir: backends.comfy.runtimeDir,
    provider: "local",
    status: "model-missing",
    statusLabel: "모델 없음",
    message: "",
    suggestions: [],
  };

  if (backends.comfy.ok && backends.comfy.checkpoints.length) {
    if (preferredLocalModel && !checkpointSelection?.matchesLocalModel) {
      return {
        ...base,
        provider: "ComfyUI",
        modelName: preferredLocalModel.name,
        status: "model-not-linked",
        statusLabel: "모델 연결 필요",
        message: "DreamShaper XL 모델은 앱 폴더에서 찾았지만, 현재 실행 중인 ComfyUI 체크포인트 목록에는 아직 보이지 않습니다.",
        suggestions: [
          `ComfyUI를 켤 때 extra model paths 설정을 연결하세요: ${backends.extraModelPathsConfig}`,
          "ComfyUI를 이미 켰다면 재시작하거나 모델 목록을 새로고침한 뒤 다시 요청해 주세요.",
        ],
      };
    }

    try {
      const generated = await generateWithComfy({
        url: backends.comfy.url,
        checkpointName: checkpointSelection?.name || backends.comfy.checkpoints[0],
        prompt: generationPrompt,
        negativePrompt,
        settings: modelProfile.settings,
        ...dimensions,
      });
      return {
        ...base,
        ...generated,
        provider: "ComfyUI",
        modelName: checkpointSelection?.name || backends.comfy.checkpoints[0],
        status: "generated",
        statusLabel: "생성 완료",
        message: `${modelProfile.label} 설정으로 ComfyUI 로컬 실행기가 이미지를 생성했습니다.`,
        suggestions: ["결과가 어색하면 용도, 화면비, 스타일, 피해야 할 요소를 한 번 더 좁혀 다시 생성해보세요."],
      };
    } catch (error) {
      return {
        ...base,
        provider: "ComfyUI",
        modelName: checkpointSelection?.name || backends.comfy.checkpoints[0],
        status: "generation-failed",
        statusLabel: "생성 실패",
        message: `ComfyUI는 감지됐지만 생성 중 오류가 났습니다. ${shortError(error)}`,
        suggestions: [
          "ComfyUI 콘솔 오류를 확인해 주세요.",
          "VRAM이 부족하면 프롬프트에 '작게' 또는 '768'을 넣어 해상도를 낮춰 다시 시도해 주세요.",
        ],
      };
    }
  }

  if (backends.comfy.ok && !backends.comfy.checkpoints.length) {
    return {
      ...base,
      provider: "ComfyUI",
      status: "model-missing",
      statusLabel: "체크포인트 없음",
      message: "ComfyUI는 켜져 있지만 사용할 체크포인트 모델이 없습니다.",
      suggestions: [
        "SDXL 또는 FLUX 체크포인트를 ComfyUI models/checkpoints 폴더에 넣어 주세요.",
        "앱 내 로컬 모델 저장소는 models/image 폴더입니다.",
      ],
    };
  }

  if (backends.localModels.count) {
    return {
      ...base,
      status: "runtime-missing",
      statusLabel: "실행기 없음",
      message: `${preferredLocalModel?.name || "로컬 이미지 모델"}은 찾았습니다. 이제 ComfyUI를 켜면 김그림이 ${modelProfile.label} 설정으로 생성을 시도합니다.`,
      modelName: preferredLocalModel?.name || backends.localModels.files[0]?.name || "",
      suggestions: backends.comfy.runtimeInstalled
        ? [
            "ComfyUI 자동 실행을 시도했지만 아직 준비되지 않았습니다. 잠시 뒤 다시 보내보거나 로그를 확인해 주세요.",
            `로그 폴더: ${COMFY_LOG_DIR}`,
          ]
        : [
            "ComfyUI 런타임이 아직 설치되어 있지 않습니다. tools/image-runtime/install-comfyui.ps1을 한 번 실행해 주세요.",
            `설치 후에는 김그림이 자동으로 ComfyUI를 켜고 이 설정을 붙입니다: ${backends.extraModelPathsConfig}`,
          ],
    };
  }

  return {
    ...base,
    status: "model-missing",
    statusLabel: "모델 없음",
    message: "아직 로컬 이미지 모델이나 ComfyUI 실행기가 연결되어 있지 않아 실제 이미지는 생성하지 못했습니다.",
    suggestions: [
      "모델 파일은 models/image 폴더에 두면 앱에서 감지합니다.",
      "ComfyUI를 쓰려면 로컬에서 실행한 뒤 기본 주소 127.0.0.1:8188 또는 HEYU_COMFYUI_URL로 연결하면 됩니다.",
    ],
  };
}

async function detectImageBackends(options = {}) {
  const autoStartRuntime = options.autoStartRuntime !== false;
  const prepareRuntimeConfig = options.prepareRuntimeConfig !== false;
  const localModels = scanImageModels(IMAGE_MODEL_DIR);
  const extraModelPathsConfig = localModels.length
    ? (prepareRuntimeConfig ? ensureComfyExtraModelPathConfig() : COMFY_EXTRA_MODEL_PATHS_FILE)
    : "";
  const comfyUrl = normalizeComfyUrl(process.env.HEYU_COMFYUI_URL || DEFAULT_COMFY_URL);
  const comfy = {
    url: comfyUrl,
    ok: false,
    checkpoints: [],
    error: "",
    runtimeDir: COMFY_DIR,
    runtimeInstalled: isComfyRuntimeInstalled(),
    startedByApp: false,
  };

  try {
    await getJson(`${comfyUrl}/system_stats`, 600);
    comfy.ok = true;
    try {
      const objectInfo = await getJson(`${comfyUrl}/object_info/CheckpointLoaderSimple`, 900);
      comfy.checkpoints = extractComfyCheckpoints(objectInfo);
    } catch (error) {
      comfy.error = shortError(error);
    }
  } catch (error) {
    comfy.error = shortError(error);
    if (autoStartRuntime && localModels.length && comfy.runtimeInstalled) {
      try {
        await startBundledComfyUI(extraModelPathsConfig);
        await waitForComfyReady(comfyUrl, 75000);
        comfy.startedByApp = true;
        comfy.ok = true;
        const objectInfo = await getJson(`${comfyUrl}/object_info/CheckpointLoaderSimple`, 5000);
        comfy.checkpoints = extractComfyCheckpoints(objectInfo);
        comfy.error = "";
      } catch (startError) {
        comfy.error = shortError(startError);
      }
    }
  }

  return {
    modelDir: IMAGE_MODEL_DIR,
    outputDir: IMAGE_OUTPUT_DIR,
    extraModelPathsConfig,
    localModels: {
      count: localModels.length,
      files: localModels.slice(0, 8),
    },
    comfy,
  };
}

async function checkImageGenerationCapability() {
  const backends = await detectImageBackends({
    autoStartRuntime: false,
    prepareRuntimeConfig: false,
  });
  const preferredLocalModel = selectPreferredLocalModel(backends.localModels.files);
  const checkpointSelection = selectPreferredComfyCheckpoint(backends.comfy.checkpoints, preferredLocalModel);

  if (backends.comfy.ok && backends.comfy.checkpoints.length) {
    if (preferredLocalModel && !checkpointSelection?.matchesLocalModel) {
      return {
        available: false,
        status: "model-not-linked",
        statusLabel: "모델 연결 필요",
        modelName: preferredLocalModel.name,
      };
    }
    return {
      available: true,
      status: "ready",
      statusLabel: "생성 가능",
      modelName: checkpointSelection?.name || backends.comfy.checkpoints[0],
    };
  }

  // A verified local model plus an installed runtime is enough to keep the
  // confirmation flow: the existing confirmed path may start ComfyUI later.
  // This preflight itself never starts a process or submits a workflow.
  if (backends.localModels.count && backends.comfy.runtimeInstalled) {
    return {
      available: true,
      status: "ready-to-start",
      statusLabel: "확인 후 실행 가능",
      modelName: preferredLocalModel?.name || backends.localModels.files[0]?.name || "",
    };
  }

  if (backends.localModels.count) {
    return {
      available: false,
      status: "runtime-missing",
      statusLabel: "실행기 없음",
      modelName: preferredLocalModel?.name || backends.localModels.files[0]?.name || "",
    };
  }

  return {
    available: false,
    status: "model-missing",
    statusLabel: "모델 없음",
    modelName: "",
  };
}

async function generateWithComfy({ url, checkpointName, prompt, negativePrompt, width, height, settings }) {
  const settingAttempts = buildComfySettingAttempts(settings);
  let lastError = null;
  for (const currentSettings of settingAttempts) {
    try {
      return await generateWithComfySettings({
        url,
        checkpointName,
        prompt,
        negativePrompt,
        width,
        height,
        settings: currentSettings,
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("ComfyUI 생성에 실패했습니다.");
}

async function generateWithComfySettings({ url, checkpointName, prompt, negativePrompt, width, height, settings }) {
  const clientId = `heyu-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const workflow = buildComfyWorkflow({ checkpointName, prompt, negativePrompt, width, height, settings });
  const queued = await postJson(`${url}/prompt`, { prompt: workflow, client_id: clientId }, 6000);
  const promptId = queued?.prompt_id;
  if (!promptId) throw new Error("ComfyUI prompt_id를 받지 못했습니다.");

  const startedAt = Date.now();
  while (Date.now() - startedAt < 150000) {
    await wait(1100);
    const history = await getJson(`${url}/history/${encodeURIComponent(promptId)}`, 5000);
    const target = history?.[promptId] || history;
    if (target?.status?.status_str === "error") {
      throw new Error(formatComfyHistoryError(target));
    }
    const images = extractComfyImages(history, promptId);
    if (!images.length) continue;

    const first = images[0];
    const query = new URLSearchParams({
      filename: first.filename || "",
      subfolder: first.subfolder || "",
      type: first.type || "output",
    });
    const response = await requestBuffer(`${url}/view?${query.toString()}`, 20000);
    const ext = normalizeImageExtension(path.extname(first.filename || "")) || ".png";
    const mimeType = mimeFromExtension(ext);
    const saved = saveGeneratedImage(response.body, ext);
    return {
      fileName: saved.fileName,
      workspacePath: saved.workspacePath,
      mimeType,
      base64: response.body.toString("base64"),
      settings,
    };
  }

  throw new Error("ComfyUI 생성 시간이 초과되었습니다.");
}

function buildComfyWorkflow({ checkpointName, prompt, negativePrompt, width, height, settings }) {
  const seed = Math.floor(Math.random() * 1000000000000000);
  const currentSettings = normalizeComfySettings(settings);
  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed,
        steps: currentSettings.steps,
        cfg: currentSettings.cfg,
        sampler_name: currentSettings.sampler,
        scheduler: currentSettings.scheduler,
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: checkpointName,
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: prompt,
        clip: ["4", 1],
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: negativePrompt,
        clip: ["4", 1],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: "heyu_geurim",
        images: ["8", 0],
      },
    },
  };
}

function buildModelProfile(modelName) {
  const normalized = String(modelName || "").toLowerCase();
  if (/dreamshaperxl.*lightning|dreamshaper.*xl.*lightning|lightningdpmsde/.test(normalized)) {
    return {
      id: "dreamshaper-xl-lightning",
      label: "DreamShaper XL Lightning",
      maxPixels: 1024 * 1024,
      settings: {
        steps: 6,
        cfg: 2,
        sampler: "dpmpp_sde",
        scheduler: "karras",
      },
    };
  }
  if (/lightning/.test(normalized)) {
    return {
      id: "sdxl-lightning",
      label: "SDXL Lightning",
      maxPixels: 1024 * 1024,
      settings: {
        steps: 6,
        cfg: 2,
        sampler: "dpmpp_sde",
        scheduler: "karras",
      },
    };
  }
  if (/sd1|sd.?1\.5|1\.5/.test(normalized)) {
    return {
      id: "sd15",
      label: "SD 1.5",
      maxPixels: 768 * 768,
      settings: {
        steps: 24,
        cfg: 6,
        sampler: "euler",
        scheduler: "normal",
      },
    };
  }
  return {
    id: "sdxl",
    label: "SDXL",
    maxPixels: 1024 * 1024,
    settings: {
      steps: 24,
      cfg: 6,
      sampler: "euler",
      scheduler: "normal",
    },
  };
}

function normalizeComfySettings(settings = {}) {
  return {
    steps: clampInteger(settings.steps, 1, 80, 24),
    cfg: clampNumber(settings.cfg, 0.5, 20, 6),
    sampler: String(settings.sampler || "euler"),
    scheduler: String(settings.scheduler || "normal"),
  };
}

function buildComfySettingAttempts(settings) {
  const primary = normalizeComfySettings(settings);
  const fallback = normalizeComfySettings({ steps: 24, cfg: 6, sampler: "euler", scheduler: "normal" });
  if (
    primary.steps === fallback.steps &&
    primary.cfg === fallback.cfg &&
    primary.sampler === fallback.sampler &&
    primary.scheduler === fallback.scheduler
  ) {
    return [primary];
  }
  return [primary, fallback];
}

function clampInteger(value, min, max, fallback) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function selectPreferredLocalModel(files = []) {
  const models = Array.isArray(files) ? files : [];
  return (
    models.find((file) => /dreamshaperxl.*lightning|dreamshaper.*xl.*lightning|lightningdpmsde/i.test(file?.name || file?.relativePath || "")) ||
    models.find((file) => /dreamshaper/i.test(file?.name || file?.relativePath || "")) ||
    models.find((file) => /sdxl|xl/i.test(file?.name || file?.relativePath || "")) ||
    models[0] ||
    null
  );
}

function selectPreferredComfyCheckpoint(checkpoints = [], preferredLocalModel = null) {
  const names = Array.isArray(checkpoints) ? checkpoints.filter(Boolean) : [];
  if (!names.length) return null;
  if (preferredLocalModel?.name) {
    const localName = normalizeModelFileName(preferredLocalModel.name);
    const match = names.find((checkpoint) => normalizeModelFileName(checkpoint) === localName);
    if (match) return { name: match, matchesLocalModel: true };
    return null;
  }
  const preferred =
    names.find((name) => /dreamshaperxl.*lightning|dreamshaper.*xl.*lightning|lightningdpmsde/i.test(name)) ||
    names.find((name) => /dreamshaper/i.test(name)) ||
    names.find((name) => /sdxl|xl/i.test(name)) ||
    names[0];
  return { name: preferred, matchesLocalModel: false };
}

function normalizeModelFileName(value) {
  return path.basename(String(value || "")).toLowerCase();
}

function normalizeDimensionsForProfile(dimensions, profile) {
  const maxPixels = profile?.maxPixels || 1024 * 1024;
  let width = Math.max(256, Number(dimensions?.width || 1024));
  let height = Math.max(256, Number(dimensions?.height || 1024));
  if (width * height > maxPixels) {
    const scale = Math.sqrt(maxPixels / (width * height));
    width = Math.floor((width * scale) / 64) * 64;
    height = Math.floor((height * scale) / 64) * 64;
  }
  return {
    width: Math.max(256, Math.round(width / 64) * 64),
    height: Math.max(256, Math.round(height / 64) * 64),
  };
}

function ensureComfyExtraModelPathConfig() {
  fs.mkdirSync(IMAGE_MODEL_DIR, { recursive: true });
  const root = ROOT_DIR.replaceAll("\\", "/");
  const content = [
    "heyu:",
    `  base_path: ${root}`,
    "  checkpoints: models/image",
    "  loras: models/image/loras",
    "  vae: models/image/vae",
    "",
  ].join("\n");
  try {
    if (!fs.existsSync(COMFY_EXTRA_MODEL_PATHS_FILE) || fs.readFileSync(COMFY_EXTRA_MODEL_PATHS_FILE, "utf8") !== content) {
      fs.writeFileSync(COMFY_EXTRA_MODEL_PATHS_FILE, content, "utf8");
    }
  } catch (_error) {
    // The image model folder can be read-only in some deployments; generation guidance still works without this helper file.
  }
  return COMFY_EXTRA_MODEL_PATHS_FILE;
}

function isComfyRuntimeInstalled() {
  return fs.existsSync(path.join(COMFY_DIR, "main.py")) && fs.existsSync(COMFY_VENV_PYTHON);
}

async function startBundledComfyUI(extraModelPathsConfig) {
  if (!isComfyRuntimeInstalled()) {
    throw new Error(`ComfyUI runtime not installed: ${COMFY_DIR}`);
  }
  if (comfyProcess && !comfyProcess.killed) return;
  if (comfyStartPromise) return comfyStartPromise;

  comfyStartPromise = new Promise((resolve, reject) => {
    fs.mkdirSync(COMFY_LOG_DIR, { recursive: true });
    const stdout = fs.openSync(path.join(COMFY_LOG_DIR, "comfyui.out.log"), "a");
    const stderr = fs.openSync(path.join(COMFY_LOG_DIR, "comfyui.err.log"), "a");
    const args = [
      path.join(COMFY_DIR, "main.py"),
      "--listen",
      "127.0.0.1",
      "--port",
      "8188",
    ];
    if (extraModelPathsConfig) {
      args.push("--extra-model-paths-config", extraModelPathsConfig);
    }

    comfyProcess = spawn(COMFY_VENV_PYTHON, args, {
      cwd: COMFY_DIR,
      stdio: ["ignore", stdout, stderr],
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: "1",
      },
    });

    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      comfyStartPromise = null;
      callback(value);
    };

    comfyProcess.once("error", (error) => settle(reject, error));
    comfyProcess.once("exit", (code) => {
      comfyProcess = null;
      if (!settled) settle(reject, new Error(`ComfyUI exited early with code ${code}`));
    });

    setTimeout(() => settle(resolve), 900);
  });

  return comfyStartPromise;
}

async function waitForComfyReady(url, timeoutMs) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await getJson(`${url}/system_stats`, 3000);
      return;
    } catch (error) {
      lastError = error;
      await wait(1000);
    }
  }
  throw lastError || new Error("ComfyUI ready timeout");
}

function formatComfyHistoryError(target) {
  const messages = Array.isArray(target?.status?.messages) ? target.status.messages : [];
  const flattened = messages
    .map((message) => JSON.stringify(message))
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 240);
  return flattened || "ComfyUI workflow execution failed";
}

function scanImageModels(root) {
  const results = [];
  if (!fs.existsSync(root)) return results;

  const walk = (dir, depth = 0) => {
    if (depth > 3 || results.length >= 200) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_error) {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (!MODEL_EXTENSIONS.has(ext)) continue;
      results.push({
        name: entry.name,
        relativePath: path.relative(root, fullPath).replaceAll("\\", "/"),
      });
    }
  };

  walk(root);
  return results;
}

function extractComfyCheckpoints(objectInfo) {
  const node = objectInfo?.CheckpointLoaderSimple || objectInfo;
  const candidate = node?.input?.required?.ckpt_name;
  if (!Array.isArray(candidate)) return [];
  const values = Array.isArray(candidate[0]) ? candidate[0] : candidate;
  return values.filter((item) => typeof item === "string" && item.trim()).slice(0, 30);
}

function extractComfyImages(history, promptId) {
  const target = history?.[promptId] || history;
  const outputs = target?.outputs || {};
  return Object.values(outputs)
    .flatMap((output) => (Array.isArray(output?.images) ? output.images : []))
    .filter((image) => image?.filename);
}

function extractGenerationPrompt(llmText, fallback) {
  const text = String(llmText || "");
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/네거티브|negative/i.test(line)) continue;
    if (!/프롬프트|prompt/i.test(line)) continue;
    const [, afterColon = ""] = line.split(/[:：]/, 2);
    const inline = cleanPromptLine(afterColon);
    if (inline && !isPromptHeadingLine(inline)) return inline.slice(0, 1200);
    const next = cleanPromptLine(lines[index + 1] || "");
    if (next && !isPromptHeadingLine(next)) return next.slice(0, 1200);
  }

  const english = lines.find((line) => /^[A-Za-z0-9 ,.'"-]{40,}$/.test(line));
  if (english) return cleanPromptLine(english).slice(0, 1200);
  return cleanPromptLine(fallback || "natural documentary style photo, clean composition, soft daylight").slice(0, 1200);
}

function extractNegativePrompt(llmText) {
  const lines = String(llmText || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/네거티브|negative/i.test(line)) continue;
    const [, afterColon = ""] = line.split(/[:：]/, 2);
    const inline = cleanPromptLine(afterColon);
    if (inline && !isPromptHeadingLine(inline)) return inline.slice(0, 600);
    const next = cleanPromptLine(lines[index + 1] || "");
    if (next && !isPromptHeadingLine(next)) return next.slice(0, 600);
  }
  return "";
}

function isPromptHeadingLine(value) {
  return /^(?:이미지\s*브리프|생성\s*프롬프트|포지티브\s*프롬프트|네거티브\s*프롬프트|positive\s*prompt|negative\s*prompt|prompt)$/i.test(String(value || "").trim());
}

function cleanPromptLine(value) {
  return String(value || "")
    .replace(/^[-*•\d.)\s]+/, "")
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, "")
    .trim();
}

function inferImageDimensions(text) {
  const value = String(text || "").toLowerCase();
  const explicit = value.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  if (explicit) return { width: Number(explicit[1]), height: Number(explicit[2]) };
  if (/512|작게|빠르게|테스트/.test(value)) return { width: 768, height: 768 };
  if (/9\s*:\s*16|세로|모바일|스토리|릴스/.test(value)) return { width: 768, height: 1344 };
  if (/16\s*:\s*9|와이드|ppt|슬라이드|배경|banner|wide/.test(value)) return { width: 1344, height: 768 };
  if (/4\s*:\s*3|보고서|문서/.test(value)) return { width: 1152, height: 864 };
  return { width: 1024, height: 1024 };
}

function inferImageTitle(prompt) {
  const text = String(prompt || "이미지 생성")
    .replace(/\s+/g, " ")
    .replace(/[\\/:*?"<>|]/g, "")
    .trim();
  return text ? `김그림 생성: ${text.slice(0, 36)}` : "김그림 이미지 생성";
}

function defaultNegativePrompt() {
  return "low quality, blurry, distorted, watermark, signature";
}

function saveGeneratedImage(buffer, ext) {
  fs.mkdirSync(IMAGE_OUTPUT_DIR, { recursive: true });
  const target = uniquePath(path.join(IMAGE_OUTPUT_DIR, `geurim-${timestampSlug()}${ext}`));
  fs.writeFileSync(target, buffer);
  return {
    fileName: path.basename(target),
    workspacePath: path.relative(WORKSPACE_DIR, target).replaceAll("\\", "/"),
  };
}

function uniquePath(initialPath) {
  const parsed = path.parse(initialPath);
  let target = initialPath;
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return target;
}

function timestampSlug() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
}

function normalizeImageExtension(ext) {
  const value = String(ext || "").toLowerCase();
  return IMAGE_EXTENSIONS.has(value) ? value : ".png";
}

function mimeFromExtension(ext) {
  const value = normalizeImageExtension(ext);
  if (value === ".jpg" || value === ".jpeg") return "image/jpeg";
  if (value === ".webp") return "image/webp";
  return "image/png";
}

function normalizeComfyUrl(url) {
  return String(url || DEFAULT_COMFY_URL).replace(/\/+$/, "");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(url, timeoutMs) {
  const response = await requestBuffer(url, timeoutMs);
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}`);
  }
  return JSON.parse(response.body.toString("utf8") || "{}");
}

async function postJson(url, body, timeoutMs) {
  const payload = Buffer.from(JSON.stringify(body || {}));
  const response = await requestBuffer(url, timeoutMs, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "content-length": String(payload.length),
    },
    body: payload,
  });
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(`HTTP ${response.statusCode}: ${response.body.toString("utf8").slice(0, 240)}`);
  }
  return JSON.parse(response.body.toString("utf8") || "{}");
}

function requestBuffer(url, timeoutMs = 1000, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const request = client.request(
      parsed,
      {
        method: options.method || "GET",
        headers: options.headers || {},
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );

    request.on("error", reject);
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error("request timeout"));
    });
    if (options.body) request.write(options.body);
    request.end();
  });
}

function shortError(error) {
  return String(error?.message || error || "알 수 없는 오류").replace(/\s+/g, " ").slice(0, 180);
}

module.exports = {
  buildImageGenerationArtifact,
  checkImageGenerationCapability,
  detectImageBackends,
};
