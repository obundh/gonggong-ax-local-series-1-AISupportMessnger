#!/usr/bin/env node
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "data", "legal_alias", "official-names.json");
const MANIFEST_FILE = "korea_all_legal_2026-08-16_manifest.json";
const FULL_FILE = "korea_all_legal_full_2026-08-16.txt";
const NAMES_FILE = "korea_all_legal_names_2026-08-16.txt";
const CATEGORY_KEYS = [
  "현행 중앙법령 — 헌법·법률·시행령·시행규칙 등",
  "현행 행정규칙 — 훈령·예규·고시·공고·지침 등",
  "자치법규 — 조례·규칙 등",
  "폐지·실효·연혁 법령명 — 현행 법령의 과거 버전도 포함",
];

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function decodeUtf8Bom(buffer, label) {
  if (buffer.length < 3 || buffer[0] !== 0xef || buffer[1] !== 0xbb || buffer[2] !== 0xbf) {
    throw new Error(`${label} is not UTF-8 BOM text`);
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(3));
}

function validateManifest(manifest, files) {
  if (!manifest || typeof manifest !== "object" || !manifest.files || !manifest.unique_name_counts) {
    throw new Error("Legal catalog manifest schema is invalid");
  }
  if (!/^[a-f0-9]{40}$/i.test(String(manifest.source_commit || ""))) {
    throw new Error("Legal catalog source commit is invalid");
  }
  for (const [fileName, buffer] of Object.entries(files)) {
    const expected = manifest.files[fileName];
    if (!expected || Number(expected.size) !== buffer.length) {
      throw new Error(`${fileName} size does not match the manifest`);
    }
    if (String(expected.sha256 || "").toLowerCase() !== sha256(buffer)) {
      throw new Error(`${fileName} SHA-256 does not match the manifest`);
    }
  }
}

function parseNameSections(text) {
  const lines = String(text || "").split(/\r?\n/);
  const sections = new Map();
  let current = null;
  let declaredCount = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line.match(/^\[([^\]]+)\]$/)?.[1];
    if (heading) {
      if (!CATEGORY_KEYS.includes(heading)) throw new Error(`Unexpected legal catalog category: ${heading}`);
      current = { names: [], declaredCount: null };
      sections.set(heading, current);
      declaredCount = null;
      continue;
    }
    if (!current || !line || /^=+$/.test(line)) continue;
    const countMatch = line.match(/^명칭 수:\s*([\d,]+)개$/);
    if (countMatch) {
      declaredCount = Number(countMatch[1].replaceAll(",", ""));
      current.declaredCount = declaredCount;
      continue;
    }
    current.names.push(line);
  }

  for (const category of CATEGORY_KEYS) {
    const section = sections.get(category);
    if (!section) throw new Error(`Required legal catalog category is missing: ${category}`);
    if (!Number.isInteger(section.declaredCount) || section.declaredCount !== section.names.length) {
      throw new Error(`Declared legal name count does not match: ${category}`);
    }
    if (new Set(section.names).size !== section.names.length) {
      throw new Error(`Duplicate legal names remain inside category: ${category}`);
    }
  }
  return sections;
}

function buildIndex({ manifest, manifestBuffer, namesText }) {
  const sections = parseNameSections(namesText);
  for (const category of CATEGORY_KEYS) {
    const expected = Number(manifest.unique_name_counts?.[category]);
    const actual = sections.get(category).names.length;
    if (expected !== actual) throw new Error(`Manifest name count does not match: ${category}`);
  }
  return {
    schemaVersion: 1,
    source: {
      sourceCommit: String(manifest.source_commit),
      manifestSha256: sha256(manifestBuffer),
      files: manifest.files,
      limitation: "법령명 라우팅용 로컬 색인이며 조문 근거나 공식 최신성 증명이 아님",
    },
    counts: {
      currentCentral: sections.get(CATEGORY_KEYS[0]).names.length,
      administrativeRules: sections.get(CATEGORY_KEYS[1]).names.length,
      localOrdinancesNotIndexed: sections.get(CATEGORY_KEYS[2]).names.length,
      historical: sections.get(CATEGORY_KEYS[3]).names.length,
    },
    names: {
      currentCentral: sections.get(CATEGORY_KEYS[0]).names,
      administrativeRules: sections.get(CATEGORY_KEYS[1]).names,
      historical: sections.get(CATEGORY_KEYS[3]).names,
    },
  };
}

async function writeAtomically(outputPath, value) {
  const output = path.resolve(outputPath);
  const directory = path.dirname(output);
  await fsp.mkdir(directory, { recursive: true });
  const staging = `${output}.${process.pid}.${Date.now()}.tmp`;
  const backup = `${output}.previous`;
  let movedExisting = false;
  try {
    await fsp.writeFile(staging, `${JSON.stringify(value)}\n`, "utf8");
    await fsp.rm(backup, { force: true });
    try {
      await fsp.rename(output, backup);
      movedExisting = true;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    await fsp.rename(staging, output);
    await fsp.rm(backup, { force: true });
    return output;
  } catch (error) {
    try {
      await fsp.rm(staging, { force: true });
      if (movedExisting) await fsp.rename(backup, output);
    } catch {
      // Preserve the original failure; recovery only touches this importer output.
    }
    throw error;
  }
}

async function importLegalCatalog({ sourceDir, outputPath = DEFAULT_OUTPUT }) {
  const source = path.resolve(String(sourceDir || ""));
  if (!sourceDir || !fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error("A directory containing the three legal catalog files is required");
  }
  const manifestPath = path.join(source, MANIFEST_FILE);
  const fullPath = path.join(source, FULL_FILE);
  const namesPath = path.join(source, NAMES_FILE);
  const [manifestBuffer, fullBuffer, namesBuffer] = await Promise.all([
    fsp.readFile(manifestPath),
    fsp.readFile(fullPath),
    fsp.readFile(namesPath),
  ]);
  const manifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBuffer));
  validateManifest(manifest, { [FULL_FILE]: fullBuffer, [NAMES_FILE]: namesBuffer });
  decodeUtf8Bom(fullBuffer, FULL_FILE);
  const namesText = decodeUtf8Bom(namesBuffer, NAMES_FILE);
  const index = buildIndex({ manifest, manifestBuffer, namesText });
  const writtenPath = await writeAtomically(outputPath, index);
  return { index, writtenPath, bytes: fs.statSync(writtenPath).size };
}

function parseArgs(argv) {
  const result = { sourceDir: "", outputPath: DEFAULT_OUTPUT };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--source") result.sourceDir = argv[++index] || "";
    else if (value === "--out") result.outputPath = argv[++index] || "";
    else throw new Error(`Unknown argument: ${value}`);
  }
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await importLegalCatalog(options);
  process.stdout.write([
    "법령명 로컬 색인 생성 완료",
    `- 현행 중앙법령: ${result.index.counts.currentCentral.toLocaleString("ko-KR")}개`,
    `- 행정규칙: ${result.index.counts.administrativeRules.toLocaleString("ko-KR")}개`,
    `- 연혁 법령명: ${result.index.counts.historical.toLocaleString("ko-KR")}개`,
    `- 출력 크기: ${result.bytes.toLocaleString("ko-KR")} bytes`,
    "- 원본 파일은 복사하지 않았고 공개 배포본에도 포함하지 않습니다.",
  ].join("\n") + "\n");
}

module.exports = {
  buildIndex,
  importLegalCatalog,
  parseNameSections,
  validateManifest,
};

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`법령명 색인 생성 실패: ${error.message}\n`);
    process.exitCode = 1;
  });
}
