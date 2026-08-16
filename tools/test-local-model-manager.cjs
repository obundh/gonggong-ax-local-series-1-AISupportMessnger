const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  createLocalModelManager,
  normalizeTagsResponse,
  officialDestination,
  validateModelTag,
} = require("../app/main/local-model-manager.cjs");
const {
  getLocalModelRuntimeConfig,
  setRuntimeSelectedModel,
} = require("../app/main/llm.cjs");

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ndjsonResponse(chunks, status = 200) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status, headers: { "Content-Type": "application/x-ndjson" } }
  );
}

function sampleTags(models = []) {
  return { models };
}

function model(name, overrides = {}) {
  return {
    name,
    modified_at: "2026-08-14T01:02:03Z",
    size: 4_500_000_000,
    digest: "sha256:abc123",
    details: {
      format: "gguf",
      family: "gemma",
      families: ["gemma"],
      parameter_size: "4.3B",
      quantization_level: "Q4_K_M",
    },
    ...overrides,
  };
}

test("validateModelTag accepts useful Ollama tags and rejects unsafe input", () => {
  for (const value of ["gemma3:4b", "qwen3:8b", "llama3.2:latest", "hf.co/user/repo:Q4_K_M"]) {
    assert.equal(validateModelTag(value), true, value);
  }
  for (const value of [
    "",
    " gemma3:4b",
    "gemma3:4b ",
    "gemma 3:4b",
    "gemma3;start",
    "gemma3\n:4b",
    "../model",
    "group/../model",
    "group\\model",
    "https://example.invalid/model",
    "model:",
    ":tag",
    "model:tag:extra",
  ]) {
    assert.equal(validateModelTag(value), false, JSON.stringify(value));
  }
});

test("normalizeTagsResponse preserves bounded metadata, deduplicates, and marks models", () => {
  const models = normalizeTagsResponse(
    sampleTags([
      model("qwen3:8b", {
        details: {
          parent_model: "base",
          format: "gguf",
          family: "qwen3",
          families: ["qwen3", "text"],
          parameter_size: "8.2B",
          quantization_level: "Q4_K_M",
        },
      }),
      model("mistral:7b"),
      model("qwen3:8b"),
      { name: "bad tag", size: 10 },
      null,
    ]),
    { selectedModel: "qwen3:8b", effectiveModel: "mistral:7b" }
  );

  assert.deepEqual(models.map((item) => item.name), ["mistral:7b", "qwen3:8b"]);
  const qwen = models.find((item) => item.name === "qwen3:8b");
  assert.equal(qwen.selected, true);
  assert.equal(qwen.effective, false);
  assert.equal(qwen.size, 4_500_000_000);
  assert.equal(qwen.details.parameterSize, "8.2B");
  assert.deepEqual(qwen.details.families, ["qwen3", "text"]);
  assert.equal(models.find((item) => item.name === "mistral:7b").effective, true);
});

test("officialDestination exposes only fixed Ollama HTTPS pages", () => {
  assert.equal(officialDestination("ollama-download"), "https://ollama.com/download");
  assert.equal(officialDestination("ollama-library"), "https://ollama.com/search");
  for (const input of [
    "",
    "https://ollama.com/download",
    "ollama-download?next=elsewhere",
    "file:///tmp/item",
    "javascript:alert(1)",
  ]) {
    assert.equal(officialDestination(input), null);
  }
});

test("list returns arbitrary installed model families and exact selected metadata", async () => {
  const calls = [];
  const manager = createLocalModelManager({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse(sampleTags([model("mistral:7b"), model("qwen3:8b"), model("llama3.2:latest")]));
    },
    getSelectedModel: () => "qwen3:8b",
    getConfig: () => ({ provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "" }),
  });

  const result = await manager.list();
  assert.equal(result.ok, true);
  assert.equal(result.serverReachable, true);
  assert.equal(result.engineInstalled, true);
  assert.equal(result.selectedModel, "qwen3:8b");
  assert.equal(result.effectiveModel, "qwen3:8b");
  assert.equal(result.lockedByEnvironment, false);
  assert.deepEqual(result.models.map((item) => item.name), ["llama3.2:latest", "mistral:7b", "qwen3:8b"]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://127.0.0.1:11434/api/tags");
  assert.equal(calls[0].options.method, "GET");
});

test("list resolves a configured family to an installed exact tag", async () => {
  const manager = createLocalModelManager({
    fetchImpl: async () => jsonResponse(sampleTags([model("mistral:7b"), model("qwen3:8b")])),
    getSelectedModel: () => "",
    getConfig: () => ({ provider: "ollama", model: "mistral" }),
  });
  const result = await manager.list();
  assert.equal(result.ok, true);
  assert.equal(result.effectiveModel, "mistral:7b");
  assert.equal(result.models.filter((item) => item.effective).length, 1);
});

test("list distinguishes missing Ollama, stopped service, and zero models", async (t) => {
  await t.test("missing executable", async () => {
    const manager = createLocalModelManager({
      fetchImpl: async () => {
        throw new TypeError("connection failed");
      },
      detectExecutable: async () => false,
      getConfig: () => ({ provider: "ollama" }),
    });
    assert.deepEqual(await manager.list(), {
      ok: false,
      serverReachable: false,
      engineInstalled: false,
      selectedModel: "",
      effectiveModel: "",
      lockedByEnvironment: false,
      models: [],
      errorCode: "OLLAMA_UNREACHABLE",
    });
  });

  await t.test("installed executable with stopped service", async () => {
    const manager = createLocalModelManager({
      fetchImpl: async () => {
        throw new TypeError("connection failed");
      },
      detectExecutable: async () => true,
      getConfig: () => ({ provider: "ollama", model: "qwen3:8b" }),
    });
    const result = await manager.list();
    assert.equal(result.ok, false);
    assert.equal(result.serverReachable, false);
    assert.equal(result.engineInstalled, true);
    assert.equal(result.errorCode, "OLLAMA_UNREACHABLE");
  });

  await t.test("reachable server with zero models", async () => {
    const manager = createLocalModelManager({
      fetchImpl: async () => jsonResponse(sampleTags([])),
      detectExecutable: async () => false,
      getConfig: () => ({ provider: "ollama" }),
    });
    const result = await manager.list();
    assert.equal(result.ok, true);
    assert.equal(result.serverReachable, true);
    assert.equal(result.engineInstalled, true);
    assert.deepEqual(result.models, []);
    assert.equal(result.errorCode, "");
  });
});

test("unsafe remote Ollama base URL is never fetched", async () => {
  let fetchCount = 0;
  const manager = createLocalModelManager({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(sampleTags([]));
    },
    getConfig: () => ({ provider: "ollama", baseUrl: "https://example.invalid", model: "qwen3:8b" }),
  });
  const result = await manager.list();
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "UNSAFE_OLLAMA_BASE_URL");
  assert.equal(fetchCount, 0);
});

test("select verifies an exact installed tag, persists it, and survives manager recreation", async () => {
  let stored = "";
  const dependencies = {
    fetchImpl: async () => jsonResponse(sampleTags([model("mistral:7b"), model("qwen3:8b")])),
    getSelectedModel: () => stored,
    setSelectedModel: (name) => {
      stored = name;
    },
    getConfig: () => ({ provider: "ollama", model: "" }),
  };

  const first = createLocalModelManager(dependencies);
  const selected = await first.select("qwen3:8b");
  assert.equal(selected.ok, true);
  assert.equal(stored, "qwen3:8b");
  assert.equal(selected.selectedModel, "qwen3:8b");
  assert.equal(selected.effectiveModel, "qwen3:8b");
  assert.equal(selected.models.find((item) => item.name === "qwen3:8b").effective, true);

  const recreated = createLocalModelManager(dependencies);
  const catalog = await recreated.list();
  assert.equal(catalog.selectedModel, "qwen3:8b");
  assert.equal(catalog.effectiveModel, "qwen3:8b");

  const absent = await recreated.select("llama3.2:latest");
  assert.equal(absent.ok, false);
  assert.equal(absent.errorCode, "MODEL_NOT_INSTALLED");
  assert.equal(stored, "qwen3:8b");
});

test("environment-selected model locks user selection", async () => {
  let saved = false;
  const manager = createLocalModelManager({
    fetchImpl: async () => jsonResponse(sampleTags([model("mistral:7b"), model("qwen3:8b")])),
    getSelectedModel: () => "qwen3:8b",
    setSelectedModel: () => {
      saved = true;
    },
    getConfig: () => ({
      provider: "ollama",
      model: "mistral:7b",
      environmentModel: "mistral:7b",
      lockedByEnvironment: true,
    }),
  });

  const catalog = await manager.list();
  assert.equal(catalog.lockedByEnvironment, true);
  assert.equal(catalog.effectiveModel, "mistral:7b");
  const result = await manager.select("qwen3:8b");
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "MODEL_SELECTION_LOCKED");
  assert.equal(saved, false);
});

test("invalid select and pull input never reaches persistence or fetch", async () => {
  let fetchCount = 0;
  let saveCount = 0;
  const manager = createLocalModelManager({
    fetchImpl: async () => {
      fetchCount += 1;
      return jsonResponse(sampleTags([]));
    },
    setSelectedModel: () => {
      saveCount += 1;
    },
    getConfig: () => ({ provider: "ollama" }),
  });
  assert.equal((await manager.select("bad;tag")).errorCode, "INVALID_MODEL_TAG");
  assert.equal((await manager.pull("../bad")).errorCode, "INVALID_MODEL_TAG");
  assert.equal(fetchCount, 0);
  assert.equal(saveCount, 0);
});

test("pull parses split NDJSON progress, refreshes the catalog, and enables exact selection", async () => {
  let selected = "";
  let tagsCall = 0;
  const managerProgress = [];
  const perPullProgress = [];
  const requests = [];
  const manager = createLocalModelManager({
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/api/pull")) {
        return ndjsonResponse([
          '{"status":"pulling manifest"}\n{"status":"downloading","digest":"sha256:aa","total":100,',
          '"completed":35}\n{"status":"downloading","digest":"sha256:aa","total":100,"completed":100}\n',
          '{"status":"success"}\n',
        ]);
      }
      tagsCall += 1;
      return jsonResponse(sampleTags(tagsCall >= 1 ? [model("qwen3:8b")] : []));
    },
    getSelectedModel: () => selected,
    setSelectedModel: (name) => {
      selected = name;
    },
    getConfig: () => ({ provider: "ollama" }),
    onProgress: (event) => managerProgress.push(event),
  });

  const result = await manager.pull("qwen3:8b", {
    onProgress: (event) => perPullProgress.push(event),
  });
  assert.equal(result.ok, true);
  assert.equal(result.canSelect, true);
  assert.equal(result.catalog.models[0].name, "qwen3:8b");
  assert.deepEqual(managerProgress.map((event) => event.percent), [0, null, 35, 100, null]);
  assert.equal(managerProgress[0].status, "Ollama에 다운로드 요청 전달 중");
  assert.deepEqual(perPullProgress, managerProgress);
  assert.equal(managerProgress.at(-1).done, true);

  const pullRequest = requests.find((request) => request.url.endsWith("/api/pull"));
  assert.equal(pullRequest.url, "http://127.0.0.1:11434/api/pull");
  assert.deepEqual(JSON.parse(pullRequest.options.body), { model: "qwen3:8b", stream: true });

  const selectResult = await manager.select("qwen3:8b");
  assert.equal(selectResult.ok, true);
  assert.equal(selected, "qwen3:8b");
});

test("pull reports remote, malformed, and incomplete streams without exposing raw errors", async (t) => {
  const cases = [
    {
      label: "remote error",
      response: ndjsonResponse(['{"status":"pulling"}\n{"error":"private upstream detail"}\n']),
      code: "PULL_REMOTE_ERROR",
    },
    {
      label: "malformed response",
      response: ndjsonResponse(["not-json\n"]),
      code: "PULL_INVALID_RESPONSE",
    },
    {
      label: "incomplete response",
      response: ndjsonResponse(['{"status":"downloading","total":10,"completed":5}\n']),
      code: "PULL_INCOMPLETE",
    },
  ];
  for (const item of cases) {
    await t.test(item.label, async () => {
      const manager = createLocalModelManager({
        fetchImpl: async () => item.response,
        getConfig: () => ({ provider: "ollama" }),
      });
      const result = await manager.pull("qwen3:8b");
      assert.equal(result.ok, false);
      assert.equal(result.errorCode, item.code);
      assert.equal(Object.hasOwn(result, "error"), false);
    });
  }
});

test("cancelPull aborts only an active pull and permits a later pull", async () => {
  let firstSignal;
  let callCount = 0;
  let markFirstRequestStarted;
  const firstRequestStarted = new Promise((resolve) => {
    markFirstRequestStarted = resolve;
  });
  const manager = createLocalModelManager({
    fetchImpl: (url, options) => {
      callCount += 1;
      if (callCount === 1) {
        firstSignal = options.signal;
        markFirstRequestStarted();
        return new Promise((_resolve, reject) => {
          options.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        });
      }
      if (url.endsWith("/api/pull")) return Promise.resolve(ndjsonResponse(['{"status":"success"}\n']));
      return Promise.resolve(jsonResponse(sampleTags([model("qwen3:8b")])));
    },
    getConfig: () => ({ provider: "ollama" }),
  });

  assert.deepEqual(manager.cancelPull(), { ok: true, canceled: false });
  const pending = manager.pull("qwen3:8b");
  await firstRequestStarted;
  assert.equal(firstSignal.aborted, false);
  assert.deepEqual(manager.cancelPull(), { ok: true, canceled: true });
  const canceled = await pending;
  assert.equal(canceled.ok, false);
  assert.equal(canceled.canceled, true);
  assert.equal(canceled.errorCode, "PULL_CANCELED");

  const retry = await manager.pull("qwen3:8b");
  assert.equal(retry.ok, true);
});

test("runtime selection applies immediately while an administrator environment model stays authoritative", (t) => {
  const originalEnvironmentModel = process.env.HEYU_LLM_MODEL;
  const originalRuntimeModel = getLocalModelRuntimeConfig().model;
  t.after(() => {
    setRuntimeSelectedModel(originalRuntimeModel);
    if (originalEnvironmentModel === undefined) delete process.env.HEYU_LLM_MODEL;
    else process.env.HEYU_LLM_MODEL = originalEnvironmentModel;
  });

  delete process.env.HEYU_LLM_MODEL;
  setRuntimeSelectedModel("qwen3:8b");
  assert.equal(getLocalModelRuntimeConfig().model, "qwen3:8b");
  assert.equal(getLocalModelRuntimeConfig().lockedByEnvironment, false);

  process.env.HEYU_LLM_MODEL = "llama3.2:latest";
  assert.equal(getLocalModelRuntimeConfig().model, "llama3.2:latest");
  assert.equal(getLocalModelRuntimeConfig().lockedByEnvironment, true);
});

test("release UI exposes a provider-neutral clickable picker without a machine-specific model default", () => {
  const root = path.join(__dirname, "..");
  const appRenderer = fs.readFileSync(path.join(root, "app", "renderer", "app.js"), "utf8");
  const appHtml = fs.readFileSync(path.join(root, "app", "renderer", "index.html"), "utf8");
  const chatRenderer = fs.readFileSync(path.join(root, "app", "renderer", "chat.js"), "utf8");
  const preload = fs.readFileSync(path.join(root, "app", "main", "preload.cjs"), "utf8");
  const llm = fs.readFileSync(path.join(root, "app", "main", "llm.cjs"), "utf8");
  const combined = [appRenderer, chatRenderer, preload, llm].join("\n");

  assert.match(appRenderer, /<button class="runtime-model-badge/);
  assert.match(appRenderer, /data-model-picker-open/);
  assert.match(chatRenderer, /<button class="runtime-model-badge/);
  assert.match(preload, /listLocalModels\(\)/);
  assert.match(preload, /selectLocalModel\(model\)/);
  assert.match(preload, /pullLocalModel\(model\)/);
  assert.match(appRenderer, /gemma4:12b-it-q4_K_M/);
  assert.match(appRenderer, /querySelector\("#modelPullInput"\)\?\.value/);
  assert.match(appHtml, /id="bootModelPickerButton"[^>]+data-model-picker-open/);
  assert.match(appHtml, /모델 선택 · 새 모델 받기/);
  assert.match(appRenderer, /function syncBootModelButton\(\)/);
  assert.doesNotMatch(combined, /gemma4:e\d+b|Gemma \$\{/);
});
