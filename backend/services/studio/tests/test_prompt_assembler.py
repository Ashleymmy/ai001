"""Tests for prompt_assembler.py — 10 tests."""
import json

from backend.services.studio.prompt_assembler import PromptAssembler
from backend.services.studio.knowledge_base import KnowledgeBase
from backend.services.studio.constants import DEFAULT_NEGATIVE_PROMPT


def test_assemble_character_tokens(tmp_storage, sample_series, sample_character_element, sample_kb):
    sample_kb.sync_character_from_element(sample_character_element["id"])
    assembler = PromptAssembler(sample_kb)
    tokens = assembler.assemble_character_tokens(sample_character_element["id"])
    assert isinstance(tokens, str)
    assert len(tokens) > 0


def test_assemble_character_tokens_fallback(tmp_storage, sample_series, sample_character_element, sample_kb):
    # Without syncing, should fall back to raw description
    assembler = PromptAssembler(sample_kb)
    tokens = assembler.assemble_character_tokens(sample_character_element["id"])
    assert isinstance(tokens, str)
    # Either KB tokens or fallback description
    assert len(tokens) > 0


def test_assemble_scene_tokens(tmp_storage, sample_series, sample_scene_element, sample_kb):
    sample_kb.sync_scene_from_element(sample_scene_element["id"])
    assembler = PromptAssembler(sample_kb)
    tokens = assembler.assemble_scene_tokens(sample_scene_element["id"])
    assert isinstance(tokens, str)
    assert len(tokens) > 0


def test_inject_mood_builtin(sample_kb, sample_assembler):
    result = sample_assembler.inject_mood("tense")
    assert isinstance(result, str)
    assert "contrast" in result.lower() or "tension" in result.lower()


def test_inject_mood_unknown(sample_kb, sample_assembler):
    result = sample_assembler.inject_mood("nonexistent_mood_xyz")
    assert result == ""


def test_inject_cinematography(sample_assembler):
    shot = {"shot_size": "medium", "camera_angle": "eye_level", "camera_movement": "push"}
    result = sample_assembler.inject_cinematography(shot)
    assert "Medium Shot" in result
    assert "Eye Level" in result
    assert "Push In" in result


def test_inject_cinematography_empty(sample_assembler):
    shot = {"shot_size": "", "camera_angle": "", "camera_movement": ""}
    result = sample_assembler.inject_cinematography(shot)
    assert result == ""


def test_inject_world_constraints(tmp_storage, sample_series, sample_world_bible, sample_kb):
    assembler = PromptAssembler(sample_kb)
    result = assembler.inject_world_constraints(sample_series["id"])
    assert "style_prompt" in result
    assert "negative_prompt" in result
    assert "anime" in result["style_prompt"].lower()
    assert DEFAULT_NEGATIVE_PROMPT in result["negative_prompt"]
    assert "modern technology" in result["negative_prompt"]


def test_resolve_element_refs(tmp_storage, sample_series, sample_character_element, sample_scene_element, sample_kb):
    sample_kb.sync_character_from_element(sample_character_element["id"])
    assembler = PromptAssembler(sample_kb)
    char_id = sample_character_element["id"]
    text = f"[{char_id}] is standing in the room"
    resolved = assembler.resolve_element_refs(text, sample_series["id"])
    # The [SE_xxx] reference should be replaced
    assert f"[{char_id}]" not in resolved
    assert len(resolved) > 0


def test_assemble_shot_prompt_full(
    tmp_storage, sample_series, sample_character_element, sample_scene_element,
    sample_world_bible, sample_kb,
):
    sample_kb.sync_character_from_element(sample_character_element["id"])
    sample_kb.sync_scene_from_element(sample_scene_element["id"])
    assembler = PromptAssembler(sample_kb)

    shot = {
        "prompt": "A dramatic scene",
        "shot_size": "close_up",
        "camera_angle": "low_angle",
        "camera_movement": "push",
        "emotion": "tense",
    }
    result = assembler.assemble_shot_prompt(shot, sample_series["id"])
    assert "prompt" in result
    assert "negative_prompt" in result
    assert "style_prompt" in result
    assert "cinematography" in result
    assert "mood_prompt" in result
    assert len(result["prompt"]) > 0
    assert len(result["negative_prompt"]) > 0
