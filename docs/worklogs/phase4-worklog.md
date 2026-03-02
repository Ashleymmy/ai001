# Phase 4 工作日志 — 全链路贯通与持续迭代

> 日期：2026-03-02
> 阶段：Phase 4（第 16-21 周计划中的核心交付）
> 基线：Phase 3 完成后的 main 分支 (af34c4c)

---

## 总览

Phase 4 的目标是将 Phase 1-3 建立的知识库、QA 质检、Agent Pipeline 贯通到全部工作台模式，并引入反馈迭代、跨集状态持久化、性能优化等能力。本阶段交付了 **3 个新建后端模块**，以及 **3 个增强文件**。

---

## 任务完成清单

### Task 4.1: 跨集状态持久化贯通

**改动文件：**
- `backend/services/studio/story_state_manager.py` — 新建（379 行）

**改动内容：**
- StoryStateManager 类：
  - `propagate_character_states()` — 将活跃角色状态从一集传递到下一集
  - `get_character_snapshot()` — 获取角色在特定集的完整状态快照
  - `track_state_change()` — 记录状态变化，自动关闭旧状态
  - `get_unresolved_foreshadowing()` — 获取未回收伏笔
  - `resolve_foreshadowing()` / `abandon_foreshadowing()` — 伏笔生命周期管理
  - `check_foreshadowing_warnings()` — 检测超过阈值未回收的伏笔
  - `get_episode_state_summary()` — 完整集状态摘要（角色状态 + 伏笔 + 警告），供 Agent Pipeline 注入
  - `auto_update_world_bible()` — 根据剧情发展自动扩展世界观词典

### Task 4.2: 知识库迭代机制

**改动文件：**
- `backend/services/studio/kb_feedback.py` — 新建（464 行）

**改动内容：**
- TokenFeedback / TokenWeight 数据类
- KBFeedbackManager 类：
  - `record_feedback()` — 记录好/差评，调整权重（good +0.1, bad -0.15, 非对称惩罚）
  - `get_weighted_tokens()` — 按权重排序，过滤低权重词条（<0.3）
  - `extract_tokens_from_prompt()` — 解析 `(token:1.2)` 和 `[token]` 格式
  - `reverse_extract()` — 从成功生成结果反向提取新词条（style_tokens / composition_tokens）
  - `suggest_kb_updates()` — 生成词条更新建议（boost / demote / remove / add）
  - `apply_weights_to_prompt()` — 将权重应用到提示词（高权重强调、低权重弱化）
  - `get_feedback_stats()` — 反馈统计（top/bottom 词条、改善趋势）
  - `export_weights()` / `import_weights()` — 权重持久化

### Task 4.3: 短视频工作台适配

**改动文件：**
- `backend/services/studio/pipeline_optimizer.py` — 新建（部分，~230 行）

**改动内容：**
- RhythmTemplate 数据类
- 5 套节奏模板：
  | 模板 | 平台 | 时长 | 镜头数 | 特点 |
  |------|------|------|--------|------|
  | fast_cut | 通用 | 60s | 19 | 快切，动作/悬疑 |
  | slow_narrative | 通用 | 90s | 12 | 慢叙，治愈/情感 |
  | climax_build | 通用 | 75s | 19 | 递进，热血/燃 |
  | douyin_hook | 抖音 | 45s | 13 | 3秒 hook 开头 |
  | xiaohongshu_aesthetic | 小红书 | 60s | 12 | 美学视觉导向 |
- `adapt_pipeline_for_short_video()` — 根据节奏模板调整 pipeline 参数

### Task 4.4: 数字人工作台适配

**改动文件：**
- `backend/services/studio/pipeline_optimizer.py` — 新建（部分，~160 行）

**改动内容：**
- `sync_digital_human_to_kb()` — 数字人 Profile → KB 角色卡同步
- `sync_kb_to_digital_human()` — KB 角色卡 → 数字人 Profile 反向同步
- `auto_match_lip_sync_style()` — 基于语音特征自动匹配口型同步风格（14 个关键词映射）

### Task 4.5: Agent Bridge 增强

**改动文件：**
- `backend/services/studio/pipeline_optimizer.py` — 新建（部分，~180 行）

**改动内容：**
- `import_agent_project_to_kb()` — Agent 项目元素 → KB 批量导入（支持两种数据格式）
- `export_kb_for_agent()` — KB 完整导出为 Agent 模式可消费的结构化数据（format_version: "1.0"）

### Task 4.6: 性能优化

**改动文件：**
- `backend/services/studio/pipeline_optimizer.py` — 新建（部分，~220 行）

**改动内容：**
- `PARALLEL_STAGE_GROUPS` — 可并行执行的阶段声明
- `KBCache` 类：TTL + FIFO 淘汰缓存，命中率统计，模块级单例 `get_shared_kb_cache()`
- `run_parallel_stages()` — 信号量控制的并发阶段执行器
- `AsyncQARunner` 类：异步 QA 检查执行器，不阻断主生产线

### Task 4.7: 集成到 studio_service.py + API 端点

**改动文件：**
- `backend/services/studio_service.py` — 增强
- `backend/main.py` — 新增 12 个 API 端点
- `src/services/api.ts` — 新增类型定义 + API 函数

**studio_service.py 新增方法：**
- Phase 4 惰性工厂：`_get_story_state_manager()` / `_get_kb_feedback()`
- Task 4.1: `propagate_episode_states()` / `get_episode_state_summary()` / `get_foreshadowing_warnings()`
- Task 4.2: `record_token_feedback()` / `get_kb_feedback_stats()` / `suggest_kb_updates()`
- Task 4.3: `get_rhythm_templates()`
- Task 4.4: `sync_dh_to_kb()` / `sync_kb_to_dh()`
- Task 4.5: `import_agent_to_kb()` / `export_kb_for_agent_mode()`

**main.py 新增 API：**

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/studio/story-state/summary/{series_id}/{episode_id}` | GET | 集状态摘要 |
| `/api/studio/story-state/propagate` | POST | 跨集状态传递 |
| `/api/studio/story-state/foreshadowing-warnings/{series_id}` | GET | 伏笔警告 |
| `/api/studio/kb/feedback` | POST | 记录词条反馈 |
| `/api/studio/kb/feedback-stats/{series_id}` | GET | 反馈统计 |
| `/api/studio/kb/suggest-updates/{series_id}/{element_id}` | GET | 更新建议 |
| `/api/studio/rhythm-templates` | GET | 节奏模板列表 |
| `/api/studio/digital-human/sync-to-kb/{profile_id}` | POST | 数字人→KB同步 |
| `/api/studio/digital-human/sync-from-kb` | POST | KB→数字人同步 |
| `/api/studio/agent-bridge/import-to-kb` | POST | Agent→KB导入 |
| `/api/studio/agent-bridge/export-kb/{series_id}` | GET | KB→Agent导出 |

**api.ts 新增：**
- 类型定义：EpisodeStateSummary、TokenFeedbackResult、RhythmTemplate
- 12 个 API 函数

---

## 文件改动统计

| 文件 | 状态 | 行数 |
|------|------|------|
| `backend/services/studio/story_state_manager.py` | 新建 | 379 |
| `backend/services/studio/kb_feedback.py` | 新建 | 464 |
| `backend/services/studio/pipeline_optimizer.py` | 新建 | 796 |
| `backend/services/studio_service.py` | 增强 | +80 |
| `backend/main.py` | 增强 | +110 |
| `src/services/api.ts` | 增强 | +120 |

**新增代码总计：~1,949 行**

---

## 架构设计要点

1. **跨集状态传播**：`propagate_character_states()` 仅传播活跃状态（valid_to 为空），自动关闭已过期状态
2. **非对称反馈**：差评惩罚（-0.15）大于好评奖励（+0.1），确保低质量词条快速降权
3. **反向提取**：从成功生成结果中提取新词条，分三类（new_tokens / style_tokens / composition_tokens）
4. **平台适配**：5 套节奏模板覆盖通用 + 抖音 + 小红书，`adapt_pipeline_for_short_video()` 自动分配镜头时长和情绪
5. **双向同步**：数字人 Profile ↔ KB 角色卡双向同步，`auto_match_lip_sync_style()` 基于关键词评分
6. **KB 缓存**：TTL 300s + FIFO 淘汰 + 命中率统计，模块级单例避免重复实例化
7. **异步 QA**：`AsyncQARunner` 将 QA 检查作为后台 asyncio.Task 执行，不阻断图像生成
