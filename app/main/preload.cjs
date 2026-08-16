const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  isDesktop: true,
  openChat(contactId) {
    return ipcRenderer.invoke("chat:open", contactId);
  },
  openProfile(contactId) {
    return ipcRenderer.invoke("profile:open", contactId);
  },
  closeProfiles() {
    return ipcRenderer.invoke("profile:close-all");
  },
  openContactConfig(contactId, mode) {
    return ipcRenderer.invoke("contact-config:open", { contactId, mode });
  },
  getContactConfig(contactId) {
    return ipcRenderer.invoke("contact-config:get", contactId);
  },
  saveContactConfig(contactId, config) {
    return ipcRenderer.invoke("contact-config:save", { contactId, config });
  },
  getChatMessages(contactId) {
    return ipcRenderer.invoke("chat:messages:get", contactId);
  },
  saveChatMessages(contactId, messages) {
    return ipcRenderer.invoke("chat:messages:save", { contactId, messages });
  },
  getChatSummaries() {
    return ipcRenderer.invoke("chat:summaries");
  },
  markChatRead(contactId) {
    return ipcRenderer.invoke("chat:mark-read", contactId);
  },
  getAppSettings() {
    return ipcRenderer.invoke("app-settings:get");
  },
  saveAppSettings(settings) {
    return ipcRenderer.invoke("app-settings:save", settings || {});
  },
  selectChatFiles(payload) {
    return ipcRenderer.invoke("chat:files:select", payload || {});
  },
  selectConverterFiles() {
    return ipcRenderer.invoke("converter:files:select");
  },
  selectDocumentResourceFile() {
    return ipcRenderer.invoke("document-resource:file-select");
  },
  analyzeDocumentResources(payload) {
    return ipcRenderer.invoke("document-resource:analyze", payload || {});
  },
  cancelDocumentResourceJob() {
    return ipcRenderer.invoke("document-resource:cancel");
  },
  previewDocumentResource(payload) {
    return ipcRenderer.invoke("document-resource:preview", payload || {});
  },
  saveDocumentResource(payload) {
    return ipcRenderer.invoke("document-resource:save-one", payload || {});
  },
  saveAllDocumentResources(payload) {
    return ipcRenderer.invoke("document-resource:save-all", payload || {});
  },
  clearDocumentResourceSession(payload) {
    return ipcRenderer.invoke("document-resource:session-clear", payload || {});
  },
  openDocumentResourceOutput() {
    return ipcRenderer.invoke("document-resource:open-output");
  },
  onDocumentResourceProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("document-resource:progress", listener);
    return () => ipcRenderer.removeListener("document-resource:progress", listener);
  },
  convertImages(payload) {
    return ipcRenderer.invoke("converter:image-convert", payload || {});
  },
  compressFiles(payload) {
    return ipcRenderer.invoke("converter:file-compress", payload || {});
  },
  mergePdfs(payload) {
    return ipcRenderer.invoke("converter:pdf-merge", payload || {});
  },
  splitPdf(payload) {
    return ipcRenderer.invoke("converter:pdf-split", payload || {});
  },
  openPdfEditor(payload) {
    return ipcRenderer.invoke("converter:pdf-editor-open", payload || {});
  },
  inspectPdf(payload) {
    return ipcRenderer.invoke("converter:pdf-inspect", payload || {});
  },
  previewPdf(payload) {
    return ipcRenderer.invoke("converter:pdf-preview", payload || {});
  },
  reorderPdf(payload) {
    return ipcRenderer.invoke("converter:pdf-reorder", payload || {});
  },
  getPdfEditorInit() {
    return ipcRenderer.invoke("pdf-editor:init");
  },
  previewPdfEditor() {
    return ipcRenderer.invoke("pdf-editor:preview");
  },
  savePdfEditorOrder(payload) {
    return ipcRenderer.invoke("pdf-editor:save-order", payload || {});
  },
  openConverterOutput(targetPath) {
    return ipcRenderer.invoke("converter:open-output", targetPath || "");
  },
  saveChartFile(payload) {
    return ipcRenderer.invoke("chart:file:save", payload || {});
  },
  savePresentationFile(payload) {
    return ipcRenderer.invoke("presentation:file:save", payload || {});
  },
  saveImageFile(payload) {
    return ipcRenderer.invoke("image:file:save", payload || {});
  },
  getWorkspaceSnapshot() {
    return ipcRenderer.invoke("workspace:snapshot");
  },
  indexWorkspace() {
    return ipcRenderer.invoke("workspace:index");
  },
  openWorkspace() {
    return ipcRenderer.invoke("workspace:open");
  },
  getCursorPosition() {
    return ipcRenderer.invoke("routine:cursor-position");
  },
  startRoutineRecording(payload) {
    return ipcRenderer.invoke("routine:recording-start", payload || {});
  },
  stopRoutineRecording() {
    return ipcRenderer.invoke("routine:recording-stop");
  },
  controlRoutineRecording(command) {
    return ipcRenderer.invoke("routine:recording-command", { command: String(command || "") });
  },
  onRoutineRecordingEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("routine:recording-event", listener);
    return () => ipcRenderer.removeListener("routine:recording-event", listener);
  },
  startRoutineExecution(payload) {
    return ipcRenderer.invoke("routine:execution-start", payload || {});
  },
  stopRoutineExecution() {
    return ipcRenderer.invoke("routine:execution-stop");
  },
  resolveRoutineApproval(payload) {
    return ipcRenderer.invoke("routine:execution-approval", payload || {});
  },
  onRoutineExecutionEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("routine:execution-event", listener);
    return () => ipcRenderer.removeListener("routine:execution-event", listener);
  },
  getSeries4Status() {
    return ipcRenderer.invoke("series4:status");
  },
  installSeries4() {
    return ipcRenderer.invoke("series4:install");
  },
  cancelSeries4Install() {
    return ipcRenderer.invoke("series4:install-cancel");
  },
  launchSeries4() {
    return ipcRenderer.invoke("series4:launch");
  },
  listSeries4Sessions() {
    return ipcRenderer.invoke("series4:sessions:list");
  },
  inspectSeries4Session(payload) {
    return ipcRenderer.invoke("series4:session:inspect", payload || {});
  },
  getSeries4VideoUrl(payload) {
    return ipcRenderer.invoke("series4:video-url", payload || {});
  },
  openSeries4Artifact(payload) {
    return ipcRenderer.invoke("series4:artifact:open", payload || {});
  },
  onSeries4Progress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("series4:progress", listener);
    return () => ipcRenderer.removeListener("series4:progress", listener);
  },
  checkFrustrationWebInput(payload) {
    return ipcRenderer.invoke("frustration:web-status", payload || {});
  },
  openFrustrationWebBrowser(payload) {
    return ipcRenderer.invoke("frustration:web-browser-open", payload || {});
  },
  startFrustrationWebInput(payload) {
    return ipcRenderer.invoke("frustration:web-input-start", payload || {});
  },
  stopFrustrationWebInput() {
    return ipcRenderer.invoke("frustration:web-input-stop");
  },
  listPrivacyWindows() {
    return ipcRenderer.invoke("privacy:windows:list");
  },
  inspectPrivacyWindows(payload) {
    return ipcRenderer.invoke("privacy:windows:inspect", payload || {});
  },
  inspectPrivacyFiles(payload) {
    return ipcRenderer.invoke("privacy:files:inspect", payload || {});
  },
  scanPrivacyText(payload) {
    return ipcRenderer.invoke("privacy:text:scan", payload || {});
  },
  onFrustrationWebInputEvent(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("frustration:web-input-event", listener);
    return () => ipcRenderer.removeListener("frustration:web-input-event", listener);
  },
  saveRoutineFile(payload) {
    return ipcRenderer.invoke("routine:file:save", payload || {});
  },
  loadRoutineFile() {
    return ipcRenderer.invoke("routine:file:load");
  },
  transcribeSpeech(payload) {
    return ipcRenderer.invoke("stt:transcribe", payload || {});
  },
  cancelSpeechTranscription() {
    return ipcRenderer.invoke("stt:transcribe-cancel");
  },
  getSttRuntimeStatus() {
    return ipcRenderer.invoke("stt:runtime-status");
  },
  selectSttAssetFile(payload) {
    return ipcRenderer.invoke("stt:asset:file-select", payload || {});
  },
  installSttAsset(payload) {
    return ipcRenderer.invoke("stt:asset:install", payload || {});
  },
  cancelSttAssetInstall(payload) {
    return ipcRenderer.invoke("stt:asset:install-cancel", payload || {});
  },
  onSttInstallProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("stt:asset:install-progress", listener);
    return () => ipcRenderer.removeListener("stt:asset:install-progress", listener);
  },
  onChatSessionsUpdated(callback) {
    const listener = (_event, summaries) => callback(summaries);
    ipcRenderer.on("chat:sessions-updated", listener);
    return () => ipcRenderer.removeListener("chat:sessions-updated", listener);
  },
  setChatReplyPending(payload) {
    return ipcRenderer.invoke("chat:reply-pending", payload || {});
  },
  notifyChatReplyComplete(payload) {
    return ipcRenderer.invoke("chat:reply-complete-notification", payload || {});
  },
  sendOfficerMessage(payload) {
    return ipcRenderer.invoke("llm:officer-message", payload);
  },
  igniteOfficer(payload) {
    return ipcRenderer.invoke("llm:ignite-officer", payload);
  },
  checkOfficerStatus() {
    return ipcRenderer.invoke("llm:status");
  },
  listLocalModels() {
    return ipcRenderer.invoke("llm:models:list");
  },
  selectLocalModel(model) {
    return ipcRenderer.invoke("llm:model:select", model);
  },
  pullLocalModel(model) {
    return ipcRenderer.invoke("llm:model:pull", model);
  },
  cancelLocalModelPull() {
    return ipcRenderer.invoke("llm:model:pull-cancel");
  },
  openOfficialLink(key) {
    return ipcRenderer.invoke("llm:official-link:open", key);
  },
  onLocalModelProgress(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("llm:model:pull-progress", listener);
    return () => ipcRenderer.removeListener("llm:model:pull-progress", listener);
  },
  onLocalModelChanged(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("llm:model-changed", listener);
    return () => ipcRenderer.removeListener("llm:model-changed", listener);
  },
  minimize() {
    ipcRenderer.send("window:minimize");
  },
  toggleMaximize() {
    ipcRenderer.send("window:maximize-toggle");
  },
  close() {
    ipcRenderer.send("window:close");
  },
  navigateMain(view) {
    ipcRenderer.send("main:navigate", view);
  },
  onNavigateMain(callback) {
    const listener = (_event, view) => callback(view);
    ipcRenderer.on("main:navigate", listener);
    return () => ipcRenderer.removeListener("main:navigate", listener);
  },
});
