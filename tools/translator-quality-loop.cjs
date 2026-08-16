const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { sendOfficerMessage } = require("../app/main/llm.cjs");
const { shutdownOfficerMcp } = require("../app/main/mcp-client.cjs");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "translator-quality-results.jsonl");

const CASES = [
  {
    id: "contract-inspection-10-days",
    prompt: "Translate this naturally into Korean: The contractor shall submit the inspection report within 10 days.",
    expect: ["기존 한국어본", "AI 번역 초안", "계약", "검사 보고서", "10일"],
    expectAny: [["제출해야", "제출하여야", "제출함"]],
    forbid: ["10개월", "10년", "영업일", "원문에 없는"],
  },
  {
    id: "payment-usd-date",
    prompt: "다음 문장을 한국어로 번역해줘: Payment of USD 12,500 is due on March 31, 2026.",
    expect: ["기존 한국어본", "AI 번역 초안", "USD 12,500", "2026년", "3월", "31일"],
    expectAny: [["지급", "결제", "납부"]],
    forbid: ["원화", "KRW", "12,500원", "2025년"],
  },
  {
    id: "records-five-years",
    prompt: "Translate into Korean: The agency shall retain all records for five years from the date of completion.",
    expect: ["기존 한국어본", "AI 번역 초안", "기관", "기록", "5년"],
    expectAny: [["완료일", "완료일자", "완료한 날"]],
    forbid: ["5일", "5개월", "계약자"],
  },
  {
    id: "supplier-repair-replace",
    prompt: "자연스럽게 번역: The supplier shall inspect, repair, and replace defective parts at no additional cost.",
    expect: ["기존 한국어본", "AI 번역 초안", "공급", "점검", "수리", "교체"],
    expectAny: [["추가 비용 없이", "추가 비용을 부담하지 않고", "추가 비용 없이"]],
    forbid: ["유상", "추가 비용을 청구", "10일"],
  },
  {
    id: "short-term-tbd",
    prompt: "TBD 뜻이 뭐야?",
    expectAny: [["미정", "추후 결정", "추후 확정"], ["문맥", "상황"]],
    forbid: ["번역할 원문이 부족", "원문을 제공", "제출해야"],
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

function loadTranslatorContact() {
  const code = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.HEYU_DATA.contacts.find((contact) => contact.id === "translator");
}

function writeEvent(output, event) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.appendFileSync(output, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

function validate(testCase, result) {
  const failures = [];
  const text = String(result?.text || "");
  if (!result?.ok) failures.push("not ok");
  if (text.length < 50) failures.push("too short");
  if (text.length > 1800) failures.push("too long");
  if (/^\s*안녕하세요/.test(text)) failures.push("starts with greeting");
  if (/\*\*|```|^\s*\|.*\|\s*$/m.test(text)) failures.push("markdown formatting");

  for (const needle of testCase.expect || []) {
    if (!text.includes(needle)) failures.push(`missing: ${needle}`);
  }
  for (const choices of testCase.expectAny || []) {
    if (!choices.some((needle) => text.includes(needle))) failures.push(`missing any: ${choices.join(" | ")}`);
  }
  for (const needle of testCase.forbid || []) {
    if (text.includes(needle)) failures.push(`forbidden: ${needle}`);
  }
  return failures;
}

function preview(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 500);
}

async function main() {
  const options = parseArgs();
  if (fs.existsSync(options.output)) fs.unlinkSync(options.output);
  const contact = loadTranslatorContact();
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
