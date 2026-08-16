@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [HEYU] Node.js 20 or later is required.
  echo [HEYU] Install Node.js and run this launcher again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [HEYU] npm was not found.
  echo [HEYU] Reinstall Node.js with npm included.
  pause
  exit /b 1
)

if not exist "node_modules\electron\dist\electron.exe" (
  echo [HEYU] Installing required packages for the first run...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [HEYU] Package installation failed.
    pause
    exit /b 1
  )
)

set "ELECTRON_RUN_AS_NODE="
node "tools\windows-dev-launcher.cjs" --detach
if errorlevel 1 (
  echo [HEYU] Failed to prepare or launch the branded HEYU executable.
  echo [HEYU] Close any running HEYU window and try again.
  pause
  exit /b 1
)

exit /b 0
