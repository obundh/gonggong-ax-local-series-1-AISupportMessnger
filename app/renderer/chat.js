const DATA = window.HEYU_DATA;
const params = new URLSearchParams(window.location.search);
const contactId = params.get("id") || "chief";
const contact = DATA.contacts.find((item) => item.id === contactId) || DATA.contacts[0];
let messages = [...(DATA.messages[contact.id] || [])];
let isOfficerRuntimeOnline = false;
let officerRuntimeModel = "";

const topbar = document.querySelector("#chatTopbar");
const stream = document.querySelector("#messageStream");
const infoPopover = document.querySelector("#infoPopover");
const input = document.querySelector("#composerInput");
const attachmentsStrip = document.querySelector("#composerAttachments");
const attachButton = document.querySelector("#attachButton");
const graphControls = document.querySelector("#graphControls");
const graphXAxisInput = document.querySelector("#graphXAxis");
const graphYAxisInput = document.querySelector("#graphYAxis");
const graphChartTypeInput = document.querySelector("#graphChartType");
const presentationControls = document.querySelector("#presentationControls");
const pptSourceTypeInput = document.querySelector("#pptSourceType");
const pptSlideCountInput = document.querySelector("#pptSlideCount");
const pptAudienceInput = document.querySelector("#pptAudience");
const pptPurposeInput = document.querySelector("#pptPurpose");
const pptToneInput = document.querySelector("#pptTone");
const pptRatioInput = document.querySelector("#pptRatio");
const pptDetailLevelInput = document.querySelector("#pptDetailLevel");
const pptFontScaleInput = document.querySelector("#pptFontScale");
const pptThemeInput = document.querySelector("#pptTheme");
const routinePanel = document.querySelector("#routinePanel");
const imagePanel = document.querySelector("#imagePanel");
const sttPanel = document.querySelector("#sttPanel");
const converterPanel = document.querySelector("#converterPanel");
const documentResourcePanel = document.querySelector("#documentResourcePanel");
const documentResourceSelectButton = document.querySelector("#documentResourceSelectButton");
const documentResourceProgress = document.querySelector("#documentResourceProgress");
const documentResourceProgressLabel = document.querySelector("#documentResourceProgressLabel");
const documentResourceProgressValue = document.querySelector("#documentResourceProgressValue");
const documentResourceProgressBar = document.querySelector("#documentResourceProgressBar");
const documentResourceSummary = document.querySelector("#documentResourceSummary");
const documentResourceBrowser = document.querySelector("#documentResourceBrowser");
const documentResourceSearchInput = document.querySelector("#documentResourceSearch");
const documentResourceFilters = document.querySelector("#documentResourceFilters");
const documentResourceCount = document.querySelector("#documentResourceCount");
const documentResourceList = document.querySelector("#documentResourceList");
const documentResourceDetail = document.querySelector("#documentResourceDetail");
const documentResourcePreview = document.querySelector("#documentResourcePreview");
const documentResourceDetailName = document.querySelector("#documentResourceDetailName");
const documentResourceDetailCategory = document.querySelector("#documentResourceDetailCategory");
const documentResourceDetailSize = document.querySelector("#documentResourceDetailSize");
const documentResourceDetailPath = document.querySelector("#documentResourceDetailPath");
const documentResourceDetailUsage = document.querySelector("#documentResourceDetailUsage");
const documentResourcePreviewButton = document.querySelector("#documentResourcePreviewButton");
const documentResourceSaveButton = document.querySelector("#documentResourceSaveButton");
const documentResourceStatus = document.querySelector("#documentResourceStatus");
const documentResourceSaveAllButton = document.querySelector("#documentResourceSaveAllButton");
const documentResourceCancelButton = document.querySelector("#documentResourceCancelButton");
const documentResourceClearButton = document.querySelector("#documentResourceClearButton");
const documentResourceOpenOutputButton = document.querySelector("#documentResourceOpenOutputButton");
const imagePurposeInput = document.querySelector("#imagePurpose");
const imageRatioInput = document.querySelector("#imageRatio");
const imageSizeHintInput = document.querySelector("#imageSizeHint");
const imageStyleInput = document.querySelector("#imageStyle");
const imagePositivePromptInput = document.querySelector("#imagePositivePrompt");
const imageNegativePromptInput = document.querySelector("#imageNegativePrompt");
const imageClearButton = document.querySelector("#imageClearButton");
const imagePromptButton = document.querySelector("#imagePromptButton");
const sttStatus = document.querySelector("#sttStatus");
const sttStage = document.querySelector("#sttStage");
const sttStageStrip = document.querySelector("#sttStageStrip");
const sttTimer = document.querySelector("#sttTimer");
const sttRecordingBadge = document.querySelector("#sttRecordingBadge");
const sttRuntimeManager = document.querySelector("#sttRuntimeManager");
const sttRuntimeSummary = document.querySelector("#sttRuntimeSummary");
const sttAssetList = document.querySelector("#sttAssetList");
const sttInstallProgress = document.querySelector("#sttInstallProgress");
const sttInstallProgressLabel = document.querySelector("#sttInstallProgressLabel");
const sttInstallProgressValue = document.querySelector("#sttInstallProgressValue");
const sttInstallProgressBar = document.querySelector("#sttInstallProgressBar");
const sttInstallCancel = document.querySelector("#sttInstallCancel");
const sttLanguageInput = document.querySelector("#sttLanguage");
const sttModelInput = document.querySelector("#sttModel");
const sttResultModeInput = document.querySelector("#sttResultMode");
const sttInitialPromptInput = document.querySelector("#sttInitialPrompt");
const sttPromptCounter = document.querySelector("#sttPromptCounter");
const sttVadInput = document.querySelector("#sttVad");
const sttVadStatus = document.querySelector("#sttVadStatus");
const sttPerformanceWarning = document.querySelector("#sttPerformanceWarning");
const sttCapacityNote = document.querySelector("#sttCapacityNote");
const sttRetainAudioInput = document.querySelector("#sttRetainAudio");
const sttRecordButton = document.querySelector("#sttRecordButton");
const sttStopButton = document.querySelector("#sttStopButton");
const sttCancelButton = document.querySelector("#sttCancelButton");
const sttFileInput = document.querySelector("#sttFileInput");
const sttFileButton = document.querySelector("#sttFileButton");
const sttTranscriptInput = document.querySelector("#sttTranscript");
const sttOutputCard = document.querySelector("#sttOutputCard");
const sttOutputLinks = document.querySelector("#sttOutputLinks");
const sttApplyModeButton = document.querySelector("#sttApplyModeButton");
const sttRawButton = document.querySelector("#sttRawButton");
const sttCleanupButton = document.querySelector("#sttCleanupButton");
const sttMinutesButton = document.querySelector("#sttMinutesButton");
const sttTasksButton = document.querySelector("#sttTasksButton");
const sttPptButton = document.querySelector("#sttPptButton");
const converterSlots = document.querySelector("#converterSlots");
const converterAddButton = document.querySelector("#converterAddButton");
const converterClearButton = document.querySelector("#converterClearButton");
const converterImageFormatInput = document.querySelector("#converterImageFormat");
const converterQualityInput = document.querySelector("#converterQuality");
const converterBackgroundInput = document.querySelector("#converterBackground");
const converterPdfNameInput = document.querySelector("#converterPdfName");
const converterRunImageButton = document.querySelector("#converterRunImageButton");
const converterRunPdfButton = document.querySelector("#converterRunPdfButton");
const converterStatus = document.querySelector("#converterStatus");
const converterOpenOutputButton = document.querySelector("#converterOpenOutputButton");
const converterTabButtons = document.querySelectorAll("[data-converter-tab]");
const converterTabPanes = document.querySelectorAll("[data-converter-pane]");
const converterPdfMergeNameInput = document.querySelector("#converterPdfMergeName");
const converterPdfMergeNameMainInput = document.querySelector("#converterPdfMergeNameMain");
const converterRunPdfMergeButton = document.querySelector("#converterRunPdfMergeButton");
const converterRunPdfMergeButtonMain = document.querySelector("#converterRunPdfMergeButtonMain");
const converterPdfTargetFileInput = document.querySelector("#converterPdfTargetFile");
const converterPdfSplitRangesInput = document.querySelector("#converterPdfSplitRanges");
const converterPdfSplitNameInput = document.querySelector("#converterPdfSplitName");
const converterRunPdfSplitButton = document.querySelector("#converterRunPdfSplitButton");
const converterOpenPdfEditorButton = document.querySelector("#converterOpenPdfEditorButton");
const converterCompressTargetInput = document.querySelector("#converterCompressTarget");
const converterCompressLevelInput = document.querySelector("#converterCompressLevel");
const converterCompressQualityInput = document.querySelector("#converterCompressQuality");
const converterCompressMaxDimensionInput = document.querySelector("#converterCompressMaxDimension");
const converterRunCompressButton = document.querySelector("#converterRunCompressButton");
const converterPdfOrderFileInput = document.querySelector("#converterPdfOrderFile");
const converterPdfOrderSummary = document.querySelector("#converterPdfOrderSummary");
const converterPdfOrderInput = document.querySelector("#converterPdfOrderInput");
const converterPdfOrderNameInput = document.querySelector("#converterPdfOrderName");
const converterPdfOrderOriginalButton = document.querySelector("#converterPdfOrderOriginalButton");
const converterPdfOrderReverseButton = document.querySelector("#converterPdfOrderReverseButton");
const converterPdfOrderOddEvenButton = document.querySelector("#converterPdfOrderOddEvenButton");
const converterInspectPdfButton = document.querySelector("#converterInspectPdfButton");
const converterRunPdfOrderButton = document.querySelector("#converterRunPdfOrderButton");
const converterPreviewPdfButton = document.querySelector("#converterPreviewPdfButton");
const converterPdfPreviewCanvas = document.querySelector("#converterPdfPreviewCanvas");
const converterPdfPreviewStatus = document.querySelector("#converterPdfPreviewStatus");
const converterPdfPreviewPageLabel = document.querySelector("#converterPdfPreviewPageLabel");
const converterPdfPreviewPrevButton = document.querySelector("#converterPdfPreviewPrevButton");
const converterPdfPreviewNextButton = document.querySelector("#converterPdfPreviewNextButton");
const routineTabs = document.querySelectorAll("[data-routine-tab]");
const routinePanes = document.querySelectorAll("[data-routine-pane]");
const routineLivePoint = document.querySelector("#routineLivePoint");
const routineCaptureButton = document.querySelector("#routineCaptureButton");
const routineCaptureLabel = document.querySelector("#routineCaptureLabel");
const routineCaptureDelayInput = document.querySelector("#routineCaptureDelay");
const routineActionTypeInput = document.querySelector("#routineActionType");
const routineStepRepeatInput = document.querySelector("#routineStepRepeat");
const routineXInput = document.querySelector("#routineX");
const routineYInput = document.querySelector("#routineY");
const routineX2Input = document.querySelector("#routineX2");
const routineY2Input = document.querySelector("#routineY2");
const routineWaitSecondsInput = document.querySelector("#routineWaitSeconds");
const routineDurationSecondsInput = document.querySelector("#routineDurationSeconds");
const routineStepValueInput = document.querySelector("#routineStepValue");
const routineWindowTitleInput = document.querySelector("#routineWindowTitle");
const routineOutputInput = document.querySelector("#routineOutput");
const routineRiskInput = document.querySelector("#routineRisk");
const routineRepeatInput = document.querySelector("#routineRepeat");
const routineStopInput = document.querySelector("#routineStop");
const routineStepList = document.querySelector("#routineStepList");
const routineAddStepButton = document.querySelector("#routineAddStepButton");
const routineUpdateStepButton = document.querySelector("#routineUpdateStepButton");
const routineClearButton = document.querySelector("#routineClearButton");
const routineApplyButton = document.querySelector("#routineApplyButton");
const routineRunDelayInput = document.querySelector("#routineRunDelay");
const routineRunRepeatInput = document.querySelector("#routineRunRepeat");
const routineRunForeverInput = document.querySelector("#routineRunForever");
const routineRunStatus = document.querySelector("#routineRunStatus");
const routineRunButton = document.querySelector("#routineRunButton");
const routineRunStopButton = document.querySelector("#routineRunStopButton");
const routineApprovalCard = document.querySelector("#routineApprovalCard");
const routineApprovalTitle = document.querySelector("#routineApprovalTitle");
const routineApprovalHelp = document.querySelector("#routineApprovalHelp");
const routineApprovalRejectButton = document.querySelector("#routineApprovalRejectButton");
const routineApprovalApproveButton = document.querySelector("#routineApprovalApproveButton");
const routineSaveButton = document.querySelector("#routineSaveButton");
const routineLoadButton = document.querySelector("#routineLoadButton");
const routineAutoModeInput = document.querySelector("#routineAutoMode");
const routineAutoTaskInput = document.querySelector("#routineAutoTask");
const routineAutoRepeatInput = document.querySelector("#routineAutoRepeat");
const routineAutoCautionInput = document.querySelector("#routineAutoCaution");
const routineRecordDelayInput = document.querySelector("#routineRecordDelay");
const routineRecordStatus = document.querySelector("#routineRecordStatus");
const routineRecordButton = document.querySelector("#routineRecordButton");
const routineRecordStopButton = document.querySelector("#routineRecordStopButton");
const routineAutoPromptButton = document.querySelector("#routineAutoPromptButton");
const series4EngineStatus = document.querySelector("#series4EngineStatus");
const series4EngineVersion = document.querySelector("#series4EngineVersion");
const series4EngineHelp = document.querySelector("#series4EngineHelp");
const series4InstallButton = document.querySelector("#series4InstallButton");
const series4CancelInstallButton = document.querySelector("#series4CancelInstallButton");
const series4LaunchButton = document.querySelector("#series4LaunchButton");
const series4ProgressWrap = document.querySelector("#series4ProgressWrap");
const series4Progress = document.querySelector("#series4Progress");
const series4ProgressText = document.querySelector("#series4ProgressText");
const series4ProgressValue = document.querySelector("#series4ProgressValue");
const series4RefreshButton = document.querySelector("#series4RefreshButton");
const series4SessionCount = document.querySelector("#series4SessionCount");
const series4SessionList = document.querySelector("#series4SessionList");
const series4SessionReview = document.querySelector("#series4SessionReview");
const series4ReviewTitle = document.querySelector("#series4ReviewTitle");
const series4ReviewDuration = document.querySelector("#series4ReviewDuration");
const series4ReviewMeta = document.querySelector("#series4ReviewMeta");
const series4ReviewCounts = document.querySelector("#series4ReviewCounts");
const series4VideoReview = document.querySelector("#series4VideoReview");
const series4VideoPreview = document.querySelector("#series4VideoPreview");
const series4Timeline = document.querySelector("#series4Timeline");
const series4TimelineTrack = document.querySelector("#series4TimelineTrack");
const series4OpenVideoButton = document.querySelector("#series4OpenVideoButton");
const series4OpenFolderButton = document.querySelector("#series4OpenFolderButton");
const frustrationPanel = document.querySelector("#frustrationPanel");
const frustrationSourceInput = document.querySelector("#frustrationSource");
const frustrationSampleButton = document.querySelector("#frustrationSampleButton");
const frustrationParseButton = document.querySelector("#frustrationParseButton");
const frustrationPromptButton = document.querySelector("#frustrationPromptButton");
const frustrationBlockList = document.querySelector("#frustrationBlockList");
const frustrationDriverInput = document.querySelector("#frustrationDriver");
const frustrationWebPortInput = document.querySelector("#frustrationWebPort");
const frustrationWebTargetInput = document.querySelector("#frustrationWebTarget");
const frustrationOpenBrowserButton = document.querySelector("#frustrationOpenBrowserButton");
const frustrationCheckWebButton = document.querySelector("#frustrationCheckWebButton");
const frustrationRunDelayInput = document.querySelector("#frustrationRunDelay");
const frustrationStepDelayInput = document.querySelector("#frustrationStepDelay");
const frustrationRunStatus = document.querySelector("#frustrationRunStatus");
const frustrationRunParagraphsButton = document.querySelector("#frustrationRunParagraphsButton");
const frustrationRunTableButton = document.querySelector("#frustrationRunTableButton");
const frustrationStopButton = document.querySelector("#frustrationStopButton");
const privacyPanel = document.querySelector("#privacyPanel");
const privacyModeToggle = document.querySelector("#privacyModeToggle");
const privacyModeLabel = document.querySelector("#privacyModeLabel");
const privacyModeHelp = document.querySelector("#privacyModeHelp");
const privacyRefreshWindowsButton = document.querySelector("#privacyRefreshWindowsButton");
const privacyInspectWindowsButton = document.querySelector("#privacyInspectWindowsButton");
const privacyWindowList = document.querySelector("#privacyWindowList");
const privacyStatus = document.querySelector("#privacyStatus");
const privacyManualTextInput = document.querySelector("#privacyManualText");
const privacyScanTextButton = document.querySelector("#privacyScanTextButton");
const privacyResultList = document.querySelector("#privacyResultList");
const sendButton = document.querySelector("#sendButton");
const CONTEXT_LEVELS = {
  veryLow: { label: "매우낮음", numCtx: 1024 },
  low: { label: "낮음", numCtx: 2048 },
  medium: { label: "중간", numCtx: 4096 },
  high: { label: "높음", numCtx: 8192 },
};
const contextStorageKey = `local-ai-messenger:context-level:${contact.id}`;
const privacyModeStorageKey = `local-ai-messenger:privacy-mode:${contact.id}`;
let isSending = false;
let isIgniting = false;
let currentContextLevel = loadContextLevel();
let pendingFiles = [];
let converterFiles = [];
let lastConverterOutputPath = "";
let converterPdfInfo = null;
let converterPdfPreviewState = {
  fileKey: "",
  pdf: null,
  page: 1,
  pageCount: 0,
  rendering: false,
};
let pdfJsModulePromise = null;
let routineCursor = null;
let routineCursorTimer = null;
let routineCaptureTimer = null;
let routineCaptureCountdownTimer = null;
let routineSteps = [];
let routineEditingStepId = null;
let routineActiveTab = "direct";
let routineAutoIntroShown = false;
let isRoutineRecording = false;
let isRoutineExecuting = false;
let routinePendingApprovalToken = "";
let routineApprovalBusy = false;
let disposeRoutineRecordingEvent = null;
let disposeRoutineExecutionEvent = null;
let series4SetupDone = false;
let series4StatusSnapshot = null;
let series4Sessions = [];
let series4SelectedHandle = "";
let series4IsInstalling = false;
let series4IsRefreshing = false;
let disposeSeries4Progress = null;
const ROUTINE_DESIGN_ONLY_ACTIONS = new Set([
  "waitImage",
  "clickImage",
  "locateImage",
  "waitText",
  "colorWait",
  "focusWindow",
  "runCommand",
  "closeWindow",
  "loopStart",
  "loopEnd",
  "ifImage",
  "ifText",
  "errorStop",
]);
const SERIES4_EVENT_LABELS = Object.freeze({
  textentry: "텍스트 입력",
  keystroke: "키 입력",
  mouseleftclick: "왼쪽 클릭",
  mouserightclick: "오른쪽 클릭",
  mousemiddleclick: "가운데 클릭",
  mousedrag: "드래그",
  click: "클릭",
  doubleclick: "더블클릭",
  mousedown: "누름",
  mouseup: "놓음",
  mousemove: "이동",
  mousewheel: "휠",
  scroll: "스크롤",
  drag: "드래그",
  keydown: "키 누름",
  keyup: "키 놓음",
  keyboard: "키보드",
  mouse: "마우스",
  other: "기타",
});
let frustrationBlocks = [];
let frustrationSelectedBlockId = "";
let isFrustrationExecuting = false;
let disposeFrustrationExecutionEvent = null;
let disposeFrustrationWebInputEvent = null;
let privacyWindows = [];
let privacyResults = [];
let privacyMode = loadPrivacyMode();
let isPrivacyBusy = false;
let documentResourceSessionId = "";
let documentResourceFile = null;
let documentResources = [];
let documentResourceCategory = "all";
let documentResourceSelectedId = "";
let isDocumentResourceBusy = false;
let isDocumentResourceCancelPending = false;
let disposeDocumentResourceProgress = null;
let sttStream = null;
let sttAudioContext = null;
let sttSourceNode = null;
let sttProcessorNode = null;
let sttAudioChunks = [];
let sttRecordingStartedAt = 0;
let sttTimerId = null;
let isSttRecording = false;
let isSttTranscribing = false;
let isSttWhisperActive = false;
let isSttCancelPending = false;
let lastSttTranscript = "";
let activeSttInstallAssetId = "";
let disposeSttInstallProgress = null;
const STT_WAV_SAMPLE_RATE = 16000;
const STT_WAV_BYTES_PER_SECOND = STT_WAV_SAMPLE_RATE * 2;
const STT_WAV_HEADER_BYTES = 44;
let currentSttStageKey = "idle";
let isSttRuntimeReady = null;
let hasSttProfileChoice = false;
let lastSttPerformanceNotice = null;
let appSettings = {
  limits: {
    sttAudioMb: 120,
  },
};

const ROUTINE_AUTO_MESSAGES = [
  { weight: 4, text: "자동 설정에서는 Series 4로 실제 흐름을 한 번 기록하고, 영상과 입력 시점을 함께 검토할 수 있습니다. 비밀번호나 민감정보를 입력하기 전에는 녹화를 끝내주세요." },
  { weight: 3, text: "반복할 화면이 고정돼 있다면 Series 4 기록이 빠릅니다. 창 위치, 해상도, 배율이 바뀌면 좌표 재생이 어긋날 수 있으니 작은 범위부터 시험하겠습니다." },
  { weight: 3, text: "저장, 제출, 삭제처럼 되돌리기 어려운 동작은 직접 설정의 사용자 승인 단계로 분리하세요. 승인 전에는 실행기가 실제로 멈춰 기다립니다." },
  { weight: 2, text: "OCR이나 화면 요소 인식이 필요한 흐름은 현재 자동 실행으로 보지 않겠습니다. Series 4 기록과 직접 단계 편집 중 맞는 쪽부터 고르죠." },
];

const ROUTINE_RECORDING_MESSAGES = [
  { weight: 22, text: "{delay}초 후에 녹화를 시작합니다. 준비하세요. 비밀번호나 인증서 암호 입력 구간은 건너뛰는 게 좋습니다." },
  { weight: 18, text: "좋습니다. {delay}초 뒤부터 사용자의 클릭과 키 입력을 기록하겠습니다. 저장이나 제출은 나중에 확인 지점으로 분리하겠습니다." },
  { weight: 14, text: "{delay}초 뒤 녹화 들어갑니다. 실제 업무 흐름을 한 번 보여주시면 김루틴이 단계표로 정리하겠습니다." },
  { weight: 11, text: "자동 루틴 녹화를 준비합니다. {delay}초 뒤 시작하니 대상 프로그램으로 마우스를 옮겨주세요." },
  { weight: 9, text: "{delay}초 후 기록을 시작합니다. 불필요한 마우스 이동은 나중에 덜어내고 핵심 클릭과 키 입력만 남기겠습니다." },
  { weight: 8, text: "녹화 대기 {delay}초입니다. 팝업 확인, 엔터, 스페이스 같은 키 입력도 단계로 잡아보겠습니다." },
  { weight: 6, text: "{delay}초 뒤부터 따라가겠습니다. 민감한 텍스트가 들어가면 녹화 종료 후 단계에서 지워주세요." },
  { weight: 5, text: "좋아요. {delay}초 후 녹화 시작입니다. 반복할 흐름을 한 번만 자연스럽게 수행해주세요." },
  { weight: 4, text: "{delay}초 후 시작합니다. 클릭할 창이 가려져 있으면 미리 앞으로 가져와주세요." },
  { weight: 3, text: "자동 설정 녹화 준비 완료. {delay}초 뒤에 출발합니다." },
  { weight: 12, text: "{delay}초 뒤 기록합니다. 평소 하던 속도 그대로 한 번만 보여주시면 됩니다." },
  { weight: 10, text: "녹화 준비됐습니다. {delay}초 뒤부터 클릭, 키 입력, 스크롤을 순서대로 잡겠습니다." },
  { weight: 9, text: "{delay}초 뒤 시작합니다. 중간에 실수해도 종료 후 단계 목록에서 지우거나 고치면 됩니다." },
  { weight: 8, text: "좋습니다. {delay}초 뒤 기록 시작입니다. 마지막 제출이나 삭제는 가능하면 누르지 말고 멈춰주세요." },
  { weight: 7, text: "{delay}초 뒤 따라가겠습니다. 반복할 부분을 한 번만 차분히 수행해주세요." },
  { weight: 6, text: "녹화 대기 중입니다. {delay}초 뒤 시작하면 대상 화면에서 자연스럽게 진행해주세요." },
  { weight: 5, text: "{delay}초 뒤 출발합니다. 입력값이 민감하면 임시 텍스트로 바꿔서 보여주는 편이 좋습니다." },
  { weight: 5, text: "좋아요. {delay}초 뒤부터 루틴 뼈대를 잡겠습니다. 나중에 단계별로 좌표와 초 수를 수정할 수 있습니다." },
  { weight: 4, text: "{delay}초 뒤 시작합니다. 팝업이 뜨는 구간은 그대로 보여주면 확인 단계로 남기겠습니다." },
  { weight: 3, text: "준비 완료. {delay}초 뒤부터 기록하고, 끝나면 직접 설정 탭에 단계로 정리해두겠습니다." },
];

const ROUTINE_EXECUTION_MESSAGES = [
  { weight: 18, text: "{delay}초 뒤 실행합니다. 급하게 멈춰야 하면 실행 중지를 누르거나 마우스를 화면 왼쪽 위 모서리로 보내세요." },
  { weight: 14, text: "좋습니다. {delay}초 뒤 루틴을 실행합니다. 대상 창이 앞에 떠 있는지만 확인해주세요." },
  { weight: 12, text: "{delay}초 뒤 시작합니다. 실행 중에는 마우스와 키보드를 잠깐 맡겨주세요." },
  { weight: 10, text: "루틴 실행 준비 완료. {delay}초 뒤 첫 단계부터 순서대로 진행하겠습니다." },
  { weight: 9, text: "{delay}초 뒤 실행 들어갑니다. 저장이나 제출 단계가 있으면 미리 단계 목록을 한 번 더 확인해주세요." },
  { weight: 8, text: "좋아요. {delay}초 후 실행합니다. 중간에 예상과 다르면 바로 실행 중지를 누르면 됩니다." },
  { weight: 7, text: "{delay}초 뒤 루틴을 돌립니다. 화면 배율이나 창 위치가 바뀌었으면 좌표를 먼저 확인해주세요." },
  { weight: 6, text: "실행 준비됐습니다. {delay}초 뒤 시작하고, 완료되면 결과를 상태창에 남기겠습니다." },
  { weight: 5, text: "{delay}초 뒤 출발합니다. 지금은 등록된 단계만 수행하고 고급 OCR 단계는 건너뜁니다." },
  { weight: 4, text: "좋습니다. {delay}초 뒤 매크로를 실행합니다. 커서는 자동으로 이동할 수 있습니다." },
];

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

function avatarMarkup(item, size = "md") {
  const profileAttr = item.id ? ` data-open-profile="${escapeHtml(item.id)}" role="button" tabindex="0"` : "";
  const statusModifier = statusClass(item);
  if (item.avatarImage) {
    const fallback = item.avatarFallback ? ` data-avatar-fallback="${escapeHtml(item.avatarFallback)}"` : "";
    return `
      <div class="avatar avatar-${size} avatar-image" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}" title="${escapeHtml(item.name || "")}"${profileAttr}>
        <img class="avatar-photo" src="${escapeHtml(item.avatarImage)}" alt=""${fallback} />
        <span class="status-dot ${statusModifier}"></span>
      </div>
    `;
  }

  const label = item.avatar === "group" ? "users-round" : item.avatar === "human" || item.avatar === "human-female" ? "user-round" : "bot";
  return `
    <div class="avatar avatar-${size} avatar-${escapeHtml(item.avatar || "bot")}" style="--avatar-bg:${escapeHtml(item.color || "#e8edf5")}"${profileAttr}>
      <i data-lucide="${label}"></i>
      <span class="status-dot ${statusModifier}"></span>
    </div>
  `;
}

function tagMarkup(item) {
  return `<span class="tag tag-${escapeHtml(item.tagType || "plain")}">${escapeHtml(item.tag)}</span>`;
}

function loadContextLevel() {
  try {
    const saved = window.localStorage?.getItem(contextStorageKey);
    if (saved && CONTEXT_LEVELS[saved]) return saved;
  } catch (_error) {
    return "medium";
  }
  return "medium";
}

function saveContextLevel(level) {
  currentContextLevel = CONTEXT_LEVELS[level] ? level : "medium";
  try {
    window.localStorage?.setItem(contextStorageKey, currentContextLevel);
  } catch (_error) {
    // Local storage can be unavailable in restricted environments.
  }
}

function loadPrivacyMode() {
  try {
    const saved = window.localStorage?.getItem(privacyModeStorageKey);
    if (saved === "chat" || saved === "scan") return saved;
  } catch (_error) {
    return "chat";
  }
  return "chat";
}

function savePrivacyMode(mode) {
  privacyMode = mode === "chat" ? "chat" : "scan";
  try {
    window.localStorage?.setItem(privacyModeStorageKey, privacyMode);
  } catch (_error) {
    // 저장소를 쓸 수 없으면 이 창에서 선택한 모드만 유지합니다.
  }
}

function currentContext() {
  return CONTEXT_LEVELS[currentContextLevel] || CONTEXT_LEVELS.medium;
}

function runtimeModelBadge() {
  const statusClassName = isOfficerRuntimeOnline ? "" : " is-offline";
  const label = officerRuntimeModel ? `Ollama · ${officerRuntimeModel}` : "로컬 LLM 설정";
  return `
    <button class="runtime-model-badge${statusClassName}" type="button" data-open-model-picker aria-label="${escapeHtml(label)} — 눌러서 모델 설정" title="메인 창에서 로컬 LLM 모델 설정">
      <i data-lucide="cpu"></i>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function isCasualContact() {
  return contact?.persona?.speechStyle === "casual";
}

function renderTopbar() {
  const displayStatusLabel = statusLabel(contact);
  const displayStatusClass = statusClass(contact);
  const context = currentContext();
  topbar.innerHTML = `
    ${avatarMarkup(contact, "lg")}
    <div class="chat-title">
      <div>
        <strong>${escapeHtml(contact.name)}</strong>
        <span class="online-label ${displayStatusClass}">
          <span></span>
          ${displayStatusLabel}
        </span>
        ${runtimeModelBadge()}
      </div>
      <p>${escapeHtml(contact.department)}</p>
    </div>
    <div class="topbar-actions">
      <div class="context-control">
        <button class="context-button raised" type="button" id="contextButton" aria-label="생각 수준" aria-expanded="false" title="생각 수준: ${escapeHtml(context.label)} (${context.numCtx})">
          <i data-lucide="brain"></i>
          <span>${escapeHtml(context.label)}</span>
        </button>
        <div class="context-menu" id="contextMenu" hidden>
          ${Object.entries(CONTEXT_LEVELS)
            .map(
              ([key, item]) => `
                <button class="context-option ${key === currentContextLevel ? "is-active" : ""}" type="button" data-context-level="${key}">
                  <span>${escapeHtml(item.label)}</span>
                  <small>${item.numCtx}</small>
                </button>
              `
            )
            .join("")}
        </div>
      </div>
      <button class="icon-button raised ignite-button" type="button" id="igniteButton" aria-label="출근했는지 알아보기" title="출근했는지 알아보기">
        <i data-lucide="sparkles"></i>
      </button>
      <button class="icon-button raised info-button" type="button" id="infoButton" aria-label="대화방 정보" aria-expanded="false" title="대화방 정보">
        <i data-lucide="info"></i>
      </button>
    </div>
  `;
  document.querySelector("#infoButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    setInfoOpen(infoPopover?.hidden ?? true);
  });
  document.querySelector("#igniteButton")?.addEventListener("click", (event) => {
    event.stopPropagation();
    igniteOfficer();
  });
  document.querySelector("[data-open-model-picker]")?.addEventListener("click", (event) => {
    event.stopPropagation();
    window.desktopAPI?.navigateMain?.("models");
  });
  bindContextControl();
  bindOpenProfiles();
  createIcons();
}

function bindContextControl() {
  const button = document.querySelector("#contextButton");
  const menu = document.querySelector("#contextMenu");
  if (!button || !menu) return;

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const isOpen = menu.hidden;
    menu.hidden = !isOpen;
    button.classList.toggle("is-active", isOpen);
    button.setAttribute("aria-expanded", String(isOpen));
    createIcons();
  });

  menu.querySelectorAll("[data-context-level]").forEach((option) => {
    option.addEventListener("click", (event) => {
      event.stopPropagation();
      saveContextLevel(option.dataset.contextLevel);
      renderTopbar();
    });
  });
}

function closeContextMenu() {
  const menu = document.querySelector("#contextMenu");
  const button = document.querySelector("#contextButton");
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  button?.classList.remove("is-active");
  button?.setAttribute("aria-expanded", "false");
}

function renderMessages() {
  stream.innerHTML = messages.map((message, index) => messageMarkup(message, index)).join("") + typingMarkup();
  bindOpenProfiles();
  createIcons();
  bindMessageActions();
  bindChartDownloads();
  bindPresentationDownloads();
  bindImageDownloads();
  stream.scrollTop = stream.scrollHeight;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function persistMessages() {
  if (!window.desktopAPI?.saveChatMessages) return;
  window.desktopAPI.saveChatMessages(contact.id, messages).catch(() => {
    // Session persistence is best-effort during the current test stage.
  });
}

function setReplyPending(pending) {
  window.desktopAPI?.setChatReplyPending?.({
    contactId: contact.id,
    pending: Boolean(pending),
  }).catch(() => {
    // Notification state is best-effort.
  });
}

function previewReplyForNotification(message) {
  if (!message) return "답변이 도착했습니다.";
  if (message.error) return "답변 처리 중 확인이 필요한 오류가 있습니다.";
  if (message.presentation?.title) return `웹 발표자료 생성 완료: ${message.presentation.title}`;
  if (message.chart?.title) return `그래프 생성 완료: ${message.chart.title}`;
  if (message.image?.title) return message.image.statusLabel || message.image.title;
  return String(message.text || "답변이 도착했습니다.").replace(/\s+/g, " ").trim().slice(0, 180) || "답변이 도착했습니다.";
}

function notifyReplyComplete(message) {
  window.desktopAPI?.notifyChatReplyComplete?.({
    contactId: contact.id,
    contactName: contact.name,
    body: previewReplyForNotification(message),
  }).catch(() => {
    // Native notifications are optional.
  });
}

async function loadSessionMessages() {
  if (!window.desktopAPI?.getChatMessages) {
    renderMessages();
    return;
  }

  try {
    const stored = await window.desktopAPI.getChatMessages(contact.id);
    if (Array.isArray(stored) && stored.length) {
      messages = stored;
    }
    await window.desktopAPI.markChatRead?.(contact.id);
  } catch (_error) {
    // Fall back to bundled initial messages if the desktop bridge is unavailable.
  } finally {
    renderMessages();
  }
}

function messageMarkup(message, index = 0) {
  const mine = message.from === "me";
  if (message.summary) {
    return `
      <article class="message-row">
        ${avatarMarkup(contact, "sm")}
        <div class="summary-card">
          <div class="summary-title"><i data-lucide="file-text"></i><strong>핵심 요약</strong></div>
          <ul>${message.summary.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
        </div>
        <time>${escapeHtml(message.time)}</time>
      </article>
    `;
  }

  return `
    <article class="message-row ${mine ? "is-mine" : ""}">
      ${mine ? "" : avatarMarkup(contact, "sm")}
      ${mine ? messageMetaMarkup(message) : ""}
      <div class="message-stack">
        ${mine ? "" : `<strong>${escapeHtml(contact.name)}</strong>`}
        <div class="bubble ${message.error ? "is-error" : ""}">${escapeHtml(message.text).replaceAll("\n", "<br />")}</div>
        ${message.attachment ? attachmentMarkup(message.attachment) : ""}
        ${message.attachments?.length ? attachmentsMarkup(message.attachments) : ""}
        ${message.chart ? chartMarkup(message.chart) : ""}
        ${message.presentation ? presentationMarkup(message.presentation) : ""}
        ${message.image ? imageGenerationMarkup(message.image) : ""}
        ${message.actions?.length ? messageActionsMarkup(message.actions, index) : ""}
      </div>
      ${mine ? "" : messageMetaMarkup(message)}
    </article>
  `;
}

function messageActionsMarkup(actions, messageIndex) {
  return `
    <div class="message-actions">
      ${actions
        .map((action, actionIndex) => `
          <button
            class="message-action-button ${action.style === "primary" ? "is-primary" : ""}"
            type="button"
            data-message-index="${escapeHtml(messageIndex)}"
            data-action-index="${escapeHtml(actionIndex)}"
            ${action.disabled ? "disabled" : ""}
          >
            ${escapeHtml(action.label || "확인")}
          </button>
        `)
        .join("")}
    </div>
  `;
}

function messageMetaMarkup(message) {
  return `
    <div class="message-meta">
      ${message.unreadCount ? `<span class="read-count">${escapeHtml(message.unreadCount)}</span>` : ""}
      <time>${escapeHtml(message.time)}</time>
    </div>
  `;
}

function attachmentMarkup(file) {
  const type = file.type === "word" ? "W" : file.type === "excel" ? "X" : file.type === "pdf" ? "PDF" : "F";
  return `
    <div class="attachment-card">
      <span class="file-icon file-${file.type}">${type}</span>
      <div>
        <strong>${escapeHtml(file.name)}</strong>
        <p>${escapeHtml(file.size)} · ${file.type === "word" ? "워드 문서" : "첨부 파일"}</p>
      </div>
      <button class="icon-button" type="button" aria-label="저장"><i data-lucide="download"></i></button>
    </div>
  `;
}

function attachmentsMarkup(files) {
  return `
    <div class="attachment-list">
      ${files.map((file) => attachmentMarkup(file)).join("")}
    </div>
  `;
}

function chartMarkup(chart) {
  return `
    <div class="chart-card">
      <div class="chart-header">
        <strong>${escapeHtml(chart.title || "그래프")}</strong>
        <div class="chart-actions">
          <span>${escapeHtml(chart.type === "line" ? "선그래프" : "막대그래프")}</span>
          <button class="icon-button chart-download-button" type="button" data-download-chart="${escapeHtml(chart.id || "")}" aria-label="그래프 다운로드" title="그래프 다운로드">
            <i data-lucide="download"></i>
          </button>
        </div>
      </div>
      <div class="chart-svg">${chart.svg || ""}</div>
      <p>${escapeHtml(chart.fileName || "")}${chart.sheetName ? ` · ${escapeHtml(chart.sheetName)}` : ""}${chart.rowCount ? ` · ${escapeHtml(chart.shownRowCount || chart.rowCount)} / ${escapeHtml(chart.rowCount)}행` : ""}</p>
    </div>
  `;
}

function presentationMarkup(presentation) {
  const format = String(presentation.format || "html").toLowerCase();
  const isWebDeck = format === "html" || presentation.mimeType?.includes("html");
  const formatLabel = isWebDeck ? "웹 발표자료" : "PPTX";
  const fallbackFileName = isWebDeck ? "presentation.html" : "presentation.pptx";
  return `
    <div class="presentation-card ${isWebDeck ? "is-webdeck" : ""}">
      <div class="presentation-file-icon">
        <i data-lucide="${isWebDeck ? "layout-dashboard" : "presentation"}"></i>
      </div>
      <div class="presentation-file-body">
        <strong>${escapeHtml(presentation.title || formatLabel)}</strong>
        <p>${escapeHtml(presentation.fileName || fallbackFileName)} · ${escapeHtml(presentation.slideCount || 0)}장 · ${formatLabel}</p>
        ${presentation.workspacePath ? `<small>${escapeHtml(presentation.workspacePath)}</small>` : ""}
        ${presentation.sourceNote ? `<small>${escapeHtml(presentation.sourceNote)}</small>` : ""}
      </div>
      <button class="icon-button presentation-download-button" type="button" data-download-presentation="${escapeHtml(presentation.id || "")}" aria-label="${formatLabel} 다운로드" title="${formatLabel} 다운로드">
        <i data-lucide="download"></i>
      </button>
    </div>
  `;
}

function imageGenerationMarkup(image) {
  const statusClass = image.status === "generated"
    ? "is-ready"
    : image.status === "generation-failed"
      ? "is-error"
      : "is-waiting";
  const canDownload = Boolean(image.base64);
  return `
    <div class="image-generation-card ${canDownload ? "" : "has-no-download"}">
      <div class="image-generation-preview ${canDownload ? "" : "is-empty"}">
        ${
          canDownload
            ? `<img src="data:${escapeHtml(image.mimeType || "image/png")};base64,${escapeHtml(image.base64)}" alt="${escapeHtml(image.title || "생성 이미지")}" />`
            : `<i data-lucide="image-plus"></i>`
        }
      </div>
      <div class="image-generation-body">
        <div class="image-generation-title">
          <strong>${escapeHtml(image.title || "김그림 이미지 생성")}</strong>
          <span class="${statusClass}">${escapeHtml(image.statusLabel || image.status || "대기")}</span>
        </div>
        <p>${escapeHtml(image.message || "이미지 생성 상태를 확인했습니다.")}</p>
        <dl>
          <dt>생성 프롬프트</dt><dd>${escapeHtml(image.prompt || image.sourcePrompt || "")}</dd>
          <dt>실행기</dt><dd>${escapeHtml(image.provider || "local")}${image.modelName ? ` · ${escapeHtml(image.modelName)}` : ""}</dd>
          <dt>크기</dt><dd>${escapeHtml(image.width || 0)} x ${escapeHtml(image.height || 0)}</dd>
          ${image.settings ? `<dt>생성 설정</dt><dd>${escapeHtml(formatImageSettings(image.settings))}</dd>` : ""}
          ${image.workspacePath ? `<dt>저장 위치</dt><dd>${escapeHtml(image.workspacePath)}</dd>` : ""}
          ${!image.workspacePath && image.modelDir ? `<dt>모델 폴더</dt><dd>${escapeHtml(image.modelDir)}</dd>` : ""}
          ${!image.workspacePath && image.runtimeDir ? `<dt>실행기 폴더</dt><dd>${escapeHtml(image.runtimeDir)}</dd>` : ""}
          ${!image.workspacePath && image.extraModelPathsConfig ? `<dt>Comfy 설정</dt><dd>${escapeHtml(image.extraModelPathsConfig)}</dd>` : ""}
        </dl>
        ${image.suggestions?.length ? `<ul>${image.suggestions.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      </div>
      ${
        canDownload
          ? `<button class="icon-button image-download-button" type="button" data-download-image="${escapeHtml(image.id || "")}" aria-label="이미지 저장" title="이미지 저장"><i data-lucide="download"></i></button>`
          : ""
      }
    </div>
  `;
}

function formatImageSettings(settings) {
  const steps = Number(settings?.steps || 0);
  const cfg = Number(settings?.cfg || 0);
  const sampler = settings?.sampler || "";
  const scheduler = settings?.scheduler || "";
  return `${steps} steps · CFG ${cfg} · ${sampler}${scheduler ? `/${scheduler}` : ""}`;
}

function bindChartDownloads() {
  document.querySelectorAll("[data-download-chart]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const chart = findChartById(button.dataset.downloadChart);
      if (!chart?.svg) return;
      const result = await window.desktopAPI?.saveChartFile?.({
        title: chart.title || "그래프",
        svg: chart.svg,
        defaultFileName: `${sanitizeFileName(chart.title || "graph")}.svg`,
      });
      if (result?.ok) return;
      if (result && result.canceled) return;
      messages.push({
        from: "them",
        time: currentTime(),
        text: `그래프 저장 중 오류가 발생했습니다.\n${result?.error || "저장 기능을 사용할 수 없습니다."}`,
        error: true,
      });
      persistMessages();
      renderMessages();
    });
  });
}

function bindPresentationDownloads() {
  document.querySelectorAll("[data-download-presentation]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const presentation = findPresentationById(button.dataset.downloadPresentation);
      if (!presentation?.base64) return;
      const format = String(presentation.format || "html").toLowerCase();
      const isWebDeck = format === "html" || presentation.mimeType?.includes("html");
      const result = await window.desktopAPI?.savePresentationFile?.({
        title: presentation.title || (isWebDeck ? "웹 발표자료" : "PPT"),
        base64: presentation.base64,
        mimeType: presentation.mimeType || (isWebDeck ? "text/html; charset=utf-8" : ""),
        format,
        defaultFileName: presentation.fileName || `${sanitizeFileName(presentation.title || "presentation")}.${isWebDeck ? "html" : "pptx"}`,
      });
      if (result?.ok) return;
      if (result && result.canceled) return;
      messages.push({
        from: "them",
        time: currentTime(),
        text: `${isWebDeck ? "웹 발표자료" : "PPTX"} 저장 중 오류가 발생했습니다.\n${result?.error || "저장 기능을 사용할 수 없습니다."}`,
        error: true,
      });
      persistMessages();
      renderMessages();
    });
  });
}

function bindImageDownloads() {
  document.querySelectorAll("[data-download-image]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const image = findImageById(button.dataset.downloadImage);
      if (!image?.base64) return;
      const result = await window.desktopAPI?.saveImageFile?.({
        title: image.title || "image",
        base64: image.base64,
        mimeType: image.mimeType || "image/png",
        defaultFileName: image.fileName || `${sanitizeFileName(image.title || "image")}.png`,
      });
      if (result?.ok) return;
      if (result && result.canceled) return;
      messages.push({
        from: "them",
        time: currentTime(),
        text: `이미지 저장 중 오류가 발생했습니다.\n${result?.error || "저장 기능을 사용할 수 없습니다."}`,
        error: true,
      });
      persistMessages();
      renderMessages();
    });
  });
}

function bindMessageActions() {
  document.querySelectorAll("[data-message-index][data-action-index]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", () => handleMessageAction(button));
  });
}

async function handleMessageAction(button) {
  if (isSending) return;
  const messageIndex = Number(button.dataset.messageIndex);
  const actionIndex = Number(button.dataset.actionIndex);
  const message = messages[messageIndex];
  const action = message?.actions?.[actionIndex];
  if (!action || action.disabled) return;

  message.actions = message.actions.map((item, index) => ({
    ...item,
    disabled: true,
    selected: index === actionIndex,
  }));
  persistMessages();
  renderMessages();

  if (action.type === "image-cancel-generate") {
    clearImagePromptPanel();
    messages.push({ from: "me", time: currentTime(), text: action.label || "아니" });
    messages.push({
      from: "them",
      time: currentTime(),
      text: "좋아. 생성은 멈출게. 방향만 다시 잡고 싶으면 원하는 분위기나 용도만 말해줘.",
    });
    persistMessages();
    renderMessages();
    return;
  }

  if (action.type === "image-confirm-generate") {
    await runImageConfirmationAction(action);
  }
}

async function runImageConfirmationAction(action) {
  const imageRequest = currentImageRequestPayload(action.payload || {});
  isSending = true;
  sendButton.disabled = true;
  if (attachButton) attachButton.disabled = true;
  messages.push({ from: "me", time: currentTime(), text: action.label || "응" });
  persistMessages();
  renderMessages();

  const typingRow = document.querySelector("#typingRow");
  if (typingRow) {
    typingRow.hidden = false;
    stream.scrollTop = stream.scrollHeight;
  }

  try {
    const reply = await window.desktopAPI.sendOfficerMessage({
      contact,
      contextLevel: currentContextLevel,
      files: [],
      history: messages,
      userText: imageRequest.sourcePrompt || "",
      imageAction: "confirm-generate",
      imageRequest,
    });
    if (reply.image && !reply.image.id) {
      reply.image.id = `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    messages.push({
      from: "them",
      time: currentTime(),
      text: reply.text,
      error: !reply.ok,
      ...(reply.image ? { image: reply.image } : {}),
    });
    persistMessages();
  } catch (error) {
    messages.push({
      from: "them",
      time: currentTime(),
      text: `이미지 생성 중 오류가 발생했습니다.\n${error?.message || error}`,
      error: true,
    });
    persistMessages();
  } finally {
    isSending = false;
    sendButton.disabled = false;
    if (attachButton) attachButton.disabled = false;
    renderMessages();
  }
}

function findChartById(id) {
  if (!id) return null;
  for (const message of messages) {
    if (message.chart?.id === id) return message.chart;
  }
  return null;
}

function findPresentationById(id) {
  if (!id) return null;
  for (const message of messages) {
    if (message.presentation?.id === id) return message.presentation;
  }
  return null;
}

function findImageById(id) {
  if (!id) return null;
  for (const message of messages) {
    if (message.image?.id === id) return message.image;
  }
  return null;
}

function sanitizeFileName(value) {
  return String(value || "graph")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function typingMarkup() {
  return `
    <article class="typing-row" id="typingRow" hidden>
      ${avatarMarkup(contact, "sm")}
      <div class="typing-bubble">
        <span>입력 중...</span>
        <i></i><i></i><i></i>
      </div>
    </article>
  `;
}

function renderInfoPopover() {
  if (!infoPopover) return;

  const persona = contact.persona;
  const info = contact.info || {
    task: contact.description,
    requester: DATA.user.name,
    requestedAt: "오늘",
    state: contact.status === "offline" ? "대기" : "진행 중",
  };
  const output = contact.output || {
    format: "대화 요약",
    length: "간단",
    tone: "업무 메모 스타일",
  };
  const evidence = contact.evidence || DATA.files.slice(0, 3);

  const personaSection = persona
    ? `
      <section class="info-popover-section">
        <h3>프로필</h3>
        <div class="persona-card">
          <strong>${escapeHtml(persona.title)}</strong>
          <p>${escapeHtml(persona.summary)}</p>
        </div>
        <dl class="info-list">
          <dt>말투</dt><dd>${escapeHtml(persona.tone)}</dd>
          <dt>처리 방식</dt><dd>${escapeHtml(persona.workflow.join(" → "))}</dd>
        </dl>
        <div class="persona-chips">
          ${persona.strengths.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}
        </div>
        ${
          persona.limits?.length
            ? `<ul class="persona-limits">${persona.limits.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
            : ""
        }
      </section>
    `
    : "";

  infoPopover.innerHTML = `
    <header>
      <div>
        <span>대화방 정보</span>
        <h2>${escapeHtml(contact.name)}</h2>
      </div>
      <button class="icon-button" type="button" id="infoCloseButton" aria-label="정보 닫기">
        <i data-lucide="x"></i>
      </button>
    </header>
    ${personaSection}
    <section class="info-popover-section">
      <header>
        <h3>업무 정보</h3>
      </header>
      <dl class="info-list">
        <dt>담당</dt><dd>${escapeHtml(contact.department)}</dd>
        <dt>업무</dt><dd>${escapeHtml(info.task)}</dd>
        <dt>요청자</dt><dd>${escapeHtml(info.requester)}</dd>
        <dt>요청 시간</dt><dd>${escapeHtml(info.requestedAt)}</dd>
        <dt>상태</dt><dd><span class="presence-small"></span>${escapeHtml(info.state)}</dd>
      </dl>
    </section>
    <section class="info-popover-section">
      <h3>출력 설정</h3>
      <dl class="info-list">
        <dt>문서 형식</dt><dd>${escapeHtml(output.format)}</dd>
        <dt>길이</dt><dd>${escapeHtml(output.length)}</dd>
        <dt>톤앤매너</dt><dd>${escapeHtml(output.tone)}</dd>
      </dl>
    </section>
    <section class="info-popover-section">
      <header>
        <h3>근거 자료</h3>
      </header>
      <div class="evidence-list">
        ${evidence
          .map(
            (file) => `
              <article>
                <span class="file-icon file-${file.type}">${file.type === "pdf" ? "PDF" : file.type === "excel" ? "X" : "W"}</span>
                <div>
                  <strong>${escapeHtml(file.name)}</strong>
                  <p>${escapeHtml(file.size)}</p>
                </div>
              </article>
            `
          )
          .join("")}
      </div>
      <button class="outline-button full" type="button"><i data-lucide="plus"></i> 자료 추가</button>
    </section>
  `;

  document.querySelector("#infoCloseButton")?.addEventListener("click", () => {
    setInfoOpen(false);
  });
}

function setInfoOpen(isOpen) {
  if (!infoPopover) return;
  infoPopover.hidden = !isOpen;
  infoPopover.classList.toggle("is-open", isOpen);
  const button = document.querySelector("#infoButton");
  button?.classList.toggle("is-active", isOpen);
  button?.setAttribute("aria-expanded", String(isOpen));
  if (isOpen) {
    createIcons();
    infoPopover.focus({ preventScroll: true });
  }
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

function setIgniteButtonBusy(isBusy) {
  const button = document.querySelector("#igniteButton");
  button?.classList.toggle("is-loading", isBusy);
  if (button) {
    button.disabled = isBusy;
  }
}

async function igniteOfficer() {
  if (isIgniting) return;
  isIgniting = true;
  setIgniteButtonBusy(true);

  messages.push({
    from: "them",
    time: currentTime(),
    text: isCasualContact()
      ? `${contact.name} 왔는지 한번 볼게. 로컬 LLM 상태 확인 중이야.`
      : `${contact.name} 출근 여부를 확인하겠습니다. 로컬 LLM 실행기와 모델 상태를 점검하는 중입니다.`,
  });
  persistMessages();
  renderMessages();

  try {
    const result = window.desktopAPI?.igniteOfficer
      ? await window.desktopAPI.igniteOfficer({ contact, contextLevel: currentContextLevel })
      : {
          ok: false,
          text: "데스크톱 앱 실행 환경에서만 출근 확인을 사용할 수 있습니다.",
        };

    messages.push({
      from: "them",
      time: currentTime(),
      text: result.text,
      error: !result.ok,
    });
    isOfficerRuntimeOnline = Boolean(result.ok);
    officerRuntimeModel = result.model || officerRuntimeModel;
    persistMessages();
  } catch (error) {
    isOfficerRuntimeOnline = false;
    messages.push({
      from: "them",
      time: currentTime(),
      text: `출근 확인 중 오류가 발생했습니다.\n${error?.message || error}`,
      error: true,
    });
    persistMessages();
  } finally {
    isIgniting = false;
    setIgniteButtonBusy(false);
    renderTopbar();
    renderMessages();
  }
}

async function refreshOfficerRuntimeStatus() {
  if (contact?.forceOffline || !window.desktopAPI?.checkOfficerStatus) return;
  try {
    const [result, catalog] = await Promise.all([
      window.desktopAPI.checkOfficerStatus(),
      window.desktopAPI.listLocalModels ? window.desktopAPI.listLocalModels().catch(() => null) : Promise.resolve(null),
    ]);
    isOfficerRuntimeOnline = Boolean(result?.ok);
    officerRuntimeModel = catalog?.effectiveModel || catalog?.selectedModel || result?.model || "";
    renderTopbar();
  } catch (_error) {
    isOfficerRuntimeOnline = false;
    renderTopbar();
  }
}

function handleChatLocalModelChanged(payload = {}) {
  const model = typeof payload === "string" ? payload : payload.effectiveModel || payload.selectedModel || payload.model || "";
  officerRuntimeModel = String(model).slice(0, 200);
  if (typeof payload?.serverReachable === "boolean") {
    isOfficerRuntimeOnline = payload.serverReachable && Boolean(officerRuntimeModel);
  }
  renderTopbar();
  void refreshOfficerRuntimeStatus();
  if (isSttOfficer()) void refreshSttRuntimeStatus();
}

function renderPendingFiles() {
  if (!attachmentsStrip) return;
  attachmentsStrip.hidden = pendingFiles.length === 0;
  attachmentsStrip.innerHTML = pendingFiles
    .map(
      (file, index) => `
        <button class="pending-file-chip" type="button" data-remove-pending-file="${index}" title="첨부 제거">
          <span class="file-icon file-${escapeHtml(file.type || "file")}">${file.type === "excel" ? "X" : file.type === "pdf" ? "PDF" : "F"}</span>
          <span>${escapeHtml(file.name)}</span>
          <i data-lucide="x"></i>
        </button>
      `
    )
    .join("");

  attachmentsStrip.querySelectorAll("[data-remove-pending-file]").forEach((button) => {
    button.addEventListener("click", () => {
      pendingFiles.splice(Number(button.dataset.removePendingFile), 1);
      renderPendingFiles();
      createIcons();
    });
  });
  createIcons();
}

async function selectFilesForChat() {
  if (isSending) return;
  if (!window.desktopAPI?.selectChatFiles) {
    messages.push({
      from: "them",
      time: currentTime(),
      text: "데스크톱 앱 실행 환경에서만 파일 첨부를 사용할 수 있습니다.",
      error: true,
    });
    persistMessages();
    renderMessages();
    return;
  }

  const selected = await window.desktopAPI.selectChatFiles({ contactId: contact.id });
  if (!Array.isArray(selected) || !selected.length) return;
  if (isConverterOfficer()) {
    addConverterFiles(selected, true);
    return;
  }
  if (isPrivacyOfficer()) {
    await inspectPrivacyFiles(selected);
    return;
  }
  pendingFiles = [...pendingFiles, ...selected].slice(0, 8);
  renderPendingFiles();
}

function publicFileInfo(file) {
  return {
    name: file.name,
    size: file.size,
    type: file.type || "file",
  };
}

function setupGraphControls() {
  if (!graphControls) return;
  const isGraphOfficer = contact.id === "graph-officer";
  graphControls.hidden = !isGraphOfficer;
  if (!isGraphOfficer) return;
  graphXAxisInput?.setAttribute("aria-label", "그래프 X축 열 이름");
  graphYAxisInput?.setAttribute("aria-label", "그래프 Y축 열 이름");
  graphChartTypeInput?.setAttribute("aria-label", "그래프 종류");
}

function currentGraphOptions() {
  if (contact.id !== "graph-officer") return {};
  return {
    xAxis: graphXAxisInput?.value.trim() || "",
    yAxis: graphYAxisInput?.value.trim() || "",
    chartType: graphChartTypeInput?.value || "auto",
  };
}

function buildGraphInstructionText(baseText, graphOptions) {
  if (contact.id !== "graph-officer") return baseText;
  const parts = [];
  if (graphOptions.xAxis) parts.push(`x축은 ${graphOptions.xAxis}`);
  if (graphOptions.yAxis) parts.push(`y축은 ${graphOptions.yAxis}`);
  if (graphOptions.chartType && graphOptions.chartType !== "auto") {
    parts.push(`그래프 종류는 ${graphOptions.chartType === "line" ? "선그래프" : "막대그래프"}`);
  }
  if (!parts.length) return baseText;
  return [baseText, parts.join(", ")].filter(Boolean).join("\n");
}

function isPresentationOfficer() {
  return contact.id === "presentation-officer";
}

function isImageOfficer() {
  return contact.id === "image-officer";
}

function isSttOfficer() {
  return contact.id === "steno-officer";
}

function isRoutineOfficer() {
  return contact.id === "routine-officer";
}

function isFrustrationOfficer() {
  return contact.id === "frustration-officer";
}

function isConverterOfficer() {
  return contact.id === "file-converter";
}

function isPrivacyOfficer() {
  return contact.id === "privacy-officer";
}

function isDocumentResourceOfficer() {
  return contact.id === "resource-officer";
}

function setupPresentationControls() {
  if (!presentationControls) return;
  presentationControls.hidden = !isPresentationOfficer();
  if (!isPresentationOfficer()) return;
  pptSourceTypeInput?.setAttribute("aria-label", "웹 발표자료 원자료 유형");
  pptSlideCountInput?.setAttribute("aria-label", "웹 발표자료 슬라이드 장수");
  pptAudienceInput?.setAttribute("aria-label", "웹 발표자료 청중");
  pptPurposeInput?.setAttribute("aria-label", "웹 발표자료 목적");
  pptToneInput?.setAttribute("aria-label", "웹 발표자료 톤");
  pptRatioInput?.setAttribute("aria-label", "웹 발표자료 화면비");
  pptDetailLevelInput?.setAttribute("aria-label", "웹 발표자료 내용 밀도");
  pptFontScaleInput?.setAttribute("aria-label", "웹 발표자료 글자 크기");
  pptThemeInput?.setAttribute("aria-label", "웹 발표자료 테마");
}

function currentPresentationOptions() {
  if (!isPresentationOfficer()) return {};
  return {
    sourceType: pptSourceTypeInput?.value || "auto",
    slideCount: pptSlideCountInput?.value || "auto",
    audience: pptAudienceInput?.value.trim() || "",
    purpose: pptPurposeInput?.value.trim() || "",
    tone: pptToneInput?.value || "공공기관 보고용",
    ratio: pptRatioInput?.value || "16:9",
    detailLevel: pptDetailLevelInput?.value || "dense",
    fontScale: pptFontScaleInput?.value || "normal",
    theme: pptThemeInput?.value || "civic-blue",
  };
}

function buildPresentationInstructionText(baseText, presentationOptions) {
  if (!isPresentationOfficer()) return baseText;
  const lines = [];
  if (presentationOptions.sourceType && presentationOptions.sourceType !== "auto") {
    lines.push(`- 자료 유형: ${presentationOptions.sourceType}`);
  }
  if (presentationOptions.slideCount && presentationOptions.slideCount !== "auto") {
    lines.push(`- 희망 장수: ${presentationOptions.slideCount}`);
  }
  if (presentationOptions.audience) lines.push(`- 청중: ${presentationOptions.audience}`);
  if (presentationOptions.purpose) lines.push(`- 목적: ${presentationOptions.purpose}`);
  if (presentationOptions.tone) lines.push(`- 톤: ${presentationOptions.tone}`);
  if (presentationOptions.ratio) lines.push(`- 화면비: ${presentationOptions.ratio}`);
  if (presentationOptions.detailLevel) {
    const labels = { brief: "간단", balanced: "균형", dense: "상세" };
    lines.push(`- 내용 밀도: ${labels[presentationOptions.detailLevel] || presentationOptions.detailLevel}`);
  }
  if (presentationOptions.fontScale) {
    const labels = { compact: "작게", normal: "보통", large: "크게" };
    lines.push(`- 글자 크기: ${labels[presentationOptions.fontScale] || presentationOptions.fontScale}`);
  }
  if (presentationOptions.theme) {
    const labels = { "civic-blue": "공공 블루", forest: "차분한 그린", mono: "흑백 보고" };
    lines.push(`- 테마: ${labels[presentationOptions.theme] || presentationOptions.theme}`);
  }
  if (!lines.length) return baseText;
  return [baseText, "웹 발표자료 작성 조건:", ...lines].filter(Boolean).join("\n");
}

function setupImagePanel() {
  if (!imagePanel) return;
  const enabled = isImageOfficer();
  imagePanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-image-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-image-panel", enabled);
  if (!enabled) return;

  imagePurposeInput?.setAttribute("aria-label", "이미지 용도");
  imageRatioInput?.setAttribute("aria-label", "이미지 화면비");
  imageSizeHintInput?.setAttribute("aria-label", "이미지 크기");
  imageStyleInput?.setAttribute("aria-label", "이미지 스타일");
  imagePositivePromptInput?.setAttribute("aria-label", "포지티브 프롬프트");
  imageNegativePromptInput?.setAttribute("aria-label", "네거티브 프롬프트");
  imageClearButton?.addEventListener("click", clearImagePromptPanel);
  imagePromptButton?.addEventListener("click", insertImagePromptRequest);
}

function currentImageOptions() {
  if (!isImageOfficer()) return {};
  return {
    purpose: imagePurposeInput?.value.trim() || "",
    ratio: imageRatioInput?.value || "auto",
    sizeHint: imageSizeHintInput?.value || "auto",
    style: imageStyleInput?.value || "auto",
    positivePrompt: imagePositivePromptInput?.value.trim() || "",
    negativePrompt: imageNegativePromptInput?.value.trim() || "",
  };
}

function buildImageInstructionText(baseText, imageOptions) {
  if (!isImageOfficer()) return baseText;
  const lines = [];
  if (imageOptions.purpose) lines.push(`- 용도: ${imageOptions.purpose}`);
  if (imageOptions.ratio && imageOptions.ratio !== "auto") lines.push(`- 화면비: ${imageOptions.ratio}`);
  if (imageOptions.sizeHint && imageOptions.sizeHint !== "auto") lines.push(`- 크기 힌트: ${imageOptions.sizeHint}`);
  if (imageOptions.style && imageOptions.style !== "auto") lines.push(`- 스타일: ${imageOptions.style}`);
  if (imageOptions.positivePrompt) lines.push(`- 포지티브 프롬프트 초안: ${imageOptions.positivePrompt}`);
  if (imageOptions.negativePrompt) lines.push(`- 네거티브 프롬프트 초안: ${imageOptions.negativePrompt}`);
  if (!lines.length) return baseText;
  return [baseText, "김그림 설정값:", ...lines].filter(Boolean).join("\n");
}

function clearImagePromptPanel() {
  if (imagePurposeInput) imagePurposeInput.value = "";
  if (imageRatioInput) imageRatioInput.value = "auto";
  if (imageSizeHintInput) imageSizeHintInput.value = "auto";
  if (imageStyleInput) imageStyleInput.value = "auto";
  if (imagePositivePromptInput) imagePositivePromptInput.value = "";
  if (imageNegativePromptInput) imageNegativePromptInput.value = "";
}

function insertImagePromptRequest() {
  const options = currentImageOptions();
  const text = buildImageInstructionText("이 설정으로 이미지 브리프랑 생성 프롬프트를 다시 잡아줘", options);
  input.textContent = text;
  input.focus();
}

function currentImageRequestPayload(basePayload = {}) {
  const options = currentImageOptions();
  const positive = options.positivePrompt || extractImagePromptBlock(basePayload.llmText, "positive") || "";
  const negative = options.negativePrompt || extractImagePromptBlock(basePayload.llmText, "negative") || "";
  const sourceParts = [
    basePayload.sourcePrompt || "",
    options.purpose ? `용도: ${options.purpose}` : "",
    options.ratio && options.ratio !== "auto" ? `화면비: ${options.ratio}` : "",
    options.sizeHint && options.sizeHint !== "auto" ? `크기: ${options.sizeHint}` : "",
    options.style && options.style !== "auto" ? `스타일: ${options.style}` : "",
  ].filter(Boolean);
  const llmParts = [];
  if (positive) llmParts.push("생성 프롬프트", positive);
  if (negative) llmParts.push("네거티브 프롬프트", negative);

  return {
    ...basePayload,
    sourcePrompt: sourceParts.join("\n") || basePayload.sourcePrompt || "",
    llmText: llmParts.length ? llmParts.join("\n") : basePayload.llmText || "",
  };
}

function updateImagePanelFromDraft(text, actionPayload = {}) {
  if (!isImageOfficer()) return;
  const positive = extractImagePromptBlock(actionPayload.llmText, "positive") || extractImagePromptBlock(text, "positive");
  const negative = extractImagePromptBlock(actionPayload.llmText, "negative") || extractImagePromptBlock(text, "negative");
  if (positive && imagePositivePromptInput) imagePositivePromptInput.value = positive;
  if (negative && imageNegativePromptInput) imageNegativePromptInput.value = negative;
}

function extractImagePromptBlock(text, kind) {
  const source = String(text || "");
  const labels = kind === "negative"
    ? ["네거티브 프롬프트", "Negative prompt", "negative prompt"]
    : ["생성 프롬프트", "포지티브 프롬프트", "Positive prompt", "positive prompt"];
  const stop = kind === "negative"
    ? /(?:\n\s*(?:권장 모델|저장 형식|확인 필요|이 방향|이 설정|$))/i
    : /(?:\n\s*(?:네거티브 프롬프트|Negative prompt|권장 모델|저장 형식|확인 필요|이 방향|이 설정|$))/i;

  for (const label of labels) {
    const index = source.toLowerCase().indexOf(label.toLowerCase());
    if (index < 0) continue;
    const afterLabel = source.slice(index + label.length).replace(/^\s*[:：]?\s*/, "");
    const stopMatch = afterLabel.match(stop);
    const block = (stopMatch ? afterLabel.slice(0, stopMatch.index) : afterLabel).trim();
    const firstLine = block.split("\n").map((line) => line.trim()).filter(Boolean)[0] || "";
    const cleanLine = firstLine.replace(/^[-*]\s*/, "").trim();
    if (isUsableImagePanelPromptLine(cleanLine, kind)) return cleanLine;
  }
  return "";
}

function isUsableImagePanelPromptLine(value, kind) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^(?:이미지\s*브리프|생성\s*프롬프트|포지티브\s*프롬프트|네거티브\s*프롬프트|positive\s*prompt|negative\s*prompt|prompt)$/i.test(text)) {
    return false;
  }
  if (kind === "positive" && /(?:네거티브|negative)\s*프롬프트/i.test(text)) return false;
  if (/(사용자|직접|입력|설정|수정|선택|정해|정해주세요|채워|작성|구체|확인 필요|미정|없음|해당 없음|none|n\/a)/i.test(text)) {
    return false;
  }
  return true;
}

const STT_ASSET_IDS = Object.freeze({
  runtime: "runtime-whisper-cpp-1.9.2",
  lite: "model-small-q5_1",
  recommended: "model-large-v3-turbo-q5_0",
  vad: "vad-silero-6.2.0",
});

function setupSttPanel() {
  if (!sttPanel) return;
  const enabled = isSttOfficer();
  sttPanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-stt-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-stt-panel", enabled);
  if (!enabled) return;

  sttLanguageInput?.setAttribute("aria-label", "STT 언어");
  sttModelInput?.setAttribute("aria-label", "받아쓰기 성능 프로필");
  sttResultModeInput?.setAttribute("aria-label", "AI 초안 모드");
  sttInitialPromptInput?.setAttribute("aria-label", "전문용어와 이름 인식 힌트");
  sttVadInput?.setAttribute("aria-label", "무음 구간 건너뛰기");
  sttRetainAudioInput?.setAttribute("aria-label", "처리용 음성 보관");
  sttTranscriptInput?.setAttribute("aria-label", "Whisper 받아쓰기 원문");
  sttRecordButton?.addEventListener("click", startSttRecording);
  sttStopButton?.addEventListener("click", stopAndTranscribeStt);
  sttCancelButton?.addEventListener("click", cancelSttTranscription);
  sttFileButton?.addEventListener("click", () => {
    if (isSttRecording || isSttTranscribing) return;
    sttFileInput?.click();
  });
  sttFileInput?.addEventListener("change", transcribeSelectedSttFile);
  sttInitialPromptInput?.addEventListener("input", updateSttPromptCounter);
  sttModelInput?.addEventListener("change", () => {
    hasSttProfileChoice = true;
    renderSttPerformanceWarning(lastSttPerformanceNotice);
  });
  sttAssetList?.addEventListener("click", (event) => {
    const button = event.target.closest?.("[data-stt-install-asset]");
    if (!button || !sttAssetList.contains(button)) return;
    installSttAsset(button.dataset.sttInstallAsset || "");
  });
  sttInstallCancel?.addEventListener("click", cancelSttAssetInstall);
  if (window.desktopAPI?.onSttInstallProgress) {
    disposeSttInstallProgress = window.desktopAPI.onSttInstallProgress(handleSttInstallProgress);
  }
  sttApplyModeButton?.addEventListener("click", () => insertSttPrompt("auto"));
  sttRawButton?.addEventListener("click", () => insertSttPrompt("raw"));
  sttCleanupButton?.addEventListener("click", () => insertSttPrompt("cleanup"));
  sttMinutesButton?.addEventListener("click", () => insertSttPrompt("minutes"));
  sttTasksButton?.addEventListener("click", () => insertSttPrompt("tasks"));
  sttPptButton?.addEventListener("click", () => insertSttPrompt("ppt"));
  updateSttPromptCounter();
  updateSttCapacityNote();
  renderSttOutputLinks(null);
  setSttStatus("idle", "녹음 대기 중");
  refreshSttRuntimeStatus();
}

async function refreshSttRuntimeStatus() {
  if (!isSttOfficer() || !window.desktopAPI?.getSttRuntimeStatus || !sttModelInput) return;
  try {
    const status = await window.desktopAPI.getSttRuntimeStatus();
    isSttRuntimeReady = Boolean(status?.ok);
    const presets = Array.isArray(status?.presets) ? status.presets : [];
    const assets = normalizeSttAssets(status);
    sttModelInput.querySelectorAll("option").forEach((option) => {
      const assetId = STT_ASSET_IDS[option.value];
      const asset = assets.find((item) => item.id === assetId);
      const preset = presets.find((item) => item.value === option.value);
      if (asset) {
        option.disabled = !isSttAssetInstalled(asset) || asset.compatible === false;
        option.title = option.disabled ? "로컬 음성 엔진에서 이 모델을 먼저 설치하세요." : sttAssetStatusText(asset);
      } else if (preset) {
        option.disabled = !preset.enabled;
        option.title = preset.note || "";
      }
    });
    if (sttModelInput.selectedOptions[0]?.disabled) {
      const firstEnabled = Array.from(sttModelInput.options).find((option) => !option.disabled);
      if (firstEnabled) sttModelInput.value = firstEnabled.value;
    }
    if (!hasSttProfileChoice) {
      const selectedAsset = assets.find((item) => item.kind === "model" && item.selected && isSttAssetInstalled(item));
      if (selectedAsset?.id === STT_ASSET_IDS.lite) sttModelInput.value = "lite";
      if (selectedAsset?.id === STT_ASSET_IDS.recommended) sttModelInput.value = "recommended";
    }
    const runtimeReady = Boolean(status?.runtime || assets.some((item) => item.id === STT_ASSET_IDS.runtime && isSttAssetInstalled(item)));
    const installedModel = Boolean(status?.selectedModel || assets.some((item) => item.id.startsWith("model-") && isSttAssetInstalled(item)));
    if (!status?.ok) {
      if (!runtimeReady) setSttStatus("error", "whisper.cpp 1.9.2 실행기를 설치해 주세요.");
      else if (!installedModel) setSttStatus("error", "가벼운 모델 또는 추천 모델을 설치해 주세요.");
      else setSttStatus("error", "로컬 음성 엔진 구성을 확인해 주세요.");
    } else if (!presets.some((item) => item.enabled) && !installedModel) {
      setSttStatus("error", "받아쓰기 모델 설치가 필요합니다.");
    }
    if (status?.ok && !isSttRecording && !isSttTranscribing && sttStatus?.dataset.state !== "done") {
      setSttStatus("idle", "로컬 음성 엔진 준비됨");
    }
    renderSttRuntimeStatus(status, assets);
    lastSttPerformanceNotice = status?.performanceNotice || null;
    renderSttPerformanceWarning(lastSttPerformanceNotice);
    applyVadRuntimeStatus(status?.vad, assets.find((item) => item.id === STT_ASSET_IDS.vad));
    setSttButtons();
  } catch (error) {
    isSttRuntimeReady = false;
    if (sttRuntimeSummary) sttRuntimeSummary.textContent = "설치 상태를 확인하지 못함";
    if (sttRuntimeManager) sttRuntimeManager.dataset.state = "error";
    setSttButtons();
    console.warn("STT runtime status check failed", error);
  }
}

function renderSttPerformanceWarning(notice) {
  if (!sttPerformanceWarning) return;
  const warning = String(notice?.warning || "").trim();
  const usesTurbo = sttModelInput?.value === "recommended";
  sttPerformanceWarning.hidden = !usesTurbo || !warning;
  sttPerformanceWarning.textContent = usesTurbo && warning ? warning : "";
}

function normalizeSttAssets(status) {
  const candidates = [status?.assets, status?.manager?.assets, status?.runtimeManager?.assets];
  const source = candidates.find(Array.isArray) || [];
  return source.map((asset) => ({
    ...asset,
    id: String(asset?.id || asset?.assetId || ""),
  })).filter((asset) => asset.id);
}

function isSttAssetInstalled(asset) {
  return Boolean(asset?.installed === true || asset?.ready === true || asset?.valid === true || asset?.status === "installed" || asset?.status === "ready");
}

function formatSttBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(2)}GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / (1024 ** 2))}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

function sttAssetStatusText(asset) {
  if (!asset) return "설치 안 됨";
  if (asset.compatible === false) return "현재 PC와 호환되지 않음";
  if (!isSttAssetInstalled(asset)) return `설치 안 됨${asset.note || asset.message ? ` · ${asset.note || asset.message}` : ""}`;
  if (asset.bundled === true || asset.source === "bundled") {
    const details = [asset.version, formatSttBytes(asset.sizeBytes || asset.bytes || asset.size), "SHA-256 확인"].filter(Boolean);
    return `배포본 기본 포함${details.length ? ` · ${details.join(" · ")}` : ""}`;
  }
  const details = [
    asset.version,
    formatSttBytes(asset.sizeBytes || asset.bytes || asset.size),
    asset.verified === true ? "SHA-256 재검증 완료" : "설치 기록 확인 · 필요 시 재검증",
  ].filter(Boolean);
  return `설치됨${details.length ? ` · ${details.join(" · ")}` : ""}`;
}

function renderSttRuntimeStatus(status, assets) {
  sttAssetList?.querySelectorAll("[data-stt-asset-card]").forEach((card) => {
    const assetId = card.dataset.sttAssetCard || "";
    const asset = assets.find((item) => item.id === assetId);
    const installed = isSttAssetInstalled(asset);
    const statusNode = card.querySelector("[data-stt-asset-status]");
    const button = card.querySelector("[data-stt-install-asset]");
    card.dataset.state = asset?.compatible === false ? "incompatible" : installed ? "ready" : "missing";
    card.dataset.source = asset?.bundled === true || asset?.source === "bundled" ? "bundled" : "managed";
    if (statusNode) statusNode.textContent = sttAssetStatusText(asset);
    if (button) {
      const bundled = asset?.bundled === true || asset?.source === "bundled";
      button.dataset.bundled = bundled ? "true" : "false";
      button.textContent = bundled ? "기본 포함" : installed ? "파일 재선택·설치" : "파일 선택·설치";
      button.disabled = bundled
        || Boolean(activeSttInstallAssetId)
        || asset?.compatible === false
        || !window.desktopAPI?.selectSttAssetFile
        || !window.desktopAPI?.installSttAsset;
    }
  });

  const runtimeAsset = assets.find((item) => item.id === STT_ASSET_IDS.runtime);
  const selectedModel = status?.model || status?.manager?.model || status?.runtimeManager?.model || null;
  const installedModelAsset = assets.find((item) => item.id.startsWith("model-") && isSttAssetInstalled(item) && (item.selected || item.active))
    || assets.find((item) => item.id === STT_ASSET_IDS.recommended && isSttAssetInstalled(item))
    || assets.find((item) => item.id === STT_ASSET_IDS.lite && isSttAssetInstalled(item));
  const runtimeVersion = (isSttAssetInstalled(runtimeAsset) ? runtimeAsset?.version : "") || status?.runtime?.version || status?.manager?.runtime?.version || "";
  const modelName = selectedModel?.modelKey || selectedModel?.name || installedModelAsset?.modelKey || installedModelAsset?.label || installedModelAsset?.id?.replace(/^model-/, "") || status?.selectedModel || "";
  if (sttRuntimeSummary) {
    sttRuntimeSummary.textContent = status?.ok
      ? [runtimeVersion ? `whisper.cpp ${runtimeVersion}` : "whisper.cpp 준비됨", modelName].filter(Boolean).join(" · ")
      : "필수 구성 요소 설치 필요";
  }
  if (sttRuntimeManager) {
    sttRuntimeManager.dataset.state = status?.ok ? "ready" : "missing";
    if (!status?.ok && assets.length) sttRuntimeManager.open = true;
  }
}

function applyVadRuntimeStatus(status, asset) {
  if (!sttVadInput) return;
  const ready = Boolean(status?.ok || status?.ready || isSttAssetInstalled(asset));
  sttVadInput.disabled = !ready;
  if (sttVadStatus) {
    const version = status?.version || asset?.version || "";
    sttVadStatus.textContent = ready ? `VAD 준비됨${version ? ` · ${version}` : ""}` : "VAD 설치 필요";
    sttVadStatus.dataset.state = ready ? "ready" : "error";
  }
}

async function installSttAsset(assetId) {
  if (!assetId || activeSttInstallAssetId || isSttRecording || isSttTranscribing || !window.desktopAPI?.selectSttAssetFile || !window.desktopAPI?.installSttAsset) return;
  activeSttInstallAssetId = assetId;
  if (sttRuntimeManager) sttRuntimeManager.open = true;
  setSttInstallBusy(true);
  updateSttInstallProgress({ assetId, phase: "starting", percent: 0, message: "검토된 로컬 파일을 선택해 주세요." });
  try {
    const selection = await window.desktopAPI.selectSttAssetFile({ assetId });
    if (selection?.canceled) {
      if (sttInstallProgress) sttInstallProgress.hidden = true;
      return;
    }
    if (selection?.ok === false || !selection?.file?.fileToken) {
      const selectionError = new Error(selection?.error || "설치할 로컬 파일을 선택하지 못했습니다.");
      selectionError.code = selection?.errorCode || "LOCAL_FILE_REQUIRED";
      throw selectionError;
    }
    updateSttInstallProgress({ assetId, phase: "importing", percent: 0, message: `${selection.file.name || "로컬 파일"} 확인 중` });
    const result = await window.desktopAPI.installSttAsset({ assetId, fileToken: selection.file.fileToken });
    if (result?.ok === false) {
      const installError = new Error(result.error || result.message || "구성 요소를 설치하지 못했습니다.");
      installError.code = result.errorCode || "INSTALL_FAILED";
      throw installError;
    }
    updateSttInstallProgress({ assetId, phase: "complete", percent: 100, message: "설치 및 검증 완료" });
    await refreshSttRuntimeStatus();
    window.setTimeout(() => {
      if (!activeSttInstallAssetId && sttInstallProgress) sttInstallProgress.hidden = true;
    }, 1600);
  } catch (error) {
    const canceled = error?.code === "INSTALL_CANCELED" || /취소|cancel/i.test(String(error?.message || ""));
    updateSttInstallProgress({ assetId, phase: "error", message: canceled ? "설치를 취소했습니다." : `설치 실패 · ${error?.message || error}` });
  } finally {
    activeSttInstallAssetId = "";
    setSttInstallBusy(false);
    await refreshSttRuntimeStatus();
  }
}

async function cancelSttAssetInstall() {
  if (!activeSttInstallAssetId || !window.desktopAPI?.cancelSttAssetInstall) return;
  if (sttInstallCancel) sttInstallCancel.disabled = true;
  try {
    await window.desktopAPI.cancelSttAssetInstall({ assetId: activeSttInstallAssetId });
    if (sttInstallProgressLabel) sttInstallProgressLabel.textContent = "취소 처리 중";
  } catch (error) {
    if (sttInstallProgressLabel) sttInstallProgressLabel.textContent = `취소 실패 · ${error?.message || error}`;
    if (sttInstallCancel) sttInstallCancel.disabled = false;
  }
}

function handleSttInstallProgress(progress) {
  const eventAssetId = String(progress?.assetId || progress?.id || progress?.installationId || "");
  if (activeSttInstallAssetId && eventAssetId && !eventAssetId.includes(activeSttInstallAssetId)) return;
  updateSttInstallProgress({ ...progress, assetId: eventAssetId || activeSttInstallAssetId });
}

function updateSttInstallProgress(progress) {
  if (!sttInstallProgress) return;
  const received = Number(progress?.receivedBytes ?? progress?.downloadedBytes ?? 0);
  const total = Number(progress?.totalBytes || 0);
  const suppliedPercent = Number(progress?.percent);
  const percent = Number.isFinite(suppliedPercent)
    ? Math.max(0, Math.min(100, suppliedPercent))
    : total > 0 ? Math.max(0, Math.min(100, (received / total) * 100)) : 0;
  const phaseLabels = {
    starting: "로컬 파일 선택 대기",
    importing: "로컬 파일 읽기·SHA-256 확인 중",
    verifying: "SHA-256 검증 중",
    extracting: "안전하게 압축 푸는 중",
    repairing: "기존 설치를 안전하게 복구하는 중",
    installing: "로컬 설치 중",
    complete: "설치 및 검증 완료",
    error: "설치 중단",
  };
  const phase = String(progress?.phase || "importing");
  sttInstallProgress.hidden = false;
  sttInstallProgress.dataset.state = phase;
  if (sttInstallProgressLabel) sttInstallProgressLabel.textContent = progress?.message || phaseLabels[phase] || "설치 중";
  if (sttInstallProgressValue) {
    const byteText = received > 0 && total > 0 ? ` · ${formatSttBytes(received)} / ${formatSttBytes(total)}` : "";
    sttInstallProgressValue.textContent = `${Math.round(percent)}%${byteText}`;
  }
  if (sttInstallProgressBar) {
    sttInstallProgressBar.value = percent;
    sttInstallProgressBar.textContent = `${Math.round(percent)}%`;
  }
}

function setSttInstallBusy(busy) {
  sttAssetList?.querySelectorAll("[data-stt-install-asset]").forEach((button) => {
    button.disabled = button.dataset.bundled === "true" || busy || button.closest("[data-state='incompatible']") != null || !window.desktopAPI?.selectSttAssetFile || !window.desktopAPI?.installSttAsset;
  });
  if (sttInstallCancel) sttInstallCancel.disabled = !busy || !window.desktopAPI?.cancelSttAssetInstall;
  setSttButtons();
}

function updateSttPromptCounter() {
  if (!sttInitialPromptInput) return;
  const clean = String(sttInitialPromptInput.value || "").replaceAll("\0", "").slice(0, 500);
  if (sttInitialPromptInput.value !== clean) sttInitialPromptInput.value = clean;
  if (sttPromptCounter) sttPromptCounter.textContent = `${clean.length}/500`;
}

async function startSttRecording() {
  if (isSttRecording || isSttTranscribing) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setSttStatus("error", "마이크 API를 사용할 수 없습니다.");
    return;
  }
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    setSttStatus("error", "오디오 컨텍스트를 사용할 수 없습니다.");
    return;
  }

  try {
    sttStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    sttAudioContext = new AudioContextCtor();
    sttSourceNode = sttAudioContext.createMediaStreamSource(sttStream);
    sttProcessorNode = sttAudioContext.createScriptProcessor(4096, 1, 1);
    sttAudioChunks = [];
    sttProcessorNode.onaudioprocess = (event) => {
      if (!isSttRecording) return;
      const inputData = event.inputBuffer.getChannelData(0);
      sttAudioChunks.push(new Float32Array(inputData));
      const outputData = event.outputBuffer.getChannelData(0);
      outputData.fill(0);
    };
    sttSourceNode.connect(sttProcessorNode);
    sttProcessorNode.connect(sttAudioContext.destination);
    clearSttTranscriptResult();
    isSttRecording = true;
    sttRecordingStartedAt = Date.now();
    setSttButtons();
    setSttStatus("recording", "마이크 녹음 중 · 정지+STT를 누르면 자동 저장", "capture");
    updateSttTimer();
    sttTimerId = window.setInterval(updateSttTimer, 500);
  } catch (error) {
    cleanupSttRecorder();
    setSttStatus("error", `마이크를 열지 못했습니다. ${error?.message || error}`);
  }
}

async function stopAndTranscribeStt() {
  if (!isSttRecording || isSttTranscribing) return;
  const durationSeconds = Math.max(0, Math.round((Date.now() - sttRecordingStartedAt) / 100) / 10);
  const sampleRate = sttAudioContext?.sampleRate || 48000;
  const chunks = sttAudioChunks;
  sttAudioChunks = [];
  cleanupSttRecorder();

  if (!chunks.length || durationSeconds < 0.3) {
    setSttStatus("error", "녹음이 너무 짧습니다.");
    return;
  }

  isSttTranscribing = true;
  isSttCancelPending = false;
  clearSttTranscriptResult();
  setSttButtons();
  setSttStatus("transcribing", "녹음을 받아쓰기용으로 준비 중", "capture");

  try {
    let wav;
    try {
      wav = encodeWav(chunks, sampleRate);
    } finally {
      chunks.length = 0;
    }
    assertSttAudioWithinByteLimit(wav.byteLength, "녹음");
    setSttStatus("transcribing", "Whisper 받아쓰기 중", "transcribe");
    await transcribeSttWav(wav, {
      durationSeconds,
      sourceName: "마이크 녹음",
    });
  } catch (error) {
    setSttStatus("error", `STT 처리 중 오류가 났습니다. ${error?.message || error}`);
  } finally {
    isSttTranscribing = false;
    isSttCancelPending = false;
    setSttButtons();
  }
}

async function transcribeSelectedSttFile(event) {
  const file = event?.target?.files?.[0];
  if (event?.target) event.target.value = "";
  if (!file || isSttRecording || isSttTranscribing) return;
  if (file.size > sttUploadLimitBytes()) {
    setSttStatus("error", `녹음 파일이 너무 큽니다. 현재 용량 한도는 ${sttLimitMbLabel()}입니다.`);
    return;
  }

  isSttTranscribing = true;
  isSttCancelPending = false;
  setSttButtons();
  clearSttTranscriptResult();
  setSttStatus("transcribing", "녹음 파일 읽는 중", "capture");

  try {
    const decoded = await decodeSttAudioFile(file);
    assertSttAudioWithinByteLimit(decoded.wav.byteLength, "변환된 처리용 음성");
    setSttStatus("transcribing", "Whisper 받아쓰기 중", "transcribe");
    await transcribeSttWav(decoded.wav, {
      durationSeconds: decoded.durationSeconds,
      sourceName: file.name,
      sourceMimeType: file.type,
      sourceSize: file.size,
    });
  } catch (error) {
    setSttStatus("error", `녹음 파일을 읽지 못했습니다. ${error?.message || error}`);
  } finally {
    isSttTranscribing = false;
    isSttCancelPending = false;
    setSttButtons();
  }
}

async function loadChatAppSettings() {
  if (!window.desktopAPI?.getAppSettings) return;
  try {
    const settings = await window.desktopAPI.getAppSettings();
    appSettings = {
      ...appSettings,
      ...(settings || {}),
      limits: {
        ...(appSettings.limits || {}),
        ...((settings || {}).limits || {}),
      },
    };
    updateSttCapacityNote();
  } catch (_error) {
    // Settings are optional in non-desktop test environments.
  }
}

function sttUploadLimitBytes() {
  const mb = Number(appSettings.limits?.sttAudioMb || 120);
  const safeMb = Number.isFinite(mb) && mb > 0 ? mb : 120;
  return Math.max(1, Math.min(4096, safeMb)) * 1024 * 1024;
}

function sttLimitMbLabel() {
  const bytes = sttUploadLimitBytes();
  const mb = bytes / (1024 * 1024);
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)}MB`;
}

function updateSttCapacityNote() {
  if (!sttCapacityNote) return;
  sttCapacityNote.textContent = `고정 시간 제한은 없습니다. 다만 메모리·디스크 보호를 위해 처리용 음성은 작업당 ${sttLimitMbLabel()}까지이며, 길수록 준비와 받아쓰기에 시간이 더 걸립니다.`;
}

function assertSttAudioWithinByteLimit(byteLength, label = "음성") {
  if (Number(byteLength || 0) <= sttUploadLimitBytes()) return;
  throw new Error(`${label}이 현재 ${sttLimitMbLabel()} 용량 한도를 넘습니다. 고정 시간 제한은 없지만 더 작은 파일로 나눠 주세요.`);
}

function estimateSttWavBytes(durationSeconds) {
  const seconds = Math.max(0, Number(durationSeconds) || 0);
  return STT_WAV_HEADER_BYTES + Math.ceil(seconds * STT_WAV_BYTES_PER_SECOND);
}

async function cancelSttTranscription() {
  if (!isSttWhisperActive || isSttCancelPending || !window.desktopAPI?.cancelSpeechTranscription) return;
  isSttCancelPending = true;
  setSttButtons();
  setSttStatus("transcribing", "Whisper 받아쓰기 취소 요청 중", "transcribe");
  try {
    const result = await window.desktopAPI.cancelSpeechTranscription();
    if (!isSttTranscribing) return;
    if (result?.canceled) {
      setSttStatus("transcribing", "Whisper 받아쓰기 취소 처리 중", "transcribe");
      return;
    }
    isSttCancelPending = false;
    setSttButtons();
    setSttStatus("transcribing", "취소할 Whisper 받아쓰기 작업을 찾지 못했습니다.", "transcribe");
  } catch (_error) {
    if (!isSttTranscribing) return;
    isSttCancelPending = false;
    setSttButtons();
    setSttStatus("transcribing", "취소 요청을 전달하지 못했습니다. 받아쓰기는 계속 진행 중입니다.", "transcribe");
  }
}

async function transcribeSttWav(wav, options = {}) {
  isSttWhisperActive = true;
  setSttButtons();
  try {
    const result = await window.desktopAPI?.transcribeSpeech?.({
      base64: uint8ToBase64(wav),
      mimeType: "audio/wav",
      durationSeconds: options.durationSeconds || 0,
      language: sttLanguageInput?.value || "ko",
      model: sttModelInput?.value || "lite",
      resultMode: sttResultModeInput?.value || "cleanup",
      initialPrompt: String(sttInitialPromptInput?.value || "").replaceAll("\0", "").slice(0, 500),
      fileName: options.sourceName || "",
      sourceMimeType: options.sourceMimeType || "",
      sourceSize: options.sourceSize || 0,
      vad: {
        enabled: Boolean(sttVadInput?.checked && !sttVadInput?.disabled),
      },
      retainOriginalAudio: sttRetainAudioInput?.checked !== false,
    });
    handleSttResult(result);
  } finally {
    isSttWhisperActive = false;
    isSttCancelPending = false;
    setSttButtons();
  }
}

function handleSttResult(result) {
  if (result?.canceled || result?.status === "canceled" || result?.errorCode === "STT_CANCELED") {
    clearSttTranscriptResult();
    setSttStatus("canceled", result?.message || "받아쓰기를 취소했습니다.", "canceled");
    return;
  }
  if (result?.ok && result.transcript) {
    const visibleTranscript = result.displayTranscript || result.transcript;
    lastSttTranscript = visibleTranscript;
    if (sttTranscriptInput) sttTranscriptInput.value = visibleTranscript;
    renderSttOutputLinks(result);
    setSttStatus("done", "받아쓰기·저장 완료", "done");
    const sourceNote = result.audio?.sourceName ? `\n원본: ${result.audio.sourceName}` : "";
    messages.push({
      from: "them",
      time: currentTime(),
      text: `받아쓰기 원문을 만들었습니다. 자동인식 결과라서 숫자, 날짜, 이름을 먼저 확인해 주세요. AI 정리본은 원문과 분리해 요청할 수 있습니다.${result.workspacePath ? `\n\n저장: ${result.workspacePath}` : ""}${sourceNote}`,
    });
  } else {
    const suggestions = Array.isArray(result?.suggestions) && result.suggestions.length
      ? `\n\n${result.suggestions.map((item) => `- ${item}`).join("\n")}`
      : "";
    setSttStatus("error", result?.statusLabel || "변환 실패");
    messages.push({
      from: "them",
      time: currentTime(),
      text: `${result?.message || "Whisper 받아쓰기를 완료하지 못했습니다."}${suggestions}`,
      error: true,
    });
  }
  persistMessages();
  renderMessages();
}

function clearSttTranscriptResult() {
  lastSttTranscript = "";
  if (sttTranscriptInput) sttTranscriptInput.value = "";
  renderSttOutputLinks(null);
}

function renderSttOutputLinks(result) {
  if (!sttOutputCard || !sttOutputLinks) return;
  sttOutputLinks.replaceChildren();
  if (!result) {
    sttOutputCard.hidden = true;
    return;
  }

  const candidates = [];
  const append = (label, value) => {
    const pathValue = typeof value === "string" ? value : value?.path || value?.workspacePath || value?.filePath || "";
    if (!pathValue || candidates.some((item) => item.path === pathValue)) return;
    candidates.push({ label, path: pathValue });
  };
  const appendMap = (map) => {
    if (!map || typeof map !== "object" || Array.isArray(map)) return;
    Object.entries(map).forEach(([key, value]) => append(sttOutputLabel(key, value), value));
  };

  append("TXT 원문", result.workspacePath || result.transcriptPath || result.textPath);
  append("SRT 자막", result.srtPath);
  append("VTT 자막", result.vttPath);
  append("JSON 타임스탬프", result.jsonPath);
  appendMap(result.outputPaths);
  appendMap(result.outputs);
  appendMap(result.exports);
  if (Array.isArray(result.exports)) {
    result.exports.forEach((item) => append(sttOutputLabel(item?.type || item?.format || item?.label, item), item));
  }
  append("처리용 음성", result.audio?.workspacePath || result.audio?.savedPath || result.audio?.path || result.audio?.sourcePath || result.sourcePath);

  candidates.forEach((item) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "stt-output-link";
    button.textContent = item.label;
    button.title = item.path;
    button.addEventListener("click", async () => {
      if (!window.desktopAPI?.openConverterOutput) return;
      const opened = await window.desktopAPI.openConverterOutput(item.path);
      if (opened?.ok === false) setSttStatus("error", opened.message || "파일 위치를 열지 못했습니다.");
    });
    sttOutputLinks.append(button);
  });
  sttOutputCard.hidden = candidates.length === 0;
}

function sttOutputLabel(key, value) {
  const source = `${key || ""} ${typeof value === "string" ? value : value?.path || value?.filePath || ""}`.toLowerCase();
  if (source.includes("rawtxt") || source.includes("raw-txt")) return "Whisper 원문 TXT";
  if (source.includes("cleanedtxt") || source.includes("cleaned-txt")) return "읽기용 TXT";
  if (source.includes(".srt") || source.includes("srt")) return "SRT 자막";
  if (source.includes(".vtt") || source.includes("vtt")) return "VTT 자막";
  if (source.includes(".json") || source.includes("json")) return "JSON 타임스탬프";
  if (source.includes("audio") || /\.(?:wav|mp3|m4a|flac|ogg|webm)(?:$|\s)/i.test(source)) return "처리용 음성";
  return "TXT 원문";
}

function insertSttPrompt(mode) {
  const transcript = (sttTranscriptInput?.value || lastSttTranscript || "").trim();
  if (!transcript) {
    setSttStatus("error", "넣을 STT 원문이 없습니다.");
    return;
  }
  input.textContent = buildSttPrompt(mode === "auto" ? sttResultModeInput?.value || "cleanup" : mode, transcript);
  input.focus();
}

function buildSttPrompt(mode, transcript) {
  const source = `[받아쓰기 원문 · Whisper 자동인식 · AI 초안 아님]\n${transcript}`;
  if (mode === "raw") return source;
  if (mode === "minutes") {
    return `아래 받아쓰기 원문을 회의록 AI 초안으로 정리해줘. 원문에 없는 사실, 화자 이름, 결정, 담당자, 기한은 만들지 말고 불명확하면 [확인 필요]로 표시해. 숫자, 날짜, 단위, 고유명사는 원문 표현을 유지하고 안건, 주요 발언, 결정사항, 할 일, 확인 필요 사항으로 나눠줘.\n\n${source}`;
  }
  if (mode === "tasks") {
    return `아래 받아쓰기 원문에서 할 일 AI 초안을 만들어줘. 작업, 담당자, 기한, 근거 발언, 확인 필요 사항을 분리하고 원문에 없는 담당자나 기한은 [확인 필요]로 둬. 추정한 화자 신원은 쓰지 마.\n\n${source}`;
  }
  if (mode === "ppt") {
    return `아래 받아쓰기 원문만 근거로 PPT 재료 AI 초안을 만들어줘. 슬라이드 후보 제목, 핵심 메시지, 넣을 내용, 시각 요소 후보를 뽑고 원문 밖의 수치나 사례를 추가하지 마.\n\n${source}`;
  }
  return `아래 받아쓰기 원문을 자연스러운 업무 문장의 AI 초안으로 정제해줘. 말버릇, 중복, 어색한 구어체만 정리하고 원문에 없는 사실은 추가하지 마. 숫자, 날짜, 단위, 고유명사는 보존하고 불명확한 부분은 [확인 필요]로 남겨.\n\n${source}`;
}

function setSttStatus(state, text, stageKey = "") {
  if (!sttStatus) return;
  const normalizedState = state || "idle";
  sttStatus.dataset.state = normalizedState;
  sttStatus.textContent = text || "녹음 대기 중";
  if (sttRecordingBadge) sttRecordingBadge.hidden = normalizedState !== "recording";
  updateSttStage(stageKey || ({ recording: "capture", transcribing: "transcribe", canceled: "canceled", done: "done", error: "error" }[normalizedState] || "idle"));
}

function updateSttStage(stageKey) {
  const order = ["capture", "transcribe", "export"];
  const labels = { idle: "대기", capture: "1단계", transcribe: "2단계", export: "3단계", canceled: "취소됨", done: "완료", error: "확인 필요" };
  if (sttStage) sttStage.textContent = labels[stageKey] || "처리 중";
  const effectiveStage = stageKey === "error" || stageKey === "canceled" ? currentSttStageKey : stageKey;
  const activeIndex = order.indexOf(effectiveStage);
  sttStageStrip?.querySelectorAll("[data-stt-stage]").forEach((node, index) => {
    if (stageKey === "done") {
      node.dataset.state = "done";
    } else if (stageKey === "error" || stageKey === "canceled") {
      node.dataset.state = index < activeIndex ? "done" : index === activeIndex ? stageKey : "pending";
    } else {
      node.dataset.state = index < activeIndex ? "done" : index === activeIndex ? "active" : "pending";
    }
  });
  if (stageKey === "done") currentSttStageKey = "export";
  else if (stageKey !== "error" && stageKey !== "canceled") currentSttStageKey = stageKey;
}

function setSttButtons() {
  const runtimeBlocked = isSttRuntimeReady === false;
  const installBlocked = Boolean(activeSttInstallAssetId);
  if (sttRecordButton) sttRecordButton.disabled = isSttRecording || isSttTranscribing || runtimeBlocked || installBlocked;
  if (sttStopButton) sttStopButton.disabled = !isSttRecording || isSttTranscribing;
  if (sttFileButton) sttFileButton.disabled = isSttRecording || isSttTranscribing || runtimeBlocked || installBlocked;
  if (sttCancelButton) {
    sttCancelButton.hidden = !isSttWhisperActive;
    sttCancelButton.disabled = !isSttWhisperActive || isSttCancelPending || !window.desktopAPI?.cancelSpeechTranscription;
  }
  sttAssetList?.querySelectorAll("[data-stt-install-asset]").forEach((button) => {
    button.disabled = button.dataset.bundled === "true" || Boolean(activeSttInstallAssetId) || isSttRecording || isSttTranscribing || button.closest("[data-state='incompatible']") != null || !window.desktopAPI?.selectSttAssetFile || !window.desktopAPI?.installSttAsset;
  });
}

function updateSttTimer() {
  if (!sttTimer) return;
  if (!isSttRecording) {
    sttTimer.textContent = "00:00";
    return;
  }
  const elapsed = Math.max(0, Math.floor((Date.now() - sttRecordingStartedAt) / 1000));
  const minutes = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const seconds = String(elapsed % 60).padStart(2, "0");
  sttTimer.textContent = `${minutes}:${seconds}`;
  const safetyMarginBytes = STT_WAV_BYTES_PER_SECOND * 2;
  if (estimateSttWavBytes(elapsed) >= Math.max(STT_WAV_HEADER_BYTES, sttUploadLimitBytes() - safetyMarginBytes)) {
    setSttStatus("recording", `${sttLimitMbLabel()} 용량 보호 한도 도달 · 자동으로 정지하고 받아쓰는 중`, "capture");
    void stopAndTranscribeStt();
  }
}

function cleanupSttRecorder() {
  isSttRecording = false;
  if (sttTimerId) window.clearInterval(sttTimerId);
  sttTimerId = null;
  try {
    sttProcessorNode?.disconnect();
    sttSourceNode?.disconnect();
  } catch (_error) {
    // Best effort.
  }
  try {
    sttStream?.getTracks?.().forEach((track) => track.stop());
  } catch (_error) {
    // Best effort.
  }
  try {
    sttAudioContext?.close?.();
  } catch (_error) {
    // Best effort.
  }
  sttStream = null;
  sttAudioContext = null;
  sttSourceNode = null;
  sttProcessorNode = null;
  setSttButtons();
}

async function decodeSttAudioFile(file) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) {
    throw new Error("이 환경에서는 오디오 파일 디코딩을 사용할 수 없습니다.");
  }
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new AudioContextCtor();
  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const mono = audioBufferToMonoSamples(audioBuffer);
    return {
      wav: encodeWav([mono], audioBuffer.sampleRate),
      durationSeconds: Math.round(audioBuffer.duration * 10) / 10,
      sampleRate: audioBuffer.sampleRate,
      channels: audioBuffer.numberOfChannels,
    };
  } catch (error) {
    throw new Error(`${file.name || "선택한 파일"} 형식을 읽을 수 없습니다. wav, mp3, m4a처럼 일반 오디오 파일로 다시 시도해 주세요.`);
  } finally {
    try {
      await audioContext.close();
    } catch (_error) {
      // Best effort.
    }
  }
}

function audioBufferToMonoSamples(audioBuffer) {
  const channelCount = Math.max(1, audioBuffer.numberOfChannels || 1);
  const length = audioBuffer.length || 0;
  if (channelCount === 1) return new Float32Array(audioBuffer.getChannelData(0));
  const samples = new Float32Array(length);
  for (let channel = 0; channel < channelCount; channel += 1) {
    const channelData = audioBuffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) {
      samples[index] += channelData[index] / channelCount;
    }
  }
  return samples;
}

function encodeWav(chunks, sampleRate) {
  const samples = resampleAudio(mergeAudioChunks(chunks), sampleRate, STT_WAV_SAMPLE_RATE);
  const wavSampleRate = STT_WAV_SAMPLE_RATE;
  const dataLength = samples.length * 2;
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, wavSampleRate, true);
  view.setUint32(28, wavSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataLength, true);
  let offset = 44;
  for (const sample of samples) {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function resampleAudio(samples, fromRate, toRate) {
  const sourceRate = Number(fromRate) || toRate;
  if (sourceRate === toRate) return samples;
  const ratio = sourceRate / toRate;
  const newLength = Math.max(1, Math.round(samples.length / ratio));
  const result = new Float32Array(newLength);
  for (let index = 0; index < newLength; index += 1) {
    const sourceIndex = index * ratio;
    const left = Math.floor(sourceIndex);
    const right = Math.min(samples.length - 1, left + 1);
    const weight = sourceIndex - left;
    result[index] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return result;
}

function mergeAudioChunks(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const samples = new Float32Array(length);
  let offset = 0;
  chunks.forEach((chunk) => {
    samples.set(chunk, offset);
    offset += chunk.length;
  });
  return samples;
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
}

function uint8ToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return window.btoa(binary);
}

const DOCUMENT_RESOURCE_CATEGORIES = {
  image: { label: "이미지", icon: "image" },
  video: { label: "영상", icon: "video" },
  audio: { label: "오디오", icon: "audio-lines" },
  attachment: { label: "첨부 파일", icon: "paperclip" },
  font: { label: "글꼴", icon: "case-sensitive" },
  style: { label: "테마·서식", icon: "palette" },
  script: { label: "스크립트·매크로", icon: "shield-alert" },
  structure: { label: "문서 구조", icon: "blocks" },
  other: { label: "기타 파일", icon: "file" },
};

const DOCUMENT_RESOURCE_CATEGORY_ALIASES = {
  "style-theme": "style",
  "macro-script": "script",
  "document-structure": "structure",
};

function setupDocumentResourcePanel() {
  if (!documentResourcePanel) return;
  const enabled = isDocumentResourceOfficer();
  documentResourcePanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-document-resource-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-document-resource-panel", enabled);
  if (!enabled) return;

  if (attachButton) {
    attachButton.setAttribute("aria-label", "문서 자원 추출 파일 선택");
    attachButton.title = "문서는 채팅에 첨부하지 않고 로컬 분석 패널에서 엽니다.";
  }
  documentResourceSelectButton?.addEventListener("click", selectDocumentResourceFile);
  documentResourceSearchInput?.addEventListener("input", renderDocumentResourceList);
  documentResourcePreviewButton?.addEventListener("click", previewSelectedDocumentResource);
  documentResourceSaveButton?.addEventListener("click", saveSelectedDocumentResource);
  documentResourceSaveAllButton?.addEventListener("click", saveAllDocumentResources);
  documentResourceCancelButton?.addEventListener("click", cancelDocumentResourceJob);
  documentResourceClearButton?.addEventListener("click", clearDocumentResourceSession);
  documentResourceOpenOutputButton?.addEventListener("click", openDocumentResourceOutput);

  ["dragenter", "dragover"].forEach((eventName) => {
    documentResourceSelectButton?.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      documentResourceSelectButton.classList.add("is-dragging");
    });
  });
  ["dragleave", "drop"].forEach((eventName) => {
    documentResourceSelectButton?.addEventListener(eventName, (event) => {
      event.preventDefault();
      event.stopPropagation();
      documentResourceSelectButton.classList.remove("is-dragging");
      if (eventName !== "drop") return;
      setDocumentResourceStatus(
        "파일 경로를 직접 읽지 않았습니다.",
        "보안을 위해 끌어 놓은 파일 대신 안전한 선택 창을 엽니다.",
        "ready",
      );
      void selectDocumentResourceFile();
    });
  });

  disposeDocumentResourceProgress = window.desktopAPI?.onDocumentResourceProgress?.(handleDocumentResourceProgress) || null;
  resetDocumentResourceUi();
}

function formatDocumentResourceBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "크기 미상";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

function documentResourceCategoryMeta(category) {
  return DOCUMENT_RESOURCE_CATEGORIES[category] || DOCUMENT_RESOURCE_CATEGORIES.other;
}

function setDocumentResourceStatus(title, detail, state = "idle") {
  if (!documentResourceStatus) return;
  documentResourceStatus.dataset.state = state;
  documentResourceStatus.innerHTML = `<strong>${escapeHtml(title || "대기 중")}</strong><span>${escapeHtml(detail || "")}</span>`;
}

function setDocumentResourceBusy(busy) {
  isDocumentResourceBusy = Boolean(busy);
  const selected = selectedDocumentResource();
  const canPreview = Boolean(selected && selected.category === "image" && selected.previewEligible !== false);
  if (documentResourceSelectButton) documentResourceSelectButton.disabled = isDocumentResourceBusy;
  if (documentResourceCancelButton) documentResourceCancelButton.disabled = !isDocumentResourceBusy;
  if (documentResourceClearButton) documentResourceClearButton.disabled = isDocumentResourceBusy || !documentResourceSessionId;
  if (documentResourceSaveAllButton) documentResourceSaveAllButton.disabled = isDocumentResourceBusy || !documentResources.length;
  if (documentResourcePreviewButton) documentResourcePreviewButton.disabled = isDocumentResourceBusy || !canPreview;
  if (documentResourceSaveButton) documentResourceSaveButton.disabled = isDocumentResourceBusy || !documentResourceSelectedId;
}

function resetDocumentResourceUi() {
  documentResourceSessionId = "";
  documentResourceFile = null;
  documentResources = [];
  documentResourceCategory = "all";
  documentResourceSelectedId = "";
  isDocumentResourceCancelPending = false;
  if (documentResourceSearchInput) documentResourceSearchInput.value = "";
  if (documentResourceProgress) documentResourceProgress.hidden = true;
  if (documentResourceBrowser) documentResourceBrowser.hidden = true;
  if (documentResourceDetail) documentResourceDetail.hidden = true;
  if (documentResourceSummary) {
    documentResourceSummary.innerHTML = "<strong>아직 선택한 문서가 없습니다.</strong><span>문서를 고르면 파일 형식, 리소스 수와 분류별 개수를 여기에 표시합니다.</span>";
  }
  clearDocumentResourcePreview();
  setDocumentResourceStatus("대기 중", "원본을 수정하지 않고 로컬에서만 분석합니다.", "idle");
  setDocumentResourceBusy(false);
}

function handleDocumentResourceProgress(progress = {}) {
  if (!isDocumentResourceOfficer()) return;
  if (progress.sessionId && documentResourceSessionId && progress.sessionId !== documentResourceSessionId) return;
  const total = Number(progress.totalEntries || progress.totalBytes || 0);
  const processed = Number(progress.processedEntries || progress.processedBytes || 0);
  const calculatedPercent = total > 0 ? (processed / total) * 100 : 0;
  const percent = Math.max(0, Math.min(100, Number(progress.percent ?? progress.progress ?? calculatedPercent) || 0));
  const stageLabels = {
    validate: "문서 형식과 안전 제한 확인 중",
    scan: "문서 내부 자원을 분류하는 중",
    preview: "안전 미리보기 확인 중",
    save: "리소스를 저장하는 중",
    done: "로컬 분석 완료",
  };
  const label = progress.message || progress.label || stageLabels[progress.stage] || documentResourceProgressLabel?.textContent || "문서를 확인하는 중";
  if (documentResourceProgress) documentResourceProgress.hidden = false;
  if (documentResourceProgressLabel) documentResourceProgressLabel.textContent = label;
  if (documentResourceProgressValue) documentResourceProgressValue.textContent = `${Math.round(percent)}%`;
  if (documentResourceProgressBar) {
    documentResourceProgressBar.value = percent;
    documentResourceProgressBar.textContent = `${Math.round(percent)}%`;
  }
  setDocumentResourceStatus("로컬 분석 중", label, "working");
}

function unwrapDocumentResourceResult(result) {
  if (!result || typeof result !== "object") return {};
  return result.result && typeof result.result === "object"
    ? { ...result, ...result.result }
    : result.extraction && typeof result.extraction === "object"
      ? { ...result, ...result.extraction }
      : result;
}

function normalizeDocumentResource(resource) {
  const category = DOCUMENT_RESOURCE_CATEGORY_ALIASES[resource.category] || resource.category || "other";
  const usage = resource.usage ?? resource.usageLocations ?? resource.usedIn ?? [];
  return {
    ...resource,
    id: resource.id ?? resource.resourceId,
    path: resource.path ?? resource.archivePath ?? "",
    size: resource.size ?? resource.sizeBytes,
    category: DOCUMENT_RESOURCE_CATEGORIES[category] ? category : "other",
    usage: Array.isArray(usage) ? usage : usage ? [usage] : [],
  };
}

function documentResourceErrorText(result, fallback) {
  return result?.error || result?.message || fallback;
}

async function selectDocumentResourceFile() {
  if (!isDocumentResourceOfficer() || isDocumentResourceBusy) return;
  if (!window.desktopAPI?.selectDocumentResourceFile || !window.desktopAPI?.analyzeDocumentResources) {
    setDocumentResourceStatus("문서 분석 기능을 사용할 수 없습니다.", "데스크톱 앱에서 다시 열어 주세요.", "error");
    return;
  }

  try {
    isDocumentResourceCancelPending = false;
    const selection = await window.desktopAPI.selectDocumentResourceFile();
    if (!selection || selection.canceled) return;
    if (selection.ok === false) throw new Error(documentResourceErrorText(selection, "파일 선택에 실패했습니다."));
    const file = selection.file || selection.handle || selection;
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      throw new Error("안전한 파일 선택 정보가 전달되지 않았습니다.");
    }

    if (documentResourceSessionId) {
      await window.desktopAPI.clearDocumentResourceSession?.({ sessionId: documentResourceSessionId });
    }
    resetDocumentResourceUi();
    documentResourceFile = file;
    setDocumentResourceBusy(true);
    if (documentResourceProgress) documentResourceProgress.hidden = false;
    if (documentResourceProgressLabel) documentResourceProgressLabel.textContent = "문서 패키지를 확인하는 중";
    if (documentResourceProgressValue) documentResourceProgressValue.textContent = "0%";
    if (documentResourceProgressBar) documentResourceProgressBar.value = 0;
    setDocumentResourceStatus("로컬 분석 중", "확장자와 내부 패키지 구조를 함께 확인합니다.", "working");

    const response = await window.desktopAPI.analyzeDocumentResources({ file: documentResourceFile });
    if (!response || response.ok === false) {
      if (response?.canceled) {
        setDocumentResourceStatus("분석을 취소했습니다.", "원본 문서는 변경되지 않았습니다.", "ready");
        return;
      }
      throw new Error(documentResourceErrorText(response, "문서 분석에 실패했습니다."));
    }
    const result = unwrapDocumentResourceResult(response);
    const resources = Array.isArray(result.resources)
      ? result.resources
        .filter((item) => item && typeof item === "object" && (item.id != null || item.resourceId != null))
        .map(normalizeDocumentResource)
      : [];
    documentResourceSessionId = String(result.sessionId || response.sessionId || "");
    if (!documentResourceSessionId) throw new Error("분석 세션을 확인할 수 없습니다.");
    documentResources = resources;
    documentResourceCategory = "all";
    documentResourceSelectedId = resources[0]?.id != null ? String(resources[0].id) : "";
    renderDocumentResourceSummary(result);
    renderDocumentResourceFilters();
    renderDocumentResourceList();
    if (documentResourceBrowser) documentResourceBrowser.hidden = false;
    if (documentResourceProgress) documentResourceProgress.hidden = true;
    setDocumentResourceStatus(
      "분석 완료",
      `${resources.length.toLocaleString("ko-KR")}개 리소스를 로컬에서 찾았습니다. 채팅 LLM에는 문서가 전달되지 않았습니다.`,
      "done",
    );
  } catch (error) {
    if (isDocumentResourceCancelPending) {
      setDocumentResourceStatus("분석을 취소했습니다.", "원본 문서는 변경되지 않았습니다.", "ready");
    } else {
      setDocumentResourceStatus("문서를 분석하지 못했습니다.", error?.message || String(error), "error");
    }
    if (documentResourceProgress) documentResourceProgress.hidden = true;
  } finally {
    isDocumentResourceCancelPending = false;
    setDocumentResourceBusy(false);
    createIcons();
  }
}

function renderDocumentResourceSummary(result = {}) {
  if (!documentResourceSummary) return;
  const fileName = result.fileName || result.document?.name || documentResourceFile?.name || "선택한 문서";
  const fileSize = result.fileSize ?? result.sourceSizeBytes ?? result.document?.sizeBytes ?? result.document?.size ?? documentResourceFile?.sizeBytes ?? documentResourceFile?.size;
  const format = result.formatLabel || result.document?.formatLabel || String(result.kind || result.extension || result.document?.extension || documentResourceFile?.extension || "").replace(/^\./, "").toUpperCase();
  const categoryCounts = documentResources.reduce((counts, resource) => {
    const category = DOCUMENT_RESOURCE_CATEGORIES[resource.category] ? resource.category : "other";
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
  const countText = Object.entries(categoryCounts)
    .map(([category, count]) => `${documentResourceCategoryMeta(category).label} ${count}`)
    .join(" · ");
  documentResourceSummary.innerHTML = `
    <strong>${escapeHtml(fileName)}</strong>
    <span>${escapeHtml([format, formatDocumentResourceBytes(fileSize), `리소스 ${documentResources.length.toLocaleString("ko-KR")}개`].filter(Boolean).join(" · "))}</span>
    ${countText ? `<small>${escapeHtml(countText)}</small>` : ""}
  `;
}

function renderDocumentResourceFilters() {
  if (!documentResourceFilters) return;
  const counts = documentResources.reduce((result, resource) => {
    const category = DOCUMENT_RESOURCE_CATEGORIES[resource.category] ? resource.category : "other";
    result[category] = (result[category] || 0) + 1;
    return result;
  }, {});
  const filters = [
    { id: "all", label: "전체", count: documentResources.length },
    ...Object.keys(DOCUMENT_RESOURCE_CATEGORIES)
      .filter((category) => counts[category])
      .map((category) => ({ id: category, label: documentResourceCategoryMeta(category).label, count: counts[category] })),
  ];
  documentResourceFilters.innerHTML = filters.map((filter) => `
    <button type="button" data-document-resource-filter="${escapeHtml(filter.id)}" aria-pressed="${filter.id === documentResourceCategory}">
      ${escapeHtml(filter.label)} <span>${filter.count}</span>
    </button>
  `).join("");
  documentResourceFilters.querySelectorAll("[data-document-resource-filter]").forEach((button) => {
    button.addEventListener("click", () => {
      documentResourceCategory = button.dataset.documentResourceFilter || "all";
      renderDocumentResourceFilters();
      renderDocumentResourceList();
    });
  });
}

function filteredDocumentResources() {
  const query = documentResourceSearchInput?.value.trim().toLocaleLowerCase("ko-KR") || "";
  return documentResources.filter((resource) => {
    const category = DOCUMENT_RESOURCE_CATEGORIES[resource.category] ? resource.category : "other";
    if (documentResourceCategory !== "all" && category !== documentResourceCategory) return false;
    if (!query) return true;
    const usage = Array.isArray(resource.usage) ? resource.usage.join(" ") : String(resource.usage || "");
    return `${resource.name || ""} ${resource.path || ""} ${resource.extension || ""} ${usage}`.toLocaleLowerCase("ko-KR").includes(query);
  });
}

function renderDocumentResourceList() {
  if (!documentResourceList) return;
  const resources = filteredDocumentResources();
  if (documentResourceCount) documentResourceCount.textContent = `${resources.length.toLocaleString("ko-KR")}개 표시`;
  if (!resources.length) {
    documentResourceList.innerHTML = '<div class="document-resource-empty">조건에 맞는 리소스가 없습니다.</div>';
    if (documentResourceDetail) documentResourceDetail.hidden = true;
    return;
  }
  if (!resources.some((resource) => String(resource.id) === documentResourceSelectedId)) {
    documentResourceSelectedId = String(resources[0].id);
  }
  documentResourceList.innerHTML = resources.map((resource) => {
    const id = String(resource.id);
    const meta = documentResourceCategoryMeta(resource.category);
    return `
      <button class="document-resource-row ${id === documentResourceSelectedId ? "is-selected" : ""}" type="button" role="listitem" data-document-resource-id="${escapeHtml(id)}" aria-pressed="${id === documentResourceSelectedId}">
        <i data-lucide="${escapeHtml(meta.icon)}"></i>
        <span><strong>${escapeHtml(resource.name || resource.path || "이름 없는 리소스")}</strong><small>${escapeHtml(meta.label)} · ${escapeHtml(formatDocumentResourceBytes(resource.size))}</small></span>
        <i data-lucide="chevron-right"></i>
      </button>
    `;
  }).join("");
  documentResourceList.querySelectorAll("[data-document-resource-id]").forEach((button) => {
    button.addEventListener("click", () => {
      documentResourceSelectedId = button.dataset.documentResourceId || "";
      renderDocumentResourceList();
    });
  });
  renderSelectedDocumentResource();
  createIcons();
}

function selectedDocumentResource() {
  return documentResources.find((resource) => String(resource.id) === documentResourceSelectedId) || null;
}

function renderSelectedDocumentResource() {
  const resource = selectedDocumentResource();
  if (!documentResourceDetail) return;
  documentResourceDetail.hidden = !resource;
  if (!resource) return;
  const usage = Array.isArray(resource.usage) ? resource.usage.filter(Boolean) : resource.usage ? [resource.usage] : [];
  if (documentResourceDetailName) documentResourceDetailName.textContent = resource.name || "이름 없는 리소스";
  if (documentResourceDetailCategory) documentResourceDetailCategory.textContent = documentResourceCategoryMeta(resource.category).label;
  if (documentResourceDetailSize) documentResourceDetailSize.textContent = formatDocumentResourceBytes(resource.size);
  if (documentResourceDetailPath) documentResourceDetailPath.textContent = resource.path || "경로 정보 없음";
  if (documentResourceDetailUsage) documentResourceDetailUsage.textContent = usage.length ? usage.join(" · ") : "사용 위치 정보 없음";
  const previewMessage = resource.category !== "image"
    ? "이미지 리소스만 안전 미리보기를 제공합니다."
    : resource.previewEligible === false
      ? resource.previewReason || "이 이미지는 안전 미리보기를 제공하지 않습니다."
      : "안전 미리보기를 눌러 확인하세요.";
  clearDocumentResourcePreview(previewMessage);
  setDocumentResourceBusy(isDocumentResourceBusy);
}

function clearDocumentResourcePreview(message = "미리보기를 눌러 확인하세요.") {
  if (!documentResourcePreview) return;
  documentResourcePreview.innerHTML = `<i data-lucide="image-off"></i><span>${escapeHtml(message)}</span>`;
  createIcons();
}

function safeRasterDataUrl(result) {
  const payload = result?.preview && typeof result.preview === "object" ? result.preview : result;
  let dataUrl = typeof payload?.dataUrl === "string" ? payload.dataUrl : "";
  if (!dataUrl && typeof payload?.base64 === "string") {
    const mime = String(payload.mimeType || payload.mime || "").toLowerCase();
    if (/^image\/(?:png|jpe?g|webp)$/.test(mime)) dataUrl = `data:${mime};base64,${payload.base64}`;
  }
  if (dataUrl.length > 32 * 1024 * 1024) return "";
  return /^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=\s]+$/i.test(dataUrl) ? dataUrl : "";
}

async function previewSelectedDocumentResource() {
  const resource = selectedDocumentResource();
  if (!resource || !documentResourceSessionId || isDocumentResourceBusy) return;
  if (!window.desktopAPI?.previewDocumentResource) {
    clearDocumentResourcePreview("미리보기 기능을 사용할 수 없습니다.");
    return;
  }
  setDocumentResourceBusy(true);
  clearDocumentResourcePreview("안전한 래스터 미리보기를 준비하는 중입니다.");
  try {
    const result = await window.desktopAPI.previewDocumentResource({
      sessionId: documentResourceSessionId,
      resourceId: resource.id,
    });
    if (!result || result.ok === false) throw new Error(documentResourceErrorText(result, "이 형식은 미리볼 수 없습니다."));
    const dataUrl = safeRasterDataUrl(result);
    if (!dataUrl) throw new Error("정적 PNG·JPEG·WebP만 안전하게 미리볼 수 있습니다.");
    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = `${resource.name || "리소스"} 미리보기`;
    image.decoding = "async";
    documentResourcePreview.replaceChildren(image);
  } catch (error) {
    clearDocumentResourcePreview(error?.message || String(error));
  } finally {
    setDocumentResourceBusy(false);
  }
}

async function saveSelectedDocumentResource() {
  const resource = selectedDocumentResource();
  if (!resource || !documentResourceSessionId || isDocumentResourceBusy) return;
  if (!window.desktopAPI?.saveDocumentResource) {
    setDocumentResourceStatus("저장 기능을 사용할 수 없습니다.", "데스크톱 앱에서 다시 열어 주세요.", "error");
    return;
  }
  setDocumentResourceBusy(true);
  try {
    const result = await window.desktopAPI.saveDocumentResource({
      sessionId: documentResourceSessionId,
      resourceId: resource.id,
    });
    if (result?.canceled) return;
    if (!result || result.ok === false) throw new Error(documentResourceErrorText(result, "리소스를 저장하지 못했습니다."));
    setDocumentResourceStatus("선택한 리소스를 저장했습니다.", result.fileName || result.outputName || resource.name || "결과 폴더에서 확인하세요.", "done");
  } catch (error) {
    setDocumentResourceStatus("리소스를 저장하지 못했습니다.", error?.message || String(error), "error");
  } finally {
    setDocumentResourceBusy(false);
  }
}

async function saveAllDocumentResources() {
  if (!documentResourceSessionId || !documentResources.length || isDocumentResourceBusy) return;
  if (!window.desktopAPI?.saveAllDocumentResources) {
    setDocumentResourceStatus("전체 ZIP 기능을 사용할 수 없습니다.", "데스크톱 앱에서 다시 열어 주세요.", "error");
    return;
  }
  setDocumentResourceBusy(true);
  try {
    const result = await window.desktopAPI.saveAllDocumentResources({ sessionId: documentResourceSessionId });
    if (result?.canceled) return;
    if (!result || result.ok === false) throw new Error(documentResourceErrorText(result, "전체 ZIP을 저장하지 못했습니다."));
    setDocumentResourceStatus("전체 ZIP을 저장했습니다.", result.fileName || result.outputName || "결과 폴더에서 확인하세요.", "done");
  } catch (error) {
    setDocumentResourceStatus("전체 ZIP을 저장하지 못했습니다.", error?.message || String(error), "error");
  } finally {
    setDocumentResourceBusy(false);
  }
}

async function cancelDocumentResourceJob() {
  if (!isDocumentResourceBusy || !window.desktopAPI?.cancelDocumentResourceJob) return;
  if (documentResourceCancelButton) documentResourceCancelButton.disabled = true;
  try {
    isDocumentResourceCancelPending = true;
    const result = await window.desktopAPI.cancelDocumentResourceJob();
    if (result?.ok === false) throw new Error(documentResourceErrorText(result, "취소하지 못했습니다."));
    setDocumentResourceStatus("취소 요청을 보냈습니다.", "진행 중인 로컬 분석을 안전하게 정리하고 있습니다.", "ready");
  } catch (error) {
    isDocumentResourceCancelPending = false;
    setDocumentResourceStatus("취소 요청에 실패했습니다.", error?.message || String(error), "error");
  }
}

async function clearDocumentResourceSession() {
  if (isDocumentResourceBusy || !documentResourceSessionId) return;
  const sessionId = documentResourceSessionId;
  try {
    const result = await window.desktopAPI?.clearDocumentResourceSession?.({ sessionId });
    if (result?.ok === false) throw new Error(documentResourceErrorText(result, "세션을 비우지 못했습니다."));
    resetDocumentResourceUi();
  } catch (error) {
    setDocumentResourceStatus("분석 결과를 비우지 못했습니다.", error?.message || String(error), "error");
  }
}

async function openDocumentResourceOutput() {
  if (!window.desktopAPI?.openDocumentResourceOutput) {
    setDocumentResourceStatus("결과 폴더를 열 수 없습니다.", "데스크톱 앱에서 다시 열어 주세요.", "error");
    return;
  }
  try {
    const result = await window.desktopAPI.openDocumentResourceOutput();
    if (result?.ok === false) throw new Error(documentResourceErrorText(result, "결과 폴더를 열지 못했습니다."));
  } catch (error) {
    setDocumentResourceStatus("결과 폴더를 열지 못했습니다.", error?.message || String(error), "error");
  }
}

function setupConverterPanel() {
  if (!converterPanel) return;
  const enabled = isConverterOfficer();
  converterPanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-converter-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-converter-panel", enabled);
  if (!enabled) return;

  converterImageFormatInput?.setAttribute("aria-label", "이미지 출력 형식");
  converterQualityInput?.setAttribute("aria-label", "이미지 변환 품질");
  converterBackgroundInput?.setAttribute("aria-label", "투명 배경 처리");
  converterPdfNameInput?.setAttribute("aria-label", "PDF 병합 파일명");
  converterAddButton?.addEventListener("click", selectConverterFiles);
  converterClearButton?.addEventListener("click", clearConverterFiles);
  converterTabButtons.forEach((button) => {
    button.addEventListener("click", () => setConverterTab(button.dataset.converterTab || "image"));
  });
  converterRunImageButton?.addEventListener("click", runImageConversion);
  converterRunPdfButton?.addEventListener("click", runPdfMerge);
  converterRunPdfMergeButton?.addEventListener("click", runPdfMerge);
  converterRunPdfMergeButtonMain?.addEventListener("click", runPdfMerge);
  converterRunPdfSplitButton?.addEventListener("click", runPdfSplit);
  converterOpenPdfEditorButton?.addEventListener("click", openPdfEditorWindow);
  converterRunCompressButton?.addEventListener("click", runFileCompression);
  converterPdfTargetFileInput?.addEventListener("change", handlePdfTargetFileChange);
  converterPdfOrderFileInput?.addEventListener("change", handlePdfOrderFileChange);
  converterPdfOrderOriginalButton?.addEventListener("click", () => setPdfOrderQuickValue("all"));
  converterPdfOrderReverseButton?.addEventListener("click", () => setPdfOrderQuickValue("reverse"));
  converterPdfOrderOddEvenButton?.addEventListener("click", () => setPdfOrderQuickValue("odd-even"));
  converterInspectPdfButton?.addEventListener("click", inspectSelectedPdf);
  converterRunPdfOrderButton?.addEventListener("click", runPdfPageReorder);
  converterPreviewPdfButton?.addEventListener("click", () => loadSelectedPdfPreview());
  converterPdfPreviewPrevButton?.addEventListener("click", () => changePdfPreviewPage(-1));
  converterPdfPreviewNextButton?.addEventListener("click", () => changePdfPreviewPage(1));
  converterOpenOutputButton?.addEventListener("click", openConverterOutput);
  renderConverterSlots();
  renderConverterPdfOrderOptions();
  setConverterTab("image");
}

function converterFileKind(file) {
  const name = String(file?.name || file?.path || "").toLowerCase();
  if (/\.(png|jpe?g|webp|avif|tiff?|bmp|gif)$/i.test(name)) return "image";
  if (/\.pdf$/i.test(name)) return "pdf";
  return "file";
}

function converterFileKindLabel(file) {
  const kind = converterFileKind(file);
  if (kind === "image") return "이미지";
  if (kind === "pdf") return "PDF";
  return "기타";
}

function converterFileIconText(file) {
  const kind = converterFileKind(file);
  if (kind === "image") return "IMG";
  if (kind === "pdf") return "PDF";
  return "F";
}

function currentConverterOptions() {
  return {
    outputFormat: converterImageFormatInput?.value || "png",
    quality: Math.min(100, Math.max(1, Number(converterQualityInput?.value || 85))),
    background: converterBackgroundInput?.value || "transparent",
    outputName: converterPdfMergeNameMainInput?.value.trim() || converterPdfMergeNameInput?.value.trim() || converterPdfNameInput?.value.trim() || "",
  };
}

function currentCompressionOptions() {
  return {
    target: converterCompressTargetInput?.value || "auto",
    level: converterCompressLevelInput?.value || "balanced",
    quality: Math.min(100, Math.max(1, Number(converterCompressQualityInput?.value || 75))),
    maxDimension: Math.min(12000, Math.max(256, Number(converterCompressMaxDimensionInput?.value || 1920))),
  };
}

function setConverterTab(tab) {
  const next = tab === "pdf" || tab === "compress" ? tab : "image";
  converterTabButtons.forEach((button) => {
    const active = button.dataset.converterTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
  converterTabPanes.forEach((pane) => {
    const active = pane.dataset.converterPane === next;
    pane.classList.toggle("is-active", active);
    pane.hidden = !active;
  });
  if (next === "pdf") {
    renderConverterPdfOrderOptions();
  }
}

function converterPdfFiles() {
  return converterFiles.filter((file) => converterFileKind(file) === "pdf");
}

function converterFileKey(file) {
  return String(file?.fileToken || file?.path || file?.name || "");
}

function selectedPdfOrderFile() {
  const key = converterPdfTargetFileInput?.value || converterPdfOrderFileInput?.value || "";
  const pdfs = converterPdfFiles();
  return pdfs.find((file) => converterFileKey(file) === key) || pdfs[0] || null;
}

function renderConverterPdfOrderOptions() {
  if (!converterPdfOrderFileInput && !converterPdfTargetFileInput) return;
  const previous = converterPdfTargetFileInput?.value || converterPdfOrderFileInput?.value || "";
  const pdfs = converterPdfFiles();
  if (!pdfs.length) {
    [converterPdfOrderFileInput, converterPdfTargetFileInput].forEach((select) => {
      if (!select) return;
      select.innerHTML = `<option value="">PDF 없음</option>`;
      select.disabled = true;
    });
    [converterPdfOrderOriginalButton, converterPdfOrderReverseButton, converterPdfOrderOddEvenButton, converterInspectPdfButton, converterRunPdfOrderButton, converterRunPdfSplitButton, converterOpenPdfEditorButton].forEach((button) => {
      if (button) button.disabled = true;
    });
    converterPdfInfo = null;
    clearPdfPreview("슬롯에 PDF를 넣으면 미리보기를 볼 수 있습니다.");
    updatePdfOrderSummary("PDF를 선택해 주세요", "슬롯에 PDF를 넣으면 페이지 순서를 확인할 수 있습니다.");
    return;
  }

  [converterPdfOrderFileInput, converterPdfTargetFileInput].forEach((select) => {
    if (!select) return;
    select.disabled = false;
    select.innerHTML = pdfs
      .map((file, index) => `<option value="${escapeHtml(converterFileKey(file))}">${index + 1}. ${escapeHtml(file.name || "PDF")}</option>`)
      .join("");
  });
  [converterPdfOrderOriginalButton, converterPdfOrderReverseButton, converterPdfOrderOddEvenButton, converterInspectPdfButton, converterRunPdfOrderButton, converterRunPdfSplitButton, converterOpenPdfEditorButton].forEach((button) => {
    if (button) button.disabled = false;
  });
  const hasPrevious = pdfs.some((file) => converterFileKey(file) === previous);
  const nextValue = hasPrevious ? previous : converterFileKey(pdfs[0]);
  if (converterPdfOrderFileInput) converterPdfOrderFileInput.value = nextValue;
  if (converterPdfTargetFileInput) converterPdfTargetFileInput.value = nextValue;
  if (!hasPrevious) {
    converterPdfInfo = null;
    clearPdfPreview("PDF를 선택하고 미리보기를 눌러 주세요.");
  }
  updatePdfOrderSummary("PDF 준비됨", "페이지 확인을 누르면 전체 페이지 수와 기본 순서를 잡아둡니다.");
}

function handlePdfOrderFileChange() {
  converterPdfInfo = null;
  clearPdfPreview("PDF가 바뀌었습니다. 미리보기를 다시 눌러 주세요.");
  if (converterPdfOrderInput) converterPdfOrderInput.value = "";
  updatePdfOrderSummary("PDF 변경됨", "페이지 확인을 다시 눌러 주세요.");
}

function handlePdfTargetFileChange() {
  const value = converterPdfTargetFileInput?.value || "";
  if (converterPdfOrderFileInput) converterPdfOrderFileInput.value = value;
  handlePdfOrderFileChange();
}

function updatePdfOrderSummary(title, detail) {
  if (!converterPdfOrderSummary) return;
  converterPdfOrderSummary.innerHTML = `<strong>${escapeHtml(title || "PDF 순서")}</strong><span>${escapeHtml(detail || "")}</span>`;
}

function setPdfOrderQuickValue(value) {
  if (!converterPdfOrderInput) return;
  if (value === "all" && converterPdfInfo?.pageCount) {
    converterPdfOrderInput.value = `1-${converterPdfInfo.pageCount}`;
  } else {
    converterPdfOrderInput.value = value;
  }
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
  if (!pdfJsModulePromise) {
    pdfJsModulePromise = import("../../node_modules/pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs", window.location.href).href;
      return pdfjs;
    });
  }
  return pdfJsModulePromise;
}

function setPdfPreviewStatus(message, pageLabel = "-") {
  if (converterPdfPreviewStatus) {
    converterPdfPreviewStatus.hidden = !message;
    converterPdfPreviewStatus.textContent = message || "";
  }
  if (converterPdfPreviewPageLabel) converterPdfPreviewPageLabel.textContent = pageLabel;
}

function clearPdfPreview(message = "PDF를 선택하고 미리보기를 눌러 주세요.") {
  converterPdfPreviewState = {
    fileKey: "",
    pdf: null,
    page: 1,
    pageCount: 0,
    rendering: false,
  };
  if (converterPdfPreviewCanvas) {
    const context = converterPdfPreviewCanvas.getContext("2d");
    context?.clearRect(0, 0, converterPdfPreviewCanvas.width, converterPdfPreviewCanvas.height);
    converterPdfPreviewCanvas.width = 0;
    converterPdfPreviewCanvas.height = 0;
    converterPdfPreviewCanvas.style.width = "";
    converterPdfPreviewCanvas.style.height = "";
  }
  setPdfPreviewStatus(message, "-");
  updatePdfPreviewButtons();
}

function updatePdfPreviewButtons() {
  const hasPreview = Boolean(converterPdfPreviewState.pdf);
  if (converterPdfPreviewPrevButton) converterPdfPreviewPrevButton.disabled = !hasPreview || converterPdfPreviewState.page <= 1;
  if (converterPdfPreviewNextButton) converterPdfPreviewNextButton.disabled = !hasPreview || converterPdfPreviewState.page >= converterPdfPreviewState.pageCount;
}

async function loadSelectedPdfPreview(options = {}) {
  const file = selectedPdfOrderFile();
  if (!file) {
    clearPdfPreview("슬롯에 PDF를 넣으면 미리보기를 볼 수 있습니다.");
    if (!options.quiet) setConverterStatus("PDF 없음", "미리볼 PDF를 슬롯에 먼저 넣어 주세요.", "error");
    return;
  }
  const fileKey = converterFileKey(file);
  if (converterPdfPreviewState.fileKey === fileKey && converterPdfPreviewState.pdf) {
    await renderPdfPreviewPage(converterPdfPreviewState.page || 1);
    return;
  }
  setPdfPreviewStatus("PDF 미리보기를 불러오는 중입니다.", "-");
  if (!options.quiet) setConverterStatus("PDF 미리보기", `${file.name || "PDF"} 파일을 불러오고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.previewPdf?.({ file });
    if (!result?.ok || !result.base64) {
      clearPdfPreview(result?.error || "PDF 미리보기를 만들지 못했습니다.");
      if (!options.quiet) setConverterStatus("미리보기 실패", result?.error || "PDF 미리보기에 실패했습니다.", "error");
      return;
    }
    const pdfjs = await loadPdfJsModule();
    const bytes = base64ToUint8Array(result.base64);
    const loadingTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      useSystemFonts: true,
    });
    const pdf = await loadingTask.promise;
    converterPdfPreviewState = {
      fileKey,
      pdf,
      page: 1,
      pageCount: pdf.numPages || result.pageCount || 0,
      rendering: false,
    };
    await renderPdfPreviewPage(1);
    if (!options.quiet) setConverterStatus("미리보기 준비됨", `${result.fileName || file.name} · ${converterPdfPreviewState.pageCount}쪽`, "ready");
  } catch (error) {
    clearPdfPreview(error?.message || String(error));
    if (!options.quiet) setConverterStatus("미리보기 오류", error?.message || String(error), "error");
  }
}

async function renderPdfPreviewPage(pageNumber) {
  const state = converterPdfPreviewState;
  if (!state.pdf || !converterPdfPreviewCanvas || state.rendering) return;
  const pageCount = Math.max(1, Number(state.pageCount || 1));
  const nextPage = Math.min(pageCount, Math.max(1, Math.round(Number(pageNumber || 1))));
  state.rendering = true;
  try {
    const page = await state.pdf.getPage(nextPage);
    const wrapper = converterPdfPreviewCanvas.parentElement;
    const maxWidth = Math.max(180, (wrapper?.clientWidth || 260) - 18);
    const maxHeight = Math.max(120, (wrapper?.clientHeight || 190) - 18);
    const baseViewport = page.getViewport({ scale: 1 });
    const scale = Math.max(0.2, Math.min(maxWidth / baseViewport.width, maxHeight / baseViewport.height));
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const context = converterPdfPreviewCanvas.getContext("2d");
    converterPdfPreviewCanvas.width = Math.floor(viewport.width * pixelRatio);
    converterPdfPreviewCanvas.height = Math.floor(viewport.height * pixelRatio);
    converterPdfPreviewCanvas.style.width = `${Math.floor(viewport.width)}px`;
    converterPdfPreviewCanvas.style.height = `${Math.floor(viewport.height)}px`;
    await page.render({
      canvasContext: context,
      viewport,
      transform: pixelRatio !== 1 ? [pixelRatio, 0, 0, pixelRatio, 0, 0] : null,
    }).promise;
    state.page = nextPage;
    setPdfPreviewStatus("", `${nextPage} / ${pageCount}`);
  } catch (error) {
    setPdfPreviewStatus(error?.message || String(error), `${nextPage} / ${pageCount}`);
  } finally {
    state.rendering = false;
    updatePdfPreviewButtons();
  }
}

function changePdfPreviewPage(direction) {
  if (!converterPdfPreviewState.pdf) {
    loadSelectedPdfPreview();
    return;
  }
  renderPdfPreviewPage(converterPdfPreviewState.page + direction);
}

function addConverterFiles(files, announce = true) {
  const incoming = (Array.isArray(files) ? files : []).filter((file) => file?.path && file?.name);
  if (!incoming.length) return;
  const known = new Set(converterFiles.map((file) => file.path));
  const added = [];
  incoming.forEach((file) => {
    if (known.has(file.path)) return;
    known.add(file.path);
    added.push(file);
  });
  if (!added.length) return;
  converterFiles = [...converterFiles, ...added].slice(0, 30);
  renderConverterSlots();
  renderConverterPdfOrderOptions();
  setConverterStatus("파일 수신", converterReceiveSummary(converterFiles), "ready");
  if (announce) {
    messages.push({
      from: "them",
      time: currentTime(),
      text: converterReceiveMessage(added, converterFiles),
      uiOnly: true,
      source: "converter-status",
    });
    persistMessages();
    renderMessages();
  }
}

function converterReceiveSummary(files) {
  const imageCount = files.filter((file) => converterFileKind(file) === "image").length;
  const pdfCount = files.filter((file) => converterFileKind(file) === "pdf").length;
  const otherCount = files.length - imageCount - pdfCount;
  return [
    imageCount ? `이미지 ${imageCount}개` : "",
    pdfCount ? `PDF ${pdfCount}개` : "",
    otherCount ? `기타 ${otherCount}개` : "",
  ].filter(Boolean).join(" · ") || "파일 없음";
}

function converterReceiveMessage(added, allFiles) {
  const names = added.slice(0, 5).map((file) => `${file.name} (${file.size || converterFileKindLabel(file)})`);
  const more = added.length > 5 ? ` 외 ${added.length - 5}개` : "";
  const summary = converterReceiveSummary(allFiles);
  const hasImage = allFiles.some((file) => converterFileKind(file) === "image");
  const hasPdf = allFiles.some((file) => converterFileKind(file) === "pdf");
  const actions = [
    hasImage ? "이미지는 형식 변환이나 용량 줄이기 바로 가능합니다." : "",
    hasPdf ? "PDF는 병합, 나누기, 순서 변경, 용량 줄이기 쪽으로 볼 수 있습니다." : "",
  ].filter(Boolean).join(" ");
  const next = [
    `파일 받았습니다. ${names.join(", ")}${more}`,
    `지금 슬롯은 ${summary}입니다.`,
    actions,
    "원하시는 작업 탭에서 버튼만 눌러주시면 원본은 그대로 두고 새 파일로 빼겠습니다.",
  ].filter(Boolean).join("\n");

  return next;
}

function appendConverterStatusMessage(text, error = false) {
  messages.push({
    from: "them",
    time: currentTime(),
    text,
    error,
    uiOnly: true,
    source: "converter-status",
  });
  persistMessages();
  renderMessages();
}

async function selectConverterFiles() {
  if (!window.desktopAPI?.selectConverterFiles) {
    setConverterStatus("파일 선택 불가", "데스크톱 앱 실행 환경에서만 파일 슬롯을 사용할 수 있습니다.", "error");
    return;
  }
  const selected = await window.desktopAPI.selectConverterFiles();
  addConverterFiles(selected, true);
}

function clearConverterFiles() {
  converterFiles = [];
  pendingFiles = [];
  converterPdfInfo = null;
  lastConverterOutputPath = "";
  if (converterPdfSplitRangesInput) converterPdfSplitRangesInput.value = "";
  if (converterPdfSplitNameInput) converterPdfSplitNameInput.value = "";
  if (converterPdfMergeNameMainInput) converterPdfMergeNameMainInput.value = "";
  if (converterPdfMergeNameInput) converterPdfMergeNameInput.value = "";
  if (converterPdfNameInput) converterPdfNameInput.value = "";
  if (converterCompressTargetInput) converterCompressTargetInput.value = "auto";
  if (converterCompressLevelInput) converterCompressLevelInput.value = "balanced";
  if (converterCompressQualityInput) converterCompressQualityInput.value = "75";
  if (converterCompressMaxDimensionInput) converterCompressMaxDimensionInput.value = "1920";
  renderPendingFiles();
  renderConverterSlots();
  renderConverterPdfOrderOptions();
  setConverterStatus("대기 중", "파일을 넣으면 김병환이 무엇을 받았는지 먼저 정리합니다.", "idle");
  appendConverterStatusMessage("파일 슬롯을 비웠습니다.\n현재 김병환이 볼 수 있는 파일은 없습니다.");
}

function removeConverterFile(index) {
  converterFiles.splice(index, 1);
  converterPdfInfo = null;
  renderConverterSlots();
  renderConverterPdfOrderOptions();
  setConverterStatus("슬롯 수정", converterReceiveSummary(converterFiles), "ready");
}

function moveConverterFile(index, direction) {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= converterFiles.length) return;
  const next = [...converterFiles];
  const [item] = next.splice(index, 1);
  next.splice(nextIndex, 0, item);
  converterFiles = next;
  renderConverterSlots();
  renderConverterPdfOrderOptions();
}

function renderConverterSlots() {
  if (!converterSlots) return;
  const emptySlots = Math.max(0, 4 - converterFiles.length);
  const rows = converterFiles.map((file, index) => converterSlotMarkup(file, index));
  for (let index = 0; index < emptySlots; index += 1) {
    rows.push(`<button class="converter-slot is-empty" type="button" data-converter-add-empty><i data-lucide="plus"></i><span>빈 슬롯</span></button>`);
  }
  converterSlots.innerHTML = rows.join("");
  converterSlots.querySelectorAll("[data-converter-add-empty]").forEach((button) => {
    button.addEventListener("click", selectConverterFiles);
  });
  converterSlots.querySelectorAll("[data-remove-converter-file]").forEach((button) => {
    button.addEventListener("click", () => removeConverterFile(Number(button.dataset.removeConverterFile)));
  });
  converterSlots.querySelectorAll("[data-move-converter-file]").forEach((button) => {
    button.addEventListener("click", () => moveConverterFile(Number(button.dataset.moveConverterFile), Number(button.dataset.direction || 0)));
  });
  if (converterRunCompressButton) {
    converterRunCompressButton.disabled = !converterFiles.some((file) => ["image", "pdf"].includes(converterFileKind(file)));
  }
  createIcons();
}

function converterSlotMarkup(file, index) {
  const kind = converterFileKind(file);
  return `
    <article class="converter-slot">
      <span class="file-icon file-${escapeHtml(kind)}">${escapeHtml(converterFileIconText(file))}</span>
      <div>
        <strong>${escapeHtml(file.name || "파일")}</strong>
        <p>${escapeHtml(file.size || "")} · ${escapeHtml(converterFileKindLabel(file))}</p>
      </div>
      <div class="converter-slot-actions">
        <button class="icon-button" type="button" data-move-converter-file="${index}" data-direction="-1" aria-label="위로 이동" ${index === 0 ? "disabled" : ""}><i data-lucide="chevron-up"></i></button>
        <button class="icon-button" type="button" data-move-converter-file="${index}" data-direction="1" aria-label="아래로 이동" ${index === converterFiles.length - 1 ? "disabled" : ""}><i data-lucide="chevron-down"></i></button>
        <button class="icon-button" type="button" data-remove-converter-file="${index}" aria-label="슬롯 제거"><i data-lucide="x"></i></button>
      </div>
    </article>
  `;
}

function setConverterBusy(isBusy) {
  [
    converterAddButton,
    converterClearButton,
    converterRunImageButton,
    converterRunPdfButton,
    converterRunPdfMergeButton,
    converterRunPdfMergeButtonMain,
    converterRunPdfSplitButton,
    converterOpenPdfEditorButton,
    converterRunCompressButton,
    converterOpenOutputButton,
  ].forEach((button) => {
    if (button) button.disabled = Boolean(isBusy);
  });

  if (!isBusy && converterRunCompressButton) {
    converterRunCompressButton.disabled = !converterFiles.some((file) => ["image", "pdf"].includes(converterFileKind(file)));
  }

  const hasPdf = converterPdfFiles().length > 0;
  [
    converterPdfOrderOriginalButton,
    converterPdfOrderReverseButton,
    converterPdfOrderOddEvenButton,
    converterInspectPdfButton,
    converterRunPdfOrderButton,
    converterPreviewPdfButton,
  ].forEach((button) => {
    if (button) button.disabled = Boolean(isBusy || !hasPdf);
  });

  if (converterPdfPreviewPrevButton) converterPdfPreviewPrevButton.disabled = Boolean(isBusy) || !converterPdfPreviewState.pdf || converterPdfPreviewState.page <= 1;
  if (converterPdfPreviewNextButton) converterPdfPreviewNextButton.disabled = Boolean(isBusy) || !converterPdfPreviewState.pdf || converterPdfPreviewState.page >= converterPdfPreviewState.pageCount;
}

function setConverterStatus(title, detail, state = "idle") {
  if (!converterStatus) return;
  converterStatus.dataset.state = state;
  converterStatus.innerHTML = `<strong>${escapeHtml(title || "대기 중")}</strong><span>${escapeHtml(detail || "")}</span>`;
}

function appendConverterResultMessage(text, error = false) {
  messages.push({
    from: "them",
    time: currentTime(),
    text,
    error,
    uiOnly: true,
    source: "converter-status",
  });
  persistMessages();
  renderMessages();
}

async function runImageConversion() {
  const imageFiles = converterFiles.filter((file) => converterFileKind(file) === "image");
  if (!imageFiles.length) {
    setConverterStatus("이미지 없음", "JPG, PNG, WebP, AVIF, TIFF 같은 이미지 파일을 슬롯에 넣어 주세요.", "error");
    return;
  }
  setConverterBusy(true);
  setConverterStatus("이미지 변환 중", `${imageFiles.length}개 파일을 변환하고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.convertImages?.({
      files: imageFiles,
      ...currentConverterOptions(),
    });
    if (!result?.ok) {
      setConverterStatus("변환 실패", result?.error || "이미지 변환에 실패했습니다.", "error");
      appendConverterResultMessage(`이미지 변환 중 문제가 생겼습니다.\n${result?.error || "원인을 확인하지 못했습니다."}`, true);
      return;
    }
    lastConverterOutputPath = result.outputDir || result.outputs?.[0]?.path || "";
    const lines = result.outputs.map((item) => `- ${item.sourceName} → ${item.fileName} (${item.size})`).slice(0, 12);
    const extra = result.outputs.length > 12 ? `\n- 외 ${result.outputs.length - 12}개` : "";
    const warning = result.errors?.length ? `\n\n일부 실패: ${result.errors.map((item) => item.sourceName).join(", ")}` : "";
    setConverterStatus("이미지 변환 완료", `${result.count}개 파일 · ${result.outputFormat?.toUpperCase?.() || ""}`, "done");
    appendConverterResultMessage(`이미지 변환 완료했습니다.\n${lines.join("\n")}${extra}\n\n저장 위치: ${result.outputDir}${warning}`);
  } catch (error) {
    setConverterStatus("변환 오류", error?.message || String(error), "error");
    appendConverterResultMessage(`이미지 변환 중 오류가 발생했습니다.\n${error?.message || error}`, true);
  } finally {
    setConverterBusy(false);
  }
}

async function runFileCompression() {
  const options = currentCompressionOptions();
  const targets = converterFiles.filter((file) => {
    const kind = converterFileKind(file);
    if (options.target === "image") return kind === "image";
    if (options.target === "pdf") return kind === "pdf";
    return kind === "image" || kind === "pdf";
  });
  if (!targets.length) {
    setConverterStatus("압축 대상 없음", "슬롯에 이미지나 PDF 파일을 먼저 넣어 주세요.", "error");
    return;
  }
  setConverterBusy(true);
  setConverterStatus("용량 줄이는 중", `${targets.length}개 파일을 원본 보존 방식으로 새로 저장하고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.compressFiles?.({
      files: targets,
      ...options,
    });
    if (!result?.ok) {
      setConverterStatus("압축 실패", result?.error || "파일 용량 줄이기에 실패했습니다.", "error");
      appendConverterResultMessage(`파일 용량 줄이기 중 문제가 생겼습니다.\n${result?.error || "원인을 확인하지 못했습니다."}`, true);
      return;
    }
    lastConverterOutputPath = result.outputDir || result.outputs?.[0]?.path || "";
    const lines = result.outputs.map((item) => {
      const note = item.note ? ` · ${item.note}` : "";
      return `- ${item.sourceName} → ${item.fileName} (${item.sourceSize} → ${item.size}, ${item.reduction})${note}`;
    }).slice(0, 12);
    const extra = result.outputs.length > 12 ? `\n- 외 ${result.outputs.length - 12}개` : "";
    const warning = result.errors?.length ? `\n\n일부 실패: ${result.errors.map((item) => item.sourceName).join(", ")}` : "";
    setConverterStatus("용량 줄이기 완료", `${result.count}개 파일 · ${result.beforeSize} → ${result.afterSize}`, "done");
    appendConverterResultMessage(`파일 용량을 줄여 새로 저장했습니다.\n${lines.join("\n")}${extra}\n\n전체: ${result.beforeSize} → ${result.afterSize} (${result.reduction})\n저장 위치: ${result.outputDir}${warning}`);
  } catch (error) {
    setConverterStatus("압축 오류", error?.message || String(error), "error");
    appendConverterResultMessage(`파일 용량 줄이기 중 오류가 발생했습니다.\n${error?.message || error}`, true);
  } finally {
    setConverterBusy(false);
  }
}

async function runPdfMerge() {
  const pdfFiles = converterFiles.filter((file) => converterFileKind(file) === "pdf");
  if (pdfFiles.length < 2) {
    setConverterStatus("PDF 부족", "PDF 병합은 PDF 파일이 2개 이상 필요합니다.", "error");
    return;
  }
  setConverterBusy(true);
  setConverterStatus("PDF 병합 중", `${pdfFiles.length}개 PDF를 슬롯 순서대로 합치고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.mergePdfs?.({
      files: pdfFiles,
      outputName: currentConverterOptions().outputName,
    });
    if (!result?.ok) {
      setConverterStatus("병합 실패", result?.error || "PDF 병합에 실패했습니다.", "error");
      appendConverterResultMessage(`PDF 병합 중 문제가 생겼습니다.\n${result?.error || "원인을 확인하지 못했습니다."}`, true);
      return;
    }
    lastConverterOutputPath = result.path || result.outputDir || "";
    const sources = result.sources.map((item, index) => `${index + 1}. ${item.name} (${item.pages}쪽)`).join("\n");
    setConverterStatus("PDF 병합 완료", `${result.fileName} · ${result.pageCount}쪽`, "done");
    appendConverterResultMessage(`PDF 병합 완료했습니다.\n${sources}\n\n결과: ${result.fileName} (${result.size}, ${result.pageCount}쪽)\n저장 위치: ${result.path}`);
  } catch (error) {
    setConverterStatus("병합 오류", error?.message || String(error), "error");
    appendConverterResultMessage(`PDF 병합 중 오류가 발생했습니다.\n${error?.message || error}`, true);
  } finally {
    setConverterBusy(false);
  }
}

async function runPdfSplit() {
  const file = selectedPdfOrderFile();
  if (!file) {
    setConverterStatus("PDF 없음", "나눌 PDF를 슬롯에 먼저 넣어 주세요.", "error");
    return;
  }
  setConverterBusy(true);
  setConverterStatus("PDF 나누는 중", `${file.name || "PDF"} 파일을 새 PDF들로 나누고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.splitPdf?.({
      file,
      ranges: converterPdfSplitRangesInput?.value.trim() || "",
      outputName: converterPdfSplitNameInput?.value.trim() || "",
    });
    if (!result?.ok) {
      setConverterStatus("나누기 실패", result?.error || "PDF 나누기에 실패했습니다.", "error");
      appendConverterResultMessage(`PDF 나누기 중 문제가 생겼습니다.\n${result?.error || "원인을 확인하지 못했습니다."}`, true);
      return;
    }
    lastConverterOutputPath = result.outputDir || result.outputs?.[0]?.path || "";
    const lines = result.outputs.map((item, index) => `${index + 1}. ${item.fileName} (${item.pages}쪽)`).slice(0, 12);
    const extra = result.outputs.length > 12 ? `\n외 ${result.outputs.length - 12}개` : "";
    setConverterStatus("PDF 나누기 완료", `${result.count}개 파일 · ${result.sourceName}`, "done");
    appendConverterResultMessage(`PDF를 나눠서 저장했습니다.\n원본: ${result.sourceName}\n${lines.join("\n")}${extra}\n\n저장 위치: ${result.outputDir}`);
  } catch (error) {
    setConverterStatus("나누기 오류", error?.message || String(error), "error");
    appendConverterResultMessage(`PDF 나누기 중 오류가 발생했습니다.\n${error?.message || error}`, true);
  } finally {
    setConverterBusy(false);
  }
}

async function openPdfEditorWindow() {
  const file = selectedPdfOrderFile();
  if (!file) {
    setConverterStatus("PDF 없음", "뷰어로 열 PDF를 슬롯에 먼저 넣어 주세요.", "error");
    return;
  }
  setConverterStatus("PDF 뷰어 여는 중", `${file.name || "PDF"} 파일을 별도 창으로 열고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.openPdfEditor?.({ file });
    if (!result?.ok) {
      setConverterStatus("뷰어 열기 실패", result?.error || "PDF 뷰어를 열지 못했습니다.", "error");
      return;
    }
    setConverterStatus("PDF 뷰어 열림", "새 창에서 페이지를 드래그해 순서를 바꿀 수 있습니다.", "ready");
  } catch (error) {
    setConverterStatus("뷰어 열기 오류", error?.message || String(error), "error");
  }
}

async function inspectSelectedPdf() {
  const file = selectedPdfOrderFile();
  if (!file) {
    setConverterStatus("PDF 없음", "순서를 바꿀 PDF를 슬롯에 먼저 넣어 주세요.", "error");
    return null;
  }
  setConverterBusy(true);
  setConverterStatus("PDF 확인 중", `${file.name || "PDF"} 페이지 수를 확인하고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.inspectPdf?.({ file });
    if (!result?.ok) {
      converterPdfInfo = null;
      updatePdfOrderSummary("확인 실패", result?.error || "PDF 페이지를 확인하지 못했습니다.");
      setConverterStatus("확인 실패", result?.error || "PDF 페이지 확인에 실패했습니다.", "error");
      return null;
    }
    converterPdfInfo = result;
    if (converterPdfOrderInput && !converterPdfOrderInput.value.trim()) {
      converterPdfOrderInput.value = result.defaultOrder || `1-${result.pageCount}`;
    }
    updatePdfOrderSummary(result.fileName || "PDF", `${result.pageCount}쪽 · 예: 1,3,2,4-6 · reverse · odd-even`);
    setConverterStatus("PDF 확인 완료", `${result.fileName} · ${result.pageCount}쪽`, "ready");
    return result;
  } catch (error) {
    converterPdfInfo = null;
    updatePdfOrderSummary("확인 오류", error?.message || String(error));
    setConverterStatus("확인 오류", error?.message || String(error), "error");
    return null;
  } finally {
    setConverterBusy(false);
  }
}

async function runPdfPageReorder() {
  const file = selectedPdfOrderFile();
  if (!file) {
    setConverterStatus("PDF 없음", "순서를 바꿀 PDF를 슬롯에 먼저 넣어 주세요.", "error");
    return;
  }
  const pageOrder = converterPdfOrderInput?.value.trim() || "";
  const outputName = converterPdfOrderNameInput?.value.trim() || "";
  setConverterBusy(true);
  setConverterStatus("PDF 순서 저장 중", `${file.name || "PDF"} 페이지를 새 순서로 저장하고 있습니다.`, "working");
  try {
    const result = await window.desktopAPI?.reorderPdf?.({
      file,
      pageOrder,
      outputName,
    });
    if (!result?.ok) {
      setConverterStatus("순서 저장 실패", result?.error || "PDF 순서 저장에 실패했습니다.", "error");
      appendConverterResultMessage(`PDF 순서를 저장하는 중 문제가 생겼습니다.\n${result?.error || "원인을 확인하지 못했습니다."}`, true);
      return;
    }
    lastConverterOutputPath = result.path || result.outputDir || "";
    const omitted = result.omittedPageCount ? `\n제외된 페이지: ${result.omittedPageCount}쪽` : "";
    const orderPreview = Array.isArray(result.order) ? result.order.slice(0, 30).join(", ") : pageOrder;
    const extraOrder = Array.isArray(result.order) && result.order.length > 30 ? ` ... 외 ${result.order.length - 30}쪽` : "";
    setConverterStatus("PDF 순서 저장 완료", `${result.fileName} · ${result.pageCount}쪽`, "done");
    appendConverterResultMessage(`PDF 순서를 새 파일로 저장했습니다.\n원본: ${result.sourceName}\n페이지 순서: ${orderPreview}${extraOrder}${omitted}\n\n결과: ${result.fileName} (${result.size}, ${result.pageCount}쪽)\n저장 위치: ${result.path}`);
  } catch (error) {
    setConverterStatus("순서 저장 오류", error?.message || String(error), "error");
    appendConverterResultMessage(`PDF 순서를 저장하는 중 오류가 발생했습니다.\n${error?.message || error}`, true);
  } finally {
    setConverterBusy(false);
  }
}

async function openConverterOutput() {
  const result = await window.desktopAPI?.openConverterOutput?.(lastConverterOutputPath || "");
  if (!result?.ok) {
    setConverterStatus("폴더 열기 실패", result?.error || "결과 폴더를 열 수 없습니다.", "error");
  }
}

function setupFrustrationPanel() {
  if (!frustrationPanel) return;
  const enabled = isFrustrationOfficer();
  frustrationPanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-frustration-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-frustration-panel", enabled);
  if (!enabled) return;

  frustrationSampleButton?.addEventListener("click", insertFrustrationSample);
  frustrationParseButton?.addEventListener("click", parseFrustrationSource);
  frustrationPromptButton?.addEventListener("click", insertFrustrationPrompt);
  frustrationOpenBrowserButton?.addEventListener("click", openFrustrationBrowser);
  frustrationCheckWebButton?.addEventListener("click", checkFrustrationWebInput);
  frustrationRunParagraphsButton?.addEventListener("click", startFrustrationParagraphInput);
  frustrationRunTableButton?.addEventListener("click", startFrustrationTableInput);
  frustrationStopButton?.addEventListener("click", stopFrustrationExecution);
  frustrationBlockList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-frustration-block]");
    if (!button) return;
    frustrationSelectedBlockId = button.dataset.frustrationBlock || "";
    renderFrustrationBlocks();
  });
  if (window.desktopAPI?.onRoutineExecutionEvent && !disposeFrustrationExecutionEvent) {
    disposeFrustrationExecutionEvent = window.desktopAPI.onRoutineExecutionEvent(handleFrustrationExecutionEvent);
  }
  if (window.desktopAPI?.onFrustrationWebInputEvent && !disposeFrustrationWebInputEvent) {
    disposeFrustrationWebInputEvent = window.desktopAPI.onFrustrationWebInputEvent(handleFrustrationWebInputEvent);
  }
  renderFrustrationBlocks();
}

function insertFrustrationSample() {
  if (!frustrationSourceInput) return;
  frustrationSourceInput.value = [
    "1. 추진 개요",
    "청년 일자리 지원사업은 2분기 기준 신청 320건, 심사완료 248건, 선정 96명으로 집계되었습니다.",
    "",
    "구분\t1분기\t2분기\t누계",
    "신청\t146건\t174건\t320건",
    "심사완료\t112건\t136건\t248건",
    "선정\t41명\t55명\t96명",
    "",
    "2. 향후 계획",
    "하반기에는 미선정자 재안내와 기업 추가 수요조사를 병행하겠습니다.",
  ].join("\n");
  parseFrustrationSource();
}

function parseFrustrationSource() {
  const text = frustrationSourceInput?.value || "";
  frustrationBlocks = splitDocumentForFrustration(text);
  frustrationSelectedBlockId = frustrationBlocks.find((block) => block.type === "table")?.id || frustrationBlocks[0]?.id || "";
  renderFrustrationBlocks();
  setFrustrationStatus(frustrationBlocks.length ? `${frustrationBlocks.length}개 입력 단위로 쪼갰습니다.` : "쪼갤 내용이 없습니다.", frustrationBlocks.length ? "ready" : "error");
}

function splitDocumentForFrustration(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const blocks = [];
  let tableRows = [];
  let paragraphLines = [];

  const flushParagraph = () => {
    const value = paragraphLines.join(" ").replace(/\s+/g, " ").trim();
    paragraphLines = [];
    if (!value) return;
    blocks.push({
      id: `fr-${blocks.length + 1}`,
      type: looksLikeHeading(value) ? "heading" : "paragraph",
      text: value,
    });
  };

  const flushTable = () => {
    if (!tableRows.length) return;
    blocks.push({
      id: `fr-${blocks.length + 1}`,
      type: "table",
      rows: normalizeTableRows(tableRows),
    });
    tableRows = [];
  };

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushTable();
      return;
    }
    if (line.includes("\t")) {
      flushParagraph();
      tableRows.push(line.split("\t").map((cell) => cell.trim()));
      return;
    }
    flushTable();
    if (looksLikeHeading(trimmed)) {
      flushParagraph();
      blocks.push({ id: `fr-${blocks.length + 1}`, type: "heading", text: trimmed });
      return;
    }
    paragraphLines.push(trimmed);
  });

  flushParagraph();
  flushTable();
  return blocks.slice(0, 80);
}

function normalizeTableRows(rows) {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  return rows.map((row) => {
    const next = [...row];
    while (next.length < maxColumns) next.push("");
    return next;
  }).slice(0, 80);
}

function looksLikeHeading(value) {
  return /^(?:\d+(?:[.)]|-\d+)|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩ]+\.|[가-힣]\.|[□■○●]\s*)\s*\S/.test(String(value || "").trim());
}

function renderFrustrationBlocks() {
  if (!frustrationBlockList) return;
  if (!frustrationBlocks.length) {
    frustrationBlockList.innerHTML = `<div class="frustration-empty">아직 쪼갠 문서가 없습니다.</div>`;
    setFrustrationButtons();
    return;
  }
  frustrationBlockList.innerHTML = frustrationBlocks.map((block, index) => {
    const selected = block.id === frustrationSelectedBlockId ? " is-selected" : "";
    const meta = block.type === "table" ? `${block.rows.length}행 x ${block.rows[0]?.length || 0}열` : `${String(block.text || "").length}자`;
    const title = block.type === "heading" ? "제목" : block.type === "table" ? "표" : "문단";
    const preview = block.type === "table" ? block.rows.slice(0, 2).map((row) => row.join(" / ")).join(" · ") : block.text;
    return `
      <button class="frustration-block${selected}" type="button" data-frustration-block="${escapeHtml(block.id)}">
        <strong>${index + 1}. ${title}</strong>
        <span>${escapeHtml(meta)}</span>
        <p>${escapeHtml(preview || "")}</p>
      </button>
    `;
  }).join("");
  setFrustrationButtons();
}

function setFrustrationButtons() {
  const hasBlocks = frustrationBlocks.length > 0;
  const selectedTable = selectedFrustrationTable();
  if (frustrationRunParagraphsButton) frustrationRunParagraphsButton.disabled = isFrustrationExecuting || !hasBlocks;
  if (frustrationRunTableButton) frustrationRunTableButton.disabled = isFrustrationExecuting || !selectedTable;
  if (frustrationStopButton) frustrationStopButton.disabled = !isFrustrationExecuting;
  if (frustrationOpenBrowserButton) frustrationOpenBrowserButton.disabled = isFrustrationExecuting;
  if (frustrationCheckWebButton) frustrationCheckWebButton.disabled = isFrustrationExecuting;
}

function selectedFrustrationTable() {
  return frustrationBlocks.find((block) => block.id === frustrationSelectedBlockId && block.type === "table") || null;
}

function setFrustrationStatus(text, state = "idle") {
  if (!frustrationRunStatus) return;
  frustrationRunStatus.textContent = text;
  frustrationRunStatus.dataset.state = state;
}

function insertFrustrationPrompt() {
  const source = (frustrationSourceInput?.value || "").trim();
  const prompt = [
    "이 문서를 회사 웹문서툴에 매크로로 입력할 수 있게 제목/문단/표 단위로 쪼개줘.",
    "출력은 JSON 배열로 하고, 각 항목은 type이 heading, paragraph, table 중 하나여야 해.",
    "table은 rows 2차원 배열로 줘. 없는 내용은 만들지 말고 원문 순서를 지켜줘.",
    "",
    "원문:",
    source || "(여기에 원문을 붙여넣겠습니다.)",
  ].join("\n");
  insertTextIntoComposer(prompt);
}

function frustrationDelaySeconds() {
  return Math.min(60, Math.max(0, Number(frustrationRunDelayInput?.value || 3) || 0));
}

function frustrationStepDelaySeconds() {
  return Math.min(5, Math.max(0, Number(frustrationStepDelayInput?.value || 0.15) || 0));
}

function frustrationDriverMode() {
  const value = frustrationDriverInput?.value || "web-first";
  return ["web-first", "web-only", "routine-only"].includes(value) ? value : "web-first";
}

function frustrationWebPort() {
  return Math.min(65535, Math.max(1, Math.round(Number(frustrationWebPortInput?.value || 9222) || 9222)));
}

function frustrationWebTarget() {
  return String(frustrationWebTargetInput?.value || "").trim();
}

function frustrationWebOptions() {
  return {
    port: frustrationWebPort(),
    targetKeyword: frustrationWebTarget(),
    delaySeconds: frustrationDelaySeconds(),
  };
}

async function openFrustrationBrowser() {
  if (!isFrustrationOfficer()) return;
  if (!window.desktopAPI?.openFrustrationWebBrowser) {
    setFrustrationStatus("데스크톱 앱에서만 자동화 브라우저를 열 수 있습니다.", "error");
    return;
  }
  setFrustrationStatus("자동화 브라우저를 여는 중입니다.", "working");
  try {
    const target = frustrationWebTarget();
    const result = await window.desktopAPI.openFrustrationWebBrowser({
      port: frustrationWebPort(),
      url: /^https?:\/\//i.test(target) ? target : "",
    });
    if (!result?.ok) {
      setFrustrationStatus(result?.error || "자동화 브라우저를 열지 못했습니다.", "error");
      return;
    }
    setFrustrationStatus(`${result.port}번 포트로 자동화 브라우저를 열었습니다. 회사툴에서 입력 위치를 잡아두세요.`, "ready");
  } catch (error) {
    setFrustrationStatus(error?.message || String(error), "error");
  }
}

async function checkFrustrationWebInput() {
  if (!isFrustrationOfficer()) return null;
  if (!window.desktopAPI?.checkFrustrationWebInput) {
    setFrustrationStatus("데스크톱 앱에서만 웹 입력 상태를 확인할 수 있습니다.", "error");
    return null;
  }
  setFrustrationStatus("웹 입력 브라우저를 확인 중입니다.", "working");
  try {
    const status = await window.desktopAPI.checkFrustrationWebInput(frustrationWebOptions());
    if (!status?.ok) {
      setFrustrationStatus(status?.error || "웹 입력 브라우저가 아직 준비되지 않았습니다.", "error");
      return status;
    }
    const title = status.selected?.title || status.selected?.url || "선택된 탭";
    setFrustrationStatus(`웹 입력 준비됨 · ${title}`, "ready");
    return status;
  } catch (error) {
    setFrustrationStatus(error?.message || String(error), "error");
    return null;
  }
}

function buildFrustrationParagraphSteps() {
  const delay = frustrationStepDelaySeconds();
  const blocks = frustrationBlocks.filter((block) => block.type !== "table");
  const steps = [];
  blocks.forEach((block, index) => {
    steps.push({ id: `fd-paste-${index}`, action: "pasteText", value: block.text || "" });
    steps.push({ id: `fd-enter-${index}`, action: "pressKey", value: "enter", delayBefore: delay });
  });
  return steps;
}

function buildFrustrationTableSteps(table) {
  const delay = frustrationStepDelaySeconds();
  const steps = [];
  table.rows.flat().forEach((cell, index) => {
    steps.push({ id: `fd-cell-${index}`, action: "pasteText", value: cell || "" });
    steps.push({ id: `fd-tab-${index}`, action: "pressKey", value: "tab", delayBefore: delay });
  });
  return steps;
}

async function startFrustrationParagraphInput() {
  if (!isFrustrationOfficer()) return;
  if (!frustrationBlocks.length) parseFrustrationSource();
  const steps = buildFrustrationParagraphSteps();
  if (!steps.length) {
    setFrustrationStatus("입력할 제목/문단이 없습니다.", "error");
    return;
  }
  await startFrustrationExecution(steps, "문단 입력");
}

async function startFrustrationTableInput() {
  if (!isFrustrationOfficer()) return;
  if (!frustrationBlocks.length) parseFrustrationSource();
  const table = selectedFrustrationTable();
  if (!table) {
    setFrustrationStatus("먼저 채울 표 블록을 선택하세요. 회사툴에는 같은 행/열의 빈 표를 만들어두면 됩니다.", "error");
    return;
  }
  await startFrustrationExecution(buildFrustrationTableSteps(table), `표 ${table.rows.length}행 x ${table.rows[0]?.length || 0}열 채우기`);
}

async function startFrustrationExecution(steps, label) {
  const mode = frustrationDriverMode();
  if (mode !== "routine-only") {
    const startedWeb = await startFrustrationWebExecution(steps, label, mode === "web-first");
    if (startedWeb) return;
    setFrustrationStatus("웹 입력 연결이 안 잡혀서 좌표 입력으로 넘깁니다.", "working");
  }
  await startFrustrationRoutineExecution(steps, label);
}

async function startFrustrationWebExecution(steps, label, allowFallback) {
  if (!window.desktopAPI?.startFrustrationWebInput || !window.desktopAPI?.checkFrustrationWebInput) {
    if (allowFallback) return false;
    setFrustrationStatus("데스크톱 앱에서만 웹 입력을 실행할 수 있습니다.", "error");
    return true;
  }
  setFrustrationStatus("웹 입력 브라우저를 확인 중입니다.", "working");
  const options = frustrationWebOptions();
  let status;
  try {
    status = await window.desktopAPI.checkFrustrationWebInput(options);
  } catch (error) {
    if (allowFallback) return false;
    setFrustrationStatus(error?.message || String(error), "error");
    return true;
  }
  if (!status?.ok) {
    if (allowFallback) return false;
    setFrustrationStatus(status?.error || "웹 입력 브라우저가 준비되지 않았습니다.", "error");
    return true;
  }

  isFrustrationExecuting = true;
  setFrustrationButtons();
  const target = status.selected?.title || status.selected?.url || "선택된 탭";
  setFrustrationStatus(`${label} 웹 입력 준비 중입니다. ${frustrationDelaySeconds()}초 안에 ${target} 입력 위치에 커서를 두세요.`, "working");
  try {
    const result = await window.desktopAPI.startFrustrationWebInput({
      ...options,
      targetId: status.selected?.id,
      steps,
    });
    if (!result?.ok) {
      isFrustrationExecuting = false;
      setFrustrationButtons();
      if (allowFallback) return false;
      setFrustrationStatus(result?.error || "웹 입력을 시작하지 못했습니다.", "error");
    }
    return true;
  } catch (error) {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    if (allowFallback) return false;
    setFrustrationStatus(error?.message || String(error), "error");
    return true;
  }
}

async function startFrustrationRoutineExecution(steps, label) {
  if (!window.desktopAPI?.startRoutineExecution) {
    setFrustrationStatus("데스크톱 앱에서만 좌표 입력을 실행할 수 있습니다.", "error");
    return;
  }
  isFrustrationExecuting = true;
  setFrustrationButtons();
  setFrustrationStatus(`${label} 좌표 입력 준비 중입니다. ${frustrationDelaySeconds()}초 안에 회사툴 입력 위치에 커서를 두세요.`, "working");
  try {
    const result = await window.desktopAPI.startRoutineExecution({
      delaySeconds: frustrationDelaySeconds(),
      steps,
    });
    if (!result?.ok) {
      isFrustrationExecuting = false;
      setFrustrationButtons();
      setFrustrationStatus(result?.error || "매크로 입력을 시작하지 못했습니다.", "error");
    }
  } catch (error) {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    setFrustrationStatus(error?.message || String(error), "error");
  }
}

async function stopFrustrationExecution() {
  await window.desktopAPI?.stopFrustrationWebInput?.();
  await window.desktopAPI?.stopRoutineExecution?.();
  isFrustrationExecuting = false;
  setFrustrationButtons();
  setFrustrationStatus("중지했습니다.", "idle");
}

function handleFrustrationExecutionEvent(event) {
  if (!isFrustrationOfficer() || !event) return;
  if (event.type === "status" && event.state === "idle") {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    return;
  }
  if (event.type === "started") {
    setFrustrationStatus(`실행 중 · ${event.count || 0}단계`, "working");
    return;
  }
  if (event.type === "step-start") {
    setFrustrationStatus(`${Number(event.index || 0) + 1}번째 동작 입력 중`, "working");
    return;
  }
  if (event.type === "final") {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    setFrustrationStatus(`완료 · ${event.executed || 0}단계 실행`, "done");
    return;
  }
  if (event.type === "error") {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    setFrustrationStatus(event.message || "입력 중 오류가 났습니다.", "error");
  }
}

function handleFrustrationWebInputEvent(event) {
  if (!isFrustrationOfficer() || !event) return;
  if (event.type === "status" && event.state === "idle") {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    return;
  }
  if (event.type === "status" && event.state === "countdown") {
    const target = event.targetTitle || event.targetUrl || "웹문서 탭";
    setFrustrationStatus(`웹 입력 대기 중 · ${event.delaySeconds || 0}초 · ${target}`, "working");
    return;
  }
  if (event.type === "started") {
    setFrustrationStatus(`웹 입력 중 · ${event.count || 0}단계`, "working");
    return;
  }
  if (event.type === "step-start") {
    setFrustrationStatus(`웹 입력 ${Number(event.index || 0) + 1}번째 동작 처리 중`, "working");
    return;
  }
  if (event.type === "final") {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    setFrustrationStatus(`웹 입력 완료 · ${event.executed || 0}단계 실행`, "done");
    return;
  }
  if (event.type === "error") {
    isFrustrationExecuting = false;
    setFrustrationButtons();
    setFrustrationStatus(event.message || "웹 입력 중 오류가 났습니다.", "error");
  }
}

function setupPrivacyPanel() {
  if (!privacyPanel) return;
  const enabled = isPrivacyOfficer();
  privacyPanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-privacy-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-privacy-panel", enabled);
  if (!enabled) return;

  renderPrivacyMode();
  privacyModeToggle?.addEventListener("change", () => {
    savePrivacyMode(privacyModeToggle.checked ? "chat" : "scan");
    renderPrivacyMode();
    setPrivacyStatus(
      privacyMode === "chat"
        ? "채팅 모드입니다. 민감한 원문은 오른쪽 로컬 검사 칸을 사용하세요."
        : "검사 모드입니다. 채팅 입력은 바로 개인정보 검사 결과로 돌려줍니다.",
      privacyMode === "chat" ? "ready" : "done"
    );
  });
  privacyRefreshWindowsButton?.addEventListener("click", refreshPrivacyWindows);
  privacyInspectWindowsButton?.addEventListener("click", inspectSelectedPrivacyWindows);
  privacyScanTextButton?.addEventListener("click", scanManualPrivacyText);
  privacyWindowList?.addEventListener("change", updatePrivacyInspectButton);
  renderPrivacyWindows();
  renderPrivacyResults();
}

function renderPrivacyMode() {
  if (!isPrivacyOfficer()) return;
  const isChatMode = privacyMode === "chat";
  if (privacyModeToggle) {
    privacyModeToggle.checked = isChatMode;
    privacyModeToggle.setAttribute("aria-checked", String(isChatMode));
  }
  if (privacyModeLabel) privacyModeLabel.textContent = isChatMode ? "채팅 모드" : "검사 모드";
  if (privacyModeHelp) {
    privacyModeHelp.textContent = isChatMode
      ? "일반 질문은 김개보가 답합니다. 민감한 원문은 아래 로컬 검사 도구를 사용하세요."
      : "채팅 입력을 LLM에 보내지 않고 로컬 검사 결과로 반환합니다.";
  }
  if (input) {
    input.dataset.placeholder = isChatMode
      ? "김개보에게 질문하세요 · 민감한 원문은 오른쪽 로컬 검사 칸에 입력하세요..."
      : "검사할 개인정보 포함 의심 텍스트를 입력하세요...";
  }
}

function setPrivacyStatus(text, state = "idle") {
  if (!privacyStatus) return;
  privacyStatus.textContent = text;
  privacyStatus.dataset.state = state;
}

function setPrivacyBusy(nextBusy) {
  isPrivacyBusy = Boolean(nextBusy);
  if (privacyModeToggle) privacyModeToggle.disabled = isPrivacyBusy;
  if (privacyRefreshWindowsButton) privacyRefreshWindowsButton.disabled = isPrivacyBusy;
  if (privacyScanTextButton) privacyScanTextButton.disabled = isPrivacyBusy;
  updatePrivacyInspectButton();
}

function selectedPrivacyWindows() {
  if (!privacyWindowList) return [];
  const selectedIds = new Set(
    [...privacyWindowList.querySelectorAll("input[data-privacy-window]:checked")].map((inputEl) => inputEl.value)
  );
  return privacyWindows.filter((item) => selectedIds.has(item.id));
}

function updatePrivacyInspectButton() {
  if (!privacyInspectWindowsButton) return;
  privacyInspectWindowsButton.disabled = isPrivacyBusy || !selectedPrivacyWindows().length;
}

async function refreshPrivacyWindows() {
  if (!isPrivacyOfficer() || !window.desktopAPI?.listPrivacyWindows) return;
  setPrivacyBusy(true);
  setPrivacyStatus("열려 있는 창을 확인하는 중입니다.", "working");
  try {
    const result = await window.desktopAPI.listPrivacyWindows();
    if (!result?.ok) {
      privacyWindows = [];
      renderPrivacyWindows();
      setPrivacyStatus(result?.error || "창 목록을 가져오지 못했습니다.", "error");
      return;
    }
    privacyWindows = Array.isArray(result.windows) ? result.windows : [];
    renderPrivacyWindows();
    const preview = privacyWindows.slice(0, 8).map((item, index) => `${index + 1}. ${item.title} (${item.processName || "프로그램"})`).join("\n");
    appendPrivacyMessage(
      privacyWindows.length
        ? `열려 있는 창을 ${privacyWindows.length}개 찾았습니다.\n\n${preview}${privacyWindows.length > 8 ? `\n... 외 ${privacyWindows.length - 8}개` : ""}\n\n검사할 창만 오른쪽에서 체크해 주세요. 확장 없이 보는 거라 웹/한글은 잠깐 창을 앞으로 가져와 전체 선택/복사를 시도합니다. 맞는 창만 고르세요.`
        : "지금 확인되는 열린 창이 없습니다. 검사할 문서 파일을 첨부하거나 텍스트를 붙여넣어 주세요."
    );
    setPrivacyStatus(privacyWindows.length ? `${privacyWindows.length}개 창 확인됨 · 검사할 창을 체크하세요.` : "검사할 창이 없습니다.", privacyWindows.length ? "ready" : "error");
  } catch (error) {
    setPrivacyStatus(error?.message || String(error), "error");
  } finally {
    setPrivacyBusy(false);
  }
}

function renderPrivacyWindows() {
  if (!privacyWindowList) return;
  if (!privacyWindows.length) {
    privacyWindowList.innerHTML = `<div class="privacy-empty">아직 확인한 창이 없습니다.</div>`;
    updatePrivacyInspectButton();
    return;
  }
  privacyWindowList.innerHTML = privacyWindows.map((item, index) => `
    <label class="privacy-window-row">
      <input type="checkbox" value="${escapeHtml(item.id)}" data-privacy-window />
      <span>
        <strong>${index + 1}. ${escapeHtml(item.title)}</strong>
        <em>${escapeHtml(item.processName || "프로그램")} · ${escapeHtml(item.methodLabel || "검사 시도")}</em>
        <small>${escapeHtml(item.note || "")}</small>
      </span>
    </label>
  `).join("");
  updatePrivacyInspectButton();
}

async function inspectSelectedPrivacyWindows() {
  if (!isPrivacyOfficer() || !window.desktopAPI?.inspectPrivacyWindows) return;
  const windows = selectedPrivacyWindows();
  if (!windows.length) {
    setPrivacyStatus("검사할 창을 먼저 체크하세요.", "error");
    return;
  }
  setPrivacyBusy(true);
  setPrivacyStatus(`${windows.length}개 창 검사 중입니다. 창이 잠깐 앞으로 올 수 있습니다.`, "working");
  try {
    const result = await window.desktopAPI.inspectPrivacyWindows({ windows });
    if (!result?.ok) {
      setPrivacyStatus(result?.error || "검사 중 오류가 났습니다.", "error");
      return;
    }
    privacyResults = Array.isArray(result.results) ? result.results : [];
    renderPrivacyResults();
    const riskCount = privacyResults.reduce((sum, item) => sum + (Array.isArray(item.findings) ? item.findings.length : 0), 0);
    const unreadable = privacyResults.filter((item) => item.status === "unreadable").length;
    appendPrivacyMessage(formatPrivacyResultMessage(privacyResults));
    setPrivacyStatus(`검사 완료 · 개인정보 후보 ${riskCount}건${unreadable ? ` · 읽기 실패 ${unreadable}개` : ""}`, riskCount ? "error" : "done");
  } catch (error) {
    setPrivacyStatus(error?.message || String(error), "error");
  } finally {
    setPrivacyBusy(false);
  }
}

function buildPrivacyTextResult(title, processName, text, result, guidance = {}) {
  const findings = Array.isArray(result?.findings) ? result.findings : [];
  return {
    title,
    processName,
    status: findings.length ? "risk" : "clean",
    textLength: result?.textLength || text.length,
    findings,
    summary: result?.summary || {},
    guidance: findings.length
      ? guidance.risk || "원문에 바로 덮어쓰지 말고 마스킹본을 검토한 뒤 반영하세요."
      : guidance.clean || "확정형 개인정보 패턴은 발견되지 않았습니다.",
  };
}

async function scanManualPrivacyText() {
  if (!isPrivacyOfficer() || !window.desktopAPI?.scanPrivacyText) return;
  const text = privacyManualTextInput?.value || "";
  if (!text.trim()) {
    setPrivacyStatus("검사할 텍스트를 먼저 붙여넣으세요.", "error");
    return;
  }
  setPrivacyBusy(true);
  setPrivacyStatus("붙여넣은 텍스트를 검사하는 중입니다.", "working");
  try {
    const result = await window.desktopAPI.scanPrivacyText({ text });
    if (!result?.ok) {
      setPrivacyStatus(result?.error || "텍스트 검사 중 오류가 났습니다.", "error");
      return;
    }
    privacyResults = [buildPrivacyTextResult("직접 붙여넣은 텍스트", "manual", text, result)];
    renderPrivacyResults();
    appendPrivacyMessage(formatPrivacyResultMessage(privacyResults));
    setPrivacyStatus(`텍스트 검사 완료 · 개인정보 후보 ${result.findings?.length || 0}건`, result.findings?.length ? "error" : "done");
  } catch (error) {
    setPrivacyStatus(error?.message || String(error), "error");
  } finally {
    setPrivacyBusy(false);
  }
}

async function inspectPrivacyFiles(files) {
  if (!isPrivacyOfficer() || !window.desktopAPI?.inspectPrivacyFiles) return;
  const safeFiles = (Array.isArray(files) ? files : []).slice(0, 10);
  if (!safeFiles.length) return;
  setPrivacyBusy(true);
  setPrivacyStatus(`${safeFiles.length}개 파일을 직접 검사하는 중입니다.`, "working");
  try {
    const result = await window.desktopAPI.inspectPrivacyFiles({ files: safeFiles });
    if (!result?.ok) {
      setPrivacyStatus(result?.error || "파일 검사 중 오류가 났습니다.", "error");
      return;
    }
    privacyResults = Array.isArray(result.results) ? result.results : [];
    renderPrivacyResults();
    appendPrivacyMessage(formatPrivacyResultMessage(privacyResults));
    const riskCount = privacyResults.reduce((sum, item) => sum + (Array.isArray(item.findings) ? item.findings.length : 0), 0);
    setPrivacyStatus(`파일 검사 완료 · 개인정보 후보 ${riskCount}건`, riskCount ? "error" : "done");
  } catch (error) {
    setPrivacyStatus(error?.message || String(error), "error");
  } finally {
    setPrivacyBusy(false);
  }
}

function renderPrivacyResults() {
  if (!privacyResultList) return;
  if (!privacyResults.length) {
    privacyResultList.innerHTML = `<div class="privacy-empty">검사 결과가 아직 없습니다.</div>`;
    return;
  }
  privacyResultList.innerHTML = privacyResults.map((result) => {
    const findings = Array.isArray(result.findings) ? result.findings : [];
    const state = result.status === "unreadable" ? "읽기 실패" : findings.length ? `${findings.length}건` : "깨끗함";
    const rows = findings.slice(0, 8).map((finding) => `
      <li>
        <strong>${escapeHtml(finding.label || finding.type)}</strong>
        <span>${escapeHtml(finding.masked || "")}</span>
        <small>${escapeHtml(finding.maskedContext || "")}</small>
      </li>
    `).join("");
    return `
      <article class="privacy-result-card" data-state="${escapeHtml(result.status || "idle")}">
        <strong>${escapeHtml(result.title || "검사 대상")}</strong>
        <span>${escapeHtml(result.processName || "")} · ${escapeHtml(state)} · ${Number(result.textLength || 0).toLocaleString("ko-KR")}자</span>
        ${result.guidance ? `<p>${escapeHtml(result.guidance)}</p>` : ""}
        ${rows ? `<ul>${rows}</ul>` : ""}
      </article>
    `;
  }).join("");
}

function formatPrivacyResultMessage(results) {
  if (!results.length) return "검사 결과가 없습니다.";
  const lines = ["검사 결과입니다."];
  results.forEach((result, index) => {
    const findings = Array.isArray(result.findings) ? result.findings : [];
    if (result.status === "unreadable") {
      lines.push(`${index + 1}. ${result.title}: 읽기 실패 - ${result.guidance || result.error || "파일이나 텍스트로 다시 받아야 합니다."}`);
      return;
    }
    lines.push(`${index + 1}. ${result.title}: 개인정보 후보 ${findings.length}건`);
    findings.slice(0, 6).forEach((finding) => {
      lines.push(`- ${finding.label}: ${finding.masked}`);
    });
    if (findings.length > 6) lines.push(`- 외 ${findings.length - 6}건`);
  });
  lines.push("");
  lines.push("원본은 자동으로 고치지 않았습니다. 읽기 실패한 창은 실제 문서 파일을 넣거나 검사할 텍스트를 붙여넣어 주세요.");
  return lines.join("\n");
}

function appendPrivacyMessage(text, error = false) {
  messages.push({
    from: "them",
    time: currentTime(),
    text,
    error,
    uiOnly: true,
    source: "privacy-status",
  });
  persistMessages();
  renderMessages();
}

function series4Api() {
  return window.desktopAPI || {};
}

function safeSeries4Number(value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(maximum, Math.max(minimum, number));
}

function safeSeries4Version(value) {
  const match = String(value || "")
    .trim()
    .match(/^v?(\d+(?:\.\d+){0,3}(?:[-+][a-z0-9.-]+)?)$/i);
  return match ? match[1] : "";
}

function series4StatusPayload(result) {
  if (result?.status && typeof result.status === "object") return result.status;
  return result && typeof result === "object" ? result : {};
}

function normalizeSeries4Status(result) {
  const api = series4Api();
  const source = series4StatusPayload(result);
  const stateText = String(typeof source.state === "string" ? source.state : typeof source.status === "string" ? source.status : "").toLowerCase();
  const installed = Boolean(source.installed ?? source.ready ?? source.available ?? ["ready", "installed", "update-available"].includes(stateText));
  const installing = Boolean(source.installing ?? ["checking", "downloading", "verifying", "extracting", "installing"].includes(stateText));
  return {
    ok: !["error", "failed"].includes(stateText),
    installed,
    installing,
    updateAvailable: Boolean(source.updateAvailable ?? source.hasUpdate ?? stateText === "update-available"),
    version: safeSeries4Version(source.version ?? source.installedVersion ?? source.currentVersion),
    canInstall: typeof api.installSeries4 === "function",
    canLaunch: installed && source.canLaunch !== false && source.launchable !== false && typeof api.launchSeries4 === "function",
    canList: installed && typeof api.listSeries4Sessions === "function",
  };
}

function setSeries4ButtonLabel(button, label) {
  const textNode = button?.querySelector("span");
  if (textNode) textNode.textContent = label;
}

function renderSeries4EngineStatus(snapshot = series4StatusSnapshot) {
  if (!series4EngineStatus) return;
  const api = series4Api();
  const hasStatusApi = typeof api.getSeries4Status === "function";
  const status = snapshot || {
    ok: hasStatusApi,
    installed: false,
    installing: false,
    updateAvailable: false,
    version: "",
    canInstall: typeof api.installSeries4 === "function",
    canLaunch: false,
    canList: false,
  };
  const installing = series4IsInstalling || status.installing;

  let state = "missing";
  let label = "설치 필요";
  let help = "Series 4를 설치하면 영상과 전역 입력을 함께 기록할 수 있습니다.";
  if (!hasStatusApi) {
    state = "unavailable";
    label = "연결 안 됨";
    help = "이 배포본에는 아직 Series 4 연결 모듈이 없습니다.";
  } else if (!status.ok) {
    state = "error";
    label = "확인 실패";
    help = "Series 4 상태를 확인하지 못했습니다. 잠시 후 다시 열어 주세요.";
  } else if (installing) {
    state = "installing";
    label = "설치 중";
    help = "내장 설치 파일의 검증과 설치가 끝날 때까지 창을 닫지 마세요.";
  } else if (status.installed && status.updateAvailable) {
    state = "update";
    label = "업데이트 있음";
    help = "현재 버전으로 바로 녹화하거나 최신 버전으로 업데이트할 수 있습니다.";
  } else if (status.installed) {
    state = "ready";
    label = "사용 가능";
    help = "Series 4에서 실제 작업을 기록한 뒤 최근 기록을 새로고침하세요.";
  }

  series4EngineStatus.dataset.state = state;
  series4EngineStatus.textContent = label;
  if (series4EngineVersion) series4EngineVersion.textContent = status.version ? `버전 ${status.version}` : "버전 —";
  if (series4EngineHelp) series4EngineHelp.textContent = help;

  if (series4InstallButton) {
    const installLabel = status.installed ? (status.updateAvailable ? "업데이트" : "최신 버전") : "설치";
    setSeries4ButtonLabel(series4InstallButton, installLabel);
    series4InstallButton.hidden = installing;
    series4InstallButton.disabled = installing || !status.canInstall || (status.installed && !status.updateAvailable);
  }
  if (series4CancelInstallButton) {
    series4CancelInstallButton.hidden = !installing;
    series4CancelInstallButton.disabled = !installing || typeof api.cancelSeries4Install !== "function";
  }
  if (series4LaunchButton) series4LaunchButton.disabled = installing || !status.canLaunch;
  if (series4RefreshButton) series4RefreshButton.disabled = installing || series4IsRefreshing || !status.canList;
}

async function refreshSeries4Status({ refreshSessions = false } = {}) {
  const api = series4Api();
  if (!series4EngineStatus || typeof api.getSeries4Status !== "function") {
    series4StatusSnapshot = null;
    renderSeries4EngineStatus();
    renderSeries4Empty("Series 4 연결 모듈이 준비되지 않았습니다.");
    return null;
  }

  series4EngineStatus.dataset.state = "checking";
  series4EngineStatus.textContent = "확인 중";
  try {
    const result = await api.getSeries4Status();
    series4StatusSnapshot = normalizeSeries4Status(result);
  } catch (_error) {
    series4StatusSnapshot = { ...normalizeSeries4Status({ state: "error" }), ok: false };
  }
  renderSeries4EngineStatus();
  if (refreshSessions && series4StatusSnapshot?.canList) await refreshSeries4Sessions();
  else if (refreshSessions) renderSeries4Empty("Series 4를 설치한 뒤 최근 기록을 확인할 수 있습니다.");
  return series4StatusSnapshot;
}

function series4ProgressPercent(event) {
  let value = safeSeries4Number(event?.percent ?? event?.percentage, 0, 100);
  if (value === null) {
    const ratio = safeSeries4Number(event?.progress, 0, 1);
    if (ratio !== null) value = ratio * 100;
  }
  if (value === null) {
    const downloaded = safeSeries4Number(event?.downloadedBytes, 0);
    const total = safeSeries4Number(event?.totalBytes, 1);
    if (downloaded !== null && total !== null) value = Math.min(100, (downloaded / total) * 100);
  }
  return value === null ? null : Math.round(value);
}

function updateSeries4Progress(event = {}) {
  if (!series4ProgressWrap || !series4Progress || !series4ProgressText || !series4ProgressValue) return;
  const phase = String(event.phase ?? event.state ?? "preparing").toLowerCase();
  const phaseLabels = {
    checking: "설치 파일 확인 중",
    starting: "설치 준비 중",
    preparing: "설치 준비 중",
    copying: "내장 설치 파일 준비 중",
    downloading: "설치 파일 준비 중",
    verifying: "파일 검증 중",
    extracting: "압축 해제 중",
    installing: "설치 중",
    complete: "설치 완료",
    completed: "설치 완료",
    cancelled: "설치 취소됨",
    canceled: "설치 취소됨",
    error: "설치 실패",
  };
  const percent = series4ProgressPercent(event);
  series4ProgressWrap.hidden = false;
  series4ProgressText.textContent = phaseLabels[phase] || "설치 진행 중";
  if (percent === null) {
    series4Progress.removeAttribute("value");
    series4ProgressValue.textContent = "진행 중";
  } else {
    series4Progress.value = percent;
    series4ProgressValue.textContent = `${percent}%`;
  }
}

function setSeries4Installing(isInstalling) {
  series4IsInstalling = isInstalling;
  series4ProgressWrap?.setAttribute("aria-busy", String(isInstalling));
  renderSeries4EngineStatus();
}

async function installSeries4Engine() {
  const api = series4Api();
  if (series4IsInstalling || typeof api.installSeries4 !== "function") return;
  setSeries4Installing(true);
  updateSeries4Progress({ phase: "preparing", percent: 0 });
  try {
    const result = await api.installSeries4();
    if (result?.ok === false) {
      updateSeries4Progress({ phase: result?.cancelled || result?.canceled ? "cancelled" : "error" });
    } else {
      updateSeries4Progress({ phase: "complete", percent: 100 });
    }
  } catch (_error) {
    updateSeries4Progress({ phase: "error" });
  } finally {
    setSeries4Installing(false);
    await refreshSeries4Status({ refreshSessions: true });
    series4InstallButton?.focus();
  }
}

async function cancelSeries4EngineInstall() {
  const api = series4Api();
  if (!(series4IsInstalling || series4StatusSnapshot?.installing) || typeof api.cancelSeries4Install !== "function") return;
  if (series4CancelInstallButton) series4CancelInstallButton.disabled = true;
  updateSeries4Progress({ phase: "cancelled" });
  try {
    await api.cancelSeries4Install();
  } catch (_error) {
    updateSeries4Progress({ phase: "error" });
  } finally {
    setSeries4Installing(false);
    await refreshSeries4Status();
  }
}

async function launchSeries4Recorder() {
  const api = series4Api();
  if (series4LaunchButton?.disabled || typeof api.launchSeries4 !== "function") return;
  series4LaunchButton.disabled = true;
  series4LaunchButton.setAttribute("aria-busy", "true");
  try {
    const result = await api.launchSeries4({ mode: "record" });
    if (series4EngineHelp) {
      series4EngineHelp.textContent = result?.ok === false
        ? "Series 4를 열지 못했습니다. 설치 상태를 다시 확인해 주세요."
        : "Series 4 창을 열었습니다. 기록을 마친 뒤 최근 기록을 새로고침하세요.";
    }
  } catch (_error) {
    if (series4EngineHelp) series4EngineHelp.textContent = "Series 4를 열지 못했습니다. 설치 상태를 다시 확인해 주세요.";
  } finally {
    series4LaunchButton.removeAttribute("aria-busy");
    renderSeries4EngineStatus();
  }
}

function series4EventKey(rawType) {
  const normalized = String(rawType || "").toLowerCase().replace(/[^a-z]/g, "");
  const aliases = {
    wheel: "mousewheel",
    mousewheelevent: "mousewheel",
    scrollwheel: "mousewheel",
    mousebuttondown: "mousedown",
    mousebuttonup: "mouseup",
    keyboarddown: "keydown",
    keyboardup: "keyup",
  };
  const key = aliases[normalized] || normalized;
  return SERIES4_EVENT_LABELS[key] ? key : "";
}

function normalizeSeries4Timeline(timeline, durationMs) {
  if (!Array.isArray(timeline)) return [];
  return timeline
    .slice(0, 1000)
    .map((event) => {
      if (!event || typeof event !== "object") return null;
      const type = series4EventKey(event.type);
      const offsetMs = safeSeries4Number(event.offsetMs, 0, Math.max(86400000, durationMs || 0));
      const eventDurationMs = safeSeries4Number(event.durationMs, 0, 86400000) ?? 0;
      if (!type || offsetMs === null) return null;
      return { type, offsetMs: Math.round(offsetMs), durationMs: Math.round(eventDurationMs) };
    })
    .filter(Boolean)
    .sort((left, right) => left.offsetMs - right.offsetMs);
}

function series4EventCounts(source) {
  const countsSource = source?.eventTypeCounts ?? source?.eventTypes ?? source?.counts ?? source?.summary?.eventTypeCounts ?? source?.summary?.eventTypes ?? {};
  const counts = {};
  let other = 0;
  const entries = Array.isArray(countsSource)
    ? countsSource.map((item) => [item?.type, item?.count])
    : countsSource && typeof countsSource === "object"
      ? Object.entries(countsSource)
      : [];
  if (entries.length) {
    entries.forEach(([rawKey, rawValue]) => {
      const value = safeSeries4Number(rawValue, 0, 100000000);
      if (value === null || value === 0) return;
      const key = series4EventKey(rawKey);
      if (key) counts[key] = (counts[key] || 0) + Math.round(value);
      else other += Math.round(value);
    });
  }
  if (other) counts.other = other;
  return counts;
}

function series4Collection(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.sessions)) return result.sessions;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function normalizeSeries4Session(source, index, fallbackToken = null) {
  if (!source || typeof source !== "object") return null;
  const token = source.sessionId ?? source.id ?? source.token ?? fallbackToken;
  if (typeof token !== "string" && typeof token !== "number") return null;
  const startedValue = source.startedAt ?? source.createdAt ?? source.recordedAt ?? source.savedAt ?? source.timestamp;
  const startedDate = startedValue === null || startedValue === undefined ? null : new Date(startedValue);
  const startedAt = startedDate && Number.isFinite(startedDate.getTime()) ? startedDate.getTime() : null;
  let durationMs = safeSeries4Number(source.durationMs ?? source.elapsedMs, 0, 86400000);
  if (durationMs === null) {
    const durationSeconds = safeSeries4Number(source.durationSeconds ?? source.elapsedSeconds, 0, 86400);
    durationMs = durationSeconds === null ? null : durationSeconds * 1000;
  }
  const width = safeSeries4Number(source.width ?? source.videoWidth ?? source.capture?.width, 1, 20000);
  const height = safeSeries4Number(source.height ?? source.videoHeight ?? source.capture?.height, 1, 20000);
  const eventCounts = series4EventCounts(source);
  const summedEvents = Object.values(eventCounts).reduce((sum, value) => sum + value, 0);
  const eventCount = Math.round(safeSeries4Number(source.eventCount ?? source.totalEvents, 0, 100000000) ?? summedEvents);
  const artifactFlags = source.artifacts && typeof source.artifacts === "object" ? source.artifacts : {};
  const hasVideo = Boolean(source.hasVideo ?? source.videoAvailable ?? artifactFlags.video ?? true);
  const hasFolder = source.folderAvailable !== false;
  return {
    handle: `series4-session-${index + 1}`,
    token,
    startedAt,
    durationMs,
    width: width === null ? null : Math.round(width),
    height: height === null ? null : Math.round(height),
    eventCounts,
    eventCount,
    timeline: normalizeSeries4Timeline(source.timeline, durationMs),
    version: safeSeries4Version(source.version ?? source.appVersion ?? source.engineVersion),
    hasVideo,
    hasFolder,
  };
}

function formatSeries4Date(timestamp) {
  if (!Number.isFinite(timestamp)) return "기록 시각 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatSeries4Duration(durationMs) {
  if (!Number.isFinite(durationMs)) return "길이 —";
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function series4CountBadges(counts, { emptyLabel = "입력 집계 없음" } = {}) {
  const entries = Object.entries(counts || {}).filter(([, count]) => count > 0);
  if (!entries.length) return `<span class="series4-count-chip is-muted">${escapeHtml(emptyLabel)}</span>`;
  return entries
    .map(([key, count]) => `<span class="series4-count-chip">${escapeHtml(SERIES4_EVENT_LABELS[key] || "기타")} <strong>${Math.round(count)}</strong></span>`)
    .join("");
}

function formatSeries4TimelineOffset(offsetMs) {
  const totalSeconds = Math.max(0, Math.round(offsetMs / 100) / 10);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round((totalSeconds % 60) * 10) / 10;
  return minutes ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}

function resetSeries4MediaReview() {
  if (series4VideoPreview) {
    series4VideoPreview.pause();
    series4VideoPreview.removeAttribute("src");
    series4VideoPreview.hidden = true;
    series4VideoPreview.load();
  }
  if (series4Timeline) series4Timeline.hidden = true;
  if (series4TimelineTrack) series4TimelineTrack.replaceChildren();
  if (series4VideoReview) series4VideoReview.hidden = true;
}

function renderSeries4Timeline(session) {
  if (!series4Timeline || !series4TimelineTrack) return;
  const timeline = Array.isArray(session?.timeline) ? session.timeline : [];
  if (!timeline.length) {
    series4Timeline.hidden = true;
    series4TimelineTrack.replaceChildren();
    return;
  }
  const lastEventEnd = timeline.reduce((maximum, event) => Math.max(maximum, event.offsetMs + event.durationMs), 0);
  const durationMs = Math.max(1, session.durationMs || lastEventEnd);
  series4TimelineTrack.innerHTML = timeline
    .map((event) => {
      const left = Math.min(100, Math.max(0, (event.offsetMs / durationMs) * 100));
      const width = Math.min(100 - left, Math.max(0.8, (event.durationMs / durationMs) * 100));
      const label = SERIES4_EVENT_LABELS[event.type];
      const offsetLabel = formatSeries4TimelineOffset(event.offsetMs);
      return `<button class="series4-timeline-marker is-${event.type}" type="button" role="listitem" style="--series4-marker-left:${left.toFixed(3)}%;--series4-marker-width:${width.toFixed(3)}%" data-series4-timeline-ms="${event.offsetMs}" aria-label="${escapeHtml(`${label}, ${offsetLabel}`)}" title="${escapeHtml(`${label} · ${offsetLabel}`)}"></button>`;
    })
    .join("");
  series4Timeline.hidden = false;
  if (series4VideoReview) series4VideoReview.hidden = false;
}

function safeSeries4VideoUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return parsed.protocol === "heyu-series4:" ? parsed.href : "";
  } catch (_error) {
    return "";
  }
}

async function loadSeries4Video(session) {
  const api = series4Api();
  if (!session?.hasVideo || typeof api.getSeries4VideoUrl !== "function") return;
  const requestedHandle = session.handle;
  try {
    const result = await api.getSeries4VideoUrl({ sessionId: session.token });
    const safeUrl = result?.ok === false ? "" : safeSeries4VideoUrl(result?.url);
    if (!safeUrl || series4SelectedHandle !== requestedHandle || !series4VideoPreview) return;
    series4VideoPreview.src = safeUrl;
    series4VideoPreview.hidden = false;
    if (series4VideoReview) series4VideoReview.hidden = false;
    series4VideoPreview.load();
  } catch (_error) {
    // The explicit open-video button remains available as a local fallback.
  }
}

function renderSeries4Empty(message) {
  if (series4SessionCount) series4SessionCount.textContent = "0개";
  if (series4SessionList) series4SessionList.innerHTML = `<p class="series4-empty">${escapeHtml(message)}</p>`;
  if (series4SessionReview) series4SessionReview.hidden = true;
  resetSeries4MediaReview();
  if (series4OpenVideoButton) series4OpenVideoButton.disabled = true;
  if (series4OpenFolderButton) series4OpenFolderButton.disabled = true;
}

function renderSeries4Sessions() {
  if (!series4SessionList) return;
  if (series4SessionCount) series4SessionCount.textContent = `${series4Sessions.length}개`;
  if (!series4Sessions.length) {
    renderSeries4Empty("아직 표시할 기록이 없습니다.");
    return;
  }
  series4SessionList.innerHTML = series4Sessions
    .map((session, index) => {
      const selected = session.handle === series4SelectedHandle;
      return `
        <button class="series4-session-card${selected ? " is-selected" : ""}" type="button" role="listitem" data-series4-session-handle="${session.handle}" aria-pressed="${String(selected)}">
          <span class="series4-session-index">${index + 1}</span>
          <span class="series4-session-body">
            <strong>${escapeHtml(formatSeries4Date(session.startedAt))}</strong>
            <span>${escapeHtml(formatSeries4Duration(session.durationMs))} · 입력 ${session.eventCount}건</span>
          </span>
          <i data-lucide="chevron-right"></i>
        </button>
      `;
    })
    .join("");
  createIcons();
}

function renderSeries4Review(session, index = series4Sessions.indexOf(session)) {
  if (!session || !series4SessionReview) return;
  series4SessionReview.hidden = false;
  if (series4ReviewTitle) series4ReviewTitle.textContent = `기록 ${Math.max(1, index + 1)} · ${formatSeries4Date(session.startedAt)}`;
  if (series4ReviewDuration) series4ReviewDuration.textContent = formatSeries4Duration(session.durationMs);
  if (series4ReviewMeta) {
    const resolution = session.width && session.height ? `${session.width} × ${session.height}` : "정보 없음";
    const version = session.version || "정보 없음";
    series4ReviewMeta.innerHTML = `
      <div><dt>입력 이벤트</dt><dd>${session.eventCount}건</dd></div>
      <div><dt>화면 크기</dt><dd>${escapeHtml(resolution)}</dd></div>
      <div><dt>기록 버전</dt><dd>${escapeHtml(version)}</dd></div>
      <div><dt>영상</dt><dd>${session.hasVideo ? "로컬 보관" : "없음"}</dd></div>
    `;
  }
  if (series4ReviewCounts) series4ReviewCounts.innerHTML = series4CountBadges(session.eventCounts);
  renderSeries4Timeline(session);
  if (series4OpenVideoButton) series4OpenVideoButton.disabled = !session.hasVideo || typeof series4Api().openSeries4Artifact !== "function";
  if (series4OpenFolderButton) series4OpenFolderButton.disabled = !session.hasFolder || typeof series4Api().openSeries4Artifact !== "function";
  createIcons();
}

async function inspectSeries4Session(handle) {
  const baseSession = series4Sessions.find((session) => session.handle === handle);
  if (!baseSession) return;
  series4SelectedHandle = handle;
  resetSeries4MediaReview();
  renderSeries4Sessions();
  renderSeries4Review(baseSession);
  const api = series4Api();
  if (typeof api.inspectSeries4Session !== "function") {
    void loadSeries4Video(baseSession);
    return;
  }
  series4SessionReview?.setAttribute("aria-busy", "true");
  try {
    const result = await api.inspectSeries4Session({ sessionId: baseSession.token });
    if (result?.ok === false) return;
    const source = result?.session ?? result?.metadata ?? result;
    const inspected = normalizeSeries4Session(source, series4Sessions.indexOf(baseSession), baseSession.token);
    if (!inspected) return;
    inspected.startedAt ??= baseSession.startedAt;
    inspected.durationMs ??= baseSession.durationMs;
    inspected.width ??= baseSession.width;
    inspected.height ??= baseSession.height;
    inspected.version ||= baseSession.version;
    if (!inspected.eventCount && baseSession.eventCount) {
      inspected.eventCount = baseSession.eventCount;
      inspected.eventCounts = baseSession.eventCounts;
    }
    inspected.timeline = normalizeSeries4Timeline(result?.timeline ?? source?.timeline, inspected.durationMs);
    if (!inspected.timeline.length) inspected.timeline = baseSession.timeline;
    inspected.handle = baseSession.handle;
    if (series4SelectedHandle !== handle) return;
    series4Sessions = series4Sessions.map((session) => (session.handle === handle ? inspected : session));
    renderSeries4Sessions();
    renderSeries4Review(inspected);
    void loadSeries4Video(inspected);
  } catch (_error) {
    // Keep the safe list metadata visible when deeper inspection is unavailable.
  } finally {
    series4SessionReview?.removeAttribute("aria-busy");
  }
}

async function refreshSeries4Sessions() {
  const api = series4Api();
  if (series4IsRefreshing || typeof api.listSeries4Sessions !== "function") return;
  series4IsRefreshing = true;
  series4SelectedHandle = "";
  if (series4SessionReview) series4SessionReview.hidden = true;
  resetSeries4MediaReview();
  series4RefreshButton?.setAttribute("aria-busy", "true");
  renderSeries4EngineStatus();
  if (series4SessionList) series4SessionList.innerHTML = `<p class="series4-empty">최근 기록을 확인하는 중입니다.</p>`;
  try {
    const result = await api.listSeries4Sessions();
    if (result?.ok === false) {
      series4Sessions = [];
      series4SelectedHandle = "";
      renderSeries4Empty("최근 기록을 불러오지 못했습니다.");
      return;
    }
    series4Sessions = series4Collection(result)
      .slice(0, 20)
      .map((session, index) => normalizeSeries4Session(session, index))
      .filter(Boolean);
    series4SelectedHandle = "";
    renderSeries4Sessions();
  } catch (_error) {
    series4Sessions = [];
    series4SelectedHandle = "";
    renderSeries4Empty("최근 기록을 불러오지 못했습니다.");
  } finally {
    series4IsRefreshing = false;
    series4RefreshButton?.removeAttribute("aria-busy");
    renderSeries4EngineStatus();
  }
}

async function openSelectedSeries4Artifact(artifact) {
  const session = series4Sessions.find((item) => item.handle === series4SelectedHandle);
  const api = series4Api();
  if (!session || typeof api.openSeries4Artifact !== "function") return;
  const button = artifact === "video" ? series4OpenVideoButton : series4OpenFolderButton;
  if (button?.disabled) return;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  try {
    const result = await api.openSeries4Artifact({ sessionId: session.token, artifact });
    if (result?.ok === false && series4EngineHelp) series4EngineHelp.textContent = "선택한 로컬 기록을 열지 못했습니다.";
  } catch (_error) {
    if (series4EngineHelp) series4EngineHelp.textContent = "선택한 로컬 기록을 열지 못했습니다.";
  } finally {
    button.removeAttribute("aria-busy");
    renderSeries4Review(series4Sessions.find((item) => item.handle === series4SelectedHandle));
  }
}

function handleSeries4SessionListClick(event) {
  const card = event.target.closest("[data-series4-session-handle]");
  if (!card) return;
  void inspectSeries4Session(card.dataset.series4SessionHandle);
}

function handleSeries4TimelineClick(event) {
  const marker = event.target.closest("[data-series4-timeline-ms]");
  if (!marker || !series4VideoPreview?.src) return;
  const offsetMs = safeSeries4Number(marker.dataset.series4TimelineMs, 0, 86400000);
  if (offsetMs === null) return;
  series4VideoPreview.currentTime = offsetMs / 1000;
  series4VideoPreview.focus();
}

function setupSeries4Panel() {
  if (series4SetupDone || !series4EngineStatus) return;
  series4SetupDone = true;
  series4InstallButton?.addEventListener("click", () => void installSeries4Engine());
  series4CancelInstallButton?.addEventListener("click", () => void cancelSeries4EngineInstall());
  series4LaunchButton?.addEventListener("click", () => void launchSeries4Recorder());
  series4RefreshButton?.addEventListener("click", () => void refreshSeries4Sessions());
  series4SessionList?.addEventListener("click", handleSeries4SessionListClick);
  series4TimelineTrack?.addEventListener("click", handleSeries4TimelineClick);
  series4OpenVideoButton?.addEventListener("click", () => void openSelectedSeries4Artifact("video"));
  series4OpenFolderButton?.addEventListener("click", () => void openSelectedSeries4Artifact("folder"));
  if (typeof series4Api().onSeries4Progress === "function" && !disposeSeries4Progress) {
    try {
      disposeSeries4Progress = series4Api().onSeries4Progress(updateSeries4Progress);
    } catch (_error) {
      disposeSeries4Progress = null;
    }
  }
  void refreshSeries4Status();
}

function setupRoutinePanel() {
  if (!routinePanel) return;
  const enabled = isRoutineOfficer();
  routinePanel.hidden = !enabled;
  document.querySelector("#chatApp")?.classList.toggle("has-routine-panel", enabled);
  document.querySelector(".chat-workspace")?.classList.toggle("has-routine-panel", enabled);
  if (!enabled) return;

  routineActionTypeInput?.setAttribute("aria-label", "자동화 동작");
  routineStepRepeatInput?.setAttribute("aria-label", "동작 반복 횟수");
  routineXInput?.setAttribute("aria-label", "클릭 X 좌표");
  routineYInput?.setAttribute("aria-label", "클릭 Y 좌표");
  routineX2Input?.setAttribute("aria-label", "드래그 끝 X 또는 상대 X");
  routineY2Input?.setAttribute("aria-label", "드래그 끝 Y 또는 상대 Y");
  routineWaitSecondsInput?.setAttribute("aria-label", "대기 또는 타임아웃 초");
  routineDurationSecondsInput?.setAttribute("aria-label", "동작 지속 또는 속도 초");
  routineStepValueInput?.setAttribute("aria-label", "입력 텍스트 또는 단축키");
  routineWindowTitleInput?.setAttribute("aria-label", "대상 창 제목");
  routineOutputInput?.setAttribute("aria-label", "자동화 산출 형식");
  routineRiskInput?.setAttribute("aria-label", "자동화 권한 범위");
  routineRepeatInput?.setAttribute("aria-label", "자동화 반복 조건");
  routineStopInput?.setAttribute("aria-label", "자동화 중지 조건");
  routineRunDelayInput?.setAttribute("aria-label", "실행 시작 대기 초");
  routineRunRepeatInput?.setAttribute("aria-label", "전체 루틴 반복 횟수");
  routineRunForeverInput?.setAttribute("aria-label", "중지할 때까지 무한 반복");
  routineAutoModeInput?.setAttribute("aria-label", "자동 설정 방식");
  routineAutoTaskInput?.setAttribute("aria-label", "자동 설정 업무명");
  routineAutoRepeatInput?.setAttribute("aria-label", "자동 설정 반복대상");
  routineAutoCautionInput?.setAttribute("aria-label", "자동 설정 주의사항");
  routineRecordDelayInput?.setAttribute("aria-label", "녹화 시작 대기 초");
  routineTabs.forEach((button) => button.addEventListener("click", () => switchRoutineTab(button.dataset.routineTab)));
  document.querySelectorAll("[data-routine-action-preset]").forEach((button) => {
    button.addEventListener("click", () => applyRoutineActionPreset(button.dataset.routineActionPreset));
  });
  routineCaptureButton?.addEventListener("click", captureRoutineCursor);
  routineAddStepButton?.addEventListener("click", addRoutineStepFromForm);
  routineUpdateStepButton?.addEventListener("click", updateRoutineStepFromForm);
  routineClearButton?.addEventListener("click", clearRoutineSteps);
  routineApplyButton?.addEventListener("click", insertRoutineBrief);
  routineRunButton?.addEventListener("click", startRoutineExecution);
  routineRunStopButton?.addEventListener("click", stopRoutineExecution);
  routineRunForeverInput?.addEventListener("change", syncRoutineRepeatControls);
  routineApprovalRejectButton?.addEventListener("click", () => void resolveRoutineApproval(false));
  routineApprovalApproveButton?.addEventListener("click", () => void resolveRoutineApproval(true));
  routineSaveButton?.addEventListener("click", saveRoutineFile);
  routineLoadButton?.addEventListener("click", loadRoutineFile);
  routineRecordButton?.addEventListener("click", startRoutineRecording);
  routineRecordStopButton?.addEventListener("click", stopRoutineRecording);
  routineAutoPromptButton?.addEventListener("click", insertRoutineAutoPrompt);
  routineStepList?.addEventListener("click", handleRoutineStepListClick);
  routineStepList?.addEventListener("keydown", handleRoutineStepListKeydown);
  if (window.desktopAPI?.onRoutineRecordingEvent && !disposeRoutineRecordingEvent) {
    disposeRoutineRecordingEvent = window.desktopAPI.onRoutineRecordingEvent(handleRoutineRecordingEvent);
  }
  if (window.desktopAPI?.onRoutineExecutionEvent && !disposeRoutineExecutionEvent) {
    disposeRoutineExecutionEvent = window.desktopAPI.onRoutineExecutionEvent(handleRoutineExecutionEvent);
  }
  setupSeries4Panel();
  syncRoutineRepeatControls();
  startRoutineCursorPolling();
  renderRoutineSteps();
}

function switchRoutineTab(tab) {
  if (!isRoutineOfficer()) return;
  routineActiveTab = tab === "auto" ? "auto" : "direct";
  routineTabs.forEach((button) => {
    const isActive = button.dataset.routineTab === routineActiveTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
  });
  routinePanes.forEach((pane) => {
    pane.classList.toggle("is-active", pane.dataset.routinePane === routineActiveTab);
  });
  if (routineActiveTab === "auto" && !routineAutoIntroShown) {
    routineAutoIntroShown = true;
    addRoutineAutoMessage();
  }
  if (routineActiveTab === "auto") void refreshSeries4Status({ refreshSessions: true });
  createIcons();
}

function applyRoutineActionPreset(action) {
  if (!isRoutineOfficer() || !routineActionTypeInput) return;
  routineActionTypeInput.value = action || "click";
  if (action === "pressKey" && routineStepValueInput && !routineStepValueInput.value.trim()) {
    routineStepValueInput.value = "enter";
  }
  if (action === "hotkey" && routineStepValueInput && !routineStepValueInput.value.trim()) {
    routineStepValueInput.value = "ctrl+s";
  }
  if (action === "wait" && routineWaitSecondsInput && !Number(routineWaitSecondsInput.value)) {
    routineWaitSecondsInput.value = "1";
  }
}

function weightedRandom(items) {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.weight || 0)), 0);
  let cursor = Math.random() * (total || 1);
  for (const item of items) {
    cursor -= Math.max(0, Number(item.weight || 0));
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function routineAutoLines() {
  const lines = [];
  const mode = routineAutoModeInput?.value || "record";
  const task = routineAutoTaskInput?.value.trim() || "";
  const repeat = routineAutoRepeatInput?.value.trim() || "";
  const caution = routineAutoCautionInput?.value.trim() || "";
  const modeLabels = {
    record: "사용자가 한 번 수행한 흐름을 단계표로 정리",
    describe: "말로 설명한 업무를 단계표로 정리",
    screenshot: "스크린샷/OCR 확인 지점 중심으로 정리",
  };
  lines.push(`- 방식: ${modeLabels[mode] || mode}`);
  if (task) lines.push(`- 업무명: ${task}`);
  if (repeat) lines.push(`- 반복대상: ${repeat}`);
  if (caution) lines.push(`- 주의사항: ${caution}`);
  return lines;
}

function addRoutineAutoMessage() {
  if (!isRoutineOfficer()) return;
  const picked = weightedRandom(ROUTINE_AUTO_MESSAGES);
  addRoutineMessage(picked.text);
}

function addRoutineMessage(text) {
  if (!isRoutineOfficer()) return;
  messages.push({
    from: "them",
    time: currentTime(),
    text,
  });
  persistMessages();
  renderMessages();
}

function buildRoutineAutoPrompt() {
  return ["자동 루틴 설정을 시작하겠습니다.", "자동 설정 조건:", ...routineAutoLines()].join("\n");
}

function insertRoutineAutoPrompt() {
  insertTextIntoComposer(buildRoutineAutoPrompt());
}

function setRoutineRecordStatus(text, state = "idle") {
  if (!routineRecordStatus) return;
  routineRecordStatus.textContent = text;
  routineRecordStatus.dataset.state = state;
}

function hasDesignOnlyRoutineSteps() {
  return routineSteps.some((step) => ROUTINE_DESIGN_ONLY_ACTIONS.has(step?.action));
}

function updateRoutineRunButtonAvailability() {
  if (!routineRunButton) return;
  const blocked = hasDesignOnlyRoutineSteps();
  routineRunButton.disabled = isRoutineRecording || isRoutineExecuting || blocked;
  routineRunButton.title = blocked ? "설계 전용 단계는 실행할 수 없습니다. 해당 단계를 빼거나 구현 후 실행하세요." : "";
}

function setRoutineRecordingBusy(isBusy) {
  isRoutineRecording = isBusy;
  if (routineRecordButton) routineRecordButton.disabled = isBusy;
  if (routineRecordStopButton) routineRecordStopButton.disabled = !isBusy;
  updateRoutineRunButtonAvailability();
}

function routineRecordDelaySeconds() {
  return Math.min(60, Math.max(0, Number(readNumberInput(routineRecordDelayInput, 2) || 0)));
}

function setRoutineRunStatus(text, state = "idle") {
  if (!routineRunStatus) return;
  routineRunStatus.textContent = text;
  routineRunStatus.dataset.state = state;
}

function setRoutineApprovalBusy(isBusy) {
  routineApprovalBusy = isBusy;
  routineApprovalCard?.setAttribute("aria-busy", String(isBusy));
  if (routineApprovalRejectButton) routineApprovalRejectButton.disabled = isBusy;
  if (routineApprovalApproveButton) routineApprovalApproveButton.disabled = isBusy;
}

function clearRoutineApproval() {
  routinePendingApprovalToken = "";
  setRoutineApprovalBusy(false);
  if (routineApprovalCard) routineApprovalCard.hidden = true;
  if (routineApprovalTitle) routineApprovalTitle.textContent = "사용자 승인 대기";
  if (routineApprovalHelp) routineApprovalHelp.textContent = "승인 전에는 실행이 이 단계에서 멈춰 있습니다.";
}

function showRoutineApproval(event) {
  const token = String(event?.token || "");
  if (!/^step-\d+-[a-f0-9]{16}$/i.test(token) || !routineApprovalCard) return;
  const index = Math.max(1, Number(event?.index || 0) + 1);
  const action = event?.action === "checkpoint" ? "확인 지점" : "사용자 승인";
  routinePendingApprovalToken = token;
  setRoutineApprovalBusy(false);
  routineApprovalCard.hidden = false;
  if (routineApprovalTitle) routineApprovalTitle.textContent = `${index}단계 · ${action}`;
  if (routineApprovalHelp) routineApprovalHelp.textContent = "다음 단계로 진행해도 되는지 직접 선택하세요. 승인 전에는 실행이 멈춰 있습니다.";
  setRoutineRunStatus(`${index}/${routineSteps.length} 승인 대기`, "countdown");
  routineApprovalRejectButton?.focus({ preventScroll: true });
}

async function resolveRoutineApproval(approved) {
  const token = routinePendingApprovalToken;
  if (routineApprovalBusy || !/^step-\d+-[a-f0-9]{16}$/i.test(token)) return;
  if (typeof window.desktopAPI?.resolveRoutineApproval !== "function") {
    setRoutineRunStatus("승인 기능을 연결하지 못했습니다. 실행을 중지해 주세요.", "error");
    return;
  }
  setRoutineApprovalBusy(true);
  try {
    const result = await window.desktopAPI.resolveRoutineApproval({ token, approved: approved === true });
    if (!result?.ok) {
      setRoutineApprovalBusy(false);
      setRoutineRunStatus("승인 선택을 전달하지 못했습니다. 다시 선택하거나 실행을 중지해 주세요.", "error");
      return;
    }
    clearRoutineApproval();
    setRoutineRunStatus(approved ? "승인됨 · 계속 실행 중" : "거부됨 · 실행 중지 중", approved ? "recording" : "stopping");
  } catch (_error) {
    setRoutineApprovalBusy(false);
    setRoutineRunStatus("승인 선택을 전달하지 못했습니다. 다시 선택하거나 실행을 중지해 주세요.", "error");
  }
}

function setRoutineExecutionBusy(isBusy) {
  isRoutineExecuting = isBusy;
  updateRoutineRunButtonAvailability();
  if (routineRunStopButton) routineRunStopButton.disabled = !isBusy;
  if (routineRecordButton) routineRecordButton.disabled = isBusy || isRoutineRecording;
  if (routineRunForeverInput) routineRunForeverInput.disabled = isBusy;
  syncRoutineRepeatControls();
}

function routineRunDelaySeconds() {
  return Math.min(60, Math.max(0, Number(readNumberInput(routineRunDelayInput, 3) || 0)));
}

function routineRunRepeatCount() {
  return Math.min(999, Math.max(1, Math.round(Number(readNumberInput(routineRunRepeatInput, 1) || 1))));
}

function routineRunRepeatsForever() {
  return routineRunForeverInput?.checked === true;
}

function syncRoutineRepeatControls() {
  if (!routineRunRepeatInput) return;
  const repeatsForever = routineRunRepeatsForever();
  routineRunRepeatInput.disabled = repeatsForever || isRoutineExecuting;
  routineRunRepeatInput.title = repeatsForever ? "무한 반복에서는 횟수를 사용하지 않습니다." : "1회부터 999회까지 지정할 수 있습니다.";
}

async function startRoutineRecording() {
  if (!isRoutineOfficer() || isRoutineRecording || isRoutineExecuting) return;
  if (!window.desktopAPI?.startRoutineRecording) {
    setRoutineRecordStatus("데스크톱 실행 환경에서만 녹화할 수 있습니다.", "error");
    return;
  }

  const delaySeconds = routineRecordDelaySeconds();
  const picked = weightedRandom(ROUTINE_RECORDING_MESSAGES);
  addRoutineMessage(picked.text.replaceAll("{delay}", String(delaySeconds)));
  setRoutineRecordingBusy(true);
  setRoutineRecordStatus(`${delaySeconds}초 후 녹화 시작`, "countdown");

  try {
    const result = await window.desktopAPI.startRoutineRecording({ delaySeconds });
    if (!result?.ok) {
      setRoutineRecordingBusy(false);
      setRoutineRecordStatus(result?.error || "녹화를 시작하지 못했습니다.", "error");
    }
  } catch (error) {
    setRoutineRecordingBusy(false);
    setRoutineRecordStatus(error?.message || "녹화를 시작하지 못했습니다.", "error");
  }
}

async function stopRoutineRecording() {
  if (!isRoutineOfficer() || !isRoutineRecording) return;
  setRoutineRecordStatus("녹화 종료 요청 중", "stopping");
  try {
    await window.desktopAPI?.stopRoutineRecording?.();
  } catch (error) {
    setRoutineRecordStatus(error?.message || "녹화 종료 요청에 실패했습니다.", "error");
  }
}

async function startRoutineExecution() {
  if (!isRoutineOfficer() || isRoutineExecuting) return;
  clearRoutineApproval();
  if (!routineSteps.length) {
    setRoutineRunStatus("실행할 단계가 없습니다.", "error");
    return;
  }
  const designOnlyCount = routineSteps.filter((step) => ROUTINE_DESIGN_ONLY_ACTIONS.has(step?.action)).length;
  if (designOnlyCount) {
    setRoutineRunStatus(`설계 전용 단계 ${designOnlyCount}개는 현재 실행되지 않습니다.`, "error");
    return;
  }
  if (!window.desktopAPI?.startRoutineExecution) {
    setRoutineRunStatus("데스크톱 실행 환경에서만 실행할 수 있습니다.", "error");
    return;
  }

  const delaySeconds = routineRunDelaySeconds();
  const repeatCount = routineRunRepeatCount();
  const repeatForever = routineRunRepeatsForever();
  const repeatLabel = repeatForever ? "무한 반복" : `${repeatCount}회 반복`;
  setRoutineExecutionBusy(true);
  setRoutineRunStatus(`${delaySeconds}초 후 실행 시작 · ${repeatLabel}`, "countdown");
  const picked = weightedRandom(ROUTINE_EXECUTION_MESSAGES);
  addRoutineMessage(picked.text.replaceAll("{delay}", String(delaySeconds)));

  try {
    const result = await window.desktopAPI.startRoutineExecution({
      delaySeconds,
      repeatCount,
      repeatForever,
      steps: routineSteps.map((step) => ({ ...step })),
    });
    if (!result?.ok) {
      setRoutineExecutionBusy(false);
      setRoutineRunStatus(result?.error || "실행을 시작하지 못했습니다.", "error");
    }
  } catch (error) {
    setRoutineExecutionBusy(false);
    setRoutineRunStatus(error?.message || "실행을 시작하지 못했습니다.", "error");
  }
}

async function stopRoutineExecution() {
  if (!isRoutineOfficer() || !isRoutineExecuting) return;
  setRoutineRunStatus("실행 중지 요청 중", "stopping");
  if (routinePendingApprovalToken) setRoutineApprovalBusy(true);
  try {
    const result = await window.desktopAPI?.stopRoutineExecution?.();
    if (result?.ok !== false) clearRoutineApproval();
    else setRoutineApprovalBusy(false);
  } catch (error) {
    setRoutineApprovalBusy(false);
    setRoutineRunStatus(error?.message || "실행 중지 요청에 실패했습니다.", "error");
  }
}

function normalizeRecordedStep(step) {
  const normalized = { ...step };
  normalized.id = normalized.id || `recorded-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  normalized.repeat = Math.min(50, Math.max(1, Math.round(Number(normalized.repeat || 1))));
  if (Number.isFinite(Number(normalized.x))) normalized.x = Math.round(Number(normalized.x));
  if (Number.isFinite(Number(normalized.y))) normalized.y = Math.round(Number(normalized.y));
  if (Number.isFinite(Number(normalized.x2))) normalized.x2 = Math.round(Number(normalized.x2));
  if (Number.isFinite(Number(normalized.y2))) normalized.y2 = Math.round(Number(normalized.y2));
  if (Number.isFinite(Number(normalized.waitSeconds))) normalized.waitSeconds = Math.round(Number(normalized.waitSeconds) * 10) / 10;
  if (Number.isFinite(Number(normalized.durationSeconds))) normalized.durationSeconds = Math.round(Number(normalized.durationSeconds) * 10) / 10;
  if (Number.isFinite(Number(normalized.delayBefore))) normalized.delayBefore = Math.round(Number(normalized.delayBefore) * 10) / 10;
  normalized.value = String(normalized.value || "").slice(0, 500);
  return normalized;
}

function handleRoutineRecordingEvent(event) {
  if (!isRoutineOfficer() || !event) return;
  if (event.type === "status") {
    if (event.state === "countdown") {
      setRoutineRecordStatus(`${event.delaySeconds || 0}초 후 녹화 시작`, "countdown");
    } else if (event.state === "recording") {
      setRoutineRecordStatus("녹화 중입니다. 완료하면 녹화 종료를 누르세요.", "recording");
    } else if (event.state === "idle" && isRoutineRecording) {
      setRoutineRecordingBusy(false);
      setRoutineRecordStatus("녹화 대기 중", "idle");
    }
    return;
  }
  if (event.type === "step") {
    setRoutineRecordStatus(`녹화 중 · ${event.count || 0}단계 기록`, "recording");
    return;
  }
  if (event.type === "final") {
    setRoutineRecordingBusy(false);
    const recorded = Array.isArray(event.steps) ? event.steps.map(normalizeRecordedStep) : [];
    if (recorded.length) {
      routineSteps = recorded.slice(0, 30);
      routineEditingStepId = null;
      switchRoutineTab("direct");
      renderRoutineSteps();
      setRoutineRecordStatus(`녹화 완료 · ${routineSteps.length}단계`, "done");
      addRoutineMessage(`녹화가 끝났습니다. ${routineSteps.length}개 단계로 정리해두었습니다. 직접 설정 탭에서 빠진 단계가 있는지 확인해 주세요.`);
    } else {
      setRoutineRecordStatus(event.canceled ? "녹화가 취소되었습니다." : "기록된 단계가 없습니다.", "idle");
    }
    return;
  }
  if (event.type === "error") {
    setRoutineRecordingBusy(false);
    setRoutineRecordStatus(event.message || "녹화 중 오류가 발생했습니다.", "error");
    addRoutineMessage(`녹화 중 문제가 생겼습니다. ${event.message || "오류 내용을 확인해 주세요."}`);
  }
}

function handleRoutineExecutionEvent(event) {
  if (!isRoutineOfficer() || !event) return;
  if (event.type === "approval-required") {
    showRoutineApproval(event);
    return;
  }
  if (event.type === "approval-resolved") {
    clearRoutineApproval();
    setRoutineRunStatus(event.approved ? "승인됨 · 계속 실행 중" : "거부됨 · 실행 중지 중", event.approved ? "recording" : "stopping");
    return;
  }
  if (event.type === "status") {
    if (event.state === "countdown") {
      const repeatText = event.repeatForever ? "무한 반복" : `${event.repeatCount || 1}회 반복`;
      setRoutineRunStatus(`${event.delaySeconds || 0}초 후 실행 시작 · ${repeatText}`, "countdown");
    } else if (event.state === "running") {
      const repeatText = event.repeatForever ? "무한 반복" : `${event.repeatCount || 1}회 반복`;
      setRoutineRunStatus(`실행 중 · ${event.count || routineSteps.length}단계 · ${repeatText}`, "recording");
    } else if (event.state === "stopping") {
      const reasonText = event.reason === "emergency-hotkey" ? "긴급 중지 키 감지" : "중지 요청 처리 중";
      setRoutineRunStatus(reasonText, "stopping");
    } else if (event.state === "idle" && isRoutineExecuting) {
      clearRoutineApproval();
      setRoutineExecutionBusy(false);
      setRoutineRunStatus("실행 대기 중", "idle");
    }
    return;
  }
  if (event.type === "cycle-start") {
    const cycle = Number(event.cycle || 1);
    const total = event.repeatForever ? "∞" : Number(event.totalCycles || 1);
    setRoutineRunStatus(`${cycle}/${total}회차 실행 중`, "recording");
    return;
  }
  if (event.type === "cycle-done") {
    const cycle = Number(event.cycle || 1);
    const total = event.repeatForever ? "∞" : Number(event.totalCycles || 1);
    setRoutineRunStatus(`${cycle}/${total}회차 완료`, "recording");
    return;
  }
  if (event.type === "step-start") {
    const index = Number(event.index || 0) + 1;
    const repeatText = event.repeat > 1 ? ` (${Number(event.repeatIndex || 0) + 1}/${event.repeat})` : "";
    const cycleText = Number(event.cycle || 0) > 0 ? `${Number(event.cycle)}회차 · ` : "";
    setRoutineRunStatus(`${cycleText}${index}/${routineSteps.length} 실행 중${repeatText}`, "recording");
    return;
  }
  if (event.type === "step-done") {
    const index = Number(event.index || 0) + 1;
    setRoutineRunStatus(event.skipped ? `${index}단계 건너뜀` : `${index}단계 완료`, event.skipped ? "countdown" : "recording");
    return;
  }
  if (event.type === "final") {
    clearRoutineApproval();
    setRoutineExecutionBusy(false);
    if (event.canceled) {
      setRoutineRunStatus(`실행 중지됨 · ${event.cyclesCompleted || 0}회차 완료`, "idle");
      addRoutineMessage(`루틴 실행을 중지했습니다. 전체 회차 ${event.cyclesCompleted || 0}회, 동작 완료 ${event.executed || 0}개, 건너뜀 ${event.skipped || 0}개입니다.`);
      return;
    }
    setRoutineRunStatus(`실행 완료 · ${event.cyclesCompleted || 0}회차`, "done");
    const outputFiles = Array.isArray(event.outputFiles) ? event.outputFiles : [];
    const outputText = outputFiles.length ? ` 스크린샷/결과 파일 ${outputFiles.length}개도 저장했습니다.` : "";
    addRoutineMessage(`루틴 실행이 끝났습니다. 전체 회차 ${event.cyclesCompleted || 0}회, 동작 완료 ${event.executed || 0}개, 건너뜀 ${event.skipped || 0}개입니다.${outputText}`);
    return;
  }
  if (event.type === "error") {
    clearRoutineApproval();
    setRoutineExecutionBusy(false);
    setRoutineRunStatus(event.message || "실행 중 오류가 발생했습니다.", "error");
    addRoutineMessage(`루틴 실행 중 문제가 생겼습니다. ${event.message || "오류 내용을 확인해 주세요."}`);
  }
}

function insertTextIntoComposer(text) {
  input.textContent = text;
  input.focus({ preventScroll: true });
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(input);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

function routineFileNameSeed() {
  const task = routineAutoTaskInput?.value.trim() || "";
  const repeat = routineRepeatInput?.value.trim() || "";
  const firstStep = routineSteps[0] ? actionLabel(routineSteps[0].action) : "";
  return task || repeat || firstStep || "김루틴 루틴";
}

async function saveRoutineFile() {
  if (!isRoutineOfficer()) return;
  if (!routineSteps.length) {
    setRoutineRunStatus("저장할 루틴 단계가 없습니다.", "error");
    return;
  }
  if (!window.desktopAPI?.saveRoutineFile) {
    setRoutineRunStatus("데스크톱 실행 환경에서만 저장할 수 있습니다.", "error");
    return;
  }

  try {
    const result = await window.desktopAPI.saveRoutineFile({
      name: routineFileNameSeed(),
      options: currentRoutineOptions(),
      steps: routineSteps.map((step) => ({ ...step })),
    });
    if (result?.canceled) return;
    if (!result?.ok) {
      setRoutineRunStatus(result?.error || "루틴을 저장하지 못했습니다.", "error");
      return;
    }
    setRoutineRunStatus(`저장 완료 · ${result.fileName || "루틴 파일"}`, "done");
  } catch (error) {
    setRoutineRunStatus(error?.message || "루틴을 저장하지 못했습니다.", "error");
  }
}

function applyLoadedRoutine(routine) {
  const options = routine?.options || {};
  const loadedSteps = Array.isArray(routine?.steps) ? routine.steps.map(normalizeRecordedStep).slice(0, 30) : [];
  if (!loadedSteps.length) return false;

  routineSteps = loadedSteps;
  routineEditingStepId = null;
  if (routineOutputInput && options.output) routineOutputInput.value = options.output;
  if (routineRiskInput && options.risk) routineRiskInput.value = options.risk;
  if (routineRepeatInput) routineRepeatInput.value = options.repeat || "";
  if (routineStopInput) routineStopInput.value = options.stop || "";
  if (routineWindowTitleInput) routineWindowTitleInput.value = options.windowTitle || "";
  if (routineAutoModeInput && options.autoMode) routineAutoModeInput.value = options.autoMode;
  if (routineAutoTaskInput) routineAutoTaskInput.value = options.autoTask || "";
  if (routineAutoRepeatInput) routineAutoRepeatInput.value = options.autoRepeat || "";
  if (routineAutoCautionInput) routineAutoCautionInput.value = options.autoCaution || "";
  if (routineRunRepeatInput) routineRunRepeatInput.value = String(Math.min(999, Math.max(1, Math.round(Number(options.repeatCount || 1)) || 1)));
  if (routineRunForeverInput) routineRunForeverInput.checked = options.repeatForever === true;
  syncRoutineRepeatControls();
  switchRoutineTab("direct");
  renderRoutineSteps();
  return true;
}

async function loadRoutineFile() {
  if (!isRoutineOfficer()) return;
  if (!window.desktopAPI?.loadRoutineFile) {
    setRoutineRunStatus("데스크톱 실행 환경에서만 불러올 수 있습니다.", "error");
    return;
  }

  try {
    const result = await window.desktopAPI.loadRoutineFile();
    if (result?.canceled) return;
    if (!result?.ok || !applyLoadedRoutine(result.routine)) {
      setRoutineRunStatus(result?.error || "루틴을 불러오지 못했습니다.", "error");
      return;
    }
    setRoutineRunStatus(`불러오기 완료 · ${result.fileName || "루틴 파일"}`, "done");
  } catch (error) {
    setRoutineRunStatus(error?.message || "루틴을 불러오지 못했습니다.", "error");
  }
}

function currentRoutineOptions() {
  if (!isRoutineOfficer()) return {};
  return {
    activeTab: routineActiveTab,
    output: routineOutputInput?.value || "자동화 설정표",
    risk: routineRiskInput?.value || "읽기/조회만",
    repeat: routineRepeatInput?.value.trim() || "",
    stop: routineStopInput?.value.trim() || "",
    windowTitle: routineWindowTitleInput?.value.trim() || "",
    autoMode: routineAutoModeInput?.value || "record",
    autoTask: routineAutoTaskInput?.value.trim() || "",
    autoRepeat: routineAutoRepeatInput?.value.trim() || "",
    autoCaution: routineAutoCautionInput?.value.trim() || "",
    repeatCount: routineRunRepeatCount(),
    repeatForever: routineRunRepeatsForever(),
    cursor: routineCursor ? { ...routineCursor } : null,
    steps: routineSteps.map((step) => ({ ...step })),
  };
}

function routineBriefLines(options = currentRoutineOptions()) {
  const lines = [];
  if (options.activeTab === "auto") {
    return routineAutoLines();
  }
  if (options.output) lines.push(`- 산출: ${options.output}`);
  if (options.risk) lines.push(`- 권한: ${options.risk}`);
  if (options.windowTitle) lines.push(`- 대상창: ${options.windowTitle}`);
  if (options.repeat) lines.push(`- 반복: ${options.repeat}`);
  if (options.repeatForever) lines.push("- 전체 실행: 중지할 때까지 무한 반복");
  else if (Number(options.repeatCount || 1) > 1) lines.push(`- 전체 실행: ${Number(options.repeatCount)}회`);
  if (options.stop) lines.push(`- 중지조건: ${options.stop}`);
  const steps = Array.isArray(options.steps) ? options.steps : [];
  if (steps.length) {
    lines.push("- 단계:");
    steps.slice(0, 30).forEach((step, index) => {
      lines.push(`  ${index + 1}. ${routineStepText(step)}`);
    });
  }
  return lines;
}

function buildRoutineInstructionText(baseText, routineOptions) {
  if (!isRoutineOfficer()) return baseText;
  const lines = routineBriefLines(routineOptions);
  if (!lines.length) return baseText;
  return [baseText, "자동화 설정 조건:", ...lines].filter(Boolean).join("\n");
}

function insertRoutineBrief() {
  if (!isRoutineOfficer()) return;
  const lines = routineBriefLines();
  const brief = ["반복업무 자동화 세팅을 잡아줘.", "자동화 설정 조건:", ...lines].join("\n");
  insertTextIntoComposer(brief);
}

function actionLabel(action) {
  const labels = {
    moveTo: "마우스 이동",
    click: "클릭",
    doubleClick: "더블클릭",
    rightClick: "우클릭",
    middleClick: "휠클릭",
    dragTo: "드래그",
    dragRel: "상대 드래그",
    mouseDown: "누른 상태",
    mouseUp: "놓기",
    typeText: "좌표에 입력",
    pasteText: "클립보드 붙여넣기",
    setClipboard: "클립보드 설정",
    pressKey: "키 누르기",
    wait: "대기",
    hotkey: "단축키",
    keyDown: "키 누른 상태",
    keyUp: "키 놓기",
    scroll: "스크롤",
    horizontalScroll: "가로 스크롤",
    waitImage: "이미지 대기",
    clickImage: "이미지 찾아 클릭",
    locateImage: "이미지 위치 찾기",
    waitText: "텍스트/OCR 대기",
    pixelCheck: "픽셀 색 확인",
    colorWait: "픽셀 색 대기",
    screenshot: "스크린샷 저장",
    focusWindow: "창 활성화",
    openApp: "프로그램 열기",
    openFile: "파일 열기",
    runCommand: "명령 실행",
    closeWindow: "창 닫기",
    checkpoint: "확인 지점",
    confirm: "사용자 승인",
    loopStart: "반복 시작",
    loopEnd: "반복 끝",
    ifImage: "이미지 조건",
    ifText: "텍스트 조건",
    errorStop: "오류 시 중지",
  };
  return labels[action] || action || "동작";
}

function routineStepText(step) {
  const parts = [actionLabel(step.action)];
  const coordinateActions = new Set(["moveTo", "click", "doubleClick", "rightClick", "middleClick", "dragTo", "dragRel", "mouseDown", "mouseUp", "typeText", "pixelCheck", "colorWait", "screenshot"]);
  const valueFirstActions = new Set(["hotkey", "pressKey", "keyDown", "keyUp", "pasteText", "setClipboard", "waitImage", "clickImage", "locateImage", "waitText", "focusWindow", "openApp", "openFile", "runCommand", "checkpoint", "confirm", "loopStart", "ifImage", "ifText", "errorStop"]);
  if (coordinateActions.has(step.action) && Number.isFinite(step.x) && Number.isFinite(step.y)) {
    parts.push(`좌표 x ${step.x}, y ${step.y}`);
  }
  if (["dragTo", "dragRel"].includes(step.action) && Number.isFinite(step.x2) && Number.isFinite(step.y2)) {
    parts.push(step.action === "dragRel" ? `상대 x ${step.x2}, y ${step.y2}` : `끝 x ${step.x2}, y ${step.y2}`);
  }
  if (["wait", "waitImage", "clickImage", "locateImage", "waitText", "colorWait"].includes(step.action) && Number.isFinite(step.waitSeconds)) {
    parts.push(`${step.waitSeconds}초`);
  }
  if (Number.isFinite(step.durationSeconds) && step.durationSeconds > 0 && ["moveTo", "dragTo", "dragRel", "typeText", "scroll", "horizontalScroll"].includes(step.action)) {
    parts.push(`속도 ${step.durationSeconds}초`);
  }
  if (step.action === "scroll" && step.value) parts.push(`세로 ${step.value}`);
  if (step.action === "horizontalScroll" && step.value) parts.push(`가로 ${step.value}`);
  if (step.action === "typeText" && step.value) parts.push(`입력 "${step.value}"`);
  if (valueFirstActions.has(step.action) && step.value) {
    parts.push(step.value);
  }
  if (step.repeat > 1) parts.push(`${step.repeat}회 반복`);
  if (step.windowTitle) parts.push(`창 "${step.windowTitle}"`);
  if (Number.isFinite(step.delayBefore) && step.delayBefore > 0.1) parts.push(`전 대기 ${step.delayBefore}초`);
  return parts.join(" · ");
}

function readNumberInput(element, fallback = null) {
  if (!element || String(element.value || "").trim() === "") return fallback;
  const value = Number(element?.value);
  return Number.isFinite(value) ? value : fallback;
}

function readRoutineStepForm() {
  const action = routineActionTypeInput?.value || "click";
  const x = Math.round(readNumberInput(routineXInput, routineCursor?.x ?? 0));
  const y = Math.round(readNumberInput(routineYInput, routineCursor?.y ?? 0));
  const x2 = Math.round(readNumberInput(routineX2Input, 0));
  const y2 = Math.round(readNumberInput(routineY2Input, 0));
  const repeat = Math.min(50, Math.max(1, Math.round(readNumberInput(routineStepRepeatInput, 1))));
  const waitSeconds = Math.min(600, Math.max(0, Number(readNumberInput(routineWaitSecondsInput, 1) || 0)));
  const durationSeconds = Math.min(60, Math.max(0, Number(readNumberInput(routineDurationSecondsInput, 0.2) || 0)));
  return {
    id: `step-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    action,
    x,
    y,
    x2,
    y2,
    waitSeconds: Math.round(waitSeconds * 10) / 10,
    durationSeconds: Math.round(durationSeconds * 10) / 10,
    value: String(routineStepValueInput?.value || "").trim().slice(0, 500),
    repeat,
    windowTitle: String(routineWindowTitleInput?.value || "").trim().slice(0, 120),
  };
}

function setRoutineInputValue(element, value) {
  if (!element) return;
  element.value = value === undefined || value === null ? "" : String(value);
}

function loadRoutineStepIntoForm(step) {
  if (!step) return;
  if (routineActionTypeInput) routineActionTypeInput.value = step.action || "click";
  setRoutineInputValue(routineStepRepeatInput, step.repeat || 1);
  setRoutineInputValue(routineXInput, Number.isFinite(Number(step.x)) ? Math.round(Number(step.x)) : "");
  setRoutineInputValue(routineYInput, Number.isFinite(Number(step.y)) ? Math.round(Number(step.y)) : "");
  setRoutineInputValue(routineX2Input, Number.isFinite(Number(step.x2)) ? Math.round(Number(step.x2)) : "");
  setRoutineInputValue(routineY2Input, Number.isFinite(Number(step.y2)) ? Math.round(Number(step.y2)) : "");
  setRoutineInputValue(routineWaitSecondsInput, Number.isFinite(Number(step.waitSeconds)) ? step.waitSeconds : 1);
  setRoutineInputValue(routineDurationSecondsInput, Number.isFinite(Number(step.durationSeconds)) ? step.durationSeconds : 0.2);
  setRoutineInputValue(routineStepValueInput, step.value || "");
  setRoutineInputValue(routineWindowTitleInput, step.windowTitle || "");
}

function updateRoutineEditButtonState() {
  if (routineUpdateStepButton) routineUpdateStepButton.disabled = !routineEditingStepId;
}

function selectRoutineStep(stepId) {
  const step = routineSteps.find((item) => item.id === stepId);
  if (!step) return;
  routineEditingStepId = step.id;
  loadRoutineStepIntoForm(step);
  renderRoutineSteps();
}

function updateRoutineStepFromForm() {
  if (!isRoutineOfficer() || !routineEditingStepId) return;
  const index = routineSteps.findIndex((step) => step.id === routineEditingStepId);
  if (index < 0) {
    routineEditingStepId = null;
    renderRoutineSteps();
    return;
  }
  const previous = routineSteps[index];
  const next = {
    ...previous,
    ...readRoutineStepForm(),
    id: previous.id,
  };
  [
    [routineXInput, "x"],
    [routineYInput, "y"],
    [routineX2Input, "x2"],
    [routineY2Input, "y2"],
  ].forEach(([inputElement, key]) => {
    if (inputElement && String(inputElement.value || "").trim() === "") {
      delete next[key];
    }
  });
  routineSteps = routineSteps.map((step, stepIndex) => (stepIndex === index ? next : step));
  renderRoutineSteps();
}

function addRoutineStepFromForm() {
  if (!isRoutineOfficer()) return;
  const nextStep = readRoutineStepForm();
  routineSteps = [...routineSteps, nextStep].slice(0, 30);
  routineEditingStepId = nextStep.id;
  renderRoutineSteps();
}

function clearRoutineSteps() {
  routineSteps = [];
  routineEditingStepId = null;
  renderRoutineSteps();
}

function handleRoutineStepListClick(event) {
  const removeButton = event.target.closest("[data-remove-routine-step]");
  if (removeButton) {
    const removedId = removeButton.dataset.removeRoutineStep;
    routineSteps = routineSteps.filter((step) => step.id !== removedId);
    if (routineEditingStepId === removedId) routineEditingStepId = null;
    renderRoutineSteps();
    return;
  }
  const row = event.target.closest("[data-routine-step-id]");
  if (!row) return;
  selectRoutineStep(row.dataset.routineStepId);
}

function handleRoutineStepListKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") return;
  const row = event.target.closest("[data-routine-step-id]");
  if (!row) return;
  event.preventDefault();
  selectRoutineStep(row.dataset.routineStepId);
}

function clampRoutineEditingStep() {
  if (!routineEditingStepId) return;
  if (!routineSteps.some((step) => step.id === routineEditingStepId)) {
    routineEditingStepId = null;
  }
}

function routineStepTitle(step, index) {
  const suffix = ROUTINE_DESIGN_ONLY_ACTIONS.has(step?.action) ? " · 설계 전용, 현재 실행 안 됨" : "";
  return `${index + 1}단계 선택해서 수정${suffix}`;
}

function routineStepRowClass(step) {
  const classes = ["routine-step-row"];
  if (step.id === routineEditingStepId) classes.push("is-selected");
  if (ROUTINE_DESIGN_ONLY_ACTIONS.has(step?.action)) classes.push("is-design-only");
  return classes.join(" ");
}

function routineStepTabIndex() {
  return 0;
}

function routineStepAriaPressed(step) {
  return String(step.id === routineEditingStepId);
}

function routineStepDataId(step) {
  return escapeHtml(step.id);
}

function renderRoutineEmptySteps() {
  routineStepList.innerHTML = `<div class="routine-step-empty">단계를 추가하면 여기 쌓입니다.</div>`;
  updateRoutineEditButtonState();
  createIcons();
}

function renderRoutineStepRows() {
  routineStepList.innerHTML = routineSteps
    .map(
      (step, index) => `
        <article class="${routineStepRowClass(step)}" data-routine-step-id="${routineStepDataId(step)}" role="button" tabindex="${routineStepTabIndex()}" aria-pressed="${routineStepAriaPressed(step)}" title="${escapeHtml(routineStepTitle(step, index))}">
          <span>${index + 1}</span>
          <div>
            <strong>${escapeHtml(actionLabel(step.action))}</strong>
            ${ROUTINE_DESIGN_ONLY_ACTIONS.has(step?.action) ? '<small class="routine-design-only-label">설계 전용 · 실행 안 됨</small>' : ""}
            <p>${escapeHtml(routineStepText(step))}</p>
          </div>
          <button class="icon-button" type="button" data-remove-routine-step="${escapeHtml(step.id)}" aria-label="단계 삭제">
            <i data-lucide="x"></i>
          </button>
        </article>
      `
    )
    .join("");
  updateRoutineEditButtonState();
}

function renderRoutineSteps() {
  if (!routineStepList) return;
  clampRoutineEditingStep();
  if (!routineSteps.length) {
    renderRoutineEmptySteps();
    updateRoutineRunButtonAvailability();
    return;
  }
  renderRoutineStepRows();
  updateRoutineRunButtonAvailability();
  createIcons();
}

async function captureRoutineCursorNow() {
  if (window.desktopAPI?.getCursorPosition) {
    try {
      const point = await window.desktopAPI.getCursorPosition();
      routineCursor = {
        x: Number(point?.x || 0),
        y: Number(point?.y || 0),
        displayId: Number(point?.displayId || 0),
        scaleFactor: Number(point?.scaleFactor || 1),
      };
    } catch (_error) {
      // Keep the last live cursor if the one-shot read fails.
    }
  }
  if (!routineCursor) return;
  if (routineXInput) routineXInput.value = String(routineCursor.x);
  if (routineYInput) routineYInput.value = String(routineCursor.y);
}

function setRoutineCaptureButtonLabel(value, disabled = false) {
  if (routineCaptureLabel) routineCaptureLabel.textContent = value;
  if (routineCaptureButton) routineCaptureButton.disabled = disabled;
}

function cancelRoutineCaptureTimers() {
  if (routineCaptureTimer) {
    window.clearTimeout(routineCaptureTimer);
    routineCaptureTimer = null;
  }
  if (routineCaptureCountdownTimer) {
    window.clearInterval(routineCaptureCountdownTimer);
    routineCaptureCountdownTimer = null;
  }
}

function captureRoutineCursor() {
  if (!isRoutineOfficer()) return;
  cancelRoutineCaptureTimers();
  const delay = Math.min(30, Math.max(0.5, Number(readNumberInput(routineCaptureDelayInput, 3) || 3)));
  let remaining = Math.ceil(delay * 10);
  setRoutineCaptureButtonLabel(`${(remaining / 10).toFixed(1)}초`, true);
  routineCaptureCountdownTimer = window.setInterval(() => {
    remaining -= 1;
    if (remaining <= 0) return;
    setRoutineCaptureButtonLabel(`${(remaining / 10).toFixed(1)}초`, true);
  }, 100);
  routineCaptureTimer = window.setTimeout(async () => {
    cancelRoutineCaptureTimers();
    await captureRoutineCursorNow();
    setRoutineCaptureButtonLabel("지연 캡처", false);
  }, delay * 1000);
}

async function refreshRoutineCursor() {
  if (!isRoutineOfficer() || !window.desktopAPI?.getCursorPosition) return;
  try {
    const point = await window.desktopAPI.getCursorPosition();
    routineCursor = {
      x: Number(point?.x || 0),
      y: Number(point?.y || 0),
      displayId: Number(point?.displayId || 0),
      scaleFactor: Number(point?.scaleFactor || 1),
    };
    if (routineLivePoint) {
      routineLivePoint.textContent = `x ${routineCursor.x}, y ${routineCursor.y}`;
      routineLivePoint.title = `display ${routineCursor.displayId}, scale ${routineCursor.scaleFactor}`;
    }
  } catch (_error) {
    if (routineLivePoint) routineLivePoint.textContent = "좌표 확인 불가";
  }
}

function startRoutineCursorPolling() {
  if (routineCursorTimer) return;
  refreshRoutineCursor();
  routineCursorTimer = window.setInterval(refreshRoutineCursor, 160);
}

async function sendPrivacyScanMessage(text) {
  if (!isPrivacyOfficer()) return;
  const scanText = (text || "").trim();
  const filesToInspect = pendingFiles.map((file) => ({ ...file }));
  if (!scanText && !filesToInspect.length) return;

  isSending = true;
  sendButton.disabled = true;
  if (attachButton) attachButton.disabled = true;
  setPrivacyBusy(true);

  const requestLabel = scanText
    ? `채팅 입력 텍스트 검사 요청 (${scanText.length.toLocaleString("ko-KR")}자)`
    : defaultMessageText();
  const myMessage = { from: "me", time: currentTime(), text: requestLabel, unreadCount: 1 };
  if (filesToInspect.length) myMessage.attachments = filesToInspect.map(publicFileInfo);
  messages.push(myMessage);
  persistMessages();
  input.textContent = "";
  pendingFiles = [];
  renderPendingFiles();
  renderMessages();

  await wait(250);
  delete myMessage.unreadCount;
  persistMessages();
  renderMessages();

  try {
    if (filesToInspect.length) {
      await inspectPrivacyFiles(filesToInspect);
    }
    if (!scanText) return;
    if (!window.desktopAPI?.scanPrivacyText) {
      throw new Error("데스크톱 앱 실행 환경에서만 개인정보 검사를 사용할 수 있습니다.");
    }
    setPrivacyStatus("채팅 입력을 개인정보 검사로 처리하는 중입니다.", "working");
    const result = await window.desktopAPI.scanPrivacyText({ text: scanText });
    if (!result?.ok) {
      const errorText = result?.error || "채팅 입력 검사 중 오류가 났습니다.";
      appendPrivacyMessage(errorText, true);
      setPrivacyStatus(errorText, "error");
      return;
    }
    privacyResults = [buildPrivacyTextResult("채팅 입력 텍스트", "chat-input", scanText, result, {
      risk: "채팅 입력에서 개인정보 후보를 찾았습니다. LLM으로 보내기 전에 마스킹하거나 삭제하세요.",
      clean: "채팅 입력에서는 확정형 개인정보 패턴이 보이지 않습니다.",
    })];
    renderPrivacyResults();
    appendPrivacyMessage(formatPrivacyResultMessage(privacyResults));
    setPrivacyStatus(`채팅 입력 검사 완료 · 개인정보 후보 ${result.findings?.length || 0}건`, result.findings?.length ? "error" : "done");
  } catch (error) {
    const errorText = `개인정보 검사 중 오류가 났습니다.\n${error?.message || error}`;
    appendPrivacyMessage(errorText, true);
    setPrivacyStatus(error?.message || String(error), "error");
  } finally {
    isSending = false;
    setPrivacyBusy(false);
    sendButton.disabled = false;
    if (attachButton) attachButton.disabled = false;
    renderMessages();
  }
}

function defaultMessageText() {
  if (contact.id === "graph-officer") return "첨부한 파일을 그래프로 만들어줘";
  if (isPresentationOfficer()) return "첨부한 자료를 웹 발표자료로 구성해줘";
  if (isImageOfficer()) return "이미지를 생성해줘";
  if (isSttOfficer()) return "녹음 내용을 받아쓰고 정리해줘";
  if (isRoutineOfficer()) return "반복업무 자동화 세팅을 잡아줘";
  if (isConverterOfficer()) return "파일 변환 방법을 정리해줘";
  if (isPrivacyOfficer()) return "열려 있는 창과 문서에서 개인정보를 검사해줘";
  if (isDocumentResourceOfficer()) return "문서 안의 자원을 로컬에서 찾아줘";
  return "파일을 첨부했습니다.";
}

async function requestAssistantReply(userText, files = [], graphOptions = {}, presentationOptions = {}, routineOptions = {}) {
  if (!window.desktopAPI?.sendOfficerMessage) {
    return {
      ok: false,
      text: "데스크톱 앱 실행 환경에서만 로컬 LLM 호출을 사용할 수 있습니다.",
    };
  }

  return window.desktopAPI.sendOfficerMessage({
    contact,
    contextLevel: currentContextLevel,
    files,
    graphOptions,
    presentationOptions,
    routineOptions,
    history: messages.slice(0, -1),
    userText,
  });
}

async function sendMessage() {
  if (isSending) return;
  const typedText = input.innerText.trim();
  const graphOptions = currentGraphOptions();
  const presentationOptions = currentPresentationOptions();
  const routineOptions = currentRoutineOptions();
  if (!typedText && !pendingFiles.length) return;
  if (isPrivacyOfficer() && privacyMode === "scan") {
    await sendPrivacyScanMessage(typedText);
    return;
  }
  const baseText = typedText || defaultMessageText();
  const toolText = buildPresentationInstructionText(buildGraphInstructionText(baseText, graphOptions), presentationOptions);
  const text = isRoutineOfficer() ? baseText : buildRoutineInstructionText(toolText, routineOptions);
  const filesForPayload = isDocumentResourceOfficer()
    ? []
    : (isConverterOfficer() ? converterFiles : pendingFiles).map((file) => ({ ...file }));
  const filesForMessage = (isConverterOfficer() ? pendingFiles : filesForPayload).map(publicFileInfo);
  isSending = true;
  setReplyPending(true);
  sendButton.disabled = true;
  if (attachButton) attachButton.disabled = true;
  const myMessage = { from: "me", time: currentTime(), text, unreadCount: 1 };
  if (filesForMessage.length) myMessage.attachments = filesForMessage;
  messages.push(myMessage);
  persistMessages();
  input.textContent = "";
  pendingFiles = [];
  renderPendingFiles();
  renderMessages();

  await wait(400);
  delete myMessage.unreadCount;
  persistMessages();
  renderMessages();

  const typingRow = document.querySelector("#typingRow");
  typingRow.hidden = false;
  stream.scrollTop = stream.scrollHeight;
  let replyMessageForNotification = null;

  try {
    const reply = await requestAssistantReply(text, filesForPayload, graphOptions, presentationOptions, routineOptions);
    if (reply.chart && !reply.chart.id) {
      reply.chart.id = `chart-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    if (reply.presentation && !reply.presentation.id) {
      reply.presentation.id = `ppt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    if (reply.image && !reply.image.id) {
      reply.image.id = `image-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    }
    if (Array.isArray(reply.actions)) {
      reply.actions = reply.actions.map((action) => ({
        ...action,
        id: action.id || `action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      }));
      const imageAction = reply.actions.find((action) => action.type === "image-confirm-generate");
      if (imageAction) updateImagePanelFromDraft(reply.text, imageAction.payload);
    }
    const replyMessage = {
      from: "them",
      time: currentTime(),
      text: reply.text,
      error: !reply.ok,
      ...(reply.chart ? { chart: reply.chart } : {}),
      ...(reply.presentation ? { presentation: reply.presentation } : {}),
      ...(reply.image ? { image: reply.image } : {}),
      ...(reply.actions?.length ? { actions: reply.actions } : {}),
    };
    messages.push(replyMessage);
    replyMessageForNotification = replyMessage;
    persistMessages();
  } catch (error) {
    const errorMessage = {
      from: "them",
      time: currentTime(),
      text: `로컬 LLM 호출 중 오류가 발생했습니다.\n${error?.message || error}`,
      error: true,
    };
    messages.push(errorMessage);
    replyMessageForNotification = errorMessage;
    persistMessages();
  } finally {
    isSending = false;
    setReplyPending(false);
    sendButton.disabled = false;
    if (attachButton) attachButton.disabled = false;
    notifyReplyComplete(replyMessageForNotification);
    renderMessages();
  }
}

function currentTime() {
  const now = new Date();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const period = hours < 12 ? "오전" : "오후";
  const hour = hours % 12 || 12;
  return `${period} ${hour}:${minutes}`;
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

function openProfile(id) {
  if (!id) return;
  if (window.desktopAPI?.openProfile) {
    window.desktopAPI.openProfile(id);
  }
}

function bindOpenProfiles() {
  document.querySelectorAll("[data-open-profile]").forEach((avatar) => {
    if (avatar.dataset.profileBound === "true") return;
    avatar.dataset.profileBound = "true";
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

sendButton.addEventListener("click", sendMessage);
attachButton?.addEventListener("click", () => {
  if (isDocumentResourceOfficer()) {
    void selectDocumentResourceFile();
    return;
  }
  void selectFilesForChat();
});
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
document.addEventListener("click", (event) => {
  closeContextMenu();
  if (!infoPopover || infoPopover.hidden) return;
  const button = document.querySelector("#infoButton");
  if (infoPopover.contains(event.target) || button?.contains(event.target)) return;
  setInfoOpen(false);
});
const disposeLocalModelChanged = window.desktopAPI?.onLocalModelChanged?.(handleChatLocalModelChanged);
window.addEventListener("keydown", closeWindowOnEscape, true);
document.addEventListener("keydown", closeWindowOnEscape, true);
window.addEventListener("beforeunload", () => {
  if (typeof disposeLocalModelChanged === "function") disposeLocalModelChanged();
  if (typeof disposeSttInstallProgress === "function") disposeSttInstallProgress();
  if (typeof disposeDocumentResourceProgress === "function") disposeDocumentResourceProgress();
  if (isDocumentResourceOfficer() && isDocumentResourceBusy) window.desktopAPI?.cancelDocumentResourceJob?.();
  if (isDocumentResourceOfficer() && documentResourceSessionId) {
    window.desktopAPI?.clearDocumentResourceSession?.({ sessionId: documentResourceSessionId });
  }
  if (routineCursorTimer) window.clearInterval(routineCursorTimer);
  cancelRoutineCaptureTimers();
  if (disposeRoutineRecordingEvent) disposeRoutineRecordingEvent();
  if (disposeRoutineExecutionEvent) disposeRoutineExecutionEvent();
  if (typeof disposeSeries4Progress === "function") disposeSeries4Progress();
  if (disposeFrustrationExecutionEvent) disposeFrustrationExecutionEvent();
  if (disposeFrustrationWebInputEvent) disposeFrustrationWebInputEvent();
  if (isRoutineRecording) window.desktopAPI?.stopRoutineRecording?.();
  if (isRoutineExecuting) window.desktopAPI?.stopRoutineExecution?.();
  if (isFrustrationOfficer() && isFrustrationExecuting) window.desktopAPI?.stopFrustrationWebInput?.();
  if (isSttWhisperActive) window.desktopAPI?.cancelSpeechTranscription?.();
  cleanupSttRecorder();
});

renderTopbar();
void refreshOfficerRuntimeStatus();
void loadChatAppSettings();
setupGraphControls();
setupPresentationControls();
setupImagePanel();
setupSttPanel();
setupDocumentResourcePanel();
setupConverterPanel();
setupFrustrationPanel();
setupPrivacyPanel();
setupRoutinePanel();
loadSessionMessages();
renderInfoPopover();
bindWindowControls();
createIcons();
