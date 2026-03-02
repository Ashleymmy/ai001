"""Pipeline 优化器与工作台适配 — Phase 4

负责将 Agent Pipeline 和知识库适配到不同工作台模式，
以及提供性能优化（并行化、缓存、异步QA）。

Tasks covered:
  4.3 — Short Video Rhythm Templates (短视频工作台节奏模板)
  4.4 — Digital Human Profile Sync (数字人工作台形象同步)
  4.5 — Agent Bridge Enhancement (Agent 桥接知识库导入/导出)
  4.6 — Performance Optimization (并行阶段、缓存、异步QA)
"""

from __future__ import annotations

import asyncio
import copy
import json
import math
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Dict, List, Optional, Set, Tuple


# ---------------------------------------------------------------------------
# Task 4.3: Short Video Rhythm Templates
# ---------------------------------------------------------------------------

@dataclass
class RhythmTemplate:
    """短视频节奏模板

    Each *segment* dict has:
        name            — segment label (e.g. "hook", "climax")
        duration_ratio  — fraction of total duration [0..1]
        shot_count      — suggested number of shots in this segment
        pace            — "slow" / "medium" / "fast" / "very_fast"
        mood_suggestion — recommended mood key (maps to mood_packs)
    """

    template_id: str
    name: str
    name_en: str
    description: str
    platform: str  # "douyin" / "kuaishou" / "xiaohongshu" / "universal"
    duration_seconds: float
    segments: List[Dict[str, Any]]


RHYTHM_TEMPLATES: Dict[str, RhythmTemplate] = {
    # ---- 1. Fast Cut (快切节奏) ------------------------------------------
    "fast_cut": RhythmTemplate(
        template_id="fast_cut",
        name="快切节奏",
        name_en="Fast Cut",
        description="适合动作、悬疑类短视频。高频切换，每镜2-3秒。",
        platform="universal",
        duration_seconds=60,
        segments=[
            {"name": "hook", "duration_ratio": 0.10, "shot_count": 2,
             "pace": "fast", "mood_suggestion": "tense"},
            {"name": "escalation", "duration_ratio": 0.40, "shot_count": 8,
             "pace": "fast", "mood_suggestion": "suspense"},
            {"name": "climax", "duration_ratio": 0.30, "shot_count": 6,
             "pace": "very_fast", "mood_suggestion": "cool"},
            {"name": "resolution", "duration_ratio": 0.20, "shot_count": 3,
             "pace": "medium", "mood_suggestion": "tender"},
        ],
    ),
    # ---- 2. Slow Narrative (慢叙事) --------------------------------------
    "slow_narrative": RhythmTemplate(
        template_id="slow_narrative",
        name="慢叙事",
        name_en="Slow Narrative",
        description="适合情感、治愈类短视频。长镜留白，沉浸感强。",
        platform="universal",
        duration_seconds=90,
        segments=[
            {"name": "opening", "duration_ratio": 0.15, "shot_count": 2,
             "pace": "slow", "mood_suggestion": "warm"},
            {"name": "development", "duration_ratio": 0.45, "shot_count": 5,
             "pace": "slow", "mood_suggestion": "tender"},
            {"name": "turning_point", "duration_ratio": 0.20, "shot_count": 3,
             "pace": "medium", "mood_suggestion": "despair"},
            {"name": "resolution", "duration_ratio": 0.20, "shot_count": 2,
             "pace": "slow", "mood_suggestion": "warm"},
        ],
    ),
    # ---- 3. Climax Build (渐进高潮) --------------------------------------
    "climax_build": RhythmTemplate(
        template_id="climax_build",
        name="渐进高潮",
        name_en="Climax Build",
        description="节奏由慢及快，在结尾爆发。适合热血、逆袭题材。",
        platform="universal",
        duration_seconds=75,
        segments=[
            {"name": "setup", "duration_ratio": 0.20, "shot_count": 3,
             "pace": "slow", "mood_suggestion": "warm"},
            {"name": "rising_action", "duration_ratio": 0.30, "shot_count": 5,
             "pace": "medium", "mood_suggestion": "tense"},
            {"name": "acceleration", "duration_ratio": 0.25, "shot_count": 6,
             "pace": "fast", "mood_suggestion": "suspense"},
            {"name": "climax", "duration_ratio": 0.15, "shot_count": 4,
             "pace": "very_fast", "mood_suggestion": "cool"},
            {"name": "cooldown", "duration_ratio": 0.10, "shot_count": 1,
             "pace": "slow", "mood_suggestion": "tender"},
        ],
    ),
    # ---- 4. Douyin Hook (抖音黄金3秒) ------------------------------------
    "douyin_hook": RhythmTemplate(
        template_id="douyin_hook",
        name="抖音黄金3秒",
        name_en="Douyin Hook",
        description="前3秒强力钩子，抖音专用节奏。完播率优化。",
        platform="douyin",
        duration_seconds=45,
        segments=[
            {"name": "hook", "duration_ratio": 0.07, "shot_count": 1,
             "pace": "very_fast", "mood_suggestion": "cool"},
            {"name": "reveal", "duration_ratio": 0.20, "shot_count": 3,
             "pace": "fast", "mood_suggestion": "suspense"},
            {"name": "body", "duration_ratio": 0.46, "shot_count": 6,
             "pace": "fast", "mood_suggestion": "tense"},
            {"name": "twist", "duration_ratio": 0.15, "shot_count": 2,
             "pace": "very_fast", "mood_suggestion": "cool"},
            {"name": "cta", "duration_ratio": 0.12, "shot_count": 1,
             "pace": "medium", "mood_suggestion": "warm"},
        ],
    ),
    # ---- 5. Xiaohongshu Aesthetic (小红书美学) ----------------------------
    "xiaohongshu_aesthetic": RhythmTemplate(
        template_id="xiaohongshu_aesthetic",
        name="小红书美学",
        name_en="Xiaohongshu Aesthetic",
        description="以视觉美感为核心，适合穿搭、场景展示类内容。舒缓有层次。",
        platform="xiaohongshu",
        duration_seconds=60,
        segments=[
            {"name": "beauty_shot", "duration_ratio": 0.20, "shot_count": 2,
             "pace": "slow", "mood_suggestion": "tender"},
            {"name": "detail_montage", "duration_ratio": 0.35, "shot_count": 5,
             "pace": "medium", "mood_suggestion": "warm"},
            {"name": "atmosphere", "duration_ratio": 0.25, "shot_count": 3,
             "pace": "slow", "mood_suggestion": "tender"},
            {"name": "closing", "duration_ratio": 0.20, "shot_count": 2,
             "pace": "slow", "mood_suggestion": "warm"},
        ],
    ),
}


def get_rhythm_template(template_id: str) -> Optional[RhythmTemplate]:
    """Return a rhythm template by its ID, or *None* if not found."""
    return RHYTHM_TEMPLATES.get(template_id)


def list_rhythm_templates(platform: Optional[str] = None) -> List[Dict[str, Any]]:
    """List available rhythm templates with optional platform filter.

    If *platform* is given, only templates whose platform matches or whose
    platform is ``"universal"`` will be returned.
    """
    results: List[Dict[str, Any]] = []
    for tid, tmpl in RHYTHM_TEMPLATES.items():
        if platform and tmpl.platform != platform and tmpl.platform != "universal":
            continue
        results.append({
            "template_id": tmpl.template_id,
            "name": tmpl.name,
            "name_en": tmpl.name_en,
            "description": tmpl.description,
            "platform": tmpl.platform,
            "duration_seconds": tmpl.duration_seconds,
            "segment_count": len(tmpl.segments),
            "total_shots": sum(s.get("shot_count", 0) for s in tmpl.segments),
        })
    return results


# Pace -> average shot duration in seconds mapping
_PACE_DURATION: Dict[str, float] = {
    "slow": 6.0,
    "medium": 4.0,
    "fast": 2.5,
    "very_fast": 1.5,
}


def adapt_pipeline_for_short_video(
    pipeline_state: Dict[str, Any],
    template_id: str,
) -> Dict[str, Any]:
    """Adapt pipeline parameters for short video production.

    Adjusts shot count, per-shot duration, and mood suggestions based on the
    chosen rhythm template.  Returns a *new* dict (does not mutate the input).
    """
    template = RHYTHM_TEMPLATES.get(template_id)
    if template is None:
        return pipeline_state

    adapted = copy.deepcopy(pipeline_state)
    total_duration = template.duration_seconds

    adapted_shots: List[Dict[str, Any]] = []
    shot_index = 0

    for segment in template.segments:
        seg_duration = total_duration * segment["duration_ratio"]
        seg_shot_count = segment["shot_count"]
        avg_shot_dur = seg_duration / max(seg_shot_count, 1)

        for i in range(seg_shot_count):
            shot_index += 1
            adapted_shots.append({
                "shot_index": shot_index,
                "segment": segment["name"],
                "duration_seconds": round(avg_shot_dur, 2),
                "pace": segment["pace"],
                "mood_suggestion": segment["mood_suggestion"],
            })

    adapted["rhythm_template_id"] = template_id
    adapted["rhythm_template_name"] = template.name_en
    adapted["total_duration"] = total_duration
    adapted["platform"] = template.platform
    adapted["adapted_shots"] = adapted_shots
    adapted["adapted_at"] = datetime.utcnow().isoformat()

    return adapted


# ---------------------------------------------------------------------------
# Task 4.4: Digital Human Profile Sync
# ---------------------------------------------------------------------------

def sync_digital_human_to_kb(storage: Any, profile_id: str) -> Dict[str, Any]:
    """Sync a digital human profile to the knowledge base.

    Creates or updates a ``kb_character_card`` from the digital human
    profile's ``appearance``, ``voice_profile``, and ``scene_template``
    fields.  Returns the synced character card dict.
    """
    profile = storage.get_digital_human_profile(profile_id)
    if not profile:
        return {"error": "profile_not_found", "profile_id": profile_id}

    appearance = profile.get("appearance", {})
    voice_profile = profile.get("voice_profile", "")
    scene_template = profile.get("scene_template", "")
    element_id = profile.get("element_id", profile_id)

    # Build appearance tokens from digital human profile
    appearance_tokens: Dict[str, str] = {}
    if isinstance(appearance, dict):
        appearance_tokens["hair"] = str(appearance.get("hair", "default hair"))
        appearance_tokens["eyes"] = str(appearance.get("eyes", "default eyes"))
        appearance_tokens["skin"] = str(appearance.get("skin", "fair skin"))
        appearance_tokens["build"] = str(appearance.get("build", "average build"))
        if appearance.get("distinctive_features"):
            appearance_tokens["distinctive"] = str(appearance["distinctive_features"])
    elif isinstance(appearance, str):
        appearance_tokens["description"] = appearance

    # Derive costume tokens from profile
    costume_tokens: Dict[str, str] = {
        "default": str(appearance.get("default_outfit", "casual wear"))
        if isinstance(appearance, dict) else "casual wear"
    }

    # Add lip sync style derived from voice
    lip_sync_style = auto_match_lip_sync_style(voice_profile)

    # Check if card already exists
    existing = storage.get_character_card_by_element(element_id)
    if existing:
        new_version = int(existing.get("version", 1)) + 1
        storage.update_character_card(existing["id"], {
            "appearance_tokens": appearance_tokens,
            "costume_tokens": costume_tokens,
            "lip_sync_style": lip_sync_style,
            "scene_template": scene_template,
            "voice_profile": voice_profile,
            "version": new_version,
        })
        card = storage.get_character_card(existing["id"])
    else:
        card = storage.create_character_card(
            element_id=element_id,
            appearance_tokens=appearance_tokens,
            costume_tokens=costume_tokens,
            lip_sync_style=lip_sync_style,
            scene_template=scene_template,
            voice_profile=voice_profile,
        )

    return card if card else {"synced": True, "element_id": element_id}


def sync_kb_to_digital_human(
    storage: Any,
    element_id: str,
    profile_id: str,
) -> Dict[str, Any]:
    """Sync a KB character card back to a digital human profile.

    Updates the digital human profile's ``appearance`` field from the
    KB card's ``appearance_tokens``.  Returns the updated profile dict.
    """
    card = storage.get_character_card_by_element(element_id)
    if not card:
        return {"error": "card_not_found", "element_id": element_id}

    profile = storage.get_digital_human_profile(profile_id)
    if not profile:
        return {"error": "profile_not_found", "profile_id": profile_id}

    appearance_tokens = card.get("appearance_tokens", {})

    # Convert KB tokens back into profile appearance dict
    updated_appearance: Dict[str, Any] = {}
    if isinstance(appearance_tokens, dict):
        updated_appearance["hair"] = appearance_tokens.get("hair", "")
        updated_appearance["eyes"] = appearance_tokens.get("eyes", "")
        updated_appearance["skin"] = appearance_tokens.get("skin", "")
        updated_appearance["build"] = appearance_tokens.get("build", "")
        if "distinctive" in appearance_tokens:
            updated_appearance["distinctive_features"] = appearance_tokens["distinctive"]

    costume_tokens = card.get("costume_tokens", {})
    if isinstance(costume_tokens, dict):
        updated_appearance["default_outfit"] = costume_tokens.get("default", "")

    storage.update_digital_human_profile(profile_id, {
        "appearance": updated_appearance,
    })

    updated = storage.get_digital_human_profile(profile_id)
    return updated if updated else {"synced": True, "profile_id": profile_id}


# Voice profile keyword -> lip sync style mapping
_VOICE_LIP_SYNC_MAP: Dict[str, str] = {
    "narrator": "smooth",
    "expressive": "expressive",
    "calm": "smooth",
    "energetic": "expressive",
    "whisper": "minimal",
    "shout": "expressive",
    "child": "expressive",
    "elder": "smooth",
    "robot": "minimal",
    "ai": "minimal",
    "professional": "precise",
    "news": "precise",
    "acting": "expressive",
    "singing": "expressive",
    "default": "precise",
}


def auto_match_lip_sync_style(voice_profile: str) -> str:
    """Auto-detect lip sync style based on voice profile characteristics.

    Scans the *voice_profile* string for known keywords and returns the
    best-matching style.

    Returns one of: ``"precise"``, ``"smooth"``, ``"expressive"``, ``"minimal"``.
    """
    if not voice_profile:
        return "precise"

    profile_lower = voice_profile.lower()

    # Score each style by counting keyword hits
    style_scores: Dict[str, int] = {
        "precise": 0,
        "smooth": 0,
        "expressive": 0,
        "minimal": 0,
    }

    for keyword, style in _VOICE_LIP_SYNC_MAP.items():
        if keyword in profile_lower:
            style_scores[style] = style_scores.get(style, 0) + 1

    best_style = max(style_scores, key=lambda s: style_scores[s])

    # If no keywords matched at all, default to "precise"
    if style_scores[best_style] == 0:
        return "precise"

    return best_style


# ---------------------------------------------------------------------------
# Task 4.5: Agent Bridge Enhancement
# ---------------------------------------------------------------------------

# Element type mapping: Agent project types -> KB entry categories
_AGENT_TYPE_TO_KB: Dict[str, str] = {
    "character": "character",
    "scene": "scene",
    "prop": "scene",       # props stored alongside scenes in KB
    "world_rule": "world",
    "dialogue": "dialogue",
    "plot": "plot",
}


def import_agent_project_to_kb(
    storage: Any,
    project_data: Dict[str, Any],
    series_id: str,
) -> Dict[str, Any]:
    """Import elements from an Agent-mode project into the Studio knowledge base.

    Scans *project_data* for elements (characters, scenes, world rules, etc.)
    and creates corresponding shared_elements and KB card entries via
    *storage*.

    Returns an import summary dict with counts per type.
    """
    elements = project_data.get("elements", [])
    if not elements and "characters" in project_data:
        # Alternative format: flat keys per type
        for char in project_data.get("characters", []):
            char.setdefault("type", "character")
            elements.append(char)
        for scene in project_data.get("scenes", []):
            scene.setdefault("type", "scene")
            elements.append(scene)
        for rule in project_data.get("world_rules", []):
            rule.setdefault("type", "world_rule")
            elements.append(rule)

    counts: Dict[str, int] = {
        "characters": 0,
        "scenes": 0,
        "world_rules": 0,
        "skipped": 0,
    }
    imported_ids: List[str] = []

    for elem in elements:
        elem_type = str(elem.get("type", ""))
        kb_type = _AGENT_TYPE_TO_KB.get(elem_type)
        if kb_type is None:
            counts["skipped"] += 1
            continue

        name = str(elem.get("name", elem.get("title", f"imported_{uuid.uuid4().hex[:6]}")))
        description = str(elem.get("description", elem.get("content", "")))

        # Create a shared element in storage
        shared = storage.create_shared_element(
            series_id=series_id,
            name=name,
            type=kb_type if kb_type in ("character", "scene") else "character",
            description=description,
        )
        if shared:
            imported_ids.append(shared.get("id", ""))

        count_key = f"{elem_type}s" if f"{elem_type}s" in counts else "skipped"
        counts[count_key] = counts.get(count_key, 0) + 1

    # Trigger KB sync for all newly imported elements
    synced = {"characters": 0, "scenes": 0}
    try:
        from .knowledge_base import KnowledgeBase
        kb = KnowledgeBase(storage)
        synced = kb.sync_all_elements(series_id)
    except Exception:
        pass  # KB sync is best-effort

    return {
        "status": "completed",
        "series_id": series_id,
        "total_elements": len(elements),
        "imported": counts,
        "synced_to_kb": synced,
        "imported_ids": imported_ids,
        "imported_at": datetime.utcnow().isoformat(),
    }


def export_kb_for_agent(storage: Any, series_id: str) -> Dict[str, Any]:
    """Export KB data in a format usable by Agent mode.

    Returns a structured dict with character cards, scene cards, mood packs,
    and world bible formatted for Agent project consumption.
    """
    # --- Character cards ---
    characters: List[Dict[str, Any]] = []
    try:
        char_elements = [
            e for e in storage.get_shared_elements(series_id)
            if e.get("type") == "character"
        ]
        for elem in char_elements:
            card = storage.get_character_card_by_element(elem["id"])
            characters.append({
                "element_id": elem.get("id", ""),
                "name": elem.get("name", ""),
                "description": elem.get("description", ""),
                "appearance_tokens": card.get("appearance_tokens", {}) if card else {},
                "costume_tokens": card.get("costume_tokens", {}) if card else {},
                "expression_tokens": card.get("expression_tokens", {}) if card else {},
            })
    except Exception:
        pass

    # --- Scene cards ---
    scenes: List[Dict[str, Any]] = []
    try:
        scene_elements = [
            e for e in storage.get_shared_elements(series_id)
            if e.get("type") == "scene"
        ]
        for elem in scene_elements:
            card = storage.get_scene_card_by_element(elem["id"])
            scenes.append({
                "element_id": elem.get("id", ""),
                "name": elem.get("name", ""),
                "description": elem.get("description", ""),
                "base_tokens": card.get("base_tokens", "") if card else "",
                "time_variants": card.get("time_variants", {}) if card else {},
            })
    except Exception:
        pass

    # --- Mood packs ---
    mood_packs: List[Dict[str, Any]] = []
    try:
        packs = storage.list_mood_packs()
        for pack in packs:
            mood_packs.append({
                "mood_key": pack.get("mood_key", ""),
                "combined_prompt": pack.get("combined_prompt", ""),
            })
    except Exception:
        # Fallback: export built-in packs
        from .mood_packs import BUILTIN_MOOD_PACKS
        for key, mp in BUILTIN_MOOD_PACKS.items():
            mood_packs.append({
                "mood_key": key,
                "combined_prompt": mp.combined_prompt,
            })

    # --- World bible ---
    world_bible: Dict[str, Any] = {}
    try:
        bible = storage.get_world_bible_by_series(series_id)
        if bible:
            world_bible = {
                "art_style": bible.get("art_style", ""),
                "era": bible.get("era", ""),
                "color_palette": bible.get("color_palette", ""),
                "forbidden_elements": bible.get("forbidden_elements", ""),
                "recurring_motifs": bible.get("recurring_motifs", ""),
            }
    except Exception:
        pass

    return {
        "format_version": "1.0",
        "series_id": series_id,
        "characters": characters,
        "scenes": scenes,
        "mood_packs": mood_packs,
        "world_bible": world_bible,
        "exported_at": datetime.utcnow().isoformat(),
    }


# ---------------------------------------------------------------------------
# Task 4.6: Performance Optimization
# ---------------------------------------------------------------------------

# Stages that can safely run in parallel within each group.
# Each inner list contains stages that are independent of each other;
# groups execute sequentially (group N+1 waits for group N to finish).
PARALLEL_STAGE_GROUPS: List[List[str]] = [
    ["world_building", "character_development"],   # independent of each other
    ["dialogue_writing", "storyboard_planning"],   # both consume world+character
    ["prompt_composition"],                        # must wait for storyboard
    ["prompt_qa"],                                 # can run as prompts are produced
]


class KBCache:
    """Knowledge base query cache for high-frequency token lookups.

    Uses a simple TTL-based eviction strategy.  When the cache exceeds
    *max_size*, the oldest entries are removed first (FIFO eviction).
    """

    def __init__(self, max_size: int = 500, ttl_seconds: int = 300) -> None:
        self._cache: Dict[str, Tuple[Any, float]] = {}
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._hits = 0
        self._misses = 0

    def get(self, key: str) -> Optional[Any]:
        """Retrieve a cached value by *key*.

        Returns ``None`` on cache miss or if the entry has expired.
        Expired entries are lazily evicted on access.
        """
        entry = self._cache.get(key)
        if entry is None:
            self._misses += 1
            return None

        value, ts = entry
        if (time.time() - ts) > self._ttl:
            # Entry expired — remove it
            del self._cache[key]
            self._misses += 1
            return None

        self._hits += 1
        return value

    def set(self, key: str, value: Any) -> None:
        """Store a value in the cache.

        If the cache is at capacity, the oldest entry is evicted first.
        """
        if len(self._cache) >= self._max_size and key not in self._cache:
            self._evict_oldest()
        self._cache[key] = (value, time.time())

    def invalidate(self, key: str) -> None:
        """Remove a specific key from the cache."""
        self._cache.pop(key, None)

    def clear(self) -> None:
        """Remove all entries from the cache."""
        self._cache.clear()
        self._hits = 0
        self._misses = 0

    def stats(self) -> Dict[str, Any]:
        """Return cache hit/miss statistics."""
        total = self._hits + self._misses
        return {
            "size": len(self._cache),
            "max_size": self._max_size,
            "hits": self._hits,
            "misses": self._misses,
            "hit_rate": round(self._hits / total, 4) if total > 0 else 0.0,
        }

    def _evict_oldest(self) -> None:
        """Remove the entry with the oldest timestamp."""
        if not self._cache:
            return
        oldest_key = min(self._cache, key=lambda k: self._cache[k][1])
        del self._cache[oldest_key]


# Module-level shared cache instance
_kb_cache = KBCache()


def get_shared_kb_cache() -> KBCache:
    """Return the module-level shared KB cache singleton."""
    return _kb_cache


async def run_parallel_stages(
    stages: List[Callable[..., Any]],
    max_concurrency: int = 3,
) -> List[Any]:
    """Run multiple pipeline stages concurrently with a concurrency limit.

    Each entry in *stages* should be an ``async`` callable (coroutine function)
    or a regular callable (which will be run in the default executor).
    Results are returned in the same order as the input list.

    A :class:`asyncio.Semaphore` enforces *max_concurrency*.
    """
    semaphore = asyncio.Semaphore(max_concurrency)
    results: List[Any] = [None] * len(stages)

    async def _run_one(index: int, fn: Callable[..., Any]) -> None:
        async with semaphore:
            if asyncio.iscoroutinefunction(fn):
                results[index] = await fn()
            else:
                loop = asyncio.get_running_loop()
                results[index] = await loop.run_in_executor(None, fn)

    tasks = [
        asyncio.ensure_future(_run_one(i, fn))
        for i, fn in enumerate(stages)
    ]
    await asyncio.gather(*tasks, return_exceptions=False)
    return results


class AsyncQARunner:
    """Asynchronous QA runner that does not block the main production line.

    QA checks are submitted and executed in background tasks.  The main
    pipeline can continue producing while QA results accumulate.
    """

    def __init__(self) -> None:
        self._pending_tasks: Dict[str, asyncio.Task[Any]] = {}
        self._results: Dict[str, Dict[str, Any]] = {}

    async def submit_check(
        self,
        check_id: str,
        check_fn: Callable[..., Any],
        *args: Any,
    ) -> str:
        """Submit a QA check to run asynchronously.

        *check_fn* can be a sync or async callable.  Returns *check_id*.
        """
        async def _wrapper() -> None:
            t0 = time.time()
            try:
                if asyncio.iscoroutinefunction(check_fn):
                    result = await check_fn(*args)
                else:
                    loop = asyncio.get_running_loop()
                    result = await loop.run_in_executor(None, check_fn, *args)
                elapsed_ms = int((time.time() - t0) * 1000)
                self._results[check_id] = {
                    "check_id": check_id,
                    "status": "completed",
                    "result": result,
                    "duration_ms": elapsed_ms,
                    "completed_at": datetime.utcnow().isoformat(),
                }
            except Exception as exc:
                elapsed_ms = int((time.time() - t0) * 1000)
                self._results[check_id] = {
                    "check_id": check_id,
                    "status": "error",
                    "error": str(exc),
                    "duration_ms": elapsed_ms,
                    "completed_at": datetime.utcnow().isoformat(),
                }

        task = asyncio.ensure_future(_wrapper())
        self._pending_tasks[check_id] = task
        return check_id

    async def get_result(
        self,
        check_id: str,
        timeout: float = 30.0,
    ) -> Optional[Dict[str, Any]]:
        """Get the result of an async QA check, waiting up to *timeout* seconds.

        Returns ``None`` if the check is not found or did not finish in time.
        """
        # If already completed, return immediately
        if check_id in self._results:
            return self._results[check_id]

        # Wait for the background task to finish
        task = self._pending_tasks.get(check_id)
        if task is None:
            return None

        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except asyncio.TimeoutError:
            return {
                "check_id": check_id,
                "status": "timeout",
                "error": f"QA check did not complete within {timeout}s",
            }

        return self._results.get(check_id)

    def get_all_results(self) -> Dict[str, Dict[str, Any]]:
        """Return all completed QA check results (keyed by check_id)."""
        return dict(self._results)

    def pending_count(self) -> int:
        """Return the number of checks that have not yet completed."""
        return sum(
            1 for cid, task in self._pending_tasks.items()
            if cid not in self._results and not task.done()
        )
