"""管线阶段任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData
from ...runtime_adapter import runtime_adapter

logger = logging.getLogger(__name__)


@register_handler("pipeline_stage")
async def handle_pipeline_stage(task: TaskJobData, ctx: dict) -> dict:
    """处理管线阶段任务

    如果运行时启用了 graph_executor，则委托给图执行器。
    否则走简单的阶段回调。
    """
    logger.info(f"Processing pipeline_stage task: {task.id} (runtime={task.runtime})")
    payload = task.payload
    storage = ctx.get("storage")
    adapter = runtime_adapter

    stage = payload.get("stage", "")
    run_id = payload.get("run_id", "")
    episode_id = task.episode_id

    if storage:
        storage.update_progress(task.id, 10, stage or "preparing")

    flags = adapter.get_flags(task.runtime)

    if flags.use_graph_executor and run_id:
        return await _execute_via_graph(task, ctx, run_id, stage, episode_id)

    # 简单模式: 直接执行 AgentPipeline stage
    if task.runtime == "agent":
        return await _execute_agent_stage(task, ctx, stage)

    return {
        "task_id": task.id,
        "type": "pipeline_stage",
        "status": "completed",
        "stage": stage,
    }


async def _execute_via_graph(task: TaskJobData, ctx: dict, run_id: str, stage: str, episode_id: str) -> dict:
    """通过图执行器执行管线阶段"""
    try:
        from ...graph_executor import execute_pipeline_graph, GraphNode, NodeResult, GraphNodeContext

        storage = ctx.get("storage")
        event_bus = ctx.get("event_bus")

        if not storage or not event_bus:
            logger.warning(f"Missing storage/event_bus in context for graph execution")
            return {"task_id": task.id, "type": "pipeline_stage", "status": "completed", "stage": stage}

        # 单阶段执行 — 构建只含一个节点的图
        async def _run_stage_node(gctx: GraphNodeContext) -> NodeResult:
            payload = task.payload
            return NodeResult(
                checkpoint_refs={"stage": stage, "task_id": task.id},
                output={"stage": stage, "status": "completed"},
            )

        node = GraphNode(
            key=stage,
            title=stage,
            max_attempts=task.max_attempts,
            timeout_s=300,
            run=_run_stage_node,
        )

        state = await execute_pipeline_graph(
            run_id=run_id,
            nodes=[node],
            storage=storage,
            event_bus=event_bus,
            episode_id=episode_id,
        )

        return {
            "task_id": task.id,
            "type": "pipeline_stage",
            "status": "completed",
            "stage": stage,
            "refs": state.refs,
        }

    except Exception as exc:
        error_info = runtime_adapter.handle_error(exc, task.runtime)
        logger.error(f"Graph execution failed for task {task.id}: {error_info['error_code']}: {exc}")
        raise


async def _execute_agent_stage(task: TaskJobData, ctx: dict, stage: str) -> dict:
    """通过 AgentPipeline 执行 Agent 运行时的阶段"""
    try:
        from ...agent_pipeline import AgentPipeline

        llm_service = runtime_adapter.get_llm_service(task.runtime)
        ag_storage = runtime_adapter.get_storage(task.runtime)

        pipeline = AgentPipeline(
            series_id=task.series_id,
            episode_id=task.episode_id,
            storage=ag_storage,
            llm_service=llm_service,
        )

        handlers = pipeline._stage_handlers()
        handler = handlers.get(stage)
        if not handler:
            return {"task_id": task.id, "type": "pipeline_stage", "status": "completed",
                    "stage": stage, "skipped": True}

        output = await handler(task.payload.get("input_data", {}))

        return {
            "task_id": task.id,
            "type": "pipeline_stage",
            "status": "completed",
            "stage": stage,
            "output": output,
        }

    except Exception as exc:
        error_info = runtime_adapter.handle_error(exc, task.runtime)
        logger.error(f"Agent stage execution failed for task {task.id}: {error_info['error_code']}: {exc}")
        raise
