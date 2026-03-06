# Waoowaoo 项目分析与主项目适配集成总规划

> 基于对 waoowaoo（demo 项目）的全面分析，结合主项目 AI Storyboarder 现状，整合形成的完整适配集成方案。
>
> 日期：2026-03-04

---

## 目录

1. [项目概况对比](#一项目概况对比)
2. [Agent 角色体系对比与整合方案](#二agent-角色体系对比与整合方案)
3. [提示词模板系统分析与移植计划](#三提示词模板系统分析与移植计划)
4. [故事脚本/角色解析拆解流程](#四故事脚本角色解析拆解流程)
5. [LLM 流式对话输出适配方案](#五llm-流式对话输出适配方案)
6. [数据模型与任务系统对比](#六数据模型与任务系统对比)
7. [前端局部改造方案](#七前端局部改造方案)
8. [发现的问题清单](#八发现的问题清单)
9. [总体实施路线图](#九总体实施路线图)

---

## 一、项目概况对比

| 维度 | 主项目 AI Storyboarder | waoowaoo |
|------|----------------------|----------|
| **定位** | AI 视频分镜制作桌面工具 | AI 小说推广视频 SaaS 平台 |
| **前端** | React 18 + Vite 5 + Zustand + Electron | Next.js 15 + React 19 + React Query |
| **后端** | Python FastAPI + Uvicorn | Next.js API Routes + Prisma |
| **存储** | SQLite + YAML | PostgreSQL + Prisma ORM |
| **任务队列** | arq + Redis（可选） | BullMQ + Redis |
| **AI SDK** | OpenAI Python SDK 直接调用 | Vercel AI SDK (`ai` + `@ai-sdk/openai`) |
| **流式传输** | SSE (Server-Sent Events) | ReadableStream + streamObject |
| **工作模式** | Agent 对话式 + Studio 工作台 + 独立模块 | Stage 阶段制流水线 |
| **Agent 数量** | 16 个（两套体系并存） | 10 个 Agent + 15 个功能提示词 |
| **提示词数量** | 11 个 | 27 个 |

---

## 二、Agent 角色体系对比与整合方案

### 2.1 现有 Agent 全景对比

#### 主项目 Agent 体系

**体系 A — Agent 服务层**（面向用户的对话式 AI）：

| # | 角色 | 职责 |
|---|------|------|
| 1 | YuanYuan 视频制作助手 | 对话式全流程引导 |
| 2 | YuanYuan 总管模式 | 日常聊天+项目总管 |
| 3 | 剧本医生 | 优化剧本 hook/高潮/节奏 |
| 4 | 音频节奏剪辑师 | 配音贴合目标时长 |
| 5 | 镜头资产拆解助手 | 从分镜补齐缺失元素 |
| 6 | 项目规划生成 | 一步生成完整项目规划 |

**体系 B — Studio 多 Agent 编排**（自动化生产流水线）：

| # | role_id | 角色 | 部门 | 模型层级 |
|---|---------|------|------|---------|
| 1 | `producer` | 制片人 | executive | tier1(Opus) |
| 2 | `world_builder` | 世界观构建 | story | tier2(Sonnet) |
| 3 | `character_developer` | 角色开发 | story | tier2(Sonnet) |
| 4 | `dialogue_writer` | 对话编剧 | story | tier2(Sonnet) |
| 5 | `storyboard_writer` | 分镜编剧 | story | tier2(Sonnet) |
| 6 | `prompt_compositor` | 提示词组装 | visual | tier3(Sonnet) |
| 7 | `narrative_qa` | 叙事QA | tech | tier2(Sonnet) |
| 8 | `visual_qa` | 视觉QA | tech | tier2(Sonnet) |
| 9 | `prompt_qa` | 提示词QA | tech | tier4(Haiku) |
| 10 | `state_manager` | 剧情状态管理 | tech | tier4(Haiku) |

#### waoowaoo Agent 体系

| # | Agent | 职责 |
|---|-------|------|
| 1 | `agent_character_profile` | 从原文提取角色档案（S/A/B/C/D层级，子形象识别） |
| 2 | `agent_character_visual` | 角色视觉描述生成（层级化字数，禁止规则） |
| 3 | `agent_clip` | 文本预分割（内容元素计数，智能切片） |
| 4 | `agent_storyboard_plan` | 分镜规划（人物连续性/空间锚定/对话规则） |
| 5 | `agent_storyboard_detail` | 镜头语言设计（景别/运镜/video_prompt） |
| 6 | `agent_storyboard_insert` | 分镜间插入过渡镜头 |
| 7 | `agent_cinematographer` | 摄影指导（灯光/景深T值/色调） |
| 8 | `agent_acting_direction` | 表演指导（表情/肢体/微动作） |
| 9 | `agent_shot_variant_analysis` | 镜头变体分析（5-8种创意方案） |
| 10 | `agent_shot_variant_generate` | 镜头变体图像生成 |

另有 15 个功能性提示词：`episode_split`, `screenplay_conversion`, `voice_analysis`, `character_create/modify/regenerate`, `location_create/modify/regenerate`, `select_location`, `single_panel_image`, `storyboard_edit`, `image_prompt_modify`, `character/location_description_update`

### 2.2 逐项功能对比

| 功能领域 | waoowaoo | 主项目 | 谁更强 | 差距 |
|---------|---------|-------|--------|------|
| 制片/总管 | 无独立角色 | `producer` + YuanYuan | 主项目 | — |
| 世界观构建 | 无 | `world_builder` | 主项目独有 | — |
| 角色档案提取 | `agent_character_profile`（极精细） | `character_developer`（偏创作） | waoowaoo | 巨大 |
| 角色视觉设计 | `agent_character_visual`（专业） | 无独立 Agent | waoowaoo独有 | 缺失 |
| 对话编写 | 无 | `dialogue_writer` | 主项目独有 | — |
| 文本预切片 | `agent_clip`（元素计数） | 无 | waoowaoo独有 | 缺失 |
| 剧本转换 | `screenplay_conversion`（248行） | 无 | waoowaoo独有 | 缺失 |
| 分镜规划 | `agent_storyboard_plan`（323行） | `storyboard_writer` | waoowaoo | 巨大 |
| 镜头语言 | `agent_storyboard_detail`（181行） | 无独立 Agent | waoowaoo独有 | 缺失 |
| 摄影指导 | `agent_cinematographer`（134行） | 无 | waoowaoo独有 | 缺失 |
| 表演指导 | `agent_acting_direction`（90行） | 无 | waoowaoo独有 | 缺失 |
| 分镜插入 | `agent_storyboard_insert` | 无 | waoowaoo独有 | 缺失 |
| 镜头变体 | 分析+生成两个 Agent | 无 | waoowaoo独有 | 缺失 |
| 提示词组装 | 模板变量注入 | `prompt_compositor`（知识库） | 主项目 | — |
| 叙事QA | 无 | `narrative_qa` | 主项目独有 | — |
| 视觉QA | 无 | `visual_qa` | 主项目独有 | — |
| 提示词QA | 无 | `prompt_qa` | 主项目独有 | — |
| 状态管理 | 无 | `state_manager`（跨集/伏笔） | 主项目独有 | — |
| 剧本医生 | 无 | 剧本优化 Agent | 主项目独有 | — |
| 音频分析 | `voice_analysis`（台词/情绪/多音字） | `duration_fit`（时长适配） | 互补 | — |
| 场景提取 | `select_location`（全景空间版） | 无独立模板 | waoowaoo独有 | 缺失 |
| 模型分级 | 无 | 4层分级 Opus/Sonnet/Sonnet/Haiku | 主项目 | — |

### 2.3 协作模式对比

| 维度 | waoowaoo | 主项目 |
|------|---------|-------|
| 编排模式 | DAG 图执行 + Worker，固定流水线 | AgentMessageBus 消息总线 + Pipeline |
| Agent 通信 | 无（通过 checkpoint 传状态） | 结构化消息总线 |
| QA 反馈循环 | 无 | narrative_qa/visual_qa 可触发修订 |
| 中断恢复 | checkpoint + 事件溯源，完整支持 | PipelineState.stages_remaining |
| 前端同步 | SSE + REST 拉增量事件 | 回调函数 on_progress |

### 2.4 整合方案

合并后的目标 Agent 体系（20+ 角色）：

```
保留主项目的：                         吸收 waoowaoo 的：
├── producer 制片人决策                 ├── agent_character_profile 角色提取 [新增]
├── world_builder 世界观                ├── agent_character_visual 视觉设计 [新增]
├── character_developer 角色开发         ├── agent_clip 文本切片 [新增]
├── dialogue_writer 对话编剧            ├── screenplay_conversion 剧本转换 [新增]
├── storyboard_writer 分镜编剧          ├── agent_storyboard_plan 分镜规划 [增强替代]
├── prompt_compositor 提示词组装         ├── agent_storyboard_detail 镜头语言 [新增]
├── narrative_qa 叙事质检               ├── agent_cinematographer 摄影指导 [新增]
├── visual_qa 视觉质检                  ├── agent_acting_direction 表演指导 [新增]
├── prompt_qa 安全检测                  ├── agent_shot_variant_* 镜头变体 [新增]
├── state_manager 跨集状态              ├── voice_analysis 配音分析 [新增]
├── PromptAssembler 知识库引擎          ├── select_location 场景提取 [新增]
├── PromptSentinel 安全检测             ├── episode_split 剧集分割 [新增]
├── 帧级控制系统 (START/KEY/END)        └── 角色/场景 CRUD 系列 [新增]
├── 剧本医生 / 资产补全 / 时长适配
├── 4层模型分级策略
└── AgentMessageBus 消息总线
```

---

## 三、提示词模板系统分析与移植计划

### 3.1 waoowaoo 提示词完整清单（27 个）

#### Agent 提示词（10 个）

| 模板 | 用途 | 行数 | 输入变量 | 输出格式 |
|------|------|------|---------|---------|
| `agent_character_profile` | 角色档案提取 | ~245 | `{characters_lib_info}`, `{input}` | JSON: new/updated_characters |
| `agent_character_visual` | 角色视觉设计 | ~209 | `{character_profiles}` | JSON: characters[appearances[descriptions]] |
| `agent_clip` | 文本预分割 | ~79 | `{input}`, `{locations_lib_name}`, `{characters_lib_name}`, `{characters_introduction}` | JSON: [{start, end, summary, location, characters}] |
| `agent_storyboard_plan` | 分镜规划 | ~323 | `{characters_lib_name}`, `{locations_lib_name}`, `{characters_introduction}`, `{characters_appearance_list}`, `{characters_full_description}`, `{clip_json}`, `{clip_content}` | JSON: [{panel_number, description, characters, location, scene_type}] |
| `agent_storyboard_detail` | 镜头语言设计 | ~181 | `{panels_json}`, `{characters_age_gender}`, `{locations_description}` | JSON: 为每个分镜补充 shot_type/camera_move/video_prompt |
| `agent_storyboard_insert` | 分镜插入 | ~90 | `{prev_panel_json}`, `{next_panel_json}`, `{user_input}`, `{characters_full_description}`, `{locations_description}` | JSON: 单个分镜 |
| `agent_cinematographer` | 摄影指导 | ~134 | `{panel_count}`, `{panels_json}`, `{locations_description}`, `{characters_info}` | JSON: [{lighting, characters_position, depth_of_field, color_tone}] |
| `agent_acting_direction` | 表演指导 | ~90 | `{panel_count}`, `{panels_json}`, `{characters_info}` | JSON: [{characters[{name, acting}]}] |
| `agent_shot_variant_analysis` | 镜头变体分析 | ~148 | `{panel_description}`, `{shot_type}`, `{camera_move}`, `{location}`, `{characters_info}` | JSON: [{title, description, shot_type, creative_score}] |
| `agent_shot_variant_generate` | 镜头变体生成 | ~82 | 多个变体参数 | 图像 |

#### 功能性提示词（17 个）

| 模板 | 用途 | 行数 |
|------|------|------|
| `episode_split` | 长文本分集 | ~95 |
| `screenplay_conversion` | 小说→剧本格式 | ~248 |
| `voice_analysis` | 台词/情绪/多音字分析 | ~116 |
| `character_create` | 角色创建 | ~54 |
| `character_modify` | 角色修改 | ~52 |
| `character_regenerate` | 角色重生成 | ~61 |
| `character_description_update` | 角色描述更新 | ~31 |
| `location_create` | 场景创建 | ~31 |
| `location_modify` | 场景修改 | ~65 |
| `location_regenerate` | 场景重生成 | ~42 |
| `location_description_update` | 场景描述更新 | ~37 |
| `select_location` | 场景资产提取 | ~136 |
| `single_panel_image` | 单面板图像生成 | ~66 |
| `storyboard_edit` | 分镜编辑 | ~12 |
| `image_prompt_modify` | 图片提示词修改 | ~39 |
| `character_image_to_description` | 图片反推角色描述 | ~37 |
| `character_reference_to_sheet` | 参考图转设定图 | ~29 |

### 3.2 主项目现有提示词（11 个）

| 模板 | 用途 | 来源文件 |
|------|------|---------|
| Agent 系统提示词 | YuanYuan 人设 | prompts.yaml / prompts.py |
| 总管模式提示词 | 日常聊天引导 | prompts.py |
| 项目规划提示词 | 一步生成项目规划 | prompts.yaml |
| 剧本医生 | 优化剧本节奏 | prompts.py |
| 时长适配 | 配音贴合时长 | prompts.py |
| 资产补全 | 从分镜补齐元素 | prompts.py |
| 首帧/关键帧/尾帧系统提示词 | 帧级画面控制 | prompt_templates.py |
| 帧级用户提示词 | 帧级具体描述 | prompt_templates.py |
| PromptAssembler | 知识库取词组装 | prompt_assembler.py |
| PromptSentinel | 安全检测改写 | prompt_sentinel.py |

### 3.3 缺口分析

**waoowaoo 有而主项目没有的（核心缺口）**：

| 缺口 | 影响 | 严重度 |
|------|------|--------|
| 角色档案提取模板 | 无法自动从原文精准提取角色 | 极高 |
| 角色视觉设计模板 | 无层级化视觉描述生成 | 极高 |
| 专业分镜规划模板 | 缺乏人物连续性/空间锚定等专业规则 | 极高 |
| 镜头语言设计模板 | 无景别/运镜/video_prompt 自动设计 | 高 |
| 摄影指导模板 | 无灯光/景深/色调规划 | 高 |
| 剧本转换模板 | 无法将小说转为标准剧本格式 | 高 |
| 文本预分割模板 | 无法智能切片长文本 | 高 |
| 场景提取模板 | 无法自动从文本提取场景资产 | 高 |
| 配音分析模板 | 无台词情绪分析和多音字处理 | 高 |
| 表演指导模板 | 无角色表演细节设计 | 中 |
| 角色/场景 CRUD 模板 | 缺乏标准化操作模板 | 中 |
| 镜头变体/分镜插入 | 缺乏创意辅助能力 | 中 |

**主项目有而 waoowaoo 没有的（应保留）**：

| 能力 | 说明 |
|------|------|
| PromptAssembler 知识库组装引擎 | 结构化取词，比模板变量注入更灵活 |
| PromptSentinel 安全检测 | 100+ 规则的安全化改写系统 |
| 帧级提示词系统 | START/KEY/END_FRAME 精细控制 |
| 剧本医生 | 优化已有项目 |
| 音频时长适配 | 配音贴合目标时长 |
| 资产补全 | 自动补齐缺失元素 |

### 3.4 移植优先级

| 优先级 | 提示词 | 移植难度 | 说明 |
|--------|--------|---------|------|
| **P0** | `agent_storyboard_plan` | 高 | 核心分镜规划，需适配 Segment/Shot 结构 |
| **P0** | `agent_character_profile` | 中 | 角色提取基础，需对齐 Element 系统 |
| **P0** | `agent_character_visual` | 中 | 视觉描述生成，需与 PromptAssembler 整合 |
| **P1** | `agent_storyboard_detail` | 高 | 需适配帧级提示词和 video_prompt |
| **P1** | `agent_cinematographer` | 高 | 需与 PromptAssembler 的 cinematography 注入整合 |
| **P1** | `screenplay_conversion` | 中-高 | 需适配 segments/content 结构 |
| **P1** | `agent_clip` | 中-高 | 作为 Pipeline 前置步骤 |
| **P1** | `select_location` | 中 | 需对齐 Element(type=scene) |
| **P2** | `voice_analysis` | 中 | 需对齐 shot 结构和 TTS 系统 |
| **P2** | `agent_acting_direction` | 中-高 | 需定义 acting 数据存储位置 |
| **P2** | `episode_split` | 低-中 | 变量简单替换即可 |
| **P2** | 角色/场景 CRUD 系列（6个） | 低 | 通用模板，可直接移植 |
| **P3** | `agent_storyboard_insert` | 中 | 需适配 shot 序列管理 |
| **P3** | `agent_shot_variant_*` | 中 | 需定义变体系统位置 |
| **P3** | 其他辅助模板（5个） | 低 | 直接可用 |

### 3.5 移植策略

**原则：保留主项目架构优势，注入 waoowaoo 专业模板内容**

具体做法：
1. 在 `backend/data/` 下新建 `prompts/` 目录，按功能分类存放独立提示词文件
2. 将 waoowaoo 的 `.zh.txt` 模板转换为主项目可用的 Python 字符串或 YAML 格式
3. 将变量占位符从 `{xxx}` 统一为 Python f-string 或 `.format()` 风格
4. 新增的 Agent 角色注册到 Studio 的 `agent_roles.py` 中，分配模型层级
5. 新增的 Pipeline 阶段注册到 `agent_pipeline.py` 中

---

## 四、故事脚本/角色解析拆解流程

### 4.1 waoowaoo 的完整流水线

```
用户输入小说/剧本
    │
    ▼
[episode_split] ── 将长文拆分为多个 Episode（集/幕）
    │                 按叙事节奏/场景转换/字数均衡切分
    │                 输出：{episodes: [{title, summary, startMarker, endMarker}]}
    │
    ▼
[screenplay_conversion] ── 将叙事文本转为标准影视剧本格式
    │                        100% 忠实原文，格式转换不是创作
    │                        输出：{scenes: [{heading, description, content}]}
    │
    ▼
[agent_character_profile] ── 提取所有角色档案
    │                          S/A/B/C/D 重要性层级
    │                          识别子形象（换装/年龄变化）
    │                          输出：{new_characters: [...], updated_characters: [...]}
    │
    ▼
[agent_character_visual] ── 为每个角色生成视觉描述
    │                         按层级控制描述字数和精度
    │                         禁止肤色/表情/背景等干扰词
    │                         输出：{characters: [{appearances: [{descriptions}]}]}
    │
    ▼
[Image Generation] ── 生成角色立绘/设定图
    │
    ▼
[select_location] ── 从文本提取/创建场景地点
    │                   全景空间版描述（前中背景层次）
    │                   输出：{locations: [{name, descriptions}]}
    │
    ▼
[Image Generation] ── 生成场景图
    │
    ▼
[voice_analysis] ── 分析台词，匹配角色音色
    │                  提取对话、情绪强度量化、镜头匹配
    │                  多音字 TTS 替换处理
    │
    ▼
[agent_clip] ── 文本按场景切片（批次化处理）
    │              "内容元素"计数（动作=1, 对话=2）
    │
    ▼
[agent_storyboard_plan] ── 规划镜头序列
    │                        人物连续性规则
    │                        空间锚定规则
    │                        对话强制口型同步规则
    │
    ▼
[agent_storyboard_detail] ── 补充镜头语言
    │                          景别(shot_type)/运镜(camera_move)/video_prompt
    │                          动态优先原则（禁止纯静态描述）
    │
    ▼
[agent_cinematographer] ── 设计摄影参数
    │                        灯光方向/质感、景深T值、色调
    │                        对话镜头景深口型规则
    │
    ▼
[agent_acting_direction] ── 添加表演指导
    │                         按 scene_type 匹配表演风格
    │                         表情/肢体/微动作/视线
    │
    ▼
[Image Generation] ── 批量生成分镜画面
    │
    ▼
[Video Generation] ── 生成视频 + TTS 音频
    │
    ▼
最终产出
```

### 4.2 主项目当前流程对比

```
用户对话 / 输入需求
    │
    ▼
[YuanYuan Agent 对话] ── 理解需求
    │
    ▼
[project_planning_prompt] ── 一步生成完整项目规划
    │                          (creative_brief + elements + segments/shots)
    │
    ▼
[Element 图像生成] ── 生成角色/场景图
    │
    ▼
[帧级提示词系统] ── START/KEY/END_FRAME 分别生成
    │
    ▼
[视频生成] ── SSE 流式进度
    │
    ▼
[音频生成] ── TTS + 时长适配
```

### 4.3 差距分析

主项目缺少的关键环节：
1. **长文本智能分割**（episode_split + agent_clip）
2. **小说→剧本格式转换**（screenplay_conversion）
3. **角色精准提取与层级化视觉描述**（agent_character_profile + agent_character_visual）
4. **场景自动提取与空间化描述**（select_location）
5. **分步骤的专业分镜流水线**（plan → detail → cinematography → acting）
6. **配音分析与多音字处理**（voice_analysis）

### 4.4 Drama 示例文件特征

waoowaoo 的 `docs/drama示例/` 包含完整范例：

- **人物设定卡**（Markdown 结构）：每角色包含"面容五官"、"发型发色"、"服装配饰"、"通用正面/负面提示词"等字段
- **宣传片脚本**：分 Scene，每个含 FADE IN、场景标头、动作描写、对白、镜头指示
- **视觉规范**：整体风格基调、色彩体系、角色设计规范、场景类型规范、光影渲染参数
- **完整剧本**：《全知读者视角》原文文本，作为分镜生成的源素材

---

## 五、LLM 流式对话输出适配方案

### 5.1 waoowaoo 的实现方式

```
技术栈：Vercel AI SDK (`ai` + `@ai-sdk/openai`)

后端（Next.js API Route）：
  streamObject({
    model: openai(modelId),
    schema: zodSchema,        // Zod 定义结构化输出
    prompt: assembledPrompt,
  })
  → result.toTextStreamResponse()

前端：
  fetch('/api/...') → response.body.getReader() → TextDecoder 逐块解析
  支持"边生成边渲染"结构化 JSON
```

关键特点：
- **streamObject**：流式生成结构化 JSON（如角色列表），前端可实时渲染部分结果
- **统一适配层**：`createOpenAI({ baseURL, apiKey })` 适配所有 OpenAI 兼容服务商
- **事件协议**：流中包含 `delta/progress/complete/error` 结构化事件

### 5.2 主项目当前实现

```
技术栈：OpenAI Python SDK + FastAPI SSE

后端：
  async for chunk in openai_client.chat.completions.create(stream=True):
      yield f"data: {json.dumps(...)}\n\n"
  → StreamingResponse(event_generator(), media_type="text/event-stream")

前端：
  EventSource / fetch + 手动解析 SSE
```

### 5.3 差异与适配建议

| 维度 | waoowaoo | 主项目 | 适配方向 |
|------|---------|-------|---------|
| AI SDK | Vercel AI SDK | OpenAI Python SDK | 保持 Python SDK，增加封装 |
| 流式方式 | ReadableStream / streamObject | SSE | 保持 SSE，增加结构化流式 |
| 结构化流式 | 原生 `streamObject` | 需手动拼接 JSON | **新增能力** |
| 前端消费 | `getReader()` + TextDecoder | EventSource / fetch SSE | 增加增量 JSON 拼接 |

### 5.4 具体实施方案

**后端改造**：在 `llm_service.py` 中新增结构化流式输出方法：

```python
async def stream_structured_output(prompt, schema_description, model_config):
    """类似 Vercel AI SDK 的 streamObject，流式生成结构化 JSON"""
    accumulated = ""
    async for chunk in openai_client.chat.completions.create(
        model=model_config.model,
        messages=[{"role": "user", "content": prompt}],
        stream=True,
        response_format={"type": "json_object"}
    ):
        delta = chunk.choices[0].delta.content
        if delta:
            accumulated += delta
            yield {"type": "delta", "content": delta, "accumulated": accumulated}
    yield {"type": "complete", "content": accumulated}
```

**SSE 端点包装**：

```python
@router.get("/api/agent/stream/{task_type}")
async def stream_agent_task(task_type: str, request: Request):
    async def event_generator():
        async for event in stream_structured_output(prompt, schema, config):
            yield f"data: {json.dumps(event)}\n\n"
    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

**前端改造**：在现有 fetch SSE 基础上增加增量 JSON 拼接能力：

```typescript
// services/api.ts 新增
export async function consumeStructuredStream<T>(
  url: string,
  onDelta: (partial: Partial<T>) => void,
  onComplete: (result: T) => void
) {
  const response = await fetch(url);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // 解析 SSE 事件，尝试 JSON.parse 部分结果
    // 调用 onDelta 实时更新 UI
  }
}
```

---

## 六、数据模型与任务系统对比

### 6.1 数据模型对比

| 概念 | waoowaoo (Prisma/PostgreSQL) | 主项目 (SQLite/YAML) | 差异 |
|------|---------------------------|---------------------|------|
| 项目 | Project | AgentProject (YAML) / Series (SQLite) | waoowaoo 用关系型DB |
| 集/幕 | Episode | Episode / Segment | 类似 |
| 分镜 | Storyboard/Panel | Shot | waoowaoo 的 Panel 更细化 |
| 角色 | Character + Appearance[] | Element (type=character) | waoowaoo 支持多外观 |
| 场景 | Location | Element (type=scene) | waoowaoo 独立建模 |
| 音频 | VoiceLine + Clip | audio_url + audio_timeline | waoowaoo 更结构化 |
| 全局资产 | AssetHub | 无 | waoowaoo 独有 |

### 6.2 任务系统对比

| 维度 | waoowaoo | 主项目 |
|------|---------|-------|
| 队列 | BullMQ + Redis | arq + Redis（可选） |
| 状态流转 | pending → active → completed/failed | pending → running → completed/failed |
| 事件记录 | graph_events 表（完整事件溯源） | 内存为主 |
| 并发控制 | 按任务类型配置 | generationQueueStore 前端控制 |
| 中断恢复 | checkpoint + afterSeq 增量拉取 | stages_remaining |

### 6.3 建议的数据模型增强

1. **角色增加 `appearances[]` 字段** — 支持多外观（换装/年龄变化）
2. **Shot 增加摄影/表演字段** — `cinematography`, `acting_direction`, `scene_type`
3. **新增 VoiceLine 独立表** — 从 audio_url 拆分为结构化台词数据
4. **考虑全局资产库** — 跨项目共享角色/场景/音色

---

## 七、前端局部改造方案

> UI 不做整体重构，在现有 Vite + React 18 + Zustand 技术栈下进行局部改造。

### 7.1 不做整体重构的理由

1. 技术栈差异太大（Vite+Electron vs Next.js），迁移等于重写
2. 产品形态不同（桌面端 vs SaaS），架构选择各有道理
3. 整体重构需 4-5 周，回归风险极高
4. waoowaoo 的核心优势是架构模式，完全可以在现有技术栈下实现

### 7.2 局部改造计划

| 优先级 | 改造项 | 预计工期 | 具体内容 |
|--------|--------|---------|---------|
| **P0** | 拆分巨型组件 | 3-5 天 | AgentPage(4835行) 和 StudioPage(4508行) 拆分：创建 Controller Hook + 独立面板组件，每个文件 ≤ 500 行 |
| **P1** | 引入 Stage 阶段导航 | 2-3 天 | AgentPage 顶部增加阶段导航条（brief→storyboard→elements→frames→videos→audio），按阶段切换面板 |
| **P2** | 引入 React Query | 3-4 天 | 安装 @tanstack/react-query，将 store 中的 CRUD 操作迁移到 query hooks，Zustand 仅保留 UI 状态 |
| **P3** | Runtime Context 分层 | 1-2 天 | 创建 AgentWorkspaceProvider / StudioWorkspaceProvider，子组件通过 Context 获取基础能力 |

---

## 八、发现的问题清单

### 8.1 主项目现有问题

| # | 问题 | 严重度 | 来源 |
|---|------|--------|------|
| 1 | 端口不一致：Electron main.js 默认 8001，启动脚本用 18001 | 中 | 构建审查 |
| 2 | 版本号不一致：splash.html v0.1.0-beta.1 vs package.json 1.0.0-beta | 低 | 构建审查 |
| 3 | 缺少 .ico 图标：build/ 仅有 SVG | 中 | 构建审查 |
| 4 | dist/ 已提交 Git：构建产物应在 .gitignore 中排除 | 低 | 构建审查 |
| 5 | `nul` 文件：根目录和 backend/ 下存在 Windows 误创建文件 | 低 | 构建审查 |
| 6 | 代码签名未配置：发布时触发 SmartScreen 警告 | 低 | 构建审查 |
| 7 | CORS 全开放：`allow_origins=["*"]`，生产需收紧 | 中 | 后端审查 |
| 8 | AgentPage.tsx 4835 行巨型组件 | 高 | 前端审查 |
| 9 | StudioPage.tsx 4508 行巨型组件 | 高 | 前端审查 |
| 10 | Agent 两套体系并存未统一 | 中 | Agent 审查 |

### 8.2 适配过程中需注意的风险

| # | 风险 | 应对措施 |
|---|------|---------|
| 1 | 提示词移植后输出格式与主项目数据结构不匹配 | 先做格式适配映射层，再移植 |
| 2 | 新增 Pipeline 阶段与现有流程冲突 | 新阶段作为可选增强，不破坏现有流程 |
| 3 | 结构化流式输出增加前端复杂度 | 封装通用 consumeStructuredStream 工具函数 |
| 4 | 模型调用成本增加（Agent 数量翻倍） | 严格执行 4 层模型分级策略 |

---

## 九、总体实施路线图

### Phase 1 — 基础设施（1-2 周）

- [ ] 新建 `backend/data/prompts/` 提示词目录结构
- [ ] 在 `llm_service.py` 增加结构化流式输出方法
- [ ] 在 `agent_roles.py` 中注册新 Agent 角色和模型层级
- [ ] 前端新增 `consumeStructuredStream` 工具函数
- [ ] 修复已知问题（端口不一致、nul 文件、版本号等）

### Phase 2 — P0 提示词移植（1-2 周）

- [ ] 移植 `agent_storyboard_plan` → 增强分镜规划能力
- [ ] 移植 `agent_character_profile` → 增加角色精准提取
- [ ] 移植 `agent_character_visual` → 增加层级化视觉描述
- [ ] 将移植的提示词接入 Pipeline 并验证

### Phase 3 — P1 提示词 + 前端改造（2-3 周）

- [ ] 移植 `agent_storyboard_detail`、`agent_cinematographer`
- [ ] 移植 `screenplay_conversion`、`agent_clip`、`select_location`
- [ ] 前端：拆分 AgentPage/StudioPage 巨型组件
- [ ] 前端：引入 Stage 阶段导航

### Phase 4 — P2 提示词 + 数据模型增强（2 周）

- [ ] 移植 `voice_analysis`、`agent_acting_direction`、`episode_split`
- [ ] 移植角色/场景 CRUD 系列提示词
- [ ] 数据模型增强（角色多外观、Shot 摄影/表演字段、VoiceLine）
- [ ] 前端：引入 React Query

### Phase 5 — P3 创意增强 + 收尾（1-2 周）

- [ ] 移植镜头变体系统
- [ ] 移植分镜插入能力
- [ ] 统一 Agent 两套体系
- [ ] 全链路测试和优化

---

## 附录：关键文件路径

### waoowaoo 项目
```
d:\新建文件夹 (3)\waoowaoo-main\waoowaoo-main\
├── lib/prompts/novel-promotion/    # 25 个提示词模板
├── lib/prompts/character-reference/ # 2 个角色参考模板
├── src/lib/run-runtime/            # 图执行器、流水线、运行时服务
├── src/lib/workers/handlers/       # 13+ 任务处理器
├── docs/ai-runtime/                # AI 运行时架构文档（8个）
├── docs/drama示例/                 # 全知读者视角完整范例
├── docs/WORKFLOW_LOGIC_FULL.md     # 完整工作流逻辑
└── AGENTS.md                       # Agent 定义
```

### 主项目
```
D:\MIN\test1\test1\ai001\
├── backend/services/agent/prompts.py       # Agent 提示词
├── backend/services/agent/models.py        # Agent 数据模型
├── backend/services/studio/agent_roles.py  # Studio Agent 角色
├── backend/services/studio/agent_pipeline.py # Agent 流水线
├── backend/services/studio/agent_protocol.py # Agent 协议
├── backend/services/studio/prompt_templates.py # 帧级提示词
├── backend/services/studio/prompt_assembler.py # 提示词组装
├── backend/services/studio/prompt_sentinel.py  # 安全检测
├── backend/services/agent_service.py       # Agent 核心服务
├── backend/data/prompts.yaml               # 提示词配置
├── src/pages/AgentPage.tsx                 # Agent 页面（4835行）
└── src/pages/StudioPage.tsx                # Studio 页面（4508行）
```
