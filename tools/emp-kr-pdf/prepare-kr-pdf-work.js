const fs = require("fs");
const path = require("path");

const DEFAULT_SOURCE_DIR = path.join("data", "emp_docs");
const DEFAULT_TARGET_DIR = path.join("data", "emp_kr_pdfs");
const DEFAULT_WORK_DIR = path.join("data", "emp_pdf_translation");
const DEFAULT_SUFFIX = ".ko";

function parseArgs(argv) {
  const args = {
    sourceDir: process.env.EMP_KR_PDF_SOURCE_DIR || DEFAULT_SOURCE_DIR,
    targetDir: process.env.EMP_KR_PDF_TARGET_DIR || DEFAULT_TARGET_DIR,
    workDir: process.env.EMP_KR_PDF_WORK_DIR || DEFAULT_WORK_DIR,
    suffix: process.env.EMP_KR_PDF_SUFFIX || DEFAULT_SUFFIX,
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
    if (arg === "--source" || arg === "--in" || arg === "--input") {
      args.sourceDir = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--target" || arg === "--pdf-out") {
      args.targetDir = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--work-dir" || arg === "--out") {
      args.workDir = requireValue(arg, next);
      if (shouldConsumeNext) i += 1;
      continue;
    }
    if (arg === "--suffix") {
      args.suffix = normalizeSuffix(requireValue(arg, next));
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

    throw new Error(`Unknown argument: ${rawArg}`);
  }

  args.suffix = normalizeSuffix(args.suffix);
  return args;
}

function printHelp() {
  console.log(`EMP Korean PDF translation work preparer

Usage:
  npm run emp:kr:prepare
  node tools/emp-kr-pdf/prepare-kr-pdf-work.js --source data/emp_docs --target data/emp_kr_pdfs

Options:
  --source, --in      Source English PDF folder. Default: data/emp_docs
  --target, --pdf-out Folder where translated Korean PDFs should be placed. Default: data/emp_kr_pdfs
  --work-dir, --out   Work metadata folder. Default: data/emp_pdf_translation
  --suffix            Expected Korean PDF suffix before .pdf. Default: .ko
  --max-files         Limit source files for testing
`);
}

function requireValue(flag, value) {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(flag, value) {
  const parsed = Number(requireValue(flag, value));
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function normalizeSuffix(suffix) {
  if (!suffix) return "";
  return suffix.startsWith(".") ? suffix : `.${suffix}`;
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

function slugify(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
  return slug || "document";
}

function makeTitle(baseName) {
  return baseName.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

function detectYear(baseName) {
  const match = baseName.match(/(?:^|[^0-9])((?:19|20)\d{2})(?:$|[^0-9])/);
  return match ? Number(match[1]) : null;
}

function detectAgency(baseName) {
  const normalized = baseName.toLowerCase();
  const rules = [
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
  const rule = rules.find((item) => item.re.test(normalized));
  return rule ? rule.name : null;
}

function collectPdfFiles(sourceDir, maxFiles) {
  if (!fs.existsSync(sourceDir)) {
    throw new Error(`Source directory does not exist: ${sourceDir}`);
  }

  const files = fs
    .readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(sourceDir, entry.name))
    .filter((filePath) => path.extname(filePath).toLowerCase() === ".pdf")
    .sort((a, b) => a.localeCompare(b, "en"));

  return maxFiles ? files.slice(0, maxFiles) : files;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const sourceDir = resolveFromCwd(args.sourceDir);
  const targetDir = resolveFromCwd(args.targetDir);
  const workDir = resolveFromCwd(args.workDir);
  const generatedAt = new Date().toISOString();
  const files = collectPdfFiles(sourceDir, args.maxFiles);

  fs.mkdirSync(targetDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });

  const items = files.map((sourcePath) => {
    const baseName = path.basename(sourcePath, ".pdf");
    const expectedName = `${baseName}${args.suffix}.pdf`;
    const expectedPath = path.join(targetDir, expectedName);

    return {
      id: slugify(baseName),
      title: makeTitle(baseName),
      sourceFile: relativeToCwd(sourcePath),
      expectedKoreanPdf: relativeToCwd(expectedPath),
      agency: detectAgency(baseName),
      year: detectYear(baseName),
      status: fs.existsSync(expectedPath) ? "ready" : "pending",
    };
  });

  const manifest = {
    kind: "emp-kr-pdf-translation-work",
    generatedAt,
    sourceDir: relativeToCwd(sourceDir),
    targetDir: relativeToCwd(targetDir),
    suffix: args.suffix,
    fileCount: items.length,
    readyCount: items.filter((item) => item.status === "ready").length,
    pendingCount: items.filter((item) => item.status === "pending").length,
    files: items,
  };

  writeJson(path.join(workDir, "manifest.json"), manifest);

  const csvHeader = ["id", "title", "sourceFile", "expectedKoreanPdf", "status"].join(",");
  const csvRows = items.map((item) => [item.id, item.title, item.sourceFile, item.expectedKoreanPdf, item.status].map(csvEscape).join(","));
  fs.writeFileSync(path.join(workDir, "translation-list.csv"), `${csvHeader}\n${csvRows.join("\n")}\n`, "utf8");

  const readme = [
    "# EMP Korean PDF translation work",
    "",
    `1. Translate the PDFs listed in \`${relativeToCwd(sourceDir)}\`.`,
    `2. Save each translated PDF to \`${relativeToCwd(targetDir)}\` using the \`expectedKoreanPdf\` filename.`,
    "3. Run `npm run emp:kr:ingest` to extract Korean JSON/search chunks from the translated PDFs.",
    "",
    "The original PDFs are not modified.",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(workDir, "README.md"), readme, "utf8");

  console.log(`Prepared ${items.length} Korean PDF translation target(s).`);
  console.log(`Work manifest: ${relativeToCwd(path.join(workDir, "manifest.json"))}`);
  console.log(`Target folder: ${relativeToCwd(targetDir)}`);
  console.log(`Ready: ${manifest.readyCount}, pending: ${manifest.pendingCount}`);
}

main();
