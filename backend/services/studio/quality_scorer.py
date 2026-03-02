"""综合评分模块 — Phase 2

整合叙事 QA、提示词 QA、视觉 QA 的检查结果，输出综合质量评分。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class QualityScore:
    """综合质量评分"""
    overall_score: float  # 0-100 综合分
    narrative_score: float  # 叙事 QA 分数
    prompt_score: float  # 提示词 QA 分数
    visual_score: float  # 视觉 QA 分数
    passed: bool
    total_issues: int
    error_count: int
    warning_count: int
    info_count: int
    issues: List[Dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


class QualityScorer:
    """综合评分引擎

    聚合三个 QA 模块的结果，按权重计算综合分数：
    - 叙事 QA: 40%
    - 提示词 QA: 35%
    - 视觉 QA: 25%
    """

    WEIGHTS = {
        "narrative": 0.40,
        "prompt": 0.35,
        "visual": 0.25,
    }

    def compute(
        self,
        narrative_result: Optional[Dict[str, Any]] = None,
        prompt_result: Optional[Dict[str, Any]] = None,
        visual_results: Optional[List[Dict[str, Any]]] = None,
    ) -> QualityScore:
        """计算综合质量评分"""
        narrative_score = 100.0
        prompt_score = 100.0
        visual_score = 100.0
        all_issues: List[Dict[str, Any]] = []

        if narrative_result:
            narrative_score = float(narrative_result.get("score", 100))
            for issue in narrative_result.get("issues", []):
                all_issues.append({**issue, "source": "narrative"})

        if prompt_result:
            prompt_score = float(prompt_result.get("score", 100))
            for issue in prompt_result.get("issues", []):
                all_issues.append({**issue, "source": "prompt"})

        if visual_results:
            scores = [float(r.get("score", 100)) for r in visual_results]
            visual_score = sum(scores) / len(scores) if scores else 100.0
            for r in visual_results:
                for issue in r.get("issues", []):
                    all_issues.append({**issue, "source": "visual"})

        # 加权计算
        overall = (
            narrative_score * self.WEIGHTS["narrative"]
            + prompt_score * self.WEIGHTS["prompt"]
            + visual_score * self.WEIGHTS["visual"]
        )

        error_count = sum(1 for i in all_issues if i.get("severity") == "error")
        warning_count = sum(1 for i in all_issues if i.get("severity") == "warning")
        info_count = sum(1 for i in all_issues if i.get("severity") == "info")

        return QualityScore(
            overall_score=round(overall, 1),
            narrative_score=round(narrative_score, 1),
            prompt_score=round(prompt_score, 1),
            visual_score=round(visual_score, 1),
            passed=error_count == 0 and overall >= 60.0,
            total_issues=len(all_issues),
            error_count=error_count,
            warning_count=warning_count,
            info_count=info_count,
            issues=all_issues,
        )
