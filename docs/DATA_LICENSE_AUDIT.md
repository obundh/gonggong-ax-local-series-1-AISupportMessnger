# 데이터/라이선스 점검 메모

작성일: 2026-04-26

2026-08-14 공개본 메모: 현재 공개 소스본은 `data/README.md` 외의 실제 데이터와 생성 인덱스를 모두 제외한다. 아래 내용은 원본 개발 트리에 데이터가 있던 시점의 역사적 감사 기록이다.

이 문서는 법률 자문이 아니라 개발/배포 판단을 위한 기술 점검 메모다. 결론부터 말하면, 코드 쪽 위험은 많이 줄었고 남은 핵심은 `data/emp*` 원본 PDF와 그 파생 산출물이다.

## 2026-04 당시 결론

- 외부 배포판에는 `data/emp_docs`, `data/emp`, `data/emp_blocks`, `data/emp_assets`, `data/emp_kr`, `data/emp_kr_pdfs`, `data/emp_kr_test`, `data/emp_pdf_translation`을 넣지 않는 쪽이 안전하다.
- 개발/시연용은 자체 생성한 `data/safe*`만 쓰면 된다.
- 내부망/기관 내부용은 기관이 이미 보유한 정식 원문/번역본을 별도 폴더에 두고 다시 파싱하는 방식이 맞다.
- 법령/판례 데이터(`data/law`, `data/precedent`, `data/precedent_body`, `data/legal_refs`)는 법제처 API 기반이라 상대적으로 낮은 위험이지만, 출처/갱신일/이용조건 메타데이터는 반드시 유지해야 한다.
- 예전 외부 번역 산출물 흔적인 `data/emp_pdf_translation/translation-cache.google.json`은 배포 제외 또는 삭제 후보다.

## 현재 데이터 묶음

| 경로 | 파일 수 | 용량 | 판단 |
| --- | ---: | ---: | --- |
| `data/emp_docs` | 33 | 44.72 MB | EMP 원본 PDF. 라이선스별로 갈림. 외부 배포 제외 권장 |
| `data/emp` | 36 | 14.03 MB | 원본 PDF에서 만든 텍스트 JSON. 원본 권리 영향 받음 |
| `data/emp_blocks` | 35 | 21.38 MB | 구조화 JSON. 원본 권리 영향 받음 |
| `data/emp_assets` | 650 | 91.71 MB | 표/그림/페이지 이미지. 가장 보수적으로 제외 |
| `data/emp_kr` | 35 | 13.60 MB | 번역/가공 JSON. 2차적 저작물 이슈 가능 |
| `data/emp_kr_pdfs` | 33 | 7.10 MB | 번역 PDF. 2차적 저작물 이슈 가능 |
| `data/emp_pdf_translation` | 7 | 3.49 MB | 번역 캐시/로그. 예전 외부 번역 캐시 포함 |
| `data/law` | 5,586 | 1.12 GB | 법제처 법령 API 산출물. 출처/갱신일 유지 |
| `data/precedent*` | 2,057 | 57.33 MB | 판례 API 산출물. 출처/갱신일 유지 |
| `data/legal_refs` | 3,154 | 160.69 MB | 행정심판례 등 법률 참조 데이터. 출처/갱신일 유지 |
| `data/safe*` | 13 | 0.08 MB | 자체 제작 샘플. 개발/외부 시연용으로 사용 가능 |

## 다시 파싱해야 하는 것

### 1순위: 내부 정식 자료로 다시 파싱

다음 자료들은 외부 배포나 번역/구조화 산출물 배포에 특히 조심해야 한다. 내부에 정식 보유본이나 정식 번역본이 있으면 그걸 원본으로 다시 파싱하는 편이 낫다.

| 분류 | 해당 파일 | 이유 | 조치 |
| --- | --- | --- | --- |
| ITU-T | `ITU-T_K115_*`, `ITU-T_K78_*`, `ITU-T_K81_*`, `ITU-T_K87_*`, `ITU-T_K_Supplement_6_*` | ITU는 문서별 조건이 있고, 외부 조직 배포/판매용 중복·번역에 제한이 있음 | 외부 배포 제외. 내부 정식 권한본/번역본으로 재파싱 |
| EPRI/EEI | `EEI_EPRI_EMP_Report_Key_Messages_2019.pdf`, `DOE_EPRI_Joint_EMP_Resilience_Strategy_2016.pdf`, `DOE_CESER_HEMP_Waveform_Application_Guide_2023.pdf` | EPRI 저작권/허가 흐름이 별도로 있음. DOE 후원 문서라도 EPRI 작성·공동 저작이면 보수적으로 봐야 함 | 내부 사용권 확인 후 재파싱 |
| NERC | `NERC_EMP_Task_Force_Strategic_Recommendations_2019.pdf`, `DOE_NERC_High_Impact_Low_Frequency_Event_Risk_2010.pdf` | NERC 자료는 웹 접근이 곧 라이선스 양도는 아님 | 외부 배포 제외. 내부 권한 확인 |
| KOGL 4유형 | `ETRI_Unshielded_Facility_Testbed_EM_Wave_2025.pdf` | 공공누리 제4유형은 출처표시 + 비영리 + 변경금지. 번역/구조화 배포는 변경·2차저작물 이슈 가능 | 정식 내부 번역본 사용 또는 제외 |
| CC BY-NC | `KPFI_EMP_Civil_Multilayer_Protection_Framework_2025.pdf` | CC BY-NC는 비영리 조건. 상용/외부 배포 앱에 넣기 애매함 | 내부 테스트만. 외부 배포 제외 |
| 사설/연구기관 | `IST_EMP_Effects_on_Communication_Infrastructure_2024.pdf`, `NIDS_HEMP_Commentary_2019.pdf`, `KNS_Technical_Standards_EMP_Effects_2017.pdf` | 원문 내 자유 이용 범위가 교육/인용 중심이거나 불명확 | 원문 조건 재확인 후 파싱 |

### 2순위: 텍스트만 재파싱하면 되는 것

미국 정부 문서는 상대적으로 위험이 낮지만, 그림/사진/도표에는 제3자 권리가 섞일 수 있다. 외부 배포용으로 쓰려면 텍스트와 메타데이터만 다시 뽑고 `data/emp_assets`의 페이지 이미지/그림은 빼는 편이 좋다.

| 분류 | 해당 파일 | 조치 |
| --- | --- | --- |
| GAO | `GAO_*` | 텍스트 중심 재파싱. 이미지/제3자 자료 분리 |
| CRS | `CRS_HEMP_High_Power_Microwave_Threat_Assessments_2008.pdf` | 텍스트 중심 재파싱. 제3자 이미지 주의 |
| DOE/White House | `DOE_*`, `WhiteHouse_*` | DOE/정부 작성분은 낮은 위험. 단, 외부 기여 이미지/도표는 분리 |
| CISA/NCC | `CISA_NCC_EMP_Protection_Resilience_Guidelines_2019_v2_2.pdf` | 공공 안내자료로 보이나 제3자 참조/상표/로고 분리 |
| MIL-STD 공개본 | `MIL_STD_188_125_1_Base_1998_Public.pdf`, `MIL_STD_188_125_2_Base_1999_Public.pdf`, `MIL_STD_464C_2010_Public.pdf` | ASSIST 공식 최신본/배포문구 확인 후 재파싱. 공개본이라도 최신성 표시 필요 |
| Air University/INL | `Air_University_*`, `INL_E1_EMP_Mitigation_Strategies_2015.pdf` | 정부/국립연구소 계열로 보이나 저자/계약/제3자 표기 확인 |

### 3순위: 그대로 두되 배포에서 제외

개발 중 참고용으로는 현재 폴더를 유지할 수 있다. 다만 실행파일에 넣는 순간 산출물 배포가 되므로, 패키징 설정에서 `data/emp*`는 제외하는 게 맞다.

## 법령/판례 데이터 판단

법제처 공동활용 안내는 법령정보가 공공데이터 정책에 따라 개방되어 있고 영리 목적 포함 자유 활용이 보장된다고 안내한다. 공공데이터포털의 법제처 국가법령정보 공유서비스도 공공저작물 제1유형 출처표시 및 제3자 권리 포함 표시가 붙어 있다.

따라서 `data/law`, `data/precedent`, `data/precedent_body`, `data/legal_refs`는 재파싱보다는 다음 보강이 필요하다.

- 각 JSON에 `source`, `retrievedAt`, `apiName`, `licenseNote` 유지
- API 키/OC 값은 저장 금지
- 앱 답변에는 법령명, 조문, 시행일, 판례번호, 선고일을 같이 표시
- 폐쇄망 반입 시 최종 동기화 날짜를 별도 manifest에 기록

## 도구/코드 라이선스 상태

### Node 의존성

현재 `package-lock.json` 기준으로 대부분 MIT/ISC/Apache/BSD 계열이다. `png-js`만 lockfile에 license 필드가 비어 있었지만, 실제 패키지의 `LICENSE` 파일은 MIT다.

검사 결과:

- `npm audit --audit-level=low`: 취약점 0개
- 직접 의존성: `lucide`, `electron`, `electron-builder`, `pdf-parse`, `pdfkit`
- GPL/AGPL 계열 직접 의존성은 발견하지 못함

### PDF 파서

기존 AGPL 우려가 있던 PyMuPDF 계열은 현재 사용하지 않는다. `tools/pdftojson-verify/vendor` 기준 주요 파서는 다음과 같다.

- `pdfplumber`: MIT
- `pdfminer.six`: MIT
- `pypdfium2`: Apache-2.0 또는 BSD-3-Clause + PDFium 제3자 고지
- `Pillow`: MIT-CMU

즉, 파서 자체 때문에 다시 파싱해야 하는 상황은 아니다. 다시 파싱이 필요한 이유는 파서가 아니라 원본 PDF와 파생 산출물의 권리 문제다.

## 정리할 파일

삭제 또는 배포 제외 후보:

- `data/emp_pdf_translation/translation-cache.google.json`
- `data/emp_pdf_translation/build-kr-pdfs.log`
- `data/emp_pdf_translation/build-kr-pdfs.pid`
- `data/emp_pdf_translation/build-kr-pdfs.err.log`

유지 후보:

- `data/emp_pdf_translation/manifest.json`
- `data/emp_pdf_translation/translation-list.csv`
- `data/emp_pdf_translation/README.md`

## 권장 운용

### 개발/외부 시연

```powershell
npm run safe:docs
npm run safe:layout
npm run start:safe
```

이 모드는 자체 제작 샘플만 읽게 되어 있어서 저작권 리스크가 가장 낮다.

### 내부망/실사용

1. 내부에서 이미 보유한 정식 표준/번역본 PDF를 별도 폴더에 둔다.
2. `data/emp_docs` 원본 대신 내부 권한본을 파싱한다.
3. 가능하면 번역본 PDF를 먼저 쓰고, 번역이 없는 문서만 로컬 LLM 번역을 표시·경고와 함께 사용한다.
4. 표/그림은 외부 배포하지 않고 내부 검색 근거용으로만 둔다.

### 외부 배포

1. 앱 코드와 자체 샘플만 포함한다.
2. `data/emp*` 실자료와 파생물은 제외한다.
3. 사용자가 자기 기관의 자료 폴더를 지정해서 직접 파싱하게 만든다.

## 확인한 공식/준공식 근거

- 법제처 국가법령정보 공동활용 저작권 정책: https://open.law.go.kr/LSO/information/guide.do
- 공공데이터포털 법제처 국가법령정보 공유서비스: https://www.data.go.kr/data/15000115/openapi.do
- 공공누리 제4유형: https://www.kogl.or.kr/info/licenseType4.do
- U.S. Copyright Office, 17 U.S.C. 105: https://www.copyright.gov/title17/92chap1.html
- GAO Copyright & Terms of Use: https://www.gao.gov/copyright
- Congress.gov CRS Products FAQ: https://www.congress.gov/help/crs-products
- DOE Web Policies: https://www.energy.gov/web-policies
- ITU translation procedure for Recommendations: https://www.itu.int/en/publications/SiteAssets/Res%20168%20procedure-FINAL.pdf
- ITU Copyright Notice: https://www.itu.int/itudoc/about/copyrght.htm
- EPRI Copyright Request page: https://copyright.epri.com/
- NERC Legal and Privacy: https://www.nerc.com/AboutNERC/Legal/Documents/LegalAndPrivacy.pdf
- Defense Standardization Program / ASSIST access guidance: https://www.dsp.dla.mil/Specs-Standards/Access-DSP-Documents/
- ASSIST distribution statement guidance: https://assist.dla.mil/Online/help/dist_stmt.cfm
- Creative Commons BY-NC 4.0: https://creativecommons.org/licenses/by-nc/4.0/
- IST EMP primer PDF notice: https://securityandtechnology.org/wp-content/uploads/2024/01/Effects-of-Electromagnetic-Pulses-on-Communication-Infrastructure.pdf
