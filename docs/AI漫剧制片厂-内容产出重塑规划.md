# AI 漫剧制片厂
## 内容产出模块重塑规划

> 基于 Claude API 多智能体编排 · 电影级生产流水线架构设计

| | |
|---|---|
| 版本 | v1.0 Draft |
| 日期 | 2025年3月 |
| 状态 | **待项目代码审阅后更新** |

---

## 目录

1. [执行摘要](#一执行摘要)
2. [现状诊断与重塑必要性](#二现状诊断与重塑必要性)
3. [AI 制片工厂完整架构](#三ai-制片工厂完整架构)
4. [结构化提示词知识库设计](#四结构化提示词知识库设计)
5. [完整生产工作流](#五完整生产工作流)
6. [四阶段实施路线图](#六四阶段实施路线图)
7. [技术选型与模型分级策略](#七技术选型与模型分级策略)
8. [风险识别与缓解措施](#八风险识别与缓解措施)
9. [下一步行动](#九下一步行动)

---

## 一、执行摘要

> **背景**：现有项目已具备初步的 Agent 结构与剧本/故事生成模块，但角色划分不清晰，缺乏系统化的内容生产体系。本规划旨在以电影工业的组织逻辑为蓝本，对内容产出模块进行全面重塑。

> **目标**：构建一套基于 Claude API 多智能体编排的完整 AI 漫剧生产流水线——从故事创意到结构化提示词输出，形成可复用、可扩展、质量可控的「AI 制片工厂」。

> ⚠️ **核心判断**：制约当前 AI 漫剧系统质量上限的不是模型能力，而是：① 提示词知识库的领域深度；② 跨 Agent 状态一致性管理。这两点是本次重塑的地基。

**本规划涵盖：**

- AI 制片工厂完整组织架构设计（27+ Agent 角色）
- 三大部门的职责边界与协作协议
- 结构化提示词知识库设计规范
- 四阶段实施路线图（预计 4-6 个月）
- 技术选型与模型分级调用策略
- 风险识别与缓解措施

---

## 二、现状诊断与重塑必要性

### 2.1 现有系统的核心痛点

当前大多数 AI 漫剧系统（包括现有项目）普遍存在以下问题：

- **角色划分不清晰**：同一任务被多个模块重复处理，或无人负责，导致输出不稳定
- **提示词黑盒化**：Script Agent 输出剧情描述后直接丢给图像模型，缺乏结构化转化层
- **无状态记忆**：每次 LLM 调用独立，无法维持跨场景、跨集的角色与世界观一致性
- **缺乏质检机制**：没有独立的审核环节，生产侧和验收侧合而为一，等同于「自己审自己」
- **镜头语言缺失**：几乎所有开源工具都未系统化地将电影分镜语法注入提示词生成流程

### 2.2 重塑的核心逻辑

| 现有方式 | 重塑后 |
|---|---|
| 单一/模糊 Agent 链条 | 27+ 明确职责的专业 Agent |
| 自然语言指令传递 | 结构化 Agent 间通信协议 |
| 无状态调用 | 剧情状态数据库 + 共享记忆 |
| 提示词自由发挥 | 提示词知识库约束 + 取词组装 |
| 无质检环节 | 独立质检部门（直属制片人） |
| 角色随机漂移 | 角色档案库 + 多视角锚点 |

---

## 三、AI 制片工厂完整架构

### 3.1 总体组织架构

```
┌──────────────────────────────────────────────────────┐
│              ★  决策层  EXECUTIVE LAYER               │
│                                                      │
│   制片人 Agent（Producer）                            │
│   任务拆解 · 资源调度 · 进度管控 · 最终审批             │
│                                                      │
│   创意总监 Agent（Creative Director）                 │
│   艺术方向定调 · 风格一致性把关 · 跨部门创意仲裁        │
└──────────────────┬───────────────────────────────────┘
                   │
     ┌─────────────┼─────────────┐
     ↓             ↓             ↓
  DEPT A        DEPT B        DEPT C
  创作部       视觉制作部    技术&数据部
```

### 3.2 部门 A：创作部（Story Department）

创作部负责从用户原始创意到可执行分镜脚本的全链路内容生产，所有输出必须写入剧情状态数据库。

| Agent 角色 | 职责 | 模型 | 频率 |
|---|---|---|---|
| 首席编剧（Head Writer） | 统筹创作部，协调风格一致性，向制片人汇报 | claude-opus-4-6 | 低 |
| 世界观构建（World Builder） | 生成世界观圣经：地理/历史/文化/规则体系 | claude-sonnet-4-6 | 中 |
| 剧情架构（Plot Architect） | 三幕结构、节拍表、伏笔/呼应矩阵，输出大纲 | claude-sonnet-4-6 | 中 |
| 角色开发（Character Developer） | 人物弧光、角色关系图、性格词典，输出角色圣经 | claude-sonnet-4-6 | 中 |
| 对话编剧（Dialogue Writer） | 按角色性格写分场台词，维护语气风格一致性 | claude-sonnet-4-6 | 高 |
| 分镜脚本（Storyboard Writer） | 剧本→分镜描述，标注景别/角度/情绪/节奏 | claude-sonnet-4-6 | 高 |

### 3.3 部门 B：视觉制作部（Visual Production）

视觉制作部的核心职责是将创作部的文字输出转化为结构化提示词，驱动图像生成模型产出高一致性画面。**所有提示词必须从知识库「取词组装」，不允许自由发挥。**

| Agent 角色 | 职责 | 模型 | 频率 |
|---|---|---|---|
| 视觉总监（Visual Supervisor） | 统筹视觉风格，裁决创意争议，向制片人汇报 | claude-opus-4-6 | 低 |
| 角色设计（Character Designer） | 外形方案设计，多视角描述，表情/动作库 | claude-sonnet-4-6 | 中 |
| 角色提示词工程（Character Prompt Eng.） | 角色设计→精确提示词词条，维护角色档案库 | claude-sonnet-4-6 | 中 |
| 场景概念（Concept Artist） | 场景氛围方案、光线设计、色调规划 | claude-sonnet-4-6 | 中 |
| 场景提示词工程（Scene Prompt Eng.） | 场景概念→标准化背景提示词词条 | claude-sonnet-4-6 | 中 |
| 分镜提示词组装 ×N（Storyboard Compositor） | 从知识库取词，组装单格完整提示词，并行生产 | claude-sonnet-4-6 | 极高 |
| 镜头语言（Cinematography Agent） | 注入景别/角度/运镜/构图规范词条 | claude-haiku-4-5 | 高 |
| 情绪氛围（Mood & Tone Agent） | 匹配情绪包，注入色调/光效/特效词 | claude-haiku-4-5 | 高 |
| 排版合成（Layout Agent） | 分镜格排版、对话框位置、音效字设计 | claude-haiku-4-5 | 高 |
| 音效文案（Sound Design Writer） | 拟声词设计、背景音标注、音效节奏规划 | claude-haiku-4-5 | 高 |

### 3.4 部门 C：技术与数据部（Tech & Data）

技术与数据部是整个工厂的神经系统，不生产内容，但负责所有 Agent 的记忆、状态、资产管理与质量把关。**质检小组独立于生产侧，直接向制片人 Agent 汇报。**

| Agent 角色 | 职责 | 模型 | 频率 |
|---|---|---|---|
| 技术总监（Technical Director） | 统筹技术部，制定 Agent 间通信协议标准 | claude-sonnet-4-6 | 低 |
| 知识库管理（Knowledge Base Manager） | 提示词词典维护、版本控制、词条冲突检测 | claude-haiku-4-5 | 中 |
| 剧情状态管理（Story State Manager） | 全局剧情状态 DB 读写，角色状态追踪，时间线一致性 | claude-haiku-4-5 | 极高 |
| 资产注册（Asset Registry） | 已生成图像分类归档，资产版本管理与检索 | claude-haiku-4-5 | 高 |
| 叙事一致性审核（Narrative QA） | 【质检】剧情逻辑漏洞、伏笔回收、人物行为合理性 | claude-sonnet-4-6 | 高 |
| 视觉一致性审核（Visual QA） | 【质检】角色外貌跨格比对、服装道具一致性、场景连续性 | claude-sonnet-4-6 | 高 |
| 提示词规范审核（Prompt QA） | 【质检】提示词是否符合知识库标准、负向词是否完整 | claude-haiku-4-5 | 高 |
| 综合评分（Quality Scorer） | 【质检】多维度评分，不合格→生成修改指令→回传 | claude-sonnet-4-6 | 高 |
| 成本监控（Cost Monitor） | Token 用量追踪、模型分级策略、预算预警 | claude-haiku-4-5 | 极高 |
| 任务调度（Task Scheduler） | 并行任务编排、依赖关系管理、失败重试 | claude-haiku-4-5 | 极高 |
| 日志审计（Audit Logger） | 全链路决策记录、可回溯性保障、问题溯源 | claude-haiku-4-5 | 极高 |

---

## 四、结构化提示词知识库设计

> 提示词知识库是整个工厂的「宪法」——所有视觉生产 Agent 都只能从知识库取词组装，不允许自由发挥。这是保证跨帧、跨集、跨角色一致性的根本制度设计。

### 模块一：角色档案库（Character Cards）

每个角色拥有一份完整的提示词档案，所有生产 Agent 按档案取词，**禁止自行描述角色外貌**。

```yaml
character_card:
  id: "char_001"
  name: "主角名"
  appearance:
    hair: "long silver hair, flowing"
    eyes: "golden eyes, sharp gaze"
    skin: "fair skin"
    build: "slender, athletic build"
  costumes:
    default: "white school uniform, red ribbon"
    battle: "black tactical suit, silver armor pauldrons"
    casual: "oversized hoodie, ripped jeans"
  expressions:
    happy: "bright smile, closed eyes, blushing"
    angry: "furrowed brows, clenched teeth, veins"
    sad: "downcast eyes, trembling lips, tears"
    shocked: "wide eyes, open mouth, sweat drop"
    determined: "sharp eyes, firm expression, strong pose"
  signature_poses:
    idle: "arms crossed, slight smirk"
    battle: "low stance, one hand forward"
  negative_prompts: "wrong hair color, different eye shape, incorrect outfit"
```

### 模块二：镜头语言词典（Cinematography Dictionary）

这是目前市场上几乎完全空白的模块，也是影响画面叙事质量的核心变量。

**景别词条：**

| 景别 | 标识 | 用途 | 提示词词条 |
|---|---|---|---|
| 极特写 | ECU | 情绪爆发、细节强调 | `extreme close-up, face filling frame` |
| 特写 | CU | 表情、道具展示 | `close-up shot, head and shoulders` |
| 中近景 | MCU | 对话、情绪交流 | `medium close-up, chest up` |
| 中景 | MS | 动作、肢体语言 | `medium shot, waist up` |
| 远景 | LS | 环境交代、孤独感 | `long shot, full body, environment` |
| 大远景 | ELS | 史诗感、渺小感 | `extreme long shot, wide landscape` |

**角度词条：**

| 角度 | 提示词词条 | 情绪效果 |
|---|---|---|
| 俯视 | `high angle shot, bird's eye` | 渺小、压迫、弱势 |
| 仰视 | `low angle shot, worm's eye` | 强大、威压、英雄感 |
| 平视 | `eye level shot` | 平等、客观、日常 |
| 荷兰角 | `dutch angle, tilted frame` | 不安、失衡、疯狂 |
| 过肩镜 | `over-the-shoulder shot` | 对话、博弈、视角感 |

### 模块三：情绪氛围包（Mood Packs）

情绪包 = 色调词 + 线条风格词 + 特效词的**预制组合**，一键调用。

| 情绪 | 词条组合 |
|---|---|
| ⚡ 紧张 | `high contrast, sharp lines, motion blur, sweat drops, heavy shadow, speed lines` |
| 💕 温柔 | `soft focus, warm backlighting, pastel palette, flower petals, lens flare` |
| 💧 绝望 | `desaturated, heavy shadows, rain, broken panel border, monochrome accent` |
| 🔥 爽感 | `dynamic angle, speed lines, particle burst, gold rim light, dramatic pose` |
| 🌫️ 悬疑 | `low-key lighting, silhouette, fog, extreme close-up, cold color temperature` |
| 🌸 温馨 | `warm tones, dappled light, soft bokeh, cozy interior, natural shadows` |
| 😤 愤怒 | `harsh lighting, red tones, sharp shadows, cracked background, vein marks` |
| 😱 恐惧 | `cold blue tones, dark vignette, trembling lines, wide eyes, sweat` |

### 模块四：场景词典（Scene Dictionary）

```yaml
scene_dict:
  protagonist_home:
    base: "small apartment, warm lighting, cluttered desk, city view window"
    day: "sunlight streaming, dust particles, peaceful atmosphere"
    night: "lamp light, city lights outside, quiet and lonely"
  school_rooftop:
    base: "rooftop, fence railing, sky background, wind blowing"
    day: "blue sky, white clouds, bright sunlight"
    sunset: "orange sky, long shadows, dramatic silhouette"
  final_battle:
    base: "ruined cityscape, debris, dramatic sky"
    climax: "energy shockwave, lightning, epic scale, smoke and fire"
```

### 模块五：世界观词典（World Bible Prompts）

```yaml
world_bible:
  art_style: "manhwa style, webtoon, clean lines, vibrant colors"
  era: "near future, 2089, cyberpunk elements, traditional culture fusion"
  color_palette: "deep blues, neon accents, warm gold highlights"
  recurring_motifs: "cherry blossoms, glowing circuits, ancient runes"
  forbidden_elements: "western comic style, realistic photography, 3D render"
```

---

## 五、完整生产工作流

### 5.1 单集生产流程

```
用户输入（故事创意 / 小说文本）
            ↓
┌───────────────────────────────────┐
│  制片人 Agent 接收，拆解任务，分配  │
└──────────────────┬────────────────┘
                   ↓
┌───────────────────────────────────────────────────┐
│  创作部全链路                                       │
│  世界观 → 剧情架构 → 角色开发 → 对话编剧 → 分镜脚本  │
└──────────────────┬────────────────────────────────┘
                   ↓
         剧情状态 DB 写入（全量存档）
                   ↓
        叙事 QA 审核
        ├── 通过 ──────────────────────────────→ 继续
        └── 不通过 → 携带修改指令回传创作部 ↑
                   ↓
┌───────────────────────────────────────────────────┐
│  视觉制作部                                         │
│  角色/场景提示词工程 → 分镜提示词组装（并行×N）      │
│                    → 镜头语言注入 → 情绪氛围注入    │
└──────────────────┬────────────────────────────────┘
                   ↓
        提示词 QA 审核
        ├── 通过 ──────────────────────────────→ 继续
        └── 不通过 → 携带修改指令回传提示词工程师 ↑
                   ↓
       图像生成（ComfyUI / Flux / SD，非 Claude 层）
                   ↓
         资产注册（Asset Registry 归档）
                   ↓
        视觉 QA 审核
        ├── 通过 ──────────────────────────────→ 继续
        └── 不通过 → 修改提示词重新生图 ↑
                   ↓
        综合评分 Agent
        ├── 达标 ───────────────────────────────→ 后期
        └── 未达标 → 定向回传修改指令 ↑
                   ↓
       排版合成 + 音效文案
                   ↓
       创意总监最终审查 → 制片人 Agent 确认交付
                   ↓
              ✅ 输出成品
```

### 5.2 质检回路设计原则

质检部门独立于生产侧，直接向制片人 Agent 汇报，形成真正的「第三方验收」机制。

- **叙事 QA**：剧本完成后、视觉生产开始前介入，避免带着错误剧本批量生图的资源浪费
- **提示词 QA**：送图前拦截不合规提示词，这是成本最低的质量关口
- **视觉 QA**：图像生成后、后期合成前介入，只对画面质量负责
- **综合评分**：整合三个 QA 结论，给出量化评分，低于阈值不允许进入后期
- **所有不通过结果必须携带「修改指令」回传**，而非仅仅标记为「不合格」

---

## 六、四阶段实施路线图

### Phase 1 — 基础地基（第 1-4 周）

**核心任务：**
- 设计提示词知识库 Schema（五大模块）
- 用真实漫画案例填充知识库
- 搭建剧情状态数据库结构
- 确立 Agent 间通信协议规范

**交付物：** 知识库 Schema 文档 / 角色卡模板（3个示例角色）/ 状态 DB ER 图 / Agent 通信协议规范 v1

**主要风险：** 知识库质量决定上限，需要真正懂漫画语言的人参与设计

---

### Phase 2 — 单链路验证（第 5-8 周）

**核心任务：**
- Script Agent → Storyboard Agent 双 Agent 编排
- 接入 ComfyUI，跑通提示词 → 图像闭环
- 实现叙事 QA 的基础校验逻辑
- 验证：3-5 格短场景的角色一致性

**交付物：** 可运行的双 Agent demo / 首批提示词→图像质量报告 / 角色一致性评分基线

**主要风险：** 图像模型回传的多模态闭环稳定性，需测试多种方案

---

### Phase 3 — 完整工厂（第 9-16 周）

**核心任务：**
- 部署全部 27+ Agent
- 实现跨集状态持久化
- 完整质检回路上线
- 并行生产 + 成本优化
- 验证：完整一集（30 格）端到端生产

**交付物：** 完整工厂 v1.0 / 单集端到端生产报告 / 成本分析报告

**主要风险：** 多 Agent 并行的指令漂移问题，需严格结构化通信协议

---

### Phase 4 — 持续迭代（第 17 周起）

**核心任务：**
- 根据实际生成结果迭代知识库
- 基于现有项目代码做模块替换
- 逐步替换现有剧本生成模块
- 扩展更多 Agent 专项能力

**交付物：** 知识库 v2.0 / 与现有项目完成集成 / 生产效率对比报告

**主要风险：** 现有项目代码架构兼容性（待代码审阅后评估）

---

## 七、技术选型与模型分级策略

### 7.1 模型分级调用

| 层级 | 适用 Agent | 模型 | 调用频率 |
|---|---|---|---|
| 决策层（Tier 1） | 制片人、创意总监 | `claude-opus-4-6` | 低（每集 2-5 次） |
| 创作层（Tier 2） | 编剧系列、视觉总监 | `claude-sonnet-4-6` | 中（每集 20-40 次） |
| 生产层（Tier 3） | 分镜组装×N、QA Agent | `claude-sonnet-4-6` | 高（每集 60-120 次） |
| 运维层（Tier 4） | 调度、监控、日志、排版 | `claude-haiku-4-5` | 极高（持续运行） |

### 7.2 核心技术栈

| 模块 | 技术选型 | 说明 |
|---|---|---|
| Agent 编排 | Claude API（tool_use + 子实例） | 官方支持多智能体，无需额外框架 |
| 状态数据库 | PostgreSQL / Supabase | 剧情状态、角色状态的持久化存储 |
| 提示词知识库 | 向量数据库（Qdrant / Pinecone） | 语义检索相关词条，支持 RAG 注入 |
| 资产管理 | 对象存储（S3 / Cloudflare R2） | 生成图像的版本化存储与检索 |
| 图像生成 | ComfyUI / Flux / SDXL | 非 Claude 层，通过 API 调用 |
| 任务编排 | Celery + Redis / Temporal | 并行任务队列与失败重试 |
| 监控告警 | 自定义 Cost Monitor Agent | Token 用量实时追踪与预算预警 |

### 7.3 Agent 间通信协议示例

所有 Agent 间指令传递使用结构化 JSON Schema，**禁止纯自然语言传递关键参数**：

```json
{
  "task_id": "ep03_scene_12_panel_04",
  "source_agent": "storyboard_writer",
  "target_agent": "storyboard_compositor",
  "scene_context": {
    "characters": ["char_001", "char_002"],
    "location": "school_rooftop",
    "time_of_day": "sunset"
  },
  "shot_spec": {
    "framing": "MCU",
    "angle": "low_angle",
    "composition": "rule_of_thirds"
  },
  "mood": "tense",
  "narrative_beat": "confrontation_peak",
  "state_refs": ["char_001.injured_left_arm", "relationship.hostile"]
}
```

---

## 八、风险识别与缓解措施

| 风险 | 概率 | 影响 | 缓解措施 |
|---|---|---|---|
| 知识库质量不足，结构化流于形式 | 高 | 极高 | Phase 1 必须有漫画领域专家参与，用真实作品验证每个词条 |
| 跨 Agent 指令漂移，意图逐层稀释 | 中 | 高 | 结构化 JSON 通信协议，禁止纯自然语言传递关键参数 |
| 角色一致性跨集失效 | 高 | 高 | 角色档案库 + 多视角锚点图像 + Story State Manager 强制校验 |
| 并行生产成本超预期 | 中 | 中 | 分级模型调用 + 提示词 QA 前置拦截 + 预算硬上限 |
| 多模态 QA 回路不稳定 | 中 | 中 | 测试 base64 和 URL 两种方案，引入人工审核作为 fallback |
| 现有项目代码架构兼容性差 | 未知 | 中 | 待代码审阅后评估，优先做数据层适配，Agent 层并行开发后再接入 |

---

## 九、下一步行动

> ✅ **立即行动**：分享项目代码（GitHub 仓库或文件上传），将基于现有结构给出精准的模块替换方案，而非在空中规划。

### 9.1 代码审阅后将更新的内容

- 现有 Agent 模块的具体替换 / 改造建议（而非新建）
- 现有数据模型与剧情状态 DB 的适配方案
- 现有剧本生成模块的重构优先级
- Phase 1 的精确工作量估算

### 9.2 Phase 1 可以现在开始的工作

1. 整理你的漫剧项目中已有的角色设定，作为角色档案库的第一批数据
2. 选定 2-3 个代表性场景，用于验证提示词知识库的实际效果
3. 确定目标美术风格（manhwa / shounen / manhua），锁定世界观词典方向
4. 评估现有代码中哪些模块可以保留、哪些需要重写

---

> ⚠️ **核心提醒**：Agent Teams 决定工厂的运转效率，结构化提示词知识库决定工厂的产品质量上限。两者缺一不可，但**知识库要先行**——它是地基，Agent 是在上面盖的楼。

---

*— 文档结束 | 待项目代码审阅后更新 Phase 1 详细执行方案 —*
