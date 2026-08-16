const fs = require("fs");
const path = require("path");
const { saveWorkspaceOutputFile } = require("./workspace-tools.cjs");

const ROOT_DIR = path.join(__dirname, "..", "..");
const MAX_TEXT_FILE_BYTES = 3 * 1024 * 1024;
const MAX_SOURCE_CHARS = 9000;
const HTML_MIME = "text/html; charset=utf-8";

async function buildPresentationOfficerReply(payload = {}, llmText = "", model = "local-webdeck") {
  const plan = buildPresentationPlan(payload, llmText);
  const html = buildWebDeckHtml(plan);
  const fileName = `${sanitizeFileName(plan.title || "web-presentation")}.html`;
  const savedOutput = saveWorkspaceOutputFile(fileName, html);

  return {
    ok: true,
    model: llmText ? `${model} + webdeck` : "local-webdeck",
    text: buildReplyText(plan, llmText),
    presentation: {
      id: `webdeck-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      title: plan.title,
      fileName: savedOutput.name || fileName,
      format: "html",
      mimeType: HTML_MIME,
      base64: Buffer.from(html, "utf8").toString("base64"),
      slideCount: plan.slides.length,
      sourceNote: plan.sourceNote,
      workspacePath: savedOutput.relativePath,
    },
  };
}

function buildPresentationPlan(payload, llmText = "") {
  const options = normalizePresentationOptions(payload?.presentationOptions || {});
  const files = normalizeInputFiles(payload?.files || payload?.attachedFiles || []);
  const source = buildSourceText(payload?.userText || "", files);
  const sourceType = options.sourceType !== "auto" ? options.sourceType : inferSourceType(source.text, files);
  const desiredSlideCount = parseSlideCount(options.slideCount) || inferSlideCount(source.text);
  const title = inferTitle(source.text, sourceType);
  const audience = options.audience || inferAudience(source.text);
  const purpose = options.purpose || inferPurpose(source.text);
  const tone = options.tone || "공공기관 보고용";
  const ratio = options.ratio || "16:9";
  const detailLevel = options.detailLevel || "dense";
  const fontScale = options.fontScale || "normal";
  const theme = options.theme || "civic-blue";
  const bullets = extractBullets(source.text);
  const missing = buildMissingItems({ options, audience, purpose });
  const fallbackSlides = buildSlides({
    title,
    sourceType,
    desiredSlideCount,
    sourceText: source.text,
    bullets,
    audience,
    purpose,
    tone,
    ratio,
    detailLevel,
    fontScale,
    theme,
    missing,
  });

  const basePlan = {
    title,
    sourceType,
    audience,
    purpose,
    tone,
    ratio,
    detailLevel,
    fontScale,
    theme,
    sourceBullets: bullets,
    desiredSlideCount,
    files,
    sourceText: source.text,
    sourceNote: source.note,
    missing,
    slides: fallbackSlides,
  };

  return enrichWebPlan(applyLlmPlan(basePlan, llmText));
}

function normalizePresentationOptions(options) {
  return {
    sourceType: normalizeOption(options.sourceType, "auto"),
    slideCount: normalizeOption(options.slideCount, "auto"),
    audience: String(options.audience || "").trim(),
    purpose: String(options.purpose || "").trim(),
    tone: normalizeOption(options.tone, "공공기관 보고용"),
    ratio: normalizeOption(options.ratio, "16:9"),
    detailLevel: normalizeEnum(options.detailLevel, ["brief", "balanced", "dense"], "dense"),
    fontScale: normalizeEnum(options.fontScale, ["compact", "normal", "large"], "normal"),
    theme: normalizeEnum(options.theme, ["civic-blue", "forest", "mono"], "civic-blue"),
  };
}

function normalizeOption(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizeEnum(value, allowed, fallback) {
  const text = String(value || "").trim();
  return allowed.includes(text) ? text : fallback;
}

function normalizeInputFiles(files) {
  return (Array.isArray(files) ? files : [])
    .map((file) => ({
      name: String(file?.name || "").trim(),
      path: String(file?.path || "").trim(),
      size: String(file?.size || "").trim(),
      type: String(file?.type || inferFileType(file?.name || file?.path || "file")).trim(),
    }))
    .filter((file) => file.name)
    .slice(0, 8);
}

function buildSourceText(userText, files) {
  const cleanUserText = stripPresentationConditionBlock(String(userText || "").trim());
  const snippets = files.map(readTextSnippet).filter(Boolean);
  const parts = [cleanUserText, ...snippets].filter(Boolean);
  const text = parts.join("\n\n").trim().slice(0, MAX_SOURCE_CHARS);
  const unreadableFiles = files.filter((file) => file.path && !isReadableTextFile(file)).map((file) => file.name);
  const note = unreadableFiles.length
    ? `첨부 원문 자동 읽기는 txt/md/json/csv만 우선 지원합니다. ${unreadableFiles.join(", ")}는 파일명 기준으로 웹 발표자료 초안을 만들었습니다.`
    : snippets.length
      ? "첨부한 텍스트형 자료 일부를 읽어 웹 발표자료 초안에 반영했습니다."
      : files.length
        ? "첨부 파일명과 사용자가 입력한 설명을 기준으로 웹 발표자료 초안을 만들었습니다."
        : "사용자가 입력한 설명을 기준으로 웹 발표자료 초안을 만들었습니다.";
  return {
    text: text || "웹 발표자료 구성 초안",
    note,
  };
}

function stripPresentationConditionBlock(text) {
  return text.split(/\n(?:PPT|웹 발표자료|발표자료) 작성 조건:\n/)[0].trim();
}

function readTextSnippet(file) {
  if (!file.path || !isReadableTextFile(file)) return "";

  try {
    const resolved = path.resolve(file.path);
    const stat = fs.statSync(resolved);
    if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) return "";
    const body = fs.readFileSync(resolved, "utf8").replace(/\0/g, "").slice(0, 5000).trim();
    if (!body) return "";
    return `첨부 자료 ${file.name}\n${body}`;
  } catch (_error) {
    return "";
  }
}

function isReadableTextFile(file) {
  const ext = path.extname(file.path || file.name).toLowerCase().replace(".", "");
  return ["txt", "md", "json", "csv"].includes(ext);
}

function inferFileType(fileName) {
  const ext = path.extname(String(fileName || "")).toLowerCase().replace(".", "");
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["pdf", "doc", "docx", "hwp", "hwpx"].includes(ext)) return "word";
  if (["txt", "md", "json", "csv"].includes(ext)) return "file";
  return "file";
}

function inferSourceType(text, files) {
  if (/회의록|회의명|참석자|회의결과|회의 결과/.test(text)) return "회의록";
  if (/보고서|추진상황|검토보고|결과보고|현황보고/.test(text)) return "보고서";
  if (/기획안|추진계획|사업계획|제안/.test(text)) return "기획안";
  if (/메모|메모장|간단히/.test(text)) return "메모";
  if (files.some((file) => /\.(pptx?|pdf|docx?|hwp|hwpx)$/i.test(file.name))) return "보고서";
  return "자료";
}

function parseSlideCount(value) {
  const match = String(value || "").match(/\d+/);
  if (!match) return 0;
  return clamp(Number(match[0]), 4, 12);
}

function inferSlideCount(text) {
  const explicitMatch = String(text || "").match(/(\d{1,2})\s*(장|슬라이드|페이지)/);
  const explicit = explicitMatch ? clamp(Number(explicitMatch[1]), 4, 12) : 0;
  if (explicit) return explicit;
  const bulletCount = extractBullets(text).length;
  if (bulletCount >= 10) return 8;
  if (bulletCount >= 6) return 7;
  return 6;
}

function inferTitle(text, sourceType) {
  const lines = meaningfulLines(text);
  const requestSubject = lines.map(extractSubjectFromRequestLine).find(Boolean);
  if (requestSubject) return tidyTitle(requestSubject);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^(회의명|제목|보고명|안건|회의\s*메모)\s*[:：]/.test(line)) continue;
    const value = line.replace(/^(회의명|제목|보고명|안건|회의\s*메모)\s*[:：]\s*/, "").trim();
    if (value && !isGenericMaterialName(value)) return tidyTitle(value);
    const nextLine = lines.slice(index + 1).find((item) => item && !isInstructionLine(item));
    if (nextLine) return tidyTitle(nextLine);
  }

  const requestLine = lines.find((line) => !/ppt|PPT|파워포인트|웹\s*슬라이드|발표자료|만들|구성|바꿔|다운로드/.test(line));
  if (requestLine) return tidyTitle(requestLine);
  return `${sourceType || "업무자료"} 발표자료`;
}

function extractSubjectFromRequestLine(value) {
  const line = String(value || "").replace(/^웹\s*발표자료[,:\s]*/i, "").trim();
  if (!/(발표자료|슬라이드|ppt|PPT|파워포인트|만들|구성|바꿔)/.test(line)) return "";
  const patterns = [
    /^(.+?)(?:을|를)?\s*\d{1,2}\s*(?:장|페이지|슬라이드).*?(?:발표자료|슬라이드|ppt|PPT|파워포인트)/,
    /^(.+?)(?:을|를)?\s*(?:웹\s*)?(?:발표자료|슬라이드|ppt|PPT|파워포인트).*?(?:만들|구성|바꿔)/,
  ];
  for (const pattern of patterns) {
    const match = line.match(pattern);
    if (!match) continue;
    const subject = match[1]
      .replace(/^(아래|다음|첨부한|첨부|이|그)\s*/, "")
      .replace(/\d{1,2}\s*(?:장|페이지|슬라이드)\s*(?:짜리)?/g, "")
      .replace(/[을를]\s*$/g, "")
      .replace(/(회의\s*메모|보고서|자료|내용)$/g, "")
      .trim();
    if (subject.length >= 6 && !isGenericMaterialName(subject)) return subject;
  }
  return "";
}

function isGenericMaterialName(value) {
  const text = String(value || "").trim().replace(/[을를]\s*$/g, "");
  return /^(아래|다음|첨부|첨부한|회의\s*메모|보고서|자료|내용|원문)$/i.test(text);
}

function tidyTitle(value) {
  const text = cleanBulletText(value)
    .replace(/\s+/g, " ")
    .trim();
  return (text || "업무자료 발표자료").slice(0, 46);
}

function inferAudience(text) {
  if (/간부|기관장|국장|과장|부서장/.test(text)) return "간부 보고";
  if (/외부|대외|민원인|위원회|협의회/.test(text)) return "외부 참석자";
  if (/교육|워크숍|설명회/.test(text)) return "교육 참석자";
  return "";
}

function inferPurpose(text) {
  if (/의사결정|결정|승인|검토 요청|요청/.test(text)) return "의사결정";
  if (/교육|안내|설명/.test(text)) return "교육 및 안내";
  if (/보고|현황|추진상황|점검/.test(text)) return "현황보고";
  return "";
}

function extractBullets(text) {
  const lines = meaningfulLines(text)
    .map((line) =>
      line
        .replace(/^(주요 내용|내용|안건|결론|향후 계획|확인 필요 사항)\s*[:：]\s*/, "")
        .replace(/^(회의\s*메모|보고서|자료)\s*[:：]\s*/, "")
        .replace(/^[-*ㆍ·]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim()
    )
    .filter(Boolean)
    .filter((line) => !isInstructionLine(line))
    .filter((line) => !/^(?:PPT|웹 발표자료|발표자료) 작성 조건/.test(line))
    .filter((line) => !/^(자료 유형|희망 장수|청중|목적|톤|화면비|내용 밀도|글자 크기|테마)\s*:/.test(line))
    .filter((line) => line.length >= 8);

  const unique = [];
  for (const line of lines) {
    const compact = line.replace(/\s+/g, " ");
    if (unique.includes(compact)) continue;
    unique.push(compact);
  }
  return unique.slice(0, 24);
}

function isInstructionLine(value) {
  const line = String(value || "").trim();
  if (!line) return true;
  if (/^(BRIEF|TODO|POINT|CHECK)\b/i.test(line)) return true;
  if (/AI지원담당\s*웹\s*발표자료|Web deck\s*\d+\s*\/\s*\d+/i.test(line)) return true;
  if (/^웹\s*발표자료[,:\s]/i.test(line)) return true;
  if (/^(청중|목적|톤|내용\s*밀도|글자\s*크기|테마|화면비|구성)(?:은|는|:|：)/.test(line)) return true;
  if (/^(보고\s*일자|보고자|사업\s*목적\s*재확인)$/i.test(line)) return true;
  if (/본인\s*이름|부서|예\s*[:：]/.test(line)) return true;
  if (/^(회의\s*메모|보고서|자료)\s*[:：]?$/.test(line)) return true;
  if (/^(예를 들어|예시|확인 필요 사항|다운로드|저장 안내)\b/.test(line)) return true;
  if (/(?:웹\s*)?발표자료|슬라이드|ppt|PPT|파워포인트/.test(line) && /(만들|구성|바꿔|다운로드|저장|희망|작성 조건)/.test(line)) return true;
  if (/^(자료 유형|희망 장수|청중|목적|톤|화면비|내용 밀도|글자 크기|테마)\s*:/.test(line)) return true;
  return false;
}

function meaningfulLines(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildMissingItems({ options, audience, purpose }) {
  const items = [];
  if (!purpose) items.push("발표 목적: 현황보고, 의사결정, 교육, 대외 설명 중 어디에 가까운지");
  if (!audience) items.push("청중: 과장님 보고, 간부회의, 외부기관, 내부 교육 등");
  if (!parseSlideCount(options.slideCount)) items.push("희망 장수와 발표 시간");
  if (!options.ratio) items.push("화면비: 16:9 또는 4:3");
  items.push("기관 템플릿, 로고, 색상 규칙이 있으면 웹 슬라이드 테마에 반영 가능");
  return items;
}

function buildSlides(context) {
  const desired = context.desiredSlideCount;
  const bulletLimit = detailBulletLimit(context.detailLevel);
  const sourceBullets = cleanBulletList(
    context.bullets.length
      ? context.bullets
      : ["원자료의 핵심 메시지를 슬라이드별로 분리", "청중이 바로 이해할 수 있는 흐름으로 재구성", "부족한 수치와 일정은 확인 필요 사항으로 분리"]
  ).filter((item) => !isTitleLikeBullet(item, context.title));
  const insights = buildSourceInsights(context.sourceText || "", sourceBullets, context.title);
  const slides = [];

  slides.push({
    type: "cover",
    title: context.title,
    message: `${context.sourceType} 기반 ${context.purpose || "현황보고"}용 웹 발표자료`,
    bullets: [
      `대상: ${context.audience || "보고 대상 미정"}`,
      `톤: ${context.tone}`,
      `구성: 지표, 성과, 이슈, 조치 중심`,
    ],
    visual: "표지",
  });

  const summary = makeSlide("summary", "핵심 요약", context.purpose || "보고자가 바로 판단할 수 있도록 현황, 성과, 쟁점을 한 장에서 정리합니다.", fillBullets(insights.summary, sourceBullets, bulletLimit), "요약 카드");
  const status = makeSlide("chart", "추진 현황 지표", "신청, 심사, 선정처럼 진행률을 보여 주는 핵심 지표를 한눈에 비교합니다.", fillBullets(insights.status, ["신청 대비 심사 완료율 확인", "심사 완료 대비 최종 선정 비율 확인", "다음 보고 전 최신 누계 업데이트"], bulletLimit), "지표 차트");
  const achievements = makeSlide("cards", "주요 성과", "사업이 만든 실질 성과를 참여 기관, 채용 연계, 교육 수료 등 결과 중심으로 제시합니다.", fillBullets(insights.achievements, ["참여 기관 수와 채용 연계 실적을 분리 표기", "교육 수료 인원과 실제 채용 연계 간 연결성 확인", "성과 수치는 전분기 또는 목표치와 비교 가능"], bulletLimit), "성과 카드");
  const budget = makeSlide("chart", "예산 집행 및 자원 운영", "총예산 대비 집행액과 남은 재원을 확인해 다음 분기 운영 여력을 점검합니다.", fillBullets(insights.budget, ["총예산, 집행액, 잔여 예산을 분리 표기", "3분기 추가 예산 필요 여부 검토", "예산 집행률과 사업 성과를 함께 비교"], bulletLimit), "예산 차트");
  const satisfaction = makeSlide("cards", "만족도와 운영 평가", "참여자 반응과 운영 품질을 수치와 정성 이슈로 나누어 봅니다.", fillBullets(insights.satisfaction, ["만족도 평균과 조사 기준을 함께 표기", "낮은 평가 항목이 있으면 개선 과제로 연결", "다음 조사 때 비교할 기준값 설정"], bulletLimit), "평가 카드");
  const issues = makeSlide("risks", "운영상 이슈", "지금 막히는 지점을 명확히 드러내고 후속 조치가 필요한 항목을 분리합니다.", fillBullets(insights.issues, ["신청 서류 보완 요청 증가 여부 확인", "협력 기관 일정 지연 여부 점검", "참여자 안내 문구 개선 필요"], bulletLimit), "이슈 점검");
  const actions = makeSlide("checklist", "다음 달 실행 계획", "다음 회의 전까지 처리해야 할 개선 작업과 점검 일정을 정리합니다.", fillBullets(insights.actions, ["서류 안내문 개선", "기관별 일정 점검 회의 개최", "홍보 채널 확대 여부 검토"], bulletLimit), "실행 체크리스트");
  const decisions = makeSlide("checklist", "확인 및 의사결정 요청", "간부 보고에서 결론을 내야 할 예산, 홍보, 일정 관련 판단 항목을 모읍니다.", fillBullets(insights.decisions, ["3분기 추가 예산 가능 여부 확인", "홍보 채널 확대 여부 결정", "기업별 채용 일정 지연 대응 방향 확인"], bulletLimit), "결정 필요 항목");

  const compactOrder = [summary, status, achievements, issues, actions];
  const fullOrder = [summary, status, achievements, budget, satisfaction, issues, actions, decisions];
  const order = desired <= 5 ? compactOrder : fullOrder;
  for (const slide of order) {
    if (slides.length >= desired) break;
    slides.push(slide);
  }

  while (slides.length < desired) {
    const chunk = sourceBullets.slice((slides.length - 1) * bulletLimit, slides.length * bulletLimit);
    slides.push(makeSlide("cards", `세부 검토 ${slides.length}`, "원자료의 세부 항목을 보고 흐름에 맞춰 보강합니다.", fillBullets(chunk, sourceBullets, bulletLimit), "세부 카드"));
  }

  return slides.slice(0, desired);
}

function makeSlide(type, title, message, bullets, visual) {
  return {
    type,
    title,
    message,
    bullets: cleanBulletList(bullets).slice(0, 6),
    visual,
  };
}

function isTitleLikeBullet(item, title) {
  const left = String(item || "").replace(/\s+/g, "");
  const right = String(title || "").replace(/\s+/g, "");
  if (!left || !right) return false;
  return left === right || right.includes(left) || left.includes(right);
}

function buildSourceInsights(text, bullets, title = "") {
  const lines = cleanBulletList([...meaningfulLines(text), ...bullets]).filter((item) => !isTitleLikeBullet(item, title));
  const metrics = uniqueTexts([...lines.flatMap(splitMetricLine), ...bullets.filter(hasNumberLikeValue)]).slice(0, 8);
  const issuePattern = /문제|이슈|지연|보완|애로|부족|위험|리스크|많/;
  const actionPattern = /다음|향후|계획|개선|점검|회의|예정|확대|검토|추진/;
  const status = collectInsight(lines, /신청|심사|선정|접수|완료|선발|참여자/, issuePattern);
  const budget = collectInsight(lines, /예산|집행|\d+(?:\.\d+)?\s*(?:억|만원|천만\s*원|백만\s*원|원)/, /확인\s*필요|여부/);
  const satisfaction = collectInsight(lines, /만족|평가|점수|평균|품질/);
  const achievements = collectInsight(lines, /성과|참여|채용|연계|수료|기업|교육/, new RegExp(`${issuePattern.source}|${actionPattern.source}`));
  const issues = collectInsight(lines, issuePattern);
  const actions = collectInsight(lines, actionPattern);
  const decisions = collectInsight(lines, /확인|여부|결정|승인|예산 가능|확대 여부|협조/);
  const summary = uniqueTexts([
    ...status.slice(0, 3),
    ...budget.slice(0, 1),
    ...achievements.slice(0, 2),
    ...issues.slice(0, 1),
  ]).slice(0, 5);

  return {
    summary,
    status,
    metrics,
    budget,
    satisfaction,
    achievements,
    issues,
    actions,
    decisions,
  };
}

function collectInsight(lines, pattern, excludePattern = null) {
  return uniqueTexts(
    lines
      .filter((line) => pattern.test(line) && !(excludePattern && excludePattern.test(line)))
      .flatMap(splitContentParts)
  ).slice(0, 8);
}

function splitContentParts(value) {
  return String(value || "")
    .split(/\s*(?:,|;|ㆍ|·|그리고|또는|및)\s*/)
    .map(cleanBulletText)
    .filter((item) => item.length >= 6 && !isInstructionLine(item));
}

function splitMetricLine(value) {
  const line = cleanBulletText(value);
  if (!hasNumberLikeValue(line)) return [];
  const parts = splitContentParts(line);
  return parts.length > 1 ? parts.filter(hasNumberLikeValue) : [line];
}

function hasNumberLikeValue(value) {
  return /\d/.test(String(value || "")) && /(건|명|곳|점|%|원|억|만|회|개|분기|월|일)/.test(String(value || ""));
}

function fillBullets(primary, fallback, limit) {
  const merged = uniqueTexts([...cleanBulletList(primary), ...cleanBulletList(fallback)]);
  if (merged.length >= limit) return merged.slice(0, limit);
  return merged.slice(0, limit);
}

function cleanBulletList(items) {
  return uniqueTexts((Array.isArray(items) ? items : []).map(cleanBulletText).filter(Boolean).filter((item) => !isInstructionLine(item)));
}

function cleanBulletText(value) {
  return String(value || "")
    .replace(/^[-*ㆍ·]\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/\((?:예|예시)\s*[:：][^)]+\)/g, "")
    .replace(/\b(?:BRIEF|CHECK|POINT\s*\d+|TODO\s*\d*)\b/gi, "")
    .replace(/AI지원담당\s*웹\s*발표자료\s*·?\s*Web deck\s*\d+\s*\/\s*\d+/gi, "")
    .replace(/AI지원담당\s*웹\s*발표자료|Web deck\s*\d+\s*\/\s*\d+/gi, "")
    .replace(/^(제목|핵심 메시지|메시지|넣을 내용|본문|내용|시각 요소 후보|시각 요소|비주얼)\s*[:：]\s*/i, "")
    .replace(/\s+/g, " ")
    .replace(/[.。]\s*$/g, "")
    .trim();
}

function detailBulletLimit(detailLevel) {
  if (detailLevel === "brief") return 3;
  if (detailLevel === "balanced") return 4;
  return 5;
}

function chunkItems(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function applyLlmPlan(basePlan, llmText) {
  const text = String(llmText || "").trim();
  if (!text) return basePlan;

  const llmSlides = parseSlidesFromLlmText(text);
  const llmMissing = parseMissingFromLlmText(text);
  const slides = llmSlides.length >= 3 ? normalizeLlmSlides(llmSlides, basePlan) : basePlan.slides;

  return {
    ...basePlan,
    slides,
    missing: llmMissing.length ? llmMissing : basePlan.missing,
    sourceNote: `${basePlan.sourceNote} LLM이 슬라이드 구성과 표현을 먼저 설계했고, 앱이 그 결과를 웹 슬라이드 HTML로 렌더링했습니다.`,
  };
}

function parseSlidesFromLlmText(text) {
  const section = extractSection(text, ["슬라이드 구성안", "슬라이드 구성", "구성안"], ["확인 필요 사항", "다운로드", "다음 확인", "보완"]);
  const lines = meaningfulLines(section || text);
  const slides = [];
  let current = null;

  for (const line of lines) {
    const start = parseSlideStart(line);
    if (start) {
      if (current) slides.push(current);
      current = start;
      continue;
    }

    if (!current) continue;
    const detail = parseSlideDetail(line);
    if (!detail.text) {
      continue;
    } else if (detail.kind === "title") {
      current.title = tidyTitle(detail.text);
    } else if (detail.kind === "visual") {
      current.visual = detail.text;
    } else if (detail.kind === "message") {
      current.message = detail.text;
      if (detail.text) current.bullets.push(detail.text);
    } else {
      current.bullets.push(detail.text);
    }
  }

  if (current) slides.push(current);
  return slides.slice(0, 12);
}

function extractSection(text, startLabels, endLabels) {
  const lines = String(text || "").split(/\r?\n/);
  let startIndex = -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (startLabels.some((label) => lines[index].includes(label))) {
      startIndex = index + 1;
      break;
    }
  }
  if (startIndex < 0) return "";

  let endIndex = lines.length;
  for (let index = startIndex; index < lines.length; index += 1) {
    if (endLabels.some((label) => lines[index].includes(label))) {
      endIndex = index;
      break;
    }
  }
  return lines.slice(startIndex, endIndex).join("\n");
}

function parseSlideStart(line) {
  const text = String(line || "").trim();
  const match = text.match(/^(?:슬라이드\s*)?(\d{1,2})[.)]\s*(.+)$/);
  if (!match) return null;

  const parsed = splitSlideTitleAndMessage(match[2]);
  return {
    title: parsed.title || `슬라이드 ${match[1]}`,
    message: parsed.message || parsed.title || "",
    bullets: parsed.message ? [parsed.message] : [],
    visual: "",
  };
}

function splitSlideTitleAndMessage(value) {
  const text = String(value || "")
    .replace(/^[-–—:：]\s*/, "")
    .trim();
  const separator = text.match(/\s*[:：]\s*/);
  if (separator && separator.index > 0) {
    return {
      title: text.slice(0, separator.index).trim(),
      message: text.slice(separator.index + separator[0].length).trim(),
    };
  }
  const dashIndex = text.search(/\s[-–—]\s/);
  if (dashIndex > 0) {
    return {
      title: text.slice(0, dashIndex).trim(),
      message: text.slice(dashIndex + 3).trim(),
    };
  }
  return { title: text, message: "" };
}

function parseSlideDetail(line) {
  const text = String(line || "")
    .replace(/^[-*ㆍ·•ㅇ]\s*/, "")
    .trim();
  if (!text || isInstructionLine(text)) return { kind: "skip", text: "" };
  const title = text.match(/^(?:제목|슬라이드\s*제목)\s*[:：]\s*(.+)$/);
  if (title) return { kind: "title", text: cleanBulletText(title[1]) };
  const visual = text.match(/^(?:시각\s*요소|시각화|도식|그래픽|비주얼)\s*[:：]\s*(.+)$/);
  if (visual) return { kind: "visual", text: cleanBulletText(visual[1]) };
  const message = text.match(/^(?:핵심\s*메시지|메시지|요지)\s*[:：]\s*(.+)$/);
  if (message) return { kind: "message", text: cleanBulletText(message[1]) };
  const content = text.match(/^(?:넣을\s*내용|본문|내용|포함\s*내용)\s*[:：]\s*(.+)$/);
  if (content) return { kind: "bullet", text: cleanBulletText(content[1]) };
  return { kind: "bullet", text: cleanBulletText(text) };
}

function parseMissingFromLlmText(text) {
  const section = extractSection(text, ["확인 필요 사항", "확인 사항", "다음 확인"], ["다운로드"]);
  return meaningfulLines(section)
    .map((line) => line.replace(/^[-*ㆍ·•ㅇ]\s*/, "").replace(/^\d+[.)]\s*/, "").trim())
    .filter((line) => line.length >= 4)
    .slice(0, 6);
}

function normalizeLlmSlides(slides, basePlan) {
  const bulletLimit = detailBulletLimit(basePlan.detailLevel);
  const normalized = slides
    .map((slide, index) => {
      const title = tidyTitle(slide.title || `슬라이드 ${index + 1}`);
      const bullets = cleanBulletList((slide.bullets || []).flatMap(splitBulletCandidates).map((item) => shorten(item, 130))).slice(0, bulletLimit);
      const message = shorten(cleanBulletText(slide.message || bullets[0] || title), 130);
      return {
        type: index === 0 ? "cover" : "",
        title,
        message,
        bullets: bullets.length ? bullets : [message],
        visual: slide.visual || (index === 0 ? "표지" : "핵심 메시지 카드"),
      };
    })
    .filter((slide) => slide.title && slide.message);

  if (normalized.length >= 3) {
    const target = basePlan.desiredSlideCount || normalized.length;
    const merged = [...normalized];
    const existingTitles = new Set(merged.map((slide) => slide.title));
    const existingGroups = new Set(merged.slice(1).flatMap(slideSemanticGroups));
    const supplements = buildSupplementalSlides(basePlan);
    for (const supplement of supplements) {
      if (merged.length >= target) break;
      if (existingTitles.has(supplement.title)) continue;
      const groups = slideSemanticGroups(supplement);
      if (groups.length && groups.every((group) => existingGroups.has(group))) continue;
      merged.push(supplement);
      existingTitles.add(supplement.title);
      groups.forEach((group) => existingGroups.add(group));
    }
    const fallbackPool = basePlan.slides.filter((fallback, fallbackIndex) => fallbackIndex > 1 && fallback.type !== "cover" && !/핵심\s*요약/.test(fallback.title));
    for (const fallback of fallbackPool) {
      if (merged.length >= target) break;
      if (existingTitles.has(fallback.title)) continue;
      const groups = slideSemanticGroups(fallback);
      if (groups.length && groups.every((group) => existingGroups.has(group))) continue;
      merged.push({ ...fallback });
      existingTitles.add(fallback.title);
      groups.forEach((group) => existingGroups.add(group));
    }
    for (const candidate of [...supplements, ...fallbackPool]) {
      if (merged.length >= target) break;
      if (existingTitles.has(candidate.title)) continue;
      merged.push({ ...candidate });
      existingTitles.add(candidate.title);
    }
    return merged.slice(0, target).map((slide, index) => ensureSlideDepth(slide, basePlan, index));
  }
  return basePlan.slides.map((slide, index) => ensureSlideDepth(slide, basePlan, index));
}

function splitBulletCandidates(value) {
  const text = cleanBulletText(value);
  if (!text || isVisualCandidateLine(text)) return [];
  const pieces = text
    .split(/\s*(?:,|，|;|；|ㆍ|·)\s*/)
    .map(cleanBulletText)
    .filter((item) => item.length >= 5 && !isInstructionLine(item) && !isVisualCandidateLine(item));
  if (pieces.length >= 2 && pieces.every((item) => item.length <= 80)) return pieces;
  return [text];
}

function ensureSlideDepth(slide, basePlan, index) {
  if (slide.type === "cover" || index === 0) return slide;
  const targetCount = basePlan.detailLevel === "brief" ? 3 : basePlan.detailLevel === "balanced" ? 4 : 5;
  const seed = relevantSourceBullets(slide, cleanBulletList(Array.isArray(basePlan.sourceBullets) ? basePlan.sourceBullets : []));
  const fallbackSlide = findRelevantFallbackSlide(slide, basePlan.slides) || {};
  const bullets = cleanBulletList([...(slide.bullets || []), ...(fallbackSlide.bullets || []), ...seed])
    .filter((item) => item && item !== slide.title && item !== slide.message)
    .slice(0, targetCount);
  return {
    ...slide,
    bullets: bullets.length >= Math.min(3, targetCount) ? bullets : cleanBulletList([...(slide.bullets || []), ...(fallbackSlide.bullets || []), slide.message, ...seed]).slice(0, targetCount),
  };
}

function isVisualCandidateLine(value) {
  const text = String(value || "");
  if (/(?:시각\s*요소|KPI|카드형|아이콘|파이\s*차트|막대\s*차트|라인\s*차트|게이지|흐름도|프로세스|나란히\s*배치|그래프)/i.test(text)) return true;
  if (/(?:차트|카드|도식|시각화)\s*(?:형태|구성|후보|활용|표현)/.test(text)) return true;
  return false;
}

function buildSupplementalSlides(basePlan) {
  const source = cleanBulletList(basePlan.sourceBullets || []);
  const actionBullets = source.filter((item) => /다음|향후|계획|개선|점검|회의|예정/.test(item));
  const decisionBullets = source.filter((item) => /확인|여부|예산|홍보|승인|결정/.test(item));
  return [
    makeSlide("checklist", "다음 달 실행 계획", "다음 회의 전까지 처리해야 할 개선 작업과 점검 일정을 정리합니다.", fillBullets(actionBullets, ["서류 안내문 개선", "기업별 채용 일정 점검 회의 개최", "홍보 채널 확대 여부 검토"], detailBulletLimit(basePlan.detailLevel)), "실행 체크리스트"),
    makeSlide("checklist", "확인 및 의사결정 요청", "보고 이후 결정하거나 확인해야 할 예산, 홍보, 일정 관련 항목을 모읍니다.", fillBullets(decisionBullets, ["3분기 추가 예산 가능 여부 확인", "홍보 채널 확대 여부 결정", "기업별 채용 일정 지연 대응 방향 확인"], detailBulletLimit(basePlan.detailLevel)), "결정 필요 항목"),
  ];
}

function slideSemanticGroups(slide) {
  const text = `${slide?.title || ""} ${slide?.message || ""} ${slide?.visual || ""}`;
  const groups = [];
  if (/예산|집행|재정|자원/.test(text)) groups.push("budget");
  if (/만족|평가|품질/.test(text)) groups.push("satisfaction");
  if (/성과|참여|채용|연계|수료|기업|교육|역량/.test(text)) groups.push("achievement");
  if (/문제|이슈|애로|지연|보완|위험|리스크/.test(text)) groups.push("issue");
  if (/다음|향후|계획|조치|개선|점검|회의|실행/.test(text)) groups.push("action");
  if (/확인|결정|승인|요청/.test(text)) groups.push("decision");
  if (/신청|심사|선정|접수|선발|지표/.test(text)) groups.push("status");
  return uniqueTexts(groups);
}

function relevantSourceBullets(slide, seed) {
  const text = `${slide.title || ""} ${slide.message || ""} ${slide.visual || ""}`;
  const groups = [
    [/예산|집행|재정|자원/, /예산|집행|원|억|만원/],
    [/만족|평가|품질|운영\s*평가/, /만족|평가|점수|평균|품질/],
    [/성과|참여|채용|연계|수료|기업|교육/, /성과|참여|채용|연계|수료|기업|교육/],
    [/문제|이슈|애로|지연|보완|위험|리스크/, /문제|이슈|애로|지연|보완|위험|리스크|많/],
    [/다음|향후|계획|조치|개선|점검|회의|실행/, /다음|향후|계획|조치|개선|점검|회의|예정/],
    [/신청|심사|선정|접수|선발|지표/, /신청|심사|선정|접수|선발|완료/],
  ];
  for (const [slidePattern, bulletPattern] of groups) {
    if (!slidePattern.test(text)) continue;
    const matched = seed.filter((item) => bulletPattern.test(item));
    if (matched.length) return matched;
  }
  return seed;
}

function findRelevantFallbackSlide(slide, fallbackSlides) {
  const seed = relevantSourceBullets(slide, cleanBulletList((fallbackSlides || []).flatMap((item) => item.bullets || [])));
  if (!seed.length) return null;
  return { bullets: seed };
}

function enrichWebPlan(plan) {
  const numeric = extractNumbers(plan.sourceText);
  const slides = plan.slides.map((slide, index) => {
    const type = normalizeSlideType(slide, index);
    const chart = type === "chart" || /차트|그래프|수치|현황|추이|비율|비교/.test(`${slide.title} ${slide.message} ${slide.visual}`)
      ? buildChartData(slide, numeric, index)
      : null;
    return {
      ...slide,
      type,
      layout: chooseLayout(type, index),
      chart,
    };
  });
  return { ...plan, slides };
}

function normalizeSlideType(slide, index) {
  if (index === 0 || slide.type === "cover") return "cover";
  const text = `${slide.title} ${slide.message} ${slide.visual}`.toLowerCase();
  if (/향후|확인|체크|조치/.test(text)) return "checklist";
  if (/쟁점|위험|보완|주의|리스크/.test(text)) return "risks";
  if (/일정|타임라인|로드맵|계획/.test(text)) return "timeline";
  if (/차트|그래프|수치|현황|추이|비율|비교/.test(text)) return "chart";
  if (/절차|흐름|프로세스|단계/.test(text)) return "process";
  if (slide.type) return slide.type;
  return index % 3 === 0 ? "chart" : index % 3 === 1 ? "process" : "cards";
}

function chooseLayout(type, index) {
  if (type === "cover") return "cover";
  if (type === "chart") return "chart";
  if (type === "process" || type === "timeline") return "steps";
  if (type === "risks" || type === "checklist") return "checklist";
  return index % 2 === 0 ? "split" : "cards";
}

function extractNumbers(text) {
  const output = [];
  const regex = /([가-힣A-Za-z0-9_\- ]{0,18}?)(-?\d+(?:\.\d+)?)\s*(%|명|건|원|만원|억원|일|월|회|개)?/g;
  let match;
  while ((match = regex.exec(String(text || ""))) && output.length < 8) {
    const label = String(match[1] || "").replace(/[^\w가-힣 -]/g, "").trim().slice(-12) || `항목 ${output.length + 1}`;
    const value = Number(match[2]);
    if (!Number.isFinite(value)) continue;
    output.push({ label, value: Math.abs(value), unit: match[3] || "" });
  }
  return output;
}

function buildChartData(slide, numbers, index) {
  const labels = slide.bullets.slice(0, 4).map((item, idx) => shorten(item.replace(/\d+(?:\.\d+)?\s*(%|명|건|원|만원|억원|일|월|회|개)?/g, "").trim() || `항목 ${idx + 1}`, 18));
  const sourceNumbers = numbers.length >= 3 ? numbers.slice(0, 5) : [];
  const fallbackValues = [42, 58, 73, 86].map((value, idx) => Math.max(8, value - index * 3 + idx * 4));
  const chartLabels = sourceNumbers.length ? sourceNumbers.map((item) => shorten(item.label || `항목 ${index + 1}`, 18)) : labels.length >= 3 ? labels : ["현재", "보완", "목표"];
  const values = sourceNumbers.length ? sourceNumbers.map((item) => item.value) : fallbackValues.slice(0, chartLabels.length);
  return {
    type: index % 2 === 0 ? "bar" : "line",
    labels: chartLabels.slice(0, 5),
    values: values.slice(0, 5),
  };
}

function buildWebDeckHtml(plan) {
  const chartJs = readChartJsRuntime();
  const deckData = {
    title: plan.title,
    sourceType: plan.sourceType,
    audience: plan.audience || "확인 필요",
    purpose: plan.purpose || "발표",
    tone: plan.tone,
    ratio: plan.ratio,
    detailLevel: plan.detailLevel,
    fontScale: plan.fontScale,
    theme: plan.theme,
    slides: plan.slides.map((slide) => ({
      type: slide.type,
      layout: slide.layout,
      title: slide.title,
      message: slide.message,
      bullets: slide.bullets,
      visual: slide.visual,
      chart: slide.chart,
    })),
  };

  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(plan.title)}</title>
  <style>${webDeckCss(plan)}</style>
</head>
<body data-theme="${escapeHtml(plan.theme)}" data-font-scale="${escapeHtml(plan.fontScale)}">
  <main class="deck" aria-label="${escapeHtml(plan.title)}">
    ${plan.slides.map((slide, index) => slideHtml(slide, index, plan)).join("\n")}
  </main>
  <nav class="deck-nav" aria-label="슬라이드 이동">
    <button type="button" data-edit-toggle>편집</button>
    <button type="button" data-font-down>글자-</button>
    <button type="button" data-font-up>글자+</button>
    <button type="button" data-save-html>HTML 저장</button>
    <button type="button" data-print>인쇄/PDF</button>
    <button type="button" data-prev>이전</button>
    <span><strong data-current>1</strong> / ${plan.slides.length}</span>
    <button type="button" data-next>다음</button>
  </nav>
  <script>${chartJs}</script>
  <script>
    window.HEYU_WEB_DECK = ${safeJson(deckData)};
    ${webDeckRuntime()}
  </script>
</body>
</html>`;
}

function readChartJsRuntime() {
  const candidates = [
    path.join(ROOT_DIR, "node_modules", "chart.js", "dist", "chart.umd.min.js"),
    path.join(process.resourcesPath || "", "app.asar.unpacked", "node_modules", "chart.js", "dist", "chart.umd.min.js"),
    path.join(process.resourcesPath || "", "app.asar", "node_modules", "chart.js", "dist", "chart.umd.min.js"),
  ];
  for (const candidate of candidates) {
    try {
      if (candidate && fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
    } catch (_error) {
      // Try next candidate.
    }
  }
  return "";
}

function webDeckCss(plan) {
  const isFourThree = plan.ratio === "4:3";
  const fontScale = plan.fontScale === "large" ? 1.08 : plan.fontScale === "compact" ? 0.92 : 1;
  const theme = webDeckTheme(plan.theme);
  return `
:root {
  color-scheme: light;
  --ink: #17202b;
  --muted: #5e6877;
  --line: #dfe6ee;
  --paper: #ffffff;
  --soft: #f4f7fb;
  --accent: ${theme.accent};
  --accent-2: ${theme.accent2};
  --accent-3: ${theme.accent3};
  --dark-panel: ${theme.darkPanel};
  --danger: #c74a3b;
  --shadow: 0 18px 50px rgba(25, 35, 50, 0.16);
  --deck-font-scale: ${fontScale};
  font-family: "Malgun Gothic", "Apple SD Gothic Neo", system-ui, sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #edf2f7;
  color: var(--ink);
}
.deck {
  width: min(100vw, ${isFourThree ? "1080px" : "1280px"});
  margin: 0 auto;
  padding: 24px 24px 84px;
}
.slide {
  position: relative;
  width: 100%;
  aspect-ratio: ${isFourThree ? "4 / 3" : "16 / 9"};
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 22px;
  margin: 0 auto 28px;
  padding: 48px 54px 38px;
  overflow: hidden;
  border: 1px solid rgba(23, 32, 43, 0.08);
  border-radius: 8px;
  background: var(--paper);
  box-shadow: var(--shadow);
  page-break-after: always;
}
.slide::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 9px;
  background: linear-gradient(90deg, var(--accent), var(--accent-3), var(--accent-2));
}
.slide-header {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 10px;
}
.eyebrow {
  color: var(--accent);
  font-size: 15px;
  font-weight: 900;
}
h1, h2, p { margin: 0; }
h1 {
  max-width: 880px;
  font-size: calc(48px * var(--deck-font-scale));
  line-height: 1.16;
  letter-spacing: 0;
}
h2 {
  max-width: 960px;
  font-size: calc(34px * var(--deck-font-scale));
  line-height: 1.2;
  letter-spacing: 0;
}
.message {
  max-width: 900px;
  color: var(--muted);
  font-size: calc(18px * var(--deck-font-scale));
  line-height: 1.5;
  font-weight: 700;
}
.slide-body {
  min-height: 0;
  position: relative;
  z-index: 1;
}
.cover {
  grid-template-rows: minmax(0, 1fr) auto;
  padding-top: 86px;
}
.cover .slide-header {
  align-self: center;
}
.cover h1 {
  max-width: 1000px;
  font-size: calc(58px * var(--deck-font-scale));
}
.meta-grid,
.card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 16px;
}
.meta-card,
.info-card,
.check-card,
.risk-card {
  min-width: 0;
  min-height: 120px;
  display: grid;
  align-content: start;
  gap: 10px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--soft);
}
.meta-card strong,
.info-card strong,
.check-card strong,
.risk-card strong {
  font-size: 17px;
  line-height: 1.35;
}
.meta-card span,
.info-card span,
.check-card span,
.risk-card span {
  color: var(--muted);
  font-size: 13px;
  font-weight: 800;
}
.split-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
  gap: 24px;
  align-items: stretch;
}
.big-number {
  display: grid;
  place-items: center;
  border-radius: 8px;
  background: var(--dark-panel);
  color: #fff;
  text-align: center;
}
.big-number strong {
  font-size: 92px;
  line-height: 1;
}
.big-number span {
  margin-top: 12px;
  color: #dce9ff;
  font-size: 17px;
  font-weight: 800;
}
.bullet-list {
  display: grid;
  gap: 13px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.bullet-list li {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  color: #2b3543;
  font-size: calc(18px * var(--deck-font-scale));
  line-height: 1.42;
  font-weight: 750;
}
.bullet-list li::before {
  content: "";
  width: 10px;
  height: 10px;
  margin-top: 8px;
  border-radius: 999px;
  background: var(--accent);
}
.steps {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.step-card {
  min-width: 0;
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 8px;
  background: #f7f9fc;
  border: 1px solid var(--line);
}
.step-card b {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  background: var(--accent);
  color: #fff;
}
.chart-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.25fr);
  gap: 24px;
  align-items: stretch;
}
.chart-box {
  min-height: 300px;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #fff;
}
.chart-box canvas {
  width: 100% !important;
  height: 100% !important;
}
.footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  color: #7b8592;
  font-size: 12px;
  font-weight: 800;
}
.deck-nav {
  position: fixed;
  left: 50%;
  bottom: 18px;
  z-index: 20;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px;
  border: 1px solid rgba(23, 32, 43, 0.12);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 10px 28px rgba(20, 30, 45, 0.18);
  backdrop-filter: blur(12px);
}
.deck-nav button {
  height: 34px;
  padding: 0 13px;
  border: 0;
  border-radius: 999px;
  background: #17202b;
  color: #fff;
  font-weight: 900;
}
.deck-nav span {
  min-width: 58px;
  text-align: center;
  color: var(--muted);
  font-size: 13px;
  font-weight: 900;
}
.deck-nav button.is-active {
  background: var(--accent);
}
.editable [data-editable] {
  outline: 2px dashed rgba(36, 87, 214, 0.28);
  outline-offset: 4px;
  border-radius: 4px;
}
.editable [data-editable]:focus {
  outline-color: var(--accent);
  background: rgba(36, 87, 214, 0.06);
}
@media print {
  body { background: #fff; }
  .deck { width: 100%; padding: 0; }
  .slide { margin: 0; border: 0; border-radius: 0; box-shadow: none; }
  .deck-nav { display: none; }
}
@media (max-width: 820px) {
  .deck { padding: 10px 10px 70px; }
  .slide { padding: 28px; gap: 14px; }
  h1, .cover h1 { font-size: 34px; }
  h2 { font-size: 25px; }
  .message { font-size: 15px; }
  .split-layout, .chart-layout, .meta-grid, .card-grid, .steps { grid-template-columns: 1fr; }
  .big-number { display: none; }
}`;
}

function webDeckTheme(theme) {
  if (theme === "forest") {
    return {
      accent: "#13795b",
      accent2: "#d7b85a",
      accent3: "#2f8f9d",
      darkPanel: "#12352c",
    };
  }
  if (theme === "mono") {
    return {
      accent: "#27313d",
      accent2: "#8a939e",
      accent3: "#596170",
      darkPanel: "#1f252d",
    };
  }
  return {
    accent: "#2457d6",
    accent2: "#f2c84b",
    accent3: "#0f9f84",
    darkPanel: "#11243f",
  };
}

function slideHtml(slide, index, plan) {
  if (slide.layout === "cover") {
    return `<section class="slide cover" data-slide="${index}">
  <header class="slide-header">
    <div class="eyebrow" data-editable>${escapeHtml(plan.sourceType)} · ${escapeHtml(plan.purpose || "발표")}</div>
    <h1 data-editable>${escapeHtml(slide.title)}</h1>
    <p class="message" data-editable>${escapeHtml(slide.message)}</p>
  </header>
  <div class="slide-body">
    <div class="meta-grid">
      ${slide.bullets.slice(0, 3).map((item) => `<div class="meta-card"><span>요약</span><strong data-editable>${escapeHtml(item)}</strong></div>`).join("")}
    </div>
  </div>
  ${footerHtml(index, plan)}
</section>`;
  }

  const header = `<header class="slide-header">
    <div class="eyebrow" data-editable>${escapeHtml(slide.visual || "웹 슬라이드")}</div>
    <h2 data-editable>${escapeHtml(slide.title)}</h2>
    <p class="message" data-editable>${escapeHtml(slide.message)}</p>
  </header>`;

  let body = "";
  if (slide.layout === "chart") {
    body = `<div class="slide-body chart-layout">
      <ul class="bullet-list">${slide.bullets.slice(0, 5).map((item) => `<li><span data-editable>${escapeHtml(item)}</span></li>`).join("")}</ul>
      <div class="chart-box"><canvas data-chart-index="${index}"></canvas></div>
    </div>`;
  } else if (slide.layout === "steps") {
    body = `<div class="slide-body steps">
      ${slide.bullets.slice(0, 5).map((item, itemIndex) => `<div class="step-card"><b>${itemIndex + 1}</b><strong data-editable>${escapeHtml(item)}</strong></div>`).join("")}
    </div>`;
  } else if (slide.layout === "checklist") {
    body = `<div class="slide-body card-grid">
      ${slide.bullets.slice(0, 6).map((item, itemIndex) => `<div class="${slide.type === "risks" ? "risk-card" : "check-card"}"><span>${slide.type === "risks" ? "점검" : `조치 ${itemIndex + 1}`}</span><strong data-editable>${escapeHtml(item)}</strong></div>`).join("")}
    </div>`;
  } else if (slide.layout === "split") {
    body = `<div class="slide-body split-layout">
      <div class="big-number"><div><strong>${String(index + 1).padStart(2, "0")}</strong><span>${escapeHtml(plan.sourceType)}</span></div></div>
      <ul class="bullet-list">${slide.bullets.slice(0, 5).map((item) => `<li><span data-editable>${escapeHtml(item)}</span></li>`).join("")}</ul>
    </div>`;
  } else {
    body = `<div class="slide-body card-grid">
      ${slide.bullets.slice(0, 6).map((item, itemIndex) => `<div class="info-card"><span>핵심 ${itemIndex + 1}</span><strong data-editable>${escapeHtml(item)}</strong></div>`).join("")}
    </div>`;
  }

  return `<section class="slide ${escapeHtml(slide.type || "content")}" data-slide="${index}">
  ${header}
  ${body}
  ${footerHtml(index, plan)}
</section>`;
}

function footerHtml(index, plan) {
  return `<footer class="footer"><span>AI지원담당 · Web deck</span><span>${index + 1} / ${plan.slides.length}</span></footer>`;
}

function webDeckRuntime() {
  return `
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll(".slide"));
  var current = 0;
  var currentLabel = document.querySelector("[data-current]");
  var editable = false;
  var scaleOrder = ["compact", "normal", "large"];
  var editButton = document.querySelector("[data-edit-toggle]");
  function setEditable(next) {
    editable = Boolean(next);
    document.body.classList.toggle("editable", editable);
    document.querySelectorAll("[data-editable]").forEach(function (node) {
      node.contentEditable = editable ? "true" : "false";
      node.spellcheck = false;
    });
    if (editButton) {
      editButton.classList.toggle("is-active", editable);
      editButton.textContent = editable ? "편집 중" : "편집";
    }
  }
  function show(index) {
    current = Math.max(0, Math.min(slides.length - 1, index));
    slides[current].scrollIntoView({ behavior: "smooth", block: "start" });
    if (currentLabel) currentLabel.textContent = String(current + 1);
  }
  function setFontScale(direction) {
    var currentScale = document.body.dataset.fontScale || "normal";
    var index = Math.max(0, scaleOrder.indexOf(currentScale));
    var next = scaleOrder[Math.max(0, Math.min(scaleOrder.length - 1, index + direction))];
    document.body.dataset.fontScale = next;
    var value = next === "large" ? "1.08" : next === "compact" ? "0.92" : "1";
    document.documentElement.style.setProperty("--deck-font-scale", value);
  }
  function downloadHtml() {
    setEditable(false);
    var html = "<!doctype html>\\n" + document.documentElement.outerHTML;
    var blob = new Blob([html], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = (window.HEYU_WEB_DECK.title || "web-presentation").replace(/[\\\\/:*?"<>|]+/g, "_") + "-edited.html";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  setEditable(false);
  editButton?.addEventListener("click", function () { setEditable(!editable); });
  document.querySelector("[data-font-down]")?.addEventListener("click", function () { setFontScale(-1); });
  document.querySelector("[data-font-up]")?.addEventListener("click", function () { setFontScale(1); });
  document.querySelector("[data-save-html]")?.addEventListener("click", downloadHtml);
  document.querySelector("[data-print]")?.addEventListener("click", function () { window.print(); });
  document.querySelector("[data-prev]")?.addEventListener("click", function () { show(current - 1); });
  document.querySelector("[data-next]")?.addEventListener("click", function () { show(current + 1); });
  window.addEventListener("keydown", function (event) {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") show(current + 1);
    if (event.key === "ArrowLeft" || event.key === "PageUp") show(current - 1);
  });
  if (window.Chart) {
    document.querySelectorAll("canvas[data-chart-index]").forEach(function (canvas) {
      var slide = window.HEYU_WEB_DECK.slides[Number(canvas.dataset.chartIndex)] || {};
      var chart = slide.chart || {};
      new Chart(canvas, {
        type: chart.type || "bar",
        data: {
          labels: chart.labels || [],
          datasets: [{
            label: slide.title || "수치",
            data: chart.values || [],
            borderColor: "#2457d6",
            backgroundColor: ["#2457d6", "#0f9f84", "#f2c84b", "#c74a3b", "#6b7cff"],
            borderWidth: 3,
            tension: 0.35
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: "#5e6877", font: { weight: "bold" } } },
            y: { beginAtZero: true, grid: { color: "#e8eef5" }, ticks: { color: "#5e6877" } }
          }
        }
      });
    });
  }
})();`;
}

function buildReplyText(plan, llmText = "") {
  const cleanedLlmText = normalizeLlmReplyText(llmText);
  const downloadText = "다운로드\n아래 웹 발표자료 카드의 다운로드 버튼을 누르면 HTML 파일로 저장할 수 있습니다. 브라우저에서 열면 편집 버튼으로 제목과 본문을 직접 고치고, 글자 크기를 조정한 뒤 HTML 저장 또는 인쇄/PDF 저장을 할 수 있습니다.";
  if (cleanedLlmText) {
    return cleanedLlmText.includes("다운로드") ? cleanedLlmText.replace(/PPTX|pptx/g, "웹 발표자료") : `${cleanedLlmText}\n\n${downloadText}`;
  }

  return [
    "1차 준비",
    `${plan.sourceType}를 기준으로 ${plan.slides.length}장짜리 웹 발표자료 초안을 만들었습니다.`,
    `목적: ${plan.purpose || "확인 필요"}`,
    `청중: ${plan.audience || "확인 필요"}`,
    `톤: ${plan.tone}`,
    `화면비: ${plan.ratio}`,
    plan.sourceNote,
    "",
    "슬라이드 구성안",
    ...plan.slides.map((slide, index) => `${index + 1}. ${slide.title}: ${slide.message}`),
    "",
    downloadText,
    "",
    "확인 필요 사항",
    ...plan.missing.map((item) => `- ${item}`),
  ].join("\n");
}

function normalizeLlmReplyText(value) {
  return String(value || "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/실제\s*pptx?\s*파일\s*저장\s*기능이\s*(?:아직\s*)?연결되지\s*않[^\n]*/gi, "")
    .replace(/파일을\s*생성했다고\s*말하지\s*않[^\n]*/g, "")
    .replace(/PPTX/g, "웹 발표자료")
    .replace(/pptx/g, "웹 발표자료")
    .trim();
}

function uniqueTexts(items) {
  const seen = new Set();
  const seenKeys = [];
  const output = [];
  for (const item of items) {
    const text = String(item || "").replace(/\s+/g, " ").trim();
    const key = normalizeUniqueKey(text);
    if (!text || seen.has(text) || seenKeys.some((seenKey) => key && seenKey && (key === seenKey || (key.length >= 14 && seenKey.includes(key)) || (seenKey.length >= 14 && key.includes(seenKey))))) continue;
    seen.add(text);
    seenKeys.push(key);
    output.push(text);
  }
  return output;
}

function normalizeUniqueKey(value) {
  return String(value || "")
    .replace(/^(문제점은|확인\s*필요한\s*사항은|주요\s*성과는|다음\s*달에는|핵심\s*\d+|조치\s*\d+)\s*/g, "")
    .replace(/[^\w가-힣]/g, "")
    .replace(/입니다|이다|한다|했다|합니다|습니다|많음|많고|점이다|예정이다/g, "")
    .toLowerCase();
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shorten(value, length) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= length) return text;
  return `${text.slice(0, Math.max(0, length - 1))}…`;
}

function sanitizeFileName(value) {
  return String(value || "web-presentation")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

module.exports = {
  buildPresentationOfficerReply,
};
