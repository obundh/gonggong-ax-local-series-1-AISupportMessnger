"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  parseArgs,
  redactString,
  redactObject,
  normalizeMeta,
  normalizeAliasRecord,
  isUsableDetail,
  buildChunks,
  contentDigest,
  pruneOrphanItems,
  inferListRetrievedAt,
  makeManifest,
  verifyTargetCorpus,
  promoteStagingTarget,
  detailMatchesMeta,
  assertCompleteListCount,
  containsSensitiveSeedMaterial,
  discoverCorpusSummaries,
  aliasCorpusStatus,
  countSelectedUnavailable,
  makeGate,
  replaceFile,
  TARGETS,
} = require("./official-law-sync/sync.cjs");

test("refuses command-line OC", () => {
  assert.throws(() => parseArgs(["--oc", "secret"]), /disabled/);
});

test("redacts OC in text and nested objects", () => {
  const secret = "very-secret-oc";
  assert.equal(redactString(`https://x/?OC=${secret}&target=law`, secret), "https://x/?OC=[REDACTED]&target=law");
  assert.deepEqual(redactObject({ x: secret, y: [`OC=${secret}`] }, secret), { x: "[REDACTED]", y: ["OC=[REDACTED]"] });
});

test("redacts credential-shaped keys even when they contain an older unknown secret", () => {
  const sanitized = redactObject({ OC: "old-oc", token: "old-token", nested: { apiKey: "old-key", Authorization: "Bearer old" }, title: "공개 제목" }, "current-oc");
  assert.deepEqual(sanitized, { OC: "[REDACTED]", token: "[REDACTED]", nested: { apiKey: "[REDACTED]", Authorization: "[REDACTED]" }, title: "공개 제목" });
});

test("legacy seed fast-copy rejects an older OC or credential-shaped key", () => {
  assert.equal(containsSensitiveSeedMaterial('{"OC":"old-token","data":{}}', "current-token"), true);
  assert.equal(containsSensitiveSeedMaterial('{"Authorization":"Bearer old","data":{}}', "current-token"), true);
  assert.equal(containsSensitiveSeedMaterial('{"url":"https://x/?OC=old-token&target=law"}', "current-token"), true);
  assert.equal(containsSensitiveSeedMaterial('{"url":"https://x/?OC=REDACTED&target=law","title":"공개"}', "current-token"), false);
});

test("normalizes the current administrative appeal identifier", () => {
  const item = { 행정심판재결례일련번호: "272887", 사건명: "정보공개 사건", 사건번호: "2026-1", 의결일자: "20260801" };
  const meta = normalizeMeta("decc", TARGETS.decc, item, "secret");
  assert.equal(meta.id, "272887");
  assert.equal(meta.title, "정보공개 사건");
});

test("rejects empty legacy detail wrappers", () => {
  assert.equal(isUsableDetail({ data: { Law: "일치하는 판례가 없습니다." } }), false);
  assert.equal(isUsableDetail({ data: { Law: { 사건명: "사건", 판례내용: "충분히 긴 판례 본문이 들어 있는 정상 응답입니다. 상세한 이유가 이어집니다." } } }), true);
});

test("builds bounded precedent chunks", () => {
  const chunks = buildChunks("prec", { id: "1", title: "사건", number: "1", date: "20260101", detailFile: "items/1.json" }, { 판시사항: "가".repeat(4000) });
  assert.ok(chunks.length >= 3);
  assert.ok(chunks.every((chunk) => chunk.text.length <= 1800));
  assert.ok(chunks.every((chunk) => chunk.itemId === "1"));
});

test("law chunks preserve current MST and law ID", () => {
  const chunks = buildChunks("law", { id: "288515", lawMst: "288515", lawId: "001817", title: "근로기준법", detailFile: "items/288515.json" }, { 조문내용: "제1조 목적과 적용 범위를 정한다." });
  assert.equal(chunks[0].itemId, "288515");
  assert.equal(chunks[0].lawMst, "288515");
  assert.equal(chunks[0].lawId, "001817");
});

test("fresh law wrappers bind by requested MST and law ID despite official effective-date display differences", () => {
  const wrapped = { schemaVersion: 1, target: "law", id: "288515", data: { 법령: { 기본정보: { 법령ID: "001817", 시행일자: "20261001" } } } };
  assert.equal(detailMatchesMeta("law", wrapped, { id: "288515", lawId: "001817", effectiveDate: "20260801" }), true);
  assert.equal(detailMatchesMeta("law", { 법령: { 기본정보: { 법령ID: "001817", 시행일자: "20261001" } } }, { id: "288515", lawId: "001817", effectiveDate: "20260801" }), false);
  assert.equal(detailMatchesMeta("law", { ...wrapped, id: "wrong" }, { id: "288515", lawId: "001817", effectiveDate: "20260801" }), false);
});

test("official alias payload can preserve rows without an abbreviation", () => {
  const rows = [
    normalizeAliasRecord({ 법령ID: "1", 법령일련번호: "10", 법령명한글: "근로기준법", 법령약칭명: "근기법" }),
    normalizeAliasRecord({ 법령ID: "2", 법령일련번호: "20", 법령명한글: "약칭 없는 법" }),
  ];
  const aliases = rows.filter((row) => row.officialName && row.shortName);
  assert.equal(rows.length, 2);
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].shortName, "근기법");
  assert.equal(aliasCorpusStatus({ apiTotal: 2, retrievedAt: "2026-08-16T00:00:00.000Z" }, rows), "complete");
  assert.equal(aliasCorpusStatus({ apiTotal: 2688, retrievedAt: "2026-08-16T00:00:00.000Z" }, rows), "partial");
  assert.equal(aliasCorpusStatus({ apiTotal: 2 }, rows), "partial");
});

test("content digest is deterministic", () => {
  const files = [{ path: "a", sha256: "1" }, { path: "b", sha256: "2" }];
  assert.equal(contentDigest(files), contentDigest(files));
});

test("orphan pruning is limited to direct JSON items and an exact current allowlist", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-prune-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, "10.json"), "{}", "utf8");
  fs.writeFileSync(path.join(root, "orphan.json"), "{}", "utf8");
  fs.writeFileSync(path.join(root, "keep.txt"), "not corpus", "utf8");
  assert.equal(pruneOrphanItems(root, [{ id: "10" }]), 1);
  assert.equal(fs.existsSync(path.join(root, "10.json")), true);
  assert.equal(fs.existsSync(path.join(root, "orphan.json")), false);
  assert.equal(fs.existsSync(path.join(root, "keep.txt")), true);
});

test("seed-only style rebuild preserves the actual old list retrieval time", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-stale-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const page = path.join(root, "000001.json");
  fs.writeFileSync(page, "{}", "utf8");
  const old = new Date("2025-01-02T03:04:05.000Z");
  fs.utimesSync(page, old, old);
  const retrievedAt = inferListRetrievedAt(root);
  const manifest = makeManifest("law", TARGETS.law, "complete", { listRetrievedAt: retrievedAt, updatedAt: new Date().toISOString(), listComplete: true },
    { listed: 1, detailFiles: 1, selectedDetailFiles: 1, chunks: 1 }, []);
  assert.equal(manifest.retrievedAt, old.toISOString());
  assert.notEqual(manifest.builtAt, manifest.retrievedAt);
});

test("failed refresh verification leaves the active target byte-for-byte unchanged", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-refresh-fail-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const active = path.join(root, "law");
  const staging = path.join(root, ".official-law-staging", "law-test");
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(active, "marker.txt"), "old-complete-bytes", "utf8");
  fs.writeFileSync(path.join(staging, "manifest.json"), JSON.stringify({ status: "partial" }), "utf8");
  assert.throws(() => verifyTargetCorpus(staging), /not complete/);
  assert.equal(fs.readFileSync(path.join(active, "marker.txt"), "utf8"), "old-complete-bytes");
});

test("verified refresh promotion swaps the whole target and retains a recovery backup", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-refresh-ok-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const active = path.join(root, "law");
  const staging = path.join(root, ".official-law-staging", "law-test");
  fs.mkdirSync(active, { recursive: true });
  fs.mkdirSync(staging, { recursive: true });
  fs.writeFileSync(path.join(active, "marker.txt"), "old", "utf8");
  fs.writeFileSync(path.join(staging, "marker.txt"), "new", "utf8");
  const result = promoteStagingTarget(active, staging, root, "law");
  assert.equal(fs.readFileSync(path.join(active, "marker.txt"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(result.backup, "marker.txt"), "utf8"), "old");
});

test("non-law cache identity must match the official nested identifier", () => {
  const wrong = { format: "JSON", data: { ExpcService: { 법령해석례일련번호: "999", 안건명: "다른 해석례", 이유: "충분히 긴 다른 해석례 본문입니다. 잘못 연결되면 안 됩니다." } } };
  assert.equal(detailMatchesMeta("expc", wrong, { id: "123" }), false);
  assert.equal(detailMatchesMeta("expc", wrong, { id: "999" }), true);
  assert.equal(detailMatchesMeta("expc", { data: { ExpcService: { 안건명: "식별자 없는 문서", 이유: "긴 본문이 있어도 식별자가 없으면 거부합니다." } } }, { id: "123" }), false);
  assert.equal(detailMatchesMeta("expc", { target: "expc", id: "123", data: { ExpcService: { 법령해석례일련번호: "999", 안건명: "다른 해석례" } } }, { id: "123" }), false);
  assert.equal(detailMatchesMeta("expc", { target: "expc", id: "123", data: { ExpcService: { 법령해석례일련번호: "123", 안건명: "정상 해석례" } } }, { id: "123" }), true);
});

test("a completed list cannot pass when deduplicated records differ from apiTotal", () => {
  const state = { listComplete: true, apiTotal: 100, status: "running" };
  assert.throws(() => assertCompleteListCount(state, 99), /count mismatch/);
  assert.equal(state.listComplete, false);
  assert.equal(state.status, "partial-count-mismatch");
  assert.equal(assertCompleteListCount({ listComplete: true, apiTotal: 100 }, 100), true);
});

test("unavailable detail receipts count only IDs in the current selection", () => {
  assert.equal(countSelectedUnavailable(["1", "2"], ["2", "2", "stale"]), 1);
  assert.equal(countSelectedUnavailable(["1"], ["stale"]), 0);
});

test("concurrent callers share one minimum request-start gate", async () => {
  const gate = makeGate(20);
  const starts = [];
  await Promise.all([1, 2, 3].map(async () => {
    await gate();
    starts.push(Date.now());
  }));
  assert.ok(starts[1] - starts[0] >= 15, `first gap was ${starts[1] - starts[0]}ms`);
  assert.ok(starts[2] - starts[1] >= 15, `second gap was ${starts[2] - starts[1]}ms`);
});

test("Windows-style transient destination locks are retried without deleting the active file", { skip: process.platform !== "win32" }, (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-replace-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = path.join(root, "state.json"), tmp = path.join(root, "state.tmp");
  fs.writeFileSync(target, "old", "utf8");
  fs.writeFileSync(tmp, "new", "utf8");
  const rename = fs.renameSync;
  let calls = 0;
  fs.renameSync = (...args) => {
    calls += 1;
    if (calls <= 2) { const error = new Error("locked"); error.code = "EBUSY"; throw error; }
    return rename(...args);
  };
  try { replaceFile(tmp, target); } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(target, "utf8"), "new");
  assert.equal(calls, 3);
});

test("integrated corpus manifest discovery retains completed targets from earlier runs", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-corpus-manifest-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "law"), { recursive: true });
  fs.mkdirSync(path.join(root, "legal_alias"), { recursive: true });
  fs.writeFileSync(path.join(root, "law", "manifest.json"), JSON.stringify({ target: "law", status: "complete", recordCount: 5611, detailCount: 5611, retrievedAt: "2026-08-16T00:00:00.000Z", contentSha256: "a".repeat(64) }), "utf8");
  fs.writeFileSync(path.join(root, "legal_alias", "official-aliases.manifest.json"), JSON.stringify({ target: "lsAbrv", status: "complete", recordCount: 2685, retrievedAt: "2026-08-16T00:01:00.000Z", contentSha256: "b".repeat(64) }), "utf8");
  const summaries = discoverCorpusSummaries(root, [{ target: "lsAbrv", status: "complete", count: 2685, manifest: "legal_alias/official-aliases.manifest.json" }]);
  assert.deepEqual(summaries.map((item) => item.target), ["law", "lsAbrv"]);
  assert.equal(summaries[0].count, 5611);
  assert.equal(summaries[1].manifest, "legal_alias/official-aliases.manifest.json");
});
