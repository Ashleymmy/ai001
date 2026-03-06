"""孤儿任务回收器 — 定期扫描并回收无主任务

移植 waoowaoo 的孤儿检测逻辑:
- 扫描 status='processing' 但 arq job 已消失的任务
- 扫描 status='processing' 的 pipeline_runs 并检查是否仍有活跃 worker
- 将孤儿标记为 failed + ORPHANED，可被后续请求重新提交
"""
import asyncio
import logging
from datetime import datetime, timedelta
from typing import List

from .storage import TaskStorage
from .event_bus import TaskEventBus

logger = logging.getLogger(__name__)


class OrphanCollector:
    """定期扫描孤儿任务并回收"""

    # 扫描间隔 (秒)
    SWEEP_INTERVAL = 120

    # processing 任务如果超过此时间没有心跳且 arq job 不存在，视为孤儿
    ORPHAN_THRESHOLD_SECONDS = 300

    # 单次扫描最大回收数量，防止批量回收造成突发负载
    MAX_RECLAIM_PER_SWEEP = 50

    def __init__(
        self,
        storage: TaskStorage,
        event_bus: TaskEventBus,
        queue_manager=None,
    ):
        self._storage = storage
        self._event_bus = event_bus
        self._queue = queue_manager
        self._running = False
        self._task: asyncio.Task = None

    async def start(self):
        """启动后台回收循环"""
        self._running = True
        self._task = asyncio.create_task(self._run_forever())
        logger.info("OrphanCollector started (interval=%ds, threshold=%ds)",
                     self.SWEEP_INTERVAL, self.ORPHAN_THRESHOLD_SECONDS)

    async def stop(self):
        """停止后台回收循环"""
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("OrphanCollector stopped")

    async def _run_forever(self):
        while self._running:
            try:
                await asyncio.sleep(self.SWEEP_INTERVAL)
                reclaimed = await self.sweep()
                if reclaimed > 0:
                    logger.info(f"OrphanCollector reclaimed {reclaimed} orphan tasks")
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"OrphanCollector sweep error: {e}")

    async def sweep(self) -> int:
        """执行一次孤儿扫描，返回回收数量"""
        reclaimed = 0

        # 1. 扫描心跳超时的 processing 任务
        stale_tasks = self._storage.find_stale_tasks(self.ORPHAN_THRESHOLD_SECONDS)
        for task in stale_tasks[:self.MAX_RECLAIM_PER_SWEEP]:
            is_orphan = await self._confirm_orphan(task.id)
            if is_orphan:
                self._storage.try_mark_failed(task.id, "ORPHANED", "孤儿任务回收: 心跳超时且 worker 不存在")
                await self._event_bus.publish_lifecycle(
                    task.id, "failed",
                    payload={"error_code": "ORPHANED", "error_message": "孤儿任务回收"},
                    episode_id=task.episode_id,
                )
                logger.warning(f"Orphan task reclaimed: {task.id} (type={task.type}, episode={task.episode_id})")
                reclaimed += 1

        # 2. 扫描卡住的 pipeline_runs
        reclaimed += await self._sweep_pipeline_runs()

        return reclaimed

    async def _confirm_orphan(self, task_id: str) -> bool:
        """确认任务是否为孤儿 (arq job 不存在)

        如果没有 queue_manager (studio 内存模式)，
        则仅依赖心跳超时判定 (已由 find_stale_tasks 过滤)。
        """
        if not self._queue:
            # 无 arq — 心跳超时即视为孤儿
            return True

        try:
            from arq.jobs import Job
            job = Job(task_id, self._queue.pool)
            info = await job.info()
            if info is None:
                return True  # job 不存在 -> 孤儿
            return False
        except Exception:
            # 查询失败 — 保守起见不回收
            return False

    async def _sweep_pipeline_runs(self) -> int:
        """扫描卡住的 pipeline_runs: processing 超时且无活跃步骤"""
        reclaimed = 0
        cutoff = (datetime.now() - timedelta(seconds=self.ORPHAN_THRESHOLD_SECONDS)).isoformat()

        try:
            rows = self._storage._conn.execute(
                """
                SELECT id, episode_id FROM pipeline_runs
                WHERE status = 'processing'
                  AND started_at < ?
                  AND started_at IS NOT NULL
                """,
                (cutoff,),
            ).fetchall()
        except Exception:
            return 0

        for row in rows[:self.MAX_RECLAIM_PER_SWEEP]:
            run_id = row["id"]
            episode_id = row["episode_id"] or ""

            # 检查是否还有活跃的 processing 步骤
            active_steps = self._storage._conn.execute(
                "SELECT COUNT(*) as cnt FROM pipeline_steps WHERE run_id = ? AND status = 'processing'",
                (run_id,),
            ).fetchone()

            if active_steps and active_steps["cnt"] > 0:
                continue  # 仍有活跃步骤，不回收

            self._storage.update_pipeline_run(
                run_id,
                status="failed",
                error_code="ORPHANED",
                error_message="管线运行超时且无活跃步骤，已回收",
                finished_at=datetime.now().isoformat(),
            )
            await self._event_bus.publish_run_event(
                run_id, "run.failed", episode_id=episode_id,
            )
            logger.warning(f"Orphan pipeline run reclaimed: {run_id}")
            reclaimed += 1

        return reclaimed
