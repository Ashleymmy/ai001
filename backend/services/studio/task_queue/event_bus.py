"""任务事件总线 — 内进程 asyncio.Queue + 可选 Redis pub/sub"""
import asyncio
import json
import logging
from typing import Dict, List, Optional, Any

from .storage import TaskStorage
from .types import TaskEvent

logger = logging.getLogger(__name__)


class TaskEventBus:
    """
    双通道事件总线:
    - 内进程: asyncio.Queue subscribers (SSE 推送用)
    - 外进程: Redis pub/sub (可选, 多 worker 场景)
    """

    def __init__(self, storage: TaskStorage, redis_client=None):
        self._storage = storage
        self._redis = redis_client
        # episode_id -> list of asyncio.Queue
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}

    def subscribe(self, episode_id: str) -> asyncio.Queue:
        """订阅某个 episode 的事件流"""
        q: asyncio.Queue = asyncio.Queue()
        if episode_id not in self._subscribers:
            self._subscribers[episode_id] = []
        self._subscribers[episode_id].append(q)
        return q

    def unsubscribe(self, episode_id: str, queue: asyncio.Queue):
        """取消订阅"""
        subs = self._subscribers.get(episode_id, [])
        if queue in subs:
            subs.remove(queue)
        if not subs:
            self._subscribers.pop(episode_id, None)

    async def publish_lifecycle(
        self,
        task_id: str,
        event_type: str,
        payload: Optional[Dict[str, Any]] = None,
        episode_id: str = "",
    ):
        """发布任务生命周期事件"""
        # 持久化到 SQLite
        event = self._storage.insert_event(task_id, event_type, payload or {}, episode_id)

        # 内进程推送
        for q in self._subscribers.get(episode_id, []):
            try:
                await q.put(event)
            except Exception:
                pass

        # Redis pub/sub
        if self._redis:
            try:
                channel = f"task-events:{episode_id}"
                data = json.dumps({
                    "id": event.id,
                    "task_id": event.task_id,
                    "episode_id": event.episode_id,
                    "event_type": event.event_type,
                    "payload": event.payload,
                    "created_at": event.created_at,
                }, ensure_ascii=False)
                await self._redis.publish(channel, data)
            except Exception as e:
                logger.warning(f"Redis publish failed: {e}")

    async def publish_run_event(
        self,
        run_id: str,
        event_type: str,
        node_key: str = "",
        attempt: int = 0,
        episode_id: str = "",
    ):
        """发布管线运行事件"""
        payload = {"run_id": run_id, "node_key": node_key, "attempt": attempt}
        await self.publish_lifecycle(run_id, event_type, payload, episode_id)

    async def replay_after(self, episode_id: str, after_id: int) -> List[TaskEvent]:
        """重放指定 episode 中 ID > after_id 的事件 (SSE 重连用)"""
        return self._storage.list_events_after(episode_id, after_id)
