# Third-Party Notices

이 파일은 공개 소스 배포본의 제3자 구성요소 경계를 설명합니다. 실제 설치파일이나 별도 런타임 묶음을 만들 때는 그 산출물에 포함된 파일을 기준으로 다시 감사해야 합니다.

## npm dependencies

Electron, Lucide, Chart.js, pdf-lib, pdfjs-dist, ExcelJS, Sharp, Model Context Protocol SDK/filesystem server와 전이 의존성은 `package-lock.json`에 기록된 각 패키지 라이선스를 따릅니다.

- `jszip`: `(MIT OR GPL-3.0-or-later)` 중 MIT 조건으로 사용
- `yauzl` 3.4.0: MIT, ZIP 패키지 문서의 제한 기반 스트리밍 검사·추출에 사용. 공식 배포: https://www.npmjs.com/package/yauzl
- `yazl` 3.3.1: MIT, 사용자가 선택한 문서 리소스의 새 ZIP 저장에 사용. 공식 배포: https://www.npmjs.com/package/yazl
- `pdfjs-dist`: Apache-2.0
- `sharp` 및 플랫폼 바이너리: 패키지 라이선스와 libvips 관련 고지 유지 필요

`node_modules`는 이 공개 소스 배포본에 포함되지 않습니다. 설치·배포 산출물에는 실제 포함된 패키지의 LICENSE/NOTICE를 보존해야 합니다.

## bundled and excluded runtimes and weights

일반 Git 소스에는 대용량 바이너리와 가중치를 커밋하지 않습니다. Windows 설치본을 만들 때는 아래 김속기 기본 구성만 고정 출처에서 받아 크기와 SHA-256을 검증한 뒤 수정 없이 동봉합니다.

- whisper.cpp 1.9.2의 `whisper-cli.exe`, `whisper.dll`, 필수 `ggml*.dll` (MIT, SDL2 제외)
- OpenAI Whisper `large-v3-turbo` 기반 `ggml-large-v3-turbo-q5_0.bin` (MIT)
- Silero VAD 6.2.0 기반 `ggml-silero-v6.2.0.bin` (MIT)
- ComfyUI 런타임과 Python 가상환경
- 이미지 생성 체크포인트

이 항목을 별도 배포하려면 각 파일의 원본 URL, 정확한 버전, 체크섬, 라이선스, 수정 여부와 재배포 조건을 별도 릴리스 명세에 기록해야 합니다. 특히 이미지 체크포인트는 모델별 재배포·상업 이용 조건을 확인하기 전에는 번들링하지 않습니다.

### 김속기 동봉 및 로컬 파일 설치 구성요소

- 기본 동봉: whisper.cpp 1.9.2 Windows x64 CPU 런타임, OpenAI Whisper `large-v3-turbo-q5_0`, Silero VAD 6.2.0
- 선택 로컬 파일 설치: OpenAI Whisper `small-q5_1`
- 모든 자산: MIT, 고정 리비전·크기·SHA-256 검증

정확한 빌드 출처, 크기와 해시는 `app/main/stt-catalog.cjs`, 사람이 읽는 설명은 `docs/STT_SETUP.md`를 기준으로 합니다. 배포 앱은 비동봉 STT 모델을 네트워크로 받지 않으며, 메인 파일 선택창으로 고른 카탈로그 일치 파일만 검증해 설치합니다. 원 자산은 수정 없이 포함하며 원 저작권·라이선스가 프로젝트 라이선스로 바뀌지 않습니다. MIT 저작권 고지와 전문은 `third_party/licenses`에 있으며 설치본의 `resources/licenses`에도 복사됩니다. 이 포함 관계는 원 개발자나 단체의 보증·제휴를 의미하지 않습니다.

### 김루틴 동봉 프로그램

- [gonggong-ax-local-4 Series 4 v4.1.1](https://github.com/obundh/gonggong-ax-local-4/releases/tag/v4.1.1): MIT, Windows x64 포터블 ZIP을 공식 GitHub release에서 수정 없이 내려받아 고정 크기와 SHA-256을 검증

Series 4 바이너리는 공개 소스 저장소에는 커밋하지 않습니다. 배포 빌드 단계에서 공식 ZIP을 고정 크기와 SHA-256으로 검증해 HEYU 설치파일의 `series4-bundle` 리소스에 수정 없이 포함하며, 원 ZIP 안의 LICENSE와 제3자 고지 파일을 함께 보존합니다. 설치된 HEYU는 외부 다운로드 없이 이 번들만 사용자별 앱 데이터 폴더에 검증ㆍ설치합니다. 고정 URL은 `tools/prepare-series4-bundle.cjs`, 고정 버전ㆍ크기ㆍ해시는 `app/main/series4-integration.cjs`, 설치ㆍ세션 검토 경계는 `docs/SERIES4_INTEGRATION.md`를 기준으로 합니다.

## app assets

공개본에는 앱 아이콘과 현재 공개 명단용 생성형 프로필 이미지 11개가 포함됩니다. 설치 전 웹 데모에는 데스크톱 앱 원본을 바이트 그대로 보존한 사본과 초기 전송량을 줄인 160×160 WebP 파생본이 함께 있으며, 변환 조건과 양쪽 SHA-256은 avatar-thumbs/manifest.json에 기록합니다. 이 이미지는 실존 인물의 신원 사진으로 사용하지 않으며, 새 이미지를 넣거나 외부에 재배포할 때는 생성 출처, 사용 권한, 실존 인물·로고 복제 여부와 파일 메타데이터를 다시 확인해야 합니다.

## Korean Legal MCP practice dictionary

- 구성요소: 대한민국 법률 실무 약어·은어·사건부호 사전 1.0, 831개 항목
- 출처 묶음: `korean_legal_mcp_PUBLIC_RELEASE_CORE_2026-08-16`
- 저작자 표시: Korean Legal MCP contributors
- 라이선스: 독자적인 선택·배열·설명에 권리가 성립하는 범위에서 CC BY 4.0
- 용도: 김법률의 로컬 검색어 해석과 다의어 후보 제시. 법령·판례 원문 근거를 대체하지 않음

원 데이터의 해시·건수·한계는 `data/legal_alias/practice-terms.manifest.json`, 상세 귀속과 재배포 조건은 `third_party/licenses/Korean-Legal-MCP-DATA-LICENSE.md`를 따릅니다. 원 패키지의 온라인 API 클라이언트와 인증값 처리는 포함하지 않았습니다.

## 국가법령정보센터 공식 법령용어 목록 팩

`data/legal_terms`는 국가법령정보 공동활용의 `lstrmAI`와 `lstrm` 목록을 외부망 준비 단계에서 동기화한 로컬 검색용 사본입니다. API 인증값은 포함하지 않으며, 정의·동의어 관계·조문 관계 본문 전건을 수록했다고 표시하지 않습니다. 실제 목록·정의·관계 수록 건수와 SHA-256은 `data/legal_terms/manifest.json`을 따릅니다. 법령정보 이용 시 국가법령정보센터 공공데이터 이용정책, 제3자 권리, 정확성·변조 금지 조건을 확인해야 합니다.

## korean-law-mcp selected search normalizer

- 출처: [chrisryugj/korean-law-mcp](https://github.com/chrisryugj/korean-law-mcp) 4.10.0, commit `71e9f3d9819e9574daf54f7914ca832b1062a116`
- 저작권: Copyright (c) 2025 Chris
- 라이선스: MIT
- 반입 범위: `src/lib/search-normalizer.ts`의 순수 문자열 정규화와 검토된 일부 법령 별칭·오타 힌트
- 제외 범위: 국가법령정보센터/국세청 API 호출, 인증키 처리, HTTP 서버, 패키지 의존성, 온라인 캐시 및 원문 데이터

HEYU에 이미 설치된 공식 약칭과 중복되는 항목은 다시 싣지 않았습니다. `국계법`, `행정법`, `원산지법`처럼 둘 이상의 법령을 가리킬 수 있는 표현은 후보만 제시하고 하나로 자동 확정하지 않습니다. 전문은 `third_party/licenses/korean-law-mcp-v4.10.0-MIT.txt`에 있습니다.

## project licence

이 공개본의 프로젝트 코드에는 별도 `LICENSE` 파일을 제공하지 않습니다. `package.json`의 `UNLICENSED` 표기는 npm 배포를 허가한다는 뜻이 아니며, 프로젝트 소유자의 별도 서면 허락 없이 코드·문서·이미지·설치파일의 사용·수정·재배포 권한을 추정해서는 안 됩니다. 이 제한은 아래에 개별 고지가 있는 제3자 구성요소의 원래 라이선스를 바꾸지 않습니다.
