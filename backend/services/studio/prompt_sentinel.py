"""Studio Prompt Sentinel

提供提示词敏感词检测、替代建议与安全化改写辅助能力。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple


_SEVERITY_SCORE = {
    "low": 1,
    "medium": 2,
    "high": 3,
}

_CATEGORY_LABELS = {
    "violence": "暴力",
    "adult": "成人",
    "politics": "政治",
    "hate": "仇恨",
}

_SENSITIVE_RULES: List[Dict[str, str]] = [
    # 暴力
    {"term": "杀死", "category": "violence", "severity": "high", "replacement": "制服", "reason": "避免直接致命伤害表达"},
    {"term": "斩首", "category": "violence", "severity": "high", "replacement": "制服", "reason": "避免血腥暴力动作"},
    {"term": "爆头", "category": "violence", "severity": "high", "replacement": "击退", "reason": "避免血腥暴力细节"},
    {"term": "肢解", "category": "violence", "severity": "high", "replacement": "激烈冲突", "reason": "避免残忍画面描述"},
    {"term": "血浆", "category": "violence", "severity": "medium", "replacement": "冲击痕迹", "reason": "降低血腥程度"},
    {"term": "血肉横飞", "category": "violence", "severity": "high", "replacement": "场面混乱", "reason": "避免血腥夸张描写"},
    # 成人
    {"term": "裸露", "category": "adult", "severity": "high", "replacement": "着装完整", "reason": "避免成人暴露内容"},
    {"term": "性爱", "category": "adult", "severity": "high", "replacement": "亲密互动", "reason": "避免成人性行为描述"},
    {"term": "性行为", "category": "adult", "severity": "high", "replacement": "情感互动", "reason": "避免成人性行为描述"},
    {"term": "激情缠绵", "category": "adult", "severity": "medium", "replacement": "情感交流", "reason": "降低露骨表述"},
    {"term": "挑逗", "category": "adult", "severity": "medium", "replacement": "互动", "reason": "降低暧昧导向"},
    # 政治 / 仇恨
    {"term": "颠覆政权", "category": "politics", "severity": "high", "replacement": "社会冲突", "reason": "避免极端政治表达"},
    {"term": "恐怖袭击", "category": "politics", "severity": "high", "replacement": "紧急事件", "reason": "避免恐怖内容直述"},
    {"term": "种族清洗", "category": "hate", "severity": "high", "replacement": "群体冲突", "reason": "避免仇恨和歧视内容"},
    {"term": "仇恨宣言", "category": "hate", "severity": "high", "replacement": "极端言论", "reason": "避免仇恨动员表达"},
]


def _deduplicate_matches(matches: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = set()
    deduped: List[Dict[str, Any]] = []
    for item in sorted(matches, key=lambda x: (x["start"], x["end"], x["term"])):
        key = (item["start"], item["end"], item["term"], item["category"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def analyze_prompt_text(prompt: str) -> Dict[str, Any]:
    text = (prompt or "").strip()
    if not text:
        return {
            "safe": True,
            "risk_score": 0,
            "categories": [],
            "matches": [],
            "suggestions": [],
        }

    raw_matches: List[Dict[str, Any]] = []
    for rule in _SENSITIVE_RULES:
        term = rule["term"]
        if not term:
            continue
        flags = re.IGNORECASE if re.search(r"[A-Za-z]", term) else 0
        for found in re.finditer(re.escape(term), text, flags):
            raw_matches.append({
                "term": found.group(0),
                "category": rule["category"],
                "category_label": _CATEGORY_LABELS.get(rule["category"], rule["category"]),
                "severity": rule["severity"],
                "replacement": rule["replacement"],
                "reason": rule["reason"],
                "start": found.start(),
                "end": found.end(),
            })

    matches = _deduplicate_matches(raw_matches)
    categories = sorted(set(item["category"] for item in matches))

    suggestions: List[Dict[str, Any]] = []
    seen_terms = set()
    risk_score = 0
    for item in matches:
        risk_score += _SEVERITY_SCORE.get(item["severity"], 1)
        term_key = item["term"].lower()
        if term_key in seen_terms:
            continue
        seen_terms.add(term_key)
        suggestions.append({
            "source": item["term"],
            "replacement": item["replacement"],
            "reason": item["reason"],
            "category": item["category"],
            "category_label": item["category_label"],
        })

    return {
        "safe": len(matches) == 0,
        "risk_score": risk_score,
        "categories": categories,
        "matches": matches,
        "suggestions": suggestions,
    }


def apply_prompt_suggestions(prompt: str, suggestions: List[Dict[str, Any]]) -> str:
    optimized = prompt or ""
    if not optimized.strip() or not suggestions:
        return optimized

    ordered = sorted(
        [item for item in suggestions if item.get("source") and item.get("replacement")],
        key=lambda x: len(str(x["source"])),
        reverse=True,
    )
    for item in ordered:
        source = str(item["source"]).strip()
        replacement = str(item["replacement"]).strip()
        if not source or not replacement:
            continue
        flags = re.IGNORECASE if re.search(r"[A-Za-z]", source) else 0
        optimized = re.sub(re.escape(source), replacement, optimized, flags=flags)
    return optimized


def build_prompt_optimize_llm_payload(prompt: str, analysis: Dict[str, Any]) -> Tuple[str, str]:
    issues = analysis.get("matches") or []
    issue_lines = [
        f"- {item.get('term')} | {item.get('category_label')} | {item.get('severity')} | 建议:{item.get('replacement')}"
        for item in issues
    ]
    issue_text = "\n".join(issue_lines) if issue_lines else "- 无命中问题"

    system_prompt = (
        "你是提示词安全优化助手。"
        "任务是保留原有镜头意图、构图、风格和节奏，同时将不安全表达替换为更安全、可用于图像/视频生成的表达。"
        "必须输出 JSON，格式为 {\"optimized_prompt\":\"...\"}，不要输出其它字段。"
    )
    user_prompt = (
        "请根据以下风险项优化提示词。\n"
        "要求：\n"
        "1) 尽量保留原始语义与风格，不要过度改写。\n"
        "2) 将高风险词替换为中性表达。\n"
        "3) 不要引入新的敏感内容。\n"
        f"原始提示词:\n{prompt}\n\n"
        f"命中风险项:\n{issue_text}\n"
    )
    return system_prompt, user_prompt

