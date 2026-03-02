"""视频生成任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData

logger = logging.getLogger(__name__)


@register_handler("video_panel")
async def handle_video_panel(task: TaskJobData, ctx: dict) -> dict:
    """处理视频面板生成任务"""
    logger.info(f"Processing video_panel task: {task.id}")
    payload = task.payload
    return {"task_id": task.id, "type": "video_panel", "status": "completed"}
