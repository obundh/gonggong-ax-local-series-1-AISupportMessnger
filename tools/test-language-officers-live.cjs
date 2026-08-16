const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT_DIR = path.join(__dirname, "..");
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "data.js"), "utf8"), sandbox);

const { sendOfficerMessage, setRuntimeSelectedModel } = require(path.join(ROOT_DIR, "app", "main", "llm.cjs"));
setRuntimeSelectedModel(process.env.HEYU_TEST_MODEL || "gemma4:e4b");

const cases = [
  { contactId: "translator", label: "김국어-인사", userText: "안녕" },
  { contactId: "translator", label: "김국어-번역", userText: "Please submit the final report by August 31, 2026. The approved budget is USD 12,500. 한국어로 번역해 주세요." },
  { contactId: "translator", label: "김국어-용어", userText: "TBD가 무슨 뜻이야?" },
  { contactId: "translator", label: "김국어-영문붙여넣기", userText: "The inspection shall be completed by September 15, 2026." },
  { contactId: "translator", label: "김국어-기능문의", userText: "번역 가능해?" },
  { contactId: "language", label: "김언심-인사", userText: "안녕하세요" },
  { contactId: "language", label: "김언심-문장교정", userText: "회의 자료 내일까지 보내줘. 늦으면 혼난다. 공문에 넣을 문장으로 다듬어줘." },
  { contactId: "language", label: "김언심-표현차이", userText: "재고와 제고의 뜻 차이를 공문 예문과 함께 알려줘." },
];

async function main() {
  const contacts = new Map(sandbox.window.HEYU_DATA.contacts.map((contact) => [contact.id, contact]));
  const results = [];
  const selectedCases = process.env.HEYU_TEST_CASE
    ? cases.filter((item) => item.label.includes(process.env.HEYU_TEST_CASE))
    : cases;
  for (const item of selectedCases) {
    const contact = contacts.get(item.contactId);
    if (!contact) throw new Error(`missing contact: ${item.contactId}`);
    const startedAt = Date.now();
    const result = await sendOfficerMessage({ contact, history: [], files: [], userText: item.userText });
    results.push({
      label: item.label,
      ok: result.ok,
      model: result.model,
      elapsedMs: Date.now() - startedAt,
      text: result.text,
    });
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  require(path.join(ROOT_DIR, "app", "main", "mcp-client.cjs")).shutdownOfficerMcp();
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
