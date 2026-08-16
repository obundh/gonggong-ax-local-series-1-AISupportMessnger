const path = require("path");
const { buildLegalVectorIndex, LEGAL_VECTOR_SOURCES } = require("../../app/main/vector-search.cjs");

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    printHelp();
    return;
  }

  const started = Date.now();
  const manifest = await buildLegalVectorIndex({
    provider: args.provider,
    model: args.model,
    baseUrl: args.baseUrl,
    vectorDir: args.out,
    dimensions: args.dimensions,
    batchSize: args.batchSize,
    maxRecords: args.maxRecords,
    sources: args.sources,
    contains: args.contains,
    onProgress: progressPrinter(args.progressEvery),
  });

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    JSON.stringify(
      {
        ok: true,
        elapsedSeconds: Number(elapsed),
        output: path.resolve(args.out || "data/vector/legal-v1"),
        ...manifest,
      },
      null,
      2
    )
  );
}

function parseArgs(argv) {
  const args = {
    provider: "hash",
    model: "",
    baseUrl: "",
    out: "",
    dimensions: 1024,
    batchSize: 8,
    maxRecords: 0,
    sources: [],
    contains: [],
    progressEvery: 1000,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") args.help = true;
    else if (arg === "--provider") args.provider = String(next || "hash"), index += 1;
    else if (arg === "--model") args.model = String(next || ""), index += 1;
    else if (arg === "--base-url") args.baseUrl = String(next || ""), index += 1;
    else if (arg === "--out") args.out = String(next || ""), index += 1;
    else if (arg === "--dimensions") args.dimensions = Number(next || 1024), index += 1;
    else if (arg === "--batch-size") args.batchSize = Number(next || 8), index += 1;
    else if (arg === "--max-records") args.maxRecords = Number(next || 0), index += 1;
    else if (arg === "--source") args.sources.push(String(next || "")), index += 1;
    else if (arg === "--contains") args.contains.push(String(next || "")), index += 1;
    else if (arg === "--progress-every") args.progressEvery = Number(next || 1000), index += 1;
    else if (arg.startsWith("--provider=")) args.provider = arg.slice("--provider=".length);
    else if (arg.startsWith("--model=")) args.model = arg.slice("--model=".length);
    else if (arg.startsWith("--base-url=")) args.baseUrl = arg.slice("--base-url=".length);
    else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
    else if (arg.startsWith("--dimensions=")) args.dimensions = Number(arg.slice("--dimensions=".length));
    else if (arg.startsWith("--batch-size=")) args.batchSize = Number(arg.slice("--batch-size=".length));
    else if (arg.startsWith("--max-records=")) args.maxRecords = Number(arg.slice("--max-records=".length));
    else if (arg.startsWith("--source=")) args.sources.push(arg.slice("--source=".length));
    else if (arg.startsWith("--contains=")) args.contains.push(arg.slice("--contains=".length));
    else if (arg.startsWith("--progress-every=")) args.progressEvery = Number(arg.slice("--progress-every=".length));
  }

  args.sources = args.sources.filter(Boolean);
  args.contains = args.contains.filter(Boolean);
  return args;
}

function progressPrinter(progressEvery) {
  const interval = Number.isFinite(progressEvery) && progressEvery > 0 ? progressEvery : 1000;
  let last = 0;
  return ({ processed, indexed }) => {
    if (indexed - last < interval) return;
    last = indexed;
    console.error(`[legal-vector] processed=${processed} indexed=${indexed}`);
  };
}

function printHelp() {
  console.log(`Build local legal vector index.

Usage:
  node tools/legal-vector-index/build-index.cjs [options]

Options:
  --provider hash|ollama       Default: hash
  --model MODEL                Ollama embedding model. Default: nomic-embed-text
  --base-url URL               Ollama base URL. Default: http://127.0.0.1:11434
  --out DIR                    Output directory. Default: data/vector/legal-v1
  --dimensions N               Hash vector dimensions. Default: 1024
  --batch-size N               Ollama embedding batch size. Default: 8
  --max-records N              Stop after N indexed records. 0 means all.
  --source ID                  Repeatable. Available: ${LEGAL_VECTOR_SOURCES.map((source) => source.id).join(", ")}
  --contains TEXT              Repeatable. Index only records containing TEXT.
  --progress-every N           Print progress every N indexed records.

Examples:
  npm run legal:vector
  node tools/legal-vector-index/build-index.cjs --provider hash --source law
  node tools/legal-vector-index/build-index.cjs --provider ollama --model nomic-embed-text --max-records 5000
`);
}

main().catch((error) => {
  console.error(`[legal-vector] failed: ${error?.message || error}`);
  process.exitCode = 1;
});
