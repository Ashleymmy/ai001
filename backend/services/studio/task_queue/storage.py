"""SQLite 任务存储层"""
import json
import sqlite3
import threading
import uuid
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any

from .types import (
    TaskJobData, TaskEvent,
    PipelineRun, PipelineStep, Checkpoint,
    CreateTaskInput,
)


def _gen_id() -> str:
    return uuid.uuid4().hex[:12]


def _now() -> str:
    return datetime.now().isoformat()


_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    series_id TEXT DEFAULT '',
    episode_id TEXT DEFAULT '',
    type TEXT NOT NULL,
    queue_type TEXT NOT NULL,
    runtime TEXT DEFAULT 'studio',
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    status TEXT DEFAULT 'queued',
    priority INTEGER DEFAULT 0,
    progress INTEGER DEFAULT 0,
    stage TEXT,
    attempt INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    payload TEXT DEFAULT '{}',
    result TEXT,
    error_code TEXT,
    error_message TEXT,
    external_id TEXT,
    dedupe_key TEXT,
    heartbeat_at TEXT,
    queued_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS task_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL,
    episode_id TEXT DEFAULT '',
    event_type TEXT NOT NULL,
    payload TEXT DEFAULT '{}',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id TEXT PRIMARY KEY,
    series_id TEXT NOT NULL,
    episode_id TEXT NOT NULL,
    runtime TEXT DEFAULT 'studio',
    status TEXT DEFAULT 'queued',
    current_stage TEXT,
    input_json TEXT DEFAULT '{}',
    output_json TEXT DEFAULT '{}',
    error_code TEXT,
    error_message TEXT,
    last_seq INTEGER DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_steps (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    step_key TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    attempt INTEGER DEFAULT 0,
    started_at TEXT,
    finished_at TEXT,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(run_id, step_key)
);

CREATE TABLE IF NOT EXISTS pipeline_checkpoints (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    node_key TEXT NOT NULL,
    version INTEGER DEFAULT 1,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_episode ON tasks(episode_id);
CREATE INDEX IF NOT EXISTS idx_tasks_dedupe ON tasks(dedupe_key);
CREATE INDEX IF NOT EXISTS idx_tasks_heartbeat ON tasks(heartbeat_at);
CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id);
CREATE INDEX IF NOT EXISTS idx_task_events_episode ON task_events(episode_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_episode ON pipeline_runs(episode_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_steps_run ON pipeline_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_checkpoints_run ON pipeline_checkpoints(run_id);
"""


class TaskStorage:
    """SQLite 任务队列存储"""

    def __init__(self, db_path: str):
        self.db_path = db_path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._init_tables()

    def _init_tables(self):
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()

    def close(self):
        self._conn.close()

    # ------------------------------------------------------------------
    # Task CRUD
    # ------------------------------------------------------------------

    def create_task(self, inp: CreateTaskInput) -> TaskJobData:
        """创建新任务，返回 TaskJobData。"""
        now = _now()
        task_id = _gen_id()
        payload_json = json.dumps(inp.payload, ensure_ascii=False)

        with self._lock:
            self._conn.execute(
                """
                INSERT INTO tasks
                    (id, series_id, episode_id, type, queue_type, runtime,
                     target_type, target_id, status, priority, progress,
                     attempt, max_attempts, payload, dedupe_key,
                     queued_at, created_at, updated_at)
                VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                """,
                (
                    task_id, inp.series_id, inp.episode_id,
                    inp.type, inp.queue_type, inp.runtime,
                    inp.target_type, inp.target_id,
                    "queued", inp.priority, 0,
                    0, inp.max_attempts, payload_json, inp.dedupe_key,
                    now, now, now,
                ),
            )
            self._conn.commit()

        return TaskJobData(
            id=task_id,
            series_id=inp.series_id,
            episode_id=inp.episode_id,
            type=inp.type,
            queue_type=inp.queue_type,
            runtime=inp.runtime,
            target_type=inp.target_type,
            target_id=inp.target_id,
            status="queued",
            priority=inp.priority,
            progress=0,
            attempt=0,
            max_attempts=inp.max_attempts,
            payload=inp.payload,
            dedupe_key=inp.dedupe_key,
            queued_at=now,
            created_at=now,
            updated_at=now,
        )

    def get_task(self, task_id: str) -> Optional[TaskJobData]:
        """按 ID 获取任务。"""
        row = self._conn.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not row:
            return None
        return self._row_to_task(row)

    def try_mark_processing(self, task_id: str) -> bool:
        """乐观锁: 仅当 status 为 queued/processing 时标记为 processing。"""
        now = _now()
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE tasks
                SET status = 'processing', attempt = attempt + 1,
                    heartbeat_at = ?, started_at = COALESCE(started_at, ?),
                    updated_at = ?
                WHERE id = ? AND status IN ('queued', 'processing')
                """,
                (now, now, now, task_id),
            )
            self._conn.commit()
            return cur.rowcount > 0

    def try_mark_completed(self, task_id: str, result: dict) -> bool:
        """标记任务为已完成。"""
        now = _now()
        result_json = json.dumps(result, ensure_ascii=False)
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE tasks
                SET status = 'completed', progress = 100,
                    result = ?, finished_at = ?, updated_at = ?
                WHERE id = ? AND status IN ('queued', 'processing')
                """,
                (result_json, now, now, task_id),
            )
            self._conn.commit()
            return cur.rowcount > 0

    def try_mark_failed(self, task_id: str, error_code: str, error_message: str) -> bool:
        """标记任务为失败。"""
        now = _now()
        with self._lock:
            cur = self._conn.execute(
                """
                UPDATE tasks
                SET status = 'failed', error_code = ?, error_message = ?,
                    finished_at = ?, updated_at = ?
                WHERE id = ? AND status IN ('queued', 'processing')
                """,
                (error_code, error_message, now, now, task_id),
            )
            self._conn.commit()
            return cur.rowcount > 0

    def get_attempt(self, task_id: str) -> int:
        """返回当前重试次数。"""
        row = self._conn.execute(
            "SELECT attempt FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        return row["attempt"] if row else 0

    def is_task_active(self, task_id: str) -> bool:
        """任务是否仍在活跃状态 (queued / processing)。"""
        row = self._conn.execute(
            "SELECT status FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        return row["status"] in ("queued", "processing") if row else False

    def find_stale_tasks(self, threshold_seconds: int) -> List[TaskJobData]:
        """查找心跳超时的 processing 任务。"""
        cutoff = (datetime.now() - timedelta(seconds=threshold_seconds)).isoformat()
        rows = self._conn.execute(
            """
            SELECT * FROM tasks
            WHERE status = 'processing' AND heartbeat_at < ?
            """,
            (cutoff,),
        ).fetchall()
        return [self._row_to_task(r) for r in rows]

    def find_tasks(
        self,
        status: Optional[str] = None,
        runtime: Optional[str] = None,
        episode_id: Optional[str] = None,
        external_id_not_null: bool = False,
    ) -> List[TaskJobData]:
        """按条件查找任务。"""
        clauses: list[str] = []
        params: list[Any] = []
        if status:
            clauses.append("status = ?")
            params.append(status)
        if runtime:
            clauses.append("runtime = ?")
            params.append(runtime)
        if episode_id:
            clauses.append("episode_id = ?")
            params.append(episode_id)
        if external_id_not_null:
            clauses.append("external_id IS NOT NULL")

        where = " AND ".join(clauses) if clauses else "1=1"
        rows = self._conn.execute(
            f"SELECT * FROM tasks WHERE {where} ORDER BY priority DESC, queued_at ASC",
            params,
        ).fetchall()
        return [self._row_to_task(r) for r in rows]

    def find_by_dedupe_key(self, key: str) -> Optional[TaskJobData]:
        """按去重键查找活跃任务。"""
        row = self._conn.execute(
            """
            SELECT * FROM tasks
            WHERE dedupe_key = ? AND status IN ('queued', 'processing')
            LIMIT 1
            """,
            (key,),
        ).fetchone()
        return self._row_to_task(row) if row else None

    def set_external_id(self, task_id: str, external_id: str):
        """设置外部服务 ID。"""
        now = _now()
        with self._lock:
            self._conn.execute(
                "UPDATE tasks SET external_id = ?, updated_at = ? WHERE id = ?",
                (external_id, now, task_id),
            )
            self._conn.commit()

    def update_heartbeat(self, task_id: str):
        """更新任务心跳时间。"""
        now = _now()
        with self._lock:
            self._conn.execute(
                "UPDATE tasks SET heartbeat_at = ?, updated_at = ? WHERE id = ?",
                (now, now, task_id),
            )
            self._conn.commit()

    def update_progress(self, task_id: str, progress: int, stage: str = None):
        """更新任务进度和阶段。"""
        now = _now()
        with self._lock:
            if stage is not None:
                self._conn.execute(
                    "UPDATE tasks SET progress = ?, stage = ?, updated_at = ? WHERE id = ?",
                    (progress, stage, now, task_id),
                )
            else:
                self._conn.execute(
                    "UPDATE tasks SET progress = ?, updated_at = ? WHERE id = ?",
                    (progress, now, task_id),
                )
            self._conn.commit()

    # ------------------------------------------------------------------
    # Task Events
    # ------------------------------------------------------------------

    def insert_event(
        self,
        task_id: str,
        event_type: str,
        payload: dict = None,
        episode_id: str = "",
    ) -> TaskEvent:
        """插入任务事件。"""
        now = _now()
        payload_json = json.dumps(payload or {}, ensure_ascii=False)
        with self._lock:
            cur = self._conn.execute(
                """
                INSERT INTO task_events (task_id, episode_id, event_type, payload, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (task_id, episode_id, event_type, payload_json, now),
            )
            self._conn.commit()
            event_id = cur.lastrowid

        return TaskEvent(
            id=event_id,
            task_id=task_id,
            episode_id=episode_id,
            event_type=event_type,
            payload=payload or {},
            created_at=now,
        )

    def list_events_after(self, episode_id: str, after_id: int) -> List[TaskEvent]:
        """列出指定 episode 中 ID 大于 after_id 的事件。"""
        rows = self._conn.execute(
            """
            SELECT * FROM task_events
            WHERE episode_id = ? AND id > ?
            ORDER BY id ASC
            """,
            (episode_id, after_id),
        ).fetchall()
        return [self._row_to_event(r) for r in rows]

    # ------------------------------------------------------------------
    # Pipeline Runs
    # ------------------------------------------------------------------

    def create_pipeline_run(
        self,
        run_id: str,
        series_id: str,
        episode_id: str,
        runtime: str = "studio",
        input_data: dict = None,
    ) -> PipelineRun:
        """创建 pipeline 运行记录。"""
        now = _now()
        input_json = json.dumps(input_data or {}, ensure_ascii=False)
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO pipeline_runs
                    (id, series_id, episode_id, runtime, status,
                     input_json, created_at)
                VALUES (?, ?, ?, ?, 'queued', ?, ?)
                """,
                (run_id, series_id, episode_id, runtime, input_json, now),
            )
            self._conn.commit()

        return PipelineRun(
            id=run_id,
            series_id=series_id,
            episode_id=episode_id,
            runtime=runtime,
            status="queued",
            input_json=input_data or {},
            created_at=now,
        )

    def update_pipeline_run(self, run_id: str, **kwargs):
        """更新 pipeline 运行记录的任意字段。"""
        if not kwargs:
            return
        sets: list[str] = []
        params: list[Any] = []
        for key, val in kwargs.items():
            if key in ("input_json", "output_json") and isinstance(val, dict):
                val = json.dumps(val, ensure_ascii=False)
            sets.append(f"{key} = ?")
            params.append(val)
        params.append(run_id)

        with self._lock:
            self._conn.execute(
                f"UPDATE pipeline_runs SET {', '.join(sets)} WHERE id = ?",
                params,
            )
            self._conn.commit()

    def is_run_canceled(self, run_id: str) -> bool:
        """pipeline 运行是否已取消 (failed / dismissed)。"""
        row = self._conn.execute(
            "SELECT status FROM pipeline_runs WHERE id = ?", (run_id,)
        ).fetchone()
        return row["status"] in ("failed", "dismissed") if row else False

    # ------------------------------------------------------------------
    # Pipeline Steps
    # ------------------------------------------------------------------

    def create_pipeline_step(
        self, step_id: str, run_id: str, step_key: str
    ) -> PipelineStep:
        """创建 pipeline 步骤。"""
        now = _now()
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO pipeline_steps (id, run_id, step_key, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (step_id, run_id, step_key, now),
            )
            self._conn.commit()

        return PipelineStep(
            id=step_id, run_id=run_id, step_key=step_key, created_at=now
        )

    def update_pipeline_step(self, step_id: str, **kwargs):
        """更新 pipeline 步骤的任意字段。"""
        if not kwargs:
            return
        sets: list[str] = []
        params: list[Any] = []
        for key, val in kwargs.items():
            sets.append(f"{key} = ?")
            params.append(val)
        params.append(step_id)

        with self._lock:
            self._conn.execute(
                f"UPDATE pipeline_steps SET {', '.join(sets)} WHERE id = ?",
                params,
            )
            self._conn.commit()

    # ------------------------------------------------------------------
    # Checkpoints
    # ------------------------------------------------------------------

    def save_checkpoint(
        self,
        run_id: str,
        node_key: str,
        version: int,
        state_json: dict,
    ) -> Checkpoint:
        """保存检查点。"""
        now = _now()
        cp_id = _gen_id()
        state_str = json.dumps(state_json, ensure_ascii=False)
        with self._lock:
            self._conn.execute(
                """
                INSERT INTO pipeline_checkpoints
                    (id, run_id, node_key, version, state_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (cp_id, run_id, node_key, version, state_str, now),
            )
            self._conn.commit()

        return Checkpoint(
            id=cp_id,
            run_id=run_id,
            node_key=node_key,
            version=version,
            state_json=state_json,
            created_at=now,
        )

    def load_latest_checkpoint(self, run_id: str) -> Optional[Checkpoint]:
        """加载最新检查点。"""
        row = self._conn.execute(
            """
            SELECT * FROM pipeline_checkpoints
            WHERE run_id = ?
            ORDER BY version DESC, created_at DESC
            LIMIT 1
            """,
            (run_id,),
        ).fetchone()
        if not row:
            return None
        return Checkpoint(
            id=row["id"],
            run_id=row["run_id"],
            node_key=row["node_key"],
            version=row["version"],
            state_json=json.loads(row["state_json"]),
            created_at=row["created_at"],
        )

    # ------------------------------------------------------------------
    # Row → dataclass 转换
    # ------------------------------------------------------------------

    @staticmethod
    def _row_to_task(row: sqlite3.Row) -> TaskJobData:
        return TaskJobData(
            id=row["id"],
            series_id=row["series_id"] or "",
            episode_id=row["episode_id"] or "",
            type=row["type"],
            queue_type=row["queue_type"],
            runtime=row["runtime"] or "studio",
            target_type=row["target_type"],
            target_id=row["target_id"],
            status=row["status"],
            priority=row["priority"] or 0,
            progress=row["progress"] or 0,
            stage=row["stage"],
            attempt=row["attempt"] or 0,
            max_attempts=row["max_attempts"] or 3,
            payload=json.loads(row["payload"] or "{}"),
            result=row["result"],
            error_code=row["error_code"],
            error_message=row["error_message"],
            external_id=row["external_id"],
            dedupe_key=row["dedupe_key"],
            heartbeat_at=row["heartbeat_at"],
            queued_at=row["queued_at"] or "",
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            created_at=row["created_at"] or "",
            updated_at=row["updated_at"] or "",
        )

    @staticmethod
    def _row_to_event(row: sqlite3.Row) -> TaskEvent:
        return TaskEvent(
            id=row["id"],
            task_id=row["task_id"],
            episode_id=row["episode_id"] or "",
            event_type=row["event_type"],
            payload=json.loads(row["payload"] or "{}"),
            created_at=row["created_at"] or "",
        )
