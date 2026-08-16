"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.join(__dirname, "..");
const {
  createLawAliasResolver,
  loadOfficialCatalog,
  resolveLegalName,
} = require(path.join(ROOT_DIR, "app", "main", "legal-name-resolver.cjs"));
const mcpClient = require(path.join(ROOT_DIR, "app", "main", "mcp-client.cjs"));

const OFFICIAL_NAMES = [
  "근로기준법",
  "노동조합 및 노동관계조정법",
  "최저임금법",
  "공공기관의 정보공개에 관한 법률",
  "개인정보 보호법",
  "개인정보 보호법",
  "개인정보 보호법 시행령",
];

const ALIASES = [
  {
    aliases: ["근기법"],
    candidates: [{ name: "근로기준법", searchTerm: "근로기준법" }],
    reason: "통용 약칭",
  },
  {
    aliases: ["정보공개법"],
    candidates: [{
      name: "공공기관의 정보공개에 관한 법률",
      searchTerm: "공공기관의 정보공개에 관한 법률",
    }],
    reason: "통용 약칭",
  },
  {
    aliases: ["개보법"],
    candidates: [{ name: "개인정보 보호법", searchTerm: "개인정보 보호법" }],
    reason: "통용 약칭",
  },
  {
    aliases: ["노동법"],
    candidates: [
      { name: "근로기준법", when: ["연차", "임금", "해고", "근로시간"] },
      { name: "노동조합 및 노동관계조정법", when: ["단체교섭", "노동조합", "쟁의"] },
      { name: "최저임금법", when: ["최저임금"] },
    ],
    reason: "여러 노동관계 법령을 가리키는 분야명",
  },
];

function createFixtureResolver() {
  return createLawAliasResolver({
    officialNames: [...OFFICIAL_NAMES],
    aliases: structuredClone(ALIASES),
  });
}

function candidateNames(result) {
  return (result?.candidates || []).map((candidate) => candidate.name);
}

test("resolver exposes the pure and singleton contract", () => {
  assert.equal(typeof createLawAliasResolver, "function");
  assert.equal(typeof resolveLegalName, "function");
  assert.equal(typeof loadOfficialCatalog, "function");
});

test("an exact abbreviation resolves to one official title", () => {
  const result = createFixtureResolver().resolveLegalName("근기법 제17조 근로조건 명시", { target: "law" });
  assert.equal(result.status, "resolved");
  assert.equal(result.matchedText, "근기법");
  assert.deepEqual(candidateNames(result), ["근로기준법"]);
});

test("an official long title is recognized without invention", () => {
  const official = "공공기관의 정보공개에 관한 법률";
  const result = createFixtureResolver().resolveLegalName(`${official} 제9조`, { target: "law" });
  assert.equal(result.status, "resolved");
  assert.equal(result.matchedText, official);
  assert.deepEqual(candidateNames(result), [official]);
});

test("an umbrella expression stays ambiguous without an issue", () => {
  const result = createFixtureResolver().resolveLegalName("노동법 전반의 적용 기준", { target: "law" });
  assert.equal(result.status, "ambiguous");
  assert.deepEqual(new Set(candidateNames(result)), new Set([
    "근로기준법",
    "노동조합 및 노동관계조정법",
    "최저임금법",
  ]));
});

test("issue terms route an umbrella expression deterministically", () => {
  const resolver = createFixtureResolver();
  assert.deepEqual(
    candidateNames(resolver.resolveLegalName("노동법 연차", { target: "law" })),
    ["근로기준법"]
  );
  assert.deepEqual(
    candidateNames(resolver.resolveLegalName("노동법 단체교섭", { target: "law" })),
    ["노동조합 및 노동관계조정법"]
  );
});

test("a nonexistent or historical-only subordinate rule is not promoted", () => {
  const currentOnly = createFixtureResolver().resolveLegalName("개보법 시행규칙", { target: "law" });
  assert.equal(currentOnly.status, "none");

  const historical = createLawAliasResolver({
    officialNames: [
      { name: "개인정보 보호법", category: "current-central" },
      { name: "개인정보 보호법 시행규칙", category: "historical" },
    ],
    aliases: structuredClone(ALIASES),
  }).resolveLegalName("개보법 시행규칙 제1조", { target: "law" });
  assert.equal(historical.status, "none");
});

test("an unknown expression never fabricates a title", () => {
  const result = createFixtureResolver().resolveLegalName("처음듣는약칭법 제3조", { target: "law" });
  assert.equal(result.status, "none");
  assert.deepEqual(result.candidates, []);
});

test("Kim Beomryul normalizes aliases before the local MCP and never selects the external server", () => {
  const request = mcpClient.__test.buildLocalLegalSearchRequest("근기법 제17조");
  assert.equal(request.query, "근로기준법 제17조");
  assert.equal(request.resolution.status, "resolved");

  const laborRequest = mcpClient.__test.buildLocalLegalSearchRequest("노동법 단체교섭");
  assert.equal(laborRequest.query, "노동조합 및 노동관계조정법 단체교섭");

  const ambiguous = mcpClient.__test.buildLocalLegalSearchRequest("노동법");
  assert.equal(ambiguous.resolution.status, "ambiguous");

  const serverPath = mcpClient.__test.resolveServerPath("legal_search");
  assert.equal(path.basename(path.dirname(serverPath)), "mcp-law");
  assert.equal(path.basename(serverPath), "server.cjs");
});
