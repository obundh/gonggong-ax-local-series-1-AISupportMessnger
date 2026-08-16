# Whisper Model Boundary

이 Git 폴더에는 모델 가중치를 커밋하지 않습니다. 빌드가 `large-v3-turbo-q5_0`과 VAD를 검증된 빌드 캐시에 준비해 Windows 설치파일에 포함합니다. `small-q5_1` 등 다른 모델은 배포 앱에서 내려받지 않고 사용자가 선택한 카탈로그 일치 로컬 파일만 앱 데이터 폴더에 설치합니다.

- 기본 포함·기본 선택: `ggml-large-v3-turbo-q5_0.bin` 약 574MB · 한국어 회의 권장
- 선택 로컬 파일 설치: `ggml-small-q5_1.bin` 약 190MB · Lite·저사양·영어 음성 권장
- 기본 포함: `ggml-silero-v6.2.0.bin` 약 0.9MB
- Whisper upstream/license: <https://github.com/openai/whisper>, MIT
- whisper.cpp model repository: <https://huggingface.co/ggerganov/whisper.cpp>
- Silero VAD upstream/license: <https://github.com/snakers4/silero-vad>, MIT

정확한 커밋, 크기와 SHA-256은 `docs/STT_SETUP.md`를 확인하세요. `.bin`, `.gguf`, `.onnx` 파일은 일반 Git에 커밋하지 않고 무시된 `vendor/stt-bundle` 빌드 캐시로만 준비합니다.
