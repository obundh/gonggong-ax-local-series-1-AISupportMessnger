const assert = require("node:assert/strict");
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
const CACHE_PATHS = [
  LLM_PATH,
  MCP_CLIENT_PATH,
  WORKSPACE_TOOLS_PATH,
  GRAPH_TOOLS_PATH,
  PRESENTATION_TOOLS_PATH,
  IMAGE_TOOLS_PATH,
];
const originalCache = new Map(CACHE_PATHS.map((filename) => [filename, require.cache[filename]]));
const ENV_NAMES = ["HEYU_LLM_PROVIDER", "HEYU_LLM_BASE_URL", "HEYU_LLM_MODEL", "HEYU_LLM_TIMEOUT_MS"];
const originalEnv = new Map(ENV_NAMES.map((name) => [name, process.env[name]]));
const TEXT_LLM_DRAFT = [
  "이미지 브리프",
  "밝고 친근한 공공서비스 안내 포스터로 구성합니다.",
  "",
  "생성 프롬프트",
  "A bright civic-service poster with clear hierarchy, friendly colors, accessible clean layout, polished flat illustration",
  "",
  "네거티브 프롬프트",
  "blurry, watermark, illegible text, cluttered layout",
].join("\n");

let llm;
let server;
let artifactResult;
let capabilityResult = { available: false, status: "model-missing", statusLabel: "모델 없음" };
const artifactCalls = [];
let capabilityCalls = 0;

function installModuleStub(filename, exports) {
  const stub = new Module(filename);
  stub.filename = filename;
  stub.loaded = true;
  stub.exports = exports;
  require.cache[filename] = stub;
}

test.before(async () => {
  server = http.createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: { content: TEXT_LLM_DRAFT } }] }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  process.env.HEYU_LLM_PROVIDER = "openai-compatible";
  process.env.HEYU_LLM_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.HEYU_LLM_MODEL = "local-text-prompt-model:test";
  process.env.HEYU_LLM_TIMEOUT_MS = "3000";
  installModuleStub(MCP_CLIENT_PATH, { buildOfficerMcpContext: async () => "" });
  installModuleStub(WORKSPACE_TOOLS_PATH, { buildWorkspaceMcpContext: async () => "" });
  installModuleStub(GRAPH_TOOLS_PATH, { buildGraphOfficerReply: async () => ({}) });
  installModuleStub(PRESENTATION_TOOLS_PATH, { buildPresentationOfficerReply: async () => ({}) });
  installModuleStub(IMAGE_TOOLS_PATH, {
    checkImageGenerationCapability: async () => {
      capabilityCalls += 1;
      return { ...capabilityResult };
    },
    buildImageGenerationArtifact: async (input) => {
      artifactCalls.push(input);
      return { ...artifactResult };
    },
  });
  delete require.cache[LLM_PATH];
  llm = require(LLM_PATH);
});

test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  for (const [name, value] of originalEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  for (const [filename, cached] of originalCache) {
    if (cached === undefined) delete require.cache[filename];
    else require.cache[filename] = cached;
  }
});

function confirmedRequest(llmText = "생성 프롬프트\nA useful local-LLM image prompt") {
  return llm.sendOfficerMessage({
    contact: { id: "image-officer", name: "김그림" },
    userText: "산뜻한 공공서비스 안내 포스터를 만들어줘",
    imageAction: "confirm-generate",
    imageRequest: {
      sourcePrompt: "산뜻한 공공서비스 안내 포스터를 만들어줘",
      llmText,
      confirmText: "좋아. 위 설정으로 생성할게.",
    },
  });
}

test("first direct request with no image model returns the text-LLM prompt without asking for confirmation", async () => {
  capabilityResult = { available: false, status: "model-missing", statusLabel: "모델 없음" };
  const artifactCount = artifactCalls.length;
  const capabilityCount = capabilityCalls;

  const result = await llm.sendOfficerMessage({
    contact: { id: "image-officer", name: "김그림", persona: { systemPrompt: "로컬 이미지 담당" } },
    history: [],
    files: [],
    userText: "산뜻한 공공서비스 안내 포스터를 만들어줘",
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "image"), false);
  assert.equal(Object.hasOwn(result, "actions"), false);
  assert.match(result.text, /사용할 수 있는 이미지 모델이 없어 실제 이미지 생성은 실행하지 않았습니다/);
  assert.match(result.text, /A bright civic-service poster with clear hierarchy/);
  assert.doesNotMatch(result.text, /이 설정으로 생성할까/);
  assert.equal(artifactCalls.length, artifactCount, "preflight must not invoke the image generator");
  assert.equal(capabilityCalls, capabilityCount + 1);
});

test("first direct request keeps confirmation when image generation is available", async () => {
  capabilityResult = { available: true, status: "ready", statusLabel: "생성 가능", modelName: "test-checkpoint.safetensors" };
  const artifactCount = artifactCalls.length;

  const result = await llm.sendOfficerMessage({
    contact: { id: "image-officer", name: "김그림", persona: { systemPrompt: "로컬 이미지 담당" } },
    history: [],
    files: [],
    userText: "산뜻한 공공서비스 안내 포스터를 만들어줘",
  });

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "image"), false);
  assert.match(result.text, /이 설정으로 생성할까/);
  assert.equal(result.actions.some((action) => action.type === "image-confirm-generate"), true);
  assert.equal(artifactCalls.length, artifactCount, "confirmation preflight must not generate an image");
});

test("missing image model returns the text-LLM prompt without a fake image artifact", async () => {
  const llmDraft = "생성 프롬프트\nA bright civic-service poster with clear hierarchy, friendly colors, and an accessible clean layout";
  artifactResult = {
    status: "model-missing",
    statusLabel: "모델 없음",
    prompt: "A bright civic-service poster with clear hierarchy, friendly colors, and an accessible clean layout",
    negativePrompt: "blurry, watermark, illegible text, cluttered layout",
    width: 1024,
    height: 1024,
  };

  const result = await confirmedRequest(llmDraft);

  assert.equal(result.ok, true);
  assert.equal(result.model, "local-text-prompt-model:test");
  assert.equal(Object.hasOwn(result, "image"), false);
  assert.match(result.text, /사용할 수 있는 이미지 모델이 없어 실제 이미지 생성은 실행하지 않았습니다/);
  assert.match(result.text, /A bright civic-service poster with clear hierarchy/);
  assert.match(result.text, /blurry, watermark, illegible text/);
  assert.match(result.text, /1024 x 1024/);
  assert.doesNotMatch(result.text, /생성 완료|이미지 카드에|생성 결과를 붙였습니다/);
  assert.equal(artifactCalls.at(-1).llmText, llmDraft);
});

test("missing image runtime is also prompt-only and explicitly not run", async () => {
  artifactResult = {
    status: "runtime-missing",
    statusLabel: "실행기 없음",
    prompt: "A calm report illustration of a public office workflow, blue and green palette, simple geometric forms",
    negativePrompt: "low quality, watermark, visual noise",
    width: 1280,
    height: 768,
  };

  const result = await confirmedRequest();

  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result, "image"), false);
  assert.match(result.text, /사용할 수 있는 이미지 실행기가 없어 실제 이미지 생성은 실행하지 않았습니다/);
  assert.match(result.text, /A calm report illustration of a public office workflow/);
});

test("available image generation keeps the real image artifact path", async () => {
  artifactResult = {
    id: "generated-image-test",
    status: "generated",
    statusLabel: "생성 완료",
    prompt: "A generated civic-service poster",
    base64: "iVBORw0KGgo=",
    mimeType: "image/png",
    workspacePath: "images/generated.png",
  };

  const result = await confirmedRequest();

  assert.equal(result.ok, true);
  assert.equal(result.model, "local-text-prompt-model:test + image");
  assert.equal(result.image.id, "generated-image-test");
  assert.equal(result.image.base64, "iVBORw0KGgo=");
  assert.match(result.text, /이미지 카드에 생성 결과를 붙였습니다/);
});
