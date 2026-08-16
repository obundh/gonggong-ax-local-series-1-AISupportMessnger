"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { igniteOfficer, sendOfficerMessage } = require("../app/main/llm.cjs");
const { shutdownOfficerMcp } = require("../app/main/mcp-client.cjs");

test("김법률은 원격 LLM 주소에 질문이나 로컬 법률 근거를 보내지 않는다", async () => {
  const saved = {
    provider: process.env.HEYU_LLM_PROVIDER,
    baseUrl: process.env.HEYU_LLM_BASE_URL,
    model: process.env.HEYU_LLM_MODEL,
  };
  const originalFetch = global.fetch;
  let fetchCalls = 0;

  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("network request must not run");
  };

  try {
    for (const config of [
      { provider: "ollama", baseUrl: "http://203.0.113.10:11434" },
      { provider: "openai-compatible", baseUrl: "https://example.invalid" },
      { provider: "ollama", baseUrl: "http://localhost.evil:11434" },
      { provider: "ollama", baseUrl: "http://127.0.0.1:11434/?remote=1" },
    ]) {
      process.env.HEYU_LLM_PROVIDER = config.provider;
      process.env.HEYU_LLM_BASE_URL = config.baseUrl;
      process.env.HEYU_LLM_MODEL = "must-not-run";

      for (const run of [sendOfficerMessage, igniteOfficer]) {
        const result = await run({
          contact: { id: "chief", name: "김법률" },
          userText: "근기법 제17조를 확인해줘",
          history: [],
        });

        assert.equal(result.ok, false);
        assert.equal(result.model, "local-only");
        assert.match(result.text, /로컬 LLM만 사용할 수 있습니다/);
        assert.match(result.text, /외부 서버로 보내지 않았습니다/);
        assert.equal(result.text.includes(config.baseUrl), false);
        assert.equal(result.text.includes("근기법 제17조"), false);
      }
    }
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
    if (saved.provider === undefined) delete process.env.HEYU_LLM_PROVIDER;
    else process.env.HEYU_LLM_PROVIDER = saved.provider;
    if (saved.baseUrl === undefined) delete process.env.HEYU_LLM_BASE_URL;
    else process.env.HEYU_LLM_BASE_URL = saved.baseUrl;
    if (saved.model === undefined) delete process.env.HEYU_LLM_MODEL;
    else process.env.HEYU_LLM_MODEL = saved.model;
  }
});

test("로컬 LLM의 HTTP redirect가 질문 본문을 다른 주소로 전달하지 않는다", async () => {
  const saved = {
    provider: process.env.HEYU_LLM_PROVIDER,
    baseUrl: process.env.HEYU_LLM_BASE_URL,
    model: process.env.HEYU_LLM_MODEL,
    dataDir: process.env.HEYU_DATA_DIR,
  };
  const emptyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-chief-redirect-"));
  let redirectedRequests = 0;
  let loopbackRequests = 0;
  const redirectedServer = http.createServer((_request, response) => {
    redirectedRequests += 1;
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: "must-not-arrive" } }] }));
  });
  const redirectedAddress = await listen(redirectedServer);
  const loopbackServer = http.createServer((request, response) => {
    loopbackRequests += 1;
    request.resume();
    response.writeHead(307, { location: `http://127.0.0.1:${redirectedAddress.port}/redirected` });
    response.end();
  });
  const loopbackAddress = await listen(loopbackServer);

  try {
    process.env.HEYU_LLM_PROVIDER = "openai-compatible";
    process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${loopbackAddress.port}`;
    process.env.HEYU_LLM_MODEL = "local-redirect-test";
    process.env.HEYU_DATA_DIR = emptyDataDir;

    const result = await sendOfficerMessage({
      contact: { id: "chief", name: "김법률" },
      userText: "근로기준법 제17조의 근거를 확인해줘",
      history: [],
    });
    assert.equal(result.ok, false);
    assert.equal(loopbackRequests, 1);
    assert.equal(redirectedRequests, 0);
  } finally {
    shutdownOfficerMcp();
    await Promise.all([closeServer(loopbackServer), closeServer(redirectedServer)]);
    fs.rmSync(emptyDataDir, { recursive: true, force: true });
    restoreEnv("HEYU_LLM_PROVIDER", saved.provider);
    restoreEnv("HEYU_LLM_BASE_URL", saved.baseUrl);
    restoreEnv("HEYU_LLM_MODEL", saved.model);
    restoreEnv("HEYU_DATA_DIR", saved.dataDir);
  }
});

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address()));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
