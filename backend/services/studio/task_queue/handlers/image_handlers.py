"""图片生成任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData
from ...runtime_adapter import runtime_adapter

logger = logging.getLogger(__name__)


@register_handler("image_frame")
async def handle_image_frame(task: TaskJobData, ctx: dict) -> dict:
    """处理图片帧生成任务

    根据 task.runtime 从 RuntimeAdapter 获取对应的图片服务实例,
    调用实际的图片生成 API。
    """
    logger.info(f"Processing image_frame task: {task.id} (runtime={task.runtime})")
    payload = task.payload

    image_service = runtime_adapter.get_image_service(task.runtime)
    if not image_service:
        logger.warning(f"No image service for runtime {task.runtime}, returning placeholder")
        return {"task_id": task.id, "type": "image_frame", "status": "completed", "placeholder": True}

    # 从 storage 更新进度
    storage = ctx.get("storage")
    if storage:
        storage.update_progress(task.id, 10, "preparing")

    try:
        prompt = payload.get("prompt", "")
        negative_prompt = payload.get("negative_prompt", "")
        width = payload.get("width", 1024)
        height = payload.get("height", 576)
        style = payload.get("style", "cinematic")
        reference_image = payload.get("reference_image")
        reference_images = payload.get("reference_images")
        steps = payload.get("steps", 25)
        seed = payload.get("seed")

        if storage:
            storage.update_progress(task.id, 30, "generating")

        result = await image_service.generate(
            prompt=prompt,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            style=style,
            reference_image=reference_image,
            reference_images=reference_images,
            steps=steps,
            seed=seed,
        )

        if storage:
            storage.update_progress(task.id, 90, "finalizing")

        image_url = result.get("url", "") if isinstance(result, dict) else str(result)
        actual_seed = result.get("seed") if isinstance(result, dict) else None

        return {
            "task_id": task.id,
            "type": "image_frame",
            "status": "completed",
            "image_url": image_url,
            "seed": actual_seed,
            "target_type": task.target_type,
            "target_id": task.target_id,
        }

    except Exception as exc:
        error_info = runtime_adapter.handle_error(exc, task.runtime)
        logger.error(f"Image generation failed for task {task.id}: {error_info['error_code']}: {exc}")
        raise
