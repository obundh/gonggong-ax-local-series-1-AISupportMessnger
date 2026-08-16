"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { searchOfficialTerms } = require("./official-term-provider.cjs");

const MAX_DATA_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_ENTRIES = 5_000;
const cache = new Map();

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function clean(value, max = 600) {
  return String(value || "").replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function loadPracticeTerms(dataDirValue) {
  const root = path.resolve(dataDirValue || ".");
  const directory = path.join(root, "legal_alias");
  const dataPath = path.join(directory, "practice-terms.json");
  const manifestPath = path.join(directory, "practice-terms.manifest.json");
  const fingerprint = fileFingerprint(dataPath, manifestPath);
  if (!fingerprint) return emptyStatus("missing", dataPath, manifestPath);
  const cached = cache.get(root);
  if (cached?.fingerprint === fingerprint) return cached.value;

  let value;
  try {
    const manifestBuffer = fs.readFileSync(manifestPath);
    const dataBuffer = fs.readFileSync(dataPath);
    const manifest = JSON.parse(manifestBuffer.toString("utf8"));
    const expected = String(manifest?.files?.["practice-terms.json"]?.sha256 || "").toLowerCase();
    const expectedBytes = Number(manifest?.files?.["practice-terms.json"]?.bytes || 0);
    const hash = crypto.createHash("sha256").update(dataBuffer).digest("hex");
    const parsed = JSON.parse(dataBuffer.toString("utf8"));
    const sourceEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];
    const entries = sourceEntries.slice(0, MAX_ENTRIES).map(normalizeEntry).filter(Boolean);
    const declaredEntries = Number(manifest?.counts?.entries || 0);
    const complete = manifest?.schemaVersion === 1 && manifest?.status === "complete" &&
      /^[a-f0-9]{64}$/.test(expected) && hash === expected && dataBuffer.length === expectedBytes &&
      entries.length > 0 && entries.length === declaredEntries && entries.length === sourceEntries.length;
    if (!complete) {
      value = emptyStatus(hash !== expected ? "mismatch" : "corrupt", dataPath, manifestPath);
    } else {
      const index = new Map();
      for (const entry of entries) {
        for (const alias of entry.aliases) {
          const key = normalizeKey(alias);
          if (!key || key.length > 120) continue;
          const items = index.get(key) || [];
          if (!items.some((item) => item.id === entry.id)) items.push(entry);
          index.set(key, items);
        }
      }
      value = {
        available: true,
        integrity: "ready",
        hash,
        expectedHash: expected,
        hashVerified: true,
        entryCount: entries.length,
        lookupKeyCount: Number(manifest?.counts?.lookupKeys || index.size),
        activeLookupKeyCount: index.size,
        license: clean(manifest.license, 80),
        attribution: clean(manifest.attribution, 160),
        basisDate: clean(manifest.basisDate, 40),
        dataPath,
        manifestPath,
        index,
      };
    }
  } catch (_error) {
    value = emptyStatus("corrupt", dataPath, manifestPath);
  }
  cache.set(root, { fingerprint, value });
  return value;
}

function resolvePracticeTerms(query, options = {}) {
  const source = loadPracticeTerms(options.dataDir);
  const normalizedQuery = normalizeKey(query);
  const limit = Math.max(1, Math.min(Number(options.limit) || 8, 20));
  const official = searchOfficialTerms(query, { dataDir: options.dataDir, limit });
  if (!normalizedQuery) return publicResult(source, query, [], "none", official);

  const practiceMatchedKeys = source.available ? [...source.index.keys()]
    .filter((key) => key.length >= 2 ? normalizedQuery.includes(key) : normalizedQuery === key)
    .sort((a, b) => b.length - a.length || a.localeCompare(b, "ko")) : [];
  const practiceMatches = [];
  for (const key of practiceMatchedKeys) {
    for (const entry of source.index.get(key) || []) {
      if (!hasSafePhraseBoundary(query, entry, key)) continue;
      if (practiceMatches.some((item) => item.id === entry.id)) continue;
      practiceMatches.push({ ...entry, sourceLayer: "practice-dictionary", matchedKey: key });
      if (practiceMatches.length >= limit) break;
    }
    if (practiceMatches.length >= limit) break;
  }
  const officialMatches = selectOfficialMatchesForCombinedQuery(query, practiceMatches, official.matches || []);
  const matches = [...practiceMatches];
  for (const candidate of officialMatches) {
    if (matches.length >= limit) break;
    if (matches.some((item) => item.id === candidate.id || (normalizeKey(item.formalName) === normalizeKey(candidate.formalName) && item.matchedKey === candidate.matchedKey))) continue;
    matches.push(candidate);
  }
  const status = combinedResolutionStatus(practiceMatches, official, matches, query);
  return publicResult(source, query, matches, status, official);
}

function selectOfficialMatchesForCombinedQuery(query, practiceMatches, officialMatches) {
  if (!practiceMatches.length) return officialMatches;
  const isExplicitMultiTerm = /[,;|/·、，\n\r]|\s+(?:및|또는|그리고)\s+/u.test(String(query || ""));
  if (!isExplicitMultiTerm) return officialMatches.filter((match) => match.matchKind === "query-exact" || match.matchKind === "segment-exact");
  const practiceKeys = new Set(practiceMatches.map((match) => match.matchedKey));
  return officialMatches.filter((match) => !practiceKeys.has(match.matchedKey) &&
    ["query-exact", "segment-exact", "segment-prefix"].includes(match.matchKind));
}

function combinedResolutionStatus(practiceMatches, officialResult, matches, query = "") {
  if (!matches.length) return "none";
  if (!practiceMatches.length) return officialResult.resolutionStatus || "none";
  const practiceKeys = [...new Set(practiceMatches.map((match) => match.matchedKey || normalizeKey(match.term)))];
  const longestLength = Math.max(...practiceKeys.map((key) => key.length));
  const dominantKeys = practiceKeys.filter((key) => key.length === longestLength);
  const dominantCandidates = practiceMatches.filter((match) => dominantKeys.includes(match.matchedKey || normalizeKey(match.term)));
  const explicitlySeparated = /[,;|/·、，\n\r]|\s+(?:및|또는|그리고)\s+/u.test(String(query || ""));
  if (explicitlySeparated) {
    const allKeys = [...new Set(matches.map((match) => `${match.sourceLayer || "practice"}:${match.matchedKey || normalizeKey(match.term)}`))];
    if (allKeys.length > 1) return "multiple";
  }
  if (dominantCandidates.length > 1) return "ambiguous";
  return "exact";
}

function hasSafePhraseBoundary(query, entry, key) {
  if (key.length === 1) return normalizeKey(query) === key;
  const source = String(query || "").normalize("NFKC").toLowerCase();
  for (const alias of entry.aliases || []) {
    if (normalizeKey(alias) !== key) continue;
    const needle = String(alias || "").normalize("NFKC").toLowerCase().trim();
    if (!needle) continue;
    let offset = 0;
    while (offset <= source.length - needle.length) {
      const index = source.indexOf(needle, offset);
      if (index < 0) break;
      const before = index > 0 ? source[index - 1] : "";
      if (!before || !/[\p{L}\p{N}]/u.test(before)) return true;
      offset = index + Math.max(needle.length, 1);
    }
  }
  return false;
}

function normalizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = clean(raw.id, 80);
  const term = clean(raw.term, 160);
  const formalName = clean(raw.formal_name, 240);
  if (!id || !term || !formalName) return null;
  const aliases = [term, formalName, ...String(raw.aliases || "").split("|")].map((item) => clean(item, 240)).filter(Boolean);
  return {
    id,
    term,
    formalName,
    aliases: [...new Set(aliases)],
    meaning: clean(raw.meaning, 1200),
    category: clean(raw.category, 180),
    termType: clean(raw.term_type, 120),
    legalBasis: clean(raw.legal_basis, 400),
    status: clean(raw.status, 100),
    ambiguityNote: clean(raw.ambiguity_note, 700),
    confidence: clean(raw.confidence, 60),
    priority: Math.max(0, Math.min(Number(raw.priority) || 0, 1000)),
    sources: clean(raw.sources, 700),
  };
}

function publicResult(source, query, matches, status, official = null) {
  return {
    ok: true,
    mode: "local-corpus-only",
    live: false,
    query: clean(query, 500),
    resolutionStatus: status,
    matches,
    source: {
      available: source.available,
      integrity: source.integrity,
      entryCount: source.entryCount || 0,
      lookupKeyCount: source.lookupKeyCount || 0,
      activeLookupKeyCount: source.activeLookupKeyCount || 0,
      basisDate: source.basisDate || "",
      license: source.license || "",
      attribution: source.attribution || "",
      hashVerified: Boolean(source.hashVerified),
      hash: source.hash || "",
      officialTermPack: official?.source || {
        available: false,
        integrity: "missing",
        recordCount: 0,
        coverage: {},
      },
    },
    limitation: "실무 용어 해석과 검색 라우팅 자료이며 법령·판례 원문 근거를 대체하지 않습니다. 다의어는 후보를 모두 확인해야 합니다.",
  };
}

function emptyStatus(integrity, dataPath, manifestPath) {
  return { available: false, integrity, entryCount: 0, lookupKeyCount: 0, hashVerified: false, dataPath, manifestPath, index: new Map() };
}

function fileFingerprint(dataPath, manifestPath) {
  try {
    const data = fs.statSync(dataPath);
    const manifest = fs.statSync(manifestPath);
    if (!data.isFile() || !manifest.isFile() || data.size > MAX_DATA_BYTES || manifest.size > MAX_MANIFEST_BYTES) return "";
    return [data.size, data.mtimeMs, data.ctimeMs, manifest.size, manifest.mtimeMs, manifest.ctimeMs].join(":");
  } catch (_error) {
    return "";
  }
}

function safeJson(value) {
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

function formatPracticeResult(result) {
  const matches = Array.isArray(result?.matches) ? result.matches : [];
  return [
    "로컬 실무 용어 해석: " + (matches.length ? `${result.resolutionStatus} (${matches.length}건)` : "일치 없음"),
    ...matches.map((item, index) => `${index + 1}. untrusted_practice_json=${safeJson(item)}`),
    result?.limitation || "",
  ].filter(Boolean).join("\n");
}

module.exports = { formatPracticeResult, loadPracticeTerms, normalizeKey, resolvePracticeTerms, safeJson };
