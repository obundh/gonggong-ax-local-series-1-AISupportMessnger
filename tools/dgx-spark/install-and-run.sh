#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
OFFLINE_DIR="$APP_DIR/offline"
RUNTIME_DIR="$APP_DIR/.runtime"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"

MODEL_SIZE=31b
RUN_AFTER_INSTALL=1
SKIP_COMFY=0
SKIP_WHISPER=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --model)
      MODEL_SIZE="${2:-31b}"
      shift 2
      ;;
    --model=*)
      MODEL_SIZE="${1#--model=}"
      shift
      ;;
    --no-run)
      RUN_AFTER_INSTALL=0
      shift
      ;;
    --skip-comfy)
      SKIP_COMFY=1
      shift
      ;;
    --skip-whisper)
      SKIP_WHISPER=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

exec > >(tee -a "$LOG_FILE") 2>&1

echo "Heyu DGX Spark offline installer"
echo "App:     $APP_DIR"
echo "Offline: $OFFLINE_DIR"
echo "Log:     $LOG_FILE"

if [ "$(uname -s)" != "Linux" ]; then
  echo "This offline installer is for DGX Spark Linux. Copy this folder to the DGX Spark and run it there."
  exit 1
fi

ARCH="$(uname -m)"
case "$ARCH" in
  aarch64|arm64) ;;
  *)
    echo "Warning: this package was prepared for Linux ARM64/aarch64, but this machine reports '$ARCH'."
    ;;
esac

sudo_cmd() {
  if [ "${EUID:-$(id -u)}" -eq 0 ]; then
    "$@"
  else
    sudo "$@"
  fi
}

have_cmd() {
  command -v "$1" >/dev/null 2>&1
}

ollama_base_url() {
  printf "%s\n" "${HEYU_LLM_BASE_URL:-http://127.0.0.1:11434}"
}

ollama_http_ready() {
  local base_url
  base_url="$(ollama_base_url)"
  if have_cmd curl && curl -fsS "${base_url%/}/api/tags" >/dev/null 2>&1; then
    return 0
  fi
  if have_cmd python3; then
    OLLAMA_BASE_URL="$base_url" python3 - <<'PY' >/dev/null 2>&1
import os
import urllib.request
base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
urllib.request.urlopen(base + "/api/tags", timeout=5).read()
PY
  fi
}

ollama_model_names() {
  local base_url
  if have_cmd ollama && ollama list >/dev/null 2>&1; then
    ollama list 2>/dev/null | awk 'NR > 1 { print $1 }'
    return
  fi
  base_url="$(ollama_base_url)"
  if have_cmd python3; then
    OLLAMA_BASE_URL="$base_url" python3 - <<'PY' 2>/dev/null || true
import json
import os
import urllib.request
base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
data = json.load(urllib.request.urlopen(base + "/api/tags", timeout=5))
for model in data.get("models", []):
    name = model.get("name") or model.get("model")
    if name:
        print(name)
PY
  fi
}

print_ollama_models() {
  if have_cmd ollama && ollama list >/dev/null 2>&1; then
    ollama list || true
    return
  fi
  local names
  names="$(ollama_model_names)"
  if [ -n "$names" ]; then
    echo "NAME"
    printf "%s\n" "$names"
  else
    echo "Could not read Ollama models through CLI or HTTP API."
  fi
}

require_cmd() {
  if ! have_cmd "$1"; then
    echo "Missing required command: $1"
    return 1
  fi
}

safe_remove_node_modules() {
  local target="$APP_DIR/node_modules"
  local resolved_app resolved_target
  resolved_app="$(cd "$APP_DIR" && pwd -P)"
  if [ -e "$target" ]; then
    resolved_target="$(cd "$(dirname "$target")" && pwd -P)/$(basename "$target")"
    case "$resolved_target" in
      "$resolved_app"/node_modules) rm -rf "$resolved_target" ;;
      *)
        echo "Refusing to remove unexpected node_modules path: $resolved_target"
        exit 1
        ;;
    esac
  fi
}

check_offline_assets() {
  require_cmd tar || exit 1

  if [ ! -d "$OFFLINE_DIR" ]; then
    echo "Missing offline assets directory: $OFFLINE_DIR"
    echo "Re-copy the full heyu-dgx-spark offline package."
    exit 1
  fi

  if ! find "$OFFLINE_DIR/npm" -maxdepth 1 -name 'node_modules-linux-arm64.tar.gz' -print -quit 2>/dev/null | grep -q .; then
    echo "Missing offline npm bundle: $OFFLINE_DIR/npm/node_modules-linux-arm64.tar.gz"
    exit 1
  fi
}

check_system_packages() {
  echo "Checking local system tools; no network package install will be attempted."

  local missing_optional=()
  have_cmd python3 || missing_optional+=(python3)
  have_cmd ffmpeg || missing_optional+=(ffmpeg)
  have_cmd cmake || missing_optional+=(cmake)
  have_cmd make || missing_optional+=(make)
  have_cmd g++ || missing_optional+=(g++)

  if [ "${#missing_optional[@]}" -gt 0 ]; then
    echo "Optional local tools not found: ${missing_optional[*]}"
    echo "Core Heyu + Ollama can still run; optional STT/image/routine setup may be skipped."
  fi
}

activate_node() {
  local node_archive node_root extracted
  node_root="$RUNTIME_DIR/node"
  mkdir -p "$node_root"

  node_archive="$(find "$OFFLINE_DIR/node" -maxdepth 1 -name 'node-v*-linux-arm64.tar.xz' 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$node_archive" ]; then
    extracted="$node_root/$(basename "$node_archive" .tar.xz)"
    if [ ! -x "$extracted/bin/node" ]; then
      echo "Extracting bundled Node.js: $(basename "$node_archive")"
      tar -xJf "$node_archive" -C "$node_root"
    fi
    ln -sfn "$extracted" "$node_root/current" 2>/dev/null || true
    export PATH="$extracted/bin:$PATH"
  fi

  local major=0
  if have_cmd node; then
    major="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  fi
  if [ "$major" -ge 20 ]; then
    echo "Node.js $(node -v) is ready."
    return 0
  fi

  echo "Node.js 20+ was not found, and no bundled Linux ARM64 Node archive could be activated."
  exit 1
}

repair_node_permissions() {
  [ -d "$APP_DIR/node_modules" ] || return 0
  find "$APP_DIR/node_modules/.bin" -maxdepth 1 -type f -exec chmod +x {} + 2>/dev/null || true
  chmod +x "$APP_DIR/node_modules/electron/dist/electron" 2>/dev/null || true
  chmod +x "$APP_DIR/node_modules/electron/dist/chrome-sandbox" 2>/dev/null || true
  chmod +x "$APP_DIR/node_modules/electron/dist/chrome_crashpad_handler" 2>/dev/null || true
}

node_modules_ready() {
  [ -x "$APP_DIR/node_modules/.bin/electron" ] || return 1
  [ -f "$APP_DIR/node_modules/electron/path.txt" ] || return 1
  [ -x "$APP_DIR/node_modules/electron/dist/electron" ] || return 1
  [ -d "$APP_DIR/node_modules/@img/sharp-linux-arm64" ] || return 1
}

install_node_modules() {
  repair_node_permissions
  if node_modules_ready; then
    echo "Linux ARM64 Node/Electron dependencies are ready."
    return 0
  fi

  local archive
  archive="$(find "$OFFLINE_DIR/npm" -maxdepth 1 -name 'node_modules-linux-arm64.tar.gz' 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -z "$archive" ]; then
    echo "Missing offline npm bundle in $OFFLINE_DIR/npm"
    exit 1
  fi

  echo "Extracting offline Node/Electron dependencies: $(basename "$archive")"
  safe_remove_node_modules
  tar -xzf "$archive" -C "$APP_DIR"
  repair_node_permissions

  if ! node_modules_ready; then
    echo "Offline node_modules extraction finished, but Linux ARM64 Electron/sharp assets are still not valid."
    exit 1
  fi
}

install_ollama() {
  if ollama_http_ready; then
    if have_cmd ollama; then
      echo "Ollama is ready: CLI $(command -v ollama), HTTP $(ollama_base_url)"
    else
      echo "Ollama HTTP API is ready at $(ollama_base_url). CLI is not on PATH, but Heyu can use the API."
    fi
    echo "Installed Ollama models:"
    print_ollama_models
    return 0
  elif have_cmd ollama; then
    echo "Ollama CLI is ready: $(command -v ollama)"
  else
    echo "Ollama was not reachable through CLI or HTTP API at $(ollama_base_url)."
    echo "Open http://127.0.0.1:11434/api/tags on the DGX. If it opens, rerun with HEYU_LLM_BASE_URL set to that URL host."
    exit 1
  fi

  if ! ollama list >/dev/null 2>&1; then
    echo "Ollama command exists, but the local service did not answer. Trying 'ollama serve' in the background."
    nohup ollama serve >"$LOG_DIR/ollama.out.log" 2>"$LOG_DIR/ollama.err.log" &
    sleep 3
  fi

  echo "Installed Ollama models:"
  print_ollama_models
}

write_spark_env() {
  local env_file="$SCRIPT_DIR/spark.env"
  if [ ! -f "$env_file" ]; then
    cp "$SCRIPT_DIR/spark.env.example" "$env_file"
  fi
  if grep -q '^HEYU_SPARK_MODEL_SIZE=' "$env_file"; then
    sed -i "s/^HEYU_SPARK_MODEL_SIZE=.*/HEYU_SPARK_MODEL_SIZE=$MODEL_SIZE/" "$env_file"
  else
    printf "\nHEYU_SPARK_MODEL_SIZE=%s\n" "$MODEL_SIZE" >> "$env_file"
  fi
}

python_venv_available() {
  have_cmd python3 || return 1
  python3 -m venv --help >/dev/null 2>&1
}

install_from_wheelhouse() {
  local venv="$1"
  local wheelhouse="$2"
  shift 2

  if [ ! -d "$wheelhouse" ] || ! find "$wheelhouse" -maxdepth 1 -type f -print -quit | grep -q .; then
    echo "Offline Python wheelhouse not found or empty: $wheelhouse"
    return 1
  fi
  if ! python_venv_available; then
    echo "python3 venv is not available; skipping Python optional setup for $venv"
    return 1
  fi

  python3 -m venv "$venv"
  "$venv/bin/python" -m pip install --no-index --find-links "$wheelhouse" --upgrade pip setuptools wheel >/dev/null 2>&1 || true
  "$venv/bin/python" -m pip install --no-index --find-links "$wheelhouse" "$@"
}

install_markitdown() {
  echo "Preparing MarkItDown MCP tools from offline wheelhouse..."
  local venv="$SCRIPT_DIR/.venv-tools"
  local wheelhouse="$OFFLINE_DIR/python-wheels/markitdown"

  if ! install_from_wheelhouse "$venv" "$wheelhouse" markitdown-mcp; then
    echo "MarkItDown MCP was skipped. Heyu will use its built-in/local document fallbacks where available."
  fi
}

install_routine_tools() {
  echo "Preparing routine automation Python tools from offline wheelhouse..."
  local venv="$SCRIPT_DIR/.venv-routine"
  local wheelhouse="$OFFLINE_DIR/python-wheels/routine"

  if ! install_from_wheelhouse "$venv" "$wheelhouse" -r "$APP_DIR/tools/routine-recorder/requirements.txt"; then
    echo "Routine automation dependencies were skipped. Other Heyu features are not blocked."
  fi
}

install_whisper_cpp() {
  [ "$SKIP_WHISPER" = "0" ] || return 0
  local target_dir="$APP_DIR/tools/whisper"
  local src_dir="$target_dir/whisper.cpp"
  local build_dir="$src_dir/build"
  local source_archive="$OFFLINE_DIR/source/whisper.cpp-master.tar.gz"
  mkdir -p "$target_dir"

  if [ -x "$target_dir/whisper-cli" ]; then
    echo "whisper.cpp runtime is ready."
    return 0
  fi

  if ! have_cmd cmake || ! have_cmd make; then
    echo "cmake/make not found; skipping offline whisper.cpp build."
    return 0
  fi

  if [ ! -f "$source_archive" ]; then
    echo "Offline whisper.cpp source archive not found: $source_archive"
    return 0
  fi

  echo "Building whisper.cpp from bundled source..."
  rm -rf "$src_dir"
  tar -xzf "$source_archive" -C "$target_dir"
  local extracted
  extracted="$(find "$target_dir" -maxdepth 1 -type d -name 'whisper.cpp-*' | head -n 1 || true)"
  if [ -n "$extracted" ]; then
    mv "$extracted" "$src_dir"
  else
    echo "Could not find extracted whisper.cpp source directory."
    return 0
  fi

  local cuda_flag=()
  if have_cmd nvcc || [ -d /usr/local/cuda ]; then
    cuda_flag=(-DGGML_CUDA=ON)
  fi

  if ! cmake -S "$src_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release "${cuda_flag[@]}"; then
    echo "CUDA whisper.cpp configure failed; retrying CPU build."
    cmake -S "$src_dir" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release || return 0
  fi
  cmake --build "$build_dir" --config Release -j"$(nproc)" || return 0

  local bin
  bin="$(find "$build_dir" -type f -name whisper-cli -perm -111 | head -n 1 || true)"
  if [ -n "$bin" ]; then
    ln -sf "$bin" "$target_dir/whisper-cli"
  else
    echo "whisper-cli was not found after build."
  fi
}

install_comfyui() {
  [ "$SKIP_COMFY" = "0" ] || return 0
  local runtime_dir="$APP_DIR/tools/image-runtime"
  local comfy_dir="$runtime_dir/ComfyUI"
  local offline_comfy="$OFFLINE_DIR/source/ComfyUI"
  local venv="$runtime_dir/.venv"
  mkdir -p "$runtime_dir"

  if [ ! -d "$comfy_dir" ] && [ -d "$offline_comfy" ]; then
    echo "Copying bundled ComfyUI source..."
    cp -a "$offline_comfy" "$comfy_dir"
  fi

  if [ ! -d "$comfy_dir" ]; then
    echo "ComfyUI source is not bundled; image generation can still use an external HEYU_COMFYUI_URL."
    return 0
  fi

  if ! python_venv_available; then
    echo "python3 venv is not available; skipping ComfyUI venv setup."
    return 0
  fi

  local venv_args=(--system-site-packages)
  if [ ! -x "$venv/bin/python" ]; then
    python3 -m venv "${venv_args[@]}" "$venv"
  fi

  if "$venv/bin/python" - <<'PY' >/dev/null 2>&1
import torch
raise SystemExit(0 if torch.cuda.is_available() else 1)
PY
  then
    echo "ComfyUI will use the DGX system PyTorch stack."
  else
    echo "PyTorch CUDA was not found in the DGX Python environment."
    echo "This offline package will not download PyTorch; use an existing ComfyUI/HEYU_COMFYUI_URL or preinstall the DGX PyTorch stack."
    return 0
  fi

  local wheelhouse="$OFFLINE_DIR/python-wheels/comfyui"
  if [ -d "$wheelhouse" ] && find "$wheelhouse" -maxdepth 1 -type f -print -quit | grep -q .; then
    "$venv/bin/python" -m pip install --no-index --find-links "$wheelhouse" -r "$comfy_dir/requirements.txt" || {
      echo "ComfyUI offline dependency installation failed. Image generation can still use HEYU_COMFYUI_URL."
    }
  else
    echo "No ComfyUI Python wheelhouse bundled; leaving ComfyUI source in place and relying on DGX system packages/external ComfyUI."
  fi
}

create_desktop_launchers() {
  local desktop_dir="$HOME/Desktop"
  [ -d "$desktop_dir" ] || return 0
  local launcher31="$desktop_dir/Heyu Spark 31B.desktop"
  local launcher26="$desktop_dir/Heyu Spark 26B.desktop"
  cat > "$launcher31" <<EOF
[Desktop Entry]
Type=Application
Name=Heyu Spark 31B
Terminal=true
Exec=/bin/bash -lc '"$APP_DIR/tools/dgx-spark/start-heyu-spark.sh" --model 31b'
Path=$APP_DIR
EOF
  cat > "$launcher26" <<EOF
[Desktop Entry]
Type=Application
Name=Heyu Spark 26B
Terminal=true
Exec=/bin/bash -lc '"$APP_DIR/tools/dgx-spark/start-heyu-spark.sh" --model 26b'
Path=$APP_DIR
EOF
  chmod +x "$launcher31" "$launcher26" || true
}

verify_model_hint() {
  [ "${HEYU_LLM_PROVIDER:-ollama}" = "ollama" ] || return 0
  local size="$MODEL_SIZE"
  if ! ollama_model_names | tr '[:upper:]' '[:lower:]' | grep -q "$size"; then
    echo "Warning: no Ollama model tag containing '$size' was found."
    echo "The launcher can map to another installed Gemma tag, or edit $SCRIPT_DIR/spark.env."
  fi
}

check_offline_assets
check_system_packages
activate_node
install_node_modules
install_ollama
write_spark_env
install_markitdown
install_routine_tools
install_whisper_cpp
install_comfyui
create_desktop_launchers
verify_model_hint

echo "Heyu DGX Spark offline installation finished."

if [ "$RUN_AFTER_INSTALL" = "1" ]; then
  exec "$SCRIPT_DIR/start-heyu-spark.sh" --model "$MODEL_SIZE"
fi
