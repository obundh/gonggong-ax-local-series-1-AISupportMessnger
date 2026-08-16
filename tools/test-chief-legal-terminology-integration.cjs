"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

const {
  callExplicitLocalLegalTerms,
  formatExplicitLocalLegalTermsContext,
  requestTimeoutForTool,
  runWithLocalLawDeadline,
  summarizeExplicitTermResolution,
  timeoutPolicy,
} = require("../app/main/mcp-client.cjs").__test;
const {
  buildLegalQueryRoute,
  buildDeterministicLegalTerminologyFallback,
  extractLegalRepairEvidence,
  extractLegalTerminologyRequirements,
  legalGroundingState,
  legalOutputIssues,
  repairLegalAnswerIfNeeded,
} = require("../app/main/llm.cjs").__test;

const ROOT = path.resolve(__dirname, "..");

function toolResult(structuredContent, marker = "") {
  return {
    structuredContent,
    content: [{ type: "text", text: marker }],
  };
}

function practiceResult(query, status, matches) {
  return toolResult({ query, resolutionStatus: status, matches }, matches.map((item, index) => (
    `${index + 1}. untrusted_practice_json=${JSON.stringify(item)}`
  )).join("\n"));
}

function officialResult(query, status, matches) {
  return toolResult({ query, resolutionStatus: status, matches }, matches.map((item, index) => (
    `${index + 1}. untrusted_official_term_json=${JSON.stringify(item)}`
  )).join("\n"));
}

function corpusResult(target, results) {
  return toolResult({
    results,
    sources: [{ id: target, label: target === "law" ? "법령" : "판례", available: true }],
  });
}

test("로컬 김법률 용어 조회만 60초 창을 사용하고 35초 지연은 성공하며 다른 MCP 제한은 유지한다", async (t) => {
  assert.equal(requestTimeoutForTool("legal_search"), timeoutPolicy.localLawRequestMs);
  assert.ok(timeoutPolicy.localLawRequestMs >= 60_000);
  assert.ok(timeoutPolicy.terminologyLocalLawTotalMs >= 60_000);
  assert.equal(timeoutPolicy.ordinaryLocalLawTotalMs, 28_000);
  for (const tool of ["law_center_search", "admin_law_search", "translator_context"]) {
    assert.equal(requestTimeoutForTool(tool), timeoutPolicy.defaultRequestMs);
    assert.equal(requestTimeoutForTool(tool), 30_000);
  }

  t.mock.timers.enable({ apis: ["setTimeout"] });
  const delayed = runWithLocalLawDeadline(
    () => new Promise((resolve) => setTimeout(() => resolve("local-law-complete"), 35_000)),
    { timeoutMs: timeoutPolicy.terminologyLocalLawTotalMs }
  );
  await Promise.resolve();
  t.mock.timers.tick(35_000);
  assert.equal(await delayed, "local-law-complete");
});

test("로컬 김법률 제한 초과 시 timeout 오류와 자식 정리 콜백을 한 번 실행한다", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let cleanupCalls = 0;
  const pending = runWithLocalLawDeadline(
    () => new Promise(() => {}),
    {
      timeoutMs: timeoutPolicy.terminologyLocalLawTotalMs,
      onTimeout: () => { cleanupCalls += 1; },
    }
  );
  await Promise.resolve();
  t.mock.timers.tick(timeoutPolicy.terminologyLocalLawTotalMs);
  await assert.rejects(pending, (error) => error?.code === "LOCAL_MCP_TIMEOUT");
  assert.equal(cleanupCalls, 1);
});

test("단일 용어 원문은 저문맥 query rewrite 모델을 거치지 않고 그대로 로컬 MCP로 전달한다", async () => {
  const originalFetch = global.fetch;
  let fetchCalls = 0;
  global.fetch = async () => {
    fetchCalls += 1;
    throw new Error("rewrite endpoint must not be called");
  };
  try {
    const route = await buildLegalQueryRoute(
      { id: "chief" },
      "약명 뜻이 뭐야?",
      [],
      { provider: "ollama", baseUrl: "http://127.0.0.1:11434", model: "fixture", timeoutMs: 1_000 }
    );
    assert.deepEqual(route, {
      searchText: "약명 뜻이 뭐야?",
      liveSearchText: "약명 뜻이 뭐야?",
      contextText: "",
    });
    assert.equal(fetchCalls, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("각 명시 용어는 실무 exact, 공식 exact, 다의어, 판례 후보, 미등록을 서로 섞지 않고 판정한다", () => {
  const highPractice = summarizeExplicitTermResolution(
    { rawLabel: "첫표현", key: "첫표현" },
    practiceResult("첫표현", "exact", [{
      id: "practice:1", sourceLayer: "practice-dictionary", matchedKey: "첫표현",
      term: "첫표현", formalName: "첫 번째 정식명칭", confidence: "높음",
    }]),
    officialResult("첫표현", "none", []),
    []
  );
  assert.equal(highPractice.status, "exact");
  assert.deepEqual(highPractice.formalNames, ["첫 번째 정식명칭"]);

  const exactOfficial = summarizeExplicitTermResolution(
    { rawLabel: "둘째표현", key: "둘째표현" },
    practiceResult("둘째표현", "none", []),
    officialResult("둘째표현", "exact", [{
      id: "official:2", matchedKey: "둘째표현", term: "둘째표현", formalName: "둘째표현",
      matchKind: "query-exact", confidence: "official-list-exact",
    }]),
    []
  );
  assert.equal(exactOfficial.status, "exact");
  assert.deepEqual(exactOfficial.formalNames, ["둘째표현"]);

  const ambiguous = summarizeExplicitTermResolution(
    { rawLabel: "겹친표현", key: "겹친표현" },
    practiceResult("겹친표현", "ambiguous", [
      { id: "practice:3a", sourceLayer: "practice-dictionary", matchedKey: "겹친표현", formalName: "첫 후보", confidence: "높음" },
      { id: "practice:3b", sourceLayer: "practice-dictionary", matchedKey: "겹친표현", formalName: "둘째 후보", confidence: "높음" },
    ]),
    officialResult("겹친표현", "none", []),
    []
  );
  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.formalNames, []);
  assert.deepEqual(new Set(ambiguous.candidateFormalNames), new Set(["첫 후보", "둘째 후보"]));

  const precedentOnly = summarizeExplicitTermResolution(
    { rawLabel: "판례문맥표현", key: "판례문맥표현" },
    practiceResult("판례문맥표현", "none", []),
    officialResult("판례문맥표현", "none", []),
    [corpusResult("prec", [{
      target: "prec", id: "prec:fixture", title: "판례 fixture",
      excerpt: "이 판결문에는 판례문맥표현이라는 문구가 등장하지만 정의하지는 않는다.",
    }])]
  );
  assert.equal(precedentOnly.status, "corpus-candidate");
  assert.equal(precedentOnly.formalNames.length, 0);
  assert.equal(precedentOnly.corpusEvidence[0].target, "prec");

  const unknown = summarizeExplicitTermResolution(
    { rawLabel: "미등록표현", key: "미등록표현" },
    practiceResult("미등록표현", "none", []),
    officialResult("미등록표현", "none", []),
    [corpusResult("law", [{ target: "law", id: "law:fixture", title: "무관한 법률", excerpt: "표현 일부만 있다." }])]
  );
  assert.equal(unknown.status, "unresolved");
  assert.deepEqual(unknown.candidateFormalNames, []);

  const embeddedSubstring = summarizeExplicitTermResolution(
    { rawLabel: "짧은표현", key: "짧은표현" },
    practiceResult("짧은표현", "none", []),
    officialResult("짧은표현", "none", []),
    [corpusResult("prec", [{
      target: "prec", id: "prec:substring", title: "무관한 사건",
      excerpt: "더긴짧은표현결합어 안쪽에만 우연히 들어 있다.",
    }])]
  );
  assert.equal(embeddedSubstring.status, "unresolved", "embedded substring must not become a semantic candidate");
  assert.equal(embeddedSubstring.corpusCandidateCount, 0);
  assert.equal(embeddedSubstring.relatedCorpusCandidateCount, 1);
  assert.equal(embeddedSubstring.relatedCorpusEvidence[0].matchQuality, "related");
});

test("다중 용어 원문 검색은 한 번의 로컬 batch 호출로 각 term 결과를 분리한다", async () => {
  const calls = [];
  const terms = [
    { rawLabel: "목록표현하나", key: "목록표현하나" },
    { rawLabel: "목록표현둘", key: "목록표현둘" },
    { rawLabel: "목록표현셋", key: "목록표현셋" },
  ];
  const client = {
    async callToolResult(name, input) {
      calls.push({ name, input });
      if (name === "resolve_legal_term" || name === "search_official_legal_terms") {
        return toolResult({ query: input.query, resolutionStatus: "none", matches: [] });
      }
      if (name === "legal_search_batch") {
        return toolResult({
          searches: input.terms.map((query, index) => ({
            index,
            query,
            results: index === 1 ? [{
              target: "prec", id: "prec:batch", title: "판례 후보",
              excerpt: `문장 앞에서 ${query} 표현이 직접 등장한다.`,
            }] : [],
          })),
          sources: [{ id: "prec", label: "판례", available: true }],
        });
      }
      throw new Error(`unexpected tool: ${name}`);
    },
  };

  const context = await callExplicitLocalLegalTerms(client, { resolution: { status: "none" } }, terms);
  const batches = calls.filter((call) => call.name === "legal_search_batch");
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].input.terms, terms.map((term) => term.rawLabel));
  assert.equal(calls.some((call) => call.name === "legal_search"), false);
  for (const term of terms) assert.ok(context.includes(term.rawLabel));
  assert.match(context, /"rawLabel":"목록표현둘","status":"corpus-candidate"/);
});

test("batch direct 문서만 최대 범위 상세 조회하고 related 부분문자열 후보는 hydrate하지 않는다", async () => {
  const calls = [];
  const terms = [
    { rawLabel: "직접문맥어", key: "직접문맥어" },
    { rawLabel: "짧은부분어", key: "짧은부분어" },
  ];
  const client = {
    async callToolResult(name, input) {
      calls.push({ name, input });
      if (name === "resolve_legal_term" || name === "search_official_legal_terms") {
        return toolResult({ query: input.query, resolutionStatus: "none", matches: [] });
      }
      if (name === "legal_search_batch") {
        return toolResult({
          searches: [
            { index: 0, query: terms[0].rawLabel, results: [{
              target: "prec", id: "prec:direct", title: "직접 판례",
              excerpt: "문장 앞에서 직접문맥어가 등장한다.", directPhraseMatch: true, matchQuality: "direct",
            }] },
            { index: 1, query: terms[1].rawLabel, results: [{
              target: "law", id: "law:related", title: "더긴짧은부분어결합",
              excerpt: "더긴짧은부분어결합 안에만 들어 있다.", directPhraseMatch: false, matchQuality: "related",
            }] },
          ],
          sources: [
            { id: "law", label: "법령", available: true },
            { id: "prec", label: "판례", available: true },
          ],
        });
      }
      if (name === "law_get") {
        return toolResult({
          target: input.target,
          title: "직접 판례",
          text: "직접문맥어가 쓰인 판결 이유의 제한된 로컬 문맥",
          keywordFound: true,
          provenance: { collectedAt: "2026-08-16T00:00:00.000Z", documentHash: "a".repeat(64) },
        });
      }
      throw new Error(`unexpected tool: ${name}`);
    },
  };

  const context = await callExplicitLocalLegalTerms(client, { resolution: { status: "none" } }, terms);
  const detailCalls = calls.filter((call) => call.name === "law_get");
  assert.equal(detailCalls.length, 1);
  assert.equal(detailCalls[0].input.id, "prec:direct");
  assert.equal(detailCalls[0].input.maxChars, 1600);
  assert.match(context, /untrusted_term_detail_json=.*"id":"prec:direct"/);
  assert.doesNotMatch(context, /untrusted_term_detail_json=.*law:related/);
  assert.match(context, /관련 후보 .*뜻·정식명칭 근거로 사용하지 않음/);

  const deadlineCalls = [];
  const deadlineClient = {
    async callToolResult(name, input) {
      deadlineCalls.push({ name, input });
      if (name === "resolve_legal_term" || name === "search_official_legal_terms") {
        return toolResult({ query: input.query, resolutionStatus: "none", matches: [] });
      }
      if (name === "legal_search_batch") {
        return toolResult({
          searches: terms.map((term, index) => ({ index, query: term.rawLabel, results: [{
            target: "prec", id: `prec:deadline-${index}`, title: "직접 판례",
            excerpt: `${term.rawLabel} 직접 문맥`, directPhraseMatch: true, matchQuality: "direct",
          }] })),
          sources: [{ id: "prec", label: "판례", available: true }],
        });
      }
      throw new Error(`detail call crossed deadline reserve: ${name}`);
    },
  };
  const deadlineContext = await callExplicitLocalLegalTerms(
    deadlineClient,
    { resolution: { status: "none" } },
    terms,
    { deadlineAt: Date.now() + 1000 }
  );
  assert.equal(deadlineCalls.some((call) => call.name === "law_get"), false);
  assert.doesNotMatch(deadlineContext, /untrusted_term_detail_json=/);
});

test("한 요청의 모든 원래 용어 표기와 각 로컬 계층 결과를 컨텍스트에 남긴다", () => {
  const fixtures = [
    {
      term: { rawLabel: "실무표현", key: "실무표현" },
      practiceResult: practiceResult("실무표현", "exact", [{
        id: "p:1", sourceLayer: "practice-dictionary", matchedKey: "실무표현",
        formalName: "실무 정식명칭", confidence: "높음",
      }]),
      officialTermResult: officialResult("실무표현", "none", []),
      corpusResults: [corpusResult("law", [])], corpusErrors: [],
    },
    {
      term: { rawLabel: "공식표현", key: "공식표현" },
      practiceResult: practiceResult("공식표현", "none", []),
      officialTermResult: officialResult("공식표현", "exact", [{
        id: "o:2", matchedKey: "공식표현", formalName: "공식표현",
        matchKind: "query-exact", confidence: "official-list-exact",
      }]),
      corpusResults: [corpusResult("prec", [])], corpusErrors: [],
    },
    {
      term: { rawLabel: "모르는표현", key: "모르는표현" },
      practiceResult: practiceResult("모르는표현", "none", []),
      officialTermResult: officialResult("모르는표현", "none", []),
      corpusResults: [corpusResult("law", []), corpusResult("prec", [])], corpusErrors: [],
    },
  ];
  for (const row of fixtures) {
    row.resolution = summarizeExplicitTermResolution(row.term, row.practiceResult, row.officialTermResult, row.corpusResults);
  }
  const context = formatExplicitLocalLegalTermsContext({ resolution: { status: "none" } }, fixtures);
  for (const label of fixtures.map((row) => row.term.rawLabel)) assert.ok(context.includes(label));
  assert.match(context, /untrusted_practice_json=/);
  assert.match(context, /untrusted_official_term_json=/);
  assert.match(context, /"rawLabel":"모르는표현","status":"unresolved"/);
  assert.match(context, /원래 표기를 보존해 각 용어를 개별 조회/);
  assert.match(context, /law, 판례|법령, prec|법령, 판례/);
});

test("김법률 답변 검수는 모든 exact 정식명칭과 용어별 다의·미해결 표시를 요구한다", () => {
  const system = [
    "법령 근거 경로: 로컬 김법률 MCP",
    `1. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "첫표현", status: "exact", formalNames: ["첫 정식명칭"] })}`,
    `2. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "둘째표현", status: "exact", formalNames: ["둘째 정식명칭"] })}`,
    `3. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "겹친표현", status: "ambiguous", formalNames: [] })}`,
    `4. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "미등록표현", status: "unresolved", formalNames: [] })}`,
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  assert.deepEqual(extractLegalTerminologyRequirements(messages), {
    requiredRawLabels: ["첫표현", "둘째표현"],
    requiredFormalNames: ["첫 정식명칭", "둘째 정식명칭"],
    nonExactTerms: [
      { rawLabel: "겹친표현", status: "ambiguous" },
      { rawLabel: "미등록표현", status: "unresolved" },
    ],
    officialNamesWithoutDefinition: [],
  });

  const good = [
    "첫표현의 정식명칭은 첫 정식명칭입니다. 둘째표현은 둘째 정식명칭으로 확인됩니다.",
    "겹친표현은 다의어라 여러 후보 중 하나로 확정할 수 없고 문맥 확인이 필요합니다.",
    "미등록표현은 동봉 자료에서 찾지 못한 미해결 용어이므로 뜻을 추정하지 않습니다.",
    "각 결과는 로컬 목록과 로컬 원문 보조 검색 범위 안에서만 정리했습니다.",
  ].join("\n");
  assert.deepEqual(legalOutputIssues(good, "각 용어 뜻 알려줘", messages), []);

  const bad = "첫표현은 첫 정식명칭입니다. 겹친표현은 무조건 하나의 뜻입니다. 미등록표현은 제가 추정한 뜻입니다. 이 답변은 충분한 분량을 맞추기 위한 추가 설명을 포함합니다.";
  const issues = legalOutputIssues(bad, "각 용어 뜻 알려줘", messages);
  assert.ok(issues.some((item) => item.includes("둘째 정식명칭")));
  assert.ok(issues.some((item) => item.includes("다의어를 하나로 확정")));
  assert.ok(issues.some((item) => item.includes("확인되지 않은 용어")));

  const missingOriginalLabel = [
    "첫표현의 정식명칭은 첫 정식명칭입니다. 이어서 둘째 정식명칭도 로컬 목록에서 확인했습니다.",
    "겹친표현은 다의어라 하나로 확정할 수 없으며, 미등록표현은 찾지 못해 뜻을 추정하지 않습니다.",
    "각 결과는 동봉된 로컬 자료 범위에서만 정리했고 문맥이 추가되면 다시 구분해야 합니다.",
  ].join("\n");
  assert.ok(legalOutputIssues(missingOriginalLabel, "각 용어 뜻 알려줘", messages)
    .some((item) => item === "확정 용어 원문 표기 누락: 둘째표현"));
});

test("공식 목록 exact라도 정의 미수록이면 표제어 존재와 의미 확인을 구분한다", () => {
  const system = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "로컬 MCP 상태: 성공",
    `1. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "공식약칭", status: "exact", formalNames: ["공식 정식명칭"] })}`,
    `- untrusted_official_term_json=${JSON.stringify({
      formalName: "공식 정식명칭", term: "공식 정식명칭", matchedKey: "공식약칭",
      matchKind: "query-exact", confidence: "official-list-exact", definitionStatus: "not-in-list-pack",
    })}`,
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  const requirements = extractLegalTerminologyRequirements(messages);
  assert.deepEqual(requirements.requiredRawLabels, ["공식약칭"]);
  assert.deepEqual(requirements.requiredFormalNames, ["공식 정식명칭"]);
  assert.deepEqual(requirements.officialNamesWithoutDefinition, ["공식 정식명칭"]);

  const good = "공식약칭의 공식 표제어와 정식명칭은 공식 정식명칭으로 확인됩니다. 다만 동봉된 공식 목록에는 정의 본문이 포함되지 않아 뜻과 법적 의미는 이 근거만으로 확정할 수 없습니다. 법령과 판례의 직접 문맥도 정식명칭 매핑과는 구분해야 합니다.";
  assert.deepEqual(legalOutputIssues(good, "공식약칭 뜻", messages), []);

  const bad = "공식약칭의 공식 정식명칭은 공식 정식명칭입니다. 이 말은 언제나 특정한 법적 효과가 생긴다는 뜻이며 예외 없이 같은 의미입니다. 공식 목록이므로 이 설명은 충분히 확정할 수 있습니다.";
  assert.ok(legalOutputIssues(bad, "공식약칭 뜻", messages)
    .some((item) => item.includes("정의 본문이 없는 용어")));

  const practiceBacked = `${system}\n- untrusted_practice_json=${JSON.stringify({
    formalName: "공식 정식명칭", confidence: "높음", meaning: "동봉 실무 사전의 검토된 의미",
  })}`;
  assert.deepEqual(
    extractLegalTerminologyRequirements([{ role: "system", content: practiceBacked }]).officialNamesWithoutDefinition,
    []
  );
});

test("구조화 안전 fallback은 high 근거만 뜻으로 쓰고 exact·다의·문맥후보·미해결을 결정적으로 구분한다", () => {
  const resolutions = [
    { rawLabel: "소취", status: "corpus-candidate", formalNames: [], candidateFormalNames: ["소 취하"] },
    { rawLabel: "통신영장", status: "ambiguous", formalNames: [], candidateFormalNames: [] },
    { rawLabel: "약명", status: "unresolved", formalNames: [], candidateFormalNames: [] },
    { rawLabel: "공소취소", status: "exact", formalNames: ["공소취소"], candidateFormalNames: ["공소취소"] },
    { rawLabel: "부제소합의", status: "corpus-candidate", formalNames: [], candidateFormalNames: [] },
  ];
  const system = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    ...resolutions.map((item, index) => `${index + 1}. untrusted_term_resolution_json=${JSON.stringify(item)}`),
    `- untrusted_practice_json=${JSON.stringify({
      sourceLayer: "practice-dictionary", matchedKey: "소취", formalName: "소 취하",
      confidence: "중간", meaning: "이 중간 신뢰 뜻은 안전 fallback에서 확정 설명으로 쓰면 안 됩니다",
    })}`,
    `- untrusted_official_term_json=${JSON.stringify({
      sourceLayer: "official-legal-terminology-list", matchedKey: "공소취소", term: "공소취소",
      formalName: "공소취소", confidence: "official-list-exact", matchKind: "query-exact",
      definitionStatus: "not-in-list-pack",
    })}`,
    `- untrusted_term_evidence_json=${JSON.stringify({ rawLabel: "소취", target: "prec", directPhraseMatch: true })}`,
    `- untrusted_term_evidence_json=${JSON.stringify({ rawLabel: "부제소합의", target: "prec", directPhraseMatch: true })}`,
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  const answer = buildDeterministicLegalTerminologyFallback(
    messages,
    "소취, 통신영장, 약명, 공소취소, 부제소합의 각각 뜻과 정식 명칭 알려줘"
  );

  for (const label of resolutions.map((item) => item.rawLabel)) assert.ok(answer.includes(label));
  assert.match(answer, /소 취하.*확정명이 아닙니다/);
  assert.doesNotMatch(answer, /이 중간 신뢰 뜻은/);
  assert.match(answer, /공소취소.*공식 목록.*정식명칭.*공소취소/);
  assert.match(answer, /정의 본문이 미수록/);
  assert.match(answer, /통신영장.*다의어/);
  assert.match(answer, /약명.*확인하지 못/);
  assert.match(answer, /부제소합의.*뜻이나 정식명칭을 확정하지 않고 추정하지 않습니다/);
  assert.doesNotMatch(answer, /untrusted_[a-z_]+_json=/);
  assert.deepEqual(legalOutputIssues(answer, "각 용어 뜻 알려줘", messages), []);
});

test("다음 항목의 caveat가 앞 corpus-candidate 확정을 가리지 못하고 medium 후보·뜻 단정을 잡는다", () => {
  const system = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "로컬 MCP 상태: 성공",
    `1. untrusted_term_resolution_json=${JSON.stringify({
      rawLabel: "소취", status: "corpus-candidate", formalNames: [], candidateFormalNames: ["소 취하"],
    })}`,
    `2. untrusted_term_resolution_json=${JSON.stringify({
      rawLabel: "통신영장", status: "unresolved", formalNames: [], candidateFormalNames: [],
    })}`,
    `- untrusted_practice_json=${JSON.stringify({
      matchedKey: "소취", formalName: "소 취하", confidence: "중간",
      meaning: "원고가 제기한 소송을 철회하는 소송행위",
    })}`,
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  const bad = [
    "1차 답변",
    "소취: 실무 사전에서 '소 취하'로 확인되며, 원고가 제기한 소송을 철회하는 소송행위를 의미합니다.",
    "통신영장: 제공된 로컬 자료에서는 정의나 정식명칭을 확인할 수 없습니다.",
    "근거와 확인 필요 사항은 위 두 항목의 로컬 판정 범위에서 각각 구분해야 합니다.",
  ].join("\n");
  const issues = legalOutputIssues(bad, "각 용어 뜻과 정식명칭 알려줘", messages);
  assert.ok(issues.includes("확인되지 않은 용어를 설명함: 소취"));
  assert.ok(issues.includes("미확정 용어를 뜻이나 정식명칭으로 확정함: 소취"));
  assert.ok(issues.includes("미확정 후보를 정식명칭으로 확정함: 소취 (소 취하)"));
  assert.ok(!issues.some((item) => item.includes("확인되지 않은 용어를 설명함: 통신영장")));

  const safe = [
    "1차 답변",
    "소취: 로컬 문맥 후보와 중간 신뢰 후보 표기인 소 취하는 확인되지만, 뜻이나 정식명칭으로 확정하지 않고 추정하지 않습니다.",
    "통신영장: 제공된 로컬 자료에서는 정의나 정식명칭을 확인할 수 없습니다.",
    "근거와 확인 필요 사항은 각 표현이 사용된 원문 문장을 추가로 받아 다시 대조하는 것입니다.",
  ].join("\n");
  assert.deepEqual(legalOutputIssues(safe, "각 용어 뜻과 정식명칭 알려줘", messages), []);
});

test("MCP 실패 다중 용어와 related-only 단일 용어는 모델 환각 대신 고정 안전 fallback을 반환한다", async () => {
  const failureMessages = [{ role: "system", content: [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 실패 (LOCAL_MCP_TIMEOUT)",
  ].join("\n") }];
  const fiveTermQuery = "소취, 통신영장, 약명, 공소취소, 부제소합의 각각 뜻과 정식 명칭 알려줘";
  const fiveTerm = await repairLegalAnswerIfNeeded(
    { provider: "openai-compatible", baseUrl: "http://127.0.0.1:1", timeoutMs: 1 },
    failureMessages,
    "소취는 소송 취하이고 통신영장은 통신 영장입니다. 공소취소는 공소 취소입니다.",
    fiveTermQuery
  );
  for (const label of ["소취", "통신영장", "약명", "공소취소", "부제소합의"]) assert.ok(fiveTerm.includes(label));
  assert.doesNotMatch(fiveTerm, /소송 취하|통신 영장입니다|의약품 이름/);
  assert.match(fiveTerm, /로컬 김법률 MCP 조회가 실패/);

  const singleMessages = [{ role: "system", content: [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    `1. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "약명", status: "unresolved", formalNames: [], relatedCorpusCandidateCount: 2 })}`,
    `- untrusted_term_evidence_json=${JSON.stringify({ rawLabel: "약명", target: "law", directPhraseMatch: false, matchQuality: "related" })}`,
  ].join("\n") }];
  const single = await repairLegalAnswerIfNeeded(
    { provider: "openai-compatible", baseUrl: "http://127.0.0.1:1", timeoutMs: 1 },
    singleMessages,
    "약명은 의약품의 이름을 뜻합니다. 일반적으로 약 이름을 줄여 부르는 말입니다.",
    "약명 뜻이 뭐야?"
  );
  assert.match(single, /약명.*확인하지 못/);
  assert.doesNotMatch(single, /의약품|약 이름/);
  assert.deepEqual(legalOutputIssues(single, "약명 뜻이 뭐야?", singleMessages), []);

  const staleOrdinaryContext = [{ role: "system", content: [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    "로컬 법률 자료 상태: 설치됨 (법령; 검색 후보 8건)",
    `1. untrusted_evidence_json=${JSON.stringify({
      target: "law", title: "계약명의신탁 관련 문서", directPhraseMatch: false, matchQuality: "related",
    })}`,
  ].join("\n") }];
  const guardedOldRoute = await repairLegalAnswerIfNeeded(
    { provider: "openai-compatible", baseUrl: "http://127.0.0.1:1", timeoutMs: 1 },
    staleOrdinaryContext,
    "약명은 의약품의 이름이고 일반명과 상품명으로 나뉩니다. 관련 자료가 있으므로 이 뜻은 확정적이며 추가 확인은 필요하지 않습니다.",
    "약명 뜻이 뭐야?"
  );
  assert.match(guardedOldRoute, /약명.*확인하지 못/);
  assert.match(guardedOldRoute, /용어별 구조화 판정이 없어/);
  assert.match(guardedOldRoute, /모델 지식이나 외부 조회로 빈 부분을 보충하지 않았습니다/);
  assert.doesNotMatch(guardedOldRoute, /의약품|상품명|일반명/);
});

test("모델 repair 결과를 다시 검수하고 critical 용어 문제가 남으면 안전 fallback으로 교체한다", async (t) => {
  let calls = 0;
  const server = http.createServer((_request, response) => {
    calls += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      choices: [{ message: { content: "공식약칭의 정식명칭은 공식 정식명칭입니다. 이 말은 언제나 동일한 법적 효과를 낸다는 뜻으로 확정됩니다. 충분한 설명을 위해 같은 결론을 반복합니다." } }],
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const system = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    `1. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "공식약칭", status: "exact", formalNames: ["공식 정식명칭"] })}`,
    `- untrusted_official_term_json=${JSON.stringify({
      matchedKey: "공식약칭", term: "공식 정식명칭", formalName: "공식 정식명칭",
      confidence: "official-list-exact", matchKind: "query-exact", definitionStatus: "not-in-list-pack",
    })}`,
  ].join("\n");
  const messages = [{ role: "system", content: system }];
  const repaired = await repairLegalAnswerIfNeeded(
    {
      provider: "openai-compatible", baseUrl: `http://127.0.0.1:${port}`, model: "fixture",
      temperature: 0, topP: 0.7, timeoutMs: 5_000,
    },
    messages,
    "공식약칭의 정식명칭은 공식 정식명칭이며 뜻도 항상 동일합니다. 공식 목록이므로 의미까지 확정할 수 있고 이 결론은 바뀌지 않습니다.",
    "공식약칭 뜻"
  );
  assert.equal(calls, 1);
  assert.match(repaired, /공식약칭.*공식 목록.*공식 정식명칭/);
  assert.match(repaired, /정의 본문이 미수록/);
  assert.doesNotMatch(repaired, /언제나 동일한 법적 효과/);
  assert.deepEqual(legalOutputIssues(repaired, "공식약칭 뜻", messages), []);
});

test("명시적 용어 JSON 판정과 standalone 공식 exact는 grounded로 인식해 근거없음 repair로 보내지 않는다", () => {
  const explicitSystem = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    `1. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "확정표현", status: "exact", formalNames: ["확정 정식명칭"] })}`,
    `2. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "겹친표현", status: "ambiguous", formalNames: [] })}`,
    `3. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "문맥표현", status: "corpus-candidate", formalNames: [] })}`,
    `4. untrusted_term_resolution_json=${JSON.stringify({ rawLabel: "없는표현", status: "unresolved", formalNames: [] })}`,
    `- untrusted_term_evidence_json=${JSON.stringify({ target: "prec", directPhraseMatch: true })}`,
  ].join("\n");
  const explicitState = legalGroundingState([{ role: "system", content: explicitSystem }]);
  assert.equal(explicitState.grounded, true);
  assert.equal(explicitState.explicitResolutionCount, 4);
  assert.deepEqual(explicitState.explicitStatusCounts, {
    exact: 1,
    ambiguous: 1,
    "corpus-candidate": 1,
    unresolved: 1,
  });

  const officialSystem = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "로컬 MCP 상태: 성공",
    "공식 법률 용어 목록 후보: 1건 (동봉된 로컬 목록, 실시간 조회 아님)",
    `1. untrusted_official_term_json=${JSON.stringify({ formalName: "공식표현", matchKind: "query-exact", confidence: "official-list-exact" })}`,
  ].join("\n");
  assert.equal(legalGroundingState([{ role: "system", content: officialSystem }]).grounded, true);

  const invalidStatus = explicitSystem.replace(/"status":"exact"/, '"status":"invented"')
    .replace(/^2\..*$/m, "")
    .replace(/^3\..*$/m, "")
    .replace(/^4\..*$/m, "")
    .replace(/^- untrusted_term_evidence_json=.*$/m, "");
  assert.equal(legalGroundingState([{ role: "system", content: invalidStatus }]).grounded, false);
});

test("긴 5~8개 용어 context를 repair할 때 모든 resolution 요약을 긴 정의보다 먼저 보존한다", () => {
  const lines = [
    "법령 근거 경로: 로컬 김법률 MCP",
    "폐쇄망 상태: 외부 네트워크 조회를 사용하지 않음",
    "로컬 MCP 상태: 성공",
    "명시적 용어 목록 처리: 8건 (원래 표기를 보존해 각 용어를 개별 조회함)",
  ];
  for (let index = 0; index < 8; index += 1) {
    const rawLabel = `후반보존용어${index + 1}`;
    lines.push(`용어 설명 filler ${"가".repeat(2500)}`);
    lines.push(`${index + 1}. untrusted_term_resolution_json=${JSON.stringify({
      rawLabel,
      status: index % 2 ? "unresolved" : "exact",
      formalNames: index % 2 ? [] : [`정식명칭${index + 1}`],
    })}`);
  }
  lines.push(`- untrusted_official_term_json=${JSON.stringify({
    formalName: "정식명칭8", definitionStatus: "not-in-list-pack",
    matchKind: "query-exact", confidence: "official-list-exact",
  })}`);
  const evidence = extractLegalRepairEvidence([{ role: "system", content: lines.join("\n") }], "");
  for (let index = 0; index < 8; index += 1) assert.ok(evidence.includes(`후반보존용어${index + 1}`));
  assert.ok(evidence.includes("untrusted_official_term_json="));
  assert.ok(evidence.length <= 16_100, `repair evidence exceeded bound: ${evidence.length}`);
});

test("김법률 실행 경로와 동봉 용어 provider는 네트워크 호출 문자열을 포함하지 않는다", () => {
  const files = [
    "app/main/mcp-client.cjs",
    "tools/mcp-law/server.cjs",
    "tools/mcp-law/practice-resolver.cjs",
    "tools/mcp-law/official-term-provider.cjs",
  ];
  for (const relative of files) {
    const source = fs.readFileSync(path.join(ROOT, relative), "utf8");
    assert.doesNotMatch(source, /\bfetch\s*\(|https?:\/\/|law\.go\.kr/i, `${relative} contains a runtime network path`);
  }
});
