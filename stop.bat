@echo off
chcp 65001 >nul
title AI Storyboarder - 停止服务

set "BACKEND_PORT=18001"
set "FRONTEND_PORT=5174"

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║     🛑 AI Storyboarder - 停止服务                         ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

echo [停止] 正在停止前端服务 (端口 %FRONTEND_PORT%)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%FRONTEND_PORT% ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [停止] 正在停止后端服务 (端口 %BACKEND_PORT%)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :%BACKEND_PORT% ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo  ✅ 所有服务已停止
echo.
timeout /t 3 /nobreak >nul
