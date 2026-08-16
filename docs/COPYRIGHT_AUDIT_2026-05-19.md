# 저작권/라이선스 점검 메모

작성일: 2026-05-19

2026-08-15 공개본 메모: 이 문서는 개발 이력 보존용 과거 점검 기록이다. 현재 공개 경계와 잔여 의존성 위험은 `PUBLIC_RELEASE.md`, `THIRD_PARTY_NOTICES.md`, `docs/STT_SETUP.md`를 우선한다.

2026-08-16 갱신 메모: Windows 빌드는 whisper.cpp 1.9.2 필수 실행파일, `large-v3-turbo-q5_0`, Silero VAD를 고정 해시 빌드 캐시에서 설치파일에 포함한다. Git에는 이 대용량 자산을 커밋하지 않으며 `small-q5_1` 등 비동봉 모델은 배포 앱의 네트워크 다운로드가 아니라 검증된 로컬 파일 선택으로만 설치한다. MIT 전문은 `third_party/licenses`와 설치본 `resources/licenses`에 포함한다. 아래 2026-05 당시 판단보다 루트 `THIRD_PARTY_NOTICES.md`의 현재 배포 경계를 우선 확인한다.

이 문서는 개발/배포 판단을 위한 기술 점검 메모이며 법률 자문이 아니다. 검사 범위는 프로젝트 루트와 `package.json`의 Windows 빌드 포함 항목이다.

## 2026-05 당시 요약 결론

- 현재 `package.json` 빌드 설정은 `data`, `models`, `tmp` 폴더를 포함하지 않는다. 즉, EMP 원문 PDF/번역 산출물과 임시 공유 ZIP은 현재 설치파일에 들어가지 않는다.
- 배포판 기준 핵심 잔여 리스크는 `app/renderer/assets/avatars`의 프로필 이미지 출처 기록, 오픈소스 고지 파일 부재, 향후 이미지 모델 체크포인트 번들링이다.
- 개발 폴더에는 `data/emp*` 원본 PDF와 번역/가공물이 남아 있다. 외부 배포에는 넣지 말고, 내부망에서는 기관이 보유한 정식 원문/번역본으로 다시 파싱하는 운용이 안전하다.
- `package-lock.json` 기준 Node 의존성은 대부분 MIT/ISC/Apache/BSD 계열이다. 강한 copyleft 직접 의존성은 발견하지 못했다.
- `package.json` 설명의 "카카오톡/온톡 스타일" 문구는 상표/트레이드드레스 오해를 줄이기 위해 중립 표현으로 변경했다.

## 배포 포함/제외 상태

현재 `build.files`에 포함되는 항목:

- `app/**/*`
- `tools/mcp-office/**/*`
- `tools/routine-recorder/**/*`
- 일부 `node_modules` 런타임 의존성
- `package.json`

현재 포함되지 않는 항목:

- `data/**/*`
- `models/**/*`
- `tmp/**/*`
- `docs/**/*`
- `heyu_workspace/**/*`

2026-05-19 당시 설정을 유지하면 외부 PDF 원문, 번역 캐시, 테스트 스크린샷, 생성 모델 가중치는 설치파일에 들어가지 않았다. 현재는 검토된 김속기 기본 STT 구성만 별도 `extraResources`로 포함하며 업무 데이터와 이미지 생성 모델은 계속 제외한다.

## 이미지/아바타

공개 소스 배포본은 출처·개인정보·메타데이터 판단을 단순화하기 위해 인물형 프로필 PNG를 전부 제외하고 Lucide 기본 아이콘으로 대체했다. 새 아바타를 추가할 때는 촬영자 또는 생성 도구, 생성일, 프롬프트 요약, 재배포 허락, 실존 인물·로고 복제 여부와 파일 메타데이터를 기록해야 한다.

이미지 생성 모델을 나중에 번들링할 경우, 체크포인트별 라이선스를 별도로 확인해야 한다. 모델 파일은 소프트웨어보다 재배포 제한, 상업적 이용 제한, 출력물 제한이 더 강한 경우가 있다.

## 데이터

기존 `docs/DATA_LICENSE_AUDIT.md`의 결론은 여전히 유효하다.

- `data/emp_docs`, `data/emp`, `data/emp_blocks`, `data/emp_assets`, `data/emp_kr`, `data/emp_kr_pdfs`, `data/emp_pdf_translation`은 외부 배포 제외 권장.
- 특히 ITU, EPRI/EEI, NERC, KOGL 4유형, CC BY-NC 자료는 원문/번역/구조화 산출물의 재배포 범위를 보수적으로 봐야 한다.
- `data/emp_pdf_translation/translation-cache.google.json`은 외부 번역 캐시 흔적이므로 배포 제외 또는 삭제 후보다.
- 법령/판례 데이터는 상대적으로 낮은 위험이나 출처, API명, 수집일, 이용조건 메타데이터 유지가 필요하다.

## 오픈소스 의존성

`package-lock.json` 전체 라이선스 카운트:

- MIT: 368
- ISC: 51
- Apache-2.0: 18
- BSD-2-Clause/BSD-3-Clause: 16
- 기타 permissive 계열: BlueOak, Python-2.0, 0BSD, WTFPL, CC0 등

직접 의존성:

- `lucide@0.468.0`: ISC
- `@modelcontextprotocol/server-filesystem@2026.1.14`: MIT
- `pptxgenjs@4.0.1`: MIT
- `xlsx@0.18.5`: Apache-2.0
- `electron@41.3.0`: MIT
- `electron-builder@26.8.1`: MIT
- `pdf-parse@2.4.5`: Apache-2.0
- `pdfkit@0.18.0`: MIT

주의 항목:

- `jszip@3.10.1`: `(MIT OR GPL-3.0-or-later)` 이중 라이선스. MIT 선택 사용으로 고지하면 된다.
- `png-js@1.1.0`: lockfile license 필드가 비어 있으나 패키지에 MIT 라이선스 파일이 있다.
- 공개 소스 배포본에는 `THIRD_PARTY_NOTICES.md`가 있다. 프로젝트 자체 `LICENSE`는 아직 선택되지 않았으므로 외부 공개 전 소유자가 직접 결정해야 한다.

## Python 벤더 도구

`tools/pdftojson-verify`는 현재 Windows 빌드에 포함되지 않는다. 별도 배포할 경우 다음 고지가 필요하다.

- `pdfplumber`: MIT
- `pdfminer.six`: MIT
- `pypdfium2`: Apache-2.0 또는 BSD-3-Clause + PDFium 제3자 고지
- `Pillow`: MIT-CMU 및 포함 라이브러리 고지
- `cryptography`: Apache-2.0 또는 BSD 계열

AGPL PyMuPDF는 현재 사용/벤더링하지 않는 것으로 확인했다.

## 즉시 조치

- `package.json` 설명에서 특정 메신저 서비스명을 제거했다.
- 2026-05-21 현재 `models/image`에 로컬 체크포인트가 있을 수 있으나 설치파일에는 포함하지 않는다.
- 빌드 포함 목록상 `data`, `models`, `tmp`가 빠져 있음을 확인했다.

## 배포 전 체크리스트

1. `THIRD_PARTY_NOTICES.md` 생성: npm 라이브러리와 포함되는 Python 벤더 도구를 각각 고지.
2. 아바타 출처표 작성: 파일명, 생성일, 생성 도구, 사용자 제공 여부, 외부 배포 허락 여부.
3. `data/emp*`와 `translation-cache.google.json`이 빌드 산출물에 들어가지 않는지 패키징 후 재확인.
4. 모델 체크포인트를 번들링할 경우 모델별 라이선스, 재배포 가능 여부, 상업/기관 내부 사용 가능 여부를 별도 승인.
5. 외부 공개용 소개문에서는 특정 서비스명이나 유사 UI를 전면에 내세우지 않기.
6. 법령/판례 데이터를 넣는 빌드를 만들 경우 출처/수집일/이용조건 고지를 UI 또는 문서에 포함.

## 참고 근거

- 기존 감사 메모: `docs/DATA_LICENSE_AUDIT.md`
- 법제처 국가법령정보 공동활용: https://open.law.go.kr/LSO/information/guide.do
- U.S. Copyright Office, 17 U.S.C. 105: https://www.copyright.gov/title17/92chap1.html
- GAO Copyright & Terms of Use: https://www.gao.gov/copyright
- Creative Commons BY-NC 4.0: https://creativecommons.org/licenses/by-nc/4.0/
- 공공누리 제4유형: https://www.kogl.or.kr/info/licenseType4.do
