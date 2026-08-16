"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const {
  buildOfficerMcpContext,
  shutdownOfficerMcp,
} = require("../app/main/mcp-client.cjs");
const {
  getLocalModelRuntimeConfig,
  sendOfficerMessage,
  setRuntimeSelectedModel,
  __test: { legalOutputIssues },
} = require("../app/main/llm.cjs");

const DEFAULT_MODEL = "gemma4:e4b";
const ROOT = path.resolve(__dirname, "..");
const CASES = Object.freeze([
  {
    id: "five-term-list",
    query: "소취, 통신영장, 약명, 공소취소, 부제소합의 각각 뜻과 정식 명칭 알려줘",
    labels: ["소취", "통신영장", "약명", "공소취소", "부제소합의"],
  },
  {
    id: "single-related-substring-guard",
    query: "약명 뜻이 뭐야?",
    labels: ["약명"],
  },
]);

function parseArgs(argv) {
  const options = {
    model: process.env.HEYU_QA_MODEL || DEFAULT_MODEL,
    contextOnly: false,
    includeContext: false,
    caseId: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--context-only") options.contextOnly = true;
    else if (arg === "--include-context") options.includeContext = true;
    else if (arg === "--case") options.caseId = String(argv[++index] || "").trim();
    else if (arg.startsWith("--case=")) options.caseId = arg.slice("--case=".length).trim();
    else if (arg === "--model") options.model = String(argv[++index] || "").trim();
    else if (arg.startsWith("--model=")) options.model = arg.slice("--model=".length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!options.contextOnly && !options.model) throw new Error("--model is required for model smoke testing");
  return options;
}

function isLoopbackBaseUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname.toLowerCase()) &&
      !url.username && !url.password && !url.search && !url.hash;
  } catch (_error) {
    return false;
  }
}

function parseEvidence(context, marker) {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`${escaped}=(\\{[^\\r\\n]+\\})`, "g");
  const rows = [];
  for (const match of String(context || "").matchAll(pattern)) {
    try {
      const value = JSON.parse(match[1]);
      if (value && typeof value === "object" && !Array.isArray(value)) rows.push(value);
    } catch (_error) {}
  }
  return rows;
}

function summarizeContext(context) {
  const resolutions = parseEvidence(context, "untrusted_term_resolution_json");
  const practice = parseEvidence(context, "untrusted_practice_json");
  const official = parseEvidence(context, "untrusted_official_term_json");
  const corpus = [
    ...parseEvidence(context, "untrusted_term_evidence_json"),
    ...parseEvidence(context, "untrusted_evidence_json"),
  ];
  const details = [
    ...parseEvidence(context, "untrusted_term_detail_json"),
    ...parseEvidence(context, "untrusted_body_json"),
  ];
  return {
    contextChars: context.length,
    contextSha256: crypto.createHash("sha256").update(context, "utf8").digest("hex"),
    resolutions: resolutions.map((item) => ({
      rawLabel: item.rawLabel,
      status: item.status,
      formalNames: Array.isArray(item.formalNames) ? item.formalNames : [],
      candidateFormalNames: Array.isArray(item.candidateFormalNames) ? item.candidateFormalNames : [],
      practiceMatchCount: item.practiceMatchCount,
      officialMatchCount: item.officialMatchCount,
      corpusCandidateCount: item.corpusCandidateCount,
      relatedCorpusCandidateCount: item.relatedCorpusCandidateCount,
    })),
    evidenceCounts: {
      practice: practice.length,
      official: official.length,
      corpusDirect: corpus.filter((item) => item.directPhraseMatch === true || item.matchQuality === "direct").length,
      corpusRelated: corpus.filter((item) => item.directPhraseMatch === false || item.matchQuality === "related").length,
      details: details.length,
    },
  };
}

let cachedChiefContact = null;
function chiefContact() {
  if (cachedChiefContact) return cachedChiefContact;
  const dataPath = path.join(ROOT, "app", "renderer", "data.js");
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(dataPath, "utf8"), sandbox, {
    filename: dataPath,
    timeout: 1_000,
  });
  const contact = sandbox.window?.HEYU_DATA?.contacts?.find((item) => item?.id === "chief");
  if (!contact) throw new Error("Configured chief contact was not found in app/renderer/data.js");
  cachedChiefContact = contact;
  return cachedChiefContact;
}

async function runCase(testCase, options, runtime) {
  const contextStartedAt = new Date();
  const contextStartMs = Date.now();
  const context = await buildOfficerMcpContext(chiefContact(), testCase.query, []);
  const contextCompletedAt = new Date();
  const summary = summarizeContext(context);
  const receipt = {
    id: testCase.id,
    originalQuery: testCase.query,
    labels: testCase.labels,
    contextStartedAt: contextStartedAt.toISOString(),
    contextCompletedAt: contextCompletedAt.toISOString(),
    contextElapsedMs: Date.now() - contextStartMs,
    ...summary,
  };
  if (options.includeContext) receipt.rawContext = context;

  if (!options.contextOnly) {
    const answerStartedAt = new Date();
    const answerStartMs = Date.now();
    const originalFetch = global.fetch;
    const ollamaChatCalls = [];
    global.fetch = async (...args) => {
      const url = String(args[0]?.url || args[0] || "");
      const isLocalChat = /\/api\/chat(?:$|[?#])/.test(url) && /^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//i.test(url);
      const startedAt = Date.now();
      try {
        const result = await originalFetch(...args);
        if (isLocalChat) ollamaChatCalls.push({ elapsedMs: Date.now() - startedAt, status: result.status });
        return result;
      } catch (error) {
        if (isLocalChat) ollamaChatCalls.push({ elapsedMs: Date.now() - startedAt, error: error?.code || error?.name || "FETCH_FAILED" });
        throw error;
      }
    };
    let response;
    try {
      response = await sendOfficerMessage({
        contact: chiefContact(),
        history: [],
        userText: testCase.query,
        files: [],
      });
    } finally {
      global.fetch = originalFetch;
    }
    receipt.answerStartedAt = answerStartedAt.toISOString();
    receipt.answerCompletedAt = new Date().toISOString();
    receipt.answerElapsedMs = Date.now() - answerStartMs;
    receipt.ok = response.ok;
    receipt.model = response.model;
    receipt.rawAnswer = response.text;
    receipt.ollamaChatCalls = ollamaChatCalls;
    receipt.llmElapsedMs = ollamaChatCalls.reduce((total, call) => total + call.elapsedMs, 0);
    receipt.nonLlmAnswerPipelineMs = Math.max(0, receipt.answerElapsedMs - receipt.llmElapsedMs);
    receipt.totalCaseElapsedMs = receipt.contextElapsedMs + receipt.answerElapsedMs;
    receipt.deterministicSafetyFallbackUsed = /(?:구조화 판정만 사용했습니다|모델 지식이나 외부 조회로 빈 부분을 보충하지 않았습니다)/.test(String(response.text || ""));
    receipt.answerChecks = {
      sourceHeaderPresent: String(response.text || "").startsWith("법령 근거 경로: 로컬 김법률 MCP"),
      allOriginalLabelsPresent: testCase.labels.every((label) => String(response.text || "").includes(label)),
      internalEvidenceJsonExposed: /untrusted_[a-z_]+_json\s*=/.test(String(response.text || "")),
      outputIssues: legalOutputIssues(response.text, testCase.query, [{ role: "system", content: context }]),
    };
  } else {
    receipt.model = null;
    receipt.runtimeModel = runtime.model;
  }
  return receipt;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.contextOnly) setRuntimeSelectedModel(options.model);
  const runtime = getLocalModelRuntimeConfig();
  if (!isLoopbackBaseUrl(runtime.baseUrl)) {
    throw new Error(`Refusing non-loopback model endpoint: ${runtime.baseUrl}`);
  }
  if (!options.contextOnly && runtime.model !== options.model) {
    throw new Error(`Requested model was not selected (requested=${options.model}, runtime=${runtime.model || "<empty>"})`);
  }

  const runStartedAt = new Date();
  const receipts = [];
  const selectedCases = options.caseId ? CASES.filter((item) => item.id === options.caseId) : CASES;
  if (!selectedCases.length) throw new Error(`Unknown case: ${options.caseId}`);
  try {
    for (const testCase of selectedCases) receipts.push(await runCase(testCase, options, runtime));
  } finally {
    shutdownOfficerMcp();
  }
  const output = {
    schemaVersion: 1,
    mode: options.contextOnly ? "context-only" : "local-mcp-plus-local-model",
    networkBoundary: "loopback-only",
    provider: runtime.provider,
    baseUrl: runtime.baseUrl,
    requestedModel: options.contextOnly ? null : options.model,
    runStartedAt: runStartedAt.toISOString(),
    runCompletedAt: new Date().toISOString(),
    cases: receipts,
  };
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

main().catch((error) => {
  shutdownOfficerMcp();
  process.stderr.write(`${JSON.stringify({
    ok: false,
    error: error?.message || String(error),
    code: error?.code || "QA_E2E_FAILED",
  })}\n`);
  process.exitCode = 1;
});
