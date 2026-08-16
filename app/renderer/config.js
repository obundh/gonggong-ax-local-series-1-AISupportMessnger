const DATA = window.HEYU_DATA;
const params = new URLSearchParams(window.location.search);
const contactId = params.get("id") || "chief";
const mode = params.get("mode") === "commands" ? "commands" : "resources";
const contact = DATA.contacts.find((item) => item.id === contactId) || DATA.contacts[0];

const titleRoot = document.querySelector("#configWindowTitle");
const heroRoot = document.querySelector("#configHero");
const editorRoot = document.querySelector("#configEditor");
const currentRoot = document.querySelector("#configCurrent");
const toast = document.querySelector("#toast");
let isOfficerRuntimeOnline = false;

let config = {
  resourcesText: "",
  commandsText: "",
  files: [],
  updatedAt: 0,
};

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
  if (isOfficerRuntimeOnline && item?.tagType === "ai" && !item?.forceOffline) return "online";
  if (item?.status === "offline") return "offline";
  if (item?.status === "away") return "away";
  return "online";
}

function statusClass(item) {
  const status = normalizedStatus(item);
  return status === "online" ? "" : `is-${status}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 1600);
}

function avatarMarkup(item) {
  const statusModifier = statusClass(item);
  if (item.avatarImage) {
    const fallback = item.avatarFallback ? ` data-avatar-fallback="${escapeHtml(item.avatarFallback)}"` : "";
    return `
      <div class="avatar avatar-md avatar-image" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}" title="${escapeHtml(item.name || "")}">
        <img class="avatar-photo" src="${escapeHtml(item.avatarImage)}" alt=""${fallback} />
        <span class="status-dot ${statusModifier}"></span>
      </div>
    `;
  }

  const label = item.avatar === "group" ? "users-round" : item.avatar === "human" || item.avatar === "human-female" ? "user-round" : "bot";
  return `
    <div class="avatar avatar-md avatar-${escapeHtml(item.avatar || "bot")}" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}">
      <i data-lucide="${label}"></i>
      <span class="status-dot ${statusModifier}"></span>
    </div>
  `;
}

function render() {
  const isCommands = mode === "commands";
  const modeTitle = isCommands ? "요구 명령" : "자료";
  const modeIcon = isCommands ? "list-checks" : "folder-open";
  const editableValue = isCommands ? config.commandsText : config.resourcesText;

  titleRoot.textContent = `${contact.name} ${modeTitle}`;
  heroRoot.innerHTML = `
    ${avatarMarkup(contact)}
    <div>
      <h1>${escapeHtml(contact.name)}</h1>
      <p>${escapeHtml(contact.description)} · ${escapeHtml(modeTitle)}</p>
    </div>
    <i data-lucide="${modeIcon}"></i>
  `;

  editorRoot.innerHTML = `
    <header>
      <h2>${escapeHtml(modeTitle)}</h2>
      <button class="primary-button" type="button" id="saveConfigButton">
        <i data-lucide="save"></i>
        저장
      </button>
    </header>
    <textarea id="configTextInput" spellcheck="false" placeholder="${isCommands ? "이 담당에게만 적용할 요구 명령을 적으세요." : "이 담당에게 참고시킬 자료 내용을 붙여넣으세요."}">${escapeHtml(editableValue)}</textarea>
    ${
      isCommands
        ? ""
        : `
          <div class="config-file-strip">
            <label class="outline-button file-picker">
              <i data-lucide="paperclip"></i>
              파일 표시 추가
              <input type="file" id="configFilePicker" multiple />
            </label>
            <div class="config-file-list" id="configFileList">
              ${fileListMarkup(config.files)}
            </div>
          </div>
        `
    }
  `;

  const persona = contact.persona || {};
  currentRoot.innerHTML = `
    <section class="config-section">
      <h2>현재 역할 설정</h2>
      <dl class="info-list">
        <dt>업무</dt><dd>${escapeHtml(contact.description)}</dd>
        <dt>말투</dt><dd>${escapeHtml(persona.tone || "-")}</dd>
        <dt>출력</dt><dd>${escapeHtml(contact.output?.format || "-")}</dd>
      </dl>
    </section>
    <section class="config-section">
      <h2>현재 처리 방식</h2>
      <div class="persona-chips">
        ${(persona.workflow || []).map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
      </div>
      ${
        persona.limits?.length
          ? `<ul class="persona-limits">${persona.limits.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
          : ""
      }
    </section>
    <section class="config-section">
      <h2>초기 설정 자료</h2>
      <div class="evidence-list">
        ${(contact.evidence || [])
          .map(
            (file) => `
              <article>
                <span class="file-icon file-${file.type || "file"}">${file.type === "pdf" ? "PDF" : file.type === "excel" ? "X" : "F"}</span>
                <div>
                  <strong>${escapeHtml(file.name)}</strong>
                  <p>${escapeHtml(file.size || "내장")}</p>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
    </section>
    <section class="config-section">
      <h2>현재 시스템 명령</h2>
      <pre>${escapeHtml(persona.systemPrompt || "")}</pre>
    </section>
  `;

  bindEditorEvents();
  createIcons();
}

function fileListMarkup(files) {
  if (!files?.length) return `<span class="empty-inline">추가된 파일 표시 없음</span>`;
  return files
    .map(
      (file, index) => `
        <button class="config-file-chip" type="button" data-remove-file="${index}" title="목록에서 제거">
          <i data-lucide="file"></i>
          <span>${escapeHtml(file.name)}</span>
        </button>
      `
    )
    .join("");
}

function bindEditorEvents() {
  document.querySelector("#saveConfigButton")?.addEventListener("click", saveConfig);
  document.querySelector("#configFilePicker")?.addEventListener("change", async (event) => {
    const selectedFiles = [...(event.target.files || [])];
    const files = selectedFiles.map((file) => ({
      name: file.name,
      size: `${Math.max(1, Math.round(file.size / 1024))}KB`,
      type: inferFileType(file.name),
    }));
    config.files = [...config.files, ...files];

    const input = document.querySelector("#configTextInput");
    const readableTexts = (await Promise.all(selectedFiles.map(readFileAsResourceText))).filter(Boolean);
    if (input && readableTexts.length) {
      config.resourcesText = [input.value.trim(), ...readableTexts].filter(Boolean).join("\n\n");
    }

    render();
  });
  document.querySelectorAll("[data-remove-file]").forEach((button) => {
    button.addEventListener("click", () => {
      config.files.splice(Number(button.dataset.removeFile), 1);
      render();
    });
  });
}

function inferFileType(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  if (["doc", "docx"].includes(ext)) return "word";
  if (["xls", "xlsx", "csv"].includes(ext)) return "excel";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  return "file";
}

async function readFileAsResourceText(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  const readable = ["txt", "md", "csv", "json", "xml", "html", "htm", "log"].includes(ext);
  if (!readable || file.size > 2 * 1024 * 1024) return "";

  try {
    const text = await file.text();
    return `[자료: ${file.name}]\n${text.slice(0, 80000)}`;
  } catch (_error) {
    return "";
  }
}

async function saveConfig() {
  const input = document.querySelector("#configTextInput");
  if (mode === "commands") {
    config.commandsText = input.value.trim();
  } else {
    config.resourcesText = input.value.trim();
  }

  if (!window.desktopAPI?.saveContactConfig) {
    showToast("데스크톱 앱 실행 환경에서만 저장할 수 있습니다.");
    return;
  }

  try {
    config = await window.desktopAPI.saveContactConfig(contact.id, config);
    showToast("저장되었습니다.");
    render();
  } catch (error) {
    showToast(error?.message || "저장하지 못했습니다.");
  }
}

async function loadConfig() {
  try {
    config = (await window.desktopAPI?.getContactConfig?.(contact.id)) || config;
  } catch (_error) {
    config = {
      resourcesText: "",
      commandsText: "",
      files: [],
      updatedAt: 0,
    };
  }
  render();
}

async function refreshOfficerRuntimeStatus() {
  if (contact?.forceOffline || !window.desktopAPI?.checkOfficerStatus) return;
  try {
    const result = await window.desktopAPI.checkOfficerStatus();
    isOfficerRuntimeOnline = Boolean(result?.ok);
    render();
  } catch (_error) {
    isOfficerRuntimeOnline = false;
    render();
  }
}

function bindWindowControls() {
  document.querySelector('[data-window-action="minimize"]')?.addEventListener("click", () => {
    window.desktopAPI?.minimize();
  });
  document.querySelector('[data-window-action="maximize"]')?.addEventListener("click", () => {
    window.desktopAPI?.toggleMaximize();
  });
  document.querySelector('[data-window-action="close"]')?.addEventListener("click", () => {
    window.desktopAPI?.close();
  });
}

function isEscapeKey(event) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape" || event.keyCode === 27;
}

window.addEventListener(
  "keydown",
  (event) => {
    if (!isEscapeKey(event) || event.repeat) return;
    event.preventDefault();
    event.stopPropagation();
    window.desktopAPI?.close();
  },
  true
);

bindWindowControls();
loadConfig();
void refreshOfficerRuntimeStatus();
