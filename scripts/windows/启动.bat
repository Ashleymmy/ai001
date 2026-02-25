@echo off
chcp 65001 >nul
title 🎬 AI Storyboarder - YuanYuan 视频制作助手
color 0B

set "PROJECT_DIR=%~dp0..\.."
cd /d "%PROJECT_DIR%"

set "BACKEND_PORT=18001"
set "FRONTEND_PORT=5174"

echo.
echo  ╔═══════════════════════════════════════════════════════════════╗
echo  ║                                                               ║
echo  ║      🎬 AI Storyboarder - YuanYuan 视频制作助手               ║
echo  ║                                                               ║
echo  ╚═══════════════════════════════════════════════════════════════╝
echo.

:: 检查环境
echo  [检查] Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未找到 Node.js
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do echo  [OK] Node.js %%i

echo  [检查] Python...
python --version >nul 2>&1
if errorlevel 1 (
    echo  [错误] 未找到 Python
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do echo  [OK] %%i

:: 检查依赖
if not exist "node_modules" (
    echo.
    echo  [安装] 正在安装前端依赖...
    call npm install
)

echo.
echo  ═══════════════════════════════════════════════════════════════
echo   启动服务中...
echo  ═══════════════════════════════════════════════════════════════
echo.
echo   前端: http://localhost:%FRONTEND_PORT%
echo   后端: http://localhost:%BACKEND_PORT%
echo   API:  http://localhost:%BACKEND_PORT%/docs
echo.

:: 启动后端（后台运行，输出到当前窗口）
echo  [启动] 后端服务...
start /b cmd /c "cd /d "%PROJECT_DIR%\backend" && python -m uvicorn main:app --reload --port %BACKEND_PORT% --host 0.0.0.0"

:: 等待后端启动
timeout /t 2 /nobreak >nul

:: 启动浏览器（6秒后）
start /b cmd /c "timeout /t 6 /nobreak >nul && start http://localhost:%FRONTEND_PORT%"

:: 启动前端（前台运行）
echo  [启动] 前端服务...
echo.
echo  ───────────────────────────────────────────────────────────────
echo   服务已启动！关闭此窗口将停止所有服务
echo  ───────────────────────────────────────────────────────────────
echo.

set VITE_BACKEND_PORT=%BACKEND_PORT%
call npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT% --strictPort
