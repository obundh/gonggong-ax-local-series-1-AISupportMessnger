"use strict";

const SEARCH_ENDPOINT = "https://www.law.go.kr/DRF/lawSearch.do";
const DETAIL_ENDPOINT = "https://www.law.go.kr/DRF/lawService.do";
const SOURCE_HOME = "https://www.law.go.kr";
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_INTERVAL_MS = 250;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const DEFAULT_DETAIL_CHARS = 12_000;
const MAX_DETAIL_CHARS = 30_000;

const TARGETS = Object.freeze({
  law: {
    label: "법령",
    idKeys: ["법령ID", "ID"],
    mstKeys: ["법령일련번호", "MST", "lsiSeq"],
    lidKeys: ["LID"],
    titleKeys: ["법령명한글", "법령명", "lawName", "name"],
    numberKeys: ["공포번호", "법령번호"],
    dateKeys: ["시행일자", "공포일자"],
    organizationKeys: ["소관부처명", "소관기관명"],
    categoryKeys: ["법령구분명", "제개정구분명"],
  },
  prec: {
    label: "판례",
    idKeys: ["판례일련번호", "판례ID", "precSeq", "ID"],
    mstKeys: ["MST"],
    lidKeys: ["LID"],
    titleKeys: ["사건명", "판례명", "caseName", "LM"],
    numberKeys: ["사건번호", "caseNo"],
    dateKeys: ["선고일자", "선고일", "decisionDate"],
    organizationKeys: ["법원명", "courtName"],
    categoryKeys: ["판결유형", "사건종류명", "decisionType"],
  },
  expc: {
    label: "법령해석례",
    idKeys: ["법령해석례일련번호", "해석례일련번호", "expcSeq", "ID"],
    mstKeys: ["MST"],
    lidKeys: ["LID"],
    titleKeys: ["안건명", "법령해석례명", "사건명", "LM"],
    numberKeys: ["안건번호", "사건번호", "itmno"],
    dateKeys: ["회신일자", "해석일자", "등록일자"],
    organizationKeys: ["질의기관명", "회신기관명"],
    categoryKeys: ["회신기관명"],
  },
  decc: {
    label: "행정심판례",
    idKeys: ["행정심판례일련번호", "재결례일련번호", "deccSeq", "ID"],
    mstKeys: ["MST"],
    lidKeys: ["LID"],
    titleKeys: ["사건명", "행정심판례명", "재결례명", "LM"],
    numberKeys: ["사건번호"],
    dateKeys: ["의결일자", "재결일자", "처분일자"],
    organizationKeys: ["처분청", "재결청"],
    categoryKeys: ["재결례유형명", "재결구분명"],
  },
  admrul: {
    label: "행정규칙",
    idKeys: ["행정규칙일련번호", "admrulSeq", "ID"],
    mstKeys: ["MST"],
    lidKeys: ["행정규칙ID", "LID"],
    titleKeys: ["행정규칙명", "행정규칙제명", "LM"],
    numberKeys: ["발령번호"],
    dateKeys: ["시행일자", "발령일자", "생성일자"],
    organizationKeys: ["소관부처명"],
    categoryKeys: ["행정규칙종류", "행정규칙구분명", "현행연혁구분", "제개정구분명"],
  },
  detc: {
    label: "헌재결정례",
    idKeys: ["헌재결정례일련번호", "결정례일련번호", "detcSeq", "ID"],
    mstKeys: ["MST"],
    lidKeys: ["LID"],
    titleKeys: ["사건명", "헌재결정례명", "LM"],
    numberKeys: ["사건번호"],
    dateKeys: ["종국일자", "선고일자"],
    organizationKeys: ["재판부구분코드", "재판부"],
    categoryKeys: ["사건종류명"],
  },
});

class LawCenterError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "LawCenterError";
    this.code = code;
  }
}

let throttleTail = Promise.resolve();
let lastRequestStartedAt = 0;

function getStatus() {
  return {
    ok: true,
    configured: Boolean(readOc()),
    mode: "direct-live-api",
    source: "국가법령정보센터 공동활용 Open API",
    sourceHome: SOURCE_HOME,
    targets: Object.entries(TARGETS).map(([value, config]) => ({ value, label: config.label })),
    timeoutMs: REQUEST_TIMEOUT_MS,
    minRequestIntervalMs: MIN_REQUEST_INTERVAL_MS,
    maxResponseBytes: MAX_RESPONSE_BYTES,
    maxDetailChars: MAX_DETAIL_CHARS,
    credential: "LAW_OC 환경변수 전용",
    privacyNotice: "검색어와 조회 식별자는 국가법령정보센터로 전송됩니다. 개인정보나 비밀정보를 입력하지 마세요.",
  };
}

async function searchLegalCenter(input) {
  const target = requireTarget(input?.target);
  const query = assertSafeQuery(input?.query);
  const search = input?.search === "body" ? "body" : "name";
  const limit = clampInteger(input?.limit, 1, 20, 10);
  const page = clampInteger(input?.page, 1, 10_000, 1);
  const upstreamDisplay = search === "name" ? Math.max(limit, 20) : limit;

  const json = await requestJson(SEARCH_ENDPOINT, {
    target,
    type: "JSON",
    search: search === "body" ? "2" : "1",
    query,
    display: String(upstreamDisplay),
    page: String(page),
  });

  const config = TARGETS[target];
  const records = extractSearchRecords(json, config);
  const normalizedItems = records.map((record) => normalizeRecord(record, target, config));
  const items = (search === "name" ? rankTitleMatches(normalizedItems, query) : normalizedItems).slice(0, limit);
  const total = readNumberDeep(json, ["totalCnt", "총건수", "검색건수"]);

  return sanitizeOutput({
    ok: true,
    source: "국가법령정보센터 공동활용 Open API",
    sourceHome: SOURCE_HOME,
    live: true,
    retrievedAt: new Date().toISOString(),
    target,
    targetLabel: config.label,
    query,
    search,
    page,
    limit,
    total,
    returned: items.length,
    items,
  });
}

async function getLegalCenter(input) {
  const target = requireTarget(input?.target);
  const selector = requireExactlyOneSelector(input);
  const articleNo = cleanOptionalText(input?.articleNo, 40);
  const keywords = articleNo ? "" : cleanOptionalText(input?.keywords, 120);
  const maxChars = clampInteger(input?.maxChars, 1_000, MAX_DETAIL_CHARS, DEFAULT_DETAIL_CHARS);

  const json = await requestJson(DETAIL_ENDPOINT, {
    target,
    type: "JSON",
    [selector.param]: selector.value,
  });

  const config = TARGETS[target];
  const article = articleNo ? findArticle(json, articleNo) : null;
  const selectedData = articleNo ? article : json;
  const fullText = selectedData ? flattenText(selectedData) : "";
  const keywordExcerpt = keywords ? extractKeywordExcerpt(fullText, keywords, maxChars) : "";
  const text = (keywordExcerpt || fullText).slice(0, maxChars);

  return sanitizeOutput({
    ok: true,
    source: "국가법령정보센터 공동활용 Open API",
    sourceHome: SOURCE_HOME,
    live: true,
    retrievedAt: new Date().toISOString(),
    target,
    targetLabel: config.label,
    selector: { type: selector.name, value: selector.value },
    title: readStringDeep(json, config.titleKeys),
    number: readStringDeep(json, config.numberKeys),
    date: normalizeDate(readStringDeep(json, config.dateKeys)),
    organization: readStringDeep(json, config.organizationKeys),
    category: readStringDeep(json, config.categoryKeys),
    articleNo: articleNo || "",
    articleFound: articleNo ? Boolean(article) : null,
    keywords,
    keywordFound: keywords ? Boolean(keywordExcerpt) : null,
    text,
    textChars: text.length,
    truncated: Boolean(keywordExcerpt) || fullText.length > text.length,
    maxChars,
  });
}

function requireTarget(value) {
  const target = String(value || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(TARGETS, target)) {
    throw new LawCenterError("INVALID_TARGET", "지원하지 않는 자료 유형입니다.");
  }
  return target;
}

function assertSafeQuery(value) {
  const query = String(value || "").replace(/\s+/g, " ").trim();
  if (!query) throw new LawCenterError("INVALID_QUERY", "검색어를 입력하세요.");
  if (query.length > 120) throw new LawCenterError("INVALID_QUERY", "검색어는 120자 이하여야 합니다.");

  const sensitivePatterns = [
    /(?<!\d)\d{6}-?[1-8]\d{6}(?!\d)/,
    /(?<!\d)01[016789][-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/,
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
    /[A-Za-z]:[\\/]Users[\\/]/i,
    /\/(?:home|Users)\/[^/\s]+/i,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{16,}\b/i,
  ];
  if (sensitivePatterns.some((pattern) => pattern.test(query))) {
    throw new LawCenterError(
      "SENSITIVE_QUERY",
      "개인정보 또는 비밀정보로 보이는 검색어는 외부 API로 전송하지 않습니다. 법령명이나 일반 법률 용어만 입력하세요."
    );
  }
  return query;
}

function requireExactlyOneSelector(input) {
  const candidates = [
    ["id", "ID"],
    ["mst", "MST"],
    ["lid", "LID"],
  ].map(([name, param]) => ({ name, param, value: cleanOptionalText(input?.[name], 120) }))
    .filter((candidate) => candidate.value);

  if (candidates.length !== 1) {
    throw new LawCenterError("INVALID_SELECTOR", "id, mst, lid 중 정확히 하나만 입력하세요.");
  }
  if (!/^[A-Za-z0-9._-]+$/.test(candidates[0].value)) {
    throw new LawCenterError("INVALID_SELECTOR", "조회 식별자 형식이 올바르지 않습니다.");
  }
  return candidates[0];
}

async function requestJson(endpoint, params) {
  const oc = readOc();
  if (!oc) {
    throw new LawCenterError("MISSING_LAW_OC", "LAW_OC 환경변수가 설정되지 않았습니다.");
  }

  await acquireThrottleSlot();
  const url = new URL(endpoint);
  url.searchParams.set("OC", oc);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "heyu-law-center-mcp/1.0",
      },
    });
    if (!response.ok) {
      throw new LawCenterError("UPSTREAM_HTTP_ERROR", `국가법령정보센터 API 요청이 실패했습니다. (HTTP ${response.status})`);
    }
    const text = await readBoundedText(response, controller);
    let json;
    try {
      json = JSON.parse(text);
    } catch (_error) {
      throw new LawCenterError("UPSTREAM_INVALID_JSON", "국가법령정보센터가 올바른 JSON 응답을 반환하지 않았습니다.");
    }
    assertApiSuccess(json, oc);
    return json;
  } catch (error) {
    if (error instanceof LawCenterError) throw error;
    if (controller.signal.aborted || error?.name === "AbortError" || error?.name === "TimeoutError") {
      throw new LawCenterError("UPSTREAM_TIMEOUT", "국가법령정보센터 API 응답 시간이 15초를 초과했습니다.");
    }
    throw new LawCenterError("UPSTREAM_NETWORK_ERROR", "국가법령정보센터 API에 연결할 수 없습니다.");
  } finally {
    clearTimeout(timeout);
  }
}

async function readBoundedText(response, controller) {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    controller.abort();
    throw new LawCenterError("UPSTREAM_TOO_LARGE", "국가법령정보센터 응답이 허용 크기를 초과했습니다.");
  }
  if (!response.body?.getReader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new LawCenterError("UPSTREAM_TOO_LARGE", "국가법령정보센터 응답이 허용 크기를 초과했습니다.");
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      controller.abort();
      throw new LawCenterError("UPSTREAM_TOO_LARGE", "국가법령정보센터 응답이 허용 크기를 초과했습니다.");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function acquireThrottleSlot() {
  const turn = throttleTail.then(async () => {
    const waitMs = Math.max(0, lastRequestStartedAt + MIN_REQUEST_INTERVAL_MS - Date.now());
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
    lastRequestStartedAt = Date.now();
  });
  throttleTail = turn.catch(() => {});
  await turn;
}

function assertApiSuccess(json, oc) {
  if (!json || typeof json !== "object") return;
  const result = cleanOptionalText(readStringDeep(json, ["result", "RESULT", "결과"]), 200);
  const message = cleanOptionalText(readStringDeep(json, ["msg", "message", "MSG", "메시지"]), 300);
  const combined = `${result} ${message}`.trim();
  if (/실패|오류|error|invalid|검증/i.test(combined)) {
    const safeMessage = redactSensitive(combined, oc).slice(0, 300);
    throw new LawCenterError("UPSTREAM_REJECTED", safeMessage || "국가법령정보센터가 요청을 거부했습니다.");
  }
}

function extractSearchRecords(json, config) {
  const arrays = [];
  walk(json, (value) => {
    if (!Array.isArray(value)) return;
    const score = value.filter((item) => isRecord(item, config)).length;
    if (score > 0) arrays.push({ score, value });
  });
  arrays.sort((a, b) => b.score - a.score);
  if (arrays[0]) return arrays[0].value.filter((item) => isRecord(item, config));

  const objects = [];
  walk(json, (value) => {
    if (isRecord(value, config)) objects.push(value);
  });
  return objects;
}

function isRecord(value, config) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && getByKeyPart(value, config.titleKeys));
}

function normalizeRecord(record, target, config) {
  return {
    target,
    id: cleanOptionalText(getByKeyPart(record, config.idKeys), 120),
    mst: cleanOptionalText(getByKeyPart(record, config.mstKeys), 120),
    lid: cleanOptionalText(getByKeyPart(record, config.lidKeys), 120),
    title: cleanOptionalText(getByKeyPart(record, config.titleKeys), 500),
    number: cleanOptionalText(getByKeyPart(record, config.numberKeys), 200),
    date: normalizeDate(cleanOptionalText(getByKeyPart(record, config.dateKeys), 40)),
    organization: cleanOptionalText(getByKeyPart(record, config.organizationKeys), 300),
    category: cleanOptionalText(getByKeyPart(record, config.categoryKeys), 300),
  };
}

function rankTitleMatches(items, query) {
  const needle = String(query || "").replace(/\s+/g, "").toLowerCase();
  return items
    .map((item, index) => {
      const title = String(item.title || "").replace(/\s+/g, "").toLowerCase();
      const score = title === needle ? 300 : title.startsWith(needle) ? 200 : title.includes(needle) ? 100 : 0;
      return { item, index, score };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}

function findArticle(value, requestedArticleNo) {
  let found = null;
  let bestScore = -1;
  walk(value, (node) => {
    if (!node || typeof node !== "object" || Array.isArray(node)) return;
    const articleNo = cleanOptionalText(getByKeyPart(node, ["조문번호"]), 40);
    const branchNo = cleanOptionalText(getByKeyPart(node, ["조문가지번호"]), 20);
    if (!articleNo || !articleNumberMatches(articleNo, branchNo, requestedArticleNo)) return;

    const kind = cleanOptionalText(getByKeyPart(node, ["조문여부"]), 40);
    const title = cleanOptionalText(getByKeyPart(node, ["조문제목"]), 200);
    const content = cleanOptionalText(getByKeyPart(node, ["조문내용"]), 2000);
    const score =
      (kind === "조문" ? 200 : 0) +
      (title ? 80 : 0) +
      (/^제\s*\d+/.test(content) ? 40 : 0) +
      Math.min(content.length, 100);
    if (score > bestScore) {
      bestScore = score;
      found = node;
    }
  });
  return found;
}

function articleNumberMatches(articleNo, branchNo, requested) {
  const desired = canonicalArticleNo(requested);
  const raw = canonicalArticleNo(articleNo);
  const branch = String(branchNo || "").replace(/\D/g, "").replace(/^0+/, "");
  const variants = new Set([raw]);
  const digits = String(articleNo || "").replace(/\D/g, "");
  if (digits) {
    variants.add(String(Number(digits)));
    if (/^\d{4,}00$/.test(digits)) variants.add(String(Number(digits) / 100));
  }
  if (branch && branch !== "0") {
    for (const variant of [...variants]) variants.add(`${variant}-${Number(branch)}`);
  }
  return variants.has(desired);
}

function canonicalArticleNo(value) {
  return String(value || "")
    .trim()
    .replace(/^제/, "")
    .replace(/조$/, "")
    .replace(/의/g, "-")
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "");
}

function flattenText(value) {
  const pieces = [];
  walk(value, (node, key) => {
    if (node === null || node === undefined) return;
    if (typeof node !== "string" && typeof node !== "number") return;
    if (/상세링크|파일링크|URL|url|HTML/i.test(String(key))) return;
    const text = String(node).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    if (!text || /^https?:\/\//i.test(text)) return;
    if (!pieces.includes(text)) pieces.push(text);
  });
  return pieces.join("\n");
}

function extractKeywordExcerpt(value, keywords, maxChars) {
  const text = String(value || "");
  const terms = String(keywords || "")
    .split(/\s*\|\s*/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 2)
    .slice(0, 8);
  if (!text || !terms.length) return "";

  const lower = text.toLowerCase();
  const positions = [];
  for (const term of terms) {
    const needle = term.toLowerCase();
    let offset = 0;
    while (offset < lower.length && positions.length < 12) {
      const index = lower.indexOf(needle, offset);
      if (index < 0) break;
      positions.push(index);
      offset = index + Math.max(needle.length, 1);
    }
  }
  if (!positions.length) return "";

  const windows = [];
  for (const position of [...new Set(positions)].sort((a, b) => a - b)) {
    const start = Math.max(0, position - 900);
    const end = Math.min(text.length, position + 2100);
    const previous = windows.at(-1);
    if (previous && start <= previous.end) {
      previous.end = Math.max(previous.end, end);
    } else {
      windows.push({ start, end });
    }
  }

  const excerpts = [];
  let used = 0;
  for (const window of windows) {
    const excerpt = text.slice(window.start, window.end).trim();
    if (!excerpt) continue;
    const remaining = maxChars - used - (excerpts.length ? 5 : 0);
    if (remaining <= 0) break;
    excerpts.push(excerpt.slice(0, remaining));
    used += excerpts.at(-1).length;
  }
  return excerpts.join("\n...\n");
}

function readStringDeep(value, keyParts) {
  let found = "";
  walk(value, (node, key) => {
    if (found || node === null || node === undefined) return;
    if (!keyParts.some((part) => String(key) === part || String(key).includes(part))) return;
    if (typeof node === "string" || typeof node === "number") found = String(node);
  });
  return found;
}

function readNumberDeep(value, keyParts) {
  const raw = readStringDeep(value, keyParts);
  const parsed = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function getByKeyPart(object, keyParts) {
  if (!object || typeof object !== "object" || Array.isArray(object)) return "";
  const entries = Object.entries(object);
  for (const part of keyParts || []) {
    const exact = entries.find(([key]) => key === part);
    if (exact) return exact[1];
  }
  for (const part of keyParts || []) {
    const partial = entries.find(([key]) => key.includes(part));
    if (partial) return partial[1];
  }
  return "";
}

function walk(value, visitor, key = "") {
  visitor(value, key);
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor, key);
    return;
  }
  for (const [childKey, childValue] of Object.entries(value)) walk(childValue, visitor, childKey);
}

function sanitizeOutput(value) {
  if (Array.isArray(value)) return value.map(sanitizeOutput);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, sanitizeOutput(child)]));
  }
  return typeof value === "string" ? redactSensitive(value, readOc()) : value;
}

function safeError(error) {
  const code = error instanceof LawCenterError ? error.code : "INTERNAL_ERROR";
  const fallback = code === "INTERNAL_ERROR" ? "법령 MCP 처리 중 오류가 발생했습니다." : error?.message;
  return {
    code,
    message: redactSensitive(String(fallback || "법령 MCP 처리 중 오류가 발생했습니다."), readOc()).slice(0, 500),
  };
}

function redactSensitive(value, oc) {
  let text = String(value || "");
  if (oc) text = text.split(oc).join("[REDACTED]");
  return text
    .replace(/([?&]OC=)[^&\s"']*/gi, "$1[REDACTED]")
    .replace(/(OC%3D)[^&\s"']*/gi, "$1[REDACTED]")
    .replace(/(LAW_OC\s*[=:]\s*)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{16,}\b/gi, "[REDACTED]");
}

function cleanOptionalText(value, maxLength) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeDate(value) {
  return String(value || "").replace(/[^\d]/g, "").slice(0, 8);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function readOc() {
  return String(process.env.LAW_OC || "").trim();
}

module.exports = {
  TARGETS,
  getStatus,
  searchLegalCenter,
  getLegalCenter,
  safeError,
};
