"""Studio Prompt Sentinel

提供提示词敏感词检测、替代建议与安全化改写辅助能力。
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple


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

# ---------------------------------------------------------------------------
# Sensitive-word rules  (100+ entries, ~25-30 per category)
#
# Each rule:
#   term        – plain text; matched via re.escape (Chinese) or as regex
#                 pattern with word boundaries (English/mixed)
#   pattern     – (optional) raw regex to use instead of the auto-generated one
#   category    – violence | adult | politics | hate
#   severity    – low | medium | high
#   replacement – safe alternative
#   reason      – human-readable explanation
# ---------------------------------------------------------------------------

_SENSITIVE_RULES: List[Dict[str, str]] = [
    # ========================================================================
    # VIOLENCE  (28 rules)
    # ========================================================================
    # -- Chinese --
    {"term": "杀死", "category": "violence", "severity": "high", "replacement": "制服", "reason": "避免直接致命伤害表达"},
    {"term": "斩首", "category": "violence", "severity": "high", "replacement": "制服", "reason": "避免血腥暴力动作"},
    {"term": "爆头", "category": "violence", "severity": "high", "replacement": "击退", "reason": "避免血腥暴力细节"},
    {"term": "肢解", "category": "violence", "severity": "high", "replacement": "激烈冲突", "reason": "避免残忍画面描述"},
    {"term": "血浆", "category": "violence", "severity": "medium", "replacement": "冲击痕迹", "reason": "降低血腥程度"},
    {"term": "血肉横飞", "category": "violence", "severity": "high", "replacement": "场面混乱", "reason": "避免血腥夸张描写"},
    {"term": "自残", "category": "violence", "severity": "high", "replacement": "内心挣扎", "reason": "避免自我伤害描写"},
    {"term": "自杀", "category": "violence", "severity": "high", "replacement": "寻求帮助", "reason": "避免自杀相关内容"},
    {"term": "刺伤", "category": "violence", "severity": "high", "replacement": "冲突", "reason": "避免利器伤害描写"},
    {"term": "勒死", "category": "violence", "severity": "high", "replacement": "控制", "reason": "避免窒息暴力描写"},
    {"term": "开枪", "category": "violence", "severity": "high", "replacement": "紧急对峙", "reason": "避免枪击暴力描写"},
    {"term": "纵火", "category": "violence", "severity": "high", "replacement": "意外火灾", "reason": "避免蓄意纵火描写"},
    {"term": "处决", "category": "violence", "severity": "high", "replacement": "审判", "reason": "避免处刑暴力描写"},
    {"term": "虐待", "category": "violence", "severity": "high", "replacement": "困境", "reason": "避免虐待行为描写"},
    # -- English --
    {"term": "bloodshed", "category": "violence", "severity": "high", "replacement": "conflict", "reason": "Avoid graphic violence imagery"},
    {"term": "massacre", "category": "violence", "severity": "high", "replacement": "large-scale conflict", "reason": "Avoid mass-killing descriptions"},
    {"term": "gore", "category": "violence", "severity": "high", "replacement": "intense scene", "reason": "Avoid gory visual content"},
    {"term": "dismember", "category": "violence", "severity": "high", "replacement": "struggle", "reason": "Avoid dismemberment imagery"},
    {"term": "decapitate", "category": "violence", "severity": "high", "replacement": "defeat", "reason": "Avoid decapitation imagery"},
    {"term": "strangle", "category": "violence", "severity": "high", "replacement": "restrain", "reason": "Avoid strangulation imagery"},
    {"term": "torture", "category": "violence", "severity": "high", "replacement": "interrogation", "reason": "Avoid torture depiction"},
    {"term": "mutilate", "category": "violence", "severity": "high", "replacement": "injure", "reason": "Avoid mutilation imagery"},
    {"term": "gunshot", "category": "violence", "severity": "high", "replacement": "loud impact", "reason": "Avoid gunshot wound detail"},
    {"term": "self-harm", "category": "violence", "severity": "high", "replacement": "inner struggle", "reason": "Avoid self-harm depiction"},
    {"term": "suicide", "category": "violence", "severity": "high", "replacement": "crisis", "reason": "Avoid suicide-related content"},
    {"term": "slaughter", "category": "violence", "severity": "high", "replacement": "overwhelming defeat", "reason": "Avoid slaughter imagery"},
    {"term": "bludgeon", "category": "violence", "severity": "high", "replacement": "strike", "reason": "Avoid bludgeoning detail"},
    {"term": "impale", "category": "violence", "severity": "high", "replacement": "pin down", "reason": "Avoid impalement imagery"},
    {"term": "lacerate", "category": "violence", "severity": "medium", "replacement": "scratch", "reason": "Reduce wound severity"},
    {"term": "eviscerate", "category": "violence", "severity": "high", "replacement": "overpower", "reason": "Avoid disembowelment imagery"},
    {"term": "suffocate", "category": "violence", "severity": "high", "replacement": "overwhelm", "reason": "Avoid suffocation imagery"},
    {"term": "poisoning", "category": "violence", "severity": "medium", "replacement": "contamination", "reason": "Reduce poisoning specificity"},
    {"term": "assassination", "category": "violence", "severity": "high", "replacement": "targeted incident", "reason": "Avoid assassination detail"},
    {"term": "bombing", "category": "violence", "severity": "high", "replacement": "explosion event", "reason": "Avoid bombing imagery"},
    {"term": "arson", "category": "violence", "severity": "high", "replacement": "fire incident", "reason": "Avoid arson detail"},
    {"term": "execution", "category": "violence", "severity": "high", "replacement": "sentencing", "reason": "Avoid execution depiction"},
    {"term": "stab wound", "category": "violence", "severity": "high", "replacement": "injury", "reason": "Avoid stab wound detail"},
    {"term": "knife attack", "category": "violence", "severity": "high", "replacement": "assault", "reason": "Avoid knife-attack specifics"},
    {"term": "brutal", "category": "violence", "severity": "medium", "replacement": "intense", "reason": "Soften violent adjective"},

    # ========================================================================
    # ADULT  (28 rules)
    # ========================================================================
    # -- Chinese --
    {"term": "裸露", "category": "adult", "severity": "high", "replacement": "着装完整", "reason": "避免成人暴露内容"},
    {"term": "性爱", "category": "adult", "severity": "high", "replacement": "亲密互动", "reason": "避免成人性行为描述"},
    {"term": "性行为", "category": "adult", "severity": "high", "replacement": "情感互动", "reason": "避免成人性行为描述"},
    {"term": "激情缠绵", "category": "adult", "severity": "medium", "replacement": "情感交流", "reason": "降低露骨表述"},
    {"term": "挑逗", "category": "adult", "severity": "medium", "replacement": "互动", "reason": "降低暧昧导向"},
    {"term": "色情", "category": "adult", "severity": "high", "replacement": "不当内容", "reason": "避免色情内容"},
    {"term": "淫秽", "category": "adult", "severity": "high", "replacement": "不雅内容", "reason": "避免淫秽表达"},
    {"term": "春宫", "category": "adult", "severity": "high", "replacement": "古典画作", "reason": "避免色情联想"},
    {"term": "脱衣", "category": "adult", "severity": "high", "replacement": "换装", "reason": "避免脱衣暗示"},
    {"term": "情欲", "category": "adult", "severity": "medium", "replacement": "情感", "reason": "降低情欲色彩"},
    {"term": "媚态", "category": "adult", "severity": "medium", "replacement": "优雅姿态", "reason": "降低色情暗示"},
    {"term": "肉体", "category": "adult", "severity": "medium", "replacement": "身体", "reason": "降低肉欲色彩"},
    # -- English --
    {"term": "explicit", "category": "adult", "severity": "high", "replacement": "detailed", "reason": "Avoid explicit-content trigger"},
    {"term": "pornographic", "category": "adult", "severity": "high", "replacement": "inappropriate", "reason": "Avoid pornographic content"},
    {"term": "erotic", "category": "adult", "severity": "high", "replacement": "romantic", "reason": "Avoid erotic imagery"},
    {"term": "nude", "category": "adult", "severity": "high", "replacement": "fully clothed", "reason": "Avoid nudity depiction"},
    {"term": "naked", "category": "adult", "severity": "high", "replacement": "clothed", "reason": "Avoid nudity depiction"},
    {"term": "sexual", "category": "adult", "severity": "high", "replacement": "emotional", "reason": "Avoid sexual content"},
    {"term": "hentai", "category": "adult", "severity": "high", "replacement": "anime art", "reason": "Avoid adult anime content"},
    {"term": "NSFW", "category": "adult", "severity": "high", "replacement": "SFW", "reason": "Avoid not-safe-for-work content"},
    {"term": "provocative", "category": "adult", "severity": "medium", "replacement": "expressive", "reason": "Reduce provocative undertone"},
    {"term": "obscene", "category": "adult", "severity": "high", "replacement": "inappropriate", "reason": "Avoid obscene content"},
    {"term": "indecent", "category": "adult", "severity": "medium", "replacement": "casual", "reason": "Reduce indecent implication"},
    {"term": "seductive", "category": "adult", "severity": "medium", "replacement": "charming", "reason": "Reduce seductive undertone"},
    {"term": "sensual", "category": "adult", "severity": "medium", "replacement": "gentle", "reason": "Reduce sensual undertone"},
    {"term": "suggestive", "category": "adult", "severity": "medium", "replacement": "subtle", "reason": "Reduce suggestive implication"},
    {"term": "lewd", "category": "adult", "severity": "high", "replacement": "playful", "reason": "Avoid lewd content"},
    {"term": "lustful", "category": "adult", "severity": "medium", "replacement": "passionate", "reason": "Reduce lustful implication"},
    {"term": "fetish", "category": "adult", "severity": "high", "replacement": "preference", "reason": "Avoid fetish content"},
    {"term": "bondage", "category": "adult", "severity": "high", "replacement": "restraint theme", "reason": "Avoid bondage imagery"},
    {"term": "lingerie", "category": "adult", "severity": "medium", "replacement": "casual wear", "reason": "Reduce adult-clothing focus"},
    {"term": "topless", "category": "adult", "severity": "high", "replacement": "fully dressed", "reason": "Avoid topless imagery"},
    {"term": "strip", "pattern": r"\bstrip(?:ping|s|ped)?\b", "category": "adult", "severity": "high", "replacement": "performance", "reason": "Avoid stripping context"},

    # ========================================================================
    # POLITICS  (27 rules)
    # ========================================================================
    # -- Chinese --
    {"term": "颠覆政权", "category": "politics", "severity": "high", "replacement": "社会冲突", "reason": "避免极端政治表达"},
    {"term": "恐怖袭击", "category": "politics", "severity": "high", "replacement": "紧急事件", "reason": "避免恐怖内容直述"},
    {"term": "政治宣传", "category": "politics", "severity": "medium", "replacement": "公共信息", "reason": "降低政治宣传导向"},
    {"term": "独裁者", "category": "politics", "severity": "high", "replacement": "统治者", "reason": "避免极端政治指称"},
    {"term": "政变", "category": "politics", "severity": "high", "replacement": "政治变动", "reason": "避免政变描述"},
    {"term": "戒严", "category": "politics", "severity": "high", "replacement": "紧急状态", "reason": "避免戒严场景渲染"},
    {"term": "镇压", "category": "politics", "severity": "high", "replacement": "管控", "reason": "避免暴力镇压描写"},
    {"term": "分裂主义", "category": "politics", "severity": "high", "replacement": "地区议题", "reason": "避免分裂主义内容"},
    {"term": "极端主义", "category": "politics", "severity": "high", "replacement": "极端立场", "reason": "避免极端主义宣传"},
    {"term": "政治犯", "category": "politics", "severity": "medium", "replacement": "受争议人物", "reason": "降低政治敏感度"},
    {"term": "禁运", "category": "politics", "severity": "medium", "replacement": "贸易限制", "reason": "降低制裁敏感度"},
    {"term": "制裁", "category": "politics", "severity": "medium", "replacement": "贸易限制", "reason": "降低制裁敏感度"},
    # -- English --
    {"term": "propaganda", "category": "politics", "severity": "medium", "replacement": "messaging", "reason": "Avoid propaganda framing"},
    {"term": "regime", "category": "politics", "severity": "medium", "replacement": "government", "reason": "Avoid loaded political term"},
    {"term": "dictator", "category": "politics", "severity": "high", "replacement": "leader", "reason": "Avoid dictator label"},
    {"term": "revolution", "category": "politics", "severity": "medium", "replacement": "social change", "reason": "Reduce revolutionary framing"},
    {"term": "coup", "category": "politics", "severity": "high", "replacement": "political shift", "reason": "Avoid coup framing"},
    {"term": "dissident", "category": "politics", "severity": "medium", "replacement": "critic", "reason": "Reduce political labeling"},
    {"term": "separatist", "category": "politics", "severity": "high", "replacement": "regional advocate", "reason": "Avoid separatist label"},
    {"term": "extremist", "category": "politics", "severity": "high", "replacement": "radical figure", "reason": "Avoid extremist label"},
    {"term": "terrorism", "category": "politics", "severity": "high", "replacement": "security threat", "reason": "Avoid terrorism depiction"},
    {"term": "radicalize", "category": "politics", "severity": "high", "replacement": "influence", "reason": "Avoid radicalization framing"},
    {"term": "insurgent", "category": "politics", "severity": "high", "replacement": "combatant", "reason": "Avoid insurgent label"},
    {"term": "martial law", "category": "politics", "severity": "high", "replacement": "emergency measures", "reason": "Avoid martial-law imagery"},
    {"term": "oppression", "category": "politics", "severity": "medium", "replacement": "hardship", "reason": "Reduce oppression framing"},
    {"term": "tyranny", "category": "politics", "severity": "high", "replacement": "authoritarian rule", "reason": "Avoid tyranny framing"},
    {"term": "fascism", "category": "politics", "severity": "high", "replacement": "authoritarian ideology", "reason": "Avoid fascism reference"},
    {"term": "totalitarian", "category": "politics", "severity": "high", "replacement": "strict governance", "reason": "Avoid totalitarian framing"},
    {"term": "authoritarian", "category": "politics", "severity": "medium", "replacement": "centralized", "reason": "Reduce authoritarian label"},
    {"term": "subversive", "category": "politics", "severity": "medium", "replacement": "unconventional", "reason": "Reduce subversive framing"},
    {"term": "sedition", "category": "politics", "severity": "high", "replacement": "dissent", "reason": "Avoid sedition framing"},
    {"term": "anarchy", "category": "politics", "severity": "medium", "replacement": "disorder", "reason": "Reduce anarchy framing"},
    {"term": "political prisoner", "category": "politics", "severity": "medium", "replacement": "detained individual", "reason": "Reduce politically charged label"},
    {"term": "embargo", "category": "politics", "severity": "medium", "replacement": "trade restriction", "reason": "Reduce embargo specificity"},
    {"term": "sanctions", "category": "politics", "severity": "medium", "replacement": "trade measures", "reason": "Reduce sanctions specificity"},

    # ========================================================================
    # HATE  (28 rules)
    # ========================================================================
    # -- Chinese --
    {"term": "种族清洗", "category": "hate", "severity": "high", "replacement": "群体冲突", "reason": "避免仇恨和歧视内容"},
    {"term": "仇恨宣言", "category": "hate", "severity": "high", "replacement": "极端言论", "reason": "避免仇恨动员表达"},
    {"term": "歧视", "category": "hate", "severity": "medium", "replacement": "偏见", "reason": "降低歧视表达"},
    {"term": "仇外", "category": "hate", "severity": "high", "replacement": "文化差异", "reason": "避免仇外情绪"},
    {"term": "白人至上", "category": "hate", "severity": "high", "replacement": "种族偏见", "reason": "避免种族至上主义"},
    {"term": "种族灭绝", "category": "hate", "severity": "high", "replacement": "大规模冲突", "reason": "避免种族灭绝描写"},
    {"term": "种族隔离", "category": "hate", "severity": "high", "replacement": "社会分隔", "reason": "避免种族隔离美化"},
    {"term": "迫害", "category": "hate", "severity": "high", "replacement": "不公对待", "reason": "避免迫害描述"},
    {"term": "替罪羊", "category": "hate", "severity": "medium", "replacement": "被指责者", "reason": "降低替罪羊叙事"},
    {"term": "污名化", "category": "hate", "severity": "medium", "replacement": "负面标签", "reason": "降低污名化表达"},
    {"term": "妖魔化", "category": "hate", "severity": "medium", "replacement": "负面描述", "reason": "降低妖魔化表达"},
    # -- English --
    {"term": "slur", "category": "hate", "severity": "high", "replacement": "offensive label", "reason": "Avoid slur usage"},
    {"term": "discriminate", "pattern": r"\bdiscriminat(?:e|ion|ing|ory)\b", "category": "hate", "severity": "medium", "replacement": "differentiate", "reason": "Avoid discrimination framing"},
    {"term": "xenophobia", "category": "hate", "severity": "high", "replacement": "cultural tension", "reason": "Avoid xenophobic framing"},
    {"term": "misogyny", "category": "hate", "severity": "high", "replacement": "gender bias", "reason": "Avoid misogynistic content"},
    {"term": "homophobia", "category": "hate", "severity": "high", "replacement": "bias against LGBTQ+", "reason": "Avoid homophobic framing"},
    {"term": "antisemitism", "category": "hate", "severity": "high", "replacement": "religious prejudice", "reason": "Avoid antisemitic content"},
    {"term": "supremacist", "category": "hate", "severity": "high", "replacement": "extremist", "reason": "Avoid supremacist label"},
    {"term": "dehumanize", "pattern": r"\bdehumaniz(?:e|ing|ed|ation)\b", "category": "hate", "severity": "high", "replacement": "disrespect", "reason": "Avoid dehumanization framing"},
    {"term": "bigot", "pattern": r"\bbigot(?:ry|ed|s)?\b", "category": "hate", "severity": "high", "replacement": "prejudiced person", "reason": "Avoid bigotry content"},
    {"term": "ethnic cleansing", "category": "hate", "severity": "high", "replacement": "mass displacement", "reason": "Avoid ethnic-cleansing reference"},
    {"term": "genocide", "category": "hate", "severity": "high", "replacement": "mass atrocity", "reason": "Avoid genocide reference"},
    {"term": "racial profiling", "category": "hate", "severity": "medium", "replacement": "biased targeting", "reason": "Avoid racial-profiling framing"},
    {"term": "hate crime", "category": "hate", "severity": "high", "replacement": "bias-motivated incident", "reason": "Avoid hate-crime depiction"},
    {"term": "intolerance", "category": "hate", "severity": "medium", "replacement": "narrow-mindedness", "reason": "Reduce intolerance framing"},
    {"term": "prejudice", "category": "hate", "severity": "medium", "replacement": "bias", "reason": "Reduce prejudice framing"},
    {"term": "apartheid", "category": "hate", "severity": "high", "replacement": "institutional separation", "reason": "Avoid apartheid reference"},
    {"term": "segregation", "category": "hate", "severity": "high", "replacement": "separation", "reason": "Avoid segregation framing"},
    {"term": "persecution", "category": "hate", "severity": "high", "replacement": "unfair treatment", "reason": "Avoid persecution framing"},
    {"term": "scapegoat", "category": "hate", "severity": "medium", "replacement": "blame target", "reason": "Reduce scapegoat narrative"},
    {"term": "stereotype", "pattern": r"\bstereotyp(?:e|es|ing|ed|ical)\b", "category": "hate", "severity": "medium", "replacement": "generalization", "reason": "Reduce stereotyping framing"},
    {"term": "marginalize", "pattern": r"\bmarginali[sz](?:e|ed|ing|ation)\b", "category": "hate", "severity": "medium", "replacement": "underrepresent", "reason": "Reduce marginalization framing"},
    {"term": "vilify", "pattern": r"\bvilif(?:y|ied|ying|ication)\b", "category": "hate", "severity": "medium", "replacement": "criticize", "reason": "Reduce vilification framing"},
    {"term": "demonize", "pattern": r"\bdemoni[sz](?:e|ed|ing|ation)\b", "category": "hate", "severity": "high", "replacement": "criticize harshly", "reason": "Avoid demonization framing"},
    {"term": "ostracize", "pattern": r"\bostraci[sz](?:e|ed|ing)\b", "category": "hate", "severity": "medium", "replacement": "exclude", "reason": "Reduce ostracism framing"},
]


def _build_regex(rule: Dict[str, str]) -> re.Pattern[str]:
    """Return a compiled regex for *rule*.

    Priority:
    1. ``rule["pattern"]`` – raw regex supplied by the rule author
    2. Auto-generated pattern from ``rule["term"]``:
       * If the term contains any ASCII letter → wrap with ``\\b`` word
         boundaries and set IGNORECASE.
       * Otherwise (pure CJK) → plain ``re.escape`` with no extra flags.
    """
    if rule.get("pattern"):
        return re.compile(rule["pattern"], re.IGNORECASE)

    term = rule["term"]
    has_latin = bool(re.search(r"[A-Za-z]", term))
    if has_latin:
        return re.compile(r"\b" + re.escape(term) + r"\b", re.IGNORECASE)
    return re.compile(re.escape(term))


# Pre-compile all patterns once at import time.
_COMPILED_RULES: List[tuple] = []
for _r in _SENSITIVE_RULES:
    _COMPILED_RULES.append((_build_regex(_r), _r))


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


def _compute_risk_level(total_score: int) -> str:
    """Map an aggregate severity score to a four-tier risk level."""
    if total_score == 0:
        return "safe"
    if total_score <= 3:
        return "low_risk"
    if total_score <= 6:
        return "medium_risk"
    return "high_risk"


def analyze_prompt_text(prompt: str) -> Dict[str, Any]:
    text = (prompt or "").strip()
    if not text:
        return {
            "safe": True,
            "risk_score": 0,
            "risk_level": "safe",
            "categories": [],
            "matches": [],
            "suggestions": [],
        }

    raw_matches: List[Dict[str, Any]] = []
    for compiled, rule in _COMPILED_RULES:
        for found in compiled.finditer(text):
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
        "risk_level": _compute_risk_level(risk_score),
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


# ---------------------------------------------------------------------------
# Phase 2: 知识库合规检查
# ---------------------------------------------------------------------------

def check_kb_compliance(
    prompt: str,
    shot: Dict[str, Any],
    kb_context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """知识库合规性检查 — 验证提示词是否遵循知识库约束

    检查项：
    1. 角色描述是否包含知识库词条（非自由发挥）
    2. 情绪词条是否来自预制包
    3. 禁止元素是否出现
    4. 负面提示词是否完整
    5. 景别/角度/运镜是否使用标准词条
    """
    if not kb_context:
        return {"compliant": True, "score": 100.0, "issues": []}

    issues: List[Dict[str, Any]] = []
    text = (prompt or "").strip()
    text_lower = text.lower()

    # 1. 检查禁止元素
    forbidden = str(kb_context.get("forbidden_elements") or "").strip()
    if forbidden:
        for elem in forbidden.split(","):
            elem = elem.strip()
            if elem and elem.lower() in text_lower:
                issues.append({
                    "severity": "error",
                    "check": "forbidden_element",
                    "description": f"提示词包含禁止元素「{elem}」",
                    "fix_suggestion": f"请移除「{elem}」，该元素在世界观词典中被标记为禁止",
                })

    # 2. 检查角色词条覆盖率
    character_cards = kb_context.get("character_cards", [])
    for card in character_cards:
        appearance = card.get("appearance_tokens", {})
        if isinstance(appearance, str):
            try:
                import json
                appearance = json.loads(appearance)
            except Exception:
                appearance = {}
        if not appearance:
            continue
        total_features = len(appearance)
        matched = 0
        for _key, val in appearance.items():
            if val and str(val).strip().lower() in text_lower:
                matched += 1
        if total_features > 0:
            coverage = matched / total_features
            if coverage < 0.3:
                issues.append({
                    "severity": "warning",
                    "check": "character_coverage",
                    "description": f"角色档案词条覆盖率仅 {coverage:.0%}，可能存在自由发挥",
                    "fix_suggestion": "建议启用知识库组装模式自动注入角色词条",
                })

    # 3. 检查情绪词条
    emotion = str(shot.get("emotion") or "").strip()
    if emotion:
        mood_packs = kb_context.get("available_moods", [])
        mood_keys = [m.get("mood_key", "") for m in mood_packs] if mood_packs else []
        from .mood_packs import resolve_mood_key
        resolved = resolve_mood_key(emotion)
        if resolved and mood_keys and resolved not in mood_keys:
            issues.append({
                "severity": "info",
                "check": "mood_not_in_packs",
                "description": f"情绪「{emotion}」不在预制包中",
                "fix_suggestion": "可以创建自定义情绪氛围包",
            })

    # 4. 检查景别/角度标准词条
    from .constants import SHOT_SIZE_STANDARDS, CAMERA_ANGLES
    shot_size = str(shot.get("shot_size") or "").strip()
    if shot_size and shot_size not in SHOT_SIZE_STANDARDS:
        issues.append({
            "severity": "warning",
            "check": "non_standard_shot_size",
            "description": f"景别「{shot_size}」不是标准词条",
            "fix_suggestion": f"请使用标准景别: {', '.join(SHOT_SIZE_STANDARDS.keys())}",
        })
    camera_angle = str(shot.get("camera_angle") or "").strip()
    if camera_angle and camera_angle not in CAMERA_ANGLES:
        issues.append({
            "severity": "warning",
            "check": "non_standard_angle",
            "description": f"机位角度「{camera_angle}」不是标准词条",
            "fix_suggestion": f"请使用标准角度: {', '.join(CAMERA_ANGLES.keys())}",
        })

    # 计算分数
    error_count = sum(1 for i in issues if i["severity"] == "error")
    warning_count = sum(1 for i in issues if i["severity"] == "warning")
    score = max(0.0, 100.0 - error_count * 20 - warning_count * 8)

    return {
        "compliant": error_count == 0,
        "score": round(score, 1),
        "issues": issues,
    }
