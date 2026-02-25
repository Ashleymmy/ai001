# AI Storyboarder - 视频分镜制作助手

基于 AI 的视频分镜自动生成工具，支持根据参考图和剧情文本生成风格统一的分镜画面。

## ✨ 功能特性

- 🎬 **智能分镜生成** - AI 自动分析剧本，生成完整分镜方案
- 🎨 **角色设计** - 自动生成角色设计图，保持风格统一
- 🖼️ **起始帧生成** - 为每个镜头生成高质量起始帧
- 🎥 **视频生成** - 将静态画面转化为动态视频
- 📦 **项目管理** - 完整的项目保存、加载、导出功能
- 🤖 **Agent 助手** - YuanYuan AI 助手全程指导创作

## 🚀 快速开始

### 1. 安装依赖

#### 前端 (Electron + React)
```bash
npm install
```

#### 后端 (Python FastAPI)
```bash
cd backend
pip install -r requirements.txt
```

### 2. 配置 API Key

**重要：首次使用前必须配置 API Key**

1. 复制配置文件模板：
```bash
cd backend/data
copy settings.yaml.example settings.local.yaml
copy custom_providers.yaml.example custom_providers.local.yaml
```

2. 编辑 `settings.local.yaml`，填入你的 API Key：
```yaml
llm:
  provider: "doubao"
  apiKey: "YOUR_API_KEY_HERE"  # 替换为你的 API Key
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  model: "doubao-seed-1-6-251015"

image:
  provider: "custom_xxxxx"
  apiKey: "YOUR_API_KEY_HERE"  # 替换为你的 API Key
  # ... 其他配置
```

3. 如果使用自定义服务商，编辑 `custom_providers.local.yaml`

### 3. 启动服务

#### 开发模式
```bash
# 一键启动（Windows）
npm run start

# 或者：手动分别启动
# 终端 1 - 启动后端
cd backend
python -m uvicorn main:app --reload --port 18001

# 终端 2 - 启动前端
npm run dev
```

#### Electron 桌面应用
```bash
npm run electron:dev
```

访问 http://localhost:5174 开始使用（后端固定端口：`18001`）

## 📁 项目结构

```
ai001/
├── src/                    # 前端源码
│   ├── pages/             # 页面组件
│   │   ├── AgentPage.tsx  # Agent 助手页面
│   │   ├── VideoPage.tsx  # 视频编辑页面
│   │   └── SettingsPage.tsx # 设置页面
│   ├── services/          # API 服务
│   └── store/             # 状态管理
├── backend/               # 后端源码
│   ├── main.py           # FastAPI 主程序
│   ├── services/         # 业务逻辑
│   │   ├── agent_service.py    # Agent 服务
│   │   ├── image_service.py    # 图像生成
│   │   ├── video_service.py    # 视频生成
│   │   ├── storage_service.py  # 数据存储
│   │   └── export_service.py   # 导出功能
│   └── data/             # 数据目录（不提交到 Git）
│       ├── settings.yaml.example      # 配置模板
│       └── custom_providers.yaml.example
├── electron/             # Electron 配置
└── build/               # 构建配置

```

## 🔒 安全说明

**重要：保护你的 API Key**

- ✅ `settings.local.yaml` 和 `custom_providers.local.yaml` 已添加到 `.gitignore`
- ✅ 不会被提交到 Git 仓库
- ✅ 使用 `.example` 文件作为配置模板
- ⚠️ 永远不要将包含真实 API Key 的文件提交到公开仓库

## 🛠️ 技术栈

- **前端**: Electron + React + TypeScript + TailwindCSS + Zustand
- **后端**: Python FastAPI + Uvicorn
- **AI 服务**: 
  - LLM: 豆包、通义千问、OpenAI 等
  - 图像生成: Nano Banana Pro、DALL-E 等
  - 视频生成: Seedance、Luma、Runway 等

## 📦 导出功能

- **导出全部素材**: 打包所有角色图片、起始帧、视频片段为 ZIP
- **视频拼接**: 提供多种拼接方案（视频编辑软件、FFmpeg 等）

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 📚 开发文档

- `docs/开发文档.md`
- `docs/前端开发文档.md`
- `docs/分镜脚本优化.md`
- `docs/视频制作流程优化.md`

## 技术栈
- 前端: Electron + React + TailwindCSS + Zustand
- 后端: Python FastAPI
- AI: ComfyUI / 云端 API (RunningHub/阿里云百炼)
