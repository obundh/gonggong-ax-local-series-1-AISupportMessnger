#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";

const TARGETS = {
  expc: {
    label: "법령해석례",
    idKeys: ["법령해석례일련번호", "해석례일련번호", "expcSeq", "ID"],
    titleKeys: ["안건명", "법령해석례명", "사건명", "LM"],
    numberKeys: ["안건번호", "사건번호", "itmno"],
    dateKeys: ["회신일자", "해석일자", "등록일자"],
    orgKeys: ["질의기관명", "회신기관명"],
    typeKeys: ["회신기관명"],
    linkKeys: ["법령해석례상세링크", "상세링크", "detailLink"],
    sectionKeys: [
      ["question", "질의요지", ["질의요지", "질의"]],
      ["answer", "회답", ["회답", "답변"]],
      ["reason", "이유", ["이유", "검토의견"]],
      ["laws", "관계법령", ["관계법령", "참조조문", "관련법령"]],
    ],
  },
  decc: {
    label: "행정심판례",
    idKeys: ["행정심판례일련번호", "재결례일련번호", "deccSeq", "ID"],
    titleKeys: ["사건명", "행정심판례명", "재결례명", "LM"],
    numberKeys: ["사건번호"],
    dateKeys: ["의결일자", "재결일자", "처분일자"],
    orgKeys: ["처분청", "재결청"],
    typeKeys: ["재결례유형명", "재결구분명"],
    linkKeys: ["행정심판례상세링크", "재결례상세링크", "상세링크", "detailLink"],
    sectionKeys: [
      ["summary", "재결요지", ["재결요지", "결정요지"]],
      ["order", "주문", ["주문"]],
      ["claim", "청구취지", ["청구취지"]],
      ["reason", "이유", ["이유"]],
    ],
  },
  admrul: {
    label: "행정규칙",
    idKeys: ["행정규칙일련번호", "행정규칙ID", "admrulSeq", "ID", "LID"],
    titleKeys: ["행정규칙명", "행정규칙제명", "LM"],
    numberKeys: ["발령번호"],
    dateKeys: ["시행일자", "발령일자", "생성일자"],
    orgKeys: ["소관부처명"],
    typeKeys: ["행정규칙종류", "행정규칙구분명", "현행연혁구분", "제개정구분명"],
    linkKeys: ["행정규칙상세링크", "상세링크", "detailLink"],
    sectionKeys: [
      ["article", "조문", ["조문내용", "조문본문", "항내용"]],
      ["appendix", "별표서식", ["별표", "서식"]],
      ["reason", "제개정이유", ["제개정이유", "개정이유"]],
    ],
  },
  detc: {
    label: "헌재결정례",
    idKeys: ["헌재결정례일련번호", "결정례일련번호", "detcSeq", "ID"],
    titleKeys: ["사건명", "헌재결정례명", "LM"],
    numberKeys: ["사건번호"],
    dateKeys: ["종국일자", "선고일자"],
    orgKeys: ["재판부구분코드"],
    typeKeys: ["사건종류명"],
    linkKeys: ["헌재결정례상세링크", "상세링크", "detailLink"],
    sectionKeys: [
      ["holding", "판시사항", ["판시사항"]],
      ["summary", "결정요지", ["결정요지"]],
      ["text", "전문", ["전문", "이유"]],
      ["subject", "심판대상조문", ["심판대상조문"]],
      ["laws", "참조조문", ["참조조문"]],
      ["refs", "참조판례", ["참조판례"]],
    ],
  },
};

function parseArgs(argv) {
  const args = {
    oc: process.env.LEGAL_REF_OC || process.env.PRECEDENT_OC || process.env.LAW_OC || "",
    target: process.env.LEGAL_REF_TARGET || "expc",
    out: process.env.LEGAL_REF_OUT || "",
    queries: parseList(process.env.LEGAL_REF_QUERIES || process.env.LEGAL_REF_QUERY || ""),
    display: Number(process.env.LEGAL_REF_DISPLAY || 100),
    maxPages: Number(process.env.LEGAL_REF_MAX_PAGES || 1),
    delayMs: Number(process.env.LEGAL_REF_DELAY_MS || 200),
    search: process.env.LEGAL_REF_SEARCH || "1",
    detailType: process.env.LEGAL_REF_DETAIL_TYPE || "JSON",
    force: false,
    skipDetails: false,
    params: {},
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--oc") throw new Error("--oc is disabled. Set LEGAL_REF_OC or LAW_OC in the environment.");
    else if (arg === "--target") args.target = String(next || ""), i += 1;
    else if (arg === "--out") args.out = next, i += 1;
    else if (arg === "--query") args.queries.push(next || ""), i += 1;
    else if (arg === "--queries") args.queries.push(...parseList(next || "")), i += 1;
    else if (arg === "--display") args.display = Number(next), i += 1;
    else if (arg === "--max-pages") args.maxPages = Number(next), i += 1;
    else if (arg === "--delay-ms") args.delayMs = Number(next), i += 1;
    else if (arg === "--search") args.search = String(next || "1"), i += 1;
    else if (arg === "--detail-type") args.detailType = String(next || "JSON").toUpperCase(), i += 1;
    else if (arg === "--param") {
      const [key, ...rest] = String(next || "").split("=");
      if (key && rest.length) args.params[key] = rest.join("=");
      i += 1;
    } else if (arg === "--force") args.force = true;
    else if (arg === "--skip-details") args.skipDetails = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  args.target = args.target.toLowerCase();
  args.display = clampNumber(args.display, 1, 100, 100);
  args.maxPages = clampNumber(args.maxPages, 1, 100000, 1);
  args.delayMs = clampNumber(args.delayMs, 0, 60000, 200);
  args.detailType = ["JSON", "XML", "HTML"].includes(args.detailType) ? args.detailType : "JSON";
  if (args.queries.length === 0) args.queries.push("");
  if (!args.out) args.out = path.join("data", "legal_refs", args.target);
  return args;
}

function printHelp() {
  console.log(`
Legal reference Open API sync

Usage:
  $env:LEGAL_REF_OC="YOUR_OC"; npm run legal-ref:sync -- --target expc --queries "공무원,징계"
  npm run legal-ref:sync -- --target decc --query "정보공개" --search 2 --max-pages 2
  npm run legal-ref:sync -- --target admrul --query "전파" --param nw=1

Targets:
  expc    법령해석례
  decc    행정심판례
  admrul  행정규칙
  detc    헌재결정례

Options:
  LEGAL_REF_OC     인증값은 LEGAL_REF_OC, PRECEDENT_OC, LAW_OC 환경변수로만 입력
  --target         동기화 대상
  --query          검색어. 여러 번 지정 가능
  --queries        콤마로 구분한 검색어 목록
  --out            출력 폴더. 기본 data/legal_refs/<target>
  --search         검색범위. 1: 제목/명칭, 2: 본문검색
  --param          추가 API 파라미터. 예: --param nw=1 --param knd=1
  --display        페이지당 목록 수. 기본/최대 100
  --max-pages      검색어별 최대 페이지 수. 기본 1
  --delay-ms       API 호출 사이 대기 시간. 기본 200
  --skip-details   목록만 저장하고 본문 조회 생략
  --force          기존 items/*.json 캐시 무시
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.oc) throw new Error("Missing OC. Set LEGAL_REF_OC, PRECEDENT_OC, or LAW_OC in the environment.");
  const config = TARGETS[args.target];
  if (!config) throw new Error(`Unsupported target: ${args.target}`);

  const outDir = path.resolve(args.out);
  const itemsDir = path.join(outDir, "items");
  fs.mkdirSync(itemsDir, { recursive: true });

  const seen = new Map();
  for (const query of args.queries) {
    for (let page = 1; page <= args.maxPages; page += 1) {
      const searchUrl = buildUrl(SEARCH_URL, {
        OC: args.oc,
        target: args.target,
        type: "JSON",
        search: args.search,
        display: String(args.display),
        page: String(page),
        ...args.params,
        ...(query ? { query } : {}),
      });

      console.log(`[search:${args.target}] query="${query || "(all)"}" page=${page}`);
      const json = await fetchJson(searchUrl);
      assertApiOk(json);
      const items = extractItems(json, config);
      if (items.length === 0) break;

      for (const item of items) {
        const meta = normalizeMeta(item, config);
        if (!meta.id) continue;
        seen.set(meta.id, { ...seen.get(meta.id), ...meta });
      }

      if (items.length < args.display) break;
      await sleep(args.delayMs);
    }
  }

  const metas = [...seen.values()].sort(compareItems);
  const index = [];
  const chunks = [];

  for (const [idx, meta] of metas.entries()) {
    const detailFile = `${safeFileName(meta.id)}.json`;
    const detailPath = path.join(itemsDir, detailFile);
    let detail = null;

    if (args.skipDetails) {
      console.log(`[list-only:${args.target}] ${idx + 1}/${metas.length} ${displayItem(meta)}`);
    } else if (!args.force && fs.existsSync(detailPath)) {
      console.log(`[cached:${args.target}] ${idx + 1}/${metas.length} ${displayItem(meta)}`);
      detail = JSON.parse(fs.readFileSync(detailPath, "utf8"));
    } else {
      console.log(`[detail:${args.target}] ${idx + 1}/${metas.length} ${displayItem(meta)}`);
      detail = await fetchDetail(args, config, meta);
      fs.writeFileSync(detailPath, JSON.stringify(detail, null, 2), "utf8");
      await sleep(args.delayMs);
    }

    const normalized = {
      ...meta,
      target: args.target,
      targetLabel: config.label,
      detailFile: args.skipDetails ? "" : path.join("items", detailFile).replaceAll("\\", "/"),
      syncedAt: new Date().toISOString(),
    };
    index.push(normalized);

    if (detail) {
      for (const chunk of buildChunks(args.target, config, normalized, detail)) {
        chunks.push(JSON.stringify(chunk));
      }
    } else {
      chunks.push(JSON.stringify(buildMetaChunk(args.target, normalized)));
    }

    if ((idx + 1) % 100 === 0) {
      writeOutputs(outDir, index, chunks, buildManifest(args, config, index.length, chunks.length, "partial"));
    }
  }

  writeOutputs(outDir, index, chunks, buildManifest(args, config, index.length, chunks.length, "done"));
  console.log(`[done:${args.target}] items=${index.length} chunks=${chunks.length} out=${outDir}`);
}

async function fetchDetail(args, config, meta) {
  const idParam = args.target === "admrul" && meta.lid ? { LID: meta.lid } : { ID: meta.id };
  const detailUrl = buildUrl(SERVICE_URL, {
    OC: args.oc,
    target: args.target,
    type: args.detailType,
    ...idParam,
    ...(meta.title ? { LM: meta.title } : {}),
  });

  const response = await fetch(detailUrl, {
    headers: {
      Accept: args.detailType === "JSON" ? "application/json,text/plain,*/*" : "text/html,application/xml,text/plain,*/*",
      "User-Agent": "local-ai-legal-ref-sync/0.1",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);

  if (args.detailType === "JSON") {
    try {
      const json = JSON.parse(text);
      assertApiOk(json);
      return { format: "JSON", fetchedAt: new Date().toISOString(), sourceUrl: redactOc(detailUrl), data: json };
    } catch (_error) {
      return { format: "TEXT", fetchedAt: new Date().toISOString(), sourceUrl: redactOc(detailUrl), text };
    }
  }

  return {
    format: args.detailType,
    fetchedAt: new Date().toISOString(),
    sourceUrl: redactOc(detailUrl),
    text: args.detailType === "HTML" ? stripHtml(text) : text,
    raw: text,
  };
}

function extractItems(json, config) {
  const arrays = [];
  walk(json, (value) => {
    if (!Array.isArray(value)) return;
    const score = value.filter((item) => item && typeof item === "object" && looksLikeItem(item, config)).length;
    if (score > 0) arrays.push({ score, value });
  });
  arrays.sort((a, b) => b.score - a.score);
  if (arrays[0]) return arrays[0].value;

  const single = findObject(json, (obj) => looksLikeItem(obj, config));
  return single ? [single] : [];
}

function looksLikeItem(item, config) {
  return Boolean(getByKeyPart(item, config.idKeys) && getByKeyPart(item, config.titleKeys));
}

function normalizeMeta(item, config) {
  const id = stringValue(getByKeyPart(item, config.idKeys));
  const lid = stringValue(getByKeyPart(item, ["행정규칙ID", "LID"]));
  return {
    id,
    lid,
    title: stringValue(getByKeyPart(item, config.titleKeys)),
    number: stringValue(getByKeyPart(item, config.numberKeys)),
    date: normalizeDate(stringValue(getByKeyPart(item, config.dateKeys))),
    organization: stringValue(getByKeyPart(item, config.orgKeys)),
    category: stringValue(getByKeyPart(item, config.typeKeys)),
    detailLink: redactUrlLike(stringValue(getByKeyPart(item, config.linkKeys))),
  };
}

function buildChunks(target, config, meta, detail) {
  const data = detail?.data || detail;
  const chunks = [];

  for (const [section, sectionTitle, keyParts] of config.sectionKeys) {
    const text = normalizeWhitespace(flattenText(firstByKeyPart(data, keyParts)));
    if (!text) continue;
    for (const [partIndex, partText] of splitText(text, 1800).entries()) {
      chunks.push({
        id: `${target}:${meta.id}:${section}:${partIndex + 1}`,
        type: "legal-reference",
        target,
        targetLabel: config.label,
        section,
        title: `${meta.title || meta.id} - ${sectionTitle}`,
        itemId: meta.id,
        itemTitle: meta.title,
        itemNumber: meta.number,
        date: meta.date,
        organization: meta.organization,
        category: meta.category,
        text: partText,
        sourceFile: meta.detailFile,
      });
    }
  }

  if (chunks.length) return chunks;

  const fallbackText = normalizeWhitespace(flattenText(data));
  if (fallbackText) {
    return splitText(fallbackText, 1800).map((text, index) => ({
      id: `${target}:${meta.id}:document:${index + 1}`,
      type: "legal-reference",
      target,
      targetLabel: config.label,
      section: "document",
      title: meta.title || meta.id,
      itemId: meta.id,
      itemTitle: meta.title,
      itemNumber: meta.number,
      date: meta.date,
      organization: meta.organization,
      category: meta.category,
      text,
      sourceFile: meta.detailFile,
    }));
  }

  return [buildMetaChunk(target, meta)];
}

function buildMetaChunk(target, meta) {
  return {
    id: `${target}:${meta.id}:meta`,
    type: "legal-reference",
    target,
    section: "meta",
    title: meta.title || meta.id,
    itemId: meta.id,
    itemTitle: meta.title,
    itemNumber: meta.number,
    date: meta.date,
    organization: meta.organization,
    category: meta.category,
    text: [meta.title, meta.number, meta.date, meta.organization, meta.category].filter(Boolean).join(" "),
    sourceFile: meta.detailFile,
  };
}

function buildManifest(args, config, itemCount, chunkCount, status) {
  return {
    source: "국가법령정보 공동활용 Open API",
    searchUrl: SEARCH_URL,
    serviceUrl: SERVICE_URL,
    syncedAt: new Date().toISOString(),
    target: args.target,
    targetLabel: config.label,
    queries: args.queries,
    search: args.search,
    params: args.params,
    detailType: args.detailType,
    itemCount,
    chunkCount,
    status,
  };
}

function writeOutputs(outDir, index, chunks, manifest) {
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "search-index.jsonl"), chunks.join("\n") + (chunks.length ? "\n" : ""), "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function firstByKeyPart(value, keyParts) {
  const found = [];
  walk(value, (node, key) => {
    if (found.length || node === null || node === undefined) return;
    if (!keyParts.some((part) => String(key).includes(part))) return;
    if (typeof node === "string" || typeof node === "number" || Array.isArray(node) || typeof node === "object") {
      found.push(node);
    }
  });
  return found[0] || "";
}

function getByKeyPart(obj, keyParts) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  const entries = Object.entries(obj);
  for (const part of keyParts || []) {
    const found = entries.find(([key]) => key === part || key.includes(part));
    if (found) return found[1];
  }
  return "";
}

function flattenText(value) {
  const pieces = [];
  walk(value, (node, key) => {
    if (node === null || node === undefined) return;
    if (typeof node === "string" || typeof node === "number") {
      const text = normalizeWhitespace(String(node));
      if (text && !isLikelyMetadataOnly(key, text)) pieces.push(text);
    }
  });
  return normalizeWhitespace(pieces.join("\n"));
}

function splitText(text, maxLength) {
  const clean = normalizeWhitespace(text);
  if (clean.length <= maxLength) return clean ? [clean] : [];

  const chunks = [];
  let remaining = clean;
  while (remaining.length > maxLength) {
    let cut = remaining.lastIndexOf(" ", maxLength);
    if (cut < maxLength * 0.65) cut = maxLength;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "local-ai-legal-ref-sync/0.1",
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text);
  } catch (_error) {
    throw new Error(`Invalid JSON from API: ${text.slice(0, 300)}`);
  }
}

function assertApiOk(json) {
  if (!json || typeof json !== "object") return;
  const result = stringValue(json.result || json.RESULT || json.결과);
  const message = stringValue(json.msg || json.message || json.MSG || json.메시지);
  if (result.includes("실패") || result.toLowerCase() === "error") {
    throw new Error(`Law API rejected request: ${message || result}`);
  }
  if (message.includes("실패") || message.includes("검증")) {
    throw new Error(`Law API rejected request: ${message}`);
  }
}

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

function walk(value, visitor, key = "") {
  visitor(value, key);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor, key);
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) {
    walk(childValue, visitor, childKey);
  }
}

function findObject(value, predicate) {
  if (!value || typeof value !== "object") return null;
  if (!Array.isArray(value) && predicate(value)) return value;
  const children = Array.isArray(value) ? value : Object.values(value);
  for (const child of children) {
    const found = findObject(child, predicate);
    if (found) return found;
  }
  return null;
}

function stripHtml(value) {
  return normalizeWhitespace(
    String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
  );
}

function normalizeWhitespace(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  return value.replace(/[^\d]/g, "").slice(0, 8);
}

function isLikelyMetadataOnly(key, text) {
  if (/상세링크|detailLink|HTML|URL|url/i.test(String(key))) return true;
  if (/^https?:\/\//i.test(text)) return true;
  return false;
}

function compareItems(a, b) {
  const byDate = String(b.date || "").localeCompare(String(a.date || ""));
  if (byDate) return byDate;
  return String(a.title || a.id).localeCompare(String(b.title || b.id), "ko");
}

function displayItem(meta) {
  return `${meta.title || "(no title)"} ${meta.number ? `(${meta.number})` : ""} [${meta.id}]`;
}

function redactOc(url) {
  const parsed = new URL(url);
  if (parsed.searchParams.has("OC")) parsed.searchParams.set("OC", "REDACTED");
  return parsed.toString();
}

function redactUrlLike(value) {
  return String(value || "").replace(/([?&]OC=)[^&"]*/i, "$1REDACTED");
}

function parseList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function safeFileName(value) {
  return String(value || "unknown").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120);
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(`[error] ${redactError(error.message)}`);
  process.exitCode = 1;
});

function redactError(value) {
  let text = String(value || "").replace(/([?&]OC=)[^&\s"']*/gi, "$1REDACTED");
  for (const secret of [process.env.LEGAL_REF_OC, process.env.PRECEDENT_OC, process.env.LAW_OC].filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text;
}
