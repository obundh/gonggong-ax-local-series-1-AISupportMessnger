"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.resolve(__dirname, "..");
const DATA = path.join(ROOT, "data");
const {
  PORTED_ALIAS_ENTRIES,
  PORTED_AMBIGUOUS_ENTRIES,
  UPSTREAM,
  normalizeBasicTypos,
  normalizeLawSearchText,
} = require(path.join(ROOT, "tools", "mcp-law", "upstream-search-normalizer.cjs"));
const {
  REVIEWED_ALIASES,
  compact,
  loadExternalAliases,
  resolveAliases,
} = require(path.join(ROOT, "tools", "mcp-law", "alias-resolver.cjs"));

function names(result) {
  return (result?.candidates || []).map((item) => item.name);
}

test("selected port is pinned to korean-law-mcp 4.10.0 main commit", () => {
  assert.deepEqual(UPSTREAM, {
    name: "chrisryugj/korean-law-mcp",
    version: "4.10.0",
    commit: "71e9f3d9819e9574daf54f7914ca832b1062a116",
    component: "src/lib/search-normalizer.ts",
    license: "MIT",
  });
  assert.equal(PORTED_ALIAS_ENTRIES.length, 44);
  assert.equal(PORTED_AMBIGUOUS_ENTRIES.length, 3);
});

test("pure text normalization handles legal punctuation and upstream typo characters", () => {
  assert.equal(normalizeLawSearchText("  민법\u00a0§ 750조 — 손해배상  "), "민법 제 750조-손해배상");
  assert.equal(normalizeLawSearchText("ＡＩ법"), "AI 법");
  assert.equal(normalizeBasicTypos("개보벚 관쉐볍"), "개보법 관세법");
});

test("high-confidence aliases and typo variants resolve locally", () => {
  assert.deepEqual(names(resolveAliases("화관법 제5조", { dataDir: DATA })), ["화학물질관리법"]);
  assert.deepEqual(names(resolveAliases("관세벚 제1조", { dataDir: DATA })), ["관세법"]);
  assert.deepEqual(names(resolveAliases("개보벚 제15조", { dataDir: DATA })), ["개인정보 보호법"]);
  assert.deepEqual(names(resolveAliases("AI법", { dataDir: DATA })), ["인공지능 발전과 신뢰 기반 조성 등에 관한 기본법"]);
  assert.deepEqual(names(resolveAliases("민 법 제750조", { dataDir: DATA })), ["민법"]);
});

test("conflicting broad aliases never auto-confirm one statute", () => {
  const nationalOrLand = resolveAliases("국계법 제1조", { dataDir: DATA });
  assert.equal(nationalOrLand.status, "ambiguous");
  assert.deepEqual(new Set(names(nationalOrLand)), new Set([
    "국가를 당사자로 하는 계약에 관한 법률",
    "국토의 계획 및 이용에 관한 법률",
  ]));

  const administrative = resolveAliases("행정법", { dataDir: DATA });
  assert.equal(administrative.status, "ambiguous");
  assert.equal(names(administrative).length, 4);

  const origin = resolveAliases("원산지법", { dataDir: DATA });
  assert.equal(origin.status, "ambiguous");
  assert.deepEqual(new Set(names(origin)), new Set(["대외무역법", "관세법"]));

  assert.deepEqual(names(resolveAliases("국가계약법 시행령", { dataDir: DATA })), ["국가를 당사자로 하는 계약에 관한 법률 시행령"]);
});

test("ported safe aliases add value beyond shipped official and reviewed aliases", () => {
  const official = loadExternalAliases(DATA);
  assert.equal(official.integrity, "ready");
  const existingKeys = new Set([
    ...REVIEWED_ALIASES.flatMap((record) => record.aliases.map(compact)),
    ...official.records.flatMap((record) => record.aliases.map(compact)),
  ]);
  const duplicateSafeAliases = PORTED_ALIAS_ENTRIES
    .flatMap((record) => record.aliases)
    .filter((alias) => existingKeys.has(compact(alias)));
  assert.deepEqual(duplicateSafeAliases, []);
});

test("unsafe broad upstream mappings were not imported as deterministic aliases", () => {
  const deterministicKeys = new Set(PORTED_ALIAS_ENTRIES.flatMap((record) => record.aliases.map(compact)));
  for (const omitted of ["상사법", "전기통신법", "지방공무원", "원산지 표시법", "원산지 사후판정", "국토이용법"]) {
    assert.equal(deterministicKeys.has(compact(omitted)), false, omitted);
  }
});

test("ported runtime module contains no network client or endpoint", () => {
  const source = fs.readFileSync(path.join(ROOT, "tools", "mcp-law", "upstream-search-normalizer.cjs"), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /https?:\/\//i);
  assert.doesNotMatch(source, /node:(?:net|tls|http|https)/);
  assert.doesNotMatch(source, /require\(["'](?:net|tls|http|https|undici|axios)["']\)/);
});

