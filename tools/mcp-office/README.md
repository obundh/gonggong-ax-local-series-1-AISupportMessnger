# Heyu Office MCP Server

AI지원담당 담당별 로컬 도구를 제공하는 MCP stdio 서버입니다.

## 실행

개발 중 직접 확인할 때:

```bash
npm run mcp:office
```

앱 실행 중에는 Electron 메인 프로세스가 자동으로 이 서버를 백그라운드에서 실행합니다.

## 제공 도구

- `admin_law_search`: 김법률의 행정실무 특화 담당인 김행정의 회계ㆍ계약ㆍ서무ㆍ여비ㆍ물품ㆍ기록물ㆍ정보공개 근거 검색 보조
- `emp_search`: EMP/HEMP/IEMI 표준 및 표/그림 근거 검색
- `translator_context`: 김국어 번역 전 기존 한국어본, 용어 일관성, 번역 초안 경고 규칙
- `language_context`: 김언심 공무원식 문장 정리 규칙
- `report_context`: 개조식 보고서 작성 규칙
- `nori_context`: 김노리 수다지원 말투와 담당 연결 규칙

## 앱 연결

`app/main/mcp-client.cjs`가 MCP 서버를 `stdio`로 실행하고 `tools/call` 요청을 보냅니다.

김행정은 국가법령정보센터 실시간 조회에서 확인된 공식 근거를 우선하고, `admin_law_search`가 찾은 로컬 행정 법령ㆍ예규ㆍ훈령 자료는 보조 후보로만 사용합니다. 공식 근거가 없으면 법령상 금액ㆍ기간ㆍ요건ㆍ가능 여부를 단정하지 않으며, 복잡한 민형사ㆍ노동ㆍ개인정보 등 전문 법률 쟁점은 김법률 검토로 분리합니다. 단순 인사와 일상 대화에는 이 검색 형식을 강제하지 않고 자연스럽고 짧게 답합니다.

김법률의 `legal_search`와 `law_get`은 앱 함수와 분리된 `tools/mcp-law` 완전 로컬 MCP 서버에서 제공합니다. 김법률 경로는 이 Office MCP나 온라인 법령센터 MCP로 우회하지 않습니다.
