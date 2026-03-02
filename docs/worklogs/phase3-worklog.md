# Phase 3 工作日志 — 多 Agent 编排引擎

> 日期：2026-03-02
> 阶段：Phase 3（第 10-15 周计划中的核心交付）
> 基线：Phase 2 完成后的 main 分支

---

## 总览

Phase 3 的目标是将现有单一 LLM 调用链升级为多 Agent 角色编排，引入结构化通信协议、跨集状态管理、伏笔矩阵、Agent 决策日志等能力。本阶段交付了 **3 个新建后端模块**、**1 个新建前端组件**，以及 **4 个增强文件**。

---

## 任务完成清单

### Task 3.1: Agent 角色注册中心

**改动文件：**
- `backend/services/studio/agent_roles.py` — 新建（214 行）

**改动内容：**
- AgentRole 数据类：role_id、display_name/display_name_en、department、model_tier、system_prompt、description、calls_per_episode、can_use_tools
- 10 个核心 Agent 角色定义：
  | 角色 | 部门 | 模型层级 | 每集调用 |
  |------|------|---------|---------|
  | 制片人 (Producer) | executive | Tier 1 (Opus) | 2-3 |
  | 世界观构建 (World Builder) | story | Tier 2 (Sonnet) | 1-2 |
  | 角色开发 (Character Developer) | story | Tier 2 | 2-5 |
  | 对话编剧 (Dialogue Writer) | story | Tier 2 | 5-10 |
  | 分镜编剧 (Storyboard Writer) | story | Tier 2 | 1-3 |
  | 提示词组装 (Prompt Compositor) | visual | Tier 3 (Sonnet) | 10-30 |
  | 叙事QA (Narrative QA) | tech | Tier 2 | 1-2 |
  | 视觉QA (Visual QA) | tech | Tier 2 | 10-30 |
  | 提示词QA (Prompt QA) | tech | Tier 4 (Haiku) | 10-30 |
  | 剧情状态管理 (State Manager) | tech | Tier 4 | 持续 |
- MODEL_TIERS 定义 4 级模型映射（Opus / Sonnet / Sonnet / Haiku）
- 工具函数：get_agent_role()、list_agent_roles()、list_roles_by_department()

### Task 3.2: 结构化通信协议

**改动文件：**
- `backend/services/studio/agent_protocol.py` — 新建（358 行）

**改动内容：**
- AgentMessage 数据类：message_id、task_id、source/target_agent、message_type、payload、context_refs、status
- 6 种消息类型：task_assignment、task_result、review_request、review_result、revision_request、context_update
- 8 套 JSON Schema 模板：
  - SHOT_SPEC_SCHEMA — 分镜规格（framing/angle/movement/composition/mood/emotion_intensity/narrative_beat/state_refs）
  - TASK_PLAN_SCHEMA — 制片人任务拆解输出
  - WORLD_CONTEXT_SCHEMA — 世界观构建输出
  - CHARACTER_PROFILE_SCHEMA — 角色开发输出
  - DIALOGUE_BATCH_SCHEMA — 对话编剧输出
  - STORYBOARD_SCHEMA — 分镜编剧输出
  - QA_RESULT_SCHEMA — QA 审核结果
  - REVISION_INSTRUCTION_SCHEMA — 修改指令
- AgentMessageBus 类：消息路由、校验、历史查询
- 有效值枚举：6 个景别、8 个角度、7 个运镜、8 种情绪，从 constants.py 和 mood_packs.py 对齐
- 工具函数：create_task_id()、create_message()

### Task 3.3: 剧情状态管理扩展

**改动文件：**
- `backend/services/studio_storage.py` — 增强

**改动内容：**
- 新增 3 张 SQLite 表：
  - `story_character_states` — 角色跨集状态追踪（state_key / state_value / valid_from/to_episode）
  - `story_foreshadowing` — 伏笔矩阵（planted / resolved / abandoned）
  - `agent_decision_log` — Agent 决策日志（agent_role / action / model / tokens / duration）
- 4 个索引：按 series_id、status、episode_id、pipeline_id 加速查询
- CRUD 方法：
  - create_character_state / list_character_states / delete_character_state
  - create_foreshadowing / list_foreshadowing / update_foreshadowing / delete_foreshadowing
  - log_agent_decision / list_agent_decisions

### Task 3.4: Agent Pipeline 编排引擎

**改动文件：**
- `backend/services/studio/agent_pipeline.py` — 新建（639 行）

**改动内容：**
- PipelineStage 枚举：13 个阶段（planning → completed）
- PipelineState 数据类：pipeline_id、stages_completed/remaining、agent_outputs、decision_log，支持序列化（pause/resume）
- AgentPipeline 类：
  - `run_episode_pipeline()` — 完整 12 阶段顺序执行
  - `run_pre_generation()` — 仅前 8 个内容阶段（供 batch_generate 前置增强）
  - 12 个 `_run_*` 方法对应每个阶段
  - QA 重试机制：narrative_qa 最多重试 2 次
  - LLM 调用抽象：llm_service 为空时返回 mock 结果
  - 决策日志：每步记录 agent_role / action / model / tokens / duration
  - 进度回调：on_progress(stage, status, detail)
- 工厂函数：create_pipeline()

### Task 3.5: Agent 决策日志

**改动文件：**
- `backend/services/studio_storage.py` — 增强（同 Task 3.3）

**改动内容：**
- agent_decision_log 表设计 + log_agent_decision() / list_agent_decisions() 方法
- 支持按 episode_id 或 pipeline_id 查询

### Task 3.6: 前端 Agent Pipeline 控制面板

**改动文件：**
- `src/components/studio/AgentPipelinePanel.tsx` — 新建（411 行）

**改动内容：**
- Agent 角色花名册：grid 布局，状态指示灯（idle/working/waiting/completed/error），部门色彩编码
- Pipeline 进度可视化：垂直时间线，进度条，阶段中文标签
- 手动介入：开始/暂停/重置按钮，跳过指定阶段
- 决策日志时间线：时间戳、Agent 角色、token 消耗、耗时
- 轮询机制：pipeline 运行时每 2 秒刷新状态

### Task 3.7: 集成到 studio_service.py + API 端点

**改动文件：**
- `backend/services/studio_service.py` — 增强
- `backend/main.py` — 新增 12 个 API 端点
- `src/services/api.ts` — 新增类型定义 + API 函数

**studio_service.py 改动：**
- 新增 `_active_pipelines` / `_agent_pipeline_enabled` 属性
- 新增方法：
  - `get_agent_roles_list()` / `get_agent_roles_by_department()`
  - `start_agent_pipeline()` — 启动异步 pipeline
  - `get_pipeline_state()` / `get_pipeline_decision_log()`
  - `list_character_states()` / `create_character_state()` / `delete_character_state()`
  - `list_foreshadowing()` / `create_foreshadowing()` / `update_foreshadowing()` / `delete_foreshadowing()`

**main.py 新增 API：**

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/studio/agent-pipeline/roles` | GET | Agent 角色列表 |
| `/api/studio/agent-pipeline/{series_id}/agents` | GET | 系列 Agent 列表 |
| `/api/studio/agent-pipeline/{episode_id}/start` | POST | 启动 Pipeline |
| `/api/studio/agent-pipeline/{episode_id}/pause` | POST | 暂停 Pipeline |
| `/api/studio/agent-pipeline/{episode_id}/skip/{stage}` | POST | 跳过阶段 |
| `/api/studio/agent-pipeline/{episode_id}/state` | GET | Pipeline 状态 |
| `/api/studio/agent-pipeline/{episode_id}/decisions` | GET | 决策日志 |
| `/api/studio/story-state/characters/{series_id}` | GET | 角色状态列表 |
| `/api/studio/story-state/characters` | POST | 创建角色状态 |
| `/api/studio/story-state/characters/{state_id}` | DELETE | 删除角色状态 |
| `/api/studio/story-state/foreshadowing/{series_id}` | GET | 伏笔列表 |
| `/api/studio/story-state/foreshadowing` | POST | 创建伏笔 |
| `/api/studio/story-state/foreshadowing/{fid}` | PUT | 更新伏笔 |
| `/api/studio/story-state/foreshadowing/{fid}` | DELETE | 删除伏笔 |

**api.ts 新增：**
- 类型定义：AgentRoleInfo、PipelineStageInfo、DecisionLogEntry、PipelineState、CharacterState、Foreshadowing
- 15 个 API 函数：getAgentRoles、startAgentPipeline、pauseAgentPipeline、skipPipelineStage、getPipelineState、getPipelineDecisions、listCharacterStates、createCharacterState、deleteCharacterState、listForeshadowing、createForeshadowing、updateForeshadowing、deleteForeshadowing 等

---

## 文件改动统计

| 文件 | 状态 | 行数 |
|------|------|------|
| `backend/services/studio/agent_roles.py` | 新建 | 214 |
| `backend/services/studio/agent_protocol.py` | 新建 | 358 |
| `backend/services/studio/agent_pipeline.py` | 新建 | 639 |
| `src/components/studio/AgentPipelinePanel.tsx` | 新建 | 411 |
| `backend/services/studio_storage.py` | 增强 | +220 |
| `backend/services/studio_service.py` | 增强 | +100 |
| `backend/main.py` | 增强 | +130 |
| `src/services/api.ts` | 增强 | +160 |

**新增代码总计：~2,232 行**

---

## 架构设计要点

1. **角色分层**：4 部门（executive/story/visual/tech）× 4 模型层级（Opus/Sonnet/Sonnet/Haiku），成本可控
2. **结构化通信**：8 套 JSON Schema 约束 Agent 间数据交换，杜绝自由文本传递关键参数
3. **Pipeline 韧性**：每阶段 try/except 隔离，单阶段失败不阻断全链路
4. **QA 重试**：叙事 QA 最多重试 2 次，修改指令结构化传递
5. **LLM 抽象**：llm_service 为空时返回 mock 结果，支持无 LLM 环境测试
6. **状态可序列化**：PipelineState.to_dict() 支持 pause/resume
7. **跨集状态**：story_character_states 表追踪角色状态变化，story_foreshadowing 表管理伏笔生命周期
8. **决策可追溯**：agent_decision_log 记录每步 agent 调用的输入/输出/模型/token/耗时
