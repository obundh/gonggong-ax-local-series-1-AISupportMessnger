const readline = require("readline");
const { buildLegalLocalContext, searchLegalEvidence } = require("../../app/main/local-data-tools.cjs");

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_INFO = {
  name: "heyu-kim-beomryul-mcp",
  version: "0.1.0",
};

const TOOLS = [
  {
    name: "legal_search",
    description: "Search Heyu local law, precedent, legal interpretation, administrative tribunal, administrative rule, and tax decision evidence for Kim Beomryul.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "User question or search query.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async ({ query }) => buildLegalLocalContext(String(query || "")),
  },
  {
    name: "legal_evidence_json",
    description: "Return structured Heyu local legal evidence records for Kim Beomryul.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "User question or search query.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
    handler: async ({ query }) => JSON.stringify(await searchLegalEvidence(String(query || "")), null, 2),
  },
];

const TOOL_MAP = new Map(TOOLS.map((tool) => [tool.name, tool]));

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

function listTool(tool) {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  };
}

async function handleRequest(message) {
  const { id, method, params } = message || {};

  if (method === "notifications/initialized") return;

  if (method === "initialize") {
    writeResult(id, {
      protocolVersion: params?.protocolVersion || PROTOCOL_VERSION,
      capabilities: {
        tools: {},
      },
      serverInfo: SERVER_INFO,
    });
    return;
  }

  if (method === "ping") {
    writeResult(id, {});
    return;
  }

  if (method === "tools/list") {
    writeResult(id, {
      tools: TOOLS.map(listTool),
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
            text: `MCP tool failed: ${error?.message || String(error)}`,
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
