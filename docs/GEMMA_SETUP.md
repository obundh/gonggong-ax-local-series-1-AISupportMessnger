# 로컬 LLM 연결 안내

기본 설정에서 앱은 현재 PC의 로컬 Ollama 서버(`http://127.0.0.1:11434`)를 사용합니다. 특정 모델 이름이나 개인 PC의 설치 경로는 배포본에 고정하지 않습니다.

## 앱에서 선택하기

1. 앱을 실행합니다. Ollama가 없어도 메인 화면은 열립니다.
2. 화면 상단의 `로컬 LLM 설정` 또는 `Ollama · 모델명` 배지를 누릅니다.
3. 이 PC의 Ollama에 설치된 모델 목록에서 사용할 모델을 고릅니다.
4. 선택값은 운영체제의 사용자별 앱 설정 폴더에 저장되고 다음 실행에도 유지됩니다.

목록은 Ollama의 `GET /api/tags`에서 실시간으로 읽습니다. Ollama가 실행 중이지만 모델이 하나도 없으면 모델 태그를 입력해 `POST /api/pull`로 받을 수 있습니다. 모델 다운로드는 용량이 클 수 있으므로 사용자가 버튼을 누른 경우에만 시작합니다.

- Ollama 설치: <https://ollama.com/download>
- Ollama 모델 찾기: <https://ollama.com/search>

Ollama가 응답하지 않는다고 해서 앱이 곧바로 미설치로 단정하지 않습니다. 설치 프로그램이 발견되면 Ollama를 실행한 뒤 `다시 확인`을 누르고, 발견되지 않거나 확인할 수 없으면 공식 설치 페이지를 이용합니다.

## 관리자 환경변수

관리자가 모델을 고정해야 하는 환경에서는 환경변수를 사용할 수 있습니다.

```powershell
$env:HEYU_LLM_MODEL="your-installed-model-tag"
$env:HEYU_LLM_BASE_URL="http://127.0.0.1:11434"
npm start
```

`HEYU_LLM_MODEL`이 설정되면 환경변수가 사용자 화면 선택보다 우선하며 선택 UI에 잠금 상태가 표시됩니다. 앱 안의 모델 다운로드는 루프백 Ollama 주소에서만 허용합니다.

`provider`와 `baseUrl`을 외부 OpenAI-compatible 서버로 바꾸면 프롬프트와 첨부 문맥이 해당 서버로 전송될 수 있습니다. 기관 보안정책과 개인정보 처리조건을 먼저 확인하고, API 키는 설정 파일이 아니라 `HEYU_LLM_API_KEY` 환경변수로만 전달하세요.

## 처리 흐름

```text
채팅 입력
→ renderer/chat.js
→ preload IPC
→ main/llm.cjs
→ 사용자가 선택한 로컬 모델
→ 담당 AI 답변
```

법령 담당의 실시간 국가법령정보센터 MCP 조회 여부와 LLM 처리 위치는 별개의 설정입니다. 실시간 법령 결과는 이후 현재 선택된 LLM으로 전달될 수 있습니다.
