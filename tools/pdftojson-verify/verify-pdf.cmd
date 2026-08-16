@echo off
setlocal
cd /d "%~dp0"
call "%~dp0ensure-deps.cmd"
if errorlevel 1 exit /b %ERRORLEVEL%
if "%~1"=="" (
  python "%~dp0verify-gui.py"
  exit /b %ERRORLEVEL%
)
python "%~dp0verify-pdf.py" --input "%~1" --open
pause
