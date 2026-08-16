# Whisper Runtime Boundary

whisper.cpp 바이너리는 일반 Git에 커밋하지 않습니다. `npm run build`가 공식 Windows x64 CPU ZIP을 검증해 필요한 실행파일과 DLL만 `vendor/stt-bundle`에 준비하고 Windows 설치파일에 포함합니다.

- Upstream: <https://github.com/ggml-org/whisper.cpp>
- Reviewed release: `v1.9.2`
- Archive SHA-256: `49dcc16de826f20bd53d44f947a1ae49dfa81f86cad67a64d80820cb192d674a`
- License: MIT

빌드 준비 다운로드·압축 해제·개별 실행파일 검증 기준은 `app/main/stt-catalog.cjs`, `app/main/stt-runtime-manager.cjs`, `app/main/bundled-stt-assets.cjs`에 있습니다. 배포 앱의 STT 네트워크 설치는 비활성화되고 검토된 로컬 파일만 설치할 수 있습니다. 이 폴더에 개인 PC의 실행파일이나 DLL을 커밋하지 마세요.
