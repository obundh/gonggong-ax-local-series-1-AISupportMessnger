const fs = require("fs");
const path = require("path");
const { PDFParse } = require("pdf-parse");

const DEFAULT_INPUT_DIR = path.join("data", "emp_docs");
const DEFAULT_OUTPUT_DIR = path.join("data", "emp");
const DEFAULT_CHUNK_SIZE = 1200;
const DEFAULT_OVERLAP = 160;

const TOPIC_RULES = [
  { topic: "EMP", terms: ["emp", "electromagnetic pulse", "electromagnetic defense"] },
  { topic: "HEMP", terms: ["hemp", "high-altitude electromagnetic pulse", "high altitude electromagnetic pulse"] },
  { topic: "HPEM", terms: ["hpem", "high-power electromagnetic", "high power electromagnetic"] },
  { topic: "E1/E2/E3", terms: ["e1", "e2", "e3", "waveform"] },
  { topic: "Power Grid", terms: ["grid", "bulk power", "electricity", "transformer", "transmission"] },
  { topic: "Telecom", terms: ["telecommunication", "communication", "telecom"] },
  { topic: "Shielding", terms: ["shield", "shielding", "protection"] },
  { topic: "Resilience", terms: ["resilience", "preparedness", "mitigation", "recovery"] },
  { topic: "Standards", terms: ["standard", "standards", "mil-std", "itu-t", "requirements"] },
  { topic: "Infrastructure", terms: ["critical infrastructure", "facility", "facilities"] },
];

const AGENCY_RULES = [
  { re: /^air_university/i, name: "Air University" },
  { re: /^cisa_ncc/i, name: "CISA/NCC" },
  { re: /^crs_/i, name: "CRS" },
  { re: /^doe_ceser/i, name: "DOE/CESER" },
  { re: /^doe_epri/i, name: "DOE/EPRI" },
  { re: /^doe_nerc/i, name: "DOE/NERC" },
  { re: /^doe_/i, name: "DOE" },
  { re: /^eei_epri/i, name: "EEI/EPRI" },
  { re: /^etri_/i, name: "ETRI" },
  { re: /^gao_/i, name: "GAO" },
  { re: /^inl_/i, name: "INL" },
  { re: /^ist_/i, name: "IST" },
  { re: /^itu[-_]t_/i, name: "ITU-T" },
  { re: /^kns_/i, name: "KNS" },
  { re: /^kpfi_/i, name: "KPFI" },
  { re: /^mil[_-]std_/i, name: "MIL-STD" },
  { re: /^nerc_/i, name: "NERC" },
  { re: /^nids_/i, name: "NIDS" },
  { re: /^whitehouse_/i, name: "White House" },
];

function parseArgs(argv) {
  const args = {
    inputDir: process.env.EMP_INPUT_DIR || DEFAULT_INPUT_DIR,
    outputDir: process.env.EMP_OUTPUT_DIR || DEFAULT_OUTPUT_DIR,
    kind: process.env.EMP_INGEST_KIND || "emp-document-ingest",
    language: process.env.EMP_LANGUAGE || "en",
    sourceLanguage: process.env.EMP_SOURCE_LANGUAGE || "",
    stripSuffix: process.env.EMP_STRIP_SUFFIX || "",
    sourceMapPath: process.env.EMP_SOURCE_MAP || "",
    chunkSize: DEFAULT_CHUNK_SIZE,
    overlap: DEFAULT_OVERLAP,
    maxFiles: null,
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
    if (arg === "--out" || arg === "--output") {
      args.outputDir = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--kind") {
      args.kind = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--language") {
      args.language = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--source-language") {
      args.sourceLanguage = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--strip-suffix") {
      args.stripSuffix = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--source-map") {
      args.sourceMapPath = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--chunk-size") {
      args.chunkSize = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--overlap") {
      args.overlap = parsePositiveInt(arg, next, true);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--max-files") {
      args.maxFiles = parsePositiveInt(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (/^\d+$/.test(arg) && args.maxFiles === null) {
      args.maxFiles = parsePositiveInt("max-files", arg);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (args.overlap >= args.chunkSize) {
    throw new Error("--overlap must be smaller than --chunk-size");
  }

  return args;
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

function printHelp() {
  console.log(`EMP document JSON ingester

Usage:
  npm run emp:ingest
  npm run emp:ingest -- --in data/emp_docs --out data/emp

Options:
  --in, --input       Source folder. Default: data/emp_docs
  --out, --output     Output folder. Default: data/emp
  --language          Output language tag. Default: en
  --source-language   Original language tag for translated inputs
  --strip-suffix      Remove filename suffix before making ids, e.g. .ko
  --source-map        Translation work manifest for original PDF provenance
  --kind              Manifest kind. Default: emp-document-ingest
  --chunk-size        Chunk size in characters. Default: 1200
  --overlap           Chunk overlap in characters. Default: 160
  --max-files         Limit the number of input files for testing
`);
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

function assertInside(parent, target) {
  const parentPath = path.resolve(parent);
  const targetPath = path.resolve(target);
  const relative = path.relative(parentPath, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside output directory: ${targetPath}`);
  }
}

function resetOutput(outputDir) {
  fs.mkdirSync(outputDir, { recursive: true });

  const docsDir = path.join(outputDir, "docs");
  assertInside(outputDir, docsDir);

  if (fs.existsSync(docsDir)) {
    fs.rmSync(docsDir, { recursive: true, force: true });
  }
  fs.mkdirSync(docsDir, { recursive: true });

  for (const filename of ["manifest.json", "index.json", "search-index.jsonl"]) {
    const filePath = path.join(outputDir, filename);
    assertInside(outputDir, filePath);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function collectInputFiles(inputDir, maxFiles) {
  if (!fs.existsSync(inputDir)) {
    throw new Error(`Input directory does not exist: ${inputDir}`);
  }

  const files = fs
    .readdirSync(inputDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(inputDir, entry.name))
    .filter((filePath) => [".pdf", ".txt"].includes(path.extname(filePath).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en"));

  return maxFiles ? files.slice(0, maxFiles) : files;
}

async function parsePdf(filePath) {
  const parser = new PDFParse({ data: fs.readFileSync(filePath) });

  try {
    const result = await parser.getText();
    const pages = Array.isArray(result.pages)
      ? result.pages.map((page, index) => ({
          page: Number.isInteger(page.num) ? page.num : index + 1,
          text: normalizeText(page.text || ""),
        }))
      : [];

    if (!pages.length && result.text) {
      pages.push({ page: 1, text: normalizeText(result.text) });
    }

    return {
      pageCount: result.total || pages.length,
      pages: pages.filter((page) => page.text.length > 0),
    };
  } finally {
    if (typeof parser.destroy === "function") {
      await parser.destroy();
    }
  }
}

function parseText(filePath) {
  const text = normalizeText(fs.readFileSync(filePath, "utf8"));
  return {
    pageCount: 1,
    pages: text ? [{ page: 1, text }] : [],
  };
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

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "document";
}

function uniqueId(baseId, usedIds) {
  let id = baseId;
  let index = 2;
  while (usedIds.has(id)) {
    id = `${baseId}-${index}`;
    index += 1;
  }
  usedIds.add(id);
  return id;
}

function makeTitle(baseName) {
  return baseName.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function stripConfiguredSuffix(baseName, suffix) {
  if (!suffix) return baseName;
  const normalizedSuffix = suffix.startsWith(".") ? suffix : `.${suffix}`;
  return baseName.toLowerCase().endsWith(normalizedSuffix.toLowerCase()) ? baseName.slice(0, -normalizedSuffix.length) : baseName;
}

function detectYear(baseName) {
  const match = baseName.match(/(?:^|[^0-9])((?:19|20)\d{2})(?:$|[^0-9])/);
  return match ? Number(match[1]) : null;
}

function detectAgency(baseName) {
  const normalized = baseName.toLowerCase();
  const rule = AGENCY_RULES.find((item) => item.re.test(normalized));
  return rule ? rule.name : null;
}

function detectTopics(baseName, pages) {
  const sampleText = pages
    .map((page) => page.text)
    .join(" ")
    .slice(0, 100000);
  const corpus = `${baseName} ${sampleText}`.toLowerCase();

  return TOPIC_RULES.filter((rule) => rule.terms.some((term) => corpus.includes(term))).map((rule) => rule.topic);
}

function splitText(text, chunkSize, overlap) {
  if (!text) return [];
  if (text.length <= chunkSize) return [text];

  const chunks = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const minimum = start + Math.floor(chunkSize * 0.6);
      const candidates = [
        text.lastIndexOf("\n\n", end),
        text.lastIndexOf("\n", end),
        text.lastIndexOf(". ", end),
        text.lastIndexOf("; ", end),
        text.lastIndexOf(" ", end),
      ];
      const cut = candidates.find((position) => position > minimum);
      if (cut && cut > start) {
        end = cut + 1;
      }
    }

    const chunk = text.slice(start, end).trim();
    if (chunk) {
      chunks.push(chunk);
    }

    if (end >= text.length) break;
    const nextStart = Math.max(0, end - overlap);
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function buildChunks(doc, pages, chunkSize, overlap) {
  const chunks = [];
  let chunkNumber = 1;

  for (const page of pages) {
    const parts = splitText(page.text, chunkSize, overlap);
    parts.forEach((text, pageChunkIndex) => {
      chunks.push({
        id: `${doc.id}:p${page.page}:c${pageChunkIndex + 1}`,
        docId: doc.id,
        title: doc.title,
        sourceFile: doc.sourceFile,
        originalSourceFile: doc.originalSourceFile,
        language: doc.language,
        sourceLanguage: doc.sourceLanguage,
        agency: doc.agency,
        year: doc.year,
        topics: doc.topics,
        page: page.page,
        chunk: chunkNumber,
        pageChunk: pageChunkIndex + 1,
        text,
      });
      chunkNumber += 1;
    });
  }

  return chunks;
}

function loadSourceMap(sourceMapPath) {
  if (!sourceMapPath) {
    return { path: null, byId: new Map(), byTargetPath: new Map() };
  }

  const resolvedPath = resolveFromCwd(sourceMapPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Source map does not exist: ${sourceMapPath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  const files = Array.isArray(parsed.files) ? parsed.files : [];
  const byId = new Map();
  const byTargetPath = new Map();

  for (const item of files) {
    if (item.id) {
      byId.set(item.id, item);
    }
    if (item.expectedKoreanPdf) {
      byTargetPath.set(toPosixPath(item.expectedKoreanPdf), item);
    }
  }

  return {
    path: relativeToCwd(resolvedPath),
    byId,
    byTargetPath,
  };
}

function findSourceInfo(sourceMap, sourceFile, id) {
  return sourceMap.byTargetPath.get(sourceFile) || sourceMap.byId.get(id) || null;
}

async function parseDocument(filePath, usedIds, options) {
  const extension = path.extname(filePath).toLowerCase();
  const rawBaseName = path.basename(filePath, extension);
  const baseName = stripConfiguredSuffix(rawBaseName, options.stripSuffix);
  const parsed = extension === ".pdf" ? await parsePdf(filePath) : parseText(filePath);
  const sourceFile = relativeToCwd(filePath);
  const baseId = slugify(baseName);
  const sourceInfo = findSourceInfo(options.sourceMap, sourceFile, baseId);
  const id = uniqueId(sourceInfo?.id || baseId, usedIds);
  const title = makeTitle(sourceInfo?.title || baseName);
  const detectionBase = [baseName, sourceInfo?.title, sourceInfo?.sourceFile].filter(Boolean).join(" ");
  const topics = detectTopics(detectionBase, parsed.pages);
  const characterCount = parsed.pages.reduce((sum, page) => sum + page.text.length, 0);

  const doc = {
    id,
    title,
    sourceFile,
    originalSourceFile: sourceInfo?.sourceFile || null,
    language: options.language,
    sourceLanguage: options.sourceLanguage || null,
    type: extension.slice(1),
    year: sourceInfo?.year || detectYear(baseName),
    agency: sourceInfo?.agency || detectAgency(baseName),
    topics,
    pageCount: parsed.pageCount,
    characterCount,
    pages: parsed.pages,
    chunks: [],
    ingestedAt: options.generatedAt,
  };

  doc.chunks = buildChunks(doc, parsed.pages, options.chunkSize, options.overlap);
  return doc;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function makeIndexEntry(doc, outputDir) {
  return {
    id: doc.id,
    title: doc.title,
    sourceFile: doc.sourceFile,
    originalSourceFile: doc.originalSourceFile,
    detailFile: relativeToCwd(path.join(outputDir, "docs", `${doc.id}.json`)),
    language: doc.language,
    sourceLanguage: doc.sourceLanguage,
    type: doc.type,
    year: doc.year,
    agency: doc.agency,
    topics: doc.topics,
    pageCount: doc.pageCount,
    characterCount: doc.characterCount,
    chunkCount: doc.chunks.length,
    ingestedAt: doc.ingestedAt,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputDir = resolveFromCwd(args.inputDir);
  const outputDir = resolveFromCwd(args.outputDir);
  const docsDir = path.join(outputDir, "docs");
  const generatedAt = new Date().toISOString();
  const files = collectInputFiles(inputDir, args.maxFiles);
  const sourceMap = loadSourceMap(args.sourceMapPath);
  const usedIds = new Set();
  const index = [];
  const errors = [];
  let chunkCount = 0;

  resetOutput(outputDir);

  console.log(`EMP ingest: ${files.length} source file(s)`);
  console.log(`Input: ${relativeToCwd(inputDir)}`);
  console.log(`Output: ${relativeToCwd(outputDir)}`);

  for (const filePath of files) {
    const displayPath = relativeToCwd(filePath);
    process.stdout.write(`- ${displayPath} ... `);

    try {
      const doc = await parseDocument(filePath, usedIds, {
        generatedAt,
        language: args.language,
        sourceLanguage: args.sourceLanguage,
        stripSuffix: args.stripSuffix,
        sourceMap,
        chunkSize: args.chunkSize,
        overlap: args.overlap,
      });
      writeJson(path.join(docsDir, `${doc.id}.json`), doc);
      index.push(makeIndexEntry(doc, outputDir));
      chunkCount += doc.chunks.length;
      console.log(`${doc.pageCount} page(s), ${doc.chunks.length} chunk(s)`);
    } catch (error) {
      errors.push({
        sourceFile: displayPath,
        message: error.message,
      });
      console.log(`failed: ${error.message}`);
    }
  }

  const chunks = [];
  for (const entry of index) {
    const doc = JSON.parse(fs.readFileSync(path.join(process.cwd(), entry.detailFile), "utf8"));
    chunks.push(...doc.chunks);
  }

  writeJson(path.join(outputDir, "index.json"), index);
  fs.writeFileSync(path.join(outputDir, "search-index.jsonl"), chunks.map((chunk) => JSON.stringify(chunk)).join("\n") + "\n", "utf8");

  const manifest = {
    kind: args.kind,
    parser: "pdf-parse",
    generatedAt,
    inputDir: relativeToCwd(inputDir),
    outputDir: relativeToCwd(outputDir),
    sourceMap: sourceMap.path,
    language: args.language,
    sourceLanguage: args.sourceLanguage || null,
    docCount: index.length,
    sourceFileCount: files.length,
    chunkCount,
    chunkSize: args.chunkSize,
    overlap: args.overlap,
    errors,
  };
  writeJson(path.join(outputDir, "manifest.json"), manifest);

  console.log(`Done. ${index.length} document(s), ${chunkCount} chunk(s), ${errors.length} error(s).`);
  if (errors.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
