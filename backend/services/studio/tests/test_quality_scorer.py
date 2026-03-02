"""Tests for quality_scorer.py — 8 tests."""
from backend.services.studio.quality_scorer import QualityScorer, QualityScore


def test_weights_sum_to_one():
    scorer = QualityScorer()
    total = sum(scorer.WEIGHTS.values())
    assert abs(total - 1.0) < 1e-9


def test_all_none_returns_perfect():
    scorer = QualityScorer()
    result = scorer.compute()
    assert isinstance(result, QualityScore)
    assert result.overall_score == 100.0
    assert result.narrative_score == 100.0
    assert result.prompt_score == 100.0
    assert result.visual_score == 100.0
    assert result.passed is True
    assert result.total_issues == 0


def test_narrative_only():
    scorer = QualityScorer()
    result = scorer.compute(narrative_result={"score": 60, "issues": [{"severity": "warning"}]})
    expected_overall = 60 * 0.4 + 100 * 0.35 + 100 * 0.25
    assert result.overall_score == round(expected_overall, 1)
    assert result.narrative_score == 60.0
    assert result.total_issues == 1


def test_prompt_only():
    scorer = QualityScorer()
    result = scorer.compute(prompt_result={"score": 50, "issues": []})
    expected_overall = 100 * 0.4 + 50 * 0.35 + 100 * 0.25
    assert result.overall_score == round(expected_overall, 1)
    assert result.prompt_score == 50.0


def test_visual_only_multiple():
    scorer = QualityScorer()
    visual_results = [
        {"score": 80, "issues": []},
        {"score": 60, "issues": [{"severity": "warning"}]},
    ]
    result = scorer.compute(visual_results=visual_results)
    expected_visual = (80 + 60) / 2
    expected_overall = 100 * 0.4 + 100 * 0.35 + expected_visual * 0.25
    assert result.visual_score == expected_visual
    assert result.overall_score == round(expected_overall, 1)


def test_mixed_results():
    scorer = QualityScorer()
    result = scorer.compute(
        narrative_result={"score": 70, "issues": [{"severity": "error"}]},
        prompt_result={"score": 80, "issues": [{"severity": "warning"}]},
        visual_results=[{"score": 90, "issues": [{"severity": "info"}]}],
    )
    expected = 70 * 0.4 + 80 * 0.35 + 90 * 0.25
    assert result.overall_score == round(expected, 1)
    assert result.total_issues == 3
    assert result.error_count == 1
    assert result.warning_count == 1
    assert result.info_count == 1


def test_passed_requires_no_errors_and_above_60():
    scorer = QualityScorer()
    # With an error → not passed
    result = scorer.compute(
        narrative_result={"score": 90, "issues": [{"severity": "error"}]},
    )
    assert result.passed is False

    # Score below 60 → not passed
    result2 = scorer.compute(
        narrative_result={"score": 10, "issues": []},
        prompt_result={"score": 10, "issues": []},
        visual_results=[{"score": 10, "issues": []}],
    )
    assert result2.overall_score < 60.0
    assert result2.passed is False


def test_issue_counting():
    scorer = QualityScorer()
    result = scorer.compute(
        narrative_result={
            "score": 50,
            "issues": [
                {"severity": "error"},
                {"severity": "error"},
                {"severity": "warning"},
            ],
        },
        prompt_result={
            "score": 50,
            "issues": [
                {"severity": "info"},
                {"severity": "info"},
            ],
        },
    )
    assert result.error_count == 2
    assert result.warning_count == 1
    assert result.info_count == 2
    assert result.total_issues == 5
    # Check that each issue has its source field
    sources = [i.get("source") for i in result.issues]
    assert sources.count("narrative") == 3
    assert sources.count("prompt") == 2
