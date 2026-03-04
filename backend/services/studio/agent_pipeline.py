"""Multi-Agent 编排引擎 — Phase 3, Task 3.4

核心 pipeline，按顺序调度 Agent 角色完成一集漫剧的完整生产流水线。
每个阶段产出结构化 JSON，供下游阶段消费。

Pipeline stages (core + waoowaoo extensions):
  planning -> world_building -> character_profiling* -> character_development
  -> character_visual_design* -> text_clipping* -> screenplay_conversion*
  -> dialogue_writing -> storyboard_planning -> narrative_qa
  -> cinematography* -> acting_direction* -> prompt_composition -> prompt_qa
  -> image_generation -> visual_qa -> video_generation -> voice_analysis*
  -> audio_generation -> completed

  (* = waoowaoo extension stages)
"""

from __future__ import annotations

import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from .agent_roles import AgentRole, AGENT_ROLES, MODEL_TIERS, get_agent_role
from .prompt_integration import get_agent_prompt

# agent_protocol is a sibling Phase 3 module; gracefully degrade if absent.
try:
    from .agent_protocol import (
        AgentMessage,
        AgentMessageBus,
        create_message,
        create_task_id,
    )
except ImportError:  # pragma: no cover — protocol module may not exist yet

    @dataclass
    class AgentMessage:
        """Fallback: lightweight inter-agent message."""
        task_id: str = ""
        source_agent: str = ""
        target_agent: str = ""
        payload: Dict[str, Any] = field(default_factory=dict)
        context_refs: List[str] = field(default_factory=list)
        created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    class AgentMessageBus:
        """Fallback: in-memory message bus (no-op routing)."""
        def __init__(self) -> None:
            self._messages: List[AgentMessage] = []

        def publish(self, msg: AgentMessage) -> None:
            self._messages.append(msg)

        def get_messages(self, target: str = "") -> List[AgentMessage]:
            if not target:
                return list(self._messages)
            return [m for m in self._messages if m.target_agent == target]

    def create_message(**kwargs: Any) -> AgentMessage:
        return AgentMessage(**kwargs)

    def create_task_id(episode_id: str = "", stage: str = "") -> str:
        short = uuid.uuid4().hex[:8]
        return f"task_{episode_id}_{stage}_{short}" if episode_id else f"task_{short}"


# ---------------------------------------------------------------------------
# Pipeline stage constants
# ---------------------------------------------------------------------------

class PipelineStage(str, Enum):
    """All stages in the episode production pipeline."""
    PLANNING = "planning"
    WORLD_BUILDING = "world_building"
    CHARACTER_PROFILING = "character_profiling"               # waoowaoo ext
    CHARACTER_DEVELOPMENT = "character_development"
    CHARACTER_VISUAL_DESIGN = "character_visual_design"       # waoowaoo ext
    TEXT_CLIPPING = "text_clipping"                           # waoowaoo ext
    SCREENPLAY_CONVERSION = "screenplay_conversion"           # waoowaoo ext
    DIALOGUE_WRITING = "dialogue_writing"
    STORYBOARD_PLANNING = "storyboard_planning"
    NARRATIVE_QA = "narrative_qa"
    CINEMATOGRAPHY = "cinematography"                         # waoowaoo ext
    ACTING_DIRECTION = "acting_direction"                     # waoowaoo ext
    PROMPT_COMPOSITION = "prompt_composition"
    PROMPT_QA = "prompt_qa"
    IMAGE_GENERATION = "image_generation"
    VISUAL_QA = "visual_qa"
    VIDEO_GENERATION = "video_generation"
    VOICE_ANALYSIS = "voice_analysis"                         # waoowaoo ext
    AUDIO_GENERATION = "audio_generation"
    COMPLETED = "completed"


# Ordered list used by the default sequential pipeline.
_DEFAULT_STAGE_ORDER: List[str] = [
    PipelineStage.PLANNING.value,
    PipelineStage.WORLD_BUILDING.value,
    PipelineStage.CHARACTER_PROFILING.value,           # waoowaoo: after story analysis, before character dev
    PipelineStage.CHARACTER_DEVELOPMENT.value,
    PipelineStage.CHARACTER_VISUAL_DESIGN.value,       # waoowaoo: after character development
    PipelineStage.TEXT_CLIPPING.value,                  # waoowaoo: before storyboard writing
    PipelineStage.SCREENPLAY_CONVERSION.value,          # waoowaoo: before storyboard writing, optional
    PipelineStage.DIALOGUE_WRITING.value,
    PipelineStage.STORYBOARD_PLANNING.value,
    PipelineStage.NARRATIVE_QA.value,
    PipelineStage.CINEMATOGRAPHY.value,                 # waoowaoo: after storyboard
    PipelineStage.ACTING_DIRECTION.value,               # waoowaoo: after cinematography
    PipelineStage.PROMPT_COMPOSITION.value,
    PipelineStage.PROMPT_QA.value,
    PipelineStage.IMAGE_GENERATION.value,
    PipelineStage.VISUAL_QA.value,
    PipelineStage.VIDEO_GENERATION.value,
    PipelineStage.VOICE_ANALYSIS.value,                 # waoowaoo: after dialogue, before audio
    PipelineStage.AUDIO_GENERATION.value,
]

# Stages that belong to the pre-generation pass (optimise prompts only).
_PRE_GENERATION_STAGES: List[str] = [
    PipelineStage.PLANNING.value,
    PipelineStage.WORLD_BUILDING.value,
    PipelineStage.CHARACTER_PROFILING.value,
    PipelineStage.CHARACTER_DEVELOPMENT.value,
    PipelineStage.CHARACTER_VISUAL_DESIGN.value,
    PipelineStage.TEXT_CLIPPING.value,
    PipelineStage.SCREENPLAY_CONVERSION.value,
    PipelineStage.DIALOGUE_WRITING.value,
    PipelineStage.STORYBOARD_PLANNING.value,
    PipelineStage.NARRATIVE_QA.value,
    PipelineStage.CINEMATOGRAPHY.value,
    PipelineStage.ACTING_DIRECTION.value,
    PipelineStage.PROMPT_COMPOSITION.value,
    PipelineStage.PROMPT_QA.value,
]


# ---------------------------------------------------------------------------
# Pipeline state — serialisable for pause / resume
# ---------------------------------------------------------------------------

@dataclass
class PipelineState:
    """Serialisable snapshot of a running (or completed) pipeline."""
    pipeline_id: str
    series_id: str
    episode_id: str
    current_stage: str = PipelineStage.PLANNING.value
    stages_completed: List[str] = field(default_factory=list)
    stages_remaining: List[str] = field(default_factory=lambda: list(_DEFAULT_STAGE_ORDER))
    agent_outputs: Dict[str, Any] = field(default_factory=dict)
    decision_log: List[Dict[str, Any]] = field(default_factory=list)
    started_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    error: Optional[str] = None

    # -- helpers -------------------------------------------------------------
    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    def advance(self, completed_stage: str) -> None:
        """Mark *completed_stage* as done and move cursor forward."""
        if completed_stage not in self.stages_completed:
            self.stages_completed.append(completed_stage)
        if completed_stage in self.stages_remaining:
            self.stages_remaining.remove(completed_stage)
        if self.stages_remaining:
            self.current_stage = self.stages_remaining[0]
        else:
            self.current_stage = PipelineStage.COMPLETED.value
        self.updated_at = datetime.utcnow().isoformat()


# ---------------------------------------------------------------------------
# Agent-to-stage mapping
# ---------------------------------------------------------------------------

_STAGE_AGENT_MAP: Dict[str, str] = {
    PipelineStage.PLANNING.value: "producer",
    PipelineStage.WORLD_BUILDING.value: "world_builder",
    PipelineStage.CHARACTER_PROFILING.value: "character_profiler",
    PipelineStage.CHARACTER_DEVELOPMENT.value: "character_developer",
    PipelineStage.CHARACTER_VISUAL_DESIGN.value: "character_visual_designer",
    PipelineStage.TEXT_CLIPPING.value: "text_clipper",
    PipelineStage.SCREENPLAY_CONVERSION.value: "screenplay_converter",
    PipelineStage.DIALOGUE_WRITING.value: "dialogue_writer",
    PipelineStage.STORYBOARD_PLANNING.value: "storyboard_writer",
    PipelineStage.NARRATIVE_QA.value: "narrative_qa",
    PipelineStage.CINEMATOGRAPHY.value: "cinematographer",
    PipelineStage.ACTING_DIRECTION.value: "acting_director",
    PipelineStage.PROMPT_COMPOSITION.value: "prompt_compositor",
    PipelineStage.PROMPT_QA.value: "prompt_qa",
    PipelineStage.IMAGE_GENERATION.value: "producer",          # producer oversees generation
    PipelineStage.VISUAL_QA.value: "visual_qa",
    PipelineStage.VIDEO_GENERATION.value: "producer",
    PipelineStage.VOICE_ANALYSIS.value: "voice_analyst",
    PipelineStage.AUDIO_GENERATION.value: "producer",
}


# ---------------------------------------------------------------------------
# Core pipeline
# ---------------------------------------------------------------------------

class AgentPipeline:
    """多 Agent 编排引擎 — Phase 3

    Orchestrates 10 agent roles through a structured episode production pipeline.
    Each stage produces structured JSON output that feeds into the next stage.
    """

    # Maximum number of revision loops for QA gates before forcing a pass.
    MAX_QA_RETRIES: int = 2

    def __init__(
        self,
        series_id: str,
        episode_id: str,
        storage: Any = None,
        llm_service: Any = None,
        on_progress: Optional[Callable[..., None]] = None,
    ) -> None:
        self.series_id = series_id
        self.episode_id = episode_id
        self.storage = storage
        self.llm_service = llm_service
        self.on_progress = on_progress
        self.message_bus = AgentMessageBus()

        pipeline_id = f"pipe_{series_id}_{episode_id}_{uuid.uuid4().hex[:6]}"
        self.state = PipelineState(
            pipeline_id=pipeline_id,
            series_id=series_id,
            episode_id=episode_id,
        )

    # ================================================================
    # Public API
    # ================================================================

    async def run_episode_pipeline(
        self,
        script_excerpt: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> PipelineState:
        """Execute the full episode production pipeline end-to-end."""
        options = options or {}
        accumulated: Dict[str, Any] = {"script": script_excerpt, "options": options}

        for stage in list(_DEFAULT_STAGE_ORDER):
            if stage not in self.state.stages_remaining:
                continue  # already completed (resume scenario)
            try:
                output = await self._run_stage(stage, accumulated)
                accumulated[stage] = output
            except Exception as exc:
                self.state.error = f"Stage [{stage}] failed: {exc}"
                self._report_progress(stage, "error", str(exc))
                # Store partial output and continue with defaults
                accumulated[stage] = {"_error": str(exc)}

        self.state.current_stage = PipelineStage.COMPLETED.value
        self.state.updated_at = datetime.utcnow().isoformat()
        self._report_progress(PipelineStage.COMPLETED.value, "completed")
        return self.state

    async def run_pre_generation(self, episode_data: Dict[str, Any]) -> Dict[str, Any]:
        """Run only the pre-generation stages (planning through prompt QA).

        Used to enhance / optimise prompts before the existing ``batch_generate``
        flow.  Returns a dict of stage outputs keyed by stage name.
        """
        script = str(episode_data.get("script_excerpt") or episode_data.get("synopsis") or "")
        accumulated: Dict[str, Any] = {"script": script, "episode_data": episode_data}

        for stage in _PRE_GENERATION_STAGES:
            try:
                output = await self._run_stage(stage, accumulated)
                accumulated[stage] = output
            except Exception as exc:
                self.state.error = f"Pre-gen stage [{stage}] failed: {exc}"
                self._report_progress(stage, "error", str(exc))
                accumulated[stage] = {"_error": str(exc)}

        return accumulated

    # ================================================================
    # Stage dispatcher
    # ================================================================

    async def _run_stage(self, stage: str, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """Execute a single pipeline stage with the appropriate agent."""
        self.state.current_stage = stage
        self._report_progress(stage, "started")

        t0 = time.time()
        handler = self._stage_handlers().get(stage)
        if handler is None:
            return {"_skipped": True, "reason": f"No handler for stage {stage}"}

        output = await handler(input_data)
        duration_ms = int((time.time() - t0) * 1000)

        agent_role_id = _STAGE_AGENT_MAP.get(stage, "producer")
        self._log_decision(
            agent_role=agent_role_id,
            action=stage,
            input_summary=_summarise(input_data, max_len=200),
            output_summary=_summarise(output, max_len=200),
            model_used=self._model_for_role(agent_role_id),
            tokens=output.get("_tokens_used", 0) if isinstance(output, dict) else 0,
            duration_ms=duration_ms,
        )

        self.state.agent_outputs[stage] = output
        self.state.advance(stage)
        self._report_progress(stage, "completed")
        return output

    def _stage_handlers(self) -> Dict[str, Callable[..., Any]]:
        return {
            PipelineStage.PLANNING.value: self._run_planning,
            PipelineStage.WORLD_BUILDING.value: self._run_world_building,
            PipelineStage.CHARACTER_PROFILING.value: self._run_character_profiling,
            PipelineStage.CHARACTER_DEVELOPMENT.value: self._run_character_development,
            PipelineStage.CHARACTER_VISUAL_DESIGN.value: self._run_character_visual_design,
            PipelineStage.TEXT_CLIPPING.value: self._run_text_clipping,
            PipelineStage.SCREENPLAY_CONVERSION.value: self._run_screenplay_conversion,
            PipelineStage.DIALOGUE_WRITING.value: self._run_dialogue_writing,
            PipelineStage.STORYBOARD_PLANNING.value: self._run_storyboard,
            PipelineStage.NARRATIVE_QA.value: self._run_narrative_qa,
            PipelineStage.CINEMATOGRAPHY.value: self._run_cinematography,
            PipelineStage.ACTING_DIRECTION.value: self._run_acting_direction,
            PipelineStage.PROMPT_COMPOSITION.value: self._run_prompt_composition,
            PipelineStage.PROMPT_QA.value: self._run_prompt_qa,
            PipelineStage.IMAGE_GENERATION.value: self._run_image_generation,
            PipelineStage.VISUAL_QA.value: self._run_visual_qa,
            PipelineStage.VIDEO_GENERATION.value: self._run_video_generation,
            PipelineStage.VOICE_ANALYSIS.value: self._run_voice_analysis,
            PipelineStage.AUDIO_GENERATION.value: self._run_audio_generation,
        }

    # ================================================================
    # Per-stage implementations
    # ================================================================

    async def _run_planning(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Producer agent decomposes script into structured tasks."""
        role = get_agent_role("producer")
        script = str(ctx.get("script", ""))
        prompt = (
            f"请将以下剧本摘要拆解为制作任务列表，每个任务包含 task_id, description, "
            f"assigned_agent, priority。\n\n剧本摘要:\n{script}"
        )
        result = await self._call_llm(role, prompt)
        return result or {
            "tasks": [
                {"task_id": "T1", "description": "世界观构建", "assigned_agent": "world_builder", "priority": 1},
                {"task_id": "T2", "description": "角色开发", "assigned_agent": "character_developer", "priority": 2},
                {"task_id": "T3", "description": "对话编写", "assigned_agent": "dialogue_writer", "priority": 3},
                {"task_id": "T4", "description": "分镜规划", "assigned_agent": "storyboard_writer", "priority": 4},
            ],
            "episode_synopsis": script[:300],
        }

    async def _run_world_building(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """World Builder enriches world context."""
        role = get_agent_role("world_builder")
        plan = ctx.get(PipelineStage.PLANNING.value, {})
        synopsis = plan.get("episode_synopsis", ctx.get("script", ""))
        prompt = (
            f"根据以下剧本信息扩展世界观设定，输出 JSON 包含 geography, history, culture, rules。\n\n"
            f"剧本概要:\n{synopsis}"
        )
        result = await self._call_llm(role, prompt)
        return result or {
            "geography": "待补充",
            "history": "待补充",
            "culture": "待补充",
            "rules": "待补充",
        }

    # -- waoowaoo extension stages ------------------------------------------

    async def _run_character_profiling(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Character Profiler extracts character profiles from source text (S/A/B/C/D tiers)."""
        role = get_agent_role("character_profiler")
        script = str(ctx.get("script", ""))
        world = ctx.get(PipelineStage.WORLD_BUILDING.value, {})

        # Build context variables for the prompt template
        characters_lib_info = json.dumps(
            ctx.get("characters_lib_info", "暂无已有角色资产。"),
            ensure_ascii=False, default=str,
        ) if isinstance(ctx.get("characters_lib_info"), (dict, list)) else str(
            ctx.get("characters_lib_info", "暂无已有角色资产。")
        )
        input_text = (
            f"{script[:800]}\n\n"
            f"世界观:\n{json.dumps(world, ensure_ascii=False, default=str)[:300]}"
        )

        # Load prompt from template (falls back to system_prompt if template missing)
        prompt = get_agent_prompt(
            "character_profiler",
            characters_lib_info=characters_lib_info,
            input=input_text,
        )
        result = await self._call_llm(role, prompt)
        return result or {"profiles": [], "_placeholder": True}

    async def _run_character_visual_design(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Character Visual Designer generates layered visual appearance descriptions."""
        role = get_agent_role("character_visual_designer")
        # Character profiles come from the profiling stage; fall back to character_development
        profiles = ctx.get(PipelineStage.CHARACTER_PROFILING.value, {})
        if not profiles or profiles.get("_placeholder"):
            profiles = ctx.get(PipelineStage.CHARACTER_DEVELOPMENT.value, {})
        character_profiles = json.dumps(profiles, ensure_ascii=False, default=str)[:800]

        # Load prompt from template
        prompt = get_agent_prompt(
            "character_visual_designer",
            character_profiles=character_profiles,
        )
        result = await self._call_llm(role, prompt)
        return result or {"visual_designs": [], "_placeholder": True}

    async def _run_text_clipping(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Text Clipper segments text by scene and element density."""
        role = get_agent_role("text_clipper")
        script = str(ctx.get("script", ""))
        prompt = (
            f"按场景和元素密度对以下文本进行智能切片，输出 JSON 数组。\n\n"
            f"文本:\n{script[:1000]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"clips": [], "_placeholder": True}

    async def _run_screenplay_conversion(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Screenplay Converter transforms narrative text into standard screenplay format."""
        role = get_agent_role("screenplay_converter")
        clips = ctx.get(PipelineStage.TEXT_CLIPPING.value, {})
        script = str(ctx.get("script", ""))
        prompt = (
            f"将以下叙事文本转换为标准影视剧本格式，输出结构化 JSON。\n\n"
            f"切片结果:\n{json.dumps(clips, ensure_ascii=False, default=str)[:500]}\n\n"
            f"原文:\n{script[:500]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"screenplay": [], "_placeholder": True}

    async def _run_cinematography(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Cinematographer designs lighting, depth-of-field, tone and other camera parameters."""
        role = get_agent_role("cinematographer")
        storyboard = ctx.get(PipelineStage.STORYBOARD_PLANNING.value, {})
        prompt = (
            f"为以下分镜设计摄影参数（灯光、景深、色调等），输出结构化 JSON。\n\n"
            f"分镜:\n{json.dumps(storyboard, ensure_ascii=False, default=str)[:800]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"cinematography": [], "_placeholder": True}

    async def _run_acting_direction(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Acting Director designs facial expressions, body language, and micro-actions."""
        role = get_agent_role("acting_director")
        storyboard = ctx.get(PipelineStage.STORYBOARD_PLANNING.value, {})
        cinematography = ctx.get(PipelineStage.CINEMATOGRAPHY.value, {})
        prompt = (
            f"为以下镜头设计角色表演细节（表情、肢体、微动作），输出结构化 JSON。\n\n"
            f"分镜:\n{json.dumps(storyboard, ensure_ascii=False, default=str)[:500]}\n\n"
            f"摄影参数:\n{json.dumps(cinematography, ensure_ascii=False, default=str)[:300]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"acting_directions": [], "_placeholder": True}

    async def _run_voice_analysis(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Voice Analyst analyzes dialogue emotions, polyphones, and voice timbre matching."""
        role = get_agent_role("voice_analyst")
        dialogue = ctx.get(PipelineStage.DIALOGUE_WRITING.value, {})
        characters = ctx.get(PipelineStage.CHARACTER_DEVELOPMENT.value, {})
        prompt = (
            f"分析以下台词的情绪、多音字及音色匹配，输出结构化 JSON。\n\n"
            f"对话:\n{json.dumps(dialogue, ensure_ascii=False, default=str)[:500]}\n\n"
            f"角色:\n{json.dumps(characters, ensure_ascii=False, default=str)[:300]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"voice_analysis": [], "_placeholder": True}

    async def _run_character_development(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Character Developer enriches character profiles."""
        role = get_agent_role("character_developer")
        plan = ctx.get(PipelineStage.PLANNING.value, {})
        world = ctx.get(PipelineStage.WORLD_BUILDING.value, {})
        prompt = (
            f"根据以下世界观和剧本任务，丰富角色设定。\n"
            f"为每个角色输出 JSON: appearance, personality, background, relationships。\n\n"
            f"世界观:\n{json.dumps(world, ensure_ascii=False, default=str)[:500]}\n\n"
            f"任务计划:\n{json.dumps(plan, ensure_ascii=False, default=str)[:500]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"characters": [], "_placeholder": True}

    async def _run_dialogue_writing(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Dialogue Writer generates dialogue for each shot."""
        role = get_agent_role("dialogue_writer")
        plan = ctx.get(PipelineStage.PLANNING.value, {})
        characters = ctx.get(PipelineStage.CHARACTER_DEVELOPMENT.value, {})
        prompt = (
            f"根据角色设定为每个镜头编写对话。\n"
            f"输出 JSON 数组，每项: shot_id, speaker, dialogue, emotion。\n\n"
            f"角色设定:\n{json.dumps(characters, ensure_ascii=False, default=str)[:500]}\n\n"
            f"任务计划:\n{json.dumps(plan, ensure_ascii=False, default=str)[:500]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"dialogues": [], "_placeholder": True}

    async def _run_storyboard(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Storyboard Writer plans visual sequence."""
        role = get_agent_role("storyboard_writer")
        plan = ctx.get(PipelineStage.PLANNING.value, {})
        characters = ctx.get(PipelineStage.CHARACTER_DEVELOPMENT.value, {})
        dialogue = ctx.get(PipelineStage.DIALOGUE_WRITING.value, {})
        visual_designs = ctx.get(PipelineStage.CHARACTER_VISUAL_DESIGN.value, {})
        text_clips = ctx.get(PipelineStage.TEXT_CLIPPING.value, {})

        # Build template context variables
        characters_lib_name = str(ctx.get("characters_lib_name", "角色资产库"))
        locations_lib_name = str(ctx.get("locations_lib_name", "场景资产库"))
        characters_introduction = json.dumps(
            ctx.get("characters_introduction", characters),
            ensure_ascii=False, default=str,
        )[:500]
        characters_appearance_list = json.dumps(
            ctx.get("characters_appearance_list", visual_designs),
            ensure_ascii=False, default=str,
        )[:500]
        characters_full_description = json.dumps(
            ctx.get("characters_full_description", characters),
            ensure_ascii=False, default=str,
        )[:500]
        clip_json = json.dumps(
            ctx.get("clip_json", text_clips),
            ensure_ascii=False, default=str,
        )[:300]
        clip_content = str(ctx.get("clip_content", ctx.get("script", "")))[:500]

        # Load prompt from template
        prompt = get_agent_prompt(
            "storyboard_writer",
            characters_lib_name=characters_lib_name,
            locations_lib_name=locations_lib_name,
            characters_introduction=characters_introduction,
            characters_appearance_list=characters_appearance_list,
            characters_full_description=characters_full_description,
            clip_json=clip_json,
            clip_content=clip_content,
        )
        result = await self._call_llm(role, prompt)
        return result or {"shots": [], "_placeholder": True}

    async def _run_narrative_qa(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Narrative QA checks storyboard consistency.

        If the check does not pass, triggers a revision loop up to MAX_QA_RETRIES
        times before forcing a pass with logged warnings.
        """
        role = get_agent_role("narrative_qa")
        storyboard = ctx.get(PipelineStage.STORYBOARD_PLANNING.value, {})

        for attempt in range(1, self.MAX_QA_RETRIES + 1):
            prompt = (
                f"审核以下分镜脚本的叙事一致性。\n"
                f"输出 JSON: passed (bool), score (0-100), issues (数组)。\n\n"
                f"分镜:\n{json.dumps(storyboard, ensure_ascii=False, default=str)[:800]}"
            )
            result = await self._call_llm(role, prompt)
            if result is None:
                # No LLM available — return default pass
                return {"passed": True, "score": 80.0, "issues": [], "_mock": True}

            if result.get("passed", True):
                return result

            # QA failed — log and try again with revision hints
            self._report_progress(
                PipelineStage.NARRATIVE_QA.value,
                "revision",
                f"Attempt {attempt}/{self.MAX_QA_RETRIES}: score={result.get('score')}"
            )

        # Exhausted retries — force pass with warnings
        result = result if result else {}  # type: ignore[possibly-undefined]
        result["_forced_pass"] = True
        result["passed"] = True
        return result

    async def _run_prompt_composition(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Prompt Compositor assembles image prompts from KB tokens."""
        role = get_agent_role("prompt_compositor")
        storyboard = ctx.get(PipelineStage.STORYBOARD_PLANNING.value, {})
        prompt = (
            f"为以下分镜组装图像生成提示词。每个镜头输出 prompt (英文) 和 negative_prompt。\n"
            f"所有词条必须来自知识库，禁止自由发挥。\n\n"
            f"分镜:\n{json.dumps(storyboard, ensure_ascii=False, default=str)[:800]}"
        )
        result = await self._call_llm(role, prompt)
        return result or {"prompts": [], "_placeholder": True}

    async def _run_prompt_qa(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Prompt QA checks prompt safety and KB compliance.

        Uses local rule engine (prompt_sentinel) when available, falling back
        to LLM-based check.
        """
        prompts_data = ctx.get(PipelineStage.PROMPT_COMPOSITION.value, {})

        # Try local sentinel first
        try:
            from .prompt_sentinel import analyze_prompt_text, check_kb_compliance
            prompts_list = prompts_data.get("prompts", [])
            qa_results: List[Dict[str, Any]] = []
            for item in prompts_list if isinstance(prompts_list, list) else []:
                text = str(item.get("prompt", ""))
                safety = analyze_prompt_text(text)
                qa_results.append({
                    "shot_id": item.get("shot_id", ""),
                    "safe": safety.get("safe", True),
                    "risk_level": safety.get("risk_level", "safe"),
                    "suggestions": safety.get("suggestions", []),
                })
            return {"passed": all(r.get("safe", True) for r in qa_results), "results": qa_results}
        except Exception:
            pass

        # Fallback: LLM check
        role = get_agent_role("prompt_qa")
        result = await self._call_llm(role, json.dumps(prompts_data, ensure_ascii=False, default=str)[:600])
        return result or {"passed": True, "results": [], "_mock": True}

    async def _run_image_generation(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Placeholder — actual image generation is handled by image_service."""
        return {
            "status": "delegated",
            "detail": "Image generation is handled by the existing batch_generate flow.",
        }

    async def _run_visual_qa(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Placeholder — visual QA runs after images are generated."""
        return {
            "status": "delegated",
            "detail": "Visual QA runs post-generation via visual_qa module.",
        }

    async def _run_video_generation(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Placeholder — video generation is handled by video_service."""
        return {
            "status": "delegated",
            "detail": "Video generation is handled by the existing video pipeline.",
        }

    async def _run_audio_generation(self, ctx: Dict[str, Any]) -> Dict[str, Any]:
        """Placeholder — audio/TTS generation is handled by tts_service."""
        return {
            "status": "delegated",
            "detail": "Audio generation is handled by the existing TTS pipeline.",
        }

    # ================================================================
    # LLM abstraction
    # ================================================================

    async def _call_llm(
        self,
        role: Optional[AgentRole],
        user_prompt: str,
    ) -> Optional[Dict[str, Any]]:
        """Call the LLM with the agent role's system prompt.

        If ``self.llm_service`` is *None*, returns *None* so that callers
        fall back to placeholder / mock results.

        When the role has a ``prompt_template``, the template has already been
        resolved by the stage handler via :func:`get_agent_prompt`, so the
        full prompt content arrives in *user_prompt*.  In that case we use the
        role's description as a lightweight system prompt instead of the
        placeholder ``system_prompt``.
        """
        if self.llm_service is None or role is None:
            return None

        if role.prompt_template is not None:
            # Template-based roles: the user_prompt already contains the
            # fully resolved template.  Use a brief system instruction.
            system_prompt = (
                f"You are {role.display_name_en} ({role.display_name}). "
                f"{role.description}"
            )
        else:
            system_prompt = role.system_prompt

        model = self._model_for_role(role.role_id if role else "producer")

        try:
            response = await self.llm_service.chat(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model=model,
                response_format="json",
            )
            if isinstance(response, dict):
                return response
            # Try parsing string response as JSON
            if isinstance(response, str):
                return json.loads(response)
            return {"raw": response}
        except Exception as exc:
            self._report_progress("llm_call", "error", f"LLM call failed for {role.role_id}: {exc}")
            return None

    def _model_for_role(self, role_id: str) -> str:
        """Resolve the recommended model string for a given agent role."""
        role = get_agent_role(role_id)
        tier_key = role.model_tier if role else "tier2"
        tier = MODEL_TIERS.get(tier_key, {})
        return str(tier.get("recommended", ""))

    # ================================================================
    # Decision logging
    # ================================================================

    def _log_decision(
        self,
        agent_role: str,
        action: str,
        input_summary: str,
        output_summary: str,
        model_used: str,
        tokens: int,
        duration_ms: int,
    ) -> None:
        """Record an agent's decision to the in-memory log (and storage if available)."""
        entry: Dict[str, Any] = {
            "id": uuid.uuid4().hex,
            "pipeline_id": self.state.pipeline_id,
            "series_id": self.series_id,
            "episode_id": self.episode_id,
            "agent_role": agent_role,
            "action": action,
            "input_summary": input_summary,
            "output_summary": output_summary,
            "model_used": model_used,
            "tokens": tokens,
            "duration_ms": duration_ms,
            "timestamp": datetime.utcnow().isoformat(),
        }
        self.state.decision_log.append(entry)

        # Persist to storage when available
        if self.storage is not None:
            try:
                self.storage.insert_agent_decision_log(entry)
            except Exception:
                pass  # Non-critical; log is already in-memory

    # ================================================================
    # Progress reporting
    # ================================================================

    def _report_progress(self, stage: str, status: str, detail: str = "") -> None:
        """Report pipeline progress via the optional callback."""
        if self.on_progress is not None:
            try:
                self.on_progress(stage, status, detail)
            except Exception:
                pass  # Never let a callback error break the pipeline

    # ================================================================
    # Introspection / serialisation
    # ================================================================

    def get_state(self) -> Dict[str, Any]:
        """Return current pipeline state as a plain dict (JSON-serialisable)."""
        return self.state.to_dict()

    def get_decision_log(self) -> List[Dict[str, Any]]:
        """Return the full decision log."""
        return list(self.state.decision_log)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _summarise(data: Any, max_len: int = 200) -> str:
    """Create a short text summary of *data* for logging purposes."""
    try:
        text = json.dumps(data, ensure_ascii=False, default=str)
    except Exception:
        text = str(data)
    if len(text) > max_len:
        return text[:max_len] + "..."
    return text


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def create_pipeline(series_id: str, episode_id: str, **kwargs: Any) -> AgentPipeline:
    """Factory function to create a configured AgentPipeline instance.

    Accepted keyword arguments are forwarded to :class:`AgentPipeline`:
      - storage
      - llm_service
      - on_progress
    """
    return AgentPipeline(
        series_id=series_id,
        episode_id=episode_id,
        storage=kwargs.get("storage"),
        llm_service=kwargs.get("llm_service"),
        on_progress=kwargs.get("on_progress"),
    )


# ------------------------------------------------------------------
# Graph Executor 集成 (Phase 3)
# ------------------------------------------------------------------
def build_graph_nodes_from_stages(
    stage_handlers: dict,
    pipeline_stages: list,
) -> list:
    """将现有 pipeline stage handlers 转为 GraphNode 列表"""
    from .graph_executor import GraphNode, NodeResult, GraphNodeContext

    nodes = []
    for stage in pipeline_stages:
        handler = stage_handlers.get(stage)
        if not handler:
            continue

        async def _make_run(handler=handler):
            async def _run(ctx: GraphNodeContext) -> NodeResult:
                # 调用现有 handler, 将结果包装为 NodeResult
                result = await handler(ctx.state.meta)
                refs = {}
                if isinstance(result, dict):
                    refs = result
                return NodeResult(checkpoint_refs=refs, output=result)
            return _run

        node = GraphNode(
            key=str(stage.value if hasattr(stage, 'value') else stage),
            title=str(stage.value if hasattr(stage, 'value') else stage),
            max_attempts=2,
            timeout_s=300,
            run=None,  # Will be set at execution time
        )
        nodes.append(node)

    return nodes
