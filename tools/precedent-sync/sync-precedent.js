#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";

function parseArgs(argv) {
  const args = {
    oc: process.env.PRECEDENT_OC || process.env.LAW_OC || "",
    out: process.env.PRECEDENT_OUT || "data/precedent",
    queries: parseList(process.env.PRECEDENT_QUERIES || process.env.PRECEDENT_QUERY || ""),
    display: Number(process.env.PRECEDENT_DISPLAY || 100),
    maxPages: Number(process.env.PRECEDENT_MAX_PAGES || 1),
    delayMs: Number(process.env.PRECEDENT_DELAY_MS || 250),
    search: process.env.PRECEDENT_SEARCH || "1",
    org: process.env.PRECEDENT_ORG || "",
    detailType: process.env.PRECEDENT_DETAIL_TYPE || "JSON",
    force: false,
    skipDetails: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--oc") throw new Error("--oc is disabled. Set PRECEDENT_OC or LAW_OC in the environment.");
    else if (arg === "--out") args.out = next, i += 1;
    else if (arg === "--query") args.queries.push(next || ""), i += 1;
    else if (arg === "--queries") args.queries.push(...parseList(next || "")), i += 1;
    else if (arg === "--display") args.display = Number(next), i += 1;
    else if (arg === "--max-pages") args.maxPages = Number(next), i += 1;
    else if (arg === "--delay-ms") args.delayMs = Number(next), i += 1;
    else if (arg === "--search") args.search = String(next || "1"), i += 1;
    else if (arg === "--org") args.org = String(next || ""), i += 1;
    else if (arg === "--detail-type") args.detailType = String(next || "JSON").toUpperCase(), i += 1;
    else if (arg === "--force") args.force = true;
    else if (arg === "--skip-details") args.skipDetails = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.queries.length === 0) args.queries.push("");
  args.display = clampNumber(args.display, 1, 100, 100);
  args.maxPages = clampNumber(args.maxPages, 1, 100000, 1);
  args.delayMs = clampNumber(args.delayMs, 0, 60000, 250);
  args.detailType = ["JSON", "XML", "HTML"].includes(args.detailType) ? args.detailType : "JSON";
  return args;
}

function printHelp() {
  console.log(`
Precedent Open API sync

Usage:
  $env:PRECEDENT_OC="YOUR_OC"; $env:PRECEDENT_QUERIES="공무원,손해배상"; npm run precedent:sync
  $env:PRECEDENT_OC="YOUR_OC"; npm run precedent:sync -- --query "연구직공무원" --max-pages 3
  npm run precedent:sync -- --query "징계" --search 2 --org 400201

Options:
  PRECEDENT_OC     인증값은 PRECEDENT_OC 또는 LAW_OC 환경변수로만 입력
  --query          판례명/본문 검색어. 여러 번 지정 가능
  --queries        콤마로 구분한 검색어 목록
  --out            출력 폴더. 기본 data/precedent
  --display        페이지당 목록 수. 기본/최대 100
  --max-pages      검색어별 최대 페이지 수. 기본 1
  --delay-ms       API 호출 사이 대기 시간. 기본 250
  --search         검색범위. 1: 판례명, 2: 본문검색
  --org            법원종류. 예: 대법원 400201, 하위법원 400202
  --detail-type    본문 출력 형식. JSON/XML/HTML, 기본 JSON
  --skip-details   목록만 저장하고 본문 조회 생략
  --force          기존 cases/*.json 캐시 무시

Output:
  index.json              판례 메타데이터 목록
  search-index.jsonl      로컬 검색/RAG용 텍스트 청크
  cases/*.json            판례 본문 원본 또는 래핑 JSON
  manifest.json           동기화 실행 정보
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.oc) {
    throw new Error("Missing OC. Set PRECEDENT_OC or LAW_OC in the environment.");
  }

  const outDir = path.resolve(args.out);
  const casesDir = path.join(outDir, "cases");
  fs.mkdirSync(casesDir, { recursive: true });

  const seen = new Map();
  for (const query of args.queries) {
    for (let page = 1; page <= args.maxPages; page += 1) {
      const searchUrl = buildUrl(SEARCH_URL, {
        OC: args.oc,
        target: "prec",
        type: "JSON",
        search: args.search,
        display: String(args.display),
        page: String(page),
        ...(query ? { query } : {}),
        ...(args.org ? { org: args.org } : {}),
      });

      console.log(`[search] query="${query || "(all)"}" page=${page}`);
      const json = await fetchJson(searchUrl);
      assertApiOk(json);
      const items = extractPrecedentList(json);
      if (items.length === 0) break;

      for (const item of items) {
        const meta = normalizePrecedentMeta(item);
        if (!meta.id) continue;
        seen.set(meta.id, { ...seen.get(meta.id), ...meta });
      }

      if (items.length < args.display) break;
      await sleep(args.delayMs);
    }
  }

  const metas = [...seen.values()].sort(comparePrecedents);
  const index = [];
  const chunks = [];

  for (const [idx, meta] of metas.entries()) {
    const detailFile = `${safeFileName(meta.id)}.json`;
    const detailPath = path.join(casesDir, detailFile);
    let detail = null;

    if (args.skipDetails) {
      console.log(`[list-only] ${idx + 1}/${metas.length} ${displayPrecedent(meta)}`);
    } else if (!args.force && fs.existsSync(detailPath)) {
      console.log(`[cached] ${idx + 1}/${metas.length} ${displayPrecedent(meta)}`);
      detail = JSON.parse(fs.readFileSync(detailPath, "utf8"));
    } else {
      console.log(`[detail] ${idx + 1}/${metas.length} ${displayPrecedent(meta)}`);
      detail = await fetchPrecedentDetail(args, meta);
      fs.writeFileSync(detailPath, JSON.stringify(detail, null, 2), "utf8");
      await sleep(args.delayMs);
    }

    const normalized = {
      ...meta,
      detailFile: args.skipDetails ? "" : path.join("cases", detailFile).replaceAll("\\", "/"),
      syncedAt: new Date().toISOString(),
    };
    index.push(normalized);

    if (detail) {
      for (const chunk of buildPrecedentChunks(normalized, detail)) {
        chunks.push(JSON.stringify(chunk));
      }
    } else {
      chunks.push(JSON.stringify(buildMetaChunk(normalized)));
    }

    if ((idx + 1) % 100 === 0) {
      writeOutputs(outDir, index, chunks, buildManifest(args, index.length, chunks.length, "partial"));
    }
  }

  writeOutputs(outDir, index, chunks, buildManifest(args, index.length, chunks.length, "done"));
  console.log(`[done] precedents=${index.length} chunks=${chunks.length} out=${outDir}`);
}

async function fetchPrecedentDetail(args, meta) {
  const detailUrl = buildUrl(SERVICE_URL, {
    OC: args.oc,
    target: "prec",
    type: args.detailType,
    ID: meta.id,
    ...(meta.caseName ? { LM: meta.caseName } : {}),
  });

  const response = await fetch(detailUrl, {
    headers: {
      Accept: args.detailType === "JSON" ? "application/json,text/plain,*/*" : "text/html,application/xml,text/plain,*/*",
      "User-Agent": "local-ai-precedent-sync/0.1",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }

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

function buildManifest(args, precedentCount, chunkCount, status) {
  return {
    source: "국가법령정보 공동활용 Open API",
    searchUrl: SEARCH_URL,
    serviceUrl: SERVICE_URL,
    syncedAt: new Date().toISOString(),
    target: "prec",
    detailTarget: "prec",
    queries: args.queries,
    search: args.search,
    org: args.org,
    detailType: args.detailType,
    precedentCount,
    chunkCount,
    status,
  };
}

function writeOutputs(outDir, index, chunks, manifest) {
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "search-index.jsonl"), chunks.join("\n") + (chunks.length ? "\n" : ""), "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function buildPrecedentChunks(meta, detail) {
  const data = detail?.data || detail;
  const sections = [
    ["facts", "사실관계", firstByKeyPart(data, ["사실관계", "인정사실"])],
    ["holding", "판시사항", firstByKeyPart(data, ["판시사항"])],
    ["summary", "판결요지", firstByKeyPart(data, ["판결요지", "결정요지"])],
    ["reason", "이유", firstByKeyPart(data, ["판례내용", "판결내용", "이유", "주문"])],
    ["laws", "참조조문", firstByKeyPart(data, ["참조조문", "참조법령"])],
    ["refs", "참조판례", firstByKeyPart(data, ["참조판례"])],
  ];

  const chunks = [];
  for (const [section, title, value] of sections) {
    const text = normalizeWhitespace(flattenText(value));
    if (!text) continue;
    for (const [partIndex, partText] of splitText(text, 1800).entries()) {
      chunks.push({
        id: `${meta.id}:${section}:${partIndex + 1}`,
        type: "precedent",
        section,
        title: `${meta.caseName || meta.title || meta.id} - ${title}`,
        precedentId: meta.id,
        caseName: meta.caseName,
        caseNo: meta.caseNo,
        courtName: meta.courtName,
        decisionDate: meta.decisionDate,
        decisionType: meta.decisionType,
        text: partText,
        sourceFile: meta.detailFile,
      });
    }
  }

  if (chunks.length) return chunks;

  const fallbackText = normalizeWhitespace(flattenText(data));
  if (fallbackText) {
    return splitText(fallbackText, 1800).map((text, index) => ({
      id: `${meta.id}:document:${index + 1}`,
      type: "precedent",
      section: "document",
      title: meta.caseName || meta.title || meta.id,
      precedentId: meta.id,
      caseName: meta.caseName,
      caseNo: meta.caseNo,
      courtName: meta.courtName,
      decisionDate: meta.decisionDate,
      decisionType: meta.decisionType,
      text,
      sourceFile: meta.detailFile,
    }));
  }

  return [buildMetaChunk(meta)];
}

function buildMetaChunk(meta) {
  return {
    id: `${meta.id}:meta`,
    type: "precedent",
    section: "meta",
    title: meta.caseName || meta.title || meta.id,
    precedentId: meta.id,
    caseName: meta.caseName,
    caseNo: meta.caseNo,
    courtName: meta.courtName,
    decisionDate: meta.decisionDate,
    decisionType: meta.decisionType,
    text: [meta.caseName, meta.caseNo, meta.courtName, meta.decisionDate, meta.decisionType, meta.caseType].filter(Boolean).join(" "),
    sourceFile: meta.detailFile,
  };
}

function extractPrecedentList(json) {
  const arrays = [];
  walk(json, (value) => {
    if (!Array.isArray(value)) return;
    const score = value.filter((item) => item && typeof item === "object" && looksLikePrecedent(item)).length;
    if (score > 0) arrays.push({ score, value });
  });
  arrays.sort((a, b) => b.score - a.score);
  if (arrays[0]) return arrays[0].value;

  const single = findObject(json, looksLikePrecedent);
  return single ? [single] : [];
}

function looksLikePrecedent(item) {
  return Boolean(
    getByKeyPart(item, ["판례일련번호", "판례ID", "precSeq", "ID"]) &&
      (getByKeyPart(item, ["사건명", "판례명", "caseName", "LM"]) || getByKeyPart(item, ["사건번호", "caseNo"]))
  );
}

function normalizePrecedentMeta(item) {
  const id = stringValue(getByKeyPart(item, ["판례일련번호", "판례ID", "precSeq", "ID"]));
  const caseName = stringValue(getByKeyPart(item, ["사건명", "판례명", "LM", "caseName"]));
  const caseNo = stringValue(getByKeyPart(item, ["사건번호", "caseNo"]));
  const courtName = stringValue(getByKeyPart(item, ["법원명", "courtName"]));
  const decisionDate = normalizeDate(stringValue(getByKeyPart(item, ["선고일자", "선고일", "decisionDate"])));
  const decisionType = stringValue(getByKeyPart(item, ["판결유형", "선고", "decisionType"]));
  const caseType = stringValue(getByKeyPart(item, ["사건종류명", "caseType"]));
  const detailLink = redactUrlLike(stringValue(getByKeyPart(item, ["판례상세링크", "상세링크", "detailLink"])));

  return {
    id,
    caseName,
    caseNo,
    courtName,
    decisionDate,
    decisionType,
    caseType,
    detailLink,
  };
}

function comparePrecedents(a, b) {
  const byDate = String(b.decisionDate || "").localeCompare(String(a.decisionDate || ""));
  if (byDate) return byDate;
  return String(a.caseName || a.id).localeCompare(String(b.caseName || b.id), "ko");
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
  for (const part of keyParts) {
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
      "User-Agent": "local-ai-precedent-sync/0.1",
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

function displayPrecedent(meta) {
  return `${meta.caseName || "(no case name)"} ${meta.caseNo ? `(${meta.caseNo})` : ""} [${meta.id}]`;
}

function redactOc(url) {
  const parsed = new URL(url);
  if (parsed.searchParams.has("OC")) parsed.searchParams.set("OC", "REDACTED");
  return parsed.toString();
}

function redactUrlLike(value) {
  return String(value || "").replace(/([?&]OC=)[^&]*/i, "$1REDACTED");
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
  for (const secret of [process.env.PRECEDENT_OC, process.env.LAW_OC].filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text;
}
