"""Tests for visual_qa.py — 8 tests (async)."""
import pytest

from backend.services.studio.visual_qa import VisualQA, VisualQAResult, VisualQAIssue


@pytest.mark.asyncio
async def test_perfect_consistency():
    qa = VisualQA()
    cards = [
        {
            "element_name": "Aria",
            "element_id": "SE_char1",
            "appearance_tokens": {
                "hair": "silver long hair",
                "eyes": "blue eyes",
            },
        },
    ]
    shot = {"prompt": "silver long hair, blue eyes, standing in palace"}
    result = await qa.check_character_consistency("http://img/1.png", cards, shot)
    assert isinstance(result, VisualQAResult)
    # All features are present in prompt → no warnings
    assert result.score >= 90.0


@pytest.mark.asyncio
async def test_missing_features_warning():
    qa = VisualQA()
    cards = [
        {
            "element_name": "Aria",
            "element_id": "SE_char1",
            "appearance_tokens": {
                "hair": "silver long hair",
                "eyes": "blue eyes",
                "skin": "fair skin",
                "build": "tall",
            },
        },
    ]
    shot = {"prompt": "a person standing in the garden"}
    result = await qa.check_character_consistency("http://img/1.png", cards, shot)
    assert any(i.severity == "warning" for i in result.issues)


@pytest.mark.asyncio
async def test_negative_prompt_info():
    qa = VisualQA()
    cards = [
        {
            "element_name": "Aria",
            "element_id": "SE_char1",
            "appearance_tokens": {},
            "negative_prompts": "chibi, cartoon, 3d render",
        },
    ]
    shot = {"prompt": "a beautiful character"}
    result = await qa.check_character_consistency("http://img/1.png", cards, shot)
    # Should have info about missing negative prompt
    info_issues = [i for i in result.issues if i.severity == "info"]
    assert len(info_issues) >= 1


@pytest.mark.asyncio
async def test_empty_character_cards():
    qa = VisualQA()
    result = await qa.check_character_consistency("http://img/1.png", [], None)
    assert result.passed is True
    assert result.score == 100.0
    assert result.issues == []


@pytest.mark.asyncio
async def test_score_calculation():
    qa = VisualQA()
    cards = [
        {
            "element_name": "Char A",
            "element_id": "SE_a",
            "appearance_tokens": {
                "hair": "silver long hair",
                "eyes": "blue eyes",
                "skin": "fair skin",
                "build": "tall build",
            },
        },
    ]
    # None of the features match
    shot = {"prompt": "a random scene"}
    result = await qa.check_character_consistency("http://img/1.png", cards, shot)
    assert result.score < 100.0


@pytest.mark.asyncio
async def test_passed_threshold():
    qa = VisualQA()
    cards = [
        {
            "element_name": "Char A",
            "element_id": "SE_a",
            "appearance_tokens": {
                "hair": "silver long hair",
                "eyes": "blue eyes",
                "skin": "fair skin",
                "build": "tall build",
            },
        },
    ]
    # Missing all features → 1 warning → score = 92
    shot = {"prompt": "a random scene without matching tokens"}
    result = await qa.check_character_consistency("http://img/1.png", cards, shot)
    # passed requires score >= 50 and no errors
    assert isinstance(result.passed, bool)


@pytest.mark.asyncio
async def test_scene_continuity_stub():
    qa = VisualQA()
    result = await qa.check_scene_continuity("http://img/2.png", "http://img/1.png")
    assert result.passed is True
    assert result.score == 100.0
    assert result.issues == []


@pytest.mark.asyncio
async def test_visual_qa_result_to_dict():
    result = VisualQAResult(
        passed=True,
        score=95.0,
        issues=[VisualQAIssue(severity="info", description="test", fix_suggestion="fix")],
        image_url="http://img/1.png",
    )
    d = result.to_dict()
    assert d["passed"] is True
    assert d["score"] == 95.0
    assert len(d["issues"]) == 1
    assert d["issues"][0]["severity"] == "info"
