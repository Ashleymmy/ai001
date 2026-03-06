"""Tests for agent_pipeline.py — 10 tests (async)."""
import pytest

from backend.services.studio.agent_pipeline import (
    PipelineStage,
    PipelineState,
    AgentPipeline,
    create_pipeline,
    _DEFAULT_STAGE_ORDER,
    _PRE_GENERATION_STAGES,
    _STAGE_AGENT_MAP,
)


def test_pipeline_stage_enum_has_20_values():
    stages = list(PipelineStage)
    assert len(stages) == 20
    assert PipelineStage.PLANNING in stages
    assert PipelineStage.COMPLETED in stages


def test_default_stage_order_has_19_entries():
    assert len(_DEFAULT_STAGE_ORDER) == 19
    assert len(_DEFAULT_STAGE_ORDER) == len(list(PipelineStage)) - 1
    assert "completed" not in _DEFAULT_STAGE_ORDER
    assert _DEFAULT_STAGE_ORDER[0] == "planning"
    assert _DEFAULT_STAGE_ORDER[-1] == "audio_generation"


def test_stage_agent_map_covers_all():
    for stage in _DEFAULT_STAGE_ORDER:
        assert stage in _STAGE_AGENT_MAP, f"Missing agent mapping for stage: {stage}"


def test_pipeline_state_advance():
    state = PipelineState(
        pipeline_id="test_pipe",
        series_id="s1",
        episode_id="e1",
    )
    assert state.current_stage == "planning"
    state.advance("planning")
    assert "planning" in state.stages_completed
    assert "planning" not in state.stages_remaining
    assert state.current_stage == "world_building"


def test_pipeline_state_advance_to_completed():
    state = PipelineState(
        pipeline_id="test_pipe",
        series_id="s1",
        episode_id="e1",
        stages_remaining=["audio_generation"],
    )
    state.advance("audio_generation")
    assert state.current_stage == "completed"
    assert state.stages_remaining == []


def test_pipeline_state_to_dict():
    state = PipelineState(pipeline_id="p1", series_id="s1", episode_id="e1")
    d = state.to_dict()
    assert d["pipeline_id"] == "p1"
    assert d["series_id"] == "s1"
    assert d["episode_id"] == "e1"
    assert isinstance(d["stages_remaining"], list)


def test_create_pipeline_factory():
    pipe = create_pipeline("s1", "e1")
    assert isinstance(pipe, AgentPipeline)
    assert pipe.series_id == "s1"
    assert pipe.episode_id == "e1"
    assert pipe.llm_service is None


@pytest.mark.asyncio
async def test_run_episode_no_llm():
    pipe = create_pipeline("s1", "e1")
    state = await pipe.run_episode_pipeline("A hero saves the kingdom.")
    assert state.current_stage == "completed"
    assert len(state.stages_completed) == len(_DEFAULT_STAGE_ORDER)
    assert len(state.stages_remaining) == 0


@pytest.mark.asyncio
async def test_run_pre_generation_no_llm():
    pipe = create_pipeline("s1", "e1")
    result = await pipe.run_pre_generation({"script_excerpt": "A hero saves the kingdom."})
    assert isinstance(result, dict)
    # Should have outputs from pre-generation stages
    assert "planning" in result


@pytest.mark.asyncio
async def test_progress_callback():
    progress_log = []

    def on_progress(stage, status, detail=""):
        progress_log.append((stage, status))

    pipe = create_pipeline("s1", "e1", on_progress=on_progress)
    await pipe.run_episode_pipeline("Test script")
    # Should have multiple progress entries
    assert len(progress_log) > 0
    # Should include started and completed events
    statuses = [s for _, s in progress_log]
    assert "started" in statuses
    assert "completed" in statuses
