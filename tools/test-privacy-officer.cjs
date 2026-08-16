const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const CHAT_SOURCE_PATH = path.join(ROOT_DIR, "app", "renderer", "chat.js");
const { sendOfficerMessage } = require(path.join(ROOT_DIR, "app", "main", "llm.cjs"));
const { inspectPrivacyFile, scanPrivacyText } = require(path.join(ROOT_DIR, "app", "main", "privacy-tools.cjs"));

function loadPrivacyModeSource() {
  const source = fs.readFileSync(CHAT_SOURCE_PATH, "utf8");
  const start = source.indexOf("function loadPrivacyMode()");
  const end = source.indexOf("\nfunction savePrivacyMode", start);
  assert.ok(start >= 0 && end > start, "chat.js must define loadPrivacyMode before savePrivacyMode");
  return source.slice(start, end);
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test("김개보는 저장된 선택이 없거나 localStorage를 읽지 못하면 채팅 모드로 시작한다", () => {
  const functionSource = loadPrivacyModeSource();
  const runLoadPrivacyMode = (getItem) =>
    Function("window", `const privacyModeStorageKey = "privacy-test-mode"; ${functionSource}; return loadPrivacyMode();`)({
      localStorage: { getItem },
    });
  assert.match(
    functionSource,
    /catch\s*\([^)]*\)\s*\{\s*return\s+["']chat["'];\s*\}/,
    "localStorage 읽기 실패 시 기본값은 chat이어야 합니다"
  );
  assert.match(
    functionSource,
    /return\s+["']chat["'];\s*\}\s*$/,
    "저장된 선택이 없을 때 기본값은 chat이어야 합니다"
  );
  assert.equal(runLoadPrivacyMode(() => null), "chat");
  assert.equal(runLoadPrivacyMode(() => "scan"), "scan", "사용자가 저장한 검사 모드는 존중해야 합니다");
  assert.equal(runLoadPrivacyMode(() => "chat"), "chat");
  assert.equal(
    runLoadPrivacyMode(() => {
      throw new Error("storage unavailable");
    }),
    "chat"
  );
});

test("김개보 로컬 검사는 가짜 전화번호와 이메일을 탐지하고 마스킹한다", () => {
  const phone = ["010", "1234", "5678"].join("-");
  const email = ["gildong.hong", "example.test"].join("@");
  const result = scanPrivacyText(`가상 연락처: ${phone}, ${email}`);

  assert.equal(result.ok, true);
  const phoneFinding = result.findings.find((finding) => finding.type === "phone");
  const emailFinding = result.findings.find((finding) => finding.type === "email");
  assert.ok(phoneFinding, "전화번호를 탐지해야 합니다");
  assert.ok(emailFinding, "이메일을 탐지해야 합니다");
  assert.equal(phoneFinding.masked, "010-****-5678");
  assert.equal(emailFinding.masked, "gi***@example.test");
  assert.ok(!phoneFinding.masked.includes(phone));
  assert.ok(!emailFinding.masked.includes(email));
  assert.ok(phoneFinding.maskedContext, "마스킹된 주변 문맥을 제공해야 합니다");
  assert.ok(emailFinding.maskedContext, "마스킹된 주변 문맥을 제공해야 합니다");
  assert.ok(!JSON.stringify(result.findings).includes(phone), "검출 결과에 실제 전화번호가 남으면 안 됩니다");
  assert.ok(!JSON.stringify(result.findings).includes(email), "검출 결과에 실제 이메일이 남으면 안 됩니다");
  assert.ok(!Object.hasOwn(phoneFinding, "text"), "검출 결과에 원문 값 필드를 노출하면 안 됩니다");
  assert.ok(!Object.hasOwn(phoneFinding, "context"), "검출 결과에 원문 문맥 필드를 노출하면 안 됩니다");
});

test("김개보 결과 화면은 원문 context로 되돌아가지 않고 maskedContext만 표시한다", () => {
  const rendererSource = fs.readFileSync(CHAT_SOURCE_PATH, "utf8");
  assert.match(rendererSource, /escapeHtml\(finding\.maskedContext\s*\|\|\s*["']{2}\)/);
  assert.doesNotMatch(rendererSource, /finding\.context/);
});

test("김개보 첨부 검사는 텍스트만 읽고 바이너리 문서를 clean으로 오판하지 않는다", (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-privacy-test-"));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

  const textPath = path.join(tempDir, "sample.txt");
  const pdfPath = path.join(tempDir, "sample.pdf");
  const phone = ["010", "1234", "5678"].join("-");
  fs.writeFileSync(textPath, `가상 연락처: ${phone}`, "utf8");
  fs.writeFileSync(pdfPath, `%PDF-1.7 가상 연락처: ${phone}`, "utf8");

  const textResult = inspectPrivacyFile({ name: "sample.txt", path: textPath });
  assert.equal(textResult.ok, true);
  assert.equal(textResult.status, "risk");
  assert.ok(textResult.findings.some((finding) => finding.type === "phone"));

  const pdfResult = inspectPrivacyFile({ name: "sample.pdf", path: pdfPath });
  assert.equal(pdfResult.ok, false);
  assert.equal(pdfResult.status, "unreadable");
  assert.equal(pdfResult.errorCode, "UNSUPPORTED_PRIVACY_FILE_FORMAT");
  assert.equal(pdfResult.findings.length, 0);
  assert.match(pdfResult.guidance, /복사.*텍스트 검사 칸/);
});

test("김개보 채팅은 설정된 OpenAI 호환 모델 경로를 호출한다", async (t) => {
  const originalEnvironment = {
    provider: process.env.HEYU_LLM_PROVIDER,
    baseUrl: process.env.HEYU_LLM_BASE_URL,
    model: process.env.HEYU_LLM_MODEL,
    timeoutMs: process.env.HEYU_LLM_TIMEOUT_MS,
    apiKey: process.env.HEYU_LLM_API_KEY,
  };
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({ url: request.url, body: JSON.parse(body || "{}") });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [{ message: { content: "PRIVACY_MODEL_PATH_SENTINEL" } }],
      }));
    });
  });
  const address = await listen(server);

  t.after(async () => {
    await close(server);
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("HEYU_LLM_PROVIDER", originalEnvironment.provider);
    restore("HEYU_LLM_BASE_URL", originalEnvironment.baseUrl);
    restore("HEYU_LLM_MODEL", originalEnvironment.model);
    restore("HEYU_LLM_TIMEOUT_MS", originalEnvironment.timeoutMs);
    restore("HEYU_LLM_API_KEY", originalEnvironment.apiKey);
  });

  process.env.HEYU_LLM_PROVIDER = "openai-compatible";
  process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.HEYU_LLM_MODEL = "privacy-officer-mock";
  process.env.HEYU_LLM_TIMEOUT_MS = "3000";
  delete process.env.HEYU_LLM_API_KEY;

  const userText = "개인정보 점검 원칙을 설명해 주세요.";
  const result = await sendOfficerMessage({
    contact: {
      id: "privacy-officer",
      name: "김개보",
      persona: {
        speechStyle: "formal",
        systemPrompt: "당신은 개인정보 검사 담당 김개보입니다.",
      },
    },
    history: [],
    files: [],
    userText,
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, "privacy-officer-mock");
  assert.equal(result.text, "PRIVACY_MODEL_PATH_SENTINEL");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "/v1/chat/completions");
  assert.equal(requests[0].body.model, "privacy-officer-mock");
  assert.equal(requests[0].body.messages.at(-1).content, userText);
  assert.match(requests[0].body.messages[0].content, /김개보 답변 강제 규칙/);
});
