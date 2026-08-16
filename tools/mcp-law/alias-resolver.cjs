"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  getPortedAliasRecords,
  normalizeBasicTypos,
  normalizeLawSearchText,
} = require("./upstream-search-normalizer.cjs");

const MAX_ALIAS_FILE_BYTES = 20 * 1024 * 1024;
const MAX_ALIAS_RECORDS = 100_000;

const REVIEWED_ALIASES = Object.freeze([
  { aliases: ["근기법"], names: ["근로기준법"] },
  { aliases: ["개보법", "개인정보보호법"], names: ["개인정보 보호법"] },
  { aliases: ["정보공개법"], names: ["공공기관의 정보공개에 관한 법률"] },
  { aliases: ["국계법", "국가계약법"], names: ["국가를 당사자로 하는 계약에 관한 법률"] },
  { aliases: ["지계법", "지방계약법"], names: ["지방자치단체를 당사자로 하는 계약에 관한 법률"] },
  { aliases: ["노조법"], names: ["노동조합 및 노동관계조정법"] },
  { aliases: ["최임법"], names: ["최저임금법"] },
  { aliases: ["퇴직급여법", "퇴직금법"], names: ["근로자퇴직급여 보장법"] },
  { aliases: ["산안법"], names: ["산업안전보건법"] },
  { aliases: ["산재법", "산재보험법"], names: ["산업재해보상보험법"] },
  { aliases: ["고보법"], names: ["고용보험법"] },
]);

const LABOR_ROUTES = Object.freeze([
  ["근로기준법", ["근로계약", "임금", "근로시간", "휴게", "휴일", "연차", "해고", "취업규칙", "직장내괴롭힘"]],
  ["최저임금법", ["최저임금"]],
  ["근로자퇴직급여 보장법", ["퇴직금", "퇴직연금", "퇴직급여"]],
  ["노동조합 및 노동관계조정법", ["노동조합", "노조", "단체교섭", "단체협약", "파업", "쟁의행위", "부당노동행위"]],
  ["산업재해보상보험법", ["산재급여", "산재보험", "요양급여", "휴업급여"]],
  ["산업안전보건법", ["산업안전", "위험성평가", "안전보건"]],
  ["고용보험법", ["실업급여", "고용보험"]],
  ["기간제 및 단시간근로자 보호 등에 관한 법률", ["기간제", "단시간근로자"]],
  ["파견근로자 보호 등에 관한 법률", ["파견근로", "파견근로자"]],
  ["남녀고용평등과 일ㆍ가정 양립 지원에 관한 법률", ["고용성차별", "직장내성희롱", "일가정양립", "육아휴직"]],
  ["공무원의 노동조합 설립 및 운영 등에 관한 법률", ["공무원노조", "공무원노동조합"]],
  ["교원의 노동조합 설립 및 운영 등에 관한 법률", ["교원노조", "교원노동조합"]],
]);

function normalizeDisplay(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u00b7\uff65\u30fb]/g, "ㆍ")
    .replace(/\s+/g, " ")
    .trim();
}

function compact(value) {
  return normalizeDisplay(value).toLowerCase().replace(/[^가-힣a-z0-9]/g, "");
}

function resolveAliases(query, options = {}) {
  const displayQuery = normalizeLawSearchText(query);
  const compactQuery = compact(displayQuery);
  const typoCorrectedQuery = normalizeBasicTypos(displayQuery);
  const typoCorrectedCompactQuery = compact(typoCorrectedQuery);
  const dataDir = path.resolve(options.dataDir || ".");
  const external = loadExternalAliases(dataDir);
  const records = mergeAliasRecords([...REVIEWED_ALIASES, ...getPortedAliasRecords(), ...external.records]);

  const laborAlias = ["노동법", "근로법", "노동관계법"]
    .map((alias) => ({ alias, key: compact(alias) }))
    .find(({ key }) => compactQuery.includes(key));
  if (laborAlias) {
    const routed = LABOR_ROUTES
      .map(([name, terms]) => ({
        name,
        matchedTerms: terms.filter((term) => compactQuery.includes(compact(term))),
      }))
      .filter((item) => item.matchedTerms.length);
    if (routed.length === 1) {
      return {
        status: "resolved",
        kind: "topic-routed",
        matchedText: laborAlias.alias,
        candidates: routed,
        source: "reviewed-local-rules",
        manifest: external.manifest,
      };
    }
    return {
      status: "ambiguous",
      kind: "topic-umbrella",
      matchedText: laborAlias.alias,
      candidates: (routed.length ? routed : LABOR_ROUTES.map(([name]) => ({ name, matchedTerms: [] }))).slice(0, 12),
      source: "reviewed-local-rules",
      manifest: external.manifest,
    };
  }

  let bestLength = 0;
  const bestMatches = [];
  for (const record of records) {
    for (const alias of record.aliases) {
      const key = compact(alias);
      const directIndex = compactQuery.indexOf(key);
      const correctedIndex = typoCorrectedCompactQuery === compactQuery ? -1 : typoCorrectedCompactQuery.indexOf(key);
      const index = directIndex >= 0 ? directIndex : correctedIndex;
      if (index < 0) continue;
      if (key.length > bestLength) {
        bestLength = key.length;
        bestMatches.length = 0;
      }
      if (key.length !== bestLength) continue;
      const queryKey = directIndex >= 0 ? compactQuery : typoCorrectedCompactQuery;
      const signature = `${key}\u0000${record.names.join("\u0000")}`;
      if (bestMatches.some((item) => item.signature === signature)) continue;
      bestMatches.push({ record, alias, key, index, queryKey, signature, typoCorrected: directIndex < 0 });
    }
  }
  if (!bestMatches.length) {
    return { status: "none", kind: "none", matchedText: "", candidates: [], source: "", manifest: external.manifest };
  }

  const candidateNames = new Set();
  const sources = new Set();
  let requestedInstrument = "";
  for (const match of bestMatches) {
    requestedInstrument ||= readInstrument(match.queryKey.slice(match.index + match.key.length));
    sources.add(match.record.source || (match.record.official ? "official-local-alias-corpus" : "reviewed-local-rules"));
    for (const name of match.record.names) {
      candidateNames.add(requestedInstrument && !name.endsWith(requestedInstrument) ? `${name} ${requestedInstrument}` : name);
    }
  }
  const candidates = [...candidateNames].map((name) => ({ name, matchedTerms: [] }));
  const officialOnly = bestMatches.every((match) => match.record.official);
  const upstreamOnly = bestMatches.every((match) => match.record.upstream);
  const conflicting = candidates.length > 1 || bestMatches.some((match) => match.record.conflictHint);
  return {
    status: candidates.length === 1 ? "resolved" : "ambiguous",
    kind: conflicting ? "conflicting-alias" : officialOnly ? "official-alias" : upstreamOnly ? "ported-upstream-alias" : "reviewed-alias",
    matchedText: bestMatches[0].alias,
    requestedInstrument,
    candidates,
    source: [...sources].join(" + "),
    typoCorrected: bestMatches.some((match) => match.typoCorrected),
    normalizedQuery: displayQuery,
    manifest: external.manifest,
  };
}

function loadExternalAliases(dataDir) {
  const aliasDir = path.join(dataDir, "legal_alias");
  const aliasPath = path.join(aliasDir, "official-aliases.json");
  const manifestPath = path.join(aliasDir, "official-aliases.manifest.json");
  let records = [];
  let manifest = null;
  let hash = "";
  let expectedHash = "";
  let integrity = "missing";

  if (isBoundedFile(manifestPath, 2 * 1024 * 1024)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch (_error) { manifest = null; }
  }
  if (isBoundedFile(aliasPath, MAX_ALIAS_FILE_BYTES)) {
    try {
      const buffer = fs.readFileSync(aliasPath);
      hash = crypto.createHash("sha256").update(buffer).digest("hex");
      expectedHash = findManifestFileHash(manifest, "official-aliases.json");
      const parsed = JSON.parse(buffer.toString("utf8"));
      const entries = collectAliasEntries(parsed);
      const rawEntries = Array.isArray(parsed?.records) ? parsed.records : entries;
      for (const raw of entries) {
        const record = normalizeExternalAlias(raw);
        if (record) records.push(record);
        if (records.length >= MAX_ALIAS_RECORDS) break;
      }
      const declaredRawCount = Number(manifest?.counts?.records || manifest?.counts?.aliases || 0);
      const declaredUsableCount = Number(
        manifest?.counts?.usableAliases ||
        (manifest?.counts?.records ? manifest?.counts?.aliases : 0) ||
        0
      );
      const countsMatch =
        (!declaredRawCount || declaredRawCount === rawEntries.length) &&
        (!declaredUsableCount || declaredUsableCount === records.length);
      const manifestStatus = String(manifest?.status || "").toLowerCase();
      const retrievedAt = validTimestamp(manifest?.retrievedAt);
      const complete = Boolean(
        manifest?.schemaVersion === 1 &&
        manifest?.target === "lsAbrv" &&
        retrievedAt &&
        !/partial|incomplete|running/.test(manifestStatus) &&
        expectedHash && expectedHash === hash &&
        records.length > 0 &&
        countsMatch
      );
      integrity = complete ? "ready" : /partial|incomplete|running/.test(manifestStatus) ? "partial" : expectedHash && expectedHash !== hash ? "mismatch" : "corrupt";
    } catch (_error) {
      integrity = "corrupt";
    }
  } else if (manifest) {
    integrity = "corrupt";
  }
  if (integrity !== "ready") records = [];
  return { records, manifest, integrity, hash, expectedHash, aliasPath, manifestPath };
}

function getOfficialAliasStatus(dataDir) {
  const loaded = loadExternalAliases(path.resolve(dataDir || "."));
  const source = loaded.manifest?.source;
  return {
    available: loaded.integrity === "ready",
    integrity: loaded.integrity,
    count: loaded.records.length,
    collectedAt: validTimestamp(loaded.manifest?.retrievedAt),
    source: normalizeDisplay(source && typeof source === "object" ? source.name : source).slice(0, 300),
    hash: loaded.hash,
    expectedHash: loaded.expectedHash,
    hashVerified: Boolean(loaded.hash && loaded.hash === loaded.expectedHash),
    manifestHash: isBoundedFile(loaded.manifestPath, 2 * 1024 * 1024)
      ? crypto.createHash("sha256").update(fs.readFileSync(loaded.manifestPath)).digest("hex")
      : "",
  };
}

function collectAliasEntries(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["aliases", "items", "records", "data", "results"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return Object.entries(value).map(([alias, name]) => ({ alias, name }));
}

function normalizeExternalAlias(value) {
  if (!value || typeof value !== "object") return null;
  const aliases = arrayText(value.aliases || value.alias || value.shortName || value.short || value.법령약칭명);
  const names = arrayText(
    value.names || value.targets || value.canonicalNames || value.canonicalName || value.officialName || value.name || value.lawName || value.법령명한글 || value.법령명
  );
  if (!aliases.length || !names.length) return null;
  return {
    aliases,
    names,
    official: true,
    source: normalizeDisplay(value.source || "official-local-alias-corpus").slice(0, 200),
  };
}

function arrayText(value) {
  const items = Array.isArray(value) ? value : [value];
  return [...new Set(items.map((item) => normalizeDisplay(typeof item === "object" ? item?.name : item)).filter((item) => item && item.length <= 200))];
}

function mergeAliasRecords(records) {
  const merged = new Map();
  for (const raw of records) {
    const aliases = arrayText(raw.aliases);
    const names = arrayText(raw.names);
    if (!aliases.length || !names.length) continue;
    const key = aliases.map(compact).sort().join("|");
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...raw, aliases, names });
      continue;
    }
    current.names = [...new Set([...current.names, ...names])];
    current.official = Boolean(current.official || raw.official);
    if (raw.source) current.source = raw.source;
  }
  return [...merged.values()];
}

function readInstrument(suffix) {
  if (suffix.startsWith("시행규칙")) return "시행규칙";
  if (suffix.startsWith("시행령")) return "시행령";
  return "";
}

function isBoundedFile(filePath, maxBytes) {
  try {
    const stat = fs.statSync(filePath);
    return stat.isFile() && stat.size <= maxBytes;
  } catch (_error) {
    return false;
  }
}

function findManifestFileHash(manifest, fileName) {
  const entry = Array.isArray(manifest?.files)
    ? manifest.files.find((item) => path.basename(String(item?.path || item?.name || "")) === fileName)
    : manifest?.files?.[fileName];
  const hash = String(typeof entry === "string" ? entry : entry?.sha256 || entry?.hash || "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : "";
}

function validTimestamp(value) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime()) || date.getTime() > Date.now() + 86_400_000) return "";
  return date.toISOString();
}

module.exports = {
  LABOR_ROUTES,
  REVIEWED_ALIASES,
  compact,
  getOfficialAliasStatus,
  loadExternalAliases,
  normalizeDisplay,
  normalizeLawSearchText,
  resolveAliases,
};
