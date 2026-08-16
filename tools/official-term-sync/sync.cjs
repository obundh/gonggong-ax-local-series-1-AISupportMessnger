#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  makeGate,
  redactString,
  replaceFile,
} = require("../official-law-sync/sync.cjs");

const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const GUIDE_ROOT = "https://open.law.go.kr/LSO/openApi/guideResult.do";
const SOURCE_ORDER = Object.freeze(["lstrmAI", "lstrm"]);
const SOURCES = Object.freeze({
  lstrmAI: Object.freeze({
    label: "법령정보지식베이스 법령용어",
    rootKeys: ["lstrmAISearch"],
    rowKeys: ["법령용어"],
    totalKeys: ["검색결과개수", "totalCnt", "totalCount"],
    nameKeys: ["법령용어명", "법령용어명_한글"],
    idKeys: ["MST", "법령용어ID", "법령용어일련번호"],
    listIdKeys: ["id"],
    homonymKeys: ["동음이의어존재여부"],
    noteKeys: ["비고"],
    guide: "lstrmAIGuide",
    detailIdentifierParameter: "MST",
  }),
  lstrm: Object.freeze({
    label: "국가법령정보센터 법령용어",
    rootKeys: ["LsTrmSearch", "LstrmSearch"],
    rowKeys: ["lstrm", "법령용어"],
    totalKeys: ["totalCnt", "검색결과개수", "totalCount"],
    nameKeys: ["법령용어명", "법령용어명_한글"],
    idKeys: ["법령용어ID", "법령용어일련번호", "trmSeqs"],
    listIdKeys: ["id"],
    homonymKeys: ["동음이의어존재여부"],
    noteKeys: ["비고"],
    guide: "lsTrmListGuide",
    detailIdentifierParameter: "trmSeqs",
  }),
});

const LINK_KEY = /(?:링크|url|uri|href|endpoint)$/i;
const SECRET_KEY = /^(?:oc|law_oc|token|access_?token|api_?key|apikey|authorization|secret)$/i;
const LEGAL_NOTICE = Object.freeze({
  use: "국가법령정보센터 법령용어 목록의 로컬 검색용 사본입니다.",
  coverage: "이 팩은 lstrmAI와 lstrm의 전체 목록 인덱스이며, 모든 용어의 정의·동의어 관계·조문 관계 본문을 수록한 팩이 아닙니다.",
  effect: "이 데이터는 참고자료이며 법적 효력이 없습니다. 법적 효력이 필요한 경우 관보 등 공식 원문을 우선 확인하십시오.",
});

function parseArgs(argv) {
  const args = {
    root: process.env.OFFICIAL_TERM_ROOT || "data",
    sources: parseList(process.env.OFFICIAL_TERM_SOURCES || SOURCE_ORDER.join(",")),
    display: boundedInt(process.env.OFFICIAL_TERM_DISPLAY, 100, 1, 100),
    maxPages: boundedInt(process.env.OFFICIAL_TERM_MAX_PAGES, 0, 0, 1_000_000),
    delayMs: boundedInt(process.env.OFFICIAL_TERM_DELAY_MS, 350, 100, 60_000),
    retries: boundedInt(process.env.OFFICIAL_TERM_RETRIES, 4, 0, 10),
    timeoutMs: boundedInt(process.env.OFFICIAL_TERM_TIMEOUT_MS, 45_000, 1_000, 300_000),
    refresh: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--root") args.root = requiredValue(arg, next), i += 1;
    else if (arg === "--sources") args.sources = parseList(requiredValue(arg, next)), i += 1;
    else if (arg === "--display") args.display = boundedInt(requiredValue(arg, next), 100, 1, 100), i += 1;
    else if (arg === "--max-pages") args.maxPages = boundedInt(requiredValue(arg, next), 0, 0, 1_000_000), i += 1;
    else if (arg === "--delay-ms") args.delayMs = boundedInt(requiredValue(arg, next), 350, 100, 60_000), i += 1;
    else if (arg === "--retries") args.retries = boundedInt(requiredValue(arg, next), 4, 0, 10), i += 1;
    else if (arg === "--timeout-ms") args.timeoutMs = boundedInt(requiredValue(arg, next), 45_000, 1_000, 300_000), i += 1;
    else if (arg === "--refresh") args.refresh = true;
    else if (arg === "--oc") throw new Error("--oc is disabled because command-line secrets leak into history. Set LAW_OC instead.");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.sources = [...new Set(args.sources.filter((source) => SOURCES[source]))];
  if (!args.sources.length) throw new Error("No supported official terminology sources selected.");
  return args;
}

function printHelp() {
  process.stdout.write(`Official Korean legal terminology list-pack sync\n\nLAW_OC must be supplied only as an environment variable. It is never written to a page cache, state file, manifest, or log.\n\n  node tools/official-term-sync/sync.cjs\n  node tools/official-term-sync/sync.cjs --max-pages 10\n  node tools/official-term-sync/sync.cjs --refresh\n\nOptions:\n  --root DIR       parent data directory (default: data)\n  --sources LIST   lstrmAI,lstrm (default: both)\n  --display N      rows per page, 1-100 (default: 100)\n  --max-pages N    newly downloaded pages in this run; 0 = unlimited\n  --delay-ms N     minimum delay between request starts (minimum 100 ms)\n  --refresh        begin a new generation; active completed pack stays unchanged until promotion\n`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const oc = String(process.env.LAW_OC || "").trim();
  if (!oc) throw new Error("Missing LAW_OC environment variable.");

  const root = path.resolve(args.root);
  const syncRoot = path.join(root, ".official-term-sync");
  ensureDir(syncRoot);
  const baseSignature = sha256Text(JSON.stringify({ schemaVersion: 1, sources: args.sources, display: args.display })).slice(0, 20);
  const generation = selectGeneration(syncRoot, baseSignature, args.refresh);
  const workDir = path.join(syncRoot, generation.signature);
  const statePath = path.join(workDir, "state.json");
  ensureDir(workDir);
  const state = loadState(statePath, generation.signature, baseSignature, args);
  const ctx = { ...args, root, syncRoot, workDir, statePath, oc, gate: makeGate(args.delayMs), downloadedThisRun: 0, nextProgressPercent: 0 };
  atomicJson(statePath, state);

  for (const source of args.sources) {
    await ensureFirstPage(source, state, ctx);
    if (pageBudgetReached(ctx)) break;
  }
  reportCombinedProgress(state, ctx, true);
  for (const source of args.sources) {
    await syncRemainingPages(source, state, ctx);
    if (pageBudgetReached(ctx)) break;
  }

  const complete = args.sources.every((source) => state.sources[source]?.listComplete);
  state.status = complete ? "lists-complete" : "partial";
  state.updatedAt = now();
  atomicJson(statePath, state);
  reportCombinedProgress(state, ctx, true);
  if (!complete) {
    process.stdout.write(`[partial] downloadedThisRun=${ctx.downloadedThisRun} resumeState=${path.relative(root, statePath).replaceAll("\\", "/")}\n`);
    return;
  }

  const result = buildAndPromotePack(state, ctx);
  state.status = "complete";
  state.output = { directory: "legal_terms", contentSha256: result.manifest.contentSha256, promotedAt: now() };
  state.updatedAt = now();
  atomicJson(statePath, state);
  process.stdout.write(`[done] records=${result.manifest.recordCount} definitions=${result.manifest.coverage.definitions.recordCount} output=${result.outputDir}\n`);
}

function selectGeneration(syncRoot, baseSignature, refresh) {
  const pointerPath = path.join(syncRoot, "current.json");
  const pointer = readJson(pointerPath);
  let signature = pointer?.baseSignature === baseSignature ? cleanToken(pointer.signature) : "";
  if (refresh || !signature) signature = refresh
    ? `${baseSignature}-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`
    : baseSignature;
  atomicJson(pointerPath, { schemaVersion: 1, baseSignature, signature, selectedAt: now() });
  return { signature };
}

function loadState(statePath, signature, baseSignature, args) {
  const old = readJson(statePath);
  if (old?.schemaVersion === 1 && old.signature === signature && old.baseSignature === baseSignature) {
    old.sources ||= {};
    for (const source of args.sources) old.sources[source] ||= newSourceState();
    return old;
  }
  return {
    schemaVersion: 1,
    signature,
    baseSignature,
    status: "new",
    startedAt: now(),
    updatedAt: now(),
    configuration: { sources: args.sources, display: args.display },
    sources: Object.fromEntries(args.sources.map((source) => [source, newSourceState()])),
  };
}

function newSourceState() {
  return { nextPage: 1, apiTotal: 0, totalPages: 0, pagesDownloaded: 0, listComplete: false, retrievedAt: null };
}

async function ensureFirstPage(source, state, ctx) {
  const sourceState = state.sources[source] ||= newSourceState();
  const pagesDir = sourcePagesDir(ctx.workDir, source);
  ensureDir(pagesDir);
  const first = path.join(pagesDir, pageName(1));
  let page = readJson(first);
  if (!isValidSanitizedPage(page, source, 1)) {
    if (pageBudgetReached(ctx)) return;
    page = await downloadPage(source, 1, ctx);
    atomicJson(first, page);
    ctx.downloadedThisRun += 1;
  }
  observePage(source, 1, page, sourceState, ctx.display);
  sourceState.pagesDownloaded = countPageFiles(pagesDir);
  sourceState.nextPage = Math.max(2, Number(sourceState.nextPage || 1));
  sourceState.updatedAt = now();
  state.updatedAt = sourceState.updatedAt;
  atomicJson(ctx.statePath, state);
}

async function syncRemainingPages(source, state, ctx) {
  const sourceState = state.sources[source] ||= newSourceState();
  if (!sourceState.apiTotal) await ensureFirstPage(source, state, ctx);
  const pagesDir = sourcePagesDir(ctx.workDir, source);
  for (let pageNumber = Math.max(1, Number(sourceState.nextPage || 1)); !sourceState.listComplete; pageNumber += 1) {
    if (pageBudgetReached(ctx)) break;
    const file = path.join(pagesDir, pageName(pageNumber));
    let page = readJson(file);
    if (!isValidSanitizedPage(page, source, pageNumber)) {
      page = await downloadPage(source, pageNumber, ctx);
      atomicJson(file, page);
      ctx.downloadedThisRun += 1;
    }
    observePage(source, pageNumber, page, sourceState, ctx.display);
    sourceState.pagesDownloaded = countPageFiles(pagesDir);
    sourceState.nextPage = pageNumber + 1;
    sourceState.updatedAt = now();
    if (sourceState.listComplete) sourceState.retrievedAt = sourceState.updatedAt;
    state.updatedAt = sourceState.updatedAt;
    atomicJson(ctx.statePath, state);
    reportCombinedProgress(state, ctx);
  }
}

async function downloadPage(source, pageNumber, ctx) {
  const url = new URL(SEARCH_URL);
  for (const [key, value] of Object.entries({ OC: ctx.oc, target: source, type: "JSON", display: ctx.display, page: pageNumber })) {
    url.searchParams.set(key, String(value));
  }
  let lastError;
  for (let attempt = 0; attempt <= ctx.retries; attempt += 1) {
    try {
      await ctx.gate();
      const response = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": "heyu-official-term-sync/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
      const raw = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${redactString(raw.slice(0, 200), ctx.oc)}`);
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { throw new Error(`Invalid JSON: ${redactString(raw.slice(0, 120), ctx.oc)}`); }
      assertApiResponse(source, parsed);
      const sanitized = sanitizeApiValue(parsed, ctx.oc);
      const serialized = JSON.stringify(sanitized);
      if (containsCredential(serialized, ctx.oc)) throw new Error("Credential remained after response sanitization.");
      return { schemaVersion: 1, source, page: pageNumber, fetchedAt: now(), payload: sanitized };
    } catch (error) {
      lastError = new Error(redactString(error?.message || String(error), ctx.oc));
      if (attempt >= ctx.retries) break;
      await sleep(Math.min(15_000, 500 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function sanitizeApiValue(value, oc, key = "") {
  if (LINK_KEY.test(key)) return undefined;
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") return redactAnyOc(redactString(value, oc), oc);
  if (Array.isArray(value)) return value.map((item) => sanitizeApiValue(item, oc, key));
  if (value && typeof value === "object") {
    const output = {};
    const officialIdentifierRefs = [];
    for (const [childKey, child] of Object.entries(value)) {
      if (SECRET_KEY.test(childKey)) continue;
      if (LINK_KEY.test(childKey)) {
        const identifier = extractIdentifierFromString(child);
        if (identifier) officialIdentifierRefs.push({
          parameter: /trmSeqs/i.test(String(child)) ? "trmSeqs" : /[?&]MST=/i.test(String(child)) ? "MST" : "ID",
          value: identifier,
        });
        continue;
      }
      const sanitized = sanitizeApiValue(child, oc, childKey);
      if (sanitized !== undefined) output[childKey] = sanitized;
    }
    if (officialIdentifierRefs.length) {
      output.__officialIdentifierRefs = officialIdentifierRefs.filter((ref, index) =>
        officialIdentifierRefs.findIndex((other) => other.parameter === ref.parameter && other.value === ref.value) === index);
    }
    return output;
  }
  return value;
}

function redactAnyOc(value, currentOc = "") {
  let text = String(value || "");
  text = text.replace(/([?&]OC=)[^&\s"']*/gi, "$1REDACTED");
  text = text.replace(/\bOC\s*[:=]\s*[^&\s,;]+/gi, "OC=[REDACTED]");
  if (currentOc) text = text.split(currentOc).join("[REDACTED]");
  return text;
}

function observePage(source, pageNumber, pageWrapper, sourceState, display) {
  const config = SOURCES[source];
  const root = findRoot(pageWrapper.payload, config.rootKeys);
  const rows = listItems(root, config.rowKeys);
  const total = numberByKeys(root, config.totalKeys);
  if (!Number.isInteger(total) || total <= 0) throw new Error(`Official ${source} page ${pageNumber} did not report a positive total.`);
  if (sourceState.apiTotal && sourceState.apiTotal !== total) {
    throw new Error(`Official ${source} total changed during generation: expected ${sourceState.apiTotal}, got ${total}. Start --refresh after the source stabilizes.`);
  }
  sourceState.apiTotal = total;
  sourceState.totalPages = Math.ceil(total / display);
  const expectedRows = pageNumber < sourceState.totalPages ? display : total - ((sourceState.totalPages - 1) * display);
  if (pageNumber <= sourceState.totalPages && rows.length !== expectedRows) {
    throw new Error(`Official ${source} page ${pageNumber} row count mismatch: expected ${expectedRows}, got ${rows.length}.`);
  }
  if (pageNumber >= sourceState.totalPages) sourceState.listComplete = true;
}

function buildAndPromotePack(state, ctx) {
  const staging = path.join(ctx.workDir, "pack-staging");
  assertDescendant(ctx.workDir, staging);
  if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
  ensureDir(staging);

  const records = [];
  const sourceCounts = {};
  for (const source of ctx.sources) {
    const sourceState = state.sources[source];
    const rawRows = readCompleteRows(source, sourceState, ctx.workDir, ctx.display);
    assertCompleteListCount(source, sourceState.apiTotal, rawRows.length);
    const normalized = rawRows.map((row, index) => normalizeTermRecord(source, row, index + 1));
    assertOfficialIdentifiers(source, normalized, sourceState.apiTotal);
    appendRecords(records, normalized);
    sourceCounts[source] = {
      label: SOURCES[source].label,
      apiTotal: sourceState.apiTotal,
      recordCount: normalized.length,
      pageCount: sourceState.totalPages,
      retrievedAt: sourceState.retrievedAt,
      listComplete: true,
      definitionCount: normalized.filter((record) => record.definition).length,
      explicitSynonymRecordCount: normalized.filter((record) => record.synonyms.length).length,
      relationReferenceRecordCount: normalized.filter((record) => record.relations.length).length,
      officialIdentifierReferenceCount: normalized.reduce((sum, record) => sum + record.officialIds.length, 0),
      uniqueOfficialIdentifierCount: new Set(normalized.flatMap((record) => record.officialIds)).size,
    };
  }
  records.sort(compareRecords);
  const counts = analyzeRecords(records);
  const generatedAt = now();
  const index = {
    schemaVersion: 1,
    generatedAt,
    packType: "official-legal-terminology-list-index",
    records,
  };
  const indexPath = path.join(staging, "index.json");
  const searchPath = path.join(staging, "search-index.jsonl");
  atomicJson(indexPath, index);
  atomicWrite(searchPath, records.map((record) => `${JSON.stringify(record)}\n`).join(""));
  const files = [fileRecord(indexPath, staging), fileRecord(searchPath, staging)];
  const retrievedAt = Object.values(sourceCounts).map((item) => item.retrievedAt).filter(Boolean).sort().at(-1) || null;
  const manifest = {
    schemaVersion: 1,
    target: "official-legal-terms",
    status: "complete",
    packType: "list-index",
    generatedAt,
    retrievedAt,
    recordCount: records.length,
    uniqueNormalizedNameCount: counts.uniqueNormalizedNameCount,
    duplicateNormalizedNameGroupCount: counts.duplicateNormalizedNameGroupCount,
    ambiguousNormalizedNameGroupCount: counts.ambiguousNormalizedNameGroupCount,
    sources: Object.fromEntries(Object.entries(sourceCounts).map(([source, value]) => [source, {
      ...value,
      sourceUrl: "https://www.law.go.kr/",
      listEndpoint: SEARCH_URL,
      guideUrl: `${GUIDE_ROOT}?htmlName=${SOURCES[source].guide}`,
      officialIdentifierParameter: SOURCES[source].detailIdentifierParameter,
    }])),
    coverage: {
      lists: { status: "complete", recordCount: records.length, expectedCount: Object.values(sourceCounts).reduce((sum, item) => sum + item.apiTotal, 0) },
      definitions: {
        status: counts.definitionCount === records.length ? "complete" : "list-only-partial",
        recordCount: counts.definitionCount,
        expectedListRecordCount: records.length,
        note: "법령용어 목록 응답에 정의가 포함된 항목만 집계합니다. 전체 정의 본문을 수집했다고 뜻하지 않습니다.",
      },
      explicitSynonyms: {
        recordCount: counts.explicitSynonymRecordCount,
        note: "목록 응답에 명시적으로 포함된 별칭·동의어 필드만 보존하며, 표제어 모양으로 추정 생성하지 않습니다.",
      },
      relationReferences: {
        recordCount: counts.relationReferenceRecordCount,
        bodyCount: 0,
        status: counts.relationReferenceRecordCount ? "identifier-references-only" : "not-present",
        note: "관계 조회에 필요한 공식 식별자만 보존합니다. 관계 본문 전건 팩이 아닙니다.",
      },
    },
    ambiguityPolicy: "동일 정규화 이름에 여러 공식 ID가 연결되면 후보를 병합하거나 임의 확정하지 않고 모두 보존합니다.",
    hashAlgorithm: "sha256",
    files,
    contentSha256: contentDigest(files),
    credentialStored: false,
    legalNotice: LEGAL_NOTICE,
  };
  atomicJson(path.join(staging, "manifest.json"), manifest);
  verifyBuiltPack(staging, ctx.oc);

  const outputDir = path.join(ctx.root, "legal_terms");
  promotePack(outputDir, staging, ctx.root);
  return { manifest, outputDir };
}

function readCompleteRows(source, sourceState, workDir, display) {
  const rows = [];
  const pagesDir = sourcePagesDir(workDir, source);
  for (let pageNumber = 1; pageNumber <= sourceState.totalPages; pageNumber += 1) {
    const page = readJson(path.join(pagesDir, pageName(pageNumber)));
    if (!isValidSanitizedPage(page, source, pageNumber)) throw new Error(`Missing or corrupt cached ${source} page ${pageNumber}.`);
    observePage(source, pageNumber, page, { apiTotal: sourceState.apiTotal, totalPages: sourceState.totalPages, listComplete: false }, display);
    const root = findRoot(page.payload, SOURCES[source].rootKeys);
    rows.push(...listItems(root, SOURCES[source].rowKeys));
  }
  return rows;
}

function normalizeTermRecord(source, raw, ordinal) {
  const config = SOURCES[source];
  const name = clean(textByKeys(raw, config.nameKeys), 500);
  if (!name) throw new Error(`Official ${source} record ${ordinal} has no legal term name.`);
  const listId = clean(textByKeys(raw, config.listIdKeys), 120);
  const explicitIds = parseOfficialIds(textByKeys(raw, config.idKeys));
  const relationIdentifiers = extractOfficialIdentifiers(raw);
  const officialIds = [...new Set([...explicitIds, ...relationIdentifiers])];
  if (!officialIds.length) throw new Error(`Official ${source} record ${ordinal} has no official detail identifier.`);
  const sourceId = officialIds[0];
  const synonyms = explicitSynonyms(raw, name);
  const relations = relationReferences(source, raw, sourceId);
  const definition = clean(textByKeys(raw, ["법령용어정의", "용어정의", "정의"]), 4_000);
  const homonymRaw = clean(textByKeys(raw, config.homonymKeys), 20).toUpperCase();
  const lawTypeCode = clean(textByKeys(raw, ["법령종류코드"]), 60);
  const dictionaryTypeCode = clean(textByKeys(raw, ["사전구분코드"]), 60);
  const recordIdentifier = source === "lstrmAI"
    ? sourceId
    : `${sourceId}-${sha256Text(JSON.stringify([officialIds, name, lawTypeCode, dictionaryTypeCode, listId])).slice(0, 20)}`;
  return {
    id: `${source}:${recordIdentifier}`,
    sourceTarget: source,
    sourceId,
    officialIds,
    listId,
    name,
    normalizedName: normalizeKey(name),
    synonyms,
    normalizedSynonyms: synonyms.map(normalizeKey).filter(Boolean),
    definition,
    definitionStatus: definition ? "present-in-list-response" : "not-in-list-pack",
    relations,
    relationBodyStatus: "not-in-list-pack",
    homonymStatus: homonymRaw === "Y" ? "declared" : homonymRaw === "N" ? "not-declared" : "unknown",
    note: clean(textByKeys(raw, config.noteKeys), 1_000),
    lawTypeCode,
    dictionaryTypeCode,
    detailIdentifier: { parameter: config.detailIdentifierParameter, value: sourceId },
    detailIdentifiers: officialIds.map((value) => ({ parameter: config.detailIdentifierParameter, value })),
    listOrdinal: ordinal,
  };
}

function explicitSynonyms(raw, name) {
  const values = [];
  for (const [key, value] of Object.entries(raw || {})) {
    if (!/(?:동의어|유의어|별칭|약칭|대체용어|법령용어명_한글)/.test(key)) continue;
    if (LINK_KEY.test(key)) continue;
    const text = clean(value, 2_000);
    if (!text) continue;
    values.push(...text.split(/[|;,\n]+/).map((item) => clean(item, 500)).filter(Boolean));
  }
  const normalizedName = normalizeKey(name);
  return [...new Map(values.filter((value) => normalizeKey(value) && normalizeKey(value) !== normalizedName).map((value) => [normalizeKey(value), value])).values()];
}

function relationReferences(source, raw, fallbackId) {
  const refs = [];
  for (const [key, value] of Object.entries(raw || {})) {
    if (!/(?:관계|관련).*(?:링크|url|uri|href)|(?:링크|url|uri|href).*(?:관계|관련)/i.test(key)) continue;
    const identifier = extractIdentifierFromString(value) || fallbackId;
    const target = /조문/.test(key) ? "lstrmRltJo" : /일상/.test(key) ? "dlytrmRlt" : "lstrmRlt";
    refs.push({ type: /조문/.test(key) ? "article-relation" : "term-relation", target, officialIdentifier: identifier });
  }
  if (source === "lstrmAI" && fallbackId && !refs.length) {
    refs.push(
      { type: "term-relation", target: "lstrmRlt", officialIdentifier: fallbackId },
      { type: "article-relation", target: "lstrmRltJo", officialIdentifier: fallbackId },
    );
  }
  return refs.filter((ref, index) => refs.findIndex((other) => other.type === ref.type && other.target === ref.target && other.officialIdentifier === ref.officialIdentifier) === index);
}

function extractOfficialIdentifiers(raw) {
  const refs = Array.isArray(raw?.__officialIdentifierRefs) ? raw.__officialIdentifierRefs : [];
  const identifiers = refs.flatMap((ref) => parseOfficialIds(ref?.value));
  for (const [key, value] of Object.entries(raw || {})) {
    if (!LINK_KEY.test(key)) continue;
    const found = extractIdentifierFromString(value);
    if (found) identifiers.push(...parseOfficialIds(found));
  }
  return [...new Set(identifiers)];
}

function extractIdentifierFromString(value) {
  const match = String(value || "").match(/[?&](?:MST|trmSeqs|ID)=([^&#\s]+)/i);
  return match ? clean(decodeURIComponent(match[1]), 120) : "";
}

function parseOfficialIds(value) {
  return String(value || "").split(/[,|;\s]+/).map((item) => item.trim()).filter((item) => /^\d{1,30}$/.test(item));
}

function assertCompleteListCount(source, expected, actual) {
  if (!Number.isInteger(expected) || expected <= 0 || actual !== expected) {
    throw new Error(`Official ${source} list count mismatch: expected ${expected}, got ${actual}. Pack was not promoted.`);
  }
  return true;
}

function assertOfficialIdentifiers(source, records, expected) {
  const recordIds = new Set(records.map((record) => record.id));
  if (recordIds.size !== expected) throw new Error(`Official ${source} record identifier count mismatch: expected ${expected}, got ${recordIds.size}.`);
  if (records.some((record) => !Array.isArray(record.officialIds) || !record.officialIds.length || record.officialIds.some((id) => !/^\d{1,30}$/.test(id)))) {
    throw new Error(`Official ${source} detail identifier set is invalid.`);
  }
  if (source === "lstrmAI") {
    const sourceIds = new Set(records.map((record) => record.sourceId));
    if (sourceIds.size !== expected) throw new Error(`Official ${source} stable MST count mismatch: expected ${expected}, got ${sourceIds.size}.`);
  }
  if (source === "lstrm") {
    const listIds = new Set(records.map((record) => record.listId));
    if (listIds.size !== expected || listIds.has("")) throw new Error(`Official ${source} global list ordinal count mismatch: expected ${expected}, got ${listIds.size}.`);
  }
}

function analyzeRecords(records) {
  const groups = new Map();
  let definitionCount = 0;
  let explicitSynonymRecordCount = 0;
  let relationReferenceRecordCount = 0;
  for (const record of records) {
    const group = groups.get(record.normalizedName) || [];
    group.push(record);
    groups.set(record.normalizedName, group);
    if (record.definition) definitionCount += 1;
    if (record.synonyms.length) explicitSynonymRecordCount += 1;
    if (record.relations.length) relationReferenceRecordCount += 1;
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  const ambiguousGroups = duplicateGroups.filter((group) => group.some((record) => record.homonymStatus === "declared") || new Set(group.map((record) => `${record.sourceTarget}:${record.sourceId}`)).size > 1);
  return {
    uniqueNormalizedNameCount: groups.size,
    duplicateNormalizedNameGroupCount: duplicateGroups.length,
    ambiguousNormalizedNameGroupCount: ambiguousGroups.length,
    definitionCount,
    explicitSynonymRecordCount,
    relationReferenceRecordCount,
  };
}

function appendRecords(destination, source) {
  for (const record of source) destination.push(record);
  return destination;
}

function verifyBuiltPack(directory, oc = "") {
  const manifestPath = path.join(directory, "manifest.json");
  const manifest = readJson(manifestPath);
  if (manifest?.schemaVersion !== 1 || manifest?.status !== "complete" || manifest?.packType !== "list-index") throw new Error("Official terminology manifest is incomplete.");
  const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
  const expectedFileNames = new Set(["index.json", "search-index.jsonl"]);
  if (manifestFiles.length !== expectedFileNames.size || manifestFiles.some((file) => !expectedFileNames.has(file?.path))) throw new Error("Official terminology manifest file inventory is invalid.");
  let searchCount = 0;
  const searchIds = new Set();
  for (const line of fs.readFileSync(path.join(directory, "search-index.jsonl"), "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line);
    if (!parsed?.id || !parsed?.name || !parsed?.sourceId) throw new Error("Official terminology search record is corrupt.");
    if (searchIds.has(parsed.id)) throw new Error(`Duplicate official terminology identifier: ${parsed.id}`);
    if (hasPersistedLinkField(parsed)) throw new Error(`Persisted API link field detected: ${parsed.id}`);
    searchIds.add(parsed.id);
    searchCount += 1;
  }
  const index = readJson(path.join(directory, "index.json"));
  if (!Array.isArray(index?.records) || index.records.length !== manifest.recordCount || searchCount !== manifest.recordCount) throw new Error("Official terminology output count mismatch.");
  if (new Set(index.records.map((record) => record?.id)).size !== index.records.length || index.records.some(hasPersistedLinkField)) throw new Error("Official terminology index identifiers or link fields are invalid.");
  for (const file of manifest.files || []) {
    const target = path.resolve(directory, ...String(file.path).split("/"));
    assertDescendant(directory, target);
    if (sha256File(target) !== file.sha256 || fs.statSync(target).size !== file.bytes) throw new Error(`Official terminology hash mismatch: ${file.path}`);
    if (containsCredential(fs.readFileSync(target, "utf8"), oc)) throw new Error(`Credential material detected in ${file.path}.`);
  }
  if (manifest.contentSha256 !== contentDigest(manifestFiles)) throw new Error("Official terminology content digest mismatch.");
  const manifestText = fs.readFileSync(manifestPath, "utf8");
  if (containsCredential(manifestText, oc)) throw new Error("Credential material detected in manifest.json.");
  return true;
}

function hasPersistedLinkField(value) {
  if (Array.isArray(value)) return value.some(hasPersistedLinkField);
  if (!value || typeof value !== "object") return false;
  for (const [key, child] of Object.entries(value)) {
    if (LINK_KEY.test(key)) return true;
    if (hasPersistedLinkField(child)) return true;
  }
  return false;
}

function promotePack(activeDirectory, stagingDirectory, root) {
  const active = path.resolve(activeDirectory);
  const staging = path.resolve(stagingDirectory);
  assertDescendant(root, active);
  assertDescendant(root, staging);
  ensureDir(path.dirname(active));
  let backup = "";
  if (fs.existsSync(active)) {
    const backups = path.join(root, ".official-term-backups");
    ensureDir(backups);
    backup = path.join(backups, `legal_terms-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
    fs.renameSync(active, backup);
  }
  try { fs.renameSync(staging, active); }
  catch (error) {
    if (backup && fs.existsSync(backup) && !fs.existsSync(active)) fs.renameSync(backup, active);
    throw error;
  }
  return { backup };
}

function reportCombinedProgress(state, ctx, force = false) {
  const sourceStates = ctx.sources.map((source) => state.sources[source]).filter((item) => item?.totalPages);
  if (!sourceStates.length) return;
  const totalPages = sourceStates.reduce((sum, item) => sum + item.totalPages, 0);
  const fetchedPages = sourceStates.reduce((sum, item) => sum + Math.min(item.pagesDownloaded || 0, item.totalPages), 0);
  const percent = totalPages ? Math.min(100, Math.floor((fetchedPages / totalPages) * 100)) : 0;
  if (!force && percent < ctx.nextProgressPercent) return;
  process.stdout.write(`[progress] ${percent}% pages=${fetchedPages}/${totalPages}\n`);
  ctx.nextProgressPercent = Math.min(100, (Math.floor(percent / 10) + 1) * 10);
}

function assertApiResponse(source, json) {
  const root = findRoot(json, SOURCES[source].rootKeys);
  const flattened = JSON.stringify(root).slice(0, 2_000);
  if (/사용자 정보 검증에 실패|인증.{0,20}실패|요청.{0,20}실패/.test(flattened)) throw new Error(`National Law API rejected ${source} request.`);
  if (!root || typeof root !== "object") throw new Error(`National Law API returned no ${source} root.`);
}

function isValidSanitizedPage(value, source, page) {
  if (value?.schemaVersion !== 1 || value?.source !== source || Number(value?.page) !== page || !value?.payload) return false;
  const serialized = JSON.stringify(value);
  return !/(?:[?&]OC=)(?!REDACTED|\[REDACTED\])[^&\s"']+/i.test(serialized) && !/"(?:OC|LAW_OC|token|api_?key|authorization|secret)"\s*:/i.test(serialized);
}

function containsCredential(text, oc = "") {
  const value = String(text || "");
  if (oc && value.includes(oc)) return true;
  if (/(?:[?&]OC=)(?!REDACTED|\[REDACTED\])[^&\s"']+/i.test(value)) return true;
  return /"(?:OC|LAW_OC|token|access_?token|api_?key|apikey|authorization|secret)"\s*:/i.test(value);
}

function findRoot(json, keys) {
  for (const key of keys) if (json?.[key] && typeof json[key] === "object") return json[key];
  return json;
}

function listItems(root, keys) {
  for (const key of keys) {
    const value = root?.[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") return [value];
  }
  return [];
}

function numberByKeys(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && /^\d+$/.test(String(value).trim())) return Number(value);
  }
  return 0;
}

function textByKeys(object, keys) {
  for (const key of keys) {
    const value = object?.[key];
    if (value !== undefined && value !== null && typeof value !== "object") return String(value);
  }
  return "";
}

function compareRecords(a, b) {
  const sourceDifference = SOURCE_ORDER.indexOf(a.sourceTarget) - SOURCE_ORDER.indexOf(b.sourceTarget);
  if (sourceDifference) return sourceDifference;
  const numericA = Number(a.sourceId), numericB = Number(b.sourceId);
  if (Number.isFinite(numericA) && Number.isFinite(numericB) && numericA !== numericB) return numericA - numericB;
  return a.sourceId.localeCompare(b.sourceId, "ko");
}

function normalizeKey(value) {
  return String(value || "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

function clean(value, max = 1_000) {
  return String(value || "").replace(/[\u0000-\u001f\u007f\u0085\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function pageBudgetReached(ctx) { return Boolean(ctx.maxPages && ctx.downloadedThisRun >= ctx.maxPages); }
function sourcePagesDir(workDir, source) { return path.join(workDir, "pages", source); }
function pageName(page) { return `${String(page).padStart(6, "0")}.json`; }
function countPageFiles(directory) { try { return fs.readdirSync(directory, { withFileTypes: true }).filter((entry) => entry.isFile() && /^\d{6}\.json$/.test(entry.name)).length; } catch { return 0; } }
function fileRecord(file, root) { const stat = fs.statSync(file); return { path: path.relative(root, file).replaceAll("\\", "/"), bytes: stat.size, sha256: sha256File(file) }; }
function contentDigest(files) { return sha256Text(files.map((file) => `${file.path}\0${file.sha256}\n`).join("")); }
function sha256File(file) { const hash = crypto.createHash("sha256"); const fd = fs.openSync(file, "r"); const buffer = Buffer.allocUnsafe(1024 * 1024); try { let bytes; while ((bytes = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes)); } finally { fs.closeSync(fd); } return hash.digest("hex"); }
function sha256Text(value) { return crypto.createHash("sha256").update(String(value)).digest("hex"); }
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function atomicJson(file, value) { atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
function atomicWrite(file, value) { ensureDir(path.dirname(file)); const temporary = `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; const fd = fs.openSync(temporary, "wx"); try { fs.writeFileSync(fd, value, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } replaceFile(temporary, file); }
function ensureDir(directory) { fs.mkdirSync(directory, { recursive: true }); }
function assertDescendant(root, target) { const relative = path.relative(path.resolve(root), path.resolve(target)); if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe path outside expected root: ${target}`); }
function parseList(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function cleanToken(value) { const token = String(value || ""); return /^[a-f0-9-]{8,80}$/i.test(token) ? token : ""; }
function boundedInt(value, fallback, min, max) { const parsed = Number(value); return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback; }
function requiredValue(flag, value) { if (!value || String(value).startsWith("--")) throw new Error(`${flag} requires a value.`); return value; }
function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[error] ${redactString(error?.message || String(error), process.env.LAW_OC || "")}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  SOURCES,
  analyzeRecords,
  appendRecords,
  assertCompleteListCount,
  containsCredential,
  extractIdentifierFromString,
  normalizeKey,
  normalizeTermRecord,
  parseArgs,
  promotePack,
  redactAnyOc,
  sanitizeApiValue,
  loadState,
  verifyBuiltPack,
};
