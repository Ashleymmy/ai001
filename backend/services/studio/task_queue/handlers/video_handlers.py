"""视频生成任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData
from ...runtime_adapter import runtime_adapter

logger = logging.getLogger(__name__)


async def _poll_video_status(video_service, external_id: str) -> dict:
    """使用 video_service 轮询外部视频任务状态"""
    return await video_service.check_task_status(external_id)


@register_handler("video_panel")
async def handle_video_panel(task: TaskJobData, ctx: dict) -> dict:
    """处理视频面板生成任务

    根据 task.runtime 从 RuntimeAdapter 获取对应的视频服务实例。
    支持断点续传: 若 task.external_id 已存在则恢复轮询外部任务状态。
    """
    logger.info(f"Processing video_panel task: {task.id} (runtime={task.runtime})")
    payload = task.payload

    video_service = runtime_adapter.get_video_service(task.runtime)
    if not video_service:
        logger.warning(f"No video service for runtime {task.runtime}, returning placeholder")
        return {"task_id": task.id, "type": "video_panel", "status": "completed", "placeholder": True}

    storage = ctx.get("storage")

    # 断点续传: 如果已有 external_id，恢复轮询
    if task.external_id:
        logger.info(f"Resuming external poll for task {task.id}, external_id={task.external_id}")
        from ..external_poll import wait_external_result

        if storage:
            storage.update_progress(task.id, 50, "polling_external")

        result = await wait_external_result(
            task_id=task.id,
            external_id=task.external_id,
            poll_fn=lambda ext_id: video_service.check_task_status(ext_id),
            storage=storage,
        )

        video_url = ""
        if isinstance(result, dict):
            video_url = result.get("video_url", "")

        return {
            "task_id": task.id,
            "type": "video_panel",
            "status": "completed",
            "video_url": video_url,
            "external_id": task.external_id,
            "target_type": task.target_type,
            "target_id": task.target_id,
        }

    # 正常生成流程
    if storage:
        storage.update_progress(task.id, 10, "preparing")

    try:
        image_url = payload.get("image_url", "")
        prompt = payload.get("prompt", "")
        duration = payload.get("duration", 5)
        motion_strength = payload.get("motion_strength", 5)
        seed = payload.get("seed")
        resolution = payload.get("resolution")
        ratio = payload.get("ratio")

        if storage:
            storage.update_progress(task.id, 20, "submitting")

        result = await video_service.generate(
            image_url=image_url,
            prompt=prompt,
            duration=duration,
            motion_strength=motion_strength,
            seed=seed,
            resolution=resolution,
            ratio=ratio,
        )

        video_task_id = result.get("task_id")

        # 异步视频: 持久化 external_id，然后轮询等待完成
        if video_task_id and not result.get("video_url"):
            if storage:
                storage.set_external_id(task.id, video_task_id)
                storage.update_progress(task.id, 30, "polling_external")

            from ..external_poll import wait_external_result

            poll_result = await wait_external_result(
                task_id=task.id,
                external_id=video_task_id,
                poll_fn=lambda ext_id: video_service.check_task_status(ext_id),
                storage=storage,
            )

            video_url = ""
            if isinstance(poll_result, dict):
                video_url = poll_result.get("video_url", "")

            return {
                "task_id": task.id,
                "type": "video_panel",
                "status": "completed",
                "video_url": video_url,
                "external_id": video_task_id,
                "target_type": task.target_type,
                "target_id": task.target_id,
            }

        if storage:
            storage.update_progress(task.id, 90, "finalizing")

        return {
            "task_id": task.id,
            "type": "video_panel",
            "status": "completed",
            "video_url": result.get("video_url", ""),
            "duration": result.get("duration"),
            "seed": result.get("seed"),
            "target_type": task.target_type,
            "target_id": task.target_id,
        }

    except Exception as exc:
        error_info = runtime_adapter.handle_error(exc, task.runtime)
        logger.error(f"Video generation failed for task {task.id}: {error_info['error_code']}: {exc}")
        raise
