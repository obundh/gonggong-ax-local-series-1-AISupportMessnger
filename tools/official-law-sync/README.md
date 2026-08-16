# 공식 법령 로컬 corpus 동기화

김법률이 폐쇄망에서 사용할 국가법령정보센터 자료를 외부망 PC에서 준비하는 도구입니다. 실행 중에만 Open API를 호출하며, 생성된 corpus와 로컬 MCP는 네트워크를 사용하지 않습니다.

## 수집 범위

- `law`: 현행 법령 전체 목록과 현재 `MST` 기준 본문 전체
- `lsAbrv`: 공식 법령명 약칭 전체
- `prec`, `expc`, `decc`, `admrul`, `detc`: 전체 목록 메타데이터
- 위 다섯 참고자료의 본문: 검증된 기존 seed와 스크립트에 명시된 공공업무 분야 query pack만. 각 query는 최신 목록 기준 최대 200건

판례·해석례·심판례·행정규칙·헌재결정례 약 27만 건의 본문 전체는 1차 corpus에 포함하지 않습니다. 각 target `manifest.json`의 `detailCoverage`가 실제 목록 건수, 본문 건수, 선택 방식과 query pack을 기록합니다.

## 실행

OC는 명령행 인자로 넘기지 않습니다. 명령행 기록과 프로세스 목록에 남지 않도록 환경변수만 사용합니다.

```powershell
$env:LAW_OC = "승인된_OC"
npm run legal:official:sync -- --seed-root "C:\path\to\existing\data"
```

짧은 검증 배치:

```powershell
npm run legal:official:sync -- --max-pages 1 --max-details 2
```

같은 명령을 다시 실행하면 `.sync-state.json`과 `.sync/<signature>/pages`에서 이어받습니다. 요청 간격은 기본 350ms이며 네트워크 오류는 지수 백오프로 재시도합니다. `--max-pages 0 --max-details 0`은 이번 실행 제한이 없다는 뜻입니다.

완료된 목록을 공식 API에서 새로 갱신할 때만 `--refresh-list`를 붙입니다. 새 generation은 별도 staging 폴더에 수집되며 성공하기 전까지 기존 완료 corpus와 manifest를 바꾸지 않습니다. 단순 재빌드나 `--seed-only`는 실제 목록 수집시각(`retrievedAt`)을 현재 시각으로 갱신하지 않습니다.

## seed 규칙

`--seed-root`는 원본을 읽기만 합니다. 복사 대상은 JSON 파싱과 본문 유효성 검사를 통과해야 합니다. 법령 seed는 파일명이 아니라 본문 안의 `법령일련번호(MST)`로 다시 이름을 붙이므로 현재 목록의 MST가 바뀐 법령은 캐시 적중하지 않고 다시 받습니다. 다른 target은 공식 일련번호를 사용합니다.

## 산출물

```text
data/
├─ legal-corpus-manifest.json
├─ law|prec|expc|decc|admrul|detc/
│  ├─ manifest.json
│  ├─ index.json
│  ├─ search-index.jsonl
│  └─ items/*.json
└─ legal_alias/
   ├─ official-aliases.json
   └─ official-aliases.manifest.json
```

각 manifest는 출처 URL, 수집 시각, 파일별 SHA-256, 전체 content digest, 수집 범위와 재개점을 기록합니다. OC와 OC가 포함된 링크는 저장 전에 마스킹합니다.

## 법적·무결성 고지

국가법령정보센터 자료는 공공데이터 이용조건과 제3자 권리를 확인하여 활용해야 합니다. 생성 corpus는 참고자료이고 법적 효력이 없으므로 법적 효력이 필요한 경우 관보 등 공식 원문을 우선 확인해야 합니다. 원문을 위조·변조하거나 공식 원문인 것처럼 표시해서는 안 됩니다.

- 국가법령정보센터: https://www.law.go.kr/
- 국가법령정보 공동활용: https://open.law.go.kr/
- OPEN API 활용가이드: https://open.law.go.kr/LSO/openApi/guideList.do
- 법적효력/저작권: https://www.law.go.kr/lawPetitionForm.do?menuId=13&subMenuId=79
