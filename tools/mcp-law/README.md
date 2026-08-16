# 김법률 완전 로컬 MCP

가져온 JSON corpus만 읽는 독립 MCP stdio 서버입니다. 실행 코드에는 외부 API 주소, 인증값 처리, 네트워크 클라이언트가 없습니다. 검색어와 본문은 컴퓨터 밖으로 보내지 않습니다.

## MCP 설정

```json
{
  "mcpServers": {
    "heyu-kim-law-local": {
      "command": "node",
      "args": ["C:/absolute/path/heyu-public/tools/mcp-law/server.cjs"],
      "env": {
        "HEYU_DATA_DIR": "C:/absolute/path/legal-corpus"
      }
    }
  }
}
```

`HEYU_DATA_DIR`를 생략하면 다음 순서로 찾습니다.

1. 패키지의 `legal-corpus`
2. 휴대용 MCP 폴더의 `data`
3. 소스 트리의 `data`

## 지원 도구

- `legal_search`: 법령명·약칭·쟁점·조문 본문 검색
- `legal_search_batch`: 서로 다른 2~8개 용어를 로컬 법률 corpus에서 분리해 일괄 검색
- `law_get`: 검색 결과의 `target`과 `id`/`mst`/`lid`로 상세 JSON 조회
- `resolve_legal_term`: 실무 사전과 공식 `lstrmAI`·`lstrm` 목록 팩을 함께 조회하는 통합 용어 해석
- `resolve_practice_term`: 기존 호출자를 위한 `resolve_legal_term` 하위호환 이름
- `search_official_legal_terms`: 공식 법령용어 전체 목록 인덱스를 직접 검색하고 정의·관계 본문 실제 수록 범위를 표시
- `legal://data/status`: 자료별 무결성, 수집 시각, 건수, SHA-256, 응답 제한

지원 `target`은 `law`, `prec`, `expc`, `decc`, `admrul`, `detc`입니다. `근기법`, `개보법`, `정보공개법`, `지계법`, `노조법` 같은 검수 별칭과 로컬로 가져온 공식 약칭 목록을 정식명 검색어로 확장합니다. 여기에 `korean-law-mcp` 4.10.0의 순수 정규화 로직과 기존 목록에 없던 검토 별칭·오타 힌트만 선별 이식했습니다. 외부 API나 해당 프로젝트의 런타임 의존성은 포함하지 않습니다.

`노동법` 같은 포괄어는 쟁점이 하나로 좁혀질 때만 라우팅합니다. `국계법`은 국가계약법과 국토계획법 양쪽에서 쓰일 수 있고, `행정법`·`원산지법`도 단일 현행 법령명이 아니므로 자동 확정하지 않고 후보를 반환합니다.

## corpus 계약

```text
HEYU_DATA_DIR/
  legal-corpus-manifest.json          # 선택
  law/
  prec/
  expc/
  decc/
  admrul/
  detc/
    manifest.json
    index.json
    search-index.jsonl
    items/*.json
  legal_alias/
    official-aliases.json             # 선택
    official-aliases.manifest.json    # 공식 약칭을 쓸 때 필수
    practice-terms.json               # CC BY 4.0 실무 용어 사전
    practice-terms.manifest.json      # 해시·건수·귀속·한계
  legal_terms/
    manifest.json                     # lstrmAI·lstrm 전체 목록 건수·SHA·coverage
    index.json                        # 공식 ID와 다의 후보를 보존한 로컬 목록
    search-index.jsonl                # 무결성 검증용 검색 레코드
```

실무 용어 사전은 `Korean Legal MCP contributors`의 공개배포용 CORE 자료를 사용하며 권리가 성립하는 범위에서 CC BY 4.0입니다. 설치본과 휴대용 MCP에는 `Korean-Legal-MCP-DATA-LICENSE.md`를 함께 보존합니다. 이 사전의 설명은 법령·판례 본문이 아니므로 실제 답변 근거는 반드시 `legal_search`와 `law_get` 결과에서 별도로 확인합니다.

`legal_terms`는 공식 법령용어 **목록 전건 팩**입니다. 모든 정의·동의어 관계·조문 관계의 본문 전건 팩이라고 표시하지 않습니다. 런타임 응답과 매니페스트에서 정의 포함 건수, 명시 동의어 건수, 관계 식별자와 관계 본문 건수를 분리합니다.

기존 자료와의 호환을 위해 `precedent_body`, `precedent`, `legal_refs/<target>`, 법령의 `laws`, 판례의 `cases`도 읽습니다.

각 target은 다음 조건을 모두 만족해야 검색 가능합니다.

- 매니페스트에 자료 유형, 출처, 수집시각, 양수 건수가 있음
- 상태가 `partial`, `incomplete`, `stale`가 아님
- `index.json`이 비어 있지 않은 정상 JSON
- `search-index.jsonl`의 모든 비어 있지 않은 줄이 정상 JSON 객체
- 매니페스트의 chunk 수가 있으면 실제 줄 수와 일치
- 새 공식 corpus는 매니페스트의 `index.json`과 `search-index.jsonl` SHA-256이 실제 파일과 모두 일치
- 상세 원문을 열 때 해당 `items/*.json`의 정확한 상대경로 SHA-256이 매니페스트와 일치
- 기본 수집 후 45일 이내. 필요하면 `HEYU_LOCAL_LEGAL_MAX_AGE_DAYS`로 1~3650일 사이에서 조정

상태별 안전 실패 코드는 `LOCAL_CORPUS_MISSING`, `LOCAL_CORPUS_PARTIAL`, `LOCAL_CORPUS_CORRUPT`, `LOCAL_CORPUS_STALE`, `CORPUS_HASH_MISMATCH`입니다. 한 target만 검색하면 그 target만 깊게 검사하므로 다른 자료의 오래됨이나 손상이 해당 검색을 막지 않습니다.

## 검색 캐시와 저사양 PC

첫 검색의 SHA-256 및 JSONL 검증 과정에서 검색에 필요한 필드만 함께 파싱하고, 같은 MCP 프로세스의 다음 검색부터 target별 LRU 캐시를 사용합니다. 기본 캐시 상한은 512 MiB이며 `HEYU_LOCAL_LEGAL_SEARCH_CACHE_MB`로 64~1024 MiB 사이에서 조정할 수 있습니다. 캐시는 파일의 크기·수정시각·변경시각·장치·파일 ID와 검증된 SHA-256에 묶입니다. 파일 세대가 바뀌거나 읽는 중 교체되면 캐시를 버리고 안전 실패합니다.

캐시 예상 크기가 상한을 넘으면 해당 파일 세대는 캐시 불가로 기억하고 매 질의마다 캐시 구축을 재시도하지 않습니다. 이 경우 검색은 JSONL 스트리밍 방식으로 동작합니다. 16 GB PC의 기본값은 캐시 보유량을 약 512 MiB 이하로 제한하는 절충값이며, 실제 전체 프로세스 RSS에는 Node 런타임과 결과 객체가 추가됩니다.

## 출력 경계

- 검색 후보 최대 20건, 후보별 발췌 최대 1,200자
- 상세 본문 최대 30,000자
- 사람이 읽는 MCP 텍스트 최대 48,000자
- 결과마다 출처, 수집시각, search-index SHA-256을 반환
- 상세 JSON을 읽은 경우 해당 파일 SHA-256도 반환
- 판례·해석례 등 목록은 전건이지만 상세 원문이 일부인 경우 목록 건수와 원문 건수를 별도로 표시
- 로컬 절대경로는 결과에 노출하지 않음

법령 제목·메타데이터·본문은 신뢰하지 않는 수집 데이터로 JSON 문자열 안에 직렬화됩니다. 자료 안에 명령·프롬프트·도구 호출 문구가 있어도 실행 지시로 취급하면 안 됩니다.

## 검증

```powershell
npm run test:mcp:law:local
```

테스트는 6종 corpus, 공식·선별 약칭과 오타·조문 검색, 다의어의 비자동확정, 상세 조회, 무결성·최신성 실패, 응답 크기, 프롬프트 인젝션 직렬화, 네트워크 코드 부재, 휴대용 데이터 복사를 검증합니다.

대형 합성 corpus의 cold/warm 검색과 메모리를 확인하려면 다음처럼 실행합니다. 네트워크는 사용하지 않으며 기본 임시 폴더는 종료할 때 삭제합니다.

```powershell
node tools/mcp-law/benchmark-search-cache.cjs --records=221954 --repetitions=44 --cache-mb=512
```

## 휴대용 폴더

```powershell
npm run mcp:law:portable
```

`outputs/heyu-kim-law-mcp`에 번들 서버와 설치된 target의 `manifest.json`, `index.json`, `search-index.jsonl`, 상세 JSON, 공식 약칭·실무사전·공식 법령용어 목록 팩을 복사합니다. 완전한 target이 하나도 없으면 `LOCAL_CORPUS_MISSING`으로 중단합니다.

## 법적·운영상 한계

법령정보는 공공데이터 정책에 따라 활용할 수 있더라도 제3자 권리와 개별 이용조건을 확인해야 하며 내용을 위변조하면 안 됩니다. 이 로컬 사본과 국가법령정보센터 정보 자체는 법적 효력을 보장하지 않습니다. 최신성·정확성이 중요한 경우 관보 등 공식 원문을 우선 확인하세요.
