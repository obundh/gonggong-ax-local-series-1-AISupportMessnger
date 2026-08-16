#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";
const GUIDE_ROOT = "https://open.law.go.kr/LSO/openApi/guideResult.do";
const ALL_TARGETS = ["law", "prec", "expc", "decc", "admrul", "detc", "lsAbrv"];

const TARGETS = {
  law: {
    label: "현행 법령",
    rootKeys: ["LawSearch"], listKeys: ["law"], idKeys: ["법령일련번호"],
    detailParam: "MST", detailGuide: "lsInfoGuide", listGuide: "lsListGuide",
    titleKeys: ["법령명한글", "법령명"], numberKeys: ["공포번호"], dateKeys: ["시행일자"],
  },
  prec: {
    label: "판례",
    rootKeys: ["PrecSearch"], listKeys: ["prec"], idKeys: ["판례일련번호", "판례정보일련번호"],
    detailParam: "ID", detailGuide: "precInfoGuide", listGuide: "precListGuide",
    titleKeys: ["사건명"], numberKeys: ["사건번호"], dateKeys: ["선고일자"],
    detailQueries: ["공무원", "징계", "직위해제", "소청", "국가배상", "행정소송", "정보공개", "개인정보", "계약", "입찰", "근로기준법"],
  },
  expc: {
    label: "법령해석례",
    rootKeys: ["Expc"], listKeys: ["expc"], idKeys: ["법령해석례일련번호"],
    detailParam: "ID", detailGuide: "expcInfoGuide", listGuide: "expcListGuide",
    titleKeys: ["안건명"], numberKeys: ["안건번호"], dateKeys: ["회신일자", "해석일자"],
    detailQueries: ["공무원", "정보공개", "개인정보", "계약", "입찰", "근로", "행정절차"],
  },
  decc: {
    label: "행정심판례",
    rootKeys: ["Decc"], listKeys: ["decc"], idKeys: ["행정심판재결례일련번호", "행정심판례일련번호", "재결례일련번호"],
    detailParam: "ID", detailGuide: "deccInfoGuide", listGuide: "deccListGuide",
    titleKeys: ["사건명"], numberKeys: ["사건번호"], dateKeys: ["의결일자", "재결일자"],
    detailQueries: ["공무원", "징계", "정보공개", "개인정보", "계약", "입찰", "영업정지"],
  },
  admrul: {
    label: "행정규칙",
    rootKeys: ["AdmRulSearch"], listKeys: ["admrul"], idKeys: ["행정규칙일련번호"],
    detailParam: "ID", detailGuide: "admrulInfoGuide", listGuide: "admrulListGuide",
    titleKeys: ["행정규칙명"], numberKeys: ["발령번호"], dateKeys: ["시행일자", "발령일자"],
    listParams: { nw: "1" },
    detailQueries: ["공무원", "계약", "입찰", "정보공개", "개인정보", "전파", "무선국", "전기통신"],
  },
  detc: {
    label: "헌재결정례",
    rootKeys: ["DetcSearch"], listKeys: ["Detc", "detc"], idKeys: ["헌재결정례일련번호"],
    detailParam: "ID", detailGuide: "detcInfoGuide", listGuide: "detcListGuide",
    titleKeys: ["사건명"], numberKeys: ["사건번호"], dateKeys: ["종국일자", "선고일자"],
    detailQueries: ["공무원", "정보공개", "개인정보", "근로", "노동", "행정절차"],
  },
  lsAbrv: {
    label: "법령명 공식 약칭",
    rootKeys: ["LawSearch"], listKeys: ["law"], idKeys: ["법령일련번호", "법령ID"],
    listGuide: "lsAbrvListGuide", titleKeys: ["법령명한글"], dateKeys: ["시행일자"], listOnly: true,
  },
};

const LEGAL_NOTICE = {
  use: "국가법령정보센터 법령정보는 공공데이터 이용조건과 제3자 권리를 확인하여 활용해야 합니다.",
  effect: "이 데이터는 참고자료이며 법적 효력이 없습니다. 법적 효력이 필요한 경우 관보 등 공식 원문을 우선 확인하십시오.",
  integrity: "원문을 위조·변조하거나 공식 원문인 것처럼 표시하지 마십시오.",
};

function parseArgs(argv) {
  const args = {
    root: process.env.OFFICIAL_LAW_ROOT || "data",
    targets: parseList(process.env.OFFICIAL_LAW_TARGETS || ALL_TARGETS.join(",")),
    display: number(process.env.OFFICIAL_LAW_DISPLAY, 100, 1, 100),
    maxPages: number(process.env.OFFICIAL_LAW_MAX_PAGES, 0, 0, 1000000),
    maxDetails: number(process.env.OFFICIAL_LAW_MAX_DETAILS, 0, 0, 1000000),
    delayMs: number(process.env.OFFICIAL_LAW_DELAY_MS, 350, 100, 60000),
    retries: number(process.env.OFFICIAL_LAW_RETRIES, 4, 0, 10),
    timeoutMs: number(process.env.OFFICIAL_LAW_TIMEOUT_MS, 45000, 1000, 300000),
    concurrency: number(process.env.OFFICIAL_LAW_CONCURRENCY, 3, 1, 6),
    seedRoot: process.env.OFFICIAL_LAW_SEED_ROOT || "",
    seedOnly: false,
    listOnly: false,
    noSeed: false,
    refreshList: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i], next = argv[i + 1];
    if (arg === "--root") args.root = next, i += 1;
    else if (arg === "--targets") args.targets = parseList(next), i += 1;
    else if (arg === "--display") args.display = number(next, 100, 1, 100), i += 1;
    else if (arg === "--max-pages") args.maxPages = number(next, 0, 0, 1000000), i += 1;
    else if (arg === "--max-details") args.maxDetails = number(next, 0, 0, 1000000), i += 1;
    else if (arg === "--delay-ms") args.delayMs = number(next, 350, 100, 60000), i += 1;
    else if (arg === "--retries") args.retries = number(next, 4, 0, 10), i += 1;
    else if (arg === "--timeout-ms") args.timeoutMs = number(next, 45000, 1000, 300000), i += 1;
    else if (arg === "--concurrency") args.concurrency = number(next, 3, 1, 6), i += 1;
    else if (arg === "--seed-root") args.seedRoot = next, i += 1;
    else if (arg === "--seed-only") args.seedOnly = true;
    else if (arg === "--list-only") args.listOnly = true;
    else if (arg === "--no-seed") args.noSeed = true;
    else if (arg === "--refresh-list") args.refreshList = true;
    else if (arg === "--oc") throw new Error("--oc is disabled because command-line secrets leak into history. Set LAW_OC instead.");
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  args.targets = [...new Set(args.targets.map(String).filter((v) => TARGETS[v]))];
  if (!args.targets.length) throw new Error("No supported targets selected.");
  return args;
}

function printHelp() {
  console.log(`Official National Law Information Center corpus sync

LAW_OC must be supplied as an environment variable. It is never written to disk or logs.

  node tools/official-law-sync/sync.cjs --targets law,prec,expc,decc,admrul,detc,lsAbrv
  node tools/official-law-sync/sync.cjs --seed-root "C:\\path\\to\\old-data" --seed-only
  node tools/official-law-sync/sync.cjs --max-pages 1 --max-details 5

Options:
  --root DIR          output root (default: data)
  --targets LIST      comma-separated targets
  --max-pages N       newly downloaded list pages per target this run; 0 = unlimited
  --max-details N     newly downloaded details per target this run; 0 = unlimited
  --delay-ms N        minimum delay between requests (minimum 100 ms)
  --concurrency N     overlapping HTTP requests, 1-6 (default 3); start times still obey delay
  --seed-root DIR     read-only legacy data root used to seed detail cache
  --seed-only         import valid seed files and rebuild manifests without API calls
  --list-only         download lists but do not request detail bodies
  --refresh-list      start a new list generation; old completed outputs remain until the new generation succeeds
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return printHelp();
  const oc = process.env.LAW_OC || process.env.PRECEDENT_OC || process.env.LEGAL_REF_OC || "";
  if (!args.seedOnly && !oc) throw new Error("Missing LAW_OC environment variable.");
  const root = path.resolve(args.root);
  ensureDir(root);
  const gate = makeGate(args.delayMs);
  const summaries = [];
  for (const target of args.targets) {
    const summary = await syncTarget(target, { ...args, root, oc, gate });
    summaries.push(summary);
    await writeCorpusManifest(root, summaries);
  }
  console.log(`[done] targets=${summaries.length} root=${root}`);
}

async function syncTarget(target, ctx) {
  const config = TARGETS[target];
  if (target === "lsAbrv") return syncAliases(config, ctx);
  const activeOutDir = path.join(ctx.root, target);
  const refreshToken = ctx.refreshList && !ctx.seedOnly ? `${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}` : "";
  const outDir = refreshToken ? path.join(ctx.root, ".official-law-staging", `${target}-${refreshToken}`) : activeOutDir;
  const itemsDir = path.join(outDir, "items");
  ensureDir(itemsDir);
  const statePath = path.join(outDir, ".sync-state.json");
  const baseSignature = sha256Text(JSON.stringify({ target, display: ctx.display, listParams: config.listParams || {} })).slice(0, 16);
  const priorState = readValidJson(statePath);
  const canResumePrior = priorState?.target === target && (priorState?.baseSignature === baseSignature || priorState?.signature === baseSignature);
  const signature = refreshToken
    ? `${baseSignature}-${refreshToken}`
    : (canResumePrior ? priorState.signature : baseSignature);
  const syncDir = path.join(outDir, ".sync", signature);
  const pagesDir = path.join(syncDir, "pages");
  ensureDir(pagesDir);
  const state = loadState(statePath, target, signature);
  state.baseSignature = baseSignature;
  state.status = "running";
  state.startedAt ||= now();
  state.updatedAt = now();
  atomicJson(statePath, state);

  if (!ctx.seedOnly) await fetchLists(target, config, pagesDir, state, statePath, ctx);
  if (state.listComplete && !state.listRetrievedAt) state.listRetrievedAt = inferListRetrievedAt(pagesDir) || state.updatedAt || now();
  const metas = readMetas(target, config, pagesDir, ctx.oc);
  assertCompleteListCount(state, metas.length, statePath);
  let seeded = { copied: 0, skipped: 0, invalid: 0, stale: 0 };
  if (refreshToken && fs.existsSync(activeOutDir)) {
    const activeSeed = seedTarget(target, ctx.root, itemsDir, ctx.oc, metas);
    seeded = mergeSeedStats(seeded, activeSeed);
  }
  if (ctx.seedRoot && !ctx.noSeed) {
    seeded = mergeSeedStats(seeded, seedTarget(target, ctx.seedRoot, itemsDir, ctx.oc, metas));
    state.seed = { rootName: path.basename(path.resolve(ctx.seedRoot)), ...seeded, importedAt: now() };
    atomicJson(statePath, state);
  }
  if (state.listComplete) {
    const pruned = pruneOrphanItems(itemsDir, metas);
    state.orphanPruned = Number(state.orphanPruned || 0) + pruned;
    if (pruned) atomicJson(statePath, state);
  }
  const selection = selectDetails(target, config, metas, itemsDir);
  state.detailCoverage = selection.coverage;
  state.selectedDetailIds = selection.metas.map((meta) => meta.id);
  if (!ctx.seedOnly && !ctx.listOnly) await fetchDetails(target, config, selection.metas, itemsDir, state, statePath, ctx);
  const built = buildTargetOutputs(target, config, outDir, metas, state, ctx.oc);
  state.status = built.status;
  state.updatedAt = now();
  state.listed = metas.length;
  state.detailFiles = built.detailFiles;
  atomicJson(statePath, state);
  if (refreshToken) {
    if (built.status !== "complete") throw new Error(`Refresh staging for ${target} is partial; active corpus was not changed.`);
    verifyTargetCorpus(outDir);
    promoteStagingTarget(activeOutDir, outDir, ctx.root, target);
  }
  console.log(`[target:${target}] status=${built.status} listed=${metas.length} details=${built.detailFiles} chunks=${built.chunks} seeded=${seeded.copied}`);
  return { target, status: built.status, count: metas.length, manifest: `${target}/manifest.json` };
}

function assertCompleteListCount(state, recordCount, statePath = "") {
  const expected = Number(state.apiTotal || 0);
  if (!state.listComplete || !expected || recordCount === expected) return true;
  state.status = "partial-count-mismatch";
  state.listComplete = false;
  state.countMismatch = { expected, actual: recordCount, detectedAt: now() };
  state.updatedAt = now();
  if (statePath) atomicJson(statePath, state);
  throw new Error(`Official list count mismatch: expected ${expected}, got ${recordCount}; corpus remains partial.`);
}

function mergeSeedStats(a, b) {
  return { copied: Number(a.copied || 0) + Number(b.copied || 0), skipped: Number(a.skipped || 0) + Number(b.skipped || 0),
    invalid: Number(a.invalid || 0) + Number(b.invalid || 0), stale: Number(a.stale || 0) + Number(b.stale || 0) };
}

async function fetchLists(target, config, pagesDir, state, statePath, ctx) {
  let page = Math.max(1, Number(state.nextPage || 1));
  let downloaded = 0;
  while (!state.listComplete) {
    if (ctx.maxPages && downloaded >= ctx.maxPages) break;
    const batch = [];
    for (let offset = 0; offset < ctx.concurrency; offset += 1) {
      const currentPage = page + offset;
      const pagePath = path.join(pagesDir, `${String(currentPage).padStart(6, "0")}.json`);
      const cached = readValidJson(pagePath);
      if (!cached && ctx.maxPages && downloaded + batch.filter((item) => !item.cached).length >= ctx.maxPages) break;
      batch.push({ page: currentPage, pagePath, cached });
    }
    if (!batch.length) break;
    const results = await Promise.all(batch.map(async (entry) => {
      let json = entry.cached;
      if (!json) {
        json = await fetchApi(SEARCH_URL, { target, type: "JSON", display: String(ctx.display), page: String(entry.page), ...(config.listParams || {}) }, ctx);
        json = redactObject(json, ctx.oc);
        atomicJson(entry.pagePath, json);
      }
      assertApiOk(json);
      const root = findRoot(json, config.rootKeys);
      return { page: entry.page, items: listItems(root, config.listKeys), total: Number(root?.totalCnt || root?.totalCount || 0), downloaded: !entry.cached };
    }));
    for (const result of results.sort((a, b) => a.page - b.page)) {
      if (result.downloaded) downloaded += 1;
      state.apiTotal = result.total || state.apiTotal || 0;
      if (result.items.length === 0 || result.items.length < ctx.display || (result.total && result.page * ctx.display >= result.total)) state.listComplete = true;
      console.log(`[list:${target}] page=${result.page} items=${result.items.length} total=${result.total || "unknown"}`);
    }
    page = results[results.length - 1].page + 1;
    state.nextPage = page;
    state.pagesDownloaded = countJsonFiles(pagesDir);
    state.updatedAt = now();
    if (state.listComplete) state.listRetrievedAt = state.updatedAt;
    atomicJson(statePath, state);
  }
}

async function fetchDetails(target, config, metas, itemsDir, state, statePath, ctx) {
  let downloaded = 0, attempted = 0;
  const unavailable = new Set(state.unavailableDetailIds || []);
  const pending = [];
  for (const [index, meta] of metas.entries()) {
    const itemPath = path.join(itemsDir, `${safeName(meta.id)}.json`);
    const cached = readValidJson(itemPath);
    if (cached && isUsableForTarget(target, cached) && detailMatchesMeta(target, cached, meta)) continue;
    if (unavailable.has(meta.id)) continue;
    if (ctx.maxDetails && attempted >= ctx.maxDetails) break;
    attempted += 1;
    pending.push({ index, meta, itemPath });
  }
  for (let start = 0; start < pending.length; start += ctx.concurrency) {
    const batch = pending.slice(start, start + ctx.concurrency);
    const results = await Promise.all(batch.map(async (entry) => {
      const json = await fetchApi(SERVICE_URL, { target, type: "JSON", [config.detailParam]: entry.meta.id }, ctx);
      assertApiOk(json);
      const wrapper = { schemaVersion: 1, target, id: entry.meta.id, fetchedAt: now(),
        source: { name: "국가법령정보센터", endpoint: SERVICE_URL, target, identifierParameter: config.detailParam }, data: redactObject(json, ctx.oc) };
      return { ...entry, wrapper, usable: isUsableForTarget(target, wrapper) && detailMatchesMeta(target, wrapper, entry.meta) };
    }));
    for (const result of results) {
      if (!result.usable) {
        if (target === "law") throw new Error(`Official law detail was empty for MST ${result.meta.id}; corpus remains partial and can be resumed.`);
        unavailable.add(result.meta.id);
        console.log(`[unavailable:${target}] id=${result.meta.id}`);
        continue;
      }
      atomicJson(result.itemPath, result.wrapper);
      downloaded += 1;
      state.detailsDownloaded = (state.detailsDownloaded || 0) + 1;
      state.lastDetailId = result.meta.id;
      console.log(`[detail:${target}] ${result.index + 1}/${metas.length} id=${result.meta.id}`);
    }
    state.updatedAt = now();
    state.unavailableDetailIds = [...unavailable];
    atomicJson(statePath, state);
  }
  state.detailFiles = countJsonFiles(itemsDir);
  state.unavailableDetailIds = [...unavailable];
  atomicJson(statePath, state);
}

function selectDetails(target, config, metas, itemsDir) {
  if (target === "law") {
    return { metas, coverage: { mode: "full-current-law", listedCount: metas.length, selectedCount: metas.length, queries: [], selection: "all current MST identifiers" } };
  }
  const queries = config.detailQueries || [];
  const selected = new Map();
  for (const meta of metas) {
    const cached = readValidJson(path.join(itemsDir, `${safeName(meta.id)}.json`));
    if (cached && isUsableDetail(cached)) selected.set(meta.id, meta);
  }
  const perQueryLimit = 200;
  const matchedCounts = {};
  for (const query of queries) {
    const matches = metas.filter((meta) => normalizeSpace([meta.title, meta.number, meta.lawType, meta.ministry].filter(Boolean).join(" ")).toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.id).localeCompare(String(b.id)));
    matchedCounts[query] = { matched: matches.length, selected: Math.min(matches.length, perQueryLimit) };
    for (const meta of matches.slice(0, perQueryLimit)) selected.set(meta.id, meta);
  }
  const selectedMetas = [...selected.values()];
  return { metas: selectedMetas, coverage: { mode: "seed-plus-title-query-pack", listedCount: metas.length, selectedCount: selectedMetas.length,
    queries, selection: "existing verified seed bodies plus current list metadata title/number/category/organization matches",
    perQueryLimit, matchedCounts,
    incompleteNotice: "원문은 전체 수집이 아닙니다. 목록 메타데이터는 전체를 대상으로 하며, 원문은 seed와 명시된 query pack 선택분만 포함합니다." } };
}

function readMetas(target, config, pagesDir, oc) {
  const seen = new Map();
  for (const pagePath of listJsonFiles(pagesDir)) {
    const json = readValidJson(pagePath);
    if (!json) continue;
    const root = findRoot(json, config.rootKeys);
    for (const item of listItems(root, config.listKeys)) {
      const meta = normalizeMeta(target, config, item, oc);
      if (meta.id) seen.set(meta.id, { ...seen.get(meta.id), ...meta });
    }
  }
  return [...seen.values()].sort((a, b) => String(a.title || a.id).localeCompare(String(b.title || b.id), "ko"));
}

function normalizeMeta(target, config, item, oc) {
  const id = textByKeys(item, config.idKeys);
  return {
    id, target, targetLabel: config.label,
    title: textByKeys(item, config.titleKeys),
    number: textByKeys(item, config.numberKeys || []),
    date: digits(textByKeys(item, config.dateKeys || []), 8),
    lawId: textByKeys(item, ["법령ID"]),
    lawMst: textByKeys(item, ["법령일련번호"]),
    shortName: textByKeys(item, ["법령약칭명"]),
    lawType: textByKeys(item, ["법령구분명", "행정규칙종류", "사건종류명", "재결구분명"]),
    ministry: textByKeys(item, ["소관부처명", "법원명", "회신기관명", "재결청"]),
    promulgationDate: digits(textByKeys(item, ["공포일자", "발령일자"]), 8),
    effectiveDate: digits(textByKeys(item, ["시행일자"]), 8),
    detailLink: redactString(textByKeys(item, ["상세링크"]), oc),
    detailFile: id ? `items/${safeName(id)}.json` : "",
  };
}

function buildTargetOutputs(target, config, outDir, metas, state, oc) {
  const index = [];
  const searchPath = path.join(outDir, "search-index.jsonl");
  ensureDir(outDir);
  const tmp = tempPath(searchPath);
  const fd = fs.openSync(tmp, "wx");
  let chunks = 0, detailFiles = 0;
  try {
    for (const meta of metas) {
      const detailPath = path.join(outDir, meta.detailFile);
      const wrapper = readValidJson(detailPath);
      const hasDetail = Boolean(wrapper && isUsableForTarget(target, wrapper) && detailMatchesMeta(target, wrapper, meta));
      const normalized = { ...meta, detailFile: hasDetail ? meta.detailFile : "", syncedAt: state.updatedAt || now() };
      index.push(normalized);
      if (hasDetail) detailFiles += 1;
      for (const chunk of buildChunks(target, normalized, hasDetail ? (wrapper.data || wrapper) : null)) {
        fs.writeSync(fd, `${JSON.stringify(redactObject(chunk, oc))}\n`, null, "utf8");
        chunks += 1;
      }
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  replaceFile(tmp, searchPath);
  const indexPath = path.join(outDir, "index.json");
  atomicJson(indexPath, index);
  const files = [fileRecord(indexPath, outDir), fileRecord(searchPath, outDir)];
  for (const meta of index) if (meta.detailFile) files.push(fileRecord(path.join(outDir, meta.detailFile), outDir));
  const selectedCount = Number(state.detailCoverage?.selectedCount || (target === "law" ? metas.length : 0));
  const selectedPresent = countSelectedDetails(target, metas, outDir, state.selectedDetailIds || []);
  const unavailableCount = countSelectedUnavailable(state.selectedDetailIds, state.unavailableDetailIds);
  const completedSelection = selectedPresent + (target === "law" ? 0 : unavailableCount);
  const status = state.listComplete && completedSelection >= selectedCount ? "complete" : "partial";
  const manifest = makeManifest(target, config, status, state, { listed: metas.length, detailFiles, selectedDetailFiles: selectedPresent, unavailableDetails: unavailableCount, chunks }, files);
  atomicJson(path.join(outDir, "manifest.json"), manifest);
  return { status, detailFiles, chunks };
}

function buildChunks(target, meta, data) {
  if (!data) return [metaChunk(target, meta)];
  const sections = sectionConfig(target);
  const out = [];
  for (const [name, keys] of sections) {
    const values = findValuesByKeys(data, keys);
    const joined = normalizeSpace(values.map((value) => flattenText(value)).filter(Boolean).join("\n"));
    for (const [index, part] of splitText(joined, 1800).entries()) {
      out.push({ id: `${target}:${meta.id}:${name}:${index + 1}`, type: "official-legal-corpus", target, section: name,
        title: meta.title || meta.id, itemId: meta.id, lawId: meta.lawId || "", lawMst: meta.lawMst || (target === "law" ? meta.id : ""),
        number: meta.number, date: meta.date, text: part, sourceFile: meta.detailFile });
    }
  }
  if (out.length) return out;
  const fallback = normalizeSpace(flattenText(data));
  return splitText(fallback, 1800).map((part, index) => ({ id: `${target}:${meta.id}:document:${index + 1}`, type: "official-legal-corpus", target,
    section: "document", title: meta.title || meta.id, itemId: meta.id, lawId: meta.lawId || "", lawMst: meta.lawMst || (target === "law" ? meta.id : ""),
    number: meta.number, date: meta.date, text: part, sourceFile: meta.detailFile }));
}

function sectionConfig(target) {
  if (target === "law" || target === "admrul") return [["article", ["조문내용", "조문본문", "항내용"]], ["addendum", ["부칙내용", "부칙"]], ["reason", ["제개정이유내용", "제개정이유"]]];
  if (target === "prec") return [["holding", ["판시사항"]], ["summary", ["판결요지"]], ["text", ["판례내용"]], ["laws", ["참조조문"]], ["references", ["참조판례"]]];
  if (target === "expc") return [["question", ["질의요지"]], ["answer", ["회답"]], ["reason", ["이유"]]];
  if (target === "decc") return [["summary", ["재결요지"]], ["order", ["주문"]], ["claim", ["청구취지"]], ["reason", ["이유"]]];
  if (target === "detc") return [["holding", ["판시사항"]], ["summary", ["결정요지"]], ["text", ["전문"]], ["laws", ["참조조문", "심판대상조문"]], ["references", ["참조판례"]]];
  return [["document", []]];
}

function metaChunk(target, meta) {
  return { id: `${target}:${meta.id}:meta`, type: "official-legal-corpus", target, section: "meta", title: meta.title || meta.id,
    itemId: meta.id, lawId: meta.lawId || "", lawMst: meta.lawMst || (target === "law" ? meta.id : ""),
    number: meta.number, date: meta.date, text: [meta.title, meta.number, meta.date, meta.ministry, meta.lawType].filter(Boolean).join(" "), sourceFile: "" };
}

function countSelectedDetails(target, metas, outDir, selectedIds) {
  const selected = new Set(selectedIds);
  let count = 0;
  for (const meta of metas) {
    if (!selected.has(meta.id)) continue;
    const detail = readValidJson(path.join(outDir, meta.detailFile || "__missing__"));
    if (detail && isUsableForTarget(target, detail) && detailMatchesMeta(target, detail, meta)) count += 1;
  }
  return count;
}

function countSelectedUnavailable(selectedIds = [], unavailableIds = []) {
  const selected = new Set(selectedIds);
  return new Set((Array.isArray(unavailableIds) ? unavailableIds : []).filter((id) => selected.has(id))).size;
}

async function syncAliases(config, ctx) {
  const outDir = path.join(ctx.root, "legal_alias");
  ensureDir(outDir);
  const dataPath = path.join(outDir, "official-aliases.json");
  if (!ctx.seedOnly) {
    const json = await fetchApi(SEARCH_URL, { target: "lsAbrv", type: "JSON" }, ctx);
    assertApiOk(json);
    const root = findRoot(json, config.rootKeys);
    const apiTotal = Number(root?.totalCnt || 0);
    const records = listItems(root, config.listKeys).map((item) => normalizeAliasRecord(item, ctx.oc));
    if (!apiTotal || records.length !== apiTotal) throw new Error(`Official alias response incomplete: received ${records.length} of ${apiTotal || "unknown"}.`);
    const aliases = records.filter((item) => item.officialName && item.shortName);
    const payload = { schemaVersion: 1, source: sourceInfo("lsAbrv", config), retrievedAt: now(), apiTotal, records, aliases };
    atomicJson(dataPath, payload);
  }
  const payload = readValidJson(dataPath);
  const records = Array.isArray(payload?.records) ? payload.records : (Array.isArray(payload?.aliases) ? payload.aliases : []);
  const aliases = Array.isArray(payload?.aliases) ? payload.aliases : records.filter((item) => item.officialName && item.shortName);
  if (!payload) throw new Error("No official alias corpus is available.");
  const aliasStatus = aliasCorpusStatus(payload, records);
  const files = [fileRecord(dataPath, outDir)];
  const manifest = { schemaVersion: 1, target: "lsAbrv", source: sourceInfo("lsAbrv", config), retrievedAt: payload.retrievedAt || null, builtAt: now(),
    status: aliasStatus, recordCount: aliases.length, counts: { apiTotal: Number(payload.apiTotal || 0), records: records.length, aliases: aliases.length, usableAliases: aliases.length },
    hashAlgorithm: "sha256", files, contentSha256: contentDigest(files), legalNotice: LEGAL_NOTICE };
  atomicJson(path.join(outDir, "official-aliases.manifest.json"), manifest);
  console.log(`[target:lsAbrv] status=${aliasStatus} records=${records.length} aliases=${aliases.length}`);
  return { target: "lsAbrv", status: aliasStatus, count: aliases.length, manifest: "legal_alias/official-aliases.manifest.json" };
}

function aliasCorpusStatus(payload, records) {
  const expected = Number(payload?.apiTotal || 0);
  return expected > 0 && records.length === expected && Boolean(payload?.retrievedAt) ? "complete" : "partial";
}

function normalizeAliasRecord(item, oc = "") {
  return { lawId: textByKeys(item, ["법령ID"]), lawMst: textByKeys(item, ["법령일련번호"]),
    officialName: textByKeys(item, ["법령명한글"]), shortName: textByKeys(item, ["법령약칭명"]),
    lawType: textByKeys(item, ["법령구분명"]), ministry: textByKeys(item, ["소관부처명"]),
    promulgationDate: digits(textByKeys(item, ["공포일자"]), 8), effectiveDate: digits(textByKeys(item, ["시행일자"]), 8),
    registeredAt: digits(textByKeys(item, ["등록일"]), 14), detailLink: redactString(textByKeys(item, ["상세링크"]), oc) };
}

function seedTarget(target, seedRoot, itemsDir, oc, metas = []) {
  const roots = seedCandidates(target, path.resolve(seedRoot));
  const result = { copied: 0, skipped: 0, invalid: 0, stale: 0 };
  const lawById = target === "law" ? new Map(metas.map((meta) => [meta.lawId, meta])) : null;
  const metaById = new Map(metas.map((meta) => [meta.id, meta]));
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const source of listJsonFiles(root)) {
      let raw, parsed;
      try { raw = fs.readFileSync(source, "utf8"); parsed = JSON.parse(raw); } catch { result.invalid += 1; continue; }
      if (!parsed || !(target === "law" ? isUsableLawSeed(parsed, raw) : isUsableDetail(parsed))) { result.invalid += 1; continue; }
      let name = path.basename(source);
      let currentMeta = null;
      if (target === "law") {
        const lawId = extractLawId(parsed) || path.basename(source, ".json");
        const current = lawById.get(lawId);
        const seedEffectiveDate = extractLawEffectiveDate(parsed);
        const declaredId = declaredWrapperId(target, parsed);
        const currentWrapper = Boolean(current && declaredId && declaredId === current.id);
        if (!current || (hasWrapperIdentity(parsed) && !currentWrapper)
          || (!currentWrapper && current.effectiveDate && seedEffectiveDate !== current.effectiveDate)) { result.stale += 1; continue; }
        currentMeta = current;
        name = `${safeName(current.id)}.json`;
      } else {
        const sourceId = detailIdentifier(target, parsed);
        currentMeta = metaById.get(sourceId);
        if (!sourceId || !currentMeta) { result.invalid += 1; continue; }
        name = `${safeName(currentMeta.id)}.json`;
      }
      const dest = path.join(itemsDir, name);
      const existing = readValidJson(dest);
      if (existing && isUsableForTarget(target, existing) && detailMatchesMeta(target, existing, currentMeta)) { result.skipped += 1; continue; }
      if (!containsSensitiveSeedMaterial(raw, oc)) {
        atomicCopy(source, dest);
      } else {
        const safe = redactObject(parsed, oc);
        atomicJson(dest, normalizeSeedWrapper(target, path.basename(name, ".json"), safe));
      }
      result.copied += 1;
    }
  }
  return result;
}

function lawBasicInfo(value) { const data = value?.data || value; return data?.법령?.기본정보 || data?.기본정보 || {}; }
function isUsableLawSeed(value, raw = "") { const info = lawBasicInfo(value); return (!raw || raw.length > 200) && Boolean(info?.법령ID || info?.법령명_한글 || info?.법령명한글); }
function extractLawId(value) { return String(lawBasicInfo(value)?.법령ID || "").trim(); }
function extractLawEffectiveDate(value) { return digits(lawBasicInfo(value)?.시행일자 || "", 8); }

function seedCandidates(target, seedRoot) {
  if (target === "law") return [path.join(seedRoot, "law", "items"), path.join(seedRoot, "law", "laws")];
  if (target === "prec") return [path.join(seedRoot, "prec", "items"), path.join(seedRoot, "precedent", "cases"), path.join(seedRoot, "precedent_body", "cases")];
  return [path.join(seedRoot, target, "items"), path.join(seedRoot, "legal_refs", target, "items")];
}

function verifyTargetCorpus(outDir) {
  const manifest = readValidJson(path.join(outDir, "manifest.json"));
  if (!manifest || manifest.status !== "complete") throw new Error("Refresh staging manifest is not complete.");
  for (const record of manifest.files || []) {
    const file = path.resolve(outDir, String(record.path || ""));
    if (path.relative(path.resolve(outDir), file).startsWith("..") || path.isAbsolute(path.relative(path.resolve(outDir), file))) throw new Error("Refresh manifest path escaped staging.");
    if (!fs.existsSync(file)) throw new Error(`Refresh staging file is missing: ${record.path}`);
    const stat = fs.statSync(file);
    if (stat.size !== Number(record.bytes) || sha256File(file) !== record.sha256) throw new Error(`Refresh staging hash mismatch: ${record.path}`);
  }
  const index = readValidJson(path.join(outDir, "index.json"));
  if (!Array.isArray(index) || index.length !== Number(manifest.recordCount)) throw new Error("Refresh staging record count mismatch.");
  return true;
}

function promoteStagingTarget(activeOutDir, stagingOutDir, root, target) {
  const active = path.resolve(activeOutDir), staging = path.resolve(stagingOutDir), resolvedRoot = path.resolve(root);
  if (path.dirname(active) !== resolvedRoot || !staging.startsWith(`${path.join(resolvedRoot, ".official-law-staging")}${path.sep}`)) throw new Error("Refusing unsafe refresh promotion paths.");
  const previousRoot = path.join(resolvedRoot, ".official-law-previous");
  ensureDir(previousRoot);
  const backup = path.join(previousRoot, `${safeName(target)}-${Date.now().toString(36)}-${crypto.randomBytes(3).toString("hex")}`);
  let movedActive = false;
  try {
    if (fs.existsSync(active)) { fs.renameSync(active, backup); movedActive = true; }
    fs.renameSync(staging, active);
  } catch (error) {
    if (movedActive && !fs.existsSync(active) && fs.existsSync(backup)) fs.renameSync(backup, active);
    throw error;
  }
  return { backup: movedActive ? backup : "" };
}

function pruneOrphanItems(itemsDir, metas) {
  const resolvedItems = path.resolve(itemsDir);
  const allowed = new Set(metas.map((meta) => `${safeName(meta.id)}.json`));
  let pruned = 0;
  for (const file of listJsonFiles(resolvedItems)) {
    if (path.dirname(path.resolve(file)) !== resolvedItems) throw new Error("Refusing to prune outside the target items directory.");
    if (allowed.has(path.basename(file))) continue;
    fs.rmSync(file);
    pruned += 1;
  }
  return pruned;
}

function normalizeSeedWrapper(target, id, value) {
  if (value?.schemaVersion && value?.data) return { ...value, target: value.target || target, id: value.id || id };
  if (Object.prototype.hasOwnProperty.call(value || {}, "data")) return { schemaVersion: 1, target, id, fetchedAt: value.fetchedAt || now(), source: { name: "국가법령정보센터", importedFrom: "legacy-local-cache" }, data: value.data };
  return { schemaVersion: 1, target, id, fetchedAt: now(), source: { name: "국가법령정보센터", importedFrom: "legacy-local-cache" }, data: value };
}

async function fetchApi(base, params, ctx) {
  const url = new URL(base);
  for (const [key, value] of Object.entries({ OC: ctx.oc, ...params })) if (value !== "" && value !== undefined) url.searchParams.set(key, String(value));
  let last;
  for (let attempt = 0; attempt <= ctx.retries; attempt += 1) {
    try {
      await ctx.gate();
      const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "heyu-official-law-sync/1.0" }, signal: AbortSignal.timeout(ctx.timeoutMs) });
      const raw = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${redactString(raw.slice(0, 200), ctx.oc)}`);
      let json;
      try { json = JSON.parse(raw); } catch { throw new Error(`Invalid JSON: ${redactString(raw.slice(0, 120), ctx.oc)}`); }
      return json;
    } catch (error) {
      last = new Error(redactString(error.message, ctx.oc));
      if (attempt >= ctx.retries) break;
      await sleep(Math.min(15000, 500 * (2 ** attempt)));
    }
  }
  throw last;
}

function makeManifest(target, config, status, state, counts, files) {
  return { schemaVersion: 1, target, targetLabel: config.label, source: sourceInfo(target, config),
    retrievedAt: state.listRetrievedAt || null, builtAt: now(), importedAt: state.seed?.importedAt || null,
    status, recordCount: counts.listed, chunkCount: counts.chunks, detailCount: counts.detailFiles,
    counts: { ...counts, apiTotal: state.apiTotal || 0 }, detailCoverage: { ...(state.detailCoverage || {}), detailCount: counts.detailFiles,
      selectedDetailCount: counts.selectedDetailFiles || 0,
      unavailableCount: Number(counts.unavailableDetails ?? (Array.isArray(state.unavailableDetailIds) ? state.unavailableDetailIds.length : 0)) },
    checkpoint: { listComplete: Boolean(state.listComplete), nextPage: state.nextPage || 1 },
    maintenance: { orphanPruned: Number(state.orphanPruned || 0) },
    hashAlgorithm: "sha256", files, contentSha256: contentDigest(files), legalNotice: LEGAL_NOTICE };
}

function sourceInfo(target, config) {
  return { name: "국가법령정보센터 국가법령정보 공동활용 Open API", target,
    sourceUrl: "https://www.law.go.kr/", guideUrl: "https://open.law.go.kr/LSO/openApi/guideList.do",
    termsOrLegalEffectUrl: "https://www.law.go.kr/lawPetitionForm.do?menuId=13&subMenuId=79", searchEndpoint: SEARCH_URL,
    serviceEndpoint: config.listOnly ? "" : SERVICE_URL,
    listGuideUrl: `${GUIDE_ROOT}?htmlName=${config.listGuide}`,
    detailGuideUrl: config.detailGuide ? `${GUIDE_ROOT}?htmlName=${config.detailGuide}` : "",
    officialSite: "https://www.law.go.kr/", openDataSite: "https://open.law.go.kr/" };
}

async function writeCorpusManifest(root, summaries = []) {
  const targets = discoverCorpusSummaries(root, summaries);
  atomicJson(path.join(root, "legal-corpus-manifest.json"), { schemaVersion: 1, source: "국가법령정보센터", generatedAt: now(), targets, legalNotice: LEGAL_NOTICE });
}

function discoverCorpusSummaries(root, currentSummaries = []) {
  const currentByTarget = new Map(currentSummaries.map((summary) => [summary.target, summary]));
  const targets = [];
  for (const target of ALL_TARGETS) {
    const relativeManifest = target === "lsAbrv" ? "legal_alias/official-aliases.manifest.json" : `${target}/manifest.json`;
    const manifestPath = path.join(root, ...relativeManifest.split("/"));
    const manifest = readValidJson(manifestPath);
    if (!manifest || manifest.target !== target || !["complete", "partial"].includes(manifest.status)) continue;
    const current = currentByTarget.get(target) || {};
    targets.push({
      target,
      status: manifest.status,
      count: Number(manifest.recordCount || 0),
      detailCount: Number(manifest.detailCount || manifest.counts?.detailFiles || 0),
      retrievedAt: manifest.retrievedAt || null,
      builtAt: manifest.builtAt || null,
      contentSha256: manifest.contentSha256 || "",
      manifest: relativeManifest,
      ...Object.fromEntries(Object.entries(current).filter(([key]) => !["target", "status", "count", "detailCount", "retrievedAt", "builtAt", "contentSha256", "manifest"].includes(key))),
      manifestSha256: sha256File(manifestPath),
      manifestBytes: fs.statSync(manifestPath).size,
    });
  }
  return targets;
}

function loadState(file, target, signature) {
  const old = readValidJson(file);
  if (old?.target === target && old?.signature === signature) return old;
  return { schemaVersion: 1, target, signature, status: "new", nextPage: 1, listComplete: false, pagesDownloaded: 0, detailsDownloaded: 0, errors: [] };
}

function inferListRetrievedAt(pagesDir) {
  let latest = 0;
  for (const file of listJsonFiles(pagesDir)) {
    try { latest = Math.max(latest, fs.statSync(file).mtimeMs); } catch { /* ignored */ }
  }
  return latest ? new Date(latest).toISOString() : "";
}

function findRoot(json, keys) { for (const key of keys) if (json?.[key] && typeof json[key] === "object") return json[key]; return json; }
function listItems(root, keys) { for (const key of keys) { const value = root?.[key]; if (Array.isArray(value)) return value; if (value && typeof value === "object") return [value]; } return []; }
function textByKeys(obj, keys) { if (!obj || typeof obj !== "object") return ""; for (const wanted of keys) { const hit = Object.entries(obj).find(([key]) => key === wanted || key.includes(wanted)); if (hit && hit[1] !== undefined && hit[1] !== null) return String(hit[1]).trim(); } return ""; }
function assertApiOk(json) { const text = flattenText(json); if (/사용자 정보 검증에 실패|인증.*실패|요청.*실패/.test(text.slice(0, 1000))) throw new Error("National Law API rejected the request."); }
function isUsableDetail(value) { const data = value?.data ?? value; const flat = normalizeSpace(flattenText(data)); return flat.length > 30 && !/일치하는 .{0,20}(없습니다|없음)|사용자 정보 검증에 실패/.test(flat.slice(0, 300)); }
function isUsableForTarget(target, value) { return target === "law" ? isUsableLawSeed(value) : isUsableDetail(value); }
function detailMatchesMeta(target, value, meta) {
  if (target === "law") {
    const lawId = extractLawId(value), effectiveDate = extractLawEffectiveDate(value);
    const declaredId = declaredWrapperId(target, value);
    if (hasWrapperIdentity(value)) {
      return Boolean(declaredId && declaredId === meta.id && lawId && lawId === meta.lawId);
    }
    return Boolean(lawId && lawId === meta.lawId && (!meta.effectiveDate || (effectiveDate && effectiveDate === meta.effectiveDate)));
  }
  return Boolean(meta?.id && detailIdentifier(target, value) === meta.id);
}

function detailIdentifier(target, value) {
  if (!value || typeof value !== "object") return "";
  const keys = TARGETS[target]?.idKeys || [];
  const found = findScalarByKeys(value.data ?? value, keys);
  const nestedId = found === undefined || found === null ? "" : String(found).trim();
  if (hasWrapperIdentity(value)) {
    const declaredId = declaredWrapperId(target, value);
    return declaredId && nestedId && declaredId === nestedId ? declaredId : "";
  }
  return nestedId;
}

function hasWrapperIdentity(value) {
  return Boolean(value && typeof value === "object"
    && (Object.prototype.hasOwnProperty.call(value, "target") || Object.prototype.hasOwnProperty.call(value, "id")));
}

function declaredWrapperId(target, value) {
  if (!hasWrapperIdentity(value) || String(value.target || "") !== target) return "";
  return value.id === undefined || value.id === null ? "" : String(value.id).trim();
}

function findScalarByKeys(value, keys) {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = findScalarByKeys(item, keys); if (found !== undefined) return found; }
    return undefined;
  }
  for (const [key, child] of Object.entries(value)) {
    if (keys.some((wanted) => key === wanted || key.includes(wanted)) && (typeof child === "string" || typeof child === "number")) return child;
  }
  for (const child of Object.values(value)) { const found = findScalarByKeys(child, keys); if (found !== undefined) return found; }
  return undefined;
}

function findValuesByKeys(value, keys, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) { for (const item of value) findValuesByKeys(item, keys, out); return out; }
  for (const [key, child] of Object.entries(value)) {
    if (keys.some((wanted) => key === wanted || key.includes(wanted))) out.push(child);
    else findValuesByKeys(child, keys, out);
  }
  return out;
}

function flattenText(value, pieces = [], key = "") {
  if (value === null || value === undefined) return pieces.join(" ");
  if (typeof value === "string" || typeof value === "number") { const text = normalizeSpace(String(value)); if (text && !/링크|url/i.test(key) && !/^https?:\/\//i.test(text)) pieces.push(text); return pieces.join(" "); }
  if (Array.isArray(value)) { for (const item of value) flattenText(item, pieces, key); return pieces.join(" "); }
  if (typeof value === "object") for (const [childKey, child] of Object.entries(value)) flattenText(child, pieces, childKey);
  return pieces.join(" ");
}

function redactObject(value, oc, parentKey = "") {
  if (/^(?:oc|law_oc|precedent_oc|legal_ref_oc|token|access_?token|api_?key|apikey|authorization|secret)$/i.test(parentKey)) return "[REDACTED]";
  if (typeof value === "string") return redactString(value, oc);
  if (Array.isArray(value)) return value.map((item) => redactObject(item, oc, parentKey));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactObject(item, oc, key)]));
  return value;
}

function redactString(value, oc) {
  let text = String(value || "");
  text = text.replace(/([?&]OC=)[^&\s"']*/gi, "$1REDACTED");
  if (oc) text = text.split(oc).join("[REDACTED]");
  return text.replace(/\b(OC|LAW_OC|PRECEDENT_OC|LEGAL_REF_OC)\s*[:=]\s*[^&\s,;]+/gi, "$1=[REDACTED]");
}

function containsSensitiveSeedMaterial(raw, oc = "") {
  const text = String(raw || "");
  if (oc && text.includes(oc)) return true;
  if (/"(?:OC|LAW_OC|PRECEDENT_OC|LEGAL_REF_OC|token|access_?token|api_?key|apikey|authorization|secret)"\s*:/i.test(text)) return true;
  return /([?&]OC=)(?!REDACTED|\[REDACTED\])[^&\s"']+/i.test(text);
}

function fileRecord(file, root) { const stat = fs.statSync(file); return { path: path.relative(root, file).replaceAll("\\", "/"), bytes: stat.size, sha256: sha256File(file) }; }
function contentDigest(files) { return sha256Text(files.map((f) => `${f.path}\0${f.sha256}\n`).join("")); }
function sha256File(file) { const hash = crypto.createHash("sha256"), fd = fs.openSync(file, "r"), buffer = Buffer.allocUnsafe(1024 * 1024); try { let n; while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n)); } finally { fs.closeSync(fd); } return hash.digest("hex"); }
function sha256Text(text) { return crypto.createHash("sha256").update(String(text)).digest("hex"); }
function readValidJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
function atomicJson(file, value) { atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`); }
function atomicWrite(file, text) { ensureDir(path.dirname(file)); const tmp = tempPath(file); const fd = fs.openSync(tmp, "wx"); try { fs.writeFileSync(fd, text, "utf8"); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } replaceFile(tmp, file); }
function atomicCopy(source, file) { ensureDir(path.dirname(file)); const tmp = tempPath(file); fs.copyFileSync(source, tmp, fs.constants.COPYFILE_EXCL); const fd = fs.openSync(tmp, "r+"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } replaceFile(tmp, file); }
function replaceFile(tmp, file) {
  let last;
  const attempts = process.platform === "win32" ? 20 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try { fs.renameSync(tmp, file); return; }
    catch (error) {
      last = error;
      const retryable = process.platform === "win32" && ["EBUSY", "EPERM", "EACCES"].includes(error.code);
      if (!retryable || attempt + 1 >= attempts) break;
      sleepSync(25 * (attempt + 1));
    }
  }
  try { if (fs.existsSync(tmp)) fs.rmSync(tmp); } catch { /* preserve the original error */ }
  throw last;
}
function sleepSync(ms) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
function tempPath(file) { return `${file}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`; }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function listJsonFiles(dir) { if (!fs.existsSync(dir)) return []; return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile() && entry.name.endsWith(".json")).map((entry) => path.join(dir, entry.name)).sort(); }
function countJsonFiles(dir) { return listJsonFiles(dir).length; }
function safeName(value) { return String(value || "unknown").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120); }
function normalizeSpace(value) { return String(value || "").replace(/\s+/g, " ").trim(); }
function splitText(value, max) { const text = normalizeSpace(value); if (!text) return []; const parts = []; for (let rest = text; rest;) { if (rest.length <= max) { parts.push(rest); break; } let cut = rest.lastIndexOf(" ", max); if (cut < max * 0.65) cut = max; parts.push(rest.slice(0, cut).trim()); rest = rest.slice(cut).trim(); } return parts; }
function digits(value, max) { return String(value || "").replace(/\D/g, "").slice(0, max); }
function parseList(value) { return String(value || "").split(",").map((item) => item.trim()).filter(Boolean); }
function number(value, fallback, min, max) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : fallback; }
function now() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function makeGate(delayMs) {
  let next = 0;
  let tail = Promise.resolve();
  return () => {
    const turn = tail.then(async () => {
      const wait = next - Date.now();
      if (wait > 0) await sleep(wait);
      next = Date.now() + delayMs;
    });
    tail = turn.catch(() => {});
    return turn;
  };
}

if (require.main === module) main().catch((error) => { console.error(`[error] ${redactString(error.message, process.env.LAW_OC || "")}`); process.exitCode = 1; });

module.exports = { TARGETS, parseArgs, redactString, redactObject, normalizeMeta, normalizeAliasRecord, isUsableDetail, buildChunks, contentDigest,
  pruneOrphanItems, inferListRetrievedAt, makeManifest, verifyTargetCorpus, promoteStagingTarget, detailMatchesMeta, assertCompleteListCount,
  containsSensitiveSeedMaterial, discoverCorpusSummaries, aliasCorpusStatus, countSelectedUnavailable, makeGate, replaceFile };
