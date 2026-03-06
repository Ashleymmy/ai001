"""Generation routes: /api/parse-story, /api/generate, /api/regenerate, /api/generate-image, /api/generate-video, /api/video-task-status, /api/videos/history."""

import asyncio
import json
import time
from datetime import datetime, timezone
import uuid
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.storage_service import storage

import dependencies as deps
from schemas.settings import (
    ModelConfig,
    LocalConfig,
    GenerateRequest,
    ParseStoryRequest,
    RegenerateRequest,
    VideoRequest,
    VideoTaskStatusRequest,
)

router = APIRouter(prefix="/api", tags=["generation"])


class GenerateImageRequest(BaseModel):
    prompt: str
    projectId: Optional[str] = None
    scope: str = "module"
    negativePrompt: Optional[str] = "blurry, low quality, distorted, deformed, ugly"
    width: int = 1024
    height: int = 576
    steps: int = 25
    seed: Optional[int] = None
    style: Optional[str] = None
    referenceImage: Optional[str] = None
    referenceImages: Optional[List[str]] = None
    image: Optional[ModelConfig] = None
    local: Optional[LocalConfig] = None


class DeleteVideosRequest(BaseModel):
    ids: List[str]


@router.post("/parse-story")
async def parse_story(request: ParseStoryRequest):
    service = deps.get_request_llm_service(request.llm)
    prompts = await service.parse_story(
        story_text=request.storyText,
        count=request.count,
        style=request.style
    )
    return {"prompts": prompts}


@router.post("/generate")
async def generate_storyboards(request: GenerateRequest):
    llm = deps.get_request_llm_service(request.llm)
    img = deps.get_request_image_service(request.storyboard, request.local, mode="storyboard")

    style_prompt = deps.STYLE_PROMPTS.get(request.style, deps.STYLE_PROMPTS["cinematic"])

    prompts = await llm.parse_story(
        story_text=request.storyText,
        count=request.count,
        style=request.style
    )

    storyboards = []
    for i, prompt in enumerate(prompts):
        full_prompt = f"{prompt}, {style_prompt}"
        result = await img.generate(
            prompt=full_prompt,
            reference_image=request.referenceImage,
            style=request.style
        )
        image_url = result["url"] if isinstance(result, dict) else result
        storyboards.append({
            "id": str(uuid.uuid4()),
            "index": i + 1,
            "prompt": prompt,
            "fullPrompt": full_prompt,
            "imageUrl": image_url
        })
    return {"storyboards": storyboards}


@router.post("/regenerate")
async def regenerate_image(request: RegenerateRequest):
    img = deps.get_request_image_service(request.storyboard, request.local, mode="storyboard")
    style_prompt = deps.STYLE_PROMPTS.get(request.style, deps.STYLE_PROMPTS["cinematic"])
    full_prompt = f"{request.prompt}, {style_prompt}"
    result = await img.generate(
        prompt=full_prompt,
        reference_image=request.referenceImage,
        style=request.style
    )
    image_url = result["url"] if isinstance(result, dict) else result
    return {"imageUrl": image_url}


@router.post("/generate-image")
async def generate_single_image(request: GenerateImageRequest):
    runtime = "agent" if (request.scope or "module") == "agent" else "module"
    if deps.resolve_runtime_mode(runtime, "/api/generate-image") == "task_queue":
        return await _module_generate_image_via_queue(request)

    # ── 原有路径 ──
    module_scope = (request.scope or "module") != "agent"
    service = deps.get_request_image_service(request.image, request.local, mode="image", module_scope=module_scope)

    final_prompt = request.prompt
    if request.style and request.style in deps.STYLE_PRESETS:
        final_prompt = f"{request.prompt}, {deps.STYLE_PRESETS[request.style]}"

    print(f"[API] 图像生成请求: provider={service.provider}, model={service.model}, size={request.width}x{request.height}")

    try:
        result = await service.generate(
            prompt=final_prompt,
            reference_image=request.referenceImage,
            reference_images=request.referenceImages,
            style=request.style or "cinematic",
            negative_prompt=request.negativePrompt or "",
            width=request.width,
            height=request.height,
            steps=request.steps,
            seed=request.seed
        )
        image_url = result["url"]
        actual_seed = result["seed"]
        storage.save_generated_image(
            prompt=request.prompt,
            image_url=image_url,
            negative_prompt=request.negativePrompt or "",
            provider=service.provider,
            model=service.model or "",
            width=request.width,
            height=request.height,
            steps=request.steps,
            seed=actual_seed,
            style=request.style,
            project_id=request.projectId
        )
        return {
            "imageUrl": image_url,
            "seed": actual_seed,
            "width": request.width,
            "height": request.height,
            "steps": request.steps
        }
    except Exception as e:
        error_msg = str(e)
        print(f"图像生成失败: {error_msg}")
        if deps._is_model_access_error(error_msg):
            guidance = (
                "当前图像模型不可用或无权限。"
                "如果你使用火山方舟/豆包，请在设置里填写 /models 返回的 endpoint id（通常是 ep-xxx），"
                "不要填展示名。"
            )
            raise HTTPException(status_code=500, detail=f"图像生成失败: {guidance}")
        raise HTTPException(status_code=500, detail=f"图像生成失败: {error_msg}")


@router.post("/generate-video")
async def generate_video(request: VideoRequest):
    runtime = "agent" if (request.scope or "module") == "agent" else "module"
    if deps.resolve_runtime_mode(runtime, "/api/generate-video") == "task_queue":
        return await _module_generate_video_via_queue(request)

    # ── 原有路径 ──
    module_scope = (request.scope or "module") != "agent"
    service = deps.get_request_video_service(request.video, module_scope=module_scope)

    print(f"[API] 视频生成请求: provider={service.provider}, model={service.model}")
    print(f"[API] 参数: duration={request.duration}, resolution={request.resolution}, ratio={request.ratio}")

    try:
        result = await service.generate(
            image_url=request.imageUrl,
            prompt=request.prompt,
            duration=request.duration,
            motion_strength=request.motionStrength,
            seed=request.seed,
            resolution=request.resolution,
            ratio=request.ratio,
            camera_fixed=request.cameraFixed,
            watermark=request.watermark,
            generate_audio=request.generateAudio,
            reference_mode=request.referenceMode or "single",
            first_frame_url=request.firstFrameUrl,
            last_frame_url=request.lastFrameUrl,
            reference_images=request.referenceImageUrls,
        )
        storage.save_generated_video(
            source_image=(request.imageUrl or request.firstFrameUrl or (request.referenceImageUrls[0] if request.referenceImageUrls else "")),
            prompt=request.prompt,
            video_url=result.get("video_url"),
            task_id=result.get("task_id"),
            status=result.get("status"),
            provider=service.provider,
            model=service.model or "",
            duration=request.duration,
            seed=result.get("seed"),
            project_id=request.projectId
        )
        task_id = result.get("task_id")
        if task_id:
            deps.video_task_services[task_id] = service
        return {
            "taskId": task_id,
            "status": result.get("status"),
            "videoUrl": result.get("video_url"),
            "duration": result.get("duration"),
            "seed": result.get("seed"),
            "audioDisabled": bool(result.get("audio_disabled")),
        }
    except Exception as e:
        error_msg = str(e)
        print(f"视频生成失败: {error_msg}")
        raise HTTPException(status_code=500, detail=f"视频生成失败: {error_msg}")


@router.post("/video-task-status")
async def check_video_task_status(request: VideoTaskStatusRequest):
    # 兼容任务队列内部 task_id
    task_storage = deps.get_task_queue_storage(required=False)
    if task_storage is not None:
        task = task_storage.get_task(request.taskId)
        if task:
            queued_timeout_sec = min(45.0, max(10.0, deps.TASK_QUEUE_WAIT_TIMEOUT_SEC / 4))
            queued_age = _seconds_since_iso(task.queued_at or task.created_at)
            if task.status == "queued" and queued_age is not None and queued_age >= queued_timeout_sec:
                error_message = "任务长时间未被消费，请检查 worker 是否已启动"
                storage.update_video_status(request.taskId, "error")
                return {
                    "taskId": request.taskId,
                    "status": "error",
                    "videoUrl": None,
                    "progress": task.progress or 0,
                    "error": error_message,
                    "mode": "task_queue",
                }
            result_payload = _decode_task_result(task.result)
            status_map = {
                "queued": "processing",
                "processing": "processing",
                "completed": "completed",
                "failed": "error",
            }
            mapped_status = status_map.get(task.status, task.status)
            video_url = str(result_payload.get("video_url") or "")
            if mapped_status == "completed" and video_url:
                storage.update_video_status(request.taskId, "completed", video_url)
            elif mapped_status == "error":
                storage.update_video_status(request.taskId, "error")
            return {
                "taskId": request.taskId,
                "status": mapped_status,
                "videoUrl": video_url or None,
                "progress": task.progress or 0,
                "error": task.error_message,
                "mode": "task_queue",
            }

    service = deps.video_task_services.get(request.taskId) or deps.get_module_video_service()
    try:
        result = await service.check_task_status(request.taskId)
        if result.get("status") == "completed" and result.get("video_url"):
            storage.update_video_status(request.taskId, "completed", result.get("video_url"))
            deps.video_task_services.pop(request.taskId, None)
        elif result.get("status") == "error":
            deps.video_task_services.pop(request.taskId, None)
        return {
            "taskId": request.taskId,
            "status": result.get("status"),
            "videoUrl": result.get("video_url"),
            "progress": result.get("progress", 0),
            "error": result.get("error")
        }
    except Exception as e:
        return {"taskId": request.taskId, "status": "error", "error": str(e)}


@router.get("/videos/history")
async def get_video_history(limit: int = 50, project_id: Optional[str] = None):
    videos = storage.list_generated_videos(limit, project_id=project_id)
    return {"videos": videos}


@router.get("/agent/videos/history")
async def get_agent_video_history(limit: int = 50, project_id: Optional[str] = None):
    videos = storage.list_agent_generated_videos(limit, project_id=project_id)
    return {"videos": videos}


@router.delete("/videos/history/{video_id}")
async def delete_video_history(video_id: str):
    success = storage.delete_generated_video(video_id)
    if not success:
        raise HTTPException(status_code=404, detail="视频记录不存在")
    return {"status": "ok"}


@router.post("/videos/history/delete-batch")
async def delete_videos_batch(request: DeleteVideosRequest):
    deleted = storage.delete_generated_videos_batch(request.ids)
    return {"status": "ok", "deleted": deleted}


# ---------------------------------------------------------------------------
# Phase 4: Module 任务队列路径
# ---------------------------------------------------------------------------

def _decode_task_result(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, dict) else {}
        except Exception:
            return {}
    return {}


def _seconds_since_iso(value: Optional[str]) -> Optional[float]:
    ts = str(value or "").strip()
    if not ts:
        return None
    try:
        normalized = ts.replace("Z", "+00:00")
        dt = datetime.fromisoformat(normalized)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(timezone.utc) - dt).total_seconds())
    except Exception:
        return None


async def _wait_for_queue_task(task_id: str, timeout_sec: Optional[int] = None):
    task_storage = deps.get_task_queue_storage(required=True)
    poll_interval = max(0.1, deps.TASK_QUEUE_POLL_INTERVAL_MS / 1000.0)
    wait_timeout = timeout_sec or deps.TASK_QUEUE_WAIT_TIMEOUT_SEC
    deadline = time.monotonic() + wait_timeout
    queued_deadline = time.monotonic() + min(15.0, max(5.0, wait_timeout / 4))

    while time.monotonic() < deadline:
        task = task_storage.get_task(task_id)
        if not task:
            raise HTTPException(status_code=500, detail="任务不存在或已丢失")
        if task.status == "completed":
            return task, _decode_task_result(task.result)
        if task.status == "failed":
            msg = task.error_message or "任务执行失败"
            raise HTTPException(status_code=500, detail=msg)
        if task.status == "queued" and time.monotonic() > queued_deadline:
            raise HTTPException(status_code=503, detail="任务长时间未被消费，请检查 worker 是否已启动")
        await asyncio.sleep(poll_interval)

    raise HTTPException(status_code=504, detail="任务执行超时")


async def _module_generate_image_via_queue(request: GenerateImageRequest):
    """通过任务队列提交图片生成任务，同步等待结果返回。"""
    from services.studio.task_queue.types import CreateTaskInput

    final_prompt = request.prompt
    if request.style and request.style in deps.STYLE_PRESETS:
        final_prompt = f"{request.prompt}, {deps.STYLE_PRESETS[request.style]}"

    runtime = "agent" if (request.scope or "module") == "agent" else "module"

    inp = CreateTaskInput(
        type="image_frame",
        queue_type="image",
        target_type="single",
        target_id=request.projectId or "standalone",
        runtime=runtime,
        priority=0,
        max_attempts=3,
        payload={
            "prompt": final_prompt,
            "negative_prompt": request.negativePrompt or "",
            "width": request.width,
            "height": request.height,
            "steps": request.steps,
            "seed": request.seed,
            "style": request.style,
            "reference_image": request.referenceImage,
            "reference_images": request.referenceImages,
        },
    )
    submitter = deps.get_task_queue_submitter(runtime, "/api/generate-image", required=True)
    task, _ = await submitter.submit_task(inp)
    _, result_data = await _wait_for_queue_task(task.id)

    image_url = str(result_data.get("image_url") or "")
    if not image_url:
        raise HTTPException(status_code=500, detail="图像生成成功但返回结果缺少 image_url")
    actual_seed = result_data.get("seed")
    image_service = deps.get_image_service() if runtime == "agent" else deps.get_module_image_service()
    storage.save_generated_image(
        prompt=request.prompt,
        image_url=image_url,
        negative_prompt=request.negativePrompt or "",
        provider=image_service.provider,
        model=image_service.model or "",
        width=request.width,
        height=request.height,
        steps=request.steps,
        seed=actual_seed or 0,
        style=request.style,
        project_id=request.projectId,
    )
    return {
        "imageUrl": image_url,
        "seed": actual_seed,
        "width": request.width,
        "height": request.height,
        "steps": request.steps,
        "taskId": task.id,
        "mode": "task_queue",
    }


async def _module_generate_video_via_queue(request):
    """通过任务队列提交视频生成任务，返回任务 ID。"""
    from services.studio.task_queue.types import CreateTaskInput

    runtime = "agent" if (request.scope or "module") == "agent" else "module"

    inp = CreateTaskInput(
        type="video_panel",
        queue_type="video",
        target_type="single",
        target_id=request.projectId or "standalone",
        runtime=runtime,
        priority=0,
        max_attempts=3,
        payload={
            "image_url": request.imageUrl or "",
            "prompt": request.prompt or "",
            "duration": request.duration,
            "motion_strength": request.motionStrength,
            "seed": request.seed,
            "resolution": request.resolution,
            "ratio": request.ratio,
        },
    )
    submitter = deps.get_task_queue_submitter(runtime, "/api/generate-video", required=True)
    task, _ = await submitter.submit_task(inp)

    video_service = deps.get_video_service() if runtime == "agent" else deps.get_module_video_service()
    storage.save_generated_video(
        source_image=request.imageUrl or "",
        prompt=request.prompt or "",
        video_url=None,
        task_id=task.id,
        status="processing",
        provider=video_service.provider,
        model=video_service.model or "",
        duration=request.duration,
        seed=request.seed or 0,
        project_id=request.projectId,
    )

    return {
        "taskId": task.id,
        "status": "processing",
        "videoUrl": None,
        "duration": request.duration,
        "seed": request.seed,
        "audioDisabled": False,
        "mode": "task_queue",
    }
