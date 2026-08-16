const { app, BrowserWindow, Notification, Tray, Menu, nativeImage, dialog, ipcMain, screen, session, shell, clipboard, protocol, net } = require("electron");
const readline = require("readline");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { fileURLToPath, pathToFileURL } = require("url");

// Packaged Electron resources are read-only. Resolve the workspace before any
// module captures HEYU_WORKSPACE_DIR at require time.
if (!process.env.HEYU_WORKSPACE_DIR && app.isPackaged) {
  process.env.HEYU_WORKSPACE_DIR = path.join(app.getPath("userData"), "workspace");
}

const {
  checkOfficerStatus,
  getLocalModelRuntimeConfig,
  igniteOfficer,
  sendOfficerMessage,
  setRuntimeSelectedModel,
} = require("./llm.cjs");
const {
  createLocalModelManager,
  officialDestination,
  validateModelTag,
} = require("./local-model-manager.cjs");
const { shutdownOfficerMcp } = require("./mcp-client.cjs");
const { getSttRuntimeStatus, transcribeSpeechAudio } = require("./stt-tools.cjs");
const {
  DOCUMENT_RESOURCE_LIMITS,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  analyzeDocumentResources,
  previewDocumentResource,
  publicDocumentResourceError,
  safeOutputFileName,
  saveAllDocumentResources,
  saveDocumentResource,
} = require("./document-resource-tools.cjs");
const { createSttRuntimeManager } = require("./stt-runtime-manager.cjs");
const {
  mergeManagedAndBundledSttPaths,
  resolveBundledSttAssets,
} = require("./bundled-stt-assets.cjs");
const { sttTurboPerformanceNotice } = require("./stt-performance-policy.cjs");
const { createSeries4Integration } = require("./series4-integration.cjs");
const {
  STT_ASSETS,
  STT_MANIFEST,
  STT_TRUSTED_URL_PREFIXES,
  findSttAsset,
} = require("./stt-catalog.cjs");
const { convertImageFiles, compressFiles, mergePdfFiles, splitPdfFile, inspectPdfFile, previewPdfFile, reorderPdfPages, conversionOutputDir } = require("./converter-tools.cjs");
const { checkWebInputStatus, runWebInput } = require("./web-input-tools.cjs");
const { inspectOpenWindows, inspectPrivacyFile, listOpenWindows, scanPrivacyText } = require("./privacy-tools.cjs");
const {
  ensureWorkspace,
  getWorkspaceSnapshot,
  indexWorkspaceFiles,
  shutdownWorkspaceMcp,
  WORKSPACE_DIR,
} = require("./workspace-tools.cjs");

protocol.registerSchemesAsPrivileged([
  {
    scheme: "heyu-series4",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

const ROOT_DIR = path.join(__dirname, "..", "..");
const APP_ICON_PNG_PATH = path.join(__dirname, "..", "renderer", "assets", "app-icon.png");
const APP_ICON_ICO_PATH = path.join(__dirname, "..", "renderer", "assets", "app-icon.ico");
const APP_USER_MODEL_ID = "local.ai.messenger";
const APP_DISPLAY_NAME = "AI지원담당";
const ACTIVE_CONTACT_IDS = new Set([
  "chief",
  "admin-officer",
  "translator",
  "file-converter",
  "language",
  "image-officer",
  "steno-officer",
  "resource-officer",
  "privacy-officer",
  "routine-officer",
  "nori",
]);

let mainWindow;
let tray = null;
let isQuitting = false;
const chatWindows = new Map();
const configWindows = new Map();
const profileWindows = new Map();
const pdfEditorWindows = new Map();
const chatSessions = new Map();
const contactConfigs = new Map();
const routineRecorders = new Map();
const routineExecutions = new Map();
const frustrationWebInputs = new Map();
const pendingChatReplies = new Set();
const selectedFileGrants = new Map();
const resourceFileGrantOwners = new Map();
const sttAssetFileGrantOwners = new Map();
const documentResourceSessions = new Map();
const activeDocumentResourceJobs = new Map();
const documentResourceOutputDirs = new Map();
const documentResourceSenderLifecycle = new Set();

const DEFAULT_LIMIT_SETTINGS = {
  graphFileMb: 30,
  converterFileMb: 200,
  converterPdfTotalMb: 300,
  converterImageMegapixels: 80,
  sttAudioMb: 120,
  generatedFileMb: 15,
};

const DEFAULT_ROUTINE_SAFETY = {
  allowFileOpen: false,
  allowProgramLaunch: false,
};
const ROUTINE_EXECUTABLE_EXTENSIONS = new Set([
  ".exe",
  ".bat",
  ".cmd",
  ".com",
  ".msi",
  ".ps1",
  ".vbs",
  ".js",
  ".jse",
  ".wsf",
  ".scr",
  ".lnk",
  ".reg",
]);

const DEFAULT_APP_SETTINGS = {
  replyDoneNotifications: true,
  limits: { ...DEFAULT_LIMIT_SETTINGS },
  routineSafety: { ...DEFAULT_ROUTINE_SAFETY },
  llm: { selectedModel: "" },
};
const FILE_GRANT_TTL_MS = 30 * 60 * 1000;
const DOCUMENT_RESOURCE_SESSION_TTL_MS = 30 * 60 * 1000;
let appSettings = { ...DEFAULT_APP_SETTINGS };
let localModelManager = null;
let sttRuntimeManager = null;
let series4Integration = null;
let activeSttInstallAssetId = "";
const verifiedSttAssetIds = new Set();
const activeSttTranscriptions = new Map();

function settingsFilePath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadAppSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsFilePath(), "utf8"));
    appSettings = normalizeAppSettings(parsed);
  } catch (_error) {
    appSettings = { ...DEFAULT_APP_SETTINGS };
  }
  setRuntimeSelectedModel(appSettings.llm.selectedModel);
  return appSettings;
}

function saveAppSettings(nextSettings = {}) {
  appSettings = normalizeAppSettings({
    ...appSettings,
    ...nextSettings,
  });
  try {
    fs.mkdirSync(path.dirname(settingsFilePath()), { recursive: true });
    fs.writeFileSync(settingsFilePath(), JSON.stringify(appSettings, null, 2), "utf8");
  } catch (_error) {
    // Settings persistence is best-effort; keep the in-memory value.
  }
  setRuntimeSelectedModel(appSettings.llm.selectedModel);
  updateTrayMenu();
  return appSettings;
}

function normalizeAppSettings(value = {}) {
  return {
    replyDoneNotifications: value.replyDoneNotifications !== false,
    limits: normalizeLimitSettings(value.limits),
    routineSafety: normalizeRoutineSafety(value.routineSafety),
    llm: {
      selectedModel: validateModelTag(value.llm?.selectedModel) ? value.llm.selectedModel : "",
    },
  };
}

function normalizeLimitSettings(value = {}) {
  return {
    graphFileMb: normalizeNumberLimit(value.graphFileMb, DEFAULT_LIMIT_SETTINGS.graphFileMb, 1, 1024),
    converterFileMb: normalizeNumberLimit(value.converterFileMb, DEFAULT_LIMIT_SETTINGS.converterFileMb, 1, 4096),
    converterPdfTotalMb: normalizeNumberLimit(value.converterPdfTotalMb, DEFAULT_LIMIT_SETTINGS.converterPdfTotalMb, 1, 8192),
    converterImageMegapixels: normalizeNumberLimit(value.converterImageMegapixels, DEFAULT_LIMIT_SETTINGS.converterImageMegapixels, 1, 500),
    sttAudioMb: normalizeNumberLimit(value.sttAudioMb, DEFAULT_LIMIT_SETTINGS.sttAudioMb, 1, 4096),
    generatedFileMb: normalizeNumberLimit(value.generatedFileMb, DEFAULT_LIMIT_SETTINGS.generatedFileMb, 1, 1024),
  };
}

function normalizeRoutineSafety(value = {}) {
  return {
    allowFileOpen: Boolean(value.allowFileOpen),
    allowProgramLaunch: Boolean(value.allowProgramLaunch),
  };
}

function normalizeNumberLimit(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number * 10) / 10));
}

function limitMbToBytes(value, fallbackMb) {
  return normalizeNumberLimit(value, fallbackMb, 1, 8192) * 1024 * 1024;
}

function isExistingFile(candidate) {
  if (!candidate) return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch (_error) {
    return false;
  }
}

function detectOllamaExecutable() {
  const candidates = [];
  if (process.env.OLLAMA_EXE) candidates.push(process.env.OLLAMA_EXE);

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "Programs", "Ollama", "ollama.exe"));
  } else if (process.platform === "darwin") {
    candidates.push(
      "/Applications/Ollama.app/Contents/Resources/ollama",
      "/opt/homebrew/bin/ollama",
      "/usr/local/bin/ollama"
    );
  } else {
    candidates.push("/usr/local/bin/ollama", "/usr/bin/ollama");
  }

  const executableName = process.platform === "win32" ? "ollama.exe" : "ollama";
  for (const directory of String(process.env.PATH || "").split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, executableName));
  }
  return { installed: candidates.some(isExistingFile) };
}

function broadcastLocalModelChanged(payload) {
  for (const target of BrowserWindow.getAllWindows()) {
    if (!target.isDestroyed() && !target.webContents.isDestroyed()) {
      target.webContents.send("llm:model-changed", payload || {});
    }
  }
}

function getLocalModelManager() {
  if (localModelManager) return localModelManager;
  localModelManager = createLocalModelManager({
    getSelectedModel: () => appSettings.llm.selectedModel,
    setSelectedModel: (selectedModel) => {
      saveAppSettings({ llm: { selectedModel } });
    },
    getConfig: getLocalModelRuntimeConfig,
    detectExecutable: detectOllamaExecutable,
  });
  return localModelManager;
}

function getManagedSttRuntime() {
  if (sttRuntimeManager) return sttRuntimeManager;
  sttRuntimeManager = createSttRuntimeManager({
    userDataDir: app.getPath("userData"),
    manifest: STT_MANIFEST,
    trustedUrlPrefixes: STT_TRUSTED_URL_PREFIXES,
    requireRuntimeFileChecksums: true,
  });
  return sttRuntimeManager;
}

const SERIES4_PUBLIC_ERROR_CODES = new Set([
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_OPEN_FAILED",
  "CHECKSUM_MISMATCH",
  "DOWNLOAD_FAILED",
  "EXTRACTION_FAILED",
  "INCOMPATIBLE_PLATFORM",
  "INSTALL_FAILED",
  "INSTALL_INCOMPLETE",
  "INSTALL_TIMEOUT",
  "INVALID_ARTIFACT_KIND",
  "INVALID_ARCHIVE",
  "INVALID_LIMIT",
  "INVALID_REQUEST",
  "INVALID_SIDECAR",
  "LAUNCH_FAILED",
  "NOT_INSTALLED",
  "OPERATION_CANCELED",
  "ROLLBACK_FAILED",
  "SESSION_NOT_FOUND",
  "SIZE_MISMATCH",
  "UNSAFE_ARCHIVE",
  "UNSAFE_INSTALLATION",
  "UNSAFE_PATH",
  "UNTRUSTED_URL",
]);
const SERIES4_PROGRESS_PHASES = new Set(["starting", "copying", "verifying", "extracting", "installing", "complete"]);
const SERIES4_OPAQUE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function resolveSeries4LocalAppDataDir() {
  const configured = String(process.env.LOCALAPPDATA || "").trim();
  if (configured && path.isAbsolute(configured)) return path.resolve(configured);
  const appDataDir = path.resolve(app.getPath("appData"));
  return path.join(path.dirname(appDataDir), "Local");
}

function safeSeries4Error(error, fallback = "SERIES4_FAILED") {
  const candidate = String(error?.code || "").trim().toUpperCase();
  return {
    ok: false,
    errorCode: SERIES4_PUBLIC_ERROR_CODES.has(candidate) ? candidate : fallback,
  };
}

function publicSeries4Inspection(result) {
  const eventTypes = Array.isArray(result?.eventTypes)
    ? result.eventTypes.slice(0, 16).map((item) => ({
      type: String(item?.type || "Other").slice(0, 32),
      count: Math.max(0, Math.floor(Number(item?.count) || 0)),
    }))
    : [];
  const timeline = Array.isArray(result?.timeline)
    ? result.timeline.slice(0, 500).map((item) => ({
      type: String(item?.type || "Other").slice(0, 32),
      actionKind: String(item?.actionKind || item?.type || "Other").slice(0, 32),
      offsetMs: Math.max(0, Math.floor(Number(item?.offsetMs) || 0)),
      durationMs: Math.max(0, Math.floor(Number(item?.durationMs) || 0)),
    }))
    : [];
  return {
    ok: result?.ok === true,
    sessionId: String(result?.sessionId || ""),
    schemaVersion: Math.max(0, Math.floor(Number(result?.schemaVersion) || 0)),
    savedAt: String(result?.savedAt || ""),
    status: String(result?.status || "unknown").slice(0, 32),
    eventCount: Math.max(0, Math.floor(Number(result?.eventCount) || 0)),
    executableEventCount: Math.max(0, Math.floor(Number(result?.executableEventCount) || 0)),
    quarantinedEventCount: Math.max(0, Math.floor(Number(result?.quarantinedEventCount) || 0)),
    durationMs: Math.max(0, Math.floor(Number(result?.durationMs) || 0)),
    eventTypes,
    timeline,
    timelineTruncated: result?.timelineTruncated === true,
    videoAvailable: result?.videoAvailable === true,
  };
}

function broadcastSeries4Progress(event) {
  const phase = String(event?.phase || "").trim().toLowerCase();
  if (!SERIES4_PROGRESS_PHASES.has(phase)) return;
  const receivedBytes = Math.max(0, Math.floor(Number(event?.downloadedBytes) || 0));
  const totalBytes = Math.max(0, Math.floor(Number(event?.totalBytes) || 0));
  const percent = totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : 0;
  const target = chatWindows.get("routine-officer");
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return;
  target.webContents.send("series4:progress", {
    phase,
    percent,
    receivedBytes,
    totalBytes,
  });
}

function getSeries4Integration() {
  if (series4Integration) return series4Integration;
  series4Integration = createSeries4Integration({
    userDataDir: app.getPath("userData"),
    roots: {
      videosDir: app.getPath("videos"),
      localAppDataDir: resolveSeries4LocalAppDataDir(),
    },
    onProgress: broadcastSeries4Progress,
  });
  return series4Integration;
}

async function handleSeries4VideoRequest(request) {
  try {
    if (!request || !["GET", "HEAD"].includes(String(request.method || "GET").toUpperCase())) {
      return new globalThis.Response(null, { status: 405 });
    }
    const parsed = new URL(String(request.url || ""));
    const segments = parsed.pathname.split("/").filter(Boolean);
    const opaqueId = segments.length === 1 ? decodeURIComponent(segments[0]) : "";
    if (parsed.protocol !== "heyu-series4:" || parsed.hostname !== "video" || !SERIES4_OPAQUE_ID_PATTERN.test(opaqueId)) {
      return new globalThis.Response(null, { status: 404 });
    }
    const artifact = await getSeries4Integration().resolveArtifact(opaqueId, "video");
    return net.fetch(pathToFileURL(artifact.path).toString(), {
      method: String(request.method || "GET").toUpperCase(),
      headers: request.headers,
    });
  } catch (_error) {
    return new globalThis.Response(null, { status: 404 });
  }
}

async function resolveManagedSttPaths() {
  const manager = getManagedSttRuntime();
  const [selected, status, bundled] = await Promise.all([
    manager.resolveSelectedPaths(),
    manager.getStatus(),
    resolveBundledSttAssets(),
  ]);
  return mergeManagedAndBundledSttPaths(selected, status, bundled);
}

async function selectManagedSttModelForPreset(value) {
  const preference = String(value || "recommended").toLowerCase();
  const desiredId = ["lite", "fast", "small", "small-q5_1", "small-q5-1"].includes(preference)
    ? "whisper-small-q5-1"
    : "whisper-large-v3-turbo-q5-0";
  const manager = getManagedSttRuntime();
  const [status, bundled] = await Promise.all([
    manager.getStatus(),
    resolveBundledSttAssets({ force: true }),
  ]);
  const desired = status.installed.models.find((item) => item.id === desiredId && item.valid && item.compatible);
  if (!desired) {
    const selected = mergeManagedAndBundledSttPaths(await manager.resolveSelectedPaths(), status, bundled);
    const desiredBundled = desiredId === "whisper-large-v3-turbo-q5-0"
      ? bundled.turboModel
      : bundled.smallModel;
    if (desiredBundled?.ready) {
      return {
        ...selected,
        ok: Boolean(selected.executablePath),
        status: selected.executablePath ? "ready" : "runtime-missing",
        modelPath: desiredBundled.modelPath,
        modelKey: desiredBundled.modelKey,
        modelInstallationId: desiredBundled.installationId,
        modelSource: "bundled",
      };
    }
    return {
      ...selected,
      modelPath: "",
      modelKey: "",
      modelInstallationId: "",
    };
  }
  if (desired && status.model?.installationId !== desired.installationId) {
    await manager.selectModel(desired.id);
  }
  return resolveManagedSttPaths();
}

async function buildSttRuntimeStatus() {
  const manager = getManagedSttRuntime();
  const catalog = manager.getCatalog();
  const [managed, selectedPaths, bundled] = await Promise.all([
    manager.getStatus(),
    resolveManagedSttPaths(),
    resolveBundledSttAssets(),
  ]);
  const legacy = getSttRuntimeStatus({ managedRuntime: selectedPaths });
  const installedById = new Map([
    ...managed.installed.runtimes,
    ...managed.installed.models,
  ].map((item) => [item.id, item]));
  const catalogById = new Map([
    ...catalog.runtimes,
    ...catalog.models,
  ].map((item) => [item.id, item]));
  const assets = STT_ASSETS.map((asset) => {
    const installed = installedById.get(asset.catalogId) || null;
    const bundledAsset = bundled.assets?.[asset.catalogId] || null;
    const catalogEntry = catalogById.get(asset.catalogId) || null;
    const selected = asset.kind === "runtime"
      ? selectedPaths.runtimeInstallationId === installed?.installationId
        || selectedPaths.runtimeInstallationId === bundled.runtime?.installationId
      : asset.kind === "model"
        ? selectedPaths.modelInstallationId === installed?.installationId
          || selectedPaths.modelInstallationId === bundled.smallModel?.installationId
          || selectedPaths.modelInstallationId === bundled.turboModel?.installationId
        : Boolean(installed?.valid || bundledAsset?.ready);
    const included = Boolean(bundledAsset?.ready && bundledAsset?.verified);
    return {
      ...asset,
      installed: Boolean(installed?.valid || included),
      selected,
      ready: Boolean((installed?.valid && installed?.compatible) || included),
      compatible: catalogEntry?.compatible !== false,
      verified: Boolean(included || (installed?.valid && (asset.kind === "runtime" || verifiedSttAssetIds.has(asset.id)))),
      installedAt: installed?.installedAt || "",
      source: included ? "bundled" : installed?.valid ? "managed" : "",
      bundled: included,
    };
  });
  return {
    ...legacy,
    ok: Boolean(legacy.runtimeReady && legacy.selectedModel),
    status: legacy.runtimeReady && legacy.selectedModel ? "ready" : managed.status,
    managed: true,
    bundled: Boolean(bundled.runtime.ready || bundled.turboModel.ready || bundled.smallModel.ready || bundled.vad.ready),
    assets,
    runtime: selectedPaths.executablePath ? {
      id: managed.runtime?.id || bundled.runtime?.id || "",
      name: managed.runtime?.name || bundled.runtime?.name || "whisper.cpp",
      version: managed.runtime?.version || bundled.runtime?.version || "",
      installationId: selectedPaths.runtimeInstallationId,
      source: selectedPaths.runtimeSource,
    } : null,
    selectedModel: managed.model?.name
      || (selectedPaths.modelInstallationId === bundled.turboModel?.installationId ? bundled.turboModel?.name : "")
      || (selectedPaths.modelInstallationId === bundled.smallModel?.installationId ? bundled.smallModel?.name : "")
      || legacy.selectedModel
      || "",
    selectedModelId: managed.model?.id
      || (selectedPaths.modelInstallationId === bundled.turboModel?.installationId ? bundled.turboModel?.id : "")
      || (selectedPaths.modelInstallationId === bundled.smallModel?.installationId ? bundled.smallModel?.id : "")
      || "",
    performanceNotice: sttTurboPerformanceNotice(getLocalModelRuntimeConfig().model),
    vad: {
      installed: Boolean(selectedPaths.vadModelPath),
      enabledByDefault: Boolean(selectedPaths.vadModelPath),
      version: selectedPaths.vadModelPath ? "6.2.0" : "",
      source: selectedPaths.vadSource,
    },
  };
}

function sttInstallError(error) {
  const code = String(error?.code || "INSTALL_FAILED");
  const messages = {
    CATALOG_ENTRY_NOT_FOUND: "검토된 음성 구성요소가 아닙니다.",
    INCOMPATIBLE_COMPONENT: "이 구성요소는 현재 운영체제 또는 CPU와 호환되지 않습니다.",
    LOCAL_FILE_REQUIRED: "설치할 로컬 파일을 먼저 선택해 주세요.",
    LOCAL_FILE_NOT_FOUND: "선택한 로컬 파일을 찾을 수 없습니다. 다시 선택해 주세요.",
    LOCAL_FILE_CHANGED: "선택한 파일이 확인 중 변경되어 설치를 중단했습니다.",
    UNSAFE_LOCAL_FILE: "일반 로컬 파일만 설치할 수 있습니다.",
    NETWORK_INSTALL_DISABLED: "폐쇄망 배포본은 인터넷 설치를 사용하지 않습니다. 검토된 파일을 불러와 설치해 주세요.",
    DOWNLOAD_FAILED: "빌드용 음성 자산을 준비하지 못했습니다.",
    DOWNLOAD_TOO_LARGE: "선택한 파일 크기가 검토된 제한을 넘었습니다.",
    SIZE_MISMATCH: "선택한 파일 크기가 검토된 배포 정보와 다릅니다.",
    CHECKSUM_MISMATCH: "선택한 파일의 SHA-256이 검토된 값과 다릅니다. 파일은 설치하지 않았습니다.",
    INSTALL_CANCELED: "설치를 취소했습니다.",
    CANCEL_ROLLBACK_FAILED: "설치는 취소했지만 로컬 정리가 끝나지 않았습니다. 앱을 다시 연 뒤 해당 구성요소를 재검증해 주세요.",
    INSTALL_CONFLICT: "기존 설치와 충돌해 안전하게 교체하지 못했습니다.",
    INSTALL_INCOMPLETE: "설치 후 무결성 확인에 실패했습니다.",
    INSTALLATION_TAMPERED: "설치된 파일의 무결성이 검토된 값과 다릅니다. 같은 구성요소의 재설치 버튼으로 복구해 주세요.",
    REPAIR_ROLLBACK_FAILED: "복구 설치에 실패했고 기존 설치의 자동 원복도 끝나지 않았습니다. 앱을 다시 연 뒤 재검증해 주세요.",
    EXTRACTION_FAILED: "Windows 압축 해제 도구로 런타임을 설치하지 못했습니다.",
    UNSAFE_ARCHIVE: "안전하지 않은 압축 파일로 판정되어 설치를 중단했습니다.",
  };
  return {
    ok: false,
    errorCode: Object.hasOwn(messages, code) ? code : "INSTALL_FAILED",
    error: messages[code] || "음성 구성요소를 설치하지 못했습니다.",
  };
}

function sanitizeChatMessage(message) {
  if (!message || typeof message !== "object") return null;

  const safe = {
    from: message.from === "me" ? "me" : "them",
    time: String(message.time || ""),
  };

  if (typeof message.text === "string") safe.text = message.text.slice(0, 20000);
  if (message.uiOnly) safe.uiOnly = true;
  if (message.source) safe.source = String(message.source).slice(0, 80);
  if (Array.isArray(message.summary)) safe.summary = message.summary.map((item) => String(item).slice(0, 2000)).slice(0, 20);
  if (message.error) safe.error = true;
  if (message.attachment && typeof message.attachment === "object") {
    safe.attachment = {
      name: String(message.attachment.name || ""),
      size: String(message.attachment.size || ""),
      type: String(message.attachment.type || "file"),
    };
  }
  if (Array.isArray(message.attachments)) {
    safe.attachments = message.attachments
      .map((file) => ({
        name: String(file?.name || ""),
        size: String(file?.size || ""),
        type: String(file?.type || "file"),
      }))
      .filter((file) => file.name)
      .slice(0, 8);
  }
  if (Array.isArray(message.actions)) {
    safe.actions = message.actions
      .map((action) => ({
        id: String(action?.id || "").slice(0, 100),
        type: String(action?.type || "").slice(0, 80),
        label: String(action?.label || "").slice(0, 40),
        style: String(action?.style || "secondary").slice(0, 40),
        disabled: Boolean(action?.disabled),
        payload: action?.payload && typeof action.payload === "object"
          ? {
              sourcePrompt: String(action.payload.sourcePrompt || "").slice(0, 3000),
              llmText: String(action.payload.llmText || "").slice(0, 4000),
              confirmText: String(action.payload.confirmText || "").slice(0, 600),
            }
          : {},
      }))
      .filter((action) => action.type && action.label)
      .slice(0, 4);
  }
  if (message.chart && typeof message.chart === "object") {
    safe.chart = {
      id: String(message.chart.id || "").slice(0, 80),
      type: String(message.chart.type || "bar"),
      title: String(message.chart.title || "그래프").slice(0, 160),
      svg: String(message.chart.svg || "").slice(0, 250000),
      fileName: String(message.chart.fileName || "").slice(0, 180),
      sheetName: String(message.chart.sheetName || "").slice(0, 120),
      rowCount: Number(message.chart.rowCount || 0),
      shownRowCount: Number(message.chart.shownRowCount || 0),
    };
  }
  if (message.presentation && typeof message.presentation === "object") {
    safe.presentation = {
      id: String(message.presentation.id || "").slice(0, 80),
      title: String(message.presentation.title || "발표자료").slice(0, 160),
      fileName: String(message.presentation.fileName || "presentation.html").slice(0, 180),
      format: String(message.presentation.format || "html").slice(0, 12),
      mimeType: String(message.presentation.mimeType || "").slice(0, 120),
      base64: String(message.presentation.base64 || "").slice(0, 12 * 1024 * 1024),
      slideCount: Number(message.presentation.slideCount || 0),
      sourceNote: String(message.presentation.sourceNote || "").slice(0, 240),
      workspacePath: String(message.presentation.workspacePath || "").slice(0, 240),
    };
  }
  if (message.image && typeof message.image === "object") {
    safe.image = {
      id: String(message.image.id || "").slice(0, 80),
      kind: String(message.image.kind || "image-generation").slice(0, 40),
      title: String(message.image.title || "이미지 생성").slice(0, 160),
      status: String(message.image.status || "pending").slice(0, 80),
      statusLabel: String(message.image.statusLabel || "").slice(0, 80),
      provider: String(message.image.provider || "").slice(0, 80),
      modelName: String(message.image.modelName || "").slice(0, 180),
      sourcePrompt: String(message.image.sourcePrompt || "").slice(0, 3000),
      prompt: String(message.image.prompt || "").slice(0, 3000),
      negativePrompt: String(message.image.negativePrompt || "").slice(0, 1200),
      message: String(message.image.message || "").slice(0, 800),
      fileName: String(message.image.fileName || "").slice(0, 180),
      mimeType: String(message.image.mimeType || "image/png").slice(0, 80),
      base64: String(message.image.base64 || "").slice(0, 12 * 1024 * 1024),
      workspacePath: String(message.image.workspacePath || "").slice(0, 240),
      modelDir: String(message.image.modelDir || "").slice(0, 240),
      outputDir: String(message.image.outputDir || "").slice(0, 240),
      extraModelPathsConfig: String(message.image.extraModelPathsConfig || "").slice(0, 240),
      runtimeDir: String(message.image.runtimeDir || "").slice(0, 240),
      width: Number(message.image.width || 0),
      height: Number(message.image.height || 0),
      settings: message.image.settings && typeof message.image.settings === "object"
        ? {
            steps: Number(message.image.settings.steps || 0),
            cfg: Number(message.image.settings.cfg || 0),
            sampler: String(message.image.settings.sampler || "").slice(0, 80),
            scheduler: String(message.image.settings.scheduler || "").slice(0, 80),
          }
        : null,
      suggestions: Array.isArray(message.image.suggestions)
        ? message.image.suggestions.map((item) => String(item).slice(0, 240)).slice(0, 4)
        : [],
    };
  }

  return safe.text || safe.summary || safe.attachment || safe.attachments?.length || safe.actions?.length || safe.chart || safe.presentation || safe.image ? safe : null;
}

function previewChatMessage(message) {
  if (!message) return "";
  if (message.text) return String(message.text).replace(/\s+/g, " ").trim();
  if (message.chart?.title) return `그래프를 만들었습니다. (${message.chart.title})`;
  if (message.presentation?.title) return `발표자료를 만들었습니다. (${message.presentation.title})`;
  if (message.image?.title) return `이미지 생성 상태: ${message.image.statusLabel || message.image.title}`;
  if (Array.isArray(message.summary) && message.summary.length) return `핵심 요약: ${message.summary[0]}`;
  if (Array.isArray(message.attachments) && message.attachments.length) return `파일을 보냈습니다. (${message.attachments[0].name})`;
  if (message.attachment?.name) return `파일을 보냈습니다. (${message.attachment.name})`;
  return "";
}

function summarizeChatSession(contactId) {
  const session = chatSessions.get(String(contactId));
  if (!session) return null;

  const lastMessage = [...session.messages].reverse().find((message) => previewChatMessage(message));
  return {
    contactId: String(contactId),
    lastMessage: previewChatMessage(lastMessage),
    time: lastMessage?.time || session.time || "",
    unread: session.unread || 0,
    updatedAt: session.updatedAt || 0,
    hasMessages: session.messages.length > 0,
  };
}

function chatSummaries() {
  return Object.fromEntries(
    [...chatSessions.keys()]
      .map((contactId) => [contactId, summarizeChatSession(contactId)])
      .filter(([, summary]) => summary)
  );
}

function broadcastChatSummaries() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("chat:sessions-updated", chatSummaries());
}

function saveChatSession(contactId, messages) {
  const key = String(contactId || "chief");
  const safeMessages = (Array.isArray(messages) ? messages : []).slice(-200).map(sanitizeChatMessage).filter(Boolean);
  const previous = chatSessions.get(key) || {};

  chatSessions.set(key, {
    messages: safeMessages,
    unread: previous.unread || 0,
    time: safeMessages.at(-1)?.time || previous.time || "",
    updatedAt: Date.now(),
  });

  broadcastChatSummaries();
  return summarizeChatSession(key);
}

function sanitizeContactConfig(value) {
  const files = Array.isArray(value?.files)
    ? value.files
        .map((file) => ({
          name: String(file?.name || "").trim(),
          size: String(file?.size || "").trim(),
          type: String(file?.type || "file").trim(),
        }))
        .filter((file) => file.name)
    : [];

  return {
    resourcesText: String(value?.resourcesText || "").slice(0, 200000),
    commandsText: String(value?.commandsText || "").slice(0, 100000),
    files,
    updatedAt: Date.now(),
  };
}

function getContactConfig(contactId) {
  return (
    contactConfigs.get(String(contactId || "chief")) || {
      resourcesText: "",
      commandsText: "",
      files: [],
      updatedAt: 0,
    }
  );
}

function saveContactConfig(contactId, nextConfig) {
  const key = String(contactId || "chief");
  const previous = getContactConfig(key);
  const merged = sanitizeContactConfig({
    ...previous,
    ...nextConfig,
  });
  contactConfigs.set(key, merged);
  return merged;
}

function enrichOfficerPayload(payload = {}) {
  const contact = payload?.contact;
  const resolvedPayload = {
    ...payload,
    files: resolveGrantedFiles(payload.files),
    limits: appSettings.limits,
  };
  if (!contact?.id) return resolvedPayload;

  const config = getContactConfig(contact.id);
  if (!config.resourcesText && !config.commandsText && !config.files.length) return resolvedPayload;

  return {
    ...resolvedPayload,
    contact: {
      ...contact,
      userResources: config.resourcesText,
      userCommands: config.commandsText,
      userFiles: config.files,
    },
  };
}

function inferFileType(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase().replace(".", "");
  if (["xls", "xlsx", "csv"].includes(ext)) return "excel";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "hwp", "hwpx"].includes(ext)) return "word";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp", "avif", "tif", "tiff"].includes(ext)) return "image";
  return "file";
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${Math.round((size / 1024 / 1024) * 10) / 10}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function selectedFileInfo(filePath) {
  const stat = fs.statSync(filePath);
  const resolved = path.resolve(filePath);
  return {
    name: path.basename(resolved),
    path: resolved,
    size: formatFileSize(stat.size),
    sizeBytes: stat.size,
    type: inferFileType(filePath),
    fileToken: issueFileGrant(resolved),
  };
}

function issueFileGrant(filePath) {
  pruneExpiredFileGrants();
  const token = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString("hex");
  selectedFileGrants.set(token, {
    path: path.resolve(filePath),
    expiresAt: Date.now() + FILE_GRANT_TTL_MS,
  });
  return token;
}

function pruneExpiredFileGrants() {
  const now = Date.now();
  for (const [token, grant] of selectedFileGrants.entries()) {
    if (!grant?.expiresAt || grant.expiresAt < now) selectedFileGrants.delete(token);
  }
  for (const [token, owner] of sttAssetFileGrantOwners.entries()) {
    if (!selectedFileGrants.has(token) || !owner?.expiresAt || owner.expiresAt < now) {
      sttAssetFileGrantOwners.delete(token);
    }
  }
}

function resolveGrantedFiles(files = []) {
  pruneExpiredFileGrants();
  return (Array.isArray(files) ? files : [])
    .map((file) => resolveGrantedFile(file))
    .filter(Boolean)
    .slice(0, 50);
}

function resolveGrantedFile(file) {
  const token = String(file?.fileToken || "").trim();
  const grant = token ? selectedFileGrants.get(token) : null;
  if (!grant) return null;
  const resolvedGrantPath = path.resolve(grant.path);
  const requestedPath = String(file?.path || "").trim();
  if (requestedPath && path.resolve(requestedPath) !== resolvedGrantPath) return null;
  let stat;
  try {
    stat = fs.statSync(resolvedGrantPath);
  } catch (_error) {
    return null;
  }
  if (!stat.isFile()) return null;
  return {
    name: String(file?.name || path.basename(resolvedGrantPath)).trim() || path.basename(resolvedGrantPath),
    path: resolvedGrantPath,
    size: formatFileSize(stat.size),
    sizeBytes: stat.size,
    type: String(file?.type || inferFileType(resolvedGrantPath)).trim(),
    fileToken: token,
  };
}

function issueSttAssetFileGrant(senderId, asset, filePath) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("STT artifact is not a regular file");
  const token = issueFileGrant(filePath);
  sttAssetFileGrantOwners.set(token, {
    senderId,
    assetId: asset.id,
    expiresAt: Date.now() + FILE_GRANT_TTL_MS,
  });
  return {
    fileToken: token,
    name: path.basename(filePath),
    size: formatFileSize(stat.size),
    sizeBytes: stat.size,
  };
}

function consumeSttAssetFileGrant(senderId, assetId, fileToken) {
  pruneExpiredFileGrants();
  const token = String(fileToken || "").trim();
  const owner = sttAssetFileGrantOwners.get(token);
  if (!token || !owner || owner.senderId !== senderId || owner.assetId !== assetId) return null;
  const granted = resolveGrantedFile({ fileToken: token });
  sttAssetFileGrantOwners.delete(token);
  selectedFileGrants.delete(token);
  return granted;
}

function documentResourceId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(24).toString("hex");
}

function pruneDocumentResourceSessions() {
  const now = Date.now();
  for (const [sessionId, resourceSession] of documentResourceSessions.entries()) {
    if (!resourceSession?.expiresAt || resourceSession.expiresAt < now) {
      const active = activeDocumentResourceJobs.get(resourceSession?.senderId);
      if (active?.sessionId === sessionId) active.controller.abort();
      documentResourceSessions.delete(sessionId);
    }
  }
  for (const [fileToken, grantOwner] of resourceFileGrantOwners.entries()) {
    if (!selectedFileGrants.has(fileToken) || !grantOwner?.expiresAt || grantOwner.expiresAt < now) {
      resourceFileGrantOwners.delete(fileToken);
    }
  }
}

function documentResourceSession(event, sessionId) {
  pruneDocumentResourceSessions();
  const key = String(sessionId || "").trim();
  const resourceSession = documentResourceSessions.get(key);
  if (!resourceSession || resourceSession.senderId !== event.sender.id) return null;
  resourceSession.expiresAt = Date.now() + DOCUMENT_RESOURCE_SESSION_TTL_MS;
  return resourceSession;
}

function cleanupDocumentResourceSender(senderId) {
  const active = activeDocumentResourceJobs.get(senderId);
  active?.controller.abort();
  activeDocumentResourceJobs.delete(senderId);
  documentResourceOutputDirs.delete(senderId);
  documentResourceSenderLifecycle.delete(senderId);
  for (const [sessionId, resourceSession] of documentResourceSessions.entries()) {
    if (resourceSession.senderId === senderId) documentResourceSessions.delete(sessionId);
  }
  for (const [fileToken, owner] of resourceFileGrantOwners.entries()) {
    if (owner.senderId === senderId) {
      resourceFileGrantOwners.delete(fileToken);
      selectedFileGrants.delete(fileToken);
    }
  }
}

function ensureDocumentResourceSenderLifecycle(sender) {
  if (documentResourceSenderLifecycle.has(sender.id)) return;
  documentResourceSenderLifecycle.add(sender.id);
  sender.once("destroyed", () => cleanupDocumentResourceSender(sender.id));
}

function documentResourceBusy() {
  return publicDocumentResourceError({ code: "BUSY" });
}

async function runDocumentResourceJob(event, resourceSession, operation) {
  const sender = event.sender;
  if (activeDocumentResourceJobs.has(sender.id)) throw Object.assign(new Error("BUSY"), { code: "BUSY" });
  const controller = new AbortController();
  const active = {
    controller,
    sessionId: resourceSession?.sessionId || "",
  };
  activeDocumentResourceJobs.set(sender.id, active);
  ensureDocumentResourceSenderLifecycle(sender);
  const onProgress = (value) => {
    if (sender.isDestroyed()) return;
    sender.send("document-resource:progress", {
      sessionId: active.sessionId,
      ...value,
    });
  };
  try {
    return await operation({ signal: controller.signal, onProgress, jobId: documentResourceId() });
  } finally {
    if (activeDocumentResourceJobs.get(sender.id) === active) activeDocumentResourceJobs.delete(sender.id);
  }
}

function documentResourceResultMetadata(resourceSession) {
  const result = resourceSession.analysis;
  return {
    ok: true,
    sessionId: resourceSession.sessionId,
    fileName: resourceSession.fileName,
    document: {
      name: resourceSession.fileName,
      sizeBytes: result.sourceSizeBytes,
      extension: result.extension,
      formatGroup: result.formatGroup,
      formatLabel: result.formatLabel,
    },
    summary: {
      entryCount: result.entryCount,
      resourceCount: result.resourceCount,
      expandedBytes: result.expandedBytes,
      categoryCounts: result.categoryCounts,
    },
    resources: result.resources,
  };
}

function rememberDocumentResourceOutput(senderId, outputPath) {
  try {
    const directory = fs.realpathSync.native(path.dirname(outputPath));
    if (fs.statSync(directory).isDirectory()) documentResourceOutputDirs.set(senderId, directory);
  } catch (_error) {
    // The saved file remains valid even if its parent cannot later be opened.
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return Boolean(relative || path.resolve(parent) === path.resolve(candidate)) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function isExistingWorkspacePathInside(parent, candidate) {
  try {
    if (!fs.existsSync(parent) || !fs.existsSync(candidate)) return false;
    const workspaceReal = fs.realpathSync.native(WORKSPACE_DIR);
    const parentReal = fs.realpathSync.native(parent);
    const candidateReal = fs.realpathSync.native(candidate);
    return isPathInside(workspaceReal, parentReal) && isPathInside(parentReal, candidateReal);
  } catch (_error) {
    return false;
  }
}

function sanitizeSaveFileName(value) {
  return String(value || "graph")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function existingIconPath(candidates) {
  return candidates.find((candidate) => {
    try {
      return fs.existsSync(candidate);
    } catch (_error) {
      return false;
    }
  });
}

function appWindowIconPath() {
  return existingIconPath(
    process.platform === "win32"
      ? [APP_ICON_ICO_PATH, APP_ICON_PNG_PATH]
      : [APP_ICON_PNG_PATH, APP_ICON_ICO_PATH],
  );
}

function appRasterIconPath() {
  return existingIconPath([APP_ICON_PNG_PATH, APP_ICON_ICO_PATH]);
}

function quoteWindowsCommandPath(value) {
  const text = String(value || "");
  if (!text || text.includes('"')) return "";
  return `"${text}"`;
}

function windowsTaskbarRelaunchCommand() {
  if (process.platform !== "win32") return "";
  const executable = quoteWindowsCommandPath(process.execPath);
  if (!executable) return "";
  if (app.isPackaged) return executable;
  const appRoot = quoteWindowsCommandPath(ROOT_DIR);
  return appRoot ? `${executable} ${appRoot}` : executable;
}

function applyWindowsTaskbarIdentity(browserWindow) {
  if (process.platform !== "win32" || !browserWindow || browserWindow.isDestroyed()) return;
  const iconPath = appWindowIconPath();
  if (!iconPath) return;

  try {
    browserWindow.setIcon(iconPath);
  } catch (_error) {
    // The constructor icon remains the fallback.
  }

  if (typeof browserWindow.setAppDetails !== "function") return;
  const relaunchCommand = windowsTaskbarRelaunchCommand();
  const details = {
    appId: APP_USER_MODEL_ID,
    appIconPath: iconPath,
    appIconIndex: 0,
  };
  if (relaunchCommand) {
    details.relaunchCommand = relaunchCommand;
    details.relaunchDisplayName = APP_DISPLAY_NAME;
  }
  try {
    browserWindow.setAppDetails(details);
  } catch (_error) {
    // Older Windows/Electron builds still retain the explicit window icon.
  }
}

function windowOptions(extra = {}) {
  return {
    frame: false,
    show: false,
    backgroundColor: "#ffffff",
    icon: appWindowIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
    ...extra,
  };
}

function hardenWindow(browserWindow) {
  browserWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  browserWindow.webContents.on("will-navigate", (event, url) => {
    if (!isAllowedRendererFileUrl(url)) event.preventDefault();
  });
}

function isAllowedRendererFileUrl(url) {
  try {
    const parsedPath = path.resolve(fileURLToPath(String(url || "")));
    const rendererRoot = path.resolve(path.join(__dirname, "..", "renderer"));
    const relative = path.relative(rendererRoot, parsedPath);
    return Boolean(relative || parsedPath === rendererRoot) && !relative.startsWith("..") && !path.isAbsolute(relative);
  } catch (_error) {
    return false;
  }
}

function trayIconImage() {
  const candidates = [
    appRasterIconPath(),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue;
      const image = nativeImage.createFromPath(candidate);
      if (!image.isEmpty()) return image.resize({ width: 16, height: 16 });
    } catch (_error) {
      // Try the next candidate.
    }
  }
  return nativeImage.createEmpty();
}

function ensureTray() {
  if (tray && !tray.isDestroyed?.()) return tray;
  tray = new Tray(trayIconImage());
  tray.setToolTip("AI지원담당 메신저");
  tray.on("click", () => {
    showMainWindowFromTray();
  });
  tray.on("double-click", () => {
    showMainWindowFromTray();
  });
  updateTrayMenu();
  return tray;
}

function updateTrayMenu() {
  if (!tray || tray.isDestroyed?.()) return;
  const menu = Menu.buildFromTemplate([
    {
      label: "메신저 열기",
      click: () => showMainWindowFromTray(),
    },
    {
      label: appSettings.replyDoneNotifications ? "답변 완료 알림: 켬" : "답변 완료 알림: 끔",
      type: "checkbox",
      checked: appSettings.replyDoneNotifications,
      click: (item) => saveAppSettings({ replyDoneNotifications: item.checked }),
    },
    { type: "separator" },
    {
      label: "종료",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

function showMainWindowFromTray() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
    return;
  }
  if (!mainWindow.isVisible()) mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function hideMainWindowToTray(event) {
  if (isQuitting) return false;
  ensureTray();
  event?.preventDefault?.();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  return true;
}

function childWindowPlacement(width, height, offsetIndex = 0) {
  if (!mainWindow || mainWindow.isDestroyed()) return {};

  const mainBounds = mainWindow.getBounds();
  const display = screen.getDisplayMatching(mainBounds);
  const area = display.workArea;
  const gap = 14;
  const cascade = offsetIndex * 24;
  let x = mainBounds.x + mainBounds.width + gap + cascade;
  let y = mainBounds.y + 34 + cascade;

  if (x + width > area.x + area.width) {
    x = Math.max(area.x, mainBounds.x - width - gap - cascade);
  }

  if (y + height > area.y + area.height) {
    y = Math.max(area.y, area.y + area.height - height - gap);
  }

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow(
    windowOptions({
      width: 520,
      height: 760,
      minWidth: 520,
      minHeight: 760,
      maxWidth: 520,
      maxHeight: 760,
      resizable: false,
      maximizable: false,
    })
  );
  applyWindowsTaskbarIdentity(mainWindow);

  hardenWindow(mainWindow);
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.on("focus", () => {
    closeProfileWindows();
  });
  mainWindow.on("close", (event) => {
    hideMainWindowToTray(event);
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function closeProfileWindows() {
  for (const profileWindow of profileWindows.values()) {
    if (!profileWindow.isDestroyed()) profileWindow.close();
  }
  profileWindows.clear();
}

function activeContactId(contactId) {
  const candidate = String(contactId || "chief");
  return ACTIVE_CONTACT_IDS.has(candidate) ? candidate : "chief";
}

function createChatWindow(contactId) {
  const key = activeContactId(contactId);
  const existing = chatWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (!existing.isVisible()) existing.show();
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return;
  }

  const hasSideTool =
    key === "routine-officer" ||
    key === "privacy-officer" ||
    key === "image-officer" ||
    key === "steno-officer" ||
    key === "resource-officer" ||
    key === "file-converter";
  const width = hasSideTool ? 900 : 520;
  const height = 760;
  const chatWindow = new BrowserWindow(
    windowOptions({
      width,
      height,
      ...childWindowPlacement(width, height, chatWindows.size),
      minWidth: hasSideTool ? 820 : 420,
      minHeight: 620,
      maxWidth: hasSideTool ? 1040 : 620,
      maxHeight: 860,
    })
  );
  applyWindowsTaskbarIdentity(chatWindow);

  hardenWindow(chatWindow);
  chatWindow.heyuContactId = key;
  chatWindows.set(key, chatWindow);
  chatWindow.loadFile(path.join(__dirname, "..", "renderer", "chat.html"), {
    query: { id: key },
  });
  chatWindow.once("ready-to-show", () => chatWindow.show());
  chatWindow.on("close", (event) => {
    if (!pendingChatReplies.has(key)) return;
    event.preventDefault();
    chatWindow.hide();
  });
  chatWindow.on("closed", () => {
    chatWindows.delete(key);
  });
}

function createPdfEditorWindow(file) {
  const safeFile = file && file.path ? file : null;
  if (!safeFile) return { ok: false, error: "PDF 파일을 찾지 못했습니다." };
  const key = String(safeFile.fileToken || safeFile.path || safeFile.name || Date.now());
  const existing = pdfEditorWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    if (!existing.isVisible()) existing.show();
    if (existing.isMinimized()) existing.restore();
    existing.focus();
    return { ok: true };
  }

  const width = 980;
  const height = 720;
  const editorWindow = new BrowserWindow(
    windowOptions({
      width,
      height,
      ...childWindowPlacement(width, height, pdfEditorWindows.size),
      minWidth: 860,
      minHeight: 620,
      maxWidth: 1400,
      maxHeight: 980,
    })
  );
  applyWindowsTaskbarIdentity(editorWindow);

  hardenWindow(editorWindow);
  editorWindow.heyuPdfEditorFile = safeFile;
  pdfEditorWindows.set(key, editorWindow);
  editorWindow.loadFile(path.join(__dirname, "..", "renderer", "pdf-editor.html"));
  editorWindow.once("ready-to-show", () => editorWindow.show());
  editorWindow.on("closed", () => {
    pdfEditorWindows.delete(key);
  });
  return { ok: true };
}

function shouldNotifyForChat(contactId, sourceWindow) {
  const target = chatWindows.get(String(contactId || "")) || sourceWindow;
  if (!target || target.isDestroyed()) return true;
  return !target.isVisible() || target.isMinimized() || !target.isFocused();
}

function showReplyDoneNotification(payload = {}, sourceWindow) {
  if (!appSettings.replyDoneNotifications) return { ok: false, skipped: "disabled" };
  if (!Notification.isSupported()) return { ok: false, skipped: "unsupported" };

  const contactId = String(payload.contactId || sourceWindow?.heyuContactId || "chief");
  if (!shouldNotifyForChat(contactId, sourceWindow)) return { ok: false, skipped: "focused" };

  const contactName = String(payload.contactName || "AI지원담당").slice(0, 60);
  const body = String(payload.body || "답변이 도착했습니다.").replace(/\s+/g, " ").trim().slice(0, 180) || "답변이 도착했습니다.";
  const notification = new Notification({
    title: `${contactName} 답변 완료`,
    body,
    icon: appRasterIconPath(),
  });
  notification.on("click", () => {
    showMainWindowFromTray();
    createChatWindow(contactId);
  });
  notification.show();
  return { ok: true };
}

function createConfigWindow(contactId, mode) {
  const safeContactId = activeContactId(contactId);
  const key = `${safeContactId}:${mode === "commands" ? "commands" : "resources"}`;
  const existing = configWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const configWindow = new BrowserWindow(
    windowOptions({
      width: 500,
      height: 720,
      ...childWindowPlacement(500, 720, configWindows.size),
      minWidth: 460,
      minHeight: 640,
      maxWidth: 620,
      maxHeight: 860,
    })
  );
  applyWindowsTaskbarIdentity(configWindow);

  hardenWindow(configWindow);
  configWindows.set(key, configWindow);
  configWindow.loadFile(path.join(__dirname, "..", "renderer", "config.html"), {
    query: { id: safeContactId, mode: mode === "commands" ? "commands" : "resources" },
  });
  configWindow.once("ready-to-show", () => configWindow.show());
  configWindow.on("closed", () => {
    configWindows.delete(key);
  });
}

function createProfileWindow(contactId) {
  const key = activeContactId(contactId);
  const existing = profileWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const profileWindow = new BrowserWindow(
    windowOptions({
      width: 360,
      height: 560,
      ...childWindowPlacement(360, 560, profileWindows.size),
      minWidth: 320,
      minHeight: 500,
      maxWidth: 420,
      maxHeight: 680,
      resizable: true,
      maximizable: false,
    })
  );
  applyWindowsTaskbarIdentity(profileWindow);

  hardenWindow(profileWindow);
  profileWindows.set(key, profileWindow);
  profileWindow.loadFile(path.join(__dirname, "..", "renderer", "profile.html"), {
    query: { id: key },
  });
  profileWindow.once("ready-to-show", () => profileWindow.show());
  profileWindow.on("closed", () => {
    profileWindows.delete(key);
  });
}

function currentWindow(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

function nativeWindowHandleId(browserWindow) {
  try {
    const handle = browserWindow?.getNativeWindowHandle?.();
    if (!Buffer.isBuffer(handle)) return "";
    if (handle.length >= 8) return handle.readBigUInt64LE(0).toString();
    if (handle.length >= 4) return String(handle.readUInt32LE(0));
  } catch (_error) {
    return "";
  }
  return "";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pdfEditorFile(event) {
  const target = currentWindow(event);
  return target && !target.isDestroyed() ? target.heyuPdfEditorFile : null;
}

function isContactWindow(event, contactId) {
  return currentWindow(event)?.heyuContactId === contactId;
}

function contactWindowError(contactName) {
  return { ok: false, error: `${contactName} 창에서만 사용할 수 있는 기능입니다.` };
}

function toggleCustomMaximize(target) {
  if (!target || target.isDestroyed()) return;

  if (target.heyuCustomMaximized) {
    const previous = target.heyuRestoreState || {};
    target.heyuCustomMaximized = false;
    target.heyuRestoreState = null;
    if (Array.isArray(previous.maximumSize)) target.setMaximumSize(previous.maximumSize[0], previous.maximumSize[1]);
    if (Array.isArray(previous.minimumSize)) target.setMinimumSize(previous.minimumSize[0], previous.minimumSize[1]);
    if (previous.bounds) target.setBounds(previous.bounds, true);
    if (previous.resizable !== undefined) target.setResizable(Boolean(previous.resizable));
    return;
  }

  const bounds = target.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const area = display.workArea;
  target.heyuRestoreState = {
    bounds,
    minimumSize: target.getMinimumSize(),
    maximumSize: target.getMaximumSize(),
    resizable: target.isResizable(),
  };
  target.heyuCustomMaximized = true;
  target.setResizable(true);
  target.setMaximumSize(area.width, area.height);
  target.setMinimumSize(Math.min(320, area.width), Math.min(240, area.height));
  target.setBounds({
    x: area.x,
    y: area.y,
    width: area.width,
    height: area.height,
  }, true);
}

function routineRecorderScriptPath() {
  const unpackedPath = path.join(process.resourcesPath || "", "app.asar.unpacked", "tools", "routine-recorder", "recorder.py");
  const developmentPath = path.join(ROOT_DIR, "tools", "routine-recorder", "recorder.py");
  return fs.existsSync(unpackedPath) ? unpackedPath : developmentPath;
}

function routineRunnerScriptPath() {
  const unpackedPath = path.join(process.resourcesPath || "", "app.asar.unpacked", "tools", "routine-recorder", "runner.py");
  const developmentPath = path.join(ROOT_DIR, "tools", "routine-recorder", "runner.py");
  return fs.existsSync(unpackedPath) ? unpackedPath : developmentPath;
}

function routinePythonCommand() {
  return process.env.HEYU_ROUTINE_PYTHON || process.env.HEYU_PYTHON_COMMAND || (process.platform === "win32" ? "python" : "python3");
}

function sanitizeRoutineStep(step) {
  if (!step || typeof step !== "object") return null;
  const safe = {
    id: String(step.id || "").slice(0, 100),
    action: String(step.action || "click").slice(0, 60),
    value: String(step.value || "").slice(0, 2000),
    windowTitle: String(step.windowTitle || "").slice(0, 240),
    button: String(step.button || "").slice(0, 40),
  };
  ["x", "y", "x2", "y2", "repeat", "waitSeconds", "durationSeconds", "delayBefore"].forEach((key) => {
    const value = Number(step[key]);
    if (Number.isFinite(value)) safe[key] = value;
  });
  return safe;
}

function sanitizeRoutineSteps(steps) {
  return (Array.isArray(steps) ? steps : []).map(sanitizeRoutineStep).filter(Boolean).slice(0, 200);
}

function validateRoutineStepsForExecution(steps) {
  const violations = [];
  steps.forEach((step, index) => {
    const reason = routineStepSafetyViolation(step);
    if (reason) violations.push(`${index + 1}번 ${actionLabelForSafety(step.action)}: ${reason}`);
  });
  return violations;
}

function routineStepSafetyViolation(step) {
  const action = String(step?.action || "");
  const value = String(step?.value || "").trim();
  if (action === "runCommand") return "명령 실행은 보안상 항상 차단했습니다.";
  if (action === "openApp") {
    return appSettings.routineSafety.allowProgramLaunch ? "" : "프로그램 실행 허용이 꺼져 있습니다.";
  }
  if (action === "openFile") {
    if (looksLikeProgramLaunch(value)) {
      return appSettings.routineSafety.allowProgramLaunch ? "" : "실행 파일 또는 스크립트로 보이는 파일은 프로그램 실행 허용이 필요합니다.";
    }
    return appSettings.routineSafety.allowFileOpen ? "" : "파일 열기 허용이 꺼져 있습니다.";
  }
  return "";
}

function looksLikeProgramLaunch(value) {
  if (!value) return false;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return true;
  return ROUTINE_EXECUTABLE_EXTENSIONS.has(path.extname(value).toLowerCase());
}

function actionLabelForSafety(action) {
  return {
    openApp: "프로그램 열기",
    openFile: "파일 열기",
    runCommand: "명령 실행",
  }[action] || String(action || "동작");
}

function sanitizeRoutineOptions(options) {
  const source = options && typeof options === "object" ? options : {};
  const repeatCount = Math.min(999, Math.max(1, Math.round(Number(source.repeatCount || 1)) || 1));
  return {
    activeTab: source.activeTab === "auto" ? "auto" : "direct",
    output: String(source.output || "자동화 설정표").slice(0, 120),
    risk: String(source.risk || "읽기/조회만").slice(0, 120),
    repeat: String(source.repeat || "").slice(0, 500),
    stop: String(source.stop || "").slice(0, 500),
    windowTitle: String(source.windowTitle || "").slice(0, 240),
    autoMode: String(source.autoMode || "record").slice(0, 80),
    autoTask: String(source.autoTask || "").slice(0, 500),
    autoRepeat: String(source.autoRepeat || "").slice(0, 500),
    autoCaution: String(source.autoCaution || "").slice(0, 1000),
    repeatCount,
    repeatForever: source.repeatForever === true,
  };
}

function routineFilePayload(payload) {
  const options = sanitizeRoutineOptions(payload?.options);
  const steps = sanitizeRoutineSteps(payload?.steps || payload?.options?.steps);
  return {
    type: "heyu-routine",
    version: 1,
    name: String(payload?.name || options.autoTask || options.repeat || "김루틴 루틴").slice(0, 120),
    savedAt: new Date().toISOString(),
    options,
    steps,
  };
}

function routineTempDir() {
  const tempDir = path.join(WORKSPACE_DIR, "temp");
  fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function routineFilesDir() {
  const routinesDir = path.join(WORKSPACE_DIR, "routines");
  fs.mkdirSync(routinesDir, { recursive: true });
  return routinesDir;
}

function stopRoutineRecorder(webContentsId) {
  const recorder = routineRecorders.get(webContentsId);
  if (!recorder) return false;
  try {
    if (recorder.process?.stdin?.writable) {
      recorder.process.stdin.write("stop\n");
    }
  } catch (_error) {
    // Best effort; the exit handler will clean up if the process is already gone.
  }
  if (!recorder.stopTimer) {
    recorder.stopTimer = setTimeout(() => {
      try {
        recorder.process?.kill?.();
      } catch (_error) {
        // Process already exited.
      }
    }, 3000);
  }
  return true;
}

function cleanupRoutineRecorder(webContentsId) {
  const recorder = routineRecorders.get(webContentsId);
  if (!recorder) return;
  if (recorder.timer) clearTimeout(recorder.timer);
  if (recorder.stopTimer) clearTimeout(recorder.stopTimer);
  if (recorder.webContents && recorder.onDestroyed && !recorder.webContents.isDestroyed()) {
    recorder.webContents.removeListener("destroyed", recorder.onDestroyed);
  }
  routineRecorders.delete(webContentsId);
}

function sendRoutineRecordingEvent(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send("routine:recording-event", payload);
}

function stopRoutineExecution(webContentsId) {
  const execution = routineExecutions.get(webContentsId);
  if (!execution) return false;
  try {
    if (execution.process?.stdin?.writable) {
      execution.process.stdin.write("stop\n");
    }
  } catch (_error) {
    // Best effort; the exit handler will clean up if the process is already gone.
  }
  if (!execution.stopTimer) {
    execution.stopTimer = setTimeout(() => {
      try {
        execution.process?.kill?.();
      } catch (_error) {
        // Process already exited.
      }
    }, 3000);
  }
  return true;
}

function cleanupRoutineExecution(webContentsId) {
  const execution = routineExecutions.get(webContentsId);
  if (!execution) return;
  if (execution.timer) clearTimeout(execution.timer);
  if (execution.stopTimer) clearTimeout(execution.stopTimer);
  if (execution.webContents && execution.onDestroyed && !execution.webContents.isDestroyed()) {
    execution.webContents.removeListener("destroyed", execution.onDestroyed);
  }
  if (execution.stepsFile) {
    try {
      fs.unlinkSync(execution.stepsFile);
    } catch (_error) {
      // Temp file may already be gone.
    }
  }
  routineExecutions.delete(webContentsId);
}

function writeRoutineCommand(entry, command) {
  if (!entry?.process?.stdin?.writable || !/^[a-z-]+(?: [a-z0-9-]+)?$/i.test(command)) return false;
  try {
    entry.process.stdin.write(`${command}\n`);
    return true;
  } catch (_error) {
    return false;
  }
}

function sendRoutineExecutionEvent(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send("routine:execution-event", payload);
}

function armRoutineExecutionWatchdog(execution) {
  if (!execution) return;
  if (execution.timer) clearTimeout(execution.timer);
  execution.timer = setTimeout(() => {
    sendRoutineExecutionEvent(execution.webContents, {
      type: "error",
      message: "실행기가 30분 동안 응답하지 않아 중지했습니다.",
    });
    try {
      execution.process?.kill?.();
    } catch (_error) {
      // Process already gone.
    }
  }, 30 * 60 * 1000);
}

function sendFrustrationWebInputEvent(webContents, payload) {
  if (!webContents || webContents.isDestroyed()) return;
  webContents.send("frustration:web-input-event", payload);
}

function stopFrustrationWebInput(webContentsId) {
  const execution = frustrationWebInputs.get(webContentsId);
  if (!execution) return false;
  execution.token.canceled = true;
  return true;
}

function sanitizeWebInputPort(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 9222;
  return Math.min(65535, Math.max(1, Math.round(number)));
}

function sanitizeWebInputUrl(value) {
  const text = String(value || "").trim();
  if (!text) return "about:blank";
  if (/^https?:\/\//i.test(text) || text === "about:blank") return text;
  return `http://${text}`;
}

function browserAutomationProfileDir() {
  return path.join(app.getPath("userData"), "frustration-browser");
}

function candidateAutomationBrowsers() {
  const localAppData = process.env.LOCALAPPDATA || process.env.LocalAppData || "";
  const programFiles = process.env.PROGRAMFILES || process.env.ProgramFiles || "";
  const programFilesX86 = process.env["PROGRAMFILES(X86)"] || process.env["ProgramFiles(x86)"] || "";
  if (process.platform !== "win32") {
    const linuxCandidates = [
      process.env.HEYU_BROWSER_PATH,
      "/usr/bin/google-chrome",
      "/usr/bin/google-chrome-stable",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
      "/usr/bin/microsoft-edge",
      "/usr/bin/microsoft-edge-stable",
      "/snap/bin/chromium",
      "/usr/bin/brave-browser",
    ].filter(Boolean);
    return linuxCandidates.find((candidate) => fs.existsSync(candidate)) || "";
  }
  const candidates = [
    process.env.HEYU_BROWSER_PATH,
    path.join(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
    path.join(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function openAutomationBrowser(payload = {}) {
  const browserPath = candidateAutomationBrowsers();
  if (!browserPath) {
    return { ok: false, error: "Edge 또는 Chrome 실행 파일을 찾지 못했습니다." };
  }
  const port = sanitizeWebInputPort(payload.port);
  const targetUrl = sanitizeWebInputUrl(payload.url);
  const userDataDir = browserAutomationProfileDir();
  fs.mkdirSync(userDataDir, { recursive: true });
  const child = spawn(
    browserPath,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--new-window",
      targetUrl,
    ],
    {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    },
  );
  child.once("error", () => {});
  child.unref();
  return {
    ok: true,
    browserPath,
    port,
    url: targetUrl,
  };
}

app.whenReady().then(() => {
  if (process.platform === "win32") {
    app.setAppUserModelId(APP_USER_MODEL_ID);
  }
  loadAppSettings();
  ensureWorkspace();
  ensureTray();
  protocol.handle("heyu-series4", handleSeries4VideoRequest);
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const mediaTypes = Array.isArray(details?.mediaTypes) ? details.mediaTypes : [];
    callback(permission === "media" && (!mediaTypes.length || mediaTypes.every((type) => type === "audio")));
  });

  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    } else {
      showMainWindowFromTray();
    }
  });
});

app.on("window-all-closed", () => {
  if (tray && !isQuitting) return;
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  isQuitting = true;
  localModelManager?.cancelPull();
  series4Integration?.cancelInstall();
  for (const transcription of activeSttTranscriptions.values()) {
    transcription.controller.abort();
  }
  for (const resourceJob of activeDocumentResourceJobs.values()) {
    resourceJob.controller.abort();
  }
  activeDocumentResourceJobs.clear();
  documentResourceSessions.clear();
  resourceFileGrantOwners.clear();
  sttAssetFileGrantOwners.clear();
  if (activeSttInstallAssetId) {
    const asset = findSttAsset(activeSttInstallAssetId);
    if (asset) getManagedSttRuntime().cancelInstall(asset.catalogId, asset.kind === "runtime" ? "runtime" : "model");
  }
  for (const recorder of routineRecorders.values()) {
    try {
      recorder.process?.kill();
    } catch (_error) {
      // Best effort during shutdown.
    }
  }
  routineRecorders.clear();
  for (const execution of routineExecutions.values()) {
    try {
      execution.process?.kill();
    } catch (_error) {
      // Best effort during shutdown.
    }
    if (execution.stepsFile) {
      try {
        fs.unlinkSync(execution.stepsFile);
      } catch (_error) {
        // Temp file may already be gone.
      }
    }
  }
  routineExecutions.clear();
  shutdownOfficerMcp();
  shutdownWorkspaceMcp();
});

ipcMain.handle("chat:open", (_event, contactId) => {
  createChatWindow(contactId);
});

ipcMain.handle("profile:open", (_event, contactId) => {
  createProfileWindow(contactId);
});

ipcMain.handle("profile:close-all", () => {
  closeProfileWindows();
});

ipcMain.handle("contact-config:open", (_event, payload) => {
  createConfigWindow(payload?.contactId, payload?.mode);
});

ipcMain.handle("contact-config:get", (_event, contactId) => {
  return getContactConfig(contactId);
});

ipcMain.handle("contact-config:save", (_event, payload) => {
  return saveContactConfig(payload?.contactId, payload?.config);
});

ipcMain.handle("chat:messages:get", (_event, contactId) => {
  const session = chatSessions.get(String(contactId || "chief"));
  return session?.messages || [];
});

ipcMain.handle("chat:messages:save", (_event, payload) => {
  return saveChatSession(payload?.contactId, payload?.messages);
});

ipcMain.handle("chat:summaries", () => {
  return chatSummaries();
});

ipcMain.handle("chat:mark-read", (_event, contactId) => {
  const key = String(contactId || "chief");
  const session = chatSessions.get(key);
  if (!session) return null;
  session.unread = 0;
  broadcastChatSummaries();
  return summarizeChatSession(key);
});

ipcMain.handle("app-settings:get", () => {
  return appSettings;
});

ipcMain.handle("app-settings:save", (_event, payload) => {
  const source = payload && typeof payload === "object" ? payload : {};
  const safePayload = {};
  for (const key of ["replyDoneNotifications", "limits", "routineSafety"]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) safePayload[key] = source[key];
  }
  return saveAppSettings(safePayload);
});

ipcMain.handle("chat:reply-pending", (event, payload) => {
  const target = currentWindow(event);
  const contactId = String(payload?.contactId || target?.heyuContactId || "chief");
  if (payload?.pending) {
    pendingChatReplies.add(contactId);
  } else {
    pendingChatReplies.delete(contactId);
  }
  return { ok: true, pending: pendingChatReplies.has(contactId) };
});

ipcMain.handle("chat:reply-complete-notification", (event, payload) => {
  return showReplyDoneNotification(payload, currentWindow(event));
});

ipcMain.handle("chat:files:select", async (event, payload = {}) => {
  const target = currentWindow(event);
  const contactId = String(target?.heyuContactId || payload?.contactId || "");
  const isFileConverter = contactId === "file-converter";
  const result = await dialog.showOpenDialog(target || undefined, {
    title: "파일 첨부",
    properties: ["openFile", "multiSelections"],
    filters: isFileConverter
      ? [
          { name: "변환 가능 파일", extensions: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff", "bmp", "gif", "pdf"] },
          { name: "이미지 파일", extensions: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff", "bmp", "gif"] },
          { name: "PDF 파일", extensions: ["pdf"] },
          { name: "모든 파일", extensions: ["*"] },
        ]
      : [
          { name: "데이터 파일", extensions: ["xlsx", "csv"] },
          { name: "발표자료 파일", extensions: ["ppt", "pptx"] },
          { name: "문서 파일", extensions: ["pdf", "doc", "docx", "hwp", "hwpx", "txt", "md", "json"] },
          { name: "모든 파일", extensions: ["*"] },
        ],
  });

  if (result.canceled) return [];
  return result.filePaths
    .map((filePath) => {
      try {
        return selectedFileInfo(filePath);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);
});

ipcMain.handle("document-resource:file-select", async (event) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const target = currentWindow(event);
  let result;
  try {
    result = await dialog.showOpenDialog(target || undefined, {
      title: "ZIP 패키지 문서 선택",
      properties: ["openFile"],
      filters: [
        { name: "지원 문서 33종", extensions: [...SUPPORTED_DOCUMENT_EXTENSIONS] },
        { name: "모든 파일", extensions: ["*"] },
      ],
    });
  } catch (_error) {
    return publicDocumentResourceError({ code: "FILE_NOT_FOUND" });
  }
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  try {
    const selected = selectedFileInfo(result.filePaths[0]);
    if (selected.sizeBytes > DOCUMENT_RESOURCE_LIMITS.maxArchiveBytes) {
      selectedFileGrants.delete(selected.fileToken);
      return publicDocumentResourceError({ code: "ARCHIVE_TOO_LARGE" });
    }
    resourceFileGrantOwners.set(selected.fileToken, {
      senderId: event.sender.id,
      expiresAt: Date.now() + FILE_GRANT_TTL_MS,
    });
    ensureDocumentResourceSenderLifecycle(event.sender);
    return {
      ok: true,
      file: {
        fileToken: selected.fileToken,
        name: selected.name,
        size: selected.size,
        sizeBytes: selected.sizeBytes,
        extension: path.extname(selected.name).slice(1).toLowerCase(),
      },
    };
  } catch (_error) {
    return publicDocumentResourceError({ code: "FILE_NOT_FOUND" });
  }
});

ipcMain.handle("document-resource:analyze", async (event, payload = {}) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  if (activeDocumentResourceJobs.has(event.sender.id)) return documentResourceBusy();
  pruneDocumentResourceSessions();
  const fileToken = String(payload?.file?.fileToken || "").trim();
  const owner = resourceFileGrantOwners.get(fileToken);
  if (!fileToken || !owner || owner.senderId !== event.sender.id || owner.expiresAt < Date.now()) {
    return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  }
  const grantedFile = resolveGrantedFile({ fileToken });
  if (!grantedFile) return publicDocumentResourceError({ code: "FILE_NOT_FOUND" });

  const sessionId = documentResourceId();
  const resourceSession = {
    sessionId,
    senderId: event.sender.id,
    fileToken,
    filePath: grantedFile.path,
    fileName: path.basename(grantedFile.path),
    secret: crypto.randomBytes(32).toString("hex"),
    previewedResourceIds: new Set(),
    analysis: null,
    expiresAt: Date.now() + DOCUMENT_RESOURCE_SESSION_TTL_MS,
  };
  documentResourceSessions.set(sessionId, resourceSession);
  try {
    resourceSession.analysis = await runDocumentResourceJob(event, resourceSession, (jobOptions) => analyzeDocumentResources({
      filePath: resourceSession.filePath,
      sessionSecret: resourceSession.secret,
      ...jobOptions,
    }));
    resourceSession.expiresAt = Date.now() + DOCUMENT_RESOURCE_SESSION_TTL_MS;
    resourceFileGrantOwners.delete(fileToken);
    selectedFileGrants.delete(fileToken);
    return documentResourceResultMetadata(resourceSession);
  } catch (error) {
    documentResourceSessions.delete(sessionId);
    return publicDocumentResourceError(error);
  }
});

ipcMain.handle("document-resource:cancel", (event) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const active = activeDocumentResourceJobs.get(event.sender.id);
  if (!active) return { ok: true, canceled: false };
  active.controller.abort();
  return { ok: true, canceled: true };
});

ipcMain.handle("document-resource:preview", async (event, payload = {}) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const resourceSession = documentResourceSession(event, payload?.sessionId);
  if (!resourceSession?.analysis) return publicDocumentResourceError({ code: "SESSION_NOT_FOUND" });
  const resourceId = String(payload?.resourceId || "").trim();
  const metadata = resourceSession.analysis.resources.find((resource) => resource.resourceId === resourceId);
  if (!metadata?.previewEligible) return publicDocumentResourceError({ code: "PREVIEW_NOT_ALLOWED" });
  if (!resourceSession.previewedResourceIds.has(resourceId) && resourceSession.previewedResourceIds.size >= DOCUMENT_RESOURCE_LIMITS.maxPreviewRequests) {
    return publicDocumentResourceError({ code: "PREVIEW_LIMIT_REACHED" });
  }
  if (activeDocumentResourceJobs.has(event.sender.id)) return documentResourceBusy();
  try {
    const result = await runDocumentResourceJob(event, resourceSession, (jobOptions) => previewDocumentResource({
      filePath: resourceSession.filePath,
      sessionSecret: resourceSession.secret,
      archiveSha256: resourceSession.analysis.archiveSha256,
      resourceId,
      ...jobOptions,
    }));
    resourceSession.previewedResourceIds.add(resourceId);
    return { ok: true, ...result };
  } catch (error) {
    return publicDocumentResourceError(error);
  }
});

ipcMain.handle("document-resource:save-one", async (event, payload = {}) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const resourceSession = documentResourceSession(event, payload?.sessionId);
  if (!resourceSession?.analysis) return publicDocumentResourceError({ code: "SESSION_NOT_FOUND" });
  if (activeDocumentResourceJobs.has(event.sender.id)) return documentResourceBusy();
  const resourceId = String(payload?.resourceId || "").trim();
  const metadata = resourceSession.analysis.resources.find((resource) => resource.resourceId === resourceId);
  if (!metadata) return publicDocumentResourceError({ code: "RESOURCE_NOT_FOUND" });
  const target = currentWindow(event);
  const defaultFileName = safeOutputFileName(metadata.name, `resource-${resourceId.slice(0, 8)}`);
  const safeExtension = /^[a-z0-9]{1,16}$/i.test(metadata.extension || "") ? metadata.extension : "";
  let saveDialog;
  try {
    saveDialog = await dialog.showSaveDialog(target || undefined, {
      title: "문서 리소스 저장",
      defaultPath: defaultFileName,
      filters: safeExtension
        ? [{ name: "원본 리소스 형식", extensions: [safeExtension] }, { name: "모든 파일", extensions: ["*"] }]
        : [{ name: "모든 파일", extensions: ["*"] }],
    });
  } catch (_error) {
    return publicDocumentResourceError({ code: "OUTPUT_FAILED" });
  }
  if (saveDialog.canceled || !saveDialog.filePath) return { ok: false, canceled: true };
  try {
    const result = await runDocumentResourceJob(event, resourceSession, (jobOptions) => saveDocumentResource({
      filePath: resourceSession.filePath,
      sessionSecret: resourceSession.secret,
      archiveSha256: resourceSession.analysis.archiveSha256,
      resourceId,
      outputPath: saveDialog.filePath,
      ...jobOptions,
    }));
    rememberDocumentResourceOutput(event.sender.id, saveDialog.filePath);
    return { ok: true, savedCount: result.savedCount, fileName: result.fileName };
  } catch (error) {
    return publicDocumentResourceError(error);
  }
});

ipcMain.handle("document-resource:save-all", async (event, payload = {}) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const resourceSession = documentResourceSession(event, payload?.sessionId);
  if (!resourceSession?.analysis) return publicDocumentResourceError({ code: "SESSION_NOT_FOUND" });
  if (activeDocumentResourceJobs.has(event.sender.id)) return documentResourceBusy();
  const target = currentWindow(event);
  const sourceBase = path.basename(resourceSession.fileName, path.extname(resourceSession.fileName));
  let saveDialog;
  try {
    saveDialog = await dialog.showSaveDialog(target || undefined, {
      title: "전체 리소스 ZIP 저장",
      defaultPath: `${safeOutputFileName(sourceBase, "document")}-resources.zip`,
      filters: [{ name: "ZIP 압축 파일", extensions: ["zip"] }],
    });
  } catch (_error) {
    return publicDocumentResourceError({ code: "OUTPUT_FAILED" });
  }
  if (saveDialog.canceled || !saveDialog.filePath) return { ok: false, canceled: true };
  try {
    const result = await runDocumentResourceJob(event, resourceSession, (jobOptions) => saveAllDocumentResources({
      filePath: resourceSession.filePath,
      sessionSecret: resourceSession.secret,
      archiveSha256: resourceSession.analysis.archiveSha256,
      outputPath: saveDialog.filePath,
      ...jobOptions,
    }));
    rememberDocumentResourceOutput(event.sender.id, saveDialog.filePath);
    return { ok: true, savedCount: result.savedCount, fileName: result.fileName };
  } catch (error) {
    return publicDocumentResourceError(error);
  }
});

ipcMain.handle("document-resource:session-clear", (event, payload = {}) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const resourceSession = documentResourceSession(event, payload?.sessionId);
  if (!resourceSession) return { ok: true, cleared: false };
  const active = activeDocumentResourceJobs.get(event.sender.id);
  if (active?.sessionId === resourceSession.sessionId) active.controller.abort();
  documentResourceSessions.delete(resourceSession.sessionId);
  return { ok: true, cleared: true };
});

ipcMain.handle("document-resource:open-output", async (event) => {
  if (!isContactWindow(event, "resource-officer")) return publicDocumentResourceError({ code: "INVALID_REQUEST" });
  const remembered = documentResourceOutputDirs.get(event.sender.id);
  if (!remembered) return publicDocumentResourceError({ code: "SESSION_NOT_FOUND" });
  try {
    const currentReal = fs.realpathSync.native(remembered);
    if (currentReal !== remembered || !fs.statSync(currentReal).isDirectory()) {
      return publicDocumentResourceError({ code: "OUTPUT_FAILED" });
    }
    const openError = await shell.openPath(currentReal);
    return openError ? publicDocumentResourceError({ code: "OUTPUT_FAILED" }) : { ok: true };
  } catch (_error) {
    return publicDocumentResourceError({ code: "OUTPUT_FAILED" });
  }
});

ipcMain.handle("converter:files:select", async (event) => {
  if (!isContactWindow(event, "file-converter")) return [];
  const target = currentWindow(event);
  const result = await dialog.showOpenDialog(target || undefined, {
    title: "변환할 파일 추가",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "변환 가능 파일", extensions: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff", "bmp", "gif", "pdf"] },
      { name: "이미지 파일", extensions: ["png", "jpg", "jpeg", "webp", "avif", "tif", "tiff", "bmp", "gif"] },
      { name: "PDF 파일", extensions: ["pdf"] },
      { name: "모든 파일", extensions: ["*"] },
    ],
  });

  if (result.canceled) return [];
  return result.filePaths
    .map((filePath) => {
      try {
        return selectedFileInfo(filePath);
      } catch (_error) {
        return null;
      }
    })
    .filter(Boolean);
});

ipcMain.handle("converter:image-convert", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("김병환");
  try {
    const files = resolveGrantedFiles(payload?.files);
    return await convertImageFiles({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:file-compress", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("김병환");
  try {
    const files = resolveGrantedFiles(payload?.files);
    return await compressFiles({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:pdf-merge", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("김병환");
  try {
    const files = resolveGrantedFiles(payload?.files);
    return await mergePdfFiles({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:pdf-split", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("김병환");
  try {
    const files = resolveGrantedFiles(payload?.file ? [payload.file] : payload?.files);
    return await splitPdfFile({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:pdf-editor-open", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("김병환");
  try {
    const files = resolveGrantedFiles(payload?.file ? [payload.file] : payload?.files);
    const file = files.find((item) => String(item?.type || "").toLowerCase() === "pdf" || /\.pdf$/i.test(item?.path || ""));
    return createPdfEditorWindow(file);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:pdf-inspect", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("源蹂묓솚");
  try {
    const files = resolveGrantedFiles(payload?.file ? [payload.file] : payload?.files);
    return await inspectPdfFile({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:pdf-preview", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("源蹂묓솚");
  try {
    const files = resolveGrantedFiles(payload?.file ? [payload.file] : payload?.files);
    return await previewPdfFile({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("converter:pdf-reorder", async (event, payload) => {
  if (!isContactWindow(event, "file-converter")) return contactWindowError("源蹂묓솚");
  try {
    const files = resolveGrantedFiles(payload?.file ? [payload.file] : payload?.files);
    return await reorderPdfPages({ ...(payload || {}), files, limits: appSettings.limits }, WORKSPACE_DIR);
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("pdf-editor:init", async (event) => {
  const file = pdfEditorFile(event);
  if (!file) return { ok: false, error: "PDF 편집 창 정보가 없습니다." };
  return {
    ok: true,
    file,
    limits: appSettings.limits,
  };
});

ipcMain.handle("pdf-editor:preview", async (event) => {
  const file = pdfEditorFile(event);
  if (!file) return { ok: false, error: "PDF 편집 창 정보가 없습니다." };
  return await previewPdfFile({ file, limits: appSettings.limits }, WORKSPACE_DIR);
});

ipcMain.handle("pdf-editor:save-order", async (event, payload) => {
  const file = pdfEditorFile(event);
  if (!file) return { ok: false, error: "PDF 편집 창 정보가 없습니다." };
  return await reorderPdfPages({ ...(payload || {}), file, limits: appSettings.limits }, WORKSPACE_DIR);
});

ipcMain.handle("converter:open-output", async (event, targetPath) => {
  const isConverter = isContactWindow(event, "file-converter");
  const isSteno = isContactWindow(event, "steno-officer");
  if (!isConverter && !isSteno) return { ok: false, error: "이 창에서는 결과 폴더를 열 수 없습니다." };
  const fallbackDir = isSteno ? path.join(WORKSPACE_DIR, "transcripts") : conversionOutputDir(WORKSPACE_DIR);
  fs.mkdirSync(fallbackDir, { recursive: true });
  if (!isExistingWorkspacePathInside(WORKSPACE_DIR, fallbackDir)) {
    return { ok: false, error: "결과 폴더가 작업공간 밖을 가리켜 열지 않았습니다." };
  }
  const requested = String(targetPath || "").trim();
  const requestedPath = requested
    ? path.resolve(isSteno && !path.isAbsolute(requested) ? WORKSPACE_DIR : "", requested)
    : "";
  const stenoAudioDir = path.join(WORKSPACE_DIR, "audio");
  const isAllowedStenoPath = isSteno && requestedPath && (
    isExistingWorkspacePathInside(fallbackDir, requestedPath) || isExistingWorkspacePathInside(stenoAudioDir, requestedPath)
  );
  const isAllowedConverterPath = isConverter && requestedPath && isExistingWorkspacePathInside(fallbackDir, requestedPath);
  const resolved = requestedPath && fs.existsSync(requestedPath) && (isAllowedStenoPath || isAllowedConverterPath)
    ? requestedPath
    : fallbackDir;
  const target = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
  const error = await shell.openPath(target);
  return { ok: !error, path: target, message: error ? "결과 폴더를 열지 못했습니다." : "" };
});

ipcMain.handle("workspace:snapshot", () => {
  return getWorkspaceSnapshot();
});

ipcMain.handle("workspace:index", () => {
  return indexWorkspaceFiles();
});

ipcMain.handle("workspace:open", async () => {
  ensureWorkspace();
  await shell.openPath(WORKSPACE_DIR);
  return { ok: true, path: WORKSPACE_DIR };
});

ipcMain.handle("series4:status", async (event) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  try {
    return await getSeries4Integration().getStatus();
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:install", async (event) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  try {
    return await getSeries4Integration().install();
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:install-cancel", (event) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  try {
    return getSeries4Integration().cancelInstall();
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:launch", async (event) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  try {
    return await getSeries4Integration().launch();
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:sessions:list", async (event) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  try {
    return await getSeries4Integration().listSessions({ limit: 100 });
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:session:inspect", async (event, payload) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  const sessionId = String(payload?.sessionId || "").trim();
  if (!SERIES4_OPAQUE_ID_PATTERN.test(sessionId)) return safeSeries4Error({ code: "SESSION_NOT_FOUND" });
  try {
    const result = await getSeries4Integration().inspectSession(sessionId);
    return publicSeries4Inspection(result);
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:video-url", async (event, payload) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  const sessionId = String(payload?.sessionId || "").trim();
  if (!SERIES4_OPAQUE_ID_PATTERN.test(sessionId)) return safeSeries4Error({ code: "SESSION_NOT_FOUND" });
  try {
    const imported = await getSeries4Integration().importSession(sessionId);
    await getSeries4Integration().resolveArtifact(imported.importId, "video");
    return {
      ok: true,
      url: `heyu-series4://video/${encodeURIComponent(imported.importId)}`,
    };
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("series4:artifact:open", async (event, payload) => {
  if (!isContactWindow(event, "routine-officer")) return safeSeries4Error({ code: "INVALID_REQUEST" });
  const sessionId = String(payload?.sessionId || "").trim();
  const artifactKind = String(payload?.artifact || "").trim().toLowerCase();
  if (!SERIES4_OPAQUE_ID_PATTERN.test(sessionId) || !new Set(["video", "folder"]).has(artifactKind)) {
    return safeSeries4Error({ code: "ARTIFACT_NOT_FOUND" });
  }
  try {
    const artifact = await getSeries4Integration().resolveArtifact(sessionId, artifactKind);
    const openError = await shell.openPath(artifact.path);
    return openError ? safeSeries4Error({ code: "ARTIFACT_OPEN_FAILED" }) : { ok: true };
  } catch (error) {
    return safeSeries4Error(error);
  }
});

ipcMain.handle("routine:cursor-position", (event) => {
  if (!isContactWindow(event, "routine-officer")) return { ok: false, error: "김루틴 창에서만 사용할 수 있는 기능입니다." };
  const point = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point);
  return {
    x: Math.round(point.x),
    y: Math.round(point.y),
    displayId: display?.id || 0,
    scaleFactor: display?.scaleFactor || 1,
    bounds: display?.bounds || null,
    workArea: display?.workArea || null,
  };
});

ipcMain.handle("routine:recording-start", (event, payload) => {
  if (!isContactWindow(event, "routine-officer")) return contactWindowError("김루틴");
  const webContents = event.sender;
  const webContentsId = webContents.id;
  if (routineRecorders.has(webContentsId)) {
    return { ok: false, error: "이미 녹화 중입니다." };
  }

  const delaySeconds = Math.min(60, Math.max(0, Number(payload?.delaySeconds ?? 2) || 0));
  const targetWindow = currentWindow(event);
  const bounds = targetWindow?.getBounds?.();
  const args = [routineRecorderScriptPath(), "--delay", String(delaySeconds)];
  if (bounds) {
    args.push("--ignore-region", `${bounds.x},${bounds.y},${bounds.width},${bounds.height}`);
  }

  const child = spawn(routinePythonCommand(), args, {
    cwd: ROOT_DIR,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const recorder = {
    process: child,
    webContents,
    finalSent: false,
    timer: setTimeout(() => {
      sendRoutineRecordingEvent(webContents, {
        type: "error",
        message: "녹화기가 오래 응답하지 않아 중지했습니다.",
      });
      try {
        child.kill();
      } catch (_error) {
        // Process already gone.
      }
    }, 30 * 60 * 1000),
  };
  recorder.onDestroyed = () => stopRoutineRecorder(webContentsId);
  webContents.once("destroyed", recorder.onDestroyed);
  routineRecorders.set(webContentsId, recorder);

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (_error) {
      return;
    }
    if (message.type === "final") recorder.finalSent = true;
    sendRoutineRecordingEvent(webContents, message);
  });

  child.stderr.resume();
  child.once("error", (error) => {
    sendRoutineRecordingEvent(webContents, {
      type: "error",
      message: error?.code === "ENOENT"
        ? "기존 Python 녹화 구성요소가 없습니다. 자동 기록은 Series 4 엔진을 설치해 사용해 주세요."
        : "기존 녹화 구성요소를 시작하지 못했습니다.",
    });
    cleanupRoutineRecorder(webContentsId);
  });
  child.once("exit", (code) => {
    if (!recorder.finalSent && code !== 0) {
      sendRoutineRecordingEvent(webContents, {
        type: "error",
        message: "기존 녹화 구성요소가 정상적으로 끝나지 않았습니다. 자동 기록은 Series 4 엔진을 사용해 주세요.",
      });
    }
    sendRoutineRecordingEvent(webContents, { type: "status", state: "idle" });
    cleanupRoutineRecorder(webContentsId);
  });

  return { ok: true, delaySeconds };
});

ipcMain.handle("routine:recording-stop", (event) => {
  if (!isContactWindow(event, "routine-officer")) return contactWindowError("김루틴");
  return { ok: stopRoutineRecorder(event.sender.id) };
});

ipcMain.handle("routine:recording-command", (event, payload) => {
  if (!isContactWindow(event, "routine-officer")) return contactWindowError("김루틴");
  const command = String(payload?.command || "").trim().toLowerCase();
  if (!new Set(["pause", "resume", "redact-last-text"]).has(command)) {
    return { ok: false, errorCode: "UNSUPPORTED_RECORDING_COMMAND" };
  }
  const recorder = routineRecorders.get(event.sender.id);
  return { ok: writeRoutineCommand(recorder, command), command };
});

ipcMain.handle("routine:execution-start", (event, payload) => {
  if (!isContactWindow(event, "routine-officer") && !isContactWindow(event, "frustration-officer")) return contactWindowError("김루틴");
  const webContents = event.sender;
  const webContentsId = webContents.id;
  if (routineExecutions.has(webContentsId)) {
    return { ok: false, error: "이미 실행 중입니다." };
  }

  const steps = sanitizeRoutineSteps(payload?.steps);
  if (!steps.length) {
    return { ok: false, error: "실행할 단계가 없습니다." };
  }
  const safetyViolations = validateRoutineStepsForExecution(steps);
  if (safetyViolations.length) {
    return {
      ok: false,
      error: [
        "위험 동작이 있어 루틴 실행을 막았습니다.",
        ...safetyViolations.slice(0, 6).map((item) => `- ${item}`),
        safetyViolations.length > 6 ? `- 외 ${safetyViolations.length - 6}건` : "",
        "필요하면 앱 설정 > 김루틴 실행 안전에서 허용 범위를 조정하세요.",
      ].filter(Boolean).join("\n"),
    };
  }

  ensureWorkspace();
  const countdownSeconds = Math.min(60, Math.max(0, Number(payload?.delaySeconds ?? 3) || 0));
  const repeatCount = Math.min(999, Math.max(1, Math.round(Number(payload?.repeatCount || 1)) || 1));
  const repeatForever = payload?.repeatForever === true;
  const stepsFile = path.join(routineTempDir(), `routine-run-${webContentsId}-${Date.now()}.json`);
  const outputDir = path.join(WORKSPACE_DIR, "outputs");
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(stepsFile, JSON.stringify(steps, null, 2), "utf8");

  const runnerArgs = [
    routineRunnerScriptPath(),
    "--steps-file", stepsFile,
    "--countdown", String(countdownSeconds),
    "--output-dir", outputDir,
    "--repeat-count", String(repeatCount),
  ];
  if (repeatForever) runnerArgs.push("--repeat-forever");
  const child = spawn(routinePythonCommand(), runnerArgs, {
    cwd: ROOT_DIR,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const execution = {
    process: child,
    webContents,
    stepsFile,
    finalSent: false,
    pendingApprovalTokens: new Set(),
    timer: null,
  };
  execution.onDestroyed = () => stopRoutineExecution(webContentsId);
  webContents.once("destroyed", execution.onDestroyed);
  routineExecutions.set(webContentsId, execution);
  armRoutineExecutionWatchdog(execution);

  const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  rl.on("line", (line) => {
    if (!line.trim()) return;
    armRoutineExecutionWatchdog(execution);
    let message;
    try {
      message = JSON.parse(line);
    } catch (_error) {
      return;
    }
    if (message.type === "final") execution.finalSent = true;
    if (message.type === "approval-required" && /^step-\d+-[a-f0-9]{16}$/i.test(String(message.token || ""))) {
      execution.pendingApprovalTokens.add(String(message.token));
    }
    if (message.type === "approval-resolved") {
      execution.pendingApprovalTokens.clear();
    }
    sendRoutineExecutionEvent(webContents, message);
  });

  child.stderr.resume();
  child.once("error", (error) => {
    sendRoutineExecutionEvent(webContents, {
      type: "error",
      message: error?.code === "ENOENT"
        ? "기존 Python 실행 구성요소가 없습니다. Series 4 엔진 또는 직접 단계 실행 환경을 확인해 주세요."
        : "기존 실행 구성요소를 시작하지 못했습니다.",
    });
    cleanupRoutineExecution(webContentsId);
  });
  child.once("exit", (code) => {
    if (!execution.finalSent && code !== 0) {
      sendRoutineExecutionEvent(webContents, {
        type: "error",
        message: "기존 실행 구성요소가 정상적으로 끝나지 않았습니다.",
      });
    }
    sendRoutineExecutionEvent(webContents, { type: "status", state: "idle" });
    cleanupRoutineExecution(webContentsId);
  });

  return {
    ok: true,
    delaySeconds: countdownSeconds,
    count: steps.length,
    repeatCount: repeatForever ? null : repeatCount,
    repeatForever,
  };
});

ipcMain.handle("routine:execution-stop", (event) => {
  if (!isContactWindow(event, "routine-officer") && !isContactWindow(event, "frustration-officer")) return contactWindowError("김루틴");
  return { ok: stopRoutineExecution(event.sender.id) };
});

ipcMain.handle("routine:execution-approval", (event, payload) => {
  if (!isContactWindow(event, "routine-officer") && !isContactWindow(event, "frustration-officer")) return contactWindowError("김루틴");
  const execution = routineExecutions.get(event.sender.id);
  const token = String(payload?.token || "").trim();
  const decision = payload?.approved === true ? "approve" : payload?.approved === false ? "reject" : "";
  if (!execution || !decision || !/^step-\d+-[a-f0-9]{16}$/i.test(token) || !execution.pendingApprovalTokens.has(token)) {
    return { ok: false, errorCode: "NO_PENDING_APPROVAL" };
  }
  const ok = writeRoutineCommand(execution, `${decision} ${token}`);
  if (ok) execution.pendingApprovalTokens.delete(token);
  return { ok, approved: decision === "approve" };
});

ipcMain.handle("frustration:web-status", async (event, payload) => {
  if (!isContactWindow(event, "frustration-officer")) return contactWindowError("문서 입력");
  return checkWebInputStatus(payload || {});
});

ipcMain.handle("frustration:web-browser-open", async (event, payload) => {
  if (!isContactWindow(event, "frustration-officer")) return contactWindowError("문서 입력");
  try {
    return openAutomationBrowser(payload || {});
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
});

ipcMain.handle("frustration:web-input-start", async (event, payload) => {
  if (!isContactWindow(event, "frustration-officer")) return contactWindowError("문서 입력");
  const webContents = event.sender;
  const webContentsId = webContents.id;
  if (frustrationWebInputs.has(webContentsId)) {
    return { ok: false, error: "이미 웹 입력 중입니다." };
  }

  const steps = sanitizeRoutineSteps(payload?.steps);
  if (!steps.length) {
    return { ok: false, error: "입력할 단계가 없습니다." };
  }
  const allowedActions = new Set(["pasteText", "pressKey", "hotkey", "setClipboard", "wait"]);
  const unsafeStep = steps.find((step) => !allowedActions.has(step.action));
  if (unsafeStep) {
    return { ok: false, error: `웹 입력은 ${unsafeStep.action} 동작을 실행하지 않습니다.` };
  }

  const status = await checkWebInputStatus(payload || {});
  if (!status.ok) {
    return { ok: false, error: status.error || "웹 입력 브라우저가 준비되지 않았습니다.", status };
  }

  const token = { canceled: false };
  frustrationWebInputs.set(webContentsId, { token });
  runWebInput({
    clipboard,
    steps,
    options: {
      ...(payload || {}),
      targetId: status.selected?.id || payload?.targetId,
    },
    token,
    onEvent: (message) => sendFrustrationWebInputEvent(webContents, message),
  }).catch((error) => {
    sendFrustrationWebInputEvent(webContents, {
      type: "error",
      message: error?.message || String(error),
      driver: "web",
    });
  }).finally(() => {
    sendFrustrationWebInputEvent(webContents, { type: "status", state: "idle", driver: "web" });
    frustrationWebInputs.delete(webContentsId);
  });

  return {
    ok: true,
    driver: "web",
    count: steps.length,
    delaySeconds: Math.min(60, Math.max(0, Number(payload?.delaySeconds ?? 3) || 0)),
    target: status.selected,
  };
});

ipcMain.handle("frustration:web-input-stop", (event) => {
  if (!isContactWindow(event, "frustration-officer")) return contactWindowError("문서 입력");
  return { ok: stopFrustrationWebInput(event.sender.id) };
});

ipcMain.handle("privacy:windows:list", async (event) => {
  if (!isContactWindow(event, "privacy-officer")) return contactWindowError("김개보");
  try {
    const ownHandle = nativeWindowHandleId(currentWindow(event));
    const windows = (await listOpenWindows()).filter((item) => item.handle !== ownHandle);
    return { ok: true, windows };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), windows: [] };
  }
});

ipcMain.handle("privacy:windows:inspect", async (event, payload) => {
  if (!isContactWindow(event, "privacy-officer")) return contactWindowError("김개보");
  const requester = currentWindow(event);
  const wasVisible = requester && !requester.isDestroyed() && requester.isVisible();
  const wasMinimized = requester && !requester.isDestroyed() && requester.isMinimized();
  try {
    if (requester && !requester.isDestroyed() && wasVisible) {
      requester.hide();
      await wait(350);
    }
    return await inspectOpenWindows(payload?.windows || [], clipboard, { workspaceDir: WORKSPACE_DIR });
  } catch (error) {
    return { ok: false, error: error?.message || String(error), results: [] };
  } finally {
    if (requester && !requester.isDestroyed() && wasVisible) {
      if (wasMinimized) requester.minimize();
      else requester.show();
      requester.focus();
    }
  }
});

ipcMain.handle("privacy:files:inspect", async (event, payload) => {
  if (!isContactWindow(event, "privacy-officer")) return contactWindowError("김개보");
  try {
    const files = resolveGrantedFiles(payload?.files || []).slice(0, 10);
    const results = files.map(inspectPrivacyFile);
    return { ok: true, inspected: results.length, results };
  } catch (error) {
    return { ok: false, error: error?.message || String(error), results: [] };
  }
});

ipcMain.handle("privacy:text:scan", async (event, payload) => {
  if (!isContactWindow(event, "privacy-officer")) return contactWindowError("김개보");
  try {
    return scanPrivacyText(payload?.text || "");
  } catch (error) {
    return { ok: false, error: error?.message || String(error), findings: [], summary: {} };
  }
});

ipcMain.handle("routine:file:save", async (event, payload) => {
  if (!isContactWindow(event, "routine-officer")) return contactWindowError("김루틴");
  ensureWorkspace();
  const routine = routineFilePayload(payload);
  if (!routine.steps.length) {
    return { ok: false, error: "저장할 루틴 단계가 없습니다." };
  }

  const target = currentWindow(event);
  const baseName = sanitizeSaveFileName(routine.name || "routine").replace(/\.routine\.json$/i, "").replace(/\.json$/i, "");
  const result = await dialog.showSaveDialog(target || undefined, {
    title: "루틴 저장",
    defaultPath: path.join(routineFilesDir(), `${baseName || "routine"}.routine.json`),
    filters: [{ name: "김루틴 루틴 파일", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, JSON.stringify(routine, null, 2), "utf8");
  return {
    ok: true,
    path: result.filePath,
    fileName: path.basename(result.filePath),
    routine,
  };
});

ipcMain.handle("routine:file:load", async (event) => {
  if (!isContactWindow(event, "routine-officer")) return contactWindowError("김루틴");
  ensureWorkspace();
  const target = currentWindow(event);
  const result = await dialog.showOpenDialog(target || undefined, {
    title: "루틴 불러오기",
    defaultPath: routineFilesDir(),
    properties: ["openFile"],
    filters: [{ name: "김루틴 루틴 파일", extensions: ["json"] }],
  });

  if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
  const filePath = result.filePaths[0];
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return { ok: false, error: "루틴 파일을 읽지 못했습니다." };
  }

  const routine = routineFilePayload({
    name: parsed?.name || path.basename(filePath, path.extname(filePath)),
    options: parsed?.options || parsed,
    steps: Array.isArray(parsed) ? parsed : parsed?.steps,
  });
  if (!routine.steps.length) {
    return { ok: false, error: "불러올 단계가 없습니다." };
  }

  return {
    ok: true,
    path: filePath,
    fileName: path.basename(filePath),
    routine,
  };
});

ipcMain.handle("stt:transcribe", async (event, payload) => {
  if (!isContactWindow(event, "steno-officer")) return contactWindowError("김속기");
  const sender = event.sender;
  const senderId = sender.id;
  if (activeSttTranscriptions.has(senderId)) {
    return {
      ok: false,
      status: "busy",
      statusLabel: "받아쓰기 진행 중",
      errorCode: "STT_BUSY",
      message: "이 김속기 창에서 이미 받아쓰기 작업이 진행 중입니다.",
      suggestions: [],
    };
  }

  const controller = new AbortController();
  const active = { controller, sender };
  activeSttTranscriptions.set(senderId, active);
  const abortWhenDestroyed = () => controller.abort();
  sender.once("destroyed", abortWhenDestroyed);

  try {
    const managedRuntime = await selectManagedSttModelForPreset(payload?.model);
    return await transcribeSpeechAudio(
      { ...(payload || {}), limits: appSettings.limits },
      { managedRuntime, signal: controller.signal }
    );
  } finally {
    sender.removeListener("destroyed", abortWhenDestroyed);
    if (activeSttTranscriptions.get(senderId) === active) {
      activeSttTranscriptions.delete(senderId);
    }
  }
});

ipcMain.handle("stt:transcribe-cancel", (event) => {
  if (!isContactWindow(event, "steno-officer")) return contactWindowError("김속기");
  const active = activeSttTranscriptions.get(event.sender.id);
  if (!active) return { ok: true, canceled: false, status: "idle" };
  active.controller.abort();
  return { ok: true, canceled: true, status: "cancel-requested" };
});

ipcMain.handle("stt:runtime-status", async (event) => {
  if (!isContactWindow(event, "steno-officer")) return { ok: false, error: "김속기 창에서만 사용할 수 있는 기능입니다." };
  try {
    return await buildSttRuntimeStatus();
  } catch (_error) {
    return { ok: false, status: "status-failed", errorCode: "STATUS_FAILED", assets: STT_ASSETS };
  }
});

ipcMain.handle("stt:asset:file-select", async (event, payload) => {
  if (!isContactWindow(event, "steno-officer")) return contactWindowError("김속기");
  const asset = findSttAsset(payload?.assetId);
  if (!asset) return sttInstallError({ code: "CATALOG_ENTRY_NOT_FOUND" });
  const target = currentWindow(event);
  let result;
  try {
    result = await dialog.showOpenDialog(target || undefined, {
      title: `${asset.label} 로컬 설치 파일 선택`,
      properties: ["openFile"],
      filters: asset.kind === "runtime"
        ? [
          { name: "검토된 whisper.cpp ZIP", extensions: ["zip"] },
          { name: "모든 파일", extensions: ["*"] },
        ]
        : [
          { name: "검토된 STT 모델", extensions: ["bin", "gguf", "onnx"] },
          { name: "모든 파일", extensions: ["*"] },
        ],
    });
  } catch (_error) {
    return sttInstallError({ code: "LOCAL_FILE_NOT_FOUND" });
  }
  if (result.canceled || !result.filePaths?.[0]) return { ok: false, canceled: true };
  try {
    const file = issueSttAssetFileGrant(event.sender.id, asset, result.filePaths[0]);
    if (Number(asset.sizeBytes) > 0 && file.sizeBytes !== Number(asset.sizeBytes)) {
      sttAssetFileGrantOwners.delete(file.fileToken);
      selectedFileGrants.delete(file.fileToken);
      return sttInstallError({ code: "SIZE_MISMATCH" });
    }
    return { ok: true, assetId: asset.id, file };
  } catch (_error) {
    return sttInstallError({ code: "LOCAL_FILE_NOT_FOUND" });
  }
});

ipcMain.handle("stt:asset:install", async (event, payload) => {
  if (!isContactWindow(event, "steno-officer")) return contactWindowError("김속기");
  const asset = findSttAsset(payload?.assetId);
  if (!asset) return sttInstallError({ code: "CATALOG_ENTRY_NOT_FOUND" });
  if (activeSttInstallAssetId && activeSttInstallAssetId !== asset.id) {
    return { ok: false, errorCode: "INSTALL_BUSY", error: "다른 음성 구성요소를 설치하고 있습니다." };
  }

  const bundled = await resolveBundledSttAssets({ force: true });
  const bundledAsset = bundled.assets?.[asset.catalogId];
  if (bundledAsset?.ready && bundledAsset?.verified) {
    verifiedSttAssetIds.add(asset.id);
    return {
      ok: true,
      assetId: asset.id,
      installed: true,
      selected: asset.kind !== "model"
        || asset.catalogId === bundled.turboModel?.id
        || asset.catalogId === bundled.smallModel?.id,
      alreadyInstalled: true,
      bundled: true,
      verified: true,
      status: await buildSttRuntimeStatus(),
    };
  }
  const grantedFile = consumeSttAssetFileGrant(event.sender.id, asset.id, payload?.fileToken);
  if (!grantedFile) return sttInstallError({ code: "LOCAL_FILE_REQUIRED" });

  activeSttInstallAssetId = asset.id;
  const manager = getManagedSttRuntime();
  const sender = event.sender;
  const onProgress = (progress) => {
    if (sender.isDestroyed()) return;
    const totalBytes = Number(progress.totalBytes || asset.sizeBytes || 0);
    const receivedBytes = Number(progress.downloadedBytes || 0);
    sender.send("stt:asset:install-progress", {
      assetId: asset.id,
      phase: String(progress.phase || "working"),
      percent: totalBytes > 0 ? Math.max(0, Math.min(100, Math.round((receivedBytes / totalBytes) * 100))) : 0,
      receivedBytes,
      totalBytes,
    });
  };

  try {
    const managerKind = asset.kind === "runtime" ? "runtime" : "model";
    const result = managerKind === "runtime"
      ? await manager.importRuntimeFromFile(asset.catalogId, grantedFile.path, { onProgress, autoSelect: true })
      : await manager.importModelFromFile(asset.catalogId, grantedFile.path, { onProgress, autoSelect: asset.kind === "model" });
    if (result.valid) verifiedSttAssetIds.add(asset.id);
    return {
      ok: true,
      assetId: asset.id,
      installed: Boolean(result.valid),
      selected: Boolean(result.selected),
      alreadyInstalled: Boolean(result.alreadyInstalled),
      status: await buildSttRuntimeStatus(),
    };
  } catch (error) {
    return sttInstallError(error);
  } finally {
    activeSttInstallAssetId = "";
  }
});

ipcMain.handle("stt:asset:install-cancel", (event, payload) => {
  if (!isContactWindow(event, "steno-officer")) return contactWindowError("김속기");
  const asset = findSttAsset(payload?.assetId || activeSttInstallAssetId);
  if (!asset) return { ok: true, canceled: false };
  const kind = asset.kind === "runtime" ? "runtime" : "model";
  return getManagedSttRuntime().cancelInstall(asset.catalogId, kind);
});

ipcMain.handle("chart:file:save", async (event, payload) => {
  const svg = String(payload?.svg || "");
  if (!svg.trim().startsWith("<svg")) {
    return { ok: false, error: "저장할 SVG 그래프 데이터가 없습니다." };
  }

  const target = currentWindow(event);
  const defaultFileName = sanitizeSaveFileName(payload?.defaultFileName || payload?.title || "graph.svg").replace(/\.svg$/i, "");
  const result = await dialog.showSaveDialog(target || undefined, {
    title: "그래프 저장",
    defaultPath: `${defaultFileName}.svg`,
    filters: [{ name: "SVG 이미지", extensions: ["svg"] }],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, svg, "utf8");
  return { ok: true, path: result.filePath };
});

ipcMain.handle("presentation:file:save", async (event, payload) => {
  const base64 = String(payload?.base64 || "");
  if (!base64) {
    return { ok: false, error: "저장할 발표자료 데이터가 없습니다." };
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (_error) {
    return { ok: false, error: "발표자료 데이터 형식이 올바르지 않습니다." };
  }

  const format = String(payload?.format || "").toLowerCase();
  const mimeType = String(payload?.mimeType || "").toLowerCase();
  const isHtml = format === "html" || mimeType.includes("html");
  const isPptx = format === "pptx" || mimeType.includes("presentationml") || (!isHtml && buffer.slice(0, 2).toString("utf8") === "PK");
  if (isPptx && (buffer.length < 4 || buffer.slice(0, 2).toString("utf8") !== "PK")) {
    return { ok: false, error: "PPTX 파일 데이터가 올바르지 않습니다." };
  }
  if (isHtml && !buffer.toString("utf8", 0, Math.min(buffer.length, 200)).toLowerCase().includes("<!doctype html")) {
    return { ok: false, error: "HTML 발표자료 데이터가 올바르지 않습니다." };
  }
  const generatedMaxBytes = limitMbToBytes(appSettings.limits.generatedFileMb, DEFAULT_LIMIT_SETTINGS.generatedFileMb);
  if (buffer.length > generatedMaxBytes) {
    return { ok: false, error: `${appSettings.limits.generatedFileMb}MB를 넘는 발표자료는 현재 저장 대상에서 제외했습니다. 설정에서 생성물 저장 제한을 조정할 수 있습니다.` };
  }

  const target = currentWindow(event);
  const extension = isHtml ? "html" : "pptx";
  const defaultFileName = sanitizeSaveFileName(payload?.defaultFileName || payload?.title || "presentation").replace(/\.(pptx|html?)$/i, "");
  const result = await dialog.showSaveDialog(target || undefined, {
    title: isHtml ? "웹 발표자료 저장" : "PPTX 저장",
    defaultPath: `${defaultFileName}.${extension}`,
    filters: isHtml
      ? [{ name: "HTML 웹 발표자료", extensions: ["html"] }]
      : [{ name: "PowerPoint 프레젠테이션", extensions: ["pptx"] }],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, isHtml ? buffer.toString("utf8") : buffer);
  return { ok: true, path: result.filePath };
});

ipcMain.handle("image:file:save", async (event, payload) => {
  const base64 = String(payload?.base64 || "");
  if (!base64) {
    return { ok: false, error: "저장할 이미지 데이터가 없습니다." };
  }

  let buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch (_error) {
    return { ok: false, error: "이미지 데이터 형식이 올바르지 않습니다." };
  }

  const generatedMaxBytes = limitMbToBytes(appSettings.limits.generatedFileMb, DEFAULT_LIMIT_SETTINGS.generatedFileMb);
  if (!buffer.length || buffer.length > generatedMaxBytes) {
    return { ok: false, error: `저장할 수 있는 이미지 크기가 아닙니다. 현재 생성물 저장 제한은 ${appSettings.limits.generatedFileMb}MB입니다.` };
  }

  const mimeType = String(payload?.mimeType || "image/png").toLowerCase();
  const extension = mimeType.includes("jpeg") || mimeType.includes("jpg") ? "jpg" : mimeType.includes("webp") ? "webp" : "png";
  const target = currentWindow(event);
  const defaultFileName = sanitizeSaveFileName(payload?.defaultFileName || payload?.title || "image").replace(/\.(png|jpg|jpeg|webp)$/i, "");
  const result = await dialog.showSaveDialog(target || undefined, {
    title: "이미지 저장",
    defaultPath: `${defaultFileName}.${extension}`,
    filters: [
      { name: "이미지", extensions: ["png", "jpg", "jpeg", "webp"] },
    ],
  });

  if (result.canceled || !result.filePath) return { ok: false, canceled: true };
  fs.writeFileSync(result.filePath, buffer);
  return { ok: true, path: result.filePath };
});

ipcMain.handle("llm:officer-message", (_event, payload) => {
  return sendOfficerMessage(enrichOfficerPayload(payload));
});

ipcMain.handle("llm:ignite-officer", (_event, payload) => {
  return igniteOfficer(enrichOfficerPayload(payload));
});

ipcMain.handle("llm:status", () => {
  return checkOfficerStatus();
});

ipcMain.handle("llm:models:list", () => {
  return getLocalModelManager().list();
});

ipcMain.handle("llm:model:select", async (_event, model) => {
  const result = await getLocalModelManager().select(String(model || ""));
  if (result.ok) {
    broadcastLocalModelChanged({
      model: result.effectiveModel,
      selectedModel: result.selectedModel,
      lockedByEnvironment: result.lockedByEnvironment,
    });
  }
  return result;
});

ipcMain.handle("llm:model:pull", async (event, model) => {
  const manager = getLocalModelManager();
  const result = await manager.pull(String(model || ""), {
    onProgress(progress) {
      if (!event.sender.isDestroyed()) event.sender.send("llm:model:pull-progress", progress);
    },
  });
  if (!result.ok || !result.canSelect) return result;

  const selected = await manager.select(result.model);
  if (selected.ok) {
    broadcastLocalModelChanged({
      model: selected.effectiveModel,
      selectedModel: selected.selectedModel,
      lockedByEnvironment: selected.lockedByEnvironment,
    });
  }
  return { ...result, selected };
});

ipcMain.handle("llm:model:pull-cancel", () => {
  return getLocalModelManager().cancelPull();
});

ipcMain.handle("llm:official-link:open", async (_event, key) => {
  const destination = officialDestination(key);
  if (!destination) return { ok: false, errorCode: "UNSUPPORTED_OFFICIAL_LINK" };
  try {
    await shell.openExternal(destination);
    return { ok: true };
  } catch (_error) {
    return { ok: false, errorCode: "OFFICIAL_LINK_OPEN_FAILED" };
  }
});

ipcMain.on("window:minimize", (event) => {
  currentWindow(event)?.minimize();
});

ipcMain.on("window:maximize-toggle", (event) => {
  const target = currentWindow(event);
  if (!target) return;
  toggleCustomMaximize(target);
});

ipcMain.on("window:close", (event) => {
  const target = currentWindow(event);
  if (!target) return;
  if (target === mainWindow) {
    hideMainWindowToTray();
    return;
  }
  const contactId = target.heyuContactId;
  if (contactId && pendingChatReplies.has(contactId)) {
    target.hide();
    return;
  }
  target.close();
});

ipcMain.on("main:navigate", (_event, view) => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }

  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("main:navigate", view);
      mainWindow.show();
      mainWindow.focus();
    });
    return;
  }

  mainWindow.webContents.send("main:navigate", view);
  mainWindow.show();
  mainWindow.focus();
});
