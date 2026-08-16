"use strict";

const fs = require("node:fs");
const path = require("node:path");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_INDEX_PATH = path.join(ROOT_DIR, "data", "legal_alias", "official-names.json");
const MAX_INDEX_BYTES = 20 * 1024 * 1024;
const MAX_OFFICIAL_NAMES = 250_000;

const BUILTIN_OFFICIAL_NAMES = [
  "대한민국헌법",
  "민법",
  "형법",
  "상법",
  "근로기준법",
  "근로기준법 시행령",
  "최저임금법",
  "근로자퇴직급여 보장법",
  "노동조합 및 노동관계조정법",
  "산업안전보건법",
  "산업재해보상보험법",
  "고용보험법",
  "기간제 및 단시간근로자 보호 등에 관한 법률",
  "파견근로자 보호 등에 관한 법률",
  "남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률",
  "공무원의 노동조합 설립 및 운영 등에 관한 법률",
  "교원의 노동조합 설립 및 운영 등에 관한 법률",
  "개인정보 보호법",
  "공공기관의 정보공개에 관한 법률",
  "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
  "국가를 당사자로 하는 계약에 관한 법률",
  "국가를 당사자로 하는 계약에 관한 법률 시행령",
  "지방자치단체를 당사자로 하는 계약에 관한 법률",
  "지방자치단체를 당사자로 하는 계약에 관한 법률 시행령",
  "공공기록물 관리에 관한 법률",
  "민원 처리에 관한 법률",
  "공유재산 및 물품 관리법",
  "물품관리법",
  "국고금 관리법",
  "지방회계법",
  "보조금 관리에 관한 법률",
  "지방자치단체 보조금 관리에 관한 법률",
  "국가공무원법",
  "지방공무원법",
  "국가공무원 복무규정",
  "지방공무원 복무규정",
  "공무원 여비 규정",
  "행정기본법",
  "행정절차법",
  "행정소송법",
  "민사소송법",
  "형사소송법",
  "주택임대차보호법",
  "상가건물 임대차보호법",
  "전자정부법",
  "전자금융거래법",
  "부정청탁 및 금품등 수수의 금지에 관한 법률",
  "도로교통법",
];

const BUILTIN_ALIASES = [
  singleAlias(["근기법"], "근로기준법"),
  singleAlias(["개보법", "개인정보보호법"], "개인정보 보호법"),
  singleAlias(["정보공개법"], "공공기관의 정보공개에 관한 법률"),
  singleAlias(["국계법", "국가계약법"], "국가를 당사자로 하는 계약에 관한 법률"),
  singleAlias(["지계법", "지방계약법"], "지방자치단체를 당사자로 하는 계약에 관한 법률"),
  singleAlias(["노조법"], "노동조합 및 노동관계조정법"),
  singleAlias(["퇴직급여법", "퇴직금법"], "근로자퇴직급여 보장법"),
  singleAlias(["최임법"], "최저임금법"),
  singleAlias(["산안법"], "산업안전보건법"),
  singleAlias(["산재보험법", "산재법"], "산업재해보상보험법"),
  singleAlias(["고보법"], "고용보험법"),
  singleAlias(["민소법"], "민사소송법"),
  singleAlias(["형소법"], "형사소송법"),
  singleAlias(["행소법"], "행정소송법"),
  singleAlias(["행기법"], "행정기본법"),
  singleAlias(["행절법"], "행정절차법"),
  singleAlias(["주임법"], "주택임대차보호법"),
  singleAlias(["상임법"], "상가건물 임대차보호법"),
  singleAlias(["망법", "정보통신망법"], "정보통신망 이용촉진 및 정보보호 등에 관한 법률"),
  singleAlias(["전자금융법"], "전자금융거래법"),
  singleAlias(["청탁금지법", "김영란법"], "부정청탁 및 금품등 수수의 금지에 관한 법률"),
  singleAlias(["기록물법"], "공공기록물 관리에 관한 법률"),
  singleAlias(["민원처리법"], "민원 처리에 관한 법률"),
  singleAlias(["공유재산법"], "공유재산 및 물품 관리법"),
  singleAlias(["국고금관리법"], "국고금 관리법"),
  singleAlias(["여비규정"], "공무원 여비 규정"),
  singleAlias(["헌법"], "대한민국헌법", { searchTerm: "헌법" }),
  {
    aliases: ["노동법", "근로법", "노동관계법"],
    reason: "노동법은 여러 노동관계 법령을 가리키는 분야 표현",
    candidates: [
      routedCandidate("근로기준법", [
        "근로계약", "임금", "근로시간", "휴게", "휴일", "연차", "해고", "취업규칙", "직장 내 괴롭힘",
      ]),
      routedCandidate("최저임금법", ["최저임금"]),
      routedCandidate("근로자퇴직급여 보장법", ["퇴직금", "퇴직연금", "퇴직급여"]),
      routedCandidate("노동조합 및 노동관계조정법", [
        "노동조합", "노조", "단체교섭", "단체협약", "파업", "쟁의행위", "부당노동행위",
      ]),
      routedCandidate("산업재해보상보험법", ["산재 급여", "산재보험", "요양급여", "휴업급여"]),
      routedCandidate("산업안전보건법", ["산업안전", "위험성평가", "안전보건"]),
      routedCandidate("고용보험법", ["실업급여", "고용보험"]),
      routedCandidate("기간제 및 단시간근로자 보호 등에 관한 법률", ["기간제", "단시간근로자"]),
      routedCandidate("파견근로자 보호 등에 관한 법률", ["파견근로", "파견근로자"]),
      routedCandidate("남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률", [
        "고용 성차별", "직장 내 성희롱", "일 가정 양립", "육아휴직",
      ]),
      routedCandidate("공무원의 노동조합 설립 및 운영 등에 관한 법률", ["공무원 노조", "공무원 노동조합"]),
      routedCandidate("교원의 노동조합 설립 및 운영 등에 관한 법률", ["교원 노조", "교원 노동조합"]),
    ],
  },
];

let cachedCatalog = null;

function singleAlias(aliases, name, options = {}) {
  return {
    aliases,
    candidates: [{ name, searchTerm: options.searchTerm || name }],
  };
}

function routedCandidate(name, when) {
  return { name, searchTerm: name, when };
}

function normalizeDisplayName(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[·･・]/g, "ㆍ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactName(value) {
  return normalizeDisplayName(value)
    .toLowerCase()
    .replace(/[^가-힣a-z0-9]/g, "");
}

function safeOfficialName(value) {
  const name = normalizeDisplayName(value);
  if (!name || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) return "";
  return name;
}

function normalizeOfficialRecord(value, fallbackCategory = "current-central") {
  if (typeof value === "string") {
    const name = safeOfficialName(value);
    return name ? { name, category: fallbackCategory, status: categoryStatus(fallbackCategory) } : null;
  }
  const name = safeOfficialName(value?.name);
  if (!name) return null;
  const category = ["current-central", "administrative-rule", "historical"].includes(value?.category)
    ? value.category
    : fallbackCategory;
  return { name, category, status: value?.status || categoryStatus(category) };
}

function categoryStatus(category) {
  return category === "historical" ? "historical" : "current";
}

function resolveCatalogPath(indexPath) {
  return path.resolve(indexPath || process.env.HEYU_LEGAL_ALIAS_INDEX || DEFAULT_INDEX_PATH);
}

function loadOfficialCatalog(options = {}) {
  const indexPath = resolveCatalogPath(options.indexPath);
  let stat;
  try {
    stat = fs.statSync(indexPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {
      indexPath,
      loaded: false,
      sourceCommit: "",
      records: BUILTIN_OFFICIAL_NAMES.map((name) => ({ name, category: "current-central", status: "current" })),
    };
  }
  if (!stat.isFile() || stat.size > MAX_INDEX_BYTES) {
    throw new Error("Legal name index is missing or exceeds the local size limit");
  }
  if (cachedCatalog && cachedCatalog.indexPath === indexPath && cachedCatalog.mtimeMs === stat.mtimeMs && cachedCatalog.size === stat.size) {
    return cachedCatalog.catalog;
  }

  const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  if (parsed?.schemaVersion !== 1 || typeof parsed?.names !== "object") {
    throw new Error("Unsupported legal name index schema");
  }
  const groups = [
    [parsed.names.currentCentral, "current-central"],
    [parsed.names.administrativeRules, "administrative-rule"],
    [parsed.names.historical, "historical"],
  ];
  const records = [];
  for (const [items, category] of groups) {
    if (!Array.isArray(items)) continue;
    for (const value of items) {
      const record = normalizeOfficialRecord(value, category);
      if (record) records.push(record);
      if (records.length > MAX_OFFICIAL_NAMES) throw new Error("Legal name index contains too many entries");
    }
  }
  const catalog = {
    indexPath,
    loaded: true,
    sourceCommit: String(parsed?.source?.sourceCommit || ""),
    records: mergeOfficialRecords(records),
  };
  cachedCatalog = { indexPath, mtimeMs: stat.mtimeMs, size: stat.size, catalog };
  return catalog;
}

function mergeOfficialRecords(records, { includeBuiltins = true } = {}) {
  const priority = { "current-central": 3, "administrative-rule": 2, historical: 1 };
  const byName = new Map();
  for (const raw of records) {
    const record = normalizeOfficialRecord(raw, raw?.category);
    if (!record) continue;
    const key = normalizeDisplayName(record.name);
    const current = byName.get(key);
    if (!current || (priority[record.category] || 0) > (priority[current.category] || 0)) byName.set(key, record);
  }
  if (includeBuiltins) {
    for (const name of BUILTIN_OFFICIAL_NAMES) {
      if (!byName.has(name)) byName.set(name, { name, category: "current-central", status: "current" });
    }
  }
  return [...byName.values()];
}

function createLawAliasResolver({ officialNames, aliases = BUILTIN_ALIASES } = {}) {
  const baseRecords = Array.isArray(officialNames)
    ? officialNames.map((value) => normalizeOfficialRecord(value)).filter(Boolean)
    : loadOfficialCatalog().records;
  const records = mergeOfficialRecords(baseRecords);
  const aliasRecords = normalizeAliasRecords(aliases);

  function recordsForTarget(target) {
    if (target === "admrul") return records.filter((record) => record.category === "administrative-rule");
    // Live law/precedent searches must not promote an abolished or historical
    // title to a current statute merely because it exists in the catalogue.
    return records.filter((record) => record.category === "current-central");
  }

  function resolveLegalName(query, options = {}) {
    const normalizedQuery = normalizeDisplayName(query);
    const compactQuery = compactName(normalizedQuery);
    const target = String(options.target || "law");
    const limit = Math.max(1, Math.min(10, Number(options.limit) || 5));
    if (!compactQuery) return emptyResolution(normalizedQuery);

    const official = findOfficialMatches(normalizedQuery, compactQuery, recordsForTarget(target));
    if (official.length) {
      const candidates = official.slice(0, limit).map((record) => ({
        name: record.name,
        searchTerm: record.name,
        reason: record.category === "historical" ? "과거 법령명 카탈로그 일치" : "정식 법령명 카탈로그 일치",
        category: record.category,
        status: record.status,
      }));
      return {
        status: candidates.length === 1 ? "resolved" : "ambiguous",
        matchedText: official[0].matchedText,
        candidates,
        normalizedQuery,
      };
    }

    const aliasMatch = findAliasMatch(compactQuery, aliasRecords);
    if (!aliasMatch) return emptyResolution(normalizedQuery);
    const requestedInstrument = suffixAfterAlias(compactQuery, aliasMatch);
    let candidates = resolveAliasCandidates(aliasMatch.record, compactQuery);
    if (requestedInstrument) {
      candidates = candidates
        .map((candidate) => appendVerifiedInstrument(candidate, requestedInstrument, recordsForTarget(target)))
        .filter(Boolean);
    }
    candidates = dedupeCandidates(candidates).slice(0, limit);
    if (!candidates.length) {
      return {
        status: "none",
        matchedText: aliasMatch.alias,
        candidates: [],
        normalizedQuery,
        reason: requestedInstrument ? `요청한 ${requestedInstrument}이 현행 정식명 목록에서 확인되지 않음` : "별칭 후보 없음",
      };
    }
    return {
      status: candidates.length === 1 ? "resolved" : "ambiguous",
      matchedText: aliasMatch.alias,
      candidates,
      normalizedQuery,
      reason: aliasMatch.record.reason || "검수된 법령 별칭",
    };
  }

  function canonicalizeLegalName(value) {
    const normalized = normalizeDisplayName(value);
    const compact = compactName(normalized);
    if (!compact) return normalized;
    const official = records.filter((record) => compactName(record.name) === compact);
    const officialNames = [...new Set(official.map((record) => record.name))];
    if (officialNames.length === 1) return officialNames[0];
    const exactAlias = aliasRecords.find((record) => record.aliases.some((alias) => compactName(alias) === compact));
    if (!exactAlias) return normalized;
    const candidates = dedupeCandidates(resolveAliasCandidates(exactAlias, compact));
    return candidates.length === 1 ? candidates[0].name : normalized;
  }

  return { resolveLegalName, canonicalizeLegalName };
}

function normalizeAliasRecords(aliases) {
  return (Array.isArray(aliases) ? aliases : [])
    .map((record) => ({
      aliases: [...new Set((record?.aliases || []).map(normalizeDisplayName).filter(Boolean))],
      candidates: (record?.candidates || []).map((candidate) => ({
        name: safeOfficialName(typeof candidate === "string" ? candidate : candidate?.name),
        searchTerm: safeOfficialName(candidate?.searchTerm || candidate?.name || candidate),
        when: Array.isArray(candidate?.when) ? candidate.when.map(normalizeDisplayName).filter(Boolean) : [],
        reason: String(candidate?.reason || record?.reason || "검수된 법령 별칭"),
      })).filter((candidate) => candidate.name),
      reason: String(record?.reason || ""),
    }))
    .filter((record) => record.aliases.length && record.candidates.length)
    .sort((a, b) => Math.max(...b.aliases.map((alias) => compactName(alias).length)) - Math.max(...a.aliases.map((alias) => compactName(alias).length)));
}

function findOfficialMatches(normalizedQuery, compactQuery, records) {
  const direct = [];
  const compact = [];
  for (const record of records) {
    const name = normalizeDisplayName(record.name);
    const nameCompact = compactName(name);
    if (!nameCompact) continue;
    const directIndex = normalizedQuery.indexOf(name);
    if (directIndex >= 0 && (nameCompact.length >= 4 || hasShortNameBoundary(normalizedQuery, directIndex))) {
      direct.push({ ...record, matchedText: name, matchLength: nameCompact.length });
      continue;
    }
    const compactIndex = compactQuery.indexOf(nameCompact);
    if (compactIndex >= 0 && nameCompact.length >= 4) {
      compact.push({ ...record, matchedText: name, matchLength: nameCompact.length });
    }
  }
  const pool = direct.length ? direct : compact;
  if (!pool.length) return [];
  const maxLength = Math.max(...pool.map((record) => record.matchLength));
  return mergeOfficialRecords(pool.filter((record) => record.matchLength === maxLength), { includeBuiltins: false })
    .map((record) => ({ ...record, matchedText: pool.find((item) => item.name === record.name)?.matchedText || record.name, matchLength: maxLength }));
}

function hasShortNameBoundary(query, index) {
  if (index <= 0) return true;
  return !/[가-힣A-Za-z0-9]/.test(query[index - 1]);
}

function findAliasMatch(compactQuery, records) {
  let best = null;
  for (const record of records) {
    for (const alias of record.aliases) {
      const compactAlias = compactName(alias);
      const index = compactQuery.indexOf(compactAlias);
      if (index < 0) continue;
      if (!best || compactAlias.length > best.compactAlias.length) {
        best = { record, alias, compactAlias, index };
      }
    }
  }
  return best;
}

function suffixAfterAlias(compactQuery, match) {
  const suffix = compactQuery.slice(match.index + match.compactAlias.length);
  if (suffix.startsWith("시행규칙")) return "시행규칙";
  if (suffix.startsWith("시행령")) return "시행령";
  return "";
}

function resolveAliasCandidates(record, compactQuery) {
  const routed = record.candidates
    .map((candidate) => ({
      ...candidate,
      matchedTerms: candidate.when.filter((term) => compactQuery.includes(compactName(term))),
    }))
    .filter((candidate) => candidate.matchedTerms.length);
  const selected = routed.length ? routed : record.candidates.filter((candidate) => !candidate.when.length);
  const base = selected.length ? selected : record.candidates;
  return base.map((candidate) => ({
    name: candidate.name,
    searchTerm: candidate.searchTerm || candidate.name,
    reason: candidate.matchedTerms?.length
      ? `분야 표현과 쟁점 일치: ${candidate.matchedTerms.join(", ")}`
      : candidate.reason,
  }));
}

function appendVerifiedInstrument(candidate, instrument, records) {
  if (candidate.name.endsWith(instrument)) return candidate;
  const expectedCompact = compactName(`${candidate.name} ${instrument}`);
  const exact = records.filter((record) => compactName(record.name) === expectedCompact);
  const names = [...new Set(exact.map((record) => record.name))];
  if (names.length !== 1) return null;
  return {
    ...candidate,
    name: names[0],
    searchTerm: names[0],
    reason: `${candidate.reason}; 현행 정식 ${instrument} 명칭 확인`,
  };
}

function dedupeCandidates(candidates) {
  const byName = new Map();
  for (const candidate of candidates) {
    const key = normalizeDisplayName(candidate?.name);
    if (key && !byName.has(key)) byName.set(key, { ...candidate, name: key, searchTerm: candidate.searchTerm || key });
  }
  return [...byName.values()];
}

function emptyResolution(normalizedQuery) {
  return { status: "none", matchedText: "", candidates: [], normalizedQuery };
}

let singletonCatalog = null;
let singletonResolver = null;

function getSingletonResolver() {
  const catalog = loadOfficialCatalog();
  if (!singletonResolver || singletonCatalog !== catalog) {
    singletonCatalog = catalog;
    singletonResolver = createLawAliasResolver({ officialNames: catalog.records });
  }
  return singletonResolver;
}

function resolveLegalName(query, options) {
  return getSingletonResolver().resolveLegalName(query, options);
}

function canonicalizeLegalName(value) {
  return getSingletonResolver().canonicalizeLegalName(value);
}

module.exports = {
  BUILTIN_ALIASES,
  BUILTIN_OFFICIAL_NAMES,
  canonicalizeLegalName,
  compactName,
  createLawAliasResolver,
  loadOfficialCatalog,
  normalizeDisplayName,
  resolveLegalName,
};
