const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { spawn } = require("child_process");
const { pathToFileURL } = require("url");

const ROOT_DIR = path.join(__dirname, "..", "..");
const WORKSPACE_DIR = process.env.HEYU_WORKSPACE_DIR || path.join(ROOT_DIR, "heyu_workspace");
const INDEX_DIR = path.join(WORKSPACE_DIR, "index");
const MARKDOWN_CACHE_DIR = path.join(INDEX_DIR, "markdown");
const CHUNKS_PATH = path.join(INDEX_DIR, "chunks.json");
const MANIFEST_PATH = path.join(INDEX_DIR, "manifest.json");
const REQUEST_TIMEOUT_MS = 15000;
const MARKITDOWN_TIMEOUT_MS = 60000;
const TEXT_EXTENSIONS = new Set([".txt", ".md", ".json", ".csv"]);
const MARKITDOWN_EXTENSIONS = new Set([".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".html", ".htm", ".xml"]);
const MARKITDOWN_MAX_BYTES = 40 * 1024 * 1024;
const INDEXABLE_FOLDERS = ["inbox", "knowledge", "outputs"];
const DEFAULT_FOLDERS = ["inbox", "outputs", "knowledge", "index", "qdrant", "temp"];

let filesystemClient = null;
let markitdownClient = null;

class StdioMcpClient {
  constructor({ command, args, cwd, env, timeoutMs }) {
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;
    this.timeoutMs = timeoutMs || REQUEST_TIMEOUT_MS;
    this.nextId = 1;
    this.pending = new Map();
    this.process = null;
    this.initialized = false;
    this.initializePromise = null;
    this.stderrTail = "";
  }

  async callTool(name, args) {
    await this.initialize();
    const result = await this.request("tools/call", {
      name,
      arguments: args || {},
    });
    const text = Array.isArray(result?.content)
      ? result.content
          .filter((item) => item?.type === "text")
          .map((item) => item.text || "")
          .join("\n")
      : "";
    if (result?.isError) throw new Error(text || `MCP tool failed: ${name}`);
    return text;
  }

  async listTools() {
    await this.initialize();
    const result = await this.request("tools/list", {});
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async initialize() {
    if (this.initialized) return;
    if (this.initializePromise) return this.initializePromise;

    this.initializePromise = (async () => {
      this.start();
      await this.request("initialize", {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: {
          name: "heyu-workspace",
          version: "0.1.0",
        },
      });
      this.notify("notifications/initialized", {});
      this.initialized = true;
    })();

    try {
      await this.initializePromise;
    } finally {
      this.initializePromise = null;
    }
  }

  start() {
    if (this.process && !this.process.killed) return;
    this.process = spawn(this.command, this.args, {
      cwd: this.cwd,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: this.env,
    });

    const rl = readline.createInterface({
      input: this.process.stdout,
      crlfDelay: Infinity,
    });

    rl.on("line", (line) => this.handleLine(line));
    this.process.stderr.on("data", (chunk) => {
      this.stderrTail = `${this.stderrTail}${chunk.toString("utf8")}`.slice(-2000);
    });
    this.process.once("error", (error) => {
      this.rejectAll(error);
      this.resetProcess();
    });
    this.process.once("exit", (code) => {
      this.rejectAll(new Error(`MCP server exited with code ${code ?? "unknown"}`));
      this.resetProcess();
    });
  }

  resetProcess() {
    this.process = null;
    this.initialized = false;
    this.initializePromise = null;
  }

  handleLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch (_error) {
      return;
    }
    if (message.id === undefined || message.id === null) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(new Error(message.error.message || "MCP request failed"));
      return;
    }
    pending.resolve(message.result);
  }

  request(method, params) {
    if (!this.process || this.process.killed) this.start();
    const id = this.nextId;
    this.nextId += 1;
    const payload = {
      jsonrpc: "2.0",
      id,
      method,
      params,
    };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timed out: ${method}${this.stderrTail ? ` / ${this.stderrTail}` : ""}`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.process.stdin.write(`${JSON.stringify(payload)}\n`, "utf8", (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      });
    });
  }

  notify(method, params) {
    if (!this.process || this.process.killed) this.start();
    this.process.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`, "utf8");
  }

  rejectAll(error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  shutdown() {
    this.rejectAll(new Error("MCP server shutting down"));
    if (this.process && !this.process.killed) this.process.kill();
    this.resetProcess();
  }
}

function ensureWorkspace() {
  for (const folder of DEFAULT_FOLDERS) {
    fs.mkdirSync(path.join(WORKSPACE_DIR, folder), { recursive: true });
  }
  fs.mkdirSync(MARKDOWN_CACHE_DIR, { recursive: true });
  if (!fs.existsSync(CHUNKS_PATH)) writeJson(CHUNKS_PATH, []);
  if (!fs.existsSync(MANIFEST_PATH)) writeJson(MANIFEST_PATH, { updatedAt: 0, files: [] });
  return WORKSPACE_DIR;
}

function resolveFilesystemServerPath() {
  const developmentPath = path.join(ROOT_DIR, "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js");
  const unpackedPath = path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "@modelcontextprotocol", "server-filesystem", "dist", "index.js");
  return fs.existsSync(unpackedPath) ? unpackedPath : developmentPath;
}

function getFilesystemClient() {
  ensureWorkspace();
  if (filesystemClient) return filesystemClient;
  filesystemClient = new StdioMcpClient({
    command: process.execPath,
    args: [resolveFilesystemServerPath(), WORKSPACE_DIR],
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
    },
  });
  return filesystemClient;
}

function resolveMarkItDownCommand() {
  return {
    command: process.env.HEYU_MARKITDOWN_MCP_COMMAND || "markitdown-mcp",
    args: process.env.HEYU_MARKITDOWN_MCP_ARGS ? process.env.HEYU_MARKITDOWN_MCP_ARGS.split(/\s+/).filter(Boolean) : [],
  };
}

function getMarkItDownClient() {
  ensureWorkspace();
  if (markitdownClient) return markitdownClient;
  const resolved = resolveMarkItDownCommand();
  markitdownClient = new StdioMcpClient({
    command: resolved.command,
    args: resolved.args,
    cwd: ROOT_DIR,
    env: {
      ...process.env,
    },
    timeoutMs: MARKITDOWN_TIMEOUT_MS,
  });
  return markitdownClient;
}

async function getWorkspaceStatus() {
  ensureWorkspace();
  const status = {
    root: WORKSPACE_DIR,
    filesystem: {
      ok: false,
      label: "Filesystem MCP 확인 전",
      allowedDirectories: [],
    },
    qdrant: {
      ok: false,
      label: "Qdrant MCP 미연결 · 로컬 인덱스 fallback 사용 중",
      collection: process.env.COLLECTION_NAME || "heyu-docs",
      localPath: path.join(WORKSPACE_DIR, "qdrant"),
    },
    markitdown: {
      ok: false,
      label: "MarkItDown MCP 확인 전",
      tool: "convert_to_markdown",
    },
    index: readIndexSummary(),
  };

  try {
    const text = await getFilesystemClient().callTool("list_allowed_directories", {});
    status.filesystem = {
      ok: true,
      label: "Filesystem MCP 연결됨",
      allowedDirectories: text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes(":\\") || line.startsWith("/")),
    };
  } catch (error) {
    status.filesystem = {
      ok: false,
      label: `Filesystem MCP 실패: ${error?.message || "알 수 없는 오류"}`,
      allowedDirectories: [WORKSPACE_DIR],
    };
  }

  try {
    const tools = await getMarkItDownClient().listTools();
    const hasConvertTool = tools.some((tool) => tool?.name === "convert_to_markdown");
    status.markitdown = {
      ok: hasConvertTool,
      label: hasConvertTool ? "MarkItDown MCP 연결됨" : "MarkItDown MCP 변환 도구 없음",
      tool: "convert_to_markdown",
    };
  } catch (error) {
    status.markitdown = {
      ok: false,
      label: `MarkItDown MCP 실패: ${error?.message || "알 수 없는 오류"}`,
      tool: "convert_to_markdown",
    };
  }

  return status;
}

async function getWorkspaceSnapshot() {
  ensureWorkspace();
  const status = await getWorkspaceStatus();
  return {
    status,
    folders: DEFAULT_FOLDERS.filter((folder) => folder !== "index" && folder !== "qdrant" && folder !== "temp").map((folder) => ({
      name: folder,
      label: workspaceFolderLabel(folder),
      files: listFolderFiles(folder),
    })),
  };
}

async function indexWorkspaceFiles() {
  ensureWorkspace();
  const chunks = [];
  const files = [];
  const skipped = [];

  for (const folder of INDEXABLE_FOLDERS) {
    for (const file of listFolderFiles(folder, { recursive: true })) {
      if (!isIndexableFile(file.absolutePath)) continue;
      let indexedFile;
      try {
        indexedFile = await readFileForIndex(file.absolutePath);
      } catch (error) {
        skipped.push({
          folder,
          name: file.name,
          relativePath: file.relativePath,
          error: error?.message || String(error),
        });
        continue;
      }
      const text = indexedFile.text || "";
      if (!text.trim()) continue;
      const fileChunks = splitTextIntoChunks(text, 900);
      files.push({
        folder,
        name: file.name,
        relativePath: file.relativePath,
        chunks: fileChunks.length,
        updatedAt: file.updatedAt,
        source: indexedFile.source,
        markdownPath: indexedFile.markdownPath || "",
      });
      fileChunks.forEach((chunk, index) => {
        chunks.push({
          id: `${file.relativePath}#${index}`,
          folder,
          fileName: file.name,
          relativePath: file.relativePath,
          chunkIndex: index,
          text: chunk,
          tokens: tokenize(chunk),
        });
      });
    }
  }

  writeJson(CHUNKS_PATH, chunks);
  writeJson(MANIFEST_PATH, {
    updatedAt: Date.now(),
    files,
    skipped,
  });

  return readIndexSummary();
}

async function buildWorkspaceMcpContext(query, options = {}) {
  ensureWorkspace();
  const results = findIndexedChunks(query, options.limit || 5);
  if (!results.length) return "";

  return [
    "자료 탭 MCP 검색 결과:",
    "- Filesystem MCP 허용 폴더의 로컬 자료 인덱스에서 검색한 후보입니다.",
    "- MarkItDown MCP로 변환 가능한 PDF, Office, HTML 자료는 마크다운으로 변환한 뒤 인덱싱합니다.",
    "- Qdrant MCP 서버가 붙기 전에는 로컬 인덱스 fallback 결과이며, 답변에서는 근거 후보로만 사용합니다.",
    ...results.map(
      (item, index) =>
        `${index + 1}. ${item.fileName} (${item.relativePath}, chunk ${item.chunkIndex + 1})\n${item.text.slice(0, 700)}`
    ),
  ].join("\n");
}

function findIndexedChunks(query, limit = 5) {
  const chunks = readJson(CHUNKS_PATH, []);
  const queryTokens = tokenize(query);
  if (!queryTokens.length || !chunks.length) return [];
  const querySet = new Set(queryTokens);
  return chunks
    .map((chunk) => {
      const tokens = Array.isArray(chunk.tokens) ? chunk.tokens : tokenize(chunk.text);
      const score = tokens.reduce((sum, token) => sum + (querySet.has(token) ? 1 : 0), 0);
      return { ...chunk, score };
    })
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath, "ko"))
    .slice(0, limit);
}

function saveWorkspaceOutputFile(fileName, bufferOrText) {
  ensureWorkspace();
  const safeName = sanitizeFileName(fileName || "output");
  const targetPath = uniquePath(path.join(WORKSPACE_DIR, "outputs", safeName));
  fs.writeFileSync(targetPath, bufferOrText);
  return {
    path: targetPath,
    relativePath: toWorkspaceRelativePath(targetPath),
    name: path.basename(targetPath),
  };
}

function listFolderFiles(folder, options = {}) {
  const root = path.join(WORKSPACE_DIR, folder);
  if (!fs.existsSync(root)) return [];
  const output = [];
  walkFolder(root, {
    recursive: Boolean(options.recursive),
    onFile(filePath) {
      const stat = fs.statSync(filePath);
      output.push({
        name: path.basename(filePath),
        folder,
        relativePath: toWorkspaceRelativePath(filePath),
        absolutePath: filePath,
        type: inferFileType(filePath),
        size: formatFileSize(stat.size),
        bytes: stat.size,
        updated: formatDate(stat.mtime),
        updatedAt: stat.mtimeMs,
        indexed: isIndexed(toWorkspaceRelativePath(filePath)),
      });
    },
  });
  return output.sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name, "ko"));
}

function walkFolder(root, { recursive, onFile }) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (recursive) walkFolder(fullPath, { recursive, onFile });
      continue;
    }
    if (entry.isFile()) onFile(fullPath);
  }
}

function isIndexed(relativePath) {
  const manifest = readJson(MANIFEST_PATH, { files: [] });
  return Array.isArray(manifest.files) && manifest.files.some((file) => file.relativePath === relativePath);
}

function readIndexSummary() {
  const manifest = readJson(MANIFEST_PATH, { updatedAt: 0, files: [] });
  const chunks = readJson(CHUNKS_PATH, []);
  return {
    updatedAt: manifest.updatedAt || 0,
    updated: manifest.updatedAt ? formatDate(new Date(manifest.updatedAt)) : "미실행",
    fileCount: Array.isArray(manifest.files) ? manifest.files.length : 0,
    chunkCount: Array.isArray(chunks) ? chunks.length : 0,
    skippedCount: Array.isArray(manifest.skipped) ? manifest.skipped.length : 0,
  };
}

function isIndexableFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || MARKITDOWN_EXTENSIONS.has(ext);
}

function isMarkItDownSupportedFile(filePath) {
  return MARKITDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function readFileForIndex(filePath) {
  if (TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    return {
      source: "text",
      text: readTextFile(filePath),
    };
  }

  if (!isMarkItDownSupportedFile(filePath)) {
    return {
      source: "unsupported",
      text: "",
    };
  }

  const text = await convertFileToMarkdown(filePath);
  return {
    source: "markitdown",
    text,
    markdownPath: toWorkspaceRelativePath(markdownCachePath(filePath)),
  };
}

function readTextFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > 5 * 1024 * 1024) return "";
  return fs.readFileSync(filePath, "utf8").replace(/\0/g, "");
}

async function convertFileToMarkdown(filePath) {
  const absolutePath = path.resolve(filePath);
  if (!isPathInsideWorkspace(absolutePath)) {
    throw new Error("workspace 밖 파일은 MarkItDown 변환 대상이 아닙니다.");
  }

  const stat = fs.statSync(absolutePath);
  if (stat.size > MARKITDOWN_MAX_BYTES) {
    throw new Error("MarkItDown 변환 제한보다 큰 파일입니다.");
  }

  const markdown = await getMarkItDownClient().callTool("convert_to_markdown", {
    uri: pathToFileURL(absolutePath).href,
  });
  const normalized = String(markdown || "").replace(/\0/g, "").trim();
  if (normalized) {
    const cachePath = markdownCachePath(absolutePath);
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, `${normalized}\n`, "utf8");
  }
  return normalized;
}

function markdownCachePath(filePath) {
  return path.join(MARKDOWN_CACHE_DIR, sanitizeFileName(`${toWorkspaceRelativePath(filePath)}.md`));
}

function isPathInsideWorkspace(filePath) {
  const relative = path.relative(WORKSPACE_DIR, filePath);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function splitTextIntoChunks(text, maxLength) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs.length ? paragraphs : [normalized]) {
    if ((current + "\n\n" + paragraph).trim().length > maxLength && current) {
      chunks.push(current.trim());
      current = "";
    }
    current = [current, paragraph].filter(Boolean).join("\n\n");
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.flatMap((chunk) => chunk.length <= maxLength * 1.4 ? [chunk] : hardSplit(chunk, maxLength)).slice(0, 80);
}

function hardSplit(text, maxLength) {
  const chunks = [];
  for (let index = 0; index < text.length; index += maxLength) {
    chunks.push(text.slice(index, index + maxLength));
  }
  return chunks;
}

function tokenize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .slice(0, 1200);
}

function toWorkspaceRelativePath(filePath) {
  return path.relative(WORKSPACE_DIR, filePath).replaceAll("\\", "/");
}

function inferFileType(filePath) {
  const ext = path.extname(String(filePath || "")).toLowerCase().replace(".", "");
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["xls", "xlsx", "csv"].includes(ext)) return "excel";
  if (ext === "pdf") return "pdf";
  if (["doc", "docx", "hwp", "hwpx"].includes(ext)) return "word";
  if (["txt", "md", "json"].includes(ext)) return "text";
  if (["png", "jpg", "jpeg", "gif", "bmp", "webp"].includes(ext)) return "image";
  return "file";
}

function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (size >= 1024 * 1024) return `${Math.round((size / 1024 / 1024) * 10) / 10}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(Number(value || 0));
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function workspaceFolderLabel(folder) {
  const labels = {
    inbox: "원본 자료",
    outputs: "산출물",
    knowledge: "기준 자료",
    temp: "임시",
  };
  return labels[folder] || folder;
}

function sanitizeFileName(value) {
  const parsed = path.parse(String(value || "output"));
  const base = (parsed.name || "output").replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, "_").slice(0, 80);
  const ext = parsed.ext || "";
  return `${base}${ext}`;
}

function uniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const parsed = path.parse(filePath);
  for (let index = 2; index < 1000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}_${index}${parsed.ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return path.join(parsed.dir, `${parsed.name}_${Date.now()}${parsed.ext}`);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_error) {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function shutdownWorkspaceMcp() {
  if (filesystemClient) {
    filesystemClient.shutdown();
    filesystemClient = null;
  }
  if (markitdownClient) {
    markitdownClient.shutdown();
    markitdownClient = null;
  }
}

module.exports = {
  WORKSPACE_DIR,
  buildWorkspaceMcpContext,
  ensureWorkspace,
  getWorkspaceSnapshot,
  getWorkspaceStatus,
  indexWorkspaceFiles,
  saveWorkspaceOutputFile,
  shutdownWorkspaceMcp,
};
