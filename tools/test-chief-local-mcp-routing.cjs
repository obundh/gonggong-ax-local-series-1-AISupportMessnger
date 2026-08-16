const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const MCP_CLIENT_PATH = path.join(ROOT_DIR, "app", "main", "mcp-client.cjs");
const LOCAL_SERVER_PATH = path.join(ROOT_DIR, "tools", "mcp-law", "server.cjs");
const LOCAL_ENGINE_PATH = path.join(ROOT_DIR, "tools", "mcp-law", "search-engine.cjs");
const { copyPortableData, copyPortableNotices } = require("./mcp-law/build-portable.cjs");
const { legalGroundingState } = require("../app/main/llm.cjs").__test;

function writeLawFixture(dataDir, options = {}) {
  const lawDir = path.join(dataDir, "law");
  const itemsDir = path.join(lawDir, "items");
  fs.mkdirSync(itemsDir, { recursive: true });
  const id = "LAW001";
  const lawName = options.lawName || "근로기준법";
  const text = options.text || "제17조(근로조건의 명시) 사용자는 근로계약을 체결할 때 근로조건을 명시하여야 한다.";
  const jsonl = `${JSON.stringify({
    id: `law:${id}:17`,
    target: "law",
    itemId: id,
    lawKey: id,
    lawName,
    itemTitle: lawName,
    articleNo: "17",
    text,
    sourceFile: `items/${id}.json`,
  })}\n`;
  fs.writeFileSync(path.join(lawDir, "search-index.jsonl"), jsonl, "utf8");
  const metadataBody = JSON.stringify([
    { key: id, id, mst: id, name: lawName, detailFile: `items/${id}.json` },
  ]);
  fs.writeFileSync(path.join(lawDir, "index.json"), metadataBody, "utf8");
  const detailBody = JSON.stringify({
    법령: { 법령명한글: lawName, 조문: [{ 조문번호: "001700", 조문제목: "근로조건의 명시", 조문내용: text }] },
  });
  fs.writeFileSync(path.join(itemsDir, `${id}.json`), detailBody, "utf8");
  fs.writeFileSync(path.join(lawDir, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    source: { name: "국가법령정보센터 로컬 테스트 corpus" },
    retrievedAt: new Date().toISOString(),
    target: "law",
    status: "done",
    counts: { listed: 1, detailFiles: 1, chunks: 1 },
    files: [
      { path: "search-index.jsonl", bytes: Buffer.byteLength(jsonl), sha256: crypto.createHash("sha256").update(jsonl).digest("hex") },
      { path: "index.json", bytes: Buffer.byteLength(metadataBody), sha256: crypto.createHash("sha256").update(metadataBody).digest("hex") },
      { path: `items/${id}.json`, bytes: Buffer.byteLength(detailBody), sha256: crypto.createHash("sha256").update(detailBody).digest("hex") },
    ],
  }), "utf8");
}

function writePrecedentFixture(dataDir, options = {}) {
  const directory = path.join(dataDir, "prec");
  const itemsDir = path.join(directory, "items");
  fs.mkdirSync(itemsDir, { recursive: true });
  const id = "PREC001";
  const title = options.title || "근로조건 판례";
  const text = options.text || "근로조건 명시 의무에 관한 로컬 판례 원문";
  const detailBody = JSON.stringify({ 사건명: title, 판례내용: text });
  const jsonl = `${JSON.stringify({
    id: `prec:${id}:document:1`, target: "prec", itemId: id,
    itemTitle: title, text,
    sourceFile: `items/${id}.json`,
  })}\n`;
  fs.writeFileSync(path.join(directory, "search-index.jsonl"), jsonl, "utf8");
  const metadataBody = JSON.stringify([
    { id, title, detailFile: `items/${id}.json` },
  ]);
  fs.writeFileSync(path.join(directory, "index.json"), metadataBody, "utf8");
  fs.writeFileSync(path.join(itemsDir, `${id}.json`), detailBody, "utf8");
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    source: { name: "국가법령정보센터 로컬 테스트 corpus" },
    retrievedAt: new Date().toISOString(),
    target: "prec",
    status: "complete",
    recordCount: 100,
    counts: { listed: 100, detailFiles: 1, selectedDetailFiles: 1, chunks: 1 },
    detailCoverage: { mode: "seed-plus-title-query-pack", listedCount: 100, selectedCount: 1, detailCount: 1 },
    files: [
      { path: "search-index.jsonl", bytes: Buffer.byteLength(jsonl), sha256: crypto.createHash("sha256").update(jsonl).digest("hex") },
      { path: "index.json", bytes: Buffer.byteLength(metadataBody), sha256: crypto.createHash("sha256").update(metadataBody).digest("hex") },
      { path: `items/${id}.json`, bytes: Buffer.byteLength(detailBody), sha256: crypto.createHash("sha256").update(detailBody).digest("hex") },
    ],
  }), "utf8");
}

function writeOfficialTermFixture(dataDir, name) {
  const directory = path.join(dataDir, "legal_terms");
  fs.mkdirSync(directory, { recursive: true });
  const record = {
    id: "lstrm:fixture-1",
    sourceTarget: "lstrm",
    sourceId: "1001",
    officialIds: ["1001"],
    listId: "fixture-1",
    name,
    normalizedName: name.replace(/\s+/g, ""),
    synonyms: [],
    normalizedSynonyms: [],
    definition: "",
    definitionStatus: "not-in-list-pack",
    relations: [],
    relationBodyStatus: "not-in-list-pack",
    homonymStatus: "unknown",
    note: "",
    lawTypeCode: "",
    dictionaryTypeCode: "",
    detailIdentifier: { parameter: "trmSeqs", value: "1001" },
    detailIdentifiers: [{ parameter: "trmSeqs", value: "1001" }],
    listOrdinal: 1,
  };
  const indexBody = `${JSON.stringify({ schemaVersion: 1, records: [record] }, null, 2)}\n`;
  const searchBody = `${JSON.stringify(record)}\n`;
  fs.writeFileSync(path.join(directory, "index.json"), indexBody, "utf8");
  fs.writeFileSync(path.join(directory, "search-index.jsonl"), searchBody, "utf8");
  const files = ["index.json", "search-index.jsonl"].map((fileName) => {
    const body = fs.readFileSync(path.join(directory, fileName));
    return { path: fileName, bytes: body.length, sha256: crypto.createHash("sha256").update(body).digest("hex") };
  });
  fs.writeFileSync(path.join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1,
    target: "official-legal-terms",
    status: "complete",
    packType: "list-index",
    generatedAt: "2026-08-16T00:00:00.000Z",
    retrievedAt: "2026-08-16T00:00:00.000Z",
    recordCount: 1,
    uniqueNormalizedNameCount: 1,
    duplicateNormalizedNameGroupCount: 0,
    ambiguousNormalizedNameGroupCount: 0,
    coverage: {
      lists: { status: "complete", recordCount: 1, expectedCount: 1 },
      definitions: { status: "list-only-partial", recordCount: 0, expectedListRecordCount: 1 },
      explicitSynonyms: { recordCount: 0 },
      relationReferences: { recordCount: 0, bodyCount: 0, status: "identifier-references-only" },
    },
    sources: {
      lstrm: { label: "fixture", apiTotal: 1, recordCount: 1, pageCount: 1, listComplete: true, officialIdentifierParameter: "trmSeqs" },
    },
    files,
  }), "utf8");
}

function copyPracticeTermFixture(dataDir) {
  const source = path.join(ROOT_DIR, "data", "legal_alias");
  const destination = path.join(dataDir, "legal_alias");
  fs.mkdirSync(destination, { recursive: true });
  for (const fileName of ["practice-terms.json", "practice-terms.manifest.json"]) {
    fs.copyFileSync(path.join(source, fileName), path.join(destination, fileName));
  }
}

test("김법률은 외부 인증이나 네트워크 없이 로컬 stdio MCP와 로컬 corpus만 사용한다", async () => {
  const emptyDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-empty-"));
  const installedDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-installed-"));
  writeLawFixture(installedDataDir);
  writePrecedentFixture(installedDataDir);

  const originalDataDir = process.env.HEYU_DATA_DIR;
  const credentialName = ["LAW", "OC"].join("_");
  const originalCredential = process.env[credentialName];
  const originalSpawn = childProcess.spawn;
  const originalExecFileSync = childProcess.execFileSync;
  const spawns = [];
  let registryReads = 0;

  childProcess.spawn = (command, args, options) => {
    spawns.push({ command, args: [...(args || [])], env: { ...(options?.env || {}) } });
    return originalSpawn(command, args, options);
  };
  childProcess.execFileSync = (...args) => {
    registryReads += 1;
    return originalExecFileSync(...args);
  };

  process.env[credentialName] = "must-not-enter-local-law-mcp";
  process.env.HEYU_DATA_DIR = emptyDataDir;
  delete require.cache[require.resolve(MCP_CLIENT_PATH)];
  const mcpClient = require(MCP_CLIENT_PATH);

  try {
    const serverSource = fs.readFileSync(LOCAL_SERVER_PATH, "utf8");
    const engineSource = fs.readFileSync(LOCAL_ENGINE_PATH, "utf8");
    assert.doesNotMatch(`${serverSource}\n${engineSource}`, /https?:\/\/|law\.go\.kr/i);
    assert.doesNotMatch(`${serverSource}\n${engineSource}`, new RegExp(credentialName, "i"));

    const missingContext = await mcpClient.buildOfficerMcpContext(
      { id: "chief" },
      "근기법 제17조",
      []
    );
    assert.match(missingContext, /법령 근거 경로: 로컬 김법률 MCP/);
    assert.match(missingContext, /외부 네트워크 조회를 사용하지 않음/);
    assert.match(missingContext, /로컬 MCP 상태: 실패 \(LOCAL_CORPUS_MISSING\)/);
    assert.match(missingContext, /로컬 법률 자료가 설치되지 않았습니다/);
    assert.match(missingContext, /조문·금액·기간·요건을 모델 지식으로 보충하거나 단정하지 않습니다/);
    assert.doesNotMatch(missingContext, /국가법령정보센터 실시간 조회/);

    mcpClient.shutdownOfficerMcp();
    process.env.HEYU_DATA_DIR = installedDataDir;

    const installedContext = await mcpClient.buildOfficerMcpContext(
      { id: "chief" },
      "근기법 제17조",
      []
    );
    assert.match(installedContext, /법령 근거 경로: 로컬 김법률 MCP/);
    assert.match(installedContext, /법령명 해석: 근기법 → 근로기준법/);
    assert.match(installedContext, /로컬 법률 자료 상태: 설치됨/);
    assert.match(installedContext, /제17조\(근로조건의 명시\)/);
    assert.doesNotMatch(installedContext, /국가법령정보센터 실시간 조회/);

    const partialBodyContext = await mcpClient.buildOfficerMcpContext(
      { id: "chief" },
      "근로조건 관련 판례",
      []
    );
    assert.match(partialBodyContext, /원문 범위 제한: 판례 목록 메타데이터 100건 중 상세 원문 1건만/);

    assert.ok(spawns.length >= 2, "chief local MCP process was not spawned for both corpus states");
    for (const spawn of spawns) {
      const serverPath = String(spawn.args[0] || "");
      assert.equal(path.basename(path.dirname(serverPath)), "mcp-law");
      assert.equal(path.basename(serverPath), "server.cjs");
      assert.equal(Object.prototype.hasOwnProperty.call(spawn.env, credentialName), false);
    }
    assert.equal(registryReads, 0, "chief route attempted to read a user credential from the registry");
  } finally {
    mcpClient.shutdownOfficerMcp();
    childProcess.spawn = originalSpawn;
    childProcess.execFileSync = originalExecFileSync;
    if (originalDataDir === undefined) delete process.env.HEYU_DATA_DIR;
    else process.env.HEYU_DATA_DIR = originalDataDir;
    if (originalCredential === undefined) delete process.env[credentialName];
    else process.env[credentialName] = originalCredential;
    for (const target of [emptyDataDir, installedDataDir]) {
      const resolved = path.resolve(target);
      if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
        fs.rmSync(resolved, { recursive: true, force: true });
      }
    }
  }
});

test("김법률 앱 경로는 명시적 용어 목록의 실무·공식·판례후보·미등록 결과를 모두 로컬에서 분리한다", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-terminology-"));
  const originalDataDir = process.env.HEYU_DATA_DIR;
  writeLawFixture(dataDir);
  writePrecedentFixture(dataDir, {
    title: "가상 판례문맥어 관련 판례",
    text: "판결 이유에서 가상 판례문맥어 표현이 직접 등장하지만 그 뜻을 정의하지는 않는다.",
  });
  writeOfficialTermFixture(dataDir, "가상 공식용어");
  copyPracticeTermFixture(dataDir);
  process.env.HEYU_DATA_DIR = dataDir;
  delete require.cache[require.resolve(MCP_CLIENT_PATH)];
  const mcpClient = require(MCP_CLIENT_PATH);

  try {
    const labels = ["기유", "가상 공식용어", "가상 판례문맥어", "가상 미등록용어"];
    const context = await mcpClient.buildOfficerMcpContext(
      { id: "chief" },
      `용어 뜻: ${labels.join(", ")} 각각 알려줘`,
      []
    );
    assert.match(context, /법령 근거 경로: 로컬 김법률 MCP/);
    assert.match(context, /외부 네트워크 조회를 사용하지 않음/);
    assert.match(context, /명시적 용어 목록 처리: 4건/);
    for (const label of labels) assert.ok(context.includes(label), `raw label was dropped: ${label}`);
    assert.ok(context.includes("기소유예"), "practice-dictionary formal name is missing");
    assert.match(context, /untrusted_official_term_json=/);
    assert.match(context, /untrusted_term_evidence_json=.*"target":"prec"/);

    const resolutions = [...context.matchAll(/untrusted_term_resolution_json=(\{[^\r\n]+\})/g)]
      .map((match) => JSON.parse(match[1]));
    assert.equal(resolutions.length, labels.length);
    const byLabel = new Map(resolutions.map((item) => [item.rawLabel, item]));
    assert.equal(byLabel.get("기유")?.status, "exact");
    assert.equal(byLabel.get("가상 공식용어")?.status, "exact");
    assert.equal(byLabel.get("가상 판례문맥어")?.status, "corpus-candidate");
    assert.equal(byLabel.get("가상 미등록용어")?.status, "unresolved");
  } finally {
    mcpClient.shutdownOfficerMcp();
    if (originalDataDir === undefined) delete process.env.HEYU_DATA_DIR;
    else process.env.HEYU_DATA_DIR = originalDataDir;
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
});

test("단일 용어 질문도 structured 판정을 사용하고 related-only 결과는 hydrate하거나 ground하지 않는다", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-single-term-"));
  const originalDataDir = process.env.HEYU_DATA_DIR;
  writeLawFixture(dataDir, {
    lawName: "더긴짧은표현결합 규칙",
    text: "더긴짧은표현결합 안쪽에 우연히 포함된 문자열일 뿐 독립된 용어 정의가 아니다.",
  });
  writePrecedentFixture(dataDir);
  copyPracticeTermFixture(dataDir);
  process.env.HEYU_DATA_DIR = dataDir;
  delete require.cache[require.resolve(MCP_CLIENT_PATH)];
  const mcpClient = require(MCP_CLIENT_PATH);

  try {
    const relatedContext = await mcpClient.buildOfficerMcpContext(
      { id: "chief" },
      "짧은표현 뜻이 뭐야?",
      []
    );
    const relatedResolution = JSON.parse(relatedContext.match(/untrusted_term_resolution_json=(\{[^\r\n]+\})/)?.[1] || "null");
    assert.equal(relatedResolution.rawLabel, "짧은표현");
    assert.equal(relatedResolution.status, "unresolved");
    assert.equal(relatedResolution.corpusCandidateCount, 0);
    assert.ok(relatedResolution.relatedCorpusCandidateCount > 0);
    assert.match(relatedContext, /관련 후보 .*뜻·정식명칭 근거로 사용하지 않음/);
    assert.doesNotMatch(relatedContext, /untrusted_term_detail_json=/);
    assert.ok(relatedContext.length < 10_000, `related-only context is too large: ${relatedContext.length}`);
    assert.equal(legalGroundingState([{ role: "system", content: relatedContext }]).grounded, false);

    const exactContext = await mcpClient.buildOfficerMcpContext(
      { id: "chief" },
      "기유 뜻이 뭐야?",
      []
    );
    const exactResolution = JSON.parse(exactContext.match(/untrusted_term_resolution_json=(\{[^\r\n]+\})/)?.[1] || "null");
    assert.equal(exactResolution.rawLabel, "기유");
    assert.equal(exactResolution.status, "exact");
    assert.deepEqual(exactResolution.formalNames, ["기소유예"]);
    assert.equal(legalGroundingState([{ role: "system", content: exactContext }]).grounded, true);
  } finally {
    mcpClient.shutdownOfficerMcp();
    if (originalDataDir === undefined) delete process.env.HEYU_DATA_DIR;
    else process.env.HEYU_DATA_DIR = originalDataDir;
    const resolved = path.resolve(dataDir);
    if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }
});

test("설치본과 portable은 공식 용어 팩 3파일 및 필수 라이선스 고지를 함께 포함한다", (t) => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-package-source-"));
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "heyu-law-package-output-"));
  t.after(() => {
    for (const target of [source, output]) {
      const resolved = path.resolve(target);
      if (resolved.startsWith(path.resolve(os.tmpdir()) + path.sep)) fs.rmSync(resolved, { recursive: true, force: true });
    }
  });
  writeLawFixture(source);
  writeOfficialTermFixture(source, "가상 배포검증용어");

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  const corpus = pkg.build.extraResources.find((entry) => entry?.to === "legal-corpus");
  assert.ok(corpus);
  for (const relative of [
    "legal_terms/manifest.json",
    "legal_terms/index.json",
    "legal_terms/search-index.jsonl",
  ]) assert.ok(corpus.filter.includes(relative), `${relative} missing from packaged corpus allowlist`);
  assert.ok(pkg.build.extraResources.some((entry) => entry?.from === "third_party/licenses" && entry?.to === "licenses"));
  assert.ok(pkg.build.extraResources.some((entry) => entry?.from === "THIRD_PARTY_NOTICES.md"));

  copyPortableData(source, path.join(output, "data"));
  for (const relative of [
    "data/legal_terms/manifest.json",
    "data/legal_terms/index.json",
    "data/legal_terms/search-index.jsonl",
  ]) assert.equal(fs.statSync(path.join(output, relative)).isFile(), true, relative);
  const notices = copyPortableNotices(output);
  assert.deepEqual(new Set(notices.files), new Set([
    "licenses/Korean-Legal-MCP-DATA-LICENSE.md",
    "licenses/korean-law-mcp-v4.10.0-MIT.txt",
    "THIRD_PARTY_NOTICES.md",
  ]));
});
