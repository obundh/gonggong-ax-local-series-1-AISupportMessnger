"use strict";

// Offline-only synthetic benchmark for the local legal search cache.
// Example:
//   node tools/mcp-law/benchmark-search-cache.cjs --records=221954 --cache-mb=512

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");

const args = Object.fromEntries(process.argv.slice(2).map((item) => {
  const [key, value = "true"] = item.replace(/^--/, "").split("=", 2);
  return [key, value];
}));
const recordCount = clamp(args.records, 1_000, 500_000, 221_954);
const repetitions = clamp(args.repetitions, 4, 80, 32);
const cacheMb = clamp(args["cache-mb"], 64, 1_024, 512);
const keep = args.keep === "true";
const root = args.dir ? path.resolve(args.dir) : fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-search-bench-"));
process.env.HEYU_LOCAL_LEGAL_SEARCH_CACHE_MB = String(cacheMb);

async function main() {
  const lawDir = path.join(root, "law");
  fs.mkdirSync(lawDir, { recursive: true });
  const indexPath = path.join(lawDir, "search-index.jsonl");
  const fd = fs.openSync(indexPath, "w");
  const digest = crypto.createHash("sha256");
  try {
    for (let index = 0; index < recordCount; index += 1) {
      const marker = index === Math.floor(recordCount / 2) ? " 고유검색어 " : " ";
      const text = `${"일반 법률 자료 ".repeat(repetitions)}${marker}${index}`;
      const line = `${JSON.stringify({
        id: `law:BENCH-${index}:document:1`,
        itemId: `BENCH-${index}`,
        title: `가상법령 ${index % 97}`,
        articleNo: String(index % 300),
        text,
        sourceFile: "",
      })}\n`;
      fs.writeSync(fd, line, null, "utf8");
      digest.update(line, "utf8");
    }
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const indexBody = JSON.stringify([{ id: "BENCH-0", title: "가상법령" }]);
  fs.writeFileSync(path.join(lawDir, "index.json"), indexBody, "utf8");
  const indexStat = fs.statSync(indexPath);
  const manifest = {
    schemaVersion: 1,
    source: { name: "offline synthetic benchmark" },
    retrievedAt: new Date().toISOString(),
    target: "law",
    status: "complete",
    counts: { listed: 1, detailFiles: 0, chunks: recordCount },
    files: [
      { path: "search-index.jsonl", bytes: indexStat.size, sha256: digest.digest("hex") },
      { path: "index.json", bytes: Buffer.byteLength(indexBody), sha256: sha256(indexBody) },
    ],
  };
  fs.writeFileSync(path.join(lawDir, "manifest.json"), JSON.stringify(manifest), "utf8");

  // Require after setting the cache budget so this script also works in a reused shell.
  const { searchLegal } = require("./search-engine.cjs");
  const timings = [];
  for (let run = 0; run < 3; run += 1) {
    const started = performance.now();
    const result = await searchLegal("고유검색어", { dataDir: root, target: "law", limit: 3, maxAgeDays: 3650 });
    timings.push(Math.round((performance.now() - started) * 100) / 100);
    if (result.results[0]?.id !== `BENCH-${Math.floor(recordCount / 2)}`) throw new Error("benchmark result mismatch");
  }
  const memory = process.memoryUsage();
  process.stdout.write(`${JSON.stringify({
    records: recordCount,
    indexMiB: Math.round(indexStat.size / 1024 / 1024 * 100) / 100,
    cacheBudgetMiB: cacheMb,
    firstMs: timings[0],
    warmMs: timings[1],
    warm2Ms: timings[2],
    rssMiB: Math.round(memory.rss / 1024 / 1024 * 100) / 100,
    heapUsedMiB: Math.round(memory.heapUsed / 1024 / 1024 * 100) / 100,
    directory: keep ? root : "removed",
  }, null, 2)}\n`);
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

main().finally(() => {
  if (!keep && !args.dir) fs.rmSync(root, { recursive: true, force: true });
}).catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
