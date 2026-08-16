const readline = require("readline");
const {
  buildAdminMcpContext,
  buildDocumentConverterMcpContext,
  buildEmpLocalContext,
  buildLanguageMcpContext,
  buildNoriMcpContext,
  buildReportMcpContext,
  buildTechnicalTranslatorMcpContext,
  buildTranslatorMcpContext,
} = require("../../app/main/local-data-tools.cjs");

const PROTOCOL_VERSION = "2024-11-05";

const TOOLS = [
  {
    name: "admin_law_search",
    description: "김행정이 사용할 회계, 계약, 서무, 여비, 물품, 기록물, 정보공개 실무 법령ㆍ예규 우선 검색 도구",
    handler: ({ query }) => buildAdminMcpContext(query),
  },
  {
    name: "emp_search",
    description: "로컬 EMP/HEMP/IEMI 표준, 가이드, 표/그림 근거 검색 도구",
    handler: ({ query }) => buildEmpLocalContext(query),
  },
  {
    name: "translator_context",
    description: "김국어가 사용할 기존 한국어본 우선 확인, 용어 일관성, 번역 초안 경고 도구",
    handler: ({ query }) => buildTranslatorMcpContext(query),
  },
  {
    name: "technical_translation_context",
    description: "기술외국어번역, EMP/EMC/표준 용어, 일반 번역 컨텍스트 결합 도구",
    handler: ({ query }) => buildTechnicalTranslatorMcpContext(query),
  },
  {
    name: "document_to_json_context",
    description: "문서 to JSON 변환 모드, 스키마, 검수 기준 안내 도구",
    handler: ({ query }) => buildDocumentConverterMcpContext(query),
  },
  {
    name: "language_context",
    description: "김언심이 사용할 공무원식 문장 정리 규칙 도구",
    handler: () => buildLanguageMcpContext(),
  },
  {
    name: "report_context",
    description: "개조식 보고서 양식과 작성 규칙 도구",
    handler: () => buildReportMcpContext(),
  },
  {
    name: "nori_context",
    description: "김노리가 사용할 수다지원 말투와 담당 연결 규칙 도구",
    handler: () => buildNoriMcpContext(),
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

function toolSchema(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "사용자 질문 또는 요청 원문",
        },
        contactId: {
          type: "string",
          description: "담당 AI 식별자",
        },
      },
      required: ["query"],
      additionalProperties: true,
    },
  };
}

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function writeResult(id, result) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result,
  });
}

function writeError(id, code, message, data) {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
      ...(data ? { data } : {}),
    },
  });
}

async function handleRequest(message) {
  const { id, method, params } = message;

  if (method === "notifications/initialized") return;

  if (method === "initialize") {
    writeResult(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: {
        name: "local-ai-office-mcp",
        version: "0.1.0",
      },
    });
    return;
  }

  if (method === "ping") {
    writeResult(id, {});
    return;
  }

  if (method === "tools/list") {
    writeResult(id, {
      tools: TOOLS.map(toolSchema),
    });
    return;
  }

  if (method === "tools/call") {
    const toolName = params?.name;
    const tool = TOOL_MAP.get(toolName);
    if (!tool) {
      writeError(id, -32602, `Unknown tool: ${toolName || ""}`);
      return;
    }

    try {
      const args = params?.arguments || {};
      const text = await tool.handler(args);
      writeResult(id, {
        content: [
          {
            type: "text",
            text: String(text || ""),
          },
        ],
        isError: false,
      });
    } catch (error) {
      writeResult(id, {
        content: [
          {
            type: "text",
            text: `MCP 도구 실행 실패: ${error?.message || "알 수 없는 오류"}`,
          },
        ],
        isError: true,
      });
    }
    return;
  }

  if (id === undefined || id === null) return;
  writeError(id, -32601, `Method not found: ${method || ""}`);
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch (error) {
    writeError(null, -32700, "Parse error", error?.message);
    return;
  }

  handleRequest(message).catch((error) => {
    if (message?.id === undefined || message?.id === null) return;
    writeError(message.id, -32603, "Internal error", error?.message);
  });
});
