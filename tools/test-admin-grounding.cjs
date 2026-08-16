"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const { EventEmitter } = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const { PassThrough, Writable } = require("node:stream");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const MCP_CLIENT_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "mcp-client.cjs"));
const LLM_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "llm.cjs"));
const LOCAL_DATA_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "local-data-tools.cjs"));
const WORKSPACE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "workspace-tools.cjs"));
const GRAPH_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "graph-tools.cjs"));
const PRESENTATION_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "presentation-tools.cjs"));
const IMAGE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "image-tools.cjs"));
const CONTACT_DATA_PATH = path.join(ROOT_DIR, "app", "renderer", "data.js");

const MODEL_NAME = "admin-local-release-model:configured";
const MODEL_SENTINEL = "ADMIN_CONFIGURED_MODEL_SENTINEL";
const LOCAL_LAW_SENTINEL = "LOCAL_LAW_MCP_SENTINEL";
const LOCAL_ADMIN_SENTINEL = "LOCAL_ADMIN_SUPPORT_SENTINEL";
const SECRET_SENTINEL = "LAW_OC_MUST_NOT_REACH_ANY_RUNTIME_CHILD";
const OFFICIAL_DECREE = "국가를 당사자로 하는 계약에 관한 법률 시행령";
const ENV_NAMES = [
  "LAW_OC",
  "HEYU_DISABLE_USER_LAW_OC",
  "HEYU_LLM_PROVIDER",
  "HEYU_LLM_BASE_URL",
  "HEYU_LLM_MODEL",
  "HEYU_LLM_TIMEOUT_MS",
  "HEYU_LLM_API_KEY",
];
const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
const CACHE_PATHS = [
  MCP_CLIENT_PATH,
  LLM_PATH,
  WORKSPACE_TOOLS_PATH,
  GRAPH_TOOLS_PATH,
  PRESENTATION_TOOLS_PATH,
  IMAGE_TOOLS_PATH,
];
const originalCache = new Map(CACHE_PATHS.map((filename) => [filename, require.cache[filename]]));

const spawnedServers = [];
const lawCalls = [];
const officeCalls = [];
const modelRequests = [];
let evidenceEnabled = true;
let modelMode = "grounded";
let mcpClient;
let llm;
let modelServer;

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

function textResult(text, structuredContent = {}) {
  return { isError: false, content: [{ type: "text", text }], structuredContent };
}

function fakeLawTool(name, args) {
  lawCalls.push({ name, args: structuredClone(args || {}) });
  if (name === "resolve_legal_term" || name === "resolve_practice_term") {
    return textResult("로컬 실무 용어 후보 없음", { matches: [], resolutionStatus: "none" });
  }
  if (name === "search_official_legal_terms") {
    return textResult("로컬 공식 용어 후보 없음", { matches: [], resolutionStatus: "none" });
  }
  if (name === "legal_search") {
    const sources = [{
      id: "law",
      label: "법령",
      available: true,
      detailCoverageComplete: true,
      listedCount: 1,
      detailCount: 1,
    }];
    const results = evidenceEnabled
      ? [{
          target: "law",
          id: "LOCAL-LAW-26",
          title: OFFICIAL_DECREE,
          excerpt: `${LOCAL_LAW_SENTINEL} 제26조 수의계약 관련 로컬 본문 후보`,
          directPhraseMatch: true,
        }]
      : [];
    return textResult(
      evidenceEnabled ? `${LOCAL_LAW_SENTINEL}: 로컬 법령 검색 후보 1건` : "로컬 법령 검색 후보 0건",
      { ok: true, mode: "local-corpus-only", live: false, sources, results, terms: ["수의계약"] }
    );
  }
  if (name === "law_get") {
    return textResult(
      [
        "로컬 법령 상세: 법령",
        `제목: ${OFFICIAL_DECREE}`,
        "요청 조문: 26 (확인됨)",
        `${LOCAL_LAW_SENTINEL} 제26조 로컬 상세 본문`,
      ].join("\n"),
      {
        ok: true,
        mode: "local-corpus-only",
        live: false,
        title: OFFICIAL_DECREE,
        text: `${LOCAL_LAW_SENTINEL} 제26조 로컬 상세 본문`,
        articleFound: true,
        keywordFound: true,
      }
    );
  }
  return { isError: true, content: [{ type: "text", text: "unknown local law tool" }], structuredContent: { error: { code: "INVALID_TARGET" } } };
}

function fakeOfficeTool(name, args) {
  officeCalls.push({ name, args: structuredClone(args || {}) });
  if (name !== "admin_law_search") {
    return { isError: true, content: [{ type: "text", text: "unknown office tool" }], structuredContent: { error: { code: "INVALID_TARGET" } } };
  }
  return textResult([
    "MCP 도구 결과: admin_law_search",
    `행정 로컬 직접 근거 상태: ${evidenceEnabled ? "확인됨" : "없음"}`,
    "김행정 전용 후보 근거:",
    ...(evidenceEnabled
      ? [`1. [법령] ${LOCAL_ADMIN_SENTINEL}: ${OFFICIAL_DECREE} 제26조 로컬 행정실무 후보`]
      : ["- 전용 범위에서 직접 일치하는 회계ㆍ계약ㆍ서무 근거를 찾지 못했습니다."]),
    "답변 지시:",
    "- 직접 근거가 없으면 법령상 결론을 만들지 않습니다.",
  ].join("\n"));
}

function createFakeMcpProcess(serverPath, options = {}) {
  const serverFolder = path.basename(path.dirname(String(serverPath || ""))).toLowerCase();
  if (serverFolder === "mcp-law-center") throw new Error("online mcp-law-center must never be spawned");
  const serverKind = serverFolder === "mcp-law" ? "law" : "office";
  spawnedServers.push({ serverFolder, env: { ...(options.env || {}) } });
  const processEmitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let inputBuffer = "";
  const stdin = new Writable({
    write(chunk, _encoding, callback) {
      inputBuffer += chunk.toString("utf8");
      const lines = inputBuffer.split(/\r?\n/);
      inputBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.id === undefined || message.id === null) continue;
        let result = {};
        if (message.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: `fake-local-${serverKind}`, version: "1.0.0" },
          };
        } else if (message.method === "tools/call") {
          const name = message.params?.name;
          const args = message.params?.arguments || {};
          result = serverKind === "law" ? fakeLawTool(name, args) : fakeOfficeTool(name, args);
        }
        setImmediate(() => stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: message.id, result })}\n`));
      }
      callback();
    },
  });
  Object.assign(processEmitter, {
    stdin,
    stdout,
    stderr,
    killed: false,
    kill() {
      if (this.killed) return false;
      this.killed = true;
      this.emit("exit", 0);
      return true;
    },
  });
  return processEmitter;
}

function compileMcpClientWithFakeProcesses() {
  const source = fs.readFileSync(MCP_CLIENT_PATH, "utf8");
  const originalLoad = Module._load;
  Module._load = function loadWithFakeChildProcess(request, parent, isMain) {
    if (parent?.filename === MCP_CLIENT_PATH && (request === "child_process" || request === "node:child_process")) {
      return { spawn: (_command, args, options) => createFakeMcpProcess(args?.[0], options) };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const compiled = new Module(MCP_CLIENT_PATH, module);
  compiled.filename = MCP_CLIENT_PATH;
  compiled.paths = Module._nodeModulePaths(path.dirname(MCP_CLIENT_PATH));
  try {
    compiled._compile(source, MCP_CLIENT_PATH);
  } finally {
    Module._load = originalLoad;
  }
  require.cache[MCP_CLIENT_PATH] = compiled;
  return compiled.exports;
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test.before(async () => {
  process.env.LAW_OC = SECRET_SENTINEL;
  mcpClient = compileMcpClientWithFakeProcesses();
  modelServer = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unexpected mock endpoint" }));
      return;
    }
    const payload = await readJsonRequest(request);
    modelRequests.push(payload);
    const lastUser = [...(payload.messages || [])].reverse().find((message) => message.role === "user")?.content || "";
    let content;
    if (/^안녕[.!?\s]*$/.test(String(lastUser))) {
      content = "안녕하세요. 오늘은 어떤 일을 같이 볼까요?";
    } else if (modelMode === "unsafe") {
      content = "1차 답변\n3천만원 이하면 수의계약이 가능합니다.\n\n적용 기준\n제99조\n\n실무 처리\n진행합니다.\n\n확인 필요 사항\n없음";
    } else {
      content = [
        MODEL_SENTINEL,
        "1차 답변",
        "확인된 로컬 본문 후보 범위에서 검토합니다.",
        "적용 기준",
        `${OFFICIAL_DECREE} 제26조 로컬 후보를 확인합니다.`,
        "실무 처리",
        "기관 구분과 내부 기준을 함께 대조합니다.",
        "확인 필요 사항",
        "로컬 자료 반입 이후 개정 여부를 확인합니다.",
      ].join("\n");
    }
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
  await new Promise((resolve, reject) => {
    modelServer.once("error", reject);
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  process.env.HEYU_LLM_PROVIDER = "openai-compatible";
  process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${modelServer.address().port}`;
  process.env.HEYU_LLM_MODEL = MODEL_NAME;
  process.env.HEYU_LLM_TIMEOUT_MS = "3000";
  delete process.env.HEYU_LLM_API_KEY;

  installModuleStub(WORKSPACE_TOOLS_PATH, { buildWorkspaceMcpContext: async () => "" });
  installModuleStub(GRAPH_TOOLS_PATH, { buildGraphOfficerReply: async () => ({ ok: true, model: "unused", text: "unused" }) });
  installModuleStub(PRESENTATION_TOOLS_PATH, { buildPresentationOfficerReply: async () => ({ ok: true, model: MODEL_NAME, text: MODEL_SENTINEL }) });
  installModuleStub(IMAGE_TOOLS_PATH, { buildImageGenerationArtifact: async () => ({ status: "unused" }) });
  delete require.cache[LLM_PATH];
  llm = require(LLM_PATH);
});

test.after(async () => {
  mcpClient?.shutdownOfficerMcp();
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
  restoreProcessState();
});

test("김행정 uses local mcp-law plus local admin support without LAW_OC or an online child", async () => {
  mcpClient.shutdownOfficerMcp();
  evidenceEnabled = true;
  spawnedServers.length = 0;
  lawCalls.length = 0;
  officeCalls.length = 0;
  const context = await mcpClient.buildOfficerMcpContext(
    { id: "admin-officer" },
    "국가계약법상 수의계약 근거를 확인해 주세요.",
    []
  );

  assert.match(context, /^행정 법령 근거 경로: 로컬 김행정 MCP/);
  assert.match(context, /폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음/);
  assert.match(context, /로컬 법률 MCP 상태: 성공/);
  assert.match(context, /로컬 법률 직접 근거 상태: 확인됨/);
  assert.match(context, /행정실무 로컬 보조 상태: 확인됨/);
  assert.match(context, new RegExp(`${LOCAL_LAW_SENTINEL}|${LOCAL_ADMIN_SENTINEL}`));
  assert.doesNotMatch(context, /실시간 조회|외부 공개 API|LAW_OC|국가법령정보센터 연결/);
  assert.ok(lawCalls.some((call) => call.name === "legal_search"));
  assert.ok(lawCalls.some((call) => call.name === "law_get"));
  assert.equal(officeCalls.filter((call) => call.name === "admin_law_search").length, 1);
  assert.deepEqual(new Set(spawnedServers.map(({ serverFolder }) => serverFolder)), new Set(["mcp-law", "mcp-office"]));
  for (const child of spawnedServers) {
    assert.equal(Object.hasOwn(child.env, "LAW_OC"), false, `${child.serverFolder} must not inherit LAW_OC`);
    assert.doesNotMatch(JSON.stringify(child.env), new RegExp(SECRET_SENTINEL));
  }
});

test("김행정 fails closed when both local evidence layers have no direct match", async () => {
  mcpClient.shutdownOfficerMcp();
  evidenceEnabled = false;
  modelMode = "unsafe";
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({
    contact: {
      id: "admin-officer",
      name: "김행정",
      persona: { speechStyle: "formal", systemPrompt: "김행정 테스트 페르소나입니다. 로컬 근거만 사용합니다." },
    },
    history: [],
    files: [],
    userText: "수의계약 가능 여부와 기준금액을 알려 주세요.",
  });

  assert.equal(result.ok, true);
  assert.equal(modelRequests.length, before + 1, "the configured model must still be called before the guard");
  assert.match(result.text, /^행정 법령 근거 경로: 로컬 김행정 MCP/);
  assert.match(result.text, /로컬 법률 직접 근거 상태: 없음/);
  assert.match(result.text, /행정실무 로컬 보조 상태: 없음/);
  assert.match(result.text, /직접 일치하는 로컬 법령ㆍ행정실무 근거를 확인하지 못했습니다/);
  assert.doesNotMatch(result.text, /3천만원|제99조|LAW_OC|실시간 조회/);
});

test("김행정 sends grounded local evidence to the configured model", async () => {
  mcpClient.shutdownOfficerMcp();
  evidenceEnabled = true;
  modelMode = "grounded";
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({
    contact: {
      id: "admin-officer",
      name: "김행정",
      persona: { speechStyle: "formal", systemPrompt: "김행정 테스트 페르소나입니다. 로컬 근거만 사용합니다." },
    },
    history: [],
    files: [],
    userText: "국가계약법상 수의계약 근거를 확인해 주세요.",
  });

  assert.equal(result.ok, true);
  assert.equal(result.model, MODEL_NAME);
  assert.equal(modelRequests.length, before + 1);
  assert.match(result.text, new RegExp(MODEL_SENTINEL));
  assert.match(result.text, /^행정 법령 근거 경로: 로컬 김행정 MCP/);
  assert.doesNotMatch(result.text, /국가법령정보센터 실시간 조회|LAW_OC|local-deterministic/);
  const request = modelRequests.at(-1);
  assert.ok(request.messages.some((message) => message.role === "system" && message.content.includes(LOCAL_LAW_SENTINEL)));
  assert.ok(request.messages.some((message) => message.role === "system" && message.content.includes(LOCAL_ADMIN_SENTINEL)));
});

test("김행정 simple chat stays natural and does not start either MCP", async () => {
  mcpClient.shutdownOfficerMcp();
  spawnedServers.length = 0;
  lawCalls.length = 0;
  officeCalls.length = 0;
  const result = await llm.sendOfficerMessage({
    contact: {
      id: "admin-officer",
      name: "김행정",
      persona: { speechStyle: "formal", systemPrompt: "김행정 테스트 페르소나입니다." },
    },
    history: [],
    files: [],
    userText: "안녕",
  });

  assert.equal(result.ok, true);
  assert.equal(result.text, "안녕하세요. 오늘은 어떤 일을 같이 볼까요?");
  assert.equal(spawnedServers.length, 0);
  assert.equal(lawCalls.length, 0);
  assert.equal(officeCalls.length, 0);
  assert.doesNotMatch(result.text, /행정 법령 근거 경로|1차 답변|확인 필요 사항/);
});

test("김행정 release sources contain no reachable online law-center or LAW_OC path", () => {
  const mcpSource = fs.readFileSync(MCP_CLIENT_PATH, "utf8");
  const llmSource = fs.readFileSync(LLM_PATH, "utf8");
  const localDataSource = fs.readFileSync(LOCAL_DATA_TOOLS_PATH, "utf8");
  const contactSource = fs.readFileSync(CONTACT_DATA_PATH, "utf8");
  assert.doesNotMatch(mcpSource, /mcp-law-center|law_center_search|LAW_OC|reg\.exe|https?:\/\//i);

  const adminPersona = contactSource.slice(
    contactSource.indexOf('id: "admin-officer"'),
    contactSource.indexOf('id: "translator"')
  );
  assert.match(adminPersona, /외부 네트워크나 실시간 법령 조회를 사용하지 않고/);
  assert.doesNotMatch(adminPersona, /국가법령정보센터 실시간 조회|외부 API/);

  const adminRepair = llmSource.slice(
    llmSource.indexOf("async function repairAdminAnswerIfNeeded"),
    llmSource.indexOf("function buildLegalRepairMessages")
  );
  assert.match(adminRepair, /행정 법령 근거 경로: 로컬 김행정 MCP/);
  assert.doesNotMatch(adminRepair, /LAW_OC|국가법령정보센터 실시간 조회|로컬 행정자료 폴백|외부 API/);

  const adminContract = llmSource.slice(
    llmSource.indexOf('if (id === "admin-officer")'),
    llmSource.indexOf('if (id === "translator")')
  );
  assert.match(adminContract, /로컬 직접 근거가 없으면/);
  assert.doesNotMatch(adminContract, /실시간 근거|실시간 조회 결과|외부 API 자료/);

  const adminLocal = localDataSource.slice(
    localDataSource.indexOf("async function buildAdminMcpContext"),
    localDataSource.indexOf("async function searchAdminEvidence")
  );
  assert.doesNotMatch(adminLocal, /실시간 조회|실시간 공식 근거|외부 API/);
  assert.match(contactSource, /법령 자료 반입/);
  assert.match(contactSource, /판례 자료 반입/);
});
