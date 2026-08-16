const DEFAULT_OLLAMA_ORIGIN = "http://127.0.0.1:11434";
const LIST_TIMEOUT_MS = 5000;
const MAX_MODELS = 512;
const MAX_MODEL_TAG_LENGTH = 200;

const OFFICIAL_DESTINATIONS = Object.freeze({
  "ollama-download": "https://ollama.com/download",
  "ollama-library": "https://ollama.com/search",
});

function validateModelTag(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > MAX_MODEL_TAG_LENGTH) return false;
  if (value !== value.trim() || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes("..") || value.includes("\\") || value.includes("//")) return false;

  const parts = value.split("/");
  if (parts.length > 8 || parts.some((part) => !part)) return false;

  const lastPart = parts.pop();
  const tagSeparator = lastPart.indexOf(":");
  if (tagSeparator !== lastPart.lastIndexOf(":")) return false;

  const repository = tagSeparator >= 0 ? lastPart.slice(0, tagSeparator) : lastPart;
  const tag = tagSeparator >= 0 ? lastPart.slice(tagSeparator + 1) : "";
  const segmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

  if (!segmentPattern.test(repository)) return false;
  if (tagSeparator >= 0 && !segmentPattern.test(tag)) return false;
  return parts.every((part) => segmentPattern.test(part));
}

function officialDestination(key) {
  return OFFICIAL_DESTINATIONS[String(key || "")] || null;
}

function safeText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/[\x00-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function safeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(Number.MAX_SAFE_INTEGER, Math.floor(number));
}

function normalizeTagsResponse(payload, options = {}) {
  const selectedModel = validateModelTag(options.selectedModel) ? options.selectedModel : "";
  const effectiveModel = validateModelTag(options.effectiveModel) ? options.effectiveModel : "";
  const rawModels = Array.isArray(payload?.models) ? payload.models : [];
  const seen = new Set();
  const models = [];

  for (const item of rawModels) {
    if (!item || typeof item !== "object") continue;
    const nameCandidate = typeof item.name === "string" && item.name ? item.name : item.model;
    if (!validateModelTag(nameCandidate) || seen.has(nameCandidate)) continue;
    seen.add(nameCandidate);

    const details = item.details && typeof item.details === "object" ? item.details : {};
    const families = Array.isArray(details.families)
      ? details.families.map((family) => safeText(family, 80)).filter(Boolean).slice(0, 16)
      : [];

    models.push({
      name: nameCandidate,
      modifiedAt: safeText(item.modified_at, 80),
      size: safeInteger(item.size),
      digest: safeText(item.digest, 180),
      details: {
        parentModel: safeText(details.parent_model, 200),
        format: safeText(details.format, 80),
        family: safeText(details.family, 80),
        families,
        parameterSize: safeText(details.parameter_size, 80),
        quantizationLevel: safeText(details.quantization_level, 80),
      },
      selected: nameCandidate === selectedModel,
      effective: nameCandidate === effectiveModel,
    });

    if (models.length >= MAX_MODELS) break;
  }

  return models.sort((left, right) => left.name.localeCompare(right.name, "en"));
}

function resolveLoopbackOrigin(config = {}) {
  const configured = config.ollamaBaseUrl || (config.provider === "ollama" || !config.provider ? config.baseUrl : "");
  const raw = String(configured || DEFAULT_OLLAMA_ORIGIN);

  try {
    const url = new URL(raw);
    const hostname = url.hostname.toLowerCase();
    const isLoopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    const cleanPath = url.pathname === "" || url.pathname === "/";
    if (!isLoopback || url.protocol !== "http:" || url.username || url.password || !cleanPath || url.search || url.hash) {
      return null;
    }
    return url.origin;
  } catch (_error) {
    return null;
  }
}

function resolveEffectiveModel(models, desiredModel) {
  if (!validateModelTag(desiredModel)) return "";
  if (models.some((item) => item.name === desiredModel)) return desiredModel;
  const familyMatches = models.filter((item) => item.name.startsWith(`${desiredModel}:`));
  if (familyMatches.length === 1) return familyMatches[0].name;
  return "";
}

function errorCodeForFetch(error, controller) {
  if (controller?.signal?.aborted || error?.name === "AbortError") return "OLLAMA_TIMEOUT";
  return "OLLAMA_UNREACHABLE";
}

function createLocalModelManager({
  fetchImpl = globalThis.fetch,
  getSelectedModel,
  setSelectedModel,
  getConfig,
  onProgress,
  detectExecutable,
} = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("fetchImpl must be a function");

  let inMemorySelectedModel = "";
  let activePullController = null;

  async function readManagerState() {
    let config = {};
    try {
      const result = typeof getConfig === "function" ? await getConfig() : {};
      config = result && typeof result === "object" ? result : {};
    } catch (_error) {
      config = {};
    }

    let selectedModel = inMemorySelectedModel;
    try {
      if (typeof getSelectedModel === "function") selectedModel = await getSelectedModel();
    } catch (_error) {
      selectedModel = inMemorySelectedModel;
    }
    selectedModel = validateModelTag(selectedModel) ? selectedModel : "";

    const processEnvironmentModel = validateModelTag(process.env.HEYU_LLM_MODEL)
      ? process.env.HEYU_LLM_MODEL
      : "";
    const configuredEnvironmentModel = validateModelTag(config.environmentModel) ? config.environmentModel : "";
    const lockedByEnvironment = Boolean(
      processEnvironmentModel ||
      configuredEnvironmentModel ||
      config.lockedByEnvironment === true ||
      config.modelSource === "environment"
    );
    const configuredModel = validateModelTag(config.model) ? config.model : "";
    const desiredModel = lockedByEnvironment
      ? processEnvironmentModel || configuredEnvironmentModel || configuredModel
      : selectedModel || configuredModel;

    return {
      config,
      origin: resolveLoopbackOrigin(config),
      selectedModel,
      desiredModel,
      lockedByEnvironment,
    };
  }

  async function executableInstalled() {
    if (typeof detectExecutable !== "function") return false;
    try {
      const result = await detectExecutable();
      return result === true || result?.installed === true;
    } catch (_error) {
      return false;
    }
  }

  function listResult(state, overrides = {}) {
    return {
      ok: false,
      serverReachable: false,
      engineInstalled: false,
      selectedModel: state?.selectedModel || "",
      effectiveModel: state?.desiredModel || "",
      lockedByEnvironment: Boolean(state?.lockedByEnvironment),
      models: [],
      errorCode: "OLLAMA_UNREACHABLE",
      ...overrides,
    };
  }

  async function list() {
    const state = await readManagerState();
    if (!state.origin) {
      return listResult(state, {
        engineInstalled: await executableInstalled(),
        errorCode: "UNSAFE_OLLAMA_BASE_URL",
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), LIST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(`${state.origin}/api/tags`, {
        method: "GET",
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeout);
      return listResult(state, {
        engineInstalled: await executableInstalled(),
        errorCode: errorCodeForFetch(error, controller),
      });
    }
    clearTimeout(timeout);

    if (!response || typeof response !== "object") {
      return listResult(state, {
        engineInstalled: true,
        errorCode: "INVALID_TAGS_RESPONSE",
      });
    }
    if (!response.ok) {
      return listResult(state, {
        serverReachable: true,
        engineInstalled: true,
        errorCode: "OLLAMA_HTTP_ERROR",
      });
    }

    let payload;
    try {
      payload = await response.json();
    } catch (_error) {
      return listResult(state, {
        serverReachable: true,
        engineInstalled: true,
        errorCode: "INVALID_TAGS_RESPONSE",
      });
    }

    if (!payload || typeof payload !== "object" || !Array.isArray(payload.models)) {
      return listResult(state, {
        serverReachable: true,
        engineInstalled: true,
        errorCode: "INVALID_TAGS_RESPONSE",
      });
    }

    const preliminaryModels = normalizeTagsResponse(payload, {
      selectedModel: state.selectedModel,
      effectiveModel: state.desiredModel,
    });
    const effectiveModel = resolveEffectiveModel(preliminaryModels, state.desiredModel);
    const models = normalizeTagsResponse(payload, {
      selectedModel: state.selectedModel,
      effectiveModel,
    });

    return listResult(state, {
      ok: true,
      serverReachable: true,
      engineInstalled: true,
      effectiveModel,
      models,
      errorCode: "",
    });
  }

  async function select(name) {
    if (!validateModelTag(name)) {
      const state = await readManagerState();
      return listResult(state, { errorCode: "INVALID_MODEL_TAG" });
    }

    const catalog = await list();
    if (!catalog.ok) return catalog;
    if (catalog.lockedByEnvironment) {
      return { ...catalog, ok: false, errorCode: "MODEL_SELECTION_LOCKED" };
    }
    if (!catalog.models.some((model) => model.name === name)) {
      return { ...catalog, ok: false, errorCode: "MODEL_NOT_INSTALLED" };
    }

    try {
      if (typeof setSelectedModel === "function") await setSelectedModel(name);
      inMemorySelectedModel = name;
    } catch (_error) {
      return { ...catalog, ok: false, errorCode: "MODEL_SELECTION_SAVE_FAILED" };
    }

    return {
      ...catalog,
      ok: true,
      selectedModel: name,
      effectiveModel: name,
      models: catalog.models.map((model) => ({
        ...model,
        selected: model.name === name,
        effective: model.name === name,
      })),
      errorCode: "",
    };
  }

  function normalizeProgressRecord(record, model) {
    if (!record || typeof record !== "object") return null;
    const status = safeText(record.status, 120);
    const total = safeInteger(record.total);
    const completed = Math.min(total || Number.MAX_SAFE_INTEGER, safeInteger(record.completed));
    const percent = total > 0 ? Math.min(100, Math.max(0, Math.round((completed / total) * 100))) : null;
    return {
      model,
      status,
      digest: safeText(record.digest, 180),
      total,
      completed,
      percent,
      done: status.toLowerCase() === "success",
    };
  }

  function emitProgress(event, perPullProgress) {
    for (const callback of new Set([onProgress, perPullProgress])) {
      if (typeof callback !== "function") continue;
      try {
        callback(event);
      } catch (_error) {
        // Progress observers cannot interrupt a local model download.
      }
    }
  }

  async function readPullRecords(response, handleRecord) {
    if (response.body && typeof response.body.getReader === "function") {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let record;
          try {
            record = JSON.parse(line);
          } catch (_error) {
            return false;
          }
          if (handleRecord(record) === false) return false;
        }
        if (done) break;
      }
      if (buffer.trim()) {
        try {
          if (handleRecord(JSON.parse(buffer)) === false) return false;
        } catch (_error) {
          return false;
        }
      }
      return true;
    }

    let text;
    try {
      text = await response.text();
    } catch (_error) {
      return false;
    }
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        if (handleRecord(JSON.parse(line)) === false) return false;
      } catch (_error) {
        return false;
      }
    }
    return true;
  }

  async function pull(name, options = {}) {
    if (!validateModelTag(name)) {
      return { ok: false, model: "", canceled: false, errorCode: "INVALID_MODEL_TAG" };
    }
    if (activePullController) {
      return { ok: false, model: name, canceled: false, errorCode: "PULL_IN_PROGRESS" };
    }

    const state = await readManagerState();
    if (!state.origin) {
      return { ok: false, model: name, canceled: false, errorCode: "UNSAFE_OLLAMA_BASE_URL" };
    }

    const controller = new AbortController();
    activePullController = controller;
    emitProgress(
      {
        model: name,
        status: "Ollama에 다운로드 요청 전달 중",
        digest: "",
        total: 0,
        completed: 0,
        percent: 0,
        done: false,
      },
      options.onProgress
    );
    let response;
    try {
      response = await fetchImpl(`${state.origin}/api/pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name, stream: true }),
        signal: controller.signal,
      });

      if (!response?.ok) {
        return { ok: false, model: name, canceled: false, errorCode: "PULL_HTTP_ERROR" };
      }

      let succeeded = false;
      let remoteError = false;
      const parsed = await readPullRecords(response, (record) => {
        if (record && typeof record === "object" && record.error) {
          remoteError = true;
          return false;
        }
        const progress = normalizeProgressRecord(record, name);
        if (!progress) return false;
        emitProgress(progress, options.onProgress);
        if (progress.done) succeeded = true;
        return true;
      });

      if (remoteError) {
        return { ok: false, model: name, canceled: false, errorCode: "PULL_REMOTE_ERROR" };
      }
      if (!parsed) {
        return { ok: false, model: name, canceled: false, errorCode: "PULL_INVALID_RESPONSE" };
      }
      if (!succeeded) {
        return { ok: false, model: name, canceled: false, errorCode: "PULL_INCOMPLETE" };
      }

      const catalog = await list();
      return {
        ok: true,
        model: name,
        canceled: false,
        errorCode: catalog.ok ? "" : "PULL_SUCCEEDED_REFRESH_FAILED",
        canSelect: catalog.models.some((model) => model.name === name),
        catalog,
      };
    } catch (error) {
      const canceled = controller.signal.aborted || error?.name === "AbortError";
      return {
        ok: false,
        model: name,
        canceled,
        errorCode: canceled ? "PULL_CANCELED" : "PULL_FAILED",
      };
    } finally {
      if (activePullController === controller) activePullController = null;
    }
  }

  function cancelPull() {
    if (!activePullController) return { ok: true, canceled: false };
    activePullController.abort();
    return { ok: true, canceled: true };
  }

  return {
    list,
    select,
    pull,
    cancelPull,
  };
}

module.exports = {
  createLocalModelManager,
  normalizeTagsResponse,
  officialDestination,
  validateModelTag,
};
