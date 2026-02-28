import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

BACKEND_DIR = os.path.dirname(os.path.dirname(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
DB_PATH = os.path.join(DATA_DIR, "studio.db")
JWT_SECRET = os.getenv("COLLAB_JWT_SECRET", "dev-collab-secret")
ACCESS_TTL_SEC = int(os.getenv("COLLAB_ACCESS_TTL_SEC", "3600"))
REFRESH_TTL_SEC = int(os.getenv("COLLAB_REFRESH_TTL_SEC", "2592000"))

os.makedirs(DATA_DIR, exist_ok=True)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _now_ts() -> int:
    return int(time.time())


def _gen_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode("utf-8").rstrip("=")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * ((4 - (len(data) % 4)) % 4)
    return base64.urlsafe_b64decode((data + padding).encode("utf-8"))


def _hash_password(password: str, salt: Optional[str] = None) -> str:
    salt_value = salt or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_value.encode("utf-8"), 120000)
    return f"{salt_value}${digest.hex()}"


def _verify_password(password: str, encoded: str) -> bool:
    if "$" not in encoded:
        return False
    salt, expected = encoded.split("$", 1)
    actual = _hash_password(password, salt=salt).split("$", 1)[1]
    return hmac.compare_digest(actual, expected)


def _token_sig(payload_b64: str) -> str:
    return hmac.new(JWT_SECRET.encode("utf-8"), payload_b64.encode("utf-8"), hashlib.sha256).hexdigest()


def _issue_token(payload: Dict[str, Any]) -> str:
    body = _b64url_encode(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    return f"{body}.{_token_sig(body)}"


def _verify_token(token: str) -> Dict[str, Any]:
    if "." not in token:
        raise ValueError("token format invalid")
    body, sig = token.split(".", 1)
    expected = _token_sig(body)
    if not hmac.compare_digest(sig, expected):
        raise ValueError("token signature invalid")
    payload = json.loads(_b64url_decode(body).decode("utf-8"))
    exp = int(payload.get("exp") or 0)
    if exp <= _now_ts():
        raise ValueError("token expired")
    return payload


class CollabService:
    def __init__(self, db_path: str = DB_PATH):
        self.db_path = db_path
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self) -> None:
        conn = self._connect()
        try:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id            TEXT PRIMARY KEY,
                    email         TEXT UNIQUE NOT NULL,
                    name          TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    status        TEXT DEFAULT 'active',
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspaces (
                    id            TEXT PRIMARY KEY,
                    name          TEXT NOT NULL,
                    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS workspace_members (
                    id            TEXT PRIMARY KEY,
                    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    role          TEXT NOT NULL,
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL,
                    UNIQUE(workspace_id, user_id)
                );

                CREATE TABLE IF NOT EXISTS workspace_invites (
                    id            TEXT PRIMARY KEY,
                    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    email         TEXT NOT NULL,
                    role          TEXT NOT NULL,
                    token         TEXT NOT NULL,
                    status        TEXT NOT NULL DEFAULT 'pending',
                    expires_at    TEXT NOT NULL,
                    created_at    TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS refresh_tokens (
                    id          TEXT PRIMARY KEY,
                    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash  TEXT NOT NULL UNIQUE,
                    expires_at  INTEGER NOT NULL,
                    revoked_at  INTEGER DEFAULT 0,
                    created_at  TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS password_resets (
                    id          TEXT PRIMARY KEY,
                    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token_hash  TEXT NOT NULL UNIQUE,
                    expires_at  INTEGER NOT NULL,
                    used_at     INTEGER DEFAULT 0,
                    created_at  TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS okr_objectives (
                    id            TEXT PRIMARY KEY,
                    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    title         TEXT NOT NULL,
                    owner_user_id TEXT DEFAULT '',
                    status        TEXT DEFAULT 'active',
                    risk          TEXT DEFAULT 'normal',
                    due_date      TEXT DEFAULT '',
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS okr_key_results (
                    id              TEXT PRIMARY KEY,
                    objective_id    TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
                    title           TEXT NOT NULL,
                    metric_target   REAL DEFAULT 100,
                    metric_current  REAL DEFAULT 0,
                    auto_metric     TEXT DEFAULT '',
                    auto_enabled    INTEGER DEFAULT 0,
                    status          TEXT DEFAULT 'active',
                    owner_user_id   TEXT DEFAULT '',
                    created_at      TEXT NOT NULL,
                    updated_at      TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS okr_links (
                    id            TEXT PRIMARY KEY,
                    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    objective_id  TEXT NOT NULL REFERENCES okr_objectives(id) ON DELETE CASCADE,
                    key_result_id TEXT DEFAULT '',
                    link_type     TEXT NOT NULL,
                    link_id       TEXT NOT NULL,
                    created_at    TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS operation_journal (
                    id            TEXT PRIMARY KEY,
                    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    project_scope TEXT NOT NULL,
                    seq           INTEGER NOT NULL,
                    action        TEXT NOT NULL,
                    payload_json  TEXT NOT NULL,
                    created_by    TEXT DEFAULT '',
                    created_at    TEXT NOT NULL,
                    UNIQUE(workspace_id, project_scope, seq)
                );

                CREATE TABLE IF NOT EXISTS operation_heads (
                    workspace_id  TEXT NOT NULL,
                    project_scope TEXT NOT NULL,
                    head_index    INTEGER NOT NULL DEFAULT 0,
                    updated_at    TEXT NOT NULL,
                    PRIMARY KEY (workspace_id, project_scope)
                );

                CREATE TABLE IF NOT EXISTS episode_assignments (
                    episode_id    TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
                    workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                    series_id     TEXT NOT NULL,
                    assigned_to   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    status        TEXT NOT NULL DEFAULT 'draft',
                    locked_at     TEXT DEFAULT '',
                    submitted_at  TEXT DEFAULT '',
                    reviewed_at   TEXT DEFAULT '',
                    reviewed_by   TEXT DEFAULT '',
                    note          TEXT DEFAULT '',
                    created_at    TEXT NOT NULL,
                    updated_at    TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
                CREATE INDEX IF NOT EXISTS idx_okr_workspace ON okr_objectives(workspace_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_okr_links_objective ON okr_links(objective_id, key_result_id);
                CREATE INDEX IF NOT EXISTS idx_journal_scope ON operation_journal(workspace_id, project_scope, seq);
                CREATE INDEX IF NOT EXISTS idx_episode_assignments_workspace ON episode_assignments(workspace_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_episode_assignments_assignee ON episode_assignments(workspace_id, assigned_to, status);
                CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at DESC);
                """
            )
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
        self._ensure_column(conn, "okr_key_results", "auto_metric", "TEXT DEFAULT ''")
        self._ensure_column(conn, "okr_key_results", "auto_enabled", "INTEGER DEFAULT 0")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_okr_links_objective ON okr_links(objective_id, key_result_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS episode_assignments (
                episode_id    TEXT PRIMARY KEY REFERENCES episodes(id) ON DELETE CASCADE,
                workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
                series_id     TEXT NOT NULL,
                assigned_to   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                status        TEXT NOT NULL DEFAULT 'draft',
                locked_at     TEXT DEFAULT '',
                submitted_at  TEXT DEFAULT '',
                reviewed_at   TEXT DEFAULT '',
                reviewed_by   TEXT DEFAULT '',
                note          TEXT DEFAULT '',
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_episode_assignments_workspace ON episode_assignments(workspace_id, updated_at DESC)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_episode_assignments_assignee ON episode_assignments(workspace_id, assigned_to, status)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS password_resets (
                id          TEXT PRIMARY KEY,
                user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                token_hash  TEXT NOT NULL UNIQUE,
                expires_at  INTEGER NOT NULL,
                used_at     INTEGER DEFAULT 0,
                created_at  TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id, created_at DESC)")

    @staticmethod
    def _row_to_dict(row: Optional[sqlite3.Row]) -> Optional[Dict[str, Any]]:
        if row is None:
            return None
        return dict(row)

    def _create_tokens(self, user_id: str, email: str) -> Dict[str, str]:
        now = _now_ts()
        access_payload = {
            "sub": user_id,
            "email": email,
            "type": "access",
            "iat": now,
            "exp": now + ACCESS_TTL_SEC,
            "jti": _gen_id("atk"),
        }
        refresh_payload = {
            "sub": user_id,
            "email": email,
            "type": "refresh",
            "iat": now,
            "exp": now + REFRESH_TTL_SEC,
            "jti": _gen_id("rtk"),
        }
        access_token = _issue_token(access_payload)
        refresh_token = _issue_token(refresh_payload)

        refresh_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
        conn = self._connect()
        try:
            conn.execute(
                "INSERT OR REPLACE INTO refresh_tokens (id, user_id, token_hash, expires_at, revoked_at, created_at) VALUES (?,?,?,?,?,?)",
                (_gen_id("rf"), user_id, refresh_hash, refresh_payload["exp"], 0, _now_iso()),
            )
            conn.commit()
        finally:
            conn.close()
        return {"access_token": access_token, "refresh_token": refresh_token}

    def verify_access_token(self, token: str) -> Dict[str, Any]:
        payload = _verify_token(token)
        if payload.get("type") != "access":
            raise ValueError("token type invalid")
        user = self.get_user_by_id(str(payload.get("sub") or ""))
        if not user:
            raise ValueError("user not found")
        return user

    def refresh_access_token(self, refresh_token: str) -> Dict[str, str]:
        payload = _verify_token(refresh_token)
        if payload.get("type") != "refresh":
            raise ValueError("refresh token type invalid")
        token_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM refresh_tokens WHERE token_hash=?",
                (token_hash,),
            ).fetchone()
            token_row = self._row_to_dict(row)
            if not token_row:
                raise ValueError("refresh token not found")
            if int(token_row.get("revoked_at") or 0) > 0:
                raise ValueError("refresh token revoked")
            if int(token_row.get("expires_at") or 0) <= _now_ts():
                raise ValueError("refresh token expired")
        finally:
            conn.close()
        user_id = str(payload.get("sub") or "")
        user = self.get_user_by_id(user_id)
        if not user:
            raise ValueError("user not found")
        return self._create_tokens(user_id=user_id, email=str(user.get("email") or ""))

    def revoke_refresh_token(self, refresh_token: str) -> None:
        token_hash = hashlib.sha256(refresh_token.encode("utf-8")).hexdigest()
        conn = self._connect()
        try:
            conn.execute(
                "UPDATE refresh_tokens SET revoked_at=? WHERE token_hash=?",
                (_now_ts(), token_hash),
            )
            conn.commit()
        finally:
            conn.close()

    def get_user_by_id(self, user_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT id, email, name, status, created_at, updated_at FROM users WHERE id=?", (user_id,)).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def get_user_by_email(self, email: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM users WHERE email=?", (email.lower().strip(),)).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def update_user_profile(
        self,
        user_id: str,
        *,
        name: Optional[str] = None,
        email: Optional[str] = None,
    ) -> Dict[str, Any]:
        user = self.get_user_by_id(user_id)
        if not user:
            raise ValueError("user not found")

        updates: Dict[str, Any] = {}
        if name is not None:
            normalized_name = str(name or "").strip()
            if not normalized_name:
                raise ValueError("name required")
            updates["name"] = normalized_name

        if email is not None:
            normalized_email = str(email or "").strip().lower()
            if not normalized_email:
                raise ValueError("email required")
            if "@" not in normalized_email:
                raise ValueError("email invalid")
            existing = self.get_user_by_email(normalized_email)
            if existing and str(existing.get("id") or "") != user_id:
                raise ValueError("email already exists")
            updates["email"] = normalized_email

        if not updates:
            return user

        now = _now_iso()
        clauses = []
        values: List[Any] = []
        for key in ("name", "email"):
            if key in updates:
                clauses.append(f"{key}=?")
                values.append(updates[key])
        clauses.append("updated_at=?")
        values.append(now)
        values.append(user_id)

        conn = self._connect()
        try:
            conn.execute(
                f"UPDATE users SET {', '.join(clauses)} WHERE id=?",
                tuple(values),
            )
            conn.commit()
        finally:
            conn.close()

        updated = self.get_user_by_id(user_id)
        if not updated:
            raise ValueError("user update failed")
        return updated

    def change_password(self, user_id: str, current_password: str, new_password: str) -> None:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT id, password_hash FROM users WHERE id=?",
                (user_id,),
            ).fetchone()
            user = self._row_to_dict(row)
            if not user:
                raise ValueError("user not found")
            if not _verify_password(current_password or "", str(user.get("password_hash") or "")):
                raise ValueError("current password invalid")
            if len(new_password or "") < 6:
                raise ValueError("new password too short")
            if _verify_password(new_password, str(user.get("password_hash") or "")):
                raise ValueError("new password must differ from current password")

            now = _now_iso()
            now_ts = _now_ts()
            conn.execute(
                "UPDATE users SET password_hash=?, updated_at=? WHERE id=?",
                (_hash_password(new_password), now, user_id),
            )
            conn.execute(
                "UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND (revoked_at IS NULL OR revoked_at=0)",
                (now_ts, user_id),
            )
            conn.commit()
        finally:
            conn.close()

    def create_password_reset_token(self, email: str, ttl_seconds: int = 1800) -> Optional[str]:
        user = self.get_user_by_email(email)
        if not user:
            return None
        user_id = str(user.get("id") or "")
        if not user_id:
            return None

        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
        now = _now_iso()
        expires_at = _now_ts() + max(300, int(ttl_seconds or 0))

        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO password_resets (id, user_id, token_hash, expires_at, used_at, created_at) VALUES (?,?,?,?,?,?)",
                (_gen_id("pwd"), user_id, token_hash, expires_at, 0, now),
            )
            conn.commit()
        finally:
            conn.close()
        return raw_token

    def reset_password_by_token(self, reset_token: str, new_password: str) -> Dict[str, Any]:
        token = str(reset_token or "").strip()
        if not token:
            raise ValueError("reset token required")
        if len(new_password or "") < 6:
            raise ValueError("new password too short")

        token_hash = hashlib.sha256(token.encode("utf-8")).hexdigest()
        now_ts = _now_ts()
        row: Optional[Dict[str, Any]] = None
        conn = self._connect()
        try:
            result = conn.execute(
                "SELECT * FROM password_resets WHERE token_hash=?",
                (token_hash,),
            ).fetchone()
            row = self._row_to_dict(result)
            if not row:
                raise ValueError("reset token invalid")
            if int(row.get("used_at") or 0) > 0:
                raise ValueError("reset token already used")
            if int(row.get("expires_at") or 0) <= now_ts:
                raise ValueError("reset token expired")

            user_id = str(row.get("user_id") or "")
            user_row = conn.execute("SELECT password_hash FROM users WHERE id=?", (user_id,)).fetchone()
            user_data = self._row_to_dict(user_row)
            if not user_data:
                raise ValueError("user not found")
            if _verify_password(new_password, str(user_data.get("password_hash") or "")):
                raise ValueError("new password must differ from current password")

            conn.execute(
                "UPDATE users SET password_hash=?, updated_at=? WHERE id=?",
                (_hash_password(new_password), _now_iso(), user_id),
            )
            conn.execute(
                "UPDATE password_resets SET used_at=? WHERE id=?",
                (now_ts, row["id"]),
            )
            conn.execute(
                "UPDATE refresh_tokens SET revoked_at=? WHERE user_id=? AND (revoked_at IS NULL OR revoked_at=0)",
                (now_ts, user_id),
            )
            conn.commit()
        finally:
            conn.close()

        user = self.get_user_by_id(str((row or {}).get("user_id") or ""))
        if not user:
            raise ValueError("user not found")
        return user

    def ensure_local_dev_user(self) -> Dict[str, Any]:
        existing = self.get_user_by_email("local@dev.local")
        if existing:
            return existing
        result = self.register_user("local@dev.local", "dev-local-pass", "Local Dev", create_workspace=True)
        return result["user"]

    def register_user(self, email: str, password: str, name: str, create_workspace: bool = True) -> Dict[str, Any]:
        email_norm = email.lower().strip()
        if not email_norm:
            raise ValueError("email required")
        if len(password or "") < 6:
            raise ValueError("password too short")
        if self.get_user_by_email(email_norm):
            raise ValueError("email already exists")

        user_id = _gen_id("usr")
        now = _now_iso()
        workspace: Optional[Dict[str, Any]] = None
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO users (id, email, name, password_hash, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
                (user_id, email_norm, name.strip() or email_norm.split("@")[0], _hash_password(password), "active", now, now),
            )
            if create_workspace:
                ws_id = _gen_id("ws")
                ws_name = f"{name.strip() or '新用户'} 的协作空间"
                conn.execute(
                    "INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at) VALUES (?,?,?,?,?)",
                    (ws_id, ws_name, user_id, now, now),
                )
                conn.execute(
                    "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                    (_gen_id("wsm"), ws_id, user_id, "owner", now, now),
                )
                workspace = {
                    "id": ws_id,
                    "name": ws_name,
                    "owner_user_id": user_id,
                    "created_at": now,
                    "updated_at": now,
                }
            conn.commit()
        finally:
            conn.close()

        user = self.get_user_by_id(user_id)
        if not user:
            raise ValueError("user create failed")
        tokens = self._create_tokens(user_id=user_id, email=email_norm)
        return {
            "user": user,
            "workspace": workspace,
            **tokens,
        }

    def login_user(self, email: str, password: str) -> Dict[str, Any]:
        user_full = self.get_user_by_email(email)
        if not user_full:
            raise ValueError("invalid credentials")
        if not _verify_password(password, str(user_full.get("password_hash") or "")):
            raise ValueError("invalid credentials")
        user = {
            "id": user_full["id"],
            "email": user_full["email"],
            "name": user_full["name"],
            "status": user_full["status"],
            "created_at": user_full["created_at"],
            "updated_at": user_full["updated_at"],
        }
        tokens = self._create_tokens(user_id=user["id"], email=user["email"])
        return {
            "user": user,
            "workspaces": self.list_workspaces(user["id"]),
            **tokens,
        }

    def list_workspaces(self, user_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT w.*,
                       wm.role AS role
                FROM workspaces w
                JOIN workspace_members wm ON wm.workspace_id = w.id
                WHERE wm.user_id = ?
                ORDER BY w.updated_at DESC
                """,
                (user_id,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def create_workspace(self, user_id: str, name: str) -> Dict[str, Any]:
        ws_id = _gen_id("ws")
        now = _now_iso()
        conn = self._connect()
        try:
            conn.execute(
                "INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at) VALUES (?,?,?,?,?)",
                (ws_id, name.strip() or "新协作空间", user_id, now, now),
            )
            conn.execute(
                "INSERT INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at) VALUES (?,?,?,?,?,?)",
                (_gen_id("wsm"), ws_id, user_id, "owner", now, now),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_workspace(ws_id) or {"id": ws_id, "name": name.strip() or "新协作空间"}

    def get_workspace(self, workspace_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute("SELECT * FROM workspaces WHERE id=?", (workspace_id,)).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def get_member_role(self, workspace_id: str, user_id: str) -> Optional[str]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT role FROM workspace_members WHERE workspace_id=? AND user_id=?",
                (workspace_id, user_id),
            ).fetchone()
            if not row:
                return None
            return str(row["role"] or "")
        finally:
            conn.close()

    def list_members(self, workspace_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            rows = conn.execute(
                """
                SELECT wm.id, wm.workspace_id, wm.user_id, wm.role, wm.created_at, wm.updated_at,
                       u.email, u.name, u.status
                FROM workspace_members wm
                JOIN users u ON u.id = wm.user_id
                WHERE wm.workspace_id=?
                ORDER BY wm.created_at ASC
                """,
                (workspace_id,),
            ).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def add_member(self, workspace_id: str, actor_user_id: str, email: str, role: str = "viewer") -> Dict[str, Any]:
        target = self.get_user_by_email(email)
        if not target:
            invite = self.create_invite(workspace_id, email, role)
            return {"mode": "invite", "invite": invite}
        now = _now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT OR REPLACE INTO workspace_members (id, workspace_id, user_id, role, created_at, updated_at)
                VALUES (
                    COALESCE((SELECT id FROM workspace_members WHERE workspace_id=? AND user_id=?), ?),
                    ?, ?, ?, COALESCE((SELECT created_at FROM workspace_members WHERE workspace_id=? AND user_id=?), ?), ?
                )
                """,
                (
                    workspace_id,
                    target["id"],
                    _gen_id("wsm"),
                    workspace_id,
                    target["id"],
                    role,
                    workspace_id,
                    target["id"],
                    now,
                    now,
                ),
            )
            conn.execute(
                "UPDATE workspaces SET updated_at=? WHERE id=?",
                (now, workspace_id),
            )
            conn.commit()
        finally:
            conn.close()
        return {"mode": "member", "member": self.list_members(workspace_id)}

    def create_invite(self, workspace_id: str, email: str, role: str) -> Dict[str, Any]:
        invite_id = _gen_id("inv")
        token = _gen_id("ivt")
        now = _now_iso()
        expires = datetime.now(timezone.utc).timestamp() + 7 * 24 * 3600
        expires_at = datetime.fromtimestamp(expires, tz=timezone.utc).isoformat()
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO workspace_invites (id, workspace_id, email, role, token, status, expires_at, created_at)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (invite_id, workspace_id, email.lower().strip(), role, token, "pending", expires_at, now),
            )
            conn.commit()
        finally:
            conn.close()
        return {
            "id": invite_id,
            "workspace_id": workspace_id,
            "email": email.lower().strip(),
            "role": role,
            "token": token,
            "status": "pending",
            "expires_at": expires_at,
            "created_at": now,
        }

    def update_member_role(self, workspace_id: str, member_user_id: str, role: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute(
                "UPDATE workspace_members SET role=?, updated_at=? WHERE workspace_id=? AND user_id=?",
                (role, _now_iso(), workspace_id, member_user_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    def remove_member(self, workspace_id: str, member_user_id: str) -> bool:
        conn = self._connect()
        try:
            cur = conn.execute(
                "DELETE FROM workspace_members WHERE workspace_id=? AND user_id=?",
                (workspace_id, member_user_id),
            )
            conn.commit()
            return cur.rowcount > 0
        finally:
            conn.close()

    @staticmethod
    def _normalize_auto_metric(value: Any) -> str:
        allowed = {
            "episodes_completion",
            "shots_completion",
            "frame_completion",
            "video_completion",
            "audio_completion",
        }
        metric = str(value or "").strip().lower()
        return metric if metric in allowed else ""

    @staticmethod
    def _safe_ratio(numerator: float, denominator: float) -> float:
        if denominator <= 0:
            return 0.0
        return max(0.0, min(1.0, numerator / denominator))

    def _workspace_shot_stats(self, conn: sqlite3.Connection, workspace_id: str) -> Dict[str, float]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS shots_total,
                SUM(CASE WHEN COALESCE(s.start_image_url,'')<>'' THEN 1 ELSE 0 END) AS frames_ready,
                SUM(CASE WHEN COALESCE(s.video_url,'')<>'' THEN 1 ELSE 0 END) AS videos_ready,
                SUM(CASE WHEN COALESCE(s.audio_url,'')<>'' THEN 1 ELSE 0 END) AS audio_ready,
                SUM(CASE WHEN s.status='completed' OR COALESCE(s.video_url,'')<>'' THEN 1 ELSE 0 END) AS shots_completed
            FROM shots s
            JOIN episodes e ON e.id = s.episode_id
            JOIN series sr ON sr.id = e.series_id
            WHERE sr.workspace_id=?
            """,
            (workspace_id,),
        ).fetchone()
        stats = dict(row or {})
        return {
            "shots_total": float(stats.get("shots_total") or 0),
            "frames_ready": float(stats.get("frames_ready") or 0),
            "videos_ready": float(stats.get("videos_ready") or 0),
            "audio_ready": float(stats.get("audio_ready") or 0),
            "shots_completed": float(stats.get("shots_completed") or 0),
        }

    def _series_shot_stats(self, conn: sqlite3.Connection, series_id: str) -> Dict[str, float]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS shots_total,
                SUM(CASE WHEN COALESCE(start_image_url,'')<>'' THEN 1 ELSE 0 END) AS frames_ready,
                SUM(CASE WHEN COALESCE(video_url,'')<>'' THEN 1 ELSE 0 END) AS videos_ready,
                SUM(CASE WHEN COALESCE(audio_url,'')<>'' THEN 1 ELSE 0 END) AS audio_ready,
                SUM(CASE WHEN status='completed' OR COALESCE(video_url,'')<>'' THEN 1 ELSE 0 END) AS shots_completed
            FROM shots
            WHERE episode_id IN (SELECT id FROM episodes WHERE series_id=?)
            """,
            (series_id,),
        ).fetchone()
        stats = dict(row or {})
        return {
            "shots_total": float(stats.get("shots_total") or 0),
            "frames_ready": float(stats.get("frames_ready") or 0),
            "videos_ready": float(stats.get("videos_ready") or 0),
            "audio_ready": float(stats.get("audio_ready") or 0),
            "shots_completed": float(stats.get("shots_completed") or 0),
        }

    def _episode_shot_stats(self, conn: sqlite3.Connection, episode_id: str) -> Dict[str, float]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS shots_total,
                SUM(CASE WHEN COALESCE(start_image_url,'')<>'' THEN 1 ELSE 0 END) AS frames_ready,
                SUM(CASE WHEN COALESCE(video_url,'')<>'' THEN 1 ELSE 0 END) AS videos_ready,
                SUM(CASE WHEN COALESCE(audio_url,'')<>'' THEN 1 ELSE 0 END) AS audio_ready,
                SUM(CASE WHEN status='completed' OR COALESCE(video_url,'')<>'' THEN 1 ELSE 0 END) AS shots_completed
            FROM shots
            WHERE episode_id=?
            """,
            (episode_id,),
        ).fetchone()
        stats = dict(row or {})
        return {
            "shots_total": float(stats.get("shots_total") or 0),
            "frames_ready": float(stats.get("frames_ready") or 0),
            "videos_ready": float(stats.get("videos_ready") or 0),
            "audio_ready": float(stats.get("audio_ready") or 0),
            "shots_completed": float(stats.get("shots_completed") or 0),
        }

    def _workspace_episode_stats(self, conn: sqlite3.Connection, workspace_id: str) -> Dict[str, float]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS episodes_total,
                SUM(CASE WHEN e.status='completed' THEN 1 ELSE 0 END) AS episodes_completed
            FROM episodes e
            JOIN series sr ON sr.id = e.series_id
            WHERE sr.workspace_id=?
            """,
            (workspace_id,),
        ).fetchone()
        stats = dict(row or {})
        return {
            "episodes_total": float(stats.get("episodes_total") or 0),
            "episodes_completed": float(stats.get("episodes_completed") or 0),
        }

    def _series_episode_stats(self, conn: sqlite3.Connection, series_id: str) -> Dict[str, float]:
        row = conn.execute(
            """
            SELECT
                COUNT(*) AS episodes_total,
                SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS episodes_completed
            FROM episodes
            WHERE series_id=?
            """,
            (series_id,),
        ).fetchone()
        stats = dict(row or {})
        return {
            "episodes_total": float(stats.get("episodes_total") or 0),
            "episodes_completed": float(stats.get("episodes_completed") or 0),
        }

    def _episode_completion_stats(self, conn: sqlite3.Connection, episode_id: str) -> Dict[str, float]:
        row = conn.execute(
            "SELECT status FROM episodes WHERE id=?",
            (episode_id,),
        ).fetchone()
        status = str((dict(row or {})).get("status") or "")
        return {
            "episodes_total": 1.0 if row else 0.0,
            "episodes_completed": 1.0 if status == "completed" else 0.0,
        }

    def _metric_ratio_from_stats(self, metric: str, stats: Dict[str, float]) -> float:
        if metric == "episodes_completion":
            return self._safe_ratio(float(stats.get("episodes_completed") or 0), float(stats.get("episodes_total") or 0))
        if metric == "shots_completion":
            return self._safe_ratio(float(stats.get("shots_completed") or 0), float(stats.get("shots_total") or 0))
        if metric == "frame_completion":
            return self._safe_ratio(float(stats.get("frames_ready") or 0), float(stats.get("shots_total") or 0))
        if metric == "video_completion":
            return self._safe_ratio(float(stats.get("videos_ready") or 0), float(stats.get("shots_total") or 0))
        if metric == "audio_completion":
            return self._safe_ratio(float(stats.get("audio_ready") or 0), float(stats.get("shots_total") or 0))
        return 0.0

    def _sanitize_okr_links(self, links: Any, workspace_id: str) -> List[Dict[str, str]]:
        if not isinstance(links, list):
            return []
        result: List[Dict[str, str]] = []
        seen: set = set()
        for raw in links:
            if not isinstance(raw, dict):
                continue
            link_type = str(raw.get("link_type") or raw.get("type") or "").strip().lower()
            link_id = str(raw.get("link_id") or raw.get("id") or "").strip()
            if link_type not in {"workspace", "series", "episode"}:
                continue
            if link_type == "workspace":
                link_id = link_id or workspace_id
            if not link_id:
                continue
            key = (link_type, link_id)
            if key in seen:
                continue
            seen.add(key)
            result.append({"link_type": link_type, "link_id": link_id})
        return result

    def _write_okr_links(
        self,
        conn: sqlite3.Connection,
        workspace_id: str,
        objective_id: str,
        key_result_id: str,
        links: List[Dict[str, str]],
    ) -> None:
        conn.execute(
            "DELETE FROM okr_links WHERE workspace_id=? AND objective_id=? AND key_result_id=?",
            (workspace_id, objective_id, key_result_id),
        )
        now = _now_iso()
        for item in links:
            conn.execute(
                """
                INSERT INTO okr_links (id, workspace_id, objective_id, key_result_id, link_type, link_id, created_at)
                VALUES (?,?,?,?,?,?,?)
                """,
                (
                    _gen_id("ol"),
                    workspace_id,
                    objective_id,
                    key_result_id,
                    item["link_type"],
                    item["link_id"],
                    now,
                ),
            )

    def _resolve_auto_metric_current(
        self,
        conn: sqlite3.Connection,
        workspace_id: str,
        kr: Dict[str, Any],
        links: List[Dict[str, str]],
    ) -> Optional[float]:
        metric = self._normalize_auto_metric(kr.get("auto_metric"))
        auto_enabled = bool(int(kr.get("auto_enabled") or 0))
        if not metric or not auto_enabled:
            return None

        target = float(kr.get("metric_target") or 100.0)
        refs = links if links else [{"link_type": "workspace", "link_id": workspace_id}]
        ratios: List[float] = []
        for ref in refs:
            link_type = str(ref.get("link_type") or "").strip().lower()
            link_id = str(ref.get("link_id") or "").strip()
            if not link_id:
                continue
            stats: Dict[str, float] = {}
            if link_type == "workspace":
                if metric == "episodes_completion":
                    stats = self._workspace_episode_stats(conn, link_id)
                else:
                    stats = self._workspace_shot_stats(conn, link_id)
            elif link_type == "series":
                if metric == "episodes_completion":
                    stats = self._series_episode_stats(conn, link_id)
                else:
                    stats = self._series_shot_stats(conn, link_id)
            elif link_type == "episode":
                if metric == "episodes_completion":
                    stats = self._episode_completion_stats(conn, link_id)
                else:
                    stats = self._episode_shot_stats(conn, link_id)
            ratio = self._metric_ratio_from_stats(metric, stats)
            ratios.append(ratio)
        if not ratios:
            return 0.0
        return round(target * (sum(ratios) / len(ratios)), 2)

    def list_okrs(self, workspace_id: str) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            objectives = conn.execute(
                "SELECT * FROM okr_objectives WHERE workspace_id=? ORDER BY updated_at DESC",
                (workspace_id,),
            ).fetchall()
            result: List[Dict[str, Any]] = []
            for row in objectives:
                objective = dict(row)
                objective_links_rows = conn.execute(
                    """
                    SELECT link_type, link_id
                    FROM okr_links
                    WHERE workspace_id=? AND objective_id=? AND key_result_id=''
                    ORDER BY created_at ASC
                    """,
                    (workspace_id, objective["id"]),
                ).fetchall()
                objective_links = [dict(item) for item in objective_links_rows]
                kr_rows = conn.execute(
                    "SELECT * FROM okr_key_results WHERE objective_id=? ORDER BY created_at ASC",
                    (objective["id"],),
                ).fetchall()
                krs: List[Dict[str, Any]] = []
                for kr_row in kr_rows:
                    kr = dict(kr_row)
                    links_rows = conn.execute(
                        """
                        SELECT link_type, link_id
                        FROM okr_links
                        WHERE workspace_id=? AND objective_id=? AND key_result_id=?
                        ORDER BY created_at ASC
                        """,
                        (workspace_id, objective["id"], str(kr.get("id") or "")),
                    ).fetchall()
                    links = [dict(item) for item in links_rows] or objective_links
                    auto_current = self._resolve_auto_metric_current(conn, workspace_id, kr, links)
                    manual_current = float(kr.get("metric_current") or 0.0)
                    effective_current = float(auto_current if auto_current is not None else manual_current)
                    kr["metric_current_manual"] = manual_current
                    kr["metric_current"] = effective_current
                    kr["auto_metric"] = self._normalize_auto_metric(kr.get("auto_metric"))
                    kr["auto_enabled"] = bool(int(kr.get("auto_enabled") or 0))
                    kr["links"] = links
                    krs.append(kr)
                if krs:
                    ratios = []
                    for kr in krs:
                        target = float(kr.get("metric_target") or 0)
                        current = float(kr.get("metric_current") or 0)
                        if target > 0:
                            ratios.append(max(0.0, min(1.0, current / target)))
                    objective["progress"] = round((sum(ratios) / len(ratios)) * 100, 2) if ratios else 0.0
                else:
                    objective["progress"] = 0.0
                objective["links"] = objective_links
                objective["key_results"] = krs
                result.append(objective)
            return result
        finally:
            conn.close()

    def create_okr(self, workspace_id: str, payload: Dict[str, Any], actor_user_id: str) -> Dict[str, Any]:
        objective_id = _gen_id("okr")
        now = _now_iso()
        title = str(payload.get("title") or "").strip() or "未命名目标"
        owner_user_id = str(payload.get("owner_user_id") or actor_user_id)
        status = str(payload.get("status") or "active")
        risk = str(payload.get("risk") or "normal")
        due_date = str(payload.get("due_date") or "")
        key_results = payload.get("key_results") if isinstance(payload.get("key_results"), list) else []
        objective_links = self._sanitize_okr_links(payload.get("links"), workspace_id)

        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO okr_objectives (id, workspace_id, title, owner_user_id, status, risk, due_date, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?)
                """,
                (objective_id, workspace_id, title, owner_user_id, status, risk, due_date, now, now),
            )
            self._write_okr_links(conn, workspace_id, objective_id, "", objective_links)
            for item in key_results:
                if not isinstance(item, dict):
                    continue
                kr_id = _gen_id("kr")
                auto_metric = self._normalize_auto_metric(item.get("auto_metric"))
                auto_enabled = bool(item.get("auto_enabled")) or bool(auto_metric)
                conn.execute(
                    """
                    INSERT INTO okr_key_results (id, objective_id, title, metric_target, metric_current, auto_metric, auto_enabled, status, owner_user_id, created_at, updated_at)
                    VALUES (?,?,?,?,?,?,?,?,?,?,?)
                    """,
                    (
                        kr_id,
                        objective_id,
                        str(item.get("title") or "未命名KR"),
                        float(item.get("metric_target") or 100.0),
                        float(item.get("metric_current") or 0.0),
                        auto_metric,
                        1 if auto_enabled else 0,
                        str(item.get("status") or "active"),
                        str(item.get("owner_user_id") or owner_user_id),
                        now,
                        now,
                    ),
                )
                kr_links = self._sanitize_okr_links(item.get("links"), workspace_id)
                self._write_okr_links(conn, workspace_id, objective_id, kr_id, kr_links)
            conn.commit()
        finally:
            conn.close()
        okrs = self.list_okrs(workspace_id)
        return next((item for item in okrs if item.get("id") == objective_id), {"id": objective_id, "title": title})

    def update_okr(self, workspace_id: str, objective_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        allowed = {
            "title": "title",
            "owner_user_id": "owner_user_id",
            "status": "status",
            "risk": "risk",
            "due_date": "due_date",
        }
        clauses: List[str] = []
        values: List[Any] = []
        for key, column in allowed.items():
            if key in updates:
                clauses.append(f"{column}=?")
                values.append(updates.get(key))
        if clauses:
            clauses.append("updated_at=?")
            values.append(_now_iso())
            values.extend([objective_id, workspace_id])
            conn = self._connect()
            try:
                conn.execute(
                    f"UPDATE okr_objectives SET {', '.join(clauses)} WHERE id=? AND workspace_id=?",
                    tuple(values),
                )
                conn.commit()
            finally:
                conn.close()

        if isinstance(updates.get("key_results"), list):
            now = _now_iso()
            conn = self._connect()
            try:
                objective_links = self._sanitize_okr_links(updates.get("links"), workspace_id)
                if not objective_links:
                    old_obj_links = conn.execute(
                        """
                        SELECT link_type, link_id
                        FROM okr_links
                        WHERE workspace_id=? AND objective_id=? AND key_result_id=''
                        ORDER BY created_at ASC
                        """,
                        (workspace_id, objective_id),
                    ).fetchall()
                    objective_links = [dict(item) for item in old_obj_links]
                conn.execute("DELETE FROM okr_key_results WHERE objective_id=?", (objective_id,))
                conn.execute("DELETE FROM okr_links WHERE workspace_id=? AND objective_id=?", (workspace_id, objective_id))
                self._write_okr_links(conn, workspace_id, objective_id, "", objective_links)
                for item in updates["key_results"]:
                    if not isinstance(item, dict):
                        continue
                    kr_id = str(item.get("id") or "").strip() or _gen_id("kr")
                    auto_metric = self._normalize_auto_metric(item.get("auto_metric"))
                    auto_enabled = bool(item.get("auto_enabled")) or bool(auto_metric)
                    conn.execute(
                        """
                        INSERT INTO okr_key_results (id, objective_id, title, metric_target, metric_current, auto_metric, auto_enabled, status, owner_user_id, created_at, updated_at)
                        VALUES (?,?,?,?,?,?,?,?,?,?,?)
                        """,
                        (
                            kr_id,
                            objective_id,
                            str(item.get("title") or "未命名KR"),
                            float(item.get("metric_target") or 100.0),
                            float(item.get("metric_current") or 0.0),
                            auto_metric,
                            1 if auto_enabled else 0,
                            str(item.get("status") or "active"),
                            str(item.get("owner_user_id") or ""),
                            now,
                            now,
                        ),
                    )
                    kr_links = self._sanitize_okr_links(item.get("links"), workspace_id)
                    self._write_okr_links(conn, workspace_id, objective_id, kr_id, kr_links)
                conn.commit()
            finally:
                conn.close()
        elif "links" in updates:
            conn = self._connect()
            try:
                objective_links = self._sanitize_okr_links(updates.get("links"), workspace_id)
                self._write_okr_links(conn, workspace_id, objective_id, "", objective_links)
                conn.commit()
            finally:
                conn.close()

        okrs = self.list_okrs(workspace_id)
        return next((item for item in okrs if item.get("id") == objective_id), None)

    def append_operation(
        self,
        workspace_id: str,
        project_scope: str,
        action: str,
        payload: Dict[str, Any],
        created_by: str = "",
    ) -> Dict[str, Any]:
        now = _now_iso()
        conn = self._connect()
        try:
            head_row = conn.execute(
                "SELECT head_index FROM operation_heads WHERE workspace_id=? AND project_scope=?",
                (workspace_id, project_scope),
            ).fetchone()
            current_head = int((head_row["head_index"] if head_row else 0) or 0)
            conn.execute(
                "DELETE FROM operation_journal WHERE workspace_id=? AND project_scope=? AND seq>?",
                (workspace_id, project_scope, current_head),
            )
            next_seq = current_head + 1
            op_id = _gen_id("op")
            conn.execute(
                """
                INSERT INTO operation_journal (id, workspace_id, project_scope, seq, action, payload_json, created_by, created_at)
                VALUES (?,?,?,?,?,?,?,?)
                """,
                (op_id, workspace_id, project_scope, next_seq, action, json.dumps(payload, ensure_ascii=False), created_by, now),
            )
            conn.execute(
                """
                INSERT INTO operation_heads (workspace_id, project_scope, head_index, updated_at)
                VALUES (?,?,?,?)
                ON CONFLICT(workspace_id, project_scope) DO UPDATE SET head_index=excluded.head_index, updated_at=excluded.updated_at
                """,
                (workspace_id, project_scope, next_seq, now),
            )
            conn.commit()
            return {
                "id": op_id,
                "workspace_id": workspace_id,
                "project_scope": project_scope,
                "seq": next_seq,
                "action": action,
                "payload": payload,
                "created_by": created_by,
                "created_at": now,
            }
        finally:
            conn.close()

    def _read_head(self, workspace_id: str, project_scope: str) -> int:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT head_index FROM operation_heads WHERE workspace_id=? AND project_scope=?",
                (workspace_id, project_scope),
            ).fetchone()
            return int((row["head_index"] if row else 0) or 0)
        finally:
            conn.close()

    def _set_head(self, workspace_id: str, project_scope: str, head_index: int) -> None:
        conn = self._connect()
        try:
            conn.execute(
                """
                INSERT INTO operation_heads (workspace_id, project_scope, head_index, updated_at)
                VALUES (?,?,?,?)
                ON CONFLICT(workspace_id, project_scope) DO UPDATE SET head_index=excluded.head_index, updated_at=excluded.updated_at
                """,
                (workspace_id, project_scope, max(0, head_index), _now_iso()),
            )
            conn.commit()
        finally:
            conn.close()

    def get_operation_by_seq(self, workspace_id: str, project_scope: str, seq: int) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                "SELECT * FROM operation_journal WHERE workspace_id=? AND project_scope=? AND seq=?",
                (workspace_id, project_scope, seq),
            ).fetchone()
            if not row:
                return None
            item = dict(row)
            payload_raw = item.get("payload_json")
            try:
                item["payload"] = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
            except Exception:
                item["payload"] = {}
            return item
        finally:
            conn.close()

    def undo(self, workspace_id: str, project_scope: str) -> Optional[Dict[str, Any]]:
        head = self._read_head(workspace_id, project_scope)
        if head <= 0:
            return None
        op = self.get_operation_by_seq(workspace_id, project_scope, head)
        if not op:
            return None
        self._set_head(workspace_id, project_scope, head - 1)
        return op

    def redo(self, workspace_id: str, project_scope: str) -> Optional[Dict[str, Any]]:
        head = self._read_head(workspace_id, project_scope)
        next_seq = head + 1
        op = self.get_operation_by_seq(workspace_id, project_scope, next_seq)
        if not op:
            return None
        self._set_head(workspace_id, project_scope, next_seq)
        return op

    def get_head(self, workspace_id: str, project_scope: str) -> int:
        return self._read_head(workspace_id, project_scope)

    def list_operations(
        self,
        workspace_id: str,
        project_scope: str,
        limit: int = 50,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Return operation journal entries with the current head position.

        Returns ``{"items": [...], "head_index": int, "total": int}``.
        Items are ordered by *seq DESC* (newest first).
        """
        conn = self._connect()
        try:
            head = self._read_head(workspace_id, project_scope)
            count_row = conn.execute(
                "SELECT COUNT(*) AS cnt FROM operation_journal WHERE workspace_id=? AND project_scope=?",
                (workspace_id, project_scope),
            ).fetchone()
            total = int(count_row["cnt"]) if count_row else 0

            rows = conn.execute(
                """
                SELECT * FROM operation_journal
                WHERE workspace_id=? AND project_scope=?
                ORDER BY seq DESC
                LIMIT ? OFFSET ?
                """,
                (workspace_id, project_scope, limit, offset),
            ).fetchall()

            items: list = []
            for r in rows:
                item = dict(r)
                payload_raw = item.pop("payload_json", None)
                try:
                    item["payload"] = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
                except Exception:
                    item["payload"] = {}
                items.append(item)

            return {"items": items, "head_index": head, "total": total}
        finally:
            conn.close()

    @staticmethod
    def _normalize_assignment_status(value: Any) -> str:
        status = str(value or "").strip().lower()
        return status if status in {"draft", "submitted", "approved", "rejected"} else "draft"

    def get_episode_assignment(self, workspace_id: str, episode_id: str) -> Optional[Dict[str, Any]]:
        conn = self._connect()
        try:
            row = conn.execute(
                """
                SELECT ea.*,
                       u.name AS assigned_to_name,
                       u.email AS assigned_to_email
                FROM episode_assignments ea
                LEFT JOIN users u ON u.id = ea.assigned_to
                WHERE ea.workspace_id=? AND ea.episode_id=?
                """,
                (workspace_id, episode_id),
            ).fetchone()
            return self._row_to_dict(row)
        finally:
            conn.close()

    def list_episode_assignments(
        self,
        workspace_id: str,
        series_id: str = "",
        assigned_to: str = "",
        status: str = "",
    ) -> List[Dict[str, Any]]:
        conn = self._connect()
        try:
            sql = """
                SELECT ea.*,
                       u.name AS assigned_to_name,
                       u.email AS assigned_to_email
                FROM episode_assignments ea
                LEFT JOIN users u ON u.id = ea.assigned_to
                WHERE ea.workspace_id=?
            """
            params: List[Any] = [workspace_id]
            if str(series_id or "").strip():
                sql += " AND ea.series_id=?"
                params.append(str(series_id).strip())
            if str(assigned_to or "").strip():
                sql += " AND ea.assigned_to=?"
                params.append(str(assigned_to).strip())
            normalized_status = self._normalize_assignment_status(status) if str(status or "").strip() else ""
            if normalized_status:
                sql += " AND ea.status=?"
                params.append(normalized_status)
            sql += " ORDER BY ea.updated_at DESC"
            rows = conn.execute(sql, tuple(params)).fetchall()
            return [dict(row) for row in rows]
        finally:
            conn.close()

    def upsert_episode_assignment(
        self,
        workspace_id: str,
        episode_id: str,
        assigned_to: str,
        actor_user_id: str = "",
        note: str = "",
    ) -> Dict[str, Any]:
        assignee = str(assigned_to or "").strip()
        if not assignee:
            raise ValueError("assigned_to required")
        user = self.get_user_by_id(assignee)
        if not user:
            raise ValueError("assigned user not found")
        if not self.get_member_role(workspace_id, assignee):
            raise ValueError("assigned user is not a workspace member")

        now = _now_iso()
        conn = self._connect()
        try:
            episode_row = conn.execute(
                """
                SELECT e.id AS episode_id, e.series_id, s.workspace_id
                FROM episodes e
                JOIN series s ON s.id = e.series_id
                WHERE e.id=?
                """,
                (episode_id,),
            ).fetchone()
            if not episode_row:
                raise ValueError("episode not found")
            episode_info = dict(episode_row)
            episode_workspace_id = str(episode_info.get("workspace_id") or "").strip()
            if episode_workspace_id and episode_workspace_id != workspace_id:
                raise ValueError("episode does not belong to workspace")
            series_id = str(episode_info.get("series_id") or "").strip()

            conn.execute(
                """
                INSERT INTO episode_assignments
                (episode_id, workspace_id, series_id, assigned_to, status, locked_at, submitted_at, reviewed_at, reviewed_by, note, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(episode_id) DO UPDATE SET
                    workspace_id=excluded.workspace_id,
                    series_id=excluded.series_id,
                    assigned_to=excluded.assigned_to,
                    status='draft',
                    locked_at=excluded.locked_at,
                    submitted_at='',
                    reviewed_at='',
                    reviewed_by='',
                    note=excluded.note,
                    updated_at=excluded.updated_at
                """,
                (
                    episode_id,
                    workspace_id,
                    series_id,
                    assignee,
                    "draft",
                    now,
                    "",
                    "",
                    "",
                    str(note or "").strip(),
                    now,
                    now,
                ),
            )
            conn.execute("UPDATE series SET updated_at=? WHERE id=?", (now, series_id))
            conn.commit()
        finally:
            conn.close()

        assignment = self.get_episode_assignment(workspace_id, episode_id)
        if not assignment:
            raise ValueError("assignment create failed")
        assignment["assigned_by"] = str(actor_user_id or "")
        return assignment

    def submit_episode_assignment(
        self,
        workspace_id: str,
        episode_id: str,
        actor_user_id: str,
        note: str = "",
    ) -> Optional[Dict[str, Any]]:
        assignment = self.get_episode_assignment(workspace_id, episode_id)
        if not assignment:
            return None

        role = self.get_member_role(workspace_id, actor_user_id) or ""
        assigned_to = str(assignment.get("assigned_to") or "")
        if role != "owner" and actor_user_id != assigned_to:
            raise ValueError("only assignee can submit for review")

        current_status = self._normalize_assignment_status(assignment.get("status"))
        if current_status in {"submitted", "approved"} and role != "owner":
            raise ValueError("episode has already been submitted")

        now = _now_iso()
        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE episode_assignments
                SET status='submitted',
                    submitted_at=?,
                    reviewed_at='',
                    reviewed_by='',
                    note=?,
                    updated_at=?
                WHERE workspace_id=? AND episode_id=?
                """,
                (now, str(note or "").strip(), now, workspace_id, episode_id),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_episode_assignment(workspace_id, episode_id)

    def review_episode_assignment(
        self,
        workspace_id: str,
        episode_id: str,
        reviewer_user_id: str,
        approve: bool,
        note: str = "",
    ) -> Optional[Dict[str, Any]]:
        reviewer_role = self.get_member_role(workspace_id, reviewer_user_id) or ""
        if reviewer_role != "owner":
            raise ValueError("only workspace owner can review assignment")

        assignment = self.get_episode_assignment(workspace_id, episode_id)
        if not assignment:
            return None

        now = _now_iso()
        next_status = "approved" if approve else "rejected"
        locked_at = str(assignment.get("locked_at") or "").strip()
        if not locked_at:
            locked_at = now

        conn = self._connect()
        try:
            conn.execute(
                """
                UPDATE episode_assignments
                SET status=?,
                    locked_at=?,
                    reviewed_at=?,
                    reviewed_by=?,
                    note=?,
                    updated_at=?
                WHERE workspace_id=? AND episode_id=?
                """,
                (
                    next_status,
                    locked_at,
                    now,
                    reviewer_user_id,
                    str(note or "").strip(),
                    now,
                    workspace_id,
                    episode_id,
                ),
            )
            conn.commit()
        finally:
            conn.close()
        return self.get_episode_assignment(workspace_id, episode_id)

    def can_edit_episode(
        self,
        workspace_id: str,
        episode_id: str,
        user_id: str,
        role: str,
    ) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        assignment = self.get_episode_assignment(workspace_id, episode_id)
        if not assignment:
            return True, "", None

        user_role = str(role or "").strip().lower()
        if user_role == "owner":
            return True, "", assignment

        assigned_to = str(assignment.get("assigned_to") or "").strip()
        assigned_to_name = str(assignment.get("assigned_to_name") or "").strip()
        status = self._normalize_assignment_status(assignment.get("status"))

        if assigned_to and assigned_to != user_id:
            assignee = assigned_to_name or assigned_to
            return False, f"该分幕已分配给 {assignee}，当前为只读模式", assignment

        if status in {"submitted", "approved"}:
            return False, "该分幕已提交审核，当前不可继续编辑", assignment

        return True, "", assignment
