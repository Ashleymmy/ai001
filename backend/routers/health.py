"""Health check endpoint."""

from fastapi import APIRouter

from dependencies import get_module_llm_service, get_module_image_service, get_task_queue_health

router = APIRouter(tags=["health"])


@router.get("/health")
async def health_check():
    module_llm = get_module_llm_service()
    module_image = get_module_image_service()
    return {
        "status": "ok",
        "version": "1.0.0",
        "llm_configured": bool(module_llm.api_key),
        "image_configured": bool(module_image.provider and module_image.provider not in {"placeholder", "none"})
    }


@router.get("/api/health/queue")
async def queue_health_check():
    return get_task_queue_health()
