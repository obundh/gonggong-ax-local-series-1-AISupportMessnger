$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ComfyDir = Join-Path $ScriptDir "ComfyUI"
$VenvDir = Join-Path $ScriptDir ".venv"
$Python = Join-Path $VenvDir "Scripts\python.exe"

if (!(Get-Command git -ErrorAction SilentlyContinue)) {
  throw "git을 찾지 못했습니다. Git을 설치한 뒤 다시 실행해 주세요."
}

if (!(Get-Command python -ErrorAction SilentlyContinue)) {
  throw "python을 찾지 못했습니다. Python 3.10+를 설치한 뒤 다시 실행해 주세요."
}

if (!(Test-Path $ComfyDir)) {
  git clone https://github.com/comfyanonymous/ComfyUI.git $ComfyDir
} else {
  git -C $ComfyDir pull --ff-only
}

if (!(Test-Path $Python)) {
  python -m venv $VenvDir
}

& $Python -m pip install --upgrade pip
& $Python -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu126
& $Python -m pip install -r (Join-Path $ComfyDir "requirements.txt")

Write-Host ""
Write-Host "ComfyUI 설치가 끝났습니다."
Write-Host "이제 앱에서 김그림에게 다시 프롬프트를 보내면 ComfyUI 자동 실행을 시도합니다."
