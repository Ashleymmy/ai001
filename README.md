# AI Storyboarder - 视频分镜制作助手

基于 AI 的视频分镜自动生成工具，支持根据参考图和剧情文本生成风格统一的分镜画面。

## 快速开始

### 前端 (Electron + React)
```bash
npm install
npm run dev          # 开发模式
npm run electron:dev # Electron 开发模式
```

### 后端 (Python FastAPI)
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload --port 8000
```

## 技术栈
- 前端: Electron + React + TailwindCSS + Zustand
- 后端: Python FastAPI
- AI: ComfyUI / 云端 API (RunningHub/阿里云百炼)
