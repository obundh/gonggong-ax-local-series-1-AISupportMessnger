# Heyu DGX Spark source scripts

이 공개 소스 배포본에는 DGX Spark용 설치·실행 스크립트만 포함됩니다. 오프라인 설치에 필요한 다음 페이로드는 개인정보·용량·재배포 권리 문제 때문에 포함하지 않습니다.

```text
offline/node/
offline/npm/
```

따라서 `HEYU_SPARK_ONE_CLICK_INSTALL.sh`는 이 저장소를 그대로 실행하면 누락 오류로 중단되는 것이 정상입니다. 직접 오프라인 패키지를 만들 때는 Linux ARM64용 Node.js, Electron, sharp 런타임의 출처·버전·해시·라이선스를 기록하고 `offline/`에 준비해야 합니다.

Ollama와 사용할 Gemma 모델도 DGX에 별도로 설치되어 있어야 합니다. Spark별 모델 매핑은 Git에서 제외되는 `tools/dgx-spark/spark.env`에 저장하며, 예시는 `tools/dgx-spark/spark.env.example`을 사용합니다.

런타임 페이로드를 준비한 뒤의 실행 명령:

```bash
bash HEYU_SPARK_ONE_CLICK_INSTALL.sh
bash HEYU_SPARK_START_31B.sh
bash HEYU_SPARK_START_26B.sh
bash HEYU_SPARK_MAP_MODEL.sh
```

모델은 파일 경로가 아니라 Ollama 태그로 연결됩니다. 기관 배포 전에는 실제 DGX에서 설치, 모델 탐지, 앱 실행, 선택 기능, 로그와 라이선스 포함 여부를 다시 검증해야 합니다.
