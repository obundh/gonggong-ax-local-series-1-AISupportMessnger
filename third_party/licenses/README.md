# Bundled STT licenses

The Windows installer bundles the following unmodified, checksum-pinned components:

- whisper.cpp `v1.9.2` Windows x64 CPU runtime files: `whisper.cpp-v1.9.2-MIT.txt`
- OpenAI Whisper `large-v3-turbo` weights converted and quantized as `ggml-large-v3-turbo-q5_0.bin`: `OpenAI-Whisper-MIT.txt`
- Silero VAD `v6.2.0` weights converted as `ggml-silero-v6.2.0.bin`: `Silero-VAD-v6.2-MIT.txt`

The lighter `small-q5_1` model is not bundled. It can be installed only from a user-selected local file whose exact size and SHA-256 match the pinned catalog; the release application does not download it. Exact source revisions, sizes, and SHA-256 values are recorded in `app/main/stt-catalog.cjs` and `docs/STT_SETUP.md`.
