@echo off
setlocal
cd /d "%~dp0"
python -c "import sys; sys.path.insert(0, r'%~dp0vendor'); import pdfplumber, pypdfium2" >nul 2>nul
if not errorlevel 1 exit /b 0

echo Installing required Python packages into local vendor folder...
python -m pip install -r "%~dp0requirements.txt" -t "%~dp0vendor" --upgrade
if errorlevel 1 (
  echo.
  echo Failed to install dependencies. Check Python and pip, then try install.cmd.
  pause
  exit /b 1
)
exit /b 0
