# DGX Spark helper scripts

이 폴더는 Heyu를 DGX Spark에서 실행하기 위한 설치·시작 스크립트와 설정 예시만 제공합니다. 공개 저장소에는 `offline/` Node/Electron/Linux ARM64 의존성 묶음과 모델 가중치가 포함되지 않습니다.

`install-and-run.sh`는 완전한 오프라인 묶음에서만 사용하세요. `spark.env.example`을 `spark.env`로 복사해 로컬 Ollama 모델 태그를 설정할 수 있으며, 실제 `spark.env`는 Git에서 제외됩니다.

```bash
cp tools/dgx-spark/spark.env.example tools/dgx-spark/spark.env
bash HEYU_SPARK_ONE_CLICK_INSTALL.sh
```

누락된 오프라인 페이로드가 있으면 설치기가 중단되는 것이 정상입니다.
