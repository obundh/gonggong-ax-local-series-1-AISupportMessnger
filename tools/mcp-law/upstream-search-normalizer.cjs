"use strict";

// Selective, dependency-free port of the pure search normalization logic in
// chrisryugj/korean-law-mcp 4.10.0 (commit 71e9f3d9819e9574daf54f7914ca832b1062a116).
// The upstream HTTP/API/server code is intentionally not included. See
// third_party/licenses/korean-law-mcp-v4.10.0-MIT.txt.

const UPSTREAM = Object.freeze({
  name: "chrisryugj/korean-law-mcp",
  version: "4.10.0",
  commit: "71e9f3d9819e9574daf54f7914ca832b1062a116",
  component: "src/lib/search-normalizer.ts",
  license: "MIT",
});

const BASIC_CHAR_MAP = new Map([
  ["벚", "법"], ["벆", "법"], ["벋", "법"], ["뻡", "법"], ["볍", "법"], ["뱝", "법"],
  ["셰", "세"], ["쉐", "세"], ["괸", "관"], ["곽", "관"], ["엄", "업"], ["얼", "업"],
]);

// Only aliases that were not already supplied by HEYU's 2026-08-16 official
// abbreviation corpus/reviewed rules are carried here. Broad field labels and
// topic phrases from upstream are deliberately omitted or kept ambiguous.
const PORTED_ALIAS_ENTRIES = Object.freeze([
  entry("대한민국헌법", ["헌법", "헌 법"]),
  entry("상법", ["상 법"]),
  entry("민법", ["민 법"]),
  entry("형법", ["형 법"]),
  entry("어음법", ["어 음법"]),
  entry("수표법", ["수 표법"]),
  entry("관세법", ["관세벚", "관세요", "관세 볍", "관세 볍률"]),
  entry("자유무역협정의 이행을 위한 관세법의 특례에 관한 법률", ["FTA특례법", "FTA 특례법", "FTA 특례", "FTA특례", "에프티에이특례법"]),
  entry("화학물질관리법", ["화관법", "화관 법", "화학물질 관리법"]),
  entry("관세법 시행령", ["관시령", "관세시행령", "관세법시행령"]),
  entry("관세법 시행규칙", ["관시규", "관세시행규칙", "관세법시행규칙"]),
  entry("지방공무원법", ["지공법", "지방공무원 법"]),
  entry("지방공무원 임용령", ["지방공무원임용령", "지공임용령"]),
  entry("지방공무원 보수규정", ["지방공무원보수규정", "지공보수규정"]),
  entry("산업안전보건기준에 관한 규칙", ["산안기준규칙", "산업안전보건규칙", "산안규칙", "안전보건기준규칙"]),
  entry("중대재해 처벌 등에 관한 법률", ["중처법", "중대재해법"]),
  entry("남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률", ["고평법"]),
  entry("개인정보 보호법", ["개인정보법"]),
  entry("인공지능 발전과 신뢰 기반 조성 등에 관한 기본법", ["인공지능법", "AI기본법", "AI법"]),
  entry("공직자의 이해충돌 방지법", ["공직자이해충돌방지법"]),
  entry("부정청탁 및 금품등 수수의 금지에 관한 법률", ["김영란법"]),
  entry("부동산 거래신고 등에 관한 법률", ["부거법"]),
  entry("주택임대차보호법", ["주임법"]),
  entry("상가건물 임대차보호법", ["상임법"]),
  entry("국세기본법", ["국기법"]),
  entry("부가가치세법", ["부가세법"]),
  entry("독점규제 및 공정거래에 관한 법률", ["공거법", "독점규제법"]),
  entry("약관의 규제에 관한 법률", ["약관규제법"]),
  entry("가맹사업거래의 공정화에 관한 법률", ["가맹법"]),
  entry("전자상거래 등에서의 소비자보호에 관한 법률", ["전상법"]),
  entry("신용정보의 이용 및 보호에 관한 법률", ["신정법"]),
  entry("자본시장과 금융투자업에 관한 법률", ["자시법"]),
  entry("특정 금융거래정보의 보고 및 이용 등에 관한 법률", ["특금법"]),
  entry("전자금융거래법", ["전금법"]),
  entry("도시 및 주거환경정비법", ["도정법"]),
  entry("감염병의 예방 및 관리에 관한 법률", ["감염병법"]),
  entry("대기환경보전법", ["대기환경법", "대기법"]),
  entry("여객자동차 운수사업법", ["여객운수법"]),
  entry("화물자동차 운수사업법", ["화물운수법", "화운법"]),
  entry("민사소송법", ["민소법"]),
  entry("형사소송법", ["형소법"]),
  entry("민사집행법", ["민집법"]),
  entry("국민건강보험법", ["국건법", "건보법"]),
  entry("정보통신망 이용촉진 및 정보보호 등에 관한 법률", ["정통망법"]),
]);

// These upstream hints cannot safely name one current statute. They remain
// multiple candidates so the caller must clarify instead of auto-confirming.
const PORTED_AMBIGUOUS_ENTRIES = Object.freeze([
  entry(["국가를 당사자로 하는 계약에 관한 법률", "국토의 계획 및 이용에 관한 법률"], ["국계법"], { conflictHint: true }),
  entry(["행정기본법", "행정절차법", "행정조사기본법", "행정규제기본법"], ["행정법", "행정 법"], { conflictHint: true }),
  entry(["대외무역법", "관세법"], ["원산지법"], { conflictHint: true }),
]);

function entry(names, aliases, extra = {}) {
  return Object.freeze({
    aliases: Object.freeze([...aliases]),
    names: Object.freeze(Array.isArray(names) ? [...names] : [names]),
    source: "korean-law-mcp-4.10.0-selected-pure-normalizer",
    upstream: true,
    ...extra,
  });
}

function normalizeBasicTypos(value) {
  return String(value || "").replace(/[벚벆벋뻡볍뱝셰쉐괸곽엄얼]/gu, (char) => BASIC_CHAR_MAP.get(char) || char);
}

function normalizeLawSearchText(input) {
  let value = String(input || "").normalize("NFKC");
  value = value
    .replace(/[\u00a0\u2002\u2003\u2009]/gu, " ")
    .replace(/[‐‑‒–—―﹘﹣－]/gu, "-")
    .replace(/[﹦=]/gu, " ")
    .replace(/§/gu, " 제")
    .replace(/\s*-\s*/gu, "-")
    .replace(/\s*\.\s*/gu, " ")
    .replace(/([a-zA-Z])([가-힣])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .replace(/\(\s+/gu, "(")
    .replace(/\s+\)/gu, ")")
    .trim();
  return value;
}

function getPortedAliasRecords() {
  return [...PORTED_ALIAS_ENTRIES, ...PORTED_AMBIGUOUS_ENTRIES];
}

module.exports = {
  BASIC_CHAR_MAP,
  PORTED_ALIAS_ENTRIES,
  PORTED_AMBIGUOUS_ENTRIES,
  UPSTREAM,
  getPortedAliasRecords,
  normalizeBasicTypos,
  normalizeLawSearchText,
};
