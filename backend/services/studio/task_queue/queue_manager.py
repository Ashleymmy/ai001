"""arq Worker 配置与任务分发"""
import asyncio
import logging
from typing import Optional
from arq import create_pool
from arq.connections import RedisSettings, ArqRedis

logger = logging.getLogger(__name__)

# 4 类队列并发控制 (通过 Semaphore)
QUEUE_CONCURRENCY = {
    "image": 3,
    "video": 2,
    "voice": 2,
    "text": 4,
}

_semaphores: dict[str, asyncio.Semaphore] = {}

def _get_semaphore(queue_type: str) -> asyncio.Semaphore:
    if queue_type not in _semaphores:
        limit = QUEUE_CONCURRENCY.get(queue_type, 2)
        _semaphores[queue_type] = asyncio.Semaphore(limit)
    return _semaphores[queue_type]

async def process_task(ctx: dict, task_id: str):
    """arq 任务入口 — 根据 task_type 分发到对应 handler"""
    from .lifecycle import with_task_lifecycle
    from .storage import TaskStorage
    from .event_bus import TaskEventBus
    from .handlers import get_handler

    storage: TaskStorage = ctx.get("storage")
    event_bus: TaskEventBus = ctx.get("event_bus")

    task = storage.get_task(task_id)
    if not task:
        logger.warning(f"Task {task_id} not found, skipping")
        return

    handler = get_handler(task.type)
    sem = _get_semaphore(task.queue_type)

    async with sem:
        await with_task_lifecycle(
            task_id=task_id,
            handler_fn=lambda: handler(task, ctx),
            storage=storage,
            event_bus=event_bus,
        )


class QueueManager:
    """管理 arq 连接池"""

    def __init__(self, redis_settings: Optional[RedisSettings] = None):
        self.redis_settings = redis_settings or RedisSettings(host='localhost', port=6379)
        self._pool: Optional[ArqRedis] = None

    async def connect(self):
        self._pool = await create_pool(self.redis_settings)
        logger.info("arq Redis pool connected")

    async def close(self):
        if self._pool:
            await self._pool.close()

    @property
    def pool(self) -> ArqRedis:
        if not self._pool:
            raise RuntimeError("QueueManager not connected")
        return self._pool

    async def enqueue(self, task_id: str, **kwargs):
        await self.pool.enqueue_job("process_task", task_id=task_id, _job_id=task_id, **kwargs)


class WorkerSettings:
    """arq Worker 配置 — 传给 arq worker CLI"""
    redis_settings = RedisSettings(host='localhost', port=6379)
    functions = [process_task]
    max_jobs = 10
    job_timeout = 600  # 10 min
    retry_jobs = True
    max_tries = 5

    @staticmethod
    async def on_startup(ctx: dict):
        from .storage import TaskStorage
        from .event_bus import TaskEventBus
        import os

        db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "data", "task_queue.db")
        storage = TaskStorage(db_path)
        ctx["storage"] = storage
        ctx["event_bus"] = TaskEventBus(storage)
        logger.info("arq worker started")

    @staticmethod
    async def on_shutdown(ctx: dict):
        storage = ctx.get("storage")
        if storage:
            storage.close()
        logger.info("arq worker shutdown")
