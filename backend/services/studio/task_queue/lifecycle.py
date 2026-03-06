"""任务生命周期包装器 — 移植 waoowaoo 的 withTaskLifecycle"""
import asyncio
import logging
from typing import Callable, Awaitable

from ..errors import normalize_error
from .storage import TaskStorage
from .event_bus import TaskEventBus

logger = logging.getLogger(__name__)

HEARTBEAT_INTERVAL = 10  # 秒


class ExternalHandoff(Exception):
    """
    Handler 抛出此异常表示任务已提交到外部服务，
    external_id 已通过 storage.set_external_id() 持久化。
    lifecycle 不标记完成/失败，而是保持 processing 状态，
    由 ExternalTaskPoller 轮询外部服务完成状态。
    """
    pass


async def _heartbeat_loop(task_id: str, storage: TaskStorage):
    """定时更新心跳"""
    while True:
        await asyncio.sleep(HEARTBEAT_INTERVAL)
        try:
            storage.update_heartbeat(task_id)
        except Exception as e:
            logger.warning(f"Heartbeat update failed for {task_id}: {e}")


async def with_task_lifecycle(
    task_id: str,
    handler_fn: Callable[[], Awaitable],
    storage: TaskStorage,
    event_bus: TaskEventBus,
):
    """
    任务生命周期包装:
    1. 乐观标记 processing
    2. 启动心跳
    3. 执行 handler
    4. 标记完成/失败
    5. 支持 ExternalHandoff — handler 提交外部服务后挂起，由 poller 接管
    """
    # 1. 乐观标记
    if not storage.try_mark_processing(task_id):
        logger.info(f"Task {task_id} already processed or canceled, skipping")
        return

    # 2. 心跳
    heartbeat_task = asyncio.create_task(_heartbeat_loop(task_id, storage))

    try:
        # 3. 发布 processing 事件
        task = storage.get_task(task_id)
        episode_id = task.episode_id if task else ""
        await event_bus.publish_lifecycle(task_id, "processing", episode_id=episode_id)

        # 4. 执行 handler
        result = await handler_fn()

        # 5. 标记完成
        storage.try_mark_completed(task_id, result or {})
        await event_bus.publish_lifecycle(task_id, "completed", payload=result, episode_id=episode_id)
        logger.info(f"Task {task_id} completed")

    except ExternalHandoff:
        # Handler 已提交外部服务并设置了 external_id
        # 保持 processing 状态，由 ExternalTaskPoller 接管
        await event_bus.publish_lifecycle(task_id, "external_handoff",
            payload={"external_id": storage.get_task(task_id).external_id if storage.get_task(task_id) else ""},
            episode_id=episode_id)
        logger.info(f"Task {task_id} handed off to external service, poller will track completion")

    except Exception as exc:
        normalized = normalize_error(exc)
        task = storage.get_task(task_id)
        max_attempts = task.max_attempts if task else 3
        current_attempt = storage.get_attempt(task_id)

        if normalized.entry.retryable and current_attempt < max_attempts:
            # 可重试 — 让 arq 自动重试
            await event_bus.publish_lifecycle(task_id, "retry",
                payload={"error_code": normalized.code, "attempt": current_attempt},
                episode_id=episode_id)
            logger.warning(f"Task {task_id} failed (attempt {current_attempt}/{max_attempts}), will retry: {normalized.code}")
            raise  # arq catches and retries
        else:
            # 不可重试或达到上限
            storage.try_mark_failed(task_id, normalized.code, str(exc))
            await event_bus.publish_lifecycle(task_id, "failed",
                payload={"error_code": normalized.code, "error_message": str(exc)},
                episode_id=episode_id)
            logger.error(f"Task {task_id} failed permanently: {normalized.code}: {exc}")
    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
