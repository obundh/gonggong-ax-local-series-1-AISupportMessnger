const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const LLM_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "llm.cjs"));
const LOCAL_DATA_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "local-data-tools.cjs"));
const MCP_CLIENT_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "mcp-client.cjs"));
const WORKSPACE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "workspace-tools.cjs"));
const GRAPH_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "graph-tools.cjs"));
const PRESENTATION_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "presentation-tools.cjs"));
const IMAGE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "image-tools.cjs"));
const MODEL_NAME = "regression-model:configured";
const MODEL_REPLY = [
  "MODEL_PATH_SENTINEL",
  "1차 답변",
  "1. 확인 필요 - 모의 OpenAI 호환 모델이 요청을 처리했습니다.",
  "2. 확인 필요 - 모의 OpenAI 호환 모델이 요청을 처리했습니다.",
  "3. 확인 필요 - 모의 OpenAI 호환 모델이 요청을 처리했습니다.",
  "4. 확인 필요 - 모의 OpenAI 호환 모델이 요청을 처리했습니다.",
  "적용 기준",
  "테스트 응답입니다.",
  "실무 처리",
  "테스트 응답입니다.",
  "검토의견",
  "테스트 응답입니다.",
  "확인 필요 사항",
  "테스트 응답입니다.",
].join("\n");

const ENV_NAMES = [
  "HEYU_LLM_PROVIDER",
  "HEYU_LLM_BASE_URL",
  "HEYU_LLM_MODEL",
  "HEYU_LLM_TIMEOUT_MS",
  "HEYU_LLM_API_KEY",
];
const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
const originalCache = new Map([
  [LLM_PATH, require.cache[LLM_PATH]],
  [MCP_CLIENT_PATH, require.cache[MCP_CLIENT_PATH]],
  [WORKSPACE_TOOLS_PATH, require.cache[WORKSPACE_TOOLS_PATH]],
  [GRAPH_TOOLS_PATH, require.cache[GRAPH_TOOLS_PATH]],
  [PRESENTATION_TOOLS_PATH, require.cache[PRESENTATION_TOOLS_PATH]],
  [IMAGE_TOOLS_PATH, require.cache[IMAGE_TOOLS_PATH]],
]);

let server;
let llm;
const modelRequests = [];

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

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

test.before(async () => {
  server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
        response.writeHead(404, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: "unexpected mock endpoint" }));
        return;
      }

      const payload = await readJsonRequest(request);
      modelRequests.push(payload);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ choices: [{ message: { content: MODEL_REPLY } }] }));
    } catch (error) {
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: String(error?.message || error) }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  process.env.HEYU_LLM_PROVIDER = "openai-compatible";
  process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.HEYU_LLM_MODEL = MODEL_NAME;
  process.env.HEYU_LLM_TIMEOUT_MS = "3000";
  delete process.env.HEYU_LLM_API_KEY;

  // Keep this test hermetic: officer context assembly is not under test and may
  // otherwise start MCP subprocesses or inspect the developer's workspace.
  installModuleStub(MCP_CLIENT_PATH, {
    buildOfficerMcpContext: async () => "",
    extractLegalTerminologyTerms: () => [],
  });
  installModuleStub(WORKSPACE_TOOLS_PATH, {
    buildWorkspaceMcpContext: async () => "",
  });
  installModuleStub(GRAPH_TOOLS_PATH, {
    buildGraphOfficerReply: async () => ({ ok: true, model: "graph-tool", text: "graph tool test stub" }),
  });
  installModuleStub(PRESENTATION_TOOLS_PATH, {
    buildPresentationOfficerReply: async () => ({ ok: true, model: MODEL_NAME, text: MODEL_REPLY }),
  });
  installModuleStub(IMAGE_TOOLS_PATH, {
    buildImageGenerationArtifact: async () => ({ status: "test-stub" }),
  });
  delete require.cache[LLM_PATH];
  llm = require(LLM_PATH);
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
  restoreProcessState();
});

test("llm runtime contains no deterministic conversational shortcut or benchmark answer", () => {
  const source = [
    fs.readFileSync(LLM_PATH, "utf8"),
    fs.readFileSync(LOCAL_DATA_TOOLS_PATH, "utf8"),
  ].join("\n");
  const forbiddenRuntimePatterns = [
    /local-deterministic/i,
    /parseDeterministicReplyFromContext/,
    /extractDeterministicReply/,
    /buildDirectDeterministicReply/,
    /parseAdminProcurementExperimentReply/,
    /B업체 RF 케이블\/어댑터 세트는 부가세 포함/,
    /선납품ㆍ사후계약/,
    /applyEmpMinimumTerms/,
    /buildIeee299FallbackAnswer/,
    /normalizeTranslatorTerms/,
    /IEEE 299는 장비 EMP 내성시험 자체가 아니라/,
    /POE\(Point-of-Entry, 차폐 경계/,
    /shall inspect, repair, and replace/,
  ];

  for (const pattern of forbiddenRuntimePatterns) {
    assert.ok(!pattern.test(source), `forbidden deterministic runtime code remains: ${pattern}`);
  }
});

test("all conversational officers reach the configured model before returning", async () => {
  const procurementBenchmark = [
    "전자파 측정 실험용 B업체 RF 케이블/어댑터 세트는 부가세 포함 330만원입니다.",
    "C업체 소프트웨어 라이선스는 부가세 포함 770만원이고 단독공급확인서 초안만 있습니다.",
    "6월 18일 먼저 납품받고 6월 21일 계약서류와 지출서류를 정리하려고 합니다.",
    "같은 시내 시험기관에 13:00~17:30 관용차로 공무원 2명이 출장합니다.",
    "각 항목을 가능 / 조건부 가능 / 곤란 / 확인 필요로 판정해 주세요.",
  ].join("\n");
  const cases = [
    { id: "chief", name: "김법률", userText: "근로계약서 미작성 시 적용 기준을 검토해 주세요." },
    { id: "translator", name: "김국어", userText: "TBD의 뜻을 문맥에 맞게 설명해 주세요." },
    { id: "file-converter", name: "김병환", userText: "PDF 변환 절차를 간단히 안내해 주세요." },
    { id: "language", name: "김언심", userText: "이 문장을 공문서 문체로 다듬는 원칙을 알려 주세요." },
    { id: "image-officer", name: "김그림", userText: "이미지 브리프 작성 원칙을 설명해 주세요." },
    { id: "steno-officer", name: "김속기", userText: "회의록 정리 원칙을 설명해 주세요." },
    { id: "resource-officer", name: "김자원", userText: "문서 자원 추출 원칙을 설명해 주세요." },
    { id: "privacy-officer", name: "김개보", userText: "개인정보 점검 원칙을 설명해 주세요." },
    { id: "routine-officer", name: "김루틴", userText: "안전한 반복 작업 설계 원칙을 설명해 주세요." },
    { id: "nori", name: "김노리", userText: "오늘 가볍게 이야기할 주제를 골라 줘." },
    // Keep the known regression last so the preceding cases still exercise
    // their model paths when this test is run against the pre-fix runtime.
    { id: "admin-officer", name: "김행정", userText: procurementBenchmark },
  ];
  const cannedFragments = [
    "B업체 RF 케이블/어댑터 세트는 부가세 포함",
    "선납품ㆍ사후계약",
    "local-deterministic",
  ];

  for (const item of cases) {
    const before = modelRequests.length;
    const result = await llm.sendOfficerMessage({
      contact: {
        id: item.id,
        name: item.name,
        persona: {
          speechStyle: item.id === "nori" ? "casual" : "formal",
          systemPrompt: `${item.name} 테스트 페르소나입니다.`,
        },
      },
      history: [],
      files: [],
      userText: item.userText,
    });
    const calls = modelRequests.slice(before);

    assert.equal(result.ok, true, `${item.id} should return the mock model response`);
    assert.equal(result.model, MODEL_NAME, `${item.id} should report the configured model`);
    assert.doesNotMatch(result.model, /local-deterministic/i);
    if (item.id === "admin-officer") {
      assert.match(
        result.text,
        /공식 근거가 없어|관련 본문과 일치하는 로컬 행정자료를 확인하지 못했습니다/,
        "admin-officer should replace an ungrounded model answer with the generic grounding guard"
      );
      assert.doesNotMatch(result.text, /2천만원|1인\s*1만원|추정가격\s*300만원/);
    } else {
      assert.match(result.text, /MODEL_PATH_SENTINEL/, `${item.id} should return content produced by the model path`);
    }
    assert.ok(calls.length >= 1, `${item.id} returned before calling the configured model endpoint`);
    assert.ok(
      calls.some(
        (call) =>
          call.model === MODEL_NAME &&
          Array.isArray(call.messages) &&
          call.messages.some((message) => message.role === "user" && message.content === item.userText)
      ),
      `${item.id} did not send the original user request to the configured model`
    );
    for (const fragment of cannedFragments) {
      assert.ok(!result.text.includes(fragment), `${item.id} returned canned fragment: ${fragment}`);
    }
  }
});
