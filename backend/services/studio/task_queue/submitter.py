from __future__ import annotations

"""统一任务提交入口"""
import logging
from datetime import datetime, timedelta
from typing import Tuple, Optional, TYPE_CHECKING

from .types import TaskJobData, CreateTaskInput
from .storage import TaskStorage
from .event_bus import TaskEventBus
from .dedupe import build_dedupe_key, check_dedupe_with_arq

if TYPE_CHECKING:
    from .queue_manager import QueueManager

logger = logging.getLogger(__name__)


class TaskSubmitter:
    def __init__(self, storage: TaskStorage, event_bus: TaskEventBus, queue_manager: Optional["QueueManager"] = None):
        self._storage = storage
        self._event_bus = event_bus
        self._queue = queue_manager

    async def submit_task(self, input: CreateTaskInput) -> Tuple[TaskJobData, bool]:
        """
        提交任务。返回 (task, is_deduped)。
        如果 dedupe_key 命中活跃任务则去重返回已有任务。
        """
        # 自动生成 dedupe_key (如果未提供)
        dedupe_key = build_dedupe_key(input)
        input.dedupe_key = dedupe_key

        # 去重检查
        if dedupe_key:
            existing = self._storage.find_by_dedupe_key(dedupe_key)
            if existing:
                # 检查 arq job 是否存活
                if self._queue and await self._is_arq_job_alive(existing.id):
                    logger.info(f"Task deduped: {existing.id} (key={dedupe_key})")
                    return existing, True
                # 孤儿回收：标记旧任务失败，创建新任务
                self._storage.try_mark_failed(existing.id, "ORPHANED", "孤儿任务回收 - arq job 不存在")
                await self._event_bus.publish_lifecycle(existing.id, "failed",
                    payload={"error_code": "ORPHANED", "error_message": "孤儿任务回收"},
                    episode_id=existing.episode_id)
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

    async def cleanup_orphaned_tasks(self, max_age_hours: int = 24) -> int:
        """清理超过指定时间的孤儿任务（status=processing 但无活跃 arq job）"""
        cutoff = (datetime.now() - timedelta(hours=max_age_hours)).isoformat()
        processing_tasks = self._storage.find_tasks(status='processing')
        cleaned = 0

        for task in processing_tasks:
            if task.created_at > cutoff:
                continue  # 太新，跳过

            if self._queue and await self._is_arq_job_alive(task.id):
                continue  # arq job 还活着

            # 标记为孤儿失败
            self._storage.try_mark_failed(task.id, "ORPHANED", "批量孤儿清理")
            await self._event_bus.publish_lifecycle(task.id, "failed",
                payload={"error_code": "ORPHANED"},
                episode_id=task.episode_id)
            cleaned += 1

        if cleaned:
            logger.info(f"Cleaned up {cleaned} orphaned tasks")
        return cleaned

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
