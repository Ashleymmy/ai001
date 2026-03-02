"""外部 API 断点续传 — 轮询恢复工具"""
import asyncio
import logging
import time
from typing import Callable, Awaitable, Any, Optional

from .storage import TaskStorage

logger = logging.getLogger(__name__)


class TaskTerminatedError(Exception):
    """任务已被取消或终止"""
    pass


class ExternalGenerationError(Exception):
    """外部生成服务返回失败"""
    def __init__(self, message: str, external_id: str = ""):
        super().__init__(message)
        self.external_id = external_id


class GenerationTimeoutError(Exception):
    """生成超时"""
    pass


async def wait_external_result(
    task_id: str,
    external_id: str,
    poll_fn: Callable[[str], Awaitable[Any]],
    storage: TaskStorage,
    interval: float = 3.0,
    timeout: float = 1200.0,
) -> Any:
    """
    轮询外部 API 直到完成或超时。

    Args:
        task_id: 内部任务 ID
        external_id: 外部 API 任务 ID
        poll_fn: 轮询函数，接收 external_id，返回带 status 属性的结果
        storage: 任务存储
        interval: 轮询间隔（秒）
        timeout: 总超时（秒）
    """
    start = time.time()
    while time.time() - start < timeout:
        # 检查任务是否已取消
        if not storage.is_task_active(task_id):
            raise TaskTerminatedError(f"Task {task_id} terminated")

        try:
            result = await poll_fn(external_id)
        except Exception as e:
            logger.warning(f"Poll error for {external_id}: {e}")
            await asyncio.sleep(interval)
            continue

        if hasattr(result, 'status'):
            status = result.status
        elif isinstance(result, dict):
            status = result.get('status', '')
        else:
            status = str(result)

        if status in ('completed', 'succeed'):
            return result
        if status in ('failed', 'error'):
            msg = getattr(result, 'error', None) or (result.get('error', '') if isinstance(result, dict) else str(result))
            raise ExternalGenerationError(str(msg), external_id)

        # 更新心跳
        storage.update_heartbeat(task_id)
        await asyncio.sleep(interval)

    raise GenerationTimeoutError(f"External task {external_id} timed out after {timeout}s")


async def resume_interrupted_tasks(
    storage: TaskStorage,
    poll_fn_factory: Callable[[str], Callable],
    on_complete: Optional[Callable] = None,
    on_fail: Optional[Callable] = None,
):
    """
    服务启动时恢复中断的外部任务。
    扫描 status='processing' 且 external_id 非空的任务，重新启动轮询。
    """
    interrupted = storage.find_tasks(status='processing', external_id_not_null=True)
    if not interrupted:
        return

    logger.info(f"Found {len(interrupted)} interrupted external tasks to resume")

    for task in interrupted:
        if not task.external_id:
            continue

        async def _resume(t=task):
            try:
                poll_fn = poll_fn_factory(t.type)
                result = await wait_external_result(
                    task_id=t.id,
                    external_id=t.external_id,
                    poll_fn=poll_fn,
                    storage=storage,
                )
                storage.try_mark_completed(t.id, {"external_result": str(result)})
                if on_complete:
                    await on_complete(t, result)
                logger.info(f"Resumed task {t.id} completed")
            except Exception as e:
                storage.try_mark_failed(t.id, "EXTERNAL_ERROR", str(e))
                if on_fail:
                    await on_fail(t, e)
                logger.error(f"Resumed task {t.id} failed: {e}")

        asyncio.create_task(_resume())
