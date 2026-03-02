"""情绪氛围预制包 — Phase 1 正式版

替代 Phase 0 的简易 EMOTION_VISUAL_HINTS 映射，提供完整的色调/线条/特效词条组合。
每个 Mood Pack 由 4 个维度组成：
- color_tokens: 色调/光影词
- line_style_tokens: 线条/笔触风格词
- effect_tokens: 视觉特效词
- combined_prompt: 上述三者 + 额外语义词的完整组合
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime
from typing import Any, Dict, List, Optional


# ======================================================================
# 数据模型
# ======================================================================

@dataclass
class MoodPack:
    """单个情绪氛围预制包。"""

    mood_key: str
    label_zh: str
    label_en: str
    color_tokens: str
    line_style_tokens: str
    effect_tokens: str
    combined_prompt: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


# ======================================================================
# 8 个内置预制包
# ======================================================================

BUILTIN_MOOD_PACKS: Dict[str, MoodPack] = {
    "tense": MoodPack(
        mood_key="tense",
        label_zh="紧张",
        label_en="Tense",
        color_tokens="high contrast, heavy shadow, cold highlights",
        line_style_tokens="sharp lines, dynamic strokes, angular composition",
        effect_tokens="motion blur, sweat drops, speed lines, dramatic lighting",
        combined_prompt=(
            "high contrast, heavy shadow, cold highlights, "
            "sharp lines, dynamic strokes, angular composition, "
            "motion blur, sweat drops, speed lines, dramatic lighting, "
            "intense atmosphere, cinematic tension"
        ),
    ),
    "tender": MoodPack(
        mood_key="tender",
        label_zh="温柔",
        label_en="Tender",
        color_tokens="soft focus, warm backlighting, pastel palette, golden hour glow",
        line_style_tokens="smooth curves, gentle lines, flowing forms",
        effect_tokens="flower petals, lens flare, bokeh highlights, soft vignette",
        combined_prompt=(
            "soft focus, warm backlighting, pastel palette, golden hour glow, "
            "smooth curves, gentle lines, flowing forms, "
            "flower petals, lens flare, bokeh highlights, soft vignette, "
            "intimate mood, gentle warmth"
        ),
    ),
    "despair": MoodPack(
        mood_key="despair",
        label_zh="绝望",
        label_en="Despair",
        color_tokens="desaturated, heavy shadows, muted colors, cold blue undertone",
        line_style_tokens="rough lines, trembling strokes, broken outlines",
        effect_tokens="rain drops, broken panel border, monochrome accent, falling debris",
        combined_prompt=(
            "desaturated, heavy shadows, muted colors, cold blue undertone, "
            "rough lines, trembling strokes, broken outlines, "
            "rain drops, broken panel border, monochrome accent, falling debris, "
            "oppressive atmosphere, emotional weight"
        ),
    ),
    "cool": MoodPack(
        mood_key="cool",
        label_zh="爽",
        label_en="Cool",
        color_tokens="dynamic angle, gold rim light, saturated colors, neon accents",
        line_style_tokens="bold outlines, sharp contrasts, geometric forms",
        effect_tokens="speed lines, particle burst, dramatic pose, energy aura",
        combined_prompt=(
            "dynamic angle, gold rim light, saturated colors, neon accents, "
            "bold outlines, sharp contrasts, geometric forms, "
            "speed lines, particle burst, dramatic pose, energy aura, "
            "power fantasy, epic moment"
        ),
    ),
    "suspense": MoodPack(
        mood_key="suspense",
        label_zh="悬疑",
        label_en="Suspense",
        color_tokens="low-key lighting, cold color temperature, deep shadows, single light source",
        line_style_tokens="thin lines, precise details, tight framing",
        effect_tokens="silhouette, fog, dust particles, lens distortion",
        combined_prompt=(
            "low-key lighting, cold color temperature, deep shadows, single light source, "
            "thin lines, precise details, tight framing, "
            "silhouette, fog, dust particles, lens distortion, "
            "mystery, unease, hidden threat"
        ),
    ),
    "warm": MoodPack(
        mood_key="warm",
        label_zh="温馨",
        label_en="Warm",
        color_tokens="warm tones, dappled light, soft bokeh, amber glow",
        line_style_tokens="relaxed strokes, rounded forms, organic shapes",
        effect_tokens="cozy interior, natural shadows, steam, warm breath",
        combined_prompt=(
            "warm tones, dappled light, soft bokeh, amber glow, "
            "relaxed strokes, rounded forms, organic shapes, "
            "cozy interior, natural shadows, steam, warm breath, "
            "comfort, nostalgia, peaceful mood"
        ),
    ),
    "angry": MoodPack(
        mood_key="angry",
        label_zh="愤怒",
        label_en="Angry",
        color_tokens="harsh lighting, red tones, sharp shadows, high saturation",
        line_style_tokens="jagged lines, aggressive strokes, fractured forms",
        effect_tokens="cracked background, vein marks, shockwave, debris",
        combined_prompt=(
            "harsh lighting, red tones, sharp shadows, high saturation, "
            "jagged lines, aggressive strokes, fractured forms, "
            "cracked background, vein marks, shockwave, debris, "
            "rage, destructive force, volatile energy"
        ),
    ),
    "fear": MoodPack(
        mood_key="fear",
        label_zh="恐惧",
        label_en="Fear",
        color_tokens="cold blue tones, dark vignette, sickly green undertone",
        line_style_tokens="uneven lines, distorted forms, warped perspective",
        effect_tokens="trembling lines, wide eyes, sweat, creeping shadow",
        combined_prompt=(
            "cold blue tones, dark vignette, sickly green undertone, "
            "uneven lines, distorted forms, warped perspective, "
            "trembling lines, wide eyes, sweat, creeping shadow, "
            "dread, vulnerability, impending doom"
        ),
    ),
}


# ======================================================================
# 中文 / 英文别名 → mood_key 映射
# ======================================================================

ZH_MOOD_ALIASES: Dict[str, str] = {
    # 主键 (中文)
    "紧张": "tense",
    "温柔": "tender",
    "绝望": "despair",
    "爽": "cool",
    "悬疑": "suspense",
    "温馨": "warm",
    "愤怒": "angry",
    "恐惧": "fear",
    # 主键 (英文)
    "tense": "tense",
    "tender": "tender",
    "despair": "despair",
    "cool": "cool",
    "suspense": "suspense",
    "warm": "warm",
    "angry": "angry",
    "fear": "fear",
    # 扩展别名
    "害怕": "fear",
    "惊恐": "fear",
    "生气": "angry",
    "暴怒": "angry",
    "甜蜜": "tender",
    "温暖": "warm",
    "热血": "cool",
    "燃": "cool",
    "紧迫": "tense",
    "焦虑": "tense",
    "神秘": "suspense",
    "诡异": "suspense",
    "悲伤": "despair",
    "哀伤": "despair",
    "舒适": "warm",
    "安详": "warm",
    "惬意": "warm",
}


# ======================================================================
# 内部辅助
# ======================================================================

def _resolve_mood_key(raw_key: str) -> Optional[str]:
    """将用户输入（中文/英文/别名）解析为标准 mood_key。"""
    key = raw_key.strip()
    if not key:
        return None
    # 精确匹配别名表
    resolved = ZH_MOOD_ALIASES.get(key)
    if resolved:
        return resolved
    # 忽略大小写匹配
    key_lower = key.lower()
    for alias, mood_key in ZH_MOOD_ALIASES.items():
        if alias.lower() == key_lower:
            return mood_key
    return None


def _gen_id(prefix: str = "mp_") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _now() -> str:
    return datetime.now().isoformat()


# ======================================================================
# 公开 API — 查询
# ======================================================================

def get_mood_pack(mood_key: str, series_id: str = "") -> Optional[MoodPack]:
    """解析 mood_key（支持中文别名）并返回对应的 MoodPack。

    优先查找 DB 中该 series_id 下的自定义包，找不到时回退到内置包。
    若 series_id 为空则只查内置包。
    """
    resolved = _resolve_mood_key(mood_key)
    if resolved is None:
        return None

    # 如果提供了 series_id，尝试从 DB 查找自定义包
    if series_id:
        custom = _load_custom_pack_from_db(series_id, resolved)
        if custom is not None:
            return custom

    return BUILTIN_MOOD_PACKS.get(resolved)


def get_mood_visual_prompt(mood_key: str, series_id: str = "") -> str:
    """返回 combined_prompt 字符串，可直接注入到提示词中。

    找不到时返回空字符串。
    """
    pack = get_mood_pack(mood_key, series_id=series_id)
    if pack is None:
        return ""
    return pack.combined_prompt


def list_available_moods() -> List[Dict[str, Any]]:
    """列出所有可用的内置情绪预制包摘要信息。"""
    results: List[Dict[str, Any]] = []
    for key, pack in BUILTIN_MOOD_PACKS.items():
        results.append({
            "mood_key": key,
            "label_zh": pack.label_zh,
            "label_en": pack.label_en,
            "combined_prompt": pack.combined_prompt,
        })
    return results


# ======================================================================
# DB 自定义包 CRUD
# ======================================================================

def _load_custom_pack_from_db(
    series_id: str,
    mood_key: str,
) -> Optional[MoodPack]:
    """从 StudioStorage 的 custom_mood_packs 表读取自定义包。

    使用惰性导入避免循环依赖。如果表不存在则静默返回 None。
    """
    try:
        from backend.services.studio_storage import StudioStorage
        storage = StudioStorage()
        conn = storage._connect()
        try:
            # 检查表是否存在
            table_check = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='custom_mood_packs'"
            ).fetchone()
            if not table_check:
                return None
            row = conn.execute(
                "SELECT * FROM custom_mood_packs WHERE series_id=? AND mood_key=? ORDER BY updated_at DESC LIMIT 1",
                (series_id, mood_key),
            ).fetchone()
            if not row:
                return None
            return MoodPack(
                mood_key=row["mood_key"],
                label_zh=row["label_zh"] if "label_zh" in row.keys() else mood_key,
                label_en=row["label_en"] if "label_en" in row.keys() else mood_key,
                color_tokens=row["color_tokens"],
                line_style_tokens=row["line_style_tokens"],
                effect_tokens=row["effect_tokens"],
                combined_prompt=row["combined_prompt"],
            )
        finally:
            conn.close()
    except Exception:
        return None


_CUSTOM_MOOD_PACKS_DDL = """
CREATE TABLE IF NOT EXISTS custom_mood_packs (
    id                  TEXT PRIMARY KEY,
    series_id           TEXT NOT NULL,
    mood_key            TEXT NOT NULL,
    label_zh            TEXT DEFAULT '',
    label_en            TEXT DEFAULT '',
    color_tokens        TEXT DEFAULT '',
    line_style_tokens   TEXT DEFAULT '',
    effect_tokens       TEXT DEFAULT '',
    combined_prompt     TEXT DEFAULT '',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    UNIQUE(series_id, mood_key)
);
CREATE INDEX IF NOT EXISTS idx_custom_mood_packs_series ON custom_mood_packs(series_id, mood_key);
"""


def _ensure_custom_table(conn: Any) -> None:
    """确保 custom_mood_packs 表存在。"""
    conn.executescript(_CUSTOM_MOOD_PACKS_DDL)


def save_custom_mood_pack(
    storage: Any,
    series_id: str,
    mood_key: str,
    tokens: Dict[str, str],
) -> Dict[str, Any]:
    """保存/更新一个自定义情绪氛围包。

    tokens 应包含:
        color_tokens, line_style_tokens, effect_tokens,
        combined_prompt (可选, 会自动拼接),
        label_zh (可选), label_en (可选)

    如果 combined_prompt 未提供，则自动将三种 tokens 拼合。
    同一 series_id + mood_key 会覆盖已有记录（UPSERT）。
    """
    color = str(tokens.get("color_tokens", "")).strip()
    line = str(tokens.get("line_style_tokens", "")).strip()
    effect = str(tokens.get("effect_tokens", "")).strip()
    combined = str(tokens.get("combined_prompt", "")).strip()
    label_zh = str(tokens.get("label_zh", mood_key)).strip()
    label_en = str(tokens.get("label_en", mood_key)).strip()

    if not combined:
        parts = [t for t in (color, line, effect) if t]
        combined = ", ".join(parts)

    now = _now()
    pack_id = _gen_id("mp_")

    conn = storage._connect()
    try:
        _ensure_custom_table(conn)
        # UPSERT: 若 series_id + mood_key 已存在则更新
        existing = conn.execute(
            "SELECT id FROM custom_mood_packs WHERE series_id=? AND mood_key=?",
            (series_id, mood_key),
        ).fetchone()
        if existing:
            pack_id = existing["id"]
            conn.execute(
                """UPDATE custom_mood_packs
                   SET label_zh=?, label_en=?, color_tokens=?,
                       line_style_tokens=?, effect_tokens=?,
                       combined_prompt=?, updated_at=?
                   WHERE id=?""",
                (label_zh, label_en, color, line, effect, combined, now, pack_id),
            )
        else:
            conn.execute(
                """INSERT INTO custom_mood_packs
                   (id, series_id, mood_key, label_zh, label_en,
                    color_tokens, line_style_tokens, effect_tokens,
                    combined_prompt, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (pack_id, series_id, mood_key, label_zh, label_en,
                 color, line, effect, combined, now, now),
            )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM custom_mood_packs WHERE id=?", (pack_id,)
        ).fetchone()
        return dict(row) if row else {"id": pack_id, "series_id": series_id, "mood_key": mood_key}
    finally:
        conn.close()


def delete_custom_mood_pack(storage: Any, pack_id: str) -> bool:
    """按 ID 删除一个自定义情绪氛围包。"""
    conn = storage._connect()
    try:
        _ensure_custom_table(conn)
        cur = conn.execute(
            "DELETE FROM custom_mood_packs WHERE id=?", (pack_id,)
        )
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


def list_custom_mood_packs(storage: Any, series_id: str) -> List[Dict[str, Any]]:
    """列出某个系列下的所有自定义情绪氛围包。"""
    conn = storage._connect()
    try:
        _ensure_custom_table(conn)
        rows = conn.execute(
            "SELECT * FROM custom_mood_packs WHERE series_id=? ORDER BY mood_key",
            (series_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
