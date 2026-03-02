"""Tests for kb_feedback.py — 14 tests."""
import pytest

from backend.services.studio.kb_feedback import (
    KBFeedbackManager,
    TokenWeight,
    TokenFeedback,
    _WEIGHT_FLOOR,
    _WEIGHT_CEILING,
    _GOOD_DELTA,
    _BAD_DELTA,
    _FILTER_THRESHOLD,
    _EMPHASIS_THRESHOLD,
    _DEEMPHASIS_THRESHOLD,
)


@pytest.fixture
def mgr():
    return KBFeedbackManager()


def test_record_good_feedback_increases_weight(mgr):
    tw = mgr.record_feedback("s1", "silver hair", "good")
    assert tw.weight == 1.0 + _GOOD_DELTA
    assert tw.good_count == 1
    assert tw.total_uses == 1


def test_record_bad_feedback_decreases_weight(mgr):
    tw = mgr.record_feedback("s1", "silver hair", "bad")
    assert tw.weight == 1.0 - _BAD_DELTA
    assert tw.bad_count == 1
    assert tw.total_uses == 1


def test_weight_floor(mgr):
    # Apply many bad feedbacks — should never go below floor
    for _ in range(100):
        tw = mgr.record_feedback("s1", "bad_token", "bad")
    assert tw.weight == _WEIGHT_FLOOR


def test_weight_ceiling(mgr):
    # Apply many good feedbacks — should never exceed ceiling
    for _ in range(100):
        tw = mgr.record_feedback("s1", "great_token", "good")
    assert tw.weight == _WEIGHT_CEILING


def test_neutral_no_weight_change(mgr):
    tw = mgr.record_feedback("s1", "token_a", "neutral")
    assert tw.weight == 1.0
    assert tw.total_uses == 1
    assert tw.good_count == 0
    assert tw.bad_count == 0


def test_empty_token_raises(mgr):
    with pytest.raises(ValueError, match="must not be empty"):
        mgr.record_feedback("s1", "", "good")


def test_invalid_rating_raises(mgr):
    with pytest.raises(ValueError, match="rating must be"):
        mgr.record_feedback("s1", "token", "excellent")


def test_get_weighted_tokens_filters_low(mgr):
    # Push token below filter threshold
    for _ in range(10):
        mgr.record_feedback("s1", "weak_token", "bad")
    # This token should be filtered out
    result = mgr.get_weighted_tokens("s1", ["weak_token", "unknown_token"])
    weak_tokens = [t for t, w in result if t == "weak_token"]
    assert len(weak_tokens) == 0
    # Unknown tokens default to weight 1.0 — above threshold
    unknown_tokens = [t for t, w in result if t == "unknown_token"]
    assert len(unknown_tokens) == 1


def test_extract_tokens_simple():
    tokens = KBFeedbackManager.extract_tokens_from_prompt("silver hair, blue eyes, fair skin")
    assert tokens == ["silver hair", "blue eyes", "fair skin"]


def test_extract_tokens_parenthesized():
    tokens = KBFeedbackManager.extract_tokens_from_prompt("(silver hair:1.2), blue eyes")
    assert "silver hair" in tokens
    assert "blue eyes" in tokens


def test_extract_tokens_bracketed():
    tokens = KBFeedbackManager.extract_tokens_from_prompt("[silver hair], (blue eyes)")
    assert "silver hair" in tokens
    assert "blue eyes" in tokens


def test_apply_weights_emphasis(mgr):
    # Boost a token above emphasis threshold
    for _ in range(5):
        mgr.record_feedback("s1", "silver hair", "good")
    tw = mgr.get_token_weights("s1")["silver hair"]
    assert tw.weight >= _EMPHASIS_THRESHOLD
    result = mgr.apply_weights_to_prompt("s1", "silver hair, blue eyes")
    assert "(silver hair:1.2)" in result
    assert "blue eyes" in result


def test_apply_weights_filter(mgr):
    # Push below filter threshold
    for _ in range(10):
        mgr.record_feedback("s1", "bad_token", "bad")
    result = mgr.apply_weights_to_prompt("s1", "bad_token, good_token")
    assert "bad_token" not in result
    assert "good_token" in result


def test_import_export_roundtrip(mgr):
    mgr.record_feedback("s1", "token_a", "good")
    mgr.record_feedback("s1", "token_b", "bad")
    exported = mgr.export_weights("s1")
    assert len(exported) == 2

    mgr2 = KBFeedbackManager()
    count = mgr2.import_weights("s1", exported)
    assert count == 2

    weights = mgr2.get_token_weights("s1")
    assert "token_a" in weights
    assert "token_b" in weights
    assert weights["token_a"].weight == 1.0 + _GOOD_DELTA
    assert weights["token_b"].weight == 1.0 - _BAD_DELTA
