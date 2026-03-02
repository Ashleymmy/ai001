"""图片生成任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData

logger = logging.getLogger(__name__)


@register_handler("image_frame")
async def handle_image_frame(task: TaskJobData, ctx: dict) -> dict:
    """处理图片帧生成任务"""
    # TODO: Phase 4 接入实际图片生成逻辑
    logger.info(f"Processing image_frame task: {task.id}")
    payload = task.payload

    # 占位: 返回空结果
    return {
        "task_id": task.id,
        "type": "image_frame",
        "status": "completed",
    }
