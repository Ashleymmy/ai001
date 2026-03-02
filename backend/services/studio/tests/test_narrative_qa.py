"""Tests for narrative_qa.py — 10 tests (async)."""
import pytest

from backend.services.studio.narrative_qa import (
    NarrativeQA,
    QAResult,
    QAIssue,
    _check_character_presence,
    _check_scene_continuity,
    _check_emotion_consistency,
    _check_dialogue_assignment,
    _check_missing_fields,
)


def test_check_character_presence():
    shots = [
        {"id": "s1", "name": "S1", "description": "小明走过来", "prompt": ""},
    ]
    elements = [
        {"id": "char1", "name": "小明", "type": "character"},
    ]
    issues = _check_character_presence(shots, elements)
    # Character mentioned but no [SE_] ref → should raise info
    assert len(issues) >= 1
    assert issues[0].severity == "info"


def test_check_scene_continuity_large_jump():
    shots = [
        {"id": "s1", "name": "S1", "shot_size": "extreme_long", "segment_name": "seg1"},
        {"id": "s2", "name": "S2", "shot_size": "extreme_close", "segment_name": "seg1"},
    ]
    issues = _check_scene_continuity(shots)
    assert len(issues) >= 1
    assert issues[0].severity == "warning"
    assert "跳跃" in issues[0].description


def test_check_scene_continuity_no_jump():
    shots = [
        {"id": "s1", "name": "S1", "shot_size": "medium", "segment_name": "seg1"},
        {"id": "s2", "name": "S2", "shot_size": "medium_close", "segment_name": "seg1"},
    ]
    issues = _check_scene_continuity(shots)
    assert len(issues) == 0


def test_check_emotion_consistency_contradiction():
    shots = [
        {"id": "s1", "name": "S1", "emotion": "开心", "description": "绝望的眼神", "prompt": ""},
    ]
    issues = _check_emotion_consistency(shots)
    assert len(issues) >= 1
    assert issues[0].severity == "warning"


def test_check_dialogue_assignment():
    shots = [
        {"id": "s1", "name": "S1", "dialogue_script": "你好，请问有什么事？"},
    ]
    elements = [
        {"id": "char1", "name": "小明", "type": "character"},
    ]
    issues = _check_dialogue_assignment(shots, elements)
    assert len(issues) >= 1
    assert issues[0].severity == "info"


def test_check_missing_fields_error():
    shots = [
        {"id": "s1", "name": "S1", "description": "", "prompt": "", "shot_size": "medium"},
    ]
    issues = _check_missing_fields(shots)
    # Missing both description and prompt → error
    assert any(i.severity == "error" for i in issues)


def test_check_missing_fields_no_shot_size():
    shots = [
        {"id": "s1", "name": "S1", "description": "A scene", "prompt": "prompt text", "shot_size": ""},
    ]
    issues = _check_missing_fields(shots)
    # Missing shot_size → info
    assert any(i.severity == "info" for i in issues)


@pytest.mark.asyncio
async def test_check_episode_all_valid():
    qa = NarrativeQA()
    shots = [
        {
            "id": "s1", "name": "S1", "sort_order": 1,
            "description": "A nice scene", "prompt": "beautiful landscape",
            "shot_size": "medium", "segment_name": "seg1",
        },
    ]
    elements = []
    result = await qa.check_episode(shots, elements)
    assert isinstance(result, QAResult)
    assert result.check_type == "narrative"
    assert result.checked_items == 1


@pytest.mark.asyncio
async def test_check_episode_with_issues():
    qa = NarrativeQA()
    shots = [
        {"id": "s1", "name": "S1", "description": "", "prompt": "", "shot_size": "", "segment_name": "seg1"},
    ]
    elements = []
    result = await qa.check_episode(shots, elements)
    assert result.passed is False or len(result.issues) > 0


@pytest.mark.asyncio
async def test_qa_result_to_dict():
    qa = NarrativeQA()
    result = await qa.check_episode(
        [{"id": "s1", "name": "S1", "description": "ok", "prompt": "ok", "shot_size": "medium", "segment_name": "seg1"}],
        [],
    )
    d = result.to_dict()
    assert "passed" in d
    assert "score" in d
    assert "issues" in d
    assert isinstance(d["issues"], list)
