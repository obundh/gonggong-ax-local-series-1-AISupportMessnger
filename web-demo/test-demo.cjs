const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const DEMO_DIR = __dirname;
const PROJECT_DIR = path.resolve(DEMO_DIR, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(DEMO_DIR, relativePath), "utf8");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function loadDemoData() {
  const context = { window: {} };
  vm.runInNewContext(read("scenarios.js"), context, { filename: "scenarios.js" });
  return {
    contacts: context.window.HEYU_DEMO_CONTACTS,
    scenarios: context.window.HEYU_DEMO_SCENARIOS,
  };
}

test("the friend roster mirrors the current HEYU contact IDs, order, groups, and tools", () => {
  const { contacts } = loadDemoData();
  const expected = [
    ["chief", "김법률", "business"],
    ["admin-officer", "김행정", "business"],
    ["language", "김언심", "business"],
    ["translator", "김국어", "business"],
    ["steno-officer", "김속기", "business"],
    ["privacy-officer", "김개보", "business"],
    ["image-officer", "김그림", "business"],
    ["nori", "김노리", "business"],
    ["file-converter", "김병환", "technical"],
    ["resource-officer", "김자원", "technical"],
    ["routine-officer", "김루틴", "technical"],
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(contacts.map(({ id, name, group }) => [id, name, group]))), expected);
  assert.equal(new Set(contacts.map((contact) => contact.id)).size, 11);
  assert.deepEqual(
    JSON.parse(JSON.stringify(contacts.filter((contact) => contact.tool).map((contact) => contact.tool).sort())),
    ["converter", "image", "privacy", "resource", "routine", "steno"],
  );
});

test("the demo covers every contact with unique, complete, correctly linked scenarios", () => {
  const { contacts, scenarios } = loadDemoData();
  const contactById = new Map(contacts.map((contact) => [contact.id, contact]));

  assert.equal(scenarios.length, 13);
  assert.deepEqual(
    JSON.parse(JSON.stringify([...new Set(scenarios.map((scenario) => scenario.officer))].sort())),
    JSON.parse(JSON.stringify(contacts.map((contact) => contact.name).sort())),
  );
  assert.equal(new Set(scenarios.map((scenario) => scenario.id)).size, scenarios.length);

  for (const scenario of scenarios) {
    for (const field of ["id", "group", "officer", "role", "avatar", "title", "question", "reply", "status", "cardTitle"]) {
      assert.equal(typeof scenario[field], "string", scenario.id + " missing " + field);
      assert.ok(scenario[field].trim(), scenario.id + " has empty " + field);
    }
    assert.ok(Array.isArray(scenario.cardItems) && scenario.cardItems.length >= 3);
    assert.ok(fs.existsSync(path.join(DEMO_DIR, scenario.avatar)), "missing avatar: " + scenario.avatar);
    assert.equal(contactById.get(scenario.contactId)?.name, scenario.officer, scenario.id);
  }
});

test("scenario copy is concrete, result-first, and consistently labels the simulation boundary", () => {
  const { scenarios } = loadDemoData();
  const expectedTitles = [
    "‘근기법’으로 연차수당 찾기",
    "소취·공소취소, 같은 말이야?",
    "출장비 보완서류 정리",
    "쪼개 사기 감사 체크",
    "서비스 중단 공지 번역",
    "민원 지연 보고 문장 정리",
    "PDF 3개 합치고 4~6쪽만",
    "얼굴 없는 안내 프사 브리프",
    "회의 녹음에서 결정·할 일만",
    "PPTX 속 원본 그림만 꺼내기",
    "발송 전 개인정보 2초 점검",
    "30회 반복, 제출 앞에서 멈추기",
    "머리 멈췄을 때 10분 정리",
  ];
  assert.deepEqual(JSON.parse(JSON.stringify(scenarios.map((scenario) => scenario.title))), expectedTitles);
  for (const scenario of scenarios) {
    assert.match(scenario.status, /^(웹 데모|합성 데이터 데모)/, scenario.id);
    assert.ok(scenario.reply.length >= 100 && scenario.reply.length <= 900, scenario.id);
    assert.doesNotMatch(scenario.reply, /^(가능·불가부터|금액 하나만으로|설치본에서는 먼저)/, scenario.id);
  }
});

test("the page is an honest static simulation with no data or network capability", () => {
  const html = read("index.html");
  const javascript = read("app.js") + "\n" + read("scenarios.js");

  assert.match(html, /AI지원담당 실제 화면 모사/);
  assert.match(html, /AI·MCP·파일·마이크·자동화를 실행하거나 저장하지 않습니다/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /<input\b[^>]*type\s*=\s*["']?file/i);
  assert.doesNotMatch(javascript, /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|getUserMedia|showOpenFilePicker|desktopAPI|localStorage|sessionStorage|document\.cookie|innerHTML/);
  assert.doesNotMatch(javascript, /https?:\/\//i);
});

test("the initial product screen is friends and supports actual open and return semantics", () => {
  const html = read("index.html");
  const app = read("app.js");
  assert.match(html, /id="friendsWindow"/);
  assert.match(html, /id="chatWindow"[^>]*hidden/);
  assert.doesNotMatch(html, /<main class="chat-main"/);
  assert.doesNotMatch(html, /sidebar-brand/);
  assert.equal((html.match(/class="nav-icon"/g) || []).length, 4);
  assert.match(app, /\["all", "전체"\].*\["business", "업무지원"\].*\["technical", "기술지원"\].*\["favorites", "즐겨찾기"\]/s);
  assert.match(app, /row\.setAttribute\("role", "button"\)/);
  assert.match(app, /row\.addEventListener\("dblclick", \(\) => openChat/);
  assert.match(app, /event\.key === "Enter" \|\| event\.key === " "/);
  assert.match(app, /openSelectedChat\.addEventListener\("click"/);
  assert.match(app, /backToFriends\.addEventListener\("click"/);
  assert.match(app, /focus\(\{ preventScroll: true \}\)/);
  assert.match(app, /person-row-status/);
  assert.doesNotMatch(app, /person-favorite/);
});

test("friend filtering cannot leave a hidden contact selected or openable", () => {
  const app = read("app.js");
  assert.match(app, /selectedContactId && !list\.some\(\(contact\) => contact\.id === selectedContactId\)/);
  assert.match(app, /selectedContactId = "";/);
  assert.match(app, /elements\.openSelectedChat\.disabled = !contact/);
  assert.match(app, /renderFriendList\(\)[\s\S]*?updateOpenHint\(\)/);
});

test("all six side-tool contacts have interactive mock panels and no fake real completion", () => {
  const app = read("app.js");
  for (const functionName of ["renderConverterTool", "renderImageTool", "renderStenoTool", "renderResourceTool", "renderPrivacyTool", "renderRoutineTool"]) {
    assert.match(app, new RegExp(`function ${functionName}\\(`));
  }
  for (const marker of ["PDF 3개 병합", "병합본 다시 넣기", "로컬 이미지 모델 없음", "생성 확인은 채팅의", "정지 + STT", "Gemma4 e4b 이상", "샘플 PPTX 선택", "합성 텍스트 검사", "승인하고 모의 완료", "직접 실행 · 웹 모사", "Series 4 엔진", "실제 설치/준비 여부 확인 안 함"]) {
    assert.ok(app.includes(marker), marker);
  }
  assert.match(app, /실제 파일 접근 없음/);
  assert.match(app, /실제 녹음 없음/);
  assert.match(app, /OS 입력 없음/);
  assert.match(app, /파일 생성 없음/);
  assert.doesNotMatch(app, /엔진 준비됨/);
});

test("the privacy example uses reserved synthetic values that match its mock result", () => {
  const scenario = loadDemoData().scenarios.find((item) => item.id === "privacy-scan");
  const mobile = ["010", "0000", "0000"].join("-");
  const email = ["demo", "example.invalid"].join("@");
  assert.match(scenario.question, new RegExp(mobile));
  assert.match(scenario.question, new RegExp(email.replace(".", "\\.")));
  assert.match(scenario.reply, /휴대전화: 010-\*{4}-0000/);
  assert.match(scenario.reply, /전자우편: de\*{3}@example\.invalid/);
});

test("reviewed originals are preserved and every scenario uses a small traced thumbnail", () => {
  const scenarios = loadDemoData().scenarios;
  const manifest = JSON.parse(read(path.join("assets", "avatar-thumbs", "manifest.json")));
  const manifestByThumbnail = new Map(manifest.items.map((item) => [item.thumbnailFile, item]));
  let totalThumbnailBytes = 0;

  for (const scenario of scenarios) {
    assert.match(scenario.avatar, /^assets\/avatar-thumbs\/[a-z]+\.webp$/);
    const thumbnailName = path.basename(scenario.avatar);
    const item = manifestByThumbnail.get(thumbnailName);
    assert.ok(item, "missing thumbnail manifest record: " + thumbnailName);
    const originalSource = path.join(PROJECT_DIR, "app", "renderer", "assets", "avatars", item.sourceFile);
    const preservedOriginal = path.join(DEMO_DIR, "assets", "avatars", item.sourceFile);
    const thumbnail = path.join(DEMO_DIR, scenario.avatar);
    assert.equal(sha256(preservedOriginal), sha256(originalSource), item.sourceFile);
    assert.equal(sha256(preservedOriginal), item.sourceSha256, item.sourceFile);
    assert.equal(sha256(thumbnail), item.thumbnailSha256, thumbnailName);
    assert.equal(item.width, 160);
    assert.equal(item.height, 160);
    assert.equal(item.format, "webp");
    totalThumbnailBytes += item.thumbnailBytes;
  }

  assert.ok(totalThumbnailBytes < 100_000, "thumbnail payload is unexpectedly large");
  assert.equal(
    sha256(path.join(DEMO_DIR, "assets", "app-icon.png")),
    sha256(path.join(PROJECT_DIR, "app", "renderer", "assets", "app-icon.png")),
  );
});

test("responsive and accessibility contracts remain present", () => {
  const html = read("index.html");
  const css = read("styles.css");
  const app = read("app.js");

  assert.match(html, /aria-live="polite"/);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /role="tablist"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(css, /@media \(max-width: 820px\)/);
  assert.match(css, /@media \(max-width: 560px\)/);
  assert.match(css, /width: min\(1260px, calc\(100% - 40px\)\)/);
  assert.match(css, /grid-template-columns: minmax\(280px, 300px\) minmax\(0, 1fr\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(app, /aria-pressed/);
  assert.match(app, /aria-selected/);
  assert.match(app, /clearPlayback/);
  assert.match(app, /clearToolTimers/);
  assert.match(app, /event\.key !== "Escape"/);
});

test("static hosting headers block runtime connections and browser capabilities", () => {
  const headers = read("_headers");
  assert.match(headers, /connect-src 'none'/);
  assert.match(headers, /frame-ancestors 'none'/);
  assert.match(headers, /camera=\(\)/);
  assert.match(headers, /microphone=\(\)/);
  assert.match(headers, /X-Content-Type-Options: nosniff/);
});
