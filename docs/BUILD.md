# AI Storyboarder 打包指南

## 版本: 0.1.0-beta.1

## 前置要求

### 前端
- Node.js 18+
- npm 或 yarn

### 后端
- Python 3.8+
- pip

## 打包步骤

### 1. 安装依赖

```bash
# 前端依赖
npm install

# 后端依赖
cd backend
pip install -r requirements.txt
pip install pyinstaller
cd ..
```

### 2. 创建应用图标

需要将 `build/icon.svg` 转换为 `build/icon.ico` (Windows) 或 `build/icon.icns` (macOS)。

可以使用在线工具如 https://convertio.co/svg-ico/ 转换。

### 3. 打包后端 (可选)

如果想将 Python 后端打包成 exe：

```bash
cd backend
pyinstaller --onefile --name backend-server main.py --hidden-import uvicorn --hidden-import fastapi
cd ..
```

生成的 `backend-server.exe` 会在 `backend/dist/` 目录。

### 4. 打包 Electron 应用

```bash
# 仅打包（不生成安装程序）
npm run pack:win

# 生成安装程序
npm run dist:win
```

输出文件在 `dist-electron/` 目录：
- `AI Storyboarder-0.1.0-beta.1-Setup.exe` - Windows 安装程序

## 运行方式

### 开发模式

```bash
# 终端1: 启动后端
npm run python:dev

# 终端2: 启动前端 + Electron
npm run electron:dev
```

### 生产模式

安装后运行 AI Storyboarder，应用会自动启动后端服务。

## 注意事项

1. 打包前确保后端 API 正常工作
2. 首次运行需要配置 API 密钥（设置页面）
3. 数据存储在 `backend/data/` 目录
4. 如果后端未打包成 exe，需要用户系统安装 Python 环境

## 目录结构

```
dist-electron/
├── win-unpacked/           # 解压后的应用
│   ├── AI Storyboarder.exe
│   ├── resources/
│   │   ├── app/           # 前端代码
│   │   └── backend/       # 后端代码
│   └── ...
└── AI Storyboarder-0.1.0-beta.1-Setup.exe  # 安装程序
```
