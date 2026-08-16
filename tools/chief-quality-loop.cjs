const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { sendOfficerMessage } = require("../app/main/llm.cjs");
const { shutdownOfficerMcp } = require("../app/main/mcp-client.cjs");

const ROOT_DIR = path.join(__dirname, "..");
const DEFAULT_OUTPUT = path.join(ROOT_DIR, "tmp", "chief-quality-results.jsonl");

const CASES = [
  {
    id: "travel-czech-researcher-lodging",
    prompt: "내가 국외 출장으로 체코를 가는데 연구사 기준으로 숙박비는 얼마 지급 돼?",
    expect: ["체코", "다등급", "공무원 여비 규정", "별표 4", "숙박비 실비 상한액 미화 106달러"],
    forbid: ["민법", "근로기준법", "제390조", "제543조", "확인되지 않았"],
  },
  {
    id: "privacy-student-system-a",
    allowGenerative: true,
    prompt: `A학원은 온라인 수강생 관리 시스템을 운영하기 위해 B소프트웨어업체와 2025년 1월 1일부터 2025년 12월 31일까지 "수강생 관리 시스템 개발 및 유지보수 계약"을 체결했다. 계약금액은 월 300만 원이고, 계약서에는 "B업체는 시스템 유지보수 과정에서 알게 된 수강생 정보를 외부에 누설해서는 안 된다", "보안 사고 발생 시 즉시 A학원에 통보한다", "B업체의 귀책사유로 손해가 발생하면 B업체가 배상한다"는 조항이 있었다.

A학원은 B업체에게 수강생 이름, 연락처, 생년월일, 수강 과목, 결제 내역, 보호자 연락처가 포함된 관리자 계정을 제공했다. B업체 직원 C는 장애 처리 과정에서 수강생 DB를 내려받아 개인 노트북에 저장했고, 암호화하지 않은 상태로 외부 카페 와이파이에 접속해 작업했다.

2025년 7월 10일, C의 개인 노트북이 악성코드에 감염되었고, 이후 일부 수강생들에게 스팸 문자와 피싱 전화가 오기 시작했다. 2025년 7월 15일, 한 수강생의 보호자가 "학원에만 알려준 번호로 이상한 전화가 온다"고 A학원에 항의했다. A학원은 B업체에 확인을 요청했으나, B업체는 "정확한 유출 여부는 확인되지 않았다"고 답했다.

이후 2025년 7월 25일, B업체 내부 점검 결과 C의 개인 노트북에서 수강생 DB 파일이 발견되었고, 파일 접근 기록상 외부 IP로 전송된 정황도 확인되었다. 그러나 B업체는 평판 문제를 우려해 A학원에 이 사실을 바로 알리지 않았고, 2025년 8월 5일에야 "일부 개인정보가 외부로 유출되었을 가능성이 있다"고 통보했다.

A학원은 수강생과 보호자들에게 사과문자를 발송하고, 일부 환불 요청에 응했다. A학원은 B업체에 대해 계약해지, 손해배상, 이미 지급한 유지보수비 일부 반환을 요구하고 싶어 한다. 반면 B업체는 "유출이 실제 피해로 이어졌다는 증거가 부족하고, A학원이 관리자 계정을 제공했으므로 A학원도 책임이 있다"고 주장한다.

A학원은 B업체에게 어떤 책임을 물을 수 있는지, 수강생들에게 어떤 조치를 해야 하는지, 개인정보 유출 신고나 통지 의무가 있는지 알고 싶어 한다.`,
    expect: ["A학원", "B업체", "수강생", "개인정보 보호법", "제26조", "제29조", "제34조", "제39조"],
    forbid: ["1차 답변: 제390조", "민법 / 제390조", "A업체", "A사", "노트북 분실", "면책", "|"],
  },
  {
    id: "lease-deposit-office-a",
    prompt: `A는 2024년 9월 1일부터 2026년 8월 31일까지 서울 소재 오피스텔을 보증금 2,000만 원, 월세 80만 원 조건으로 임차했다. 계약서에는 "임차인은 퇴거 시 원상복구 의무를 부담한다", "월세를 2개월 이상 연체하면 임대인은 계약을 해지할 수 있다", "보증금은 퇴거 후 30일 이내 반환한다"는 조항이 있었다.

A는 입주 당시 벽지 일부가 들떠 있었고, 욕실 문틀에 곰팡이가 있었으나 별도의 하자확인서를 작성하지 않았다. 다만 입주 당일 휴대전화로 촬영한 사진과 집주인 B에게 보낸 "처음부터 벽지랑 욕실 문틀 상태가 안 좋다"는 문자메시지는 남아 있다.

A는 2025년 12월과 2026년 1월 월세를 늦게 냈지만, 2026년 2월 초에 연체분을 모두 지급했다. 이후 2026년 7월 20일, A는 계약기간 만료일에 맞춰 퇴거하겠다고 B에게 문자로 통보했다.

A는 2026년 8월 31일 실제로 퇴거하고 열쇠를 반납했다. 그런데 B는 "벽지 교체, 욕실 문틀 교체, 청소비, 도어락 교체비가 필요하다"며 보증금 2,000만 원 중 650만 원을 공제하겠다고 통보했다. A는 벽지와 욕실 문틀은 입주 전부터 하자가 있었고, 청소도 통상적인 수준으로 마쳤으며, 도어락은 정상 작동했다고 주장한다.

B는 또한 "과거에 월세를 2개월 연체한 적이 있으므로 계약위반이 있었고, 보증금을 바로 돌려줄 수 없다"고 말한다. A는 보증금 전액 또는 최소한 과도하게 공제된 금액을 돌려받고 싶어 한다.`,
    expect: ["A는", "보증금 2,000만 원", "650만 원", "민법 제615조", "민법 제640조", "주택임대차보호법 제4조제2항"],
    forbid: ["민법 제543조", "제543조(해지", "착수금", "잔금", "근로기준법", "B에게가", "B에게는"],
  },
  {
    id: "labor-designer-a",
    prompt:
      "A는 2023년 6월부터 2025년 8월까지 B마케팅회사에서 콘텐츠 디자이너로 일했다. 계약서 제목은 프리랜서 업무위탁계약서였다. A는 매주 월요일부터 금요일까지 오전 9시 30분까지 사무실에 출근했고 오후 6시 30분 이후 퇴근했다. 지각 결근은 팀장에게 보고했고 쉬려면 회사 메신저에 휴가 신청을 남겼다. 업무는 팀장이 배정했고 디자인 방향, 수정 횟수, 마감 시간도 팀장이 정했다. 회사 컴퓨터와 유료 디자인 프로그램 계정을 사용했다. 보수는 매월 말 고정적으로 280만 원씩 지급되었고 콘텐츠 수와 무관했다. 4대 보험은 없고 매달 3.3% 원천징수했다. 다른 회사 일은 거의 하지 못했다. 2025년 8월 29일 B회사는 이번 달까지만 하겠다고 통보했다. A는 퇴직금과 미사용 연차수당 및 갑작스러운 계약 종료 대응 가능성을 알고 싶어 한다.",
    expect: ["A는", "근로기준법 제2조", "근로기준법 제23조", "근로기준법 제26조", "월 280만 원"],
    forbid: ["C는", "월 250만 원", "3월분", "4월분", "민법 제664조"],
  },
  {
    id: "labor-editor-c",
    prompt:
      "C는 2024년 1월부터 2025년 4월까지 D온라인교육업체에서 영상 편집자로 일했다. 계약서 제목은 프리랜서 용역계약서였고 근로자가 아니며 4대 보험과 퇴직금은 적용되지 않는다고 적혀 있었다. 실제로는 월요일부터 금요일까지 오전 10시부터 오후 7시까지 사무실에 출근했고 회사 컴퓨터와 편집 프로그램 계정을 사용했다. 팀장이 강의 영상 편집, 자막 삽입, 썸네일 제작을 배정하고 마감일을 지시했다. 매일 출근 보고와 퇴근 전 작업내역 보고를 했다. 보수는 매월 고정 250만 원이고 작업량과 무관했다. 2025년 3월분과 4월분 보수 총 500만 원이 미지급되었고 2025년 4월 30일 계약 종료 통보를 받았다. C는 미지급 임금 500만 원, 퇴직금, 연차수당을 청구하고 싶어 한다.",
    expect: ["C는", "근로기준법 제2조", "500만 원", "월 250만 원", "퇴직금"],
    forbid: ["A는", "월 280만 원", "민법 제664조"],
  },
  {
    id: "labor-tutor-e",
    prompt:
      "E는 2022년 9월부터 2025년 2월까지 온라인 학원에서 콘텐츠 검수 담당으로 일했다. 계약서는 프리랜서 위탁계약서였지만 평일 오전 9시부터 오후 6시까지 회사 채팅방에 접속해야 했고, 매일 팀장에게 업무 시작과 종료를 보고했다. 회사 계정으로만 검수 프로그램에 접속했고 업무량과 순서는 회사가 정했다. 매월 310만 원이 고정 지급됐고 다른 회사 업무는 사전 허락 없이는 사실상 불가능했다. 학원은 2025년 2월 말 계약을 끝내면서 퇴직금과 연차수당은 프리랜서라서 없다고 한다. E의 청구 가능성을 검토해줘.",
    expect: ["E는", "근로기준법 제2조", "월 310만 원", "퇴직금", "연차"],
    forbid: ["A는", "C는", "월 250만 원", "월 280만 원", "민법 제664조"],
  },
  {
    id: "civil-homepage-a",
    prompt:
      "A는 B업체에 회사 홈페이지 제작을 의뢰했다. 계약금액은 총 1,200만 원이고 착수금 600만 원은 환불하지 않는다고 되어 있다. 납기일은 2026년 3월 31일이다. A는 착수금 600만 원을 지급했고 B업체는 디자인 시안 1개와 일부 프론트엔드 화면만 만들었다. 납기일이 지나도 완성본을 제공하지 못했고 A가 4월 10일과 4월 20일 두 차례 완성 요청을 했지만 B업체는 곧 처리하겠다고만 했다. B업체는 착수금 환불 불가와 잔금 600만 원 지급을 주장한다. A는 계약 해제, 착수금 반환, 손해배상을 원한다.",
    expect: ["A는", "민법 제544조", "민법 제548조", "착수금 600만 원", "잔금 600만 원"],
    forbid: ["C는", "근로기준법 제2조", "제544조(해제의 효과"],
  },
  {
    id: "civil-app-e",
    prompt:
      "E사는 F개발자에게 모바일 앱 MVP 제작을 맡겼다. 총 계약금액은 2,000만 원이고 착수금 800만 원을 먼저 지급했다. 계약서에는 납기일 2026년 5월 15일, 착수금은 원칙적으로 반환하지 않는다고 적혀 있다. F개발자는 로그인 화면 일부만 만들고 핵심 기능을 구현하지 못했다. E사는 5월 20일과 5월 30일 완성을 요구했지만 F는 곧 하겠다고만 답했다. F는 이미 투입한 시간이 있으니 잔금 1,200만 원도 달라고 한다. E사의 계약 해제와 착수금 반환 가능성을 검토해줘.",
    expect: ["E", "민법 제544조", "민법 제548조", "착수금 800만 원", "잔금 1,200만 원"],
    forbid: ["A는", "C는", "월 250만 원", "근로기준법 제2조"],
  },
  {
    id: "civil-video-g",
    prompt:
      "G는 H프로덕션에 홍보영상 제작을 맡겼다. 총 계약금액은 900만 원이고 계약금 300만 원을 지급했다. 납기일은 2026년 2월 10일이었으나 H는 촬영 원본 일부만 제출하고 최종 편집본을 넘기지 못했다. G는 2월 15일과 2월 25일 이메일로 완성을 요구했다. H는 계약금은 환불하지 않고 잔금 600만 원도 받아야 한다고 주장한다. G가 계약을 해제하고 계약금 반환 및 손해배상을 청구할 수 있는지 검토해줘.",
    expect: ["G", "민법 제544조", "민법 제548조", "계약금 300만 원", "잔금 600만 원"],
    forbid: ["A는", "C는", "월 250만 원", "근로기준법 제2조"],
  },
  {
    id: "annual-leave",
    prompt: "노동법상 연차휴가는 어떻게 발생해? 3문장으로 답해줘.",
    expect: ["근로기준법", "제60조", "15일"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "severance-advance",
    prompt: "퇴직금 중간정산은 노동법상 아무 때나 가능한 거야? 근거랑 같이 짧게 답해줘.",
    expect: ["근로자퇴직급여 보장법", "제8조", "중간정산"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "maternity-leave",
    prompt: "노동법 제74조 출산전후휴가 핵심만 알려줘.",
    expect: ["근로기준법", "제74조", "출산"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "info-network-44-7",
    prompt: "정보통신망법 제44조의7 내용 알려줘.",
    expect: ["정보통신망", "제44조의7"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "civil-web-z",
    prompt:
      "Z기관은 Y업체와 웹 예약시스템 제작 계약을 체결했다. 총액은 3,000만 원, 선지급금은 1,000만 원이다. 납기일을 넘겼고 Y업체는 관리자 화면 일부만 만들었다. Z기관은 두 차례 보완과 완성을 요구했지만 Y업체는 계속 지연했다. Z기관은 계약을 해제하고 선지급금 반환과 추가 손해를 청구할 수 있는지 알고 싶다.",
    expect: ["Z", "민법 제544조", "민법 제548조", "1,000만 원"],
    forbid: ["A는", "C는", "근로기준법 제2조"],
  },
  {
    id: "labor-planner-k",
    prompt:
      "K는 2021년 3월부터 2024년 12월까지 행사기획 회사에서 프리랜서 기획자로 일했다. 평일 오전 9시 회사 사무실로 출근했고 팀장이 업무를 배정했으며 휴가도 회사 승인을 받아야 했다. 보수는 매월 고정 340만 원이었다. 회사는 3.3%만 떼고 지급했으며 4대 보험은 없었다. 계약 종료 후 K는 퇴직금과 연차수당을 요구하려 한다.",
    expect: ["K는", "근로기준법 제2조", "월 340만 원", "퇴직금"],
    forbid: ["A는", "C는", "월 250만 원", "민법 제664조"],
  },
  {
    id: "labor-marketer-m",
    prompt:
      "M은 프리랜서 마케터 계약으로 2024년 5월부터 2025년 7월까지 일했다. 매일 오전 회의에 참석했고 회사 노트북과 광고 계정을 사용했으며 팀장이 소재 제작과 광고 집행 순서를 지시했다. 월 보수는 고정 260만 원이었다. 계약서에는 근로자가 아니라고 되어 있으나 M은 퇴직금과 미사용 연차수당을 청구하고 싶다.",
    expect: ["M은", "근로기준법 제2조", "월 260만 원", "연차"],
    forbid: ["A는", "C는", "월 250만 원", "민법 제664조"],
  },
  {
    id: "civil-design-p",
    prompt:
      "P는 Q디자인업체에 브랜드 리뉴얼 작업을 맡겼다. 총액은 700만 원이고 착수금 350만 원을 지급했다. 납기일 후에도 로고 초안만 제출되고 가이드북과 응용 디자인은 완성되지 않았다. P는 두 차례 완성을 요구했지만 Q는 인력이 투입됐으니 환불은 안 되고 잔금도 달라고 한다. P의 계약 해제와 착수금 반환 가능성을 알려줘.",
    expect: ["P", "민법 제544조", "민법 제548조", "착수금 350만 원"],
    forbid: ["C는", "근로기준법 제2조"],
  },
  {
    id: "annual-allowance",
    prompt: "프리랜서가 근로자로 인정되면 미사용 연차수당도 받을 수 있어?",
    expect: ["근로기준법", "제60조", "근로자"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "dismissal-notice",
    prompt: "프리랜서라고 계약했는데 실제 근로자처럼 일하다가 이번 달까지만 나오라고 통보받으면 해고예고수당도 문제될 수 있어?",
    expect: ["근로기준법", "제26조", "해고"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "wage-liquidation",
    prompt: "근로자로 인정되는 프리랜서에게 퇴사 후 보수를 안 주면 금품청산은 며칠 안에 해야 해?",
    expect: ["근로기준법", "제36조", "14일"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "civil-maintenance-r",
    prompt:
      "R회사는 S업체에 쇼핑몰 유지보수와 기능개선을 맡겼고 총액 1,500만 원 중 500만 원을 먼저 지급했다. S업체는 핵심 결제 오류를 고치지 못하고 약정 기한을 넘겼다. R회사가 두 차례 시정을 요구했지만 처리되지 않았다. S업체는 이미 작업을 시작했으니 선지급금은 못 돌려준다고 한다. 계약 해제와 반환 가능성을 검토해줘.",
    expect: ["R", "민법 제544조", "민법 제548조", "500만 원"],
    forbid: ["C는", "근로기준법 제2조"],
  },
  {
    id: "labor-insurance-not-decisive",
    prompt: "4대 보험이 없고 3.3% 사업소득세를 뗐으면 무조건 프리랜서라서 근로자성이 부정돼?",
    expect: ["3.3%", "근로자성", "배제"],
    forbid: ["민법 제664조", "맥락"],
  },
  {
    id: "civil-final-u",
    prompt:
      "U는 V업체에 랜딩페이지 제작을 맡겼다. 총액 400만 원, 착수금 200만 원, 잔금 200만 원 조건이었다. V업체는 납기일까지 첫 화면 일부만 만들고 완성본을 주지 않았다. U가 추가 완성을 요청했지만 V업체는 대응하지 않았다. U가 계약 해제와 착수금 반환을 요구할 수 있는지 답해줘.",
    expect: ["U", "민법 제544조", "민법 제548조", "착수금 200만 원"],
    forbid: ["C는", "근로기준법 제2조"],
  },
];

const GLOBAL_FORBIDDEN = [
  "정확한 답변을 드리기 어렵",
  "맥락이 명확하지",
  "문맥 파악 불가",
  "제공된 텍스트",
  "법률 조항을 인용한 것으로 추정",
  "A, B",
  "undefined",
  "NaN",
  "제543조(이행지체",
  "제544조(해제의 효과",
  "제548조(이행지체",
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    output: DEFAULT_OUTPUT,
    limit: CASES.length,
    contextLevel: "low",
    targetStreak: 0,
    maxAttempts: 0,
    once: false,
    saveText: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--out") options.output = path.resolve(args[++index] || DEFAULT_OUTPUT);
    if (arg === "--limit") options.limit = Number(args[++index]) || options.limit;
    if (arg === "--streak") options.targetStreak = Number(args[++index]) || options.targetStreak;
    if (arg === "--max-attempts") options.maxAttempts = Number(args[++index]) || options.maxAttempts;
    if (arg === "--context") options.contextLevel = args[++index] || options.contextLevel;
    if (arg === "--once") options.once = true;
    if (arg === "--save-text") options.saveText = true;
  }
  return options;
}

function loadChiefContact() {
  const code = fs.readFileSync(path.join(ROOT_DIR, "app", "renderer", "data.js"), "utf8");
  const sandbox = { window: {} };
  vm.runInNewContext(code, sandbox);
  return sandbox.window.HEYU_DATA.contacts.find((contact) => contact.id === "chief");
}

function writeEvent(output, event) {
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.appendFileSync(output, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`, "utf8");
}

function validate(testCase, result) {
  const failures = [];
  const text = String(result?.text || "");
  const model = String(result?.model || "");
  if (!result?.ok) failures.push("not ok");
  if (text.length < 80) failures.push("too short");
  if (text.length > 2600) failures.push("too long");
  if (model.includes("local-deterministic")) failures.push(`deterministic shortcut detected: ${model}`);

  for (const needle of GLOBAL_FORBIDDEN) {
    if (text.includes(needle)) failures.push(`global forbidden: ${needle}`);
  }
  for (const needle of testCase.expect || []) {
    if (!text.includes(needle)) failures.push(`missing: ${needle}`);
  }
  for (const needle of testCase.forbid || []) {
    if (text.includes(needle)) failures.push(`forbidden: ${needle}`);
  }
  if (/민법 제\d+조/.test(text) && /근로자성|퇴직금|연차수당|4대 보험|3\.3%/.test(testCase.prompt)) {
    failures.push("labor case includes civil-law article");
  }
  if (/근로기준법 제2조/.test(text) && /착수금|계약금|잔금|납기일|완성본/.test(testCase.prompt)) {
    failures.push("civil case includes worker-status article");
  }
  return failures;
}

function preview(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 420);
}

async function main() {
  const options = parseArgs();
  if (fs.existsSync(options.output)) fs.unlinkSync(options.output);
  const contact = loadChiefContact();
  let consecutivePasses = 0;
  let attempts = 0;
  let caseIndex = 0;
  const activeCases = CASES.slice(0, options.limit);
  const targetStreak = options.targetStreak || activeCases.length;
  const maxAttempts = options.maxAttempts || Math.max(activeCases.length, targetStreak) * 4;

  writeEvent(options.output, {
    type: "suite-start",
    limit: activeCases.length,
    contextLevel: options.contextLevel,
    targetStreak,
    maxAttempts,
    once: options.once,
  });

  if (options.once) {
    for (const testCase of activeCases) {
      const startedAt = Date.now();
      attempts += 1;
      writeEvent(options.output, { type: "start", id: testCase.id });

      try {
        const result = await sendOfficerMessage({
          contact,
          history: [],
          userText: testCase.prompt,
          contextLevel: options.contextLevel,
        });
        const failures = validate(testCase, result);
        const passed = failures.length === 0;
        if (passed) consecutivePasses += 1;
        writeEvent(options.output, {
          type: passed ? "pass" : "fail",
          id: testCase.id,
          elapsedMs: Date.now() - startedAt,
          model: result.model,
          failures,
          consecutivePasses,
          attempts,
          preview: preview(result.text),
          ...(options.saveText ? { text: String(result.text || "") } : {}),
        });
        console.log(`${passed ? "PASS" : "FAIL"} ${testCase.id} ${Date.now() - startedAt}ms ${result.model}`);
        if (!passed) {
          console.log(failures.join("; "));
          console.log(preview(result.text));
        }
      } catch (error) {
        writeEvent(options.output, {
          type: "error",
          id: testCase.id,
          elapsedMs: Date.now() - startedAt,
          attempts,
          error: error?.message || String(error),
        });
        console.error(`ERROR ${testCase.id}: ${error?.message || error}`);
      } finally {
        shutdownOfficerMcp();
      }
    }

    writeEvent(options.output, { type: "suite-end", consecutivePasses, attempts, targetStreak: activeCases.length, once: true });
    console.log(`passes=${consecutivePasses}`);
    console.log(`target=${activeCases.length}`);
    console.log(`attempts=${attempts}`);
    if (consecutivePasses < activeCases.length) process.exitCode = 1;
    return;
  }

  while (consecutivePasses < targetStreak && attempts < maxAttempts) {
    const testCase = activeCases[caseIndex];
    const startedAt = Date.now();
    attempts += 1;
    writeEvent(options.output, { type: "start", id: testCase.id });

    try {
      const result = await sendOfficerMessage({
        contact,
        history: [],
        userText: testCase.prompt,
        contextLevel: options.contextLevel,
      });
      const failures = validate(testCase, result);
      const passed = failures.length === 0;
      consecutivePasses = passed ? consecutivePasses + 1 : 0;
      writeEvent(options.output, {
        type: passed ? "pass" : "fail",
        id: testCase.id,
        elapsedMs: Date.now() - startedAt,
        model: result.model,
        failures,
        consecutivePasses,
        attempts,
        preview: preview(result.text),
        ...(options.saveText ? { text: String(result.text || "") } : {}),
      });
      console.log(`${passed ? "PASS" : "FAIL"} ${testCase.id} ${Date.now() - startedAt}ms ${result.model}`);
      if (!passed) {
        console.log(failures.join("; "));
        console.log(preview(result.text));
        if (!options.targetStreak) {
          process.exitCode = 1;
          break;
        }
        caseIndex = 0;
      } else {
        caseIndex = (caseIndex + 1) % activeCases.length;
      }
    } catch (error) {
      consecutivePasses = 0;
      writeEvent(options.output, {
        type: "error",
        id: testCase.id,
        elapsedMs: Date.now() - startedAt,
        attempts,
        error: error?.message || String(error),
      });
      console.error(`ERROR ${testCase.id}: ${error?.message || error}`);
      if (!options.targetStreak) {
        process.exitCode = 1;
        break;
      }
      caseIndex = 0;
    } finally {
      shutdownOfficerMcp();
    }
  }

  if (consecutivePasses < targetStreak) process.exitCode = 1;
  writeEvent(options.output, { type: "suite-end", consecutivePasses, attempts, targetStreak });
  console.log(`consecutivePasses=${consecutivePasses}`);
  console.log(`targetStreak=${targetStreak}`);
  console.log(`attempts=${attempts}`);
}

main().catch((error) => {
  const options = parseArgs();
  writeEvent(options.output, { type: "fatal", error: error?.message || String(error) });
  console.error(error);
  process.exitCode = 1;
});
