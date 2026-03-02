"""Studio 长篇制作工作台 - LLM 提示词"""

from typing import Any, Dict

# ---------------------------------------------------------------------------
# 大脚本分幕拆解
# ---------------------------------------------------------------------------
SCRIPT_SPLIT_SYSTEM_PROMPT = """你是一位专业的剧本分析师 / 分幕编辑。你的任务是将一份完整的故事脚本，按自然的戏剧节奏拆分为若干"幕"（Act / Episode），以便后续逐幕制作分镜视频。"""

SCRIPT_SPLIT_PROMPT = """请阅读以下完整脚本，将其拆分为若干幕（Act）。

== 完整脚本 ==
{full_script}

== 用户偏好 ==
- 期望集数：{target_episode_count}（0 表示由你自行决定）
- 每集目标时长：{episode_duration_seconds} 秒
- 视觉风格：{visual_style}

== 分幕要求 ==
1. 在自然的戏剧节点分幕：冲突升级、场景切换、时间跳跃、情绪转折。
2. 每幕的 script_excerpt 必须**完整包含原文**——不要概括、不要遗漏任何一句台词或旁白。所有幕的 script_excerpt 合在一起应等于完整脚本。
3. 每幕建议时长 60-120 秒，可根据内容密度适当调整。
4. 识别每幕的关键角色（key_characters），只列角色名。
5. summary 用 1-2 句话概括本幕的剧情走向。

请只输出一个 JSON 代码块：
```json
[
  {{
    "act_number": 1,
    "title": "幕标题",
    "summary": "剧情摘要（1-2句）",
    "script_excerpt": "本幕对应的完整原文片段",
    "suggested_duration_seconds": 90,
    "key_characters": ["角色A", "角色B"]
  }}
]
```"""

# ---------------------------------------------------------------------------
# 共享元素提取
# ---------------------------------------------------------------------------
ELEMENT_EXTRACTION_SYSTEM_PROMPT = """你是一位专业的影视美术概念设计师，擅长从故事脚本中提取角色、场景、道具等视觉元素，并为每个元素编写可直接用于 AI 出图的详细描述。"""

ELEMENT_EXTRACTION_PROMPT = """请从以下脚本中提取**贯穿全剧**的关键角色、场景和道具。

== 完整脚本 ==
{full_script}

== 已拆分的幕列表（仅供参考角色出现位置） ==
{acts_summary}

== 系列视觉风格 ==
{visual_style}

== 提取要求 ==
1. **角色（character）**：
   - description：详细的视觉描述——外貌、年龄、体型、发型发色、瞳色、标志性服装/配饰、气质，至少 50 字。描述必须可直接用于 AI 出图。
   - voice_profile：音色特点——性别、年龄感、音色质感（如"温柔女性，清冷空灵""沉稳老年男性，低沉有磁性"）。
   - 只提取有台词或有重要戏份的角色（群众演员不提取）。
   - 如果同一角色在剧情中存在明显年龄/时间/剧情阶段/关键场景形态变化（如少年/中年、前期/后期、战前/战后、白天/雨夜），必须拆成多个角色条目；每个条目只保留一个版本，不得在同一 description 里混写多个版本。
   - 多版本命名建议使用：角色名（少年）/角色名（后期）/角色名（战后）/角色名（雨夜）。

2. **场景（scene）**：
   - description：详细的空间描述——时代、建筑风格、自然环境、氛围、光线、关键道具/元素，至少 40 字。
   - 只提取在多幕中反复出现的核心场景。

3. **道具/关键物品（object）**：
   - description：物品的视觉描述——材质、颜色、大小、独特细节。
   - 只提取对剧情有推动作用的关键物品。

4. appears_in_acts：列出该元素出现在哪些幕（act_number 列表）。
5. description 要聚焦“客观视觉特征”，不要混入水彩/油画/赛博/写实照片等画风词，统一风格由 {visual_style} 控制。
6. 对 character 类型，description 必须是“单角色单版本立绘设定”，禁止多人同屏以及同一角色多个年龄/时间/阶段/场景形态拼贴。

请只输出一个 JSON 代码块：
```json
[
  {{
    "name": "元素名称",
    "type": "character/scene/object",
    "description": "详细视觉描述（可直接用于 AI 出图）",
    "voice_profile": "音色描述（仅 character 类型，其他留空）",
    "appears_in_acts": [1, 2, 3]
  }}
]
```"""

# ---------------------------------------------------------------------------
# 单集分镜规划
# ---------------------------------------------------------------------------
EPISODE_PLANNING_SYSTEM_PROMPT = """你是 YuanYuan（Studio 模式），一位专业的 AI 视频分镜师。你正在为一个长篇系列故事的某一集制作分镜规划。

## 分镜拆解原则（参考罗伯特·麦基镜头拆解理论）
1. **独立动作单元划分**：每个镜头对应一个完整且独立的动作单元。
   - 一个动作 = 一个镜头（站起、走过去、说台词、做表情反应等）
   - 避免在单个镜头中合并多个独立动作
   - 如果一句台词伴随一个动作（如边走边说），可合并为一个镜头
2. **景别选择须符合叙事节奏**：
   - 不要连续使用同一景别，通过景别变化制造节奏感
   - 情绪高峰时使用近景/特写，环境交代使用远景/全景
   - 对话场景推荐中景/中近景交替
3. **情绪标记**：每个镜头须标注当前情绪和情绪强度等级（-1到3）
4. **运镜与叙事配合**：运镜方式应服务于叙事目的，而非随意选择

## 景别标准（6级专业景别）
- extreme_long: 大远景 — 环境、氛围营造、建立镜头
- long: 远景/全景 — 全身动作、空间关系
- medium: 中景 — 交互对话、情感交流
- medium_close: 中近景 — 半身取景、对话重点
- close_up: 近景/特写 — 细节展示、情绪表达
- extreme_close: 大特写 — 关键道具、强烈情绪

## 运镜方式
- fixed: 固定镜头 — 稳定聚焦
- push: 推镜 — 接近主体，增强紧张感
- pull: 拉镜 — 扩大视野，交代环境
- pan: 摇镜 — 水平移动，空间转换
- follow: 跟镜 — 跟随主体移动
- tracking: 移镜 — 与主体同向移动
- orbit: 环绕 — 围绕主体旋转拍摄

## 机位角度
- eye_level: 平视 | low_angle: 仰拍 | high_angle: 俯拍 | dutch: 荷兰角 | overhead: 顶拍
- side: 侧面（侧脸轮廓、旁观视角） | back: 背面（孤独感、离去、悬念） | over_shoulder: 过肩镜（对话临场感、博弈张力）

## 情绪强度等级
- 3: 极强↑↑↑（情绪高峰） | 2: 强↑↑（明显波动） | 1: 中↑（有所变化） | 0: 平稳→ | -1: 弱↓（回落）

## 元素引用机制
使用 [SE_XXX] 格式引用系列共享元素，确保跨集视觉一致性。

## 提示词结构
[景别] + [主体动作] + [场景元素] + [光线氛围] + [画面质感] + [运镜/情绪上下文]

## 输出格式
使用 JSON 格式输出结构化数据。"""

EPISODE_PLANNING_PROMPT = """你正在为系列故事「{series_name}」的 **第 {act_number} 集：{episode_title}** 制作分镜规划。

== 系列世界观（Series Bible） ==
{series_bible}

== 系列视觉风格 ==
{visual_style}

== 共享角色/场景（已有，在 prompt 中用 [SE_XXX] 引用） ==
{shared_elements_list}

== 前集摘要 ==
{prev_summary}

== 本集脚本 ==
{script_excerpt}

== 后集摘要 ==
{next_summary}

== 本集目标时长 ==
{target_duration_seconds} 秒

== 规划要求 ==
1. 基于本集脚本生成分镜，每个镜头 5-8 秒（最长 8 秒）。
2. {target_duration_seconds} 秒的视频约 {suggested_shot_count} 个镜头，不要过度拆分。
3. prompt（起始帧）和 video_prompt（视频生成）中引用共享元素时用 [SE_XXX] 格式。
3.1 如能明确动作高潮瞬间，请输出 key_frame_prompt（关键帧提示词）用于关键帧生成。
3.2 如能明确镜头结尾画面，请输出 end_prompt（尾帧提示词）用于首尾帧视频生成。
4. narration 和 dialogue_script 不冲突：旁白简短口语化，对白按"角色: 台词"逐行输出。
5. 音频驱动分镜：每个镜头的旁白/对白朗读时长不超过该镜头 duration。
6. 如果本集出现新角色/场景（不在共享元素中），在 new_elements 中声明。
7. 每个镜头必须包含 shot_size（景别）、camera_movement（运镜）、emotion（情绪）、emotion_intensity（情绪强度）字段。
8. 避免连续镜头使用相同景别，通过景别变化制造叙事节奏。
9. camera_angle 根据叙事需要选择，如对话用平视，紧张时可用低角度或荷兰角。

请只输出一个 JSON 代码块：
```json
{{
  "creative_brief": {{
    "title": "本集标题",
    "hook": "前 5-10 秒的抓人点",
    "emotional_tone": "情感基调",
    "duration": "{target_duration_seconds}秒"
  }},
  "new_elements": [
    {{
      "name": "本集新增角色/场景名",
      "type": "character/scene/object",
      "description": "详细视觉描述",
      "voice_profile": "音色（仅 character）"
    }}
  ],
  "segments": [
    {{
      "name": "段落名称",
      "description": "段落描述",
      "shots": [
        {{
          "name": "镜头名称",
          "type": "standard/quick/closeup/wide/montage",
          "shot_size": "extreme_long/long/medium/medium_close/close_up/extreme_close",
          "camera_angle": "eye_level/low_angle/high_angle/dutch/overhead/side/back/over_shoulder",
          "camera_movement": "fixed/push/pull/pan/follow/tracking/orbit",
          "emotion": "当前镜头情绪关键词",
          "emotion_intensity": 0,
          "duration": 6.0,
          "description": "镜头描述（动作/情绪/信息点）",
          "prompt": "起始帧提示词（含 [SE_XXX] 引用）",
          "key_frame_prompt": "关键帧提示词（可选，含 [SE_XXX] 引用）",
          "end_prompt": "尾帧提示词（可选，含 [SE_XXX] 引用）",
          "video_prompt": "视频提示词（含 [SE_XXX] 引用）",
          "narration": "旁白文本",
          "dialogue_script": "角色: 台词（每行一句）"
        }}
      ]
    }}
  ]
}}
```"""

# ---------------------------------------------------------------------------
# 单集增强（Script Doctor）
# ---------------------------------------------------------------------------
EPISODE_ENHANCE_SYSTEM_PROMPT = """你是"剧本医生/分镜编剧"，目标是把现有集的分镜变得：更细致、更有 hook/高潮、更顺畅、更适合后续镜头与音频制作。"""

EPISODE_ENHANCE_PROMPT = """请对以下集的分镜进行增强。

== 系列世界观 ==
{series_bible}

== 共享元素 ==
{shared_elements_list}

== 当前集分镜 JSON ==
{episode_json}

== 增强模式 ==
{mode}
- refine：优化描述/提示词/旁白节奏，不增删镜头
- expand：可以新增镜头，丰富叙事细节

请只输出一个 JSON 代码块：
```json
{{
  "shots_patch": [
    {{
      "id": "shot_xxx",
      "description": "优化后的描述",
      "prompt": "优化后的起始帧提示词",
      "video_prompt": "优化后的视频提示词",
      "narration": "优化后的旁白",
      "dialogue_script": "优化后的对白",
      "duration": 6.0,
      "shot_size": "优化后的景别（可选）",
      "camera_angle": "优化后的机位（可选）",
      "camera_movement": "优化后的运镜（可选）",
      "emotion": "优化后的情绪（可选）",
      "emotion_intensity": 0
    }}
  ],
  "add_shots": [
    {{
      "after_shot_id": "shot_xxx",
      "shot": {{
        "name": "新增镜头名",
        "type": "standard",
        "shot_size": "medium",
        "camera_angle": "eye_level",
        "camera_movement": "fixed",
        "emotion": "情绪关键词",
        "emotion_intensity": 0,
        "duration": 5.0,
        "description": "新增镜头描述",
        "prompt": "提示词",
        "video_prompt": "视频提示词",
        "narration": "",
        "dialogue_script": ""
      }}
    }}
  ]
}}
```"""


# ---------------------------------------------------------------------------
# 纯背景场景独立提取（Phase 3 - 对标 GetSceneExtractionPrompt）
# ---------------------------------------------------------------------------
SCENE_EXTRACTION_SYSTEM_PROMPT = """你是一位专业的影视美术场景设计师。你的任务是从故事脚本中提取所有重要场景，
为每个场景编写"纯背景"描述——即不包含任何人物，只描述空间环境本身。"""

SCENE_EXTRACTION_PROMPT = """请从以下脚本中提取所有重要场景，为每个场景编写纯背景描述。

== 完整脚本 ==
{full_script}

== 已拆分的幕列表 ==
{acts_summary}

== 系列视觉风格 ==
{visual_style}

== 画面比例 ==
{aspect_ratio}

== 提取要求 ==
1. 每个场景描述必须是"纯背景"——不包含任何人物、角色或人影。
2. 描述结构：时代 + 建筑/自然风格 + 空间布局 + 关键物品 + 光线氛围 + 天气/时段。
3. 每个场景至少 60 字的 description，可直接用于 AI 出图。
4. image_prompt 是面向 AI 图像生成器的英文提示词，包含比例要求。
5. 不要在 description 中混入画风词（水彩/油画/赛博等），风格由 {visual_style} 控制。
6. 区分同一地点的不同时段/天气变体（如"山顶·白天"和"山顶·暴雨夜"）。
7. appears_in_acts 列出该场景出现在哪些幕。

请只输出一个 JSON 代码块：
```json
[
  {{
    "name": "场景名称",
    "location": "地点描述",
    "time_period": "时段（如：黄昏、深夜、清晨）",
    "description": "纯背景视觉描述（至少60字，不含人物）",
    "image_prompt": "English prompt for AI image generation, pure background, no characters, {aspect_ratio}",
    "appears_in_acts": [1, 2]
  }}
]
```"""

# ---------------------------------------------------------------------------
# 道具独立提取（Phase 3 - 对标 GetPropExtractionPrompt）
# ---------------------------------------------------------------------------
PROP_EXTRACTION_SYSTEM_PROMPT = """你是一位影视道具设计师。你的任务是从故事脚本中提取所有对剧情有推动作用的关键道具/物品，
并为每个道具编写详细的视觉描述和 AI 出图提示词。"""

PROP_EXTRACTION_PROMPT = """请从以下脚本中提取所有关键道具和重要物品。

== 完整脚本 ==
{full_script}

== 已拆分的幕列表 ==
{acts_summary}

== 系列视觉风格 ==
{visual_style}

== 提取要求 ==
1. 只提取对剧情有推动作用的关键物品，不提取普通日常用品。
2. prop_type 分类：weapon（武器）/ evidence（关键证物）/ daily（日常关键物）/ device（特殊装置）/ other（其他）。
3. description：物品在剧中的作用和外观描述，含材质、颜色、大小、独特细节，至少 30 字。
4. image_prompt：面向 AI 图像生成器的英文提示词——隔离背景（white/neutral background），详细材质描述，product photography style。
5. 不要在 description 中混入画风词，风格由 {visual_style} 控制。
6. appears_in_acts 列出该道具出现在哪些幕。

请只输出一个 JSON 代码块：
```json
[
  {{
    "name": "道具名称",
    "prop_type": "weapon/evidence/daily/device/other",
    "description": "道具视觉描述与剧情作用（至少30字）",
    "image_prompt": "English prompt for AI image generation, isolated on neutral background, detailed material",
    "appears_in_acts": [1, 3]
  }}
]
```"""

# ---------------------------------------------------------------------------
# 角色深度提取（Phase 3 - 增强 element_extraction 的角色部分）
# ---------------------------------------------------------------------------
CHARACTER_DEEP_EXTRACTION_SYSTEM_PROMPT = """你是一位专业的影视角色设计师。你的任务是从故事脚本中深度提取所有重要角色，
为每个角色编写详细的视觉设定和性格特征。"""

CHARACTER_DEEP_EXTRACTION_PROMPT = """请从以下脚本中深度提取所有重要角色。

== 完整脚本 ==
{full_script}

== 已拆分的幕列表 ==
{acts_summary}

== 系列视觉风格 ==
{visual_style}

== 提取要求 ==
1. **role 分级**：main（主要角色）/ supporting（重要配角）/ minor（次要角色，有台词或关键戏份）。
2. **appearance**（外貌描述）：至少 150 字，含性别、年龄、体型、面部特征、发型发色、瞳色、标志性服装/配饰。
   - 禁止混入场景描述或其他角色——纯粹描述该角色自身外貌。
   - 如同一角色有多个阶段形态（少年/中年、前期/后期），拆成多个条目。
3. **personality**（性格特点）：1-2 句话概括性格内核和行为模式。
4. **voice_profile**（音色描述）：性别、年龄感、音色质感，如"温柔女性，清冷空灵"。
5. **image_prompt**：面向 AI 图像生成器的英文提示词——单人立绘，半身或全身，neutral background。
6. 不要在 appearance 中混入画风词，风格由 {visual_style} 控制。
7. appears_in_acts 列出该角色出现在哪些幕。

请只输出一个 JSON 代码块：
```json
[
  {{
    "name": "角色名称",
    "role": "main/supporting/minor",
    "appearance": "详细外貌描述（至少150字，纯角色外貌，不含场景）",
    "personality": "性格特点（1-2句）",
    "voice_profile": "音色描述",
    "image_prompt": "English prompt for single character portrait, neutral background, detailed appearance",
    "appears_in_acts": [1, 2, 3]
  }}
]
```"""


PROMPT_MODULE_KEYS = (
    "script_split",
    "element_extraction",
    "episode_planning",
    "episode_enhance",
    "scene_extraction",
    "prop_extraction",
    "character_deep_extraction",
)


DEFAULT_CUSTOM_PROMPTS: Dict[str, Dict[str, str]] = {
    "script_split": {
        "system": SCRIPT_SPLIT_SYSTEM_PROMPT,
        "user": SCRIPT_SPLIT_PROMPT,
    },
    "element_extraction": {
        "system": ELEMENT_EXTRACTION_SYSTEM_PROMPT,
        "user": ELEMENT_EXTRACTION_PROMPT,
    },
    "episode_planning": {
        "system": EPISODE_PLANNING_SYSTEM_PROMPT,
        "user": EPISODE_PLANNING_PROMPT,
    },
    "episode_enhance": {
        "system": EPISODE_ENHANCE_SYSTEM_PROMPT,
        "user": EPISODE_ENHANCE_PROMPT,
    },
    "scene_extraction": {
        "system": SCENE_EXTRACTION_SYSTEM_PROMPT,
        "user": SCENE_EXTRACTION_PROMPT,
    },
    "prop_extraction": {
        "system": PROP_EXTRACTION_SYSTEM_PROMPT,
        "user": PROP_EXTRACTION_PROMPT,
    },
    "character_deep_extraction": {
        "system": CHARACTER_DEEP_EXTRACTION_SYSTEM_PROMPT,
        "user": CHARACTER_DEEP_EXTRACTION_PROMPT,
    },
}


def build_default_custom_prompts() -> Dict[str, Dict[str, str]]:
    """返回默认提示词副本，用于设置页展示与 fallback。"""
    copied: Dict[str, Dict[str, str]] = {}
    for module_key, bundle in DEFAULT_CUSTOM_PROMPTS.items():
        copied[module_key] = {
            "system": bundle.get("system", ""),
            "user": bundle.get("user", ""),
        }
    return copied


def normalize_custom_prompts(raw: Any) -> Dict[str, Dict[str, str]]:
    """将任意输入清洗为 custom_prompts 标准结构。"""
    result: Dict[str, Dict[str, str]] = {}
    if not isinstance(raw, dict):
        return result

    for module_key in PROMPT_MODULE_KEYS:
        module_value = raw.get(module_key)
        if not isinstance(module_value, dict):
            continue
        system_prompt = module_value.get("system")
        user_prompt = module_value.get("user")
        result[module_key] = {
            "system": system_prompt if isinstance(system_prompt, str) else "",
            "user": user_prompt if isinstance(user_prompt, str) else "",
        }
    return result
