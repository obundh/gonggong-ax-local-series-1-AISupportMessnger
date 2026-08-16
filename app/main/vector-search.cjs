const fs = require("fs");
const path = require("path");
const readline = require("readline");

const ROOT_DIR = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DEFAULT_VECTOR_DIR = path.join(DATA_DIR, "vector", "legal-v1");
const VECTOR_MANIFEST = "manifest.json";
const VECTOR_CHUNKS = "chunks.jsonl";
const DEFAULT_HASH_DIMENSIONS = 1024;
const DEFAULT_TOP_LIMIT = 8;
const DEFAULT_MIN_SCORE = 0.055;
const DEFAULT_OLLAMA_MIN_SCORE = 0.23;
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_EMBED_MODEL = "nomic-embed-text";
const MAX_MEMORY_INDEX_BYTES = 320 * 1024 * 1024;

const LEGAL_VECTOR_SOURCES = [
  {
    id: "law",
    label: "\ubc95\ub839",
    path: path.join(DATA_DIR, "law", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "law", "manifest.json"),
  },
  {
    id: "precedent-body",
    label: "\ud310\ub840",
    path: path.join(DATA_DIR, "precedent_body", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "precedent_body", "manifest.json"),
  },
  {
    id: "expc",
    label: "\ubc95\ub839\ud574\uc11d\ub840",
    path: path.join(DATA_DIR, "legal_refs", "expc", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "expc", "manifest.json"),
  },
  {
    id: "decc",
    label: "\ud589\uc815\uc2ec\ud310\ub840",
    path: path.join(DATA_DIR, "legal_refs", "decc", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "decc", "manifest.json"),
  },
  {
    id: "admrul",
    label: "\ud589\uc815\uaddc\uce59",
    path: path.join(DATA_DIR, "legal_refs", "admrul", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "admrul", "manifest.json"),
  },
  {
    id: "detc",
    label: "\ud5cc\uc7ac\uacb0\uc815\ub840",
    path: path.join(DATA_DIR, "legal_refs", "detc", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "detc", "manifest.json"),
  },
];

let legalVectorCache = null;
let legalVectorCacheKey = "";

async function searchLegalVectorEvidence(query, options = {}) {
  if (String(process.env.HEYU_LEGAL_VECTOR_DISABLE || "").trim() === "1") return [];

  const index = loadLegalVectorIndex(options);
  if (!index) return [];

  const limit = positiveInteger(options.limit, DEFAULT_TOP_LIMIT);
  const minScore =
    typeof options.minScore === "number"
      ? options.minScore
      : index.provider === "ollama"
        ? Number(process.env.HEYU_LEGAL_VECTOR_MIN_SCORE || DEFAULT_OLLAMA_MIN_SCORE)
        : Number(process.env.HEYU_LEGAL_VECTOR_MIN_SCORE || DEFAULT_MIN_SCORE);

  const queryVector =
    index.provider === "ollama"
      ? await embedOne(String(query || ""), {
          model: index.model || DEFAULT_EMBED_MODEL,
          baseUrl: index.baseUrl || DEFAULT_OLLAMA_BASE_URL,
          timeoutMs: positiveInteger(process.env.HEYU_LEGAL_VECTOR_TIMEOUT_MS, 4500),
        })
      : buildHashVector(String(query || ""), index.dimensions || DEFAULT_HASH_DIMENSIONS);

  if (!queryVector) return [];

  const queryMap = Array.isArray(queryVector?.[0]) ? sparseToMap(queryVector) : null;
  const candidates = [];

  const visit = (record) => {
    const vector = decodeVector(record.vector);
    const score = queryMap ? sparseDot(queryMap, vector) : denseDot(queryVector, vector);
    if (score < minScore) return;
    insertScoredCandidate(candidates, { record, score }, limit * 4);
  };

  if (Array.isArray(index.records)) {
    for (const record of index.records) visit(record);
  } else {
    await streamVectorRecords(index.chunksPath, visit);
  }

  return candidates.slice(0, limit).map(({ record, score }) => ({
    sourceId: `vector-${record.sourceId || "legal"}`,
    sourceLabel: `${record.sourceLabel || "vector"}\u00b7vector`,
    title: record.title || "",
    meta: record.meta || "",
    text: record.text || "",
    articleTitle: record.articleTitle || "",
    sourceFile: record.sourceFile || "",
    lawKey: record.lawKey || "",
    vectorScore: Number(score.toFixed(5)),
  }));
}

function loadLegalVectorIndex(options = {}) {
  const vectorDir = resolveVectorDir(options.vectorDir);
  const manifestPath = path.join(vectorDir, VECTOR_MANIFEST);
  const chunksPath = path.join(vectorDir, VECTOR_CHUNKS);
  const cacheKey = `${manifestPath}:${chunksPath}`;

  if (legalVectorCache && legalVectorCacheKey === cacheKey) return legalVectorCache;
  if (!fs.existsSync(manifestPath) || !fs.existsSync(chunksPath)) return null;

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (_error) {
    return null;
  }

  const chunksSize = safeFileSize(chunksPath);
  const index = {
    provider: manifest.provider || "hash",
    model: manifest.model || "",
    baseUrl: manifest.baseUrl || DEFAULT_OLLAMA_BASE_URL,
    dimensions: manifest.dimensions || DEFAULT_HASH_DIMENSIONS,
    records: null,
    chunksPath,
    manifest,
  };

  if (chunksSize <= MAX_MEMORY_INDEX_BYTES) {
    const records = [];
    try {
      const lines = fs.readFileSync(chunksPath, "utf8").split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        const record = JSON.parse(line);
        record.vector = decodeVector(record.vector);
        if (!record.vector.length) continue;
        records.push(record);
      }
      index.records = records;
    } catch (_error) {
      index.records = null;
    }
  }

  legalVectorCache = index;
  legalVectorCacheKey = cacheKey;
  return legalVectorCache;
}

async function buildLegalVectorIndex(options = {}) {
  const provider = String(options.provider || process.env.HEYU_LEGAL_VECTOR_PROVIDER || "hash").toLowerCase();
  if (!["hash", "ollama"].includes(provider)) {
    throw new Error(`Unsupported vector provider: ${provider}`);
  }

  const vectorDir = resolveVectorDir(options.vectorDir);
  const dimensions = positiveInteger(options.dimensions, DEFAULT_HASH_DIMENSIONS);
  const model = String(options.model || process.env.HEYU_EMBED_MODEL || DEFAULT_EMBED_MODEL);
  const baseUrl = String(options.baseUrl || process.env.HEYU_LLM_BASE_URL || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  const batchSize = Math.max(1, Math.min(positiveInteger(options.batchSize, 8), 64));
  const maxRecords = Math.max(0, positiveInteger(options.maxRecords, 0));
  const contains = normalizeContainsFilter(options.contains);
  const sources = selectSources(options.sources);
  const startedAt = new Date().toISOString();

  fs.mkdirSync(vectorDir, { recursive: true });
  const chunksPath = path.join(vectorDir, VECTOR_CHUNKS);
  const tempPath = `${chunksPath}.tmp`;
  const out = fs.createWriteStream(tempPath, { encoding: "utf8" });

  let processed = 0;
  let indexed = 0;
  let pending = [];

  async function flush() {
    if (!pending.length) return;

    if (provider === "ollama") {
      const inputs = pending.map((item) => vectorInputText(item.record));
      const vectors = await embedMany(inputs, { model, baseUrl, timeoutMs: positiveInteger(options.timeoutMs, 120000) });
      for (let index = 0; index < pending.length; index += 1) {
        const vector = vectors[index];
        if (!vector?.length) continue;
        out.write(`${JSON.stringify({ ...pending[index].record, vector })}\n`);
        indexed += 1;
      }
    } else {
      for (const item of pending) {
        const vector = buildHashVector(vectorInputText(item.record), dimensions);
        if (!vector?.length) continue;
        out.write(`${JSON.stringify({ ...item.record, vector: encodeSparseVector(vector) })}\n`);
        indexed += 1;
      }
    }

    pending = [];
    if (typeof options.onProgress === "function") {
      options.onProgress({ processed, indexed });
    }
  }

  try {
    for (const source of sources) {
      if (!fs.existsSync(source.path)) continue;
      const rl = readline.createInterface({
        input: fs.createReadStream(source.path, { encoding: "utf8" }),
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (maxRecords && indexed >= maxRecords) break;
        processed += 1;
        if (!line.trim()) continue;

        let raw;
        try {
          raw = JSON.parse(line);
        } catch (_error) {
          continue;
        }

        const record = normalizeVectorRecord(source, raw);
        if (!record || !matchesContains(record, contains)) continue;
        pending.push({ record });
        if (pending.length >= batchSize) await flush();
      }

      if (maxRecords && indexed >= maxRecords) break;
    }

    await flush();
  } finally {
    await closeStream(out);
  }

  fs.renameSync(tempPath, chunksPath);

  const manifest = {
    version: "legal-v1",
    provider,
    model: provider === "ollama" ? model : "",
    baseUrl: provider === "ollama" ? baseUrl : "",
    dimensions: provider === "hash" ? dimensions : undefined,
    sourceIds: sources.map((source) => source.id),
    contains,
    maxRecords,
    processed,
    indexed,
    startedAt,
    builtAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(vectorDir, VECTOR_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  legalVectorCache = null;
  legalVectorCacheKey = "";
  return manifest;
}

function normalizeVectorRecord(source, record) {
  const text = compactVectorText(record.text || record.content || "", 330);
  if (!text || isEmptyVectorResult(text)) return null;

  const title = compactVectorText(record.lawName || record.caseName || record.itemTitle || record.title || record.name || source.label, 150);
  const articleTitle = record.lawName && record.title ? compactVectorText(record.title, 90) : "";
  const meta = buildVectorMeta(record);

  return {
    id: `${source.id}:${record.id || record.lawKey || record.caseNo || record.itemNumber || `${title}:${meta}`}`,
    sourceId: source.id,
    sourceLabel: record.targetLabel || source.label,
    title,
    meta,
    text,
    articleTitle,
    sourceFile: record.sourceFile || "",
    lawKey: record.lawKey || "",
  };
}

function vectorInputText(record) {
  return [record.title, record.articleTitle, record.meta, record.text].filter(Boolean).join("\n");
}

function buildVectorMeta(record) {
  const pieces = [];
  if (record.articleNo) pieces.push(`\uc81c${record.articleNo}\uc870`);
  if (record.caseNo) pieces.push(record.caseNo);
  if (record.itemNumber) pieces.push(record.itemNumber);
  if (record.courtName) pieces.push(record.courtName);
  if (record.organization) pieces.push(record.organization);
  if (record.decisionDate) pieces.push(formatVectorDate(record.decisionDate));
  if (record.date) pieces.push(formatVectorDate(record.date));
  if (record.section) pieces.push(record.section);
  return pieces.filter(Boolean).join(" / ");
}

function buildHashVector(value, dimensions = DEFAULT_HASH_DIMENSIONS) {
  const features = extractHashFeatures(value);
  if (!features.length) return [];

  const buckets = new Map();
  for (const feature of features) {
    const weight = feature.length >= 4 ? 1.25 : 1;
    const hash = fnv1a(feature);
    const index = hash % dimensions;
    const sign = hash & 0x80000000 ? -1 : 1;
    buckets.set(index, (buckets.get(index) || 0) + sign * weight);
  }

  let norm = 0;
  for (const value of buckets.values()) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return [];

  return [...buckets.entries()]
    .map(([index, bucketValue]) => [index, Number((bucketValue / norm).toFixed(4))])
    .sort((a, b) => a[0] - b[0]);
}

function extractHashFeatures(value) {
  const normalized = String(value || "")
    .toLowerCase()
    .replace(/[^\p{Script=Hangul}a-z0-9]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return [];

  const features = [];
  const tokens = normalized.match(/[\p{Script=Hangul}a-z0-9]+/gu) || [];
  for (const token of tokens) {
    if (token.length >= 2) features.push(token);
    if (/[\p{Script=Hangul}]/u.test(token)) {
      for (let size = 2; size <= 3; size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          features.push(token.slice(index, index + size));
        }
      }
    }
  }

  for (let index = 0; index < tokens.length - 1; index += 1) {
    const pair = `${tokens[index]} ${tokens[index + 1]}`;
    if (pair.length <= 36) features.push(pair);
  }

  return features.slice(0, 55);
}

function sparseToMap(vector) {
  const map = new Map();
  for (const pair of vector || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    map.set(pair[0], pair[1]);
  }
  return map;
}

function sparseDot(queryMap, vector) {
  let score = 0;
  for (const pair of vector || []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const value = queryMap.get(pair[0]);
    if (value) score += value * pair[1];
  }
  return score;
}

async function streamVectorRecords(chunksPath, visit) {
  const rl = readline.createInterface({
    input: fs.createReadStream(chunksPath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch (_error) {
      continue;
    }
    if (!record?.vector) continue;
    visit(record);
  }
}

function encodeSparseVector(vector) {
  return (vector || []).map(([index, value]) => `${index}:${formatVectorNumber(value)}`).join(" ");
}

function decodeVector(vector) {
  if (typeof vector === "string") return decodeSparseVector(vector);
  if (Array.isArray(vector)) return vector;
  return [];
}

function decodeSparseVector(value) {
  const pairs = [];
  for (const token of String(value || "").split(/\s+/)) {
    if (!token) continue;
    const [indexText, valueText] = token.split(":");
    const index = Number(indexText);
    const number = Number(valueText);
    if (!Number.isFinite(index) || !Number.isFinite(number)) continue;
    pairs.push([index, number]);
  }
  return pairs;
}

function formatVectorNumber(value) {
  return Number(value)
    .toFixed(4)
    .replace(/0+$/, "")
    .replace(/\.$/, "");
}

function denseDot(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length) return 0;
  let score = 0;
  for (let index = 0; index < a.length; index += 1) score += a[index] * b[index];
  return score;
}

async function embedOne(input, options) {
  const vectors = await embedMany([input], options);
  return vectors[0] || null;
}

async function embedMany(inputs, options = {}) {
  const model = options.model || DEFAULT_EMBED_MODEL;
  const baseUrl = String(options.baseUrl || DEFAULT_OLLAMA_BASE_URL).replace(/\/+$/, "");
  const timeoutMs = positiveInteger(options.timeoutMs, 120000);

  try {
    const result = await postJson(`${baseUrl}/api/embed`, { model, input: inputs }, timeoutMs);
    const vectors = result?.embeddings;
    if (Array.isArray(vectors) && vectors.length) return vectors.map(normalizeDenseVector);
  } catch (_error) {
    // Older Ollama builds use /api/embeddings and accept one prompt at a time.
  }

  const vectors = [];
  for (const input of inputs) {
    const result = await postJson(`${baseUrl}/api/embeddings`, { model, prompt: input }, timeoutMs);
    vectors.push(normalizeDenseVector(result?.embedding || []));
  }
  return vectors;
}

async function postJson(url, body, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeDenseVector(vector) {
  if (!Array.isArray(vector) || !vector.length) return [];
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!norm) return [];
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

function insertScoredCandidate(candidates, item, limit) {
  candidates.push(item);
  candidates.sort((a, b) => b.score - a.score);
  if (candidates.length > limit) candidates.length = limit;
}

function resolveVectorDir(vectorDir) {
  return path.resolve(ROOT_DIR, vectorDir || process.env.HEYU_LEGAL_VECTOR_DIR || DEFAULT_VECTOR_DIR);
}

function selectSources(sourceIds) {
  const selected = Array.isArray(sourceIds)
    ? sourceIds
    : String(sourceIds || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
  if (!selected.length) return LEGAL_VECTOR_SOURCES;
  const wanted = new Set(selected);
  return LEGAL_VECTOR_SOURCES.filter((source) => wanted.has(source.id));
}

function normalizeContainsFilter(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function matchesContains(record, contains) {
  if (!contains.length) return true;
  const haystack = vectorInputText(record);
  return contains.some((term) => haystack.includes(term));
}

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function safeFileSize(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch (_error) {
    return Number.MAX_SAFE_INTEGER;
  }
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function compactVectorText(value, limit = 420) {
  const text = String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function isEmptyVectorResult(text) {
  return /\uc77c\uce58\ud558\ub294 .+ \uc5c6\uc2b5\ub2c8\ub2e4|\ud655\uc778\ud558\uc5ec \uc8fc\uc2ed\uc2dc\uc624/.test(text);
}

function formatVectorDate(value) {
  const text = String(value || "");
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function closeStream(stream) {
  return new Promise((resolve, reject) => {
    stream.end(() => resolve());
    stream.once("error", reject);
  });
}

module.exports = {
  LEGAL_VECTOR_SOURCES,
  buildHashVector,
  buildLegalVectorIndex,
  loadLegalVectorIndex,
  searchLegalVectorEvidence,
};
