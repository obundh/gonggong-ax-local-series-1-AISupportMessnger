const DATA = window.HEYU_DATA;

const state = {
  view: "friends",
  friendTab: "all",
  chatFilter: "all",
  fileFilter: "all",
  search: "",
  llmStatus: "offline",
  llmModel: "",
  llmStatusText: "로컬 LLM 연결 확인 전입니다.",
  localModels: {
    ok: false,
    serverReachable: false,
    engineInstalled: null,
    selectedModel: "",
    effectiveModel: "",
    lockedByEnvironment: false,
    models: [],
    errorCode: "",
  },
  modelPicker: {
    open: false,
    loading: false,
    actionBusy: false,
    choice: "",
    pullInput: "",
    actionError: "",
    pull: {
      active: false,
      name: "",
      status: "",
      completed: 0,
      total: 0,
      percent: 0,
      error: "",
    },
  },
  isCheckingAttendance: false,
  isIndexingWorkspace: false,
  workspace: null,
  chatSummaries: {},
  appSettings: {
    replyDoneNotifications: true,
    limits: {
      graphFileMb: 30,
      converterFileMb: 200,
      converterPdfTotalMb: 300,
      converterImageMegapixels: 80,
      sttAudioMb: 120,
      generatedFileMb: 15,
    },
    routineSafety: {
      allowFileOpen: false,
      allowProgramLaunch: false,
    },
  },
};

const viewRoot = document.querySelector("#viewRoot");
const modalLayer = document.querySelector("#modalLayer");
const toast = document.querySelector("#toast");
const mainApp = document.querySelector("#mainApp");
const bootScreen = document.querySelector("#bootScreen");
const bootPowerButton = document.querySelector("#bootPowerButton");
const bootStatusText = document.querySelector("#bootStatusText");
let modelPickerTrigger = null;

function createIcons() {
  bindAvatarFallbacks();
  if (window.lucide) {
    window.lucide.createIcons({
      attrs: {
        "stroke-width": 2,
      },
    });
  }
}

function bindAvatarFallbacks() {
  document.querySelectorAll("img[data-avatar-fallback]").forEach((image) => {
    if (image.dataset.avatarFallbackBound === "true") return;
    image.dataset.avatarFallbackBound = "true";
    image.addEventListener("error", () => {
      if (!image.dataset.avatarFallback || image.dataset.avatarFallbackApplied === "true") return;
      image.dataset.avatarFallbackApplied = "true";
      image.src = image.dataset.avatarFallback;
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizedStatus(item) {
  if (item?.status === "offline") return "offline";
  if (item?.status === "away") return "away";
  return "online";
}

function statusLabel(item) {
  const status = normalizedStatus(item);
  if (status === "offline") return "오프라인";
  if (status === "away") return "자리비움";
  return "온라인";
}

function statusClass(item) {
  const status = normalizedStatus(item);
  return status === "online" ? "" : `is-${status}`;
}

function runtimeModelBadge() {
  const model = state.localModels.effectiveModel || state.localModels.selectedModel || state.llmModel;
  const runtimeReady = Boolean(model) && (state.llmStatus === "online" || state.localModels.serverReachable);
  const statusClassName = runtimeReady ? "" : " is-offline";
  const label = model ? `Ollama · ${model}` : "로컬 LLM 설정";
  const title = model
    ? `${label} — 눌러서 모델 변경`
    : "눌러서 Ollama 설치 및 로컬 모델을 설정하세요.";
  return `
    <button class="runtime-model-badge${statusClassName}" type="button" data-model-picker-open aria-haspopup="dialog" aria-expanded="${state.modelPicker.open ? "true" : "false"}" title="${escapeHtml(title)}">
      <i data-lucide="cpu"></i>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function syncBootModelButton() {
  const button = document.querySelector("#bootModelPickerButton");
  const label = document.querySelector("#bootModelPickerLabel");
  if (!button || !label) return;
  const model = state.localModels.effectiveModel || state.localModels.selectedModel || state.llmModel;
  const ready = Boolean(model) && (state.localModels.serverReachable || state.llmStatus === "online");
  label.textContent = model ? `모델: ${model} · 변경/다운로드` : "모델 선택 · 새 모델 받기";
  button.classList.toggle("is-offline", !ready);
  button.title = model ? `${model} 사용 중 — 눌러서 변경하거나 새 모델 받기` : "설치된 모델을 선택하거나 새 모델을 받습니다.";
}

function formatModelBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "크기 정보 없음";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const amount = bytes / 1024 ** unitIndex;
  return `${amount >= 10 || unitIndex === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unitIndex]}`;
}

function formatModelDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "short", day: "numeric" }).format(date);
}

function normalizedLocalModels(result = {}) {
  const models = (Array.isArray(result.models) ? result.models : [])
    .filter((model) => model && typeof model.name === "string" && model.name.trim())
    .map((model) => ({
      name: model.name.trim().slice(0, 200),
      size: Number(model.size) || 0,
      modifiedAt: String(model.modifiedAt || "").slice(0, 80),
      details: {
        parameterSize: String(model.details?.parameterSize || "").slice(0, 80),
        quantizationLevel: String(model.details?.quantizationLevel || "").slice(0, 80),
        family: String(model.details?.family || "").slice(0, 80),
      },
    }));
  return {
    ok: Boolean(result.ok),
    serverReachable: Boolean(result.serverReachable),
    engineInstalled: typeof result.engineInstalled === "boolean" ? result.engineInstalled : null,
    selectedModel: String(result.selectedModel || "").trim().slice(0, 200),
    effectiveModel: String(result.effectiveModel || "").trim().slice(0, 200),
    lockedByEnvironment: Boolean(result.lockedByEnvironment),
    models,
    errorCode: String(result.errorCode || "").slice(0, 80),
  };
}

function localModelErrorText(code, fallback = "") {
  const messages = {
    DESKTOP_API_UNAVAILABLE: "데스크톱 앱에서만 로컬 LLM을 설정할 수 있습니다.",
    OLLAMA_NOT_FOUND: "Ollama가 설치되어 있지 않거나 실행 파일을 찾지 못했습니다.",
    OLLAMA_OFFLINE: "Ollama에 연결할 수 없습니다. Ollama를 실행한 뒤 다시 확인하세요.",
    SERVER_UNREACHABLE: "Ollama에 연결할 수 없습니다. Ollama를 실행한 뒤 다시 확인하세요.",
    OLLAMA_UNREACHABLE: "Ollama에 연결할 수 없습니다. Ollama를 실행한 뒤 다시 확인하세요.",
    OLLAMA_TIMEOUT: "Ollama 응답 시간이 초과되었습니다. 실행 상태를 확인한 뒤 다시 시도하세요.",
    UNSAFE_OLLAMA_BASE_URL: "보호를 위해 로컬 주소가 아닌 Ollama 연결은 차단했습니다.",
    OLLAMA_HTTP_ERROR: "Ollama가 모델 목록 요청을 처리하지 못했습니다.",
    INVALID_TAGS_RESPONSE: "Ollama 모델 목록 응답을 읽지 못했습니다.",
    NO_MODELS: "설치된 로컬 모델이 없습니다.",
    MODEL_NOT_FOUND: "선택한 모델이 현재 컴퓨터에 없습니다. 목록을 새로고침하세요.",
    MODEL_NOT_INSTALLED: "선택한 모델이 현재 컴퓨터에 없습니다. 목록을 새로고침하세요.",
    ENV_MODEL_LOCKED: "환경 변수로 모델이 고정되어 있어 앱에서 변경할 수 없습니다.",
    MODEL_SELECTION_LOCKED: "환경 변수로 모델이 고정되어 있어 앱에서 변경할 수 없습니다.",
    INVALID_MODEL_NAME: "모델 태그 형식을 확인하세요.",
    INVALID_MODEL_TAG: "모델 태그 형식을 확인하세요.",
    MODEL_SELECTION_SAVE_FAILED: "선택한 모델 설정을 저장하지 못했습니다.",
    PULL_IN_PROGRESS: "다른 모델을 다운로드하고 있습니다. 완료하거나 취소한 뒤 다시 시도하세요.",
    PULL_HTTP_ERROR: "Ollama가 모델 다운로드 요청을 처리하지 못했습니다.",
    PULL_REMOTE_ERROR: "모델 제공 서버가 다운로드 오류를 반환했습니다.",
    PULL_INVALID_RESPONSE: "모델 다운로드 응답을 읽지 못했습니다.",
    PULL_INCOMPLETE: "모델 다운로드가 완료되지 않았습니다.",
    PULL_CANCELED: "모델 다운로드를 취소했습니다.",
    PULL_FAILED: "모델 다운로드에 실패했습니다.",
  };
  return messages[String(code || "")] || fallback || "로컬 LLM 요청을 처리하지 못했습니다.";
}

function modelMetadata(model) {
  const details = [model.details?.parameterSize, model.details?.quantizationLevel, model.details?.family].filter(Boolean);
  const date = formatModelDate(model.modifiedAt);
  if (date) details.push(date);
  return details.join(" · ") || "Ollama 로컬 모델";
}

function modelOptionsMarkup() {
  const catalog = state.localModels;
  const picker = state.modelPicker;
  if (!catalog.models.length) {
    return `
      <div class="model-empty-state is-compact">
        <i data-lucide="package-open"></i>
        <div>
          <strong>설치된 모델이 없습니다.</strong>
          <p>아래에서 모델 태그를 입력해 이 컴퓨터에 다운로드하세요.</p>
        </div>
      </div>
    `;
  }

  return `
    <fieldset class="model-list" id="modelList" ${catalog.lockedByEnvironment || picker.actionBusy ? "disabled" : ""}>
      <legend class="sr-only">설치된 로컬 모델</legend>
      ${catalog.models
        .map((model) => {
          const checked = picker.choice === model.name;
          const current = catalog.effectiveModel === model.name;
          return `
            <label class="model-option${checked ? " is-selected" : ""}">
              <input type="radio" name="localModel" value="${escapeHtml(model.name)}" ${checked ? "checked" : ""} />
              <span class="model-option-copy">
                <strong>${escapeHtml(model.name)}</strong>
                <small>${escapeHtml(modelMetadata(model))}</small>
              </span>
              <span class="model-option-side">
                ${current ? '<em>사용 중</em>' : ""}
                <small>${escapeHtml(formatModelBytes(model.size))}</small>
              </span>
            </label>
          `;
        })
        .join("")}
    </fieldset>
    ${
      catalog.lockedByEnvironment
        ? '<p class="model-picker-notice"><i data-lucide="lock-keyhole"></i><span>환경 변수로 모델이 고정되어 있습니다. 환경 설정을 바꾸기 전에는 앱에서 선택할 수 없습니다.</span></p>'
        : ""
    }
    <div class="model-picker-selection-actions">
      <span>${picker.choice ? `선택: ${escapeHtml(picker.choice)}` : "사용할 모델을 선택하세요."}</span>
      <button class="primary-button" type="button" data-model-use ${
        !picker.choice || catalog.lockedByEnvironment || picker.actionBusy || picker.choice === catalog.effectiveModel ? "disabled" : ""
      }>${picker.actionBusy ? "적용 중…" : picker.choice === catalog.effectiveModel ? "사용 중" : "이 모델 사용"}</button>
    </div>
  `;
}

function modelPullMarkup() {
  const pull = state.modelPicker.pull;
  const disabled = pull.active ? "disabled" : "";
  const progressValue = Math.max(0, Math.min(100, Number(pull.percent) || 0));
  return `
    <section class="model-pull-section" aria-labelledby="modelPullTitle">
      <header>
        <div>
          <h3 id="modelPullTitle">새 모델 받기</h3>
          <p>모델 라이브러리에서 정확한 태그를 확인한 뒤 입력하세요.</p>
        </div>
        <button class="text-button" type="button" data-official-link="ollama-library">
          모델 라이브러리 <i data-lucide="external-link"></i>
        </button>
      </header>
      <form class="model-pull-form" id="modelPullForm">
        <label for="modelPullInput" class="sr-only">다운로드할 Ollama 모델 태그</label>
        <input id="modelPullInput" type="text" maxlength="200" autocomplete="off" spellcheck="false" placeholder="예: gemma4:12b-it-q4_K_M" value="${escapeHtml(
          state.modelPicker.pullInput
        )}" ${disabled} />
        <button class="outline-button" type="submit" data-model-pull ${disabled || !state.modelPicker.pullInput.trim() ? "disabled" : ""}>
          <i data-lucide="download"></i> 다운로드
        </button>
      </form>
      ${
        pull.active
          ? `
            <div class="model-pull-progress" aria-live="polite">
              <div>
                <strong id="modelPullStatus">${escapeHtml(pull.status || "다운로드 준비 중")}</strong>
                <span id="modelPullBytes">${escapeHtml(modelPullBytesText(pull))}</span>
              </div>
              <progress id="modelPullProgress" max="100" value="${progressValue}">${progressValue}%</progress>
              <button class="text-button" type="button" data-model-pull-cancel>취소</button>
            </div>
          `
          : pull.error
            ? `<p class="model-picker-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(pull.error)}</span></p>`
            : pull.status
              ? `<p class="model-picker-success" role="status"><i data-lucide="circle-check"></i><span>${escapeHtml(pull.status)}</span></p>`
              : ""
      }
    </section>
  `;
}

function modelPullBytesText(pull) {
  if (pull.total > 0) return `${formatModelBytes(pull.completed)} / ${formatModelBytes(pull.total)} · ${Math.round(pull.percent || 0)}%`;
  if (pull.completed > 0) return formatModelBytes(pull.completed);
  return pull.name || "준비 중";
}

function modelCatalogMarkup() {
  const catalog = state.localModels;
  const picker = state.modelPicker;
  if (picker.loading) {
    return `
      <div class="model-empty-state" role="status">
        <i class="is-spinning" data-lucide="loader-circle"></i>
        <div><strong>이 컴퓨터의 로컬 모델을 확인하고 있습니다.</strong><p>Ollama 연결과 설치된 모델 목록을 읽는 중입니다.</p></div>
      </div>
    `;
  }

  if (!catalog.serverReachable) {
    const heading = catalog.engineInstalled === false ? "Ollama를 찾지 못했습니다." : "Ollama에 연결할 수 없습니다.";
    const description = catalog.engineInstalled === false
      ? "이미 설치했다면 Ollama를 실행하고 다시 확인하세요. 아직 없다면 공식 설치 페이지에서 운영체제에 맞게 설치할 수 있습니다."
      : "Ollama를 실행한 뒤 다시 확인하세요. 설치 여부가 확실하지 않다면 공식 설치 페이지를 이용할 수 있습니다.";
    return `
      <div class="model-empty-state is-warning">
        <i data-lucide="unplug"></i>
        <div><strong>${escapeHtml(heading)}</strong><p>${escapeHtml(description)}</p></div>
      </div>
      <div class="model-empty-actions">
        <button class="primary-button" type="button" data-official-link="ollama-download"><i data-lucide="external-link"></i> 공식 설치 페이지</button>
        <button class="outline-button" type="button" data-official-link="ollama-library">모델 라이브러리</button>
      </div>
    `;
  }

  return `
    <section class="model-installed-section" aria-labelledby="installedModelsTitle">
      <div class="model-section-heading">
        <div>
          <h3 id="installedModelsTitle">설치된 모델</h3>
          <p>${catalog.models.length}개 · 이 컴퓨터에서 확인된 목록입니다.</p>
        </div>
      </div>
      ${modelOptionsMarkup()}
    </section>
    ${modelPullMarkup()}
  `;
}

function renderModelPicker({ focus = false } = {}) {
  if (!modalLayer || !state.modelPicker.open) return;
  const catalog = state.localModels;
  const connectionLabel = state.modelPicker.loading
    ? "확인 중"
    : catalog.serverReachable
      ? "Ollama 연결됨"
      : catalog.engineInstalled === false
        ? "찾지 못함"
        : "연결 안 됨";
  modalLayer.innerHTML = `
    <section class="modal-card model-picker" role="dialog" aria-modal="true" aria-labelledby="modelPickerTitle" aria-describedby="modelPickerDescription" tabindex="-1">
      <header class="model-picker-header">
        <div>
          <span class="model-picker-kicker">LOCAL AI</span>
          <h2 id="modelPickerTitle">로컬 LLM 선택</h2>
          <p id="modelPickerDescription">현재 컴퓨터의 Ollama 모델을 선택하거나 새 모델을 받을 수 있습니다.</p>
        </div>
        <button class="icon-button model-picker-close" type="button" data-model-close aria-label="닫기"><i data-lucide="x"></i></button>
      </header>
      <div class="model-picker-toolbar">
        <span class="model-engine-state${catalog.serverReachable ? " is-online" : ""}"><i data-lucide="${catalog.serverReachable ? "circle-check" : "circle-dashed"}"></i>${escapeHtml(
          connectionLabel
        )}</span>
        <span class="sr-only" id="modelPickerStatus" role="status" aria-live="polite">${escapeHtml(connectionLabel)}</span>
        <button class="outline-button model-refresh-button" type="button" data-model-refresh ${state.modelPicker.loading ? "disabled" : ""}>
          <i data-lucide="refresh-cw"></i> 새로고침
        </button>
      </div>
      <div class="model-picker-body">
        ${modelCatalogMarkup()}
        ${
          state.modelPicker.actionError
            ? `<p class="model-picker-error" role="alert"><i data-lucide="circle-alert"></i><span>${escapeHtml(state.modelPicker.actionError)}</span></p>`
            : ""
        }
      </div>
    </section>
  `;
  bindModelPickerEvents();
  createIcons();
  if (focus) {
    window.requestAnimationFrame(() => modalLayer.querySelector(".model-picker")?.focus({ preventScroll: true }));
  }
}

function bindModelPickerEvents() {
  modalLayer.querySelector("[data-model-close]")?.addEventListener("click", closeModelPicker);
  modalLayer.querySelector("[data-model-refresh]")?.addEventListener("click", () => void refreshLocalModels({ focusPicker: true }));
  modalLayer.querySelectorAll("[data-official-link]").forEach((button) => {
    button.addEventListener("click", () => void openOfficialModelLink(button.dataset.officialLink));
  });
  modalLayer.querySelectorAll('input[name="localModel"]').forEach((input) => {
    input.addEventListener("change", () => {
      state.modelPicker.choice = input.value;
      modalLayer.querySelectorAll(".model-option").forEach((option) => option.classList.toggle("is-selected", option.contains(input)));
      const useButton = modalLayer.querySelector("[data-model-use]");
      if (useButton) {
        const isCurrent = input.value === state.localModels.effectiveModel;
        useButton.disabled = state.localModels.lockedByEnvironment || isCurrent;
        useButton.textContent = isCurrent ? "사용 중" : "이 모델 사용";
      }
      const selectionText = modalLayer.querySelector(".model-picker-selection-actions > span");
      if (selectionText) selectionText.textContent = `선택: ${input.value}`;
    });
  });
  modalLayer.querySelector("[data-model-use]")?.addEventListener("click", () => void selectChosenLocalModel());
  const pullInput = modalLayer.querySelector("#modelPullInput");
  pullInput?.addEventListener("input", () => {
    state.modelPicker.pullInput = pullInput.value;
    const pullButton = modalLayer.querySelector("[data-model-pull]");
    if (pullButton) pullButton.disabled = !pullInput.value.trim();
  });
  modalLayer.querySelector("#modelPullForm")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const submittedName = String(modalLayer.querySelector("#modelPullInput")?.value || "").trim();
    state.modelPicker.pullInput = submittedName;
    void pullRequestedLocalModel(submittedName);
  });
  modalLayer.querySelector("[data-model-pull-cancel]")?.addEventListener("click", () => void cancelLocalModelPull());
}

async function openModelPicker(trigger) {
  if (!modalLayer) return;
  modelPickerTrigger = trigger || document.activeElement;
  state.modelPicker.open = true;
  state.modelPicker.actionError = "";
  modalLayer.hidden = false;
  document.querySelectorAll("[data-model-picker-open]").forEach((button) => button.setAttribute("aria-expanded", "true"));
  renderModelPicker({ focus: true });
  await refreshLocalModels({ focusPicker: true });
}

function closeModelPicker() {
  if (!modalLayer || !state.modelPicker.open) return;
  state.modelPicker.open = false;
  modalLayer.hidden = true;
  modalLayer.innerHTML = "";
  document.querySelectorAll("[data-model-picker-open]").forEach((button) => button.setAttribute("aria-expanded", "false"));
  const fallbackTrigger = document.querySelector("[data-model-picker-open]");
  const target = modelPickerTrigger?.isConnected ? modelPickerTrigger : fallbackTrigger;
  modelPickerTrigger = null;
  target?.focus?.({ preventScroll: true });
}

function trapModelPickerFocus(event) {
  if (!state.modelPicker.open || event.key !== "Tab" || !modalLayer) return;
  const focusable = [...modalLayer.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(
    (item) => !item.hidden && !item.disabled && item.getClientRects().length > 0
  );
  if (!focusable.length) {
    event.preventDefault();
    modalLayer.querySelector(".model-picker")?.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!focusable.includes(document.activeElement)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function refreshLocalModels({ focusPicker = false } = {}) {
  state.modelPicker.loading = true;
  state.modelPicker.actionError = "";
  if (state.modelPicker.open) renderModelPicker({ focus: focusPicker });
  if (!window.desktopAPI?.listLocalModels) {
    state.localModels = normalizedLocalModels({ errorCode: "DESKTOP_API_UNAVAILABLE" });
    state.modelPicker.loading = false;
    state.llmModel = "";
    if (mainApp && !mainApp.hidden) render();
    if (state.modelPicker.open) renderModelPicker({ focus: true });
    return state.localModels;
  }

  try {
    const result = await window.desktopAPI.listLocalModels();
    state.localModels = normalizedLocalModels(result);
    const availableNames = new Set(state.localModels.models.map((model) => model.name));
    const preferred = state.localModels.effectiveModel || state.localModels.selectedModel;
    if (!availableNames.has(state.modelPicker.choice)) {
      state.modelPicker.choice = availableNames.has(preferred) ? preferred : state.localModels.models[0]?.name || "";
    }
    state.llmModel = preferred || "";
    if (!state.localModels.serverReachable) state.llmStatus = "offline";
  } catch (error) {
    state.localModels = normalizedLocalModels({ errorCode: "SERVER_UNREACHABLE" });
    state.modelPicker.actionError = localModelErrorText("SERVER_UNREACHABLE", error?.message || String(error));
    state.llmModel = "";
    state.llmStatus = "offline";
  } finally {
    state.modelPicker.loading = false;
    syncBootModelButton();
    if (mainApp && !mainApp.hidden) render();
    if (state.modelPicker.open) renderModelPicker({ focus: true });
  }
  return state.localModels;
}

async function selectChosenLocalModel() {
  const name = state.modelPicker.choice;
  if (!name || !state.localModels.models.some((model) => model.name === name)) {
    state.modelPicker.actionError = localModelErrorText("MODEL_NOT_FOUND");
    renderModelPicker({ focus: true });
    return;
  }
  if (state.localModels.lockedByEnvironment) {
    state.modelPicker.actionError = localModelErrorText("ENV_MODEL_LOCKED");
    renderModelPicker({ focus: true });
    return;
  }
  if (!window.desktopAPI?.selectLocalModel) {
    state.modelPicker.actionError = localModelErrorText("DESKTOP_API_UNAVAILABLE");
    renderModelPicker({ focus: true });
    return;
  }

  state.modelPicker.actionBusy = true;
  state.modelPicker.actionError = "";
  renderModelPicker({ focus: true });
  try {
    const result = await window.desktopAPI.selectLocalModel(name);
    if (!result?.ok) throw new Error(localModelErrorText(result?.errorCode));
    state.llmModel = String(result.effectiveModel || result.selectedModel || name);
    state.llmStatusText = `${state.llmModel} 모델을 사용합니다.`;
    state.modelPicker.actionBusy = false;
    showToast(`${state.llmModel} 모델을 선택했습니다.`);
    await refreshLocalModels({ focusPicker: true });
    void refreshLlmStatus();
  } catch (error) {
    state.modelPicker.actionBusy = false;
    state.modelPicker.actionError = error?.message || String(error);
    renderModelPicker({ focus: true });
  }
}

function isValidLocalModelTag(value) {
  if (!value || value.length > 200 || value !== value.trim() || /[\s\x00-\x1f\x7f]/.test(value)) return false;
  if (value.includes("..") || value.includes("\\") || value.includes("//")) return false;
  const parts = value.split("/");
  if (parts.some((part) => !part)) return false;
  const lastPart = parts[parts.length - 1];
  const tagSeparator = lastPart.indexOf(":");
  if (tagSeparator !== lastPart.lastIndexOf(":")) return false;
  const repository = tagSeparator >= 0 ? lastPart.slice(0, tagSeparator) : lastPart;
  const tag = tagSeparator >= 0 ? lastPart.slice(tagSeparator + 1) : "";
  const segmentPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;
  if (!segmentPattern.test(repository)) return false;
  if (tagSeparator >= 0 && !segmentPattern.test(tag)) return false;
  return parts.slice(0, -1).every((part) => segmentPattern.test(part));
}

async function pullRequestedLocalModel(requestedName = "") {
  const liveInput = String(modalLayer?.querySelector("#modelPullInput")?.value || "").trim();
  const name = String(requestedName || liveInput || state.modelPicker.pullInput || "").trim();
  state.modelPicker.pullInput = name;
  if (!isValidLocalModelTag(name)) {
    state.modelPicker.pull.error = localModelErrorText("INVALID_MODEL_NAME");
    state.modelPicker.pull.status = "";
    renderModelPicker({ focus: true });
    return;
  }
  if (!window.desktopAPI?.pullLocalModel) {
    state.modelPicker.pull.error = localModelErrorText("DESKTOP_API_UNAVAILABLE");
    renderModelPicker({ focus: true });
    return;
  }

  state.modelPicker.pull = { active: true, name, status: "다운로드 준비 중", completed: 0, total: 0, percent: 0, error: "" };
  renderModelPicker({ focus: true });
  try {
    const result = await window.desktopAPI.pullLocalModel(name);
    if (!result?.ok) {
      if (result?.canceled || result?.errorCode === "PULL_CANCELED") {
        state.modelPicker.pull.active = false;
        state.modelPicker.pull.status = localModelErrorText("PULL_CANCELED");
        state.modelPicker.pull.error = "";
        if (state.modelPicker.open) renderModelPicker({ focus: true });
        return;
      }
      throw new Error(localModelErrorText(result?.errorCode, result?.error));
    }
    if (result.started && result.done !== true) return;
    state.modelPicker.pull.active = false;
    state.modelPicker.pull.status = "다운로드가 완료되었습니다.";
    state.modelPicker.pullInput = "";
    showToast(`${name} 다운로드가 완료되었습니다.`);
    await refreshLocalModels({ focusPicker: true });
    if (state.localModels.models.some((model) => model.name === name)) state.modelPicker.choice = name;
    if (state.modelPicker.open) renderModelPicker({ focus: true });
  } catch (error) {
    state.modelPicker.pull.active = false;
    state.modelPicker.pull.status = "";
    state.modelPicker.pull.error = error?.message || String(error);
    renderModelPicker({ focus: true });
  }
}

async function cancelLocalModelPull() {
  if (!state.modelPicker.pull.active) return;
  try {
    await window.desktopAPI?.cancelLocalModelPull?.();
    state.modelPicker.pull.active = false;
    state.modelPicker.pull.status = "다운로드를 취소했습니다.";
    state.modelPicker.pull.error = "";
  } catch (error) {
    state.modelPicker.pull.error = error?.message || String(error);
  }
  renderModelPicker({ focus: true });
}

async function openOfficialModelLink(key) {
  if (!window.desktopAPI?.openOfficialLink) {
    showToast("데스크톱 앱에서만 공식 링크를 열 수 있습니다.");
    return;
  }
  try {
    const result = await window.desktopAPI.openOfficialLink(key);
    if (result?.ok === false) showToast("공식 페이지를 열지 못했습니다.");
  } catch (_error) {
    showToast("공식 페이지를 열지 못했습니다.");
  }
}

function updateModelPullProgress(payload = {}) {
  const pull = state.modelPicker.pull;
  const completed = Math.max(0, Number(payload.completed) || 0);
  const total = Math.max(0, Number(payload.total) || 0);
  let percent = Number(payload.percent);
  if (Number.isFinite(percent) && percent > 0 && percent <= 1) percent *= 100;
  if (!Number.isFinite(percent)) percent = total > 0 ? (completed / total) * 100 : pull.percent;
  pull.completed = completed;
  pull.total = total;
  pull.percent = Math.max(0, Math.min(100, percent || 0));
  pull.status = String(payload.status || pull.status || "다운로드 중").slice(0, 160);
  const failed = Boolean(payload.error);
  const done = Boolean(payload.done) || /^success$/i.test(String(payload.status || ""));
  const canceled = Boolean(payload.canceled || payload.cancelled);
  if (failed || done || canceled) {
    pull.active = false;
    pull.error = failed ? String(payload.error).slice(0, 240) : "";
    pull.status = canceled ? "다운로드를 취소했습니다." : done ? "다운로드가 완료되었습니다." : "";
    if (done) {
      state.modelPicker.pullInput = "";
      void refreshLocalModels({ focusPicker: false });
    } else if (state.modelPicker.open) {
      renderModelPicker({ focus: true });
    }
    return;
  }
  pull.active = true;
  const status = modalLayer?.querySelector("#modelPullStatus");
  const bytes = modalLayer?.querySelector("#modelPullBytes");
  const progress = modalLayer?.querySelector("#modelPullProgress");
  if (status) status.textContent = pull.status;
  if (bytes) bytes.textContent = modelPullBytesText(pull);
  if (progress) progress.value = pull.percent;
}

function handleLocalModelChanged(payload = {}) {
  const model = typeof payload === "string" ? payload : payload.effectiveModel || payload.selectedModel || payload.model || "";
  state.llmModel = String(model).slice(0, 200);
  state.localModels.effectiveModel = state.llmModel;
  syncBootModelButton();
  if (mainApp && !mainApp.hidden) render();
  void refreshLocalModels({ focusPicker: false });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1800);
}

async function loadAppSettings({ rerender = false } = {}) {
  if (!window.desktopAPI?.getAppSettings) return;
  try {
    const settings = await window.desktopAPI.getAppSettings();
    state.appSettings = {
      ...state.appSettings,
      ...(settings || {}),
    };
    if (rerender && state.view === "settings") renderSettings();
  } catch (_error) {
    // Settings are optional in non-desktop test environments.
  }
}

function setBootStatus(message) {
  if (bootStatusText) bootStatusText.textContent = message;
}

function setBootBusy(isBusy) {
  if (!bootPowerButton) return;
  bootPowerButton.disabled = isBusy;
  bootPowerButton.classList.toggle("is-loading", isBusy);
}

function showMainApp() {
  if (bootScreen) bootScreen.hidden = true;
  if (mainApp) mainApp.hidden = false;
  render();
}

function avatarMarkup(item, size = "md") {
  const profileAttr = item.id ? ` data-open-profile="${escapeHtml(item.id)}" role="button" tabindex="0"` : "";
  const statusModifier = statusClass(item);
  if (item.avatarImage) {
    const fallback = item.avatarFallback ? ` data-avatar-fallback="${escapeHtml(item.avatarFallback)}"` : "";
    return `
      <div class="avatar avatar-${size} avatar-image" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}" title="${escapeHtml(item.name || "")}"${profileAttr}>
        <img class="avatar-photo" src="${escapeHtml(item.avatarImage)}" alt=""${fallback} />
        ${item.status ? `<span class="status-dot ${statusModifier}"></span>` : ""}
      </div>
    `;
  }

  const label = item.avatar === "group" ? "users-round" : item.avatar === "human" || item.avatar === "human-female" ? "user-round" : "bot";
  return `
    <div class="avatar avatar-${size} avatar-${escapeHtml(item.avatar || "bot")}" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}"${profileAttr}>
      <i data-lucide="${label}"></i>
      ${item.status ? `<span class="status-dot ${statusModifier}"></span>` : ""}
    </div>
  `;
}

function tagMarkup(item) {
  return `<span class="tag tag-${escapeHtml(item.tagType || "plain")}">${escapeHtml(item.tag)}</span>`;
}

function isAiContact(item) {
  return item?.tagType === "ai";
}

function supportGroupLabel(item) {
  if (item?.supportGroup === "technical") return "기술지원";
  if (item?.supportGroup === "business") return "업무지원";
  return "";
}

function supportGroupDisplayRank(item) {
  const ranks = {
    chief: 10,
    "admin-officer": 20,
    language: 30,
    translator: 40,
    "steno-officer": 56,
    "privacy-officer": 57,
    "image-officer": 58,
    nori: 60,
    "file-converter": 135,
    "resource-officer": 140,
    "routine-officer": 150,
  };
  return ranks[item?.id] || 999;
}

function sortSupportContacts(contacts) {
  return [...contacts].sort((a, b) => supportGroupDisplayRank(a) - supportGroupDisplayRank(b));
}

function contactWithRuntimeStatus(item) {
  if (!isAiContact(item)) return item;
  if (item.forceOffline) {
    return {
      ...item,
      status: "offline",
    };
  }
  return {
    ...item,
    status: state.llmStatus === "online" ? "online" : normalizedStatus(item),
  };
}

function contactWithChatSummary(item) {
  const displayItem = contactWithRuntimeStatus(item);
  const summary = state.chatSummaries[item.id];
  if (!summary) return displayItem;

  return {
    ...displayItem,
    lastMessage: summary.lastMessage || displayItem.lastMessage,
    time: summary.time || displayItem.time,
    unread: typeof summary.unread === "number" ? summary.unread : displayItem.unread,
    hasSession: Boolean(summary.hasMessages),
    updatedAt: summary.updatedAt || 0,
  };
}

function firstAiContact() {
  return DATA.contacts.find((item) => isAiContact(item)) || DATA.contacts[0];
}

function openChat(id) {
  const contact = DATA.contacts.find((item) => item.id === id);
  if (!contact) return;
  if (window.desktopAPI?.openChat) {
    window.desktopAPI.openChat(id);
    return;
  }
  showToast("데스크톱 앱 실행 환경에서 사용할 수 있습니다.");
}

function openProfile(id) {
  const contact = DATA.contacts.find((item) => item.id === id);
  if (!contact) return;
  if (window.desktopAPI?.openProfile) {
    window.desktopAPI.openProfile(id);
    return;
  }
  showToast("데스크톱 앱 실행 환경에서 사용할 수 있습니다.");
}

function openContactConfig(id, mode) {
  const contact = DATA.contacts.find((item) => item.id === id);
  if (!contact) return;
  if (window.desktopAPI?.openContactConfig) {
    window.desktopAPI.openContactConfig(id, mode);
    return;
  }
  showToast("데스크톱 앱 실행 환경에서 사용할 수 있습니다.");
}

function baseHeader({ title = "AI지원담당", icon = true, actions = "" } = {}) {
  return `
    <header class="screen-header">
      <div class="brand-title">
        ${icon ? avatarMarkup({ avatar: "bot", color: "#fdf0a7" }, "brand") : ""}
        <h1>${escapeHtml(title)}</h1>
        ${runtimeModelBadge()}
      </div>
      <div class="header-actions">${actions}</div>
    </header>
  `;
}

function searchBar(placeholder) {
  return `
    <div class="search-box">
      <i data-lucide="search"></i>
      <input type="search" id="screenSearch" value="${escapeHtml(state.search)}" placeholder="${escapeHtml(placeholder)}" />
      <button class="icon-button" type="button" aria-label="필터">
        <i data-lucide="list-filter"></i>
      </button>
    </div>
  `;
}

function bindSearch() {
  const input = document.querySelector("#screenSearch");
  if (!input) return;
  input.addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });
  input.focus({ preventScroll: true });
  const length = input.value.length;
  input.setSelectionRange(length, length);
}

function filteredContacts() {
  const query = state.search.trim().toLowerCase();
  return DATA.contacts.filter((item) => {
    const haystack = `${item.name} ${item.department} ${item.description} ${item.tag} ${supportGroupLabel(item)}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (state.friendTab === "business") return item.supportGroup === "business";
    if (state.friendTab === "technical") return item.supportGroup === "technical";
    if (state.friendTab === "favorites") return item.favorite;
    return true;
  });
}

function contactRow(item, showMessage = false) {
  const displayItem = contactWithRuntimeStatus(item);
  const displayStatusLabel = statusLabel(displayItem);
  const displayStatusClass = statusClass(displayItem);
  return `
    <article class="person-row" data-open-chat="${escapeHtml(item.id)}" tabindex="0">
      ${avatarMarkup(displayItem)}
      <div class="row-main">
        <div class="row-title">
          <strong>${escapeHtml(displayItem.name)}</strong>
          ${tagMarkup(displayItem)}
        </div>
        <p>${escapeHtml(showMessage ? displayItem.lastMessage : displayItem.description)}</p>
      </div>
      <div class="row-meta">
        <span class="online-label ${displayStatusClass}">
          <span></span>
          ${displayStatusLabel}
        </span>
        ${
          item.favorite
            ? `<button class="tiny-icon is-starred" type="button" aria-label="즐겨찾기"><i data-lucide="star"></i></button>`
            : `<button class="tiny-icon" type="button" aria-label="더보기"><i data-lucide="ellipsis"></i></button>`
        }
      </div>
    </article>
  `;
}

function renderFriends() {
  const contacts = filteredContacts();
  const friendSections = renderFriendSections(contacts);
  const actions = "";

  viewRoot.innerHTML = `
    ${baseHeader({ title: "친구", icon: false, actions })}
    ${searchBar("이름 검색")}
    <div class="tabs" role="tablist" aria-label="친구 분류">
      ${tabButton("all", "전체", state.friendTab)}
      ${tabButton("business", "업무지원", state.friendTab)}
      ${tabButton("technical", "기술지원", state.friendTab)}
      ${tabButton("favorites", "즐겨찾기", state.friendTab)}
    </div>

    <div class="list-section">
      ${friendSections}
    </div>
    <p class="security-note"><i data-lucide="lock-keyhole"></i> 기본 설정은 로컬 서비스를 사용합니다. 실제 처리 위치는 LLM 및 도구 연결 설정을 확인하세요.</p>
  `;

  bindSearch();
  bindFriendEvents();
}

function renderFriendSections(contacts) {
  if (state.friendTab === "all") {
    const business = sortSupportContacts(contacts.filter((item) => item.supportGroup === "business"));
    const technical = sortSupportContacts(contacts.filter((item) => item.supportGroup === "technical"));
    const other = sortSupportContacts(contacts.filter((item) => item.supportGroup !== "business" && item.supportGroup !== "technical"));
    return [
      business.length
        ? `
          <h2>업무지원 ${business.length}</h2>
          <div class="person-list">${business.map((item) => contactRow(item)).join("")}</div>
        `
        : "",
      technical.length
        ? `
          <h2>기술지원 ${technical.length}</h2>
          <div class="person-list">${technical.map((item) => contactRow(item)).join("")}</div>
        `
        : "",
      other.length
        ? `
          <h2>기타 ${other.length}</h2>
          <div class="person-list">${other.map((item) => contactRow(item)).join("")}</div>
        `
        : "",
    ]
      .filter(Boolean)
      .join("");
  }

  const title = state.friendTab === "business" ? "업무지원" : state.friendTab === "technical" ? "기술지원" : "검색 결과";
  const sortedContacts = sortSupportContacts(contacts);
  return `
    <h2>${title} ${sortedContacts.length}</h2>
    <div class="person-list">${sortedContacts.map((item) => contactRow(item)).join("")}</div>
  `;
}

async function refreshLlmStatus({ showResult = false } = {}) {
  if (!window.desktopAPI?.checkOfficerStatus) {
    state.llmStatus = "offline";
    state.llmStatusText = "데스크톱 앱 실행 환경에서만 로컬 LLM 상태를 확인할 수 있습니다.";
    if (showResult) showToast("로컬 LLM 상태를 확인할 수 없습니다.");
    return;
  }

  try {
    const result = await window.desktopAPI.checkOfficerStatus();
    state.llmStatus = result.ok ? "online" : "offline";
    state.llmStatusText = result.text || "";
    state.llmModel = state.localModels.effectiveModel || result.model || state.llmModel;
    if (showResult) {
      showToast(result.ok ? "어서오세요! AI지원담당입니다." : "아무도 반응이 없어요.");
    }
  } catch (error) {
    state.llmStatus = "offline";
    state.llmStatusText = error?.message || String(error);
    if (showResult) showToast("아무도 반응이 없어요.");
  } finally {
    if (state.view === "friends" || state.view === "chats") render();
  }
}

async function confirmAttendance() {
  if (state.isCheckingAttendance) return;

  if (!window.desktopAPI?.igniteOfficer) {
    showToast("데스크톱 앱 실행 환경에서만 사용할 수 있습니다.");
    return;
  }

  state.isCheckingAttendance = true;
  state.llmStatus = "offline";
  renderFriends();

  try {
    const result = await window.desktopAPI.igniteOfficer({ contact: firstAiContact() });
    state.llmStatus = result.ok ? "online" : "offline";
    state.llmStatusText = result.text || "";
    state.llmModel = state.localModels.effectiveModel || result.model || state.llmModel;
    showToast(result.ok ? "어서오세요! AI지원담당입니다." : "아무도 반응이 없어요.");
  } catch (error) {
    state.llmStatus = "offline";
    state.llmStatusText = error?.message || String(error);
    showToast("아무도 반응이 없어요.");
  } finally {
    state.isCheckingAttendance = false;
    renderFriends();
  }
}

async function bootIntoMain() {
  if (state.isCheckingAttendance) return;

  if (!window.desktopAPI?.igniteOfficer) {
    setBootStatus("데스크톱 앱 실행 환경에서만 시작할 수 있습니다.");
    showMainApp();
    return;
  }

  state.isCheckingAttendance = true;
  state.llmStatus = "offline";
  setBootBusy(true);
  setBootStatus("AI지원담당에 노크하는 중입니다.");

  try {
    const result = await window.desktopAPI.igniteOfficer({ contact: firstAiContact() });
    state.llmStatus = result.ok ? "online" : "offline";
    state.llmStatusText = result.text || "";
    state.llmModel = state.localModels.effectiveModel || result.model || state.llmModel;

    if (result.ok) {
      setBootStatus("어서오세요! AI지원담당입니다.");
      showMainApp();
      showToast("어서오세요! AI지원담당입니다.");
      return;
    }

    setBootStatus("로컬 LLM 설정을 확인해 주세요.");
    showMainApp();
    showToast("로컬 LLM을 설치하거나 모델을 선택해 주세요.");
    window.setTimeout(() => void openModelPicker(document.querySelector("[data-model-picker-open]")), 0);
  } catch (error) {
    state.llmStatus = "offline";
    state.llmStatusText = error?.message || String(error);
    setBootStatus("로컬 LLM 설정을 확인해 주세요.");
    showMainApp();
    showToast("로컬 LLM을 설치하거나 모델을 선택해 주세요.");
    window.setTimeout(() => void openModelPicker(document.querySelector("[data-model-picker-open]")), 0);
  } finally {
    state.isCheckingAttendance = false;
    setBootBusy(false);
  }
}

function tabButton(id, label, current) {
  return `<button class="tab-button ${current === id ? "is-active" : ""}" type="button" data-tab="${id}">${escapeHtml(label)}</button>`;
}

function bindFriendEvents() {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.friendTab = button.dataset.tab;
      state.search = "";
      renderFriends();
    });
  });
  bindOpenRows();
}

function bindOpenRows() {
  document.querySelectorAll("[data-open-chat]").forEach((row) => {
    row.addEventListener("dblclick", () => openChat(row.dataset.openChat));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter") openChat(row.dataset.openChat);
    });
  });
}

function bindOpenProfiles() {
  document.querySelectorAll("[data-open-profile]").forEach((avatar) => {
    avatar.addEventListener("click", (event) => {
      event.stopPropagation();
      openProfile(avatar.dataset.openProfile);
    });
    avatar.addEventListener("dblclick", (event) => {
      event.stopPropagation();
    });
    avatar.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      openProfile(avatar.dataset.openProfile);
    });
  });
}

async function refreshChatSummaries({ rerender = false } = {}) {
  if (!window.desktopAPI?.getChatSummaries) return;

  try {
    state.chatSummaries = (await window.desktopAPI.getChatSummaries()) || {};
    if (rerender && state.view === "chats") render();
  } catch (_error) {
    // Chat summaries are session-only in the current test stage.
  }
}

function renderChats() {
  const query = state.search.trim().toLowerCase();
  const chats = DATA.contacts.map(contactWithChatSummary).filter((item) => {
    const haystack = `${item.name} ${item.lastMessage} ${item.tag} ${supportGroupLabel(item)}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (state.chatFilter === "unread") return item.unread > 0;
    if (state.chatFilter === "business") return item.supportGroup === "business";
    if (state.chatFilter === "technical") return item.supportGroup === "technical";
    return true;
  }).sort((a, b) => {
    const updatedDiff = (b.updatedAt || 0) - (a.updatedAt || 0);
    if (updatedDiff) return updatedDiff;
    return Number(Boolean(b.pinned)) - Number(Boolean(a.pinned));
  });
  const actions = `
    <button class="primary-button" type="button" id="newChatButton">
      <i data-lucide="message-circle-plus"></i>
      새 채팅
    </button>
    <button class="icon-button raised" type="button" aria-label="더보기">
      <i data-lucide="ellipsis"></i>
    </button>
  `;

  viewRoot.innerHTML = `
    ${baseHeader({ title: "채팅", icon: false, actions })}
    ${searchBar("대화방 검색")}
    <div class="chat-toolbar">
      <div class="tabs compact">
        ${filterButton("all", "전체", state.chatFilter)}
        ${filterButton("unread", "읽지 않음", state.chatFilter)}
        ${filterButton("business", "업무지원", state.chatFilter)}
        ${filterButton("technical", "기술지원", state.chatFilter)}
      </div>
      <div class="sort-control">
        <button class="text-button" type="button">최신순 <i data-lucide="chevron-down"></i></button>
        <button class="icon-button" type="button" aria-label="목록 보기"><i data-lucide="list"></i></button>
      </div>
    </div>
    <div class="chat-list">
      ${chats.map(chatRow).join("")}
    </div>
  `;

  bindSearch();
  document.querySelector("#newChatButton")?.addEventListener("click", () => showToast("새 채팅 대상을 선택하세요."));
  document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      state.chatFilter = button.dataset.filter;
      state.search = "";
      renderChats();
    });
  });
  bindOpenRows();
}

function filterButton(id, label, current) {
  return `<button class="tab-button ${current === id ? "is-active" : ""}" type="button" data-filter="${id}">${escapeHtml(label)}</button>`;
}

function chatRow(item) {
  const displayItem = contactWithRuntimeStatus(item);
  return `
    <article class="chat-row" data-open-chat="${escapeHtml(item.id)}" tabindex="0">
      ${avatarMarkup(displayItem)}
      <div class="row-main">
        <div class="row-title">
          <strong>${escapeHtml(displayItem.name)}</strong>
          ${tagMarkup(displayItem)}
        </div>
        <p>${escapeHtml(displayItem.lastMessage)}</p>
      </div>
      <div class="chat-row-side">
        <div class="chat-flags">
          ${displayItem.pinned ? `<i class="pin-icon" data-lucide="pin"></i>` : ""}
        </div>
        <span>${escapeHtml(displayItem.time)}</span>
        ${displayItem.unread ? `<strong class="unread-badge">${displayItem.unread}</strong>` : ""}
      </div>
    </article>
  `;
}

async function refreshWorkspace({ rerender = false } = {}) {
  if (!window.desktopAPI?.getWorkspaceSnapshot) return;
  try {
    state.workspace = await window.desktopAPI.getWorkspaceSnapshot();
  } catch (error) {
    state.workspace = {
      error: error?.message || "자료 저장소를 불러오지 못했습니다.",
    };
  }
  if (rerender && state.view === "files") render();
}

async function indexWorkspaceFromFilesView() {
  if (state.isIndexingWorkspace || !window.desktopAPI?.indexWorkspace) return;
  state.isIndexingWorkspace = true;
  render();
  try {
    const index = await window.desktopAPI.indexWorkspace();
    state.workspace = {
      ...(state.workspace || {}),
      status: {
        ...(state.workspace?.status || {}),
        index,
      },
    };
    await refreshWorkspace({ rerender: false });
    showToast(`자료 인덱싱 완료: ${index.fileCount}개 파일, ${index.chunkCount}개 조각`);
  } catch (error) {
    showToast(`자료 인덱싱 실패: ${error?.message || "알 수 없는 오류"}`);
  } finally {
    state.isIndexingWorkspace = false;
    render();
  }
}

function renderFiles() {
  const query = state.search.trim().toLowerCase();
  const contacts = DATA.contacts
    .filter(isAiContact)
    .map(contactWithRuntimeStatus)
    .filter((item) => {
      const haystack = `${item.name} ${item.description} ${item.tag} ${item.persona?.title || ""}`.toLowerCase();
      return !query || haystack.includes(query);
    })
    .sort((a, b) => a.name.localeCompare(b.name, "ko"));

  viewRoot.innerHTML = `
    ${baseHeader({
      title: "자료",
      icon: false,
      actions: `
        <button class="primary-button" type="button" id="openWorkspaceButton"><i data-lucide="folder-open"></i> 폴더</button>
        <button class="primary-button" type="button" id="indexWorkspaceButton" ${state.isIndexingWorkspace ? "disabled" : ""}><i data-lucide="database-zap"></i> ${state.isIndexingWorkspace ? "인덱싱" : "인덱싱"}</button>
      `,
    })}
    ${workspacePanelMarkup()}
    ${searchBar("담당 검색")}
    <div class="resource-board">
      <div class="resource-list">
        ${contacts.map(resourceRow).join("")}
      </div>
    </div>
  `;

  bindSearch();
  document.querySelector("#openWorkspaceButton")?.addEventListener("click", () => {
    window.desktopAPI?.openWorkspace?.();
  });
  document.querySelector("#indexWorkspaceButton")?.addEventListener("click", indexWorkspaceFromFilesView);
  document.querySelectorAll("[data-open-config]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openContactConfig(button.dataset.openConfig, button.dataset.configMode);
    });
  });
  if (!state.workspace) void refreshWorkspace({ rerender: true });
}

function workspacePanelMarkup() {
  const workspace = state.workspace;
  if (!workspace) {
    return `
      <section class="workspace-panel">
        <div class="workspace-empty">
          <strong>자료 저장소 확인 중</strong>
          <span>heyu_workspace 폴더와 MCP 상태를 불러오는 중입니다.</span>
        </div>
      </section>
    `;
  }

  if (workspace.error) {
    return `
      <section class="workspace-panel">
        <div class="workspace-empty is-error">
          <strong>자료 저장소 오류</strong>
          <span>${escapeHtml(workspace.error)}</span>
        </div>
      </section>
    `;
  }

  const status = workspace.status || {};
  const index = status.index || {};
  const skippedText = index.skippedCount ? ` · 실패 ${index.skippedCount}개` : "";
  return `
    <section class="workspace-panel">
      <div class="workspace-status-grid">
        ${workspaceStatusCard("Filesystem MCP", status.filesystem?.label || "확인 전", status.filesystem?.ok)}
        ${workspaceStatusCard("MarkItDown MCP", status.markitdown?.label || "확인 전", status.markitdown?.ok)}
        ${workspaceStatusCard("Qdrant MCP", status.qdrant?.label || "확인 전", status.qdrant?.ok)}
        ${workspaceStatusCard("자료 인덱스", `${index.fileCount || 0}개 파일 · ${index.chunkCount || 0}개 조각 · ${index.updated || "미실행"}${skippedText}`, Boolean(index.chunkCount))}
      </div>
      <div class="workspace-root">${escapeHtml(status.root || "")}</div>
      <div class="workspace-folders">
        ${(workspace.folders || []).map(workspaceFolderMarkup).join("")}
      </div>
    </section>
  `;
}

function workspaceStatusCard(title, body, ok) {
  return `
    <div class="workspace-status-card ${ok ? "is-ok" : "is-warn"}">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(body)}</strong>
    </div>
  `;
}

function workspaceFolderMarkup(folder) {
  const allFiles = Array.isArray(folder.files) ? folder.files : [];
  const files = allFiles.slice(0, 5);
  return `
    <section class="workspace-folder">
      <header>
        <strong>${escapeHtml(folder.label || folder.name)}</strong>
        <span>${escapeHtml(allFiles.length)}개</span>
      </header>
      ${
        files.length
          ? files.map(workspaceFileRow).join("")
          : `<div class="workspace-file-empty">아직 파일이 없습니다.</div>`
      }
    </section>
  `;
}

function workspaceFileRow(file) {
  return `
    <article class="workspace-file-row">
      <span class="file-icon file-${escapeHtml(file.type || "file")}">${fileIconText(file.type)}</span>
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <p>${escapeHtml(file.relativePath)} · ${escapeHtml(file.size)} · ${escapeHtml(file.updated)}</p>
      </div>
      <span class="workspace-index-pill ${file.indexed ? "is-indexed" : ""}">${file.indexed ? "indexed" : "raw"}</span>
    </article>
  `;
}

function fileIconText(type) {
  const labels = {
    ppt: "P",
    excel: "X",
    pdf: "PDF",
    word: "W",
    text: "T",
    image: "IMG",
  };
  return labels[type] || "F";
}

function resourceRow(item) {
  const evidenceCount = item.evidence?.length || 0;
  return `
    <article class="resource-row">
      ${avatarMarkup(item)}
      <div class="row-main">
        <div class="row-title">
          <strong>${escapeHtml(item.name)}</strong>
          ${tagMarkup(item)}
        </div>
        <p>${escapeHtml(item.description)} · 초기 설정 ${evidenceCount}건</p>
      </div>
      <div class="resource-actions">
        <button class="resource-action-button" type="button" data-open-config="${escapeHtml(item.id)}" data-config-mode="resources" aria-label="${escapeHtml(item.name)} 자료 설정">
          <i data-lucide="folder-open"></i>
          <span>자료</span>
        </button>
        <button class="resource-action-button" type="button" data-open-config="${escapeHtml(item.id)}" data-config-mode="commands" aria-label="${escapeHtml(item.name)} 명령 설정">
          <i data-lucide="list-checks"></i>
          <span>명령</span>
        </button>
      </div>
    </article>
  `;
}

function renderSettings() {
  const actions = `<button class="primary-button" type="button" id="saveSettings"><i data-lucide="save"></i> 저장</button>`;
  const limits = state.appSettings.limits || {};
  const routineSafety = state.appSettings.routineSafety || {};

  viewRoot.innerHTML = `
    ${baseHeader({ title: "설정", icon: false, actions })}
    <div class="settings-layout">
      <section class="settings-panel">
        <h2>프로필</h2>
        <div class="settings-row">
          <span>표시 이름</span>
          <strong>${escapeHtml(DATA.user.name)}</strong>
        </div>
        <div class="settings-row">
          <span>소속</span>
          <strong>${escapeHtml(DATA.user.department)}</strong>
        </div>
        <div class="settings-row">
          <span>상태</span>
          <button class="status-pill" type="button"><span class="presence-small"></span> 온라인 <i data-lucide="chevron-down"></i></button>
        </div>
      </section>
      <section class="settings-panel">
        <h2>알림</h2>
        ${settingToggle("답변 완료 알림", state.appSettings.replyDoneNotifications, "replyDoneNotifications")}
        ${settingToggle("업무 대화 알림", true)}
        ${settingToggle("자료 업데이트 알림", true)}
        ${settingToggle("오프라인 요약", false)}
      </section>
      <section class="settings-panel wide">
        <h2>보안</h2>
        <div class="security-grid">
          <div><strong>LLM 처리 위치</strong><span>연결 설정에 따름</span></div>
          <div><strong>작업 파일</strong><span>로컬 워크스페이스에 저장</span></div>
          <div><strong>개인정보 검사</strong><span>검사 모드에서 LLM 미전송</span></div>
        </div>
      </section>
      <section class="settings-panel wide">
        <h2>용량 제한</h2>
        <div class="limit-grid">
          ${settingNumber("그래프 파일", "graphFileMb", limits.graphFileMb ?? 30, "MB")}
          ${settingNumber("변환 파일 1개", "converterFileMb", limits.converterFileMb ?? 200, "MB")}
          ${settingNumber("PDF 병합 전체", "converterPdfTotalMb", limits.converterPdfTotalMb ?? 300, "MB")}
          ${settingNumber("이미지 픽셀", "converterImageMegapixels", limits.converterImageMegapixels ?? 80, "MP")}
          ${settingNumber("녹음/STT", "sttAudioMb", limits.sttAudioMb ?? 120, "MB")}
          ${settingNumber("생성물 저장", "generatedFileMb", limits.generatedFileMb ?? 15, "MB")}
        </div>
      </section>
      <section class="settings-panel wide">
        <h2>김루틴 실행 안전</h2>
        ${settingToggle("파일 열기 허용", Boolean(routineSafety.allowFileOpen), "routineSafety.allowFileOpen")}
        ${settingToggle("프로그램 실행 허용", Boolean(routineSafety.allowProgramLaunch), "routineSafety.allowProgramLaunch")}
      </section>
    </div>
  `;

  document.querySelector("#saveSettings")?.addEventListener("click", async () => {
    const nextSettings = {
      replyDoneNotifications: Boolean(document.querySelector('[data-setting-key="replyDoneNotifications"]')?.checked),
      limits: readLimitSettings(),
      routineSafety: {
        allowFileOpen: Boolean(document.querySelector('[data-setting-key="routineSafety.allowFileOpen"]')?.checked),
        allowProgramLaunch: Boolean(document.querySelector('[data-setting-key="routineSafety.allowProgramLaunch"]')?.checked),
      },
    };
    state.appSettings = {
      ...state.appSettings,
      ...nextSettings,
    };
    try {
      await window.desktopAPI?.saveAppSettings?.(state.appSettings);
      showToast("설정이 저장되었습니다.");
    } catch (_error) {
      showToast("설정 저장에 실패했습니다.");
    }
  });
}

function readLimitSettings() {
  const fallback = state.appSettings.limits || {};
  return {
    graphFileMb: readNumberSetting("graphFileMb", fallback.graphFileMb ?? 30),
    converterFileMb: readNumberSetting("converterFileMb", fallback.converterFileMb ?? 200),
    converterPdfTotalMb: readNumberSetting("converterPdfTotalMb", fallback.converterPdfTotalMb ?? 300),
    converterImageMegapixels: readNumberSetting("converterImageMegapixels", fallback.converterImageMegapixels ?? 80),
    sttAudioMb: readNumberSetting("sttAudioMb", fallback.sttAudioMb ?? 120),
    generatedFileMb: readNumberSetting("generatedFileMb", fallback.generatedFileMb ?? 15),
  };
}

function readNumberSetting(key, fallback) {
  const input = [...document.querySelectorAll("[data-limit-key]")].find((item) => item.dataset.limitKey === key);
  const value = Number(input?.value);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function settingToggle(label, checked, key = "") {
  return `
    <label class="settings-row toggle-row">
      <span>${escapeHtml(label)}</span>
      <input type="checkbox" ${key ? `data-setting-key="${escapeHtml(key)}"` : ""} ${checked ? "checked" : ""} />
      <i></i>
    </label>
  `;
}

function settingNumber(label, key, value, unit) {
  return `
    <label class="settings-number-row">
      <span>${escapeHtml(label)}</span>
      <input type="number" min="1" step="1" data-limit-key="${escapeHtml(key)}" value="${escapeHtml(value)}" />
      <b>${escapeHtml(unit)}</b>
    </label>
  `;
}

function render() {
  document.querySelectorAll(".nav-item").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  viewRoot.dataset.view = state.view;
  if (state.view === "friends") renderFriends();
  if (state.view === "chats") renderChats();
  if (state.view === "files") renderFiles();
  if (state.view === "settings") renderSettings();
  bindOpenProfiles();
  createIcons();
}

function bindWindowControls() {
  document.querySelectorAll('[data-window-action="minimize"]').forEach((button) => button.addEventListener("click", () => {
    window.desktopAPI?.minimize();
  }));
  document.querySelectorAll('[data-window-action="maximize"]').forEach((button) => button.addEventListener("click", () => {
    window.desktopAPI?.toggleMaximize();
  }));
  document.querySelectorAll('[data-window-action="close"]').forEach((button) => button.addEventListener("click", () => {
    window.desktopAPI?.close();
  }));
}

function isEscapeKey(event) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape" || event.keyCode === 27;
}

function closeWindowOnEscape(event) {
  if (!isEscapeKey(event) || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  if (state.modelPicker.open) {
    closeModelPicker();
    return;
  }
  window.desktopAPI?.close();
}

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.search = "";
    render();
    if (state.view === "chats") void refreshChatSummaries({ rerender: true });
    if (state.view === "files") void refreshWorkspace({ rerender: true });
  });
});

document.addEventListener("click", (event) => {
  const modelTrigger = event.target.closest?.("[data-model-picker-open]");
  if (modelTrigger) {
    event.preventDefault();
    event.stopPropagation();
    void openModelPicker(modelTrigger);
    return;
  }
  if (event.target.closest("[data-open-profile]")) return;
  window.desktopAPI?.closeProfiles?.();
});

modalLayer?.addEventListener("click", (event) => {
  if (event.target === modalLayer) closeModelPicker();
});

window.desktopAPI?.onNavigateMain?.((nextView) => {
  const shouldOpenModelPicker = nextView === "models";
  if (!["friends", "chats", "files", "settings"].includes(nextView) && !shouldOpenModelPicker) return;
  state.view = shouldOpenModelPicker ? "settings" : nextView;
  state.search = "";
  if (mainApp?.hidden) showMainApp();
  else render();
  if (shouldOpenModelPicker) {
    window.setTimeout(() => void openModelPicker(document.querySelector("[data-model-picker-open]")), 0);
  }
  if (state.view === "chats") void refreshChatSummaries({ rerender: true });
  if (state.view === "files") void refreshWorkspace({ rerender: true });
});

window.desktopAPI?.onChatSessionsUpdated?.((summaries) => {
  state.chatSummaries = summaries || {};
  if (state.view === "chats") render();
});

const disposeLocalModelProgress = window.desktopAPI?.onLocalModelProgress?.(updateModelPullProgress);
const disposeLocalModelChanged = window.desktopAPI?.onLocalModelChanged?.(handleLocalModelChanged);

window.addEventListener("keydown", trapModelPickerFocus, true);
window.addEventListener("keydown", closeWindowOnEscape, true);
window.addEventListener("beforeunload", () => {
  if (typeof disposeLocalModelProgress === "function") disposeLocalModelProgress();
  if (typeof disposeLocalModelChanged === "function") disposeLocalModelChanged();
});

bindWindowControls();
bootPowerButton?.addEventListener("click", bootIntoMain);
syncBootModelButton();
render();
void loadAppSettings({ rerender: true });
void refreshChatSummaries({ rerender: state.view === "chats" });
void refreshLlmStatus();
void refreshLocalModels({ focusPicker: false });
