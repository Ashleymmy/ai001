@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "PY_SCRIPT=%SCRIPT_DIR%..\qa\run_acceptance.py"

if exist "%SystemRoot%\py.exe" (
    py -3 "%PY_SCRIPT%" %*
    exit /b %errorlevel%
)

python --version >nul 2>&1
if %errorlevel%==0 (
    python "%PY_SCRIPT%" %*
    exit /b %errorlevel%
)

echo [ERROR] 未找到 Python (py/python)
exit /b 1
