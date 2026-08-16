"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_INDEX_BYTES = 256 * 1024 * 1024;
const MAX_SEARCH_BYTES = 256 * 1024 * 1024;
const MAX_RECORDS = 400_000;
const cache = new Map();

function normalizeKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function clean(value, max = 1_000) {
  return String(value || "").replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function loadOfficialTermPack(dataDirValue) {
  const root = path.resolve(dataDirValue || ".");
  const directory = path.join(root, "legal_terms");
  const manifestPath = path.join(directory, "manifest.json");
  const indexPath = path.join(directory, "index.json");
  const searchPath = path.join(directory, "search-index.jsonl");
  const fingerprint = fileFingerprint(manifestPath, indexPath, searchPath);
  if (!fingerprint) return emptyStatus("missing");
  const cached = cache.get(root);
  if (cached?.fingerprint === fingerprint) return cached.value;

  let value;
  try {
    const manifestBuffer = fs.readFileSync(manifestPath);
    const manifest = JSON.parse(manifestBuffer.toString("utf8"));
    const indexFile = manifestFile(manifest, "index.json");
    const searchFile = manifestFile(manifest, "search-index.jsonl");
    const indexStat = fs.statSync(indexPath);
    const searchStat = fs.statSync(searchPath);
    const indexHash = sha256File(indexPath);
    const searchHash = sha256File(searchPath);
    const shapeReady = manifest?.schemaVersion === 1 && manifest?.status === "complete" && manifest?.packType === "list-index" &&
      indexFile && searchFile && /^[a-f0-9]{64}$/.test(String(indexFile.sha256 || "")) && /^[a-f0-9]{64}$/.test(String(searchFile.sha256 || ""));
    const hashesReady = shapeReady && indexHash === String(indexFile.sha256).toLowerCase() && searchHash === String(searchFile.sha256).toLowerCase() &&
      indexStat.size === Number(indexFile.bytes) && searchStat.size === Number(searchFile.bytes);
    if (!hashesReady) {
      value = emptyStatus(shapeReady ? "mismatch" : "corrupt");
    } else {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      const rawRecords = Array.isArray(parsed?.records) ? parsed.records : [];
      const declaredCount = Number(manifest.recordCount || 0);
      if (!declaredCount || declaredCount > MAX_RECORDS || rawRecords.length !== declaredCount) throw new Error("official term record count mismatch");
      const records = rawRecords.map(normalizeRecord).filter(Boolean);
      if (records.length !== rawRecords.length || new Set(records.map((record) => record.id)).size !== records.length) throw new Error("official term identifiers are invalid");
      const searchCount = countJsonLines(searchPath);
      if (searchCount !== declaredCount) throw new Error("official term search count mismatch");
      const index = new Map();
      for (const record of records) {
        for (const alias of [record.name, ...record.synonyms]) {
          const key = normalizeKey(alias);
          if (!key || key.length > 500) continue;
          const candidates = index.get(key) || [];
          if (!candidates.some((candidate) => candidate.id === record.id)) candidates.push(record);
          index.set(key, candidates);
        }
      }
      const prefix = new Map();
      for (const key of index.keys()) {
        const prefixKey = key.slice(0, Math.min(2, key.length));
        if (!prefixKey) continue;
        const keys = prefix.get(prefixKey) || [];
        keys.push(key);
        prefix.set(prefixKey, keys);
      }
      for (const keys of prefix.values()) keys.sort((a, b) => b.length - a.length || a.localeCompare(b, "ko"));
      value = {
        available: true,
        integrity: "ready",
        hashVerified: true,
        contentSha256: clean(manifest.contentSha256, 80),
        indexHash,
        searchHash,
        recordCount: records.length,
        uniqueNormalizedNameCount: Number(manifest.uniqueNormalizedNameCount || index.size),
        duplicateNormalizedNameGroupCount: Number(manifest.duplicateNormalizedNameGroupCount || 0),
        ambiguousNormalizedNameGroupCount: Number(manifest.ambiguousNormalizedNameGroupCount || 0),
        retrievedAt: clean(manifest.retrievedAt, 60),
        generatedAt: clean(manifest.generatedAt, 60),
        packType: clean(manifest.packType, 80),
        coverage: normalizeCoverage(manifest.coverage),
        sources: normalizeSources(manifest.sources),
        index,
        prefix,
      };
    }
  } catch (_error) {
    value = emptyStatus("corrupt");
  }
  cache.set(root, { fingerprint, value });
  return value;
}

function searchOfficialTerms(query, options = {}) {
  const source = loadOfficialTermPack(options.dataDir);
  const normalizedQuery = normalizeKey(query);
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20));
  if (!source.available || !normalizedQuery) return publicResult(source, query, [], "none", 0, 0);

  const queryText = String(query || "");
  const matchedKeys = discoverMatchedKeys(queryText, normalizedQuery, source);
  const dominantExactKeys = discoverDominantExactKeys(queryText, normalizedQuery, source);
  const selectedMatchedKeys = dominantExactKeys.size
    ? matchedKeys.filter((matched) => dominantExactKeys.has(matched.key) && (matched.matchKind === "query-exact" || matched.matchKind === "segment-exact"))
    : matchedKeys;
  const matches = [];
  let totalCandidateCount = 0;
  for (const matched of selectedMatchedKeys) {
    const candidates = source.index.get(matched.key) || [];
    totalCandidateCount += candidates.length;
    for (const record of candidates) {
      if (matches.some((item) => item.id === record.id)) continue;
      matches.push(toPublicMatch(record, matched.key, matched.matchKind));
      if (matches.length >= limit) break;
    }
    if (matches.length >= limit) break;
  }
  const selectedKeys = [...new Set(matches.map((match) => match.matchedKey))];
  let resolutionStatus = "none";
  let sourceDuplicateCount = 0;
  if (matches.length) {
    if (dominantExactKeys.size > 1) resolutionStatus = "multiple";
    else if (dominantExactKeys.size === 1) {
      const sameKeyCandidates = source.index.get(selectedKeys[0]) || [];
      const normalizedFormalNames = new Set(sameKeyCandidates.map((item) => normalizeKey(item.name)).filter(Boolean));
      sourceDuplicateCount = Math.max(0, sameKeyCandidates.length - normalizedFormalNames.size);
      resolutionStatus = normalizedFormalNames.size > 1 || sameKeyCandidates.some((item) => item.homonymStatus === "declared") ? "ambiguous" : "exact";
    }
    else if (selectedKeys.length > 1) resolutionStatus = "multiple-candidate";
    else {
      const sameKeyCandidates = source.index.get(selectedKeys[0]) || [];
      resolutionStatus = sameKeyCandidates.length > 1 ? "multiple-candidate" : "candidate";
    }
  }
  return publicResult(source, query, matches, resolutionStatus, totalCandidateCount, sourceDuplicateCount);
}

function discoverDominantExactKeys(query, normalizedQuery, source) {
  if (source.index.has(normalizedQuery)) return new Set([normalizedQuery]);

  const dominant = new Set();
  for (const segment of splitQuerySegments(query)) {
    const normalized = normalizeKey(segment);
    if (!normalized) continue;
    const exactKeys = [];
    if (source.index.has(normalized)) exactKeys.push(normalized);
    for (const key of source.prefix.get(normalized.slice(0, Math.min(2, normalized.length))) || []) {
      if (key.length < 2 || !normalized.startsWith(key) || !hasOriginalSegmentBoundary(segment, key, source)) continue;
      exactKeys.push(key);
    }
    const longestLength = exactKeys.reduce((maximum, key) => Math.max(maximum, key.length), 0);
    for (const key of exactKeys) {
      if (key.length === longestLength) dominant.add(key);
    }
  }
  return dominant;
}

function discoverMatchedKeys(query, normalizedQuery, source) {
  const found = new Map();
  const add = (key, rank, matchKind) => {
    if (!key || !source.index.has(key)) return;
    const current = found.get(key);
    if (!current || rank > current.rank) found.set(key, { key, rank, matchKind });
  };
  add(normalizedQuery, 10_000 + normalizedQuery.length, "query-exact");

  const segments = splitQuerySegments(query);
  for (const segment of segments) {
    const normalized = normalizeKey(segment);
    if (!normalized) continue;
    add(normalized, 9_000 + normalized.length, "segment-exact");
    const prefixKeys = source.prefix.get(normalized.slice(0, Math.min(2, normalized.length))) || [];
    for (const key of prefixKeys) {
      if (key.length < 2 || !normalized.startsWith(key)) continue;
      const exactAtBoundary = hasOriginalSegmentBoundary(segment, key, source);
      add(key, (exactAtBoundary ? 8_500 : 7_000) + key.length, exactAtBoundary ? "segment-exact" : "segment-prefix");
    }
  }

  const seenPrefixes = new Set();
  for (let index = 0; index < normalizedQuery.length - 1; index += 1) {
    const prefixKey = normalizedQuery.slice(index, index + 2);
    if (seenPrefixes.has(prefixKey)) continue;
    seenPrefixes.add(prefixKey);
    for (const key of source.prefix.get(prefixKey) || []) {
      if (key.length < 3 || !normalizedQuery.includes(key)) continue;
      add(key, 5_000 + key.length, "query-contained");
    }
  }
  return [...found.values()].sort((a, b) => b.rank - a.rank || b.key.length - a.key.length || a.key.localeCompare(b.key, "ko"));
}

function hasOriginalSegmentBoundary(segment, key, source) {
  const haystack = String(segment || "").normalize("NFKC").toLowerCase().trimStart();
  for (const record of source.index.get(key) || []) {
    for (const alias of [record.name, ...record.synonyms]) {
      if (normalizeKey(alias) !== key) continue;
      const needle = String(alias || "").normalize("NFKC").toLowerCase().trim();
      if (!needle || !haystack.startsWith(needle)) continue;
      const next = haystack.slice(needle.length, needle.length + 1);
      if (!next || !/[\p{L}\p{N}]/u.test(next)) return true;
    }
  }
  return false;
}

function splitQuerySegments(query) {
  return String(query || "")
    .normalize("NFKC")
    .split(/[,;|/·、，\n\r]|\s+(?:및|또는|그리고)\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 50);
}

function toPublicMatch(record, matchedKey, matchKind) {
  const hasDefinition = Boolean(record.definition);
  return {
    id: record.id,
    sourceLayer: "official-legal-terminology-list",
    sourceTarget: record.sourceTarget,
    sourceId: record.sourceId,
    officialIds: record.officialIds,
    term: record.name,
    formalName: record.name,
    aliases: [record.name, ...record.synonyms],
    synonyms: record.synonyms,
    meaning: hasDefinition
      ? record.definition
      : "국가법령정보센터 공식 법령용어 목록에 수록된 표제어입니다. 이 목록 팩에는 해당 용어의 정의 본문이 포함되지 않았습니다.",
    definitionStatus: record.definitionStatus,
    relations: record.relations,
    relationBodyStatus: record.relationBodyStatus,
    homonymStatus: record.homonymStatus,
    note: record.note,
    lawTypeCode: record.lawTypeCode,
    dictionaryTypeCode: record.dictionaryTypeCode,
    detailIdentifier: record.detailIdentifier,
    detailIdentifiers: record.detailIdentifiers,
    matchedKey,
    matchKind,
    confidence: matchKind === "query-exact" || matchKind === "segment-exact" ? "official-list-exact" : "official-list-candidate",
  };
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = clean(raw.id, 180);
  const sourceTarget = clean(raw.sourceTarget, 40);
  const sourceId = clean(raw.sourceId, 120);
  const name = clean(raw.name, 500);
  const normalizedName = normalizeKey(raw.normalizedName || name);
  if (!id || !sourceTarget || !sourceId || !name || !normalizedName) return null;
  const synonyms = Array.isArray(raw.synonyms) ? raw.synonyms.map((value) => clean(value, 500)).filter(Boolean).slice(0, 100) : [];
  const officialIds = Array.isArray(raw.officialIds)
    ? raw.officialIds.map((value) => clean(value, 120)).filter((value) => /^\d{1,30}$/.test(value)).slice(0, 5_000)
    : (/^\d{1,30}$/.test(sourceId) ? [sourceId] : []);
  if (!officialIds.length) return null;
  const relations = Array.isArray(raw.relations) ? raw.relations.map((relation) => ({
    type: clean(relation?.type, 80),
    target: clean(relation?.target, 80),
    officialIdentifier: clean(relation?.officialIdentifier, 120),
  })).filter((relation) => relation.type && relation.target && relation.officialIdentifier).slice(0, 50) : [];
  return {
    id, sourceTarget, sourceId, officialIds: [...new Set(officialIds)], name, normalizedName,
    synonyms: [...new Set(synonyms)],
    definition: clean(raw.definition, 4_000),
    definitionStatus: clean(raw.definitionStatus, 80),
    relations,
    relationBodyStatus: clean(raw.relationBodyStatus, 80),
    homonymStatus: clean(raw.homonymStatus, 40),
    note: clean(raw.note, 1_000),
    lawTypeCode: clean(raw.lawTypeCode, 60),
    dictionaryTypeCode: clean(raw.dictionaryTypeCode, 60),
    detailIdentifier: {
      parameter: clean(raw.detailIdentifier?.parameter, 40),
      value: clean(raw.detailIdentifier?.value, 120),
    },
    detailIdentifiers: (Array.isArray(raw.detailIdentifiers) ? raw.detailIdentifiers : []).map((item) => ({
      parameter: clean(item?.parameter, 40),
      value: clean(item?.value, 120),
    })).filter((item) => item.parameter && /^\d{1,30}$/.test(item.value)).slice(0, 5_000),
  };
}

function publicResult(source, query, matches, resolutionStatus, totalCandidateCount, sourceDuplicateCount = 0) {
  return {
    ok: true,
    mode: "local-corpus-only",
    live: false,
    query: clean(query, 500),
    resolutionStatus,
    totalCandidateCount,
    sourceDuplicateCount,
    truncated: totalCandidateCount > matches.length,
    matches,
    source: {
      available: Boolean(source.available),
      integrity: source.integrity || "missing",
      hashVerified: Boolean(source.hashVerified),
      recordCount: Number(source.recordCount || 0),
      uniqueNormalizedNameCount: Number(source.uniqueNormalizedNameCount || 0),
      duplicateNormalizedNameGroupCount: Number(source.duplicateNormalizedNameGroupCount || 0),
      ambiguousNormalizedNameGroupCount: Number(source.ambiguousNormalizedNameGroupCount || 0),
      retrievedAt: source.retrievedAt || "",
      generatedAt: source.generatedAt || "",
      packType: source.packType || "",
      coverage: source.coverage || {},
      sources: source.sources || {},
    },
    limitation: "공식 법령용어 전체 목록 인덱스의 로컬 검색 결과입니다. 정의·동의어 관계·조문 관계 본문 전건 수록을 의미하지 않으며, 같은 표제어의 여러 공식 ID는 모두 확인해야 합니다.",
  };
}

function formatOfficialTermResult(result) {
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  const definitionCoverage = result?.source?.coverage?.definitions || {};
  return [
    `로컬 공식 법령용어 목록 검색: ${matches.length ? `${result.resolutionStatus} (${matches.length}건)` : "일치 없음"}`,
    `목록 범위: ${Number(result?.source?.recordCount || 0)}건; 정의 본문 포함: ${Number(definitionCoverage.recordCount || 0)}건`,
    ...matches.map((match, index) => `${index + 1}. untrusted_official_term_json=${safeJson(match)}`),
    result?.limitation || "",
  ].filter(Boolean).join("\n");
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function normalizeCoverage(raw) {
  if (!raw || typeof raw !== "object") return {};
  return {
    lists: sanitizePlainObject(raw.lists),
    definitions: sanitizePlainObject(raw.definitions),
    explicitSynonyms: sanitizePlainObject(raw.explicitSynonyms),
    relationReferences: sanitizePlainObject(raw.relationReferences),
  };
}

function normalizeSources(raw) {
  if (!raw || typeof raw !== "object") return {};
  const output = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!value || typeof value !== "object") continue;
    output[clean(key, 40)] = {
      label: clean(value.label, 160),
      apiTotal: Number(value.apiTotal || 0),
      recordCount: Number(value.recordCount || 0),
      pageCount: Number(value.pageCount || 0),
      retrievedAt: clean(value.retrievedAt, 60),
      listComplete: Boolean(value.listComplete),
      definitionCount: Number(value.definitionCount || 0),
      officialIdentifierParameter: clean(value.officialIdentifierParameter, 40),
    };
  }
  return output;
}

function sanitizePlainObject(raw) {
  if (!raw || typeof raw !== "object") return {};
  const output = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "boolean" || typeof value === "number") output[clean(key, 80)] = value;
    else if (typeof value === "string") output[clean(key, 80)] = clean(value, 600);
  }
  return output;
}

function manifestFile(manifest, name) {
  return Array.isArray(manifest?.files) ? manifest.files.find((file) => file?.path === name) : null;
}

function countJsonLines(file) {
  let count = 0;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== "object" || !parsed.id) throw new Error("invalid official terminology JSONL record");
    count += 1;
  }
  return count;
}

function fileFingerprint(...files) {
  try {
    const stats = files.map((file) => fs.statSync(file));
    if (stats.some((stat) => !stat.isFile())) return "";
    if (stats[0].size > MAX_MANIFEST_BYTES || stats[1].size > MAX_INDEX_BYTES || stats[2].size > MAX_SEARCH_BYTES) return "";
    return stats.flatMap((stat) => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.dev, stat.ino]).join(":");
  } catch (_error) {
    return "";
  }
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytes;
    while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function emptyStatus(integrity) {
  return { available: false, integrity, hashVerified: false, recordCount: 0, index: new Map(), prefix: new Map(), coverage: {}, sources: {} };
}

module.exports = {
  formatOfficialTermResult,
  loadOfficialTermPack,
  normalizeKey,
  safeJson,
  searchOfficialTerms,
  splitQuerySegments,
};
