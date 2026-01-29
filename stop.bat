@echo off
chcp 65001 >nul
title AI Storyboarder - 停止服务

echo.
echo  ╔═══════════════════════════════════════════════════════════╗
echo  ║     🛑 AI Storyboarder - 停止服务                         ║
echo  ╚═══════════════════════════════════════════════════════════╝
echo.

echo [停止] 正在停止前端服务 (端口 5173)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5173 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [停止] 正在停止后端服务 (端口 8000)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo [停止] 正在停止 demo Go 服务 (端口 5678)...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr :5678 ^| findstr LISTENING') do (
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo  ✅ 所有服务已停止
echo.
timeout /t 3 /nobreak >nul
