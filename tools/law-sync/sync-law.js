#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do";
const SERVICE_URL = "https://www.law.go.kr/DRF/lawService.do";

function parseArgs(argv) {
  const args = {
    oc: process.env.LAW_OC || "",
    out: process.env.LAW_OUT || "data/law",
    queries: parseList(process.env.LAW_QUERIES || process.env.LAW_QUERY || ""),
    display: Number(process.env.LAW_DISPLAY || 100),
    maxPages: Number(process.env.LAW_MAX_PAGES || 1),
    delayMs: Number(process.env.LAW_DELAY_MS || 250),
    target: "law",
    detailTarget: "law",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--oc") throw new Error("--oc is disabled. Set LAW_OC in the environment.");
    else if (arg === "--out") args.out = next, i += 1;
    else if (arg === "--query") args.queries.push(next || ""), i += 1;
    else if (arg === "--queries") args.queries.push(...parseList(next || "")), i += 1;
    else if (arg === "--display") args.display = Number(next), i += 1;
    else if (arg === "--max-pages") args.maxPages = Number(next), i += 1;
    else if (arg === "--delay-ms") args.delayMs = Number(next), i += 1;
    else if (arg === "--target") args.target = next, i += 1;
    else if (arg === "--detail-target") args.detailTarget = next, i += 1;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.queries.length === 0) args.queries.push("");
  args.display = clampNumber(args.display, 1, 100, 100);
  args.maxPages = clampNumber(args.maxPages, 1, 100000, 1);
  args.delayMs = clampNumber(args.delayMs, 0, 60000, 250);
  return args;
}

function clampNumber(value, min, max, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

function printHelp() {
  console.log(`
Law Open API sync

Usage:
  $env:LAW_OC="YOUR_OC"; $env:LAW_QUERIES="민법,행정기본법"; npm run law:sync
  $env:LAW_OC="YOUR_OC"; npm run law:sync -- --query "민법" --out data/law
  npm run law:sync -- --queries "행정기본법,민원 처리에 관한 법률" --max-pages 2

Options:
  LAW_OC           법제처 Open API 인증값은 환경변수로만 입력
  --query          법령명 검색어. 여러 번 지정 가능. 없으면 LAW_QUERY 사용
  --queries        콤마로 구분한 법령명 검색어 목록. 없으면 LAW_QUERIES 사용
  --out            출력 폴더. 기본 data/law
  --display        페이지당 목록 수. 기본/최대 100
  --max-pages      검색어당 최대 페이지 수. 기본 1
  --delay-ms       API 호출 사이 대기 시간. 기본 250

Output:
  index.json              법령 메타데이터 목록
  search-index.jsonl      로컬 검색/RAG용 텍스트 청크
  laws/*.json             법령 본문 원본 JSON
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
    throw new Error("Missing OC. Set LAW_OC in the environment.");
  }

  const outDir = path.resolve(args.out);
  const lawsDir = path.join(outDir, "laws");
  fs.mkdirSync(lawsDir, { recursive: true });

  const seen = new Map();
  for (const query of args.queries) {
    for (let page = 1; page <= args.maxPages; page += 1) {
      const url = buildUrl(SEARCH_URL, {
        OC: args.oc,
        target: args.target,
        type: "JSON",
        display: String(args.display),
        page: String(page),
        ...(query ? { query } : {}),
      });
      console.log(`[search] query="${query || "(all)"}" page=${page}`);
      const json = await fetchJson(url);
      assertApiOk(json);
      const items = extractLawList(json);
      if (items.length === 0) break;
      for (const item of items) {
        const meta = normalizeLawMeta(item);
        if (!meta.key) continue;
        seen.set(meta.key, { ...seen.get(meta.key), ...meta });
      }
      if (items.length < args.display) break;
      await sleep(args.delayMs);
    }
  }

  const metas = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  const index = [];
  const chunks = [];

  for (const [idx, meta] of metas.entries()) {
    const detailFile = `${safeFileName(meta.key)}.json`;
    const detailPath = path.join(lawsDir, detailFile);
    let detail;

    if (fs.existsSync(detailPath)) {
      console.log(`[cached] ${idx + 1}/${metas.length} ${meta.name} (${meta.id || meta.mst})`);
      detail = JSON.parse(fs.readFileSync(detailPath, "utf8"));
    } else {
      console.log(`[detail] ${idx + 1}/${metas.length} ${meta.name} (${meta.id || meta.mst})`);
      const detailUrl = buildUrl(SERVICE_URL, {
        OC: args.oc,
        target: args.detailTarget,
        type: "JSON",
        ...(meta.id ? { ID: meta.id } : { MST: meta.mst }),
      });
      detail = await fetchJson(detailUrl);
      assertApiOk(detail);
      fs.writeFileSync(detailPath, JSON.stringify(detail, null, 2), "utf8");
      await sleep(args.delayMs);
    }

    const normalized = {
      ...meta,
      detailFile: path.join("laws", detailFile).replaceAll("\\", "/"),
      syncedAt: new Date().toISOString(),
    };
    index.push(normalized);

    for (const chunk of buildChunks(normalized, detail)) {
      chunks.push(JSON.stringify(chunk));
    }

    if ((idx + 1) % 100 === 0) {
      writeOutputs(outDir, index, chunks, {
        source: "법제처 국가법령정보 공동활용 Open API",
        searchUrl: SEARCH_URL,
        serviceUrl: SERVICE_URL,
        syncedAt: new Date().toISOString(),
        target: args.target,
        detailTarget: args.detailTarget,
        queries: args.queries,
        lawCount: index.length,
        chunkCount: chunks.length,
        status: "partial",
      });
    }
  }

  const manifest = {
    source: "법제처 국가법령정보 공동활용 Open API",
    searchUrl: SEARCH_URL,
    serviceUrl: SERVICE_URL,
    syncedAt: new Date().toISOString(),
    target: args.target,
    detailTarget: args.detailTarget,
    queries: args.queries,
    lawCount: index.length,
    chunkCount: chunks.length,
  };

  writeOutputs(outDir, index, chunks, manifest);
  console.log(`[done] laws=${index.length} chunks=${chunks.length} out=${outDir}`);
}

function writeOutputs(outDir, index, chunks, manifest) {
  fs.writeFileSync(path.join(outDir, "index.json"), JSON.stringify(index, null, 2), "utf8");
  fs.writeFileSync(path.join(outDir, "search-index.jsonl"), chunks.join("\n") + (chunks.length ? "\n" : ""), "utf8");
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
}

function buildUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  }
  return url.toString();
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json,text/plain,*/*",
      "User-Agent": "local-ai-law-sync/0.1",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON from API: ${text.slice(0, 300)}`);
  }
}

function assertApiOk(json) {
  if (!json || typeof json !== "object") return;
  const result = getAny(json, ["result", "RESULT", "결과"]);
  const message = getAny(json, ["msg", "message", "MSG", "메시지"]);
  if (result && String(result).includes("실패")) {
    throw new Error(`Law API rejected request: ${message || result}`);
  }
  if (message && String(message).includes("사용자 정보 검증에 실패")) {
    throw new Error(`Law API rejected request: ${message}`);
  }
}

function extractLawList(json) {
  const candidates = [];
  walk(json, (value, key) => {
    if (Array.isArray(value)) {
      const score = value.filter((item) => item && typeof item === "object" && (item.법령ID || item.법령일련번호 || item.법령명한글)).length;
      if (score > 0) candidates.push({ score, value, key });
    }
  });
  candidates.sort((a, b) => b.score - a.score);
  if (candidates[0]) return candidates[0].value;

  const single = findObject(json, (obj) => obj.법령ID || obj.법령일련번호 || obj.법령명한글);
  return single ? [single] : [];
}

function normalizeLawMeta(item) {
  const id = stringValue(item.법령ID || item.ID || item.LID);
  const mst = stringValue(item.법령일련번호 || item.MST || item.lsiSeq);
  const name = stringValue(item.법령명한글 || item.법령명 || item.name || item.lawName);
  const key = id || mst || safeFileName(name);
  return {
    key,
    id,
    mst,
    name,
    shortName: stringValue(item.법령약칭명),
    ministry: stringValue(item.소관부처명),
    ministryCode: stringValue(item.소관부처코드),
    lawType: stringValue(item.법령구분명),
    promulgationDate: stringValue(item.공포일자),
    enforcementDate: stringValue(item.시행일자),
    amendmentType: stringValue(item.제개정구분명),
    detailLink: redactUrlLike(stringValue(item.법령상세링크)),
  };
}

function buildChunks(meta, detail) {
  const articleChunks = [];
  collectArticleChunks(detail, articleChunks);
  if (articleChunks.length > 0) {
    return articleChunks.map((article, index) => ({
      id: `${meta.key}:${article.articleNo || index + 1}`,
      lawKey: meta.key,
      lawName: meta.name,
      articleNo: article.articleNo || "",
      title: article.title || meta.name,
      text: article.text,
      sourceFile: meta.detailFile,
    }));
  }

  const text = flattenText(detail).slice(0, 100000);
  return [
    {
      id: `${meta.key}:document`,
      lawKey: meta.key,
      lawName: meta.name,
      articleNo: "",
      title: meta.name,
      text,
      sourceFile: meta.detailFile,
    },
  ];
}

function collectArticleChunks(value, out) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectArticleChunks(item, out);
    return;
  }

  const articleText = firstValueByKeyPart(value, "조문내용") || firstValueByKeyPart(value, "조문본문");
  const paragraphText = firstValueByKeyPart(value, "항내용");
  if (articleText || paragraphText) {
    const articleNo = stringValue(firstValueByKeyPart(value, "조문번호") || firstValueByKeyPart(value, "조문가지번호"));
    const title = stringValue(firstValueByKeyPart(value, "조문제목"));
    const text = normalizeWhitespace(flattenText(value));
    if (text) out.push({ articleNo, title, text });
    return;
  }

  for (const child of Object.values(value)) collectArticleChunks(child, out);
}

function firstValueByKeyPart(obj, keyPart) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "";
  for (const [key, value] of Object.entries(obj)) {
    if (key.includes(keyPart)) return value;
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

function getAny(obj, keys) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) return obj[key];
  }
  return undefined;
}

function isLikelyMetadataOnly(key, text) {
  if (/상세링크|HTML|URL/i.test(key)) return true;
  if (/^https?:\/\//i.test(text)) return true;
  return false;
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, " ").trim();
}

function safeFileName(value) {
  return String(value || "unknown").replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").slice(0, 120);
}

function stringValue(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function redactUrlLike(value) {
  return String(value || "").replace(/([?&]OC=)[^&]*/i, "$1REDACTED");
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
  for (const secret of [process.env.LAW_OC].filter(Boolean)) text = text.split(secret).join("[REDACTED]");
  return text;
}
