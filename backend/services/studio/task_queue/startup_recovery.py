"""启动时自动恢复 — 扫描中断任务并重新入队"""
import logging
from typing import Optional

from .storage import TaskStorage
from .event_bus import TaskEventBus
from .queue_manager import QueueManager

logger = logging.getLogger(__name__)


class StartupRecovery:
    """
    Worker 启动时自动恢复中断的任务。

    场景:
    - Worker 崩溃/重启后，部分任务处于 processing 但无心跳
    - 部分任务处于 queued 但未被 arq 消费 (arq 队列丢失)
    - 持有 external_id 的任务需要恢复轮询

    策略:
    1. processing 且心跳过期 → 重置为 queued 并重新入队
    2. queued 且已创建超过阈值 → 重新入队 (补偿 arq 丢失)
    3. processing 且持有 external_id → 保留 processing (由 ExternalTaskPoller 继续跟踪)
    """

    STALE_THRESHOLD = 120  # 秒，与 watchdog 一致

    def __init__(
        self,
        storage: TaskStorage,
        event_bus: TaskEventBus,
        queue_manager: Optional[QueueManager] = None,
    ):
        self._storage = storage
        self._event_bus = event_bus
        self._queue = queue_manager

    async def recover(self) -> dict:
        """
        执行一次恢复扫描。返回统计信息。

        Returns:
            {"requeued": int, "kept_polling": int, "failed": int}
        """
        stats = {"requeued": 0, "kept_polling": 0, "failed": 0}

        # 1. 恢复 stale processing 任务
        stale_tasks = self._storage.find_stale_tasks(self.STALE_THRESHOLD)
        for task in stale_tasks:
            if task.external_id:
                # 持有 external_id — 保留，由 poller 跟踪
                # 刷新心跳防止被 watchdog 杀死
                self._storage.update_heartbeat(task.id)
                stats["kept_polling"] += 1
                logger.info(f"Recovery: kept polling task {task.id} (ext={task.external_id})")
            else:
                # 无 external_id — 重置为 queued 并重新入队
                success = await self._requeue_task(task.id)
                if success:
                    stats["requeued"] += 1
                else:
                    stats["failed"] += 1

        # 2. 恢复孤立的 queued 任务 (可能 arq job 丢失)
        queued_tasks = self._storage.find_tasks(status="queued")
        for task in queued_tasks:
            if self._queue:
                alive = await self._is_arq_job_alive(task.id)
                if not alive:
                    success = await self._requeue_task(task.id, reset_status=False)
                    if success:
                        stats["requeued"] += 1
                    else:
                        stats["failed"] += 1

        if any(v > 0 for v in stats.values()):
            logger.info(f"Startup recovery complete: {stats}")
        else:
            logger.info("Startup recovery: no interrupted tasks found")

        return stats

    async def _requeue_task(self, task_id: str, reset_status: bool = True) -> bool:
        """重置任务状态并重新入队 arq"""
        try:
            if reset_status:
                self._storage.reset_to_queued(task_id)

            if self._queue:
                await self._queue.enqueue(task_id)

            await self._event_bus.publish_lifecycle(
                task_id, "requeued",
                payload={"reason": "startup_recovery"},
                episode_id=self._get_episode_id(task_id),
            )
            logger.info(f"Recovery: requeued task {task_id}")
            return True
        except Exception as e:
            logger.error(f"Recovery: failed to requeue task {task_id}: {e}")
            return False

    async def _is_arq_job_alive(self, job_id: str) -> bool:
        """检查 arq job 是否仍在队列中"""
        if not self._queue:
            return False
        try:
            from arq.jobs import Job
            job = Job(job_id, self._queue.pool)
            info = await job.info()
            return info is not None
        except Exception:
            return False

    def _get_episode_id(self, task_id: str) -> str:
        """获取任务的 episode_id"""
        task = self._storage.get_task(task_id)
        return task.episode_id if task else ""
