"""统一任务提交入口"""
import logging
from typing import Tuple, Optional

from .types import TaskJobData, CreateTaskInput
from .storage import TaskStorage
from .event_bus import TaskEventBus
from .queue_manager import QueueManager

logger = logging.getLogger(__name__)


class TaskSubmitter:
    def __init__(self, storage: TaskStorage, event_bus: TaskEventBus, queue_manager: Optional[QueueManager] = None):
        self._storage = storage
        self._event_bus = event_bus
        self._queue = queue_manager

    async def submit_task(self, input: CreateTaskInput) -> Tuple[TaskJobData, bool]:
        """
        提交任务。返回 (task, is_deduped)。
        如果 dedupe_key 命中活跃任务则去重返回已有任务。
        """
        # 去重检查
        if input.dedupe_key:
            existing = self._storage.find_by_dedupe_key(input.dedupe_key)
            if existing:
                # 检查 arq job 是否存活
                if self._queue and await self._is_arq_job_alive(existing.id):
                    logger.info(f"Task deduped: {existing.id} (key={input.dedupe_key})")
                    return existing, True
                # 孤儿回收
                self._storage.try_mark_failed(existing.id, "ORPHANED", "孤儿任务回收")
                logger.warning(f"Orphan task recycled: {existing.id}")

        # 创建新任务
        task = self._storage.create_task(input)

        # 入队 arq
        if self._queue:
            try:
                await self._queue.enqueue(task.id)
            except Exception as e:
                logger.error(f"Failed to enqueue task {task.id}: {e}")
                self._storage.try_mark_failed(task.id, "INTERNAL_ERROR", f"入队失败: {e}")
                raise

        # 发布 created 事件
        await self._event_bus.publish_lifecycle(task.id, "created", episode_id=task.episode_id)
        logger.info(f"Task submitted: {task.id} (type={task.type}, queue={task.queue_type})")
        return task, False

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
