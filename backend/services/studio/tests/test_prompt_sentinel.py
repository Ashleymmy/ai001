"""Tests for prompt_sentinel.py — 12 tests."""
from backend.services.studio.prompt_sentinel import (
    analyze_prompt_text,
    apply_prompt_suggestions,
    build_prompt_optimize_llm_payload,
    check_kb_compliance,
)


def test_safe_prompt_returns_safe():
    result = analyze_prompt_text("a beautiful sunset over the ocean")
    assert result["safe"] is True
    assert result["risk_score"] == 0
    assert result["risk_level"] == "safe"
    assert result["matches"] == []


def test_empty_prompt_returns_safe():
    result = analyze_prompt_text("")
    assert result["safe"] is True
    assert result["risk_level"] == "safe"


def test_violence_detection_zh():
    result = analyze_prompt_text("角色被杀死了")
    assert result["safe"] is False
    assert "violence" in result["categories"]
    assert any(m["term"] == "杀死" for m in result["matches"])


def test_violence_detection_en():
    result = analyze_prompt_text("There was bloodshed on the battlefield")
    assert result["safe"] is False
    assert "violence" in result["categories"]


def test_adult_detection():
    result = analyze_prompt_text("a nude figure in the painting")
    assert result["safe"] is False
    assert "adult" in result["categories"]


def test_politics_detection():
    result = analyze_prompt_text("the dictator was overthrown in a coup")
    assert result["safe"] is False
    assert "politics" in result["categories"]


def test_hate_detection():
    result = analyze_prompt_text("xenophobia is rising in the region")
    assert result["safe"] is False
    assert "hate" in result["categories"]


def test_multiple_categories():
    result = analyze_prompt_text("nude torture scene with propaganda")
    assert result["safe"] is False
    assert len(result["categories"]) >= 2


def test_risk_level_computation():
    # Single low-severity match → low_risk
    result = analyze_prompt_text("this scene is brutal")
    assert result["risk_level"] in ("low_risk", "medium_risk")
    # Multiple high-severity matches → high_risk
    result2 = analyze_prompt_text("bloodshed massacre gore dismember decapitate")
    assert result2["risk_level"] == "high_risk"


def test_apply_suggestions():
    analysis = analyze_prompt_text("角色被杀死了，场面血浆横飞")
    suggestions = analysis["suggestions"]
    optimized = apply_prompt_suggestions("角色被杀死了，场面血浆横飞", suggestions)
    assert "杀死" not in optimized
    assert "制服" in optimized


def test_build_llm_payload():
    analysis = analyze_prompt_text("杀死")
    sys_prompt, user_prompt = build_prompt_optimize_llm_payload("杀死", analysis)
    assert "安全优化" in sys_prompt
    assert "杀死" in user_prompt


def test_kb_compliance_no_context():
    result = check_kb_compliance("any prompt", {"shot_size": "medium"})
    assert result["compliant"] is True
    assert result["score"] == 100.0


def test_kb_compliance_forbidden_element():
    result = check_kb_compliance(
        "a scene with guns and swords",
        {"shot_size": "medium"},
        kb_context={"forbidden_elements": "guns, bombs"},
    )
    assert result["compliant"] is False
    assert any(i["check"] == "forbidden_element" for i in result["issues"])
