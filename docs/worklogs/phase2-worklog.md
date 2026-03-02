# Phase 2 工作日志 — 双 Agent 质检回路

> 日期：2026-03-02
> 阶段：Phase 2（第 5-9 周计划中的核心交付）
> 基线：Phase 1 完成后的 main 分支 (dc5308b)

---

## 总览

Phase 2 的目标是引入独立质检能力，在生产链路中插入三道质检关口：叙事 QA、提示词 QA、视觉 QA。本阶段交付了 **4 个新建模块** 和 **4 个增强文件**。

---

## 任务完成清单

### Task 2.1: 叙事 QA 模块

**改动文件：**
- `backend/services/studio/narrative_qa.py` — 新建（210 行）

**改动内容：**
- QAIssue / QAResult 数据类：所有问题携带 severity、description、fix_suggestion、fix_instruction（结构化修改指令）、affected_shots
- 本地规则引擎（不依赖 LLM）：
  - `_check_character_presence()`: 角色引用检查 — 提到角色名但未使用 [SE_] 元素引用
  - `_check_scene_continuity()`: 场景连续性 — 相邻镜头景别跳跃过大（>4 级差）
  - `_check_emotion_consistency()`: 情绪一致性 — 情绪标签与描述内容矛盾检测
  - `_check_dialogue_assignment()`: 对白归属 — 有对白但未标注说话角色
  - `_check_missing_fields()`: 关键字段完整性 — 缺描述/提示词、未设景别
- NarrativeQA 类：check_episode() 聚合所有检查，计算加权分数（error -15 / warning -5 / info -1）
- 预留 LLM 深度审核提示词（Phase 3 启用）

### Task 2.2: 提示词 QA 增强

**改动文件：**
- `backend/services/studio/prompt_sentinel.py` — 增强

**改动内容：**
- 新增 `check_kb_compliance()` 函数：知识库合规性检查
  - 禁止元素检查：验证提示词不包含 world_bible.forbidden_elements 中的词条
  - 角色词条覆盖率：检查提示词中角色外貌特征的覆盖比例（<30% 视为自由发挥）
  - 情绪词条验证：检查情绪标签是否在预制包中
  - 景别/角度标准化：检查是否使用 constants.py 中的标准词条
- 返回结构化结果（compliant / score / issues）

### Task 2.3: 视觉 QA 基础版

**改动文件：**
- `backend/services/studio/visual_qa.py` — 新建（160 行）

**改动内容：**
- VisualQA 类：
  - `check_character_consistency()`: 基于提示词的前置校验
    - 检查提示词是否包含角色档案的关键特征词
    - 检查负面提示词是否被注入
    - 标记潜在视觉偏差风险
  - `check_scene_continuity()`: 预留接口（Phase 3 启用 LLM 图像比对）
- 预留多模态 LLM 审核提示词（Phase 3 接入 Claude Vision 后启用）

### Task 2.4: 综合评分模块

**改动文件：**
- `backend/services/studio/quality_scorer.py` — 新建（100 行）

**改动内容：**
- QualityScorer 类：按权重聚合三个 QA 结果
  - 叙事 QA: 40%
  - 提示词 QA: 35%
  - 视觉 QA: 25%
- QualityScore 数据类：overall_score / narrative_score / prompt_score / visual_score / passed / issues

### Task 2.5: 质检集成到 studio_service.py + API 端点

**改动文件：**
- `backend/services/studio_service.py` — 增强
- `backend/main.py` — 新增 4 个 QA API 端点

**studio_service.py 改动：**
- 新增 `_narrative_qa` / `_visual_qa` / `_quality_scorer` 属性
- 新增方法：
  - `run_narrative_qa(episode_id)`: 对集执行叙事检查
  - `run_visual_qa(shot_id)`: 对镜头执行视觉检查
  - `run_prompt_qa(shot_id)`: 对镜头执行提示词检查（安全 + KB 合规）
  - `run_full_qa(episode_id)`: 完整质量评估
  - `_build_kb_context(series_id)`: 构建 KB 上下文

**main.py 新增 API：**
- `POST /api/studio/qa/narrative/{episode_id}` — 叙事检查
- `POST /api/studio/qa/prompt/{shot_id}` — 提示词检查
- `POST /api/studio/qa/visual/{shot_id}` — 视觉检查
- `POST /api/studio/qa/full/{episode_id}` — 完整质量评估

### Task 2.6: 前端质量评分面板

**改动文件：**
- `src/components/studio/QualityScorePanel.tsx` — 新建（200 行）
- `src/services/api.ts` — 新增 QA API 调用

**QualityScorePanel.tsx：**
- 综合评分卡（带通过/未通过状态）
- 三维分数展示（叙事/提示词/视觉，含权重标注）
- 问题统计（error/warning/info 计数）
- 可折叠问题详情列表，按严重等级颜色编码
- "开始检查"按钮触发完整 QA

**api.ts 新增：**
- 类型定义：QAIssue / QualityScore
- 4 个 API 函数：runNarrativeQA / runPromptQA / runVisualQA / runFullQA

---

## 文件改动统计

| 文件 | 状态 | 行数 |
|------|------|------|
| `backend/services/studio/narrative_qa.py` | 新建 | 210 |
| `backend/services/studio/visual_qa.py` | 新建 | 160 |
| `backend/services/studio/quality_scorer.py` | 新建 | 100 |
| `src/components/studio/QualityScorePanel.tsx` | 新建 | 200 |
| `backend/services/studio/prompt_sentinel.py` | 增强 | +110 |
| `backend/services/studio_service.py` | 增强 | +115 |
| `backend/main.py` | 增强 | +50 |
| `src/services/api.ts` | 增强 | +45 |

**新增代码总计：~990 行**

---

## 架构设计要点

1. **独立质检**：三个 QA 模块完全独立于生产侧，不影响现有生成流程
2. **结构化修改指令**：所有 QAIssue 携带 fix_instruction 字段，可被自动应用（对齐规划文档要求）
3. **本地规则优先**：Phase 2 使用本地规则引擎，不依赖 LLM 调用，零额外成本
4. **LLM 预留**：叙事 QA 和视觉 QA 均预留了 LLM 深度审核接口和提示词模板，Phase 3 启用
5. **加权评分**：综合分数 = 叙事(40%) + 提示词(35%) + 视觉(25%)，error 直接判定不通过
