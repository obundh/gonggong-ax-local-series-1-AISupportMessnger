# Law Sync

폐쇄망에서 법령 API를 직접 호출할 수 없을 때 쓰는 외부망 동기화 도구입니다.

## 흐름

1. 외부망 PC 또는 등록된 서버에서 법제처 Open API 인증값(`OC`)으로 실행
2. 법령 목록과 본문을 `data/law` 폴더에 저장
3. 생성된 폴더를 폐쇄망으로 반입
4. 앱 또는 로컬 LLM/RAG가 `index.json`, `search-index.jsonl`, `laws/*.json`만 조회

## 실행

```powershell
$env:LAW_OC="YOUR_OC"
npm run law:sync -- --query "민법" --out data/law
```

여러 법령을 한 번에 받을 때:

```powershell
npm run law:sync -- --queries "행정기본법,민원 처리에 관한 법률" --out data/law
```

PowerShell/npm에서 옵션 전달이 꼬이면 환경변수 방식으로 실행합니다.

```powershell
$env:LAW_OC="YOUR_OC"
$env:LAW_QUERIES="민법,행정기본법,민원 처리에 관한 법률"
$env:LAW_OUT="data/law"
npm run law:sync
```

## 출력물

- `manifest.json`: 동기화 실행 정보
- `index.json`: 법령별 메타데이터
- `search-index.jsonl`: 로컬 검색/RAG용 텍스트 청크
- `laws/*.json`: 법령 본문 원본 JSON

## 주의

법제처 Open API는 인증값뿐 아니라 신청/등록된 접속 환경을 검증할 수 있습니다.
로컬 PC에서 호출할 경우 해당 외부망 IP 또는 도메인이 API 신청 정보와 맞아야 합니다.
