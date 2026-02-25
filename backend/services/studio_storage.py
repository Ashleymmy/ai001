"""Studio 长篇制作工作台 - SQLite 存储层"""
import os
import json
import sqlite3
import uuid
from datetime import datetime
from typing import Optional, List, Dict, Any

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DATA_DIR, "studio.db")

os.makedirs(DATA_DIR, exist_ok=True)


def _gen_id(prefix: str = "") -> str:
    return f"{prefix}{uuid.uuid4().hex[:8]}"


def _now() -> str:
    return datetime.now().isoformat()


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS series (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    description     TEXT DEFAULT '',
    series_bible    TEXT DEFAULT '',
    visual_style    TEXT DEFAULT '',
    source_script   TEXT DEFAULT '',
    settings        TEXT DEFAULT '{}',
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS episodes (
    id                      TEXT PRIMARY KEY,
    series_id               TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
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
    video_prompt    TEXT DEFAULT '',
    narration       TEXT DEFAULT '',
    dialogue_script TEXT DEFAULT '',
    start_image_url TEXT DEFAULT '',
    video_url       TEXT DEFAULT '',
    audio_url       TEXT DEFAULT '',
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

CREATE INDEX IF NOT EXISTS idx_episodes_series ON episodes(series_id);
CREATE INDEX IF NOT EXISTS idx_shared_elements_series ON shared_elements(series_id);
CREATE INDEX IF NOT EXISTS idx_shots_episode ON shots(episode_id);
CREATE INDEX IF NOT EXISTS idx_episode_elements_episode ON episode_elements(episode_id);
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
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        d = dict(row)
        # 自动反序列化 JSON 字段
        for key in ("settings", "creative_brief", "image_history",
                     "reference_images", "appears_in_episodes"):
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
                   (id, name, description, series_bible, visual_style,
                    source_script, settings, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?)""",
                (sid, name, description, series_bible, visual_style,
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

    def list_series(self, limit: int = 50) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """SELECT s.*,
                          (SELECT COUNT(*) FROM episodes e WHERE e.series_id=s.id) AS episode_count,
                          (SELECT COUNT(*) FROM shared_elements se WHERE se.series_id=s.id) AS element_count
                   FROM series s ORDER BY s.updated_at DESC LIMIT ?""",
                (limit,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_series(
        self, series_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "name", "description", "series_bible", "visual_style",
            "source_script", "settings",
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
    # 集 / 幕 CRUD
    # ==================================================================

    def create_episode(
        self,
        series_id: str,
        act_number: int,
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
            conn.execute(
                """INSERT INTO episodes
                   (id, series_id, act_number, title, summary, script_excerpt,
                    creative_brief, target_duration_seconds, status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
                (eid, series_id, act_number, title, summary, script_excerpt,
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

    def list_episodes(self, series_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """SELECT e.*,
                          (SELECT COUNT(*) FROM shots s WHERE s.episode_id=e.id) AS shot_count
                   FROM episodes e WHERE e.series_id=? ORDER BY e.act_number""",
                (series_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_episode(
        self, episode_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "title", "summary", "script_excerpt", "creative_brief",
            "target_duration_seconds", "status",
        }
        fields = []
        values: list = []
        for k, v in updates.items():
            if k in allowed:
                if k == "creative_brief":
                    v = self._json_field(v)
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
                    image_url, image_history, reference_images,
                    appears_in_episodes, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (eid, series_id, name, element_type, description, voice_profile,
                 image_url, "[]", "[]",
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

    def get_shared_elements(self, series_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                "SELECT * FROM shared_elements WHERE series_id=? ORDER BY type, name",
                (series_id,),
            ).fetchall()
            return [self._row_to_dict(r) for r in rows]  # type: ignore[misc]
        finally:
            conn.close()

    def update_shared_element(
        self, element_id: str, updates: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        allowed = {
            "name", "type", "description", "voice_profile", "image_url",
            "image_history", "reference_images", "appears_in_episodes",
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
        video_prompt: str = "",
        narration: str = "",
        dialogue_script: str = "",
        segment_name: str = "",
    ) -> Dict[str, Any]:
        sid = _gen_id("shot_")
        now = _now()
        conn = self._connect()
        try:
            conn.execute(
                """INSERT INTO shots
                   (id, episode_id, segment_name, sort_order, name, type,
                    duration, description, prompt, video_prompt,
                    narration, dialogue_script,
                    start_image_url, video_url, audio_url,
                    status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (sid, episode_id, segment_name, sort_order, name, shot_type,
                 duration, description, prompt, video_prompt,
                 narration, dialogue_script,
                 "", "", "", "pending", now, now),
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
            "description", "prompt", "video_prompt", "narration",
            "dialogue_script", "start_image_url", "video_url", "audio_url",
            "status",
        }
        fields = []
        values: list = []
        for k, v in updates.items():
            if k in allowed:
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
                conn.execute(
                    """INSERT INTO shots
                       (id, episode_id, segment_name, sort_order, name, type,
                        duration, description, prompt, video_prompt,
                        narration, dialogue_script,
                        start_image_url, video_url, audio_url,
                        status, created_at, updated_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (sid, episode_id, s.get("segment_name", ""),
                     idx, s.get("name", ""), s.get("type", "standard"),
                     s.get("duration", 5.0), s.get("description", ""),
                     s.get("prompt", ""), s.get("video_prompt", ""),
                     s.get("narration", ""), s.get("dialogue_script", ""),
                     "", "", "", "pending", now, now),
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
                 description, voice_profile, "", 0, now),
            )
            conn.commit()
            row = conn.execute(
                "SELECT * FROM episode_elements WHERE id=?", (eid,)
            ).fetchone()
            return self._row_to_dict(row)  # type: ignore[return-value]
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
        series["episodes"] = self.list_episodes(series_id)
        series["shared_elements"] = self.get_shared_elements(series_id)
        for ep in series["episodes"]:
            ep["shots"] = self.get_shots(ep["id"])
        return series
