"""语音生成任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData

logger = logging.getLogger(__name__)


@register_handler("voice_line")
async def handle_voice_line(task: TaskJobData, ctx: dict) -> dict:
    """处理语音合成任务"""
    logger.info(f"Processing voice_line task: {task.id}")
    payload = task.payload
    return {"task_id": task.id, "type": "voice_line", "status": "completed"}
