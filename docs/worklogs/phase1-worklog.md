# Phase 1 工作日志 — 提示词知识库落地

> 日期：2026-03-02
> 阶段：Phase 1（第 1-4 周计划中的核心交付）
> 基线：Phase 0 完成后的 main 分支 (ca41ebb)

---

## 总览

Phase 1 的目标是建立"提示词知识库"体系，将现有"自由发挥"的提示词生成流程改造为"知识库约束 + 取词组装"。本阶段交付了 **5 个新建模块** 和 **5 个增强文件**，涵盖后端知识库 Schema、情绪氛围预制包、提示词组装引擎、前端知识库管理 UI、角色卡结构化改造。

---

## 任务完成清单

### Task 1.1: 知识库 Schema 设计与存储层

**改动文件：**
- `backend/services/studio_storage.py` — 新增 4 张知识库表 + 完整 CRUD 方法
- `backend/services/studio/knowledge_base.py` — 新建，知识库高级操作层

**改动内容：**
- 新增 `kb_character_cards` 表：存储角色提示词档案（appearance_tokens/costume_tokens/expression_tokens/signature_poses/negative_prompts）
- 新增 `kb_mood_packs` 表：存储情绪氛围预制包（color_tokens/line_style_tokens/effect_tokens/combined_prompt）
- 新增 `kb_scene_cards` 表：存储场景提示词档案（base_tokens/time_variants/negative_prompts）
- 新增 `kb_world_bible` 表：存储世界观提示词词典（art_style/era/color_palette/recurring_motifs/forbidden_elements）
- 为每张表添加索引，保证查询性能
- StudioStorage 类新增完整 CRUD 方法（create/get/list/update/delete）
- KnowledgeBase 类实现：
  - `sync_character_from_element()`: 从 shared_elements 角色描述自动解析出结构化词条（发型、瞳色、肤色、体型等中文→英文映射）
  - `sync_scene_from_element()`: 从场景描述提取基础空间词条和时段变体
  - `sync_all_elements()`: 批量同步系列下所有角色和场景
  - `get_character_prompt_tokens()` / `get_scene_prompt_tokens()`: 按需取词

---

### Task 1.2: 内置情绪氛围预制包

**改动文件：**
- `backend/services/studio/mood_packs.py` — 新建

**改动内容：**
- 8 种内置情绪氛围包：tense / tender / despair / cool / suspense / warm / angry / fear
- 每种包包含 4 个维度：color_tokens（色调词）、line_style_tokens（线条风格词）、effect_tokens（视觉特效词）、combined_prompt（完整组合）
- 中文别名映射（28+ 中文情绪词 → 8 种标准 mood_key），支持"紧张""害怕""燃"等口语化表达
- MoodPack dataclass 封装
- 自定义包 CRUD（save_custom_mood_pack / delete_custom_mood_pack）
- 设计为可**替代 Phase 0 的简易 EMOTION_VISUAL_HINTS 映射**

---

### Task 1.3: 提示词取词组装引擎

**改动文件：**
- `backend/services/studio/prompt_assembler.py` — 新建

**改动内容：**
- PromptAssembler 类，核心方法：
  - `assemble_character_tokens()`: 从 KB 角色档案取词，组装角色描述英文提示词段
  - `assemble_scene_tokens()`: 从 KB 场景档案取词，含时段变体
  - `inject_cinematography()`: 从 constants.py 取英文景别/角度/运镜词条（Phase 0 逻辑的正式版）
  - `inject_mood()`: 从 mood_packs 取情绪视觉提示词
  - `assemble_shot_prompt()`: **主入口** — 完整单格提示词组装（角色 + 场景 + 镜头语言 + 情绪 + 原始描述 + 负面提示词）
  - `get_negative_prompts()`: 收集涉及元素的负面提示词
- 支持 `[SE_XXX]` 元素引用的自动解析和 KB 查询替换
- 返回结构化结果（prompt / sections / negative_prompt / metadata）

---

### Task 1.4: 集成 PromptAssembler 到 studio_service.py + API 端点

**改动文件：**
- `backend/services/studio_service.py` — 增强
- `backend/main.py` — 新增 14 个 API 端点

**studio_service.py 改动：**
- 新增 `_knowledge_base` / `_prompt_assembler` / `_knowledge_base_enabled` 属性
- 新增 `_get_or_create_prompt_assembler()` 惰性工厂方法
- 新增 `_build_shot_image_prompt_kb()` — KB 组装路径，启用时替代 Phase 0 逻辑
- `_build_shot_image_prompt()` 增加 KB 开关分支：`if self._knowledge_base_enabled`
- `configure()` 方法新增 `knowledge_base.enabled` 配置项解析
- 保持完全向后兼容：KB 默认关闭，不影响现有功能

**main.py 新增 API 端点（14 个）：**
- `GET /api/studio/kb/character-cards/{series_id}` — 列出角色档案
- `POST /api/studio/kb/character-cards/sync/{element_id}` — 同步角色档案
- `PUT /api/studio/kb/character-cards/{card_id}` — 更新角色档案
- `GET /api/studio/kb/scene-cards/{series_id}` — 列出场景档案
- `POST /api/studio/kb/scene-cards/sync/{element_id}` — 同步场景档案
- `PUT /api/studio/kb/scene-cards/{card_id}` — 更新场景档案
- `GET /api/studio/kb/mood-packs` — 列出内置情绪包
- `GET /api/studio/kb/mood-packs/{series_id}` — 列出系列情绪包
- `POST /api/studio/kb/mood-packs` — 创建自定义情绪包
- `DELETE /api/studio/kb/mood-packs/{pack_id}` — 删除自定义情绪包
- `GET /api/studio/kb/world-bible/{series_id}` — 获取世界观词典
- `PUT /api/studio/kb/world-bible/{series_id}` — 更新世界观词典
- `POST /api/studio/kb/sync-all/{series_id}` — 一键全量同步
- `POST /api/studio/kb/assemble-preview` — 提示词组装预览

---

### Task 1.5: 前端知识库管理 UI

**改动文件：**
- `src/components/studio/KnowledgeBasePanel.tsx` — 新建（460 行）
- `src/components/studio/MoodPackSelector.tsx` — 新建（135 行）
- `src/services/api.ts` — 新增知识库 API 调用函数

**KnowledgeBasePanel.tsx：**
- 4 个 Tab：角色档案 / 场景档案 / 情绪氛围包 / 世界观词典
- 角色档案 Tab：从元素库自动同步，展示结构化词条（appearance/costume/expression），支持编辑
- 场景档案 Tab：展示基础词条和时段变体（day/night/sunset/rain）
- 情绪氛围包 Tab：8 个内置包以色彩编码卡片展示，combined_prompt 预览，自定义包管理
- 世界观词典 Tab：编辑 art_style/era/color_palette/recurring_motifs/forbidden_elements
- 顶部"一键同步"按钮调用 syncAllKB API

**MoodPackSelector.tsx：**
- 紧凑型下拉选择器，用于 ShotDetailPanel 中选择情绪包
- 8 种情绪带色彩标识，选择后预览 combined_prompt
- 支持 seriesId 加载系列专属包

**api.ts 新增：**
- 类型定义：KBCharacterCard / KBSceneCard / KBMoodPack / KBWorldBible
- 9 个 API 函数：fetchKBCharacterCards / syncKBCharacterCard / updateKBCharacterCard / fetchKBSceneCards / syncKBSceneCard / fetchKBMoodPacks / fetchKBWorldBible / updateKBWorldBible / syncAllKB

---

### Task 1.6: 前端角色卡结构化改造

**改动文件：**
- `src/components/studio/CharacterSettingCardDialog.tsx` — 增强

**改动内容：**
- 在现有描述 textarea 下方新增可折叠的"结构化提示词档案"区域
- 外貌特征：hair / eyes / skin / build 独立输入字段
- 服装变体：default / battle / casual 可切换标签，每种变体独立文本输入
- 表情库：happy / angry / sad / shocked / determined / neutral 网格布局，每个表情对应英文提示词
- 负面提示词：专用文本输入，防止生成偏差
- "同步到知识库"按钮，调用 syncKBCharacterCard API
- 保留原有 textarea 作为主输入，结构化字段默认折叠（`showStructuredFields` 开关）

---

## 文件改动统计

| 文件 | 状态 | 行数 |
|------|------|------|
| `backend/services/studio/knowledge_base.py` | 新建 | 390 |
| `backend/services/studio/mood_packs.py` | 新建 | 440 |
| `backend/services/studio/prompt_assembler.py` | 新建 | 312 |
| `src/components/studio/KnowledgeBasePanel.tsx` | 新建 | 460 |
| `src/components/studio/MoodPackSelector.tsx` | 新建 | 135 |
| `backend/services/studio_storage.py` | 增强 | 2246 (+868) |
| `backend/services/studio_service.py` | 增强 | 4611 (+127) |
| `backend/main.py` | 增强 | 9405 (+214) |
| `src/services/api.ts` | 增强 | 3397 (+192) |
| `src/components/studio/CharacterSettingCardDialog.tsx` | 增强 | 558 (+189) |

**新增代码总计：~2,927 行**

---

## 架构设计要点

1. **可开关设计**：知识库功能通过 `knowledge_base.enabled` 设置控制，默认关闭，不影响现有功能
2. **向后兼容**：Phase 0 的 EMOTION_VISUAL_HINTS 作为 fallback 保留，KB 未启用时自动使用
3. **数据扩展优先**：在现有 SQLite 中新增 4 张表，通过 _migrate_schema 确保平滑升级
4. **中英文双向**：角色/场景词条支持中文描述→英文提示词的自动映射，情绪包支持 28+ 中文别名
5. **结构化输出**：PromptAssembler 返回结构化结果（sections/metadata），便于调试和 Phase 2 质检

---

## 下一阶段：Phase 2 — 双 Agent 质检回路

Phase 2 前置条件已满足：
- [x] Phase 1 知识库 CRUD + 自动同步功能已完成
- [ ] 至少 3 个角色和 5 个场景完成知识库词条录入（需用户在 UI 中操作）
