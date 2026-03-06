"""外部任务轮询器 — 定期检查 external_id 任务状态并恢复"""
import asyncio
import logging
from typing import Callable, Awaitable, Dict, Optional, Any

from .storage import TaskStorage
from .event_bus import TaskEventBus

logger = logging.getLogger(__name__)


class ExternalTaskPoller:
    """
    定期轮询持有 external_id 的 processing 任务，
    向外部服务查询状态并据此更新本地任务。

    用于异步外部服务 (如图片/视频/语音生成 API) 的断点续传:
    - 提交时保存 external_id (第三方任务 ID)
    - 本轮询器周期性检查这些外部任务是否已完成
    - 若已完成则标记本地任务 completed
    - 若外部任务失败则标记本地任务 failed
    """

    POLL_INTERVAL = 15  # 秒

    def __init__(
        self,
        storage: TaskStorage,
        event_bus: TaskEventBus,
        poll_fn: Optional[Callable[[str, str, Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None,
    ):
        """
        Args:
            storage: 任务存储
            event_bus: 事件总线
            poll_fn: 轮询回调 — async fn(task_type, external_id, payload) -> {
                "status": "completed" | "failed" | "processing",
                "result": {...},       # status=completed 时
                "error_code": "...",   # status=failed 时
                "error_message": "...",
                "progress": 50,        # 可选, 0-100
            }
        """
        self._storage = storage
        self._event_bus = event_bus
        self._poll_fn = poll_fn
        self._running = False
        self._task: Optional[asyncio.Task] = None

    async def start(self):
        if not self._poll_fn:
            logger.info("ExternalTaskPoller: no poll_fn configured, skipping start")
            return
        self._running = True
        self._task = asyncio.create_task(self._run_forever())
        logger.info("ExternalTaskPoller started")

    async def stop(self):
        self._running = False
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
        logger.info("ExternalTaskPoller stopped")

    async def _run_forever(self):
        while self._running:
            try:
                await asyncio.sleep(self.POLL_INTERVAL)
                await self._poll_cycle()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"ExternalTaskPoller cycle error: {e}")

    async def _poll_cycle(self):
        """一次轮询周期: 查找所有持有 external_id 的 processing 任务并检查"""
        tasks = self._storage.find_tasks(
            status="processing",
            external_id_not_null=True,
        )
        if not tasks:
            return

        logger.debug(f"ExternalTaskPoller: checking {len(tasks)} tasks with external_id")

        for task in tasks:
            try:
                await self._poll_single(task)
            except Exception as e:
                logger.warning(f"ExternalTaskPoller: error polling task {task.id}: {e}")

    async def _poll_single(self, task):
        """轮询单个外部任务"""
        if not self._poll_fn or not task.external_id:
            return

        try:
            result = await self._poll_fn(task.type, task.external_id, task.payload)
        except Exception as e:
            logger.warning(f"Poll fn error for task {task.id} (ext={task.external_id}): {e}")
            return

        if not result or not isinstance(result, dict):
            return

        status = result.get("status", "processing")

        # 更新进度 (如果提供)
        progress = result.get("progress")
        if progress is not None and isinstance(progress, int):
            self._storage.update_progress(task.id, progress)

        # 更新心跳 (证明轮询器在关注这个任务)
        self._storage.update_heartbeat(task.id)

        if status == "completed":
            task_result = result.get("result", {})
            self._storage.try_mark_completed(task.id, task_result)
            await self._event_bus.publish_lifecycle(
                task.id, "completed",
                payload=task_result,
                episode_id=task.episode_id,
            )
            logger.info(f"External task completed: {task.id} (ext={task.external_id})")

        elif status == "failed":
            error_code = result.get("error_code", "EXTERNAL_ERROR")
            error_message = result.get("error_message", "外部任务失败")
            self._storage.try_mark_failed(task.id, error_code, error_message)
            await self._event_bus.publish_lifecycle(
                task.id, "failed",
                payload={"error_code": error_code, "error_message": error_message},
                episode_id=task.episode_id,
            )
            logger.warning(f"External task failed: {task.id} (ext={task.external_id}): {error_code}")
