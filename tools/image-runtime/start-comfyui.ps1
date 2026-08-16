$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Resolve-Path (Join-Path $ScriptDir "..\..")
$ComfyDir = Join-Path $ScriptDir "ComfyUI"
$Python = Join-Path $ScriptDir ".venv\Scripts\python.exe"
$ExtraConfig = Join-Path $RootDir "models\image\comfy_extra_model_paths.yaml"

if (!(Test-Path $Python) -or !(Test-Path (Join-Path $ComfyDir "main.py"))) {
  throw "ComfyUI 런타임이 없습니다. 먼저 tools\image-runtime\install-comfyui.ps1을 실행해 주세요."
}

& $Python (Join-Path $ComfyDir "main.py") --listen 127.0.0.1 --port 8188 --extra-model-paths-config $ExtraConfig
