@echo off
setlocal
cd /d "%~dp0"
call "%~dp0ensure-deps.cmd"
if errorlevel 1 exit /b %ERRORLEVEL%
python "%~dp0verify-gui.py"
