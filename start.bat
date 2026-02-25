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

:: 固定端口配置（统一由启动脚本维护）
set "BACKEND_PORT=18001"
set "FRONTEND_PORT=5174"

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

:: 固定端口空闲检查
set "PORT_BUSY="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%BACKEND_PORT% ^| findstr LISTENING') do set "PORT_BUSY=1"
if defined PORT_BUSY (
    color 0C
    echo [错误] 后端端口 %BACKEND_PORT% 已被占用，请先释放端口后再启动。
    echo        可执行 stop.bat 关闭旧服务，或手动终止占用进程。
    pause
    exit /b 1
)

set "PORT_BUSY="
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%FRONTEND_PORT% ^| findstr LISTENING') do set "PORT_BUSY=1"
if defined PORT_BUSY (
    color 0C
    echo [错误] 前端端口 %FRONTEND_PORT% 已被占用，请先释放端口后再启动。
    echo        可执行 stop.bat 关闭旧服务，或手动终止占用进程。
    pause
    exit /b 1
)

:: 记录 PID 文件
set "PID_FILE=%PROJECT_DIR%.dev-pids.json"

echo.
echo ══════════════════════════════════════════════════════════════
echo  启动服务
echo ══════════════════════════════════════════════════════════════
echo.

:: 启动后端 (新窗口，带标题)
echo [启动] 正在启动后端服务 (端口 %BACKEND_PORT%)...
start "🔧 AI Storyboarder - 后端服务" cmd /k "cd /d "%PROJECT_DIR%backend" && color 0E && echo. && echo  ╔═══════════════════════════════════════╗ && echo  ║  🔧 后端服务 - FastAPI + Uvicorn     ║ && echo  ║  端口: %BACKEND_PORT%                          ║ && echo  ╚═══════════════════════════════════════╝ && echo. && python -m uvicorn main:app --reload --port %BACKEND_PORT% --host 0.0.0.0"

:: 等待后端启动
echo [等待] 等待后端服务启动...
timeout /t 3 /nobreak >nul

:: 启动前端 (新窗口，带标题)
echo [启动] 正在启动前端服务 (端口 %FRONTEND_PORT%)...
start "🎨 AI Storyboarder - 前端服务" cmd /k "cd /d "%PROJECT_DIR%" && set VITE_BACKEND_PORT=%BACKEND_PORT% && color 0A && echo. && echo  ╔═══════════════════════════════════════╗ && echo  ║  🎨 前端服务 - Vite + React           ║ && echo  ║  端口: %FRONTEND_PORT%                           ║ && echo  ╚═══════════════════════════════════════╝ && echo. && npm run dev -- --host 0.0.0.0 --port %FRONTEND_PORT% --strictPort"

:: 等待前端启动
echo [等待] 等待前端服务启动...
timeout /t 5 /nobreak >nul

echo.
echo ══════════════════════════════════════════════════════════════
echo  ✅ 服务已启动！
echo ══════════════════════════════════════════════════════════════
echo.
echo  📌 前端地址: http://localhost:%FRONTEND_PORT%
echo  📌 后端地址: http://localhost:%BACKEND_PORT%
echo  📌 API 文档: http://localhost:%BACKEND_PORT%/docs
echo.
echo  💡 提示:
echo     - 按任意键打开浏览器
echo     - 关闭此窗口不会停止服务
echo     - 要停止服务请关闭对应的终端窗口
echo.

:: 等待用户按键
pause >nul

:: 打开浏览器
start http://localhost:%FRONTEND_PORT%

echo.
echo  🎉 浏览器已打开，祝你创作愉快！
echo.
timeout /t 3 /nobreak >nul
