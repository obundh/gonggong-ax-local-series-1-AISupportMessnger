const titleEl = document.querySelector("#pdfEditorTitle");
const metaEl = document.querySelector("#pdfEditorMeta");
const railEl = document.querySelector("#pdfThumbnailRail");
const previewCanvas = document.querySelector("#pdfPreviewCanvas");
const statusEl = document.querySelector("#pdfEditorStatus");
const pageLabelEl = document.querySelector("#pdfPageLabel");
const prevButton = document.querySelector("#pdfPrevButton");
const nextButton = document.querySelector("#pdfNextButton");
const resetButton = document.querySelector("#pdfEditorResetButton");
const closeButton = document.querySelector("#pdfEditorCloseButton");
const saveButton = document.querySelector("#pdfSaveButton");
const outputNameInput = document.querySelector("#pdfOutputName");

let pdfjsModulePromise = null;
let pdfDocument = null;
let fileInfo = null;
let pageOrder = [];
let selectedIndex = 0;
let draggedIndex = null;
let isRenderingPreview = false;

function createIcons() {
  if (window.lucide) {
    window.lucide.createIcons({ attrs: { "stroke-width": 2 } });
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function setStatus(message, visible = true) {
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.hidden = !visible;
}

function base64ToUint8Array(base64) {
  const binary = window.atob(String(base64 || ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function loadPdfJsModule() {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import("../../node_modules/pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", window.location.href).href;
      return pdfjs;
    });
  }
  return pdfjsModulePromise;
}

function updatePageLabel() {
  const current = pageOrder[selectedIndex] || 0;
  if (pageLabelEl) pageLabelEl.textContent = current ? `원본 ${current}쪽 · 위치 ${selectedIndex + 1} / ${pageOrder.length}` : "-";
  if (prevButton) prevButton.disabled = selectedIndex <= 0;
  if (nextButton) nextButton.disabled = selectedIndex >= pageOrder.length - 1;
}

async function renderPreview() {
  if (!pdfDocument || !previewCanvas || isRenderingPreview) return;
  const pageNumber = pageOrder[selectedIndex];
  if (!pageNumber) return;
  isRenderingPreview = true;
  try {
    const page = await pdfDocument.getPage(pageNumber);
    const stage = previewCanvas.parentElement;
    const maxWidth = Math.max(360, (stage?.clientWidth || 760) - 52);
    const maxHeight = Math.max(360, (stage?.clientHeight || 560) - 52);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(0.35, Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height));
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const context = previewCanvas.getContext("2d");
    previewCanvas.width = Math.floor(viewport.width * pixelRatio);
    previewCanvas.height = Math.floor(viewport.height * pixelRatio);
    previewCanvas.style.width = `${Math.floor(viewport.width)}px`;
    previewCanvas.style.height = `${Math.floor(viewport.height)}px`;
    await page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null,
    }).promise;
    setStatus("", false);
  } catch (error) {
    setStatus(error?.message || String(error), true);
  } finally {
    isRenderingPreview = false;
    updatePageLabel();
  }
}

async function renderThumbnail(canvas, pageNumber) {
  if (!pdfDocument || !canvas) return;
  const page = await pdfDocument.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(140 / baseViewport.width, 115 / baseViewport.height);
  const viewport = page.getViewport({ scale: Math.max(0.12, scale) });
  const context = canvas.getContext("2d");
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  await page.render({ canvasContext: context, viewport }).promise;
}

function renderThumbnails() {
  if (!railEl) return;
  railEl.innerHTML = pageOrder
    .map((pageNumber, index) => `
      <button class="thumbnail-item ${index === selectedIndex ? "is-active" : ""}" type="button" draggable="true" data-index="${index}">
        <canvas data-thumbnail-page="${pageNumber}"></canvas>
        <span>${index + 1}. 원본 ${pageNumber}쪽</span>
      </button>
    `)
    .join("");

  railEl.querySelectorAll(".thumbnail-item").forEach((item) => {
    item.addEventListener("click", () => selectIndex(Number(item.dataset.index || 0)));
    item.addEventListener("dragstart", (event) => {
      draggedIndex = Number(item.dataset.index || 0);
      event.dataTransfer?.setData("text/plain", String(draggedIndex));
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragover", (event) => {
      event.preventDefault();
      item.classList.add("is-drop-target");
    });
    item.addEventListener("dragleave", () => item.classList.remove("is-drop-target"));
    item.addEventListener("drop", (event) => {
      event.preventDefault();
      item.classList.remove("is-drop-target");
      const targetIndex = Number(item.dataset.index || 0);
      movePage(draggedIndex, targetIndex);
    });
  });

  railEl.querySelectorAll("canvas[data-thumbnail-page]").forEach((canvas) => {
    renderThumbnail(canvas, Number(canvas.dataset.thumbnailPage || 0)).catch(() => {});
  });
}

function selectIndex(index) {
  selectedIndex = Math.min(pageOrder.length - 1, Math.max(0, Math.round(Number(index || 0))));
  renderThumbnails();
  renderPreview();
}

function movePage(fromIndex, toIndex) {
  if (!Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex === toIndex) return;
  if (fromIndex < 0 || fromIndex >= pageOrder.length || toIndex < 0 || toIndex >= pageOrder.length) return;
  const next = [...pageOrder];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  pageOrder = next;
  selectedIndex = toIndex;
  draggedIndex = null;
  renderThumbnails();
  renderPreview();
}

function selectRelative(direction) {
  selectIndex(selectedIndex + direction);
}

async function initializeEditor() {
  createIcons();
  setStatus("PDF를 불러오고 있습니다.");
  const init = await window.desktopAPI?.getPdfEditorInit?.();
  if (!init?.ok) {
    setStatus(init?.error || "PDF 편집 창을 준비하지 못했습니다.");
    return;
  }
  fileInfo = init.file;
  if (titleEl) titleEl.textContent = fileInfo.name || "PDF";
  if (outputNameInput && fileInfo.name) outputNameInput.value = fileInfo.name.replace(/\.pdf$/i, "_순서수정");

  const preview = await window.desktopAPI?.previewPdfEditor?.();
  if (!preview?.ok || !preview.base64) {
    setStatus(preview?.error || "PDF를 불러오지 못했습니다.");
    return;
  }

  const pdfjs = await loadPdfJsModule();
  const loadingTask = pdfjs.getDocument({
    data: base64ToUint8Array(preview.base64),
    isEvalSupported: false,
    useSystemFonts: true,
  });
  pdfDocument = await loadingTask.promise;
  pageOrder = Array.from({ length: pdfDocument.numPages }, (_item, index) => index + 1);
  selectedIndex = 0;
  if (metaEl) metaEl.textContent = `${preview.size || ""} · ${pdfDocument.numPages}쪽`;
  renderThumbnails();
  await renderPreview();
}

async function saveOrder() {
  if (!pageOrder.length) return;
  saveButton.disabled = true;
  setStatus("새 순서로 PDF를 저장하고 있습니다.");
  try {
    const result = await window.desktopAPI?.savePdfEditorOrder?.({
      order: pageOrder,
      outputName: outputNameInput?.value.trim() || "",
    });
    if (!result?.ok) {
      setStatus(result?.error || "PDF 저장에 실패했습니다.");
      return;
    }
    setStatus(`저장 완료: ${result.fileName} (${result.pageCount}쪽)`);
    if (metaEl) metaEl.textContent = `저장 위치: ${result.path}`;
  } catch (error) {
    setStatus(error?.message || String(error));
  } finally {
    saveButton.disabled = false;
  }
}

prevButton?.addEventListener("click", () => selectRelative(-1));
nextButton?.addEventListener("click", () => selectRelative(1));
resetButton?.addEventListener("click", () => {
  if (!pdfDocument) return;
  pageOrder = Array.from({ length: pdfDocument.numPages }, (_item, index) => index + 1);
  selectedIndex = 0;
  renderThumbnails();
  renderPreview();
});
closeButton?.addEventListener("click", () => {
  window.desktopAPI?.close?.();
});
saveButton?.addEventListener("click", saveOrder);
window.addEventListener("resize", () => renderPreview());

initializeEditor().catch((error) => setStatus(error?.message || String(error)));
