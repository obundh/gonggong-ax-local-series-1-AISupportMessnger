# Precedent Sync

폐쇄망에서 판례 API를 직접 호출할 수 없을 때 쓰는 외부망 동기화 도구입니다.

## 흐름

1. 외부망 PC 또는 등록된 서버에서 법제처 Open API 인증값(`OC`)으로 실행
2. 판례 목록과 본문을 `data/precedent` 폴더에 저장
3. 생성된 폴더를 폐쇄망으로 반입
4. 앱 또는 로컬 LLM/RAG가 `index.json`, `search-index.jsonl`, `cases/*.json`만 조회

## 실행

PowerShell 기준:

```powershell
$env:PRECEDENT_OC="발급받은_OC"
$env:PRECEDENT_QUERIES="공무원,징계,손해배상"
$env:PRECEDENT_OUT="data/precedent"

npm run precedent:sync
```

옵션으로 바로 넘길 수도 있습니다.

```powershell
$env:PRECEDENT_OC="YOUR_OC"
npm run precedent:sync -- --query "연구직공무원" --max-pages 3
```

본문까지 검색하려면 `--search 2`를 사용합니다.

```powershell
npm run precedent:sync -- --query "연구직공무원" --search 2 --max-pages 2
```

대법원 판례만 우선 받을 때는 법원종류 코드를 붙입니다.

```powershell
npm run precedent:sync -- --query "징계" --org 400201 --max-pages 5
```

## 주요 옵션

- 인증값은 `PRECEDENT_OC`, 그다음 `LAW_OC` 환경변수로만 입력
- `--query`: 판례명 또는 본문 검색어. 여러 번 지정 가능
- `--queries`: 콤마로 구분한 검색어 목록
- `--out`: 출력 폴더. 기본값 `data/precedent`
- `--display`: 페이지당 목록 수. 기본/최대 `100`
- `--max-pages`: 검색어별 최대 페이지 수. 기본 `1`
- `--delay-ms`: API 호출 사이 대기 시간. 기본 `250`
- `--search`: `1` 판례명 검색, `2` 본문 검색
- `--org`: 법원종류. 예: 대법원 `400201`, 하위법원 `400202`
- `--skip-details`: 목록만 저장하고 본문 조회 생략
- `--force`: 기존 `cases/*.json` 캐시 무시

## 출력물

- `manifest.json`: 동기화 실행 정보
- `index.json`: 판례별 메타데이터
- `search-index.jsonl`: 로컬 검색/RAG용 텍스트 청크
- `cases/*.json`: 판례 본문 원본 또는 래핑 JSON

## 주의

판례 데이터는 법령보다 검색어 설계가 중요합니다. 처음부터 전부 받으려 하기보다 업무별 키워드를 나누어 받는 편이 좋습니다.

예시는 다음처럼 시작합니다.

```powershell
$env:PRECEDENT_QUERIES="공무원,징계,직위해제,인사처분,국가배상,행정소송,계약,입찰,정보공개"
```

법제처 Open API는 인증값뿐 아니라 신청/등록된 접속 환경을 검증할 수 있습니다.
로컬 PC에서 호출할 경우 해당 외부망 IP 또는 도메인이 API 신청 정보와 맞아야 합니다.
