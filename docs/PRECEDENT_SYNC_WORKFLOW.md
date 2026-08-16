# 판례 데이터 동기화 순서

폐쇄망에서는 법제처 Open API를 직접 호출하지 않고, 외부망에서 데이터를 받아 로컬 파일로 반입한다.

## 1. 외부망 준비

1. 법제처 국가법령정보 공동활용 Open API 사용 신청
2. 발급받은 `OC` 값 확인
3. API 신청 정보에 실행할 외부망 PC/서버의 IP 또는 도메인 등록
4. 이 프로젝트 폴더를 외부망 실행 환경에 복사
5. `npm install` 실행

## 2. 판례 데이터 동기화

신규 폐쇄망 corpus는 `npm run legal:official:sync`를 우선 사용한다. 이 도구는 판례 전체 목록 메타데이터를 저장하되, 원문은 기존 검증 seed와 manifest에 명시된 query pack 선택분만 수집한다. 약 17만 건의 판례 원문 전체를 1차 배포에 포함하지 않는다. 실제 원문 범위는 `data/prec/manifest.json`의 `detailCoverage`를 확인한다.

PowerShell 기준:

```powershell
$env:PRECEDENT_OC="발급받은_OC"
$env:PRECEDENT_QUERIES="공무원,징계,직위해제,인사처분,국가배상,행정소송,계약,입찰,정보공개"
$env:PRECEDENT_OUT="data/precedent"

npm run precedent:sync
```

본문 검색까지 넓히는 경우:

```powershell
npm run precedent:sync -- --query "연구직공무원" --search 2 --max-pages 3
```

생성물:

```text
data/precedent/
├─ manifest.json
├─ index.json
├─ search-index.jsonl
└─ cases/
   └─ *.json
```

## 3. 폐쇄망 반입

1. `data/precedent` 폴더를 압축
2. 보안 절차에 따라 폐쇄망 반입
3. 폐쇄망 앱 폴더의 `data/precedent` 위치에 압축 해제
4. 김법률은 API가 아니라 이 로컬 데이터만 조회

## 4. 앱 연결 예정

다음 단계에서 구현할 것:

1. `data/precedent/manifest.json`에서 마지막 판례 동기화 일자 표시
2. `data/precedent/index.json`으로 사건명, 사건번호, 법원명 검색
3. `data/precedent/search-index.jsonl`로 판시사항, 판결요지, 판례내용 검색
4. `cases/*.json`에서 원문 본문 확인
5. 김법률 답변에 `관련 판례`, `판례 요지`, `적용 가능성`, `확인 필요`를 분리 표시

## 참고

- 판례 목록 조회: `lawSearch.do?target=prec`
- 판례 본문 조회: `lawService.do?target=prec`
- API는 인증값뿐 아니라 등록된 접속 환경 검증을 할 수 있다.
