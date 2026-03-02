"""LLM 文本任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData
from ...runtime_adapter import runtime_adapter

logger = logging.getLogger(__name__)


@register_handler("llm_text")
async def handle_llm_text(task: TaskJobData, ctx: dict) -> dict:
    """处理 LLM 文本生成任务

    根据 task.runtime 从 RuntimeAdapter 获取对应的 LLM 服务实例。
    """
    logger.info(f"Processing llm_text task: {task.id} (runtime={task.runtime})")
    payload = task.payload

    llm_service = runtime_adapter.get_llm_service(task.runtime)
    if not llm_service:
        logger.warning(f"No LLM service for runtime {task.runtime}, returning placeholder")
        return {"task_id": task.id, "type": "llm_text", "status": "completed", "placeholder": True}

    storage = ctx.get("storage")
    if storage:
        storage.update_progress(task.id, 10, "preparing")

    try:
        system_prompt = payload.get("system_prompt", "")
        user_prompt = payload.get("user_prompt", "")
        model = payload.get("model")
        response_format = payload.get("response_format", "text")
        temperature = payload.get("temperature")

        if storage:
            storage.update_progress(task.id, 30, "generating")

        kwargs = {}
        if model:
            kwargs["model"] = model
        if response_format:
            kwargs["response_format"] = response_format
        if temperature is not None:
            kwargs["temperature"] = temperature

        if hasattr(llm_service, "chat"):
            result = await llm_service.chat(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                **kwargs,
            )
        elif hasattr(llm_service, "generate"):
            result = await llm_service.generate(prompt=user_prompt, **kwargs)
        else:
            logger.warning(f"LLM service has no chat/generate method")
            return {"task_id": task.id, "type": "llm_text", "status": "completed", "placeholder": True}

        if storage:
            storage.update_progress(task.id, 90, "finalizing")

        # 标准化输出
        if isinstance(result, dict):
            text_result = result
        elif isinstance(result, str):
            text_result = {"text": result}
        else:
            text_result = {"text": str(result)}

        return {
            "task_id": task.id,
            "type": "llm_text",
            "status": "completed",
            "result": text_result,
            "target_type": task.target_type,
            "target_id": task.target_id,
        }

    except Exception as exc:
        error_info = runtime_adapter.handle_error(exc, task.runtime)
        logger.error(f"LLM generation failed for task {task.id}: {error_info['error_code']}: {exc}")
        raise
