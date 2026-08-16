# 국가법령정보센터 공식 법령용어 로컬 목록 팩

외부망 준비 PC에서 `lstrmAI`와 `lstrm` 목록을 끝까지 페이지 단위로 수집한 뒤, 폐쇄망 김법률 MCP가 읽는 무결성 검증 팩을 만듭니다. 네트워크 코드는 이 동기화 폴더에만 있으며 `tools/mcp-law` 런타임은 파일만 읽습니다.

## 실행

OC는 프로세스 인자, 상태 파일, 페이지 캐시, 최종 매니페스트 및 로그에 남기지 않습니다. 환경변수 `LAW_OC`로만 전달합니다.

```powershell
$env:LAW_OC = "승인된_OC"
npm run legal:terms:sync
```

중단 후 같은 명령을 실행하면 `data/.official-term-sync/current.json`이 가리키는 generation의 다음 페이지부터 재개합니다. 새 generation으로 공식 목록을 갱신할 때만 `--refresh`를 사용합니다. 새 팩의 전체 건수·공식 ID 유일성·파일 SHA-256 검증이 끝날 때까지 기존 `data/legal_terms`는 바뀌지 않습니다.

```powershell
npm run legal:terms:sync -- --max-pages 20
npm run legal:terms:sync -- --refresh
```

진행률은 두 목록에서 내려받은 페이지 합계/전체 페이지 합계를 기준으로 약 10%마다 출력합니다.

## 산출물과 수록 범위

```text
data/legal_terms/
  manifest.json
  index.json
  search-index.jsonl
```

- `lstrmAI`, `lstrm`: 각 API가 보고한 `total`과 실제 전 페이지 행 수가 정확히 같아야 완성 처리
- `lstrmAI`: 링크는 저장 전에 제거하고, 메모리에서 먼저 추출한 안정적인 `MST`만 보존
- `lstrm`: `법령용어ID`를 보존
- 동일 정규화 표제어의 공식 ID가 여러 개면 모두 유지
- 동의어는 목록 응답에 명시된 필드만 수록하며 표제어 모양으로 만들지 않음
- 관계 링크 본문은 저장하지 않고 후속 상세 팩이 사용할 공식 식별자만 보존

이것은 **공식 법령용어 전체 목록 인덱스**입니다. 모든 표제어의 정의, 동의어 관계, 조문 관계 본문 전건을 내려받은 팩이 아닙니다. `manifest.json`의 `coverage.definitions`, `coverage.explicitSynonyms`, `coverage.relationReferences`가 각각의 실제 수록 건수를 표시합니다.

## 보안·무결성

- `--oc` 인자는 즉시 거부
- HTTP redirect 거부, 시간 제한, 지수 백오프, 최소 요청 간격 적용
- 응답을 디스크에 쓰기 전에 URL/링크 필드 전체 제거
- 중첩 문자열의 현재 또는 과거 `OC=...`도 재귀 마스킹
- 상태와 산출물을 임시 파일에 fsync한 뒤 원자 교체
- 전체 목록 건수, 전역 공식 ID 유일성, index/JSONL 건수와 SHA-256 검증 후에만 승격

