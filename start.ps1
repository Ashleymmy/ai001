# AI Storyboarder 启动器 - PowerShell 增强版
# 提供实时状态监控和服务管理

$Host.UI.RawUI.WindowTitle = "AI Storyboarder - 控制台"
$ErrorActionPreference = "SilentlyContinue"

# 颜色定义
function Write-ColorText {
    param([string]$Text, [string]$Color = "White")
    Write-Host $Text -ForegroundColor $Color
}

# 清屏并显示 Banner
Clear-Host
Write-Host ""
Write-ColorText "  ╔═══════════════════════════════════════════════════════════════╗" "Cyan"
Write-ColorText "  ║                                                               ║" "Cyan"
Write-ColorText "  ║      🎬 AI Storyboarder - YuanYuan 视频制作助手               ║" "Cyan"
Write-ColorText "  ║                                                               ║" "Cyan"
Write-ColorText "  ╚═══════════════════════════════════════════════════════════════╝" "Cyan"
Write-Host ""

# 获取项目目录
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

# 全局变量存储进程
$Global:BackendProcess = $null
$Global:FrontendProcess = $null

# 检查端口是否被占用
function Test-Port {
    param([int]$Port)
    $connection = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue
    return $connection -ne $null
}

# 检查服务是否响应
function Test-Service {
    param([string]$Url)
    try {
        $response = Invoke-WebRequest -Uri $Url -TimeoutSec 2 -UseBasicParsing
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

# 环境检查
Write-ColorText "[检查环境]" "Yellow"

# 检查 Node.js
$nodeVersion = node -v 2>$null
if ($nodeVersion) {
    Write-ColorText "  ✓ Node.js $nodeVersion" "Green"
} else {
    Write-ColorText "  ✗ 未找到 Node.js" "Red"
    exit 1
}

# 检查 Python
$pythonVersion = python --version 2>&1
if ($pythonVersion -match "Python") {
    Write-ColorText "  ✓ $pythonVersion" "Green"
} else {
    Write-ColorText "  ✗ 未找到 Python" "Red"
    exit 1
}

# 检查 Go（用于 demo/huobao-drama）
$huobaoProjectPath = Join-Path $ProjectDir "demo\\huobao-drama"
$huobaoEnabled = Test-Path $huobaoProjectPath
if ($huobaoEnabled) {
    $goVersion = go version 2>$null
    if ($goVersion) {
        Write-ColorText "  ✓ $goVersion" "Green"
    } else {
        Write-ColorText "  ⚠️ 未找到 Go，Canvas(Huobao demo) 将不可用" "Yellow"
        $huobaoEnabled = $false
    }
} else {
    $huobaoEnabled = $false
}

# 检查依赖
Write-Host ""
Write-ColorText "[检查依赖]" "Yellow"

if (-not (Test-Path "node_modules")) {
    Write-ColorText "  安装前端依赖中..." "Yellow"
    npm.cmd install
}
Write-ColorText "  ✓ 前端依赖已就绪" "Green"

# 检查 / 安装后端依赖（包括 Fish TTS 需要的 ormsgpack）
python -c "import fastapi,uvicorn,httpx,ormsgpack" 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-ColorText "  安装后端依赖中..." "Yellow"
    python -m pip install -r backend/requirements.txt
}
Write-ColorText "  ✓ 后端依赖已就绪" "Green"

if ($huobaoEnabled) {
    Write-Host ""
    Write-ColorText "[检查依赖] demo/huobao-drama (Go)..." "Yellow"

    $huobaoConfigPath = Join-Path $huobaoProjectPath "configs\\config.yaml"
    $huobaoConfigExamplePath = Join-Path $huobaoProjectPath "configs\\config.example.yaml"
    if (-not (Test-Path $huobaoConfigPath) -and (Test-Path $huobaoConfigExamplePath)) {
        Copy-Item $huobaoConfigExamplePath $huobaoConfigPath -Force
    }

    try {
        Push-Location $huobaoProjectPath
        go mod download
        Pop-Location
        Write-ColorText "  ✓ demo Go 依赖已就绪" "Green"
    } catch {
        Write-ColorText "  ⚠️ demo Go 依赖下载失败（仍会尝试启动）" "Yellow"
        try { Pop-Location } catch {}
    }
}

# 启动服务
Write-Host ""
Write-ColorText "═══════════════════════════════════════════════════════════════════" "DarkGray"
Write-ColorText "  启动服务" "White"
Write-ColorText "═══════════════════════════════════════════════════════════════════" "DarkGray"
Write-Host ""

# 启动后端
Write-ColorText "[启动] 后端服务 (FastAPI)..." "Yellow"
$backendScript = @"
`$Host.UI.RawUI.WindowTitle = '🔧 后端服务 - Port 8001'
`$Host.UI.RawUI.BackgroundColor = 'DarkBlue'
Clear-Host
Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Cyan
Write-Host '  ║                                                           ║' -ForegroundColor Cyan
Write-Host '  ║   🔧 AI Storyboarder 后端服务                             ║' -ForegroundColor Cyan
Write-Host '  ║                                                           ║' -ForegroundColor Cyan
Write-Host '  ║   端口: 8001                                              ║' -ForegroundColor Cyan
Write-Host '  ║   框架: FastAPI + Uvicorn                                 ║' -ForegroundColor Cyan
Write-Host '  ║   API文档: http://localhost:8001/docs                     ║' -ForegroundColor Cyan
Write-Host '  ║                                                           ║' -ForegroundColor Cyan
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Cyan
Write-Host ''
Write-Host '  [状态] 服务启动中...' -ForegroundColor Yellow
Write-Host ''
Set-Location '$ProjectDir\backend'
python -m uvicorn main:app --reload --port 8001 --host 0.0.0.0
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendScript

# 等待后端启动
Start-Sleep -Seconds 2

if ($huobaoEnabled) {
    Write-ColorText "[启动] demo 服务 (Huobao Drama / Go)..." "Yellow"
    $huobaoScript = @"
`$Host.UI.RawUI.WindowTitle = '🎬 demo Go 服务 - Port 5678'
`$Host.UI.RawUI.BackgroundColor = 'DarkMagenta'
Clear-Host
Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Magenta
Write-Host '  ║     🎬 Huobao Drama (demo) - Go 后端服务                  ║' -ForegroundColor Magenta
Write-Host '  ║     端口: 5678   健康检查: http://localhost:5678/health    ║' -ForegroundColor Magenta
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Magenta
Write-Host ''
Set-Location '$huobaoProjectPath'
go run main.go
"@
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $huobaoScript
    Start-Sleep -Seconds 2
}

# 启动前端
Write-ColorText "[启动] 前端服务 (Vite)..." "Yellow"
$frontendScript = @"
`$Host.UI.RawUI.WindowTitle = '🎨 前端服务 - Port 5174'
`$Host.UI.RawUI.BackgroundColor = 'DarkGreen'
Clear-Host
Write-Host ''
Write-Host '  ╔═══════════════════════════════════════════════════════════╗' -ForegroundColor Green
Write-Host '  ║                                                           ║' -ForegroundColor Green
Write-Host '  ║   🎨 AI Storyboarder 前端服务                             ║' -ForegroundColor Green
Write-Host '  ║                                                           ║' -ForegroundColor Green
Write-Host '  ║   端口: 5174                                              ║' -ForegroundColor Green
Write-Host '  ║   框架: Vite + React + TypeScript                         ║' -ForegroundColor Green
Write-Host '  ║   地址: http://localhost:5174                             ║' -ForegroundColor Green
Write-Host '  ║                                                           ║' -ForegroundColor Green
Write-Host '  ╚═══════════════════════════════════════════════════════════╝' -ForegroundColor Green
Write-Host ''
Write-Host '  [状态] 服务启动中...' -ForegroundColor Yellow
Write-Host ''
Set-Location '$ProjectDir'
npm run dev
"@

Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendScript

# 等待服务启动并监控状态
Write-Host ""
Write-ColorText "═══════════════════════════════════════════════════════════════════" "DarkGray"
Write-ColorText "  服务状态监控" "White"
Write-ColorText "═══════════════════════════════════════════════════════════════════" "DarkGray"
Write-Host ""

$maxWait = 30
$waited = 0
$backendReady = $false
$frontendReady = $false
$huobaoReady = $false

while ($waited -lt $maxWait -and (-not $backendReady -or -not $frontendReady -or ($huobaoEnabled -and -not $huobaoReady))) {
    # 检查后端
    if (-not $backendReady) {
        if (Test-Port 8001) {
            $backendReady = $true
            Write-ColorText "  ✓ 后端服务已就绪 (http://localhost:8001)" "Green"
        }
    }

    # 检查前端
    if (-not $frontendReady) {
        if (Test-Port 5174) {
            $frontendReady = $true
            Write-ColorText "  ✓ 前端服务已就绪 (http://localhost:5174)" "Green"
        }
    }

    if ($huobaoEnabled -and -not $huobaoReady) {
        if (Test-Port 5678) {
            $huobaoReady = $true
            Write-ColorText "  ✓ demo Go 服务已就绪 (http://localhost:5678)" "Green"
        }
    }

    if (-not $backendReady -or -not $frontendReady -or ($huobaoEnabled -and -not $huobaoReady)) {
        Write-Host "`r  等待服务启动... ($waited 秒)" -NoNewline
        Start-Sleep -Seconds 1
        $waited++
    }
}

Write-Host ""

if ($backendReady -and $frontendReady -and (-not $huobaoEnabled -or $huobaoReady)) {
    Write-Host ""
    Write-ColorText "═══════════════════════════════════════════════════════════════════" "DarkGray"
    Write-ColorText "  ✅ 所有服务已启动！" "Green"
    Write-ColorText "═══════════════════════════════════════════════════════════════════" "DarkGray"
    Write-Host ""
    Write-ColorText "  📌 前端地址: http://localhost:5174" "Cyan"
    Write-ColorText "  📌 后端地址: http://localhost:8001" "Cyan"
    Write-ColorText "  📌 API 文档: http://localhost:8001/docs" "Cyan"
    if ($huobaoEnabled) {
        Write-ColorText "  📌 demo Go:  http://localhost:5678" "Cyan"
    }
    if ($huobaoEnabled) {
        Write-Host ""
        Write-ColorText "[同步] 预加载主项目 API 配置到 demo（默认禁用，可在 demo 的 AI配置 页面启用）..." "Yellow"
        try {
            python scripts/sync_huobao_ai_config.py --main http://localhost:8001 --demo http://localhost:5678
        } catch {
            Write-ColorText "  ⚠️ 同步失败：$($_.Exception.Message)" "Yellow"
        }
    }
    Write-Host ""
    Write-ColorText "  💡 提示:" "Yellow"
    Write-ColorText "     - 后端窗口 (蓝色) 显示 API 请求日志" "Gray"
    Write-ColorText "     - 前端窗口 (绿色) 显示构建状态" "Gray"
    if ($huobaoEnabled) {
        Write-ColorText "     - demo窗口 (紫色) 为 Canvas(Huobao) 后端" "Gray"
    }
    Write-ColorText "     - 关闭此窗口不会停止服务" "Gray"
    Write-Host ""

    # 询问是否打开浏览器
    Write-ColorText "  按 Enter 打开浏览器，或按 Q 退出..." "Yellow"
    $key = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

    if ($key.Character -ne 'q' -and $key.Character -ne 'Q') {
        Start-Process "http://localhost:5174"
        Write-ColorText "  🎉 浏览器已打开！" "Green"
    }
} else {
    Write-ColorText "  ⚠️ 部分服务启动超时，请检查终端窗口" "Yellow"
}

Write-Host ""
Write-ColorText "  按任意键退出控制台..." "DarkGray"
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
