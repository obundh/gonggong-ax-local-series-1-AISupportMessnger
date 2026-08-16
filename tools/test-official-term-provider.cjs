"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  loadOfficialTermPack,
  searchOfficialTerms,
} = require("./mcp-law/official-term-provider.cjs");

function makePack(root, records, overrides = {}) {
  const directory = path.join(root, "legal_terms");
  fs.mkdirSync(directory, { recursive: true });
  const indexPath = path.join(directory, "index.json");
  const searchPath = path.join(directory, "search-index.jsonl");
  fs.writeFileSync(indexPath, `${JSON.stringify({ schemaVersion: 1, records }, null, 2)}\n`, "utf8");
  fs.writeFileSync(searchPath, records.map((record) => `${JSON.stringify(record)}\n`).join(""), "utf8");
  const files = [indexPath, searchPath].map((file) => ({
    path: path.basename(file),
    bytes: fs.statSync(file).size,
    sha256: crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"),
  }));
  fs.writeFileSync(path.join(directory, "manifest.json"), `${JSON.stringify({
    schemaVersion: 1,
    target: "official-legal-terms",
    status: "complete",
    packType: "list-index",
    generatedAt: "2026-08-16T00:00:00.000Z",
    retrievedAt: "2026-08-16T00:00:00.000Z",
    recordCount: records.length,
    uniqueNormalizedNameCount: new Set(records.map((record) => record.normalizedName)).size,
    duplicateNormalizedNameGroupCount: 1,
    ambiguousNormalizedNameGroupCount: 1,
    coverage: {
      lists: { status: "complete", recordCount: records.length, expectedCount: records.length },
      definitions: { status: "list-only-partial", recordCount: records.filter((record) => record.definition).length, expectedListRecordCount: records.length },
      explicitSynonyms: { recordCount: records.filter((record) => record.synonyms.length).length },
      relationReferences: { recordCount: records.filter((record) => record.relations.length).length, bodyCount: 0, status: "identifier-references-only" },
    },
    sources: { lstrm: { label: "fixture", apiTotal: records.length, recordCount: records.length, pageCount: 1, listComplete: true, officialIdentifierParameter: "trmSeqs" } },
    files,
    ...overrides,
  }, null, 2)}\n`, "utf8");
  return directory;
}

function record(id, name, extra = {}) {
  return {
    id: `lstrm:${id}`,
    sourceTarget: "lstrm",
    sourceId: String(id),
    listId: String(id),
    name,
    normalizedName: name.replace(/\s+/g, ""),
    synonyms: [],
    normalizedSynonyms: [],
    definition: "",
    definitionStatus: "not-in-list-pack",
    relations: [],
    relationBodyStatus: "not-in-list-pack",
    homonymStatus: "unknown",
    note: "",
    lawTypeCode: "",
    dictionaryTypeCode: "",
    detailIdentifier: { parameter: "trmSeqs", value: String(id) },
    listOrdinal: Number(id),
    ...extra,
  };
}

test("무결성 검증된 목록 팩은 exact 후보와 정의 수록 범위를 분리해 반환한다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-terms-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makePack(root, [
    record(1, "가상 행정절차어", { definition: "목록 응답에 포함된 정의", definitionStatus: "present-in-list-response" }),
    record(2, "가상 형사절차어"),
  ]);
  const status = loadOfficialTermPack(root);
  assert.equal(status.available, true);
  assert.equal(status.hashVerified, true);
  assert.equal(status.recordCount, 2);

  const result = searchOfficialTerms("가상 행정절차어 뜻", { dataDir: root });
  assert.equal(result.mode, "local-corpus-only");
  assert.equal(result.live, false);
  assert.equal(result.resolutionStatus, "exact");
  assert.equal(result.matches[0].formalName, "가상 행정절차어");
  assert.equal(result.matches[0].definitionStatus, "present-in-list-response");
  assert.equal(result.source.coverage.definitions.recordCount, 1);
});

test("같은 표제어의 공식 ID가 둘이면 모두 유지하고 ambiguous로 표시한다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-ambiguous-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makePack(root, [record(10, "가상 중복용어"), record(11, "가상 중복용어", { homonymStatus: "declared" })]);
  const result = searchOfficialTerms("가상 중복용어", { dataDir: root, limit: 20 });
  assert.equal(result.resolutionStatus, "ambiguous");
  assert.equal(result.sourceDuplicateCount, 1);
  assert.deepEqual(new Set(result.matches.map((match) => match.sourceId)), new Set(["10", "11"]));
});

test("같은 정식 표제어의 중복 출처는 보존하되 다의어로 오인하지 않는다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-source-duplicate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makePack(root, [record(12, "가상 중복출처어"), record(13, "가상 중복출처어")]);
  const result = searchOfficialTerms("가상 중복출처어", { dataDir: root, limit: 20 });
  assert.equal(result.resolutionStatus, "exact");
  assert.equal(result.sourceDuplicateCount, 1);
  assert.deepEqual(new Set(result.matches.map((match) => match.sourceId)), new Set(["12", "13"]));
});

test("쉼표로 구분된 여러 공식 용어를 한 질문에서 각각 찾는다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-multi-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makePack(root, [record(20, "가상 계약절차어"), record(21, "가상 노동절차어")]);
  const result = searchOfficialTerms("가상 계약절차어, 가상 노동절차어 뜻을 알려줘", { dataDir: root, limit: 20 });
  assert.equal(result.resolutionStatus, "multiple");
  assert.deepEqual(new Set(result.matches.map((match) => match.formalName)), new Set(["가상 계약절차어", "가상 노동절차어"]));
});

test("부분접두·문장내 포함 일치는 exact나 ambiguous로 승격하지 않는다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-candidate-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makePack(root, [record(25, "가상 접두어"), record(26, "가상 접두어", { homonymStatus: "declared" })]);
  const result = searchOfficialTerms("가상 접두어확장 표현의 뜻", { dataDir: root, limit: 20 });
  assert.equal(result.resolutionStatus, "multiple-candidate");
  assert.ok(result.matches.every((match) => ["segment-prefix", "query-contained"].includes(match.matchKind)));
  assert.ok(result.matches.every((match) => match.confidence === "official-list-candidate"));
});

test("긴 정확 표제어는 같은 문장 안의 짧은 접두 후보보다 우선한다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-dominant-exact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makePack(root, [
    record(27, "가상 절차"),
    record(28, "가상 절차 긴표제"),
    record(29, "가상 절차 긴표제", { homonymStatus: "declared" }),
  ]);
  const result = searchOfficialTerms("가상 절차 긴표제 뜻", { dataDir: root, limit: 20 });
  assert.equal(result.resolutionStatus, "ambiguous");
  assert.deepEqual(new Set(result.matches.map((match) => match.sourceId)), new Set(["28", "29"]));
  assert.ok(result.matches.every((match) => match.matchKind === "segment-exact"));
  assert.ok(result.matches.every((match) => match.confidence === "official-list-exact"));
});

test("인덱스가 변조되면 후보를 반환하지 않고 fail closed 한다", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-official-tamper-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const directory = makePack(root, [record(30, "가상 무결성용어")]);
  fs.appendFileSync(path.join(directory, "index.json"), "tampered", "utf8");
  const status = loadOfficialTermPack(root);
  assert.equal(status.available, false);
  assert.equal(status.integrity, "mismatch");
  assert.deepEqual(searchOfficialTerms("가상 무결성용어", { dataDir: root }).matches, []);
});
