"""LLM 文本任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData

logger = logging.getLogger(__name__)


@register_handler("llm_text")
async def handle_llm_text(task: TaskJobData, ctx: dict) -> dict:
    """处理 LLM 文本生成任务"""
    logger.info(f"Processing llm_text task: {task.id}")
    payload = task.payload
    return {"task_id": task.id, "type": "llm_text", "status": "completed"}
