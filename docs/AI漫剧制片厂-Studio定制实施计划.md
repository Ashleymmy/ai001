# AI 漫剧制片厂 — Studio 定制实施计划

> 基于《AI漫剧制片厂-内容产出重塑规划》，结合当前 Studio 模块实际代码实现状态制定的落地执行方案

| | |
|---|---|
| 版本 | v2.0 |
| 日期 | 2026-03-02 |
| 基线 | ai001 项目 main 分支当前状态 |
| 依据 | `docs/AI漫剧制片厂-内容产出重塑规划.md` |
| 更新依据 | v2.0 基于 4 路并行代码审计结果修订（后端核心/提示词系统/前端组件/辅助服务） |

---

## 目录

1. [现状能力盘点与差距分析](#一现状能力盘点与差距分析)
2. [改造策略：渐进增强而非推倒重来](#二改造策略渐进增强而非推倒重来)
3. [Phase 0 — 现有断层修复（第 0 周，1-2 天）](#三phase-0--现有断层修复第-0-周1-2-天)
4. [Phase 1 — 提示词知识库落地（第 1-4 周）](#四phase-1--提示词知识库落地第-1-4-周)
5. [Phase 2 — 双 Agent 质检回路（第 5-9 周）](#五phase-2--双-agent-质检回路第-5-9-周)
6. [Phase 3 — 多 Agent 编排引擎（第 10-15 周）](#六phase-3--多-agent-编排引擎第-10-15-周)
7. [Phase 4 — 全链路贯通与持续迭代（第 16-21 周）](#七phase-4--全链路贯通与持续迭代第-16-21-周)
8. [模型分级策略（适配现有多服务商架构）](#八模型分级策略适配现有多服务商架构)
9. [技术风险与缓解](#九技术风险与缓解)
10. [两份规划文档间的差异协调](#十两份规划文档间的差异协调)
11. [文件改动清单](#十一文件改动清单)

---

## 一、现状能力盘点与差距分析

### 1.1 已具备的能力（可直接复用）

下表列出规划文档中的核心概念在当前代码中的**实际对应物**。覆盖度评分已根据 v2.0 代码审计结果**校正**：

| 规划概念 | 现有实现 | 覆盖度 | v1.0 评分 | 校正说明 | 代码位置 |
|----------|----------|--------|-----------|---------|----------|
| **角色档案库** | 共享元素库 (character/scene/object) + CharacterDesignConsole + CharacterSettingCard + 年龄阶段拆分 + 参考图 + 语音档案 | ★★★☆ | ★★★☆ | 准确。但角色卡仍为自由 textarea，缺结构化字段（hair/eyes/skin/build/costumes/expressions） | `studio_storage.py` shared_elements 表；`ElementLibraryPanel.tsx`；`CharacterDesignConsoleDialog.tsx` |
| **镜头语言词典** | 6 级景别 + 7 种运镜 + 7 种机位角度 + 5 级情绪强度，已标准化常量 | ★★★☆ | ~~★★★★~~ | **↓ 下调**。常量定义完整，但英文词条（`"en"` 字段）**从未注入图像生成提示词**——实际注入的是中文。且 `prompts.py` 仅列 5 种角度 vs `constants.py` 的 7 种，存在不同步。缺少过肩镜（over-the-shoulder）词条 | `backend/services/studio/constants.py` |
| **情绪氛围包** | emotion + emotion_intensity 字段已在 Shot 模型中 | ★☆☆☆ | ~~★★☆☆~~ | **↓ 下调**。仅有 emotion 文本标签 + intensity 数值，**无任何预制色调/光效/特效词条组合**。情绪选择器形同虚设，对画面输出零影响 | `prompts.py` EPISODE_PLANNING 提示词 |
| **场景词典** | 场景元素独立提取 (SCENE_EXTRACTION_PROMPT) | ★★☆☆ | ★★☆☆ | 准确。SCENE_EXTRACTION_PROMPT 质量良好，含时段/天气变体 | `prompts.py` |
| **世界观词典** | series_bible + visual_style 字段；style_anchor 机制 | ★★☆☆ | ★★☆☆ | 准确。字段存在且被规划提示词注入，style_anchor 有完整读写逻辑 | `studio_storage.py` series 表 |
| **分镜脚本Agent** | EPISODE_PLANNING 提示词 + `[SE_XXX]` 元素引用机制 | ★★★☆ | ★★★☆ | 准确。系统最成熟的模块，嵌入麦基理论，JSON Schema 输出结构清晰 | `prompts.py`; `studio_service.py` |
| **质检机制** | Prompt Sentinel (敏感词检测/风险评分/替代建议) + Prompt Optimize | ★☆☆☆ | ~~★★☆☆~~ | **↓ 下调**。敏感词库仅 **15 条**规则（4 类），无阈值分级（只有 safe/unsafe 二值），替代词固定无上下文感知 | `prompt_sentinel.py`; `studio_service.py` |
| **审核流程** | Episode Assignment 协作审核 (assign → submit → approve/reject) | ★★☆☆ | ★★☆☆ | 准确。状态机完整，权限校验到位 | `collab_service.py` |
| **历史/回滚** | 双系统：Episode History 快照 + Workspace Undo/Redo Journal | ★★★★ | ★★★★ | 准确。4 个关键操作点（plan/enhance/batch_generate/restore）自动记录 | `studio_storage.py`; `studioStore.ts` |
| **批量生产流水线** | 7 阶段 SSE 流式批量生成 (elements → frames → key_frames → end_frames → videos → audio) + 并发控制 | ★★★★ | ★★★★ | 准确。SSE 事件完整，失败重试系统完善 | `studio_service.py`; `studioStore.ts` |
| **成本监控** | API Monitor Service (用量追踪/预算限额/服务商健康探测) | ★★☆☆ | ~~★★★☆~~ | **↓ 下调**。1228 行代码看似完善，但：预算为**软限额**（仅展示不阻断）；数据**不持久**（重启清零，内存 deque 最多 8000 条）；无 **Agent 粒度**追踪 | `api_monitor_service.py` |
| **多服务商 LLM** | LLM 13 个（2 个占位）+ 图像 ~8 个 + 视频 ~6 个 + TTS 4 个 | ★★★★ | ~~★★★★★~~ | **↓ 下调**。图像标称"10+"实际独立服务商 ~8 个（dashscope/qwen-image 同源，doubao/volcengine/ark 同源）；视频标称"8+"实际 ~6 个。**缺少 Anthropic Claude 直连 provider**（可通过 openrouter 间接接入） | `llm_service.py`; `image_service.py` 等 |
| **多工作台模式** | 长篇/短视频/数字人 三种工作台 | ★★★☆ | ★★★☆ | 准确。三模式差异化明确。短视频有节奏模板+平台预设。数字人有口型同步选项。但数字人 TTS 试听为 **setTimeout 模拟**，未接真实后端 | `StudioPage.tsx`; `ShortVideoWorkbenchPage.tsx`; `DigitalHumanWorkbenchPage.tsx` |
| **协作系统** | JWT 认证 + 工作区 + 成员 + WebSocket 在线状态 + OKR | ★★★☆ | ★★★☆ | 准确。collab_service.py 1674 行覆盖认证/工作区/成员/审核/OKR/操作日志六大子系统。WS 心跳超时已定义但**无定时清理任务** | `collab_service.py`; `ws_manager.py` |

> **v2.0 校正总结**：14 项中 **5 项被下调**（镜头语言、情绪氛围、质检机制、成本监控、多服务商），9 项维持原评。

### 1.2 关键差距（需要新建或大幅增强）

#### 原有差距（v1.0 已识别）

| 规划概念 | 差距 | 优先级 |
|----------|------|--------|
| **结构化提示词知识库** | 现有提示词模板是**硬编码 Python 字符串**，支持用户自定义但无结构化取词组装机制。缺少角色档案 → 标准化提示词词条的自动转化。无"从知识库取词，禁止自由发挥"的约束层。 | P0 |
| **多 Agent 角色编排** | 当前 Studio 是**单一 LLM 调用链**（剧本→元素→分镜→画面），无显式 Agent 角色概念。`studio_service.py` 的每个操作直接调 `llm_service.call()`，没有 Agent 身份/记忆/协议层。 | P1 |
| **叙事一致性审核** | 无独立叙事 QA。现有 Prompt Sentinel 只做敏感词检测，不做剧情逻辑漏洞/人物行为合理性检查。 | P1 |
| **视觉一致性审核** | 无图像回传比对。生成的图像无法自动验证角色外貌跨镜一致性。 | P2 |
| **Agent 间结构化通信协议** | 各流程步骤之间通过 Python 函数参数传递，无标准化 JSON Schema 通信协议。 | P1 |
| **提示词组装 Agent** | 当前由 LLM 在分镜规划时直接生成提示词，无"从知识库取词组装"的独立环节。 | P0 |
| **情绪氛围预制包** | 仅有 emotion 字段标注，无标准化的色调/光线/特效词条组合包。 | P1 |
| **剧情状态数据库** | 现有 SQLite 存储了结构化数据（系列/集/镜头/元素），但缺少跨集角色状态追踪、伏笔矩阵、时间线一致性等"剧情状态"维度。 | P1 |
| **日志审计** | 有 Episode History 但缺少全链路 Agent 决策记录和可回溯性。 | P2 |

#### 新发现的断层（v2.0 审计新增，标记 🆕）

| 问题 | 性质 | 优先级 | 审计发现 |
|------|------|--------|---------|
| 🆕 **英文提示词词条定义了但从未注入** | 代码断层 | **P0** | `constants.py` 定义了完整的英文景别/角度/运镜词条，但 `studio_service.py` 的 `_build_shot_image_prompt()` 全部调用 `get_xxx_zh()` 注入**中文**。对 Flux/SD/DALL-E 等英文模型，这是显著的画面质量损耗 |
| 🆕 **prompt_templates.py 整个文件是死代码** | 代码断层 | **P0** | 精心设计的首帧/关键帧/尾帧专业系统提示词（`START_FRAME_SYSTEM_PROMPT`/`KEY_FRAME_SYSTEM_PROMPT`/`END_FRAME_SYSTEM_PROMPT`）从未被 import 或使用。`studio_service.py` 用硬编码的 `stage_clauses` 字典替代 |
| 🆕 **情绪字段对画面输出零影响** | 代码断层 | **P0** | emotion 字段只是文本标签（如"紧张"），没有被转化为视觉提示词（如 `high contrast, heavy shadow, speed lines`）。情绪选择器选了等于没选 |
| 🆕 **prompts.py 角度列表与 constants.py 不同步** | 代码断层 | **P0** | EPISODE_PLANNING_SYSTEM_PROMPT 仅列 5 种机位角度（eye_level/low_angle/high_angle/dutch/overhead），遗漏 side 和 back，与 constants.py 的 7 种不一致 |
| 🆕 **缺少过肩镜（over-the-shoulder）词条** | 内容缺失 | **P1** | 原始文档明确列为核心角度词条，是对话场景最常用的镜头语言。constants.py 用 side/back 替代，但两者语义不同 |
| 🆕 **缺少 Anthropic Claude 直连 provider** | 架构缺失 | **P1** | 规划文档的 27+ Agent 编排全部基于 Claude API（tool_use + 子实例），但 llm_service.py 无 Claude provider，且无 tool_use 支持。Phase 3 的硬性前置条件 |
| 🆕 **Prompt Sentinel 敏感词库仅 15 条** | 能力不足 | **P1** | 4 类共 15 条规则（violence 6 / adult 5 / politics 2 / hate 2），生产环境覆盖率严重不足 |
| 🆕 **Image Service 占位图逻辑矛盾** | 代码缺陷 | **P2** | `_call_comfyui` 等方法失败时返回 `_placeholder()` 占位图，但 `generate()` 顶层 `_ensure_valid_image_url` 拒绝占位图抛异常，行为不一致 |
| 🆕 **Video Service 死代码** | 代码质量 | **P2** | `_generate_qwen_video` 方法存在但从未被 `generate()` 分支调用 |
| 🆕 **数字人 TTS 试听功能为模拟** | 功能缺失 | **P2** | DigitalHumanWorkbenchPage 的试听使用 `setTimeout 3s` 模拟，未调用真实 TTS 后端 |
| 🆕 **WS Manager 心跳超时未执行** | 代码断层 | **P2** | 定义了 `_heartbeat_timeout_sec=60` 但无定时清理过期连接的后台任务 |
| 🆕 **API Monitor 数据不持久** | 架构缺陷 | **P2** | 内存 deque（最多 8000 条），服务重启后清零，无历史趋势数据 |

### 1.3 关键判断

> **现有 Studio 架构是健全的底座**——数据模型（系列/卷/集/镜头/元素）、批量生产流水线（7 阶段 SSE）、多服务商 LLM 层、协作系统、历史回滚等核心基建已经稳固。不需要推倒重来，而是在现有架构上**嫁接 Agent 编排层 + 提示词知识库层**。
>
> 🆕 **v2.0 补充判断**：审计发现一个系统性问题——**"定义了但未使用"**。镜头语言英文词条、帧级专业模板、情绪数据都已写好代码，却没有被串联进生产链路。在启动任何新功能建设之前，必须先**让已有的弹药上膛**。因此新增 Phase 0。

---

## 二、改造策略：渐进增强而非推倒重来

### 2.1 核心原则

1. **不动底座**：`studio_storage.py` 的 SQLite Schema、`studio_service.py` 的批量生成流水线、`llm_service.py` 的多服务商抽象层保持不变
2. **插入中间层**：在"LLM 调用"和"业务逻辑"之间插入 Agent 编排层和知识库层
3. **数据扩展优先**：优先在现有 SQLite 表上扩字段，而非新建数据库
4. **可开关**：所有新能力通过设置开关控制，默认关闭，不影响现有功能
5. 🆕 **先修后建**：在新建功能之前，先修复现有代码中"定义了但未使用"的断层（Phase 0）

### 2.2 架构演进图

```
 现有架构                              目标架构
 ────────                              ────────

 用户操作                              用户操作
    ↓                                     ↓
 studio_service.py                     studio_service.py
 (直接调 LLM)                          (调度 Agent Pipeline)
    ↓                                     ↓
 llm_service.py                    ┌─────────────────┐
    ↓                              │  Agent 编排层     │  ← Phase 3 新增
 图像/视频服务                      │  (角色分工/协议)   │
                                   └────────┬────────┘
                                            ↓
                                   ┌─────────────────┐
                                   │  知识库层         │  ← Phase 1 新增
                                   │  (取词组装/约束)   │
                                   └────────┬────────┘
                                            ↓
                                     llm_service.py
                                       (不变)
                                            ↓
                                     图像/视频服务
                                    (Phase 0 修复断层)
```

### 2.3 规划 Agent 角色 → 现有代码的映射与改造方案

| 规划 Agent (27+) | 改造策略 | 说明 |
|---|---|---|
| **制片人 Agent** | 新建 `pipeline_orchestrator.py` | 任务拆解/调度/审批，串联全链路 |
| **创意总监 Agent** | 增强现有 `visual_style` + `series_bible` | 风格一致性不需要独立 Agent，做成校验函数 |
| **首席编剧** | 增强现有 `SCRIPT_SPLIT` 提示词 | 现有分幕逻辑足够，增强上下文管理 |
| **世界观构建** | 新建 `world_bible_agent.py` | 从 `series_bible` 字段扩展为结构化世界观数据库 |
| **剧情架构** | 复用现有 `SCRIPT_SPLIT` + 新增节拍表模块 | 现有分幕足够，新增伏笔/呼应矩阵 |
| **角色开发** | 增强现有 `CHARACTER_DEEP_EXTRACTION` | 已有角色深度提取，扩展为完整角色圣经 |
| **对话编剧** | 新增 `dialogue_agent.py` | 现有 `dialogue_script` 字段已预留，需独立生成逻辑 |
| **分镜脚本** | 复用现有 `EPISODE_PLANNING` | 已高度完善，是系统最成熟的模块 |
| **视觉总监** | 合并进 `pipeline_orchestrator.py` | 视觉风格校验 |
| **角色设计** | 复用现有 `CharacterDesignConsole` | 已有完整流程 |
| **角色提示词工程** | **新建 `prompt_assembler.py`** | **核心新增**：角色档案 → 标准化提示词词条 |
| **场景提示词工程** | **新建（合入 `prompt_assembler.py`）** | 场景元素 → 标准化背景提示词 |
| **分镜提示词组装** | **新建 `shot_prompt_compositor.py`** | **核心新增**：从知识库取词组装单格完整提示词 |
| **镜头语言 Agent** | 🆕 Phase 0 先修复英文注入；Phase 1 新增组装逻辑 | 景别/角度/运镜常量已有，**Phase 0 先让其生效** |
| **情绪氛围 Agent** | 🆕 Phase 0 先做简易映射；Phase 1 **新建 `mood_packs.py`** | Phase 0 先让 emotion 影响画面，Phase 1 做完整预制包 |
| **排版合成** | 暂不实施 | 当前系统生成单帧图像，非漫画格排版 |
| **音效文案** | 复用现有 `sound_effects` + `tts_service.py` | 已有音效字段和 TTS 生成 |
| **知识库管理** | **新建 `knowledge_base.py`** | **核心新增**：统一知识库 Schema + CRUD |
| **剧情状态管理** | 扩展现有 `studio_storage.py` | 新增角色状态追踪表、伏笔矩阵表 |
| **资产注册** | 复用现有 `frame_history` / `video_history` | 已有资产版本管理 |
| **叙事 QA** | **新建 `narrative_qa.py`** | 剧情逻辑/人物一致性校验 |
| **视觉 QA** | **新建 `visual_qa.py`** | 图像回传多模态比对 |
| **提示词 QA** | 增强现有 `prompt_sentinel.py` | 已有基础，需增加知识库合规检查 |
| **综合评分** | 新建 `quality_scorer.py` | 整合三个 QA 结果 |
| **成本监控** | 🆕 增强现有 `api_monitor_service.py` | 需增加 Agent 粒度追踪、数据持久化、硬限额 |
| **任务调度** | 复用现有 SSE 批量生成 + `generationQueueStore` | 已有并发控制 |
| **日志审计** | 扩展现有 Episode History | 增加 Agent 决策记录维度 |

**统计**：27 个规划 Agent 中：
- **14 个** 可复用/增强现有代码
- **8 个** 需要新建模块
- **5 个** 可合并或暂缓

---

## 三、Phase 0 — 现有断层修复（第 0 周，1-2 天）

> 🆕 **v2.0 新增阶段**。审计发现 4 个"定义了但未使用"的严重断层和若干代码缺陷。这些不是新功能，而是**已有能力的激活与修复**。不修复这些断层，后续 Phase 1 的知识库建设将建立在一个有裂缝的地基上。

### 3.0 设计原则

- **零新增功能**：只修复/激活/清理，不引入新概念
- **向后兼容**：所有改动不破坏现有功能，保持 API 接口不变
- **可逐条验证**：每个任务独立可测试

### 3.1 任务清单

#### 任务 0.1：图像提示词改用英文词条 🔴

**问题**：`_build_shot_image_prompt()` 调用 `get_shot_size_zh()` / `get_camera_angle_zh()` 注入中文景别/角度名，对英文图像模型（Flux/SD/DALL-E）造成质量损耗。

**改动文件**：`backend/services/studio_service.py`

**改动内容**：
```python
# 改前（约 L1240-1260）
shot_size_str = get_shot_size_zh(shot.get("shot_size", ""))
angle_str = get_camera_angle_zh(shot.get("camera_angle", ""))

# 改后：新增英文取词函数，优先注入英文
from .studio.constants import SHOT_SIZE_STANDARDS, CAMERA_ANGLES, CAMERA_MOVEMENTS

def _get_cinematography_en(shot: dict) -> str:
    """从 constants.py 取英文词条，组装镜头语言提示词段"""
    parts = []
    size_key = shot.get("shot_size", "")
    if size_key and size_key in SHOT_SIZE_STANDARDS:
        parts.append(SHOT_SIZE_STANDARDS[size_key]["en"])
    angle_key = shot.get("camera_angle", "")
    if angle_key and angle_key in CAMERA_ANGLES:
        parts.append(CAMERA_ANGLES[angle_key]["en"])
    movement_key = shot.get("camera_movement", "")
    if movement_key and movement_key in CAMERA_MOVEMENTS:
        parts.append(CAMERA_MOVEMENTS[movement_key]["en"])
    return ", ".join(parts)
```

同时在视频提示词构建中也改用英文运镜词条。

**验证**：生成一张测试图像，检查发送给图像模型的 prompt 中包含英文镜头语言（如 `Medium Close-Up (MCU), Low Angle`）。

#### 任务 0.2：激活 prompt_templates.py 帧级模板 🔴

**问题**：`prompt_templates.py` 中的 `START_FRAME_SYSTEM_PROMPT` / `KEY_FRAME_SYSTEM_PROMPT` / `END_FRAME_SYSTEM_PROMPT` 从未被 import。`studio_service.py` 用硬编码的 `stage_clauses` 字典替代。

**改动文件**：`backend/services/studio_service.py`

**改动内容**：
```python
# 改前：硬编码 stage 描述
stage_clauses = {
    "start": "...",
    "key": "...",
    "end": "..."
}

# 改后：import 并使用专业模板
from .studio.prompt_templates import (
    START_FRAME_SYSTEM_PROMPT,
    KEY_FRAME_SYSTEM_PROMPT,
    END_FRAME_SYSTEM_PROMPT,
    FRAME_USER_PROMPT
)
```

在帧生成的 LLM 调用中，将 system prompt 替换为对应帧类型的专业模板。

**验证**：生成一集的首帧/关键帧/尾帧，确认 LLM 调用的 system prompt 来自 prompt_templates.py。

#### 任务 0.3：同步角度列表 + 补回过肩镜 🔴

**问题**：
1. `prompts.py` 的 `EPISODE_PLANNING_SYSTEM_PROMPT` 仅列 5 种角度（缺 side/back），与 `constants.py` 的 7 种不一致
2. 原始文档中的"过肩镜"（over-the-shoulder）未收录

**改动文件**：
- `backend/services/studio/constants.py` — 新增 `over_shoulder` 词条（替换 `back` 或作为第 8 种）
- `backend/services/studio/prompts.py` — EPISODE_PLANNING_SYSTEM_PROMPT 的角度列表补齐至与 constants.py 一致

**验证**：分镜规划输出的 JSON 中 `camera_angle` 字段可出现所有已定义的角度值。

#### 任务 0.4：情绪字段→英文视觉词简易映射 🔴

**问题**：emotion 字段（如"紧张""温柔"）只作为文本标签存储，不影响图像生成提示词。

**改动文件**：`backend/services/studio_service.py`

**改动内容**：在 `_build_shot_image_prompt()` 中增加简易情绪→视觉词映射：

```python
# Phase 0 简易映射（Phase 1 将被完整 mood_packs 替代）
EMOTION_VISUAL_HINTS = {
    "紧张": "high contrast, heavy shadow, speed lines",
    "tense": "high contrast, heavy shadow, speed lines",
    "温柔": "soft focus, warm backlighting, pastel palette",
    "tender": "soft focus, warm backlighting, pastel palette",
    "绝望": "desaturated, heavy shadows, rain",
    "despair": "desaturated, heavy shadows, rain",
    "爽": "dynamic angle, speed lines, gold rim light",
    "cool": "dynamic angle, speed lines, gold rim light",
    "悬疑": "low-key lighting, silhouette, fog",
    "suspense": "low-key lighting, silhouette, fog",
    "温馨": "warm tones, dappled light, soft bokeh",
    "warm": "warm tones, dappled light, soft bokeh",
    "愤怒": "harsh lighting, red tones, sharp shadows",
    "angry": "harsh lighting, red tones, sharp shadows",
    "恐惧": "cold blue tones, dark vignette, trembling lines",
    "fear": "cold blue tones, dark vignette, trembling lines",
}

emotion = shot.get("emotion", "").strip().lower()
emotion_hint = EMOTION_VISUAL_HINTS.get(emotion, "")
if emotion_hint:
    prompt_parts.append(emotion_hint)
```

**验证**：设置某镜头 emotion="紧张"，生成图像，确认 prompt 中包含 `high contrast, heavy shadow, speed lines`。

#### 任务 0.5：修复 Image Service 占位图逻辑矛盾 🟠

**问题**：`_call_comfyui` 等方法失败时返回 `_placeholder()` 占位图，但 `generate()` 顶层 `_ensure_valid_image_url` 拒绝占位图抛异常。

**改动文件**：`backend/services/image_service.py`

**改动内容**：统一策略——失败时直接抛异常而非返回占位图，让上层统一处理。删除各子方法中的 `return _placeholder()` fallback。

#### 任务 0.6：清理 Video Service 死代码 🟡

**问题**：`_generate_qwen_video` 方法存在但从未被调用。

**改动文件**：`backend/services/video_service.py`

**改动内容**：将 `_generate_qwen_video` 接入 `generate()` 的 provider 分支（若为有效实现），或删除该死代码。

#### 任务 0.7：扩充 Prompt Sentinel 敏感词库 🟠

**问题**：4 类共 15 条规则，生产环境覆盖率不足。

**改动文件**：`backend/services/studio/prompt_sentinel.py`

**改动内容**：
- 每类扩充至 20-30 条规则（目标 100+）
- 新增风险阈值分级：`low_risk`(1-3分) / `medium_risk`(4-6分) / `high_risk`(7+分)
- 保持现有 API 接口不变

#### 任务 0.8：修复数字人 TTS 试听接入 🟡

**问题**：DigitalHumanWorkbenchPage 的试听功能使用 `setTimeout 3s` 模拟。

**改动文件**：`src/pages/DigitalHumanWorkbenchPage.tsx`

**改动内容**：将模拟 setTimeout 替换为实际调用 TTS 后端 API（复用 studioStore 中已有的音频生成逻辑）。

### 3.2 交付标准

- [ ] 生成一张测试图像，prompt 中包含英文镜头语言词条（非中文）
- [ ] 帧生成 LLM 调用使用 prompt_templates.py 中的专业系统提示词
- [ ] 分镜规划可输出所有已定义的角度值（含 over_shoulder）
- [ ] emotion="紧张" 的镜头生成的图像 prompt 包含 `high contrast, heavy shadow`
- [ ] Image Service 失败时不再返回占位图
- [ ] Prompt Sentinel 规则数 ≥ 100 条，支持三级风险评分
- [ ] 数字人试听调用真实 TTS 后端

---

## 四、Phase 1 — 提示词知识库落地（第 1-4 周）

> 知识库是地基。本阶段不碰 Agent 编排，专注把现有"自由发挥"的提示词生成流程改造为"知识库约束 + 取词组装"。

### 4.1 任务清单

#### 任务 1.1：知识库 Schema 设计与存储层

**改动文件**：`backend/services/studio/knowledge_base.py`（新建）、`backend/services/studio_storage.py`（扩展）

在现有 SQLite 中新增知识库表：

```sql
-- 角色提示词档案（从 shared_elements 的 character 自动生成）
CREATE TABLE kb_character_cards (
    id TEXT PRIMARY KEY,
    element_id TEXT REFERENCES shared_elements(id),
    appearance_tokens TEXT,      -- JSON: {hair, eyes, skin, build, ...}
    costume_tokens TEXT,         -- JSON: {default, battle, casual, ...}
    expression_tokens TEXT,      -- JSON: {happy, angry, sad, ...}
    signature_poses TEXT,        -- JSON: {idle, battle, ...}
    negative_prompts TEXT,       -- 角色负面提示词
    version INTEGER DEFAULT 1,
    updated_at TEXT
);

-- 情绪氛围预制包
CREATE TABLE kb_mood_packs (
    id TEXT PRIMARY KEY,
    series_id TEXT,
    mood_key TEXT,               -- tense, tender, despair, cool, suspense, warm, angry, fear
    color_tokens TEXT,           -- 色调词
    line_style_tokens TEXT,      -- 线条风格词
    effect_tokens TEXT,          -- 特效词
    combined_prompt TEXT,        -- 完整预制组合
    is_builtin BOOLEAN DEFAULT 1
);

-- 场景提示词档案（从 shared_elements 的 scene 自动生成）
CREATE TABLE kb_scene_cards (
    id TEXT PRIMARY KEY,
    element_id TEXT REFERENCES shared_elements(id),
    base_tokens TEXT,            -- 基础空间描述词
    time_variants TEXT,          -- JSON: {day, night, sunset, rain, ...}
    negative_prompts TEXT,
    version INTEGER DEFAULT 1,
    updated_at TEXT
);

-- 世界观提示词词典
CREATE TABLE kb_world_bible (
    id TEXT PRIMARY KEY,
    series_id TEXT,
    art_style TEXT,
    era TEXT,
    color_palette TEXT,
    recurring_motifs TEXT,
    forbidden_elements TEXT,     -- 禁止出现的风格词
    updated_at TEXT
);
```

**交付物**：
- `knowledge_base.py` — KB CRUD + 从现有 `shared_elements` 自动导入/同步
- `studio_storage.py` — 新增 4 张表的 DDL 和基础读写方法
- 迁移脚本，确保现有数据库平滑升级

#### 任务 1.2：内置情绪氛围预制包

**改动文件**：`backend/services/studio/mood_packs.py`（新建）

将规划文档中的 8 种情绪包转化为可配置的预制数据，并提供 API 供前端选用。**替换 Phase 0 的简易映射**：

| 情绪 Key | 色调词 | 线条风格词 | 特效词 | 组合提示词 |
|----------|--------|-----------|--------|-----------|
| `tense` | `high contrast, heavy shadow` | `sharp lines, dynamic strokes` | `motion blur, sweat drops, speed lines` | 完整组合 |
| `tender` | `soft focus, warm backlighting, pastel palette` | `smooth curves, gentle lines` | `flower petals, lens flare` | ... |
| `despair` | `desaturated, heavy shadows` | `rough lines, trembling strokes` | `rain, broken panel border, monochrome accent` | ... |
| `cool` | `dynamic angle, gold rim light` | `bold outlines, sharp contrasts` | `speed lines, particle burst, dramatic pose` | ... |
| `suspense` | `low-key lighting, cold color temperature` | `thin lines, precise details` | `silhouette, fog` | ... |
| `warm` | `warm tones, dappled light, soft bokeh` | `relaxed strokes, rounded forms` | `cozy interior, natural shadows` | ... |
| `angry` | `harsh lighting, red tones, sharp shadows` | `jagged lines, aggressive strokes` | `cracked background, vein marks` | ... |
| `fear` | `cold blue tones, dark vignette` | `uneven lines, distorted forms` | `trembling lines, wide eyes, sweat` | ... |

**交付物**：
- `mood_packs.py` — 内置 8 种预制包 + 自定义包 CRUD
- 前端 `ShotDetailPanel.tsx` 增加情绪包选择器（下拉），选中后自动注入对应词条到提示词
- 🆕 `studio_service.py` 中的 Phase 0 简易映射 `EMOTION_VISUAL_HINTS` 被正式 mood_packs 替代

#### 任务 1.3：角色档案 → 提示词词条自动转化

**改动文件**：`backend/services/studio/prompt_assembler.py`（新建）

核心逻辑：当 `shared_elements` 中的 character 元素被创建/编辑时，自动生成对应的 `kb_character_cards` 记录，将自然语言描述拆分为结构化提示词词条。

```python
class PromptAssembler:
    """从知识库取词组装提示词，禁止自由发挥"""

    def assemble_character_tokens(self, element_id: str) -> str:
        """从角色档案取词，组装角色描述提示词段"""
        card = self.kb.get_character_card(element_id)
        tokens = []
        tokens.extend(card.appearance_tokens.values())
        tokens.extend(card.costume_tokens.get(costume_key, []))
        tokens.extend(card.expression_tokens.get(expression_key, []))
        return ", ".join(tokens)

    def assemble_scene_tokens(self, element_id: str, time_variant: str) -> str:
        """从场景档案取词，组装背景描述提示词段"""
        ...

    def assemble_shot_prompt(self, shot, episode_elements, mood_pack) -> str:
        """完整单格提示词组装：角色词条 + 场景词条 + 镜头语言 + 情绪包 + 负面提示词"""
        ...
```

**交付物**：
- `prompt_assembler.py` — 取词组装引擎
- 现有 `[SE_XXX]` 引用机制改造为知识库查询

#### 任务 1.4：镜头语言自动注入（Phase 0 基础上的正式版）

**改动文件**：`backend/services/studio/prompt_assembler.py`（续）

Phase 0 已在 `_build_shot_image_prompt()` 中做了英文词条注入。本任务将其迁移到 `PromptAssembler`，实现更完整的组装逻辑：

```python
def inject_cinematography(self, shot) -> str:
    """根据镜头元数据自动注入景别/角度/运镜词条"""
    parts = []
    # 景别
    size = SHOT_SIZE_STANDARDS.get(shot.shot_size)
    if size:
        parts.append(size["en"])  # e.g., "Medium Close-Up (MCU)"
    # 角度
    angle = CAMERA_ANGLES.get(shot.camera_angle)
    if angle:
        parts.append(angle["en"])  # e.g., "Low Angle"
    # 运镜（主要影响视频提示词）
    movement = CAMERA_MOVEMENTS.get(shot.camera_movement)
    if movement:
        parts.append(movement["en"])
    return ", ".join(parts)
```

#### 任务 1.5：前端知识库管理 UI

**改动文件**：`src/components/studio/KnowledgeBasePanel.tsx`（新建）

在 Studio 工作台设置面板中新增"提示词知识库"Tab：

- **角色档案列表**：从元素库自动同步，可编辑词条
- **场景档案列表**：从元素库自动同步，支持时段变体
- **情绪氛围包**：8 个内置 + 自定义，可预览组合效果
- **世界观词典**：编辑全局美术风格约束词
- **一键同步**：从 `shared_elements` 重新生成所有词条

#### 🆕 任务 1.6：前端角色卡结构化改造

**改动文件**：`src/components/studio/CharacterSettingCardDialog.tsx`（增强）

**问题**：当前角色设定卡只有一个自由 textarea，无法支撑"从知识库取词组装"的设计。

**改动内容**：将自由文本区域改造为结构化表单字段：

- **外貌**：hair / eyes / skin / build 独立文本输入
- **服装变体**：default / battle / casual 等可增减的多套服装描述
- **表情库**：happy / angry / sad / shocked / determined 等对应英文提示词词条
- **标志姿态**：idle / battle 等预设姿态描述
- **负面提示词**：专用字段，防止生成偏差

保留原有 textarea 作为"自由描述"降级入口，结构化字段优先。

### 4.2 交付标准

- [ ] 用真实项目的 3 个角色验证：角色档案 → 词条拆分 → 提示词组装的完整链路
- [ ] 对比测试：知识库组装 vs 现有自由生成的画面一致性
- [ ] 情绪包应用前后的画面氛围对比
- [ ] 🆕 角色卡结构化字段 ↔ kb_character_cards 双向同步验证

---

## 五、Phase 2 — 双 Agent 质检回路（第 5-9 周）

> 本阶段引入独立质检能力，在生产链路中插入三道质检关口。
>
> 🆕 **v2.0 调整**：时间从"第 5-8 周"扩展为"第 5-9 周"，增加 1 周 buffer。原因：Phase 2 的提示词 QA 依赖 Phase 1 知识库交付，需预留衔接时间。

### 5.1 前置条件

- [ ] Phase 1 知识库 CRUD + 自动同步功能已稳定运行
- [ ] 至少 3 个角色和 5 个场景已完成知识库词条录入

### 5.2 任务清单

#### 任务 2.1：叙事 QA 模块

**改动文件**：`backend/services/studio/narrative_qa.py`（新建）

在分镜规划完成后、画面生成前，自动执行叙事一致性检查：

```python
class NarrativeQA:
    """叙事一致性审核 — 独立于生产侧"""

    async def check_episode(self, episode, series_context) -> QAResult:
        """
        检查项：
        1. 角色行为一致性 — 对照角色圣经检查行为是否合理
        2. 时间线连续性 — 前后集事件是否矛盾
        3. 伏笔回收 — 已埋设的伏笔是否被遗忘
        4. 对话风格一致性 — 角色台词是否符合性格设定
        5. 场景逻辑 — 角色是否出现在不可能的场景
        """
        ...
        return QAResult(
            passed=bool,
            issues=[QAIssue(severity, description, fix_suggestion)],
            score=float  # 0-100
        )
```

**调用点**：在 `studio_service.py` 的 `plan_episode()` 完成后、`batch_generate()` 开始前插入。

**LLM 调用**：使用 Sonnet 级模型，每集约 1-2 次调用。

🆕 **关键设计**：所有不通过结果**必须携带结构化修改指令**回传（对齐原始规划文档要求），而非仅标记"不合格"：

```python
class QAIssue:
    severity: str          # "error" / "warning" / "info"
    description: str       # 问题描述
    fix_suggestion: str    # 修改建议（自然语言）
    fix_instruction: dict  # 结构化修改指令（可被自动应用）
    affected_shots: list   # 涉及的镜头 ID 列表
```

#### 任务 2.2：提示词 QA 增强

**改动文件**：`backend/services/studio/prompt_sentinel.py`（增强）

在现有敏感词检测基础上（Phase 0 已扩充至 100+ 条），新增知识库合规检查：

```python
def check_kb_compliance(self, prompt: str, shot, kb_context) -> ComplianceResult:
    """
    新增检查项：
    1. 角色描述是否来自知识库（非自由发挥）
    2. 场景描述是否匹配场景档案
    3. 情绪词条是否来自预制包
    4. 负面提示词是否完整
    5. 禁止元素是否出现（如 world_bible.forbidden_elements）
    """
```

#### 任务 2.3：视觉 QA 基础版

**改动文件**：`backend/services/studio/visual_qa.py`（新建）

利用多模态 LLM 对生成图像进行角色一致性校验：

```python
class VisualQA:
    """视觉一致性审核"""

    async def check_character_consistency(
        self, generated_image_url: str, character_card: dict
    ) -> QAResult:
        """
        将生成图像 + 角色档案词条发送给多模态 LLM，
        要求比对：发色、瞳色、服装、体型是否匹配。
        返回：通过/不通过 + 具体偏差描述 + 修改建议。
        """
```

**调用点**：在 batch_generate 的 `generating_frames` 阶段，每张图生成后异步校验。不通过的图像标记 warning 而非阻断（避免影响生产效率）。

**优先级**：先做角色一致性校验，场景连续性校验放到 Phase 3。

#### 任务 2.4：综合评分面板

**改动文件**：`src/components/studio/QualityScorePanel.tsx`（新建）

在 Studio 工作台中新增质量评分面板：

- 每集自动展示：叙事 QA 分数、提示词 QA 分数、视觉 QA 分数
- 不合格项高亮，点击可跳转到对应镜头
- 一键重试：对不合格镜头重新生成
- 🆕 展示不通过结果的**结构化修改指令**，支持一键应用

#### 任务 2.5：质检回路集成到批量生成流水线

**改动文件**：`backend/services/studio_service.py`（增强）

在现有 7 阶段 SSE 流式生成中插入质检关口：

```
现有流程：elements → frames → key_frames → end_frames → videos → audio → done

增强流程：
  elements
    ↓
  [叙事 QA 关口]  ← Phase 2 新增（不通过时携带修改指令回传）
    ↓
  frames
    ↓
  [提示词 QA 前置] ← Phase 2 新增（每张图生成前校验提示词）
    ↓
  [视觉 QA 后置]  ← Phase 2 新增（每张图生成后校验一致性）
    ↓
  key_frames → end_frames → videos → audio → done
```

SSE 事件扩展：
- `qa_start` / `qa_item_check` / `qa_item_result` / `qa_complete`
- 前端 `studioStore.ts` 新增 `generating_qa` 阶段

### 5.3 交付标准

- [ ] 叙事 QA：检出率 > 80%（用人工标注的 10 个故障案例验证）
- [ ] 提示词 QA：知识库合规检查准确率 > 90%
- [ ] 视觉 QA：角色一致性偏差检出率 > 60%（多模态 LLM 能力限制，先追求覆盖率）
- [ ] 全链路测试：一集 30 格端到端，质检回路正常运转
- [ ] 🆕 所有不通过结果携带结构化修改指令，可一键应用

---

## 六、Phase 3 — 多 Agent 编排引擎（第 10-15 周）

> 本阶段将现有单一 LLM 调用链升级为多 Agent 角色编排，引入结构化通信协议。
>
> 🆕 **v2.0 调整**：时间从"第 9-14 周"推迟为"第 10-15 周"，对齐 Phase 2 扩展。

### 6.0 前置条件（🆕 v2.0 新增）

> Phase 3 的 Agent 编排依赖 Claude API 的 tool_use 和子实例能力。**必须在 Phase 3 启动前完成以下前置工作**：

- [ ] **接入 Anthropic Claude provider**：在 `llm_service.py` 中新增 Claude 直连 provider（使用 Anthropic Python SDK），支持 `tool_use` 和结构化输出
- [ ] **API Monitor 增加 Agent 粒度追踪**：新增 `agent_role` 维度，每次 LLM 调用记录发起 Agent 身份
- [ ] **API Monitor 数据持久化**：将事件队列写入 SQLite（或日志文件），重启后不丢失
- [ ] **预算限额升级为硬限额**：超限时实际拒绝请求（可配置硬/软切换）

### 6.1 Agent 编排架构

**改动文件**：`backend/services/studio/agent_pipeline.py`（新建）

```python
class AgentRole:
    """Agent 角色定义"""
    role_id: str           # e.g., "storyboard_writer"
    display_name: str      # e.g., "分镜编剧"
    system_prompt: str     # 角色系统提示词
    model_tier: str        # "tier1_opus" / "tier2_sonnet" / "tier3_sonnet" / "tier4_haiku"
    department: str        # "story" / "visual" / "tech"

class AgentMessage:
    """Agent 间结构化通信"""
    task_id: str
    source_agent: str
    target_agent: str
    payload: dict          # 结构化 JSON，遵循 Schema 约束
    context_refs: list     # 引用的知识库条目 ID

class AgentPipeline:
    """多 Agent 编排引擎"""

    def __init__(self, series_id, episode_id):
        self.agents = self._init_agents()
        self.knowledge_base = KnowledgeBase(series_id)
        self.state_manager = StoryStateManager(series_id)

    async def run_episode_pipeline(self, script_excerpt: str):
        """单集完整生产流水线"""
        # 1. 制片人 Agent 拆解任务
        plan = await self.producer.plan_tasks(script_excerpt)

        # 2. 创作部链路
        world_context = await self.world_builder.enrich_context(plan)
        characters = await self.character_developer.develop(plan, world_context)
        dialogue = await self.dialogue_writer.write(plan, characters)
        storyboard = await self.storyboard_writer.plan(plan, characters, dialogue)

        # 3. 叙事 QA 关口（复用 Phase 2 模块）
        narrative_result = await self.narrative_qa.check(storyboard, world_context)
        if not narrative_result.passed:
            storyboard = await self.storyboard_writer.revise(
                storyboard, narrative_result.fix_instructions
            )

        # 4. 视觉制作部链路
        prompts = await self.prompt_compositor.assemble_all(
            storyboard, self.knowledge_base
        )

        # 5. 提示词 QA 关口（复用 Phase 2 模块）
        prompt_result = await self.prompt_qa.check_batch(prompts)
        prompts = self._apply_fixes(prompts, prompt_result)

        # 6. 图像生成（复用现有 batch_generate）
        # 7. 视觉 QA 关口
        # 8. 视频/音频生成

        return pipeline_result
```

### 6.2 任务清单

#### 任务 3.1：Agent 角色注册中心

**改动文件**：`backend/services/studio/agent_roles.py`（新建）

定义所有 Agent 角色的配置，包括系统提示词、模型层级、职责边界：

| 角色 | 模型层级 | 每集调用次数 |
|------|---------|------------|
| 制片人 (Producer) | Tier 1 (Opus 级) | 2-3 |
| 世界观构建 (World Builder) | Tier 2 (Sonnet 级) | 1-2 |
| 角色开发 (Character Developer) | Tier 2 | 2-5 |
| 对话编剧 (Dialogue Writer) | Tier 2 | 5-10 |
| 分镜编剧 (Storyboard Writer) | Tier 2 | 1-3 |
| 提示词组装 (Prompt Compositor) | Tier 3 (Sonnet 级) | 10-30 |
| 叙事 QA | Tier 2 | 1-2 |
| 视觉 QA | Tier 2 (多模态) | 10-30 |
| 提示词 QA | Tier 4 (Haiku 级) | 10-30 |
| 剧情状态管理 | Tier 4 | 持续 |

#### 任务 3.2：结构化通信协议

**改动文件**：`backend/services/studio/agent_protocol.py`（新建）

定义 Agent 间 JSON Schema 通信标准，禁止纯自然语言传递关键参数：

```python
SHOT_SPEC_SCHEMA = {
    "task_id": "ep{episode}_seg{segment}_shot{index}",
    "characters": ["element_id_1", "element_id_2"],
    "location": "element_id_scene",
    "time_of_day": "sunset",
    "shot_spec": {
        "framing": "MCU",         # 从 constants.py 枚举
        "angle": "low_angle",     # 从 constants.py 枚举
        "movement": "push",       # 从 constants.py 枚举
        "composition": "rule_of_thirds",  # 构图规则
    },
    "mood": "tense",              # 从 mood_packs 枚举
    "emotion_intensity": 2,
    "narrative_beat": "confrontation_peak",
    "state_refs": ["char_001.injured_left_arm"],
}
```

#### 任务 3.3：剧情状态管理扩展

**改动文件**：`backend/services/studio_storage.py`（扩展）

```sql
-- 角色跨集状态追踪
CREATE TABLE story_character_states (
    id TEXT PRIMARY KEY,
    series_id TEXT,
    element_id TEXT,
    episode_id TEXT,
    state_key TEXT,          -- e.g., "injured_left_arm", "wearing_battle_suit"
    state_value TEXT,
    valid_from_episode INTEGER,
    valid_to_episode INTEGER,  -- NULL = 持续
    created_at TEXT
);

-- 伏笔矩阵
CREATE TABLE story_foreshadowing (
    id TEXT PRIMARY KEY,
    series_id TEXT,
    planted_episode_id TEXT,
    description TEXT,        -- 伏笔内容
    resolved_episode_id TEXT,  -- 回收的集 ID (NULL = 未回收)
    status TEXT DEFAULT 'planted',  -- planted / resolved / abandoned
    created_at TEXT
);
```

#### 任务 3.4：Agent Pipeline 接入现有批量生成

**改动文件**：`backend/services/studio_service.py`（增强）

在现有 `batch_generate` 方法前增加可选的 Agent Pipeline 前处理：

```python
async def batch_generate_with_agents(self, episode_id, options):
    """增强版批量生成 — 可选 Agent Pipeline"""
    if options.get("use_agent_pipeline"):
        # 先跑 Agent Pipeline 生成/优化提示词
        pipeline = AgentPipeline(series_id, episode_id)
        await pipeline.run_pre_generation(episode)
    # 然后走现有 batch_generate 流程
    await self.batch_generate(episode_id, stages, ...)
```

#### 任务 3.5：Agent 决策日志

**改动文件**：`backend/services/studio_storage.py`（扩展）

```sql
CREATE TABLE agent_decision_log (
    id TEXT PRIMARY KEY,
    series_id TEXT,
    episode_id TEXT,
    agent_role TEXT,
    action TEXT,             -- plan / generate / review / revise
    input_summary TEXT,
    output_summary TEXT,
    model_used TEXT,
    tokens_used INTEGER,
    duration_ms INTEGER,
    created_at TEXT
);
```

#### 任务 3.6：前端 Agent Pipeline 控制面板

**改动文件**：`src/components/studio/AgentPipelinePanel.tsx`（新建）

在 Studio 工作台中新增 Agent Pipeline Tab：

- Agent 角色列表 + 状态指示灯（空闲/工作中/等待）
- 流水线进度可视化（各 Agent 的输入/输出/耗时）
- 可手动介入：暂停流水线、修改中间结果、跳过某个 Agent
- Agent 决策日志时间线

### 6.3 交付标准

- [ ] 完整一集（20-30 格）通过 Agent Pipeline 端到端生产
- [ ] Agent 间通信全部走结构化 JSON，零自然语言传递
- [ ] Agent 决策日志完整记录，可回溯任一步骤
- [ ] 成本对比：Agent Pipeline vs 现有直接调用的 Token 消耗差异
- [ ] 🆕 Claude provider + tool_use 接入验证通过
- [ ] 🆕 API Monitor 可按 Agent 角色维度查看用量

---

## 七、Phase 4 — 全链路贯通与持续迭代（第 16-21 周）

### 7.1 任务清单

#### 任务 4.1：跨集状态持久化贯通

- 角色状态在集与集之间自动传递
- 伏笔矩阵自动追踪和提醒未回收伏笔
- 世界观词典随剧情发展自动更新

#### 任务 4.2：知识库迭代机制

- 基于实际生成结果反馈，自动调整词条权重
- 人工可标记"好词条"/"差词条"，影响后续取词概率
- 支持从优秀生成结果反向提取词条入库

#### 任务 4.3：短视频工作台适配

将 Agent Pipeline 和知识库适配到 `/short-video` 工作台：
- 短视频特有的节奏模板（快切/慢叙/高潮递进）与 Agent 角色协作
- 平台导出预设（抖音/快手/小红书）的提示词自动适配

#### 任务 4.4：数字人工作台适配

将角色档案库和视觉 QA 适配到 `/digital-human` 工作台：
- 数字人 Profile 与角色档案库双向同步
- 口型同步风格的自动匹配

#### 任务 4.5：Agent Bridge 增强

增强现有 Studio ↔ Agent 导入导出桥：
- Agent 模式生成的项目可直接导入 Studio 知识库
- Studio 的角色档案可反哺 Agent 模式使用

#### 任务 4.6：性能优化

- Agent Pipeline 的并行度调优（哪些 Agent 可并行执行）
- 知识库查询缓存（高频角色词条预加载）
- 多模态 QA 的异步化（不阻断主生产线）

#### 🆕 任务 4.7：API Monitor 全面增强

- 历史趋势数据持久化（SQLite 存储，支持按日/周/月聚合查看）
- Agent 级别成本分析面板（哪个 Agent 消耗最多 Token）
- 预算预警通知（接入 WebSocket 推送）

### 7.2 交付标准

- [ ] 3 集连续生产，角色一致性跨集验证通过
- [ ] 知识库经过 3 轮迭代，词条质量稳定
- [ ] 三种工作台模式均已接入 Agent Pipeline
- [ ] 生产效率对比报告：引入 Agent Pipeline 前后的质量/成本/效率

---

## 八、模型分级策略（适配现有多服务商架构）

现有 `llm_service.py` 已支持 13 个 LLM 服务商（11 个可开箱即用，2 个需手动配置）。Agent 模型分级策略需与现有多服务商架构兼容。

🆕 **v2.0 修正**：新增 Anthropic Claude 直连 provider 作为 Phase 3 前置条件。

### 8.1 层级定义

| 层级 | 角色 | 推荐模型 | 现有设置项映射 | 每集调用量 |
|------|------|---------|--------------|----------|
| Tier 1 (决策层) | 制片人、创意总监 | Claude Opus / Doubao Seed | 新增 `agent_tier1_model` | 2-5 次 |
| Tier 2 (创作层) | 编剧系列、QA 系列 | Claude Sonnet / Doubao Pro | 复用现有 `llm.model` | 15-30 次 |
| Tier 3 (生产层) | 提示词组装、批量QA | Claude Sonnet / Qwen Max | 新增 `agent_tier3_model` | 30-60 次 |
| Tier 4 (运维层) | 状态管理、日志、监控 | Claude Haiku / Doubao Lite | 新增 `agent_tier4_model` | 持续 |

### 8.2 配置扩展

在 `studio.settings.local.yaml` 中新增 Agent 模型分级配置：

```yaml
agent_pipeline:
  enabled: false                  # 默认关闭
  tier1:
    provider: "anthropic"         # 🆕 Phase 3 前置新增
    model: "claude-opus-4-6"
  tier2:
    inherit: "llm"                # 继承主 LLM 配置
  tier3:
    provider: "doubao"
    model: "doubao-pro-256k"
  tier4:
    provider: "doubao"
    model: "doubao-lite-128k"
```

### 8.3 成本估算（单集 30 格）

| 阶段 | Tier 1 | Tier 2 | Tier 3 | Tier 4 | 合计 Token |
|------|--------|--------|--------|--------|-----------|
| 当前方案（无 Agent） | — | 3 次 | — | — | ~50K |
| Agent Pipeline | 3 次 | 20 次 | 40 次 | 持续 | ~250-300K |
| 增量成本 | | | | | **约 5-6 倍** |

> 🆕 **v2.0 修正**：增量成本从 v1.0 的"约 4 倍"上调为"约 5-6 倍"。原因：v1.0 未充分计入 QA 回路重试（不通过时需重新生成+再次QA）和 Agent 间上下文传递的开销。但画面一致性和叙事质量的提升可减少人工返工次数，综合 ROI 仍为正向。

---

## 九、技术风险与缓解

| 风险 | 概率 | 影响 | 缓解措施 | 对应阶段 |
|------|------|------|---------|---------|
| 🆕 英文词条注入后画面风格变化 | 中 | 低 | Phase 0 修复后做 A/B 对比测试，必要时调整词条措辞；保留中文 fallback 开关 | Phase 0 |
| 🆕 prompt_templates 激活后帧质量波动 | 中 | 中 | 小批量验证（3-5 格），确认质量提升后全量启用；保留旧逻辑作降级 | Phase 0 |
| 知识库词条质量不足，自动拆分不准确 | 高 | 高 | Phase 1 提供人工编辑入口；先用 LLM 拆分再人工校验；积累标注数据后迭代 | Phase 1 |
| 🆕 Phase 1 延期导致 Phase 2 无法启动 | 中 | 高 | Phase 2 前增加 1 周 buffer；提示词 QA 可先基于 Phase 0 简易映射开发，后切换知识库 | Phase 1→2 |
| 多模态视觉 QA 准确率不足 | 高 | 中 | 先做"标记 warning"而非"阻断生产"；记录 QA 结果供人工确认；逐步积累准确率数据 | Phase 2 |
| 🆕 缺少 Claude 直连阻塞 Phase 3 | 中 | 高 | Phase 3 前置条件明确列出 Claude provider 接入任务；可先用 openrouter 中转开发，后切直连 | Phase 3 |
| Agent Pipeline 增加延迟 | 中 | 中 | Agent Pipeline 作为可选预处理步骤，不替代现有直接生成；并行化 Agent 调用 | Phase 3 |
| 跨 Agent 指令漂移 | 中 | 高 | 结构化 JSON 通信协议；每步输出经 Schema 校验；关键参数从知识库取值而非 LLM 生成 | Phase 3 |
| 现有 SQLite 在高并发下性能瓶颈 | 低 | 中 | 知识库读多写少，适合 SQLite；如需升级，先加读缓存层再评估 PostgreSQL 迁移 | Phase 4 |
| 🆕 成本超预期（5-6 倍而非 2-3 倍） | 中 | 中 | Tier 4 Agent 用最便宜的模型；QA 前置拦截减少无效生图；预算**硬限额**（Phase 3 前置完成）；Agent 粒度成本面板实时监控 | 全阶段 |

---

## 十、两份规划文档间的差异协调

> 🆕 v2.0 新增章节。审计发现《内容产出重塑规划》（以下简称"规划"）与本实施计划之间存在若干差异，需明确协调方案。

| 差异点 | 规划文档 | 本实施计划 | 协调结论 |
|--------|---------|-----------|---------|
| **数据库** | PostgreSQL/Supabase + 向量数据库(Qdrant/Pinecone) | 现有 SQLite 扩展 | **采用实施计划方案**。现有 SQLite 底座稳固，知识库读多写少适合 SQLite。向量数据库的语义检索能力暂通过 LLM 辅助实现，Phase 4 评估是否需要引入 |
| **模型** | 全部基于 Claude API（Opus/Sonnet/Haiku） | 适配现有多服务商（Doubao/Qwen 等） | **混合方案**。日常生产用多服务商降本，Agent 编排层（Phase 3）接入 Claude 直连以使用 tool_use 能力。Tier 1/2 推荐 Claude，Tier 3/4 可用国产模型 |
| **任务队列** | Celery + Redis / Temporal | 现有 SSE 批量生成 + generationQueueStore | **采用实施计划方案**。现有并发控制已足够，Phase 4 根据性能瓶颈评估是否引入 |
| **Agent 数量** | 27+ 独立 Agent | 14 复用 + 8 新建 + 5 合并/暂缓 | **采用实施计划方案**。合理精简，避免过度 Agent 化 |
| **Phase 划分** | Phase 1 包含"Agent 间通信协议规范" | 通信协议推迟到 Phase 3 | **采用实施计划方案**。"知识库先行"策略更稳，Phase 1-2 无需 Agent 间通信 |
| **排版合成 Agent** | 独立 Agent 角色 | "暂不实施" | **合理**。当前系统生成单帧图像，非漫画格排版。未来若支持漫画页排版再启动 |
| **质检回路** | "所有不通过结果必须携带修改指令回传" | v1.0 描述了回路但未强调自动修复 | **v2.0 已对齐**。Phase 2 任务 2.1 明确要求 QAIssue 含 fix_instruction 结构化修改指令 |
| **过肩镜(OTS)** | 明确列为核心角度词条 | v1.0 中未提及 | **v2.0 已对齐**。Phase 0 任务 0.3 补回 over_shoulder 词条 |
| **资产存储** | 对象存储（S3/Cloudflare R2） | 现有本地/在线 URL 存储 | **延后评估**。Phase 4 根据资产量级决定是否迁移至对象存储 |

---

## 十一、文件改动清单

### Phase 0 修复文件（🆕 v2.0 新增）

| 文件路径 | 改动 |
|----------|------|
| `backend/services/studio_service.py` | 英文词条注入、情绪简易映射、激活 prompt_templates |
| `backend/services/studio/constants.py` | 补回 over_shoulder 角度词条 |
| `backend/services/studio/prompts.py` | 同步角度列表至 7+ 种 |
| `backend/services/studio/prompt_sentinel.py` | 敏感词库扩充至 100+ 条 + 三级风险评分 |
| `backend/services/image_service.py` | 修复占位图逻辑矛盾 |
| `backend/services/video_service.py` | 清理/修复 `_generate_qwen_video` 死代码 |
| `src/pages/DigitalHumanWorkbenchPage.tsx` | TTS 试听接入真实后端 |

### 新建文件

| 文件路径 | 阶段 | 说明 |
|----------|------|------|
| `backend/services/studio/knowledge_base.py` | Phase 1 | 知识库 Schema + CRUD |
| `backend/services/studio/mood_packs.py` | Phase 1 | 情绪氛围预制包 |
| `backend/services/studio/prompt_assembler.py` | Phase 1 | 提示词取词组装引擎 |
| `backend/services/studio/narrative_qa.py` | Phase 2 | 叙事一致性审核 |
| `backend/services/studio/visual_qa.py` | Phase 2 | 视觉一致性审核 |
| `backend/services/studio/quality_scorer.py` | Phase 2 | 综合评分 |
| `backend/services/studio/agent_pipeline.py` | Phase 3 | 多 Agent 编排引擎 |
| `backend/services/studio/agent_roles.py` | Phase 3 | Agent 角色注册中心 |
| `backend/services/studio/agent_protocol.py` | Phase 3 | 结构化通信协议 |
| `src/components/studio/KnowledgeBasePanel.tsx` | Phase 1 | 知识库管理 UI |
| `src/components/studio/MoodPackSelector.tsx` | Phase 1 | 情绪包选择器 |
| `src/components/studio/QualityScorePanel.tsx` | Phase 2 | 质量评分面板 |
| `src/components/studio/AgentPipelinePanel.tsx` | Phase 3 | Agent Pipeline 控制面板 |

### 增强文件

| 文件路径 | 阶段 | 改动 |
|----------|------|------|
| `backend/services/studio_storage.py` | Phase 1-3 | 新增 kb_* 表、story_* 表、agent_decision_log 表 |
| `backend/services/studio/prompt_sentinel.py` | Phase 0 + Phase 2 | Phase 0 扩充词库；Phase 2 新增知识库合规检查 |
| `backend/services/studio_service.py` | Phase 0-3 | Phase 0 修复断层；Phase 2 插入 QA 关口；Phase 3 可选 Agent Pipeline |
| `backend/services/studio/constants.py` | Phase 0 + Phase 1 | Phase 0 补角度；Phase 1 新增情绪包常量 |
| `backend/services/llm_service.py` | Phase 3 前置 | 🆕 新增 Anthropic Claude provider + tool_use 支持 |
| `backend/services/api_monitor_service.py` | Phase 3 前置 + Phase 4 | 🆕 Agent 粒度追踪、数据持久化、硬限额 |
| `backend/main.py` | Phase 1-3 | 新增知识库/QA/Agent Pipeline API 端点 |
| `src/store/studioStore.ts` | Phase 1-3 | 新增知识库状态、QA 状态、Agent Pipeline 状态 |
| `src/services/api.ts` | Phase 1-3 | 新增知识库/QA/Agent Pipeline API 调用 |
| `src/components/studio/ShotDetailPanel.tsx` | Phase 1 | 集成情绪包选择器 + 提示词组装预览 |
| `src/components/studio/CharacterSettingCardDialog.tsx` | Phase 1 | 🆕 结构化角色卡字段改造 |
| `src/components/studio/StudioSettingsPanel.tsx` | Phase 1-3 | 新增知识库配置 Tab、Agent Pipeline 配置 |

### 不改动的核心文件

| 文件路径 | 原因 |
|----------|------|
| `backend/services/tts_service.py` | TTS 服务，Agent Pipeline 通过现有接口调用 |
| `backend/services/collab_service.py` | 协作系统，独立于 Agent Pipeline |
| `backend/services/storage_service.py` | Agent/Module 模式的 YAML 存储，不影响 |

> 🆕 **v2.0 变更**：`image_service.py`、`video_service.py`、`llm_service.py`、`api_monitor_service.py` 从"不改动"移至"Phase 0 修复"或"增强"列表。

---

> **总结**：本计划的核心策略是 🆕 **"先修后建、知识库先行、质检中置、编排后置"**——Phase 0 先让已有弹药上膛，Phase 1 解决提示词质量上限问题，Phase 2 建立独立质检能力，Phase 3-4 引入多 Agent 编排。每个阶段都以"可开关、不影响现有功能"为原则，确保系统在渐进演化的过程中始终可用。
