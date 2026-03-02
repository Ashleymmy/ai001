"""叙事 QA 模块 — Phase 2 叙事一致性审核

在分镜规划完成后、画面生成前，自动执行叙事一致性检查。
所有不通过结果携带结构化修改指令，可被自动应用。
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


@dataclass
class QAIssue:
    """质检问题条目"""
    severity: str  # "error" / "warning" / "info"
    description: str  # 问题描述
    fix_suggestion: str  # 修改建议（自然语言）
    fix_instruction: Dict[str, Any] = field(default_factory=dict)  # 结构化修改指令
    affected_shots: List[str] = field(default_factory=list)  # 涉及的镜头 ID

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class QAResult:
    """质检结果"""
    passed: bool
    score: float  # 0-100
    issues: List[QAIssue] = field(default_factory=list)
    checked_items: int = 0
    check_type: str = "narrative"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "passed": self.passed,
            "score": self.score,
            "issues": [i.to_dict() for i in self.issues],
            "checked_items": self.checked_items,
            "check_type": self.check_type,
        }


# ---------------------------------------------------------------------------
# 叙事一致性检查规则（本地规则引擎，不依赖 LLM）
# ---------------------------------------------------------------------------

def _check_character_presence(shots: List[Dict], elements: List[Dict]) -> List[QAIssue]:
    """检查角色是否在不合理的镜头中出场/缺失"""
    issues: List[QAIssue] = []
    char_names = {e["name"]: e["id"] for e in elements if e.get("type") == "character"}
    for shot in shots:
        desc = str(shot.get("description") or "") + str(shot.get("prompt") or "")
        for name, eid in char_names.items():
            if name in desc:
                # 检查是否有对应的元素引用
                if f"[SE_{eid}]" not in desc and f"[SE_" not in desc:
                    issues.append(QAIssue(
                        severity="info",
                        description=f"镜头 {shot.get('name', '')} 提到角色「{name}」但未使用 [SE_] 元素引用",
                        fix_suggestion=f"建议在提示词中使用 [SE_{eid}] 引用角色「{name}」以确保视觉一致性",
                        fix_instruction={"action": "add_element_ref", "shot_id": shot.get("id"), "element_id": eid},
                        affected_shots=[shot.get("id", "")],
                    ))
    return issues


def _check_scene_continuity(shots: List[Dict]) -> List[QAIssue]:
    """检查镜头间的场景连续性"""
    issues: List[QAIssue] = []
    for i in range(1, len(shots)):
        prev = shots[i - 1]
        curr = shots[i]
        prev_seg = str(prev.get("segment_name") or "")
        curr_seg = str(curr.get("segment_name") or "")
        # 同一段落内景别跳跃检查
        if prev_seg and curr_seg and prev_seg == curr_seg:
            prev_size = str(prev.get("shot_size") or "")
            curr_size = str(curr.get("shot_size") or "")
            size_order = ["extreme_long", "long", "medium", "medium_close", "close_up", "extreme_close"]
            if prev_size in size_order and curr_size in size_order:
                prev_idx = size_order.index(prev_size)
                curr_idx = size_order.index(curr_size)
                if abs(prev_idx - curr_idx) >= 4:
                    issues.append(QAIssue(
                        severity="warning",
                        description=f"镜头 {prev.get('name', '')} → {curr.get('name', '')} 景别跳跃过大（{prev_size} → {curr_size}）",
                        fix_suggestion="相邻镜头景别建议渐进过渡，避免观众视觉突变",
                        fix_instruction={
                            "action": "suggest_shot_size",
                            "shot_id": curr.get("id"),
                            "suggested_size": size_order[min(prev_idx + 2, len(size_order) - 1)],
                        },
                        affected_shots=[prev.get("id", ""), curr.get("id", "")],
                    ))
    return issues


def _check_emotion_consistency(shots: List[Dict]) -> List[QAIssue]:
    """检查情绪标签与描述内容是否矛盾"""
    issues: List[QAIssue] = []
    # 简单矛盾对
    contradictions = {
        "开心": ["死亡", "绝望", "哭泣", "悲伤"],
        "happy": ["death", "despair", "crying", "sadness"],
        "温柔": ["暴怒", "杀", "激烈打斗"],
        "tender": ["rage", "kill", "intense fight"],
        "恐惧": ["开心", "大笑", "欢庆"],
        "fear": ["happy", "laughing", "celebration"],
    }
    for shot in shots:
        emotion = str(shot.get("emotion") or "").strip().lower()
        desc = (str(shot.get("description") or "") + str(shot.get("prompt") or "")).lower()
        if emotion in contradictions:
            for contra in contradictions[emotion]:
                if contra.lower() in desc:
                    issues.append(QAIssue(
                        severity="warning",
                        description=f"镜头 {shot.get('name', '')} 的情绪标签「{emotion}」与描述中的「{contra}」存在矛盾",
                        fix_suggestion=f"建议调整情绪标签或修改镜头描述以保持一致",
                        fix_instruction={"action": "review_emotion", "shot_id": shot.get("id"), "current_emotion": emotion},
                        affected_shots=[shot.get("id", "")],
                    ))
    return issues


def _check_dialogue_assignment(shots: List[Dict], elements: List[Dict]) -> List[QAIssue]:
    """检查对白是否有明确的角色归属"""
    issues: List[QAIssue] = []
    char_names = [e["name"] for e in elements if e.get("type") == "character"]
    for shot in shots:
        dialogue = str(shot.get("dialogue_script") or "").strip()
        if not dialogue:
            continue
        # 检查对白中是否有角色名标注
        has_char_ref = any(name in dialogue for name in char_names)
        if not has_char_ref and "：" not in dialogue and ":" not in dialogue:
            issues.append(QAIssue(
                severity="info",
                description=f"镜头 {shot.get('name', '')} 有对白但未标注说话角色",
                fix_suggestion="建议在对白前标注角色名（如「角色名：台词」），以便 TTS 使用对应音色",
                fix_instruction={"action": "annotate_dialogue", "shot_id": shot.get("id")},
                affected_shots=[shot.get("id", "")],
            ))
    return issues


def _check_missing_fields(shots: List[Dict]) -> List[QAIssue]:
    """检查关键字段是否缺失"""
    issues: List[QAIssue] = []
    for shot in shots:
        name = shot.get("name", f"第{shot.get('sort_order', '?')}格")
        desc = str(shot.get("description") or "").strip()
        prompt = str(shot.get("prompt") or "").strip()
        if not desc and not prompt:
            issues.append(QAIssue(
                severity="error",
                description=f"镜头「{name}」缺少描述和提示词",
                fix_suggestion="镜头必须至少有描述或提示词，否则无法生成画面",
                fix_instruction={"action": "require_description", "shot_id": shot.get("id")},
                affected_shots=[shot.get("id", "")],
            ))
        if not shot.get("shot_size"):
            issues.append(QAIssue(
                severity="info",
                description=f"镜头「{name}」未设置景别",
                fix_suggestion="设置景别可提升画面构图质量",
                fix_instruction={"action": "suggest_shot_size", "shot_id": shot.get("id"), "suggested_size": "medium"},
                affected_shots=[shot.get("id", "")],
            ))
    return issues


class NarrativeQA:
    """叙事一致性审核 — 独立于生产侧

    在分镜规划完成后、画面生成前执行。包含本地规则引擎检查
    和可选的 LLM 深度审核。
    """

    def __init__(self, llm_service=None):
        self.llm = llm_service

    async def check_episode(
        self,
        shots: List[Dict[str, Any]],
        elements: List[Dict[str, Any]],
        episode: Optional[Dict[str, Any]] = None,
        series_context: Optional[Dict[str, Any]] = None,
    ) -> QAResult:
        """执行叙事一致性检查

        Args:
            shots: 该集所有镜头
            elements: 该集涉及的元素
            episode: 集信息
            series_context: 系列上下文（世界观等）

        Returns:
            QAResult 包含通过/不通过、分数、问题列表
        """
        all_issues: List[QAIssue] = []

        # 1. 角色引用检查
        all_issues.extend(_check_character_presence(shots, elements))

        # 2. 场景连续性检查
        all_issues.extend(_check_scene_continuity(shots))

        # 3. 情绪一致性检查
        all_issues.extend(_check_emotion_consistency(shots))

        # 4. 对白归属检查
        all_issues.extend(_check_dialogue_assignment(shots, elements))

        # 5. 关键字段完整性检查
        all_issues.extend(_check_missing_fields(shots))

        # 6. 可选：LLM 深度审核（暂不启用，预留接口）
        # if self.llm and series_context:
        #     llm_issues = await self._llm_deep_check(shots, elements, series_context)
        #     all_issues.extend(llm_issues)

        # 计算分数
        error_count = sum(1 for i in all_issues if i.severity == "error")
        warning_count = sum(1 for i in all_issues if i.severity == "warning")
        info_count = sum(1 for i in all_issues if i.severity == "info")

        max_deduct = 100.0
        deduction = error_count * 15 + warning_count * 5 + info_count * 1
        score = max(0.0, max_deduct - deduction)
        passed = error_count == 0 and score >= 60.0

        return QAResult(
            passed=passed,
            score=round(score, 1),
            issues=all_issues,
            checked_items=len(shots),
            check_type="narrative",
        )


# ---------------------------------------------------------------------------
# LLM 深度审核提示词（Phase 3 启用）
# ---------------------------------------------------------------------------

NARRATIVE_QA_SYSTEM_PROMPT = """你是一位专业的叙事质检员。你的任务是审核一集漫剧的分镜脚本，
检查叙事逻辑的完整性和一致性。

检查维度：
1. 角色行为一致性 — 角色的行为是否符合其设定的性格特征
2. 时间线连续性 — 事件发生的时间顺序是否合理
3. 场景逻辑 — 角色是否出现在合理的场景中
4. 对话风格一致性 — 台词是否符合角色的语言特征
5. 情节完整性 — 本集是否有完整的起承转合

请以 JSON 格式输出检查结果。"""

NARRATIVE_QA_USER_PROMPT = """请审核以下分镜脚本的叙事一致性：

== 系列世界观 ==
{world_context}

== 角色设定 ==
{character_profiles}

== 本集概要 ==
{episode_summary}

== 分镜列表 ==
{shots_json}

请输出 JSON 格式的检查结果：
```json
{{
  "passed": true/false,
  "score": 0-100,
  "issues": [
    {{
      "severity": "error/warning/info",
      "description": "问题描述",
      "fix_suggestion": "修改建议",
      "fix_instruction": {{"action": "...", "shot_id": "...", ...}},
      "affected_shots": ["shot_id_1", "shot_id_2"]
    }}
  ]
}}
```"""
