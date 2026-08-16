# Legal Reference Sync

법령 외의 법률 참고자료를 외부망에서 받아 폐쇄망으로 반입하기 위한 동기화 도구입니다.

## 지원 대상

- `expc`: 법령해석례
- `decc`: 행정심판례
- `admrul`: 행정규칙
- `detc`: 헌재결정례

## 실행

PowerShell 기준:

```powershell
$env:LEGAL_REF_OC="발급받은_OC"

npm run legal-ref:sync -- --target expc --queries "공무원,징계,정보공개" --max-pages 2
```

본문 검색까지 포함하려면 `--search 2`를 붙입니다.

```powershell
npm run legal-ref:sync -- --target decc --query "정보공개" --search 2 --max-pages 2
```

행정규칙은 현행 규칙만 받을 때 `nw=1`을 추가합니다.

```powershell
npm run legal-ref:sync -- --target admrul --queries "전파,보안,계약" --param nw=1
```

## 출력물

기본 출력 위치는 `data/legal_refs/<target>`입니다.

- `manifest.json`: 동기화 실행 정보
- `index.json`: 목록 메타데이터
- `search-index.jsonl`: 로컬 검색/RAG용 텍스트 청크
- `items/*.json`: 본문 원본 또는 래핑 JSON

## 보안

API 호출에 사용한 `OC`는 저장하지 않습니다.
API가 내려준 상세링크에 `OC`가 포함되어 있으면 `OC=REDACTED`로 마스킹합니다.
