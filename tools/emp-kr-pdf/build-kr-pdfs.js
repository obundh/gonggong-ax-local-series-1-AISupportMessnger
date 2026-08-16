const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const DEFAULT_INPUT_DIR = path.join("data", "emp");
const DEFAULT_OUTPUT_DIR = path.join("data", "emp_kr_pdfs");
const DEFAULT_WORK_MANIFEST = path.join("data", "emp_pdf_translation", "manifest.json");
const DEFAULT_CACHE_FILE = path.join("data", "emp_pdf_translation", "translation-cache.local-llm.json");
const DEFAULT_MAX_CHARS = 3200;
const DEFAULT_BATCH_SIZE = 6;
const DEFAULT_DELAY_MS = 120;
const DEFAULT_LLM_CONFIG = {
  provider: "ollama",
  baseUrl: "http://127.0.0.1:11434",
  model: process.env.HEYU_TRANSLATION_MODEL || process.env.HEYU_LLM_MODEL || "gemma4",
  temperature: 0.1,
  topP: 0.9,
  numCtx: 4096,
  timeoutMs: 600000,
};

function parseArgs(argv) {
  const llmConfig = readLlmConfig();
  const args = {
    inputDir: process.env.EMP_INPUT_DIR || DEFAULT_INPUT_DIR,
    outputDir: process.env.EMP_KR_PDF_TARGET_DIR || DEFAULT_OUTPUT_DIR,
    workManifest: process.env.EMP_KR_PDF_MANIFEST || DEFAULT_WORK_MANIFEST,
    cacheFile: process.env.EMP_KR_TRANSLATION_CACHE || DEFAULT_CACHE_FILE,
    file: null,
    maxDocs: null,
    maxPages: null,
    startPage: null,
    maxChars: DEFAULT_MAX_CHARS,
    batchSize: DEFAULT_BATCH_SIZE,
    delayMs: DEFAULT_DELAY_MS,
    force: false,
    provider: process.env.EMP_KR_TRANSLATION_PROVIDER || llmConfig.provider || DEFAULT_LLM_CONFIG.provider,
    baseUrl: process.env.EMP_KR_TRANSLATION_BASE_URL || llmConfig.baseUrl || DEFAULT_LLM_CONFIG.baseUrl,
    model: process.env.EMP_KR_TRANSLATION_MODEL || llmConfig.model || DEFAULT_LLM_CONFIG.model,
    temperature: Number(process.env.EMP_KR_TRANSLATION_TEMPERATURE || llmConfig.temperature || DEFAULT_LLM_CONFIG.temperature),
    topP: Number(process.env.EMP_KR_TRANSLATION_TOP_P || llmConfig.topP || DEFAULT_LLM_CONFIG.topP),
    numCtx: Number(process.env.EMP_KR_TRANSLATION_NUM_CTX || llmConfig.numCtx || DEFAULT_LLM_CONFIG.numCtx),
    timeoutMs: Number(process.env.EMP_KR_TRANSLATION_TIMEOUT_MS || llmConfig.timeoutMs || DEFAULT_LLM_CONFIG.timeoutMs),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const rawArg = argv[i];
    const equalIndex = rawArg.startsWith("--") ? rawArg.indexOf("=") : -1;
    const arg = equalIndex > -1 ? rawArg.slice(0, equalIndex) : rawArg;
    const inlineValue = equalIndex > -1 ? rawArg.slice(equalIndex + 1) : null;
    const next = inlineValue ?? argv[i + 1];
    const shouldConsumeNext = inlineValue === null;

    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--in" || arg === "--input") {
      args.inputDir = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--out" || arg === "--pdf-out") {
      args.outputDir = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--manifest") {
      args.workManifest = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--cache") {
      args.cacheFile = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--file") {
      args.file = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--max-docs") {
      args.maxDocs = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--start-page") {
      args.startPage = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--max-pages") {
      args.maxPages = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--max-chars") {
      args.maxChars = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--batch-size") {
      args.batchSize = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--delay-ms") {
      args.delayMs = parsePositiveInt(arg, next, true);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--force") {
      args.force = true;
      continue;
    }
    if (arg === "--provider") {
      args.provider = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--base-url") {
      args.baseUrl = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--model") {
      args.model = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (/^\d+$/.test(arg) && args.maxDocs === null) {
      args.maxDocs = parsePositiveInt("max-docs", arg);
      continue;
    }

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  return args;
}

function printHelp() {
  console.log(`Build Korean EMP PDFs

Usage:
  npm run emp:kr:pdfs
  node tools/emp-kr-pdf/build-kr-pdfs.js --file eei-epri-emp-report-key-messages-2019 --max-pages 1 --force

Options:
  --in, --input       Source JSON folder. Default: data/emp
  --out, --pdf-out    Korean PDF output folder. Default: data/emp_kr_pdfs
  --manifest          Work manifest from emp:kr:prepare. Default: data/emp_pdf_translation/manifest.json
  --cache             Translation cache file
  --file              One document id or title fragment
  --max-docs          Limit number of documents
  --start-page        Start from source page number
  --max-pages         Limit pages per document
  --max-chars         Max characters per translation segment. Default: ${DEFAULT_MAX_CHARS}
  --batch-size        Number of translation segments per request. Default: ${DEFAULT_BATCH_SIZE}
  --delay-ms          Delay between translation batches. Default: ${DEFAULT_DELAY_MS}
  --force             Rebuild PDFs that already exist
  --provider          ollama or openai-compatible. Default follows app/config/llm.json
  --base-url          Local model server URL. Default follows app/config/llm.json
  --model             Local model name. Default follows app/config/llm.json
`);
}

function readLlmConfig() {
  const configPath = path.join("app", "config", "llm.json");
  try {
    return { ...DEFAULT_LLM_CONFIG, ...JSON.parse(fs.readFileSync(configPath, "utf8")) };
  } catch (_error) {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(flag, value, allowZero = false) {
  const parsed = Number(requireValue(flag, value));
  const valid = Number.isInteger(parsed) && (allowZero ? parsed >= 0 : parsed > 0);
  if (!valid) {
    throw new Error(`${flag} must be ${allowZero ? "zero or a positive" : "a positive"} integer`);
  }
  return parsed;
}

function toPosixPath(value) {
  return value.split(path.sep).join("/");
}

function relativeToCwd(filePath) {
  return toPosixPath(path.relative(process.cwd(), filePath));
}

function resolveFromCwd(value) {
  return path.resolve(process.cwd(), value);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function normalizeText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function loadWorkItems(options) {
  const manifestPath = resolveFromCwd(options.workManifest);
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Missing work manifest. Run npm run emp:kr:prepare first: ${options.workManifest}`);
  }

  let items = loadJson(manifestPath).files || [];
  if (options.file) {
    const needle = options.file.toLowerCase();
    items = items.filter((item) => [item.id, item.title, item.sourceFile, item.expectedKoreanPdf].filter(Boolean).some((value) => value.toLowerCase().includes(needle)));
  }
  if (options.maxDocs) {
    items = items.slice(0, options.maxDocs);
  }
  return items;
}

function loadSourceDoc(inputDir, item) {
  const detailPath = path.join(inputDir, "docs", `${item.id}.json`);
  if (!fs.existsSync(detailPath)) {
    throw new Error(`Missing source JSON for ${item.id}: ${relativeToCwd(detailPath)}`);
  }
  return loadJson(detailPath);
}

function selectPages(pages, options) {
  let selected = pages || [];
  if (options.startPage) {
    selected = selected.filter((page) => page.page >= options.startPage);
  }
  if (options.maxPages) {
    selected = selected.slice(0, options.maxPages);
  }
  return selected;
}

function splitForTranslation(text, maxChars) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const segments = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) continue;
    if (paragraph.length > maxChars) {
      if (current) {
        segments.push(current.trim());
        current = "";
      }
      segments.push(...splitLongText(paragraph, maxChars));
      continue;
    }

    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars) {
      segments.push(current.trim());
      current = paragraph;
    } else {
      current = next;
    }
  }

  if (current.trim()) {
    segments.push(current.trim());
  }

  return segments;
}

function splitLongText(text, maxChars) {
  const parts = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + maxChars, text.length);
    if (end < text.length) {
      const minimum = start + Math.floor(maxChars * 0.55);
      const candidates = [
        text.lastIndexOf(". ", end),
        text.lastIndexOf("; ", end),
        text.lastIndexOf(", ", end),
        text.lastIndexOf(" ", end),
      ];
      const cut = candidates.find((position) => position > minimum);
      if (cut && cut > start) {
        end = cut + 1;
      }
    }
    const part = text.slice(start, end).trim();
    if (part) parts.push(part);
    start = end;
  }

  return parts;
}

function hashText(text) {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function loadCache(cacheFile) {
  const resolved = resolveFromCwd(cacheFile);
  ensureDir(path.dirname(resolved));
  if (!fs.existsSync(resolved)) {
    return { path: resolved, values: {} };
  }
  try {
    return { path: resolved, values: loadJson(resolved) };
  } catch {
    return { path: resolved, values: {} };
  }
}

function saveCache(cache) {
  writeJson(cache.path, cache.values);
}

async function translateSegments(segments, options, cache) {
  const translated = new Array(segments.length);
  const misses = [];

  segments.forEach((text, index) => {
    const key = hashText(text);
    if (cache.values[key]) {
      translated[index] = cache.values[key];
    } else {
      misses.push({ index, key, text });
    }
  });

  for (let i = 0; i < misses.length; i += options.batchSize) {
    const batch = misses.slice(i, i + options.batchSize);
    const result = await translateBatchWithRetry(batch.map((item) => item.text), options);
    const translatedBatch = Array.isArray(result) ? result : [result];

    translatedBatch.forEach((item, batchIndex) => {
      const miss = batch[batchIndex];
      const text = normalizeText(item.text || "");
      cache.values[miss.key] = text;
      translated[miss.index] = text;
    });

    saveCache(cache);
    if (options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  return translated;
}

async function translateBatchWithRetry(texts, options) {
  const translated = [];
  for (const text of texts) {
    translated.push({ text: await translateOneWithRetry(text, options) });
  }
  return translated;
}

async function translateOneWithRetry(text, options) {
  let lastError = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      return await translateOne(text, options);
    } catch (error) {
      lastError = error;
      await sleep(700 * attempt);
    }
  }
  throw lastError;
}

async function translateOne(text, options) {
  if (options.provider === "openai-compatible") {
    return translateOneOpenAICompatible(text, options);
  }
  if (options.provider !== "ollama") {
    throw new Error(`Unsupported translation provider: ${options.provider}`);
  }
  return translateOneOllama(text, options);
}

async function translateOneOllama(text, options) {
  const response = await fetchWithTimeout(`${normalizeBaseUrl(options.baseUrl)}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: options.model,
      stream: false,
      messages: translationMessages(text),
      options: {
        temperature: options.temperature,
        top_p: options.topP,
        num_ctx: options.numCtx,
      },
    }),
  }, options.timeoutMs);

  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(body?.error || body?.message || `Ollama HTTP ${response.status}`);
  }
  return cleanTranslationText(body?.message?.content || body?.response || "");
}

async function translateOneOpenAICompatible(text, options) {
  const headers = { "Content-Type": "application/json" };
  if (process.env.HEYU_LLM_API_KEY) headers.Authorization = `Bearer ${process.env.HEYU_LLM_API_KEY}`;

  const response = await fetchWithTimeout(`${normalizeBaseUrl(options.baseUrl)}/v1/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: options.model,
      messages: translationMessages(text),
      temperature: options.temperature,
      top_p: options.topP,
    }),
  }, options.timeoutMs);

  const body = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(body?.error?.message || body?.message || `LLM HTTP ${response.status}`);
  }
  return cleanTranslationText(body?.choices?.[0]?.message?.content || "");
}

function translationMessages(text) {
  return [
    {
      role: "system",
      content: [
        "You translate English technical/government documents into Korean.",
        "Return only the Korean translation.",
        "Preserve numbers, units, standard names, document identifiers, and acronyms.",
        "Do not add explanations, markdown, bullets, or comments unless they exist in the source.",
      ].join("\n"),
    },
    {
      role: "user",
      content: String(text || ""),
    },
  ];
}

function normalizeBaseUrl(baseUrl) {
  return String(baseUrl || "").replace(/\/+$/, "");
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs || DEFAULT_LLM_CONFIG.timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function readJsonResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (_error) {
    return { message: text };
  }
}

function cleanTranslationText(value) {
  return normalizeText(String(value || "")
    .replace(/```[a-zA-Z0-9_-]*\n?/g, "")
    .replace(/```/g, ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function translatePages(pages, options, cache) {
  const translatedPages = [];

  for (const page of pages) {
    const segments = splitForTranslation(page.text, options.maxChars);
    process.stdout.write(` p.${page.page}(${segments.length})`);
    const translatedSegments = await translateSegments(segments, options, cache);
    translatedPages.push({
      page: page.page,
      text: normalizeText(translatedSegments.join("\n\n")),
    });
  }

  console.log("");
  return translatedPages;
}

function findKoreanFont() {
  const candidates = [
    "C:\\Windows\\Fonts\\malgun.ttf",
    "C:\\Windows\\Fonts\\malgunbd.ttf",
    "/System/Library/Fonts/AppleSDGothicNeo.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error("No Korean font found. Install Malgun Gothic or Noto Sans CJK.");
  }
  return found;
}

function writeKoreanPdf(item, sourceDoc, translatedPages, outputPdfPath, options) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(outputPdfPath));

    const stream = fs.createWriteStream(outputPdfPath);
    const pdf = new PDFDocument({
      size: "A4",
      margin: 48,
      info: {
        Title: `${sourceDoc.title} Korean Translation`,
        Author: "local-ai-messenger",
        Subject: "Korean translated EMP document",
      },
    });

    stream.on("finish", resolve);
    stream.on("error", reject);
    pdf.on("error", reject);

    pdf.pipe(stream);
    pdf.registerFont("Korean", findKoreanFont());
    pdf.font("Korean");

    pdf.fontSize(18).fillColor("#111111").text(sourceDoc.title, { lineGap: 6 });
    pdf.moveDown(0.8);
    pdf.fontSize(9).fillColor("#666666");
    pdf.text(`원문: ${item.sourceFile}`);
    pdf.text(`번역 PDF: ${relativeToCwd(outputPdfPath)}`);
    pdf.text(`기관: ${sourceDoc.agency || "-"} / 연도: ${sourceDoc.year || "-"}`);
    pdf.text(`생성: ${new Date().toISOString()} / 번역: ${options.provider}`);

    translatedPages.forEach((page) => {
      pdf.addPage();
      pdf.font("Korean").fontSize(9).fillColor("#777777").text(`원문 p.${page.page}`, { align: "right" });
      pdf.moveDown(0.6);
      pdf.fontSize(10.5).fillColor("#111111").text(page.text, {
        lineGap: 4,
        paragraphGap: 8,
      });
    });

    pdf.end();
  });
}

async function buildOnePdf(item, options, cache) {
  const inputDir = resolveFromCwd(options.inputDir);
  const sourceDoc = loadSourceDoc(inputDir, item);
  const outputPdfPath = resolveFromCwd(item.expectedKoreanPdf || path.join(options.outputDir, `${item.id}.ko.pdf`));

  if (fs.existsSync(outputPdfPath) && !options.force) {
    console.log(`- ${item.id}: exists, skipped`);
    return { id: item.id, status: "skipped", outputPdf: relativeToCwd(outputPdfPath) };
  }

  const pages = selectPages(sourceDoc.pages, options);
  console.log(`- ${item.id}: ${pages.length}/${sourceDoc.pages.length} page(s)`);
  const translatedPages = await translatePages(pages, options, cache);
  await writeKoreanPdf(item, sourceDoc, translatedPages, outputPdfPath, options);

  return {
    id: item.id,
    status: "built",
    outputPdf: relativeToCwd(outputPdfPath),
    pageCount: translatedPages.length,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  ensureDir(resolveFromCwd(options.outputDir));
  const items = loadWorkItems(options);
  const cache = loadCache(options.cacheFile);
  const generatedAt = new Date().toISOString();
  const results = [];
  const errors = [];

  if (!items.length) {
    throw new Error("No matching PDF work items");
  }

  console.log(`Build Korean PDFs: ${items.length} document(s)`);
  console.log(`Output: ${options.outputDir}`);

  for (const item of items) {
    try {
      results.push(await buildOnePdf(item, options, cache));
    } catch (error) {
      errors.push({ id: item.id, message: error.message });
      console.log(`  failed: ${error.message}`);
    }
  }

  saveCache(cache);
  writeJson(path.join(resolveFromCwd(options.outputDir), "_build-report.json"), {
    kind: "emp-korean-pdf-build",
    generatedAt,
    provider: options.provider,
    resultCount: results.length,
    errorCount: errors.length,
    results,
    errors,
  });

  console.log(`Done. built=${results.filter((item) => item.status === "built").length}, skipped=${results.filter((item) => item.status === "skipped").length}, errors=${errors.length}`);
  if (errors.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
