(function () {
  "use strict";

  const contacts = Array.isArray(window.HEYU_DEMO_CONTACTS) ? window.HEYU_DEMO_CONTACTS : [];
  const scenarios = Array.isArray(window.HEYU_DEMO_SCENARIOS) ? window.HEYU_DEMO_SCENARIOS : [];
  const filters = ["전체", ...new Set(scenarios.map((scenario) => scenario.group))];
  const friendTabDefs = [
    ["all", "전체"], ["business", "업무지원"], ["technical", "기술지원"], ["favorites", "즐겨찾기"],
  ];
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const elements = {
    filterRow: document.getElementById("filterRow"), scenarioList: document.getElementById("scenarioList"),
    friendsWindow: document.getElementById("friendsWindow"), chatWindow: document.getElementById("chatWindow"),
    chatWorkspace: document.getElementById("chatWorkspace"), friendSearch: document.getElementById("friendSearch"),
    friendTabs: document.getElementById("friendTabs"), friendList: document.getElementById("friendList"),
    friendOpenHint: document.getElementById("friendOpenHint"), openSelectedChat: document.getElementById("openSelectedChat"),
    backToFriends: document.getElementById("backToFriends"), contactAvatar: document.getElementById("contactAvatar"),
    messengerHeading: document.getElementById("messengerHeading"), contactRole: document.getElementById("contactRole"),
    chatPresence: document.getElementById("chatPresence"), chatWindowTitle: document.getElementById("chatWindowTitle"),
    chatFeed: document.getElementById("chatFeed"), composerHint: document.getElementById("composerHint"),
    sendDemoButton: document.getElementById("sendDemoButton"), simulationCaption: document.getElementById("simulationCaption"),
    infoButton: document.getElementById("infoButton"), infoPopover: document.getElementById("infoPopover"),
    infoName: document.getElementById("infoName"), infoSummary: document.getElementById("infoSummary"),
    readyButton: document.getElementById("readyButton"), toolPanel: document.getElementById("toolPanel"),
    demoToast: document.getElementById("demoToast"),
  };

  let activeFilter = "전체";
  let activeScenarioId = scenarios[0]?.id || "";
  let friendTab = "all";
  let selectedContactId = scenarios[0]?.contactId || contacts[0]?.id || "";
  let currentContactId = "";
  let playbackTimers = [];
  let toolTimers = [];
  let typingRow = null;
  let toastTimer = null;

  function createElement(tagName, className, text) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function createButton(text, className, handler) {
    const button = createElement("button", className, text);
    button.type = "button";
    if (handler) button.addEventListener("click", handler);
    return button;
  }

  function activeScenario() {
    return scenarios.find((scenario) => scenario.id === activeScenarioId) || scenarios[0];
  }

  function contactById(contactId) {
    return contacts.find((contact) => contact.id === contactId);
  }

  function firstScenarioForContact(contactId) {
    return scenarios.find((scenario) => scenario.contactId === contactId);
  }

  function clearPlayback() {
    playbackTimers.forEach((timer) => window.clearTimeout(timer));
    playbackTimers = [];
    typingRow = null;
    elements.chatFeed.setAttribute("aria-busy", "false");
  }

  function clearToolTimers() {
    toolTimers.forEach((timer) => window.clearTimeout(timer));
    toolTimers = [];
  }

  function schedule(callback, delay) {
    if (reducedMotion) { callback(); return; }
    playbackTimers.push(window.setTimeout(callback, delay));
  }

  function scheduleTool(callback, delay) {
    if (reducedMotion) { callback(); return; }
    toolTimers.push(window.setTimeout(callback, delay));
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    elements.demoToast.textContent = message;
    elements.demoToast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => elements.demoToast.classList.remove("is-visible"), reducedMotion ? 10 : 1900);
  }

  function renderFilters() {
    elements.filterRow.replaceChildren();
    filters.forEach((filter) => {
      const button = createButton(filter, "filter-button", () => {
        activeFilter = filter;
        renderFilters();
        renderScenarioList();
      });
      button.dataset.filter = filter;
      button.setAttribute("aria-pressed", String(filter === activeFilter));
      elements.filterRow.appendChild(button);
    });
  }

  function renderScenarioList() {
    const visible = scenarios.filter((scenario) => activeFilter === "전체" || scenario.group === activeFilter);
    elements.scenarioList.replaceChildren();
    visible.forEach((scenario) => {
      const button = createButton("", "scenario-button", () => selectScenario(scenario.id));
      button.dataset.scenarioId = scenario.id;
      button.setAttribute("aria-pressed", String(scenario.id === activeScenarioId));
      button.setAttribute("aria-label", `${scenario.officer} 데모 질문: ${scenario.title}`);
      const avatar = createElement("img");
      avatar.alt = "";
      avatar.loading = "lazy";
      avatar.decoding = "async";
      avatar.src = scenario.avatar;
      const copy = createElement("span", "scenario-copy");
      copy.append(createElement("span", "", `${scenario.officer} · ${scenario.role}`), createElement("strong", "", scenario.title));
      button.append(avatar, copy, createElement("span", "scenario-arrow", "›"));
      elements.scenarioList.appendChild(button);
    });
  }

  function selectScenario(scenarioId) {
    const scenario = scenarios.find((item) => item.id === scenarioId);
    if (!scenario) return;
    clearPlayback();
    clearToolTimers();
    activeScenarioId = scenario.id;
    selectedContactId = scenario.contactId;
    friendTab = "all";
    elements.friendSearch.value = "";
    if (!elements.chatWindow.hidden) closeChat(false);
    renderFilters();
    renderScenarioList();
    renderFriendTabs();
    renderFriendList();
    updateOpenHint();
    elements.simulationCaption.textContent = `${scenario.officer} 담당자를 친구 목록에서 강조했습니다. 행을 더블클릭하거나 채팅 열기를 누르세요.`;
    window.requestAnimationFrame(() => {
      document.querySelector(`[data-contact-id="${scenario.contactId}"]`)?.scrollIntoView({ block: "nearest" });
    });
  }

  function renderFriendTabs() {
    elements.friendTabs.replaceChildren();
    friendTabDefs.forEach(([id, label]) => {
      const button = createButton(label, "friend-tab", () => {
        friendTab = id;
        elements.friendSearch.value = "";
        renderFriendTabs();
        renderFriendList();
      });
      button.dataset.friendTab = id;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", String(friendTab === id));
      elements.friendTabs.appendChild(button);
    });
  }

  function filteredContacts() {
    const query = elements.friendSearch.value.trim().toLowerCase();
    return contacts.filter((contact) => {
      const haystack = `${contact.name} ${contact.role} ${contact.tag} ${contact.group === "business" ? "업무지원" : "기술지원"}`.toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (friendTab === "business") return contact.group === "business";
      if (friendTab === "technical") return contact.group === "technical";
      if (friendTab === "favorites") return contact.favorite;
      return true;
    });
  }

  function createPersonRow(contact) {
    const row = createElement("article", "person-row");
    row.dataset.contactId = contact.id;
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    row.setAttribute("aria-label", `${contact.name}, ${contact.role}. 더블클릭 또는 Enter로 채팅 열기`);
    if (contact.id === selectedContactId) row.classList.add("is-selected");

    const avatarWrap = createElement("span", "person-avatar-wrap");
    const avatar = createElement("img", "person-avatar");
    avatar.src = contact.avatar;
    avatar.alt = `${contact.name} 프로필`;
    avatar.loading = "lazy";
    avatar.decoding = "async";
    avatar.style.setProperty("--avatar-bg", contact.color);
    const status = createElement("span", `person-status ${contact.status}`);
    status.setAttribute("aria-hidden", "true");
    avatarWrap.append(avatar, status);

    const copy = createElement("div", "person-copy");
    const title = createElement("div", "person-title");
    title.append(createElement("strong", "", contact.name), createElement("span", "person-tag", contact.tag));
    copy.append(title, createElement("p", "", contact.role));
    const rowStatus = createElement("span", `person-row-status ${contact.status}`);
    rowStatus.setAttribute("aria-hidden", "true");
    row.append(avatarWrap, copy, rowStatus);

    row.addEventListener("click", () => {
      selectedContactId = contact.id;
      const scenario = firstScenarioForContact(contact.id);
      if (scenario && activeScenario()?.contactId !== contact.id) activeScenarioId = scenario.id;
      activeFilter = "전체";
      renderFilters();
      renderScenarioList();
      renderFriendList();
      updateOpenHint();
    });
    row.addEventListener("dblclick", () => openChat(contact.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openChat(contact.id); }
    });
    avatar.addEventListener("click", (event) => {
      event.stopPropagation();
      selectedContactId = contact.id;
      updateOpenHint();
      showToast(`${contact.name} 프로필 모의: ${contact.role} · 실제 프로필 창은 열지 않습니다.`);
    });
    avatar.addEventListener("dblclick", (event) => event.stopPropagation());
    return row;
  }

  function appendContactSection(label, list) {
    if (!list.length) return;
    elements.friendList.appendChild(createElement("h3", "friend-section-title", `${label} ${list.length}`));
    const container = createElement("div", "person-list");
    list.forEach((contact) => container.appendChild(createPersonRow(contact)));
    elements.friendList.appendChild(container);
  }

  function renderFriendList() {
    const list = filteredContacts();
    if (selectedContactId && !list.some((contact) => contact.id === selectedContactId)) {
      selectedContactId = "";
    }
    elements.friendList.replaceChildren();
    if (!list.length) {
      elements.friendList.appendChild(createElement("p", "tool-status", "검색 결과가 없습니다."));
      updateOpenHint();
      return;
    }
    if (friendTab === "all") {
      appendContactSection("업무지원", list.filter((contact) => contact.group === "business"));
      appendContactSection("기술지원", list.filter((contact) => contact.group === "technical"));
    } else {
      const title = friendTab === "business" ? "업무지원" : friendTab === "technical" ? "기술지원" : "검색 결과";
      appendContactSection(title, list);
    }
    updateOpenHint();
  }

  function updateOpenHint() {
    const contact = contactById(selectedContactId);
    elements.openSelectedChat.disabled = !contact;
    elements.friendOpenHint.textContent = contact ? `${contact.name} 선택됨 · 더블클릭, Enter 또는 버튼으로 채팅 열기` : "질문을 고르거나 친구를 선택하세요.";
  }

  function appendParagraphs(container, text) {
    String(text).split(/\n\s*\n/).filter(Boolean).forEach((paragraph) => container.appendChild(createElement("p", "", paragraph)));
  }

  function createMessageRow(kind, contact, text) {
    const row = createElement("div", `message-row ${kind}`);
    if (kind === "assistant") {
      const avatar = createElement("img", "message-avatar");
      avatar.src = contact.avatar;
      avatar.alt = "";
      row.appendChild(avatar);
    }
    const stack = createElement("div", "message-stack");
    if (kind === "assistant") stack.appendChild(createElement("p", "message-sender", contact.name));
    const bubble = createElement("div", "message-bubble");
    appendParagraphs(bubble, text);
    stack.append(bubble, createElement("span", "message-time", "데모"));
    row.appendChild(stack);
    return row;
  }

  function createTypingRow(contact) {
    const row = createElement("div", "message-row assistant");
    row.setAttribute("role", "status");
    row.setAttribute("aria-label", `${contact.name}이 예시 응답을 준비하고 있습니다.`);
    const avatar = createElement("img", "message-avatar");
    avatar.src = contact.avatar;
    avatar.alt = "";
    const bubble = createElement("div", "message-bubble typing-bubble");
    bubble.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) bubble.appendChild(createElement("i"));
    row.append(avatar, bubble);
    return row;
  }

  function createResultCard(scenario) {
    const card = createElement("article", "result-card");
    const header = createElement("header");
    header.append(createElement("strong", "", scenario.cardTitle), createElement("span", "", "모의 화면"));
    const list = createElement("ul");
    scenario.cardItems.forEach((item) => list.appendChild(createElement("li", "", item)));
    card.append(header, list);
    return card;
  }

  function scrollFeed() {
    elements.chatFeed.scrollTop = elements.chatFeed.scrollHeight;
  }

  function playScenario(scenario) {
    const contact = contactById(scenario.contactId);
    if (!contact) return;
    clearPlayback();
    elements.chatFeed.replaceChildren();
    elements.chatFeed.setAttribute("aria-busy", "true");
    elements.composerHint.textContent = scenario.question;
    elements.simulationCaption.textContent = scenario.status;
    elements.chatFeed.append(createElement("p", "example-stamp", "웹 모의환경 · 고정 예시 응답 · 실제 처리 없음"));
    elements.chatFeed.appendChild(createMessageRow("assistant", contact, contact.greeting));
    elements.chatFeed.appendChild(createMessageRow("user", contact, scenario.question));
    scrollFeed();
    schedule(() => {
      typingRow = createTypingRow(contact);
      elements.chatFeed.appendChild(typingRow);
      scrollFeed();
    }, 260);
    schedule(() => {
      if (typingRow?.isConnected) typingRow.remove();
      elements.chatFeed.appendChild(createMessageRow("assistant", contact, scenario.reply));
      elements.chatFeed.appendChild(createResultCard(scenario));
      elements.chatFeed.appendChild(createElement("p", "example-stamp", `예시 응답 · 실제 작업 없음 · ${scenario.status}`));
      elements.chatFeed.setAttribute("aria-busy", "false");
      scrollFeed();
    }, 860);
  }

  function openChat(contactId) {
    const contact = contactById(contactId);
    if (!contact) return;
    selectedContactId = contact.id;
    currentContactId = contact.id;
    const scenario = activeScenario()?.contactId === contact.id ? activeScenario() : firstScenarioForContact(contact.id);
    if (scenario) activeScenarioId = scenario.id;
    activeFilter = "전체";
    renderFilters();
    renderScenarioList();
    elements.contactAvatar.src = contact.avatar;
    elements.contactAvatar.alt = `${contact.name} 프로필`;
    elements.messengerHeading.textContent = contact.name;
    elements.contactRole.textContent = `${contact.role} · ${contact.status === "online" ? "온라인" : contact.status === "away" ? "자리비움" : "오프라인"}`;
    elements.chatPresence.className = `presence ${contact.status}`;
    elements.chatWindowTitle.textContent = `AI지원담당 · ${contact.name}`;
    elements.infoName.textContent = `${contact.name} · ${contact.role}`;
    elements.infoSummary.textContent = `${contact.tag}. 설치본의 담당 흐름을 정적으로 모사하며 실제 모델이나 도구를 실행하지 않습니다.`;
    elements.infoPopover.hidden = true;
    elements.infoButton.setAttribute("aria-expanded", "false");
    renderToolPanel(contact);
    elements.friendsWindow.hidden = true;
    elements.chatWindow.hidden = false;
    elements.chatWindow.classList.toggle("has-tool", Boolean(contact.tool));
    elements.chatWorkspace.className = contact.tool === "resource" ? "chat-workspace has-tool has-resource" : contact.tool ? "chat-workspace has-tool" : "chat-workspace";
    if (scenario) playScenario(scenario);
    window.requestAnimationFrame(() => elements.messengerHeading.focus({ preventScroll: true }));
  }

  function closeChat(restoreFocus = true) {
    const contactId = currentContactId || selectedContactId;
    clearPlayback();
    clearToolTimers();
    elements.infoPopover.hidden = true;
    elements.infoButton.setAttribute("aria-expanded", "false");
    elements.chatWindow.hidden = true;
    elements.friendsWindow.hidden = false;
    elements.toolPanel.replaceChildren();
    currentContactId = "";
    renderFriendList();
    updateOpenHint();
    elements.simulationCaption.textContent = "친구 목록으로 돌아왔습니다. 다른 담당자를 더블클릭해 보세요.";
    if (restoreFocus) window.requestAnimationFrame(() => document.querySelector(`[data-contact-id="${contactId}"]`)?.focus({ preventScroll: true }));
  }

  function toolHeader(title, subtitle) {
    const header = createElement("header", "tool-header");
    const copy = createElement("div");
    copy.append(createElement("strong", "", title), createElement("span", "", subtitle));
    header.append(copy, createElement("span", "mock-badge", "웹 데모"));
    return header;
  }

  function toolCard(title) {
    const card = createElement("section", "tool-card");
    card.appendChild(createElement("h3", "", title));
    return card;
  }

  function toolStatus(text, state) {
    return createElement("div", `tool-status${state ? ` ${state}` : ""}`, text);
  }

  function labeledField(label, control) {
    const wrapper = createElement("label", "tool-field");
    wrapper.append(createElement("span", "", label), control);
    return wrapper;
  }

  function selectControl(options, value) {
    const select = createElement("select");
    options.forEach((optionText) => {
      const option = createElement("option", "", optionText);
      option.selected = optionText === value;
      select.appendChild(option);
    });
    return select;
  }

  function renderToolPanel(contact) {
    clearToolTimers();
    elements.toolPanel.replaceChildren();
    elements.toolPanel.hidden = !contact.tool;
    if (!contact.tool) return;
    const renderers = { converter: renderConverterTool, image: renderImageTool, steno: renderStenoTool, resource: renderResourceTool, privacy: renderPrivacyTool, routine: renderRoutineTool };
    renderers[contact.tool]?.();
  }

  function renderConverterTool() {
    elements.toolPanel.appendChild(toolHeader("김병환 변환", "이미지 · PDF · 원본 보존"));
    const tabs = createElement("div", "tool-tabs");
    ["이미지 변환", "PDF 작업", "용량 줄이기"].forEach((name) => {
      const tab = createButton(name, "tool-tab", () => {
        tabs.querySelectorAll("button").forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
        status.textContent = `${name} 탭을 선택했습니다. 아래 샘플은 실제 파일을 열지 않습니다.`;
      });
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(name === "PDF 작업"));
      tabs.appendChild(tab);
    });
    const files = toolCard("파일 슬롯 · 병합 순서");
    ["01_회의표지.pdf", "02_회의안건.pdf", "03_붙임자료.pdf"].forEach((name, index) => {
      const slot = createElement("div", "file-slot");
      slot.append(createElement("span", "", `${index + 1}. ${name}`), createElement("span", "", "모의 PDF"));
      files.appendChild(slot);
    });
    const range = createElement("input"); range.value = "4-6"; range.setAttribute("aria-label", "PDF 나누기 범위 모의");
    files.appendChild(labeledField("PDF 나누기 범위", range));
    const actions = createElement("div", "tool-row wrap");
    const status = toolStatus("대기 · 실제 파일 접근 없음");
    const reinsert = createButton("병합본 다시 넣기", "tool-btn");
    const split = createButton("4~6쪽 나누기", "tool-btn");
    reinsert.disabled = true;
    split.disabled = true;
    const merge = createButton("PDF 3개 병합", "tool-btn primary", () => {
      clearToolTimers(); status.className = "tool-status working"; status.textContent = "병합 모의 처리 중…";
      scheduleTool(() => {
        status.className = "tool-status complete";
        status.textContent = "모의 병합 저장 화면 완료 · 나누려면 병합본을 다시 슬롯에 넣으세요";
        reinsert.disabled = false;
        showToast("웹 데모에서는 병합 파일을 만들지 않습니다.");
      }, 650);
    });
    reinsert.addEventListener("click", () => {
      const slot = createElement("div", "file-slot");
      slot.dataset.mockMerged = "true";
      slot.append(createElement("span", "", "대상. 회의자료_통합본.pdf"), createElement("span", "", "다시 넣기 모사"));
      files.querySelectorAll("[data-mock-merged]").forEach((item) => item.remove());
      files.insertBefore(slot, files.lastElementChild);
      split.disabled = false;
      status.className = "tool-status";
      status.textContent = "병합본을 슬롯에 다시 넣고 나누기 대상으로 선택한 상태를 모사했습니다.";
    });
    split.addEventListener("click", () => {
      clearToolTimers(); status.className = "tool-status working"; status.textContent = "4~6쪽 나누기 모의 처리 중…";
      scheduleTool(() => { status.className = "tool-status complete"; status.textContent = "모의 4~6쪽 선택 화면 완료 · 원본 유지 · 파일 생성 없음"; showToast("웹 데모에서는 분리 PDF를 만들지 않습니다."); }, 650);
    });
    actions.append(merge, reinsert, split, createButton("비우기", "tool-btn", () => { files.querySelectorAll("[data-mock-merged]").forEach((item) => item.remove()); reinsert.disabled = true; split.disabled = true; status.className = "tool-status"; status.textContent = "파일 슬롯을 비운 상태를 모사했습니다."; }));
    elements.toolPanel.append(tabs, files, actions, status);
  }

  function renderImageTool() {
    elements.toolPanel.appendChild(toolHeader("김그림 설정", "생성 전 확인 · 모델 없으면 프롬프트만"));
    const settings = toolCard("이미지 브리프");
    const purpose = selectControl(["프사", "PPT 배경", "보고서 삽화"], "프사");
    const ratio = selectControl(["1:1", "16:9", "9:16", "4:3"], "1:1");
    const style = selectControl(["편집 삽화", "사진", "자료 도식", "낙서"], "편집 삽화");
    const prompt = createElement("textarea"); prompt.value = "사람 얼굴 없이 열린 문과 작은 말풍선을 형상화한 안내 아이콘, 따뜻한 아이보리 배경, 절제된 골드 포인트";
    const negative = createElement("textarea"); negative.value = "사람 얼굴, 실사 인물, 기관 로고, 글자, 워터마크";
    settings.append(labeledField("용도", purpose), labeledField("비율", ratio), labeledField("스타일", style), labeledField("생성 프롬프트", prompt), labeledField("금지 요소", negative));
    const status = toolStatus("로컬 이미지 모델 없음 · 실제 생성하지 않음");
    const actions = createElement("div", "tool-row wrap");
    actions.append(createButton("비우기", "tool-btn", () => { prompt.value = ""; negative.value = ""; status.className = "tool-status"; status.textContent = "브리프를 비웠습니다 · 실제 생성 없음"; }), createButton("요청문 넣기", "tool-btn primary", () => { prompt.value = `${purpose.value}용 ${ratio.value} ${style.value}. 열린 문과 작은 말풍선, 얼굴 없는 따뜻한 공공기관 안내 이미지.`; status.className = "tool-status complete"; status.textContent = "프롬프트 초안 준비됨 · 생성 확인은 채팅의 ‘응, 생성해줘’ 액션에서만 진행"; }));
    elements.toolPanel.append(settings, actions, status);
  }

  function renderStenoTool() {
    elements.toolPanel.appendChild(toolHeader("김속기 받아쓰기", "로컬 STT · 원문 자동 저장 모사"));
    const engine = toolCard("로컬 음성 엔진");
    engine.append(createElement("p", "", "Turbo 기본 포함 · 한국어 권장 · Whisper.cpp + VAD"));
    engine.append(createElement("p", "", "Turbo와 AI 회의록 정리를 함께 사용할 때는 Gemma4 e4b 이상을 권장합니다. e4b 미만·미식별 모델은 성능 주의가 필요하며, Small Lite는 영어 음성에 권장됩니다."));
    engine.append(createElement("p", "", "고정 15분 제한 없음 · 기본 120MB 보호 한도. 받아쓰기는 로컬이지만 회의록·할 일 AI 초안은 현재 LLM 처리 위치를 확인해야 합니다."));
    const steps = createElement("div", "step-strip");
    ["1 녹음·읽기", "2 받아쓰기", "3 저장"].forEach((label, index) => { const item = createElement("span", index === 0 ? "active" : "", label); item.dataset.step = String(index); steps.appendChild(item); });
    engine.appendChild(steps);
    const transcript = createElement("textarea"); transcript.readOnly = true; transcript.placeholder = "모의 받아쓰기 원문이 여기에 표시됩니다.";
    engine.appendChild(labeledField("성능 모델", selectControl(["Turbo 기본 · 한국어 권장", "Small Lite · 영어 권장"], "Turbo 기본 · 한국어 권장")));
    engine.appendChild(labeledField("언어", selectControl(["한국어", "영어", "자동 감지"], "한국어")));
    engine.appendChild(labeledField("원문", transcript));
    const status = toolStatus("대기 · 마이크 권한을 요청하지 않음");
    const actions = createElement("div", "tool-row wrap");
    const finish = () => {
      status.className = "tool-status working"; status.textContent = "Turbo 모의 받아쓰기 중…";
      steps.querySelectorAll("span").forEach((item, index) => item.className = index === 0 ? "done" : index === 1 ? "active" : "");
      scheduleTool(() => {
        steps.querySelectorAll("span").forEach((item) => item.className = "done");
        transcript.value = "오늘 회의에서는 8월 20일까지 수정 보고서를 제출하기로 했습니다. 담당자는 [확인 필요]입니다.";
        status.className = "tool-status complete"; status.textContent = "모의 STT 완료 · TXT/SRT/VTT/JSON 표시만 제공";
      }, 720);
    };
    actions.append(createButton("녹음 시작", "tool-btn primary", () => { clearToolTimers(); status.className = "tool-status recording"; status.textContent = "REC 00:04 · 실제 녹음 없음"; }), createButton("정지 + STT", "tool-btn", finish), createButton("녹음본 열기 + STT", "tool-btn", () => { status.className = "tool-status working"; status.textContent = "샘플 음성 선택 화면을 모사합니다…"; finish(); }));
    elements.toolPanel.append(engine, actions, status);
  }

  function renderResourceTool() {
    elements.toolPanel.appendChild(toolHeader("김자원 문서 자원", "로컬 전용 · 지원 문서 33종"));
    const summary = toolCard("문서 선택");
    const progress = createElement("div", "meter"); const bar = createElement("i"); progress.appendChild(bar);
    const fileLabel = createElement("p", "", "선택된 문서 없음");
    const resourceArea = createElement("div", "resource-grid");
    const preview = createElement("div", "preview-tile", "문서 자원 미리보기\n(정적 모사)");
    const status = toolStatus("대기 · 문서 바이트를 읽지 않음");
    const select = createButton("샘플 PPTX 선택", "tool-btn primary", () => {
      clearToolTimers(); fileLabel.textContent = "사업계획서_샘플.pptx · 모의 문서"; bar.style.setProperty("--progress", "45%"); status.className = "tool-status working"; status.textContent = "패키지 구조 분석 모사 45%";
      scheduleTool(() => {
        bar.style.setProperty("--progress", "100%"); status.className = "tool-status complete"; status.textContent = "모의 분석 완료 · 리소스 8개 · 이미지 4 · 글꼴 2 · 테마 1 · 구조 1";
        resourceArea.replaceChildren();
        ["표지 이미지", "조직도 PNG", "Noto Sans", "테마 색상"].forEach((name, index) => { const item = createButton(name, `resource-item${index === 0 ? " is-selected" : ""}`, () => { resourceArea.querySelectorAll("button").forEach((button) => button.classList.toggle("is-selected", button === item)); preview.textContent = `${name}\n안전 미리보기 모사`; }); resourceArea.appendChild(item); });
      }, 700);
    });
    summary.append(fileLabel, progress, createElement("p", "", "매크로·스크립트는 실행하지 않으며 채팅과 분석은 분리됩니다."));
    const actions = createElement("div", "tool-row wrap");
    actions.append(select, createButton("선택 저장", "tool-btn", () => showToast("웹 데모에서는 추출 파일을 저장하지 않습니다.")), createButton("전체 ZIP", "tool-btn", () => showToast("웹 데모에서는 ZIP을 만들지 않습니다.")));
    elements.toolPanel.append(summary, actions, status, resourceArea, preview);
  }

  function renderPrivacyTool() {
    elements.toolPanel.appendChild(toolHeader("김개보 검사실", "열린 창 · 합성 텍스트 개인정보 검사"));
    const syntheticMobile = ["010", "0000", "0000"].join("-");
    const syntheticEmail = ["demo", "example.invalid"].join("@");
    const maskedEmail = ["de***", "example.invalid"].join("@");
    const tabs = createElement("div", "tool-tabs");
    ["검사 모드", "채팅 모드"].forEach((label, index) => { const tab = createButton(label, "tool-tab", () => tabs.querySelectorAll("button").forEach((button) => button.setAttribute("aria-pressed", String(button === tab)))); tab.setAttribute("aria-pressed", String(index === 0)); tabs.appendChild(tab); });
    const input = createElement("textarea"); input.value = `안전한 합성값 ${syntheticMobile}, ${syntheticEmail}`; input.readOnly = true;
    const card = toolCard("검사 대상");
    card.append(labeledField("합성 예시 텍스트", input));
    const windows = createElement("div");
    const results = createElement("div");
    const status = toolStatus("대기 · 실제 열린 창이나 클립보드를 읽지 않음");
    const revealWindows = () => { windows.replaceChildren(); ["민원접수 - Edge (모의)", "보고서.hwp (모의)"].forEach((label) => { const slot = createElement("div", "file-slot"); const check = createElement("input"); check.type = "checkbox"; check.checked = true; check.setAttribute("aria-label", label); slot.append(check, createElement("span", "", label)); windows.appendChild(slot); }); status.textContent = "합성 창 목록 2개를 표시했습니다."; };
    const scan = () => { results.replaceChildren(); [["휴대전화 1건", "010-****-0000"], ["전자우편 1건", maskedEmail]].forEach(([type, value]) => { const row = createElement("div", "privacy-result"); row.append(createElement("strong", "", type), createElement("span", "", "후보"), createElement("span", "", value), createElement("span", "", "모의 마스킹")); results.appendChild(row); }); status.className = "tool-status complete"; status.textContent = "합성 개인정보 후보 2건 · 원문 수정·저장 없음"; };
    const actions = createElement("div", "tool-row wrap");
    actions.append(createButton("열린 창 확인", "tool-btn", revealWindows), createButton("합성 텍스트 검사", "tool-btn primary", scan));
    elements.toolPanel.append(tabs, card, actions, windows, results, status);
  }

  function renderRoutineTool() {
    elements.toolPanel.appendChild(toolHeader("김루틴 설정", "직접 실행 · 웹 모사"));
    const tabs = createElement("div", "tool-tabs");
    const body = createElement("div");
    const renderMode = (mode) => {
      clearToolTimers(); body.replaceChildren(); tabs.querySelectorAll("button").forEach((button) => button.setAttribute("aria-selected", String(button.dataset.mode === mode)));
      if (mode === "series4") { renderSeries4Mode(body); return; }
      renderDirectRoutineMode(body);
    };
    [["direct", "직접 설정"], ["series4", "자동 설정 · Series 4"]].forEach(([mode, label]) => { const tab = createButton(label, "tool-tab", () => renderMode(mode)); tab.dataset.mode = mode; tab.setAttribute("role", "tab"); tab.setAttribute("aria-selected", String(mode === "direct")); tabs.appendChild(tab); });
    elements.toolPanel.append(tabs, body);
    renderMode("direct");
  }

  function renderDirectRoutineMode(body) {
    const config = toolCard("전체 실행 설정");
    const repeat = createElement("input"); repeat.type = "number"; repeat.min = "1"; repeat.max = "999"; repeat.value = "30";
    const infinite = createElement("input"); infinite.type = "checkbox"; infinite.id = "routineInfinite";
    const infiniteLabel = createElement("label", "tool-row"); infiniteLabel.append(infinite, createElement("span", "", "중지할 때까지 무한 반복"));
    config.append(labeledField("전체 반복 횟수 (1~999)", repeat), infiniteLabel);
    const steps = toolCard("단계 3개 · 승인 지점 포함");
    const stepRows = [];
    ["대상 칸 클릭", "텍스트 입력", "제출 전 사용자 승인"].forEach((label, index) => { const row = createElement("div", "routine-step"); row.append(createElement("b", "", String(index + 1)), createElement("span", "", label), createElement("span", "", index === 2 ? "확인" : "지원")); steps.appendChild(row); stepRows.push(row); });
    const approval = createElement("div", "approval-card"); approval.hidden = true; approval.append(createElement("strong", "", "사용자 승인 필요"), createElement("p", "", "제출 동작 전입니다. 실제 입력이나 제출은 발생하지 않습니다."));
    const approve = createButton("승인하고 모의 완료", "tool-btn primary"); approval.appendChild(approve);
    const status = toolStatus("대기 · OS 입력 없음");
    const actions = createElement("div", "tool-row wrap");
    const start = createButton("실행 시작", "tool-btn primary", () => { clearToolTimers(); approval.hidden = true; stepRows.forEach((row) => row.className = "routine-step"); status.className = "tool-status working"; status.textContent = `${infinite.checked ? "무한 반복" : `${repeat.value || 1}회 반복`} 모사 · 1/3`; stepRows[0].classList.add("active"); scheduleTool(() => { stepRows[0].className = "routine-step done"; stepRows[1].className = "routine-step done"; stepRows[2].className = "routine-step active"; approval.hidden = false; status.textContent = "2/3 완료 · 승인 지점에서 안전 정지"; }, 700); });
    const stop = createButton("중지", "tool-btn danger", () => { clearToolTimers(); approval.hidden = true; status.className = "tool-status"; status.textContent = "사용자가 모의 실행을 중지했습니다."; });
    approve.addEventListener("click", () => { approval.hidden = true; stepRows.forEach((row) => row.className = "routine-step done"); status.className = "tool-status complete"; status.textContent = infinite.checked ? "무한 반복 모사 2회 후 데모 안전 중지" : `${repeat.value || 1}회 설정 확인 · 3/3 모의 완료`; });
    actions.append(start, stop);
    body.append(config, steps, approval, actions, status);
  }

  function renderSeries4Mode(body) {
    const engine = toolCard("Series 4 엔진");
    engine.append(createElement("p", "", "설치본에는 기본 포함되지만 이 웹에서는 설치·버전·준비 상태를 확인하지 않습니다."));
    const timeline = createElement("div");
    const status = toolStatus("모의 엔진 카드 · 실제 설치/준비 여부 확인 안 함");
    const actions = createElement("div", "tool-row wrap");
    actions.append(createButton("녹화 창 흐름 보기", "tool-btn primary", () => { timeline.replaceChildren(createElement("div", "preview-tile", "최근 기록 모의 프레임\n00:01 클릭 · 00:03 키보드 · 00:06 중지")); status.textContent = "모의 최근 기록 타임라인 · 화면이나 입력을 기록하지 않음"; }), createButton("상태 확인 모사", "tool-btn", () => showToast("실제 Series 4 설치·버전·기록 폴더를 확인하지 않습니다.")));
    body.append(engine, actions, timeline, status);
  }

  elements.friendSearch.addEventListener("input", renderFriendList);
  elements.openSelectedChat.addEventListener("click", () => openChat(selectedContactId));
  elements.backToFriends.addEventListener("click", () => closeChat(true));
  elements.sendDemoButton.addEventListener("click", () => { const scenario = activeScenario(); if (scenario?.contactId === currentContactId) playScenario(scenario); else showToast("왼쪽에서 현재 담당자의 질문을 선택해 주세요."); });
  elements.readyButton.addEventListener("click", () => showToast("데모 상태: 로컬 LLM 준비됨 모사 · 실제 모델 호출 없음"));
  elements.infoButton.addEventListener("click", () => { const next = elements.infoPopover.hidden; elements.infoPopover.hidden = !next; elements.infoButton.setAttribute("aria-expanded", String(next)); });
  document.querySelectorAll("[data-demo-nav]").forEach((button) => button.addEventListener("click", () => { document.querySelectorAll("[data-demo-nav]").forEach((item) => { item.classList.toggle("is-active", item === button); item.toggleAttribute("aria-current", item === button); }); if (button.dataset.demoNav !== "friends") { showToast("웹 데모에서는 친구 화면과 담당자 채팅만 체험합니다."); window.setTimeout(() => { document.querySelector('[data-demo-nav="friends"]')?.click(); }, reducedMotion ? 0 : 500); } }));
  document.querySelectorAll("[data-window-action]").forEach((button) => button.addEventListener("click", () => { if (button.dataset.windowAction === "close-chat") closeChat(true); else showToast("창 제어 모양만 재현한 버튼입니다. 브라우저 창은 바꾸지 않습니다."); }));
  document.addEventListener("keydown", (event) => { if (event.key !== "Escape") return; if (!elements.infoPopover.hidden) { elements.infoPopover.hidden = true; elements.infoButton.setAttribute("aria-expanded", "false"); elements.infoButton.focus(); } });

  renderFilters();
  renderScenarioList();
  renderFriendTabs();
  renderFriendList();
  updateOpenHint();
})();
