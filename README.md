# AI Storyboarder - AI 视频分镜制作助手

> 基于 AI 的全流程视频分镜制作工具，支持从剧本创作、角色设计、分镜画面生成到视频合成的完整工作流。提供 Agent 对话式引导、Studio 长篇制作工作台、短视频工作台、数字人工作台等多种创作模式，以及多人协作能力。

**版本**: 1.0.0-beta &nbsp;|&nbsp; **许可证**: MIT &nbsp;|&nbsp; **平台**: Windows (Electron 桌面应用 / Web)

---

## 功能特性

### 核心创作模式

| 模式 | 说明 |
|------|------|
| **Agent 助手模式** | AI 助手 "YuanYuan" 全程对话式引导：故事分析 → 项目规划 → 角色设计 → 分镜拆解 → 画面生成 → 视频生成 → 音频生成，支持全自动流水线执行 |
| **Studio 长篇工作台** | 专业长篇内容制作：系列/卷/集层级管理、共享元素库、镜头级编辑（景别/机位/运镜/情绪/关键帧）、批量生成（SSE 流式）、历史回滚 |
| **短视频工作台** | 面向短视频内容的轻量化制作流程 |
| **数字人工作台** | 数字人视频专用制作环境 |
| **独立模块** | 剧本创作、图像生成、分镜制作、视频生成 —— 各模块可独立使用 |

### 平台能力

- **多 AI 服务商支持** — LLM (13+)、图像生成 (10+)、视频生成 (8+)、TTS (4+) 服务商可自由切换
- **多人协作** — JWT 认证、工作区管理、成员角色、集分配、WebSocket 实时在线状态、OKR 追踪
- **API 用量监控** — 调用追踪、预算限额、服务商健康探测
- **音频流水线** — 多 TTS 服务商、音频时间轴编辑、多轨合成、视频音频提取
- **项目管理** — 完整的项目保存/加载、ZIP 导出导入、Studio 与 Agent 互通
- **内容安全** — 内置敏感词库过滤

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React 18 + TypeScript + Vite 5 + TailwindCSS 3 + Zustand 4 |
| **桌面端** | Electron 28 (NSIS 安装包) |
| **后端** | Python FastAPI + Uvicorn (异步) |
| **存储** | SQLite (Studio) + YAML 文件 (Agent/Module) |
| **实时通信** | WebSocket (协作在线状态) + SSE (生成流式进度) |
| **AI 服务** | OpenAI SDK 统一接入，支持豆包、通义千问、DeepSeek、智谱、Moonshot、百川、零一万物、SiliconFlow、OpenRouter 等 |
| **图像生成** | ComfyUI、SD WebUI、通义万相、DALL-E、Stability AI、Midjourney、Flux、自定义服务商 |
| **视频生成** | Seedance、Runway、Pika、Kling、Luma、MiniMax、通义视频、自定义服务商 |
| **TTS** | 火山引擎、Fish Audio、百炼 (DashScope)、OpenAI 兼容 |

---

## 快速开始

### 环境要求

- **Node.js** >= 18
- **Python** >= 3.10
- **npm** >= 9

### 1. 安装依赖

```bash
# 前端依赖
npm install

# 后端依赖
cd backend
pip install -r requirements.txt
```

### 2. 配置 API Key

首次使用前**必须**配置 API Key：

```bash
cd backend/data

# 复制配置模板
copy settings.yaml.example settings.local.yaml
copy custom_providers.yaml.example custom_providers.local.yaml
```

编辑 `settings.local.yaml`，填入 API Key：

```yaml
llm:
  provider: "doubao"
  apiKey: "YOUR_API_KEY_HERE"
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3"
  model: "doubao-seed-1-6-251015"

image:
  provider: "custom_xxxxx"
  apiKey: "YOUR_API_KEY_HERE"
```

系统采用**三套隔离配置**，分别用于不同运行时：

| 配置文件 | 作用域 |
|----------|--------|
| `settings.local.yaml` | Agent 运行时 |
| `module.settings.local.yaml` | Module 独立模块运行时 |
| `studio.settings.local.yaml` | Studio 工作台运行时（缺省回退至 Module） |

如使用自定义服务商，另需编辑 `custom_providers.local.yaml`。

### 3. 启动服务

```bash
# 一键启动（Windows，自动启动前后端）
npm run start

# 或手动分别启动：
# 终端 1 - 后端
cd backend
python -m uvicorn main:app --reload --port 18001

# 终端 2 - 前端
npm run dev
```

访问 **http://localhost:5174** 开始使用（后端端口：`18001`）

#### Electron 桌面模式

```bash
npm run electron:dev
```

---

## 项目结构

```
ai001/
├── src/                          # 前端源码 (React + TypeScript)
│   ├── App.tsx                   # 路由定义 (HashRouter)
│   ├── pages/                    # 页面组件 (15 个)
│   │   ├── WelcomePage.tsx       #   欢迎页（首次访问引导）
│   │   ├── HomePage.tsx          #   首页（项目列表 & 模块入口）
│   │   ├── AgentPage.tsx         #   Agent 对话式创作
│   │   ├── StudioPage.tsx        #   Studio 长篇制作工作台
│   │   ├── ShortVideoWorkbenchPage.tsx  # 短视频工作台
│   │   ├── DigitalHumanWorkbenchPage.tsx # 数字人工作台
│   │   ├── ScriptPage.tsx        #   剧本创作模块
│   │   ├── ImagePage.tsx         #   图像生成模块
│   │   ├── StoryboardPage.tsx    #   分镜制作模块
│   │   ├── VideoPage.tsx         #   视频生成模块
│   │   ├── SettingsPage.tsx      #   设置页（多服务商配置）
│   │   ├── ApiMonitorPage.tsx    #   API 用量监控
│   │   ├── AuthPage.tsx          #   登录/注册
│   │   ├── WorkspaceDashboardPage.tsx  # 协作仪表盘
│   │   └── WorkspaceOkrPage.tsx  #   OKR 管理
│   ├── components/               # 共享组件
│   │   ├── studio/               #   Studio 工作台组件 (15 个)
│   │   ├── audio-workbench/      #   音频工作台组件 (7 个)
│   │   └── Layout.tsx            #   主布局 + 侧边栏
│   ├── features/                 # 功能模块 (agent, canvas, editor, project, settings)
│   ├── store/                    # Zustand 状态管理
│   │   ├── settingsStore.ts      #   服务商配置 & 模型预设
│   │   ├── projectStore.ts       #   项目 & 分镜数据
│   │   ├── studioStore.ts        #   Studio 状态
│   │   ├── workspaceStore.ts     #   协作 & 认证状态
│   │   └── generationQueueStore.ts # 并发生成队列
│   ├── services/api.ts           # API 客户端 (80+ 接口)
│   └── hooks/                    # 自定义 Hooks
├── backend/                      # 后端源码 (Python FastAPI)
│   ├── main.py                   # FastAPI 主程序 (150+ 接口)
│   ├── requirements.txt          # Python 依赖
│   ├── services/                 # 业务服务
│   │   ├── llm_service.py        #   LLM 统一抽象层 (13+ 服务商)
│   │   ├── image_service.py      #   图像生成服务
│   │   ├── video_service.py      #   视频生成服务
│   │   ├── tts_service.py        #   TTS 语音合成
│   │   ├── agent_service.py      #   Agent 编排引擎
│   │   ├── studio_service.py     #   Studio 编排引擎
│   │   ├── studio_storage.py     #   Studio SQLite 存储
│   │   ├── collab_service.py     #   协作 & 认证服务 (JWT)
│   │   ├── storage_service.py    #   Agent/Module YAML 存储
│   │   ├── api_monitor_service.py #  API 用量监控
│   │   ├── export_service.py     #   导出/导入服务
│   │   ├── fish_audio_service.py #   Fish Audio 语音克隆
│   │   ├── ws_manager.py         #   WebSocket 管理器
│   │   ├── agent/                #   Agent 提示词 & 常量
│   │   └── studio/               #   Studio 提示词 & 模板
│   └── data/                     # 运行时数据（不提交 Git）
│       ├── settings.yaml.example #   配置模板
│       ├── custom_providers.yaml.example
│       ├── prompts.yaml          #   Agent 提示词模板
│       └── projects/             #   项目数据文件
├── electron/                     # Electron 桌面封装
│   ├── main.js                   #   主进程（自动启动后端）
│   ├── preload.js                #   IPC 桥接
│   └── splash.html               #   启动画面
├── docs/                         # 开发文档
├── vendor/                       # 第三方库 (wavesurfer.js)
├── Sensitive-lexicon-1.2/        # 敏感词库
├── scripts/                      # 工具脚本
├── start.bat / start.ps1         # Windows 一键启动
├── stop.bat                      # 停止服务
├── vite.config.ts                # Vite 构建配置
├── tailwind.config.js            # TailwindCSS 配置
└── tsconfig.json                 # TypeScript 配置
```

---

## 路由总览

| 路径 | 页面 | 说明 |
|------|------|------|
| `/` | WelcomePage | 欢迎引导页（首次访问） |
| `/home` | HomePage | 首页，项目列表 & 模块入口 |
| `/home/script` | ScriptPage | 剧本创作 |
| `/home/image` | ImagePage | 图像生成 |
| `/home/storyboard` | StoryboardPage | 分镜制作 |
| `/home/video` | VideoPage | 视频生成 |
| `/home/settings` | SettingsPage | 系统设置 |
| `/home/api-monitor` | ApiMonitorPage | API 监控 |
| `/home/project/:id` | ProjectPage | 项目详情 |
| `/agent` | AgentPage | Agent 对话创作 |
| `/studio` | StudioPage | Studio 长篇工作台 |
| `/short-video` | ShortVideoWorkbenchPage | 短视频工作台 |
| `/digital-human` | DigitalHumanWorkbenchPage | 数字人工作台 |
| `/auth` | AuthPage | 登录/注册 |
| `/workspace/dashboard` | WorkspaceDashboardPage | 协作仪表盘 |
| `/workspace/okr` | WorkspaceOkrPage | OKR 管理 |

---

## 后端 API 概览

后端提供 **150+ REST API** 端点，主要分组：

| 分组 | 前缀 | 说明 |
|------|------|------|
| **Agent** | `/api/agent/*` | Agent 全流程：项目规划、元素生成、画面生成 (SSE)、视频生成 (SSE)、音频生成、流水线执行、音频时间轴 |
| **Studio** | `/api/studio/*` | Studio 全流程：系列/卷/集 CRUD、元素管理、镜头管理、批量生成 (SSE)、历史回滚、设置、提示词工具、导出导入 |
| **认证** | `/api/auth/*` | 注册、登录、JWT 刷新、密码管理 |
| **工作区** | `/api/workspaces/*` | 工作区 CRUD、成员管理、OKR、集分配、撤销/重做、WebSocket |
| **设置** | `/api/settings`, `/api/module/settings` | Agent & Module 配置管理 |
| **生成** | `/api/generate-*`, `/api/parse-story` | 独立模块生成（图像/视频/故事解析） |
| **存储** | `/api/projects/*`, `/api/scripts/*` | 项目 & 剧本 CRUD |
| **导出** | `/api/export/*`, `/api/import` | ZIP 导出导入 |
| **监控** | `/api/monitor/*` | API 用量追踪、预算、健康探测 |
| **TTS** | `/api/tts/*`, `/api/fish/*` | 语音合成、Fish Audio 模型管理 |
| **上传** | `/api/upload*` | 文件上传（音频/图片/文档） |
| **自定义服务商** | `/api/custom-providers/*` | 自定义 AI 服务商管理 |

---

## 构建与打包

```bash
# 前端构建
npm run build

# 后端打包为单文件 exe（PyInstaller）
npm run python:build

# Electron 桌面应用打包（Windows x64 NSIS 安装包）
npm run dist:win
```

产物输出至 `dist-electron/` 目录。

---

## NPM Scripts

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 前端开发服务器 (端口 5174) |
| `npm run build` | 构建前端生产包 |
| `npm run start` | 一键启动前后端 (PowerShell) |
| `npm run start:all` | 并行启动后端 + 前端 |
| `npm run electron:dev` | Electron 开发模式 |
| `npm run electron:build` | 构建 Electron 应用 |
| `npm run dist:win` | 打包 Windows 安装程序 |
| `npm run python:dev` | 启动后端开发服务器 (端口 18001) |
| `npm run python:build` | PyInstaller 打包后端 |

---

## 安全说明

以下文件已添加到 `.gitignore`，不会提交到 Git 仓库：

- `settings.local.yaml` — Agent 运行时配置（含 API Key）
- `module.settings.local.yaml` — Module 运行时配置
- `studio.settings.local.yaml` — Studio 运行时配置
- `custom_providers.local.yaml` — 自定义服务商配置
- `backend/data/studio.db` — Studio SQLite 数据库
- `backend/data/projects/` — 项目数据文件

使用 `.example` 文件作为配置模板，**切勿**将包含真实 API Key 的文件提交到公开仓库。

---

## 开发文档

| 文档 | 说明 |
|------|------|
| [BUILD.md](docs/BUILD.md) | 构建与打包指南 |
| [studio-module-design.md](docs/studio-module-design.md) | Studio 工作台架构设计 |
| [studio-improvement-plan.md](docs/studio-improvement-plan.md) | Studio 改进路线图 |
| [开发文档.md](docs/开发文档.md) | 综合开发文档 |
| [前端开发文档.md](docs/前端开发文档.md) | 前端开发文档 |
| [分镜脚本优化.md](docs/分镜脚本优化.md) | 分镜脚本优化方案 |
| [视频制作流程优化.md](docs/视频制作流程优化.md) | 视频制作流程优化 |
| [音频agent脚本解析.md](docs/音频agent脚本解析.md) | 音频 Agent 脚本解析 |
| [API监控-火山配额配置与使用.md](docs/API监控-火山配额配置与使用.md) | API 监控与火山引擎配额 |
| [精细化提示词集成规划.md](docs/精细化提示词集成规划.md) | 提示词精细化集成规划 |

---

## 许可证

MIT License &copy; 2024-2026 AI Storyboarder Team
