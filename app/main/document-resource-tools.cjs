const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Worker } = require("worker_threads");

const SUPPORTED_DOCUMENT_EXTENSIONS = Object.freeze([
  "hwpx",
  "docx", "docm", "dotx", "dotm",
  "pptx", "pptm", "potx", "potm", "ppsx", "ppsm",
  "xlsx", "xlsm", "xlsb", "xltx", "xltm",
  "odt", "ods", "odp", "odg", "ott", "ots", "otp", "otg",
  "vsdx", "vsdm", "vssx", "vssm", "vstx", "vstm",
  "xps", "oxps",
  "epub",
]);

const DOCUMENT_RESOURCE_LIMITS = Object.freeze({
  maxArchiveBytes: 100 * 1000 * 1000,
  maxEntryBytes: 128 * 1024 * 1024,
  maxExpandedBytes: 512 * 1024 * 1024,
  maxEntries: 5000,
  maxCompressionRatio: 1000,
  maxPreviewBytes: 1024 * 1024,
  maxPreviewRequests: 24,
  maxPreviewDimension: 16384,
  maxPreviewPixels: 25 * 1000 * 1000,
});

const PUBLIC_ERROR_MESSAGES = Object.freeze({
  CANCELED: "작업을 취소했습니다.",
  BUSY: "이미 문서 리소스 작업이 진행 중입니다.",
  INVALID_REQUEST: "요청 정보가 올바르지 않습니다.",
  SESSION_NOT_FOUND: "분석 세션이 없거나 만료되었습니다.",
  FILE_NOT_FOUND: "선택한 문서를 다시 찾을 수 없습니다.",
  UNSUPPORTED_FORMAT: "지원하지 않는 문서 형식입니다.",
  ARCHIVE_TOO_LARGE: "원본 문서는 100 MB 이하여야 합니다.",
  INVALID_ZIP: "유효한 ZIP 패키지 문서가 아닙니다.",
  FORMAT_MISMATCH: "확장자와 문서 내부 형식이 일치하지 않습니다.",
  ZIP64_NOT_SUPPORTED: "ZIP64 문서는 지원하지 않습니다.",
  SPLIT_ZIP_NOT_SUPPORTED: "분할 ZIP 문서는 지원하지 않습니다.",
  ENCRYPTED_ENTRY: "암호화되거나 DRM이 적용된 문서는 처리할 수 없습니다.",
  UNSAFE_ENTRY_PATH: "안전하지 않은 내부 경로가 있어 처리를 중단했습니다.",
  DUPLICATE_ENTRY: "중복되거나 충돌하는 내부 경로가 있어 처리를 중단했습니다.",
  UNSAFE_ENTRY_TYPE: "지원하지 않는 내부 파일 유형이 있어 처리를 중단했습니다.",
  UNSUPPORTED_COMPRESSION: "지원하지 않는 압축 방식이 포함되어 있습니다.",
  ENTRY_TOO_LARGE: "내부 파일 하나가 128 MiB 제한을 초과합니다.",
  EXPANDED_SIZE_TOO_LARGE: "전체 압축 해제 크기가 512 MiB 제한을 초과합니다.",
  TOO_MANY_ENTRIES: "내부 항목이 5,000개 제한을 초과합니다.",
  ABNORMAL_COMPRESSION_RATIO: "비정상적인 압축률이 감지되어 처리를 중단했습니다.",
  ARCHIVE_CHANGED: "분석 후 원본 문서가 변경되었습니다. 다시 분석해 주세요.",
  RESOURCE_NOT_FOUND: "선택한 리소스를 찾을 수 없습니다.",
  PREVIEW_NOT_ALLOWED: "이 리소스는 안전 미리보기를 제공하지 않습니다.",
  PREVIEW_LIMIT_REACHED: "한 세션의 미리보기는 24개까지 열 수 있습니다.",
  OUTPUT_EXISTS: "같은 이름의 파일이 이미 있습니다. 다른 이름이나 위치를 선택해 주세요.",
  OUTPUT_FAILED: "리소스를 저장하지 못했습니다.",
  TIMEOUT: "문서 처리 시간이 제한을 초과해 작업을 중단했습니다.",
  INTERNAL_ERROR: "문서 리소스 처리 중 오류가 발생했습니다.",
});

const KNOWN_ERROR_CODES = new Set(Object.keys(PUBLIC_ERROR_MESSAGES));
const WORKER_PATH = path.join(__dirname, "document-resource-worker.cjs");

class DocumentResourceError extends Error {
  constructor(code) {
    const normalized = KNOWN_ERROR_CODES.has(code) ? code : "INTERNAL_ERROR";
    super(PUBLIC_ERROR_MESSAGES[normalized]);
    this.name = "DocumentResourceError";
    this.code = normalized;
  }
}

function publicDocumentResourceError(error) {
  const errorCode = KNOWN_ERROR_CODES.has(error?.code) ? error.code : "INTERNAL_ERROR";
  return {
    ok: false,
    errorCode,
    message: PUBLIC_ERROR_MESSAGES[errorCode],
  };
}

function documentExtension(fileName) {
  return path.extname(String(fileName || "")).slice(1).toLowerCase();
}

function isSupportedDocumentName(fileName) {
  return SUPPORTED_DOCUMENT_EXTENSIONS.includes(documentExtension(fileName));
}

function safeOutputFileName(value, fallback = "resource") {
  const raw = path.basename(String(value || fallback)).normalize("NFC");
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, "_")
    .replace(/[. ]+$/g, "")
    .replace(/^\.+/g, "")
    .slice(0, 180);
  return cleaned || fallback;
}

function sanitizeProgress(value = {}) {
  return {
    stage: String(value.stage || "working").slice(0, 40),
    processedEntries: Math.max(0, Number(value.processedEntries || 0)),
    totalEntries: Math.max(0, Number(value.totalEntries || 0)),
    processedBytes: Math.max(0, Number(value.processedBytes || 0)),
    totalBytes: Math.max(0, Number(value.totalBytes || 0)),
  };
}

async function cleanupPartialArtifacts(directory, jobId) {
  if (!directory || !jobId) return;
  let entries = [];
  try {
    entries = await fs.promises.readdir(directory, { withFileTypes: true });
  } catch (_error) {
    return;
  }
  const suffix = `.heyu-partial-${jobId}`;
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
    .map((entry) => fs.promises.unlink(path.join(directory, entry.name)).catch(() => {})));
}

function runDocumentResourceWorker(task, options = {}) {
  const signal = options.signal;
  if (signal?.aborted) return Promise.reject(new DocumentResourceError("CANCELED"));

  const jobId = String(options.jobId || task.jobId || (crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")));
  const cleanupDir = String(options.cleanupDir || "");
  return new Promise((resolve, reject) => {
    let settled = false;
    let terminateTimer = null;
    let timeoutTimer = null;
    let timedOut = false;
    let cancelRequested = Boolean(signal?.aborted);
    const worker = new Worker(WORKER_PATH, {
      workerData: {
        ...task,
        jobId,
        limits: DOCUMENT_RESOURCE_LIMITS,
      },
    });

    const cleanup = () => {
      if (terminateTimer) clearTimeout(terminateTimer);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      worker.removeAllListeners();
    };

    const finish = async (error, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      await Promise.all([
        worker.terminate().catch(() => {}),
        cleanupPartialArtifacts(cleanupDir, jobId),
      ]);
      signal?.removeEventListener?.("abort", onAbort);
      const finalError = timedOut
        ? new DocumentResourceError("TIMEOUT")
        : cancelRequested || signal?.aborted
          ? new DocumentResourceError("CANCELED")
          : error;
      if (finalError) reject(finalError);
      else resolve(value);
    };

    const requestWorkerStop = () => {
      if (settled) return;
      try {
        worker.postMessage({ type: "cancel" });
      } catch (_error) {
        // The worker may already be shutting down.
      }
      terminateTimer = setTimeout(() => worker.terminate().catch(() => {}), 500);
    };

    const onAbort = () => {
      cancelRequested = true;
      requestWorkerStop();
    };

    signal?.addEventListener?.("abort", onAbort, { once: true });
    const defaultTimeoutMs = task.operation === "save-all" || task.operation === "save-one" ? 5 * 60 * 1000 : 2 * 60 * 1000;
    const timeoutMs = Math.max(1000, Math.min(10 * 60 * 1000, Number(options.timeoutMs || defaultTimeoutMs)));
    timeoutTimer = setTimeout(() => {
      timedOut = true;
      requestWorkerStop();
    }, timeoutMs);
    worker.on("message", (message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "progress") {
        options.onProgress?.(sanitizeProgress(message.value));
        return;
      }
      if (message.type !== "result") return;
      if (timedOut) finish(new DocumentResourceError("TIMEOUT"));
      else if (cancelRequested || signal?.aborted) finish(new DocumentResourceError("CANCELED"));
      else if (message.ok) finish(null, message.value);
      else finish(new DocumentResourceError(message.errorCode));
    });
    worker.once("error", () => finish(new DocumentResourceError(timedOut ? "TIMEOUT" : signal?.aborted ? "CANCELED" : "INTERNAL_ERROR")));
    worker.once("exit", (code) => {
      if (!settled) finish(new DocumentResourceError(timedOut ? "TIMEOUT" : signal?.aborted ? "CANCELED" : code === 0 ? "INTERNAL_ERROR" : "INTERNAL_ERROR"));
    });
  });
}

async function analyzeDocumentResources(options = {}) {
  const filePath = path.resolve(String(options.filePath || ""));
  if (!filePath || !isSupportedDocumentName(filePath)) throw new DocumentResourceError("UNSUPPORTED_FORMAT");
  return runDocumentResourceWorker({
    operation: "analyze",
    filePath,
    sessionSecret: String(options.sessionSecret || ""),
  }, options);
}

async function previewDocumentResource(options = {}) {
  return runDocumentResourceWorker({
    operation: "preview",
    filePath: path.resolve(String(options.filePath || "")),
    sessionSecret: String(options.sessionSecret || ""),
    archiveSha256: String(options.archiveSha256 || ""),
    resourceId: String(options.resourceId || ""),
  }, options);
}

async function saveDocumentResource(options = {}) {
  return runDocumentResourceWorker({
    operation: "save-one",
    filePath: path.resolve(String(options.filePath || "")),
    sessionSecret: String(options.sessionSecret || ""),
    archiveSha256: String(options.archiveSha256 || ""),
    resourceId: String(options.resourceId || ""),
    outputPath: path.resolve(String(options.outputPath || "")),
  }, {
    ...options,
    cleanupDir: path.dirname(path.resolve(String(options.outputPath || ""))),
  });
}

async function saveAllDocumentResources(options = {}) {
  return runDocumentResourceWorker({
    operation: "save-all",
    filePath: path.resolve(String(options.filePath || "")),
    sessionSecret: String(options.sessionSecret || ""),
    archiveSha256: String(options.archiveSha256 || ""),
    outputPath: path.resolve(String(options.outputPath || "")),
  }, {
    ...options,
    cleanupDir: path.dirname(path.resolve(String(options.outputPath || ""))),
  });
}

module.exports = {
  DOCUMENT_RESOURCE_LIMITS,
  DocumentResourceError,
  PUBLIC_ERROR_MESSAGES,
  SUPPORTED_DOCUMENT_EXTENSIONS,
  analyzeDocumentResources,
  documentExtension,
  isSupportedDocumentName,
  previewDocumentResource,
  publicDocumentResourceError,
  safeOutputFileName,
  saveAllDocumentResources,
  saveDocumentResource,
};
