"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const Module = require("node:module");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const LLM_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "llm.cjs"));
const MCP_CLIENT_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "mcp-client.cjs"));
const WORKSPACE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "workspace-tools.cjs"));
const GRAPH_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "graph-tools.cjs"));
const PRESENTATION_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "presentation-tools.cjs"));
const IMAGE_TOOLS_PATH = require.resolve(path.join(ROOT_DIR, "app", "main", "image-tools.cjs"));
const CONTACT_DATA_PATH = path.join(ROOT_DIR, "app", "renderer", "data.js");

const ENV_NAMES = [
  "HEYU_LLM_PROVIDER",
  "HEYU_LLM_BASE_URL",
  "HEYU_LLM_MODEL",
  "HEYU_LLM_TIMEOUT_MS",
  "HEYU_LLM_API_KEY",
];
const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
const CACHE_PATHS = [LLM_PATH, MCP_CLIENT_PATH, WORKSPACE_TOOLS_PATH, GRAPH_TOOLS_PATH, PRESENTATION_TOOLS_PATH, IMAGE_TOOLS_PATH];
const originalCache = new Map(CACHE_PATHS.map((filename) => [filename, require.cache[filename]]));
const productionExtractLegalTerminologyTerms = require(MCP_CLIENT_PATH).extractLegalTerminologyTerms;

const modelRequests = [];
const mcpCalls = [];
let modelServer;
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

function localLawContext(userText) {
  if (String(userText).includes("소취, 통신영장, 약명, 공소취소, 부제소합의")) {
    const resolutions = [
      { rawLabel: "소취", status: "corpus-candidate", formalNames: [], candidateFormalNames: ["소 취하"] },
      { rawLabel: "통신영장", status: "unresolved", formalNames: [], candidateFormalNames: [] },
      { rawLabel: "약명", status: "unresolved", formalNames: [], candidateFormalNames: [] },
      { rawLabel: "공소취소", status: "exact", formalNames: ["공소취소"], candidateFormalNames: ["공소취소"] },
      { rawLabel: "부제소합의", status: "corpus-candidate", formalNames: [], candidateFormalNames: [] },
    ];
    return [
      "법령 근거 경로: 로컬 김법률 MCP",
      "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
      "로컬 MCP 상태: 성공",
      "명시적 용어 목록 처리: 5건 (원래 표기를 보존해 각 용어를 개별 조회함)",
      ...resolutions.map((item, index) => `${index + 1}. untrusted_term_resolution_json=${JSON.stringify(item)}`),
      `- untrusted_practice_json=${JSON.stringify({
        matchedKey: "소취", formalName: "소 취하", confidence: "중간",
        meaning: "원고가 제기한 소송을 철회하는 소송행위",
      })}`,
      `- untrusted_official_term_json=${JSON.stringify({
        matchedKey: "공소취소", formalName: "공소취소", term: "공소취소",
        confidence: "official-list-exact", matchKind: "query-exact", definitionStatus: "not-in-list-pack",
      })}`,
      `- untrusted_term_evidence_json=${JSON.stringify({ rawLabel: "소취", target: "prec", directPhraseMatch: true })}`,
      `- untrusted_term_evidence_json=${JSON.stringify({ rawLabel: "부제소합의", target: "prec", directPhraseMatch: true })}`,
      "제한: 문맥 후보와 중간 신뢰 후보는 뜻이나 정식명칭으로 확정하지 않습니다.",
    ].join("\n");
  }
  if (String(userText).trim() === "약명 뜻이 뭐야?") {
    return [
      "법령 근거 경로: 로컬 김법률 MCP",
      "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
      "로컬 MCP 상태: 성공",
      "명시적 용어 목록 처리: 1건 (원래 표기를 보존해 각 용어를 개별 조회함)",
      `1. untrusted_term_resolution_json=${JSON.stringify({
        rawLabel: "약명", status: "unresolved", formalNames: [], candidateFormalNames: [],
        practiceMatchCount: 0, officialMatchCount: 0, corpusCandidateCount: 0, relatedCorpusCandidateCount: 2,
      })}`,
      `- untrusted_term_evidence_json=${JSON.stringify({
        rawLabel: "약명", target: "law", directPhraseMatch: false, matchQuality: "related",
      })}`,
      "제한: 미해결 용어는 새 뜻을 만들지 않습니다.",
    ].join("\n");
  }
  if (String(userText).includes("빈 검색")) {
    return [
      "법령 근거 경로: 로컬 김법률 MCP",
      "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
      "로컬 MCP 상태: 성공",
      "로컬 법률 자료 상태: 설치됨 (법령; 검색 후보 0건)",
      "제한: 로컬 자료에서 직접 근거를 찾지 못했으므로 조문·금액·기간·요건을 추정으로 단정하지 않습니다.",
      "후보 근거:",
      "- 직접 일치하는 로컬 근거를 찾지 못했습니다.",
    ].join("\n");
  }
  if (String(userText).includes("민법 제750조")) {
    return [
      "법령 근거 경로: 로컬 김법률 MCP",
      "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
      "로컬 MCP 상태: 성공",
      "로컬 법률 자료 상태: 설치됨 (법령; 검색 후보 1건)",
      "근거 사용 규칙: 아래 로컬 상세 원문에 '요청 조문: ... (확인됨)'이 있으면 해당 조문이 없거나 제공되지 않았다고 말하지 않습니다.",
      "확인된 로컬 상세 원문:",
      "요청 조문: 750 (확인됨)",
      'untrusted_body_json="제750조(불법행위의 내용) 고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다."',
      "제한: 아래 내용은 설치된 로컬 자료의 후보입니다. 원문과 로컬 동기화 시점을 함께 확인합니다.",
      'untrusted_evidence_json={"target":"law","title":"민법","articleNo":"750","snippet":"제750조 불법행위의 내용","retrievedAt":"2030-01-01T00:00:00.000Z"}',
    ].join("\n");
  }
  return [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    "로컬 법률 자료 상태: 설치됨 (법령; 검색 후보 1건)",
    "제한: 아래 내용은 설치된 로컬 자료의 후보입니다. 원문과 로컬 동기화 시점을 함께 확인합니다.",
    "후보 근거:",
    '1. untrusted_evidence_json={"target":"law","title":"근로기준법","articleNo":"17","snippet":"제17조 근로조건 명시 관련 로컬 시험 근거","retrievedAt":"2030-01-01T00:00:00.000Z"}',
  ].join("\n");
}

async function readJsonRequest(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function modelAnswer(payload) {
  const system = String(payload.messages?.[0]?.content || "");
  const user = String(payload.messages?.at(-1)?.content || "");
  if (system.includes("김법률 직접 근거 없음 재작성기")) {
    return [
      "1차 답변",
      "설치된 로컬 자료에서 질문에 직접 일치하는 근거 후보를 찾지 못해 법률 결론을 단정하지 않겠습니다.",
      "",
      "근거",
      "로컬 MCP 검색 결과에 직접 확인된 근거가 없습니다.",
      "",
      "확인 필요 사항",
      "확인하려는 쟁점과 적용 사실관계를 조금 더 구체적으로 알려 주세요.",
    ].join("\n");
  }
  if (system.includes("김법률 답변 재작성기")) {
    if (system.includes("요청 조문: 750 (확인됨)")) {
      return [
        "1차 답변",
        "민법 제750조의 로컬 원문에는 고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자가 그 손해를 배상할 책임이 있다고 적혀 있습니다.",
        "",
        "근거",
        "설치된 로컬 민법 제750조 원문에서 고의 또는 과실, 위법행위, 타인의 손해, 손해배상 책임을 직접 확인했습니다.",
        "",
        "확인 필요 사항",
        "구체적 사안에서는 실제 행위와 손해가 위 조문 문구에 해당하는지 사실관계를 대조해야 합니다.",
      ].join("\n");
    }
    return [
      "1차 답변",
      "로컬 근거 후보에서 근로조건 명시에 관한 조문 후보를 확인했습니다. 구체적 적용은 질문의 계약 체결 상황을 함께 대조해야 합니다.",
      "",
      "근거",
      "로컬 법령 자료의 근로기준법 제17조 후보에 근로조건 명시 관련 문구가 포함되어 있습니다. 이 범위를 넘어선 벌칙이나 기간은 제시하지 않습니다.",
      "",
      "확인 필요 사항",
      "로컬 동기화 일자와 조문 전체 원문, 실제 계약 체결 시점과 교부 사실을 확인해야 합니다.",
    ].join("\n");
  }
  if (user === "안녕") return "반갑습니다. 오늘은 어떤 이야기를 나눠볼까요?";
  if (user.includes("소취, 통신영장, 약명, 공소취소, 부제소합의")) {
    return [
      "1차 답변",
      "소취: 실무 사전에서 '소 취하'로 확인되며, 원고가 제기한 소송을 철회하는 소송행위를 의미합니다.",
      "통신영장: 제공된 로컬 자료에서는 정의나 정식명칭을 확인할 수 없습니다.",
      "약명: 제공된 로컬 자료에서는 정의나 정식명칭을 확인할 수 없습니다.",
      "공소취소: 공식 목록 표제어는 공소취소지만 정의 본문은 미수록되어 뜻은 확인할 수 없습니다.",
      "부제소합의: 로컬 문맥 후보만 있어 뜻이나 정식명칭을 확정하지 않습니다.",
      "근거와 확인 필요 사항은 각 용어별 로컬 판정 범위에서 구분합니다.",
    ].join("\n");
  }
  if (user === "약명 뜻이 뭐야?") {
    return "약명은 의약품의 이름입니다. 상품명과 일반명으로 나뉘며 약국에서 부르는 특정 약의 이름이라고 확정할 수 있습니다. 이 설명은 충분히 자세한 일반 지식입니다.";
  }
  if (user.includes("빈 검색")) {
    return "민법 제999조에 따라 언제나 반드시 위법하고 손해배상 책임이 확정됩니다. 다른 사실관계나 근거 확인은 필요하지 않습니다.";
  }
  if (user.includes("민법 제750조")) {
    return "제공해주신 자료 중 민법 제750조에 대한 구체적인 조문 내용은 포함되어 있지 않습니다. 따라서 일반적인 법적 원칙에 근거하면 고의 또는 과실, 위법행위, 손해, 인과관계를 검토해야 하며 손해배상 책임이 문제될 수 있습니다.";
  }
  return "확인했습니다.";
}

const chiefContact = {
  id: "chief",
  name: "김법률",
  department: "Ai지원담당",
  description: "법률지원",
  persona: {
    speechStyle: "formal",
    systemPrompt: "김법률 테스트 페르소나입니다. 확인된 로컬 근거만 사용합니다.",
    character: "차분하고 정중한 법률지원 담당입니다.",
  },
};

test.before(async () => {
  installModuleStub(MCP_CLIENT_PATH, {
    buildOfficerMcpContext: async (_contact, userText) => {
      mcpCalls.push(String(userText || ""));
      return localLawContext(userText);
    },
    extractLegalTerminologyTerms: productionExtractLegalTerminologyTerms,
  });
  installModuleStub(WORKSPACE_TOOLS_PATH, { buildWorkspaceMcpContext: async () => "" });
  installModuleStub(GRAPH_TOOLS_PATH, { buildGraphOfficerReply: async () => ({ ok: true, text: "unused" }) });
  installModuleStub(PRESENTATION_TOOLS_PATH, { buildPresentationOfficerReply: async () => ({ ok: true, text: "unused" }) });
  installModuleStub(IMAGE_TOOLS_PATH, {
    buildImageGenerationArtifact: async () => ({ status: "unused" }),
    checkImageGenerationCapability: async () => ({ available: false }),
  });

  modelServer = http.createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "unexpected endpoint" }));
      return;
    }
    const payload = await readJsonRequest(request);
    modelRequests.push(payload);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ choices: [{ message: { content: modelAnswer(payload) } }] }));
  });
  await new Promise((resolve, reject) => {
    modelServer.once("error", reject);
    modelServer.listen(0, "127.0.0.1", resolve);
  });
  const address = modelServer.address();
  process.env.HEYU_LLM_PROVIDER = "openai-compatible";
  process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.HEYU_LLM_MODEL = "chief-local-persona-test";
  process.env.HEYU_LLM_TIMEOUT_MS = "3000";
  delete process.env.HEYU_LLM_API_KEY;

  delete require.cache[LLM_PATH];
  llm = require(LLM_PATH);
});

test.after(async () => {
  if (modelServer) await new Promise((resolve) => modelServer.close(resolve));
  restoreProcessState();
});

test("김법률과 김행정 연락처는 폐쇄망 로컬 MCP를 설명한다", () => {
  const source = fs.readFileSync(CONTACT_DATA_PATH, "utf8");
  const chiefStart = source.indexOf('id: "chief"');
  const adminStart = source.indexOf('id: "admin-officer"');
  const chief = source.slice(chiefStart, adminStart);
  const admin = source.slice(adminStart, source.indexOf('id: "translator"'));

  assert.match(chief, /로컬 김법률 MCP/);
  assert.match(chief, /폐쇄망 전용/);
  assert.match(chief, /단순 인사, 일상 대화, 역할이나 기능 질문/);
  assert.match(chief, /직접 확인되지 않은 조문 번호, 금액, 비율, 기간, 요건/);
  assert.doesNotMatch(chief, /국가법령정보센터 실시간 조회|로컬 법률 자료 폴백|공동활용 Open API/);
  assert.match(admin, /로컬 김법률 MCP/);
  assert.match(admin, /폐쇄망 전용/);
  assert.match(admin, /외부 네트워크나 실시간 법령 조회를 사용하지 않고/);
  assert.doesNotMatch(admin, /국가법령정보센터 실시간 조회|로컬 행정자료 폴백|공동활용 Open API|LAW_OC/);
});

test("김법률의 단순 인사는 MCP 검색이나 법률 검토 양식을 강제하지 않는다", async () => {
  mcpCalls.length = 0;
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({ contact: chiefContact, history: [], files: [], userText: "안녕" });
  const requests = modelRequests.slice(before);

  assert.equal(result.ok, true);
  assert.equal(mcpCalls.length, 0);
  assert.equal(requests.length, 1);
  assert.match(requests[0].messages[0].content, /김법률 일상 대화 규칙/);
  assert.doesNotMatch(requests[0].messages[0].content, /법령 근거 경로: 로컬 김법률 MCP/);
  assert.equal(result.text, "반갑습니다. 오늘은 어떤 이야기를 나눠볼까요?");
  assert.doesNotMatch(result.text, /법령 근거 경로|로컬 MCP 상태|1차 답변|확인 필요 사항/);
});

test("단일 용어 질문은 query rewrite 없이 structured MCP 판정을 거쳐 환각을 안전 fallback으로 교체한다", async () => {
  mcpCalls.length = 0;
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({
    contact: chiefContact,
    history: [],
    files: [],
    userText: "약명 뜻이 뭐야?",
  });
  const requests = modelRequests.slice(before);

  assert.equal(result.ok, true);
  assert.deepEqual(mcpCalls, ["약명 뜻이 뭐야?"], "terminology query was rewritten before local MCP routing");
  assert.equal(requests.length, 1, "the configured model should be called once before deterministic post-validation fallback");
  assert.ok(requests[0].messages.some((message) => message.role === "user" && message.content === "약명 뜻이 뭐야?"));
  assert.match(result.text, /^법령 근거 경로: 로컬 김법률 MCP/);
  assert.match(result.text, /약명.*직접 일치하는 뜻과 정식명칭을 확인하지 못했습니다/);
  assert.match(result.text, /구조화 판정만 사용했습니다/);
  assert.doesNotMatch(result.text, /의약품|상품명|일반명/);
});

test("다중 용어의 medium 후보 과확정은 다음 항목 caveat로 통과하지 않고 send 경로에서 안전 fallback된다", async () => {
  mcpCalls.length = 0;
  const query = "소취, 통신영장, 약명, 공소취소, 부제소합의 각각 뜻과 정식 명칭 알려줘";
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({ contact: chiefContact, history: [], files: [], userText: query });
  const requests = modelRequests.slice(before);

  assert.equal(result.ok, true);
  assert.deepEqual(mcpCalls, [query]);
  assert.equal(requests.length, 2, "bad first answer should be repaired once before deterministic fallback");
  assert.ok(requests[0].messages.some((message) => message.role === "user" && message.content === query));
  assert.match(JSON.stringify(requests[1].messages), /미확정 후보를 정식명칭으로 확정함: 소취/);
  for (const label of ["소취", "통신영장", "약명", "공소취소", "부제소합의"]) assert.ok(result.text.includes(label));
  assert.match(result.text, /소취.*후보 표기는 소 취하이지만 확정명이 아닙니다/);
  assert.match(result.text, /구조화 판정만 사용했습니다/);
  assert.doesNotMatch(result.text, /소송을 철회하는 소송행위|소 취하로 확인되며/);
});

test("김법률의 법률 답변과 재작성기는 로컬 MCP 근거만 사용하고 로컬 source marker를 보존한다", async () => {
  mcpCalls.length = 0;
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({
    contact: chiefContact,
    history: [],
    files: [],
    userText: "근로기준법 제17조의 근로조건 명시 기준을 검토해 주세요.",
  });
  const requests = modelRequests.slice(before);

  assert.equal(result.ok, true);
  assert.equal(mcpCalls.length, 1);
  assert.equal(requests.length, 2, "짧은 첫 응답은 한 번만 로컬 근거 재작성을 거쳐야 한다");
  assert.match(requests[0].messages[0].content, /법령 근거 경로: 로컬 김법률 MCP/);
  assert.match(requests[1].messages[0].content, /로컬 MCP 근거 후보만 사용/);
  assert.doesNotMatch(requests[1].messages[0].content, /국가법령정보센터 실시간 조회|로컬 법률 자료 폴백/);
  assert.match(result.text, /^법령 근거 경로: 로컬 김법률 MCP\n폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음\n로컬 MCP 상태: 성공/);
  assert.match(result.text, /근로기준법 제17조/);
  assert.doesNotMatch(result.text, /국가법령정보센터 실시간 조회|로컬 법률 자료 폴백/);
});

test("로컬 MCP에 직접 근거가 없으면 모델의 자신 있는 법률 단정을 폐기한다", async () => {
  mcpCalls.length = 0;
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({
    contact: chiefContact,
    history: [],
    files: [],
    userText: "빈 검색의 법적 결론을 알려줘.",
  });
  const requests = modelRequests.slice(before);

  assert.equal(result.ok, true);
  assert.equal(mcpCalls.length, 1);
  assert.equal(requests.length, 2, "근거 없는 첫 응답은 같은 로컬 모델의 근거 없음 재작성을 거쳐야 한다");
  assert.match(requests[1].messages[0].content, /김법률 직접 근거 없음 재작성기/);
  assert.match(requests[1].messages[0].content, /모델의 사전 지식으로 법률 내용을 답하지 않습니다/);
  assert.match(result.text, /^법령 근거 경로: 로컬 김법률 MCP/);
  assert.match(result.text, /직접 일치하는 근거 후보를 찾지 못해/);
  assert.match(result.text, /직접 확인된 근거가 없습니다/);
  assert.doesNotMatch(result.text, /제999조|언제나 반드시 위법|손해배상 책임이 확정/);
});

test("확인된 로컬 조문을 없다고 답하면 같은 로컬 모델로 근거 기반 재작성한다", async () => {
  mcpCalls.length = 0;
  const before = modelRequests.length;
  const result = await llm.sendOfficerMessage({
    contact: chiefContact,
    history: [],
    files: [],
    userText: "민법 제750조 원문을 기준으로 불법행위 책임을 설명해 주세요.",
  });
  const requests = modelRequests.slice(before);

  assert.equal(result.ok, true);
  assert.equal(mcpCalls.length, 1);
  assert.equal(requests.length, 2, "확인된 조문을 부정한 첫 답변은 근거 재작성을 거쳐야 한다");
  assert.match(JSON.stringify(requests[1].messages), /확인된 로컬 조문을 없다고 설명함/);
  assert.match(requests[1].messages[0].content, /요청 조문: 750 \(확인됨\)/);
  assert.match(result.text, /민법 제750조/);
  assert.match(result.text, /고의 또는 과실/);
  assert.doesNotMatch(result.text, /조문 내용은 포함되어 있지|일반적인 법적 원칙에 근거/);
});
