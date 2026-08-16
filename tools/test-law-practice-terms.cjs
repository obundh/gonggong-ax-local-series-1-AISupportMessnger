"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  loadPracticeTerms,
  normalizeKey,
  resolvePracticeTerms,
} = require("./mcp-law/practice-resolver.cjs");
const { copyPortableNotices } = require("./mcp-law/build-portable.cjs");
const { extractExplicitLegalTerms, extractLegalTerminologyTerms } = require("../app/main/mcp-client.cjs").__test;

const ROOT = path.resolve(__dirname, "..");

test("공개배포용 CORE 사전은 해시 검증 후 831개 실무 용어를 로컬에서 해석한다", () => {
  const status = loadPracticeTerms(path.join(ROOT, "data"));
  assert.equal(status.available, true);
  assert.equal(status.hashVerified, true);
  assert.equal(status.entryCount, 831);
  assert.equal(status.lookupKeyCount, 1888);
  assert.equal(status.activeLookupKeyCount, 1888);
  assert.equal(status.license, "CC-BY-4.0");

  const result = resolvePracticeTerms("기유가 무엇인지 알려줘", { dataDir: path.join(ROOT, "data") });
  assert.equal(result.mode, "local-corpus-only");
  assert.equal(result.live, false);
  assert.equal(result.resolutionStatus, "exact");
  assert.equal(result.matches[0].formalName, "기소유예");
  assert.match(result.matches[0].ambiguityNote, /무혐의나 무죄와 다르/);
});

test("집정 같은 다의어는 후보를 지우거나 임의 확정하지 않는다", () => {
  const result = resolvePracticeTerms("집정 뜻", { dataDir: path.join(ROOT, "data") });
  assert.equal(result.resolutionStatus, "ambiguous");
  assert.deepEqual(new Set(result.matches.map((item) => item.formalName)), new Set(["강제집행정지", "집행정지"]));
});

test("831개 사전의 모든 표제어와 별칭은 인덱스에 들어가며 각 항목이 실제 질의로 도달 가능하다", () => {
  const dataDir = path.join(ROOT, "data");
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "legal_alias", "practice-terms.json"), "utf8"));
  const entries = Array.isArray(raw?.entries) ? raw.entries : [];
  const status = loadPracticeTerms(dataDir);

  assert.equal(entries.length, 831);
  assert.equal(status.entryCount, entries.length);
  for (const entry of entries) {
    const aliases = [entry.term, entry.formal_name, ...String(entry.aliases || "").split("|")].filter(Boolean);
    for (const alias of aliases) {
      const indexed = status.index.get(normalizeKey(alias)) || [];
      assert.ok(indexed.some((item) => item.id === entry.id), `${entry.id} alias not indexed: ${alias}`);
    }

    const resolved = resolvePracticeTerms(entry.term, { dataDir, limit: 20 });
    assert.ok(resolved.matches.some((item) => item.id === entry.id), `${entry.id} is not reachable by its term`);
  }
});

test("서로 다른 여러 용어는 한 질문에서도 각각 반환되고 미등록 표현은 새 후보로 만들어지지 않는다", () => {
  const dataDir = path.join(ROOT, "data");
  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, "legal_alias", "practice-terms.json"), "utf8"));
  const status = loadPracticeTerms(dataDir);
  const uniqueEntries = raw.entries.filter((entry) => {
    const key = normalizeKey(entry.term);
    return key.length >= 2 && (status.index.get(key) || []).length === 1;
  });
  assert.ok(uniqueEntries.length >= 2);
  const selected = [uniqueEntries[7], uniqueEntries[uniqueEntries.length - 8]];
  const query = `${selected[0].term}, ${selected[1].term}의 뜻을 각각 알려줘`;
  const result = resolvePracticeTerms(query, { dataDir, limit: 20 });
  const matchedIds = new Set(result.matches.map((item) => item.id));

  assert.equal(result.resolutionStatus, "multiple");
  for (const entry of selected) assert.equal(matchedIds.has(entry.id), true, `${entry.term} was dropped from a multi-term query`);

  const unknown = "쀍쀍쀍쀍쀍";
  const unknownResult = resolvePracticeTerms(unknown, { dataDir, limit: 20 });
  assert.equal(unknownResult.resolutionStatus, "none");
  assert.deepEqual(unknownResult.matches, []);
});

test("사전에 실제로 중복 등록된 표현은 모든 연결 후보를 유지하고 ambiguous로 표시한다", () => {
  const dataDir = path.join(ROOT, "data");
  const status = loadPracticeTerms(dataDir);
  const shared = [...status.index.entries()].find(([key, entries]) => key.length >= 2 && entries.length > 1 && entries.length <= 20);
  assert.ok(shared, "shared dictionary key fixture is required");
  const [key, entries] = shared;
  const query = entries.flatMap((entry) => entry.aliases).find((alias) => normalizeKey(alias) === key);
  const result = resolvePracticeTerms(query, { dataDir, limit: 20 });
  const matchedIds = new Set(result.matches.map((item) => item.id));

  assert.equal(result.resolutionStatus, "ambiguous");
  for (const entry of entries) assert.equal(matchedIds.has(entry.id), true, `${entry.id} was forced out of an ambiguous term`);
});

test("명시적인 쉼표·줄바꿈·불릿 용어 목록만 안전하게 분리하고 원래 표기를 보존한다", () => {
  assert.deepEqual(
    extractExplicitLegalTerms("다음 용어의 정식 명칭: 첫째표현, 둘째 표현"),
    [
      { rawLabel: "첫째표현", key: "첫째표현" },
      { rawLabel: "둘째 표현", key: "둘째표현" },
    ]
  );
  assert.deepEqual(
    extractExplicitLegalTerms("- 첫째표현\n- 둘째표현\n각각 뜻 알려줘"),
    [
      { rawLabel: "첫째표현", key: "첫째표현" },
      { rawLabel: "둘째표현", key: "둘째표현" },
    ]
  );
  assert.deepEqual(extractExplicitLegalTerms("계약금 반환, 손해배상 가능해?"), []);

  assert.deepEqual(
    extractLegalTerminologyTerms("법률 실무 용어 첫째표현, 둘째표현 각각 뜻과 정식 명칭 알려줘"),
    [
      { rawLabel: "첫째표현", key: "첫째표현" },
      { rawLabel: "둘째표현", key: "둘째표현" },
    ]
  );
  assert.deepEqual(extractLegalTerminologyTerms("단일표현 뜻이 뭐야?"), [{ rawLabel: "단일표현", key: "단일표현" }]);
  assert.deepEqual(extractLegalTerminologyTerms("단일표현은 무슨 의미인가요?"), [{ rawLabel: "단일표현", key: "단일표현" }]);
  assert.deepEqual(extractLegalTerminologyTerms("계약명의신탁 뜻이 뭐야?"), [{ rawLabel: "계약명의신탁", key: "계약명의신탁" }]);
  assert.deepEqual(extractLegalTerminologyTerms("손해배상 의미"), [{ rawLabel: "손해배상", key: "손해배상" }]);
  assert.deepEqual(extractLegalTerminologyTerms("계약 해지의 법적 의미와 손해배상 알려줘"), []);

  const capped = extractExplicitLegalTerms("용어 뜻: A, B, C, D, E, F, G, H, I, J");
  assert.equal(capped.length, 8);
  assert.deepEqual(capped.map((item) => item.rawLabel), ["A", "B", "C", "D", "E", "F", "G", "H"]);
});

test("사전이 변조되면 실무 용어 후보를 반환하지 않는다", (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-practice-terms-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const directory = path.join(temporary, "legal_alias");
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(path.join(ROOT, "data", "legal_alias", "practice-terms.manifest.json"), path.join(directory, "practice-terms.manifest.json"));
  fs.writeFileSync(path.join(directory, "practice-terms.json"), "{\"entries\":[]}", "utf8");

  const status = loadPracticeTerms(temporary);
  assert.equal(status.available, false);
  assert.equal(status.integrity, "mismatch");
  assert.equal(resolvePracticeTerms("기유", { dataDir: temporary }).matches.length, 0);
});

test("설치본과 휴대용 MCP는 사전·매니페스트·CC BY 고지를 함께 포함한다", (t) => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const corpus = pkg.build.extraResources.find((entry) => entry?.to === "legal-corpus");
  assert.ok(corpus.filter.includes("legal_alias/practice-terms.json"));
  assert.ok(corpus.filter.includes("legal_alias/practice-terms.manifest.json"));
  assert.equal(fs.existsSync(path.join(ROOT, "third_party", "licenses", "Korean-Legal-MCP-DATA-LICENSE.md")), true);

  const portable = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-practice-portable-"));
  t.after(() => fs.rmSync(portable, { recursive: true, force: true }));
  const copied = copyPortableNotices(portable);
  assert.deepEqual(new Set(copied.files), new Set([
    "licenses/Korean-Legal-MCP-DATA-LICENSE.md",
    "licenses/korean-law-mcp-v4.10.0-MIT.txt",
    "THIRD_PARTY_NOTICES.md",
  ]));
  for (const relative of copied.files) assert.equal(fs.statSync(path.join(portable, relative)).isFile(), true);
});
