#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
ENV_FILE="${HEYU_SPARK_ENV:-$SCRIPT_DIR/spark.env}"
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

activate_bundled_node() {
  local node_root="$APP_DIR/.runtime/node/current"
  if [ -x "$node_root/bin/node" ]; then
    export PATH="$node_root/bin:$PATH"
    return 0
  fi
  local node_dir
  node_dir="$(find "$APP_DIR/.runtime/node" -maxdepth 1 -type d -name 'node-v*-linux-arm64' 2>/dev/null | sort -V | tail -n 1 || true)"
  if [ -n "$node_dir" ] && [ -x "$node_dir/bin/node" ]; then
    export PATH="$node_dir/bin:$PATH"
  fi
}

repair_node_permissions() {
  [ -d "$APP_DIR/node_modules" ] || return 0
  find "$APP_DIR/node_modules/.bin" -maxdepth 1 -type f -exec chmod +x {} + 2>/dev/null || true
  chmod +x "$APP_DIR/node_modules/electron/dist/electron" 2>/dev/null || true
  chmod +x "$APP_DIR/node_modules/electron/dist/chrome-sandbox" 2>/dev/null || true
  chmod +x "$APP_DIR/node_modules/electron/dist/chrome_crashpad_handler" 2>/dev/null || true
}

node_modules_ready() {
  repair_node_permissions
  [ -x "$APP_DIR/node_modules/.bin/electron" ] || return 1
  [ -x "$APP_DIR/node_modules/electron/dist/electron" ] || return 1
  [ -d "$APP_DIR/node_modules/@img/sharp-linux-arm64" ] || return 1
}

if [ ! -f "$ENV_FILE" ]; then
  cp "$SCRIPT_DIR/spark.env.example" "$ENV_FILE"
fi

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

MODEL_SIZE="${HEYU_SPARK_MODEL_SIZE:-31b}"
CHOOSE_MODEL=0
CONFIGURE_ONLY=0

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
    --choose)
      CHOOSE_MODEL=1
      shift
      ;;
    --configure-only)
      CONFIGURE_ONLY=1
      shift
      ;;
    *)
      shift
      ;;
  esac
done

choose_model() {
  if command -v zenity >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    zenity --list --title="Heyu DGX Spark" --text="Choose a Gemma model profile" \
      --column="Profile" 31b 26b 2>/dev/null || true
    return
  fi
  printf "Choose model profile [31b/26b] (default: 31b): "
  read -r answer || true
  printf "%s\n" "${answer:-31b}"
}

if [ "$CHOOSE_MODEL" = "1" ]; then
  MODEL_SIZE="$(choose_model)"
fi

case "$(printf "%s" "$MODEL_SIZE" | tr '[:upper:]' '[:lower:]')" in
  26|26b) MODEL_SIZE=26b ;;
  31|31b|"") MODEL_SIZE=31b ;;
  *)
    echo "Unknown model profile: $MODEL_SIZE"
    echo "Use --model 31b or --model 26b."
    exit 2
    ;;
esac

env_value() {
  printenv "$1" 2>/dev/null || true
}

write_env_value() {
  local key="$1"
  local value="$2"
  [ -n "$key" ] || return 0
  [ -n "$value" ] || return 0
  mkdir -p "$(dirname "$ENV_FILE")"
  touch "$ENV_FILE"
  if grep -q "^$key=" "$ENV_FILE"; then
    sed -i "s|^$key=.*|$key=$value|" "$ENV_FILE"
  else
    printf "\n%s=%s\n" "$key" "$value" >> "$ENV_FILE"
  fi
}

configured_model() {
  if [ "$MODEL_SIZE" = "26b" ]; then
    env_value HEYU_LLM_MODEL_26B
  else
    env_value HEYU_LLM_MODEL_31B
  fi
}

model_env_key() {
  if [ "$MODEL_SIZE" = "26b" ]; then
    printf "%s\n" HEYU_LLM_MODEL_26B
  else
    printf "%s\n" HEYU_LLM_MODEL_31B
  fi
}

configured_ctx() {
  if [ "$MODEL_SIZE" = "26b" ]; then
    env_value HEYU_LLM_NUM_CTX_26B
  else
    env_value HEYU_LLM_NUM_CTX_31B
  fi
}

ollama_base_url() {
  printf "%s\n" "${HEYU_LLM_BASE_URL:-http://127.0.0.1:11434}"
}

ollama_ready() {
  local base_url
  base_url="$(ollama_base_url)"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS "${base_url%/}/api/tags" >/dev/null 2>&1 && return 0
  fi
  if command -v python3 >/dev/null 2>&1; then
    OLLAMA_BASE_URL="$base_url" python3 - <<'PY' >/dev/null 2>&1 && return 0
import os
import urllib.request
base = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
urllib.request.urlopen(base + "/api/tags", timeout=5).read()
PY
  fi
  command -v ollama >/dev/null 2>&1 || return 1
  ollama list >/dev/null 2>&1
}

ollama_model_names() {
  local base_url
  if command -v ollama >/dev/null 2>&1 && ollama list >/dev/null 2>&1; then
    ollama list 2>/dev/null | awk 'NR > 1 { print $1 }'
    return
  fi
  base_url="$(ollama_base_url)"
  if command -v python3 >/dev/null 2>&1; then
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

start_ollama_if_needed() {
  [ "${HEYU_LLM_PROVIDER:-ollama}" = "ollama" ] || return 0
  if ollama_ready; then
    return 0
  fi
  command -v ollama >/dev/null 2>&1 || return 0
  nohup ollama serve >"$LOG_DIR/ollama.out.log" 2>"$LOG_DIR/ollama.err.log" &
  for _ in $(seq 1 60); do
    if ollama_ready; then
      return 0
    fi
    sleep 1
  done
}

select_ollama_model_tag() {
  local candidates="$1"
  local requested="$2"
  local size="$3"

  if command -v zenity >/dev/null 2>&1 && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
    local tags=()
    local item
    while IFS= read -r item; do
      [ -n "$item" ] && tags+=("$item")
    done <<EOF
$candidates
EOF
    if [ "${#tags[@]}" -gt 0 ]; then
      zenity --list --title="Heyu DGX Spark" \
        --text="Could not find '$requested'. Choose the installed model tag for $size." \
        --column="Ollama tag" "${tags[@]}" 2>/dev/null || true
      return
    fi
  fi

  if [ -t 0 ]; then
    echo "Could not find requested Ollama model tag: $requested" >&2
    echo "Choose the installed model tag for $size:" >&2
    local tags=()
    local item index answer
    while IFS= read -r item; do
      [ -n "$item" ] && tags+=("$item")
    done <<EOF
$candidates
EOF
    for index in "${!tags[@]}"; do
      printf "  %s) %s\n" "$((index + 1))" "${tags[$index]}" >&2
    done
    printf "Select number (default: 1): " >&2
    read -r answer || true
    answer="${answer:-1}"
    if [ "$answer" -ge 1 ] 2>/dev/null && [ "$answer" -le "${#tags[@]}" ] 2>/dev/null; then
      printf "%s\n" "${tags[$((answer - 1))]}"
      return
    fi
  fi

  printf "%s\n" "$candidates" | head -n 1
}

resolve_ollama_model() {
  local requested="$1"
  local size="$2"
  [ "${HEYU_LLM_PROVIDER:-ollama}" = "ollama" ] || {
    printf "%s\n" "$requested"
    return
  }

  local names
  names="$(ollama_model_names)" || names=""
  [ -n "$names" ] || {
    printf "%s\n" "$requested"
    return
  }

  local name lower requested_lower
  requested_lower="$(printf "%s" "$requested" | tr '[:upper:]' '[:lower:]')"
  while IFS= read -r name; do
    [ -n "$name" ] || continue
    lower="$(printf "%s" "$name" | tr '[:upper:]' '[:lower:]')"
    if [ "$lower" = "$requested_lower" ]; then
      printf "%s\n" "$name"
      return
    fi
  done <<EOF
$names
EOF

  while IFS= read -r name; do
    [ -n "$name" ] || continue
    lower="$(printf "%s" "$name" | tr '[:upper:]' '[:lower:]')"
    if printf "%s" "$lower" | grep -q "gemma" && printf "%s" "$lower" | grep -q "$size"; then
      printf "%s\n" "$name"
      return
    fi
  done <<EOF
$names
EOF

  if [ "${HEYU_LLM_MODEL_AUTODETECT:-1}" = "0" ]; then
    printf "%s\n" "$requested"
    return
  fi

  local gemma_candidates
  gemma_candidates="$(printf "%s\n" "$names" | awk '{ l=tolower($0); if (l ~ /gemma/) print $0 }')"
  if [ -n "$gemma_candidates" ]; then
    select_ollama_model_tag "$gemma_candidates" "$requested" "$size"
    return
  fi

  local chat_candidates
  chat_candidates="$(printf "%s\n" "$names" | awk '{ l=tolower($0); if (l !~ /(embed|embedding|nomic)/) print $0 }')"
  if [ -n "$chat_candidates" ]; then
    echo "Warning: no installed Ollama model tag matched '$requested' or Gemma $size." >&2
    echo "Falling back to an installed non-embedding model tag." >&2
    select_ollama_model_tag "$chat_candidates" "$requested" "$size"
    return
  fi

  echo "Warning: no installed Ollama model tag matched '$requested', Gemma $size, or a non-embedding fallback." >&2
  echo "Open /api/tags and edit $ENV_FILE if the model tag is custom." >&2
  printf "%s\n" "$requested"
}

REQUESTED_MODEL="$(configured_model)"
REQUESTED_MODEL="${REQUESTED_MODEL:-gemma4:31b}"
CTX="$(configured_ctx)"
CTX="${CTX:-8192}"

start_ollama_if_needed || true
MODEL="$(resolve_ollama_model "$REQUESTED_MODEL" "$MODEL_SIZE")"
if [ -n "$MODEL" ] && [ "$MODEL" != "$REQUESTED_MODEL" ]; then
  echo "Mapped Gemma model '$REQUESTED_MODEL' -> '$MODEL'"
  write_env_value "$(model_env_key)" "$MODEL"
fi

if [ "$CONFIGURE_ONLY" = "1" ]; then
  echo "Saved DGX Spark model mapping."
  echo "  model profile: $MODEL_SIZE"
  echo "  model tag:     $MODEL"
  echo "  env file:      $ENV_FILE"
  exit 0
fi

export HEYU_PROFILE=dgx-spark
export HEYU_LLM_PROVIDER="${HEYU_LLM_PROVIDER:-ollama}"
export HEYU_LLM_BASE_URL="${HEYU_LLM_BASE_URL:-http://127.0.0.1:11434}"
export HEYU_LLM_MODEL="$MODEL"
export HEYU_LLM_NUM_CTX="$CTX"
export HEYU_LLM_TIMEOUT_MS="${HEYU_LLM_TIMEOUT_MS:-900000}"
export HEYU_LLM_TEMPERATURE="${HEYU_LLM_TEMPERATURE:-0.25}"
export HEYU_LLM_TOP_P="${HEYU_LLM_TOP_P:-0.9}"
export HEYU_STT_ENABLE_LARGE_MODELS="${HEYU_STT_ENABLE_LARGE_MODELS:-1}"
export HEYU_EMP_DATA_MODE="${HEYU_EMP_DATA_MODE:-full}"
export HEYU_WORKSPACE_DIR="${HEYU_WORKSPACE_DIR:-$APP_DIR/heyu_workspace}"
export HEYU_COMFYUI_DIR="${HEYU_COMFYUI_DIR:-$APP_DIR/tools/image-runtime/ComfyUI}"
export HEYU_COMFYUI_PYTHON="${HEYU_COMFYUI_PYTHON:-$APP_DIR/tools/image-runtime/.venv/bin/python}"
export HEYU_MARKITDOWN_MCP_COMMAND="${HEYU_MARKITDOWN_MCP_COMMAND:-$APP_DIR/tools/dgx-spark/.venv-tools/bin/markitdown-mcp}"
export HEYU_ROUTINE_PYTHON="${HEYU_ROUTINE_PYTHON:-$APP_DIR/tools/dgx-spark/.venv-routine/bin/python}"

mkdir -p "$HEYU_WORKSPACE_DIR" "$LOG_DIR"

activate_bundled_node

if ! node_modules_ready; then
  echo "Electron dependencies are missing. Running the offline installer first..."
  "$SCRIPT_DIR/install-and-run.sh" --model "$MODEL_SIZE" --no-run
  activate_bundled_node
fi

if ! node_modules_ready; then
  echo "Linux ARM64 Electron dependencies are still missing. Re-copy the full offline package and rerun the installer."
  exit 1
fi

if [ -z "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]; then
  echo "DISPLAY/WAYLAND_DISPLAY is not set. Start this from the DGX Spark desktop session."
fi

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"
export GTK_IM_MODULE="${GTK_IM_MODULE:-ibus}"
export QT_IM_MODULE="${QT_IM_MODULE:-ibus}"
export XMODIFIERS="${XMODIFIERS:-@im=ibus}"
if command -v ibus-daemon >/dev/null 2>&1; then
  ibus-daemon -drx >/dev/null 2>&1 || true
  ibus engine hangul >/dev/null 2>&1 || true
fi

echo "Starting Heyu on DGX Spark"
echo "  model profile: $MODEL_SIZE"
echo "  model tag:     $HEYU_LLM_MODEL"
echo "  base URL:      $HEYU_LLM_BASE_URL"
echo "  workspace:     $HEYU_WORKSPACE_DIR"

unset ELECTRON_RUN_AS_NODE
exec "$APP_DIR/node_modules/.bin/electron" --no-sandbox --disable-gpu "$APP_DIR"
