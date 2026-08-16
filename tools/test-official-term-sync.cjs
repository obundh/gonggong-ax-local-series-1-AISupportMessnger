"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  analyzeRecords,
  appendRecords,
  assertCompleteListCount,
  containsCredential,
  loadState,
  normalizeTermRecord,
  parseArgs,
  promotePack,
  sanitizeApiValue,
  verifyBuiltPack,
} = require("./official-term-sync/sync.cjs");

const ROOT = path.resolve(__dirname, "..");

test("공식 용어 동기화는 명령행 OC를 거부하고 환경변수 전용 계약을 유지한다", () => {
  assert.throws(() => parseArgs(["--oc", "secret"]), /--oc is disabled/);
  const parsed = parseArgs(["--sources", "lstrmAI,lstrm", "--display", "50", "--max-pages", "3"]);
  assert.deepEqual(parsed.sources, ["lstrmAI", "lstrm"]);
  assert.equal(parsed.display, 50);
  assert.equal(parsed.maxPages, 3);
});

test("중첩 링크의 현재·과거 OC는 저장 전에 제거하고 stable MST만 별도 보존한다", () => {
  const raw = {
    lstrmAISearch: {
      OC: "current-secret",
      법령용어: [{
        id: "1",
        법령용어명: "가상 법령용어",
        용어간관계링크: "/DRF/lawService.do?OC=old-secret&target=lstrmRlt&MST=1418803",
        조문간관계링크: "/DRF/lawService.do?OC=current-secret&target=lstrmRltJo&MST=1418803",
        nested: { api_key: "old-secret", 설명: "https://example.invalid/path?OC=older-secret&x=1" },
      }],
    },
  };
  const sanitized = sanitizeApiValue(raw, "current-secret");
  const serialized = JSON.stringify(sanitized);
  assert.doesNotMatch(serialized, /current-secret|old-secret|older-secret|용어간관계링크|조문간관계링크|"OC"|api_key/);
  assert.equal(containsCredential(serialized, "current-secret"), false);
  const row = sanitized.lstrmAISearch.법령용어[0];
  const normalized = normalizeTermRecord("lstrmAI", row, 1);
  assert.equal(normalized.sourceId, "1418803");
  assert.equal(normalized.listId, "1");
  assert.notEqual(normalized.sourceId, normalized.listId);
});

test("lstrm의 명시적 공식 ID와 목록에 실제 들어온 동의어만 정규화한다", () => {
  const record = normalizeTermRecord("lstrm", {
    id: "7",
    법령용어ID: "5042001,5042002,5042003",
    법령용어명: "가상 표제어",
    동의어: "대체 표제어|보조 표제어",
    법령용어정의: "테스트 정의",
    법령종류코드: "010102",
  }, 7);
  assert.equal(record.sourceId, "5042001");
  assert.deepEqual(record.officialIds, ["5042001", "5042002", "5042003"]);
  assert.deepEqual(record.synonyms, ["대체 표제어", "보조 표제어"]);
  assert.equal(record.definitionStatus, "present-in-list-response");
  assert.equal(record.detailIdentifier.parameter, "trmSeqs");
  assert.deepEqual(record.detailIdentifiers.map((item) => item.value), ["5042001", "5042002", "5042003"]);
});

test("동일 정규화 이름의 서로 다른 공식 ID는 삭제하지 않고 모호성 그룹으로 집계한다", () => {
  const base = {
    name: "동일 용어", normalizedName: "동일용어", synonyms: [], definition: "", relations: [], homonymStatus: "unknown",
  };
  const records = [
    { ...base, id: "lstrm:10", sourceTarget: "lstrm", sourceId: "10" },
    { ...base, id: "lstrm:11", sourceTarget: "lstrm", sourceId: "11" },
    { ...base, id: "lstrmAI:20", sourceTarget: "lstrmAI", sourceId: "20" },
  ];
  const counts = analyzeRecords(records);
  assert.equal(records.length, 3);
  assert.equal(counts.uniqueNormalizedNameCount, 1);
  assert.equal(counts.duplicateNormalizedNameGroupCount, 1);
  assert.equal(counts.ambiguousNormalizedNameGroupCount, 1);
});

test("API total과 실제 전 페이지 행 수가 다르면 완성 팩으로 승격하지 않는다", () => {
  assert.equal(assertCompleteListCount("lstrm", 100, 100), true);
  assert.throws(() => assertCompleteListCount("lstrm", 100, 99), /count mismatch/);
});

test("20만건 이상 레코드를 함수 인자 spread 없이 결합해 call-stack 한계를 넘지 않는다", () => {
  const first = Array.from({ length: 143_717 }, (_value, index) => index);
  const second = Array.from({ length: 73_165 }, (_value, index) => index + first.length);
  const combined = [];
  appendRecords(combined, first);
  appendRecords(combined, second);
  assert.equal(combined.length, 216_882);
  assert.equal(combined.at(-1), 216_881);
});

test("중단 상태를 다시 읽으면 source별 nextPage와 기존 checkpoint를 그대로 이어받는다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-term-resume-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const statePath = path.join(root, "state.json");
  const stored = {
    schemaVersion: 1,
    signature: "abcdef1234567890",
    baseSignature: "abcdef1234567890",
    sources: {
      lstrmAI: { nextPage: 47, apiTotal: 1_000, totalPages: 10, pagesDownloaded: 46, listComplete: false },
      lstrm: { nextPage: 8, apiTotal: 500, totalPages: 5, pagesDownloaded: 7, listComplete: false },
    },
  };
  fs.writeFileSync(statePath, JSON.stringify(stored), "utf8");
  const resumed = loadState(statePath, stored.signature, stored.baseSignature, { sources: ["lstrmAI", "lstrm"], display: 100 });
  assert.equal(resumed.sources.lstrmAI.nextPage, 47);
  assert.equal(resumed.sources.lstrm.nextPage, 8);
  assert.equal(resumed.sources.lstrmAI.pagesDownloaded, 46);
});

test("불완전 staging 검증 실패는 기존 active를 건드리지 않고, 완성 팩만 원자 승격한다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-term-promote-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const active = path.join(root, "legal_terms");
  const bad = path.join(root, "work", "bad-staging");
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(bad, { recursive: true });
  fs.writeFileSync(path.join(active, "marker.txt"), "old-complete-bytes", "utf8");
  fs.writeFileSync(path.join(bad, "manifest.json"), JSON.stringify({ schemaVersion: 1, status: "partial" }), "utf8");
  assert.throws(() => verifyBuiltPack(bad), /manifest is incomplete/);
  assert.equal(fs.readFileSync(path.join(active, "marker.txt"), "utf8"), "old-complete-bytes");

  const good = path.join(root, "work", "good-staging");
  makeValidPack(good);
  assert.equal(verifyBuiltPack(good), true);
  const promoted = promotePack(active, good, root);
  assert.equal(fs.existsSync(path.join(active, "manifest.json")), true);
  assert.equal(fs.readFileSync(path.join(promoted.backup, "marker.txt"), "utf8"), "old-complete-bytes");
});

test("런타임 김법률 MCP 코드에는 네트워크 클라이언트가 없다", () => {
  const runtimeFiles = fs.readdirSync(path.join(ROOT, "tools", "mcp-law"), { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".cjs"))
    .map((entry) => path.join(ROOT, "tools", "mcp-law", entry.name));
  for (const file of runtimeFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\brequire\(["'](?:node:)?(?:http|https|net|tls|dns|dgram)["']\)|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b/, path.basename(file));
  }
});

function makeValidPack(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const record = {
    id: "lstrm:100", sourceTarget: "lstrm", sourceId: "100", listId: "1", name: "가상 검증용어", normalizedName: "가상검증용어",
    synonyms: [], normalizedSynonyms: [], definition: "", definitionStatus: "not-in-list-pack", relations: [], relationBodyStatus: "not-in-list-pack",
    homonymStatus: "unknown", note: "", lawTypeCode: "", dictionaryTypeCode: "", detailIdentifier: { parameter: "trmSeqs", value: "100" }, listOrdinal: 1,
  };
  const indexPath = path.join(directory, "index.json");
  const searchPath = path.join(directory, "search-index.jsonl");
  fs.writeFileSync(indexPath, `${JSON.stringify({ schemaVersion: 1, records: [record] }, null, 2)}\n`, "utf8");
  fs.writeFileSync(searchPath, `${JSON.stringify(record)}\n`, "utf8");
  const files = [indexPath, searchPath].map((file) => ({
    path: path.basename(file), bytes: fs.statSync(file).size, sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }));
  const contentSha256 = crypto.createHash("sha256").update(files.map((file) => `${file.path}\0${file.sha256}\n`).join("")).digest("hex");
  fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1, status: "complete", packType: "list-index", recordCount: 1, files, contentSha256,
    coverage: { lists: { status: "complete", recordCount: 1 }, definitions: { status: "list-only-partial", recordCount: 0 } },
  }, null, 2)}\n`, "utf8");
}
