const assert = require("node:assert/strict");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const LLM_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "llm.cjs"));
const MCP_CLIENT_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "mcp-client.cjs"));
const WORKSPACE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "workspace-tools.cjs"));
const GRAPH_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "graph-tools.cjs"));
const PRESENTATION_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "presentation-tools.cjs"));
const IMAGE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "image-tools.cjs"));
const CACHED_PATHS = [
  LLM_PATH,
  MCP_CLIENT_PATH,
  WORKSPACE_TOOLS_PATH,
  GRAPH_TOOLS_PATH,
  PRESENTATION_TOOLS_PATH,
  IMAGE_TOOLS_PATH,
];
const originalCache = new Map(CACHED_PATHS.map((filename) => [filename, require.cache[filename]]));
const ENV_NAMES = ["HEYU_LLM_PROVIDER", "HEYU_LLM_BASE_URL", "HEYU_LLM_MODEL", "HEYU_LLM_TIMEOUT_MS", "HEYU_LLM_API_KEY"];
const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));

const requests = [];
let mcpCalls = 0;
let workspaceCalls = 0;
let server;
let llm;

function installModuleStub(filename, exports) {
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

function restoreProcessState() {
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const [filename, cached] of originalCache) {
    if (cached === undefined) delete require.cache[filename];
    else require.cache[filename] = cached;
  }
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function stenoContact() {
  return {
    id: "steno-officer",
    name: "김속기",
    department: "Ai지원담당",
    description: "녹음속기",
    persona: {
      systemPrompt: "김속기 테스트 페르소나입니다.",
      workflow: ["대화와 속기 작업 구분", "원문 보존"],
      limits: ["원문에 없는 사실을 만들지 않음"],
    },
  };
}

test.before(async () => {
  server = http.createServer(async (request, response) => {
    const body = await readJson(request);
    requests.push(body);
    const currentUserText = body.messages.at(-1)?.content || "";
    const reply = currentUserText === "안녕"
      ? "반가워요. 오늘은 어떤 얘기부터 해볼까요?"
      : "모의 모델이 현재 요청만 읽고 정리했습니다.";
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: reply } }] }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  process.env.HEYU_LLM_PROVIDER = "openai-compatible";
  process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.HEYU_LLM_MODEL = "steno-routing-test";
  process.env.HEYU_LLM_TIMEOUT_MS = "3000";
  delete process.env.HEYU_LLM_API_KEY;

  installModuleStub(MCP_CLIENT_PATH, {
    buildOfficerMcpContext: async () => {
      mcpCalls += 1;
      return "MCP_CONTEXT_SENTINEL";
    },
  });
  installModuleStub(WORKSPACE_TOOLS_PATH, {
    buildWorkspaceMcpContext: async () => {
      workspaceCalls += 1;
      return "WORKSPACE_CONTEXT_SENTINEL";
    },
  });
  installModuleStub(GRAPH_TOOLS_PATH, {
    buildGraphOfficerReply: async () => ({ ok: true, model: "stub", text: "stub" }),
  });
  installModuleStub(PRESENTATION_TOOLS_PATH, {
    buildPresentationOfficerReply: async () => ({ ok: true, model: "stub", text: "stub" }),
  });
  installModuleStub(IMAGE_TOOLS_PATH, {
    buildImageGenerationArtifact: async () => ({ status: "stub" }),
  });
  delete require.cache[LLM_PATH];
  llm = require(LLM_PATH);
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  restoreProcessState();
});

test("김속기 단순 인사는 속기 서식과 과거 녹취 문맥 없이 자연스럽게 처리한다", async () => {
  const before = requests.length;
  const result = await llm.sendOfficerMessage({
    contact: stenoContact(),
    history: [
      { from: "me", text: "STT 원문:\n이전 회의의 민감한 내용" },
      { from: "them", text: "AI 정리 초안\n이전 답변" },
    ],
    files: [],
    userText: "안녕",
  });
  const request = requests[before];

  assert.equal(result.ok, true);
  assert.equal(result.text, "반가워요. 오늘은 어떤 얘기부터 해볼까요?");
  assert.equal(request.messages.length, 2, "simple greeting should not inherit transcript history");
  assert.equal(request.messages.at(-1).content, "안녕");
  assert.equal(mcpCalls, 0);
  assert.equal(workspaceCalls, 0);
});

test("실제 STT 정리는 현재 원문만 보내고 출처 보존 규칙과 AI 초안 라벨을 적용한다", async () => {
  const transcriptRequest = [
    "아래 STT 원문을 회의록으로 정리해줘.",
    "",
    "STT 원문:",
    "[00:01:12] 화자 1: 김민수 주무관이 2026년 8월 20일 14:30까지 1,250만원 견적을 확인합니다.",
    "[00:01:25] 화자 2: 담당자는 잘 안 들리는데 금요일까지 보내 주세요.",
  ].join("\n");
  const before = requests.length;
  const result = await llm.sendOfficerMessage({
    contact: stenoContact(),
    history: [
      { from: "me", text: "이전 회의에서는 담당자가 박서연이었어." },
      { from: "them", text: "기억했습니다." },
    ],
    files: [],
    userText: transcriptRequest,
  });
  const request = requests[before];
  const system = request.messages[0].content;

  assert.equal(result.ok, true);
  assert.match(result.text, /^AI 정리 초안\n/);
  assert.deepEqual(request.messages.map((message) => message.role), ["system", "user"]);
  assert.equal(request.messages[1].content, transcriptRequest);
  assert.doesNotMatch(system, /박서연/);
  assert.match(system, /현재 속기 작업의 출처 격리 규칙/);
  assert.match(system, /숫자, 날짜, 시각, 금액, 단위, 이름, 기관명, 고유명사, 타임스탬프/);
  assert.match(system, /화자 신원은 추측하지 않습니다/);
  assert.equal(mcpCalls, 0);
  assert.equal(workspaceCalls, 0);
});

test("사용자가 녹취 비교를 명시하면 이전 대화와 로컬 문맥을 허용한다", async () => {
  const comparisonRequest = [
    "아래 STT 원문을 이전 회의록과 비교해서 달라진 점을 정리해줘.",
    "",
    "STT 원문:",
    "화자 1: 납품일은 8월 22일로 바뀌었습니다.",
  ].join("\n");
  const before = requests.length;
  const result = await llm.sendOfficerMessage({
    contact: stenoContact(),
    history: [{ from: "me", text: "이전 회의록: 납품일은 8월 20일입니다." }],
    files: [],
    userText: comparisonRequest,
  });
  const request = requests[before];
  const system = request.messages[0].content;

  assert.equal(result.ok, true);
  assert.match(result.text, /^AI 정리 초안\n/);
  assert.deepEqual(request.messages.map((message) => message.role), ["system", "user", "user"]);
  assert.match(request.messages[1].content, /이전 회의록/);
  assert.match(system, /MCP_CONTEXT_SENTINEL/);
  assert.match(system, /WORKSPACE_CONTEXT_SENTINEL/);
  assert.equal(mcpCalls, 1);
  assert.equal(workspaceCalls, 1);
});

test("회의록 정리 방법 질문은 실제 원문 작업으로 오인하지 않는다", async () => {
  const before = requests.length;
  const result = await llm.sendOfficerMessage({
    contact: stenoContact(),
    history: [],
    files: [],
    userText: "회의록 정리 원칙을 설명해 주세요.",
  });
  const request = requests[before];

  assert.equal(result.ok, true);
  assert.doesNotMatch(result.text, /^AI 정리 초안/);
  assert.equal(request.messages.at(-1).content, "회의록 정리 원칙을 설명해 주세요.");
  assert.equal(mcpCalls, 2);
  assert.equal(workspaceCalls, 2);
});

test("녹취 내용 속 비교라는 단어만으로 과거 문맥을 불러오지 않는다", async () => {
  const requestText = [
    "아래 STT 원문을 회의록으로 정리해줘.",
    "",
    "STT 원문:",
    "화자 1: 두 장비의 비교 시험 결과는 원문 표에 적어 두었습니다.",
  ].join("\n");
  const beforeMcp = mcpCalls;
  const beforeWorkspace = workspaceCalls;
  const beforeRequest = requests.length;
  const result = await llm.sendOfficerMessage({
    contact: stenoContact(),
    history: [{ from: "me", text: "다른 회의의 비교 결과" }],
    files: [],
    userText: requestText,
  });
  const request = requests[beforeRequest];

  assert.equal(result.ok, true);
  assert.match(result.text, /^AI 정리 초안\n/);
  assert.deepEqual(request.messages.map((message) => message.role), ["system", "user"]);
  assert.equal(mcpCalls, beforeMcp);
  assert.equal(workspaceCalls, beforeWorkspace);
});

test("화면의 대괄호 원문 표시는 짧은 녹취도 현재 원문 작업으로 격리한다", async () => {
  const requestText = [
    "짧게 정리해줘.",
    "",
    "[받아쓰기 원문 · Whisper 자동인식 · AI 초안 아님]",
    "오늘 3시에 점검합니다.",
  ].join("\n");
  const beforeMcp = mcpCalls;
  const beforeWorkspace = workspaceCalls;
  const beforeRequest = requests.length;
  const result = await llm.sendOfficerMessage({
    contact: stenoContact(),
    history: [{ from: "me", text: "이전 녹취의 민감한 내용" }],
    files: [],
    userText: requestText,
  });
  const request = requests[beforeRequest];

  assert.equal(result.ok, true);
  assert.match(result.text, /^AI 정리 초안\n/);
  assert.deepEqual(request.messages.map((message) => message.role), ["system", "user"]);
  assert.doesNotMatch(request.messages[0].content, /이전 녹취의 민감한 내용/);
  assert.equal(mcpCalls, beforeMcp);
  assert.equal(workspaceCalls, beforeWorkspace);
});
