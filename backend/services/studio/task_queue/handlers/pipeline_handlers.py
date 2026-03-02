"""管线阶段任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData

logger = logging.getLogger(__name__)


@register_handler("pipeline_stage")
async def handle_pipeline_stage(task: TaskJobData, ctx: dict) -> dict:
    """处理管线阶段任务"""
    logger.info(f"Processing pipeline_stage task: {task.id}")
    payload = task.payload
    return {"task_id": task.id, "type": "pipeline_stage", "status": "completed"}
