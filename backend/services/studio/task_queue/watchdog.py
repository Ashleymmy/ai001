"""任务心跳看门狗 — 检测僵死任务并标记失败"""
import asyncio
import logging

from .storage import TaskStorage
from .event_bus import TaskEventBus

logger = logging.getLogger(__name__)


class TaskWatchdog:
    SWEEP_INTERVAL = 60    # 秒
    STALE_THRESHOLD = 120  # 秒

    def __init__(self, storage: TaskStorage, event_bus: TaskEventBus):
        self._storage = storage
        self._event_bus = event_bus
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
            self._storage.try_mark_failed(task.id, "WATCHDOG_TIMEOUT", "任务心跳超时")
            await self._event_bus.publish_lifecycle(
                task.id, "failed",
                payload={"error_code": "WATCHDOG_TIMEOUT", "error_message": "任务心跳超时"},
                episode_id=task.episode_id,
            )
            logger.warning(f"Marked stale task {task.id} as failed (WATCHDOG_TIMEOUT)")
