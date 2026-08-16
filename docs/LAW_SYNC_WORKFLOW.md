# 법령 데이터 동기화 순서

폐쇄망에서는 법제처 Open API를 직접 호출하지 않고, 외부망에서 데이터를 받아 로컬 파일로 반입한다.

## 1. 외부망 준비

1. 법제처 국가법령정보 공동활용 Open API 사용 신청
2. 발급받은 `OC` 값 확인
3. API 신청 정보에 실행할 외부망 PC/서버의 IP 또는 도메인 등록
4. 이 프로젝트 폴더를 외부망 실행 환경에 복사
5. `npm install` 실행

## 2. 법령 데이터 동기화

신규 전체 corpus는 통합 수집기를 사용한다. `OC`는 명령행 인자로 전달하지 않는다.

```powershell
$env:LAW_OC="발급받은_OC"
npm run legal:official:sync -- --seed-root "C:\path\to\existing\data"
```

통합 수집기는 현행 법령 전체 본문과 공식 법령명 약칭, 판례·법령해석례·행정심판례·행정규칙·헌재결정례 전체 목록을 대상별 폴더에 저장한다. 법령 외 다섯 종류의 원문은 전체가 아니라 기존 검증 seed 및 manifest에 표시된 query pack만 포함한다. 실제 범위는 각 `manifest.json`의 `detailCoverage`를 기준으로 판단한다.

완료 목록을 새로 갱신할 때만 다음처럼 새 generation을 만든다.

```powershell
npm run legal:official:sync -- --refresh-list --seed-root "C:\path\to\existing\data"
```

`--refresh-list`는 target 전체를 sibling staging에 만들고 파일별 SHA-256, record count, 완료 상태를 검증한 뒤 디렉터리 단위로 교체한다. 중간 실패 시 기존 완료 target은 그대로 유지되고, 성공 시 이전 target은 `.official-law-previous` 아래 복구본으로 남는다. `--seed-only`와 단순 재빌드는 `builtAt`만 바꾸며 실제 API 목록 수집시각인 `retrievedAt`을 현재 시각으로 위장하지 않는다.

아래 `law:sync`는 소수 법령명만 별도로 받는 기존 호환 도구다.

PowerShell 기준:

```powershell
$env:LAW_OC="발급받은_OC"
$env:LAW_QUERIES="민법,행정기본법,민원 처리에 관한 법률"
$env:LAW_OUT="data/law"

npm run law:sync
```

통합 생성물:

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

## 3. 폐쇄망 반입

1. `data/legal-corpus-manifest.json`에 기록된 target manifest가 모두 존재하는지 확인
2. 각 target manifest의 `status`, `recordCount`, `chunkCount`, `detailCoverage`, 파일별 `bytes`와 `sha256`, `contentSha256` 검증
3. `data` 전체를 압축하거나 `npm run mcp:law:portable`로 만든 portable pack을 준비
4. 보안 절차에 따라 폐쇄망으로 반입
5. 폐쇄망의 `HEYU_DATA_DIR`에 target 폴더와 `legal_alias`를 함께 배치
6. 반입 후 같은 manifest/hash를 다시 검증
7. 김법률은 외부 API가 아니라 이 로컬 corpus와 로컬 MCP만 조회

`data/law`만 따로 반입하면 판례·해석례 등 다른 target과 공식 약칭을 잃으므로 통합 반입 단위로 사용하지 않는다.

## 4. 앱 및 MCP 연결

현재 앱과 `tools/mcp-law` 서버는 다음 로컬 파일을 읽는다:

1. `data/law/manifest.json`에서 마지막 동기화 일자 확인
2. `data/law/index.json`으로 법령명 검색
3. `data/law/search-index.jsonl`로 조문/키워드 검색
4. `items/*.json`에서 원문 조문 확인
5. 김법률 답변에 `법령명`, `조문`, `시행일`, `확인 필요`를 분리 표시

공개 소스 배포본에는 실제 데이터가 포함되지 않는다. 인증값과 수집 산출물은 로컬에만 보관한다.

판례·법령해석례·행정심판례·행정규칙·헌재결정례는 목록 메타데이터는 전체지만 원문은 seed와 명시 query pack 선택분만 들어 있다. MCP와 답변 화면은 `detailCoverage.incompleteNotice`를 숨기지 말아야 하며, 원문이 없는 후보는 사건번호·기관·일자 등 목록 수준 정보로만 표시해야 한다.

## 참고

- 법령 목록 조회: `lawSearch.do?target=law`
- 법령 본문 조회: `lawService.do?target=law`
- API는 인증값뿐 아니라 등록된 접속 환경 검증을 할 수 있다.
- 생성 corpus는 참고자료이며 법적 효력이 없다. 법적 효력이 필요한 경우 관보 등 공식 원문을 우선 확인한다.
- 공공데이터 이용조건과 제3자 권리를 확인하고, 원문을 위조·변조하거나 공식 원문인 것처럼 표시하지 않는다.
