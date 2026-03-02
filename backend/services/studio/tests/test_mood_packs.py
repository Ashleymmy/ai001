"""Tests for mood_packs.py — 14 tests."""
from backend.services.studio.mood_packs import (
    MoodPack,
    BUILTIN_MOOD_PACKS,
    ZH_MOOD_ALIASES,
    resolve_mood_key,
    get_mood_pack,
    get_mood_visual_prompt,
    list_available_moods,
)


def test_builtin_packs_count_is_8():
    assert len(BUILTIN_MOOD_PACKS) == 8
    expected = {"tense", "tender", "despair", "cool", "suspense", "warm", "angry", "fear"}
    assert set(BUILTIN_MOOD_PACKS.keys()) == expected


def test_each_builtin_pack_has_required_fields():
    for key, pack in BUILTIN_MOOD_PACKS.items():
        assert isinstance(pack, MoodPack)
        assert pack.mood_key == key
        assert pack.label_zh
        assert pack.label_en
        assert pack.color_tokens
        assert pack.line_style_tokens
        assert pack.effect_tokens
        assert pack.combined_prompt


def test_tense_pack_contains_contrast():
    pack = BUILTIN_MOOD_PACKS["tense"]
    assert "contrast" in pack.color_tokens.lower()
    assert "cinematic tension" in pack.combined_prompt


def test_tender_pack_contains_soft_focus():
    pack = BUILTIN_MOOD_PACKS["tender"]
    assert "soft focus" in pack.color_tokens.lower()


def test_despair_pack_contains_desaturated():
    pack = BUILTIN_MOOD_PACKS["despair"]
    assert "desaturated" in pack.color_tokens.lower()


def test_cool_pack_contains_dynamic():
    pack = BUILTIN_MOOD_PACKS["cool"]
    assert "dynamic" in pack.color_tokens.lower()


def test_suspense_pack_contains_fog():
    pack = BUILTIN_MOOD_PACKS["suspense"]
    assert "fog" in pack.effect_tokens.lower()


def test_warm_pack_contains_warm_tones():
    pack = BUILTIN_MOOD_PACKS["warm"]
    assert "warm tones" in pack.color_tokens.lower()


def test_angry_pack_contains_red():
    pack = BUILTIN_MOOD_PACKS["angry"]
    assert "red" in pack.color_tokens.lower()


def test_fear_pack_contains_cold_blue():
    pack = BUILTIN_MOOD_PACKS["fear"]
    assert "cold blue" in pack.color_tokens.lower()


def test_resolve_mood_key_zh_alias():
    assert resolve_mood_key("紧张") == "tense"
    assert resolve_mood_key("害怕") == "fear"
    assert resolve_mood_key("燃") == "cool"
    assert resolve_mood_key("惬意") == "warm"


def test_resolve_mood_key_en_direct():
    assert resolve_mood_key("tense") == "tense"
    assert resolve_mood_key("TENSE") == "tense"  # case-insensitive
    assert resolve_mood_key("fear") == "fear"


def test_resolve_mood_key_empty_returns_none():
    assert resolve_mood_key("") is None
    assert resolve_mood_key("   ") is None
    assert resolve_mood_key("nonexistent_mood") is None


def test_get_mood_pack_returns_builtin():
    pack = get_mood_pack("tense")
    assert pack is not None
    assert pack.mood_key == "tense"
    # Also via Chinese alias
    pack2 = get_mood_pack("紧张")
    assert pack2 is not None
    assert pack2.mood_key == "tense"
    # Unknown returns None
    assert get_mood_pack("nonexistent") is None
