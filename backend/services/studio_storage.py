"""Studio 长篇制作工作台 - SQLite 存储层"""
import os
import json
import sqlite3
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "studio.db")
UPLOAD_DIR = os.path.join(BACKEND_DIR, "uploads")
STUDIO_AUDIO_DIR = os.path.join(DATA_DIR, "studio_audio")

os.makedirs(DATA_DIR, exist_ok=True)


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _now() -> str:
    return datetime.now().isoformat()


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS series (
    id              TEXT PRIMARY KEY,
    workspace_id    TEXT DEFAULT '',
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    series_bible    TEXT DEFAULT '',
    visual_style    TEXT DEFAULT '',
    source_script   TEXT DEFAULT '',
    settings        TEXT DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS volumes (
    id              TEXT PRIMARY KEY,
    series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    volume_number   INTEGER NOT NULL,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    source_text     TEXT DEFAULT '',
    style_anchor    TEXT DEFAULT '{}',
    status          TEXT DEFAULT 'draft',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL,
    UNIQUE(series_id, volume_number)
);

CREATE TABLE IF NOT EXISTS episodes (
    id                      TEXT PRIMARY KEY,
    series_id               TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    volume_id               TEXT DEFAULT '',
    act_number              INTEGER NOT NULL,
    title                   TEXT DEFAULT '',
    summary                 TEXT DEFAULT '',
    script_excerpt          TEXT DEFAULT '',
    creative_brief          TEXT DEFAULT '{}',
    target_duration_seconds REAL DEFAULT 60.0,
    status                  TEXT DEFAULT 'draft',
    created_at              TEXT NOT NULL,
    updated_at              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shared_elements (
    id                  TEXT PRIMARY KEY,
    series_id           TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL,
    description         TEXT DEFAULT '',
    voice_profile       TEXT DEFAULT '',
    is_favorite         INTEGER DEFAULT 0,
    image_url           TEXT DEFAULT '',
    image_history       TEXT DEFAULT '[]',
    reference_images    TEXT DEFAULT '[]',
    appears_in_episodes TEXT DEFAULT '[]',
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shots (
    id              TEXT PRIMARY KEY,
    episode_id      TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    segment_name    TEXT DEFAULT '',
    sort_order      INTEGER NOT NULL,
    name            TEXT DEFAULT '',
    type            TEXT DEFAULT 'standard',
    duration        REAL DEFAULT 5.0,
    description     TEXT DEFAULT '',
    prompt          TEXT DEFAULT '',
    end_prompt      TEXT DEFAULT '',
    video_prompt    TEXT DEFAULT '',
    narration       TEXT DEFAULT '',
    dialogue_script TEXT DEFAULT '',
    sound_effects   TEXT DEFAULT '',
    start_image_url TEXT DEFAULT '',
    end_image_url   TEXT DEFAULT '',
    frame_history   TEXT DEFAULT '[]',
    video_url       TEXT DEFAULT '',
    video_history   TEXT DEFAULT '[]',
    audio_url       TEXT DEFAULT '',
    visual_action   TEXT DEFAULT '{}',
    shot_size       TEXT DEFAULT '',
    camera_angle    TEXT DEFAULT '',
    camera_movement TEXT DEFAULT '',
    emotion         TEXT DEFAULT '',
    emotion_intensity INTEGER DEFAULT 0,
    key_frame_prompt TEXT DEFAULT '',
    key_frame_url   TEXT DEFAULT '',
    status          TEXT DEFAULT 'pending',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episode_elements (
    id                  TEXT PRIMARY KEY,
    episode_id          TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    shared_element_id   TEXT,
    name                TEXT NOT NULL,
    type                TEXT NOT NULL,
    description         TEXT DEFAULT '',
    voice_profile       TEXT DEFAULT '',
    image_url           TEXT DEFAULT '',
    is_override         INTEGER DEFAULT 0,
    created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS studio_history (
    id              TEXT PRIMARY KEY,
    series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    episode_id      TEXT NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
    action          TEXT NOT NULL,
    snapshot_json   TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS digital_human_profiles (
    id              TEXT PRIMARY KEY,
    series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
    base_name       TEXT NOT NULL,
    display_name    TEXT DEFAULT '',
    stage_label     TEXT DEFAULT '',
    appearance      TEXT DEFAULT '',
    voice_profile   TEXT DEFAULT '',
    scene_template  TEXT DEFAULT '',
    lip_sync_style  TEXT DEFAULT '',
    sort_order      INTEGER DEFAULT 0,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- 角色提示词档案（从 shared_elements 的 character 自动生成）
CREATE TABLE IF NOT EXISTS kb_character_cards (
    id TEXT PRIMARY KEY,
    element_id TEXT,
    appearance_tokens TEXT DEFAULT '{}',
    costume_tokens TEXT DEFAULT '{}',
    expression_tokens TEXT DEFAULT '{}',
    signature_poses TEXT DEFAULT '{}',
    negative_prompts TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 情绪氛围预制包
CREATE TABLE IF NOT EXISTS kb_mood_packs (
    id TEXT PRIMARY KEY,
    series_id TEXT DEFAULT '',
    mood_key TEXT NOT NULL,
    color_tokens TEXT DEFAULT '',
    line_style_tokens TEXT DEFAULT '',
    effect_tokens TEXT DEFAULT '',
    combined_prompt TEXT DEFAULT '',
    is_builtin INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 场景提示词档案（从 shared_elements 的 scene 自动生成）
CREATE TABLE IF NOT EXISTS kb_scene_cards (
    id TEXT PRIMARY KEY,
    element_id TEXT,
    base_tokens TEXT DEFAULT '',
    time_variants TEXT DEFAULT '{}',
    negative_prompts TEXT DEFAULT '',
    version INTEGER DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- 世界观提示词词典
CREATE TABLE IF NOT EXISTS kb_world_bible (
    id TEXT PRIMARY KEY,
    series_id TEXT DEFAULT '',
    art_style TEXT DEFAULT '',
    era TEXT DEFAULT '',
    color_palette TEXT DEFAULT '',
    recurring_motifs TEXT DEFAULT '',
    forbidden_elements TEXT DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_volumes_series ON volumes(series_id, volume_number);
CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_shared_elements_series ON shared_elements(series_id);
CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_elements_episode ON episode_elements(episode_id);
CREATE INDEX IF NOT EXISTS idx_studio_history_episode ON studio_history(episode_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_kb_character_cards_element ON kb_character_cards(element_id);
CREATE INDEX IF NOT EXISTS idx_kb_mood_packs_series ON kb_mood_packs(series_id, mood_key);
CREATE INDEX IF NOT EXISTS idx_kb_scene_cards_element ON kb_scene_cards(element_id);
CREATE INDEX IF NOT EXISTS idx_kb_world_bible_series ON kb_world_bible(series_id);
"""


class StudioStorage:
    """Studio 工作台 SQLite 存储"""

    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        conn = self._connect()
        try:
            conn.executescript(_SCHEMA_SQL)
            self._migrate_schema(conn)
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _column_exists(conn: sqlite3.Connection, table: str, column: str) -> bool:
        rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return any(r["name"] == column for r in rows)

    def _ensure_column(
        self,
        conn: sqlite3.Connection,
        table: str,
        column: str,
        column_ddl: str,
    ) -> None:
        if self._column_exists(conn, table, column):
            return
        conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {column_ddl}")

    def _migrate_schema(self, conn: sqlite3.Connection) -> None:
        """为历史数据库补齐新列。"""
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS volumes (
                id              TEXT PRIMARY KEY,
                series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
                volume_number   INTEGER NOT NULL,
                name            TEXT NOT NULL,
                description     TEXT DEFAULT '',
                source_text     TEXT DEFAULT '',
                style_anchor    TEXT DEFAULT '{}',
                status          TEXT DEFAULT 'draft',
                created_at      TEXT NOT NULL,
                updated_at      TEXT NOT NULL,
                UNIQUE(series_id, volume_number)
            )
            """
        )
        self._ensure_column(conn, "series", "workspace_id", "TEXT DEFAULT ''")
        self._ensure_column(conn, "episodes", "volume_id", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shared_elements", "is_favorite", "INTEGER DEFAULT 0")
        self._ensure_column(conn, "shots", "end_prompt", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "end_image_url", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "sound_effects", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "frame_history", "TEXT DEFAULT '[]'")
        self._ensure_column(conn, "shots", "video_history", "TEXT DEFAULT '[]'")
        self._ensure_column(conn, "shots", "visual_action", "TEXT DEFAULT '{}'")
        # 精细化影视参数（对标 prompt_i18n.go 专业景别/运镜/情绪体系）
        self._ensure_column(conn, "shots", "shot_size", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "camera_angle", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "camera_movement", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "emotion", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "emotion_intensity", "INTEGER DEFAULT 0")
        self._ensure_column(conn, "shots", "key_frame_prompt", "TEXT DEFAULT ''")
        self._ensure_column(conn, "shots", "key_frame_url", "TEXT DEFAULT ''")
        self._ensure_column(conn, "digital_human_profiles", "display_name", "TEXT DEFAULT ''")
        self._ensure_column(conn, "digital_human_profiles", "scene_template", "TEXT DEFAULT ''")
        self._ensure_column(conn, "digital_human_profiles", "lip_sync_style", "TEXT DEFAULT ''")
        self._ensure_column(conn, "digital_human_profiles", "sort_order", "INTEGER DEFAULT 0")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_series_workspace ON series(workspace_id, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_volumes_series ON volumes(series_id, volume_number)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_episodes_volume ON episodes(volume_id, act_number)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dh_profiles_series ON digital_human_profiles(series_id, sort_order, updated_at DESC)")

    @staticmethod
    def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        d = dict(row)
        # 自动反序列化 JSON 字段
        for key in ("settings", "creative_brief", "image_history",
                     "reference_images", "appears_in_episodes",
                     "frame_history", "video_history", "visual_action",
                     "snapshot_json", "style_anchor",
                     "appearance_tokens", "costume_tokens",
                     "expression_tokens", "signature_poses",
                     "time_variants"):
            if key in d and isinstance(d[key], str):
                try:
                    d[key] = json.loads(d[key])
                except (json.JSONDecodeError, TypeError):
                    pass
        return d

    @staticmethod
    def _json_field(value: Any) -> str:
        if isinstance(value, str):
            return value
        return json.dumps(value, ensure_ascii=False)

    # ==================================================================
    # 系列 CRUD
    # ==================================================================

    def create_series(
        self,
        name: str,
        workspace_id: str = "",
        description: str = "",
        source_script: str = "",
        series_bible: str = "",
        visual_style: str = "",
        settings: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        sid = _gen_id("series_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO series
                   (id, workspace_id, name, description, series_bible, visual_style,
                    source_script, settings, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (sid, workspace_id, name, description, series_bible, visual_style,
                 source_script, self._json_field(settings or {}), now, now),
            )
            conn.commit()
            return self.get_series(sid, _conn=conn)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_series(
        self, series_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM series WHERE id=?", (series_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def list_series(self, limit: int = 50, workspace_id: Optional[str] = None) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            sql = """SELECT s.*,
                            (SELECT COUNT(*) FROM episodes e WHERE e.series_id=s.id) AS episode_count,
                            (SELECT COUNT(*) FROM volumes v WHERE v.series_id=s.id) AS volume_count,
                            (SELECT COUNT(*) FROM shared_elements se WHERE se.series_id=s.id) AS element_count
                     FROM series s"""
            params: List[Any] = []
            workspace = str(workspace_id or "").strip()
            if workspace:
                # 兼容历史数据：旧系列可能没有 workspace_id
                sql += " WHERE (s.workspace_id=? OR s.workspace_id='' OR s.workspace_id IS NULL)"
                params.append(workspace)
            sql += " ORDER BY s.updated_at DESC LIMIT ?"
            params.append(limit)
            rows = conn.execute(sql, tuple(params)).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_series(
        self, series_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "name", "description", "series_bible", "visual_style",
            "source_script", "settings", "workspace_id",
        }
        fields = []
        values: list = []
        for k, v in updates.items():
            if k in allowed:
                if k == "settings":
                    v = self._json_field(v)
                fields.append(f"{k}=?")
                values.append(v)
        if not fields:
            return self.get_series(series_id)
        fields.append("updated_at=?")
        values.append(_now())
        values.append(series_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE series SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            return self.get_series(series_id, _conn=conn)
        finally:
            conn.close()

    def delete_series(self, series_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM series WHERE id=?", (series_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 卷（Volume）CRUD
    # ==================================================================

    def get_next_volume_number(
        self,
        series_id: str,
        *,
        _conn: Optional[sqlite3.Connection] = None,
    ) -> int:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT COALESCE(MAX(volume_number), 0) + 1 AS next_number FROM volumes WHERE series_id=?",
                (series_id,),
            ).fetchone()
            return max(1, int((row["next_number"] if row else 1) or 1))
        finally:
            if _conn is None:
                conn.close()

    def create_volume(
        self,
        series_id: str,
        volume_number: Optional[int] = None,
        name: str = "",
        description: str = "",
        source_text: str = "",
        style_anchor: Optional[Dict[str, Any]] = None,
        status: str = "draft",
    ) -> Dict[str, Any]:
        vid = _gen_id("vol_")
        now = _now()
        conn = self._connect()
        try:
            number = int(volume_number or 0)
            if number <= 0:
                number = self.get_next_volume_number(series_id, _conn=conn)
            if not name.strip():
                name = f"第{number}卷"
            conn.execute(
                """
                INSERT INTO volumes
                (id, series_id, volume_number, name, description, source_text, style_anchor, status, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    vid,
                    series_id,
                    number,
                    name.strip(),
                    description,
                    source_text,
                    self._json_field(style_anchor or {}),
                    status or "draft",
                    now,
                    now,
                ),
            )
            conn.execute("UPDATE series SET updated_at=? WHERE id=?", (now, series_id))
            conn.commit()
            return self.get_volume(vid, _conn=conn)  # type: ignore[return-value]
        except sqlite3.IntegrityError as e:
            if "UNIQUE constraint failed: volumes.series_id, volumes.volume_number" in str(e):
                raise ValueError("volume_number already exists in series")
            raise
        finally:
            conn.close()

    def get_volume(
        self,
        volume_id: str,
        *,
        _conn: Optional[sqlite3.Connection] = None,
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM volumes WHERE id=?",
                (volume_id,),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def list_volumes(self, series_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT v.*,
                       (SELECT COUNT(*) FROM episodes e WHERE e.volume_id=v.id) AS episode_count
                FROM volumes v
                WHERE v.series_id=?
                ORDER BY v.volume_number ASC, v.created_at ASC
                """,
                (series_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_volume(
        self,
        volume_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "volume_number",
            "name",
            "description",
            "source_text",
            "style_anchor",
            "status",
        }
        clauses: List[str] = []
        values: List[Any] = []
        for key, value in updates.items():
            if key not in allowed:
                continue
            if key == "style_anchor":
                value = self._json_field(value or {})
            elif key == "volume_number":
                value = int(value or 0)
                if value <= 0:
                    raise ValueError("volume_number must be positive")
            clauses.append(f"{key}=?")
            values.append(value)
        if not clauses:
            return self.get_volume(volume_id)
        now = _now()
        clauses.append("updated_at=?")
        values.append(now)
        values.append(volume_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE volumes SET {', '.join(clauses)} WHERE id=?",
                tuple(values),
            )
            conn.execute(
                "UPDATE series SET updated_at=? WHERE id=(SELECT series_id FROM volumes WHERE id=?)",
                (now, volume_id),
            )
            conn.commit()
            return self.get_volume(volume_id, _conn=conn)
        except sqlite3.IntegrityError as e:
            if "UNIQUE constraint failed: volumes.series_id, volumes.volume_number" in str(e):
                raise ValueError("volume_number already exists in series")
            raise
        finally:
            conn.close()

    def delete_volume(self, volume_id: str, detach_episodes: bool = True) -> bool:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT series_id FROM volumes WHERE id=?",
                (volume_id,),
            ).fetchone()
            if not row:
                return False
            now = _now()
            if detach_episodes:
                conn.execute(
                    "UPDATE episodes SET volume_id='', updated_at=? WHERE volume_id=?",
                    (now, volume_id),
                )
            cur = conn.execute("DELETE FROM volumes WHERE id=?", (volume_id,))
            if cur.rowcount > 0:
                conn.execute("UPDATE series SET updated_at=? WHERE id=?", (now, row["series_id"]))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def get_next_episode_act_number(
        self,
        series_id: str,
        *,
        _conn: Optional[sqlite3.Connection] = None,
    ) -> int:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT COALESCE(MAX(act_number), 0) + 1 AS next_act FROM episodes WHERE series_id=?",
                (series_id,),
            ).fetchone()
            return max(1, int((row["next_act"] if row else 1) or 1))
        finally:
            if _conn is None:
                conn.close()

    # ==================================================================
    # 数字人角色配置
    # ==================================================================

    def list_digital_human_profiles(self, series_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT * FROM digital_human_profiles
                WHERE series_id=?
                ORDER BY sort_order ASC, updated_at DESC
                """,
                (series_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def get_digital_human_profile(self, profile_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM digital_human_profiles WHERE id=?",
                (profile_id,),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def create_digital_human_profile(
        self,
        series_id: str,
        base_name: str,
        display_name: str = "",
        stage_label: str = "",
        appearance: str = "",
        voice_profile: str = "",
        scene_template: str = "",
        lip_sync_style: str = "",
        sort_order: int = 0,
    ) -> Dict[str, Any]:
        profile_id = _gen_id("dhp_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO digital_human_profiles
                (id, series_id, base_name, display_name, stage_label, appearance, voice_profile, scene_template, lip_sync_style, sort_order, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    profile_id,
                    series_id,
                    base_name,
                    display_name,
                    stage_label,
                    appearance,
                    voice_profile,
                    scene_template,
                    lip_sync_style,
                    int(sort_order),
                    now,
                    now,
                ),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM digital_human_profiles WHERE id=?", (profile_id,)).fetchone()
            return self._row_to_dict(row) or {"id": profile_id, "series_id": series_id, "base_name": base_name}
        finally:
            conn.close()

    def update_digital_human_profile(
        self,
        profile_id: str,
        updates: Dict[str, Any],
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "base_name",
            "display_name",
            "stage_label",
            "appearance",
            "voice_profile",
            "scene_template",
            "lip_sync_style",
            "sort_order",
        }
        clauses: List[str] = []
        values: List[Any] = []
        for key, value in updates.items():
            if key not in allowed:
                continue
            clauses.append(f"{key}=?")
            values.append(value)
        if not clauses:
            return self.get_digital_human_profile(profile_id)
        clauses.append("updated_at=?")
        values.append(_now())
        values.append(profile_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE digital_human_profiles SET {', '.join(clauses)} WHERE id=?",
                tuple(values),
            )
            conn.commit()
            row = conn.execute("SELECT * FROM digital_human_profiles WHERE id=?", (profile_id,)).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def delete_digital_human_profile(self, profile_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute(
                "DELETE FROM digital_human_profiles WHERE id=?",
                (profile_id,),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def replace_digital_human_profiles(
        self,
        series_id: str,
        profiles: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        now = _now()
        conn = self._connect()
        try:
            conn.execute("DELETE FROM digital_human_profiles WHERE series_id=?", (series_id,))
            for index, item in enumerate(profiles):
                if not isinstance(item, dict):
                    continue
                base_name = str(item.get("base_name") or item.get("character_name") or item.get("name") or "").strip()
                display_name = str(item.get("display_name") or item.get("name") or base_name).strip()
                if not base_name and not display_name:
                    continue
                profile_id = str(item.get("id") or "").strip() or _gen_id("dhp_")
                conn.execute(
                    """
                    INSERT INTO digital_human_profiles
                    (id, series_id, base_name, display_name, stage_label, appearance, voice_profile, scene_template, lip_sync_style, sort_order, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        profile_id,
                        series_id,
                        base_name or display_name,
                        display_name or base_name,
                        str(item.get("stage_label") or item.get("stage") or "").strip(),
                        str(item.get("appearance") or item.get("description") or "").strip(),
                        str(item.get("voice_profile") or "").strip(),
                        str(item.get("scene_template") or item.get("scene") or "").strip(),
                        str(item.get("lip_sync_style") or item.get("lip_sync") or "").strip(),
                        int(item.get("sort_order") or index),
                        now,
                        now,
                    ),
                )
            conn.commit()
            rows = conn.execute(
                """
                SELECT * FROM digital_human_profiles
                WHERE series_id=?
                ORDER BY sort_order ASC, updated_at DESC
                """,
                (series_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    # ==================================================================
    # 集 / 幕 CRUD
    # ==================================================================

    def create_episode(
        self,
        series_id: str,
        act_number: int,
        volume_id: str = "",
        title: str = "",
        summary: str = "",
        script_excerpt: str = "",
        creative_brief: Optional[Dict] = None,
        target_duration_seconds: float = 60.0,
    ) -> Dict[str, Any]:
        eid = _gen_id("ep_")
        now = _now()
        conn = self._connect()
        try:
            normalized_volume_id = str(volume_id or "").strip()
            if normalized_volume_id:
                volume_row = conn.execute(
                    "SELECT id FROM volumes WHERE id=? AND series_id=?",
                    (normalized_volume_id, series_id),
                ).fetchone()
                if not volume_row:
                    raise ValueError("volume does not belong to series")
            conn.execute(
                """INSERT INTO episodes
                   (id, series_id, volume_id, act_number, title, summary, script_excerpt,
                    creative_brief, target_duration_seconds, status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (eid, series_id, normalized_volume_id, act_number, title, summary, script_excerpt,
                 self._json_field(creative_brief or {}),
                 target_duration_seconds, "draft", now, now),
            )
            conn.commit()
            return self.get_episode(eid, _conn=conn)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_episode(
        self, episode_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM episodes WHERE id=?", (episode_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def list_episodes(self, series_id: str, volume_id: Optional[str] = None) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            sql = """
                SELECT e.*,
                       v.name AS volume_name,
                       v.volume_number AS volume_number,
                       (SELECT COUNT(*) FROM shots s WHERE s.episode_id=e.id) AS shot_count
                FROM episodes e
                LEFT JOIN volumes v ON v.id = e.volume_id
                WHERE e.series_id=?
            """
            params: List[Any] = [series_id]
            normalized_volume_id = str(volume_id or "").strip()
            if normalized_volume_id:
                if normalized_volume_id == "__none__":
                    sql += " AND (e.volume_id='' OR e.volume_id IS NULL)"
                else:
                    sql += " AND e.volume_id=?"
                    params.append(normalized_volume_id)
            sql += " ORDER BY e.act_number"
            rows = conn.execute(sql, tuple(params)).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_episode(
        self, episode_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "title", "summary", "script_excerpt", "creative_brief",
            "target_duration_seconds", "status", "volume_id",
        }
        current_episode = self.get_episode(episode_id)
        if not current_episode:
            return None
        series_id = str(current_episode.get("series_id") or "")
        fields = []
        values: list = []
        for k, v in updates.items():
            if k in allowed:
                if k == "creative_brief":
                    v = self._json_field(v)
                elif k == "volume_id":
                    v = str(v or "").strip()
                    if v:
                        conn_check = self._connect()
                        try:
                            volume_row = conn_check.execute(
                                "SELECT id FROM volumes WHERE id=? AND series_id=?",
                                (v, series_id),
                            ).fetchone()
                        finally:
                            conn_check.close()
                        if not volume_row:
                            raise ValueError("volume does not belong to series")
                fields.append(f"{k}=?")
                values.append(v)
        if not fields:
            return self.get_episode(episode_id)
        fields.append("updated_at=?")
        values.append(_now())
        values.append(episode_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE episodes SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            return self.get_episode(episode_id, _conn=conn)
        finally:
            conn.close()

    def delete_episode(self, episode_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM episodes WHERE id=?", (episode_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 共享元素
    # ==================================================================

    def add_shared_element(
        self,
        series_id: str,
        name: str,
        element_type: str,
        description: str = "",
        voice_profile: str = "",
        is_favorite: int = 0,
        image_url: str = "",
        appears_in_episodes: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        eid = _gen_id("SE_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO shared_elements
                   (id, series_id, name, type, description, voice_profile,
                    is_favorite, image_url, image_history, reference_images,
                    appears_in_episodes, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (eid, series_id, name, element_type, description, voice_profile,
                 int(is_favorite), image_url, "[]", "[]",
                 self._json_field(appears_in_episodes or []), now, now),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM shared_elements WHERE id=?", (eid,)
            ).fetchone()
            return self._row_to_dict(row)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_shared_element(self, element_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM shared_elements WHERE id=?", (element_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def get_shared_elements(
        self,
        series_id: str,
        element_type: Optional[str] = None,
        favorites_only: bool = False,
    ) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            sql = "SELECT * FROM shared_elements WHERE series_id=?"
            params: List[Any] = [series_id]
            if element_type:
                sql += " AND type=?"
                params.append(element_type)
            if favorites_only:
                sql += " AND is_favorite=1"
            sql += " ORDER BY is_favorite DESC, type, name"
            rows = conn.execute(sql, tuple(params)).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_shared_element(
        self, element_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "name", "type", "description", "voice_profile", "image_url",
            "image_history", "reference_images", "appears_in_episodes", "is_favorite",
        }
        fields = []
        values: list = []
        for k, v in updates.items():
            if k in allowed:
                if k in ("image_history", "reference_images", "appears_in_episodes"):
                    v = self._json_field(v)
                fields.append(f"{k}=?")
                values.append(v)
        if not fields:
            return None
        fields.append("updated_at=?")
        values.append(_now())
        values.append(element_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE shared_elements SET {', '.join(fields)} WHERE id=?",
                values,
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM shared_elements WHERE id=?", (element_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def delete_shared_element(self, element_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute(
                "DELETE FROM shared_elements WHERE id=?", (element_id,)
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 镜头 CRUD
    # ==================================================================

    def add_shot(
        self,
        episode_id: str,
        sort_order: int,
        name: str = "",
        shot_type: str = "standard",
        duration: float = 5.0,
        description: str = "",
        prompt: str = "",
        end_prompt: str = "",
        video_prompt: str = "",
        narration: str = "",
        dialogue_script: str = "",
        sound_effects: str = "",
        segment_name: str = "",
        shot_size: str = "",
        camera_angle: str = "",
        camera_movement: str = "",
        emotion: str = "",
        emotion_intensity: int = 0,
        key_frame_prompt: str = "",
    ) -> Dict[str, Any]:
        sid = _gen_id("shot_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO shots
                   (id, episode_id, segment_name, sort_order, name, type,
                    duration, description, prompt, end_prompt, video_prompt,
                    narration, dialogue_script, sound_effects,
                    start_image_url, end_image_url, frame_history, video_url, video_history, audio_url, visual_action,
                    shot_size, camera_angle, camera_movement, emotion, emotion_intensity,
                    key_frame_prompt, key_frame_url,
                    status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    sid, episode_id, segment_name, sort_order, name, shot_type,
                    duration, description, prompt, end_prompt, video_prompt,
                    narration, dialogue_script, sound_effects,
                    "", "", "[]", "", "[]", "", "{}",
                    shot_size, camera_angle, camera_movement, emotion, emotion_intensity,
                    key_frame_prompt, "",
                    "pending", now, now,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM shots WHERE id=?", (sid,)
            ).fetchone()
            return self._row_to_dict(row)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_shot(self, shot_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM shots WHERE id=?", (shot_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def get_shots(self, episode_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM shots WHERE episode_id=? ORDER BY sort_order",
                (episode_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_shot(
        self, shot_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "segment_name", "sort_order", "name", "type", "duration",
            "description", "prompt", "end_prompt", "video_prompt", "narration",
            "dialogue_script", "sound_effects", "start_image_url", "end_image_url", "frame_history",
            "video_url", "video_history", "audio_url", "visual_action", "status",
            "shot_size", "camera_angle", "camera_movement",
            "emotion", "emotion_intensity",
            "key_frame_prompt", "key_frame_url",
        }
        fields = []
        values: list = []
        for k, v in updates.items():
            if k in allowed:
                if k in ("frame_history", "video_history", "visual_action"):
                    v = self._json_field(v)
                fields.append(f"{k}=?")
                values.append(v)
        if not fields:
            return None
        fields.append("updated_at=?")
        values.append(_now())
        values.append(shot_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE shots SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM shots WHERE id=?", (shot_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def delete_shot(self, shot_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM shots WHERE id=?", (shot_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def reorder_shots(self, episode_id: str, shot_ids: List[str]) -> bool:
        conn = self._connect()
        try:
            for idx, sid in enumerate(shot_ids):
                conn.execute(
                    "UPDATE shots SET sort_order=?, updated_at=? WHERE id=? AND episode_id=?",
                    (idx, _now(), sid, episode_id),
                )
            conn.commit()
            return True
        finally:
            conn.close()

    def bulk_add_shots(
        self, episode_id: str, shots_data: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """批量添加镜头（先清除该集现有镜头）"""
        conn = self._connect()
        try:
            conn.execute("DELETE FROM shots WHERE episode_id=?", (episode_id,))
            now = _now()
            result_ids = []
            for idx, s in enumerate(shots_data):
                sid = _gen_id("shot_")
                frame_history = self._json_field(s.get("frame_history", []))
                video_history = self._json_field(s.get("video_history", []))
                visual_action = self._json_field(s.get("visual_action", {}))
                conn.execute(
                    """INSERT INTO shots
                       (id, episode_id, segment_name, sort_order, name, type,
                        duration, description, prompt, end_prompt, video_prompt,
                        narration, dialogue_script, sound_effects,
                        start_image_url, end_image_url, frame_history, video_url, video_history, audio_url, visual_action,
                        shot_size, camera_angle, camera_movement, emotion, emotion_intensity,
                        key_frame_prompt, key_frame_url,
                        status, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        sid, episode_id, s.get("segment_name", ""),
                        idx, s.get("name", ""), s.get("type", s.get("shot_type", "standard")),
                        s.get("duration", 5.0), s.get("description", ""),
                        s.get("prompt", ""), s.get("end_prompt", ""), s.get("video_prompt", ""),
                        s.get("narration", ""), s.get("dialogue_script", ""), s.get("sound_effects", ""),
                        s.get("start_image_url", ""), s.get("end_image_url", ""), frame_history,
                        s.get("video_url", ""), video_history, s.get("audio_url", ""), visual_action,
                        s.get("shot_size", ""), s.get("camera_angle", ""), s.get("camera_movement", ""),
                        s.get("emotion", ""), int(s.get("emotion_intensity", 0) or 0),
                        s.get("key_frame_prompt", ""), s.get("key_frame_url", ""),
                        s.get("status", "pending"), now, now,
                    ),
                )
                result_ids.append(sid)
            conn.commit()
            rows = conn.execute(
                f"SELECT * FROM shots WHERE episode_id=? ORDER BY sort_order",
                (episode_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    # ==================================================================
    # 集元素引用
    # ==================================================================

    def inherit_shared_elements(
        self, episode_id: str, series_id: str
    ) -> List[Dict[str, Any]]:
        """将系列共享元素继承到集中（跳过已存在的）"""
        conn = self._connect()
        try:
            shared = conn.execute(
                "SELECT * FROM shared_elements WHERE series_id=?", (series_id,)
            ).fetchall()
            existing = {
                r["shared_element_id"]
                for r in conn.execute(
                    "SELECT shared_element_id FROM episode_elements WHERE episode_id=? AND shared_element_id IS NOT NULL",
                    (episode_id,),
                ).fetchall()
            }
            now = _now()
            for se in shared:
                if se["id"] in existing:
                    continue
                conn.execute(
                    """INSERT INTO episode_elements
                       (id, episode_id, shared_element_id, name, type,
                        description, voice_profile, image_url, is_override, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (_gen_id("ee_"), episode_id, se["id"],
                     se["name"], se["type"], se["description"],
                     se["voice_profile"], se["image_url"], 0, now),
                )
            conn.commit()
            return self.get_episode_elements(episode_id, _conn=conn)
        finally:
            conn.close()

    def get_episode_elements(
        self, episode_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> List[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM episode_elements WHERE episode_id=? ORDER BY type, name",
                (episode_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            if _conn is None:
                conn.close()

    def add_episode_element(
        self,
        episode_id: str,
        name: str,
        element_type: str,
        description: str = "",
        voice_profile: str = "",
        shared_element_id: Optional[str] = None,
        image_url: str = "",
        is_override: int = 0,
    ) -> Dict[str, Any]:
        eid = _gen_id("ee_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO episode_elements
                   (id, episode_id, shared_element_id, name, type,
                    description, voice_profile, image_url, is_override, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (eid, episode_id, shared_element_id, name, element_type,
                 description, voice_profile, image_url, is_override, now),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM episode_elements WHERE id=?", (eid,)
            ).fetchone()
            return self._row_to_dict(row)  # type: ignore[return-value]
        finally:
            conn.close()

    def replace_episode_elements(
        self,
        episode_id: str,
        elements_data: List[Dict[str, Any]],
        keep_shared_elements: bool = True,
    ) -> List[Dict[str, Any]]:
        """替换集内元素（默认保留继承的共享元素）。"""
        conn = self._connect()
        try:
            if keep_shared_elements:
                conn.execute(
                    "DELETE FROM episode_elements WHERE episode_id=? AND shared_element_id IS NULL",
                    (episode_id,),
                )
            else:
                conn.execute("DELETE FROM episode_elements WHERE episode_id=?", (episode_id,))

            now = _now()
            for item in elements_data:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name", "") or "").strip()
                if not name:
                    continue
                conn.execute(
                    """INSERT INTO episode_elements
                       (id, episode_id, shared_element_id, name, type,
                        description, voice_profile, image_url, is_override, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        _gen_id("ee_"),
                        episode_id,
                        item.get("shared_element_id"),
                        name,
                        str(item.get("type", "character") or "character"),
                        str(item.get("description", "") or ""),
                        str(item.get("voice_profile", "") or ""),
                        str(item.get("image_url", "") or ""),
                        int(item.get("is_override", 1) or 1),
                        now,
                    ),
                )
            conn.commit()
            return self.get_episode_elements(episode_id, _conn=conn)
        finally:
            conn.close()

    # ==================================================================
    # 知识库 - 角色提示词档案 (kb_character_cards) CRUD
    # ==================================================================

    def create_character_card(
        self,
        element_id: str = "",
        appearance_tokens: Optional[Dict] = None,
        costume_tokens: Optional[Dict] = None,
        expression_tokens: Optional[Dict] = None,
        signature_poses: Optional[Dict] = None,
        negative_prompts: str = "",
    ) -> Dict[str, Any]:
        cid = _gen_id("kbcc_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO kb_character_cards
                   (id, element_id, appearance_tokens, costume_tokens,
                    expression_tokens, signature_poses, negative_prompts,
                    version, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (cid, element_id,
                 self._json_field(appearance_tokens or {}),
                 self._json_field(costume_tokens or {}),
                 self._json_field(expression_tokens or {}),
                 self._json_field(signature_poses or {}),
                 negative_prompts, 1, now, now),
            )
            conn.commit()
            return self.get_character_card(cid, _conn=conn)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_character_card(
        self, card_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_character_cards WHERE id=?", (card_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def get_character_card_by_element(self, element_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_character_cards WHERE element_id=? ORDER BY version DESC LIMIT 1",
                (element_id,),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def list_character_cards(self) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM kb_character_cards ORDER BY updated_at DESC"
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_character_card(
        self, card_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "element_id", "appearance_tokens", "costume_tokens",
            "expression_tokens", "signature_poses", "negative_prompts", "version",
        }
        fields: List[str] = []
        values: List[Any] = []
        for k, v in updates.items():
            if k not in allowed:
                continue
            if k in ("appearance_tokens", "costume_tokens", "expression_tokens", "signature_poses"):
                v = self._json_field(v)
            fields.append(f"{k}=?")
            values.append(v)
        if not fields:
            return self.get_character_card(card_id)
        fields.append("updated_at=?")
        values.append(_now())
        values.append(card_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE kb_character_cards SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            return self.get_character_card(card_id, _conn=conn)
        finally:
            conn.close()

    def delete_character_card(self, card_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM kb_character_cards WHERE id=?", (card_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 知识库 - 情绪氛围预制包 (kb_mood_packs) CRUD
    # ==================================================================

    def create_mood_pack(
        self,
        mood_key: str,
        series_id: str = "",
        color_tokens: str = "",
        line_style_tokens: str = "",
        effect_tokens: str = "",
        combined_prompt: str = "",
        is_builtin: int = 1,
    ) -> Dict[str, Any]:
        mid = _gen_id("kbmp_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO kb_mood_packs
                   (id, series_id, mood_key, color_tokens, line_style_tokens,
                    effect_tokens, combined_prompt, is_builtin,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?)""",
                (mid, series_id, mood_key, color_tokens, line_style_tokens,
                 effect_tokens, combined_prompt, int(is_builtin), now, now),
            )
            conn.commit()
            return self.get_mood_pack(mid, _conn=conn)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_mood_pack(
        self, pack_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_mood_packs WHERE id=?", (pack_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def get_mood_packs_by_series(
        self, series_id: str, mood_key: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            if mood_key:
                rows = conn.execute(
                    "SELECT * FROM kb_mood_packs WHERE (series_id=? OR series_id='') AND mood_key=? ORDER BY is_builtin DESC, updated_at DESC",
                    (series_id, mood_key),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM kb_mood_packs WHERE series_id=? OR series_id='' ORDER BY mood_key, is_builtin DESC",
                    (series_id,),
                ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def list_mood_packs(self, series_id: str = "") -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            if series_id:
                rows = conn.execute(
                    "SELECT * FROM kb_mood_packs WHERE series_id=? OR series_id='' ORDER BY mood_key, is_builtin DESC",
                    (series_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM kb_mood_packs ORDER BY mood_key, is_builtin DESC"
                ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_mood_pack(
        self, pack_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "series_id", "mood_key", "color_tokens", "line_style_tokens",
            "effect_tokens", "combined_prompt", "is_builtin",
        }
        fields: List[str] = []
        values: List[Any] = []
        for k, v in updates.items():
            if k not in allowed:
                continue
            fields.append(f"{k}=?")
            values.append(v)
        if not fields:
            return self.get_mood_pack(pack_id)
        fields.append("updated_at=?")
        values.append(_now())
        values.append(pack_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE kb_mood_packs SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            return self.get_mood_pack(pack_id, _conn=conn)
        finally:
            conn.close()

    def delete_mood_pack(self, pack_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM kb_mood_packs WHERE id=?", (pack_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 知识库 - 场景提示词档案 (kb_scene_cards) CRUD
    # ==================================================================

    def create_scene_card(
        self,
        element_id: str = "",
        base_tokens: str = "",
        time_variants: Optional[Dict] = None,
        negative_prompts: str = "",
    ) -> Dict[str, Any]:
        sid = _gen_id("kbsc_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO kb_scene_cards
                   (id, element_id, base_tokens, time_variants,
                    negative_prompts, version, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?)""",
                (sid, element_id, base_tokens,
                 self._json_field(time_variants or {}),
                 negative_prompts, 1, now, now),
            )
            conn.commit()
            return self.get_scene_card(sid, _conn=conn)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_scene_card(
        self, card_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_scene_cards WHERE id=?", (card_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def get_scene_card_by_element(self, element_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_scene_cards WHERE element_id=? ORDER BY version DESC LIMIT 1",
                (element_id,),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def list_scene_cards(self) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM kb_scene_cards ORDER BY updated_at DESC"
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_scene_card(
        self, card_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "element_id", "base_tokens", "time_variants",
            "negative_prompts", "version",
        }
        fields: List[str] = []
        values: List[Any] = []
        for k, v in updates.items():
            if k not in allowed:
                continue
            if k == "time_variants":
                v = self._json_field(v)
            fields.append(f"{k}=?")
            values.append(v)
        if not fields:
            return self.get_scene_card(card_id)
        fields.append("updated_at=?")
        values.append(_now())
        values.append(card_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE kb_scene_cards SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            return self.get_scene_card(card_id, _conn=conn)
        finally:
            conn.close()

    def delete_scene_card(self, card_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM kb_scene_cards WHERE id=?", (card_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 知识库 - 世界观提示词词典 (kb_world_bible) CRUD
    # ==================================================================

    def create_world_bible(
        self,
        series_id: str = "",
        art_style: str = "",
        era: str = "",
        color_palette: str = "",
        recurring_motifs: str = "",
        forbidden_elements: str = "",
    ) -> Dict[str, Any]:
        wid = _gen_id("kbwb_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO kb_world_bible
                   (id, series_id, art_style, era, color_palette,
                    recurring_motifs, forbidden_elements,
                    created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (wid, series_id, art_style, era, color_palette,
                 recurring_motifs, forbidden_elements, now, now),
            )
            conn.commit()
            return self.get_world_bible(wid, _conn=conn)  # type: ignore[return-value]
        finally:
            conn.close()

    def get_world_bible(
        self, bible_id: str, *, _conn: Optional[sqlite3.Connection] = None
    ) -> Optional[Dict[str, Any]]:
        conn = _conn or self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_world_bible WHERE id=?", (bible_id,)
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            if _conn is None:
                conn.close()

    def get_world_bible_by_series(self, series_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM kb_world_bible WHERE series_id=? ORDER BY updated_at DESC LIMIT 1",
                (series_id,),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def list_world_bibles(self, series_id: str = "") -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            if series_id:
                rows = conn.execute(
                    "SELECT * FROM kb_world_bible WHERE series_id=? ORDER BY updated_at DESC",
                    (series_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    "SELECT * FROM kb_world_bible ORDER BY updated_at DESC"
                ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_world_bible(
        self, bible_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "series_id", "art_style", "era", "color_palette",
            "recurring_motifs", "forbidden_elements",
        }
        fields: List[str] = []
        values: List[Any] = []
        for k, v in updates.items():
            if k not in allowed:
                continue
            fields.append(f"{k}=?")
            values.append(v)
        if not fields:
            return self.get_world_bible(bible_id)
        fields.append("updated_at=?")
        values.append(_now())
        values.append(bible_id)
        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE kb_world_bible SET {', '.join(fields)} WHERE id=?", values
            )
            conn.commit()
            return self.get_world_bible(bible_id, _conn=conn)
        finally:
            conn.close()

    def delete_world_bible(self, bible_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute("DELETE FROM kb_world_bible WHERE id=?", (bible_id,))
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    # ==================================================================
    # 统计
    # ==================================================================

    @staticmethod
    def _resolve_local_media_path(url: str) -> Optional[str]:
        if not url:
            return None
        if url.startswith("/api/uploads/"):
            rel = url[len("/api/uploads/") :].strip().replace("/", os.sep)
            return os.path.join(UPLOAD_DIR, rel)
        if url.startswith("/data/studio_audio/"):
            name = os.path.basename(url)
            return os.path.join(STUDIO_AUDIO_DIR, name)
        if os.path.isabs(url):
            return url
        return None

    def _estimate_storage_bytes(self, conn: sqlite3.Connection, series_id: str) -> int:
        urls: List[str] = []
        rows = conn.execute(
            """
            SELECT image_url
            FROM shared_elements
            WHERE series_id=?
            """,
            (series_id,),
        ).fetchall()
        urls.extend([r["image_url"] for r in rows if r["image_url"]])

        rows = conn.execute(
            """
            SELECT s.start_image_url, s.video_url, s.audio_url
            FROM shots s
            INNER JOIN episodes e ON e.id = s.episode_id
            WHERE e.series_id=?
            """,
            (series_id,),
        ).fetchall()
        for r in rows:
            urls.extend([
                r["start_image_url"] or "",
                r["video_url"] or "",
                r["audio_url"] or "",
            ])

        total = 0
        seen: set[str] = set()
        for raw in urls:
            path = self._resolve_local_media_path(raw)
            if not path or path in seen:
                continue
            seen.add(path)
            if os.path.exists(path):
                try:
                    total += os.path.getsize(path)
                except OSError:
                    continue
        return total

    def get_series_stats(self, series_id: str) -> Dict[str, Any]:
        conn = self._connect()
        try:
            episodes_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN status='planned' THEN 1 ELSE 0 END) AS planned,
                    SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) AS in_progress,
                    SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed
                FROM episodes
                WHERE series_id=?
                """,
                (series_id,),
            ).fetchone()

            shots_row = conn.execute(
                """
                SELECT
                    COUNT(*) AS total,
                    SUM(CASE WHEN s.start_image_url IS NOT NULL AND s.start_image_url!='' THEN 1 ELSE 0 END) AS frames,
                    SUM(CASE WHEN s.video_url IS NOT NULL AND s.video_url!='' THEN 1 ELSE 0 END) AS videos,
                    SUM(CASE WHEN s.audio_url IS NOT NULL AND s.audio_url!='' THEN 1 ELSE 0 END) AS audio,
                    COALESCE(SUM(s.duration), 0) AS total_duration_seconds
                FROM shots s
                INNER JOIN episodes e ON e.id = s.episode_id
                WHERE e.series_id=?
                """,
                (series_id,),
            ).fetchone()

            element_rows = conn.execute(
                """
                SELECT
                    type,
                    COUNT(*) AS count,
                    SUM(CASE WHEN is_favorite=1 THEN 1 ELSE 0 END) AS favorites
                FROM shared_elements
                WHERE series_id=?
                GROUP BY type
                """,
                (series_id,),
            ).fetchall()

            by_type = {"character": 0, "scene": 0, "object": 0}
            favorite_count = 0
            for row in element_rows:
                et = row["type"] or "object"
                by_type[et] = int(row["count"] or 0)
                favorite_count += int(row["favorites"] or 0)

            total_elements = sum(by_type.values())

            return {
                "series_id": series_id,
                "episodes": {
                    "total": int((episodes_row and episodes_row["total"]) or 0),
                    "planned": int((episodes_row and episodes_row["planned"]) or 0),
                    "in_progress": int((episodes_row and episodes_row["in_progress"]) or 0),
                    "completed": int((episodes_row and episodes_row["completed"]) or 0),
                },
                "shots": {
                    "total": int((shots_row and shots_row["total"]) or 0),
                    "frames": int((shots_row and shots_row["frames"]) or 0),
                    "videos": int((shots_row and shots_row["videos"]) or 0),
                    "audio": int((shots_row and shots_row["audio"]) or 0),
                    "total_duration_seconds": float((shots_row and shots_row["total_duration_seconds"]) or 0),
                },
                "elements": {
                    "total": total_elements,
                    "favorites": favorite_count,
                    "by_type": by_type,
                },
                "storage": {
                    "bytes": self._estimate_storage_bytes(conn, series_id),
                },
            }
        finally:
            conn.close()

    # ==================================================================
    # 快照 / 导出
    # ==================================================================

    def get_episode_snapshot(self, episode_id: str) -> Optional[Dict[str, Any]]:
        episode = self.get_episode(episode_id)
        if not episode:
            return None
        episode["shots"] = self.get_shots(episode_id)
        episode["elements"] = self.get_episode_elements(episode_id)
        return episode

    def get_series_snapshot(self, series_id: str) -> Optional[Dict[str, Any]]:
        series = self.get_series(series_id)
        if not series:
            return None
        series["volumes"] = self.list_volumes(series_id)
        series["episodes"] = self.list_episodes(series_id)
        series["shared_elements"] = self.get_shared_elements(series_id)
        for ep in series["episodes"]:
            ep["shots"] = self.get_shots(ep["id"])
        return series

    # ==================================================================
    # 历史记录（版本快照）
    # ==================================================================

    def create_history_entry(
        self,
        series_id: str,
        episode_id: str,
        action: str,
        snapshot_json: Dict[str, Any],
    ) -> Dict[str, Any]:
        history_id = _gen_id("hist_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO studio_history
                   (id, series_id, episode_id, action, snapshot_json, created_at)
                   VALUES (?,?,?,?,?,?)""",
                (
                    history_id,
                    series_id,
                    episode_id,
                    action,
                    self._json_field(snapshot_json or {}),
                    now,
                ),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM studio_history WHERE id=?",
                (history_id,),
            ).fetchone()
            return self._row_to_dict(row)  # type: ignore[return-value]
        finally:
            conn.close()

    def record_episode_history(self, episode_id: str, action: str) -> Optional[Dict[str, Any]]:
        snapshot = self.get_episode_snapshot(episode_id)
        if not snapshot:
            return None
        series_id = str(snapshot.get("series_id") or "")
        if not series_id:
            return None
        return self.create_history_entry(
            series_id=series_id,
            episode_id=episode_id,
            action=action,
            snapshot_json=snapshot,
        )

    def get_history_entry(self, history_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM studio_history WHERE id=?",
                (history_id,),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def list_episode_history(
        self,
        episode_id: str,
        limit: int = 50,
        include_snapshot: bool = False,
    ) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT *
                FROM studio_history
                WHERE episode_id=?
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (episode_id, max(1, int(limit))),
            ).fetchall()

            result: List[Dict[str, Any]] = []
            for row in rows:
                item = self._row_to_dict(row) or {}
                snapshot = item.get("snapshot_json")
                shot_count = 0
                title = ""
                summary = ""
                status = ""
                duration = 0.0
                if isinstance(snapshot, dict):
                    shots = snapshot.get("shots")
                    if isinstance(shots, list):
                        shot_count = len(shots)
                    title = str(snapshot.get("title") or "")
                    summary = str(snapshot.get("summary") or "")
                    status = str(snapshot.get("status") or "")
                    try:
                        duration = float(snapshot.get("target_duration_seconds") or 0)
                    except (TypeError, ValueError):
                        duration = 0.0

                payload: Dict[str, Any] = {
                    "id": item.get("id"),
                    "series_id": item.get("series_id"),
                    "episode_id": item.get("episode_id"),
                    "action": item.get("action"),
                    "created_at": item.get("created_at"),
                    "shot_count": shot_count,
                    "title": title,
                    "summary": summary,
                    "status": status,
                    "target_duration_seconds": duration,
                }
                if include_snapshot and isinstance(snapshot, dict):
                    payload["snapshot"] = snapshot
                result.append(payload)
            return result
        finally:
            conn.close()

    def restore_episode_from_history(
        self,
        episode_id: str,
        history_id: str,
    ) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            episode_row = conn.execute(
                "SELECT * FROM episodes WHERE id=?",
                (episode_id,),
            ).fetchone()
            if not episode_row:
                return None

            history_row = conn.execute(
                "SELECT * FROM studio_history WHERE id=? AND episode_id=?",
                (history_id, episode_id),
            ).fetchone()
            history = self._row_to_dict(history_row)
            if not history:
                return None

            snapshot = history.get("snapshot_json")
            if not isinstance(snapshot, dict):
                return None

            now = _now()
            episode_updates = {
                "title": snapshot.get("title", ""),
                "summary": snapshot.get("summary", ""),
                "script_excerpt": snapshot.get("script_excerpt", ""),
                "creative_brief": self._json_field(snapshot.get("creative_brief", {})),
                "target_duration_seconds": snapshot.get("target_duration_seconds", 60.0),
                "status": snapshot.get("status", "draft"),
                "updated_at": now,
            }
            conn.execute(
                """
                UPDATE episodes
                SET title=?, summary=?, script_excerpt=?, creative_brief=?,
                    target_duration_seconds=?, status=?, updated_at=?
                WHERE id=?
                """,
                (
                    episode_updates["title"],
                    episode_updates["summary"],
                    episode_updates["script_excerpt"],
                    episode_updates["creative_brief"],
                    episode_updates["target_duration_seconds"],
                    episode_updates["status"],
                    episode_updates["updated_at"],
                    episode_id,
                ),
            )

            conn.execute("DELETE FROM shots WHERE episode_id=?", (episode_id,))
            snapshot_shots = snapshot.get("shots")
            shots = snapshot_shots if isinstance(snapshot_shots, list) else []
            def _shot_order_value(data: Dict[str, Any]) -> int:
                try:
                    return int(data.get("sort_order"))
                except (TypeError, ValueError):
                    return 0
            ordered_shots = sorted(
                [s for s in shots if isinstance(s, dict)],
                key=_shot_order_value,
            )
            for idx, shot in enumerate(ordered_shots):
                shot_id = str(shot.get("id") or _gen_id("shot_"))
                created_at = str(shot.get("created_at") or now)
                sort_order_raw = shot.get("sort_order")
                try:
                    sort_order = int(sort_order_raw)
                except (TypeError, ValueError):
                    sort_order = idx
                conn.execute(
                    """INSERT INTO shots
                       (id, episode_id, segment_name, sort_order, name, type,
                        duration, description, prompt, end_prompt, video_prompt,
                        narration, dialogue_script, sound_effects,
                        start_image_url, end_image_url, frame_history, video_url, video_history, audio_url, visual_action,
                        shot_size, camera_angle, camera_movement, emotion, emotion_intensity, key_frame_prompt, key_frame_url,
                        status, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (
                        shot_id,
                        episode_id,
                        str(shot.get("segment_name") or ""),
                        sort_order,
                        str(shot.get("name") or ""),
                        str(shot.get("type") or "standard"),
                        float(shot.get("duration") or 5.0),
                        str(shot.get("description") or ""),
                        str(shot.get("prompt") or ""),
                        str(shot.get("end_prompt") or ""),
                        str(shot.get("video_prompt") or ""),
                        str(shot.get("narration") or ""),
                        str(shot.get("dialogue_script") or ""),
                        str(shot.get("sound_effects") or ""),
                        str(shot.get("start_image_url") or ""),
                        str(shot.get("end_image_url") or ""),
                        self._json_field(shot.get("frame_history") or []),
                        str(shot.get("video_url") or ""),
                        self._json_field(shot.get("video_history") or []),
                        str(shot.get("audio_url") or ""),
                        self._json_field(shot.get("visual_action") or {}),
                        str(shot.get("shot_size") or ""),
                        str(shot.get("camera_angle") or ""),
                        str(shot.get("camera_movement") or ""),
                        str(shot.get("emotion") or ""),
                        int(shot.get("emotion_intensity") or 0),
                        str(shot.get("key_frame_prompt") or ""),
                        str(shot.get("key_frame_url") or ""),
                        str(shot.get("status") or "pending"),
                        created_at,
                        now,
                    ),
                )

            conn.execute("DELETE FROM episode_elements WHERE episode_id=?", (episode_id,))
            snapshot_elements = snapshot.get("elements")
            elements = snapshot_elements if isinstance(snapshot_elements, list) else []
            for element in elements:
                if not isinstance(element, dict):
                    continue
                element_id = str(element.get("id") or _gen_id("ee_"))
                conn.execute(
                    """INSERT INTO episode_elements
                       (id, episode_id, shared_element_id, name, type,
                        description, voice_profile, image_url, is_override, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?)""",
                    (
                        element_id,
                        episode_id,
                        element.get("shared_element_id"),
                        str(element.get("name") or ""),
                        str(element.get("type") or "character"),
                        str(element.get("description") or ""),
                        str(element.get("voice_profile") or ""),
                        str(element.get("image_url") or ""),
                        int(element.get("is_override") or 0),
                        str(element.get("created_at") or now),
                    ),
                )

            conn.commit()
        finally:
            conn.close()
        return self.get_episode_snapshot(episode_id)
