const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { searchLegalVectorEvidence } = require("./vector-search.cjs");

const ROOT_DIR = path.join(__dirname, "..", "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const MAX_CANDIDATES_PER_FILE = 18;
const LEGAL_CONTEXT_ITEM_LIMIT = 6;

const EMP_SAFETY_SEARCH_TERMS = [
  "전파법",
  "제56조",
  "전파법 제56조",
  "고출력 전자파",
  "누설 전자파",
  "고출력ㆍ누설 전자파",
  "고출력ㆍ누설 전자파 안전성 평가",
  "방호차폐시설",
  "장비보호시설",
  "정보유출 방지",
  "안전성 평가기준",
  "과학기술정보통신부장관",
];

const CURATED_EMP_SAFETY_EVIDENCE = [
  {
    sourceId: "curated-emp-safety-radio-law",
    sourceLabel: "법령",
    title: "전파법",
    meta: "제56조",
    text:
      "제56조(고출력ㆍ누설 전자파 안전성 평가 등) 고출력 전자파로 인한 피해와 누설 전자파에 의한 정보유출을 방지하기 위하여 방호차폐시설 또는 장비보호시설 등을 구축한 자는 과학기술정보통신부장관에게 그 시설 등의 안전성 평가를 의뢰할 수 있다. 과학기술정보통신부장관은 안전성을 평가하고 그 결과를 통지하여야 하며, 평가기준 및 방법 등에 필요한 세부사항은 고시로 정한다.",
    articleTitle: "고출력ㆍ누설 전자파 안전성 평가 등",
    sourceFile: "laws/001732.json",
    lawKey: "001732",
  },
];

const CURATED_CIVIL_CONTRACT_EVIDENCE = [
  {
    meta: "제390조",
    text: "제390조(채무불이행과 손해배상) 채무자가 채무의 내용에 좇은 이행을 하지 아니한 때에는 채권자는 손해배상을 청구할 수 있다.",
    keywords: ["채무불이행", "손해배상", "손해", "이행하지"],
  },
  {
    meta: "제543조",
    text: "제543조(해지, 해제권) 계약 또는 법률의 규정에 의하여 당사자의 일방이나 쌍방이 해지 또는 해제의 권리가 있는 때에는 그 해지 또는 해제는 상대방에 대한 의사표시로 한다.",
    keywords: ["해지", "해제", "계약 해제", "의사표시"],
  },
  {
    meta: "제544조",
    text: "제544조(이행지체와 해제) 당사자 일방이 그 채무를 이행하지 아니하는 때에는 상대방은 상당한 기간을 정하여 그 이행을 최고하고 그 기간 내에 이행하지 아니한 때에는 계약을 해제할 수 있다. 다만 채무자가 미리 이행하지 아니할 의사를 표시한 경우에는 최고를 요하지 아니한다.",
    keywords: ["이행지체", "납기", "납기일", "완성", "완성본", "최고", "계약 해제", "해제"],
  },
  {
    meta: "제548조",
    text: "제548조(해제의 효과, 원상회복의무) 당사자 일방이 계약을 해제한 때에는 각 당사자는 그 상대방에 대하여 원상회복의 의무가 있다. 이 경우 반환할 금전에는 그 받은 날로부터 이자를 가하여야 한다.",
    keywords: ["원상회복", "반환", "환불", "착수금", "계약금", "해제의 효과"],
  },
  {
    meta: "제551조",
    text: "제551조(해지, 해제와 손해배상) 계약의 해지 또는 해제는 손해배상의 청구에 영향을 미치지 아니한다.",
    keywords: ["손해배상", "해제", "해지"],
  },
  {
    meta: "제664조",
    text: "제664조(도급의 의의) 도급은 당사자 일방이 어느 일을 완성할 것을 약정하고 상대방이 그 일의 결과에 대하여 보수를 지급할 것을 약정함으로써 효력이 생긴다.",
    keywords: ["도급", "제작", "용역", "홈페이지", "완성", "보수", "잔금"],
  },
  {
    meta: "제665조",
    text: "제665조(보수의 지급시기) 보수는 그 완성된 목적물의 인도와 동시에 지급하여야 한다. 목적물의 인도를 요하지 아니하는 경우에는 그 일을 완성한 후 지체 없이 지급하여야 한다.",
    keywords: ["보수", "잔금", "완성", "목적물", "인도"],
  },
  {
    meta: "제673조",
    text: "제673조(완성전의 도급인의 해제권) 수급인이 일을 완성하기 전에는 도급인은 손해를 배상하고 계약을 해제할 수 있다.",
    keywords: ["도급인", "수급인", "완성전", "계약 해제", "해제"],
  },
];

const CURATED_LEASE_DEPOSIT_EVIDENCE = [
  {
    title: "민법",
    meta: "제615조",
    text: "제615조(차주의 원상회복의무와 철거권) 차주가 차용물을 반환하는 때에는 이를 원상에 회복하여야 한다. 이에 부속시킨 물건은 철거할 수 있다.",
    keywords: ["임대차", "원상회복", "원상복구", "퇴거", "하자", "벽지", "욕실", "문틀"],
  },
  {
    title: "민법",
    meta: "제640조",
    text: "제640조(차임연체와 해지) 건물 기타 공작물의 임대차에는 임차인의 차임연체액이 2기의 차임액에 달하는 때에는 임대인은 계약을 해지할 수 있다.",
    keywords: ["월세", "차임", "연체", "2기", "해지"],
  },
  {
    title: "민법",
    meta: "제654조",
    text: "제654조(준용규정) 제615조의 규정은 임대차에 이를 준용한다.",
    keywords: ["임대차", "원상회복", "준용", "퇴거"],
  },
  {
    title: "주택임대차보호법",
    meta: "제4조제2항",
    text: "제4조제2항은 임대차기간이 끝난 경우에도 임차인이 보증금을 반환받을 때까지는 임대차관계가 존속되는 것으로 본다고 정한다.",
    keywords: ["주택임대차", "보증금", "반환", "임대차기간", "존속"],
  },
];

const CURATED_PRIVACY_BREACH_EVIDENCE = [
  {
    title: "개인정보 보호법",
    meta: "제2조",
    text: "제2조(정의) 개인정보는 살아 있는 개인에 관한 정보로서 성명 등 개인을 알아볼 수 있는 정보이고, 개인정보처리자는 업무를 목적으로 개인정보파일을 운용하기 위하여 개인정보를 처리하는 법인, 단체 및 개인 등을 말한다.",
    keywords: ["개인정보", "개인정보처리자", "수강생", "연락처", "생년월일", "보호자", "DB"],
  },
  {
    title: "개인정보 보호법",
    meta: "제26조",
    text: "제26조(업무위탁에 따른 개인정보의 처리 제한) 개인정보처리자가 개인정보 처리 업무를 위탁하는 경우 문서로 하여야 하고, 위탁자는 수탁자를 교육ㆍ감독하여야 하며, 수탁자는 위탁받은 업무 범위를 초과하여 개인정보를 이용하거나 제3자에게 제공하여서는 아니 된다.",
    keywords: ["업무위탁", "처리위탁", "위탁자", "수탁자", "유지보수", "관리자 계정", "수탁자"],
  },
  {
    title: "개인정보 보호법",
    meta: "제29조",
    text: "제29조(안전조치의무) 개인정보처리자는 개인정보가 분실ㆍ도난ㆍ유출ㆍ위조ㆍ변조 또는 훼손되지 아니하도록 내부 관리계획 수립, 접속기록 보관 등 안전성 확보에 필요한 기술적ㆍ관리적 및 물리적 조치를 하여야 한다.",
    keywords: ["안전조치", "암호화", "노트북", "악성코드", "외부 IP", "접속기록", "보안 사고"],
  },
  {
    title: "개인정보 보호법",
    meta: "제34조",
    text: "제34조(개인정보 유출 등의 통지ㆍ신고) 개인정보처리자는 개인정보가 분실ㆍ도난ㆍ유출되었음을 알게 되었을 때에는 지체 없이 정보주체에게 유출 항목, 시점과 경위, 피해 최소화 방법, 대응조치와 피해구제절차 등을 알려야 하고, 대통령령으로 정하는 바에 따라 보호위원회 또는 전문기관에 신고하여야 한다.",
    keywords: ["유출", "통지", "신고", "정보주체", "보호위원회", "전문기관", "지체 없이"],
  },
  {
    title: "개인정보 보호법",
    meta: "제39조",
    text: "제39조(손해배상책임) 정보주체는 개인정보처리자가 개인정보 보호법을 위반한 행위로 손해를 입으면 손해배상을 청구할 수 있고, 개인정보처리자는 고의 또는 과실이 없음을 입증하지 아니하면 책임을 면할 수 없다.",
    keywords: ["손해배상", "손해", "배상", "고의", "과실", "피해"],
  },
  {
    title: "개인정보 보호법",
    meta: "제39조의2",
    text: "제39조의2(법정손해배상의 청구) 정보주체는 개인정보처리자의 고의 또는 과실로 개인정보가 분실ㆍ도난ㆍ유출ㆍ위조ㆍ변조 또는 훼손된 경우 300만원 이하의 범위에서 상당한 금액을 손해액으로 하여 배상을 청구할 수 있다.",
    keywords: ["법정손해배상", "300만원", "유출", "손해액"],
  },
];

const CURATED_LABOR_WORKER_STATUS_EVIDENCE = [
  {
    title: "근로기준법",
    meta: "제2조",
    text: "제2조(정의) '근로자'란 직업의 종류와 관계없이 임금을 목적으로 사업이나 사업장에 근로를 제공하는 사람을 말한다.",
    keywords: ["근로자", "근로자성", "프리랜서", "용역계약", "출근", "지휘", "감독", "고정급", "임금"],
  },
  {
    title: "근로기준법",
    meta: "제36조",
    text: "제36조(금품 청산) 사용자는 근로자가 사망 또는 퇴직한 경우에는 그 지급 사유가 발생한 때부터 14일 이내에 임금, 보상금, 그 밖의 일체의 금품을 지급하여야 한다. 특별한 사정이 있는 경우에는 당사자 사이의 합의로 기일을 연장할 수 있다.",
    keywords: ["미지급", "임금", "보수", "퇴직", "금품", "청산", "14일"],
  },
  {
    title: "근로기준법",
    meta: "제60조",
    text: "제60조(연차 유급휴가) 사용자는 1년간 80퍼센트 이상 출근한 근로자에게 15일의 유급휴가를 주어야 한다. 계속하여 근로한 기간이 1년 미만인 근로자 또는 1년간 80퍼센트 미만 출근한 근로자에게는 1개월 개근 시 1일의 유급휴가를 주어야 한다.",
    keywords: ["연차", "연차수당", "유급휴가", "출근"],
  },
  {
    title: "근로기준법",
    meta: "제23조",
    text: "제23조(해고 등의 제한) 사용자는 근로자에게 정당한 이유 없이 해고, 휴직, 정직, 전직, 감봉, 그 밖의 징벌을 하지 못한다.",
    keywords: ["해고", "계약 종료", "종료", "정당한 이유", "통보"],
  },
  {
    title: "근로기준법",
    meta: "제26조",
    text: "제26조(해고의 예고) 사용자는 근로자를 해고하려면 적어도 30일 전에 예고하여야 하고, 30일 전에 예고하지 아니하였을 때에는 30일분 이상의 통상임금을 지급하여야 한다. 다만 계속 근로한 기간이 3개월 미만인 경우 등은 예외로 한다.",
    keywords: ["해고예고", "계약 종료", "종료", "통보", "30일", "갑작스러운"],
  },
  {
    title: "근로자퇴직급여 보장법",
    meta: "제4조",
    text: "제4조(퇴직급여제도의 설정) 사용자는 퇴직하는 근로자에게 급여를 지급하기 위하여 퇴직급여제도 중 하나 이상의 제도를 설정하여야 한다. 다만 계속근로기간이 1년 미만인 근로자 등은 제외된다.",
    keywords: ["퇴직금", "퇴직급여", "1년", "계속근로"],
  },
  {
    title: "근로자퇴직급여 보장법",
    meta: "제8조",
    text: "제8조(퇴직금제도의 설정 등) 퇴직금제도를 설정하려는 사용자는 계속근로기간 1년에 대하여 30일분 이상의 평균임금을 퇴직금으로 퇴직 근로자에게 지급할 수 있는 제도를 설정하여야 한다.",
    keywords: ["퇴직금", "평균임금", "30일분"],
  },
];

const LEGAL_SOURCES = [
  {
    id: "law",
    label: "법령",
    path: path.join(DATA_DIR, "law", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "law", "manifest.json"),
    limit: 6,
  },
  {
    id: "precedent-body",
    label: "판례",
    path: path.join(DATA_DIR, "precedent_body", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "precedent_body", "manifest.json"),
    limit: 4,
  },
  {
    id: "expc",
    label: "법령해석례",
    path: path.join(DATA_DIR, "legal_refs", "expc", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "expc", "manifest.json"),
    limit: 3,
  },
  {
    id: "decc",
    label: "행정심판례",
    path: path.join(DATA_DIR, "legal_refs", "decc", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "decc", "manifest.json"),
    limit: 3,
  },
  {
    id: "admrul",
    label: "행정규칙",
    path: path.join(DATA_DIR, "legal_refs", "admrul", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "admrul", "manifest.json"),
    limit: 3,
  },
  {
    id: "detc",
    label: "헌재결정례",
    path: path.join(DATA_DIR, "legal_refs", "detc", "search-index.jsonl"),
    manifest: path.join(DATA_DIR, "legal_refs", "detc", "manifest.json"),
    limit: 2,
  },
];

const STOP_WORDS = new Set([
  "관련",
  "대한",
  "대해",
  "어떻게",
  "무엇",
  "지금",
  "현재",
  "뭐야",
  "얼마",
  "얼마냐",
  "얼마인지",
  "프로야",
  "그거",
  "그건",
  "그럼",
  "이거",
  "이건",
  "저거",
  "몇조",
  "몇조야",
  "조야",
  "확인",
  "기준",
  "경우",
  "하는",
  "하려고",
  "가능",
  "알려줘",
  "알려",
  "있나",
  "있어",
  "되나",
  "해야",
  "해줘",
]);

const LAW_ALIASES = [
  {
    aliases: ["정보통신망법", "망법"],
    lawName: "정보통신망 이용촉진 및 정보보호 등에 관한 법률",
    terms: ["정보통신망", "정보보호", "정보통신망 이용촉진", "정보통신망 이용촉진 및 정보보호"],
  },
  {
    aliases: ["국가계약법", "국계법"],
    lawName: "국가를 당사자로 하는 계약에 관한 법률",
    terms: ["국가를 당사자로 하는 계약", "국가계약"],
  },
  {
    aliases: ["지방계약법", "지계법"],
    lawName: "지방자치단체를 당사자로 하는 계약에 관한 법률",
    terms: ["지방자치단체를 당사자로 하는 계약", "지방계약"],
  },
  {
    aliases: ["근기법"],
    lawName: "근로기준법",
    terms: [
      "근로기준법",
      "근로자",
      "사용자",
      "임금",
      "근로시간",
      "휴게",
      "휴일",
      "고용노동부",
    ],
  },
  {
    aliases: ["노조법"],
    lawName: "노동조합 및 노동관계조정법",
    terms: ["노동조합", "단체교섭", "단체협약", "부당노동행위", "쟁의행위"],
  },
  {
    aliases: ["개보법", "개인정보보호법"],
    lawName: "개인정보 보호법",
    terms: ["개인정보", "개인정보 보호", "안전성 확보조치", "개인정보 유출"],
  },
  {
    aliases: ["정보공개법"],
    lawName: "공공기관의 정보공개에 관한 법률",
    terms: ["정보공개", "비공개 대상 정보", "공개 청구"],
  },
];

const ADMIN_PRIMARY_LAWS = [
  "국가를 당사자로 하는 계약에 관한 법률",
  "지방자치단체를 당사자로 하는 계약에 관한 법률",
  "국가계약법",
  "지방계약법",
  "계약예규",
  "정부 입찰ㆍ계약 집행기준",
  "정부입찰계약집행기준",
  "지방자치단체 입찰 및 계약집행기준",
  "지방자치단체 입찰시 낙찰자 결정기준",
  "지방회계법",
  "지방회계법 시행령",
  "지방자치단체 회계관리에 관한 훈령",
  "국가재정법",
  "국고금 관리법",
  "보조금 관리에 관한 법률",
  "지방자치단체 보조금 관리에 관한 법률",
  "공유재산 및 물품 관리법",
  "물품관리법",
  "공무원 여비 규정",
  "국가공무원 복무규정",
  "지방공무원 복무규정",
  "민원 처리에 관한 법률",
  "공공기록물 관리에 관한 법률",
  "공공기관의 정보공개에 관한 법률",
  "행정업무의 운영 및 혁신에 관한 규정",
];

const ADMIN_SCOPE_TERMS = [
  "계약",
  "입찰",
  "수의계약",
  "견적",
  "1인 견적",
  "예정가격",
  "낙찰",
  "검사",
  "검수",
  "납품",
  "지체상금",
  "선금",
  "기성금",
  "하자",
  "계약보증금",
  "대금 지급",
  "지출",
  "지출품의",
  "지출결의",
  "원인행위",
  "예산",
  "예산집행",
  "세출",
  "증빙",
  "법인카드",
  "업무추진비",
  "정산",
  "보조금",
  "출장",
  "여비",
  "숙박비",
  "일비",
  "식비",
  "항공운임",
  "공문",
  "기록물",
  "정보공개",
  "비공개",
  "민원",
  "위임전결",
  "복무",
  "휴가",
  "근태",
  "외부강의",
  "물품",
  "공유재산",
  "재물조사",
  "불용",
  "취득",
  "처분",
];

const ADMIN_OUT_OF_SCOPE_LAWS = [
  "근로기준법",
  "근로자퇴직급여 보장법",
  "개인정보 보호법",
  "형법",
  "민법",
  "상법",
  "주택임대차보호법",
];

const ADMIN_EXCLUDED_SEARCH_TERMS = new Set([
  "민법",
  "도급",
  "계약 해제",
  "이행지체",
  "원상회복",
  "채무불이행",
  "손해배상",
  "보수 지급시기",
  "착수금 반환",
  "잔금",
  "제390조",
  "제543조",
  "제544조",
  "제548조",
  "제551조",
  "제664조",
  "제665조",
  "제673조",
]);

let manifestCache = null;
let empIndexCache = null;
let publicOfficialTravelLawCache = null;

function buildLegalLocalContext(userText) {
  return searchLegalEvidence(userText).then((result) => {
    if (!result.items.length) {
      return [
        "MCP 도구 결과: legal_search",
        "",
        "로컬 법률 자료 도구 검색 결과:",
        "- 질문과 직접 일치하는 법령/판례/해석례 후보를 찾지 못했습니다.",
        "- 이 경우에도 답변을 회피하지 말고, 질문의 법적 쟁점과 적용될 가능성이 높은 법령 체계를 먼저 제시합니다.",
        "- 구체적 금액, 비율, 기간, 신고 여부는 근거가 확인되지 않았으면 단정하지 말고 확인 필요로 둡니다.",
        "",
        "김법률 답변 지시:",
        "- 첫 문장을 '제공해주신 정보만으로는', '우선 이렇게 보면', '이렇게 보면'으로 시작하지 않습니다.",
        "- 먼저 1차 답변을 제시한 뒤, 마지막에 필요한 추가 정보를 묻습니다.",
        "- 이모지, 마크다운 표, 가로 구분선, 법률 자문 면책문을 쓰지 않습니다.",
        `검색어: ${result.terms.join(", ") || "(없음)"}`,
        `자료 동기화: ${formatSyncSummary(result.syncSummary)}`,
      ].join("\n");
    }

    const answerHints = extractLegalAnswerHints(userText, result.items);
    const lines = [
      "MCP 도구 결과: legal_search",
      "",
      "로컬 법률 자료 도구 검색 결과:",
      "- 아래 근거는 질문을 기준으로 로컬 JSON/JSONL 자료에서 검색한 후보입니다.",
      "- 후보 근거에 질문과 맞는 금액, 비율, 기간, 신고 여부, 가능 여부가 있으면 그 근거를 기준으로 1차 답변을 먼저 합니다.",
      "- 후보 근거가 일부 부족하면 부족한 부분만 확인 필요로 분리합니다.",
      "- 법률 결론으로 단정하지 말고, 자료 유형과 확인 필요 사항을 구분해서 답합니다.",
      "- 첫 문장을 '제공해주신 정보만으로는', '우선 이렇게 보면', '이렇게 보면'으로 시작하지 않습니다.",
      "- 이모지, 마크다운 표, 가로 구분선, 법률 자문 면책문을 쓰지 않습니다.",
      "",
      `검색어: ${result.terms.join(", ")}`,
      `자료 동기화: ${formatSyncSummary(result.syncSummary)}`,
      "",
    ];

    if (answerHints.length) {
      lines.push("수치ㆍ판단 후보:", ...answerHints.slice(0, 4).map((item, index) => `${index + 1}. ${item}`), "");
    }

    lines.push(
      "답변 형식:",
      "1차 답변: 질문에 대한 현재 기준의 결론 또는 가장 가까운 검토 의견을 먼저 제시합니다.",
      "근거: 후보 근거의 법령명, 조문, 별표, 예규, 판례 유형을 짧게 연결합니다.",
      "확인 필요 사항: 연도, 국가/지방, 계약/협약, 물품/용역/공사 등 부족한 조건만 마지막에 묻습니다.",
      "",
      "후보 근거:"
    );

    const contextItems = result.items.slice(0, LEGAL_CONTEXT_ITEM_LIMIT);
    contextItems.forEach((item, index) => {
      lines.push(
        `${index + 1}. [${item.sourceLabel}] ${item.title}${item.meta ? ` / ${item.meta}` : ""}`,
        `   ${item.text}`
      );
    });

    if (result.items.length > contextItems.length) {
      lines.push(`- 그 밖의 후보 ${result.items.length - contextItems.length}건은 컨텍스트 절약을 위해 생략했습니다.`);
    }

    return lines.join("\n");
  });
}

async function buildAdminMcpContext(userText) {
  const query = String(userText || "");
  const adminTerms = extractAdminSearchTerms(query);
  const result = await searchAdminEvidence(query, adminTerms);
  const ranked = result.items
    .map((item) => ({ item, score: scoreAdminEvidenceItem(item, query, adminTerms) }))
    .sort((a, b) => b.score - a.score);
  const adminItems = ranked
    .filter(({ score }) => score > 0)
    .slice(0, 8)
    .map(({ item }) => item);
  const scoped = looksLikeAdminPracticeQuery(query) || adminItems.length > 0;
  const answerHints = extractLegalAnswerHints(query, adminItems.length ? adminItems : result.items);

  const lines = [
    "MCP 도구 결과: admin_law_search",
    "",
    "김행정 전용 검색 규칙:",
    "- 회계ㆍ계약ㆍ서무ㆍ여비ㆍ물품ㆍ재산ㆍ민원ㆍ정보공개ㆍ기록물 실무 근거를 우선합니다.",
    "- 법령만 보지 말고 계약예규, 회계훈령, 집행기준, 별표처럼 실무 처리 기준이 되는 자료를 우선 후보로 봅니다.",
    "- 이 결과는 설치 시 반입되고 무결성을 검사한 로컬 법령ㆍ행정규칙 자료에서 찾은 후보입니다.",
    "- 노동, 민형사, 개인정보 유출, 임대차 분쟁처럼 범위 밖 쟁점은 김법률 검토 필요로 분리합니다.",
    "",
    `행정실무 검색어: ${adminTerms.join(", ") || "(없음)"}`,
    `자료 동기화: ${formatSyncSummary(result.syncSummary)}`,
    `행정 로컬 직접 근거 상태: ${adminItems.length ? "확인됨" : "없음"}`,
  ];

  if (!scoped) {
    lines.push(
      "",
      "범위 판단:",
      "- 현재 질문은 김행정의 통상 회계ㆍ계약ㆍ서무 범위와 직접 연결되는 단서가 약합니다.",
      "- 답변할 때 가능한 행정실무 쟁점만 짧게 정리하고, 나머지는 김법률 검토 필요로 분리합니다."
    );
  }

  if (answerHints.length) {
    lines.push("", "수치ㆍ판단 후보:", ...answerHints.slice(0, 4).map((item, index) => `${index + 1}. ${item}`));
  }

  lines.push(
    "",
    "답변 형식:",
    "1차 답변: 담당자가 바로 판단해야 할 가능 여부, 기준, 처리 방향을 먼저 씁니다.",
    "적용 기준: 확인된 법령명, 예규명, 훈령명, 별표, 조문 후보를 짧게 연결합니다.",
    "실무 처리: 품의ㆍ계약ㆍ지출ㆍ정산ㆍ공문ㆍ자료요구 등 실제 다음 조치를 순서대로 제시합니다.",
    "확인 필요 사항: 국가/지방, 물품/용역/공사, 금액, 계약방식, 회계연도, 내부 위임전결처럼 부족한 조건만 마지막에 둡니다.",
    "사례형 질문 처리:",
    "- 사용자가 금액, 날짜, 업체명, 증빙 유무, 출장시간, 이동수단을 줬으면 사실관계로 보존하고, 근거 후보가 확인된 항목에만 대입합니다.",
    "- 사용자가 가능/조건부 가능/곤란/확인 필요 같은 라벨을 지정해도 근거가 없는 항목은 '확인 필요'로 표시합니다.",
    "- 산술 계산은 사용자가 비율을 직접 제시했거나 근거 후보에서 그 비율이 확인된 경우에만 합니다.",
    "- 여러 질문이 들어 있으면 하나의 수의계약 일반론으로 합치지 말고 구매, 계약방식, 지출절차, 출장ㆍ여비처럼 나누어 답합니다.",
    "",
    "김행정 전용 후보 근거:"
  );

  if (adminItems.length) {
    adminItems.slice(0, 6).forEach((item, index) => {
      lines.push(formatAdminEvidenceItem(item, index + 1));
    });
  } else {
    lines.push(
      "- 전용 범위에서 직접 일치하는 회계ㆍ계약ㆍ서무 근거를 찾지 못했습니다.",
      "- 이 상태에서는 법령상 금액ㆍ기간ㆍ요건이나 가능ㆍ곤란 여부를 모델 지식으로 보충하지 않습니다."
    );
  }

  lines.push(
    "",
    "답변 지시:",
    "- 위 로컬 후보와 로컬 김법률 MCP의 직접 근거가 함께 확인된 범위에서만 판단합니다.",
    "- 로컬 직접 근거가 없으면 구체적 결론 대신 반입해야 할 공식 자료와 처리 순서를 제시합니다.",
    "- 조문 번호와 별표 번호는 후보 근거에 있을 때만 씁니다.",
    "- 행정실무 담당자 말투로 간결하게 답하고, 마크다운 표는 쓰지 않습니다."
  );

  return lines.join("\n");
}

async function searchAdminEvidence(userText, adminTerms) {
  const terms = adminTerms.length ? adminTerms : extractAdminSearchTerms(userText);
  if (!terms.length) {
    return { terms: [], items: [], syncSummary: readSyncSummary() };
  }

  const groups = await Promise.all(
    LEGAL_SOURCES.map(async (source) => {
      try {
        return await searchJsonlSource(source, terms);
      } catch (_error) {
        return [];
      }
    })
  );

  const searchedItems = enrichLegalEvidenceItems(
    groups
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, 18)
      .map(({ score: _score, ...item }) => item),
    terms
  ).slice(0, 18);
  const curatedItems = looksLikeOverseasTravelAllowanceIssue(userText) ? buildCuratedOverseasTravelEvidence(userText) : [];

  return {
    terms,
    items: mergeLegalEvidence(curatedItems, searchedItems).slice(0, 18),
    syncSummary: readSyncSummary(),
  };
}

function extractAdminSearchTerms(userText) {
  const raw = String(userText || "").toLowerCase();
  const terms = new Set(extractSearchTerms(userText).filter((term) => !ADMIN_EXCLUDED_SEARCH_TERMS.has(term)));

  addAdminTermsByPattern(terms, raw, /(수의계약|입찰|견적|예정가격|낙찰|계약|검사|검수|납품|지체상금|선금|기성금|하자|계약보증금|대금)/, [
    "국가를 당사자로 하는 계약에 관한 법률",
    "지방자치단체를 당사자로 하는 계약에 관한 법률",
    "국가계약법",
    "지방계약법",
    "계약예규",
    "정부 입찰ㆍ계약 집행기준",
    "지방자치단체 입찰 및 계약집행기준",
    "수의계약",
    "견적서",
    "추정가격",
  ]);

  addAdminTermsByPattern(terms, raw, /(지출|품의|지출결의|원인행위|회계|예산|세출|증빙|법인카드|업무추진비|정산|보조금)/, [
    "지방회계법",
    "지방회계법 시행령",
    "지방자치단체 회계관리에 관한 훈령",
    "국가재정법",
    "국고금 관리법",
    "보조금 관리에 관한 법률",
    "지방자치단체 보조금 관리에 관한 법률",
  ]);

  addAdminTermsByPattern(terms, raw, /(출장|여비|숙박비|일비|식비|항공|국외|국내출장|국외출장)/, [
    "공무원 여비 규정",
    "공무원 여비",
    "여비 지급 구분표",
    "국외 여비 지급표",
    "별표 1",
    "별표 4",
    "일비",
    "숙박비",
    "식비",
  ]);

  addAdminTermsByPattern(terms, raw, /(복무|휴가|근태|초과근무|출장명령|겸직|외부강의)/, [
    "국가공무원 복무규정",
    "지방공무원 복무규정",
    "공무원 행동강령",
    "외부강의등",
    "복무",
  ]);

  addAdminTermsByPattern(terms, raw, /(정보공개|비공개|공개청구|내부검토|의사결정)/, [
    "공공기관의 정보공개에 관한 법률",
    "정보공개",
    "비공개대상정보",
    "의사결정",
    "내부검토",
  ]);

  addAdminTermsByPattern(terms, raw, /(기록물|공문|문서|접수|시행|결재|위임전결)/, [
    "공공기록물 관리에 관한 법률",
    "행정업무의 운영 및 혁신에 관한 규정",
    "기록물",
    "공문서",
    "위임전결",
  ]);

  addAdminTermsByPattern(terms, raw, /(민원|처리기간|보완요구|민원인|접수증)/, [
    "민원 처리에 관한 법률",
    "민원",
    "처리기간",
    "보완요구",
  ]);

  addAdminTermsByPattern(terms, raw, /(물품|공유재산|재산|불용|재물조사|취득|처분|관리전환)/, [
    "공유재산 및 물품 관리법",
    "물품관리법",
    "공유재산",
    "물품",
    "재물조사",
    "불용",
  ]);

  if (looksLikeAdminPracticeQuery(userText)) {
    ADMIN_SCOPE_TERMS.forEach((term) => {
      if (String(userText || "").includes(term)) terms.add(term);
    });
  }

  return [...terms].filter(Boolean).sort((a, b) => b.length - a.length).slice(0, 28);
}

function addAdminTermsByPattern(terms, raw, pattern, additions) {
  if (!pattern.test(raw)) return;
  additions.forEach((term) => terms.add(term));
}

function looksLikeAdminPracticeQuery(value) {
  const text = String(value || "");
  return ADMIN_SCOPE_TERMS.some((term) => text.includes(term)) || ADMIN_PRIMARY_LAWS.some((law) => text.includes(law));
}

function scoreAdminEvidenceItem(item, query, adminTerms) {
  const haystack = `${item.title || ""} ${item.meta || ""} ${item.articleTitle || ""} ${item.text || ""}`.toLowerCase();
  let score = 0;

  for (const law of ADMIN_PRIMARY_LAWS) {
    const lowered = law.toLowerCase();
    if (!haystack.includes(lowered)) continue;
    score += law.length >= 12 ? 70 : 38;
  }

  for (const term of ADMIN_SCOPE_TERMS) {
    if (haystack.includes(term.toLowerCase())) score += Math.min(20, term.length + 6);
  }

  for (const term of adminTerms || []) {
    const lowered = String(term || "").toLowerCase();
    if (!lowered || !haystack.includes(lowered)) continue;
    score += Math.min(18, lowered.length + 3);
  }

  if (item.sourceId === "admrul") score += 28;
  if (item.sourceId === "law") score += 20;
  if (item.sourceId === "decc") score += 8;
  if (item.sourceId === "expc") score += 6;

  const title = `${item.title || ""} ${item.meta || ""}`;
  if (/지방자치단체 입찰 및 계약집행기준|정부 입찰ㆍ계약 집행기준|정부입찰.*계약집행기준|계약예규/.test(title)) score += 80;
  if (/1인\s*견적|1인견적/.test(`${title} ${item.text || ""}`)) score += 55;
  if (/수의계약/.test(`${title} ${item.text || ""}`) && /(수의계약|견적)/.test(String(query || ""))) score += 28;
  if (/수의계약.*운용.*집행.*지침/.test(title) && !/국가인권위원회|해당\s*기관|위원회/.test(String(query || ""))) score -= 45;
  if (/국가종합전자조달시스템/.test(title) && /(수의계약|1인\s*견적|1인견적)/.test(String(query || ""))) score -= 20;
  if (/별표|훈령|예규|집행기준|계약집행기준|회계관리/.test(title)) score += 24;
  if (/제\d+조|별표/.test(`${item.meta || ""} ${item.text || ""}`)) score += 8;

  const outsideLaw = ADMIN_OUT_OF_SCOPE_LAWS.some((law) => haystack.includes(law.toLowerCase()));
  const adminHit = ADMIN_PRIMARY_LAWS.some((law) => haystack.includes(law.toLowerCase())) || ADMIN_SCOPE_TERMS.some((term) => haystack.includes(term.toLowerCase()));
  if (outsideLaw && !adminHit) score -= 80;
  if (/curated-labor|curated-privacy|curated-lease/.test(String(item.sourceId || ""))) score -= 90;
  if (String(item.title || "").includes("민법") && /수의계약|입찰|예정가격|지출|여비|정보공개|기록물|민원|물품|공유재산/.test(String(query || ""))) {
    score -= 35;
  }

  return score;
}

function formatAdminEvidenceItem(item, index) {
  return [
    `${index}. [${item.sourceLabel}] ${item.title}${item.meta ? ` / ${item.meta}` : ""}`,
    `   ${item.text}`,
  ].join("\n");
}

function buildEmpLocalContext(userText) {
  const query = String(userText || "");
  const evidence = findEmpEvidence(query, 5);
  const safeMode = empDataMode() === "safe";
  const lines = safeMode
    ? [
        "MCP 도구 결과: emp_search",
        "",
        "안전 테스트 데이터 모드:",
        "- 현재 EMP 표준 검색은 실제 표준, 가이드, 내부 번역본이 아니라 자체 제작한 테스트 PDF JSON만 참조합니다.",
        "- 이 모드의 근거는 파서, 검색, 표, 그림 추출 동작을 확인하기 위한 더미 문서입니다.",
        "- 실제 표준의 내용, 시험 조건, 적합성 판단으로 사용하지 않습니다.",
      ]
    : [
        "MCP 도구 결과: emp_search",
        "",
        "로컬 EMP 데이터 우선 규칙:",
        "- 아래 로컬 EMP 표준/가이드 JSON 검색 결과만 근거 후보로 사용합니다.",
        "- 검색 결과에 없는 약어 확장, 시험 성격, 구성요소 설명은 코드에서 보충하지 않습니다.",
      ];

  if (evidence.length) {
    lines.push("", "로컬 JSON 검색 근거:");
    evidence.forEach((item, index) => {
      lines.push(`${index + 1}. ${item.title} / p.${item.page} / ${item.type}: ${item.text}`);
    });
  } else {
    lines.push("", "로컬 JSON 검색 근거:", "- 직접 일치하는 EMP 표준 근거를 찾지 못했습니다. 확인하지 못한 항목은 확인 필요로 표시합니다.");
  }

  lines.push(
    "",
    "답변 지시:",
    safeMode
      ? "- 안전 테스트 모드에서는 실제 표준 검토 의견처럼 답하지 말고, 파싱된 더미 JSON 근거 확인 결과로만 답합니다."
      : "- 위 로컬 근거와 충돌하는 일반 상식 답변을 우선하지 않습니다.",
    safeMode
      ? "- 답변에는 어떤 테스트 PDF/페이지/블록에서 검색됐는지와 파싱 결과의 한계를 짧게 정리합니다."
      : "- 답변에는 용어 뜻, EMP 방호상 의미, 확인할 보호 조치 순서로 짧게 정리합니다."
  );

  return lines.join("\n");
}

function buildTranslatorMcpContext(userText) {
  const query = String(userText || "");
  const hasForeignText = /[a-zA-Z]/.test(query);
  const looksLikeShortTerm = looksLikeShortTranslatorTerm(query);
  return [
    "MCP 도구 결과: translator_context",
    "",
    "외국어 번역 처리 규칙:",
    "- 기존 한국어본 저장소, 번역 메모리, 용어집이 있으면 새 번역보다 기존 자료를 우선합니다.",
    "- 현재 앱에 연결된 기존 한국어본/번역 메모리 전용 인덱스는 아직 준비되지 않았습니다.",
    "- 따라서 기존 한국어본을 확인하지 못한 상태의 번역은 AI 번역 초안으로 표시합니다.",
    "- 숫자, 날짜, 단위, 기관명, 법령명, 고유명사는 원문과 대조합니다.",
    "- 같은 용어는 한 답변 안에서 같은 한국어 표현으로 유지합니다.",
    "- 인사말로 시작하지 않고 바로 번역문 또는 약어 뜻으로 시작합니다.",
    "- 원문에 있는 통화 코드와 금액 표기(예: USD 12,500)는 번역문 안에 그대로 유지합니다.",
    "",
    "답변 지시:",
    looksLikeShortTerm
      ? "- 짧은 알파벳 단어/약어 질문이면 번역 초안 고지나 원문 제공 요청으로 시작하지 말고, 가장 흔한 뜻 후보를 먼저 제시한 뒤 마지막에 문맥을 물어봅니다."
      : hasForeignText
        ? "- 첫 줄에 기존 한국어본 확인 여부를 밝히고, 번역문과 확인 필요 사항을 분리합니다."
        : "- 번역할 원문이 부족해도 먼저 가능한 처리 방향을 짧게 설명한 뒤, 마지막에 원문 제공을 요청합니다.",
  ].join("\n");
}

function buildTechnicalTranslatorMcpContext(userText) {
  const query = String(userText || "");
  const translatorContext = buildTranslatorMcpContext(query);
  const empContext = buildEmpLocalContext(query);
  const looksLikeShortTerm = looksLikeShortTranslatorTerm(query);

  return [
    "MCP 도구 결과: technical_translation_context",
    "",
    "기술외국어번역 처리 규칙:",
    "- 일반 번역이 아니라 기술표준, EMP, EMC, 전기전자, 시험절차 문서 번역에 집중합니다.",
    "- 단독 영문 용어 질문도 일반 사전 뜻 하나로 닫지 말고 기술표준 문맥 우선 후보와 일반 문맥 후보를 분리합니다.",
    "- IEEE, MIL-STD, IEC, ITU-T, CISA, EMP, HEMP, IEMI, HPEM, shielding, SE, DR, POE, transmitting equipment, receiving equipment 같은 단서가 있으면 기술표준 문맥을 우선합니다.",
    "- 원문 문장이 있으면 번역문, 용어 판단, 확인 필요 사항 순서로 답합니다.",
    "- 원문 문장이 없고 단어만 있으면 기술표준 문맥 우선 번역 후보, 일반 문맥 후보, 확인하면 좋은 문맥 순서로 답합니다.",
    "- 전문용어는 한 가지로 단정하지 말고 현장 번역 후보를 2~4개까지 제시하되, 가장 자연스러운 후보를 먼저 둡니다.",
    "- 번역할 때 숫자, 단위, 표준명, 조항번호, 장비명, 약어는 원문 그대로 보존합니다.",
    "",
    "기술표준 번역 시드 용어 예시:",
    "- excitation: 전기전자/시험 문맥에서는 여기, 인가, 시험 신호 인가 후보를 우선합니다. 일반 문맥에서는 흥분, 각성, 자극도 가능합니다.",
    "- coupling: 결합, 커플링, 유도 결합 후보를 우선하고, 문맥에 따라 연계나 연결은 후순위로 둡니다.",
    "- illumination: EMP/전자파 시험 문맥에서는 조사, 입사, 전자파 조사 후보를 우선합니다.",
    "- penetration: 차폐/EMP 문맥에서는 관통부, 관통, 인입부 후보를 우선합니다.",
    "- reference level: 기준 레벨 또는 기준값 후보를 우선합니다.",
    "- dynamic range 또는 DR: 동적 범위 후보를 우선합니다.",
    "- shielding effectiveness 또는 SE: 차폐효과 또는 차폐성능 후보를 우선합니다.",
    "",
    looksLikeShortTerm
      ? "짧은 용어 질문 지시: 번역 초안 고지로 시작하지 말고, 기술표준 문맥 우선 후보부터 바로 답합니다."
      : "문장/문단 번역 지시: 기존 한국어본을 확인하지 못했음을 짧게 밝힌 뒤 번역문과 용어 판단을 분리합니다.",
    "",
    "기본 번역 컨텍스트:",
    translatorContext,
    "",
    "EMP/기술표준 로컬 근거:",
    empContext,
  ].join("\n");
}

function buildDocumentConverterMcpContext(userText) {
  const query = String(userText || "");
  const wantsPdf = /\.pdf\b|pdf|스캔|scan/i.test(query);
  const wantsTable = /표|별표|table|수치|금액|기준값|시험조건|등급/i.test(query);
  const wantsRag = /mcp|rag|검색|인덱스|청크|chunk|벡터|근거/i.test(query);
  const wantsTranslation = /번역|원문|대역|translation|영문|국문/i.test(query);

  return [
    "MCP 도구 결과: document_to_json_context",
    "",
    "문서 JSON 변환 처리 규칙:",
    "- 문서를 LLM으로 읽어 요약하는 방식이 아니라, 검증 가능한 변환 프로그램으로 JSON 산출물을 만들도록 설계합니다.",
    "- 기본 산출물은 Markdown이 아니라 JSON입니다. Markdown은 사용자가 명시할 때만 보조 산출물로 둡니다.",
    "- 원문 보존, 페이지 출처, 블록 ID, 표 구조, 그림/캡션, 변환 품질 정보를 분리합니다.",
    "- 변환 결과를 바로 성공으로 말하지 말고, 어떤 항목이 추출됐고 어떤 항목은 검수 필요인지 함께 보고합니다.",
    "- 사용자가 파일 경로만 주면 먼저 문서 유형, 스캔 여부, 표 비중, 목표 에이전트, 산출 스키마를 확인합니다.",
    "- PDF 텍스트 추출에는 현재 프로젝트의 pdfplumber 기반 도구와 레이아웃 추출 도구를 우선 고려합니다.",
    "- 스캔 PDF나 이미지 문서는 OCR 단계가 필요하다고 분리합니다. OCR 없이 텍스트 추출이 된다고 단정하지 않습니다.",
    "",
    "기본 JSON 산출물 스키마:",
    "- document: documentId, title, sourcePath, sourceHash, pageCount, language, createdAt, converterVersion",
    "- pages: pageNo, width, height, rotation, text, hasImage, ocrUsed, qualityFlags",
    "- blocks: blockId, pageNo, type, level, text, bbox, parentId, confidence",
    "- tables: tableId, pageNo, title, columns, rows, mergedCells, bbox, confidence",
    "- figures: figureId, pageNo, caption, imagePath, bbox, confidence",
    "- chunks: chunkId, titlePath, text, sourcePages, sourceBlockIds, keywords",
    "- quality: emptyPages, lowConfidencePages, brokenTextSamples, tableWarnings, requiredReview",
    "",
    "변환 모드:",
    "- quick_json: 텍스트와 페이지 출처를 빠르게 JSON으로 만듭니다.",
    "- layout_json: 페이지, 블록, 좌표, 표, 그림을 보존합니다.",
    "- table_json: 별표, 시험조건표, 금액표, 기준값표를 행ㆍ열 중심으로 정규화합니다.",
    "- rag_json: MCP/RAG 검색용 chunks와 sourceBlockIds를 생성합니다.",
    "- bilingual_json: 원문ㆍ번역문 병렬 처리를 위해 segmentId와 sourceText를 보존합니다.",
    "",
    "현재 질문에 대한 모드 힌트:",
    wantsPdf ? "- PDF 또는 스캔 문서 단서가 있으므로 텍스트 PDF인지 스캔 PDF인지 먼저 구분합니다." : "- 문서 형식 단서가 부족하면 PDF/HWP/DOCX/이미지 중 무엇인지 먼저 확인합니다.",
    wantsTable ? "- 표/별표/수치 단서가 있으므로 table_json 또는 layout_json을 우선 검토합니다." : "- 표가 핵심인지 본문 검색이 핵심인지 확인합니다.",
    wantsRag ? "- MCP/RAG 단서가 있으므로 chunks와 sourceBlockIds가 포함된 rag_json을 우선 검토합니다." : "- 다른 에이전트가 먹을 데이터라면 rag_json 여부를 확인합니다.",
    wantsTranslation ? "- 번역 단서가 있으므로 bilingual_json 구조를 함께 고려합니다." : "- 번역용이 아니라면 원문 보존 JSON을 기본으로 둡니다.",
    "",
    "답변 지시:",
    "- 사용자가 설계를 묻는 경우 '권장 변환 모드', 'JSON 스키마', '처리 순서', '검수 기준', '다음 확인 사항' 순서로 답합니다.",
    "- 사용자가 실제 변환을 요청했지만 파일 경로가 없으면 파일 경로와 목표 모드를 먼저 요청합니다.",
    "- 사용자가 JSON 예시를 요구하면 코드블록 없이 순수 JSON 예시만 짧게 제공합니다.",
  ].join("\n");
}

function looksLikeShortTranslatorTerm(value) {
  const text = String(value || "").trim();
  if (/^[\s"'`()[\]{}.,:;!?/\\-]*[a-zA-Z]{1,8}[\s"'`()[\]{}.,:;!?/\\-]*$/.test(text)) return true;
  const foreignTerms = text.match(/\b[A-Za-z][A-Za-z0-9.-]{1,40}\b/g) || [];
  if (foreignTerms.length > 0 && foreignTerms.length <= 2 && /(뜻|뭐야|무슨\s*말|의미|설명|번역|뭐라고)/.test(text)) return true;
  const acronym = text.match(/\b[A-Z]{2,8}\b/);
  if (!acronym) return false;
  return /(뜻|의미|약어|뭐야|무슨\s*말|풀어|설명)/.test(text) && (text.match(/\b[A-Za-z]+\b/g) || []).length <= 2;
}

function buildLanguageMcpContext() {
  return [
    "MCP 도구 결과: language_context",
    "",
    "국어사전 역할:",
    "- 단어 뜻, 맞춤법, 띄어쓰기, 유의어, 반의어, 표현 차이, 공문에 적합한 표현을 설명합니다.",
    "- 뜻이 여러 갈래면 문맥별로 구분하고, 공공기관 문서에서 자연스러운 용례를 함께 제시합니다.",
    "- 공식 사전 원문을 직접 조회한 것이 아니면 자체 설명임을 전제하고, 확정이 필요한 표기는 국립국어원 등 공식 사전 확인 필요로 표시합니다.",
    "",
    "공무원식 문장 정리 규칙:",
    "- 원문의 사실관계, 수치, 날짜, 기관명, 사람 이름은 임의로 바꾸지 않습니다.",
    "- 구어체, 감정 표현, 사적 표현, 비속한 표현은 제거합니다.",
    "- 확정 근거가 없으면 '~로 판단됨'보다 '~로 보임', '~가능성이 있음', '확인 필요'를 사용합니다.",
    "- 문장은 '~함', '~하였음', '~할 필요가 있음', '~가 요구됨' 등 보고 문체로 정리합니다.",
    "- 전체 보고서 양식을 만들기보다 문장과 문단의 행정문 개선에 집중합니다.",
    "",
    "답변 지시:",
    "- 짧은 단어, 약어, 기호 질문이면 확인 질문으로 시작하지 말고 가장 흔한 뜻 후보를 먼저 제시합니다.",
    "- 단어 질문이면 뜻풀이, 쓰임, 예문, 공문 사용 권장 표현 순서로 답합니다.",
    "- 문장 교정이면 다듬은 문안, 수정 기준, 확인 필요 사항 순서로 답합니다.",
    "- 사용자가 한 문장만 주면 설명을 줄이고 다듬은 문안부터 제시합니다.",
  ].join("\n");
}

function buildReportMcpContext() {
  return [
    "MCP 도구 결과: report_context",
    "",
    "개조식 보고서 작성 규칙:",
    "- 원문에 없는 사실, 일정, 수치, 기관명, 담당자는 임의로 만들지 않습니다.",
    "- 내용이 부족한 부분은 확인 필요로 표시합니다.",
    "- 대제목, 중제목, 소제목, 주석, 향후 일정 구조를 우선합니다.",
    "",
    "기본 출력 형식:",
    "(대 타이틀)",
    "",
    "ㅁ 중제목",
    "ㅇ 소제목 : 보고 문안. 한글 문서 기준 2줄 정도의 짧은 줄글로 작성합니다.",
    "ㅇ 소제목 : 보고 문안. 한글 문서 기준 2줄 정도의 짧은 줄글로 작성합니다.",
    "* 수검자가 헷갈릴 수 있는 용어 설명 또는 보충 설명",
    "※ 향후 일정, 참고 사항, 부가 설명",
    "",
    "ㅁ 향후 일정",
    "ㅇ 일정명 : 시기",
    "",
    "답변 지시:",
    "- 별표와 ※는 주석과 부가 설명에만 사용합니다.",
    "- 마크다운 표, 코드블록, 굵게 표시는 사용하지 않습니다.",
  ].join("\n");
}

function buildNoriMcpContext() {
  return [
    "MCP 도구 결과: nori_context",
    "",
    "수다지원 처리 규칙:",
    "- 친한 동기처럼 자연스러운 반말을 사용합니다.",
    "- 사용자를 놀리거나 깎아내리지 않고, 과한 친밀감이나 사적인 관계 연기는 하지 않습니다.",
    "- 일하기 싫다, 머리가 복잡하다, 뭐부터 해야 할지 모르겠다는 말에는 짧게 공감한 뒤 바로 할 수 있는 작은 행동을 제안합니다.",
    "- 잡지식은 쉽게 설명하되 확실하지 않으면 확실하지 않다고 말합니다.",
    "",
    "담당 연결 규칙:",
    "- 법률, 법령, 판례, 행정심판, 행정규칙은 김법률에게 넘깁니다.",
    "- EMP, HEMP, IEMI, 차폐, 접지, SPD, IEEE 299 등 표준 검토는 전문 검토가 필요하다고 안내합니다.",
    "- 외국어 번역은 김국어에게 넘깁니다.",
    "- 공문체 문장 다듬기는 김언심에게 넘깁니다.",
    "- 개조식 보고서 작성은 별도 보고서 작성 절차가 필요하다고 안내합니다.",
  ].join("\n");
}

async function searchLegalEvidence(userText) {
  const terms = extractSearchTerms(userText);
  if (!terms.length) {
    return { terms: [], items: buildCuratedLegalEvidence(userText, []), syncSummary: readSyncSummary() };
  }

  const groups = await Promise.all(
    LEGAL_SOURCES.map(async (source) => {
      try {
        return await searchJsonlSource(source, terms);
      } catch (_error) {
        return [];
      }
    })
  );

  const searchedItems = enrichLegalEvidenceItems(
    groups
      .flat()
      .sort((a, b) => b.score - a.score)
      .slice(0, 14)
      .map(({ score: _score, ...item }) => item),
    terms
  ).slice(0, 16);
  const vectorQuery = [userText, terms.join(" ")].filter(Boolean).join("\n");
  const vectorItems = await searchLegalVectorEvidence(vectorQuery, { limit: 8 });
  const hybridItems = interleaveLegalEvidence(searchedItems, vectorItems);
  const items = mergeLegalEvidence(buildCuratedLegalEvidence(userText, terms), hybridItems).slice(0, 16);

  return {
    terms,
    items,
    syncSummary: readSyncSummary(),
  };
}

function buildCuratedLegalEvidence(userText, terms) {
  const haystack = `${userText || ""}\n${(terms || []).join(" ")}`;
  if (looksLikeEmpSafetyAssessmentIssue(haystack)) {
    return CURATED_EMP_SAFETY_EVIDENCE;
  }
  if (looksLikeOverseasTravelAllowanceIssue(haystack)) {
    const travelEvidence = buildCuratedOverseasTravelEvidence(userText);
    if (travelEvidence.length) return travelEvidence;
  }
  if (looksLikeLaborWorkerStatusIssue(haystack)) {
    return CURATED_LABOR_WORKER_STATUS_EVIDENCE.map((item) => ({
      sourceId: "curated-labor-worker-status",
      sourceLabel: "법령",
      title: item.title,
      meta: item.meta,
      text: item.text,
      articleTitle: item.text.match(/^제\d+조\(([^)]+)\)/)?.[1] || "",
      sourceFile: "",
      lawKey: "curated-labor-worker-status",
    }));
  }
  if (looksLikeLeaseDepositIssue(haystack)) {
    return CURATED_LEASE_DEPOSIT_EVIDENCE.map((item) => ({
      sourceId: "curated-lease-deposit",
      sourceLabel: "법령",
      title: item.title,
      meta: item.meta,
      text: item.text,
      articleTitle: item.text.match(/^제\d+조(?:제\d+항)?\(([^)]+)\)/)?.[1] || "",
      sourceFile: "",
      lawKey: "curated-lease-deposit",
    }));
  }
  if (looksLikePrivacyBreachIssue(haystack)) {
    return CURATED_PRIVACY_BREACH_EVIDENCE.map((item) => ({
      sourceId: "curated-privacy-breach",
      sourceLabel: "법령",
      title: item.title,
      meta: item.meta,
      text: item.text,
      articleTitle: item.text.match(/^제\d+조(?:의\d+)?\(([^)]+)\)/)?.[1] || "",
      sourceFile: "",
      lawKey: "curated-privacy-breach",
    }));
  }
  if (!looksLikeCivilContractIssue(haystack)) return [];

  const selected = CURATED_CIVIL_CONTRACT_EVIDENCE.filter((item) =>
    item.keywords.some((keyword) => haystack.includes(keyword))
  );
  const fallback = selected.length ? selected : CURATED_CIVIL_CONTRACT_EVIDENCE.slice(0, 6);

  return fallback.map((item) => ({
    sourceId: "curated-civil-contract",
    sourceLabel: "법령",
    title: "민법",
    meta: item.meta,
    text: item.text,
    articleTitle: item.text.match(/^제\d+조\(([^)]+)\)/)?.[1] || "",
    sourceFile: "",
    lawKey: "curated-civil-contract",
  }));
}

function looksLikeEmpSafetyAssessmentIssue(value) {
  const text = String(value || "");
  const lower = text.toLowerCase();
  const hasEmpTerm =
    /\b(?:emp|hemp|hpem|hpm|iemi)\b/i.test(text) ||
    /고출력\s*전자파|고출력[ㆍ·\s-]*누설\s*전자파|누설\s*전자파|방호차폐시설|장비보호시설|전자파.{0,12}차폐|차폐시설/.test(text);
  const hasSafetyAssessmentTerm =
    /안전성\s*평가|안전성평가|평가기준|평가\s*기준|근거|무슨\s*법|어떤\s*법|관련\s*법|정보유출|피해/.test(text);

  return (
    (hasEmpTerm && hasSafetyAssessmentTerm) ||
    /전파법\s*제?\s*56\s*조/.test(text) ||
    /고출력[ㆍ·\s-]*누설\s*전자파\s*안전성\s*평가/.test(text)
  );
}

function looksLikeCivilContractIssue(value) {
  const text = String(value || "");
  if (looksLikeLaborWorkerStatusIssue(text)) return false;
  if (looksLikeLeaseDepositIssue(text)) return false;
  if (looksLikePrivacyBreachIssue(text)) return false;
  return /계약|도급|용역|제작|홈페이지|납기|납품|착수금|계약금|잔금|환불|반환|해제|해지|채무불이행|손해배상|원상회복|기성고|수급인|도급인/.test(text);
}

function looksLikePrivacyBreachIssue(value) {
  const text = String(value || "");
  return (
    /(개인정보|수강생|고객정보|회원정보|연락처|생년월일|보호자|DB|데이터베이스|관리자\s*계정)/i.test(text) &&
    /(유출|누설|노트북|악성코드|외부\s*IP|전송|암호화|와이파이|보안\s*사고|통보|신고|처리위탁|위탁|수탁|안전조치)/i.test(text)
  );
}

function looksLikeLeaseDepositIssue(value) {
  const text = String(value || "");
  return (
    /(임대차|임차|임대인|임차인|월세|차임|보증금|오피스텔|주택|집주인)/.test(text) &&
    /(퇴거|원상복구|원상회복|공제|벽지|욕실|문틀|청소비|도어락|하자|열쇠|반납|반환)/.test(text)
  );
}

function looksLikeLaborWorkerStatusIssue(value) {
  const text = String(value || "");
  return (
    /(프리랜서|용역계약|근로자성|근로자|4대\s*보험|3\.3%|사업소득|원천징수|퇴직금|연차수당|미지급\s*임금|고정\s*급|고정급)/.test(text) &&
    /(출근|퇴근|근무|사무실|팀장|지시|보고|마감|회사.*컴퓨터|계정|전속|다른 업체|월요일|금요일|오전|오후|매월|고정)/.test(text)
  );
}

function looksLikeOverseasTravelAllowanceIssue(value) {
  const text = String(value || "");
  return (
    /(국외|해외|공무국외|출장|여행|체코|숙박)/.test(text) &&
    /(여비|숙박비|일비|식비|운임|항공운임|지급|얼마|상한|정산)/.test(text)
  );
}

function buildCuratedOverseasTravelEvidence(query) {
  const resolved = resolveOverseasTravelAllowance(query);
  if (!resolved) return [];

  const items = [
    {
      sourceId: "curated-overseas-travel",
      sourceLabel: "법령",
      title: "공무원 여비 규정",
      meta: "제3조",
      text: "제3조(여비의 지급 구분): 국가공무원의 여비는 별표 1의 여비 지급 구분표에 따라 지급합니다.",
      articleTitle: "여비의 지급 구분",
      sourceFile: "laws/009402.json",
      lawKey: "009402",
    },
    {
      sourceId: "curated-overseas-travel",
      sourceLabel: "법령",
      title: "공무원 여비 규정",
      meta: "제16조",
      text: "제16조(일비ㆍ숙박비ㆍ식비의 지급): 국외 여행자의 일비ㆍ숙박비 및 식비는 별표 4에 따라 지급하고, 숙박비는 숙박하는 밤의 수에 따라 지급합니다.",
      articleTitle: "일비ㆍ숙박비ㆍ식비의 지급",
      sourceFile: "laws/009402.json",
      lawKey: "009402",
    },
    {
      sourceId: "curated-overseas-travel",
      sourceLabel: "법령 별표",
      title: "공무원 여비 규정",
      meta: "별표 1 · 여비 지급 구분표",
      text: resolved.classText,
      articleTitle: "",
      sourceFile: "laws/009402.json",
      lawKey: "009402",
    },
    {
      sourceId: "curated-overseas-travel",
      sourceLabel: "법령 별표",
      title: "공무원 여비 규정",
      meta: "별표 4 · 국외 여비 지급표",
      text: formatOverseasTravelRateText(resolved),
      articleTitle: "",
      sourceFile: "laws/009402.json",
      lawKey: "009402",
    },
  ];

  return items;
}

function resolveOverseasTravelAllowance(query) {
  const law = loadPublicOfficialTravelLaw();
  if (!law) return null;

  const appendix4 = findLawAppendix(law, "0004", "00");
  if (!appendix4) return null;

  const lines = flattenStrings(appendix4["별표내용"]);
  const countryGrade = findOverseasTravelGrade(query, lines);
  if (!countryGrade) return null;
  const travelerClass = inferOverseasTravelerClass(query);
  const rate = findOverseasTravelRate(lines, travelerClass.groupNo, countryGrade.gradeKey);
  if (!rate) return null;

  return {
    country: countryGrade.country || "해당 국가",
    gradeName: countryGrade.gradeName || `${rate.grade}등급`,
    travelerClass,
    rate,
    classText: travelerClass.classText,
  };
}

function loadPublicOfficialTravelLaw() {
  if (publicOfficialTravelLawCache !== null) return publicOfficialTravelLawCache;

  const filePath = path.join(DATA_DIR, "law", "laws", "009402.json");
  try {
    publicOfficialTravelLawCache = JSON.parse(fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, ""));
  } catch (_error) {
    publicOfficialTravelLawCache = null;
  }
  return publicOfficialTravelLawCache;
}

function findLawAppendix(law, appendixNo, branchNo = "00") {
  const appendices = law?.["법령"]?.["별표"]?.["별표단위"];
  if (!Array.isArray(appendices)) return null;
  return appendices.find((item) => item?.["별표번호"] === appendixNo && String(item?.["별표가지번호"] || "00") === branchNo) || null;
}

function findOverseasTravelGrade(query, lines) {
  const raw = String(query || "");
  let currentGrade = "";
  let currentGradeName = "";

  for (const line of lines.map(cleanTableLine)) {
    const gradeMatch = line.match(/([가-라])\.\s*\1등급/);
    if (gradeMatch) {
      currentGrade = gradeMatch[1];
      currentGradeName = `${gradeMatch[1]}등급`;
    }

    const listedNames = line
      .replace(/^[^:：]*[:：]\s*/, "")
      .split(/,|ㆍ/)
      .map((item) => item.replace(/\s+/g, "").trim())
      .filter((item) => item.length >= 2);
    const country = listedNames.find((name) => raw.includes(name));
    if (country && currentGrade) {
      return { country, gradeKey: currentGrade, gradeName: currentGradeName };
    }
  }

  if (/체코/.test(raw)) return { country: "체코", gradeKey: "다", gradeName: "다등급" };
  return null;
}

function inferOverseasTravelerClass(query) {
  const raw = String(query || "");

  if (/제\s*1\s*호\s*가|대통령|국무총리/.test(raw)) {
    return {
      groupNo: "1",
      label: "별표 1 제1호가목",
      classText: "별표 1 제1호가목은 대통령, 국무총리 등 최고위직 공무원 구분입니다. 대통령과 국무총리는 별표 4 비고에 따라 일비ㆍ숙박비ㆍ식비를 실비로 봅니다.",
    };
  }

  if (/제\s*1\s*호\s*나|차관|인사혁신처장|법제처장|식품의약품안전처장|과학기술혁신본부장/.test(raw)) {
    return {
      groupNo: "2",
      label: "별표 1 제1호나목",
      classText: "별표 1 제1호나목은 차관 상당 보수를 받는 공무원 등 고위직 구분입니다.",
    };
  }

  if (/제\s*1\s*호\s*다|1급|고위.*가등급|준장|소장/.test(raw)) {
    return {
      groupNo: "3",
      label: "별표 1 제1호다목",
      classText: "별표 1 제1호다목은 1급 상당, 고위공무원단 가등급, 소장ㆍ준장 등 고위직 구분입니다.",
    };
  }

  if (/제\s*1\s*호\s*라|2급|3급|국장급|교육연구관|교장|교수|부교수|대령|중령/.test(raw)) {
    return {
      groupNo: "4",
      label: "별표 1 제1호라목",
      classText: "별표 1 제1호라목은 2급ㆍ3급 국장급, 교육연구관, 교수ㆍ부교수, 대령ㆍ중령 등 고위직 구분입니다.",
    };
  }

  return {
    groupNo: "5",
    label: "별표 1 제2호",
    classText:
      "별표 1 제2호는 제1호에 해당하지 않는 공무원입니다. 연구사는 별표 1 제1호의 고위직ㆍ교육연구관 등으로 별도 처리되는 사정이 없으면 제2호 기준으로 검토합니다.",
  };
}

function findOverseasTravelRate(lines, groupNo, gradeKey) {
  let currentGroup = "";

  for (const line of lines.map(cleanTableLine)) {
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    const groupMatch = cells[0]?.match(/^(\d+)\./);
    if (groupMatch) currentGroup = groupMatch[1];

    const grade = cells.find((cell) => /^[가-라]$/.test(cell));
    if (!currentGroup || !grade || grade !== gradeKey) continue;

    const gradeIndex = cells.indexOf(grade);
    const day = cells[gradeIndex + 1]?.match(/\d+/)?.[0] || "";
    const lodging = cells[gradeIndex + 2]?.match(/상한액:\s*([0-9,]+)/)?.[1] || "";
    const meals = cells[gradeIndex + 3]?.match(/[0-9,]+/)?.[0] || "";
    if (currentGroup !== groupNo || !day || !lodging || !meals) continue;

    return {
      groupNo: currentGroup,
      grade,
      day,
      lodging,
      meals,
      row: cleanTableLine(line),
    };
  }

  return null;
}

function formatOverseasTravelRateText(resolved) {
  const { country, gradeName, travelerClass, rate } = resolved;
  return `${country}는 공무원 여비 규정 별표 4 비고의 국가 및 도시별 등급 구분상 ${gradeName}입니다. ${travelerClass.label} 해당자의 ${gradeName} 국외 여비는 일비 미화 ${rate.day}달러, 숙박비 실비 상한액 미화 ${rate.lodging}달러, 식비 미화 ${rate.meals}달러입니다. 숙박비는 정액 지급이 아니라 실비 상한액 기준이며, 할인정액 적용 여부는 기관 여비 처리 기준을 확인해야 합니다.`;
}

function mergeLegalEvidence(preferredItems, searchedItems) {
  const result = [];
  const seen = new Set();
  [...(preferredItems || []), ...(searchedItems || [])].forEach((item) => {
    const key = `${item.title || ""}:${item.meta || ""}:${item.text || ""}`.slice(0, 260);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function interleaveLegalEvidence(keywordItems, vectorItems) {
  const result = [];
  const max = Math.max(keywordItems?.length || 0, vectorItems?.length || 0);
  for (let index = 0; index < max; index += 1) {
    if (keywordItems?.[index]) result.push(keywordItems[index]);
    if (vectorItems?.[index]) result.push(vectorItems[index]);
  }
  return mergeLegalEvidence([], result);
}

function extractLegalAnswerHints(userText, items) {
  const query = String(userText || "");
  const wantsNumber = /얼마|얼만|금액|비율|몇\s*프로|퍼센트|%|한도|기준|최대|까지|이하|초과/.test(query);
  const wantsDecision = /해야|되나|돼|가능|위법|공개|비공개|신고|면제|생략|취소/.test(query);
  const wantsAllowance = query.includes("직급보조비");
  const wantsArticle = /제\s*\d+(?:의\d+)?\s*조/.test(query);
  const wantsLabor = looksLikeLaborWorkerStatusIssue(query);
  const wantsLease = looksLikeLeaseDepositIssue(query);
  const wantsPrivacy = looksLikePrivacyBreachIssue(query);
  const wantsContract = looksLikeCivilContractIssue(query);
  const wantsTravelAllowance = looksLikeOverseasTravelAllowanceIssue(query);
  const wantsEmpSafety = looksLikeEmpSafetyAssessmentIssue(query);
  if (
    !wantsNumber &&
    !wantsDecision &&
    !wantsAllowance &&
    !wantsArticle &&
    !wantsContract &&
    !wantsLabor &&
    !wantsLease &&
    !wantsPrivacy &&
    !wantsTravelAllowance &&
    !wantsEmpSafety
  ) {
    return [];
  }

  const terms = extractSearchTerms(query).filter((term) => term.length >= 2);
  const hints = extractDirectLegalAnswerHints(query, items, terms);

  for (const item of items.slice(0, 10)) {
    const snippet = pickLegalHintSnippet(item.text, terms, { wantsNumber, wantsDecision });
    if (!snippet) continue;
    hints.push(`[${item.sourceLabel}] ${item.title}${item.meta ? ` / ${item.meta}` : ""}: ${snippet}`);
    if (hints.length >= 5) break;
  }

  return hints;
}

function extractDirectLegalAnswerHints(query, items, terms) {
  const directHints = [];
  directHints.push(...extractDirectEmpSafetyHints(query));
  directHints.push(...extractDirectOverseasTravelHints(query));
  directHints.push(...extractDirectArticleHints(query, items));
  directHints.push(...extractDirectAllowanceHints(query, items, terms));
  directHints.push(...extractDirectExamScoreHints(query, items));
  return directHints;
}

function extractDirectEmpSafetyHints(query) {
  if (!looksLikeEmpSafetyAssessmentIssue(query)) return [];
  return [
    "[법령] 전파법 / 제56조(고출력ㆍ누설 전자파 안전성 평가 등): EMP 안전성 평가는 고출력 전자파 피해 및 누설 전자파 정보유출 방지를 위한 시설 등의 안전성 평가 근거로 보아야 합니다.",
  ];
}

function extractDirectOverseasTravelHints(query) {
  if (!looksLikeOverseasTravelAllowanceIssue(query)) return [];
  const resolved = resolveOverseasTravelAllowance(query);
  if (!resolved) return [];
  return [`[법령 별표] 공무원 여비 규정 / 별표 4 · 국외 여비 지급표: ${formatOverseasTravelRateText(resolved)}`];
}

function extractDirectArticleHints(query, items) {
  const articleNo = extractRequestedArticleNo(query);
  if (!articleNo) return [];

  const alias = findLawAlias(query);
  for (const item of items) {
    if (!isSameArticle(item.meta, articleNo)) continue;
    if (alias && !String(item.title || "").includes(alias.lawName)) continue;
    const articleLabel = formatArticleNo(articleNo);
    const label = item.articleTitle ? `${articleLabel}(${item.articleTitle})` : articleLabel;
    return [
      `[${item.sourceLabel}] ${item.title}${item.meta ? ` / ${item.meta}` : ""}: ${label} ${cleanArticleText(item.text, articleNo, item.articleTitle)}`,
    ];
  }

  return [];
}

function cleanArticleText(text, articleNo, articleTitle) {
  const no = normalizeArticleNo(articleNo);
  const baseNo = no.split("의")[0] || no;
  const articleLabel = formatArticleNo(no);
  let value = String(text || "").replace(/\s+/g, " ").trim();
  value = value.replace(new RegExp(`^${escapeRegExp(baseNo)}\\s+\\d{8}\\s+[A-Z]\\s+(?:000000\\s+)?`), "");
  value = value.replace(/^(?:\[[^\]]+\]\s*)?\d{7}\s+/, "");
  value = value.replace(/([①-⑳])\s*\1\s*/g, "$1 ");
  value = value.replace(/(\d+)\.\s+\1\.\s+/g, "$1. ");

  if (articleTitle) {
    value = value.replace(new RegExp(`\\s*${escapeRegExp(articleLabel)}\\(${escapeRegExp(articleTitle)}\\)\\s*${escapeRegExp(articleTitle)}\\s*조문\\s*$`), "");
  } else {
    value = value.replace(/\s*제\d+조(?:의\d+)?\([^)]*\)\s*[^①②③④⑤⑥⑦⑧⑨⑩]{0,80}\s*조문\s*$/, "");
  }

  return compactText(value, 620);
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractRequestedArticleNo(query) {
  const standard = String(query || "").match(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?/);
  if (standard) return standard[2] ? `${standard[1]}의${standard[2]}` : standard[1];

  const alternate = String(query || "").match(/제\s*(\d+)\s*의\s*(\d+)\s*조/);
  return alternate ? `${alternate[1]}의${alternate[2]}` : "";
}

function isSameArticle(meta, articleNo) {
  return normalizeArticleNo(meta) === normalizeArticleNo(articleNo);
}

function normalizeArticleNo(value) {
  const text = String(value || "");
  const standard = text.match(/(\d+)\s*조(?:\s*의\s*(\d+))?/);
  if (standard) return standard[2] ? `${Number(standard[1])}의${Number(standard[2])}` : String(Number(standard[1]));

  const match = text.match(/(\d+)(?:\s*의\s*(\d+))?/);
  if (!match) return "";
  return match[2] ? `${Number(match[1])}의${Number(match[2])}` : String(Number(match[1]));
}

function findLawAlias(query) {
  const raw = String(query || "");
  return LAW_ALIASES.find((item) => item.aliases.some((alias) => raw.includes(alias)) || raw.includes(item.lawName));
}

function extractDirectAllowanceHints(query, items, terms) {
  const directHints = [];
  if (!String(query || "").includes("직급보조비")) return directHints;
  const targets = extractAllowanceTargets(query, terms);
  if (!targets.length) return directHints;

  for (const item of items) {
    if (!String(item.meta || item.title || "").includes("직급보조비")) continue;
    const match = findAllowanceRowMatch(item.text, targets);
    if (!match) continue;

    directHints.push(
      `[${item.sourceLabel}] ${item.title}${item.meta ? ` / ${item.meta}` : ""}: ${match.label} 직급보조비 월 ${match.amount} (${match.row})`
    );
    break;
  }

  return directHints;
}

function extractDirectExamScoreHints(query, items) {
  const raw = String(query || "");
  if (!raw.includes("배점")) return [];

  const subject = extractExamSubject(raw);
  if (!subject) return [];

  const wantedExam = raw.includes("제1차") || raw.includes("1차") ? "제1차시험" : raw.includes("제2차") || raw.includes("2차") ? "제2차시험" : "";

  for (const item of items) {
    const haystack = `${item.title || ""} ${item.meta || ""} ${item.text || ""}`;
    if (wantedExam && !haystack.includes(wantedExam)) continue;
    if (!/시험.*과목|과목.*배점|배점/.test(haystack)) continue;

    const match = findExamScoreRowMatch(item.text, subject);
    if (!match) continue;

    const examLabel = wantedExam || "시험";
    return [
      `[${item.sourceLabel}] ${item.title}${item.meta ? ` / ${item.meta}` : ""}: ${examLabel} ${subject} 배점 ${match.score} (${match.row})`,
    ];
  }

  return [];
}

function extractExamSubject(query) {
  if (query.includes("경영향")) return "경영학";

  const knownSubjects = [
    "경영학",
    "경제원론",
    "상법",
    "세법개론",
    "회계학",
    "영어",
    "재무관리",
    "원가회계",
    "회계감사",
    "재무회계",
    "세법",
  ];
  return knownSubjects.find((subject) => query.includes(subject)) || "";
}

function findExamScoreRowMatch(text, subject) {
  const rows = String(text || "")
    .split(/\s+\/\s+|\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  for (const row of rows) {
    if (!row.includes(subject)) continue;
    const score = row.match(/(\d[\d,]*점)/)?.[1];
    if (!score) continue;
    return {
      score,
      row: compactText(row, 220),
    };
  }

  return null;
}

function extractAllowanceTargets(query, terms) {
  const raw = String(query || "");
  const targets = [];
  const gradeNo = findRequestedGradeNo(terms);
  if (gradeNo) {
    targets.push({ type: "grade", value: `${gradeNo}급`, label: `${gradeNo}급` });
  }

  [
    "준장",
    "대령",
    "중령",
    "소령",
    "대위",
    "준위",
    "원사",
    "상사",
    "중위",
    "소위",
    "중사",
    "하사",
    "총경",
    "경정",
    "경감",
    "경위",
    "경사",
    "경장",
    "순경",
    "소방정",
    "소방령",
    "소방경",
    "소방위",
    "소방장",
    "소방교",
    "소방사",
    "연구관",
    "연구사",
    "지도관",
    "지도사",
  ].forEach((rank) => {
    if (raw.includes(rank)) targets.push({ type: "text", value: rank, label: rank });
  });

  return targets;
}

function findAllowanceRowMatch(text, targets) {
  const rows = String(text || "")
    .split(/\s+\/\s+|\n/)
    .map((row) => row.trim())
    .filter(Boolean);

  for (const row of rows) {
    const amount = row.match(/(\d[\d,]*원)/)?.[1];
    if (!amount) continue;

    for (const target of targets) {
      const matched = target.type === "grade" ? isGradeAllowanceLine(row, target.value.match(/^([1-9])급/)?.[1] || "") : row.includes(target.value);
      if (!matched) continue;
      return {
        amount,
        label: target.label,
        row: compactText(row, 220),
      };
    }
  }

  return null;
}

function pickLegalHintSnippet(text, terms, options) {
  const source = compactText(text, 1400);
  if (!source) return "";

  const markers = [
    ...terms,
    "원",
    "만원",
    "억원",
    "퍼센트",
    "%",
    "100분의",
    "이하",
    "초과",
    "범위",
    "공개",
    "비공개",
    "신고",
    "승인",
    "허가",
    "면제",
    "사전통지",
    "의견제출",
    "청문",
    "위법",
    "취소",
  ];
  const candidates = [{ text: source.slice(0, 420), opening: true }];

  for (const marker of markers) {
    const index = source.indexOf(marker);
    if (index < 0) continue;
    const start = Math.max(0, index - 140);
    const end = Math.min(source.length, index + 220);
    candidates.push({ text: source.slice(start, end), opening: false });
  }

  if (!candidates.length) return "";

  const scored = candidates
    .map((candidate) => ({
      candidate: cleanLegalHintText(compactText(candidate.text, candidate.opening ? 420 : 360)),
      score: scoreLegalHintSnippet(candidate.text, terms, options) + (candidate.opening ? 10 : 0),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.candidate || "";
}

function cleanLegalHintText(value) {
  return String(value || "")
    .replace(/^\d+\s+\d{8}\s+[A-Z]\s+(?:000000\s+)?\d{7}\s+/, "")
    .replace(/([①②③④⑤⑥⑦⑧⑨⑩])\s*\1\s*/g, "$1 ")
    .replace(/(\d+)\.\s+\1\.\s+/g, "$1. ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreLegalHintSnippet(value, terms, options) {
  const text = String(value || "");
  let score = 0;
  for (const term of terms) {
    if (text.includes(term)) score += Math.min(8, term.length);
  }
  const gradeNo = findRequestedGradeNo(terms);
  if (gradeNo && isGradeAllowanceLine(text, gradeNo)) score += 40;
  if (options.wantsNumber && /(\d[\d,]*(원|만원|억원)|\d+(\.\d+)?\s*(퍼센트|%)|100분의\s*\d+|\d+급|\d+등급)/.test(text)) score += 16;
  if (options.wantsDecision && /(공개|비공개|신고|승인|허가|면제|사전통지|의견제출|청문|위법|취소|가능|생략)/.test(text)) score += 12;
  if (/(별표|제\d+조|계약예규|시행령|시행규칙|법률|규정|지침)/.test(text)) score += 5;
  return score;
}

async function searchJsonlSource(source, terms) {
  if (!fs.existsSync(source.path)) return [];

  const candidates = [];
  const rl = readline.createInterface({
    input: fs.createReadStream(source.path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const lineScore = scoreText(line, terms);
    if (lineScore <= 0) continue;

    let record;
    try {
      record = JSON.parse(line);
    } catch (_error) {
      continue;
    }

    const item = normalizeRecord(source, record, terms, lineScore);
    if (!item) continue;
    insertTopCandidate(candidates, item, source.limit || 3);
  }

  return candidates.slice(0, source.limit || 3);
}

function normalizeRecord(source, record, terms, lineScore) {
  const title =
    record.lawName ||
    record.caseName ||
    record.itemTitle ||
    record.title ||
    record.name ||
    source.label;
  const text = compactText(record.text || record.content || "");
  if (!text || isEmptyResult(text)) return null;

  const titleScore = scoreText(title, terms) * 2;
  const sectionScore = scoreText([record.section, record.articleNo, record.itemNumber, record.caseNo].filter(Boolean).join(" "), terms);
  const score = lineScore + titleScore + sectionScore + sourceWeight(source.id) + legalHintBoost(source.id, record, terms);

  return {
    score,
    sourceId: source.id,
    sourceLabel: record.targetLabel || source.label,
    title: compactText(title, 130),
    meta: buildMeta(record),
    text: compactText(text, 430),
    articleTitle: record.lawName && record.title ? compactText(record.title, 80) : "",
    sourceFile: record.sourceFile || "",
    lawKey: record.lawKey || "",
  };
}

function enrichLegalEvidenceItems(items, terms) {
  const enriched = [];
  const seenAppendices = new Set();

  items.forEach((item) => {
    enriched.push(item);

    const appendixItems = findLawAppendixEvidence(item, terms);
    appendixItems.forEach((appendixItem) => {
      const key = `${appendixItem.title}:${appendixItem.meta}`;
      if (seenAppendices.has(key)) return;
      seenAppendices.add(key);
      enriched.push(appendixItem);
    });
  });

  return enriched;
}

function findLawAppendixEvidence(item, terms) {
  if (item.sourceId !== "law" || !item.sourceFile) return [];

  const hints = buildAppendixHints(item, terms);
  if (!hints.length) return [];

  const lawRoot = path.resolve(DATA_DIR, "law");
  const sourcePath = path.resolve(lawRoot, item.sourceFile);
  if (!sourcePath.startsWith(`${lawRoot}${path.sep}`) || !fs.existsSync(sourcePath)) return [];

  let lawData;
  try {
    lawData = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  } catch (_error) {
    return [];
  }

  return collectAppendices(lawData)
    .filter((appendix) => matchesAppendixHints(appendix, hints))
    .map((appendix) => buildAppendixItem(item, appendix, terms))
    .filter(Boolean)
    .slice(0, 2);
}

function buildAppendixHints(item, terms) {
  const hints = [];
  const haystack = `${item.title || ""} ${item.meta || ""} ${item.text || ""}`;
  const appendixMatches = haystack.matchAll(/별표\s*(\d+(?:의\d+)?)/g);

  for (const match of appendixMatches) {
    hints.push({ type: "appendixNo", value: match[1] });
  }

  if (terms.includes("직급보조비")) hints.push({ type: "keyword", value: "직급보조비" });
  if (terms.includes("국외 여비 지급표") || terms.includes("국외 여비") || terms.includes("별표 4")) {
    hints.push({ type: "appendixNo", value: "4" });
  }
  if (terms.includes("여비 지급 구분표") || terms.includes("별표 1")) {
    hints.push({ type: "appendixNo", value: "1" });
  }

  return hints;
}

function matchesAppendixHints(appendix, hints) {
  const title = decodeHtml(appendix["별표제목"] || "");
  const appendixNo = normalizeAppendixNumber(appendix["별표번호"]);
  const content = flattenStrings(appendix["별표내용"]).slice(0, 80).join(" ");

  return hints.some((hint) => {
    if (hint.type === "appendixNo") return normalizeAppendixNumber(hint.value) === appendixNo;
    return `${title} ${content}`.includes(hint.value);
  });
}

function buildAppendixItem(baseItem, appendix, terms) {
  const title = decodeHtml(appendix["별표제목"] || "");
  const appendixNo = normalizeAppendixNumber(appendix["별표번호"]);
  const lines = selectAppendixLines(flattenStrings(appendix["별표내용"]), terms);
  if (!lines.length) return null;

  return {
    sourceId: baseItem.sourceId,
    sourceLabel: "법령 별표",
    title: baseItem.title,
    meta: [`별표 ${appendixNo}`, title].filter(Boolean).join(" · "),
    text: compactText(lines.join(" / "), 900),
    sourceFile: baseItem.sourceFile,
    lawKey: baseItem.lawKey,
  };
}

function collectAppendices(root) {
  const result = [];
  const stack = [root];

  while (stack.length) {
    const value = stack.pop();
    if (!value || typeof value !== "object") continue;

    if (Object.prototype.hasOwnProperty.call(value, "별표내용")) {
      result.push(value);
    }

    if (Array.isArray(value)) {
      value.forEach((item) => stack.push(item));
      continue;
    }

    Object.values(value).forEach((item) => stack.push(item));
  }

  return result;
}

function selectAppendixLines(lines, terms) {
  const cleaned = lines.map(cleanTableLine).filter(Boolean);
  if (!cleaned.length) return [];

  if (terms.includes("직급보조비")) {
    const gradeNo = findRequestedGradeNo(terms);
    const wanted = cleaned.filter((line) => {
      if (/직급보조비 지급 구분표|월지급액/.test(line)) return true;
      if (gradeNo && isGradeAllowanceLine(line, gradeNo)) return true;
      if (line.includes("|") && /([1-9]급|[1-9]ㆍ[1-9]급).+원/.test(line)) return true;
      if (/(연구관|연구사|지도관|지도사)/.test(line) && /(원|급|상당|감액)/.test(line)) return true;
      if (/위 표에서 규정되지 않은 공무원/.test(line)) return true;
      return false;
    });

    if (terms.includes("연구직공무원") && !wanted.some((line) => /(연구관|연구사|지도관|지도사)/.test(line))) {
      return [];
    }

    return uniqueLines(wanted).slice(0, 12);
  }

  if (terms.includes("국외 여비 지급표") || terms.includes("국외 여비") || terms.includes("별표 4")) {
    const wanted = cleaned.filter((line) => {
      if (/국외 여비 지급표|구분.*등급.*일비.*숙박비.*식비|단위:\s*미 달러화/.test(line)) return true;
      if (/별표 1의 제2호|제2호에 해|당하는 사람/.test(line)) return true;
      if (/실비\(상한액:\s*(176|137|106|81)\)/.test(line)) return true;
      if (/다\.\s*다등급|유럽주:.*체코|체코/.test(line)) return true;
      if (/숙박비는 실비 상한액|할인정액|제8조의2/.test(line)) return true;
      return false;
    });
    return uniqueLines(wanted).slice(0, 16);
  }

  if (terms.includes("여비 지급 구분표") || terms.includes("별표 1")) {
    const wanted = cleaned.filter((line) => /여비 지급 구분표|제1호|제2호|연구사|연구관|제1호에 해당하지 않는 공무원/.test(line));
    return uniqueLines(wanted).slice(0, 14);
  }

  const queryTerms = terms.filter((term) => term.length >= 3);
  const wanted = cleaned.filter((line) => queryTerms.some((term) => line.toLowerCase().includes(term)));
  return uniqueLines(wanted.length ? wanted : cleaned).slice(0, 10);
}

function findRequestedGradeNo(terms) {
  for (const term of terms) {
    const match = String(term || "").match(/^([1-9])급/);
    if (match) return match[1];
  }
  return "";
}

function isGradeAllowanceLine(line, gradeNo) {
  const normalized = String(line || "")
    .replace(/[·･]/g, "ㆍ")
    .replace(/\s+/g, "");
  if (!normalized.includes("원")) return false;
  if (normalized.includes(`${gradeNo}급`)) return true;
  if (gradeNo === "8" || gradeNo === "9") return normalized.includes("8ㆍ9급");
  if (gradeNo === "6" || gradeNo === "7") return normalized.includes("6ㆍ7급") || normalized.includes(`${gradeNo}급`);
  return false;
}

function flattenStrings(value) {
  if (typeof value === "string") return [decodeHtml(value)];
  if (Array.isArray(value)) return value.flatMap((item) => flattenStrings(item));
  if (!value || typeof value !== "object") return [];
  return Object.values(value).flatMap((item) => flattenStrings(item));
}

function cleanTableLine(value) {
  return String(value || "")
    .replace(/[┌┬┐├┼┤└┴┘─━]/g, " ")
    .replace(/[│┃]/g, " | ")
    .replace(/\s+/g, " ")
    .replace(/\s*\|\s*/g, " | ")
    .trim();
}

function uniqueLines(lines) {
  const seen = new Set();
  return lines.filter((line) => {
    if (!line || seen.has(line)) return false;
    seen.add(line);
    return true;
  });
}

function normalizeAppendixNumber(value) {
  const digits = String(value || "").match(/\d+/);
  return digits ? String(Number(digits[0])) : "";
}

function buildMeta(record) {
  const pieces = [];
  const articleNo = getRecordArticleNo(record);
  if (articleNo) pieces.push(formatArticleNo(articleNo));
  if (record.caseNo) pieces.push(record.caseNo);
  if (record.itemNumber) pieces.push(record.itemNumber);
  if (record.courtName) pieces.push(record.courtName);
  if (record.organization) pieces.push(record.organization);
  if (record.decisionDate) pieces.push(formatDate(record.decisionDate));
  if (record.date) pieces.push(formatDate(record.date));
  if (record.section) pieces.push(record.section);
  return pieces.filter(Boolean).join(" · ");
}

function getRecordArticleNo(record) {
  const fallback = normalizeArticleNo(record.articleNo);
  if (!fallback) return "";

  const text = String(record.text || "");
  const encodedArticle = extractEncodedArticleNo(text, fallback);
  if (encodedArticle) return encodedArticle;

  const titleMatches = [...text.matchAll(/제\s*(\d+)\s*조(?:\s*의\s*(\d+))?\s*\(/g)];
  const ownTitle = [...titleMatches].reverse().find((match) => normalizeArticleNo(match[1]) === fallback);
  if (ownTitle) return ownTitle[2] ? `${Number(ownTitle[1])}의${Number(ownTitle[2])}` : String(Number(ownTitle[1]));

  return fallback;
}

function extractEncodedArticleNo(text, fallback) {
  const base = fallback.split("의")[0];
  if (!base) return "";

  const encodedBase = String(Number(base)).padStart(4, "0");
  const match = String(text || "").match(new RegExp(`\\b${encodedBase}(\\d{2})\\d\\b`));
  if (!match) return "";

  const branch = Number(match[1]);
  return branch > 0 ? `${Number(base)}의${branch}` : String(Number(base));
}

function formatArticleNo(value) {
  const normalized = normalizeArticleNo(value);
  if (!normalized) return "";
  const [base, branch] = normalized.split("의");
  return branch ? `제${base}조의${branch}` : `제${base}조`;
}

function scoreText(value, terms) {
  const text = String(value || "").toLowerCase();
  if (!text) return 0;

  let score = 0;
  for (const term of terms) {
    if (!text.includes(term)) continue;
    score += Math.min(14, term.length + 2);
    if (term.length >= 5) score += 4;
  }
  return score;
}

function insertTopCandidate(candidates, item, sourceLimit) {
  candidates.push(item);
  candidates.sort((a, b) => b.score - a.score);
  const max = Math.max(MAX_CANDIDATES_PER_FILE, sourceLimit * 3);
  if (candidates.length > max) candidates.length = max;
}

function extractSearchTerms(userText) {
  const raw = String(userText || "").toLowerCase();
  const normalized = raw
    .replace(/[「」『』()[\]{}"'“”‘’.,;:!?/\\|<>~`*_+=-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = normalized.match(/[\p{Script=Hangul}a-z0-9]+/gu) || [];
  const filtered = tokens
    .map((token) => normalizeToken(token.trim()))
    .filter((token) => token.length >= 2)
    .filter((token) => !STOP_WORDS.has(token));

  const terms = new Set(filtered);

  if (looksLikeEmpSafetyAssessmentIssue(userText)) {
    EMP_SAFETY_SEARCH_TERMS.forEach((term) => terms.add(term.toLowerCase()));
  }

  for (let index = 0; index < filtered.length - 1; index += 1) {
    const combined = `${filtered[index]}${filtered[index + 1]}`;
    if (combined.length >= 4) terms.add(combined);
  }

  if (filtered.length >= 3) {
    const combinedAll = filtered.join("");
    if (combinedAll.length <= 24) terms.add(combinedAll);
  }

  if (raw.includes("직급") && raw.includes("보조비")) terms.add("직급보조비");
  const gradeMatch = raw.match(/([1-9])\s*급/);
  if (raw.includes("직급보조비") && gradeMatch) {
    const grade = gradeMatch[1];
    terms.add(`${grade}급`);
    terms.add("공무원수당");
    terms.add("별표 15");
    if (grade === "8" || grade === "9") terms.add("8ㆍ9급");
    if (grade === "6" || grade === "7") terms.add("6ㆍ7급");
  }
  if (raw.includes("연구직") && raw.includes("공무원")) terms.add("연구직공무원");
  if (raw.includes("연구직") || raw.includes("연구사") || raw.includes("연구관")) {
    ["연구관", "연구사", "지도관", "지도사"].forEach((term) => terms.add(term));
  }
  if (looksLikeOverseasTravelAllowanceIssue(raw)) {
    [
      "공무원 여비 규정",
      "공무원 여비",
      "국외 여비",
      "국외 여비 지급표",
      "여비 지급 구분표",
      "별표 1",
      "별표 4",
      "제3조",
      "제16조",
      "일비",
      "숙박비",
      "식비",
      "실비 상한액",
    ].forEach((term) => terms.add(term));
    if (raw.includes("체코")) terms.add("체코");
    if (raw.includes("연구사")) terms.add("연구사");
  }
  if (raw.includes("정보") && raw.includes("공개")) terms.add("정보공개");
  if (raw.includes("입찰") && raw.includes("참가")) terms.add("입찰참가");
  if (raw.includes("연차") || raw.includes("유급휴가")) {
    ["근로기준법", "연차 유급휴가", "연차휴가", "제60조"].forEach((term) => terms.add(term));
  }
  if (raw.includes("출산전후") || raw.includes("출산휴가") || raw.includes("임산부") || raw.includes("임신")) {
    ["근로기준법", "출산전후휴가", "임산부의 보호", "제74조"].forEach((term) => terms.add(term));
  }
  if (raw.includes("퇴직금") || raw.includes("퇴직급여") || raw.includes("중간정산")) {
    ["근로자퇴직급여 보장법", "퇴직급여", "퇴직금", "중간정산", "퇴직금제도의 설정", "제8조"].forEach((term) => terms.add(term));
  }
  if (looksLikeLaborWorkerStatusIssue(raw)) {
    [
      "근로기준법",
      "근로자",
      "근로자성",
      "근로자 정의",
      "사용종속관계",
      "임금을 목적",
      "미지급 임금",
      "금품 청산",
      "제2조",
      "제36조",
      "제23조",
      "제26조",
      "제60조",
      "근로자퇴직급여 보장법",
      "퇴직급여제도",
      "퇴직금제도의 설정",
      "제4조",
      "제8조",
      "연차 유급휴가",
      "연차수당",
      "해고",
      "해고예고",
      "정당한 이유",
    ].forEach((term) => terms.add(term));
  }
  if (looksLikeLeaseDepositIssue(raw)) {
    [
      "민법",
      "임대차",
      "임차인",
      "임대인",
      "보증금",
      "보증금 반환",
      "원상회복",
      "원상복구",
      "차임연체",
      "월세 연체",
      "제615조",
      "제640조",
      "제654조",
      "주택임대차보호법",
      "제4조",
    ].forEach((term) => terms.add(term));
  }
  if (looksLikePrivacyBreachIssue(raw)) {
    [
      "개인정보 보호법",
      "개인정보",
      "개인정보처리자",
      "정보주체",
      "업무위탁",
      "처리위탁",
      "수탁자",
      "위탁자",
      "안전조치의무",
      "안전조치",
      "개인정보 유출",
      "유출 통지",
      "유출 신고",
      "보호위원회",
      "전문기관",
      "손해배상책임",
      "법정손해배상",
      "제2조",
      "제26조",
      "제29조",
      "제34조",
      "제39조",
      "제39조의2",
    ].forEach((term) => terms.add(term));
  }
  if (looksLikeCivilContractIssue(raw)) {
    [
      "민법",
      "도급",
      "계약 해제",
      "이행지체",
      "원상회복",
      "채무불이행",
      "손해배상",
      "보수 지급시기",
      "착수금 반환",
      "잔금",
      "제390조",
      "제543조",
      "제544조",
      "제548조",
      "제551조",
      "제664조",
      "제665조",
      "제673조",
    ].forEach((term) => terms.add(term));
  }
  if (raw.includes("선금")) {
    ["선금", "선금지급", "계약예규", "정부입찰계약집행기준"].forEach((term) => terms.add(term));
  }
  if (raw.includes("수의계약")) {
    ["수의계약", "견적서", "추정가격", "국가계약법", "지방계약법"].forEach((term) => terms.add(term));
  }
  if (raw.includes("r&d") || raw.includes("연구개발")) {
    ["연구개발", "연구개발용역", "협약", "국가연구개발혁신법"].forEach((term) => terms.add(term));
  }
  if (raw.includes("1인") || raw.includes("견적")) {
    ["1인견적", "1인 견적", "견적서제출", "수의계약"].forEach((term) => terms.add(term));
  }
  if (raw.includes("여성기업")) {
    ["여성기업", "여성기업지원", "추정가격", "수의계약"].forEach((term) => terms.add(term));
  }
  if (raw.includes("계약보증금")) {
    ["계약보증금", "보증금면제", "계약보증금면제", "면제"].forEach((term) => terms.add(term));
  }
  if (raw.includes("외부") && raw.includes("강의")) {
    ["외부강의", "외부강의등", "청탁금지법", "공무원행동강령", "겸직"].forEach((term) => terms.add(term));
  }
  if (raw.includes("사전통지") || raw.includes("행정처분")) {
    ["사전통지", "의견제출", "청문", "행정절차법", "처분"].forEach((term) => terms.add(term));
  }
  if (raw.includes("내부") && raw.includes("메모")) {
    ["의사결정", "내부검토", "정보공개", "비공개대상정보"].forEach((term) => terms.add(term));
  }
  if (raw.includes("경영향")) terms.add("경영학");
  if (raw.includes("공인회계사") && raw.includes("배점")) {
    ["공인회계사법 시행령", "공인회계사", "과목별 배점", "별표 1", "제1차시험"].forEach((term) => terms.add(term));
  }
  for (const alias of LAW_ALIASES) {
    if (!alias.aliases.some((name) => raw.includes(name)) && !raw.includes(alias.lawName)) continue;
    alias.terms.forEach((term) => terms.add(term));
    terms.add(alias.lawName);
    const articleNo = extractRequestedArticleNo(raw);
    if (articleNo) {
      terms.add(`${alias.lawName}${articleNo}조`);
      terms.add(`제${articleNo}조`);
    }
  }

  return [...terms].sort((a, b) => b.length - a.length).slice(0, 22);
}

function sourceWeight(sourceId) {
  if (sourceId === "law") return 18;
  if (sourceId === "admrul") return 8;
  if (sourceId === "precedent-body") return 3;
  return 3;
}

function legalHintBoost(sourceId, record, terms) {
  let boost = 0;
  const title = String(record.title || "").toLowerCase();
  const lawName = String(record.lawName || "").toLowerCase();
  const text = String(record.text || "").toLowerCase();

  if (terms.includes("전파법 제56조") || terms.includes("고출력ㆍ누설 전자파 안전성 평가")) {
    const articleNo = normalizeArticleNo(getRecordArticleNo(record));
    const isRadioAct = lawName === "전파법";
    const isRadioActDecree = lawName === "전파법 시행령";
    if (sourceId === "law" && isRadioAct) boost += 170;
    if (isRadioAct && articleNo === "56") boost += 180;
    if (isRadioActDecree && text.includes("고출력ㆍ누설 전자파 안전성 평가") && text.includes("법 제56조")) boost += 90;
    if (title.includes("고출력") && title.includes("누설") && title.includes("안전성")) boost += 120;
    if (text.includes("방호차폐시설") || text.includes("장비보호시설")) boost += 55;
    if (text.includes("과학기술정보통신부장관") && text.includes("안전성 평가")) boost += 40;
  }

  if (sourceId === "law" && terms.includes("직급보조비")) {
    if (title.includes("직급보조비")) boost += 32;
    if (lawName.includes("공무원수당")) boost += 28;
    if (text.includes("별표 15")) boost += 12;
  }

  if (terms.includes("공무원 여비 규정") || terms.includes("국외 여비 지급표") || terms.includes("국외 여비")) {
    const articleNo = normalizeArticleNo(getRecordArticleNo(record));
    if (lawName.includes("공무원 여비 규정")) boost += 95;
    if (title.includes("일비") || title.includes("숙박비") || title.includes("식비") || title.includes("여비의 지급 구분")) boost += 45;
    if (["3", "16"].includes(articleNo)) boost += 80;
    if (text.includes("별표 4") || text.includes("국외 여행자") || text.includes("숙박비")) boost += 35;
  }

  if (terms.includes("연차 유급휴가") || terms.includes("연차휴가")) {
    if (lawName.includes("근로기준법")) boost += 70;
    if (title.includes("연차 유급휴가")) boost += 60;
    if (normalizeArticleNo(getRecordArticleNo(record)) === "60") boost += 80;
  }
  if (terms.includes("출산전후휴가") || terms.includes("임산부의 보호")) {
    if (lawName.includes("근로기준법")) boost += 70;
    if (title.includes("임산부의 보호")) boost += 60;
    if (normalizeArticleNo(getRecordArticleNo(record)) === "74") boost += 80;
  }
  if (terms.includes("근로자퇴직급여 보장법") || terms.includes("퇴직금") || terms.includes("중간정산")) {
    if (lawName.includes("근로자퇴직급여 보장법")) boost += 65;
    if (text.includes("중간정산")) boost += 45;
    if (title.includes("퇴직금") || title.includes("급여의 종류")) boost += 20;
    if (lawName === "근로자퇴직급여 보장법" && normalizeArticleNo(getRecordArticleNo(record)) === "8") boost += 90;
    if (lawName === "근로자퇴직급여 보장법 시행령" && normalizeArticleNo(getRecordArticleNo(record)) === "3") boost += 80;
  }
  if (terms.includes("개인정보 보호법") || terms.includes("개인정보 유출") || terms.includes("처리위탁")) {
    const articleNo = normalizeArticleNo(getRecordArticleNo(record));
    if (lawName.includes("개인정보 보호법")) boost += 90;
    if (["2", "26", "29", "34", "39", "39의2"].includes(articleNo)) boost += 85;
    if (title.includes("업무위탁") || title.includes("안전조치") || title.includes("유출") || title.includes("손해배상")) boost += 55;
    if (text.includes("수탁자") || text.includes("위탁자") || text.includes("정보주체") || text.includes("보호위원회")) boost += 25;
  }

  if (terms.includes("연구직공무원") && text.includes("연구직공무원")) boost += 8;
  if (terms.includes("선금")) {
    if (sourceId === "admrul") boost += 18;
    if (title.includes("정부 입찰") || title.includes("계약 집행기준") || lawName.includes("정부 입찰")) boost += 45;
    if (title.includes("계약예규") || lawName.includes("계약예규")) boost += 20;
    if (text.includes("선금") && text.includes("100분의 70")) boost += 60;
    if (text.includes("제34조") && text.includes("선금")) boost += 20;
  }
  if (terms.includes("1인견적") || terms.includes("1인 견적") || terms.includes("견적서제출")) {
    if (title.includes("지방자치단체") || lawName.includes("지방자치단체")) boost += 35;
    if (title.includes("입찰 및 계약집행기준") || lawName.includes("입찰 및 계약집행기준")) boost += 25;
    if (text.includes("1인") && text.includes("견적")) boost += 35;
    if (text.includes("견적서") && text.includes("수의계약")) boost += 20;
  }
  if (terms.includes("여성기업")) {
    if (text.includes("여성기업") && text.includes("수의계약")) boost += 45;
    if (title.includes("국가를 당사자로 하는 계약") || lawName.includes("국가를 당사자로 하는 계약")) boost += 16;
  }
  if (terms.includes("계약보증금면제") || terms.includes("보증금면제")) {
    if (text.includes("계약보증금") && text.includes("면제")) boost += 45;
  }
  if (terms.includes("외부강의") || terms.includes("외부강의등")) {
    if (text.includes("외부강의") || text.includes("외부강의등")) boost += 45;
    if (text.includes("신고")) boost += 15;
  }
  if (terms.includes("사전통지") || terms.includes("행정절차법")) {
    if (title.includes("행정절차법") || lawName.includes("행정절차법")) boost += 35;
    if (text.includes("사전통지") || text.includes("의견제출") || text.includes("청문")) boost += 35;
  }
  if (terms.includes("정보공개") || terms.includes("비공개대상정보")) {
    if (title.includes("정보공개") || lawName.includes("정보공개")) boost += 30;
    if (text.includes("의사결정") || text.includes("내부검토") || text.includes("비공개대상정보")) boost += 25;
  }
  for (const alias of LAW_ALIASES) {
    if (!terms.includes(alias.lawName) && !alias.terms.some((term) => terms.includes(term))) continue;
    if (lawName.includes(alias.lawName)) boost += 90;
  }
  const articleTerm = terms.find((term) => /^제\d+조(?:의\d+)?$/.test(term) || /^제\d+의\d+조$/.test(term));
  if (articleTerm && normalizeArticleNo(getRecordArticleNo(record)) === normalizeArticleNo(articleTerm)) {
    boost += 110;
  }
  return boost;
}

function normalizeToken(token) {
  let value = token;
  const endings = [
    "으로서",
    "으로써",
    "에게는",
    "에게",
    "에서",
    "부터",
    "까지",
    "인지",
    "인가",
    "이라",
    "이며",
    "냐",
    "요",
    "은",
    "는",
    "이",
    "가",
    "을",
    "를",
    "에",
    "의",
    "와",
    "과",
    "도",
    "만",
  ];

  let changed = true;
  while (changed && value.length > 2) {
    changed = false;
    for (const ending of endings) {
      if (value.length <= ending.length + 1 || !value.endsWith(ending)) continue;
      value = value.slice(0, -ending.length);
      changed = true;
      break;
    }
  }

  return value;
}

function isEmptyResult(text) {
  return /일치하는 .+ 없습니다|확인하여 주십시오/.test(text);
}

function compactText(value, limit = 420) {
  const text = String(value || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function readSyncSummary() {
  if (manifestCache) return manifestCache;

  manifestCache = LEGAL_SOURCES.map((source) => {
    try {
      const manifest = JSON.parse(fs.readFileSync(source.manifest, "utf8"));
      return {
        label: source.label,
        syncedAt: manifest.syncedAt || "",
        count: manifest.lawCount || manifest.itemCount || manifest.caseCount || manifest.precedentCount || manifest.chunkCount || 0,
      };
    } catch (_error) {
      return {
        label: source.label,
        syncedAt: "",
        count: 0,
      };
    }
  });

  return manifestCache;
}

function formatSyncSummary(summary) {
  return summary
    .filter((item) => item.syncedAt || item.count)
    .map((item) => {
      const count = item.count ? `${item.count}건` : "건수 미확인";
      return `${item.label} ${count}${item.syncedAt ? `(${formatDate(item.syncedAt)})` : ""}`;
    })
    .join(", ");
}

function formatDate(value) {
  const text = String(value || "");
  if (/^\d{8}$/.test(text)) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return text;
}

function findEmpEvidence(userText, limit = 5) {
  const terms = extractEmpSearchTerms(userText);
  if (!terms.length) return [];

  const records = loadEmpIndex();
  if (!records.length) return [];

  return records
    .map((record) => ({ record, score: scoreEmpRecord(record, terms) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ record }) => ({
      title: record.title || record.docId || "EMP document",
      page: record.page || "?",
      type: record.type || "text",
      text: compactEvidenceText(record.text),
    }));
}

function extractEmpSearchTerms(userText) {
  const raw = String(userText || "").toLowerCase();
  const terms = new Set();

  for (const token of raw.match(/[a-z0-9][a-z0-9.-]{1,}/g) || []) {
    terms.add(token);
  }

  if (/\bpoe\b/i.test(userText || "")) {
    ["poe", "point-of-entry", "point of entry", "points of entry", "poe protective", "cable poe", "electrical poe"].forEach((term) =>
      terms.add(term)
    );
  }

  if (/\bieee\s*299\b/i.test(userText || "") || raw.includes("299")) {
    ["ieee 299", "299", "shielding effectiveness", "measurement distance", "test distance"].forEach((term) => terms.add(term));
  }

  if (looksLikeEmpShieldingEffectivenessQuery(userText)) {
    [
      "se",
      "shielding effectiveness",
      "shielding effectiveness tests",
      "shielding effectiveness requirement",
      "차폐효과",
      "차폐 효과",
      "차폐성능",
      "em barrier",
      "80 db",
      "ieee 299",
    ].forEach((term) => terms.add(term));
  }

  if (/\bspd\b/i.test(userText || "") || raw.includes("서지")) {
    ["spd", "surge", "surge protection", "surge arrester"].forEach((term) => terms.add(term));
  }

  if (raw.includes("차폐") || raw.includes("shield")) {
    ["shield", "shielding", "shielding effectiveness", "electromagnetic barrier", "em barrier"].forEach((term) => terms.add(term));
  }

  if (/\bhemp\b/i.test(userText || "") && (/\be1\b/i.test(userText || "") || /\be2\b/i.test(userText || "") || /\be3\b/i.test(userText || ""))) {
    ["hemp", "e1", "e2", "e3", "early-time", "intermediate-time", "late-time", "geomagnetic", "nanosecond"].forEach((term) =>
      terms.add(term)
    );
  }

  if (raw.includes("거리") || raw.includes("distance")) {
    ["distance", "separation", "measurement distance", "test distance"].forEach((term) => terms.add(term));
  }

  return [...terms].filter((term) => term.length >= 2);
}

function scoreEmpRecord(record, terms) {
  const text = `${record.title || ""} ${record.docId || ""} ${record.text || ""}`.toLowerCase();
  let score = 0;

  for (const term of terms) {
    if (!empTextIncludesTerm(text, term)) continue;
    score += term.includes(" ") || term.includes("-") ? 5 : 2;
  }

  if (terms.includes("poe")) {
    if (/point-of-entry|points of entry|point of entry/i.test(text)) score += 30;
    if (/poe protective|poe protection|electrical poe|cable\/piping poe|shield points of entry/i.test(text)) score += 18;
    if (/power over ethernet/i.test(text)) score -= 50;
    if (/mil-std-188-125-1/i.test(record.docId || record.title || "")) score += 8;
    if (/cisa-ncc-emp-protection/i.test(record.docId || record.title || "")) score += 5;
  }

  if (terms.includes("ieee 299") || terms.includes("299")) {
    if (/ieee.?299/i.test(text)) score += 20;
    if (/shielding effectiveness|shielding effectiveness\s*\(se\)|se\s+shielding effectiveness/i.test(text)) score += 24;
    if (/distance|separation|meter|metre|measurement/i.test(text)) score += 8;
    if (/susceptibility|mil-std-461|iec\s*61000/i.test(text)) score -= 14;
  }

  if (terms.includes("shielding effectiveness") || terms.includes("se")) {
    if (/se\s+shielding effectiveness/i.test(text)) score += 42;
    if (/shielding effectiveness\s*\(se\)|shielding effectiveness tests?/i.test(text)) score += 38;
    if (/shielding effectiveness requirement|hemp shielding effectiveness/i.test(text)) score += 28;
    if (/site equipment|system engineering/i.test(text)) score -= 60;
    if (/itu-t-k78|k78/i.test(record.docId || record.title || "")) score += 12;
    if (/cisa-ncc-emp-protection/i.test(record.docId || record.title || "")) score += 10;
  }

  if (record.type === "paragraph") score += 2;
  if (record.type === "figure") score -= 1;

  return score;
}

function empTextIncludesTerm(text, term) {
  const value = String(term || "").toLowerCase();
  if (!value) return false;
  if (value.length <= 2 && /^[a-z0-9]+$/.test(value)) {
    return new RegExp(`\\b${escapeRegExp(value)}\\b`, "i").test(text);
  }
  return text.includes(value);
}

function looksLikeEmpShieldingEffectivenessQuery(value) {
  const text = String(value || "");
  const lower = text.toLowerCase();
  return (
    (/\bse\b/i.test(text) || lower.includes("shielding effectiveness") || lower.includes("차폐효과") || lower.includes("차폐 효과") || lower.includes("차폐성능")) &&
    /(emp|hemp|iemi|hpem|차폐|shield|shielding|em\s*barrier|ieee\s*299|mil-std|방호|전자기)/i.test(text)
  );
}

function loadEmpIndex() {
  if (empIndexCache) return empIndexCache;

  const indexPaths =
    empDataMode() === "safe"
      ? [path.join(ROOT_DIR, "data", "safe_blocks", "block-search-index.jsonl")]
      : [
          path.join(ROOT_DIR, "data", "emp_blocks", "block-search-index.jsonl"),
          path.join(ROOT_DIR, "data", "emp_kr", "search-index.jsonl"),
        ];

  empIndexCache = indexPaths.flatMap((indexPath) => {
    try {
      return fs
        .readFileSync(indexPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line);
          } catch (_error) {
            return null;
          }
        })
        .filter((record) => record?.text);
    } catch (_error) {
      return [];
    }
  });

  return empIndexCache;
}

function empDataMode() {
  return String(process.env.HEYU_EMP_DATA_MODE || "").toLowerCase();
}

function compactEvidenceText(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > 420 ? `${text.slice(0, 420)}...` : text;
}

module.exports = {
  buildAdminMcpContext,
  buildDocumentConverterMcpContext,
  buildEmpLocalContext,
  buildLegalLocalContext,
  buildLanguageMcpContext,
  buildNoriMcpContext,
  buildReportMcpContext,
  buildTechnicalTranslatorMcpContext,
  buildTranslatorMcpContext,
  extractSearchTerms,
  findEmpEvidence,
  searchLegalEvidence,
};
