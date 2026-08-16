#!/usr/bin/env node
"use strict";

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");
const {
  TARGETS,
  getStatus,
  searchLegalCenter,
  getLegalCenter,
  safeError,
} = require("./api-client.cjs");

const targetSchema = z.enum(Object.keys(TARGETS));
const server = new McpServer({ name: "heyu-law-center-live-mcp", version: "1.0.0" });

server.registerTool("legal_search", {
  title: "국가법령정보센터 실시간 검색",
  description: "국가법령정보센터 공동활용 Open API에서 법령·판례·해석례·심판례·행정규칙·헌재결정례를 실시간 검색합니다. 검색어는 외부 API로 전송됩니다.",
  inputSchema: {
    query: z.string().trim().min(1).max(120).describe("개인정보가 아닌 법령명 또는 일반 법률 검색어"),
    target: targetSchema.describe("law 법령, prec 판례, expc 법령해석례, decc 행정심판례, admrul 행정규칙, detc 헌재결정례"),
    search: z.enum(["name", "body"]).optional().describe("name 제목 검색(기본), body 본문 검색"),
    limit: z.number().int().min(1).max(20).optional().describe("반환 건수(기본 10, 최대 20)"),
    page: z.number().int().min(1).max(10000).optional().describe("결과 페이지(기본 1)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
}, async (input) => {
  try {
    const result = await searchLegalCenter(input);
    return {
      content: [{ type: "text", text: formatSearchText(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
});

server.registerTool("law_get", {
  title: "국가법령정보센터 실시간 본문 조회",
  description: "검색 결과의 id, mst, lid 중 정확히 하나로 국가법령정보센터 본문을 조회합니다. 선택적으로 법령 조문만 추출할 수 있습니다.",
  inputSchema: {
    target: targetSchema,
    id: z.string().trim().min(1).max(120).optional().describe("본문 조회 일련번호"),
    mst: z.string().trim().min(1).max(120).optional().describe("법령 일련번호(MST)"),
    lid: z.string().trim().min(1).max(120).optional().describe("법령 또는 행정규칙 ID(LID)"),
    articleNo: z.string().trim().min(1).max(40).optional().describe("선택 조문 번호. 예: 1, 제1조, 1의2"),
    keywords: z.string().trim().min(1).max(120).optional().describe("본문 응답에서 관련 구간을 찾을 개인정보 없는 법률 쟁점 구문. 여러 구문은 | 로 구분"),
    maxChars: z.number().int().min(1000).max(30000).optional().describe("본문 최대 글자 수(기본 12000, 최대 30000)"),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
}, async (input) => {
  try {
    const result = await getLegalCenter(input);
    return {
      content: [{ type: "text", text: formatDetailText(result) }],
      structuredContent: result,
    };
  } catch (error) {
    return toolError(error);
  }
});

server.registerResource("law-center-status", "law-center://status", {
  title: "국가법령정보센터 실시간 MCP 상태",
  description: "OC 설정 여부와 외부 전송·응답 제한을 보여 줍니다. 인증값 자체는 노출하지 않습니다.",
  mimeType: "application/json",
}, async (uri) => ({
  contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(getStatus(), null, 2) }],
}));

server.registerPrompt("law-center-grounded-answer", {
  title: "국가법령정보센터 근거 답변",
  description: "실시간 검색과 본문 조회 결과만 근거로 사용하고 확인 한계를 표시하는 법률 조사 절차입니다.",
  argsSchema: {
    question: z.string().trim().min(1).max(1000).describe("법률 조사 질문. 개인정보나 비밀정보를 넣지 마세요."),
  },
}, ({ question }) => ({
  messages: [{
    role: "user",
    content: {
      type: "text",
      text: [
        "아래 질문에 답하기 전에 legal_search로 관련 자료를 찾고, 선택한 결과를 law_get으로 확인하세요.",
        "답변에는 자료 유형·제목·사건번호 또는 식별자·기준일을 적고, 조회 본문에 없는 내용은 추정이라고 표시하세요.",
        "검색어에 개인정보나 비밀정보를 넣지 말고, 법률 자문이나 최종 판단을 대신한다고 표현하지 마세요.",
        "",
        question,
      ].join("\n"),
    },
  }],
}));

function formatSearchText(result) {
  const lines = [
    `국가법령정보센터 실시간 검색: ${result.targetLabel}`,
    `검색어: ${result.query}`,
    `검색 범위: ${result.search === "body" ? "본문" : "제목"}`,
    `조회 시각: ${result.retrievedAt}`,
    `전체 ${result.total ?? "확인 불가"}건 중 ${result.returned}건 반환 (페이지 ${result.page})`,
  ];
  for (const [index, item] of result.items.entries()) {
    const identifiers = [item.id && `id=${item.id}`, item.mst && `mst=${item.mst}`, item.lid && `lid=${item.lid}`].filter(Boolean).join(", ");
    lines.push(`${index + 1}. ${item.title || "제목 없음"}${item.number ? ` · ${item.number}` : ""}${item.date ? ` · ${item.date}` : ""}${identifiers ? ` · ${identifiers}` : ""}`);
  }
  lines.push("출처: 국가법령정보센터 공동활용 Open API (실시간 조회)");
  return lines.join("\n");
}

function formatDetailText(result) {
  const lines = [
    `국가법령정보센터 실시간 본문: ${result.targetLabel}`,
    `제목: ${result.title || "확인 불가"}`,
    `식별자: ${result.selector.type}=${result.selector.value}`,
    `조회 시각: ${result.retrievedAt}`,
  ];
  if (result.number) lines.push(`번호: ${result.number}`);
  if (result.date) lines.push(`기준일: ${result.date}`);
  if (result.articleNo) lines.push(`요청 조문: ${result.articleNo} (${result.articleFound ? "확인됨" : "찾지 못함"})`);
  if (result.keywords) lines.push(`본문 쟁점어: ${result.keywords} (${result.keywordFound ? "관련 구간 확인됨" : "관련 구간 찾지 못함"})`);
  lines.push("", result.text || "반환할 본문이 없습니다.");
  if (result.truncated) lines.push("", `[본문이 ${result.maxChars}자로 잘렸습니다.]`);
  lines.push("", "출처: 국가법령정보센터 공동활용 Open API (실시간 조회)");
  return lines.join("\n");
}

function toolError(error) {
  const safe = safeError(error);
  return {
    isError: true,
    content: [{ type: "text", text: `법령 MCP 요청 실패: ${safe.message} (${safe.code})` }],
    structuredContent: { ok: false, error: safe },
  };
}

async function main() {
  await server.connect(new StdioServerTransport());
}

main().catch((error) => {
  const safe = safeError(error);
  process.stderr.write(`[mcp-law-center] 서버 시작 실패: ${safe.message} (${safe.code})\n`);
  process.exitCode = 1;
});
