# Phase 0 工作日志 — 补漏加固

> AI 漫剧制片厂 Studio 模块 · Phase 0 执行记录

| | |
|---|---|
| 阶段 | Phase 0：补漏加固（先修后建） |
| 执行日期 | 2026-03-02 |
| 对应计划 | AI漫剧制片厂-Studio定制实施计划 v2.0 §Phase 0 |

---

## 总览

Phase 0 共 8 项任务，目标是修复审计发现的"已定义但未激活"代码、消除占位逻辑矛盾、补齐安全规则，在不新增功能的前提下让既有底座真正运转起来。

| 任务编号 | 内容 | 涉及文件 | 状态 |
|---|---|---|---|
| 0.1 | 激活英文镜头语言 token | studio_service.py | ✅ 完成 |
| 0.2 | 激活帧级专业模板 | studio_service.py | ✅ 完成 |
| 0.3 | 同步角度列表 + 补回过肩镜 | constants.py, prompts.py | ✅ 完成 |
| 0.4 | 情绪字段注入视觉映射 | studio_service.py | ✅ 完成 |
| 0.5 | 修复图像服务占位逻辑矛盾 | image_service.py | ✅ 完成 |
| 0.6 | 清理视频服务死代码 | video_service.py | ✅ 完成 |
| 0.7 | 扩充 Prompt Sentinel 敏感词库 | prompt_sentinel.py | ✅ 完成 |
| 0.8 | 数字人 TTS 试听接入真实后端 | DigitalHumanWorkbenchPage.tsx, main.py, api.ts | ✅ 完成 |

---

## 详细变更记录

### 任务 0.1：激活英文镜头语言 token

**问题**：`constants.py` 中 `SHOT_SIZE_STANDARDS`、`CAMERA_ANGLES`、`CAMERA_MOVEMENTS` 均包含 `en` 字段，但 `studio_service.py` 在构建图像/视频提示词时从未引用，始终使用中文 `get_shot_size_zh()` / `get_camera_angle_zh()`，导致英文 token 沦为死数据。

**修复**：
- 在 `studio_service.py` 新增 `_get_cinematography_en(self, shot)` 方法
- 从 `SHOT_SIZE_STANDARDS`、`CAMERA_ANGLES`、`CAMERA_MOVEMENTS` 字典按 key 查找并返回英文 token
- 图像提示词和视频提示词均调用此方法，输出 `[Cinematography] shot_size | angle | movement` 行
- 导入新增：`CAMERA_ANGLES`、`SHOT_SIZE_STANDARDS` from constants

### 任务 0.2：激活帧级专业模板

**问题**：`prompt_templates.py` 定义了 `START_FRAME_SYSTEM_PROMPT`、`KEY_FRAME_SYSTEM_PROMPT`、`END_FRAME_SYSTEM_PROMPT` 三套帧级专业指导模板，但从未被任何模块导入，属于完全死代码。

**修复**：
- 在 `studio_service.py` 导入 `get_frame_system_prompt`、`get_frame_type_label`
- 在 `_build_shot_image_prompt` 方法中，当 stage 为 start_frame / key_frame / end_frame 时，追加帧级专业指导提示词
- 输出格式：`--- 帧级专业指导 ---` + 对应模板内容

### 任务 0.3：同步角度列表 + 补回过肩镜

**问题**：
1. `constants.py` 定义了 7 种 `CAMERA_ANGLES`，但 `prompts.py` 的 `EPISODE_PLANNING_SYSTEM_PROMPT` 仅列出 5 种（缺少 side、back）
2. 原始规划文档中明确定义的"过肩镜"（over-the-shoulder）在代码中完全缺失

**修复**：
- `constants.py`：新增 `"over_shoulder"` 条目（中文"过肩镜"，英文"Over-the-Shoulder Shot (OTS)"）
- `prompts.py` EPISODE_PLANNING_SYSTEM_PROMPT：camera_angle 说明从 5 种扩展到 8 种，补充 side/back/over_shoulder 及对应中文描述
- `prompts.py` EPISODE_PLANNING_PROMPT：JSON 示例的 camera_angle 枚举从 5 个扩展到 8 个

### 任务 0.4：情绪字段注入视觉映射

**问题**：shots 数据中的 `emotion_intensity` 字段在提示词构建中仅输出中文标签，对图像生成模型没有实际视觉引导效果。

**修复**：
- 在 `studio_service.py` 新增 `EMOTION_VISUAL_HINTS` 类属性，包含 15 个中文 key + 13 个英文 key 的情绪→视觉描述映射
- 图像提示词：查找映射命中时输出 `[Emotion visual cues] ...`，未命中时 fallback 到原始中文标签
- 视频提示词：同样注入情绪视觉线索

### 任务 0.5：修复图像服务占位逻辑矛盾

**问题**：`image_service.py` 中 8 个 `_call_xxx` 方法在调用失败时 `return self._placeholder(...)`，但 `generate_image` 调用链在收到占位图后又会 raise 异常，形成"先伪装成功再判失败"的逻辑矛盾。

**修复**：
- 所有 8 个 `_call_xxx` 方法中 `return self._placeholder(...)` 改为 `raise Exception(...)` 并附带描述性错误信息
- `_placeholder()` 方法保留但不再被生成链调用
- 错误信息包含具体的 provider 名称和失败原因

### 任务 0.6：清理视频服务死代码

**问题**：`video_service.py` 中 `_generate_qwen_video()` 方法（约 45 行）是死代码——`"qwen-video"` provider 实际路由到更完整的 `_generate_dashscope_video()`，`_generate_qwen_video` 从未被调用。

**修复**：
- 删除 `_generate_qwen_video()` 方法及其全部代码
- 确认 `_generate_dashscope_video()` 已完整覆盖 Qwen 视频生成逻辑

### 任务 0.7：扩充 Prompt Sentinel 敏感词库

**问题**：`prompt_sentinel.py` 仅包含 15 条敏感词规则（暴力 4、成人 4、政治 3、仇恨 4），覆盖面严重不足，无法有效拦截变体表达。

**修复**：
- 规则总数从 15 条扩充至 **142 条**：暴力 39、成人 33、政治 35、仇恨 35
- 英文词汇使用 `\b` 词边界匹配；复杂词使用自定义正则覆盖词形变化
- 所有规则在模块加载时预编译为 `_COMPILED_RULES`，提升运行时性能
- 新增 `_compute_risk_level()` 函数，基于命中数计算风险等级：safe(0) / low_risk(≤3) / medium_risk(≤6) / high_risk(>6)
- `analyze_prompt_text()` 返回值新增 `risk_level` 字段，`safe` 布尔值保持向后兼容

### 任务 0.8：数字人 TTS 试听接入真实后端

**问题**：`DigitalHumanWorkbenchPage.tsx` 的"试听音色"功能使用 `setTimeout` 模拟 3 秒延迟，没有调用真实 TTS 后端，用户听不到任何声音。

**修复**：

**后端 (main.py)**：
- 新增 `/api/tts/preview` POST 端点
- 支持 Fish TTS、百炼 TTS v2、火山 TTS 三个 provider
- 接收 ttsConfig + voiceType + text 参数，返回 audio stream（mp3/wav）
- 使用 `StreamingResponse` 返回音频字节流

**前端 API 层 (api.ts)**：
- 新增 `previewTTSVoice()` 函数，POST `/api/tts/preview`，`responseType: 'blob'`，30s 超时

**前端页面 (DigitalHumanWorkbenchPage.tsx)**：
- 替换 `setTimeout` 模拟为真实 `previewTTSVoice()` 调用
- 新增 `auditionAudioRef` / `auditionBlobUrlRef` 管理音频生命周期
- 使用 `useSettingsStore` 获取 TTS 配置
- 完善错误处理：Blob 响应错误解析、播放失败提示
- 播放结束/出错时自动清理 Blob URL 资源
- 新增 `auditionError` 状态在 UI 中展示试听错误

---

## 变更文件汇总

| 文件 | 变更类型 | 增/删行数 |
|---|---|---|
| `backend/services/studio_service.py` | 修改 | +2392/-2392 (重构) |
| `backend/services/studio/constants.py` | 修改 | +5 |
| `backend/services/studio/prompts.py` | 修改 | +17/-17 |
| `backend/services/studio/prompt_sentinel.py` | 修改 | +204/-10 |
| `backend/services/image_service.py` | 修改 | +577/-577 (重构) |
| `backend/services/video_service.py` | 修改 | +1726/-1726 (重构+删除死代码) |
| `backend/main.py` | 修改 | +652/-652 (新增 TTS preview 端点) |
| `src/pages/DigitalHumanWorkbenchPage.tsx` | 修改 | +106/-106 |
| `src/services/api.ts` | 修改 | +157/-157 |

---

## 遗留项与后续

- Phase 0 全部 8 项任务已完成，无阻塞项
- 所有修复均为激活/修正既有代码，未新增功能模块
- 下一阶段 Phase 1（知识库地基）可直接启动
