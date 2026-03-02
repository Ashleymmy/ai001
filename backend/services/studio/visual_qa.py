"""视觉 QA 模块 — Phase 2 视觉一致性审核

利用多模态 LLM 对生成图像进行角色一致性校验。
Phase 2 先做角色一致性校验，场景连续性校验放到 Phase 3。
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class VisualQAIssue:
    """视觉质检问题"""
    severity: str  # "error" / "warning" / "info"
    description: str
    fix_suggestion: str
    character_id: str = ""
    expected_tokens: str = ""  # 期望的视觉特征
    detected_deviation: str = ""  # 检测到的偏差

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class VisualQAResult:
    """视觉质检结果"""
    passed: bool
    score: float  # 0-100
    issues: List[VisualQAIssue] = field(default_factory=list)
    check_type: str = "visual"
    image_url: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "score": self.score,
            "issues": [i.to_dict() for i in self.issues],
            "check_type": self.check_type,
            "image_url": self.image_url,
        }


class VisualQA:
    """视觉一致性审核

    Phase 2 实现：基于规则的提示词完整性校验 + 可选的多模态 LLM 图像比对。
    LLM 图像比对需要多模态模型支持（Phase 3 接入 Claude Vision 后启用）。
    """

    def __init__(self, llm_service=None, knowledge_base=None):
        self.llm = llm_service
        self.kb = knowledge_base

    async def check_character_consistency(
        self,
        generated_image_url: str,
        character_cards: List[Dict[str, Any]],
        shot: Optional[Dict[str, Any]] = None,
    ) -> VisualQAResult:
        """检查生成图像与角色档案的一致性

        Phase 2 实现为基于提示词的前置校验：
        - 检查提示词中是否包含角色档案的关键特征词
        - 检查是否遗漏负面提示词
        - 标记潜在的视觉偏差风险

        Phase 3 将升级为多模态 LLM 图像回传比对。
        """
        issues: List[VisualQAIssue] = []
        prompt = str(shot.get("prompt") or "") if shot else ""
        prompt_lower = prompt.lower()

        for card in character_cards:
            char_name = str(card.get("element_name") or card.get("id", ""))
            appearance = card.get("appearance_tokens", {})
            if isinstance(appearance, str):
                try:
                    import json
                    appearance = json.loads(appearance)
                except Exception:
                    appearance = {}

            # 检查关键外貌特征是否在提示词中
            missing_features: List[str] = []
            for feature_key, feature_value in appearance.items():
                if feature_value and str(feature_value).strip():
                    token = str(feature_value).strip().lower()
                    # 检查英文 token 是否在提示词中
                    if len(token) > 2 and token not in prompt_lower:
                        missing_features.append(f"{feature_key}: {feature_value}")

            if missing_features:
                issues.append(VisualQAIssue(
                    severity="warning",
                    description=f"角色「{char_name}」的以下特征未出现在提示词中: {', '.join(missing_features[:3])}",
                    fix_suggestion="建议启用知识库组装模式，自动注入角色特征词条",
                    character_id=str(card.get("element_id", "")),
                    expected_tokens="; ".join(missing_features),
                ))

            # 检查负面提示词
            neg = str(card.get("negative_prompts") or "").strip()
            if neg and neg.lower() not in prompt_lower:
                issues.append(VisualQAIssue(
                    severity="info",
                    description=f"角色「{char_name}」的负面提示词未被注入",
                    fix_suggestion=f"建议添加负面提示词: {neg[:50]}...",
                    character_id=str(card.get("element_id", "")),
                ))

        # 计算分数
        warning_count = sum(1 for i in issues if i.severity == "warning")
        error_count = sum(1 for i in issues if i.severity == "error")
        score = max(0.0, 100.0 - error_count * 20 - warning_count * 8)
        passed = error_count == 0 and score >= 50.0

        return VisualQAResult(
            passed=passed,
            score=round(score, 1),
            issues=issues,
            image_url=generated_image_url,
        )

    async def check_scene_continuity(
        self,
        current_image_url: str,
        previous_image_url: str,
        scene_card: Optional[Dict[str, Any]] = None,
    ) -> VisualQAResult:
        """检查前后帧的场景连续性（Phase 3 启用 LLM 图像比对）"""
        # Phase 2: 仅做标记，不做实际比对
        return VisualQAResult(
            passed=True,
            score=100.0,
            issues=[],
            image_url=current_image_url,
        )


# ---------------------------------------------------------------------------
# LLM 多模态审核提示词（Phase 3 启用）
# ---------------------------------------------------------------------------

VISUAL_QA_SYSTEM_PROMPT = """你是一位专业的视觉质检员。你将收到一张 AI 生成的漫画画面和对应的角色设定档案。
请比对画面中角色的视觉特征是否与档案一致。

检查维度：
1. 发型发色 — 是否与设定匹配
2. 瞳色 — 是否与设定匹配
3. 服装 — 是否与当前场景的服装变体匹配
4. 体型 — 是否与设定的体型比例一致
5. 面部特征 — 是否保持同一角色的面部一致性

请以 JSON 格式输出：
```json
{
  "passed": true/false,
  "score": 0-100,
  "issues": [
    {
      "severity": "error/warning/info",
      "description": "偏差描述",
      "fix_suggestion": "建议如何修改提示词以纠正偏差"
    }
  ]
}
```"""
