const DATA = window.HEYU_DATA;
const params = new URLSearchParams(window.location.search);
const contactId = params.get("id") || "chief";
const contact = DATA.contacts.find((item) => item.id === contactId) || DATA.contacts[0];
const profileHero = document.querySelector("#profileHero");
let isOfficerRuntimeOnline = false;

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

function profileImageMarkup(item) {
  if (item.avatarImage) {
    const fallback = item.avatarFallback ? ` data-avatar-fallback="${escapeHtml(item.avatarFallback)}"` : "";
    return `<img class="profile-photo" src="${escapeHtml(item.avatarImage)}" alt=""${fallback} />`;
  }

  const icon = item.avatar === "human" || item.avatar === "human-female" ? "user-round" : item.avatar === "group" ? "users-round" : "bot";
  return `<div class="profile-photo profile-photo-fallback" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}"><i data-lucide="${icon}"></i></div>`;
}

function render() {
  const displayStatusLabel = statusLabel(contact);
  const displayStatusClass = statusClass(contact);
  const persona = contact.persona;
  const chips = (persona?.strengths || []).slice(0, 3);

  profileHero.innerHTML = `
    <div class="profile-photo-frame">
      ${profileImageMarkup(contact)}
    </div>
    <div class="profile-summary">
      <h1>${escapeHtml(contact.name)}</h1>
      <p>${escapeHtml(contact.description)}</p>
      <span class="profile-status ${displayStatusClass}">
        <i></i>
        ${displayStatusLabel}
      </span>
    </div>
    ${
      persona?.summary
        ? `<p class="profile-intro">${escapeHtml(persona.summary)}</p>`
        : ""
    }
    ${
      chips.length
        ? `<div class="profile-chip-row">${chips.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</div>`
        : ""
    }
    <button class="profile-chat-button" type="button" id="profileChatButton">
      <i data-lucide="message-circle"></i>
      채팅하기
    </button>
  `;

  document.querySelector("#profileChatButton")?.addEventListener("click", () => {
    window.desktopAPI?.openChat?.(contact.id);
  });

  createIcons();
}

function bindWindowControls() {
  document.querySelector('[data-window-action="minimize"]')?.addEventListener("click", () => {
    window.desktopAPI?.minimize();
  });
  document.querySelector('[data-window-action="close"]')?.addEventListener("click", () => {
    window.desktopAPI?.close();
  });
}

function isEscapeKey(event) {
  return event.key === "Escape" || event.key === "Esc" || event.code === "Escape" || event.keyCode === 27;
}

function closeWindowOnEscape(event) {
  if (!isEscapeKey(event) || event.repeat) return;
  event.preventDefault();
  event.stopPropagation();
  window.desktopAPI?.close();
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

bindWindowControls();
window.addEventListener("keydown", closeWindowOnEscape, true);
document.addEventListener("keydown", closeWindowOnEscape, true);
render();
void refreshOfficerRuntimeStatus();
