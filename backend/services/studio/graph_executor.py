"""
图执行器 — 管线持久化与恢复
移植 waoowaoo 的 graph-executor.ts，增强现有 AgentPipeline。
"""
import asyncio
import random
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable, Dict, List, Optional

from .errors import normalize_error
from .task_queue.storage import TaskStorage
from .task_queue.event_bus import TaskEventBus

logger = logging.getLogger(__name__)


class PipelineCancellationError(Exception):
    """管线被取消"""
    pass


@dataclass
class NodeResult:
    """单个节点执行结果"""
    checkpoint_refs: Dict[str, Any] = field(default_factory=dict)
    output: Any = None


@dataclass
class PipelineState:
    """管线全局状态，在节点间传递"""
    refs: Dict[str, Any] = field(default_factory=dict)   # 产出引用 (scriptId, storyboardId 等)
    meta: Dict[str, Any] = field(default_factory=dict)   # 元数据


@dataclass
class GraphNodeContext:
    """传给每个节点的上下文"""
    state: PipelineState
    run_id: str
    node_key: str
    attempt: int
    storage: TaskStorage
    event_bus: TaskEventBus


@dataclass
class GraphNode:
    """管线图中的一个节点"""
    key: str                    # 阶段标识，如 'world_building'
    title: str                  # 显示名，如 '世界观构建'
    max_attempts: int = 2
    timeout_s: float = 300      # 5 分钟超时
    run: Callable[[GraphNodeContext], Awaitable[NodeResult]] = None


async def execute_pipeline_graph(
    run_id: str,
    nodes: List[GraphNode],
    storage: TaskStorage,
    event_bus: TaskEventBus,
    episode_id: str = "",
    resume_from: Optional[str] = None,
) -> PipelineState:
    """
    执行管线图。

    Args:
        run_id: 管线运行 ID
        nodes: 有序节点列表
        storage: 任务存储
        event_bus: 事件总线
        episode_id: 关联分幕 ID
        resume_from: 从指定节点恢复 (跳过之前的节点)

    Returns:
        最终管线状态
    """
    state = PipelineState()

    # 尝试从检查点恢复
    if resume_from:
        checkpoint = storage.load_latest_checkpoint(run_id)
        if checkpoint:
            state.refs = checkpoint.state_json.get("refs", {})
            state.meta = checkpoint.state_json.get("meta", {})
            logger.info(f"Pipeline {run_id} resumed from checkpoint at {checkpoint.node_key}")

    # 确定起始节点
    start_index = 0
    if resume_from:
        for i, node in enumerate(nodes):
            if node.key == resume_from:
                start_index = i
                break

    # 更新运行状态
    storage.update_pipeline_run(run_id, status="processing", started_at=_now())

    for i in range(start_index, len(nodes)):
        node = nodes[i]

        # 检查取消
        if storage.is_run_canceled(run_id):
            logger.info(f"Pipeline {run_id} canceled at node {node.key}")
            raise PipelineCancellationError(f"Pipeline canceled at {node.key}")

        # 更新当前阶段
        storage.update_pipeline_run(run_id, current_stage=node.key)

        # 创建/获取步骤记录
        step_id = f"{run_id}_{node.key}"
        try:
            storage.create_pipeline_step(step_id, run_id, node.key)
        except Exception:
            pass  # 可能已存在 (恢复场景)

        last_error = None
        for attempt in range(1, node.max_attempts + 1):
            try:
                # 发布 step.start
                await event_bus.publish_run_event(
                    run_id, "step.start", node.key, attempt, episode_id
                )
                storage.update_pipeline_step(step_id, status="processing", attempt=attempt, started_at=_now())

                # 创建上下文
                ctx = GraphNodeContext(
                    state=state,
                    run_id=run_id,
                    node_key=node.key,
                    attempt=attempt,
                    storage=storage,
                    event_bus=event_bus,
                )

                # 执行节点 (带超时)
                result = await asyncio.wait_for(
                    node.run(ctx),
                    timeout=node.timeout_s,
                )

                # 合并状态
                if result and result.checkpoint_refs:
                    state.refs.update(result.checkpoint_refs)

                # 持久化检查点
                storage.save_checkpoint(
                    run_id, node.key, attempt,
                    {"refs": state.refs, "meta": state.meta}
                )

                # 标记步骤完成
                storage.update_pipeline_step(step_id, status="completed", finished_at=_now())

                # 发布 step.complete
                await event_bus.publish_run_event(
                    run_id, "step.complete", node.key, attempt, episode_id
                )

                logger.info(f"Pipeline {run_id} node {node.key} completed (attempt {attempt})")
                break  # 成功，跳出重试循环

            except asyncio.TimeoutError:
                last_error = asyncio.TimeoutError(f"Node {node.key} timed out after {node.timeout_s}s")
                logger.warning(f"Pipeline {run_id} node {node.key} timeout (attempt {attempt}/{node.max_attempts})")
                if attempt < node.max_attempts:
                    delay = min(1.0 * (2 ** attempt), 10.0)
                    await asyncio.sleep(delay)

            except PipelineCancellationError:
                raise

            except Exception as exc:
                last_error = exc
                normalized = normalize_error(exc)
                logger.warning(
                    f"Pipeline {run_id} node {node.key} error (attempt {attempt}/{node.max_attempts}): "
                    f"{normalized.code}: {exc}"
                )

                if not normalized.entry.retryable or attempt >= node.max_attempts:
                    # 不可重试或达到上限
                    storage.update_pipeline_step(
                        step_id, status="failed",
                        error_code=normalized.code,
                        error_message=str(exc),
                        finished_at=_now()
                    )
                    await event_bus.publish_run_event(
                        run_id, "step.failed", node.key, attempt, episode_id
                    )
                    storage.update_pipeline_run(
                        run_id, status="failed",
                        error_code=normalized.code,
                        error_message=str(exc),
                        finished_at=_now()
                    )
                    raise

                # 可重试 — 指数退避 + 随机抖动
                delay = min(1.0 * (2 ** attempt), 10.0) + random.random()
                await asyncio.sleep(delay)
        else:
            # 所有重试用尽
            if last_error:
                normalized = normalize_error(last_error)
                storage.update_pipeline_step(
                    step_id, status="failed",
                    error_code=normalized.code,
                    error_message=str(last_error),
                    finished_at=_now()
                )
                storage.update_pipeline_run(
                    run_id, status="failed",
                    error_code=normalized.code,
                    error_message=str(last_error),
                    finished_at=_now()
                )
                raise last_error

    # 所有节点完成
    storage.update_pipeline_run(run_id, status="completed", finished_at=_now())
    logger.info(f"Pipeline {run_id} completed successfully")
    return state


def _now() -> str:
    from datetime import datetime
    return datetime.now().isoformat()
