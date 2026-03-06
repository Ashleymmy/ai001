@echo off
setlocal EnableExtensions
chcp 65001 >nul

set "PROJECT_DIR=%~dp0..\.."
cd /d "%PROJECT_DIR%"
if errorlevel 1 (
    echo [ERROR] Cannot enter project directory: %PROJECT_DIR%
    pause
    exit /b 1
)

set "BACKEND_PORT=18001"
set "FRONTEND_PORT=5174"

echo.
echo [INFO] AI Storyboarder launcher
echo [INFO] Project: %PROJECT_DIR%
echo.

echo [CHECK] Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found
    pause
    exit /b 1
)
for /f "delims=" %%i in ('node -v 2^>nul') do echo [OK] Node.js %%i

echo [CHECK] Python...
set "PY_CMD=python"
where py >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3"
%PY_CMD% --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found
    pause
    exit /b 1
)
for /f "delims=" %%i in ('%PY_CMD% --version 2^>^&1') do echo [OK] %%i

echo [CHECK] Backend Python packages...
%PY_CMD% -c "import fastapi, uvicorn, arq, redis" >nul 2>&1
if errorlevel 1 (
    echo [INFO] Installing backend dependencies...
    %PY_CMD% -m pip install -r "%PROJECT_DIR%\backend\requirements.txt"
    if errorlevel 1 (
        echo [ERROR] Failed to install backend dependencies.
        echo         Run: %PY_CMD% -m pip install -r backend\requirements.txt
        pause
        exit /b 1
    )
)

if not exist "node_modules" (
    echo [INFO] Installing frontend dependencies...
    call npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install frontend dependencies.
        pause
        exit /b 1
    )
)

echo.
echo [INFO] Frontend: http://localhost:%FRONTEND_PORT%
echo [INFO] Backend : http://localhost:%BACKEND_PORT%
echo [INFO] API Docs: http://localhost:%BACKEND_PORT%/docs
echo.

echo [START] Backend service...
start "ai001-backend" /b cmd /c "cd /d ""%PROJECT_DIR%\backend"" && %PY_CMD% -m uvicorn main:app --reload --port %BACKEND_PORT% --host 0.0.0.0"
if errorlevel 1 (
    echo [ERROR] Failed to start backend process.
    pause
    exit /b 1
)

timeout /t 2 /nobreak >nul
start "ai001-browser" /b cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:%FRONTEND_PORT%"

echo [START] Frontend service...
set "VITE_BACKEND_PORT=%BACKEND_PORT%"
call npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT% --strictPort

