"""语音生成任务处理器"""
import logging
from . import register_handler
from ..types import TaskJobData
from ...runtime_adapter import runtime_adapter

logger = logging.getLogger(__name__)


@register_handler("voice_line")
async def handle_voice_line(task: TaskJobData, ctx: dict) -> dict:
    """处理语音合成任务

    根据 task.runtime 从 RuntimeAdapter 获取对应的语音服务实例。
    """
    logger.info(f"Processing voice_line task: {task.id} (runtime={task.runtime})")
    payload = task.payload

    voice_service = runtime_adapter.get_voice_service(task.runtime)
    storage = ctx.get("storage")

    if not voice_service:
        # 语音服务可选 — 无服务时尝试从 studio_service TTS 配置获取
        logger.info(f"No voice service for runtime {task.runtime}, trying studio TTS")
        try:
            import dependencies as deps
            studio_svc = getattr(deps, "studio_service", None)
            if studio_svc and hasattr(studio_svc, "tts_service"):
                voice_service = studio_svc.tts_service
        except Exception:
            pass

    if not voice_service:
        logger.warning(f"No voice service available for task {task.id}")
        return {"task_id": task.id, "type": "voice_line", "status": "completed", "placeholder": True}

    if storage:
        storage.update_progress(task.id, 10, "preparing")

    try:
        text = payload.get("text", "")
        voice_id = payload.get("voice_id", "")
        speaker = payload.get("speaker", "")
        speed = payload.get("speed", 1.0)
        volume = payload.get("volume", 1.0)

        if storage:
            storage.update_progress(task.id, 30, "synthesizing")

        # 通用 TTS 接口
        if hasattr(voice_service, "synthesize"):
            result = await voice_service.synthesize(
                text=text,
                voice_id=voice_id,
                speed=speed,
            )
        elif hasattr(voice_service, "generate"):
            result = await voice_service.generate(text=text, voice_id=voice_id)
        else:
            logger.warning(f"Voice service has no synthesize/generate method")
            return {"task_id": task.id, "type": "voice_line", "status": "completed", "placeholder": True}

        if storage:
            storage.update_progress(task.id, 90, "finalizing")

        audio_url = result.get("url", "") if isinstance(result, dict) else str(result)

        return {
            "task_id": task.id,
            "type": "voice_line",
            "status": "completed",
            "audio_url": audio_url,
            "target_type": task.target_type,
            "target_id": task.target_id,
        }

    except Exception as exc:
        error_info = runtime_adapter.handle_error(exc, task.runtime)
        logger.error(f"Voice synthesis failed for task {task.id}: {error_info['error_code']}: {exc}")
        raise
