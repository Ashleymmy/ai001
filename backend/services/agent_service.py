"""Agent 服务 - 智能视频制作助手

基于 Flova Agent 架构设计，实现：
1. 对话式 AI 助手 - 理解用户需求，制定制作方案
2. 元素引用系统 - [Element_XXX] 机制确保角色一致性
3. 分镜规划系统 - Segment → Shot 结构
4. 提示词模板系统 - 结构化提示词生成
5. 批量生成流程 - 自动化视频制作
"""
import os
import json
import uuid
import re
import asyncio
import hashlib
import math
import copy
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any, Callable
from urllib.parse import urlparse, parse_qs

import httpx
from openai import AsyncOpenAI
from .storage_service import StorageService
from .agent.constants import SHOT_TYPES
from .agent.prompts import (
    DEFAULT_AGENT_SYSTEM_PROMPT,
    DEFAULT_ASSET_COMPLETION_PROMPT,
    DEFAULT_MANAGER_SYSTEM_PROMPT,
    DEFAULT_PROJECT_PLANNING_PROMPT,
    DEFAULT_DURATION_FIT_PROMPT,
    DEFAULT_SCRIPT_DOCTOR_PROMPT,
)
from .agent.models import AgentProject


def _sha256(text: str) -> str:
    import hashlib
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def _as_text(value: Any) -> str:
    """Coerce unknown values to a safe string for prompt processing.

    Only accepts real strings; everything else becomes empty string to avoid crashes
    (e.g. `None` passed into regex operations).
    """
    return value if isinstance(value, str) else ""


def _ensure_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _smart_split_text(
    text: str,
    *,
    max_chars: int,
    boundaries: str,
    min_good_ratio: float = 0.6,
    min_tail_ratio: float = 0.35,
) -> List[str]:
    """Smartly split a long text into fewer, more balanced chunks.

    Principles:
    - If short enough, keep as a whole (do not split on commas by default).
    - When splitting, prefer punctuation boundaries; if the remaining tail would be too short,
      pick a more balanced cut (closer to the middle) when possible.
    """
    t = (text or "").strip()
    if not t:
        return []

    try:
        mc = int(max_chars)
    except Exception:
        mc = 0
    if mc <= 0:
        return [t]

    if len(t) <= mc:
        return [t]

    bset = set(boundaries or "")

    def compute_min_good() -> int:
        mg = max(6, int(mc * float(min_good_ratio)))
        return max(1, min(mc, mg))

    def compute_min_tail() -> int:
        mt = max(6, int(mc * float(min_tail_ratio)))
        return max(1, min(mc, mt))

    min_good = compute_min_good()
    min_tail = compute_min_tail()

    out: List[str] = []
    rest = t
    while rest and len(rest) > mc:
        window = rest[: mc + 1]
        mid = len(rest) // 2

        def tail_len(c: int) -> int:
            return max(0, len(rest) - int(c))

        def in_range(c: int) -> bool:
            try:
                v = int(c)
            except Exception:
                return False
            return 1 <= v <= len(window)

        tail_short_risk = tail_len(mc) < min_tail

        punct_cands: List[int] = []
        if bset:
            for i, ch in enumerate(window):
                if ch in bset:
                    punct_cands.append(i + 1)
        punct_cands = sorted({c for c in punct_cands if in_range(c)})

        space_cands: List[int] = []
        sp = window.rfind(" ")
        if sp >= 0 and in_range(sp + 1):
            space_cands = [sp + 1]

        balance_cands: List[int] = []
        if 1 <= mid <= mc and in_range(mid):
            balance_cands.append(mid)
        tail_guard = len(rest) - min_tail
        if 1 <= tail_guard <= mc and in_range(tail_guard):
            balance_cands.append(tail_guard)
        balance_cands = sorted({c for c in balance_cands if in_range(c)})

        def pick(cands: List[int], *, allow_small: bool) -> Optional[int]:
            if not cands:
                return None

            if not allow_small:
                cands = [c for c in cands if c >= min_good]
                if not cands:
                    return None
                good = [c for c in cands if tail_len(c) >= min_tail]
                return max(good) if good else None

            good = [c for c in cands if tail_len(c) >= min_tail]
            if good:
                return max(good)
            return min(cands, key=lambda c: (abs(c - mid), -c))

        cut = pick(punct_cands, allow_small=tail_short_risk)
        if cut is None:
            cut = pick(space_cands, allow_small=tail_short_risk)
        if cut is None:
            if not tail_short_risk:
                cut = mc
            else:
                cut = pick(balance_cands, allow_small=True)
                if cut is None:
                    cut = max(1, min(mc, max(min_good, min(mc, mid))))

        head = rest[:cut].strip()
        rest = rest[cut:].strip()
        if head:
            out.append(head)
        else:
            # Defensive: ensure progress
            out.append(rest[:mc].strip())
            rest = rest[mc:].strip()

    if rest:
        out.append(rest.strip())

    return [x for x in out if x]


def _estimate_speech_seconds(text: str, speed: float = 1.0) -> float:
    """Heuristic voice duration estimate for narration/dialogue (seconds).

    This is used as a fallback when `voice_audio_duration_ms` is not available.
    """
    if not isinstance(text, str):
        return 0.0
    s = re.sub(r"\s+", " ", text).strip()
    if not s:
        return 0.0

    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    words = len(re.findall(r"[A-Za-z0-9']+", s))

    cps = 4.0  # Chinese chars/sec
    wps = 2.7  # English words/sec

    base = (cjk / cps) if cjk >= max(8, words * 2) else (words / wps if words else (len(s) / 10.0))
    punct = len(re.findall(r"[，,。\.！!？?；;：:、]", s))
    pauses = punct * 0.18 + s.count("…") * 0.25 + s.count("—") * 0.12
    lead = 0.25

    spd = speed if isinstance(speed, (int, float)) and speed > 0 else 1.0
    return max(0.0, (base + pauses + lead) / float(spd))


def _clamp(value: float, min_value: float, max_value: float) -> float:
    try:
        v = float(value)
    except Exception:
        v = 0.0
    return max(min_value, min(max_value, v))


def _ceil_to_half(seconds: float) -> float:
    try:
        s = float(seconds)
    except Exception:
        return 0.0
    if not math.isfinite(s) or s < 0:
        return 0.0
    return float(math.ceil(s * 2.0) / 2.0)


def _parse_duration_seconds(text: Any) -> Optional[float]:
    """Parse a human duration string into seconds.

    Supports: 90秒 / 1分钟 / 1.5分钟 / 1分30秒 / 00:30 / 01:02:03 / 90s / 1m30s / 1h.
    """
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s:
        return None

    raw = s
    s = s.strip().lower()

    # timecode formats: mm:ss or hh:mm:ss
    m = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)", s)
    if m:
        a = int(m.group(1))
        b = int(m.group(2))
        c = int(m.group(3)) if m.group(3) else None
        if c is None:
            # mm:ss
            return float(a * 60 + b)
        # hh:mm:ss
        return float(a * 3600 + b * 60 + c)

    # Chinese combined
    hours = 0.0
    minutes = 0.0
    seconds = 0.0

    mh = re.search(r"(\d+(?:\.\d+)?)\s*(?:小时|h|hr|hrs|hour|hours)\b", s)
    if mh:
        hours = float(mh.group(1))

    mmn = re.search(r"(\d+(?:\.\d+)?)\s*(?:分钟|min|mins|minute|minutes|m)\b", s)
    if mmn:
        minutes = float(mmn.group(1))

    ms = re.search(r"(\d+(?:\.\d+)?)\s*(?:秒|s|sec|secs|second|seconds)\b", s)
    if ms:
        seconds = float(ms.group(1))

    if hours or minutes or seconds:
        return hours * 3600.0 + minutes * 60.0 + seconds

    # Chinese shorthand like "1分30秒" or "1分30"
    mcn = re.search(r"(\d+(?:\.\d+)?)\s*分(?:钟)?\s*(\d+(?:\.\d+)?)\s*秒?", raw)
    if mcn:
        return float(mcn.group(1)) * 60.0 + float(mcn.group(2))

    return None


def _extract_dialogue_utterances(dialogue_script: Any) -> List[str]:
    if not isinstance(dialogue_script, str) or not dialogue_script.strip():
        return []
    out: List[str] = []
    for raw_line in dialogue_script.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        # remove bullets / numbering
        line = re.sub(r"^[-*•\u2022]\s*", "", line)
        line = re.sub(r"^\d+\s*[.)、]\s*", "", line)
        if "：" in line:
            _, tail = line.split("：", 1)
            out.append(tail.strip())
        elif ":" in line:
            _, tail = line.split(":", 1)
            out.append(tail.strip())
        else:
            out.append(line)
    return [t for t in out if t]


def _split_narration_sentences(text: str) -> List[str]:
    s = (text or "").strip()
    if not s:
        return []

    # Strip wrapping quotes to avoid splitting across “ ... ” and leaving dangling quote-only chunks.
    for open_q, close_q in (("“", "”"), ("‘", "’"), ("\"", "\""), ("'", "'")):
        if s.startswith(open_q) and s.endswith(close_q) and len(s) > (len(open_q) + len(close_q) + 1):
            s = s[len(open_q):-len(close_q)].strip()
            break

    # Strong boundaries only (comma-like punctuations are "soft" and handled by `_smart_split_text` when needed).
    boundaries = set("。！？.!?；;")
    parts: List[str] = []
    buf: List[str] = []
    for ch in s:
        buf.append(ch)
        if ch in boundaries:
            seg = "".join(buf).strip()
            if seg:
                parts.append(seg)
            buf = []
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)

    # Fallback: split by newlines if no punctuation boundaries
    flat: List[str] = []
    for p in parts or [s]:
        flat.extend([x.strip() for x in p.splitlines() if x.strip()])

    # Merge standalone quote-only chunks back to previous part.
    merged: List[str] = []
    for seg in flat:
        if not seg:
            continue
        if merged and re.fullmatch(r"[\"“”'‘’]+", seg):
            merged[-1] = (merged[-1] + seg).strip()
        else:
            merged.append(seg)
    return merged


def _split_dialogue_line(line: str, max_chars: int = 26) -> List[str]:
    """Split a dialogue line into multiple shorter lines (keep speaker prefix)."""
    ln = (line or "").strip()
    if not ln:
        return []
    speaker = ""
    content = ln
    if "：" in ln:
        speaker, content = ln.split("：", 1)
        speaker = speaker.strip()
        content = content.strip()
    elif ":" in ln:
        speaker, content = ln.split(":", 1)
        speaker = speaker.strip()
        content = content.strip()

    if not content:
        return [ln]

    # Short dialogue: keep whole (avoid splitting by commas/short pauses).
    if len(content) <= int(max_chars or 0):
        return [ln]

    wrapped = _smart_split_text(
        content,
        max_chars=max_chars,
        boundaries="，,；;、。！？.!?…—",
        min_good_ratio=0.6,
        min_tail_ratio=0.35,
    )

    if speaker:
        return [f"{speaker}：{t}" for t in wrapped if t]
    return [t for t in wrapped if t]

# 元素生成提示词模板
ELEMENT_PROMPT_TEMPLATE = """请为以下角色/元素生成详细的图像生成提示词：

元素名称：{element_name}
元素类型：{element_type}
基础描述：{base_description}
视觉风格：{visual_style}

请输出适合 AI 图像生成的英文提示词，包含：
1. 主体描述（外貌、服装、姿态）
2. 风格描述（画风、质感）
3. 光线和氛围
4. 画面质量关键词

输出格式：
```json
{{ 
  "prompt": "英文提示词",
  "negative_prompt": "负面提示词",
  "recommended_resolution": "推荐分辨率"
}}
```
"""

# 镜头提示词模板
SHOT_PROMPT_TEMPLATE = """请为以下镜头生成详细的视频生成提示词：

镜头名称：{shot_name}
镜头类型：{shot_type}
镜头描述：{shot_description}
涉及元素：{elements}
视觉风格：{visual_style}
旁白内容：{narration}

请输出适合 AI 视频生成的提示词，格式：
```json
{{
  "image_prompt": "起始帧图像提示词（英文）",
  "video_prompt": "视频动态提示词（英文）",
  "camera_movement": "镜头运动描述",
  "duration_seconds": 预计秒数
}}
```
"""

REFINE_SPLIT_VISUALS_PROMPT_TEMPLATE = """你是资深分镜导演与提示词工程师。下面给你一个项目的“拆分镜头组”（同一镜头因为音频较长被拆成多个 part）。请为每个 part 生成更清晰且彼此有明显差异的画面设计与提示词，减少起始帧重复。

项目视觉风格：
{visual_style}

涉及元素（用于一致性引用；请继续使用 [Element_XXX]，不要把 Element ID 替换成名字）：
{elements_json}

拆分镜头组（按时间顺序；每个 part 的 narration/dialogue_script 就是该段对应的台词/旁白）：
{shots_json}

你必须遵守：
1) 不允许修改任何 shot_id；只输出这些 shot_id 的结果，不要新增/删除。
2) 保持角色/场景/道具一致性：继续使用原本的 [Element_XXX] 引用。
3) 每个 part 的画面必须与该 part 的 narration/dialogue_script 匹配，并且各 part 之间要有可感知差异（至少在“景别/构图/关注点/动作/镜头运动”中的两项不同）。
4) prompt 与 video_prompt 使用中文，清晰描述画面；prompt 必须包含 no-text（避免画面文字/水印/字幕）。
5) 输出必须是严格 JSON：只输出一个 ```json 代码块，不要任何额外文字。

输出格式（示例）：
```json
{{
  "shots": [
    {{
      "shot_id": "Shot_XXX",
      "description": "新的镜头描述（更具体、可画）",
      "prompt": "新的起始帧提示词（含 no-text）",
      "video_prompt": "新的动态提示词（与该段音频匹配）"
    }}
  ]
}}
```"""


class AgentService:
    """Agent 服务 - 智能视频制作助手"""
    
    def __init__(self, storage: StorageService):
        self.storage = storage
        self.client: Optional[AsyncOpenAI] = None
        self.model = "qwen-plus"
        self._prompt_cache: Dict[str, Any] = {"path": None, "mtime": None, "data": None}
        self._llm_fingerprint: Optional[tuple] = None
        self._init_client()

    def _load_prompt_config(self) -> Dict[str, Any]:
        """读取 prompts.yaml（带 mtime 缓存），用于统一管理 system prompt。"""
        try:
            path = None
            from .storage_service import PROMPTS_LOCAL_FILE, PROMPTS_TEMPLATE_FILE  # type: ignore
            if os.path.exists(PROMPTS_LOCAL_FILE):
                path = PROMPTS_LOCAL_FILE
            else:
                path = PROMPTS_TEMPLATE_FILE
            mtime = os.path.getmtime(path) if path and os.path.exists(path) else None

            cached = self._prompt_cache
            if cached.get("path") == path and cached.get("mtime") == mtime and isinstance(cached.get("data"), dict):
                return cached["data"]

            data = self.storage.get_prompts() or {}
            if not isinstance(data, dict):
                data = {}
            self._prompt_cache = {"path": path, "mtime": mtime, "data": data}
            return data
        except Exception:
            return {}

    def _get_prompt(self, dotted_key: str, default: str) -> str:
        data = self._load_prompt_config()
        cur: Any = data
        for part in (dotted_key or "").split("."):
            if not isinstance(cur, dict):
                cur = None
                break
            cur = cur.get(part)
        if isinstance(cur, str) and cur.strip():
            return cur
        return default

    def _format_prompt_safe(self, template: str, **kwargs: Any) -> str:
        """Format prompt templates without crashing on unescaped JSON braces.

        Primary path uses `str.format(**kwargs)`. If the template contains raw JSON
        braces (common in YAML overrides) and formatting fails, fall back to simple
        placeholder replacement for known keys and unescape `{{`/`}}`.
        """
        if not isinstance(template, str):
            template = str(template)
        try:
            return template.format(**kwargs)
        except Exception:
            out = template
            for k, v in kwargs.items():
                out = out.replace("{" + str(k) + "}", str(v))
            return out.replace("{{", "{").replace("}}", "}")

    def get_prompts_debug(self, include_content: bool = False) -> Dict[str, Any]:
        """给前端/调试用：查看当前 prompt 版本与摘要（默认不返回全文）。"""
        cfg = self._load_prompt_config()
        version = cfg.get("version")
        updated_at = cfg.get("updated_at")

        system_prompt = self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)
        planning_prompt = self._get_prompt("agent.project_planning_prompt", DEFAULT_PROJECT_PLANNING_PROMPT)

        out: Dict[str, Any] = {
            "version": version,
            "updated_at": updated_at,
            "active": {
                "agent.system_prompt": {"length": len(system_prompt), "sha256": _sha256(system_prompt)},
                "agent.project_planning_prompt": {"length": len(planning_prompt), "sha256": _sha256(planning_prompt)},
            }
        }

        if include_content:
            out["content"] = {
                "agent.system_prompt": system_prompt,
                "agent.project_planning_prompt": planning_prompt,
            }
        return out
    
    def _detect_scene(self, message: str) -> str:
        """基于用户输入关键词做轻量路由：避免为了分类再额外调用一次 LLM。"""
        text = (message or "").lower()

        tech_keywords = [
            "报错", "错误", "失败", "异常", "bug", "issue", "debug", "日志", "log", "trace",
            "接口", "api", "请求", "响应", "sse", "跨域", "cors", "端口", "8000", "5173",
            "前端", "后端", "fastapi", "uvicorn", "react", "electron", "node", "python",
            "怎么改", "如何修", "修复", "排查", "定位"
        ]
        prompt_keywords = [
            "提示词", "prompt", "negative", "seed", "模型", "model", "分辨率", "画质", "风格", "一致性"
        ]
        planning_keywords = [
            "规划", "方案", "创意", "brief", "大纲", "脚本", "剧本", "分镜", "镜头", "旁白", "对白", "角色", "元素"
        ]
        workflow_keywords = [
            "生成", "一键", "执行", "开始", "继续", "下一步", "重试", "批量", "导出", "合成"
        ]

        if any(k in text for k in tech_keywords):
            return "tech_support"
        if any(k in text for k in prompt_keywords):
            return "prompt_engineering"
        if any(k in text for k in planning_keywords):
            return "project_planning"
        if any(k in text for k in workflow_keywords):
            return "workflow"
        return "general_chat"

    def _looks_like_operator_request(self, message: str, project: Dict[str, Any]) -> bool:
        """Heuristic: user is asking to edit existing project fields (cards/tabs).

        When true, we switch YuanYuan into a strict machine-actionable JSON mode so
        a backend "operator/worker" can safely apply updates.
        """
        msg = (message or "").strip()
        if not msg:
            return False

        # Explicit IDs -> always an edit intent.
        if re.search(r"\b(?:Shot|Element)_[A-Za-z0-9_]+\b", msg):
            return True

        # Avoid triggering on initial planning when there is no structure yet.
        has_structure = False
        try:
            has_structure = bool(project.get("segments")) or bool(project.get("elements"))
        except Exception:
            has_structure = False
        if not has_structure:
            return False

        verbs = [
            "修改", "改成", "改为", "更新", "替换", "调整", "设为", "设置", "设定",
            "删除", "移除", "新增", "添加", "插入", "批量", "全部", "所有",
        ]
        nouns = [
            "镜头", "分镜", "旁白", "对白", "台词",
            "角色", "元素", "音色", "声音",
            "时长", "比例", "画风", "风格",
            "标题", "项目名", "名称",
            "voice", "prompt",
        ]

        msg_l = msg.lower()
        if any(v in msg for v in verbs):
            if any((n in msg_l) if n.isascii() else (n in msg) for n in nouns):
                return True

        if re.search(r"第\s*\d+\s*(?:个)?\s*(?:镜头|分镜)", msg):
            return True

        return False

    def _first_shot_id(self, project: Dict[str, Any]) -> Optional[str]:
        segments = project.get("segments", []) or []
        if not isinstance(segments, list):
            return None
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            for shot in (seg.get("shots", []) or []):
                if isinstance(shot, dict) and isinstance(shot.get("id"), str) and shot.get("id"):
                    return shot.get("id")
        return None

    def _maybe_frame_generation_shortcut(self, message: str, project: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """将“生成/重生成起始帧（可排除某些镜头）”转成可确认的前端动作，避免只回复不执行。"""
        msg = (message or "").strip()
        if not msg:
            return None

        if "起始帧" not in msg:
            return None

        has_generate_intent = any(k in msg for k in ["生成", "重生成", "重新生成", "出图", "重出图", "再生成", "再出图"])
        if not has_generate_intent:
            return None

        # 避免误判“生成起始帧提示词/首帧提示词”这种纯文本任务
        if any(k in msg for k in ["起始帧提示词", "首帧提示词", "第一帧提示词"]):
            if not any(k in msg for k in ["出图", "图片", "画面", "生成图", "生成图片", "重出图", "重生成", "重新生成"]):
                return None
        if "提示词" in msg and not any(k in msg for k in ["出图", "图片", "画面", "生成图", "生成图片", "重出图", "重生成", "重新生成"]):
            return None

        # 排除镜头：支持“除第一张/跳过第一张”或显式 Shot_ID
        exclude: List[str] = []
        explicit_shots = re.findall(r"\bShot_[A-Za-z0-9_]+\b", msg)

        # 仅在“批量/全量/排除某些镜头”的语境下走快捷键，避免拦截单个镜头的生成请求
        batch_markers = ["所有", "全部", "批量", "一键", "除", "除了", "跳过", "排除"]
        if explicit_shots and not any(k in msg for k in batch_markers):
            return None
        if explicit_shots and any(k in msg for k in ["跳过", "排除", "除了", "除", "不要"]):
            exclude.extend(explicit_shots)
        elif any(k in msg for k in ["第一张", "首张", "第1张", "第一个镜头", "第一镜头"]):
            first_id = self._first_shot_id(project)
            if first_id:
                exclude.append(first_id)

        exclude = list(dict.fromkeys([x for x in exclude if isinstance(x, str) and x.strip()]))

        # 模式：缺失生成 vs 批量重生成
        mode = "missing"
        if any(k in msg for k in ["重生成", "重新生成", "重出图", "再生成", "再出图"]) or ("所有" in msg and "除" in msg):
            mode = "regenerate"
        if any(k in msg for k in ["缺失", "没生成", "未生成", "没有", "缺少"]):
            mode = "missing"

        label = "开始生成起始帧"
        if exclude:
            label += f"（跳过 {exclude[0]}）"

        content = "我可以按你的要求开始生成起始帧。"
        if mode == "regenerate":
            content += "\n\n注意：批量重生成会对除排除镜头外的镜头重新出图（需要时间与额度），是否开始？"
        else:
            content += "\n\n我将只为“缺失起始帧”的镜头补齐出图，是否开始？"

        return {
            "type": "text",
            "content": content,
            "confirmButton": {
                "label": label,
                "action": "generate_frames_batch",
                "payload": {
                    "mode": mode,
                    "excludeShotIds": exclude
                }
            }
        }
    
    def _scene_system_prompt(self, scene: str) -> str:
        """在不改变 YuanYuan 人设的前提下，给不同场景加一层更明确的行为约束。"""
        common_guardrails = """你必须遵守：
1) 只基于“项目上下文”和“对话记忆”中的事实回答；如果缺信息，先提出澄清问题。
2) 不要编造任何项目数据（角色/镜头/状态/URL）、配置、文件路径、接口行为；不确定就说不确定。
3) 当用户只是日常聊天/提问时：直接自然回复，不要强行进入工作流。
4) 当用户明确要推进制作流程时：给出清晰步骤/选项，并指出需要的输入或下一步操作。
"""

        if scene == "tech_support":
            return common_guardrails + """当前场景：技术排障/使用指导。
- 先复述问题与现象 → 再给最可能的 2-3 个原因 → 给最短验证步骤（日志/接口/前端控制台）。
- 如果需要看代码/配置，明确让用户提供哪些文件或关键输出。"""

        if scene == "operator":
            return common_guardrails + """当前场景：项目操作（给后端“职工”执行）。
- 你的输出**必须**包含且只包含一个 ```json``` 代码块；JSON 顶层必须是对象，包含：
  - "reply": 给用户看的说明（说明你将修改哪些卡片/字段、为什么）
  - "actions": 可执行动作数组（给职工执行）
  - "ui_hints": （可选）建议前端聚焦位置，如 {"activeModule":"storyboard","focus":{"type":"shot","id":"Shot_03"}}
- actions 仅允许以下 type：
  1) update_shot: { "shot_id": "Shot_XX", "patch": { "prompt"?, "video_prompt"?, "description"?, "narration"?, "dialogue_script"?, "duration"? }, "reason"? }
  2) update_element: { "element_id": "Element_XX", "patch": { "description"?, "voice_profile"? }, "reason"? }
  3) update_brief: { "patch": { "title"?, "videoType"?, "narrativeDriver"?, "emotionalTone"?, "visualStyle"?, "duration"?, "aspectRatio"?, "language"?, "narratorVoiceProfile"? }, "reason"? }
  4) regenerate_shot_frame: { "shot_id": "Shot_XX", "visualStyle"? }（仅当用户明确要求“重新生成/重出图/重做起始帧”时）
- 必须引用项目里真实存在的 Shot_ID / Element_ID；如果用户没给 ID，请先问清楚，不要猜。
- 默认只改一个目标（一个镜头/一个元素/brief）；除非用户明确说“全部/批量/列出多个 ID”。"""

        if scene == "prompt_engineering":
            return common_guardrails + """当前场景：提示词/模型参数建议。
- 给出可执行的提示词改写建议（主体、镜头、风格、负面词、角色一致性）。
- 如果缺少模型/分辨率/参考图信息，先问清再给定稿。
- 如果用户明确提出“修改申请/把某处改成…/优化某个镜头或元素”，请只提出**最小范围**的改动，不要推翻整个项目。
- 当你给出可执行的修改时，请用 ```json``` 输出：
  {
    "reply": "给用户看的说明（包含修改范围与原因）",
    "actions": [
      { "type": "update_shot", "shot_id": "Shot_XX", "patch": { "prompt": "..." }, "reason": "..." }
    ]
  }
  其中 actions 默认只允许修改 `shot.prompt`；除非用户明确要求，否则不要触发重生成。
  当用户明确要批量修改时（如“全部起始帧/所有镜头”或列出多个 Shot_ID），actions 可以包含多个 update_shot，但仍然只改 prompt。"""

        if scene == "project_planning":
            return common_guardrails + """当前场景：项目规划/分镜/脚本问答。
- 优先引用项目里已有的 Creative Brief/镜头/旁白/元素；需要修改时给出最小改动建议。"""

        if scene == "workflow":
            return common_guardrails + """当前场景：工作流推进。
- 明确告诉用户你要执行/建议执行哪一步（规划→元素→起始帧→视频→导出）。
- 遇到关键分歧先确认，不要一次性做太多假设。"""

        return common_guardrails + "当前场景：日常对话/泛问答。"
    
    def _project_snapshot(self, project: Dict[str, Any]) -> Dict[str, Any]:
        """给模型的“事实来源”快照：尽量精简但保留可回答问题所需信息。"""
        if not isinstance(project, dict):
            return {}

        def trunc(value: Any, limit: int) -> str:
            s = _as_text(value)
            if not s:
                return ""
            if len(s) <= limit:
                return s
            return s[:limit] + "…"

        brief_raw = project.get("creative_brief", {})
        brief: Dict[str, Any] = {}
        if isinstance(brief_raw, dict):
            for k, v in brief_raw.items():
                if isinstance(v, str):
                    brief[k] = trunc(v, 800)
                else:
                    brief[k] = v

        snapshot: Dict[str, Any] = {
            "id": project.get("id"),
            "name": project.get("name"),
            "creative_brief": brief,
            "elements": {},
            "segments": [],
            "updated_at": project.get("updated_at"),
        }

        elements = project.get("elements", {}) or {}
        if isinstance(elements, dict):
            for k, v in elements.items():
                if not isinstance(v, dict):
                    continue
                snapshot["elements"][k] = {
                    "id": v.get("id"),
                    "name": v.get("name"),
                    "type": v.get("type"),
                    "description": trunc(v.get("description"), 900),
                    "voice_profile": trunc(v.get("voice_profile"), 300),
                    "image_url": v.get("image_url"),
                    "reference_images": [
                        trunc(u, 400)
                        for u in _ensure_list(v.get("reference_images") or v.get("referenceImages") or [])[:10]
                        if isinstance(u, str) and u.strip()
                    ],
                }

        segments = project.get("segments", []) or []
        if isinstance(segments, list):
            for seg in segments:
                if not isinstance(seg, dict):
                    continue
                shots_out = []
                for shot in (seg.get("shots", []) or []):
                    if not isinstance(shot, dict):
                        continue
                    shots_out.append({
                        "id": shot.get("id"),
                        "name": shot.get("name"),
                        "type": shot.get("type"),
                        "description": trunc(shot.get("description"), 900),
                        "prompt": trunc(shot.get("prompt"), 1200),
                        "video_prompt": trunc(shot.get("video_prompt") or shot.get("videoPrompt"), 1200),
                        "dialogue_script": trunc(shot.get("dialogue_script"), 1200),
                        "narration": trunc(shot.get("narration"), 600),
                        "duration": shot.get("duration"),
                        "status": shot.get("status"),
                        "start_image_url": shot.get("start_image_url"),
                        "video_url": shot.get("video_url"),
                        "reference_images": [
                            trunc(u, 400)
                            for u in _ensure_list(shot.get("reference_images") or shot.get("referenceImages") or [])[:10]
                            if isinstance(u, str) and u.strip()
                        ],
                    })
                snapshot["segments"].append({
                    "id": seg.get("id"),
                    "name": seg.get("name"),
                    "description": seg.get("description"),
                    "shots": shots_out,
                })

        return snapshot
    
    def _collect_project_ids(self, project: Dict[str, Any]) -> Dict[str, set]:
        shot_ids: set = set()
        element_ids: set = set()

        elements = project.get("elements", {}) or {}
        if isinstance(elements, dict):
            for k, v in elements.items():
                element_ids.add(k)
                if isinstance(v, dict) and v.get("id"):
                    element_ids.add(v.get("id"))

        segments = project.get("segments", []) or []
        if isinstance(segments, list):
            for seg in segments:
                if not isinstance(seg, dict):
                    continue
                for shot in (seg.get("shots", []) or []):
                    if isinstance(shot, dict) and shot.get("id"):
                        shot_ids.add(shot.get("id"))

        return {"shot_ids": shot_ids, "element_ids": element_ids}
    
    def _try_parse_action_bundle(self, reply: str) -> Optional[Dict[str, Any]]:
        """解析包含 actions 的 JSON 代码块（如果有的话）。"""
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', reply)
        if not json_match:
            return None
        try:
            data = json.loads(json_match.group(1))
        except Exception:
            return None
        if not isinstance(data, dict):
            return None
        if not isinstance(data.get("reply"), str):
            return None
        if not isinstance(data.get("actions"), list):
            return None
        return data

    def _extract_json_from_reply(self, reply: str) -> Optional[Any]:
        """Extract JSON from LLM output.

        The LLM may return:
        - a ```json code block
        - a generic ``` code block containing JSON
        - JSON embedded in normal text
        """
        if not isinstance(reply, str) or not reply.strip():
            return None

        def try_load(raw: str) -> Optional[Any]:
            if not isinstance(raw, str):
                return None
            s = raw.strip().lstrip("\ufeff")
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                pass

            # Best-effort repair for common "JSON-like" outputs from LLMs
            # (e.g. semicolons, trailing commas, comments, smart quotes).
            def repair_jsonish(text: str) -> str:
                t = (text or "").strip().lstrip("\ufeff")
                if not t:
                    return t

                # normalize smart quotes
                t = (
                    t.replace("“", '"')
                    .replace("”", '"')
                    .replace("„", '"')
                    .replace("‟", '"')
                    .replace("’", "'")
                    .replace("‘", "'")
                )

                # remove comments and replace separators outside of strings
                out: List[str] = []
                i = 0
                in_str = False
                escape = False
                while i < len(t):
                    ch = t[i]
                    if in_str:
                        out.append(ch)
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == '"':
                            in_str = False
                        i += 1
                        continue

                    if ch == '"':
                        in_str = True
                        out.append(ch)
                        i += 1
                        continue

                    # line comment: //
                    if ch == "/" and i + 1 < len(t) and t[i + 1] == "/":
                        i += 2
                        while i < len(t) and t[i] not in ("\n", "\r"):
                            i += 1
                        continue

                    # block comment: /* ... */
                    if ch == "/" and i + 1 < len(t) and t[i + 1] == "*":
                        i += 2
                        while i + 1 < len(t) and not (t[i] == "*" and t[i + 1] == "/"):
                            i += 1
                        i += 2 if i + 1 < len(t) else 0
                        continue

                    # treat semicolons as commas (common in JS-like object output)
                    if ch in (";", "；"):
                        out.append(",")
                        i += 1
                        continue

                    out.append(ch)
                    i += 1

                t = "".join(out)

                # remove trailing commas before } or ]
                out2: List[str] = []
                i = 0
                in_str = False
                escape = False
                while i < len(t):
                    ch = t[i]
                    if in_str:
                        out2.append(ch)
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == '"':
                            in_str = False
                        i += 1
                        continue

                    if ch == '"':
                        in_str = True
                        out2.append(ch)
                        i += 1
                        continue

                    if ch == ",":
                        j = i + 1
                        while j < len(t) and t[j].isspace():
                            j += 1
                        if j < len(t) and t[j] in ("}", "]"):
                            i += 1
                            continue

                    out2.append(ch)
                    i += 1

                return "".join(out2)

            repaired: Optional[str] = None
            try:
                repaired = repair_jsonish(s)
                if repaired and repaired != s:
                    try:
                        return json.loads(repaired)
                    except Exception:
                        pass
            except Exception:
                repaired = None

            def salvage_truncated_json(text: str) -> Optional[str]:
                """Attempt to close a truncated JSON object/array (best-effort).

                This is useful when the model output is cut off mid-string near the end.
                We close any unterminated string and then close remaining brackets.
                """
                t = (text or "").strip().lstrip("\ufeff")
                if not t or t[0] not in "{[":
                    return None

                stack: List[str] = []
                in_str = False
                escape = False
                for ch in t:
                    if in_str:
                        if escape:
                            escape = False
                        elif ch == "\\":
                            escape = True
                        elif ch == '"':
                            in_str = False
                        continue

                    if ch == '"':
                        in_str = True
                        continue

                    if ch in "{[":
                        stack.append(ch)
                        continue

                    if ch in "}]":
                        if not stack:
                            return None
                        opener = stack[-1]
                        if (opener == "{" and ch == "}") or (opener == "[" and ch == "]"):
                            stack.pop()
                            continue
                        return None

                needs_fix = in_str or escape or bool(stack)
                if not needs_fix:
                    return None

                out = t.rstrip()

                # If we ended inside a string, make sure the closing quote won't be escaped.
                if in_str:
                    backslashes = 0
                    i = len(out) - 1
                    while i >= 0 and out[i] == "\\":
                        backslashes += 1
                        i -= 1
                    if backslashes % 2 == 1:
                        out += "\\"
                    out += '"'

                # Strip trailing separators that would break after we append closers.
                out = out.rstrip()
                while out and out[-1] in (",", ":"):
                    out = out[:-1].rstrip()

                for opener in reversed(stack):
                    out += "}" if opener == "{" else "]"
                return out

            for candidate in (repaired, s):
                salvaged = salvage_truncated_json(candidate or "")
                if salvaged:
                    try:
                        return json.loads(salvaged)
                    except Exception:
                        pass
            return None

        # 1) Preferred: ```json ... ```
        json_match = re.search(r"```(?:json|JSON)\\s*([\\s\\S]*?)\\s*```", reply)
        if json_match:
            data = try_load(json_match.group(1))
            if data is not None:
                return data

        # 2) Generic fenced block: ``` ... ``` (some models omit language)
        generic_match = re.search(r"```\\s*([\\s\\S]*?)\\s*```", reply)
        if generic_match:
            data = try_load(generic_match.group(1))
            if data is not None:
                return data

        # 3) Raw reply starts with JSON
        raw = reply.strip()
        if raw.startswith("{") or raw.startswith("["):
            data = try_load(raw)
            if data is not None:
                return data

        # 4) Embedded JSON: extract the first complete object/array via bracket matching
        def extract_first_json(text: str) -> Optional[str]:
            start = -1
            opener = ""
            for i, ch in enumerate(text):
                if ch in "{[":
                    start = i
                    opener = ch
                    break
            if start < 0:
                return None

            closer = "}" if opener == "{" else "]"
            depth = 0
            in_str = False
            escape = False
            for j in range(start, len(text)):
                c = text[j]
                if in_str:
                    if escape:
                        escape = False
                    elif c == "\\":
                        escape = True
                    elif c == '"':
                        in_str = False
                    continue

                if c == '"':
                    in_str = True
                    continue

                if c == opener:
                    depth += 1
                elif c == closer:
                    depth -= 1
                    if depth == 0:
                        return text[start : j + 1]
            return None

        candidate = extract_first_json(reply)
        if candidate:
            return try_load(candidate)

        return None

    def _coerce_float(self, value: Any) -> Optional[float]:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if isinstance(value, str):
            try:
                return float(value.strip())
            except Exception:
                return None
        return None

    def _apply_segments_patch(self, segments: List[Dict[str, Any]], patch: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        if not isinstance(segments, list) or not isinstance(patch, list):
            return segments

        seg_map = {seg.get("id"): seg for seg in segments if isinstance(seg, dict) and seg.get("id")}
        for seg_patch in patch:
            if not isinstance(seg_patch, dict):
                continue
            seg_id = seg_patch.get("id")
            if not isinstance(seg_id, str) or seg_id not in seg_map:
                continue
            seg = seg_map[seg_id]
            for key in ("name", "description"):
                val = seg_patch.get(key)
                if isinstance(val, str) and val.strip():
                    seg[key] = val
            shots_patch = seg_patch.get("shots")
            if isinstance(shots_patch, list):
                shot_map = {s.get("id"): s for s in (seg.get("shots") or []) if isinstance(s, dict) and s.get("id")}
                for sp in shots_patch:
                    if not isinstance(sp, dict):
                        continue
                    sid = sp.get("id")
                    if not isinstance(sid, str) or sid not in shot_map:
                        continue
                    shot = shot_map[sid]
                    for key in ("name", "description", "prompt", "video_prompt", "narration", "dialogue_script"):
                        val = sp.get(key)
                        if isinstance(val, str):
                            shot[key] = val
                    dur = self._coerce_float(sp.get("duration"))
                    if dur is not None and dur > 0:
                        shot["duration"] = dur
        return segments

    def _insert_shots(self, segments: List[Dict[str, Any]], add_shots: Any) -> List[Dict[str, Any]]:
        if not isinstance(segments, list) or not isinstance(add_shots, list):
            return segments

        for item in add_shots:
            if not isinstance(item, dict):
                continue
            segment_id = item.get("segment_id")
            after_shot_id = item.get("after_shot_id")
            shot = item.get("shot")
            if not isinstance(segment_id, str) or not isinstance(shot, dict):
                continue
            target_seg = next((s for s in segments if isinstance(s, dict) and s.get("id") == segment_id), None)
            if not target_seg:
                continue
            shots = target_seg.get("shots") or []
            if not isinstance(shots, list):
                continue

            new_shot = dict(shot)
            new_id = new_shot.get("id")
            if not isinstance(new_id, str) or not new_id.strip():
                new_id = f"Shot_{uuid.uuid4().hex[:8].upper()}"
            existing_ids = {s.get("id") for s in shots if isinstance(s, dict)}
            while new_id in existing_ids:
                new_id = f"Shot_{uuid.uuid4().hex[:8].upper()}"
            new_shot["id"] = new_id
            new_shot.setdefault("status", "pending")
            new_shot.setdefault("created_at", datetime.utcnow().isoformat() + "Z")

            insert_idx = None
            if isinstance(after_shot_id, str) and after_shot_id:
                for idx, s in enumerate(shots):
                    if isinstance(s, dict) and s.get("id") == after_shot_id:
                        insert_idx = idx + 1
                        break
            if insert_idx is None:
                shots.append(new_shot)
            else:
                shots.insert(insert_idx, new_shot)
            target_seg["shots"] = shots

        return segments
    
    def _validate_actions(
        self,
        actions: List[Dict[str, Any]],
        project: Dict[str, Any],
        user_message: str
    ) -> Optional[List[Dict[str, Any]]]:
        """校验 actions：只允许最小范围、且引用项目内真实 ID。"""
        ids = self._collect_project_ids(project)
        shot_ids = ids["shot_ids"]
        element_ids = ids["element_ids"]

        msg = user_message or ""
        allow_multi = any(k in msg for k in ["全部", "全局", "所有", "整体"])

        # 点对点批量：用户显式点名多个 Shot_ID 也允许（仍然会严格限制动作类型）
        mentioned_shots = set(re.findall(r"\bShot_[A-Za-z0-9_]+\b", msg))
        if len(mentioned_shots) >= 2:
            allow_multi = True

        allow_regenerate = any(k in msg for k in ["重生成", "重新生成", "重新出图", "重出图", "重跑"])

        # 额外允许的字段：仅在用户明确提到时开放，避免模型“顺手改一堆”
        allow_video_prompt = any(k in msg.lower() for k in ["video_prompt", "video prompt"]) or any(
            k in msg for k in ["视频提示词", "动态提示词", "视频prompt", "视频 prompt"]
        )
        allow_description = any(k in msg.lower() for k in ["description"]) or ("描述" in msg)
        allow_narration = any(k in msg.lower() for k in ["narration"]) or ("旁白" in msg)
        allow_dialogue = any(k in msg.lower() for k in ["dialogue", "dialogue_script", "dialogue script"]) or any(
            k in msg for k in ["对白", "台词", "对话脚本", "对白脚本"]
        )
        allow_duration = any(k in msg.lower() for k in ["duration"]) or any(k in msg for k in ["时长", "秒数", "持续时间"])
        allow_voice_profile = any(k in msg.lower() for k in ["voice", "voice_profile", "voice profile"]) or any(
            k in msg for k in ["音色", "声音", "配音", "旁白音色", "旁白声音", "角色音色", "角色声音"]
        )

        allow_brief_title = any(k in msg for k in ["标题", "项目名", "名称"])
        allow_brief_visual_style = any(k in msg.lower() for k in ["visual", "style"]) or any(k in msg for k in ["画风", "风格"])
        allow_brief_duration = any(k in msg for k in ["时长", "分钟", "秒"]) or ("duration" in msg.lower())
        allow_brief_aspect_ratio = any(k in msg for k in ["比例", "横屏", "竖屏", "16:9", "9:16"])
        allow_brief_language = ("language" in msg.lower()) or ("语言" in msg)
        allow_brief_voice = any(k in msg.lower() for k in ["narrator", "voice"]) or any(k in msg for k in ["旁白音色", "旁白声音", "旁白配音"])

        max_text_len = 8000

        normalized: List[Dict[str, Any]] = []
        targets: set = set()

        for a in actions:
            if not isinstance(a, dict):
                return None
            t = a.get("type")

            if t == "update_shot":
                shot_id = a.get("shot_id")
                patch = a.get("patch")
                if not isinstance(shot_id, str) or shot_id not in shot_ids:
                    return None
                if not isinstance(patch, dict):
                    return None

                safe_patch: Dict[str, Any] = {}

                # prompt：默认允许（核心最小改动）
                prompt = patch.get("prompt")
                if isinstance(prompt, str) and prompt.strip():
                    p = prompt.strip()
                    if len(p) > max_text_len:
                        return None
                    safe_patch["prompt"] = p

                # 其它字段：仅在用户明确提出时允许
                if allow_video_prompt:
                    vp = patch.get("video_prompt") if "video_prompt" in patch else patch.get("videoPrompt")
                    if isinstance(vp, str) and vp.strip():
                        vps = vp.strip()
                        if len(vps) > max_text_len:
                            return None
                        safe_patch["video_prompt"] = vps

                if allow_description:
                    desc = patch.get("description")
                    if isinstance(desc, str) and desc.strip():
                        ds = desc.strip()
                        if len(ds) > max_text_len:
                            return None
                        safe_patch["description"] = ds

                if allow_narration:
                    nar = patch.get("narration")
                    if isinstance(nar, str) and nar.strip():
                        ns = nar.strip()
                        if len(ns) > max_text_len:
                            return None
                        safe_patch["narration"] = ns

                if allow_dialogue:
                    dlg = patch.get("dialogue_script") if "dialogue_script" in patch else patch.get("dialogueScript")
                    if isinstance(dlg, str) and dlg.strip():
                        ds = dlg.strip()
                        if len(ds) > max_text_len:
                            return None
                        safe_patch["dialogue_script"] = ds

                if allow_duration:
                    dur = self._coerce_float(patch.get("duration"))
                    if dur is not None:
                        if dur <= 0 or dur > 600:
                            return None
                        safe_patch["duration"] = dur

                if not safe_patch:
                    return None
                targets.add(f"shot:{shot_id}")
                normalized.append({
                    "type": "update_shot",
                    "shot_id": shot_id,
                    "patch": safe_patch,
                    "reason": a.get("reason") if isinstance(a.get("reason"), str) else None
                })

            elif t == "regenerate_shot_frame":
                if not allow_regenerate:
                    return None
                shot_id = a.get("shot_id")
                if not isinstance(shot_id, str) or shot_id not in shot_ids:
                    return None
                targets.add(f"shot:{shot_id}")
                normalized.append({
                    "type": "regenerate_shot_frame",
                    "shot_id": shot_id,
                    "visualStyle": a.get("visualStyle") if isinstance(a.get("visualStyle"), str) else None
                })

            elif t == "update_element":
                element_id = a.get("element_id")
                patch = a.get("patch")
                if not isinstance(element_id, str) or element_id not in element_ids:
                    return None
                if not isinstance(patch, dict):
                    return None
                safe_patch: Dict[str, Any] = {}
                desc = patch.get("description")
                if isinstance(desc, str) and desc.strip():
                    ds = desc.strip()
                    if len(ds) > max_text_len:
                        return None
                    safe_patch["description"] = ds
                if allow_voice_profile:
                    vp = patch.get("voice_profile") if "voice_profile" in patch else patch.get("voiceProfile")
                    if isinstance(vp, str) and vp.strip():
                        vps = vp.strip()
                        if len(vps) > max_text_len:
                            return None
                        safe_patch["voice_profile"] = vps
                if not safe_patch:
                    return None
                targets.add(f"element:{element_id}")
                normalized.append({
                    "type": "update_element",
                    "element_id": element_id,
                    "patch": safe_patch,
                    "reason": a.get("reason") if isinstance(a.get("reason"), str) else None
                })

            elif t == "update_brief":
                patch = a.get("patch")
                if not isinstance(patch, dict):
                    return None

                safe_patch: Dict[str, Any] = {}

                def take_str(val: Any) -> Optional[str]:
                    if isinstance(val, str) and val.strip():
                        s = val.strip()
                        if len(s) > max_text_len:
                            return None
                        return s
                    return None

                title = take_str(patch.get("title"))
                if title and allow_brief_title:
                    safe_patch["title"] = title

                video_type = take_str(patch.get("videoType") if "videoType" in patch else patch.get("video_type"))
                if video_type:
                    safe_patch["videoType"] = video_type

                narrative_driver = take_str(
                    patch.get("narrativeDriver") if "narrativeDriver" in patch else patch.get("narrative_driver")
                )
                if narrative_driver:
                    safe_patch["narrativeDriver"] = narrative_driver

                emotional_tone = take_str(patch.get("emotionalTone") if "emotionalTone" in patch else patch.get("emotional_tone"))
                if emotional_tone:
                    safe_patch["emotionalTone"] = emotional_tone

                visual_style = take_str(patch.get("visualStyle") if "visualStyle" in patch else patch.get("visual_style"))
                if visual_style and allow_brief_visual_style:
                    safe_patch["visualStyle"] = visual_style

                duration = take_str(patch.get("duration"))
                if duration and allow_brief_duration:
                    safe_patch["duration"] = duration

                aspect_ratio = take_str(patch.get("aspectRatio") if "aspectRatio" in patch else patch.get("aspect_ratio"))
                if aspect_ratio and allow_brief_aspect_ratio:
                    safe_patch["aspectRatio"] = aspect_ratio

                language = take_str(patch.get("language"))
                if language and allow_brief_language:
                    safe_patch["language"] = language

                narrator_voice = take_str(
                    patch.get("narratorVoiceProfile")
                    if "narratorVoiceProfile" in patch
                    else patch.get("narrator_voice_profile")
                )
                if narrator_voice and allow_brief_voice:
                    safe_patch["narratorVoiceProfile"] = narrator_voice

                if not safe_patch:
                    return None
                targets.add("brief")
                normalized.append({
                    "type": "update_brief",
                    "patch": safe_patch,
                    "reason": a.get("reason") if isinstance(a.get("reason"), str) else None
                })

            else:
                return None

        if len(normalized) > 50:
            return None

        # 默认只允许一个目标，避免“推翻重来”
        if len(targets) > 1 and not allow_multi:
            return None

        # 保持 deterministic：update 在前、regenerate 在后
        order = {"update_shot": 1, "update_element": 1, "update_brief": 1, "regenerate_shot_frame": 2}
        normalized.sort(key=lambda x: order.get(x.get("type"), 9))
        return normalized
    
    def _init_client(self):
        """初始化 LLM 客户端"""
        settings = self.storage.get_settings() or {}
        if not isinstance(settings, dict):
            settings = {}
        llm_config = settings.get("llm", {}) if isinstance(settings, dict) else {}
        if not isinstance(llm_config, dict):
            llm_config = {}
        
        api_key = llm_config.get("apiKey") or os.getenv("LLM_API_KEY", "")
        if not api_key:
            self.client = None
            self._llm_fingerprint = None
            print("[Agent] 未配置 LLM API Key")
            return
        
        provider = llm_config.get("provider", "qwen")
        base_url = llm_config.get("baseUrl", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.model = llm_config.get("model", "qwen-plus")
        
        # 处理自定义配置
        if provider.startswith("custom_"):
            custom_providers = self.storage.get_custom_providers()
            custom_config = custom_providers.get(provider, {})
            if custom_config:
                api_key = custom_config.get("apiKey", api_key)
                base_url = custom_config.get("baseUrl", base_url)
                self.model = custom_config.get("model", self.model)
        
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        self._llm_fingerprint = (provider, api_key, base_url, self.model)
        print(f"[Agent] 初始化完成: model={self.model}")

    def _ensure_client(self) -> bool:
        """Ensure LLM client is initialized and up-to-date with latest settings."""
        settings = self.storage.get_settings() or {}
        if not isinstance(settings, dict):
            settings = {}
        llm_config = settings.get("llm", {})
        if not isinstance(llm_config, dict):
            llm_config = {}

        provider = llm_config.get("provider", "qwen")
        api_key = llm_config.get("apiKey") or os.getenv("LLM_API_KEY", "")
        base_url = llm_config.get("baseUrl", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        model = llm_config.get("model", "qwen-plus")

        if provider.startswith("custom_"):
            custom_providers = self.storage.get_custom_providers()
            custom_config = custom_providers.get(provider, {})
            if isinstance(custom_config, dict) and custom_config:
                api_key = custom_config.get("apiKey", api_key)
                base_url = custom_config.get("baseUrl", base_url)
                model = custom_config.get("model", model)

        fingerprint = (provider, api_key, base_url, model)
        if self.client is None or self._llm_fingerprint != fingerprint:
            self._init_client()
        return self.client is not None
    
    async def chat(self, message: str, context: Optional[Dict] = None) -> Dict[str, Any]:
        """对话接口 - 处理用户消息并返回结构化响应"""
        if not self._ensure_client():
            return {
                "type": "text",
                "content": "请先在设置中配置 LLM API Key 以启用 AI 助手功能。"
            }
        
        try:
            messages = [{"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)}]

            ctx = context or {}
            project = ctx.get("project") if isinstance(ctx, dict) else None
            # Optional global “manager/supervisor” mode (floating assistant)
            if isinstance(ctx, dict):
                mode = ctx.get("assistant_mode") or ctx.get("assistantMode") or ctx.get("mode") or ctx.get("module")
                if mode == "manager":
                    messages.append({
                        "role": "system",
                        "content": self._get_prompt("agent.manager_system_prompt", DEFAULT_MANAGER_SYSTEM_PROMPT)
                    })
            scene = self._detect_scene(message)
            if isinstance(project, dict) and self._looks_like_operator_request(message, project):
                scene = "operator"
            messages.append({"role": "system", "content": self._scene_system_prompt(scene)})

            # 项目事实快照（禁止模型脑补）
            if isinstance(project, dict):
                shortcut = self._maybe_frame_generation_shortcut(message, project)
                if shortcut:
                    return shortcut

                snapshot = self._project_snapshot(project)
                messages.append({
                    "role": "system",
                    "content": "项目上下文（仅作为事实来源，缺失则先问，不要脑补）：\n"
                               + json.dumps(snapshot, ensure_ascii=False, indent=2)
                })

                # 追加对话记忆（仅最近 N 条）
                memory = project.get("agent_memory", []) or []
                if isinstance(memory, list) and memory:
                    memory_tail = memory[-20:]
                    for m in memory_tail:
                        if not isinstance(m, dict):
                            continue
                        role = m.get("role")
                        content = m.get("content")
                        if role in ("user", "assistant") and isinstance(content, str) and content.strip():
                            c = content.strip()
                            if len(c) > 1200:
                                c = c[:1200] + "…"
                            messages.append({"role": role, "content": c})

            # Support stateless chat: allow passing recent chat history via context
            # so the assistant doesn't "forget" previous turns before a project exists.
            if not (
                isinstance(project, dict)
                and isinstance(project.get("agent_memory"), list)
                and project.get("agent_memory")
            ):
                history = None
                if isinstance(ctx, dict):
                    for key in ("chat_history", "chatHistory", "history", "agent_memory", "agentMemory"):
                        cand = ctx.get(key)
                        if isinstance(cand, list) and cand:
                            history = cand
                            break

                if isinstance(history, list) and history:
                    for h in history[-20:]:
                        if not isinstance(h, dict):
                            continue
                        h_role = h.get("role")
                        h_content = h.get("content")
                        if h_role in ("user", "assistant") and isinstance(h_content, str) and h_content.strip():
                            c = h_content.strip()
                            if len(c) > 1200:
                                c = c[:1200] + "..."
                            messages.append({"role": h_role, "content": c})

            messages.append({"role": "user", "content": message})
            
            # 调用 LLM
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=6000
            )
            
            reply = response.choices[0].message.content or ""

            # 如果模型给出“最小修改动作”，优先走可确认的 actions（避免一不小心推翻重来）
            if isinstance(project, dict):
                bundle = self._try_parse_action_bundle(reply)
                if bundle:
                    validated = self._validate_actions(bundle.get("actions", []), project, message)
                    if validated:
                        has_regen = any(a.get("type") == "regenerate_shot_frame" for a in validated if isinstance(a, dict))
                        return {
                            "type": "text",
                            "content": bundle.get("reply", ""),
                            "data": {"actions": validated},
                            "confirmButton": {
                                "label": "只修改错误点并重生成" if has_regen else "只修改错误点",
                                "action": "apply_agent_actions",
                                "payload": validated
                            }
                        }
                    else:
                        # 解析到了 actions 但没通过安全校验：退回普通对话（要求用户缩小范围/给出明确目标）
                        return {
                            "type": "text",
                            "content": bundle.get("reply", "") + "\n\n（为避免推翻重来：我需要你明确一个要修改的镜头 ID（如 Shot_03）或元素 ID（如 Element_WOLF），我会只改这一个。）"
                        }

            # 否则按原有逻辑解析（文本 / structured / action）
            parsed = self._parse_response(reply)
            return parsed
            
        except Exception as e:
            print(f"[Agent] 对话失败: {e}")
            return {
                "type": "error",
                "content": f"AI 助手调用失败: {str(e)}"
            }
    
    def _normalize_project_plan(self, data: Any) -> Optional[Dict[str, Any]]:
        """Normalize LLM planning output into the canonical AgentProjectPlan shape."""
        if not isinstance(data, dict):
            return None

        # unwrap common wrappers
        for wrap_key in ("plan", "result", "data"):
            wrapped = data.get(wrap_key)
            if isinstance(wrapped, dict):
                data = wrapped
                break

        def nk(key: Any) -> str:
            if not isinstance(key, str):
                return ""
            return re.sub(r"[^a-z0-9]+", "", key.lower())

        def pick(obj: Any, *candidates: str) -> Any:
            if not isinstance(obj, dict):
                return None
            key_map: Dict[str, str] = {}
            for k in obj.keys():
                if isinstance(k, str):
                    key_map[nk(k)] = k
            for cand in candidates:
                k = key_map.get(nk(cand))
                if k is not None:
                    return obj.get(k)
            return None

        def as_str(value: Any) -> str:
            if isinstance(value, str):
                return value.strip()
            if value is None:
                return ""
            return str(value).strip()

        def ensure_prefix(raw_id: str, prefix: str, fallback: str) -> str:
            rid = (raw_id or "").strip()
            if not rid:
                rid = fallback
            if rid.startswith(prefix):
                return rid
            if rid.isdigit():
                return f"{prefix}{rid}"
            slug = re.sub(r"[^A-Za-z0-9_]+", "_", rid).strip("_") or fallback.replace(prefix, "")
            return f"{prefix}{slug}"

        # --- creative brief ---
        brief_raw = pick(
            data,
            "creative_brief",
            "creativeBrief",
            "Creative_Brief",
            "brief",
            "project_overview",
            "projectOverview",
        )
        if not isinstance(brief_raw, dict):
            brief_raw = data

        title = as_str(pick(brief_raw, "title", "project_name", "Project_Name", "name")) or "未命名项目"
        duration = as_str(pick(brief_raw, "duration", "total_duration", "Total_Duration")) or ""
        visual_style = as_str(pick(brief_raw, "visual_style", "Visual_Style", "style")) or ""
        emotional_tone = as_str(pick(brief_raw, "emotional_tone", "Emotional_Tone", "tone", "core_theme", "Core_Theme")) or ""
        language = as_str(pick(brief_raw, "language", "Language")) or "中文"
        aspect_ratio = as_str(pick(brief_raw, "aspect_ratio", "Aspect_Ratio", "aspect")) or "16:9"
        video_type = as_str(pick(brief_raw, "video_type", "Video_Type", "type")) or "Narrative Story"
        narrative_driver = as_str(pick(brief_raw, "narrative_driver", "Narrative_Driver", "driver")) or "旁白驱动"
        narrator_voice_profile = as_str(
            pick(brief_raw, "narratorVoiceProfile", "narrator_voice_profile", "Narrator_Voice_Profile", "voice_profile")
        )

        creative_brief: Dict[str, Any] = {
            "title": title,
            "video_type": video_type,
            "narrative_driver": narrative_driver,
            "emotional_tone": emotional_tone,
            "visual_style": visual_style,
            "duration": duration,
            "aspect_ratio": aspect_ratio,
            "language": language,
        }
        if narrator_voice_profile:
            creative_brief["narratorVoiceProfile"] = narrator_voice_profile

        # --- elements ---
        elements_raw = pick(
            data,
            "elements",
            "key_elements",
            "Key_Elements",
            "characters",
            "assets",
            "character_designs",
            "characterDesigns",
            "Character_Designs",
        )
        elements: List[Dict[str, Any]] = []

        if isinstance(elements_raw, list):
            for i, item in enumerate(elements_raw):
                if not isinstance(item, dict):
                    continue
                eid = ensure_prefix(as_str(pick(item, "id")), "Element_", f"Element_{i+1}")
                name = as_str(pick(item, "name", "Name")) or eid
                typ = as_str(pick(item, "type", "Type", "element_type", "Element_Type")) or ""
                if typ not in ("character", "object", "scene"):
                    typ = "character"
                desc = as_str(pick(item, "description", "Description", "visual_description", "Visual_Description")) or ""
                voice_profile = as_str(pick(item, "voice_profile", "Voice_Profile", "voiceProfile")) or ""
                out = {"id": eid, "name": name, "type": typ, "description": desc}
                if voice_profile:
                    out["voice_profile"] = voice_profile
                elements.append(out)
        elif isinstance(elements_raw, dict):
            for i, (k, v) in enumerate(elements_raw.items()):
                if not isinstance(k, str):
                    continue
                if not isinstance(v, dict):
                    v = {}
                eid = ensure_prefix(k, "Element_", f"Element_{i+1}")
                name = as_str(pick(v, "name", "Name", "label", "Label", "display_name", "Display_Name")) or eid
                typ = as_str(pick(v, "type", "Type", "element_type", "Element_Type")) or ""
                if typ not in ("character", "object", "scene"):
                    upper = eid.upper()
                    if "SCENE" in upper or "BG" in upper or "LOCATION" in upper:
                        typ = "scene"
                    elif any(tok in upper for tok in ("PROP", "OBJECT", "ITEM", "PILLOW", "WEAPON", "TOOL", "VEHICLE", "CAR")):
                        typ = "object"
                    else:
                        typ = "character"
                desc = as_str(pick(v, "description", "Description", "visual_description", "Visual_Description")) or ""
                voice_profile = as_str(pick(v, "voice_profile", "Voice_Profile", "voiceProfile")) or ""
                out = {"id": eid, "name": name, "type": typ, "description": desc}
                if voice_profile:
                    out["voice_profile"] = voice_profile
                elements.append(out)

        # Ensure core elements exist (for schemas like { creative_brief: { core_elements: [...] } })
        core_raw = pick(brief_raw, "core_elements", "coreElements", "Core_Elements")
        core_ids: List[str] = []
        if isinstance(core_raw, list):
            for v in core_raw:
                if isinstance(v, str) and v.strip():
                    core_ids.append(ensure_prefix(v.strip(), "Element_", v.strip()))
        if core_ids:
            by_id: Dict[str, Dict[str, Any]] = {
                e.get("id"): e for e in elements if isinstance(e, dict) and isinstance(e.get("id"), str) and e.get("id")
            }
            for cid in core_ids:
                if cid in by_id:
                    continue
                upper = cid.upper()
                if "SCENE" in upper or "BG" in upper or "LOCATION" in upper:
                    typ = "scene"
                elif any(tok in upper for tok in ("PROP", "OBJECT", "ITEM", "PILLOW", "WEAPON", "TOOL", "VEHICLE", "CAR")):
                    typ = "object"
                else:
                    typ = "character"
                placeholder = {"id": cid, "name": cid, "type": typ, "description": ""}
                elements.append(placeholder)
                by_id[cid] = placeholder

        # --- segments / shots ---
        def normalize_shot(raw_shot: Any, index: int) -> Dict[str, Any]:
            if not isinstance(raw_shot, dict):
                sid = ensure_prefix("", "Shot_", f"Shot_{index+1}")
                return {
                    "id": sid,
                    "name": sid,
                    "type": "standard",
                    "duration": "5",
                    "description": "",
                    "prompt": "",
                    "video_prompt": "",
                    "narration": "",
                    "dialogue_script": "",
                }

            sid = as_str(pick(raw_shot, "id", "shot_id", "Shot_Id", "shotId")) or as_str(pick(raw_shot, "shot", "number", "index"))
            sid = ensure_prefix(sid, "Shot_", f"Shot_{index+1}")
            name = as_str(pick(raw_shot, "name", "shot_name", "Shot_Name", "title", "scene", "Scene")) or sid
            typ = as_str(pick(raw_shot, "type", "shot_type", "Shot_Type", "scene_type", "Scene_Type")) or "standard"
            duration = as_str(pick(raw_shot, "duration", "Duration", "duration_seconds", "durationSeconds")) or "5"
            desc = as_str(
                pick(raw_shot, "description", "Description", "desc", "visual_description", "Visual_Description", "shot_description", "Shot_Description")
            ) or ""
            prompt = as_str(pick(raw_shot, "prompt", "Prompt", "image_prompt", "Image_Prompt", "imagePrompt")) or ""
            video_prompt = as_str(pick(raw_shot, "video_prompt", "Video_Prompt", "videoPrompt")) or ""
            narration = as_str(pick(raw_shot, "narration", "Narration", "voiceover", "Voiceover", "audio", "Audio")) or ""
            dialogue_script = as_str(pick(raw_shot, "dialogue_script", "Dialogue_Script", "dialogue", "Dialogue")) or ""
            return {
                "id": sid,
                "name": name,
                "type": typ,
                "duration": duration,
                "description": desc,
                "prompt": prompt,
                "video_prompt": video_prompt,
                "narration": narration,
                "dialogue_script": dialogue_script,
            }

        def normalize_segment(raw_seg: Any, index: int) -> Dict[str, Any]:
            if not isinstance(raw_seg, dict):
                seg_id = ensure_prefix("", "Segment_", f"Segment_{index+1}")
                return {"id": seg_id, "name": seg_id, "description": "", "shots": []}

            seg_id = ensure_prefix(as_str(pick(raw_seg, "id", "segment_id", "Segment_Id", "segmentId")), "Segment_", f"Segment_{index+1}")
            name = as_str(pick(raw_seg, "name", "Name", "title", "Title")) or seg_id
            description = as_str(pick(raw_seg, "description", "Description", "desc")) or ""
            shots_raw = pick(raw_seg, "shots", "Shots", "shot_list", "shotList") or []
            shots: List[Dict[str, Any]] = []
            if isinstance(shots_raw, list):
                for j, shot in enumerate(shots_raw):
                    shots.append(normalize_shot(shot, j))
            return {"id": seg_id, "name": name, "description": description, "shots": shots}

        segments_raw = pick(data, "segments", "Segments")
        segments: List[Dict[str, Any]] = []
        if isinstance(segments_raw, list):
            for i, seg in enumerate(segments_raw):
                segments.append(normalize_segment(seg, i))
        else:
            shots_raw = pick(data, "storyboard_with_prompts", "Storyboard_With_Prompts", "shots", "Shots", "storyboard", "Storyboard")
            if isinstance(shots_raw, list):
                segments = [
                    {
                        "id": "Segment_1",
                        "name": "Storyboard",
                        "description": "",
                        "shots": [normalize_shot(s, i) for i, s in enumerate(shots_raw)],
                    }
                ]

        cost_raw = pick(data, "cost_estimate", "Cost_Estimate", "cost")
        if not isinstance(cost_raw, dict):
            cost_raw = {}
        cost_estimate = {
            "elements": as_str(pick(cost_raw, "elements", "Elements")) or "TBD",
            "shots": as_str(pick(cost_raw, "shots", "Shots")) or "TBD",
            "audio": as_str(pick(cost_raw, "audio", "Audio")) or "TBD",
            "total": as_str(pick(cost_raw, "total", "Total")) or "TBD",
        }

        return {
            "creative_brief": creative_brief,
            "elements": elements,
            "segments": segments,
            "cost_estimate": cost_estimate,
        }

    async def plan_project(self, user_request: str, style: str = "吉卜力2D") -> Dict[str, Any]:
        """规划项目 - 根据用户需求生成完整的项目规划"""
        if not self._ensure_client():
            return {"success": False, "error": "未配置 LLM API Key"}
        
        try:
            prompt = self._format_prompt_safe(
                self._get_prompt("agent.project_planning_prompt", DEFAULT_PROJECT_PLANNING_PROMPT),
                user_request=user_request,
            )
            prompt = (
                "IMPORTANT:\n"
                "- Output must be valid JSON (double quotes, no trailing commas, no semicolons).\n"
                "- Keys must match the template exactly (snake_case).\n"
                "- Output only ONE ```json ... ``` code block, with no extra text.\n\n"
                + prompt
            )
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.2,
                max_tokens=8000
            )
            
            reply = response.choices[0].message.content or ""
            
            # 提取 JSON：模型可能不总是用 ```json 代码块，这里做宽松解析
            data = self._extract_json_from_reply(reply)
            normalized = self._normalize_project_plan(data)
            if normalized:
                normalized = self._postprocess_audio_driven_plan(normalized, user_request)
                normalized = await self._maybe_duration_fit_plan(normalized, user_request)
                return {"success": True, "plan": normalized}

            # Repair attempt: ask the model to output strict JSON matching the schema.
            try:
                repair_prompt = (
                    "你的上一条回复无法被程序解析为符合 schema 的 JSON。"
                    "请严格按下面模板重新输出。注意：只输出一个 ```json ... ``` 代码块，不要其他文字。\n\n"
                    + prompt
                )
                repair_response = await self.client.chat.completions.create(
                    model=self.model,
                    messages=[
                        {"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)},
                        {"role": "user", "content": repair_prompt},
                    ],
                    temperature=0.2,
                    max_tokens=8000,
                )
                repair_reply = repair_response.choices[0].message.content or ""
                repaired = self._extract_json_from_reply(repair_reply)
                normalized2 = self._normalize_project_plan(repaired)
                if normalized2:
                    normalized2 = self._postprocess_audio_driven_plan(normalized2, user_request)
                    normalized2 = await self._maybe_duration_fit_plan(normalized2, user_request)
                    return {"success": True, "plan": normalized2}
            except Exception as e:
                print(f"[Agent] project planning repair failed: {e}")

            return {"success": False, "error": "无法解析项目规划", "raw": reply}
            
        except Exception as e:
            print(f"[Agent] 项目规划失败: {e}")
            return {"success": False, "error": str(e)}

    def _find_target_duration_seconds(self, user_request: str, brief_duration: Any) -> Optional[float]:
        # Prefer explicit duration mentioned by user; fall back to persisted targetDurationSeconds (if any).
        t = _parse_duration_seconds(user_request)
        if t is None:
            if isinstance(brief_duration, (int, float)):
                t = float(brief_duration)
            elif isinstance(brief_duration, str) and brief_duration.strip():
                raw = brief_duration.strip()
                # targetDurationSeconds might be a numeric string (seconds)
                if re.fullmatch(r"\d+(?:\.\d+)?", raw):
                    try:
                        t = float(raw)
                    except Exception:
                        t = None
                else:
                    t = _parse_duration_seconds(raw)
        if t is None:
            return None
        try:
            v = float(t)
        except Exception:
            return None
        if not math.isfinite(v) or v <= 0:
            return None
        # Reject implausibly long durations for this app.
        if v > 3600 * 2:
            return None
        return v

    def _duration_fit_snapshot(self, plan: Dict[str, Any]) -> Dict[str, Any]:
        """Compact snapshot for duration-fitting: keep only audio-relevant fields."""
        if not isinstance(plan, dict):
            return {}
        brief = plan.get("creative_brief") if isinstance(plan.get("creative_brief"), dict) else {}
        segs_out: List[Dict[str, Any]] = []
        segs = plan.get("segments") or []
        if isinstance(segs, list):
            for seg in segs:
                if not isinstance(seg, dict):
                    continue
                shots_out: List[Dict[str, Any]] = []
                for shot in seg.get("shots") or []:
                    if not isinstance(shot, dict):
                        continue
                    shots_out.append({
                        "id": shot.get("id"),
                        "name": shot.get("name"),
                        "duration": shot.get("duration"),
                        "description": shot.get("description"),
                        "narration": shot.get("narration"),
                        "dialogue_script": shot.get("dialogue_script"),
                    })
                segs_out.append({
                    "id": seg.get("id"),
                    "name": seg.get("name"),
                    "description": seg.get("description"),
                    "shots": shots_out,
                })
        return {"creative_brief": brief, "segments": segs_out}

    def _collect_script_text(self, plan: Dict[str, Any]) -> str:
        parts: List[str] = []
        for seg in plan.get("segments") or []:
            if not isinstance(seg, dict):
                continue
            for shot in seg.get("shots") or []:
                if not isinstance(shot, dict):
                    continue
                narration = _as_text(shot.get("narration")).strip()
                if narration:
                    parts.append(narration)
                dlg = _as_text(shot.get("dialogue_script")).strip()
                if dlg:
                    parts.append(" ".join(_extract_dialogue_utterances(dlg)))
        return " ".join([p for p in parts if p])

    def _suggest_tts_speed_ratio(self, plan: Dict[str, Any], target_seconds: float) -> Optional[float]:
        if not isinstance(target_seconds, (int, float)) or target_seconds <= 0:
            return None
        text = self._collect_script_text(plan)
        est = _estimate_speech_seconds(text, speed=1.0)
        if est <= 0.01:
            return None
        # If script is longer than target, speed_ratio > 1.0 (faster).
        # Clamp to a reasonable range to avoid unnatural speech.
        ratio = est / float(target_seconds)
        ratio = _clamp(ratio, 0.85, 1.25)
        return ratio

    def _sum_plan_shot_durations(self, plan: Dict[str, Any]) -> float:
        total = 0.0
        segs = plan.get("segments") or []
        if not isinstance(segs, list):
            return 0.0
        for seg in segs:
            if not isinstance(seg, dict):
                continue
            for shot in seg.get("shots") or []:
                if not isinstance(shot, dict):
                    continue
                d = self._coerce_duration_seconds(shot.get("duration"), default=5.0)
                total += float(_ceil_to_half(_clamp(d, 2.0, 6.0)) or 2.0)
        return total

    def _estimate_total_duration_after_split(self, plan: Dict[str, Any], speed_ratio: float, max_shot_seconds: float = 6.0) -> float:
        """Estimate total timeline seconds if we split shots by audio at the given speed."""
        total = 0.0
        segs = plan.get("segments") or []
        if not isinstance(segs, list):
            return 0.0
        for seg in segs:
            if not isinstance(seg, dict):
                continue
            shots = seg.get("shots") or []
            if not isinstance(shots, list):
                continue
            for shot in shots:
                if not isinstance(shot, dict):
                    continue
                for ns in self._split_shot_by_audio(shot, speed_ratio=speed_ratio, max_shot_seconds=max_shot_seconds):
                    d = self._coerce_duration_seconds(ns.get("duration"), default=5.0)
                    total += float(_ceil_to_half(_clamp(d, 2.0, max_shot_seconds)) or 2.0)
        return total

    def _pick_speed_ratio_for_target(self, plan: Dict[str, Any], target_seconds: float, max_shot_seconds: float = 6.0) -> float:
        """Pick a speed ratio (0.85-1.25) that best matches target duration after audio-driven splitting."""
        if not isinstance(target_seconds, (int, float)) or target_seconds <= 0:
            return 1.0
        candidates = [round(0.85 + 0.05 * i, 2) for i in range(9)]  # 0.85..1.25
        best = 1.0
        best_diff = float("inf")
        for sp in candidates:
            total = self._estimate_total_duration_after_split(plan, speed_ratio=sp, max_shot_seconds=max_shot_seconds)
            diff = abs(total - float(target_seconds))
            # tie-break: prefer closer to 1.0
            if diff < best_diff - 1e-6 or (abs(diff - best_diff) <= 1e-6 and abs(sp - 1.0) < abs(best - 1.0)):
                best = sp
                best_diff = diff
        return float(_clamp(best, 0.85, 1.25))

    def _distribute_duration_slack(self, plan: Dict[str, Any], target_seconds: float, max_shot_seconds: float = 6.0) -> None:
        """If the timeline is shorter than target, distribute extra duration by extending shots (up to max_shot_seconds)."""
        if not isinstance(target_seconds, (int, float)) or target_seconds <= 0:
            return
        shots: List[Dict[str, Any]] = []
        segs = plan.get("segments") or []
        if isinstance(segs, list):
            for seg in segs:
                if not isinstance(seg, dict):
                    continue
                for shot in seg.get("shots") or []:
                    if isinstance(shot, dict):
                        shots.append(shot)

        if not shots:
            return

        total = self._sum_plan_shot_durations(plan)
        remaining = float(target_seconds) - float(total)
        # Convert to 0.5s ticks (avoid tiny oscillations)
        ticks = int(round(_ceil_to_half(max(0.0, remaining)) * 2.0))
        if ticks <= 0:
            return

        # Prioritize shots with more slack.
        def slack_of(s: Dict[str, Any]) -> float:
            d = self._coerce_duration_seconds(s.get("duration"), default=5.0)
            d = float(_ceil_to_half(_clamp(d, 2.0, max_shot_seconds)) or 2.0)
            return float(max_shot_seconds) - d

        # Limit cycles to avoid infinite loops if everything is capped.
        max_cycles = max(3, len(shots) * 3)
        cycle = 0
        while ticks > 0 and cycle < max_cycles:
            cycle += 1
            progress = False
            shots_sorted = sorted(shots, key=slack_of, reverse=True)
            for shot in shots_sorted:
                if ticks <= 0:
                    break
                cur = self._coerce_duration_seconds(shot.get("duration"), default=5.0)
                cur = float(_ceil_to_half(_clamp(cur, 2.0, max_shot_seconds)) or 2.0)
                if cur + 0.5 <= float(max_shot_seconds) + 1e-6:
                    shot["duration"] = str(_ceil_to_half(cur + 0.5) or cur + 0.5)
                    ticks -= 1
                    progress = True
            if not progress:
                break

    async def _maybe_duration_fit_plan(self, plan: Dict[str, Any], user_request: str) -> Dict[str, Any]:
        """If user provided total duration and heuristic fit is still off, ask LLM to rewrite narration/dialogue to fit."""
        if not isinstance(plan, dict):
            return plan
        brief = plan.get("creative_brief")
        if not isinstance(brief, dict):
            brief = {}
            plan["creative_brief"] = brief

        target_seconds = self._find_target_duration_seconds(user_request, brief.get("targetDurationSeconds"))
        if not target_seconds:
            return plan

        total = self._sum_plan_shot_durations(plan)
        diff_ratio = abs(total - float(target_seconds)) / float(target_seconds) if target_seconds else 0.0
        try:
            sp = float(brief.get("ttsSpeedRatio")) if isinstance(brief.get("ttsSpeedRatio"), str) else None
        except Exception:
            sp = None

        # Only do an extra LLM pass when mismatch is large or we hit speed caps.
        at_cap = sp is not None and (abs(sp - 0.85) < 0.02 or abs(sp - 1.25) < 0.02)
        if diff_ratio <= 0.08 and not (at_cap and diff_ratio > 0.05):
            return plan

        if not self._ensure_client():
            return plan

        snapshot = self._duration_fit_snapshot(plan)
        prompt = self._format_prompt_safe(
            self._get_prompt("agent.duration_fit_prompt", DEFAULT_DURATION_FIT_PROMPT),
            user_request=user_request,
            target_seconds=str(int(round(float(target_seconds)))),
            project_json=json.dumps(snapshot, ensure_ascii=False, indent=2),
        )
        prompt = (
            "IMPORTANT:\n"
            "- Output must be valid JSON (double quotes, no trailing commas).\n"
            "- Output only ONE ```json ... ``` code block, with no extra text.\n\n"
            + prompt
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.3,
                max_tokens=6000,
            )
            reply = response.choices[0].message.content or ""
            data = self._extract_json_from_reply(reply)
            if not isinstance(data, dict):
                return plan

            creative_brief_patch = data.get("creative_brief_patch") or {}
            segments_patch = data.get("segments_patch") or []
            add_shots = data.get("add_shots") or []

            next_plan = copy.deepcopy(plan)
            next_brief = dict(next_plan.get("creative_brief") or {})
            if isinstance(creative_brief_patch, dict):
                next_brief.update(creative_brief_patch)
            next_plan["creative_brief"] = next_brief

            next_segments = next_plan.get("segments") or []
            if isinstance(next_segments, list) and isinstance(segments_patch, list):
                next_segments = self._apply_segments_patch(next_segments, segments_patch)
            if isinstance(next_segments, list) and isinstance(add_shots, list) and add_shots:
                next_segments = self._insert_shots(next_segments, add_shots)
            next_plan["segments"] = next_segments

            # Re-apply audio-driven postprocess (split + speed + duration slack)
            return self._postprocess_audio_driven_plan(next_plan, user_request)
        except Exception as e:
            print(f"[Agent] duration fit failed: {e}")
            return plan

    def _coerce_duration_seconds(self, raw: Any, default: float = 5.0) -> float:
        try:
            v = float(raw)
        except Exception:
            v = default
        if not math.isfinite(v) or v <= 0:
            v = default
        return v

    def _dialogue_line_utterance(self, line: str) -> str:
        ln = (line or "").strip()
        if not ln:
            return ""
        if "：" in ln:
            _, tail = ln.split("：", 1)
            return tail.strip()
        if ":" in ln:
            _, tail = ln.split(":", 1)
            return tail.strip()
        return ln

    def _normalize_frame_prompt_key(self, prompt: Any) -> str:
        """Normalize a shot prompt for de-duplication in start-frame generation (planning side)."""
        s = _as_text(prompt)
        if not s:
            return ""
        s = s.lower()
        s = re.sub(r"\bno[-_ ]?text\b", "", s)
        s = re.sub(r"\[element_[a-z0-9_\-]+\]", "[element]", s, flags=re.IGNORECASE)
        s = re.sub(r"[\"“”‘’]", "", s)
        s = re.sub(r"[，,。.!?;；:：、]+", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s

    def _compact_frame_hint_text(self, text: Any, max_len: int = 60) -> str:
        """Compact text into a short, model-friendly hint to reduce duplicated frames."""
        s = _as_text(text).replace("\r", " ").replace("\n", " ").strip()
        if not s:
            return ""
        s = s.strip(" \"“”'‘’")
        s = re.sub(r"^(?:旁白同步|旁白|narration|voiceover)\s*[:：]\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\[Element_[A-Za-z0-9_\-]+\]", "", s)
        # Avoid leading punctuation like "：：我..." after removing element refs / prefixes.
        s = s.lstrip(" :：，,;；-—").strip()
        s = re.sub(r"\s+", " ", s).strip()
        parts = re.split(r"[。！？.!?]", s, maxsplit=1)
        if parts and parts[0].strip():
            s = parts[0].strip()
        if len(s) > max_len:
            s = s[:max_len].rstrip(" ,，。.!?;；:：-")
        return s

    def _build_frame_prompt_hint(self, shot: Dict[str, Any], max_len: int = 60) -> str:
        if not isinstance(shot, dict):
            return ""
        hint_parts: List[str] = []
        name = _as_text(shot.get("name")).strip()
        if name:
            hint_parts.append(name)
        narration_hint = self._compact_frame_hint_text(shot.get("narration"), max_len=max_len)
        if narration_hint:
            hint_parts.append(narration_hint)
        if not narration_hint:
            desc_hint = self._compact_frame_hint_text(shot.get("description"), max_len=max_len)
            if desc_hint:
                hint_parts.append(desc_hint)
        return "；".join([p for p in hint_parts if p])

    def _split_shot_by_audio(self, shot: Dict[str, Any], speed_ratio: float, max_shot_seconds: float) -> List[Dict[str, Any]]:
        narration = _as_text(shot.get("narration")).strip()
        dialogue_script = _as_text(shot.get("dialogue_script")).strip()

        chunks: List[Dict[str, str]] = []
        for sent in _split_narration_sentences(narration):
            if sent.strip():
                chunks.append({"role": "narration", "text": sent.strip()})
        if dialogue_script:
            for raw_line in dialogue_script.splitlines():
                line = raw_line.strip()
                if not line:
                    continue
                # Keep the original "角色: 台词" format, but split overly long lines.
                for sub in _split_dialogue_line(line):
                    if sub.strip():
                        chunks.append({"role": "dialogue", "text": sub.strip()})

        # No audio content: just clamp duration to a sane range.
        if not chunks:
            out = dict(shot)
            d = self._coerce_duration_seconds(out.get("duration"), default=5.0)
            d = _clamp(d, 2.0, float(max_shot_seconds))
            out["duration"] = str(_ceil_to_half(d) or 2.0)
            return [out]

        soft_limit = max(1.5, float(max_shot_seconds) - 0.6)
        groups: List[List[Dict[str, str]]] = []
        cur: List[Dict[str, str]] = []
        cur_dur = 0.0

        def chunk_seconds(c: Dict[str, str]) -> float:
            role = c.get("role") or "dialogue"
            t = c.get("text") or ""
            utter = t if role == "narration" else self._dialogue_line_utterance(t)
            return _estimate_speech_seconds(utter, speed=speed_ratio)

        for c in chunks:
            dur = chunk_seconds(c)
            # If a single chunk is too long, further hard-wrap by chars (narration) or split dialogue more.
            if dur > soft_limit + 0.2 and c.get("role") == "narration":
                t = c.get("text") or ""
                # hard wrap by characters (roughly 4 chars/sec)
                max_chars = max(8, int(soft_limit * 4.0))
                pieces = _smart_split_text(
                    t,
                    max_chars=max_chars,
                    boundaries="，,；;、。！？.!?…—",
                    min_good_ratio=0.6,
                    min_tail_ratio=0.35,
                )
                for piece in pieces:
                    d2 = _estimate_speech_seconds(piece, speed=speed_ratio)
                    if cur and cur_dur + d2 > soft_limit:
                        groups.append(cur)
                        cur = []
                        cur_dur = 0.0
                    cur.append({"role": "narration", "text": piece})
                    cur_dur += d2
                continue

            if cur and cur_dur + dur > soft_limit:
                groups.append(cur)
                cur = []
                cur_dur = 0.0
            cur.append(c)
            cur_dur += dur

        if cur:
            groups.append(cur)

        orig_id = _as_text(shot.get("id")).strip() or "Shot_1"
        orig_name = _as_text(shot.get("name")).strip() or orig_id

        out_shots: List[Dict[str, Any]] = []
        total_parts = len(groups)
        for idx, g in enumerate(groups):
            narr_parts: List[str] = []
            dlg_lines: List[str] = []
            g_dur = 0.0
            for c in g:
                role = c.get("role") or "dialogue"
                t = (c.get("text") or "").strip()
                if not t:
                    continue
                if role == "narration":
                    narr_parts.append(t)
                else:
                    dlg_lines.append(t)
                g_dur += chunk_seconds(c)

            dur_s = _ceil_to_half(max(2.0, min(float(max_shot_seconds), g_dur + 0.4))) or 2.0
            ns = dict(shot)
            if idx == 0:
                ns["id"] = orig_id
                ns["name"] = orig_name if total_parts == 1 else f"{orig_name}（1/{total_parts}）"
            else:
                ns["id"] = f"{orig_id}_P{idx+1}"
                ns["name"] = f"{orig_name}（{idx+1}/{total_parts}）"
            ns["duration"] = str(dur_s)
            ns["narration"] = "".join(narr_parts).strip()
            ns["dialogue_script"] = "\n".join(dlg_lines).strip()

            # If we split one shot into multiple parts, strengthen visual differentiation signals
            # (prompt/video_prompt/description) so parts don't collapse to the same start frame.
            if total_parts > 1:
                hint_src = ns.get("narration") or ns.get("dialogue_script") or ns.get("description") or ns.get("name")
                hint_txt = self._compact_frame_hint_text(hint_src, max_len=48)

                if idx == 0:
                    composition_tag = "建立场景（远景/全景）"
                elif idx == 1:
                    composition_tag = "人物动作推进（中景）"
                elif idx == 2:
                    composition_tag = "情绪与关键细节（特写）"
                else:
                    composition_tag = "道具/环境细节插入（插入镜头/特写）"

                if hint_txt:
                    visual_hint = f"镜头要点（{idx+1}/{total_parts}）：{composition_tag}；{hint_txt}"
                else:
                    visual_hint = f"镜头要点（{idx+1}/{total_parts}）：{composition_tag}"

                def inject_hint(prompt: Any) -> str:
                    base = _as_text(prompt).strip()
                    if not base:
                        return ""
                    if visual_hint in base:
                        return base
                    m = re.search(r"\bno[-_ ]?text\b", base, flags=re.IGNORECASE)
                    if m:
                        before = base[:m.start()].rstrip(" ,，;；")
                        after = base[m.start():].lstrip()
                        sep = "；" if before else ""
                        return f"{before}{sep}{visual_hint}，{after}".strip()
                    return f"{base}；{visual_hint}".strip()

                if _as_text(ns.get("prompt")).strip():
                    ns["prompt"] = inject_hint(ns.get("prompt"))

                # Also differentiate video prompt and description for readability and downstream generation.
                vp0 = _as_text(ns.get("video_prompt")).strip()
                if vp0:
                    focus_txt = hint_txt or composition_tag
                    suffix = f"本段重点：{focus_txt}"
                    if suffix not in vp0:
                        if vp0.endswith(("；", ";")):
                            ns["video_prompt"] = f"{vp0}{suffix}"
                        else:
                            ns["video_prompt"] = f"{vp0}；{suffix}"

                desc0 = _as_text(ns.get("description")).strip()
                if desc0:
                    short_txt = self._compact_frame_hint_text(hint_src, max_len=24)
                    if short_txt:
                        tail = f"（{idx+1}/{total_parts}：{short_txt}）"
                        if tail not in desc0:
                            ns["description"] = f"{desc0}{tail}"

                # Defensive: do not inherit existing media assets for new split parts.
                if idx > 0:
                    for k in (
                        "start_image_url",
                        "cached_start_image_url",
                        "start_image_history",
                        "video_url",
                        "cached_video_url",
                        "video_source_url",
                        "video_task_id",
                        "voice_audio_url",
                        "voice_audio_duration_ms",
                        "narration_audio_url",
                        "narration_audio_duration_ms",
                        "dialogue_audio_url",
                        "dialogue_audio_duration_ms",
                    ):
                        ns.pop(k, None)
                    ns["status"] = "pending"
            out_shots.append(ns)

        return out_shots

    def _split_plan_shots_by_audio(self, plan: Dict[str, Any], speed_ratio: float, max_shot_seconds: float = 6.0) -> None:
        segs = plan.get("segments") or []
        if not isinstance(segs, list):
            return
        for seg in segs:
            if not isinstance(seg, dict):
                continue
            shots = seg.get("shots") or []
            if not isinstance(shots, list):
                continue
            next_shots: List[Dict[str, Any]] = []
            used_ids: set = set()
            for shot in shots:
                if not isinstance(shot, dict):
                    continue
                # clamp declared duration first (avoid pathological values)
                declared = self._coerce_duration_seconds(shot.get("duration"), default=5.0)
                shot["duration"] = str(_ceil_to_half(_clamp(declared, 2.0, max_shot_seconds)) or 2.0)

                for ns in self._split_shot_by_audio(shot, speed_ratio=speed_ratio, max_shot_seconds=max_shot_seconds):
                    sid = _as_text(ns.get("id")).strip()
                    if not sid:
                        sid = f"Shot_{uuid.uuid4().hex[:8].upper()}"
                        ns["id"] = sid
                    # ensure unique within the segment
                    base = sid
                    k = 2
                    while sid in used_ids:
                        sid = f"{base}_{k}"
                        k += 1
                    ns["id"] = sid
                    used_ids.add(sid)
                    next_shots.append(ns)
            seg["shots"] = next_shots

    def _dedupe_plan_start_frame_prompts(self, plan: Dict[str, Any]) -> None:
        """Reduce duplicated start-frame prompts by appending per-shot hints.

        This helps when audio-driven splitting (or LLM output) produces many shots with identical `prompt`,
        causing repeated start frames even if narration differs.
        """
        if not isinstance(plan, dict):
            return
        segs = plan.get("segments") or []
        if not isinstance(segs, list):
            return

        shots: List[Dict[str, Any]] = []
        for seg in segs:
            if not isinstance(seg, dict):
                continue
            for shot in seg.get("shots") or []:
                if isinstance(shot, dict):
                    shots.append(shot)

        if not shots:
            return

        key_counts: Dict[str, int] = {}
        for s in shots:
            k = self._normalize_frame_prompt_key(s.get("prompt"))
            if k:
                key_counts[k] = key_counts.get(k, 0) + 1

        dup_keys = {k for k, c in key_counts.items() if c > 1}
        if not dup_keys:
            return

        def inject(prompt: str, hint: str) -> str:
            base = (prompt or "").strip()
            if not base or not hint:
                return base
            if hint in base:
                return base
            m = re.search(r"\bno[-_ ]?text\b", base, flags=re.IGNORECASE)
            if m:
                before = base[:m.start()].rstrip(" ,，;；")
                after = base[m.start():].lstrip()
                sep = "；" if before else ""
                return f"{before}{sep}{hint}，{after}".strip()
            return f"{base}；{hint}".strip()

        for s in shots:
            k = self._normalize_frame_prompt_key(s.get("prompt"))
            if not k or k not in dup_keys:
                continue
            prompt = _as_text(s.get("prompt")).strip()
            if not prompt:
                continue
            hint = self._build_frame_prompt_hint(s, max_len=60)
            if not hint:
                continue
            s["prompt"] = inject(prompt, hint)

    def _postprocess_audio_driven_plan(self, plan: Dict[str, Any], user_request: str) -> Dict[str, Any]:
        if not isinstance(plan, dict):
            return plan
        brief = plan.get("creative_brief")
        if not isinstance(brief, dict):
            brief = {}
            plan["creative_brief"] = brief

        target_seconds = self._find_target_duration_seconds(user_request, brief.get("targetDurationSeconds"))
        speed_ratio = 1.0
        if target_seconds:
            speed_ratio = self._pick_speed_ratio_for_target(plan, target_seconds, max_shot_seconds=6.0)
            brief["targetDurationSeconds"] = str(int(round(target_seconds)))
            brief["ttsSpeedRatio"] = f"{float(speed_ratio):.2f}"

        # Audio-driven constraint: keep shot durations <= 6s by splitting long speech.
        self._split_plan_shots_by_audio(plan, speed_ratio=float(speed_ratio), max_shot_seconds=6.0)

        # If we have a target and are shorter, try to distribute slack by extending shots up to 6s.
        if target_seconds:
            self._distribute_duration_slack(plan, target_seconds=float(target_seconds), max_shot_seconds=6.0)

        # After splitting, de-duplicate start-frame prompts to reduce repeated frames.
        self._dedupe_plan_start_frame_prompts(plan)
        return plan
    
    async def script_doctor(self, project: Dict[str, Any], mode: str = "expand") -> Dict[str, Any]:
        """Enhance storyboard/script quality (hook/climax/logic) without breaking IDs."""
        if not self._ensure_client():
            return {"success": False, "error": "未配置 LLM API Key"}

        snapshot = self._project_snapshot(project)
        prompt = self._format_prompt_safe(
            self._get_prompt("agent.script_doctor_prompt", DEFAULT_SCRIPT_DOCTOR_PROMPT),
            project_json=json.dumps(snapshot, ensure_ascii=False, indent=2),
            mode=mode or "expand",
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.6,
                max_tokens=6000,
            )
            reply = response.choices[0].message.content or ""
            data = self._extract_json_from_reply(reply)
            if not isinstance(data, dict):
                return {"success": False, "error": "无法解析 Script Doctor 输出", "raw": reply}

            segments_patch = data.get("segments_patch") or []
            creative_brief_patch = data.get("creative_brief_patch") or {}
            add_shots = data.get("add_shots") or []

            next_segments = self._apply_segments_patch(project.get("segments") or [], segments_patch)
            if (mode or "") == "expand":
                next_segments = self._insert_shots(next_segments, add_shots)

            next_brief = dict(project.get("creative_brief") or {})
            if isinstance(creative_brief_patch, dict):
                next_brief.setdefault("script_doctor", {})
                if isinstance(next_brief.get("script_doctor"), dict):
                    next_brief["script_doctor"].update(creative_brief_patch)
                for k in ("hook", "climax", "logline", "series_bible_hint"):
                    v = creative_brief_patch.get(k)
                    if isinstance(v, str) and v.strip():
                        next_brief[k] = v.strip()

            return {
                "success": True,
                "updates": {"creative_brief": next_brief, "segments": next_segments},
                "patch": data,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def complete_assets(self, project: Dict[str, Any]) -> Dict[str, Any]:
        """Extract missing scene/prop elements and optionally patch shot prompts."""
        if not self._ensure_client():
            return {"success": False, "error": "未配置 LLM API Key"}

        snapshot = self._project_snapshot(project)
        prompt = self._format_prompt_safe(
            self._get_prompt("agent.asset_completion_prompt", DEFAULT_ASSET_COMPLETION_PROMPT),
            project_json=json.dumps(snapshot, ensure_ascii=False, indent=2),
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
                max_tokens=5000,
            )
            reply = response.choices[0].message.content or ""
            data = self._extract_json_from_reply(reply)
            if not isinstance(data, dict):
                return {"success": False, "error": "无法解析资产补全输出", "raw": reply}

            new_elements = data.get("new_elements") or []
            shot_patch = data.get("shot_patch") or []

            elements = dict(project.get("elements") or {})
            existing_ids = set(elements.keys())

            def safe_element_id(raw_id: Any, name: str, typ: str) -> str:
                base = raw_id if isinstance(raw_id, str) else ""
                base = base.strip()
                if not base or not re.match(r"^Element_[A-Za-z0-9_]+$", base):
                    slug = re.sub(r"[^A-Za-z0-9_]+", "_", (name or "").strip().upper())[:32] or typ.upper()
                    base = f"Element_{slug}"
                cand = base
                i = 2
                while cand in existing_ids:
                    cand = f"{base}_{i}"
                    i += 1
                existing_ids.add(cand)
                return cand

            added = []
            if isinstance(new_elements, list):
                for e in new_elements:
                    if not isinstance(e, dict):
                        continue
                    typ = e.get("type")
                    if typ not in ("scene", "object"):
                        continue
                    name = e.get("name")
                    desc = e.get("description")
                    if not isinstance(name, str) or not name.strip() or not isinstance(desc, str) or not desc.strip():
                        continue
                    eid = safe_element_id(e.get("id"), name, typ)
                    element = {
                        "id": eid,
                        "name": name.strip(),
                        "type": typ,
                        "description": desc.strip(),
                        "created_at": datetime.utcnow().isoformat() + "Z",
                    }
                    elements[eid] = element
                    added.append(element)

            segments = project.get("segments") or []
            if isinstance(segments, list) and isinstance(shot_patch, list):
                patch_map = {p.get("id"): p for p in shot_patch if isinstance(p, dict) and isinstance(p.get("id"), str)}
                for seg in segments:
                    if not isinstance(seg, dict):
                        continue
                    for shot in (seg.get("shots") or []):
                        if not isinstance(shot, dict):
                            continue
                        sp = patch_map.get(shot.get("id"))
                        if not sp:
                            continue
                        for key in ("description", "prompt", "video_prompt"):
                            val = sp.get(key)
                            if isinstance(val, str) and val.strip():
                                shot[key] = val

            return {
                "success": True,
                "updates": {"elements": elements, "segments": segments},
                "added_elements": added,
                "raw": data,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def refine_split_visuals(self, project: Dict[str, Any], parent_shot_id: str) -> Dict[str, Any]:
        """Refine visuals for a split-shot group (parent + _P parts) with ONE LLM call.

        - Must not change shot IDs.
        - Only updates: description/prompt/video_prompt
        """
        if not self._ensure_client():
            return {"success": False, "error": "未配置 LLM API Key"}
        parent = _as_text(parent_shot_id).strip()
        if not parent:
            return {"success": False, "error": "parentShotId 不能为空"}

        segments = project.get("segments") or []
        if not isinstance(segments, list):
            return {"success": False, "error": "项目 segments 结构无效"}

        pat = re.compile(rf"^{re.escape(parent)}(?:_P\\d+)?$")
        target_seg_index: Optional[int] = None
        target_shots: List[Dict[str, Any]] = []

        for i, seg in enumerate(segments):
            if not isinstance(seg, dict):
                continue
            shots = seg.get("shots") or []
            if not isinstance(shots, list):
                continue
            has_parent = any(isinstance(s, dict) and _as_text(s.get("id")).strip() == parent for s in shots)
            if not has_parent:
                continue
            target_seg_index = i
            for s in shots:
                sid = _as_text(s.get("id")).strip() if isinstance(s, dict) else ""
                if sid and pat.match(sid) and isinstance(s, dict):
                    target_shots.append(s)
            break

        if target_seg_index is None:
            return {"success": False, "error": "未找到 parentShotId 对应的镜头"}
        if not target_shots:
            return {"success": False, "error": "未找到可精修的拆分镜头组"}

        # Gather only referenced elements for consistency context.
        elements = project.get("elements") if isinstance(project.get("elements"), dict) else {}
        referenced_ids: List[str] = []
        for s in target_shots:
            blob = " ".join([
                _as_text(s.get("prompt")),
                _as_text(s.get("video_prompt")),
                _as_text(s.get("description")),
            ])
            for m in re.finditer(r"\[Element_([A-Za-z0-9_\\-]+)\\]", blob):
                referenced_ids.append(f"Element_{m.group(1)}")
        referenced_ids = list(dict.fromkeys([rid for rid in referenced_ids if rid]))

        elements_out: List[Dict[str, Any]] = []
        for eid in referenced_ids:
            elem = elements.get(eid)
            if isinstance(elem, dict):
                elements_out.append({
                    "id": _as_text(elem.get("id")).strip() or eid,
                    "name": _as_text(elem.get("name")).strip(),
                    "type": _as_text(elem.get("type")).strip(),
                    "description": _as_text(elem.get("description")).strip(),
                })

        shots_out: List[Dict[str, Any]] = []
        for s in target_shots:
            shots_out.append({
                "shot_id": _as_text(s.get("id")).strip(),
                "name": _as_text(s.get("name")).strip(),
                "type": _as_text(s.get("type")).strip(),
                "duration": s.get("duration"),
                "narration": _as_text(s.get("narration")).strip(),
                "dialogue_script": _as_text(s.get("dialogue_script")).strip(),
                "description": _as_text(s.get("description")).strip(),
                "prompt": _as_text(s.get("prompt")).strip(),
                "video_prompt": _as_text(s.get("video_prompt")).strip(),
            })

        brief = project.get("creative_brief") if isinstance(project.get("creative_brief"), dict) else {}
        visual_style = _as_text(brief.get("visualStyle") or brief.get("visual_style")).strip() or "吉卜力动画风格"

        prompt = self._format_prompt_safe(
            self._get_prompt("agent.refine_split_visuals_prompt", REFINE_SPLIT_VISUALS_PROMPT_TEMPLATE),
            visual_style=visual_style,
            elements_json=json.dumps(elements_out, ensure_ascii=False, indent=2),
            shots_json=json.dumps(shots_out, ensure_ascii=False, indent=2),
        )

        try:
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": self._get_prompt("agent.system_prompt", DEFAULT_AGENT_SYSTEM_PROMPT)},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.4,
                max_tokens=3500,
            )
            reply = response.choices[0].message.content or ""
            data = self._extract_json_from_reply(reply)

            items: List[Dict[str, Any]] = []
            if isinstance(data, dict) and isinstance(data.get("shots"), list):
                items = [x for x in data.get("shots") if isinstance(x, dict)]
            elif isinstance(data, list):
                items = [x for x in data if isinstance(x, dict)]
            elif isinstance(data, dict):
                # mapping form: { "Shot_XXX": { ... }, ... }
                for k, v in data.items():
                    if isinstance(k, str) and isinstance(v, dict):
                        items.append({"shot_id": k, **v})

            if not items:
                return {"success": False, "error": "无法解析精修输出", "raw": reply}

            allowed_ids = {s.get("id") for s in target_shots if isinstance(s, dict) and isinstance(s.get("id"), str)}
            patch_by_id: Dict[str, Dict[str, str]] = {}
            for it in items:
                sid = _as_text(it.get("shot_id") or it.get("id")).strip()
                if not sid or sid not in allowed_ids:
                    continue
                patch: Dict[str, str] = {}
                for key in ("description", "prompt", "video_prompt", "videoPrompt"):
                    val = it.get(key)
                    if isinstance(val, str) and val.strip():
                        norm_key = "video_prompt" if key == "videoPrompt" else key
                        patch[norm_key] = val.strip()
                if patch:
                    patch_by_id[sid] = patch

            if not patch_by_id:
                return {"success": False, "error": "精修输出不包含任何可应用的镜头字段", "raw": reply}

            next_segments = copy.deepcopy(segments)
            target_seg = next_segments[target_seg_index] if 0 <= int(target_seg_index) < len(next_segments) else None
            if isinstance(target_seg, dict):
                for shot in (target_seg.get("shots") or []):
                    if not isinstance(shot, dict):
                        continue
                    sid = shot.get("id")
                    if isinstance(sid, str) and sid in patch_by_id:
                        shot.update(patch_by_id[sid])

            return {
                "success": True,
                "updates": {"segments": next_segments},
                "raw": data,
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def generate_element_prompt(
        self,
        element_name: str,
        element_type: str,
        base_description: str,
        visual_style: str = "吉卜力动画风格"
    ) -> Dict[str, Any]:
        """生成元素的图像提示词"""
        if not self._ensure_client():
            return {"error": "未配置 LLM API Key"}
        
        try:
            prompt = ELEMENT_PROMPT_TEMPLATE.format(
                element_name=element_name,
                element_type=element_type,
                base_description=base_description,
                visual_style=visual_style
            )
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一位专业的 AI 图像提示词工程师。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            reply = response.choices[0].message.content or ""
            
            result = self._extract_json_from_reply(reply)
            if isinstance(result, dict):
                return {"success": True, **result}
            
            return {"success": False, "error": "无法解析提示词", "raw": reply}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def generate_shot_prompt(
        self,
        shot_name: str,
        shot_type: str,
        shot_description: str,
        elements: List[str],
        visual_style: str,
        narration: str
    ) -> Dict[str, Any]:
        """生成镜头的视频提示词"""
        if not self._ensure_client():
            return {"error": "未配置 LLM API Key"}
        
        try:
            shot_type_info = SHOT_TYPES.get(shot_type, SHOT_TYPES["standard"])
            
            prompt = SHOT_PROMPT_TEMPLATE.format(
                shot_name=shot_name,
                shot_type=f"{shot_type_info['name']} ({shot_type_info['duration']})",
                shot_description=shot_description,
                elements=", ".join(elements),
                visual_style=visual_style,
                narration=narration
            )
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一位专业的 AI 视频提示词工程师。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            reply = response.choices[0].message.content or ""
            
            result = self._extract_json_from_reply(reply)
            if isinstance(result, dict):
                return {"success": True, **result}
            
            return {"success": False, "error": "无法解析提示词", "raw": reply}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _parse_response(self, reply: str) -> Dict[str, Any]:
        """解析 LLM 响应"""
        data = self._extract_json_from_reply(reply)
        if data is not None:
            return {"type": "structured", "data": data, "content": reply}

        return {"type": "text", "content": reply}
    
    def build_shot_prompt(
        self,
        shot_type: str,
        description: str,
        elements: List[str],
        narration: str,
        style: str = "cinematic"
    ) -> str:
        """构建完整的镜头提示词"""
        shot_info = SHOT_TYPES.get(shot_type, SHOT_TYPES["standard"])
        
        # 替换元素引用
        prompt_parts = [
            f"{shot_info['name']} ({shot_info['duration']})",
            description
        ]
        
        # 添加旁白对齐
        if narration:
            prompt_parts.append(f"对齐旁白：'{narration}'")
        
        return " ".join(prompt_parts)
    
    def resolve_element_references(
        self,
        prompt: str,
        elements: Dict[str, Dict]
    ) -> str:
        """解析提示词中的元素引用，替换为实际描述"""
        def replace_element(match):
            element_id = match.group(1)
            if element_id in elements:
                return elements[element_id].get("description", element_id)
            return match.group(0)
        
        return re.sub(r'\[Element_(\w+)\]', replace_element, prompt)

    # ==================== Operator/Worker (apply edits) ====================

    def _unwrap_structured_payload(self, value: Any) -> Optional[Dict[str, Any]]:
        if not isinstance(value, dict):
            return None
        obj: Dict[str, Any] = value
        for key in ("data", "result", "plan", "patch", "updates"):
            inner = obj.get(key)
            if isinstance(inner, dict):
                obj = inner
        return obj

    def _find_shot_mut(self, project: AgentProject, shot_id: str) -> Optional[Dict[str, Any]]:
        if not isinstance(project.segments, list):
            return None
        for seg in project.segments:
            if not isinstance(seg, dict):
                continue
            for shot in (seg.get("shots") or []):
                if isinstance(shot, dict) and shot.get("id") == shot_id:
                    return shot
        return None

    def _normalize_operator_actions_for_apply(
        self,
        actions: Any,
        project_data: Dict[str, Any],
    ) -> Optional[List[Dict[str, Any]]]:
        """Validate/sanitize actions for backend execution (post-confirm).

        This is stricter than "chat-time" parsing and does NOT rely on user text.
        """
        if not isinstance(actions, list):
            return None

        ids = self._collect_project_ids(project_data)
        shot_ids = ids["shot_ids"]
        element_ids = ids["element_ids"]

        max_text_len = 8000
        normalized: List[Dict[str, Any]] = []

        def take_str(val: Any) -> Optional[str]:
            if isinstance(val, str) and val.strip():
                s = val.strip()
                if len(s) > max_text_len:
                    return None
                return s
            return None

        for a in actions:
            if not isinstance(a, dict):
                return None
            t = a.get("type")

            if t == "update_shot":
                shot_id = a.get("shot_id")
                patch = a.get("patch")
                if not isinstance(shot_id, str) or shot_id not in shot_ids:
                    return None
                if not isinstance(patch, dict):
                    return None

                safe_patch: Dict[str, Any] = {}
                for key in ("prompt", "video_prompt", "description", "narration", "dialogue_script"):
                    val = take_str(patch.get(key))
                    if val:
                        safe_patch[key] = val

                # allow camelCase variants
                vp2 = take_str(patch.get("videoPrompt"))
                if vp2 and "video_prompt" not in safe_patch:
                    safe_patch["video_prompt"] = vp2
                dlg2 = take_str(patch.get("dialogueScript"))
                if dlg2 and "dialogue_script" not in safe_patch:
                    safe_patch["dialogue_script"] = dlg2

                dur = self._coerce_float(patch.get("duration"))
                if dur is not None:
                    if dur <= 0 or dur > 600:
                        return None
                    safe_patch["duration"] = dur

                if not safe_patch:
                    return None
                normalized.append({
                    "type": "update_shot",
                    "shot_id": shot_id,
                    "patch": safe_patch,
                    "reason": a.get("reason") if isinstance(a.get("reason"), str) else None,
                })

            elif t == "regenerate_shot_frame":
                shot_id = a.get("shot_id")
                if not isinstance(shot_id, str) or shot_id not in shot_ids:
                    return None
                normalized.append({
                    "type": "regenerate_shot_frame",
                    "shot_id": shot_id,
                    "visualStyle": a.get("visualStyle") if isinstance(a.get("visualStyle"), str) else None,
                })

            elif t == "update_element":
                element_id = a.get("element_id")
                patch = a.get("patch")
                if not isinstance(element_id, str) or element_id not in element_ids:
                    return None
                if not isinstance(patch, dict):
                    return None

                safe_patch: Dict[str, Any] = {}
                desc = take_str(patch.get("description"))
                if desc:
                    safe_patch["description"] = desc
                vp = take_str(patch.get("voice_profile") if "voice_profile" in patch else patch.get("voiceProfile"))
                if vp:
                    safe_patch["voice_profile"] = vp
                if not safe_patch:
                    return None

                normalized.append({
                    "type": "update_element",
                    "element_id": element_id,
                    "patch": safe_patch,
                    "reason": a.get("reason") if isinstance(a.get("reason"), str) else None,
                })

            elif t == "update_brief":
                patch = a.get("patch")
                if not isinstance(patch, dict):
                    return None

                safe_patch: Dict[str, Any] = {}
                # Canonicalize into frontend-friendly camelCase keys
                for key in (
                    "title",
                    "videoType",
                    "narrativeDriver",
                    "emotionalTone",
                    "visualStyle",
                    "duration",
                    "aspectRatio",
                    "language",
                    "narratorVoiceProfile",
                ):
                    val = take_str(patch.get(key))
                    if val:
                        safe_patch[key] = val

                # snake_case fallbacks
                mapping = {
                    "video_type": "videoType",
                    "narrative_driver": "narrativeDriver",
                    "emotional_tone": "emotionalTone",
                    "visual_style": "visualStyle",
                    "aspect_ratio": "aspectRatio",
                    "narrator_voice_profile": "narratorVoiceProfile",
                }
                for src, dst in mapping.items():
                    if dst in safe_patch:
                        continue
                    val = take_str(patch.get(src))
                    if val:
                        safe_patch[dst] = val

                if not safe_patch:
                    return None
                normalized.append({
                    "type": "update_brief",
                    "patch": safe_patch,
                    "reason": a.get("reason") if isinstance(a.get("reason"), str) else None,
                })

            else:
                return None

        if len(normalized) > 50:
            return None

        order = {"update_shot": 1, "update_element": 1, "update_brief": 1, "regenerate_shot_frame": 2}
        normalized.sort(key=lambda x: order.get(x.get("type"), 9))
        return normalized

    def _apply_operator_patch_inplace(self, project: AgentProject, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Best-effort merge patch into project (used by confirm/apply)."""
        root = self._unwrap_structured_payload(payload) or payload
        now = datetime.utcnow().isoformat() + "Z"

        def pick(obj: Dict[str, Any], *keys: str) -> Any:
            for k in keys:
                if k in obj:
                    return obj.get(k)
            return None

        def take_str(val: Any) -> Optional[str]:
            if isinstance(val, str) and val.strip():
                return val.strip()
            return None

        applied: Dict[str, Any] = {"kind": "patch", "updated": {"brief": False, "elements": 0, "shots": 0}}

        # ---- creative brief ----
        brief_raw = pick(root, "creative_brief", "creativeBrief", "Creative_Brief", "brief")
        if isinstance(brief_raw, dict):
            cb = project.creative_brief if isinstance(project.creative_brief, dict) else {}
            mapping = {
                "title": ("title", "Project_Name", "project_name", "name"),
                "videoType": ("videoType", "video_type", "Video_Type"),
                "narrativeDriver": ("narrativeDriver", "narrative_driver", "Narrative_Driver"),
                "emotionalTone": ("emotionalTone", "emotional_tone", "Emotional_Tone", "Core_Theme"),
                "visualStyle": ("visualStyle", "visual_style", "Visual_Style"),
                "duration": ("duration", "total_duration", "Total_Duration"),
                "aspectRatio": ("aspectRatio", "aspect_ratio", "Aspect_Ratio"),
                "language": ("language", "Language"),
                "narratorVoiceProfile": ("narratorVoiceProfile", "narrator_voice_profile", "Narrator_Voice_Profile"),
            }
            for dst, keys in mapping.items():
                for k in keys:
                    v = take_str(brief_raw.get(k))
                    if v:
                        cb[dst] = v
                        applied["updated"]["brief"] = True
                        if dst == "title":
                            project.name = v
                        break
            project.creative_brief = cb

        # ---- elements ----
        elements_raw = pick(
            root,
            "elements",
            "Key_Elements",
            "key_elements",
            "keyElements",
            "character_designs",
            "characterDesigns",
            "Character_Designs",
        )
        if isinstance(elements_raw, list):
            items = [x for x in elements_raw if isinstance(x, dict)]
            for item in items:
                eid = take_str(item.get("id"))
                if not eid:
                    continue
                cur = project.elements.get(eid) if isinstance(project.elements, dict) else None
                cur = cur if isinstance(cur, dict) else {"id": eid, "created_at": now}
                for key in ("name", "Element_Name"):
                    v = take_str(item.get(key))
                    if v:
                        cur["name"] = v
                        break
                for key in ("type", "Element_Type"):
                    v = take_str(item.get(key))
                    if v:
                        cur["type"] = v
                        break
                for key in ("description", "Description", "visual_description", "visualDescription"):
                    v = take_str(item.get(key))
                    if v is not None:
                        cur["description"] = v
                        break
                vp = take_str(item.get("voice_profile") if "voice_profile" in item else item.get("voiceProfile"))
                if vp:
                    cur["voice_profile"] = vp
                project.elements[eid] = cur
                applied["updated"]["elements"] += 1
        elif isinstance(elements_raw, dict):
            for k, v in elements_raw.items():
                if not isinstance(v, dict):
                    continue
                eid = take_str(v.get("id")) or (k if isinstance(k, str) and k else None)
                if not eid:
                    continue
                cur = project.elements.get(eid) if isinstance(project.elements, dict) else None
                cur = cur if isinstance(cur, dict) else {"id": eid, "created_at": now}
                name = take_str(v.get("name") or v.get("Element_Name"))
                if name:
                    cur["name"] = name
                typ = take_str(v.get("type") or v.get("Element_Type"))
                if typ:
                    cur["type"] = typ
                desc = take_str(v.get("description") or v.get("Description") or v.get("visual_description") or v.get("visualDescription"))
                if desc is not None:
                    cur["description"] = desc
                vp = take_str(v.get("voice_profile") if "voice_profile" in v else v.get("voiceProfile"))
                if vp:
                    cur["voice_profile"] = vp
                project.elements[eid] = cur
                applied["updated"]["elements"] += 1

        # ---- segments/shots (update existing, add if missing) ----
        segments_raw = pick(root, "segments", "Storyboard_With_Prompts", "storyboard_with_prompts", "storyboard", "Storyboard")
        segments_array: Optional[List[Any]] = None
        if isinstance(segments_raw, list):
            segments_array = segments_raw
        elif isinstance(segments_raw, dict) and isinstance(segments_raw.get("segments"), list):
            segments_array = segments_raw.get("segments")  # type: ignore[assignment]

        if isinstance(segments_array, list):
            def normalize_shot_id(raw_id: Any, idx: int) -> str:
                if isinstance(raw_id, str) and raw_id.strip():
                    rid = raw_id.strip()
                    if rid.startswith("Shot_"):
                        return rid
                    if rid.isdigit():
                        return f"Shot_{rid}"
                    slug = re.sub(r"[^A-Za-z0-9_]+", "_", rid).strip("_") or str(idx + 1)
                    return f"Shot_{slug}"
                if isinstance(raw_id, (int, float)):
                    return f"Shot_{int(raw_id)}"
                return f"Shot_{idx + 1}"

            # segment list format
            first = segments_array[0] if segments_array else None
            is_segment_list = isinstance(first, dict) and isinstance(first.get("shots"), list)

            if is_segment_list:
                # Merge by Segment ID; create if not exists.
                if not isinstance(project.segments, list):
                    project.segments = []
                seg_map = {s.get("id"): s for s in project.segments if isinstance(s, dict) and isinstance(s.get("id"), str)}

                for seg_item in segments_array:
                    if not isinstance(seg_item, dict):
                        continue
                    seg_id = take_str(seg_item.get("id")) or None
                    if not seg_id:
                        continue
                    seg_obj = seg_map.get(seg_id)
                    if not isinstance(seg_obj, dict):
                        seg_obj = {"id": seg_id, "name": seg_id, "description": "", "shots": [], "created_at": now}
                        project.segments.append(seg_obj)
                        seg_map[seg_id] = seg_obj

                    sname = take_str(seg_item.get("name"))
                    if sname:
                        seg_obj["name"] = sname
                    sdesc = take_str(seg_item.get("description"))
                    if sdesc is not None:
                        seg_obj["description"] = sdesc

                    shots_patch = seg_item.get("shots") or []
                    if not isinstance(shots_patch, list):
                        continue
                    shot_map = {s.get("id"): s for s in (seg_obj.get("shots") or []) if isinstance(s, dict) and isinstance(s.get("id"), str)}
                    for idx, sp in enumerate(shots_patch):
                        if not isinstance(sp, dict):
                            continue
                        sid = take_str(sp.get("id")) or normalize_shot_id(sp.get("shot_id") or sp.get("shotId"), idx)
                        if not sid:
                            continue
                        shot_obj = shot_map.get(sid)
                        if not isinstance(shot_obj, dict):
                            shot_obj = {
                                "id": sid,
                                "name": sid,
                                "type": "standard",
                                "description": "",
                                "prompt": "",
                                "narration": "",
                                "duration": 5,
                                "status": "pending",
                                "created_at": now,
                            }
                            seg_obj["shots"] = list(seg_obj.get("shots") or []) + [shot_obj]
                            shot_map[sid] = shot_obj

                        for key, dst in (
                            ("name", "name"),
                            ("type", "type"),
                            ("description", "description"),
                            ("prompt", "prompt"),
                            ("video_prompt", "video_prompt"),
                            ("videoPrompt", "video_prompt"),
                            ("narration", "narration"),
                            ("dialogue_script", "dialogue_script"),
                            ("dialogueScript", "dialogue_script"),
                        ):
                            v = take_str(sp.get(key))
                            if v is not None and v != "":
                                shot_obj[dst] = v
                        dur = self._coerce_float(sp.get("duration") or sp.get("duration_seconds") or sp.get("durationSeconds"))
                        if dur is not None and dur > 0:
                            shot_obj["duration"] = dur
                        applied["updated"]["shots"] += 1
            else:
                # flat shot list format -> merge into Segment_1
                if not isinstance(project.segments, list):
                    project.segments = []
                target_seg = next((s for s in project.segments if isinstance(s, dict) and s.get("id") == "Segment_1"), None)
                if not isinstance(target_seg, dict):
                    target_seg = {"id": "Segment_1", "name": "Storyboard", "description": "", "shots": [], "created_at": now}
                    project.segments.append(target_seg)
                shots = target_seg.get("shots") or []
                if not isinstance(shots, list):
                    shots = []
                shot_map = {s.get("id"): s for s in shots if isinstance(s, dict) and isinstance(s.get("id"), str)}
                for idx, sp in enumerate(segments_array):
                    if not isinstance(sp, dict):
                        continue
                    sid = normalize_shot_id(sp.get("id") or sp.get("shot_id") or sp.get("shotId"), idx)
                    shot_obj = shot_map.get(sid)
                    if not isinstance(shot_obj, dict):
                        shot_obj = {"id": sid, "name": sid, "type": "standard", "description": "", "prompt": "", "narration": "", "duration": 5, "status": "pending", "created_at": now}
                        shots.append(shot_obj)
                        shot_map[sid] = shot_obj

                    for key, dst in (
                        ("name", "name"),
                        ("type", "type"),
                        ("description", "description"),
                        ("prompt", "prompt"),
                        ("image_prompt", "prompt"),
                        ("video_prompt", "video_prompt"),
                        ("videoPrompt", "video_prompt"),
                        ("narration", "narration"),
                        ("dialogue_script", "dialogue_script"),
                        ("dialogueScript", "dialogue_script"),
                    ):
                        v = take_str(sp.get(key))
                        if v is not None and v != "":
                            shot_obj[dst] = v
                    dur = self._coerce_float(sp.get("duration") or sp.get("duration_seconds") or sp.get("durationSeconds"))
                    if dur is not None and dur > 0:
                        shot_obj["duration"] = dur
                    applied["updated"]["shots"] += 1
                target_seg["shots"] = shots

        return applied

    async def apply_operator(
        self,
        project_data: Dict[str, Any],
        kind: str,
        payload: Any,
        executor: Any = None,
    ) -> Dict[str, Any]:
        """Apply a confirmed LLM patch/actions to the project (backend operator)."""
        if not isinstance(project_data, dict):
            return {"success": False, "error": "project_data must be a dict"}

        k = (kind or "").strip().lower()
        project = AgentProject.from_dict(project_data)

        try:
            if k == "actions":
                normalized = self._normalize_operator_actions_for_apply(payload, project_data)
                if not normalized:
                    return {"success": False, "error": "Invalid actions payload"}

                updated_shots: List[str] = []
                updated_elements: List[str] = []
                brief_changed = False
                regen_actions: List[Dict[str, Any]] = []

                for a in normalized:
                    t = a.get("type")
                    if t == "regenerate_shot_frame":
                        regen_actions.append(a)
                        continue

                    if t == "update_shot":
                        sid = a.get("shot_id")
                        if not isinstance(sid, str):
                            continue
                        shot = self._find_shot_mut(project, sid)
                        if not isinstance(shot, dict):
                            continue
                        patch_d = a.get("patch") if isinstance(a.get("patch"), dict) else {}
                        for key in ("prompt", "video_prompt", "description", "narration", "dialogue_script"):
                            v = patch_d.get(key)
                            if isinstance(v, str):
                                shot[key] = v
                        if "duration" in patch_d:
                            dur = self._coerce_float(patch_d.get("duration"))
                            if dur is not None and dur > 0:
                                shot["duration"] = dur
                        updated_shots.append(sid)

                    if t == "update_element":
                        eid = a.get("element_id")
                        if not isinstance(eid, str):
                            continue
                        elem = project.elements.get(eid) if isinstance(project.elements, dict) else None
                        if not isinstance(elem, dict):
                            continue
                        patch_d = a.get("patch") if isinstance(a.get("patch"), dict) else {}
                        for key in ("description", "voice_profile"):
                            v = patch_d.get(key)
                            if isinstance(v, str):
                                elem[key] = v
                        project.elements[eid] = elem
                        updated_elements.append(eid)

                    if t == "update_brief":
                        patch_d = a.get("patch") if isinstance(a.get("patch"), dict) else {}
                        cb = project.creative_brief if isinstance(project.creative_brief, dict) else {}
                        for key, val in patch_d.items():
                            if isinstance(val, str) and val.strip():
                                cb[key] = val.strip()
                                if key == "title":
                                    project.name = val.strip()
                        project.creative_brief = cb
                        brief_changed = True

                regen_results: List[Dict[str, Any]] = []
                if executor and regen_actions:
                    default_style = None
                    if isinstance(project.creative_brief, dict):
                        default_style = project.creative_brief.get("visualStyle") or project.creative_brief.get("visual_style")
                    for a in regen_actions:
                        sid = a.get("shot_id")
                        if not isinstance(sid, str):
                            continue
                        style = a.get("visualStyle") if isinstance(a.get("visualStyle"), str) and a.get("visualStyle") else default_style
                        try:
                            res = await executor.regenerate_single_frame(project, sid, visual_style=style or "cinematic")
                        except Exception as e:
                            res = {"success": False, "shot_id": sid, "error": str(e)}
                        regen_results.append(res)

                self.storage.save_agent_project(project.to_dict())

                ui_hints: Dict[str, Any] = {}
                if updated_shots or regen_actions:
                    ui_hints = {"activeModule": "storyboard", "focus": {"type": "shot", "id": (updated_shots or [regen_actions[0]["shot_id"]])[0]}}
                elif updated_elements:
                    ui_hints = {"activeModule": "elements", "focus": {"type": "element", "id": updated_elements[0]}}
                elif brief_changed:
                    ui_hints = {"expandCards": ["brief"]}

                return {
                    "success": True,
                    "project": project.to_dict(),
                    "applied": {
                        "kind": "actions",
                        "updated_shots": list(dict.fromkeys(updated_shots)),
                        "updated_elements": list(dict.fromkeys(updated_elements)),
                        "brief_changed": brief_changed,
                        "regenerated": len(regen_results),
                    },
                    "regen_results": regen_results,
                    "ui_hints": ui_hints,
                }

            if k == "patch":
                if not isinstance(payload, dict):
                    return {"success": False, "error": "Patch payload must be an object"}
                applied = self._apply_operator_patch_inplace(project, payload)
                self.storage.save_agent_project(project.to_dict())
                return {"success": True, "project": project.to_dict(), "applied": applied, "ui_hints": {"expandCards": ["brief", "storyboard"]}}

            return {"success": False, "error": f"Unsupported kind: {kind}"}
        except Exception as e:
            return {"success": False, "error": str(e)}




class AgentExecutor:
    """Agent 执行器 - 负责批量生成流程
    
    参照 Flova 的渐进式确认机制：
    1. 每个阶段完成后暂停等待用户确认
    2. 支持中断和恢复
    3. 实时进度回调
    """
    
    def __init__(
        self,
        agent_service: AgentService,
        image_service,  # ImageService
        video_service,  # VideoService
        storage: StorageService
    ):
        self.agent = agent_service
        self.image_service = image_service
        self.video_service = video_service
        self.storage = storage
        self._cancelled = False
    
    def cancel(self):
        """取消执行"""
        self._cancelled = True

    def resolve_audio_workflow(self, project: AgentProject) -> str:
        """Resolve the project's audio workflow mode and persist it into creative_brief.

        Returns:
          - "video_dialogue": video is expected to output dialogue/music audio; TTS generates narration only.
          - "tts_all": TTS generates both narration and dialogue; video must not speak.
        """
        resolved = "tts_all"
        brief = project.creative_brief if isinstance(project.creative_brief, dict) else {}

        pref_raw = brief.get("audioWorkflowPreference")
        pref = str(pref_raw or "auto").strip().lower() or "auto"
        if pref not in {"auto", "video_dialogue", "tts_all"}:
            pref = "auto"

        supported = brief.get("videoAudioSupported")
        if pref == "tts_all":
            resolved = "tts_all"
        elif pref == "video_dialogue":
            resolved = "video_dialogue"
        else:
            if supported is True:
                resolved = "video_dialogue"
            elif supported is False:
                resolved = "tts_all"
            else:
                # Heuristic: only Volcengine Ark supports the `generate_audio` flag in our current integration.
                try:
                    provider = str(getattr(self.video_service, "provider", "") or "").strip().lower()
                    base_url = str(getattr(self.video_service, "base_url", "") or getattr(self.video_service, "baseUrl", "") or "").strip().lower()
                    if provider.startswith("custom") and ("volces.com" in base_url or "ark.cn" in base_url):
                        resolved = "video_dialogue"
                except Exception:
                    resolved = "tts_all"

        if isinstance(project.creative_brief, dict):
            project.creative_brief.setdefault("audioWorkflowPreference", pref)
            project.creative_brief["audioWorkflowResolved"] = resolved

        return resolved

    def record_video_audio_support(self, project: AgentProject, *, audio_disabled: Optional[bool]) -> None:
        """Record whether the current video provider/model supports generating audio.

        - audio_disabled=False -> supported=True
        - audio_disabled=True  -> supported=False (unless previously confirmed True)
        """
        if audio_disabled is None:
            return
        if not isinstance(project.creative_brief, dict):
            return
        supported = not bool(audio_disabled)

        if supported:
            project.creative_brief["videoAudioSupported"] = True
        else:
            # If a model doesn't support generate_audio, we treat it as unsupported unless already confirmed supported.
            if project.creative_brief.get("videoAudioSupported") is not True:
                project.creative_brief["videoAudioSupported"] = False

        # Refresh resolved mode (for preference=auto cases).
        self.resolve_audio_workflow(project)

    def _ceil_to_half(self, seconds: Any) -> float:
        """Round up to 0.5s (used for voice-safe durations)."""
        try:
            s = float(seconds)
        except Exception:
            return 0.0
        if not math.isfinite(s) or s < 0:
            return 0.0
        return float(math.ceil(s * 2.0) / 2.0)

    def build_audio_timeline_from_project(
        self,
        project: AgentProject,
        shot_durations_override: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """Build a draft audio_timeline from current project segments/shots (no re-segmentation).

        Rules:
        - Keep existing shot order and shot IDs.
        - Duration is at least max(2s, voice_duration, estimated_voice_duration).
        - Durations are rounded up to 0.5s for stability.
        """
        overrides = shot_durations_override if isinstance(shot_durations_override, dict) else {}

        segments_out: List[Dict[str, Any]] = []
        t = 0.0

        segments = project.segments if isinstance(project.segments, list) else []
        for seg_index, seg in enumerate(segments):
            if not isinstance(seg, dict):
                continue
            seg_id = seg.get("id") if isinstance(seg.get("id"), str) else f"Segment_{seg_index+1}"
            seg_name = seg.get("name") if isinstance(seg.get("name"), str) and seg.get("name").strip() else seg_id

            shots_out: List[Dict[str, Any]] = []
            shots = seg.get("shots") or []
            if not isinstance(shots, list):
                shots = []

            for shot_index, shot in enumerate(shots):
                if not isinstance(shot, dict):
                    continue
                shot_id = shot.get("id")
                if not isinstance(shot_id, str) or not shot_id.strip():
                    continue
                shot_name = shot.get("name") if isinstance(shot.get("name"), str) and shot.get("name").strip() else shot_id

                voice_ms = shot.get("voice_audio_duration_ms")
                voice_ms_i = int(voice_ms) if isinstance(voice_ms, (int, float)) else 0
                min_sec = float(voice_ms_i) / 1000.0 if voice_ms_i > 0 else 0.0

                if min_sec <= 0.01:
                    # Fallback estimate based on script text.
                    narration = shot.get("narration") if isinstance(shot.get("narration"), str) else ""
                    dialogue = shot.get("dialogue_script") if isinstance(shot.get("dialogue_script"), str) else ""
                    text = " ".join([p for p in [narration.strip(), dialogue.strip()] if p])
                    min_sec = _estimate_speech_seconds(text, speed=1.0)

                raw_override = overrides.get(shot_id) if isinstance(overrides, dict) else None
                raw_dur = raw_override if raw_override is not None else shot.get("duration", 5.0)
                try:
                    dur = float(raw_dur)
                except Exception:
                    dur = 5.0

                dur = max(2.0, dur, float(min_sec or 0.0))
                dur = self._ceil_to_half(dur)

                start = t
                end = t + dur
                t = end

                shots_out.append({
                    "shot_id": shot_id,
                    "shot_name": shot_name,
                    "timecode_start": round(start, 3),
                    "timecode_end": round(end, 3),
                    "duration": float(dur),
                    "voice_audio_url": shot.get("voice_audio_url") if isinstance(shot.get("voice_audio_url"), str) else "",
                    "voice_duration_ms": int(voice_ms_i or 0),
                    "narration_audio_url": shot.get("narration_audio_url") if isinstance(shot.get("narration_audio_url"), str) else "",
                    "narration_duration_ms": int(shot.get("narration_audio_duration_ms") or 0) if isinstance(shot.get("narration_audio_duration_ms"), (int, float)) else 0,
                    "dialogue_audio_url": shot.get("dialogue_audio_url") if isinstance(shot.get("dialogue_audio_url"), str) else "",
                    "dialogue_duration_ms": int(shot.get("dialogue_audio_duration_ms") or 0) if isinstance(shot.get("dialogue_audio_duration_ms"), (int, float)) else 0,
                })

            segments_out.append({
                "segment_id": seg_id,
                "segment_name": seg_name,
                "shots": shots_out,
            })

        return {
            "version": "v1",
            "confirmed": False,
            "updated_at": datetime.utcnow().isoformat() + "Z",
            "master_audio_url": "",
            "total_duration": round(t, 3),
            "segments": segments_out,
        }

    def apply_audio_timeline_to_project(
        self,
        project: AgentProject,
        audio_timeline: Dict[str, Any],
        reset_videos: bool = True,
    ) -> None:
        """Apply timeline durations back to project shots (no shot count changes)."""
        if not isinstance(audio_timeline, dict):
            raise ValueError("audio_timeline must be an object")

        segs = audio_timeline.get("segments") or []
        if not isinstance(segs, list):
            raise ValueError("audio_timeline.segments must be a list")

        timeline_ids: List[str] = []
        timeline_durations: Dict[str, float] = {}

        for seg in segs:
            if not isinstance(seg, dict):
                continue
            shots = seg.get("shots") or []
            if not isinstance(shots, list):
                continue
            for s in shots:
                if not isinstance(s, dict):
                    continue
                sid = s.get("shot_id")
                if not isinstance(sid, str) or not sid.strip():
                    continue
                if sid in timeline_durations:
                    raise ValueError(f"duplicate shot_id in audio_timeline: {sid}")
                try:
                    dur = float(s.get("duration", 0.0))
                except Exception:
                    dur = 0.0
                timeline_ids.append(sid)
                timeline_durations[sid] = self._ceil_to_half(max(2.0, dur))

        project_ids: List[str] = []
        segments = project.segments if isinstance(project.segments, list) else []
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            for shot in (seg.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                sid = shot.get("id")
                if isinstance(sid, str) and sid.strip():
                    project_ids.append(sid)

        if len(project_ids) != len(timeline_ids) or set(project_ids) != set(timeline_ids):
            raise ValueError("audio_timeline shot_id set must match project shots (no re-segmentation allowed)")

        for seg in segments:
            if not isinstance(seg, dict):
                continue
            for shot in (seg.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                sid = shot.get("id")
                if not isinstance(sid, str) or sid not in timeline_durations:
                    continue

                try:
                    old = float(shot.get("duration", 5.0))
                except Exception:
                    old = 5.0
                new = float(timeline_durations[sid])

                shot["duration"] = new

                if reset_videos and abs(old - new) > 0.2:
                    shot.pop("video_url", None)
                    shot.pop("video_source_url", None)
                    shot.pop("cached_video_url", None)
                    shot.pop("video_task_id", None)
                    if shot.get("start_image_url"):
                        shot["status"] = "frame_ready"
                    else:
                        shot["status"] = "pending"

    async def execute_full_pipeline_v2(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        resolution: str = "720p",
        audio_timeline: Optional[Dict[str, Any]] = None,
        reset_videos: bool = False,
        on_stage_complete: Optional[Callable[[str, Dict], None]] = None,
        on_progress: Optional[Callable[[str, str, int, int, Dict], None]] = None,
    ) -> Dict[str, Any]:
        """执行完整的生成流程（可选 audio_timeline 约束）。"""
        tl = audio_timeline if isinstance(audio_timeline, dict) else (project.audio_timeline if isinstance(getattr(project, "audio_timeline", None), dict) else None)
        if isinstance(tl, dict) and tl.get("confirmed") is True:
            try:
                self.apply_audio_timeline_to_project(project, tl, reset_videos=reset_videos)
            except Exception as e:
                return {"success": False, "error": f"Invalid audio_timeline: {str(e)}"}

        # 复用原 pipeline 逻辑（不改 execute_full_pipeline）
        return await self.execute_full_pipeline(
            project,
            visual_style=visual_style,
            resolution=resolution,
            on_stage_complete=on_stage_complete,
            on_progress=on_progress,
        )

    def _is_stable_local_url(self, url: Any) -> bool:
        return isinstance(url, str) and (url.startswith("/api/uploads/") or url.startswith("data:"))

    def _is_probably_expired_signed_url(self, url: Any) -> bool:
        """Detect expiring signed URLs (Volc TOS / S3 style) without network calls."""
        if not isinstance(url, str) or not url.startswith("http"):
            return False
        try:
            parsed = urlparse(url)
            qs = parse_qs(parsed.query or "")

            # Volcengine TOS
            if "X-Tos-Date" in qs and "X-Tos-Expires" in qs:
                dt_raw = (qs.get("X-Tos-Date") or [""])[0]
                exp_raw = (qs.get("X-Tos-Expires") or ["0"])[0]
                if dt_raw and exp_raw:
                    start = datetime.strptime(dt_raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                    expires = int(exp_raw)
                    return datetime.now(timezone.utc) > start + timedelta(seconds=max(0, expires - 30))

            # AWS-style signed URL
            if "X-Amz-Date" in qs and "X-Amz-Expires" in qs:
                dt_raw = (qs.get("X-Amz-Date") or [""])[0]
                exp_raw = (qs.get("X-Amz-Expires") or ["0"])[0]
                if dt_raw and exp_raw:
                    start = datetime.strptime(dt_raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                    expires = int(exp_raw)
                    return datetime.now(timezone.utc) > start + timedelta(seconds=max(0, expires - 30))

        except Exception:
            return False
        return False

    def _should_skip_existing_image(self, url: Any) -> bool:
        if not isinstance(url, str) or not url:
            return False
        if self._is_stable_local_url(url):
            return True
        if self._is_probably_expired_signed_url(url):
            return False
        # Unknown http URL: assume valid
        return True

    def _filter_reference_images(self, urls: Any, limit: int = 10) -> List[str]:
        """Filter out unusable reference images (e.g. expired signed URLs)."""
        if not isinstance(urls, list):
            return []

        filtered: List[str] = []
        for url in urls:
            if not isinstance(url, str):
                continue
            u = url.strip()
            if not u or u.startswith("data:"):
                continue
            if u.startswith("/api/uploads/"):
                filtered.append(u)
                continue
            if u.startswith("http") and not self._is_probably_expired_signed_url(u):
                filtered.append(u)

        dedup: List[str] = []
        for u in filtered:
            if u not in dedup:
                dedup.append(u)
        return dedup[: max(0, int(limit))]

    async def _cache_remote_to_uploads(self, url: Any, category: str, default_ext: str, max_bytes: Optional[int] = None) -> Any:
        """Download remote media to local /api/uploads for durability (best-effort).

        Safety:
        - Only http/https
        - Reject localhost/private IPs (basic SSRF mitigation)
        - Enforce a max download size (prevents OOM / disk abuse)
        """
        if not isinstance(url, str) or not url.startswith("http"):
            return url

        tmp_path = None
        try:
            parsed = urlparse(url)
            if parsed.scheme not in ("http", "https"):
                return url
            if not parsed.hostname:
                return url
            if parsed.port and parsed.port not in (80, 443):
                return url

            host = (parsed.hostname or "").strip().lower()
            if host in ("localhost", "127.0.0.1", "::1"):
                return url

            # Resolve and block private/loopback/link-local ranges.
            import ipaddress
            import socket

            def is_public_host(h: str, port: int) -> bool:
                if not h:
                    return False
                h = h.strip().lower()
                if h in ("localhost", "127.0.0.1", "::1"):
                    return False
                try:
                    infos = socket.getaddrinfo(h, port, type=socket.SOCK_STREAM)
                    ips = {info[4][0] for info in infos if info and len(info) >= 5}
                except Exception:
                    return False

                for ip_s in ips:
                    try:
                        ip = ipaddress.ip_address(ip_s)
                    except Exception:
                        continue
                    if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast:
                        return False
                return True

            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            if not is_public_host(host, port):
                return url

            # Normalize ext
            ext = os.path.splitext(parsed.path)[1].lower() or default_ext
            if not re.fullmatch(r"\.[a-z0-9]{1,8}", ext):
                ext = default_ext

            # Size limits
            if max_bytes is None:
                limits = {
                    "image": 30 * 1024 * 1024,
                    "video": 300 * 1024 * 1024,
                    "audio": 50 * 1024 * 1024,
                }
                max_bytes = limits.get(category, 50 * 1024 * 1024)
            try:
                max_bytes = int(max_bytes)
            except Exception:
                max_bytes = 50 * 1024 * 1024
            max_bytes = max(1 * 1024 * 1024, max_bytes)

            digest = hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]
            filename = f"cache_{digest}{ext}"

            backend_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
            upload_dir = os.path.join(backend_root, "uploads", category)
            os.makedirs(upload_dir, exist_ok=True)
            dst_path = os.path.join(upload_dir, filename)
            tmp_path = dst_path + ".tmp"

            if os.path.exists(dst_path) and os.path.getsize(dst_path) > 0:
                return f"/api/uploads/{category}/{filename}"

            timeout = httpx.Timeout(120.0, connect=10.0, read=120.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                async with client.stream("GET", url) as resp:
                    resp.raise_for_status()

                    # Re-validate after redirects (host may change).
                    try:
                        final_url = str(resp.url)
                        final_parsed = urlparse(final_url)
                        final_scheme = (final_parsed.scheme or "").lower()
                        final_host = (final_parsed.hostname or "").strip().lower()
                        final_port = final_parsed.port or (443 if final_scheme == "https" else 80)
                        if final_scheme not in ("http", "https"):
                            raise ValueError("unsafe redirect scheme")
                        if final_parsed.port and final_parsed.port not in (80, 443):
                            raise ValueError("unsafe redirect port")
                        if final_host and not is_public_host(final_host, final_port):
                            raise ValueError("unsafe redirect host")
                    except ValueError:
                        raise
                    except Exception:
                        # If we cannot validate final URL, skip caching.
                        raise ValueError("unable to validate redirected URL")

                    cl = resp.headers.get("Content-Length")
                    if cl:
                        try:
                            if int(cl) > max_bytes:
                                raise ValueError(f"remote file too large: {cl} > {max_bytes}")
                        except ValueError:
                            raise
                        except Exception:
                            # ignore invalid Content-Length, fall back to streaming cap
                            pass

                    total = 0
                    with open(tmp_path, "wb") as f:
                        async for chunk in resp.aiter_bytes():
                            if not chunk:
                                continue
                            total += len(chunk)
                            if total > max_bytes:
                                raise ValueError(f"remote file exceeds limit: {total} > {max_bytes}")
                            f.write(chunk)

            os.replace(tmp_path, dst_path)
            return f"/api/uploads/{category}/{filename}"
        except Exception as e:
            try:
                if tmp_path and os.path.exists(tmp_path):
                    os.remove(tmp_path)
            except Exception:
                pass
            print(f"[AgentExecutor] 缓存远程资源失败: {str(e)[:200]}")
            return url

    def _build_video_prompt_for_shot(self, shot: Dict[str, Any], project: AgentProject) -> str:
        """构建“视频生成”提示词（与起始帧提示词分离）。

        优先使用用户/系统显式设置的 `shot.video_prompt`；否则从 `shot.prompt/shot.description` + `shot.narration` 组合，
        并加上运动与音频一致性约束，减少“对白跑偏/音色忽男忽女”。
        """
        explicit = shot.get("video_prompt") or shot.get("videoPrompt")
        if isinstance(explicit, str) and explicit.strip():
            return explicit.strip()

        base_scene = shot.get("prompt") or shot.get("description") or ""
        if not isinstance(base_scene, str):
            base_scene = ""

        style = ""
        if isinstance(project.creative_brief, dict):
            style = project.creative_brief.get("visualStyle") or ""
        if not isinstance(style, str) or not style.strip():
            style = "吉卜力动画风格"

        narrator_voice = ""
        if isinstance(project.creative_brief, dict):
            narrator_voice = project.creative_brief.get("narratorVoiceProfile") or ""
        if not isinstance(narrator_voice, str):
            narrator_voice = ""

        shot_type = (shot.get("type") or "").strip()
        motion_map = {
            "standard": "自然流畅的角色动作与轻微镜头运动，避免突兀跳切",
            "quick": "节奏更快的动作与镜头移动，但保持画面稳定不眩晕",
            "closeup": "以角色表情与细节为主，轻微推拉或微摇镜头",
            "wide": "展示环境与空间关系，缓慢平移/推进镜头，氛围感强",
            "montage": "更强的节奏感与剪辑感，多段动作连贯但不杂乱"
        }
        motion = motion_map.get(shot_type, "自然流畅的动作与适度镜头运动")

        resolved_scene = self._resolve_element_references(base_scene, project.elements)
        character_consistency = self._build_character_consistency_prompt(base_scene, project.elements)

        # 角色音色设定：按镜头 prompt 中引用的角色元素汇总（尽量不猜）
        cast_lines = []
        try:
            referenced_ids = []
            for m in re.finditer(r"\[Element_(\w+)\]", base_scene):
                key = m.group(1)
                referenced_ids.append(f"Element_{key}")
            for eid in dict.fromkeys(referenced_ids):
                elem = project.elements.get(eid)
                if not isinstance(elem, dict):
                    continue
                if elem.get("type") != "character":
                    continue
                vp = elem.get("voice_profile")
                if isinstance(vp, str) and vp.strip():
                    cast_lines.append(f"{elem.get('name') or eid}: {vp.strip()}")
        except Exception:
            cast_lines = []

        narration = shot.get("narration") or ""
        if not isinstance(narration, str):
            narration = ""

        dialogue_script = shot.get("dialogue_script") or ""
        if not isinstance(dialogue_script, str):
            dialogue_script = ""
        dialogue_script = dialogue_script.strip()

        duration_rule = ""
        try:
            dur_f = float(shot.get("duration", 0.0))
            if math.isfinite(dur_f) and dur_f > 0:
                duration_rule = f"镜头时长严格为 {dur_f:.1f} 秒（节奏与旁白/对白长度匹配，不要过快或过慢）"
        except Exception:
            duration_rule = ""

        mode = self.resolve_audio_workflow(project)

        dialogue_script_rule = ""
        music_rule = ""
        if mode == "video_dialogue":
            # Video should output dialogue + music, but narration is generated by TTS separately.
            audio_rules = (
                "音频规则：允许人物对白与背景音乐（可自然口语化），但禁止旁白/解说/画外音。"
                "allow dialogue and background music, but no voiceover/narration."
            )
            if dialogue_script:
                dialogue_script_rule = f"对白脚本（逐字一致、每行一句）：\n{dialogue_script}"

            tone = ""
            vtype = ""
            if isinstance(project.creative_brief, dict):
                tone = str(project.creative_brief.get("emotionalTone") or "").strip()
                vtype = str(project.creative_brief.get("videoType") or "").strip()
            blob = " / ".join([x for x in [vtype, tone] if x])
            if blob:
                music_rule = f"背景音乐建议：{blob} 氛围（不要压过对白；可有转场音效）"
        else:
            audio_rules = (
                "音频规则：只保留自然环境音/音效（与画面匹配），禁止任何旁白/对白/朗读/人声/唱歌。"
                "no speech, no voiceover, no narration, no dialogue."
            )

        voice_cast_rule = ""
        if narrator_voice.strip() or cast_lines:
            lines = []
            if narrator_voice.strip() and mode != "video_dialogue":
                lines.append(f"旁白音色: {narrator_voice.strip()}")
            if cast_lines:
                lines.append("角色音色设定（同角色全片一致）:\n" + "\n".join(cast_lines))
            voice_cast_rule = "\n".join(lines)

        no_text = "no subtitles, no captions, no on-screen text, no watermarks"

        sync_hint = ""
        if mode == "video_dialogue" and narration.strip():
            sync_hint = f"视觉节奏与旁白同步（旁白由 TTS 生成，不在视频里朗读）：{narration.strip()}"

        parts = [p for p in [
            resolved_scene.strip(),
            character_consistency.strip(),
            style.strip(),
            motion,
            duration_rule,
            voice_cast_rule,
            sync_hint,
            music_rule,
            dialogue_script_rule,
            audio_rules,
            no_text
        ] if p]
        return "，".join(parts)
    
    async def generate_all_elements(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        on_progress: Optional[Callable[[str, int, int, Dict], None]] = None
    ) -> Dict[str, Any]:
        """批量生成所有元素图片
        
        Args:
            project: 项目对象
            visual_style: 视觉风格
            on_progress: 进度回调 (element_id, current, total, result)
        
        Returns:
            {success: bool, generated: int, failed: int, results: [...]}
        """
        self._cancelled = False
        if not isinstance(project.elements, dict):
            project.elements = {}
        if not isinstance(project.visual_assets, list):
            project.visual_assets = []

        elements = list(project.elements.values())
        total = len(elements)
        generated = 0
        failed = 0
        results = []
        
        for i, element in enumerate(elements):
            if self._cancelled:
                break
            if not isinstance(element, dict):
                continue

            element_id = element.get("id")
            if not isinstance(element_id, str) or not element_id.strip():
                # 无法稳定引用，跳过
                continue

            element_name = _as_text(element.get("name")).strip() or element_id
            element_type = _as_text(element.get("type")).strip() or "character"
            element_desc = _as_text(element.get("description")).strip()
            
            # 跳过已有图片的元素
            existing_url = element.get("image_url")
            if existing_url and self._should_skip_existing_image(existing_url):
                results.append({
                    "element_id": element_id,
                    "status": "skipped",
                    "message": "已有图片"
                })
                continue
            
            try:
                # 生成优化的提示词
                prompt_result = await self.agent.generate_element_prompt(
                    element_name,
                    element_type,
                    element_desc,
                    visual_style
                )
                
                if not prompt_result.get("success"):
                    # 使用原始描述作为提示词
                    prompt = f"{element_desc}, {visual_style}, high quality, detailed"
                    negative_prompt = "blurry, low quality, distorted"
                else:
                    prompt = _as_text(prompt_result.get("prompt")).strip() or element_desc
                    negative_prompt = prompt_result.get("negative_prompt", "blurry, low quality")

                if not isinstance(negative_prompt, str):
                    negative_prompt = "blurry, low quality"

                # 可选：使用用户上传的参考图增强一致性（最多 10 张）
                reference_images = _ensure_list(element.get("reference_images") or element.get("referenceImages") or [])
                reference_images = self._filter_reference_images(reference_images, limit=10)

                # 生成图片
                image_result = await self.image_service.generate(
                    prompt=prompt,
                    reference_images=reference_images or None,
                    negative_prompt=negative_prompt,
                    width=1024,
                    height=1024
                )
                
                source_url = image_result.get("url")
                cached_url = await self._cache_remote_to_uploads(source_url, "image", ".jpg")
                display_url = cached_url if isinstance(cached_url, str) and cached_url.startswith("/api/uploads/") else source_url
                
                # 创建图片历史记录
                image_record = {
                    "id": f"img_{uuid.uuid4().hex[:8]}",
                    "url": display_url,
                    "source_url": source_url,
                    "created_at": datetime.utcnow().isoformat() + "Z",
                    "is_favorite": False
                }
                
                # 获取现有历史，将新图片插入到最前面
                image_history = element.get("image_history") or []
                if not isinstance(image_history, list):
                    image_history = []
                image_history.insert(0, image_record)
                
                # 检查是否有收藏的图片
                has_favorite = any(isinstance(img, dict) and img.get("is_favorite") for img in image_history)
                
                # 更新元素
                project.elements.setdefault(element_id, element)
                project.elements[element_id]["image_history"] = image_history
                project.elements[element_id]["prompt"] = prompt
                
                # 如果没有收藏的图片，使用最新生成的
                if not has_favorite:
                    project.elements[element_id]["image_url"] = source_url
                    project.elements[element_id]["cached_image_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None

                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"asset_{element_id}_{image_record['id']}",
                    "url": display_url,
                    "type": "element",
                    "element_id": element_id
                })
                
                generated += 1
                result = {
                    "element_id": element_id,
                    "status": "success",
                    "image_url": display_url,
                    "source_url": source_url,
                    "image_id": image_record["id"]
                }
                results.append(result)
                
                if on_progress:
                    on_progress(element_id, i + 1, total, result)
                    
            except Exception as e:
                failed += 1
                result = {
                    "element_id": element_id,
                    "status": "failed",
                    "error": str(e)
                }
                results.append(result)
                
                if on_progress:
                    on_progress(element_id, i + 1, total, result)
        
        # 保存项目
        self.storage.save_agent_project(project.to_dict())
        
        return {
            "success": failed == 0,
            "generated": generated,
            "failed": failed,
            "total": total,
            "results": results
        }
    
    async def generate_all_start_frames(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        on_progress: Optional[Callable[[str, int, int, Dict], None]] = None
    ) -> Dict[str, Any]:
        """批量生成所有镜头的起始帧
        
        Args:
            project: 项目对象
            visual_style: 视觉风格
            on_progress: 进度回调 (shot_id, current, total, result)
        """
        self._cancelled = False
        if not isinstance(project.segments, list):
            project.segments = []
        if not isinstance(project.elements, dict):
            project.elements = {}
        if not isinstance(project.visual_assets, list):
            project.visual_assets = []
        
        # 收集所有镜头
        all_shots = []
        for segment in project.segments:
            if not isinstance(segment, dict):
                continue
            seg_id = segment.get("id") if isinstance(segment.get("id"), str) else ""
            shots = segment.get("shots") or []
            if not isinstance(shots, list):
                continue
            for shot in shots:
                if isinstance(shot, dict):
                    all_shots.append((seg_id, shot))

        # 为“上一镜头场景参考”建立索引（同一段落内）
        prev_shot_by_id: Dict[str, Optional[Dict[str, Any]]] = {}
        for segment in project.segments:
            prev: Optional[Dict[str, Any]] = None
            for s in segment.get("shots", []) or []:
                sid = s.get("id") if isinstance(s, dict) else None
                if isinstance(sid, str) and sid:
                    prev_shot_by_id[sid] = prev
                prev = s if isinstance(s, dict) else None

        try:
            from collections import Counter
            prompt_key_counts = Counter()
            for _, s in all_shots:
                if not isinstance(s, dict):
                    continue
                p0 = _as_text(s.get("prompt")).strip()
                if not p0:
                    p0 = _as_text(s.get("description")).strip()
                k = self._normalize_frame_prompt_key(p0)
                if k:
                    prompt_key_counts[k] += 1
        except Exception:
            prompt_key_counts = {}

        total = len(all_shots)
        generated = 0
        failed = 0
        results = []
        
        for i, (segment_id, shot) in enumerate(all_shots):
            if self._cancelled:
                break
            if not isinstance(shot, dict):
                continue
            shot_id = shot.get("id")
            if not isinstance(shot_id, str) or not shot_id.strip():
                continue
            
            # 跳过已有起始帧的镜头
            existing_url = shot.get("start_image_url")
            if existing_url and self._should_skip_existing_image(existing_url):
                results.append({
                    "shot_id": shot_id,
                    "status": "skipped",
                    "message": "已有起始帧"
                })
                continue
            
            try:
                # 解析元素引用，构建完整提示词
                prompt = _as_text(shot.get("prompt")).strip()
                if not prompt:
                    prompt = _as_text(shot.get("description")).strip()
                
                # 替换 [Element_XXX] 引用，使用完整角色描述
                resolved_prompt = self._resolve_element_references(prompt, project.elements)
                
                # 收集镜头中涉及的角色参考图（使用收藏的图片）
                reference_images = self._collect_element_reference_images(prompt, project.elements)

                # 叠加镜头级参考图（用户上传）
                shot_refs = _ensure_list(shot.get("reference_images") or shot.get("referenceImages") or [])
                for u in shot_refs:
                    if isinstance(u, str) and u and u not in reference_images and not u.startswith("data:") and (u.startswith("http") or u.startswith("/api/uploads/")):
                        reference_images.append(u)

                # 叠加上一镜头的起始帧作为“场景参考”（同一段落内）
                prompt_key = self._normalize_frame_prompt_key(prompt)
                is_prompt_dup = False
                try:
                    is_prompt_dup = bool(prompt_key) and int(prompt_key_counts.get(prompt_key, 0)) > 1
                except Exception:
                    is_prompt_dup = False

                if not is_prompt_dup:
                    prev_shot = prev_shot_by_id.get(shot.get("id"))
                    if isinstance(prev_shot, dict):
                        def parent_id(sid: Any) -> str:
                            s = _as_text(sid).strip()
                            if not s:
                                return ""
                            return re.sub(r"_P\\d+$", "", s)

                        # Avoid chaining prev-frame references within the same split-shot group.
                        if parent_id(prev_shot.get("id")) != parent_id(shot_id):
                            prev_frame = prev_shot.get("start_image_url")
                            if isinstance(prev_frame, str) and prev_frame and prev_frame not in reference_images and (prev_frame.startswith("http") or prev_frame.startswith("/api/uploads/")):
                                reference_images.append(prev_frame)

                reference_images = self._filter_reference_images(reference_images, limit=10)

                # 收集镜头中涉及的角色，构建角色一致性提示
                character_consistency = self._build_character_consistency_prompt(prompt, project.elements)
                is_split_part = bool(re.search(r"_P\\d+$", str(shot_id)))
                extra_hint = self._build_frame_prompt_hint(shot) if (is_prompt_dup or is_split_part) else ""
                
                # 添加风格、角色一致性和质量关键词
                if extra_hint:
                    full_prompt = f"{resolved_prompt}, ({extra_hint}), {character_consistency}, {visual_style}, cinematic composition, consistent character design, same art style throughout, high quality, detailed"
                else:
                    full_prompt = f"{resolved_prompt}, {character_consistency}, {visual_style}, cinematic composition, consistent character design, same art style throughout, high quality, detailed"
                
                # 生成图片，传入角色参考图
                image_result = await self.image_service.generate(
                    prompt=full_prompt,
                    reference_images=reference_images,  # 传入角色参考图
                    negative_prompt="blurry, low quality, distorted, deformed, inconsistent character, different art style, multiple styles",
                    width=1280,
                    height=720
                )
                
                source_url = image_result.get("url")
                cached_url = await self._cache_remote_to_uploads(source_url, "image", ".jpg")
                display_url = cached_url if isinstance(cached_url, str) and cached_url.startswith("/api/uploads/") else source_url
                
                # 创建图片历史记录
                image_record = {
                    "id": f"frame_{uuid.uuid4().hex[:8]}",
                    "url": display_url,
                    "source_url": source_url,
                    "created_at": datetime.utcnow().isoformat() + "Z",
                    "is_favorite": False
                }
                
                # 获取现有历史，将新图片插入到最前面
                image_history = shot.get("start_image_history") or []
                if not isinstance(image_history, list):
                    image_history = []
                image_history.insert(0, image_record)
                
                # 检查是否有收藏的图片
                has_favorite = any(isinstance(img, dict) and img.get("is_favorite") for img in image_history)
                
                # 更新镜头
                shot["start_image_history"] = image_history
                shot["resolved_prompt"] = resolved_prompt
                shot["status"] = "frame_ready"
                
                # 如果没有收藏的图片，使用最新生成的
                if not has_favorite:
                    shot["start_image_url"] = source_url
                    shot["cached_start_image_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None
                
                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"frame_{shot_id}_{image_record['id']}",
                    "url": display_url,
                    "type": "start_frame",
                    "shot_id": shot_id
                })
                
                generated += 1
                result = {
                    "shot_id": shot_id,
                    "status": "success",
                    "image_url": display_url,
                    "source_url": source_url,
                    "image_id": image_record["id"]
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot_id, i + 1, total, result)
                    
            except Exception as e:
                failed += 1
                shot["status"] = "frame_failed"
                result = {
                    "shot_id": shot_id,
                    "status": "failed",
                    "error": str(e)
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot_id, i + 1, total, result)
        
        # 保存项目
        self.storage.save_agent_project(project.to_dict())
        
        return {
            "success": failed == 0,
            "generated": generated,
            "failed": failed,
            "total": total,
            "results": results
        }
    
    async def regenerate_single_frame(
        self,
        project: AgentProject,
        shot_id: str,
        visual_style: str = "吉卜力动画风格"
    ) -> Dict[str, Any]:
        """重新生成单个镜头的起始帧（带角色参考图）
        
        Args:
            project: 项目对象
            shot_id: 镜头ID
            visual_style: 视觉风格
        
        Returns:
            {success: bool, image_url: str, image_id: str, ...}
        """
        if not isinstance(project.segments, list):
            project.segments = []
        if not isinstance(project.elements, dict):
            project.elements = {}

        # 找到目标镜头
        target_shot = None
        target_segment = None
        for segment in project.segments:
            if not isinstance(segment, dict):
                continue
            for shot in (segment.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                if shot.get("id") == shot_id:
                    target_shot = shot
                    target_segment = segment
                    break
            if target_shot:
                break
        
        if not target_shot:
            return {"success": False, "error": "镜头不存在"}
        
        try:
            # 解析元素引用，构建完整提示词
            prompt = _as_text(target_shot.get("prompt")).strip()
            if not prompt:
                prompt = _as_text(target_shot.get("description")).strip()
            
            # 替换 [Element_XXX] 引用，使用完整角色描述
            resolved_prompt = self._resolve_element_references(prompt, project.elements)
            
            # 收集镜头中涉及的角色参考图（使用收藏的图片）
            reference_images = self._collect_element_reference_images(prompt, project.elements)

            # 叠加镜头级参考图（用户上传）
            shot_refs = _ensure_list(target_shot.get("reference_images") or target_shot.get("referenceImages") or [])
            for u in shot_refs:
                if isinstance(u, str) and u and u not in reference_images and not u.startswith("data:") and (u.startswith("http") or u.startswith("/api/uploads/")):
                    reference_images.append(u)

            # 叠加上一镜头的起始帧作为“场景参考”（同一段落内）
            if isinstance(target_segment, dict):
                seg_shots = target_segment.get("shots") or []
                if isinstance(seg_shots, list):
                    for idx, s in enumerate(seg_shots):
                        if isinstance(s, dict) and s.get("id") == shot_id and idx > 0:
                            prev = seg_shots[idx - 1]
                            if isinstance(prev, dict):
                                def parent_id(sid: Any) -> str:
                                    s = _as_text(sid).strip()
                                    if not s:
                                        return ""
                                    return re.sub(r"_P\\d+$", "", s)

                                # Avoid chaining prev-frame references within the same split-shot group.
                                if parent_id(prev.get("id")) != parent_id(shot_id):
                                    prev_frame = prev.get("start_image_url")
                                    if isinstance(prev_frame, str) and prev_frame and prev_frame not in reference_images and (prev_frame.startswith("http") or prev_frame.startswith("/api/uploads/")):
                                        reference_images.append(prev_frame)
                            break

            reference_images = self._filter_reference_images(reference_images, limit=10)

            # 收集镜头中涉及的角色，构建角色一致性提示
            character_consistency = self._build_character_consistency_prompt(prompt, project.elements)

            extra_hint = self._build_frame_prompt_hint(target_shot) if isinstance(target_shot, dict) else ""
            
            # 添加风格、角色一致性和质量关键词
            if extra_hint:
                full_prompt = f"{resolved_prompt}, ({extra_hint}), {character_consistency}, {visual_style}, cinematic composition, consistent character design, same art style throughout, high quality, detailed"
            else:
                full_prompt = f"{resolved_prompt}, {character_consistency}, {visual_style}, cinematic composition, consistent character design, same art style throughout, high quality, detailed"
            
            # 生成图片，传入角色参考图
            image_result = await self.image_service.generate(
                prompt=full_prompt,
                reference_images=reference_images,  # 传入角色参考图
                negative_prompt="blurry, low quality, distorted, deformed, inconsistent character, different art style, multiple styles",
                width=1280,
                height=720
            )
            
            source_url = image_result.get("url")
            cached_url = await self._cache_remote_to_uploads(source_url, "image", ".jpg")
            display_url = cached_url if isinstance(cached_url, str) and cached_url.startswith("/api/uploads/") else source_url
            
            # 创建图片历史记录
            image_record = {
                "id": f"frame_{uuid.uuid4().hex[:8]}",
                "url": display_url,
                "source_url": source_url,
                "created_at": datetime.utcnow().isoformat() + "Z",
                "is_favorite": False
            }
            
            # 获取现有历史
            image_history = target_shot.get("start_image_history") or []
            if not isinstance(image_history, list):
                image_history = []
            
            # 如果历史为空但有旧图片，先把旧图片加入历史
            if not image_history and target_shot.get("start_image_url"):
                old_image_record = {
                    "id": f"frame_old_{uuid.uuid4().hex[:8]}",
                    "url": target_shot.get("cached_start_image_url") or target_shot["start_image_url"],
                    "source_url": target_shot["start_image_url"],
                    "created_at": target_shot.get("created_at", datetime.utcnow().isoformat() + "Z"),
                    "is_favorite": False
                }
                image_history.append(old_image_record)
            
            # 将新图片插入到最前面
            image_history.insert(0, image_record)
            
            # 检查是否有收藏的图片
            has_favorite = any(isinstance(img, dict) and img.get("is_favorite") for img in image_history)
            
            # 更新镜头
            target_shot["start_image_history"] = image_history
            target_shot["resolved_prompt"] = resolved_prompt
            target_shot["status"] = "frame_ready"
            
            # 如果没有收藏的图片，使用最新生成的
            if not has_favorite:
                target_shot["start_image_url"] = source_url
                target_shot["cached_start_image_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None
            
            # 保存项目
            self.storage.save_agent_project(project.to_dict())
            
            return {
                "success": True,
                "shot_id": shot_id,
                "image_url": display_url,
                "source_url": source_url,
                "image_id": image_record["id"],
                "start_image_url": target_shot["start_image_url"],
                "cached_start_image_url": target_shot.get("cached_start_image_url"),
                "start_image_history": image_history,
                "reference_images_count": len(reference_images)
            }
            
        except Exception as e:
            target_shot["status"] = "frame_failed"
            self.storage.save_agent_project(project.to_dict())
            return {
                "success": False,
                "shot_id": shot_id,
                "error": str(e)
            }
    
    async def generate_all_videos(
        self,
        project: AgentProject,
        resolution: str = "720p",
        on_progress: Optional[Callable[[str, int, int, Dict], None]] = None,
        on_task_created: Optional[Callable[[str, str], None]] = None
    ) -> Dict[str, Any]:
        """批量生成所有镜头的视频
        
        Args:
            project: 项目对象
            resolution: 分辨率
            on_progress: 进度回调 (shot_id, current, total, result)
            on_task_created: 任务创建回调 (shot_id, task_id)
        """
        self._cancelled = False
        if not isinstance(project.segments, list):
            project.segments = []
        if not isinstance(project.visual_assets, list):
            project.visual_assets = []
        
        # 收集所有有起始帧的镜头
        all_shots = []
        for segment in project.segments:
            if not isinstance(segment, dict):
                continue
            seg_id = segment.get("id") if isinstance(segment.get("id"), str) else ""
            for shot in (segment.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                if shot.get("start_image_url"):
                    all_shots.append((seg_id, shot))

        # Track shots that already had videos before this run, so we can report counts correctly.
        already_has_video_ids = {shot.get("id") for _, shot in all_shots if shot.get("video_url")}
        
        total = len(all_shots)
        generated = 0
        failed = 0
        results = []
        pending_tasks = []  # 待轮询的任务
        
        for i, (segment_id, shot) in enumerate(all_shots):
            if self._cancelled:
                break
            if not isinstance(shot, dict):
                continue
            shot_id = shot.get("id")
            if not isinstance(shot_id, str) or not shot_id.strip():
                continue
            
            # 跳过已有视频的镜头
            if shot.get("video_url"):
                results.append({
                    "shot_id": shot_id,
                    "status": "skipped",
                    "message": "已有视频"
                })
                continue
            
            try:
                # 构建视频提示词
                video_prompt = self._build_video_prompt_for_shot(shot, project)

                # 时长：确保是 float，并且不短于人声轨（避免导出混音被截断）
                try:
                    duration = float(shot.get("duration", 5.0))
                except Exception:
                    duration = 5.0
                if not math.isfinite(duration) or duration <= 0:
                    duration = 5.0

                voice_ms = shot.get("voice_audio_duration_ms")
                try:
                    voice_ms_i = int(voice_ms) if isinstance(voice_ms, (int, float)) else 0
                except Exception:
                    voice_ms_i = 0
                if voice_ms_i > 0:
                    voice_sec = float(voice_ms_i) / 1000.0
                    if voice_sec > 0.01 and duration < voice_sec:
                        duration = self._ceil_to_half(max(2.0, voice_sec))
                        shot["duration"] = duration
                else:
                    duration = max(2.0, duration)
                
                # 生成视频
                video_result = await self.video_service.generate(
                    image_url=shot["start_image_url"],
                    prompt=video_prompt,
                    duration=duration,
                    resolution=resolution
                )

                audio_disabled = video_result.get("audio_disabled") if isinstance(video_result, dict) else None
                if isinstance(audio_disabled, bool):
                    shot["video_audio_disabled"] = bool(audio_disabled)
                    self.record_video_audio_support(project, audio_disabled=bool(audio_disabled))
                
                task_id = video_result.get("task_id")
                status = video_result.get("status")
                
                shot["video_task_id"] = task_id
                shot["status"] = "video_processing"
                
                if on_task_created:
                    on_task_created(shot_id, task_id)
                
                # 如果是异步任务，加入待轮询列表
                if status in ["processing", "pending", "submitted"]:
                    pending_tasks.append({
                        "shot_id": shot_id,
                        "task_id": task_id,
                        "shot": shot
                    })
                elif status == "completed" or status == "succeeded":
                    remote_url = video_result.get("video_url")
                    if isinstance(remote_url, str) and remote_url.strip():
                        cached = await self._cache_remote_to_uploads(remote_url, "video", ".mp4")
                        display_url = cached if isinstance(cached, str) and cached.startswith("/api/uploads/") else remote_url
                        shot["video_source_url"] = remote_url
                        shot["video_url"] = display_url
                        shot["cached_video_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None
                    else:
                        shot["video_url"] = remote_url
                    shot["status"] = "video_ready"
                    generated += 1
                    
                    # 添加到视觉资产
                    project.visual_assets.append({
                        "id": f"video_{shot_id}_{task_id or uuid.uuid4().hex[:8]}",
                        "url": shot["video_url"],
                        "type": "video",
                        "shot_id": shot_id,
                        "duration": shot.get("duration")
                    })
                
                result = {
                    "shot_id": shot_id,
                    "status": "submitted",
                    "task_id": task_id
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot_id, i + 1, total, result)
                    
            except Exception as e:
                failed += 1
                shot["status"] = "video_failed"
                result = {
                    "shot_id": shot_id,
                    "status": "failed",
                    "error": str(e)
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot_id, i + 1, total, result)
        
        # 轮询等待所有任务完成
        if pending_tasks and not self._cancelled:
            await self._poll_video_tasks(project, pending_tasks, on_progress)

        # Recalculate counts after polling (pending_tasks may be empty by now).
        generated = sum(
            1 for _, shot in all_shots
            if shot.get("video_url") and shot.get("id") not in already_has_video_ids
        )
        failed = sum(
            1 for _, shot in all_shots
            if shot.get("status") == "video_failed" and shot.get("id") not in already_has_video_ids
        )
        
        # 保存项目
        self.storage.save_agent_project(project.to_dict())
        
        return {
            "success": failed == 0,
            "generated": generated,
            "failed": failed,
            "total": total,
            "results": results
        }
    
    async def _poll_video_tasks(
        self,
        project: AgentProject,
        pending_tasks: List[Dict],
        on_progress: Optional[Callable] = None,
        max_wait: int = 600,  # 最长等待10分钟
        poll_interval: int = 5
    ):
        """轮询视频任务状态"""
        start_time = asyncio.get_event_loop().time()
        if not isinstance(project.visual_assets, list):
            project.visual_assets = []
        
        while pending_tasks and not self._cancelled:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait:
                print(f"[AgentExecutor] 视频生成超时，{len(pending_tasks)} 个任务未完成")
                break
            
            for task_info in pending_tasks[:]:  # 复制列表以便修改
                try:
                    result = await self.video_service.check_task_status(task_info["task_id"])
                    status = result.get("status")
                    
                    if status in ["completed", "succeeded"]:
                        shot = task_info["shot"]
                        remote_url = result.get("video_url")
                        if isinstance(remote_url, str) and remote_url.strip():
                            cached = await self._cache_remote_to_uploads(remote_url, "video", ".mp4")
                            display_url = cached if isinstance(cached, str) and cached.startswith("/api/uploads/") else remote_url
                            shot["video_source_url"] = remote_url
                            shot["video_url"] = display_url
                            shot["cached_video_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None
                        else:
                            shot["video_url"] = remote_url
                        shot["status"] = "video_ready"
                        
                        # 添加到视觉资产
                        project.visual_assets.append({
                            "id": f"video_{shot.get('id')}_{task_info.get('task_id') or uuid.uuid4().hex[:8]}",
                            "url": shot["video_url"],
                            "type": "video",
                            "shot_id": shot["id"],
                            "duration": shot.get("duration")
                        })
                        
                        pending_tasks.remove(task_info)
                        
                        if on_progress:
                            on_progress(shot["id"], -1, -1, {
                                "status": "completed",
                                "video_url": shot["video_url"]
                            })
                    
                    elif status in ["failed", "error"]:
                        shot = task_info["shot"]
                        shot["status"] = "video_failed"
                        shot["error"] = result.get("error", "视频生成失败")
                        pending_tasks.remove(task_info)
                        
                        if on_progress:
                            on_progress(shot["id"], -1, -1, {
                                "status": "failed",
                                "error": shot["error"]
                            })
                            
                except Exception as e:
                    print(f"[AgentExecutor] 轮询任务 {task_info['task_id']} 失败: {e}")
            
            if pending_tasks:
                await asyncio.sleep(poll_interval)

    async def poll_project_video_tasks(self, project: AgentProject) -> Dict[str, Any]:
        """Poll all pending video tasks in a project once and persist any completed results.

        Keeps old assets for user selection; only updates shots that have a `video_task_id`
        but no `video_url` yet.
        """
        checked = 0
        completed = 0
        failed = 0
        processing = 0
        updated: List[Dict[str, Any]] = []

        if not isinstance(project.segments, list):
            project.segments = []
        if not isinstance(project.visual_assets, list):
            project.visual_assets = []

        for segment in project.segments:
            if not isinstance(segment, dict):
                continue
            for shot in (segment.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                task_id = shot.get("video_task_id")
                if not task_id:
                    continue
                if shot.get("video_url"):
                    continue

                checked += 1
                try:
                    result = await self.video_service.check_task_status(task_id)
                except Exception as e:
                    processing += 1
                    updated.append({
                        "shot_id": shot.get("id"),
                        "task_id": task_id,
                        "status": "error",
                        "error": str(e)
                    })
                    continue

                status = result.get("status")

                if status in ["completed", "succeeded"] and result.get("video_url"):
                    remote_url = result.get("video_url")
                    cached = await self._cache_remote_to_uploads(remote_url, "video", ".mp4")
                    display_url = cached if isinstance(cached, str) and cached.startswith("/api/uploads/") else remote_url
                    shot["video_source_url"] = remote_url
                    shot["video_url"] = display_url
                    shot["cached_video_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None
                    shot["status"] = "video_ready"

                    project.visual_assets.append({
                        "id": f"video_{shot.get('id')}_{task_id or uuid.uuid4().hex[:8]}",
                        "url": shot["video_url"],
                        "type": "video",
                        "shot_id": shot.get("id"),
                        "duration": shot.get("duration")
                    })

                    completed += 1
                    updated.append({
                        "shot_id": shot.get("id"),
                        "task_id": task_id,
                        "status": "completed",
                        "video_url": shot["video_url"]
                    })

                elif status in ["failed", "error"]:
                    shot["status"] = "video_failed"
                    shot["error"] = result.get("error", "视频生成失败")
                    failed += 1
                    updated.append({
                        "shot_id": shot.get("id"),
                        "task_id": task_id,
                        "status": "failed",
                        "error": shot.get("error")
                    })
                else:
                    processing += 1
                    updated.append({
                        "shot_id": shot.get("id"),
                        "task_id": task_id,
                        "status": status or "processing",
                        "progress": result.get("progress")
                    })

        self.storage.save_agent_project(project.to_dict())

        return {
            "checked": checked,
            "completed": completed,
            "failed": failed,
            "processing": processing,
            "updated": updated
        }
    
    def _resolve_element_references(self, prompt: Any, elements: Dict[str, Dict]) -> str:
        """解析提示词中的元素引用，使用完整描述确保角色一致性"""
        prompt = _as_text(prompt)
        if not prompt:
            return ""
        if not isinstance(elements, dict):
            elements = {}

        def replace_element(match):
            element_id = match.group(0)  # 完整匹配 [Element_XXX]
            element_key = match.group(1)  # XXX 部分
            
            # 尝试多种匹配方式
            full_id = f"Element_{element_key}"
            element = elements.get(full_id) or elements.get(element_id) or elements.get(element_key)
            
            if isinstance(element, dict):
                # 始终使用完整描述以保持角色一致性
                # 格式：角色名（详细描述）
                name = _as_text(element.get("name")).strip() or element_key
                description = _as_text(element.get("description")).strip()
                if description.strip():
                    return f"{name} ({description})"
                return name
            return match.group(0)
        
        return re.sub(r'\[Element_(\w+)\]', replace_element, prompt)
    
    def _build_character_consistency_prompt(self, prompt: Any, elements: Dict[str, Dict]) -> str:
        """构建角色一致性提示词
        
        提取镜头中涉及的角色，生成强调一致性的提示词
        """
        prompt = _as_text(prompt)
        if not prompt:
            return ""
        if not isinstance(elements, dict):
            elements = {}

        # 找出所有引用的元素
        referenced_elements = []
        for match in re.finditer(r'\[Element_(\w+)\]', prompt):
            element_key = match.group(1)
            full_id = f"Element_{element_key}"
            element = elements.get(full_id) or elements.get(element_key)
            if isinstance(element, dict) and element.get("type") == "character":
                referenced_elements.append(element)
        
        if not referenced_elements:
            return ""
        
        # 构建角色一致性描述
        consistency_parts = []
        for elem in referenced_elements:
            name = _as_text(elem.get("name"))
            # 提取关键特征（发型、服装、颜色等）
            desc = _as_text(elem.get("description"))
            if name and desc:
                # 提取关键词
                key_features = []
                # 发型相关
                if "黑色" in desc or "black" in desc.lower():
                    key_features.append("black hair")
                if "棕色" in desc or "brown" in desc.lower():
                    key_features.append("brown hair")
                if "羊角辫" in desc or "pigtails" in desc.lower():
                    key_features.append("pigtails")
                if "长发" in desc or "long hair" in desc.lower():
                    key_features.append("long hair")
                if "卷发" in desc or "curly" in desc.lower():
                    key_features.append("curly hair")
                # 服装相关
                if "黄色" in desc and ("裙" in desc or "dress" in desc.lower()):
                    key_features.append("yellow dress")
                if "围裙" in desc or "apron" in desc.lower():
                    key_features.append("apron")
                # 年龄相关
                ages: List[int] = []
                for m in re.finditer(r"(?<!\d)(\d{1,3})\s*岁", desc):
                    try:
                        ages.append(int(m.group(1)))
                    except Exception:
                        continue

                if 5 in ages or ("幼儿" in desc and "幼儿园" not in desc):
                    key_features.append("5-year-old child")
                if 30 in ages:
                    key_features.append("30-year-old woman")
                
                if key_features:
                    consistency_parts.append(f"{name} with {', '.join(key_features)}")
        
        if consistency_parts:
            return f"maintaining character consistency: {'; '.join(consistency_parts)}"
        return ""

    def _normalize_frame_prompt_key(self, prompt: Any) -> str:
        """Normalize a shot prompt for de-duplication in start-frame generation."""
        s = _as_text(prompt)
        if not s:
            return ""
        s = s.lower()
        s = re.sub(r"\bno[-_ ]?text\b", "", s)
        s = re.sub(r"\[element_[a-z0-9_\-]+\]", "[element]", s, flags=re.IGNORECASE)
        s = re.sub(r"[\"“”‘’]", "", s)
        s = re.sub(r"[，,。.!?;；:：、]+", " ", s)
        s = re.sub(r"\s+", " ", s).strip()
        return s

    def _compact_frame_hint_text(self, text: Any, max_len: int = 60) -> str:
        s = _as_text(text).replace("\r", " ").replace("\n", " ").strip()
        if not s:
            return ""
        s = s.strip(" \"“”'‘’")
        s = re.sub(r"^(?:旁白同步|旁白|narration|voiceover)\s*[:：]\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\[Element_[A-Za-z0-9_\-]+\]", "", s)
        # Avoid leading punctuation like "：：我..." after removing element refs / prefixes.
        s = s.lstrip(" :：，,;；-—").strip()
        s = re.sub(r"\s+", " ", s).strip()
        parts = re.split(r"[。！？.!?]", s, maxsplit=1)
        if parts and parts[0].strip():
            s = parts[0].strip()
        if len(s) > max_len:
            s = s[:max_len].rstrip(" ,，。.!?;；:：-")
        return s

    def _build_frame_prompt_hint(self, shot: Dict[str, Any], max_len: int = 60) -> str:
        if not isinstance(shot, dict):
            return ""
        hint_parts: List[str] = []
        name = _as_text(shot.get("name")).strip()
        if name:
            hint_parts.append(name)
        narration_hint = self._compact_frame_hint_text(shot.get("narration"), max_len=max_len)
        if narration_hint:
            hint_parts.append(narration_hint)
        if not narration_hint:
            desc_hint = self._compact_frame_hint_text(shot.get("description"), max_len=max_len)
            if desc_hint:
                hint_parts.append(desc_hint)
        return "；".join([p for p in hint_parts if p])
    
    def _collect_element_reference_images(self, prompt: Any, elements: Dict[str, Dict]) -> List[str]:
        """收集镜头中涉及的元素参考图
        
        提取镜头提示词中引用的所有元素的图片 URL，用于图文混合生成
        """
        prompt = _as_text(prompt)
        if not prompt:
            return []
        if not isinstance(elements, dict):
            elements = {}

        reference_images: List[str] = []

        def is_valid_ref(url: Any) -> bool:
            if not isinstance(url, str):
                return False
            u = url.strip()
            if not u or u.startswith("data:"):
                return False
            if u.startswith("/api/uploads/"):
                return True
            if u.startswith("http") and not self._is_probably_expired_signed_url(u):
                return True
            return False
        
        # 找出所有引用的元素
        for match in re.finditer(r'\[Element_(\w+)\]', prompt):
            element_key = match.group(1)
            full_id = f"Element_{element_key}"
            element = elements.get(full_id) or elements.get(element_key)
            
            if element and isinstance(element, dict):
                candidates: List[Any] = []
                if element.get("image_url"):
                    candidates.append(element.get("image_url"))
                ref_list = element.get("reference_images") or element.get("referenceImages") or []
                if isinstance(ref_list, list):
                    candidates.extend(ref_list)

                for image_url in candidates:
                    if is_valid_ref(image_url) and image_url not in reference_images:
                        reference_images.append(image_url)
                        print(f"[AgentExecutor] 添加参考图: {element.get('name', element_key)} -> {str(image_url)[:50]}...")

        return reference_images
    
    async def execute_full_pipeline(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        resolution: str = "720p",
        on_stage_complete: Optional[Callable[[str, Dict], None]] = None,
        on_progress: Optional[Callable[[str, str, int, int, Dict], None]] = None
    ) -> Dict[str, Any]:
        """执行完整的生成流程
        
        Flova 风格的渐进式执行：
        1. 生成所有元素图片
        2. 生成所有起始帧
        3. 生成所有视频
        
        Args:
            project: 项目对象
            visual_style: 视觉风格
            resolution: 视频分辨率
            on_stage_complete: 阶段完成回调 (stage_name, result)
            on_progress: 进度回调 (stage, item_id, current, total, result)
        """
        self._cancelled = False
        pipeline_result = {
            "stages": {},
            "success": True,
            "total_generated": 0,
            "total_failed": 0
        }
        
        # 阶段1: 生成元素图片
        print("[AgentExecutor] 阶段1: 生成元素图片")
        elements_result = await self.generate_all_elements(
            project,
            visual_style,
            on_progress=lambda eid, cur, tot, res: on_progress("elements", eid, cur, tot, res) if on_progress else None
        )
        pipeline_result["stages"]["elements"] = elements_result
        pipeline_result["total_generated"] += elements_result["generated"]
        pipeline_result["total_failed"] += elements_result["failed"]
        
        if on_stage_complete:
            on_stage_complete("elements", elements_result)
        
        if self._cancelled:
            pipeline_result["success"] = False
            pipeline_result["cancelled_at"] = "elements"
            return pipeline_result
        
        # 阶段2: 生成起始帧
        print("[AgentExecutor] 阶段2: 生成起始帧")
        frames_result = await self.generate_all_start_frames(
            project,
            visual_style,
            on_progress=lambda sid, cur, tot, res: on_progress("frames", sid, cur, tot, res) if on_progress else None
        )
        pipeline_result["stages"]["frames"] = frames_result
        pipeline_result["total_generated"] += frames_result["generated"]
        pipeline_result["total_failed"] += frames_result["failed"]
        
        if on_stage_complete:
            on_stage_complete("frames", frames_result)
        
        if self._cancelled:
            pipeline_result["success"] = False
            pipeline_result["cancelled_at"] = "frames"
            return pipeline_result
        
        # 阶段3: 生成视频
        print("[AgentExecutor] 阶段3: 生成视频")
        videos_result = await self.generate_all_videos(
            project,
            resolution,
            on_progress=lambda sid, cur, tot, res: on_progress("videos", sid, cur, tot, res) if on_progress else None
        )
        pipeline_result["stages"]["videos"] = videos_result
        pipeline_result["total_generated"] += videos_result["generated"]
        pipeline_result["total_failed"] += videos_result["failed"]
        
        if on_stage_complete:
            on_stage_complete("videos", videos_result)
        
        pipeline_result["success"] = pipeline_result["total_failed"] == 0
        
        return pipeline_result
