@echo off
chcp 65001 >nul
title AI Storyboarder - 启动器

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║                                                           ║
echo  ║     🎬 AI Storyboarder - YuanYuan 视频制作助手            ║
echo  ║                                                           ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

:: 设置颜色
color 0B

:: 获取脚本所在目录
set "PROJECT_DIR=%~dp0"
cd /d "%PROJECT_DIR%"

:: 检查 Node.js
echo [检查环境] 正在检查 Node.js...
node -v >nul 2>&1
if errorlevel 1 (
    color 0C
    echo [错误] 未找到 Node.js，请先安装 Node.js
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VER=%%i
echo [✓] Node.js %NODE_VER%

:: 检查 Python
echo [检查环境] 正在检查 Python...
python --version >nul 2>&1
if errorlevel 1 (
    color 0C
    echo [错误] 未找到 Python，请先安装 Python 3.8+
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('python --version') do set PYTHON_VER=%%i
echo [✓] %PYTHON_VER%

:: 检查 Go（用于 demo/huobao-drama）
set "HUOBAO_ENABLED=0"
if exist "demo\huobao-drama" (
    echo [检查环境] 正在检查 Go (demo/huobao-drama)...
    go version >nul 2>&1
    if errorlevel 1 (
        echo [WARN] 未找到 Go，Canvas(Huobao demo) 将不可用
    ) else (
        for /f "tokens=*" %%i in ('go version') do echo [✓] %%i
        set "HUOBAO_ENABLED=1"
    )
)

:: 检查依赖
echo.
echo [检查依赖] 正在检查前端依赖...
if not exist "node_modules" (
    echo [安装] 正在安装前端依赖...
    call npm install
)
echo [✓] 前端依赖已就绪

echo [检查依赖] 正在检查后端依赖...
if not exist "backend\venv" (
    echo [提示] 建议创建虚拟环境: python -m venv backend\venv
)

if "%HUOBAO_ENABLED%"=="1" (
    if not exist "demo\\huobao-drama\\configs\\config.yaml" (
        if exist "demo\\huobao-drama\\configs\\config.example.yaml" (
            copy /Y "demo\\huobao-drama\\configs\\config.example.yaml" "demo\\huobao-drama\\configs\\config.yaml" >nul
        )
    )
)

:: 记录 PID 文件
set "PID_FILE=%PROJECT_DIR%.dev-pids.json"

echo.
echo ══════════════════════════════════════════════════════════════
echo  启动服务
echo ══════════════════════════════════════════════════════════════
echo.

:: 启动后端 (新窗口，带标题)
echo [启动] 正在启动后端服务 (端口 8000)...
start "🔧 AI Storyboarder - 后端服务" cmd /k "cd /d "%PROJECT_DIR%backend" && color 0E && echo. && echo  ╔═══════════════════════════════════════╗ && echo  ║  🔧 后端服务 - FastAPI + Uvicorn     ║ && echo  ║  端口: 8000                           ║ && echo  ╚═══════════════════════════════════════╝ && echo. && python -m uvicorn main:app --reload --port 8000 --host 0.0.0.0"

:: 等待后端启动
echo [等待] 等待后端服务启动...
timeout /t 3 /nobreak >nul

if "%HUOBAO_ENABLED%"=="1" (
    :: 启动 demo Go 后端（Huobao Drama）
    echo [启动] 正在启动 demo 服务 (Huobao Drama / Go) (端口 5678)...
    start "🎬 Huobao Drama (demo) - Go 后端" cmd /k "cd /d "%PROJECT_DIR%demo\\huobao-drama" && color 0D && echo. && echo  ╔═══════════════════════════════════════╗ && echo  ║  🎬 Huobao Drama (demo) - Go 后端     ║ && echo  ║  端口: 5678  Health: /health          ║ && echo  ╚═══════════════════════════════════════╝ && echo. && go mod download && go run main.go"
    timeout /t 2 /nobreak >nul
)

:: 启动前端 (新窗口，带标题)
echo [启动] 正在启动前端服务 (端口 5173)...
start "🎨 AI Storyboarder - 前端服务" cmd /k "cd /d "%PROJECT_DIR%" && color 0A && echo. && echo  ╔═══════════════════════════════════════╗ && echo  ║  🎨 前端服务 - Vite + React           ║ && echo  ║  端口: 5173                           ║ && echo  ╚═══════════════════════════════════════╝ && echo. && npm run dev"

:: 等待前端启动
echo [等待] 等待前端服务启动...
timeout /t 5 /nobreak >nul

echo.
echo ══════════════════════════════════════════════════════════════
echo  ✅ 服务已启动！
echo ══════════════════════════════════════════════════════════════
echo.
echo  📌 前端地址: http://localhost:5173
echo  📌 后端地址: http://localhost:8000
echo  📌 API 文档: http://localhost:8000/docs
if "%HUOBAO_ENABLED%"=="1" echo  📌 demo Go:  http://localhost:5678
echo.
echo  💡 提示:
echo     - 按任意键打开浏览器
echo     - 关闭此窗口不会停止服务
echo     - 要停止服务请关闭对应的终端窗口
echo.

:: 等待用户按键
pause >nul

:: 打开浏览器
start http://localhost:5173

echo.
echo  🎉 浏览器已打开，祝你创作愉快！
echo.
timeout /t 3 /nobreak >nul
