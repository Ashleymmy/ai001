"""知识库迭代反馈机制 — Phase 4, Task 4.2

基于实际生成结果反馈，自动调整知识库词条权重。
支持人工标记"好词条"/"差词条"，以及从优秀生成结果反向提取词条入库。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

_WEIGHT_FLOOR = 0.1       # 权重下限，永远不会降到零
_WEIGHT_CEILING = 2.0     # 权重上限
_GOOD_DELTA = 0.1         # "好评"单次权重增量
_BAD_DELTA = 0.15         # "差评"单次权重衰减（略大于增量，让差词条更快淘汰）
_FILTER_THRESHOLD = 0.3   # 低于此权重的词条在组装时被过滤
_EMPHASIS_THRESHOLD = 1.3  # 高于此权重的词条在 prompt 中加强调
_DEEMPHASIS_THRESHOLD = 0.5  # 低于此权重的词条在 prompt 中减弱

# 用于从 prompt 中剥离括号权重的正则: (token:1.2) -> token
_PAREN_WEIGHT_RE = re.compile(r"^\((.+?)(?::[\d.]+)?\)$")
# 用于剥离方括号: [token] -> token
_BRACKET_RE = re.compile(r"^\[(.+?)\]$")
# 用于识别 style/composition/lighting 类 token 的关键词
_STYLE_KEYWORDS = {
    "style", "illustration", "painting", "watercolor", "oil", "anime",
    "manga", "realistic", "cartoon", "sketch", "cel-shaded", "flat color",
    "line art", "3d render", "digital art", "concept art", "pixel art",
}
_COMPOSITION_KEYWORDS = {
    "close-up", "wide shot", "medium shot", "bird's eye", "low angle",
    "high angle", "dutch angle", "over the shoulder", "pov", "panoramic",
    "symmetrical", "rule of thirds", "centered", "depth of field",
    "bokeh", "shallow dof", "fisheye", "cinematic", "dramatic lighting",
    "rim lighting", "backlighting", "volumetric lighting", "soft lighting",
    "hard lighting", "natural lighting", "golden hour", "blue hour",
    "spotlight", "ambient occlusion", "lens flare",
}


# ---------------------------------------------------------------------------
# 数据类
# ---------------------------------------------------------------------------

@dataclass
class TokenFeedback:
    """单条词条反馈记录"""
    token: str
    rating: str           # "good" / "bad" / "neutral"
    source: str           # "manual" / "auto"
    context: str = ""     # 来自哪个镜头/话数
    created_at: str = ""

    def __post_init__(self) -> None:
        if not self.created_at:
            self.created_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TokenWeight:
    """词条权重"""
    token: str
    weight: float = 1.0
    good_count: int = 0
    bad_count: int = 0
    total_uses: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# 主管理器
# ---------------------------------------------------------------------------

class KBFeedbackManager:
    """知识库反馈管理器

    管理每个系列 (series) 下的词条权重与反馈历史，
    提供权重调整、词条过滤、反向提取、prompt 加权等能力。
    """

    def __init__(self, storage: Any = None) -> None:
        self.storage = storage
        # 按 series_id 缓存的权重表: {series_id: {token: TokenWeight}}
        self._weights: Dict[str, Dict[str, TokenWeight]] = {}
        self._feedback_history: List[TokenFeedback] = []

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    def _ensure_series(self, series_id: str) -> Dict[str, TokenWeight]:
        """确保 series 的权重表已初始化。"""
        if series_id not in self._weights:
            self._weights[series_id] = {}
        return self._weights[series_id]

    def _get_or_create_weight(self, series_id: str, token: str) -> TokenWeight:
        """获取已有的 TokenWeight，或创建默认权重。"""
        table = self._ensure_series(series_id)
        if token not in table:
            table[token] = TokenWeight(token=token)
        return table[token]

    # ------------------------------------------------------------------
    # 核心 API: 反馈记录
    # ------------------------------------------------------------------

    def record_feedback(
        self,
        series_id: str,
        token: str,
        rating: str,
        source: str = "manual",
        context: str = "",
    ) -> TokenWeight:
        """Record feedback for a specific token.

        Adjusts the token weight:
        - "good" feedback: weight += 0.1 (max 2.0)
        - "bad" feedback:  weight -= 0.15 (min 0.1)
        - "neutral": no change, just records usage

        Returns the updated TokenWeight.
        """
        token = token.strip()
        if not token:
            raise ValueError("token must not be empty")
        if rating not in ("good", "bad", "neutral"):
            raise ValueError(f"rating must be 'good', 'bad', or 'neutral', got '{rating}'")

        # 记录反馈历史
        fb = TokenFeedback(
            token=token,
            rating=rating,
            source=source,
            context=context,
        )
        self._feedback_history.append(fb)

        # 调整权重
        tw = self._get_or_create_weight(series_id, token)
        tw.total_uses += 1

        if rating == "good":
            tw.good_count += 1
            tw.weight = min(tw.weight + _GOOD_DELTA, _WEIGHT_CEILING)
        elif rating == "bad":
            tw.bad_count += 1
            tw.weight = max(tw.weight - _BAD_DELTA, _WEIGHT_FLOOR)
        # neutral: 只计数，不改权重

        return tw

    # ------------------------------------------------------------------
    # 权重查询
    # ------------------------------------------------------------------

    def get_token_weights(self, series_id: str) -> Dict[str, TokenWeight]:
        """Get all token weights for a series."""
        return dict(self._ensure_series(series_id))

    def get_weighted_tokens(
        self,
        series_id: str,
        tokens: List[str],
    ) -> List[Tuple[str, float]]:
        """Return tokens sorted by weight (highest first).

        Tokens with weight < 0.3 are filtered out (considered "bad").
        """
        table = self._ensure_series(series_id)
        result: List[Tuple[str, float]] = []
        for t in tokens:
            t = t.strip()
            if not t:
                continue
            tw = table.get(t)
            weight = tw.weight if tw else 1.0
            if weight >= _FILTER_THRESHOLD:
                result.append((t, weight))
        result.sort(key=lambda x: x[1], reverse=True)
        return result

    # ------------------------------------------------------------------
    # 词条提取
    # ------------------------------------------------------------------

    @staticmethod
    def extract_tokens_from_prompt(prompt: str) -> List[str]:
        """Extract individual tokens from a comma-separated prompt string.

        Handles: "token1, token2, (token3:1.2), [token4]"
        Strips whitespace, parentheses weights, and brackets.
        """
        if not prompt:
            return []

        raw_parts = prompt.split(",")
        tokens: List[str] = []
        for part in raw_parts:
            part = part.strip()
            if not part:
                continue
            # 去除 (token:weight) 格式
            m = _PAREN_WEIGHT_RE.match(part)
            if m:
                part = m.group(1).strip()
            # 去除 [token] 格式
            m = _BRACKET_RE.match(part)
            if m:
                part = m.group(1).strip()
            # 还可能有嵌套括号但无权重: (token)
            if part.startswith("(") and part.endswith(")"):
                part = part[1:-1].strip()
            if part:
                tokens.append(part)
        return tokens

    # ------------------------------------------------------------------
    # 反向提取（从成功生成结果提取新词条）
    # ------------------------------------------------------------------

    def reverse_extract(
        self,
        series_id: str,
        successful_prompt: str,
        element_type: str = "character",
    ) -> Dict[str, List[str]]:
        """Reverse-extract tokens from a successful generation result.

        Analyzes the prompt that produced a good image and extracts:
        - new_tokens:         tokens not already in existing KB weight table
        - style_tokens:       style-related tokens
        - composition_tokens: composition/lighting tokens

        Returns dict with categories.
        """
        all_tokens = self.extract_tokens_from_prompt(successful_prompt)
        table = self._ensure_series(series_id)

        new_tokens: List[str] = []
        style_tokens: List[str] = []
        composition_tokens: List[str] = []

        for token in all_tokens:
            lower = token.lower()

            # 分类
            is_style = any(kw in lower for kw in _STYLE_KEYWORDS)
            is_comp = any(kw in lower for kw in _COMPOSITION_KEYWORDS)

            if is_style:
                style_tokens.append(token)
            elif is_comp:
                composition_tokens.append(token)

            # 检查是否为知识库中已有的词条
            if token not in table:
                new_tokens.append(token)

        return {
            "new_tokens": new_tokens,
            "style_tokens": style_tokens,
            "composition_tokens": composition_tokens,
        }

    # ------------------------------------------------------------------
    # 知识库更新建议
    # ------------------------------------------------------------------

    def suggest_kb_updates(
        self,
        series_id: str,
        element_id: str,
    ) -> Dict[str, Any]:
        """Suggest updates to a KB character/scene card based on accumulated feedback.

        Returns:
        - tokens_to_boost:  high-weight tokens that should be prioritized
        - tokens_to_demote: low-weight tokens that should be deprioritized
        - tokens_to_remove: very low weight tokens to consider removing
        - new_tokens_to_add: tokens from reverse extraction not yet in KB
        """
        table = self._ensure_series(series_id)

        tokens_to_boost: List[Dict[str, Any]] = []
        tokens_to_demote: List[Dict[str, Any]] = []
        tokens_to_remove: List[Dict[str, Any]] = []

        for token, tw in table.items():
            entry = {"token": token, "weight": round(tw.weight, 2),
                     "good": tw.good_count, "bad": tw.bad_count}
            if tw.weight >= _EMPHASIS_THRESHOLD:
                tokens_to_boost.append(entry)
            elif tw.weight < _FILTER_THRESHOLD:
                tokens_to_remove.append(entry)
            elif tw.weight < _DEEMPHASIS_THRESHOLD:
                tokens_to_demote.append(entry)

        # 按权重排序
        tokens_to_boost.sort(key=lambda x: x["weight"], reverse=True)
        tokens_to_demote.sort(key=lambda x: x["weight"])
        tokens_to_remove.sort(key=lambda x: x["weight"])

        # 汇总来自历史反馈中反向提取但尚未入库的词条
        new_tokens_to_add: List[str] = []
        seen: set[str] = set()
        for fb in self._feedback_history:
            if fb.rating == "good" and fb.source == "auto" and fb.token not in table:
                if fb.token not in seen:
                    new_tokens_to_add.append(fb.token)
                    seen.add(fb.token)

        return {
            "element_id": element_id,
            "series_id": series_id,
            "tokens_to_boost": tokens_to_boost,
            "tokens_to_demote": tokens_to_demote,
            "tokens_to_remove": tokens_to_remove,
            "new_tokens_to_add": new_tokens_to_add,
        }

    # ------------------------------------------------------------------
    # Prompt 权重应用
    # ------------------------------------------------------------------

    def apply_weights_to_prompt(self, series_id: str, prompt: str) -> str:
        """Apply token weights to a prompt.

        Tokens with high weight (>1.3) get emphasis:   (token:1.2)
        Tokens with low weight  (<0.5) get de-emphasis: (token:0.8)
        Tokens with weight < 0.3 are removed entirely.
        """
        tokens = self.extract_tokens_from_prompt(prompt)
        if not tokens:
            return prompt

        table = self._ensure_series(series_id)
        output_parts: List[str] = []

        for token in tokens:
            tw = table.get(token)
            weight = tw.weight if tw else 1.0

            if weight < _FILTER_THRESHOLD:
                # 过滤掉低质量词条
                continue
            elif weight >= _EMPHASIS_THRESHOLD:
                # 高权重词条加强调
                output_parts.append(f"({token}:1.2)")
            elif weight < _DEEMPHASIS_THRESHOLD:
                # 低权重词条减弱
                output_parts.append(f"({token}:0.8)")
            else:
                # 正常权重，原样保留
                output_parts.append(token)

        return ", ".join(output_parts)

    # ------------------------------------------------------------------
    # 统计信息
    # ------------------------------------------------------------------

    def get_feedback_stats(self, series_id: str) -> Dict[str, Any]:
        """Get feedback statistics for a series.

        Returns:
        - total_feedback_count
        - good_count, bad_count, neutral_count
        - top_tokens:   best rated tokens (up to 10)
        - bottom_tokens: worst rated tokens (up to 10)
        - improvement_trend: whether quality is improving
        """
        table = self._ensure_series(series_id)

        # 从反馈历史中聚合该 series 的计数
        # (反馈历史不记录 series_id，但权重表是按 series 隔离的)
        good_total = sum(tw.good_count for tw in table.values())
        bad_total = sum(tw.bad_count for tw in table.values())
        neutral_total = sum(
            tw.total_uses - tw.good_count - tw.bad_count
            for tw in table.values()
        )
        total = good_total + bad_total + neutral_total

        # 排序获取 top / bottom
        sorted_by_weight = sorted(table.values(), key=lambda tw: tw.weight, reverse=True)
        top_tokens = [
            {"token": tw.token, "weight": round(tw.weight, 2), "good": tw.good_count}
            for tw in sorted_by_weight[:10]
        ]
        bottom_tokens = [
            {"token": tw.token, "weight": round(tw.weight, 2), "bad": tw.bad_count}
            for tw in sorted_by_weight[-10:]
        ] if sorted_by_weight else []

        # 改善趋势：最近 20 条反馈中好评占比 vs 全局好评占比
        recent = self._feedback_history[-20:] if self._feedback_history else []
        recent_good = sum(1 for fb in recent if fb.rating == "good")
        recent_total = len(recent)

        global_good_ratio = good_total / total if total > 0 else 0.0
        recent_good_ratio = recent_good / recent_total if recent_total > 0 else 0.0

        if recent_total < 5:
            trend = "insufficient_data"
        elif recent_good_ratio > global_good_ratio + 0.05:
            trend = "improving"
        elif recent_good_ratio < global_good_ratio - 0.05:
            trend = "declining"
        else:
            trend = "stable"

        return {
            "total_feedback_count": total,
            "good_count": good_total,
            "bad_count": bad_total,
            "neutral_count": neutral_total,
            "top_tokens": top_tokens,
            "bottom_tokens": bottom_tokens,
            "improvement_trend": trend,
        }

    # ------------------------------------------------------------------
    # 导入 / 导出
    # ------------------------------------------------------------------

    def export_weights(self, series_id: str) -> List[Dict[str, Any]]:
        """Export all token weights as a list of dicts for persistence."""
        table = self._ensure_series(series_id)
        return [tw.to_dict() for tw in table.values()]

    def import_weights(self, series_id: str, weights_data: List[Dict[str, Any]]) -> int:
        """Import token weights from exported data. Returns count imported."""
        table = self._ensure_series(series_id)
        count = 0
        for item in weights_data:
            token = item.get("token", "").strip()
            if not token:
                continue
            tw = TokenWeight(
                token=token,
                weight=float(item.get("weight", 1.0)),
                good_count=int(item.get("good_count", 0)),
                bad_count=int(item.get("bad_count", 0)),
                total_uses=int(item.get("total_uses", 0)),
            )
            # 确保权重在合法范围内
            tw.weight = max(_WEIGHT_FLOOR, min(_WEIGHT_CEILING, tw.weight))
            table[token] = tw
            count += 1
        return count
