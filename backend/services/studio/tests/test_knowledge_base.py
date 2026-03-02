"""Tests for knowledge_base.py — 12 tests."""
import json

from backend.services.studio.knowledge_base import KnowledgeBase, _zh_to_en, _split_desc, _ZH_EN_HAIR, _ZH_EN_SCENE


def test_zh_to_en_hair():
    result = _zh_to_en("银色长发", _ZH_EN_HAIR)
    assert "silver" in result
    assert "long hair" in result


def test_split_desc():
    parts = _split_desc("银色长发，蓝色瞳孔，白皙皮肤")
    assert len(parts) == 3
    assert parts[0] == "银色长发"


def test_sync_character_from_element(tmp_storage, sample_series, sample_character_element):
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_character_from_element(sample_character_element["id"])
    assert result is not None
    # Check parsed appearance tokens
    appearance = result.get("appearance_tokens")
    if isinstance(appearance, str):
        appearance = json.loads(appearance)
    assert "hair" in appearance
    assert "silver" in appearance["hair"].lower()


def test_sync_character_default_values(tmp_storage, sample_series):
    elem = tmp_storage.add_shared_element(
        series_id=sample_series["id"],
        name="Plain Char",
        element_type="character",
        description="没有明显特征描述的角色",
    )
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_character_from_element(elem["id"])
    assert result is not None
    appearance = result.get("appearance_tokens")
    if isinstance(appearance, str):
        appearance = json.loads(appearance)
    # Should fall back to defaults
    assert appearance.get("hair")
    assert appearance.get("eyes")


def test_sync_character_nonexistent(tmp_storage):
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_character_from_element("nonexistent_id")
    assert result is None


def test_sync_character_wrong_type(tmp_storage, sample_series):
    elem = tmp_storage.add_shared_element(
        series_id=sample_series["id"],
        name="A Scene",
        element_type="scene",
        description="森林",
    )
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_character_from_element(elem["id"])
    assert result is None


def test_sync_scene_from_element(tmp_storage, sample_series, sample_scene_element):
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_scene_from_element(sample_scene_element["id"])
    assert result is not None
    base = result.get("base_tokens", "")
    if isinstance(base, str):
        assert "palace" in base.lower()


def test_sync_scene_time_variants(tmp_storage, sample_series, sample_scene_element):
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_scene_from_element(sample_scene_element["id"])
    variants = result.get("time_variants")
    if isinstance(variants, str):
        variants = json.loads(variants)
    assert "day" in variants
    assert "night" in variants
    assert "sunset" in variants
    assert "daytime" in variants["day"]
    assert "moonlight" in variants["night"]


def test_sync_scene_nonexistent(tmp_storage):
    kb = KnowledgeBase(tmp_storage)
    assert kb.sync_scene_from_element("nope") is None


def test_sync_all_elements(tmp_storage, sample_series, sample_character_element, sample_scene_element):
    kb = KnowledgeBase(tmp_storage)
    result = kb.sync_all_elements(sample_series["id"])
    assert result["characters"] >= 1
    assert result["scenes"] >= 1


def test_get_character_prompt_tokens(tmp_storage, sample_series, sample_character_element):
    kb = KnowledgeBase(tmp_storage)
    kb.sync_character_from_element(sample_character_element["id"])
    tokens = kb.get_character_prompt_tokens(sample_character_element["id"])
    assert isinstance(tokens, str)
    assert len(tokens) > 0


def test_get_scene_prompt_tokens(tmp_storage, sample_series, sample_scene_element):
    kb = KnowledgeBase(tmp_storage)
    kb.sync_scene_from_element(sample_scene_element["id"])
    tokens = kb.get_scene_prompt_tokens(sample_scene_element["id"], time_variant="night")
    assert isinstance(tokens, str)
    assert "night" in tokens.lower() or "moon" in tokens.lower()
