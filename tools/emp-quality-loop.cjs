const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { sendOfficerMessage } = require("../app/main/llm.cjs");
const { shutdownOfficerMcp } = require("../app/main/mcp-client.cjs");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "emp-quality-results.jsonl");

const CASES = [
  {
    id: "se-shielding-effectiveness",
    prompt: "EMP 차폐실 검토에서 SE가 뭐 뜻이야? Site Equipment 말고 표준 문맥 기준으로 짧게 답해줘.",
    expect: ["SE"],
    expectAny: [["Shielding Effectiveness", "차폐효과", "차폐 효과", "차폐성능"], ["EMP", "HEMP", "차폐"]],
    forbid: ["Site Equipment", "System Engineering", "현장 장비", "시스템 공학"],
  },
  {
    id: "poe-meaning",
    prompt: "MIL-STD-188-125 EMP 문맥에서 POE가 뭐 뜻이야? Power over Ethernet이랑 헷갈리지 말고 3문장으로 답해줘.",
    expectAny: [["Point-of-Entry", "Point of Entry", "진입점", "관통"]],
    expect: ["POE", "EMP"],
    forbid: ["전력 공급 방식입니다", "이더넷 전원 공급입니다"],
  },
  {
    id: "poe-cable-piping-check",
    prompt: "EMP 차폐 장벽에서 케이블이나 배관 POE를 검토할 때 현장 체크리스트를 짧게 잡아줘.",
    expect: ["POE", "케이블", "차폐"],
    expectAny: [["배관", "piping"], ["필터", "보호", "접지", "본딩", "SPD"]],
    forbid: ["Power over Ethernet", "IP 카메라"],
  },
  {
    id: "ieee-299-shielding",
    prompt: "IEEE 299는 EMP 차폐실 검토에서 어떤 시험이나 측정 근거로 봐야 해? 확인할 점을 알려줘.",
    expect: ["IEEE 299"],
    expectAny: [["차폐효과", "차폐 효과", "shielding effectiveness"], ["측정", "시험"]],
    forbid: ["법률", "근로기준법", "민법"],
  },
  {
    id: "spd-grounding",
    prompt: "EMP 방호에서 SPD와 접지는 같이 어떻게 봐야 해? 설비 담당자 체크 포인트로 답해줘.",
    expect: ["SPD", "접지"],
    expectAny: [["서지", "surge"], ["본딩", "등전위", "접속", "보호"]],
    forbid: ["법률", "민법", "근로기준법"],
  },
  {
    id: "hemp-e1-e2-e3",
    prompt: "HEMP E1, E2, E3 성분 차이랑 설비 검토 포인트를 아주 짧게 정리해줘.",
    expect: ["HEMP", "E1", "E2", "E3"],
    expectAny: [["빠른", "고속", "초기"], ["느린", "지자기", "장주기"]],
    forbid: ["법률", "민법", "근로기준법"],
  },
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { output: DEFAULT_OUTPUT, contextLevel: "low", limit: CASES.length };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") options.output = path.resolve(args[++index] || DEFAULT_OUTPUT);
    if (arg === "--context") options.contextLevel = args[++index] || options.contextLevel;
    if (arg === "--limit") options.limit = Number(args[++index]) || options.limit;
  }
  return options;
}

function loadEmpContact() {
  const code = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.HEYU_DATA.contacts.find((contact) => contact.id === "emp-standard");
}

function writeEvent(output, event) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.appendFileSync(output, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

function validate(testCase, result) {
  const failures = [];
  const text = String(result?.text || "");
  if (!result?.ok) failures.push("not ok");
  if (text.length < 80) failures.push("too short");
  if (text.length > 2600) failures.push("too long");
  for (const needle of testCase.expect || []) {
    if (!text.includes(needle)) failures.push(`missing: ${needle}`);
  }
  for (const choices of testCase.expectAny || []) {
    if (!choices.some((needle) => text.includes(needle))) failures.push(`missing any: ${choices.join(" | ")}`);
  }
  for (const needle of testCase.forbid || []) {
    if (text.includes(needle)) failures.push(`forbidden: ${needle}`);
  }
  if (/^\s*제\d+조/.test(text)) failures.push("article-only hallucination");
  if (/정확한 답변이 어렵|자료가 부족|맥락이 명확하지/.test(text)) failures.push("unhelpful fallback");
  return failures;
}

function preview(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

async function main() {
  const options = parseArgs();
  if (fs.existsSync(options.output)) fs.unlinkSync(options.output);
  const contact = loadEmpContact();
  const activeCases = CASES.slice(0, options.limit);
  let passed = 0;

  writeEvent(options.output, { type: "suite-start", count: activeCases.length, contextLevel: options.contextLevel });

  for (const testCase of activeCases) {
    const startedAt = Date.now();
    writeEvent(options.output, { type: "start", id: testCase.id, prompt: testCase.prompt });
    try {
      const result = await sendOfficerMessage({
        contact,
        history: [],
        userText: testCase.prompt,
        contextLevel: options.contextLevel,
      });
      const failures = validate(testCase, result);
      const ok = failures.length === 0;
      if (ok) passed += 1;
      writeEvent(options.output, {
        type: ok ? "pass" : "fail",
        id: testCase.id,
        elapsedMs: Date.now() - startedAt,
        model: result.model,
        failures,
        charCount: String(result.text || "").length,
        preview: preview(result.text),
      });
      console.log(`${ok ? "PASS" : "FAIL"} ${testCase.id} ${Date.now() - startedAt}ms ${result.model}`);
      if (!ok) {
        console.log(failures.join("; "));
        console.log(preview(result.text));
      }
    } catch (error) {
      writeEvent(options.output, {
        type: "error",
        id: testCase.id,
        elapsedMs: Date.now() - startedAt,
        error: error?.message || String(error),
      });
      console.error(`ERROR ${testCase.id}: ${error?.message || error}`);
    } finally {
      shutdownOfficerMcp();
    }
  }

  writeEvent(options.output, { type: "suite-end", passed, total: activeCases.length });
  console.log(`passed=${passed}`);
  console.log(`total=${activeCases.length}`);
  if (passed !== activeCases.length) process.exitCode = 1;
}

main().catch((error) => {
  const options = parseArgs();
  writeEvent(options.output, { type: "fatal", error: error?.message || String(error) });
  console.error(error);
  process.exitCode = 1;
});
