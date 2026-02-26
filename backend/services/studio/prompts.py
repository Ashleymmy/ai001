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

== 提取要求 ==
1. **角色（character）**：
   - description：详细的视觉描述——外貌、年龄、体型、发型发色、瞳色、标志性服装/配饰、气质，至少 50 字。描述必须可直接用于 AI 出图。
   - voice_profile：音色特点——性别、年龄感、音色质感（如"温柔女性，清冷空灵""沉稳老年男性，低沉有磁性"）。
   - 只提取有台词或有重要戏份的角色（群众演员不提取）。

2. **场景（scene）**：
   - description：详细的空间描述——时代、建筑风格、自然环境、氛围、光线、关键道具/元素，至少 40 字。
   - 只提取在多幕中反复出现的核心场景。

3. **道具/关键物品（object）**：
   - description：物品的视觉描述——材质、颜色、大小、独特细节。
   - 只提取对剧情有推动作用的关键物品。

4. appears_in_acts：列出该元素出现在哪些幕（act_number 列表）。

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

## 元素引用机制
使用 [SE_XXX] 格式引用系列共享元素，确保跨集视觉一致性。

## 提示词结构
[镜头类型] + [时长] + [主体动作] + [场景元素] + [光线氛围] + [画面质感] + [旁白对齐]

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
3.1 如能明确镜头结尾画面，请输出 end_prompt（尾帧提示词）用于首尾帧视频生成。
4. narration 和 dialogue_script 不冲突：旁白简短口语化，对白按"角色: 台词"逐行输出。
5. 音频驱动分镜：每个镜头的旁白/对白朗读时长不超过该镜头 duration。
6. 如果本集出现新角色/场景（不在共享元素中），在 new_elements 中声明。

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
          "duration": 6.0,
          "description": "镜头描述（动作/情绪/信息点）",
          "prompt": "起始帧提示词（含 [SE_XXX] 引用）",
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
      "duration": 6.0
    }}
  ],
  "add_shots": [
    {{
      "after_shot_id": "shot_xxx",
      "shot": {{
        "name": "新增镜头名",
        "type": "standard",
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


PROMPT_MODULE_KEYS = (
    "script_split",
    "element_extraction",
    "episode_planning",
    "episode_enhance",
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
