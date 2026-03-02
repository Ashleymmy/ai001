"""任务心跳看门狗 — 检测僵死任务并标记失败"""
import asyncio
import logging

from .storage import TaskStorage
from .event_bus import TaskEventBus

logger = logging.getLogger(__name__)


class TaskWatchdog:
    SWEEP_INTERVAL = 60    # 秒
    STALE_THRESHOLD = 120  # 秒

    def __init__(self, storage: TaskStorage, event_bus: TaskEventBus, queue_manager=None):
        self._storage = storage
        self._event_bus = event_bus
        self._queue = queue_manager
        self._running = False
        self._task: asyncio.Task = None

    async def start(self):
        self._running = True
        self._task = asyncio.create_task(self._run_forever())
        logger.info("TaskWatchdog started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("TaskWatchdog stopped")

    async def _run_forever(self):
        while self._running:
            try:
                await asyncio.sleep(self.SWEEP_INTERVAL)
                await self._sweep()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Watchdog sweep error: {e}")

    async def _sweep(self):
        stale = self._storage.find_stale_tasks(self.STALE_THRESHOLD)
        if stale:
            logger.warning(f"Found {len(stale)} stale tasks")
        for task in stale:
            # 如果有 arq queue_manager，先检查 job 是否仍然存活
            if self._queue and await self._is_arq_job_alive(task.id):
                # job 仍存活但心跳超时 — 可能只是心跳延迟，跳过
                logger.info(f"Task {task.id} stale heartbeat but arq job alive, skipping")
                continue

            error_code = "ORPHANED" if self._queue else "WATCHDOG_TIMEOUT"
            error_msg = "孤儿任务回收 - arq job 不存在" if self._queue else "任务心跳超时"

            self._storage.try_mark_failed(task.id, error_code, error_msg)
            await self._event_bus.publish_lifecycle(
                task.id, "failed",
                payload={"error_code": error_code, "error_message": error_msg},
                episode_id=task.episode_id,
            )
            logger.warning(f"Marked stale task {task.id} as failed ({error_code})")

    async def _is_arq_job_alive(self, job_id: str) -> bool:
        """检查 arq job 是否仍在队列中或正在执行"""
        if not self._queue:
            return False
        try:
            from arq.jobs import Job, JobStatus
            job = Job(job_id, self._queue.pool)
            info = await job.info()
            if info is None:
                return False
            return info.status in (JobStatus.queued, JobStatus.in_progress, JobStatus.deferred)
        except Exception as e:
            logger.warning(f"Failed to check arq job {job_id}: {e}")
            return False
