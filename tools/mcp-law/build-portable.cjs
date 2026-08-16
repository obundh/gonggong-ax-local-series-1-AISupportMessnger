"use strict";

const fs = require("node:fs");
const path = require("node:path");
const esbuild = require("esbuild");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "outputs", "heyu-kim-law-mcp");
const DATA = path.join(ROOT, "data");
const TARGET_PATHS = Object.freeze({
  law: ["law"],
  prec: ["prec", "precedent_body", "precedent"],
  expc: ["expc", path.join("legal_refs", "expc")],
  decc: ["decc", path.join("legal_refs", "decc")],
  admrul: ["admrul", path.join("legal_refs", "admrul")],
  detc: ["detc", path.join("legal_refs", "detc")],
});
const REQUIRED_FILES = ["manifest.json", "index.json", "search-index.jsonl"];
const OPTIONAL_ROOT_FILES = ["legal-corpus-manifest.json"];
const OPTIONAL_ALIAS_FILES = [
  "official-aliases.json",
  "official-aliases.manifest.json",
  "practice-terms.json",
  "practice-terms.manifest.json",
];
const OPTIONAL_TERM_PACK_FILES = ["manifest.json", "index.json", "search-index.jsonl"];
const PORTABLE_NOTICE_FILES = Object.freeze([
  {
    source: path.join(ROOT, "third_party", "licenses", "Korean-Legal-MCP-DATA-LICENSE.md"),
    destination: path.join("licenses", "Korean-Legal-MCP-DATA-LICENSE.md"),
  },
  {
    source: path.join(ROOT, "third_party", "licenses", "korean-law-mcp-v4.10.0-MIT.txt"),
    destination: path.join("licenses", "korean-law-mcp-v4.10.0-MIT.txt"),
  },
  {
    source: path.join(ROOT, "THIRD_PARTY_NOTICES.md"),
    destination: "THIRD_PARTY_NOTICES.md",
  },
]);

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(__dirname, "server.cjs")],
    outfile: path.join(OUT, "server.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node20",
  });

  const receipt = copyPortableData(DATA, path.join(OUT, "data"));
  const notices = copyPortableNotices(OUT);
  fs.copyFileSync(path.join(__dirname, "README-PORTABLE.md"), path.join(OUT, "README.md"));
  fs.writeFileSync(path.join(OUT, "mcp-config.example.json"), JSON.stringify({
    mcpServers: {
      "heyu-kim-law-local": { command: "node", args: ["/absolute/path/heyu-kim-law-mcp/server.cjs"] },
    },
  }, null, 2));

  process.stdout.write(`Portable MCP created: ${OUT}\nTargets: ${receipt.targets.join(", ")}\nData size: ${(receipt.bytes / 1024 / 1024).toFixed(1)} MB\nNotices: ${notices.files.join(", ")}\n`);
}

function copyPortableNotices(outputDir) {
  const destinationRoot = path.resolve(outputDir);
  const files = [];
  let bytes = 0;
  for (const item of PORTABLE_NOTICE_FILES) {
    if (!isRegularFile(item.source)) throw new Error(`Required portable notice is missing: ${path.basename(item.source)}`);
    bytes += copyRegularFile(item.source, path.join(destinationRoot, item.destination));
    files.push(item.destination.replaceAll("\\", "/"));
  }
  return { files, bytes };
}

function copyPortableData(dataDir, outputDataDir) {
  const sourceRoot = path.resolve(dataDir);
  const destinationRoot = path.resolve(outputDataDir);
  fs.mkdirSync(destinationRoot, { recursive: true });
  const targets = [];
  let bytes = 0;

  for (const [target, candidates] of Object.entries(TARGET_PATHS)) {
    const source = candidates.map((relative) => path.resolve(sourceRoot, relative)).find(isCompleteTargetDirectory);
    if (!source) continue;
    const destination = path.join(destinationRoot, target);
    fs.mkdirSync(destination, { recursive: true });
    for (const fileName of REQUIRED_FILES) bytes += copyRegularFile(path.join(source, fileName), path.join(destination, fileName));
    bytes += copyReferencedDetails(source, destination);
    targets.push(target);
  }
  if (!targets.length) {
    throw new Error("LOCAL_CORPUS_MISSING: portable package에 포함할 완전한 로컬 법률 corpus가 없습니다.");
  }

  for (const fileName of OPTIONAL_ROOT_FILES) {
    const source = path.join(sourceRoot, fileName);
    if (isRegularFile(source)) bytes += copyRegularFile(source, path.join(destinationRoot, fileName));
  }
  const aliasDestination = path.join(destinationRoot, "legal_alias");
  for (const fileName of OPTIONAL_ALIAS_FILES) {
    const source = path.join(sourceRoot, "legal_alias", fileName);
    if (!isRegularFile(source)) continue;
    fs.mkdirSync(aliasDestination, { recursive: true });
    bytes += copyRegularFile(source, path.join(aliasDestination, fileName));
  }
  const termPackSource = path.join(sourceRoot, "legal_terms");
  if (isCompleteAuxiliaryPack(termPackSource)) {
    const termPackDestination = path.join(destinationRoot, "legal_terms");
    for (const fileName of OPTIONAL_TERM_PACK_FILES) {
      bytes += copyRegularFile(path.join(termPackSource, fileName), path.join(termPackDestination, fileName));
    }
  }
  return { targets, bytes };
}

function isCompleteAuxiliaryPack(directory) {
  if (!isDirectory(directory) || !OPTIONAL_TERM_PACK_FILES.every((name) => isRegularFile(path.join(directory, name)))) return false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
    return manifest?.schemaVersion === 1 && manifest?.status === "complete" && manifest?.packType === "list-index" && Number(manifest?.recordCount || 0) > 0;
  } catch (_error) {
    return false;
  }
}

function isCompleteTargetDirectory(directory) {
  return isDirectory(directory) && REQUIRED_FILES.every((name) => isRegularFile(path.join(directory, name)));
}

function copyReferencedDetails(source, destination) {
  let bytes = 0;
  const parsed = JSON.parse(fs.readFileSync(path.join(source, "index.json"), "utf8"));
  const records = Array.isArray(parsed)
    ? parsed
    : ["items", "records", "laws", "cases", "data"].map((key) => parsed?.[key]).find(Array.isArray) || [];
  const relativeFiles = new Set(records
    .map((record) => String(record?.detailFile || "").replaceAll("\\", "/").trim())
    .filter(Boolean));
  for (const relativeFile of relativeFiles) {
    if (path.isAbsolute(relativeFile) || path.extname(relativeFile).toLowerCase() !== ".json") continue;
    const sourcePath = path.resolve(source, relativeFile);
    const relative = path.relative(path.resolve(source), sourcePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative) || !isRegularFile(sourcePath)) continue;
    bytes += copyRegularFile(sourcePath, path.resolve(destination, relative));
  }
  return bytes;
}

function copyRegularFile(source, destination) {
  const stat = fs.statSync(source);
  if (!stat.isFile()) throw new Error(`Not a regular file: ${source}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
  return stat.size;
}

function isRegularFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch (_error) { return false; }
}

function isDirectory(filePath) {
  try { return fs.statSync(filePath).isDirectory(); } catch (_error) { return false; }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exitCode = 1;
  });
}

module.exports = { OPTIONAL_TERM_PACK_FILES, PORTABLE_NOTICE_FILES, TARGET_PATHS, copyPortableData, copyPortableNotices, copyReferencedDetails, isCompleteAuxiliaryPack, isCompleteTargetDirectory };
