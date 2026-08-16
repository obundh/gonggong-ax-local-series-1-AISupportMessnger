const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { sendOfficerMessage } = require("../app/main/llm.cjs");
const { shutdownOfficerMcp } = require("../app/main/mcp-client.cjs");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "officer-perf-results.jsonl");

const TEST_PROMPTS = {
  chief: "\ub178\ub3d9\ubc95\uc0c1 \uc5f0\ucc28\ud734\uac00\ub294 \uc5b4\ub5bb\uac8c \ub3fc? 3\ubb38\uc7a5\uc73c\ub85c \ub2f5\ud574\uc918.",
  "emp-standard": "MIL-STD-188-125\uc5d0\uc11c POE\uac00 \ubb58 \ub73b\ud558\ub294\uc9c0 3\ubb38\uc7a5\uc73c\ub85c \ub2f5\ud574\uc918.",
  translator: "Translate this naturally into Korean: The contractor shall submit the inspection report within 10 days.",
  language: "\ub2e4\uc74c \ubb38\uc7a5\uc744 \uacf5\ubb38\uccb4\ub85c \ub2e4\ub4ec\uc5b4\uc918. \uc790\ub8cc \ube68\ub9ac \ubcf4\ub0b4\uc8fc\uc138\uc694.",
  report: "\ud68c\uc758 \uacb0\uacfc\ub97c \uac1c\uc870\uc2dd \ubcf4\uace0\ubb38\uc73c\ub85c \uc815\ub9ac\ud574\uc918. \uc608\uc0b0\uc740 \ub2e4\uc74c \uc8fc \uc7ac\uac80\ud1a0, \ubcf4\uc548 \uc810\uac80\uc740 \uae08\uc694\uc77c \uc2e4\uc2dc.",
  nori: "\uc77c\ud558\uae30 \uc2eb\uc740\ub370 2\ubb38\uc7a5\uc73c\ub85c \uc815\uc2e0 \ucc28\ub9ac\uac8c \ud574\uc918.",
};

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    output: DEFAULT_OUTPUT,
    contextLevel: "low",
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") options.output = path.resolve(args[++index] || DEFAULT_OUTPUT);
    if (arg === "--context") options.contextLevel = args[++index] || options.contextLevel;
  }

  return options;
}

function loadContacts() {
  const code = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.HEYU_DATA.contacts;
}

function writeEvent(output, event) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.appendFileSync(output, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

function previewText(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

async function main() {
  const options = parseArgs();
  if (fs.existsSync(options.output)) fs.unlinkSync(options.output);

  const contacts = loadContacts().filter((contact) => TEST_PROMPTS[contact.id]);
  writeEvent(options.output, {
    type: "suite-start",
    contextLevel: options.contextLevel,
    count: contacts.length,
  });

  for (const contact of contacts) {
    const prompt = TEST_PROMPTS[contact.id];
    const startedAt = Date.now();
    writeEvent(options.output, {
      type: "start",
      id: contact.id,
      name: contact.name,
      prompt,
    });

    try {
      const result = await sendOfficerMessage({
        contact,
        history: [],
        userText: prompt,
        contextLevel: options.contextLevel,
      });
      writeEvent(options.output, {
        type: "result",
        id: contact.id,
        name: contact.name,
        ok: Boolean(result.ok),
        model: result.model,
        elapsedMs: Date.now() - startedAt,
        charCount: String(result.text || "").length,
        preview: previewText(result.text),
      });
    } catch (error) {
      writeEvent(options.output, {
        type: "error",
        id: contact.id,
        name: contact.name,
        elapsedMs: Date.now() - startedAt,
        error: error?.message || String(error),
      });
    } finally {
      shutdownOfficerMcp();
    }
  }

  writeEvent(options.output, {
    type: "suite-end",
    elapsedMs: 0,
  });
}

main().catch((error) => {
  const options = parseArgs();
  writeEvent(options.output, {
    type: "fatal",
    error: error?.message || String(error),
  });
  process.exitCode = 1;
});
