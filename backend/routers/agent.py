"""Agent routes: /api/agent/*."""

import os
import re
import math
import json
import uuid
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from time import perf_counter
from fastapi import APIRouter, HTTPException, Query, Header, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from services.storage_service import storage
from services.agent_service import AgentService, AgentProject, AgentExecutor
from services.tts_service import (
    DashScopeTTSConfig,
    DashScopeTTSService,
    FishTTSConfig,
    FishTTSService,
    OpenAITTSConfig,
    OpenAITTSService,
    VolcTTSConfig,
    VolcTTSService,
)
from schemas.settings import (
    ModelConfig,
    LocalConfig,
    TTSConfig,
    GenerateAgentAudioRequest,
    ClearAgentAudioRequest,
    SaveAudioTimelineRequest,
    AudioTimelineMasterAudioRequest,
    ExtractVideoAudioRequest,
    ExecutePipelineRequest,
    ExecutePipelineV2Request,
)
import dependencies as deps
from dependencies import USE_TASK_QUEUE

router = APIRouter(prefix="/api/agent", tags=["agent"])

@router.get("/prompts")
async def get_agent_prompts(includeContent: bool = False):
    """查看后端当前启用的 system prompts 摘要（调试用）。

    默认只返回摘要与哈希；需要全文时传 includeContent=true。
    """
    service = deps.get_agent_service()
    return service.get_prompts_debug(include_content=includeContent)


@router.post("/chat")
async def agent_chat(request: AgentChatRequest):
    """Agent 对话接口"""
    service = deps.get_agent_service()
    
    # 构建上下文
    context = request.context or {}
    if not isinstance(context, dict):
        context = {}
    project_data = None
    if request.projectId:
        # 加载项目数据作为上下文
        project_data = storage.get_agent_project(request.projectId)
        if project_data:
            context["project"] = project_data

    # 兼容“未保存项目”场景：前端会传 elements/segments，但没有 projectId。
    if not project_data and "project" not in context:
        elements = context.get("elements")
        segments = context.get("segments")
        if isinstance(elements, dict) or isinstance(segments, list):
            context["project"] = {
                "id": "unsaved",
                "name": "unsaved",
                "creative_brief": context.get("creative_brief") or context.get("creativeBrief") or {},
                "elements": elements if isinstance(elements, dict) else {},
                "segments": segments if isinstance(segments, list) else [],
                "updated_at": datetime.utcnow().isoformat() + "Z",
            }
     
    result = await service.chat(request.message, context)

    # 将对话写入项目的 agent_memory，供后续“基于上下文回答”使用（减少幻觉）
    if request.projectId and project_data:
        try:
            project_obj = AgentProject.from_dict(project_data)

            ts = int(time.time() * 1000)
            now = datetime.utcnow().isoformat() + "Z"

            user_turn = {
                "id": f"mem_u_{ts}",
                "role": "user",
                "content": request.message,
                "created_at": now
            }
            assistant_turn = {
                "id": f"mem_a_{ts + 1}",
                "role": "assistant",
                "content": result.get("content", ""),
                "created_at": now,
                "meta": {
                    "type": result.get("type"),
                    "action": result.get("action")
                }
            }

            project_obj.agent_memory = project_obj.agent_memory or []

            last = project_obj.agent_memory[-1] if project_obj.agent_memory else None
            if not (isinstance(last, dict) and last.get("role") == user_turn["role"] and last.get("content") == user_turn["content"]):
                project_obj.agent_memory.append(user_turn)

            last2 = project_obj.agent_memory[-1] if project_obj.agent_memory else None
            if not (isinstance(last2, dict) and last2.get("role") == assistant_turn["role"] and last2.get("content") == assistant_turn["content"]):
                project_obj.agent_memory.append(assistant_turn)

            storage.save_agent_project(project_obj.to_dict())
        except Exception as e:
            print(f"[Agent] 保存 agent_memory 失败: {e}")

    return result


@router.post("/plan")
async def agent_plan_project(request: AgentPlanRequest):
    """Agent 项目规划"""
    service = deps.get_agent_service()
    result = await service.plan_project(request.userRequest, request.style)
    return result


@router.post("/element-prompt")
async def agent_generate_element_prompt(request: AgentElementPromptRequest):
    """生成元素的图像提示词"""
    service = deps.get_agent_service()
    result = await service.generate_element_prompt(
        request.elementName,
        request.elementType,
        request.baseDescription,
        request.visualStyle
    )
    return result


@router.post("/shot-prompt")
async def agent_generate_shot_prompt(request: AgentShotPromptRequest):
    """生成镜头的视频提示词"""
    service = deps.get_agent_service()
    result = await service.generate_shot_prompt(
        request.shotName,
        request.shotType,
        request.shotDescription,
        request.elements,
        request.visualStyle,
        request.narration
    )
    return result


@router.get("/shot-types")
async def get_shot_types():
    """获取支持的镜头类型"""
    from services.agent_service import SHOT_TYPES
    return {"shotTypes": SHOT_TYPES}


# Agent 项目管理

@router.post("/projects")
async def create_agent_project(request: AgentProjectRequest):
    """创建 Agent 项目"""
    project = AgentProject()
    project.name = request.name
    if request.creativeBrief:
        project.creative_brief = request.creativeBrief
    
    # 保存到存储
    storage.save_agent_project(project.to_dict())
    return project.to_dict()


@router.get("/projects")
async def list_agent_projects(limit: int = 50):
    """获取 Agent 项目列表"""
    projects = storage.list_agent_projects(limit)
    return {"projects": projects}


@router.get("/projects/{project_id}")
async def get_agent_project(project_id: str):
    """获取 Agent 项目详情"""
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return deps._sanitize_expired_agent_media_urls(project)


@router.put("/projects/{project_id}")
async def update_agent_project(project_id: str, updates: dict):
    """更新 Agent 项目"""
    print(f"[API] 更新 Agent 项目: {project_id}")
    print(f"[API] 更新数据: {list(updates.keys())}")
    
    project = storage.update_agent_project(project_id, updates)
    if not project:
        print(f"[API] 项目不存在: {project_id}")
        raise HTTPException(status_code=404, detail="项目不存在")
    
    print(f"[API] 项目已更新: {project.get('name')}")
    return project


@router.post("/projects/{project_id}/operator/apply")
async def apply_agent_operator(project_id: str, request: AgentOperatorApplyRequest):
    """Apply confirmed LLM edits (actions/patch) via backend operator."""
    service = deps.get_agent_service()
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    executor = deps.get_agent_executor() if request.executeRegenerate else None
    result = await service.apply_operator(project, request.kind, request.payload, executor=executor)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Apply failed"))
    return result


@router.post("/projects/{project_id}/script-doctor")
async def script_doctor_project(project_id: str, request: AgentScriptDoctorRequest):
    """剧本增强：补齐 hook/高潮，提升逻辑与细节（不破坏现有 ID）。"""
    service = deps.get_agent_service()
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    result = await service.script_doctor(project, mode=request.mode)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Script Doctor 失败"))

    updates = result.get("updates") or {}
    updated_project = storage.update_agent_project(project_id, updates) if request.apply else project

    return {
        "success": True,
        "patch": result.get("patch"),
        "updates": updates,
        "project": updated_project,
    }


@router.post("/projects/{project_id}/complete-assets")
async def complete_assets_project(project_id: str, request: AgentAssetCompletionRequest):
    """资产补全：从分镜提取缺失的场景/道具元素，并可选补丁镜头 prompt。"""
    service = deps.get_agent_service()
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    result = await service.complete_assets(project)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "资产补全失败"))

    updates = result.get("updates") or {}
    updated_project = storage.update_agent_project(project_id, updates) if request.apply else project

    return {
        "success": True,
        "added_elements": result.get("added_elements") or [],
        "raw": result.get("raw"),
        "updates": updates,
        "project": updated_project,
    }


@router.post("/projects/{project_id}/refine-split-visuals")
async def refine_split_visuals_project(project_id: str, request: AgentRefineSplitVisualsRequest):
    """一键精修“拆分镜头组”的画面提示词（LLM）：仅更新 description/prompt/video_prompt，不改 shot id。"""
    service = deps.get_agent_service()
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    result = await service.refine_split_visuals(project, parent_shot_id=request.parentShotId)
    if not result.get("success"):
        return {"success": False, "error": result.get("error", "精修失败")}

    updates = result.get("updates") or {}
    if not isinstance(updates, dict) or not updates:
        return {"success": False, "error": "精修未产生可应用的更新"}

    updated_project = storage.update_agent_project(project_id, updates)
    return {"success": True, "project": updated_project}


@router.post("/projects/{project_id}/audio-check")
async def audio_check_project(project_id: str, request: AgentAudioCheckRequest):
    """音频对齐检查：用启发式估算旁白/对话时长，并给出镜头时长建议（可选自动应用）。"""
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    include_n = bool(request.includeNarration)
    include_d = bool(request.includeDialogue)
    speed = request.speed if isinstance(request.speed, (int, float)) and request.speed > 0 else 1.0

    issues: List[Dict[str, Any]] = []
    suggestions: Dict[str, float] = {}

    segments = project.get("segments") or []
    if isinstance(segments, list):
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            for shot in (seg.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                shot_id = shot.get("id")
                if not isinstance(shot_id, str):
                    continue

                narration = shot.get("narration") or ""
                dialogue_script = shot.get("dialogue_script") or ""
                parts: List[str] = []
                if include_n and isinstance(narration, str) and narration.strip():
                    parts.append(narration.strip())
                if include_d and isinstance(dialogue_script, str) and dialogue_script.strip():
                    parts.append(deps._extract_dialogue_text(dialogue_script))
                text = " ".join([p for p in parts if p])
                est = deps._estimate_speech_seconds(text, speed=speed)

                dur = shot.get("duration", 5.0)
                try:
                    dur_f = float(dur)
                except Exception:
                    dur_f = 5.0

                if est <= 0.01:
                    continue

                ratio = est / max(0.1, dur_f)
                if ratio > 1.15:
                    suggested = float(math.ceil((est + 0.4) * 2) / 2)  # round up to 0.5s
                    suggestions[shot_id] = max(dur_f, suggested)
                    issues.append({
                        "shot_id": shot_id,
                        "type": "too_short",
                        "duration": dur_f,
                        "estimated_audio": est,
                        "suggested_duration": suggestions[shot_id],
                    })
                elif ratio < 0.45 and dur_f >= 6:
                    issues.append({
                        "shot_id": shot_id,
                        "type": "too_long",
                        "duration": dur_f,
                        "estimated_audio": est,
                        "suggested_duration": max(2.0, float(math.floor((est + 0.3) * 2) / 2)),
                    })

    if request.apply and suggestions:
        # Apply only suggested increases (avoid shortening automatically)
        if isinstance(segments, list):
            for seg in segments:
                if not isinstance(seg, dict):
                    continue
                for shot in (seg.get("shots") or []):
                    if not isinstance(shot, dict):
                        continue
                    sid = shot.get("id")
                    if isinstance(sid, str) and sid in suggestions:
                        shot["duration"] = suggestions[sid]
        project = storage.update_agent_project(project_id, {"segments": segments}) or project

    return {"success": True, "issues": issues, "suggestions": suggestions, "project": project}


@router.delete("/projects/{project_id}")
async def delete_agent_project(project_id: str):
    """删除 Agent 项目"""
    success = storage.delete_agent_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"status": "ok"}


@router.post("/projects/{project_id}/export/assets")
async def export_project_assets(project_id: str):
    """导出项目所有素材（打包成 ZIP）"""
    from services.export_service import export_service
    from fastapi.responses import FileResponse
    
    print(f"[API] 导出项目素材: {project_id}")
    
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    try:
        print(f"[API] 项目数据: name={project.get('name')}, elements={len(project.get('elements', {}))}, segments={len(project.get('segments', []))}")
        
        zip_path = await export_service.export_project_assets(
            project_id=project_id,
            project_name=project.get('name', 'Untitled'),
            elements=project.get('elements', {}),
            segments=project.get('segments', []),
            visual_assets=project.get('visual_assets', [])
        )
        
        print(f"[API] ZIP 文件已创建: {zip_path}")
        
        return FileResponse(
            zip_path,
            media_type='application/zip',
            filename=os.path.basename(zip_path)
        )
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"[API] 导出素材失败:\n{error_detail}")
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.post("/projects/{project_id}/export/video")
async def export_merged_video(project_id: str, resolution: str = "720p"):
    """导出拼接后的视频"""
    from services.export_service import export_service
    from fastapi.responses import FileResponse
    
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    try:
        video_path = await export_service.export_merged_video(
            project_id=project_id,
            project_name=project.get('name', 'Untitled'),
            segments=project.get('segments', []),
            output_resolution=resolution
        )
        
        return FileResponse(
            video_path,
            media_type='video/mp4',
            filename=os.path.basename(video_path)
        )
    except Exception as e:
        print(f"[API] 导出视频失败: {e}")
        raise HTTPException(status_code=500, detail=f"导出失败: {str(e)}")


@router.post("/projects/{project_id}/elements")
async def add_agent_element(project_id: str, request: AgentElementRequest):
    """添加元素到项目"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    element = project.add_element(
        request.elementId,
        request.name,
        request.elementType,
        request.description,
        request.imageUrl
    )
    
    storage.save_agent_project(project.to_dict())
    return element


@router.post("/projects/{project_id}/segments")
async def add_agent_segment(project_id: str, request: AgentSegmentRequest):
    """添加段落到项目"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    segment = project.add_segment(
        request.segmentId,
        request.name,
        request.description
    )
    
    storage.save_agent_project(project.to_dict())
    return segment


@router.post("/projects/{project_id}/shots")
async def add_agent_shot(project_id: str, request: AgentShotRequest):
    """添加镜头到段落"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    shot = project.add_shot(
        request.segmentId,
        request.shotId,
        request.name,
        request.shotType,
        request.description,
        request.prompt,
        request.narration,
        request.duration
    )
    
    if not shot:
        raise HTTPException(status_code=404, detail="段落不存在")
    
    storage.save_agent_project(project.to_dict())
    return shot


# ========== 图片收藏 API ==========

class FavoriteImageRequest(BaseModel):
    imageId: str


@router.post("/projects/{project_id}/elements/{element_id}/favorite")
async def favorite_element_image(project_id: str, element_id: str, request: FavoriteImageRequest):
    """收藏元素图片 - 将指定图片设为当前使用的图片"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    element = project.elements.get(element_id)
    if not element:
        raise HTTPException(status_code=404, detail="元素不存在")
    
    # 获取图片历史
    image_history = element.get("image_history") or []
    if not isinstance(image_history, list):
        image_history = []
    
    # 找到要收藏的图片
    target_image = None
    for img in image_history:
        if not isinstance(img, dict):
            continue
        if img.get("id") == request.imageId:
            target_image = img
            img["is_favorite"] = True
        else:
            img["is_favorite"] = False
    
    if not target_image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 更新当前使用的图片
    target_url = target_image.get("url")
    source_url = target_image.get("source_url") or target_url
    element["image_url"] = source_url
    element["cached_image_url"] = target_url if isinstance(target_url, str) and target_url.startswith("/api/uploads/") else None
    element["image_history"] = image_history
    
    # 保存项目
    storage.save_agent_project(project.to_dict())
    
    return {"success": True, "element": element}


@router.post("/projects/{project_id}/shots/{shot_id}/favorite")
async def favorite_shot_image(project_id: str, shot_id: str, request: FavoriteImageRequest):
    """收藏镜头起始帧 - 将指定图片设为当前使用的起始帧"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    
    # 在所有段落中查找镜头
    target_shot = None
    for segment in project.segments:
        if not isinstance(segment, dict):
            continue
        for shot in (segment.get("shots") or []):
            if not isinstance(shot, dict):
                continue
            if shot.get("id") == shot_id:
                target_shot = shot
                break
        if target_shot:
            break
    
    if not target_shot:
        raise HTTPException(status_code=404, detail="镜头不存在")
    
    # 获取图片历史
    image_history = target_shot.get("start_image_history") or []
    if not isinstance(image_history, list):
        image_history = []
    
    # 找到要收藏的图片
    target_image = None
    for img in image_history:
        if not isinstance(img, dict):
            continue
        if img.get("id") == request.imageId:
            target_image = img
            img["is_favorite"] = True
        else:
            img["is_favorite"] = False
    
    if not target_image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 更新当前使用的起始帧
    target_url = target_image.get("url")
    source_url = target_image.get("source_url") or target_url
    target_shot["start_image_url"] = source_url
    target_shot["cached_start_image_url"] = target_url if isinstance(target_url, str) and target_url.startswith("/api/uploads/") else None
    target_shot["start_image_history"] = image_history
    
    # 保存项目
    storage.save_agent_project(project.to_dict())
    
    return {"success": True, "shot": target_shot}


# ========== Agent 批量生成 API ==========

class GenerateElementsRequest(BaseModel):
    visualStyle: str = "吉卜力动画风格"


class GenerateFramesRequest(BaseModel):
    visualStyle: str = "吉卜力动画风格"


class GenerateVideosRequest(BaseModel):
    resolution: str = "720p"


class ExecutePipelineRequest(BaseModel):
    visualStyle: str = "吉卜力动画风格"
    resolution: str = "720p"


class ExecutePipelineV2Request(BaseModel):
    visualStyle: str = "吉卜力动画风格"
    resolution: str = "720p"
    forceRegenerateVideos: bool = False


class SaveAudioTimelineRequest(BaseModel):
    audioTimeline: dict
    applyToProject: bool = True
    resetVideos: bool = True


class AudioTimelineMasterAudioRequest(BaseModel):
    shotDurations: Dict[str, float] = Field(default_factory=dict)
    # optional: ["narration", "mix"]; when omitted, generate both
    modes: Optional[List[str]] = None


class ExtractVideoAudioRequest(BaseModel):
    shotIds: Optional[List[str]] = None
    overwrite: bool = False


def deps.get_agent_executor() -> AgentExecutor:
    """获取 Agent 执行器"""
    return AgentExecutor(
        agent_service=deps.get_agent_service(),
        image_service=deps.get_image_service(),
        video_service=deps.get_video_service(),
        storage=storage
    )


from fastapi.responses import FileResponse, StreamingResponse
import json
import asyncio
import time
from datetime import datetime


@router.post("/projects/{project_id}/generate-elements")
async def generate_project_elements(project_id: str, request: GenerateElementsRequest):
    """批量生成项目的所有元素图片
    
    Flova 风格：生成完成后返回结果，前端可以展示并让用户确认
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()
    
    try:
        result = await executor.generate_all_elements(
            project,
            visual_style=request.visualStyle
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.get("/projects/{project_id}/generate-elements-stream")
async def generate_project_elements_stream(project_id: str, visualStyle: str = "吉卜力动画风格"):
    """流式生成项目的所有元素图片 (SSE)
    
    每生成一张图片就推送一次进度
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()
    
    async def event_generator():
        elements = list(project.elements.values())
        total = len(elements)
        generated = 0
        failed = 0
        
        # 发送开始事件
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        
        for i, element in enumerate(elements):
            # 跳过已有图片的元素
            existing_url = element.get("image_url")
            if existing_url and executor._should_skip_existing_image(existing_url):
                yield f"data: {json.dumps({'type': 'skip', 'element_id': element['id'], 'current': i + 1, 'total': total})}\n\n"
                continue
            
            try:
                # 发送生成中事件
                yield f"data: {json.dumps({'type': 'generating', 'element_id': element['id'], 'element_name': element['name'], 'current': i + 1, 'total': total})}\n\n"
                
                # 生成优化的提示词
                prompt_result = await executor.agent.generate_element_prompt(
                    element["name"],
                    element["type"],
                    element["description"],
                    visualStyle
                )
                
                if not prompt_result.get("success"):
                    prompt = f"{element['description']}, {visualStyle}, high quality, detailed"
                    negative_prompt = "blurry, low quality, distorted"
                else:
                    prompt = prompt_result.get("prompt", element["description"])
                    negative_prompt = prompt_result.get("negative_prompt", "blurry, low quality")
                
                # 生成图片
                image_result = await executor.image_service.generate(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=1024,
                    height=1024
                )
                
                source_url = image_result.get("url")
                cached_url = await executor._cache_remote_to_uploads(source_url, "image", ".jpg")
                display_url = cached_url if isinstance(cached_url, str) and cached_url.startswith("/api/uploads/") else source_url

                image_record = {
                    "id": f"img_{uuid.uuid4().hex[:8]}",
                    "url": display_url,
                    "source_url": source_url,
                    "created_at": datetime.utcnow().isoformat() + "Z",
                    "is_favorite": False,
                }

                image_history = element.get("image_history", [])
                if not isinstance(image_history, list):
                    image_history = []
                image_history.insert(0, image_record)
                has_favorite = any(isinstance(img, dict) and img.get("is_favorite") for img in image_history)

                # 更新元素
                project.elements[element["id"]]["image_history"] = image_history
                project.elements[element["id"]]["prompt"] = prompt
                if not has_favorite:
                    project.elements[element["id"]]["image_url"] = source_url
                    project.elements[element["id"]]["cached_image_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None

                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"asset_{element['id']}",
                    "url": display_url,
                    "type": "element",
                    "element_id": element["id"]
                })
                
                # 保存项目（每生成一张就保存）
                storage.save_agent_project(project.to_dict())
                
                generated += 1
                
                # 发送完成事件
                yield f"data: {json.dumps({'type': 'complete', 'element_id': element['id'], 'image_url': display_url, 'source_url': source_url, 'image_id': image_record['id'], 'current': i + 1, 'total': total, 'generated': generated})}\n\n"
                
            except Exception as e:
                failed += 1
                yield f"data: {json.dumps({'type': 'error', 'element_id': element['id'], 'error': str(e), 'current': i + 1, 'total': total})}\n\n"
        
        # 发送结束事件
        yield f"data: {json.dumps({'type': 'done', 'generated': generated, 'failed': failed, 'total': total})}\n\n"
    
    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


class RegenerateShotFrameRequest(BaseModel):
    visualStyle: str = "吉卜力动画风格"


@router.post("/projects/{project_id}/shots/{shot_id}/regenerate-frame")
async def regenerate_shot_frame(project_id: str, shot_id: str, request: RegenerateShotFrameRequest):
    """重新生成单个镜头的起始帧（带角色参考图）"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()
    
    # 找到目标镜头
    target_shot = None
    target_segment = None
    for segment in project.segments:
        for shot in segment.get("shots", []):
            if shot.get("id") == shot_id:
                target_shot = shot
                target_segment = segment
                break
        if target_shot:
            break
    
    if not target_shot:
        raise HTTPException(status_code=404, detail="镜头不存在")
    
    try:
        # 使用 agent_service 的方法生成单个起始帧
        result = await executor.regenerate_single_frame(
            project,
            shot_id,
            visual_style=request.visualStyle
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/projects/{project_id}/generate-frames")
async def generate_project_frames(project_id: str, request: GenerateFramesRequest):
    """批量生成项目的所有镜头起始帧

    需要先生成元素图片，起始帧会引用元素
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    try:
        result = await executor.generate_all_start_frames(
            project,
            visual_style=request.visualStyle
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.get("/projects/{project_id}/generate-frames-stream")
async def generate_project_frames_stream(
    project_id: str,
    visualStyle: str = "吉卜力动画风格",
    excludeShotIds: Optional[str] = None,
    mode: str = "missing"
):
    """流式生成项目的所有镜头起始帧 (SSE)

    每生成一张图片就推送一次进度，包含单个任务和总体进度百分比
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    async def event_generator():
        # ── Phase 4: 任务队列路径 ──
        if USE_TASK_QUEUE:
            async for chunk in _agent_generate_frames_via_queue(
                project, executor, project_id, visualStyle,
                excludeShotIds, mode,
            ):
                yield chunk
            return

        # ── 原有路径 ──
        regenerate = (mode or "").strip().lower() in ("regenerate", "regen", "force", "all")

        excluded_shot_ids = set()
        if excludeShotIds:
            for part in excludeShotIds.split(","):
                sid = (part or "").strip()
                if sid:
                    excluded_shot_ids.add(sid)

        # 收集所有镜头
        all_shots = []
        for segment in project.segments:
            if not isinstance(segment, dict):
                continue
            seg_id = segment.get("id") if isinstance(segment.get("id"), str) else ""
            shots = segment.get("shots") or []
            if not isinstance(shots, list):
                continue
            for shot in shots:
                if isinstance(shot, dict) and isinstance(shot.get("id"), str) and shot.get("id"):
                    all_shots.append((seg_id, shot))

        try:
            from collections import Counter
            prompt_key_counts = Counter()
            for _, s in all_shots:
                prompt0 = s.get("prompt") if isinstance(s.get("prompt"), str) else ""
                if not prompt0.strip():
                    prompt0 = s.get("description") if isinstance(s.get("description"), str) else ""
                k = executor._normalize_frame_prompt_key(prompt0)
                if k:
                    prompt_key_counts[k] += 1
        except Exception:
            prompt_key_counts = {}

        total = len(all_shots)
        generated = 0
        failed = 0
        skipped = 0

        # 发送开始事件
        yield f"data: {json.dumps({'type': 'start', 'total': total, 'percent': 0})}\n\n"

        for i, (segment_id, shot) in enumerate(all_shots):
            current = i + 1
            overall_percent = int((current / total) * 100) if total > 0 else 100
            shot_id = shot.get("id")
            shot_name = shot.get("name", "") if isinstance(shot.get("name"), str) else ""

            # 显式排除的镜头：无论是否已有起始帧都跳过（用于“除第一张外生成”等场景）
            if shot_id in excluded_shot_ids:
                skipped += 1
                yield f"data: {json.dumps({'type': 'skip', 'shot_id': shot_id, 'shot_name': shot_name, 'current': current, 'total': total, 'percent': overall_percent, 'reason': 'excluded'})}\n\n"
                continue

            # 跳过已有起始帧的镜头
            existing_url = shot.get("start_image_url")
            if (not regenerate) and existing_url and executor._should_skip_existing_image(existing_url):
                skipped += 1
                yield f"data: {json.dumps({'type': 'skip', 'shot_id': shot_id, 'shot_name': shot_name, 'current': current, 'total': total, 'percent': overall_percent, 'reason': 'already_has_frame'})}\n\n"
                continue

            try:
                # 批量重生成时，先把当前使用的图片尽量保留到历史版本
                if regenerate:
                    try:
                        source_prev = shot.get("start_image_url")
                        display_prev = shot.get("cached_start_image_url") or source_prev
                        if isinstance(display_prev, str) and display_prev.strip():
                            history = shot.get("start_image_history", [])
                            if not isinstance(history, list):
                                history = []
                            if not any(isinstance(h, dict) and h.get("url") == display_prev for h in history):
                                history.insert(0, {
                                    "id": f"img_prev_{int(time.time() * 1000)}",
                                    "url": display_prev,
                                    "source_url": source_prev,
                                    "created_at": datetime.now().isoformat(),
                                    "is_favorite": False
                                })
                            shot["start_image_history"] = history
                    except Exception:
                        pass

                # 发送生成中事件
                yield f"data: {json.dumps({'type': 'generating', 'shot_id': shot_id, 'shot_name': shot_name, 'current': current, 'total': total, 'percent': overall_percent, 'stage': 'prompt'})}\n\n"

                # 解析元素引用，构建完整提示词
                prompt = shot.get("prompt") if isinstance(shot.get("prompt"), str) else ""
                if not prompt.strip():
                    prompt = shot.get("description") if isinstance(shot.get("description"), str) else ""
                resolved_prompt = executor._resolve_element_references(prompt, project.elements)

                # 收集镜头中涉及的角色参考图
                reference_images = executor._collect_element_reference_images(prompt, project.elements)

                # 构建角色一致性提示
                character_consistency = executor._build_character_consistency_prompt(prompt, project.elements)

                # 添加风格和质量关键词
                prompt_key = executor._normalize_frame_prompt_key(prompt)
                extra_hint = ""
                try:
                    if prompt_key and int(prompt_key_counts.get(prompt_key, 0)) > 1:
                        extra_hint = executor._build_frame_prompt_hint(shot)
                except Exception:
                    extra_hint = ""

                if extra_hint:
                    full_prompt = f"{resolved_prompt}, ({extra_hint}), {character_consistency}, {visualStyle}, cinematic composition, consistent character design, same art style throughout, high quality, detailed"
                else:
                    full_prompt = f"{resolved_prompt}, {character_consistency}, {visualStyle}, cinematic composition, consistent character design, same art style throughout, high quality, detailed"

                # 发送图片生成阶段事件
                yield f"data: {json.dumps({'type': 'generating', 'shot_id': shot_id, 'shot_name': shot_name, 'current': current, 'total': total, 'percent': overall_percent, 'stage': 'image', 'reference_count': len(reference_images)})}\n\n"

                # 生成图片
                image_result = await executor.image_service.generate(
                    prompt=full_prompt,
                    reference_images=reference_images,
                    negative_prompt="blurry, low quality, distorted, deformed, inconsistent character, different art style, multiple styles",
                    width=1280,
                    height=720
                )

                source_url = image_result.get("url")
                cached_url = await executor._cache_remote_to_uploads(source_url, "image", ".jpg")
                display_url = cached_url if isinstance(cached_url, str) and cached_url.startswith("/api/uploads/") else source_url

                # 创建图片历史记录
                image_id = f"img_{int(time.time() * 1000)}"
                image_record = {
                    "id": image_id,
                    "url": display_url,
                    "source_url": source_url,
                    "created_at": datetime.now().isoformat(),
                    "is_favorite": False
                }

                # 更新镜头数据
                history = shot.get("start_image_history", [])
                if not isinstance(history, list):
                    history = []
                history.insert(0, image_record)
                has_favorite = any(isinstance(img, dict) and img.get("is_favorite") for img in history)

                shot["resolved_prompt"] = full_prompt
                shot["status"] = "frame_ready"
                shot["start_image_history"] = history
                if not has_favorite:
                    shot["start_image_url"] = source_url
                    shot["cached_start_image_url"] = display_url if isinstance(display_url, str) and display_url.startswith("/api/uploads/") else None

                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"frame_{shot['id']}_{image_id}",
                    "url": display_url,
                    "type": "start_frame",
                    "shot_id": shot["id"]
                })

                # 保存项目
                storage.save_agent_project(project.to_dict())

                generated += 1

                # 发送完成事件
                yield f"data: {json.dumps({'type': 'complete', 'shot_id': shot_id, 'shot_name': shot_name, 'image_url': display_url, 'source_url': source_url, 'image_id': image_id, 'current': current, 'total': total, 'generated': generated, 'percent': overall_percent})}\n\n"

            except Exception as e:
                failed += 1
                shot["status"] = "frame_failed"
                # 尽量持久化失败状态，避免前端一直显示 pending
                try:
                    storage.save_agent_project(project.to_dict())
                except Exception:
                    pass
                yield f"data: {json.dumps({'type': 'error', 'shot_id': shot_id, 'shot_name': shot_name, 'error': str(e), 'current': current, 'total': total, 'percent': overall_percent})}\n\n"

        # 发送结束事件
        yield f"data: {json.dumps({'type': 'done', 'generated': generated, 'failed': failed, 'skipped': skipped, 'total': total, 'percent': 100})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/projects/{project_id}/generate-videos")
async def generate_project_videos(project_id: str, request: GenerateVideosRequest):
    """批量生成项目的所有视频

    需要先生成起始帧，视频基于起始帧生成
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    # 若存在已确认的 audio_timeline，则在生成前应用到 shots.duration（作为视频时长约束）。
    tl = project_data.get("audio_timeline")
    if isinstance(tl, dict) and tl.get("confirmed") is True:
        try:
            executor.apply_audio_timeline_to_project(project, tl, reset_videos=False)
            storage.save_agent_project(project.to_dict())
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid audio_timeline: {str(e)}")

    try:
        result = await executor.generate_all_videos(
            project,
            resolution=request.resolution
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@router.post("/projects/{project_id}/generate-audio")
async def generate_project_audio(project_id: str, request: GenerateAgentAudioRequest):
    """为 Agent 项目生成旁白/对白音频（独立 TTS），并写入 project.audio_assets + shot.voice_audio_url。

    说明：视频本身仍可保留环境音/音效；此接口只生成“人声轨”，用于导出/混音时叠加。
    """
    import io
    import re
    import subprocess
    import tempfile
    import wave
    from pathlib import Path

    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)

    settings = storage.get_settings() or {}
    tts_settings = TTSConfig.model_validate(settings.get("tts") or {})

    provider = str(tts_settings.provider or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
    is_fish_tts = provider.startswith("fish")
    is_bailian_tts = provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"} or provider.startswith("aliyun_bailian")
    is_custom_tts = provider.startswith("custom_")

    # Keep these names for downstream code.
    appid = ""
    access_token = ""
    base_url = ""
    endpoint = "https://openspeech.bytedance.com/api/v1/tts"
    cluster = "volcano_tts"
    model = "seed-tts-1.1"
    encoding = "mp3"
    rate = 24000
    speed_ratio = 1.0
    bailian_workspace = ""
    custom_openai_base_url = ""
    custom_openai_api_key = ""
    custom_openai_model = ""

    # Auto speed-fit (audio-driven): when user sets a total duration in creative_brief.duration (or targetDurationSeconds),
    # and request.speedRatio is not provided, estimate speech length and pick a reasonable speedRatio.
    brief = project.creative_brief if isinstance(project.creative_brief, dict) else {}

    # Audio workflow mode (tts_all vs video_dialogue).
    workflow = str(brief.get("audioWorkflowResolved") or "").strip().lower()
    if workflow not in {"tts_all", "video_dialogue"}:
        try:
            workflow = deps.get_agent_executor().resolve_audio_workflow(project)
        except Exception:
            workflow = "tts_all"

    fields_set = getattr(request, "model_fields_set", set()) or set()
    include_narration = bool(request.includeNarration)
    include_dialogue = bool(request.includeDialogue)
    # In "video_dialogue" mode, default to narration-only unless client explicitly sets includeDialogue.
    if workflow == "video_dialogue" and "includeDialogue" not in fields_set:
        include_dialogue = False

    def coerce_positive_float(val: Any) -> Optional[float]:
        try:
            v = float(val)
        except Exception:
            return None
        if not math.isfinite(v) or v <= 0:
            return None
        return v

    requested_speed = coerce_positive_float(request.speedRatio)
    hinted_speed = coerce_positive_float(brief.get("ttsSpeedRatio"))

    target_seconds: Optional[float] = None
    td = brief.get("targetDurationSeconds")
    if isinstance(td, (int, float)):
        target_seconds = float(td) if float(td) > 0 else None
    elif isinstance(td, str) and td.strip():
        target_seconds = coerce_positive_float(td.strip())
    if target_seconds is None:
        target_seconds = deps._parse_duration_seconds(brief.get("duration")) if isinstance(brief.get("duration"), str) else None

    auto_speed: Optional[float] = None
    if requested_speed is None and hinted_speed is None and target_seconds and not (request.shotIds or []):
        parts: List[str] = []
        segs = project.segments or []
        if isinstance(segs, list):
            for seg in segs:
                if not isinstance(seg, dict):
                    continue
                for shot in (seg.get("shots") or []):
                    if not isinstance(shot, dict):
                        continue
                    narration = shot.get("narration") or ""
                    dialogue_script = shot.get("dialogue_script") or shot.get("dialogueScript") or shot.get("dialogue") or ""
                    if include_narration and isinstance(narration, str) and narration.strip():
                        parts.append(deps._sanitize_tts_text(narration.strip()))
                    if include_dialogue and isinstance(dialogue_script, str) and dialogue_script.strip():
                        parts.append(deps._sanitize_tts_text(deps._extract_dialogue_text(dialogue_script)))
        text = " ".join([p for p in parts if p]).strip()
        est = deps._estimate_speech_seconds(text, speed=1.0) if text else 0.0
        if est > 0.01:
            auto_speed = est / float(target_seconds)
            auto_speed = max(0.85, min(1.25, float(auto_speed)))
            # Persist hint for subsequent audio generations.
            try:
                if isinstance(project.creative_brief, dict):
                    project.creative_brief.setdefault("targetDurationSeconds", str(int(round(float(target_seconds)))))
                    project.creative_brief["ttsSpeedRatio"] = f"{float(auto_speed):.2f}"
            except Exception:
                pass

    speed_choice = requested_speed or hinted_speed or auto_speed

    if is_fish_tts:
        fish_cfg = tts_settings.fish
        access_token = str(fish_cfg.apiKey or "").strip()
        if not access_token:
            raise HTTPException(status_code=400, detail="未配置 Fish TTS：请在设置中填写 Fish.apiKey")
        base_url = str(fish_cfg.baseUrl or "").strip() or "https://api.fish.audio"
        model = str(fish_cfg.model or "").strip() or "speech-1.5"
        if model.startswith("seed-"):
            model = "speech-1.5"
        encoding = str(request.encoding or fish_cfg.encoding or "mp3").strip() or "mp3"
        rate = int(request.rate or fish_cfg.rate or 24000)
        speed_ratio = float(speed_choice or coerce_positive_float(fish_cfg.speedRatio) or 1.0)
    elif is_bailian_tts:
        bailian_cfg = tts_settings.bailian
        access_token = str(bailian_cfg.apiKey or "").strip()
        if not access_token:
            raise HTTPException(status_code=400, detail="未配置阿里百炼 TTS：请在设置中填写 Bailian.apiKey")
        base_url = str(bailian_cfg.baseUrl or "").strip() or "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
        bailian_workspace = str(bailian_cfg.workspace or "").strip()
        model = str(bailian_cfg.model or "").strip() or "cosyvoice-v1"
        encoding = str(request.encoding or bailian_cfg.encoding or "mp3").strip() or "mp3"
        rate = int(request.rate or bailian_cfg.rate or 24000)
        speed_ratio = float(speed_choice or coerce_positive_float(bailian_cfg.speedRatio) or 1.0)
    elif is_custom_tts:
        custom_provider = storage.get_custom_provider(provider) or {}
        if not custom_provider or str(custom_provider.get("category") or "") != "tts":
            raise HTTPException(status_code=400, detail="自定义 TTS 配置不存在或类别不匹配（请先在设置里新增 tts 自定义配置）")
        custom_openai_api_key = str(custom_provider.get("apiKey") or "").strip()
        custom_openai_base_url = str(custom_provider.get("baseUrl") or "").strip()
        custom_openai_model = str(custom_provider.get("model") or "").strip()
        if not custom_openai_api_key or not custom_openai_base_url:
            raise HTTPException(status_code=400, detail="自定义 TTS 缺少 apiKey/baseUrl")

        custom_cfg = tts_settings.custom
        encoding = str(request.encoding or custom_cfg.encoding or "mp3").strip() or "mp3"
        rate = int(request.rate or custom_cfg.rate or 24000)
        speed_ratio = float(speed_choice or coerce_positive_float(custom_cfg.speedRatio) or 1.0)
    else:
        volc_cfg = tts_settings.volc
        appid = str(volc_cfg.appid or "").strip()
        access_token = str(volc_cfg.accessToken or "").strip()
        if not appid or not access_token:
            raise HTTPException(status_code=400, detail="未配置 TTS：请在设置中填写 Volc 的 appid 与 accessToken")
        endpoint = str(volc_cfg.endpoint or "").strip() or "https://openspeech.bytedance.com/api/v1/tts"
        cluster = str(volc_cfg.cluster or "volcano_tts").strip() or "volcano_tts"
        model = str(volc_cfg.model or "seed-tts-1.1").strip() or "seed-tts-1.1"
        encoding = str(request.encoding or volc_cfg.encoding or "mp3").strip() or "mp3"
        rate = int(request.rate or volc_cfg.rate or 24000)
        speed_ratio = float(speed_choice or coerce_positive_float(volc_cfg.speedRatio) or 1.0)

    def check_ffmpeg() -> bool:
        try:
            p = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            return p.returncode == 0
        except Exception:
            return False

    ffmpeg_ok = check_ffmpeg()

    def estimate_pcm_duration_ms(pcm_bytes: bytes, sample_rate: int) -> int:
        try:
            if not pcm_bytes or int(sample_rate) <= 0:
                return 0
            # OpenSpeech pcm: 16-bit mono @ sample_rate
            frames = len(pcm_bytes) // 2
            return int(frames * 1000 / int(sample_rate))
        except Exception:
            return 0

    def pcm_silence_bytes(ms: int, sample_rate: int) -> bytes:
        if int(ms) <= 0 or int(sample_rate) <= 0:
            return b""
        frames = int(int(sample_rate) * (float(ms) / 1000.0))
        return b"\x00\x00" * max(frames, 0)

    def pcm_to_wav_bytes(pcm_bytes: bytes, sample_rate: int) -> bytes:
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(int(sample_rate))
            wf.writeframes(pcm_bytes or b"")
        return buf.getvalue()

    def looks_like_voice_type(value: str) -> bool:
        v = (value or "").strip()
        if not v:
            return False
        if is_fish_tts or is_bailian_tts or is_custom_tts:
            # Fish/Bailian/Custom voices are provider-specific free-form strings.
            return True
        # 常见 voice_type 形态：zh_female_xxx / zh_male_xxx / en_... 等
        return bool(re.match(r"^[a-z]{2}_[a-z0-9_\\-]+$", v, flags=re.IGNORECASE))

    # 默认音色：优先请求覆盖，其次 settings.tts(按 provider) 默认，其次 creative_brief；若均为空则自动匹配（仅使用内置音色库）
    brief = project.creative_brief if isinstance(project.creative_brief, dict) else {}
    if is_fish_tts:
        provider_defaults = tts_settings.fish
    elif is_bailian_tts:
        provider_defaults = tts_settings.bailian
    elif is_custom_tts:
        provider_defaults = tts_settings.custom
    else:
        provider_defaults = tts_settings.volc

    def normalize_voice_type(value: str) -> str:
        v = (value or "").strip()
        return v if (v and looks_like_voice_type(v)) else ""

    narrator_voice = normalize_voice_type(
        request.narratorVoiceType
        or getattr(provider_defaults, "narratorVoiceType", "")
        or brief.get("narratorVoiceType")
        or brief.get("narratorVoiceProfile")
        or ""
    )

    dialogue_voice_legacy = normalize_voice_type(
        request.dialogueVoiceType or getattr(provider_defaults, "dialogueVoiceType", "") or ""
    )
    dialogue_voice_male = normalize_voice_type(
        request.dialogueMaleVoiceType or getattr(provider_defaults, "dialogueMaleVoiceType", "") or ""
    )
    dialogue_voice_female = normalize_voice_type(
        request.dialogueFemaleVoiceType or getattr(provider_defaults, "dialogueFemaleVoiceType", "") or ""
    )

    # 兼容旧设置：dialogueVoiceType 作为男女对白的兜底
    if dialogue_voice_legacy:
        if not dialogue_voice_male:
            dialogue_voice_male = dialogue_voice_legacy
        if not dialogue_voice_female:
            dialogue_voice_female = dialogue_voice_legacy

    auto_narrator_voice = ""
    if not (is_fish_tts or is_bailian_tts or is_custom_tts):
        auto_narrator_voice = VolcTTSService.auto_pick_voice_type(
            role="narration",
            name="narrator",
            description=str(brief.get("narratorVoiceProfile") or ""),
            profile=str(brief.get("narratorVoiceType") or ""),
        )
    else:
        auto_narrator_voice = narrator_voice or dialogue_voice_male or dialogue_voice_female or dialogue_voice_legacy
        if not auto_narrator_voice:
            if is_fish_tts:
                msg = "Fish TTS 未配置 voice model id：请在设置的“默认旁白/对白 voice_type”中填写 Fish 的 reference_id"
            elif is_bailian_tts:
                msg = "阿里百炼 TTS 未配置 voice：请在设置的“默认旁白/对白 voice”中填写可用音色名称"
            else:
                msg = "自定义 TTS 未配置 voice：请在设置的“默认旁白/对白 voice”中填写可用音色名称"
            raise HTTPException(status_code=400, detail=msg)

    # 建立 speaker -> element 映射：兼容 “角色名” 与 “Element_XXX” 等写法
    element_lookup: Dict[str, Dict[str, Any]] = {}
    try:
        elems = project.elements or {}
        if isinstance(elems, dict):
            for k, e in elems.items():
                if not isinstance(e, dict):
                    continue
                if isinstance(k, str) and k.strip():
                    element_lookup[k.strip().lower()] = e
                if isinstance(e.get("id"), str) and str(e.get("id")).strip():
                    element_lookup[str(e.get("id")).strip().lower()] = e
                if isinstance(e.get("name"), str) and str(e.get("name")).strip():
                    element_lookup[str(e.get("name")).strip().lower()] = e
    except Exception:
        element_lookup = {}

    def resolve_element_for_speaker(speaker: str) -> Optional[Dict[str, Any]]:
        sl = (speaker or "").strip().lower()
        if not sl:
            return None
        if sl in element_lookup:
            return element_lookup.get(sl)
        m = re.search(r"(element_[a-z0-9_]+)", sl, flags=re.IGNORECASE)
        if m:
            key = m.group(1).strip().lower()
            if key in element_lookup:
                return element_lookup.get(key)
        # 兼容 speaker="KATE" 这类（去掉 Element_ 前缀）
        if sl.startswith("element_"):
            short = sl[len("element_") :].strip()
            if short and short in element_lookup:
                return element_lookup.get(short)
        return None

    fish_tts: Optional[FishTTSService] = None
    volc_tts: Optional[VolcTTSService] = None
    bailian_tts: Optional[DashScopeTTSService] = None
    custom_tts: Optional[OpenAITTSService] = None

    if is_fish_tts:
        model_hdr = model.strip()
        if not model_hdr or model_hdr.startswith("seed-"):
            model_hdr = "speech-1.5"
        fish_tts = FishTTSService(
            FishTTSConfig(
                api_key=access_token,
                base_url=base_url or "https://api.fish.audio",
                model=model_hdr,
            )
        )
    elif is_bailian_tts:
        bailian_tts = DashScopeTTSService(
            DashScopeTTSConfig(
                api_key=access_token,
                base_url=base_url or "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                model=model or "cosyvoice-v1",
                workspace=bailian_workspace,
            )
        )
    elif is_custom_tts:
        custom_tts = OpenAITTSService(
            OpenAITTSConfig(
                api_key=custom_openai_api_key,
                base_url=custom_openai_base_url,
                model=custom_openai_model,
            )
        )
    else:
        volc_tts = VolcTTSService(
            VolcTTSConfig(
                appid=appid,
                access_token=access_token,
                endpoint=endpoint,
                cluster=cluster,
                model=model,
            )
        )

    async def tts_synthesize(*, text: str, voice: str, out_encoding: str) -> tuple[bytes, int]:
        if is_fish_tts:
            if not fish_tts:
                raise RuntimeError("Fish TTS not initialized")
            return await fish_tts.synthesize(
                text=text,
                reference_id=voice,
                encoding=out_encoding,
                speed_ratio=speed_ratio,
                rate=rate,
            )
        if is_bailian_tts:
            if not bailian_tts:
                raise RuntimeError("Bailian TTS not initialized")
            return await bailian_tts.synthesize(
                text=text,
                voice=voice,
                encoding=out_encoding,
                speed_ratio=speed_ratio,
                rate=rate,
            )
        if is_custom_tts:
            if not custom_tts:
                raise RuntimeError("Custom TTS not initialized")
            return await custom_tts.synthesize(
                text=text,
                voice=voice,
                encoding=out_encoding,
                speed_ratio=speed_ratio,
            )
        if not volc_tts:
            raise RuntimeError("Volc TTS not initialized")
        return await volc_tts.synthesize(
            text=text,
            voice_type=voice,
            encoding=out_encoding,
            speed_ratio=speed_ratio,
            rate=rate,
        )

    generated = 0
    skipped = 0
    failed = 0
    results: List[Dict[str, Any]] = []

    audio_assets: List[Dict[str, Any]] = list(project.audio_assets or [])

    # 清理旧的 voice 资产（按 shot_id）
    def remove_voice_assets_for_shot(shot_id: str):
        nonlocal audio_assets
        audio_assets = [
            a
            for a in audio_assets
            if str(a.get("shot_id") or "") != shot_id
            or a.get("type") not in ("narration", "dialogue")
        ]

    # 输出目录（复用 uploads/audio）
    audio_dir = Path(UPLOAD_DIR) / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    selected_shot_ids: Optional[set[str]] = None
    if isinstance(request.shotIds, list) and request.shotIds:
        selected_shot_ids = {str(s).strip() for s in request.shotIds if isinstance(s, str) and str(s).strip()}
        if not selected_shot_ids:
            selected_shot_ids = None

    # 逐镜头生成
    for seg in project.segments or []:
        for shot in seg.get("shots", []) if isinstance(seg, dict) else []:
            shot_id = str(shot.get("id") or "").strip()
            if not shot_id:
                continue
            if selected_shot_ids is not None and shot_id not in selected_shot_ids:
                continue

            if not request.overwrite and shot.get("voice_audio_url"):
                skipped += 1
                results.append({"shot_id": shot_id, "status": "skipped", "message": "已有旁白/对白音频"})
                continue

            narration = shot.get("narration")
            narration = narration if isinstance(narration, str) else ""
            narration = deps._sanitize_tts_text(narration)

            dialogue_script = shot.get("dialogue_script") or shot.get("dialogueScript") or shot.get("dialogue")
            dialogue_script = dialogue_script if isinstance(dialogue_script, str) else ""
            dialogue_script = dialogue_script.strip()

            segments_to_say: List[Dict[str, str]] = []

            if include_narration and narration and deps._is_speakable_text(narration):
                segments_to_say.append({"role": "narration", "voice_type": narrator_voice or auto_narrator_voice, "text": narration})

            if include_dialogue and dialogue_script:
                for raw_line in dialogue_script.splitlines():
                    line = raw_line.strip()
                    if not line:
                        continue
                    # 容错：去掉常见项目符号/编号前缀
                    line = re.sub(r"^[-*•\u2022]\s*", "", line)
                    line = re.sub(r"^\d+\s*[.)、]\s*", "", line)
                    m = re.match(r"^([^:：]{1,40})[:：]\\s*(.+)$", line)
                    if not m:
                        # 不符合格式，按默认对白音色朗读整行
                        fallback_voice = dialogue_voice_legacy or dialogue_voice_male or dialogue_voice_female or narrator_voice or auto_narrator_voice
                        # 尝试去掉类似“角色 (character)”的非朗读前缀
                        line = re.sub(r"^[^:：]{1,40}\\s*[（(]\\s*(?:character|object|scene)\\s*[)）]\\s*", "", line, flags=re.IGNORECASE)
                        line = re.sub(r"^\\[Element_[A-Za-z0-9_\\-]+\\]\\s*", "", line)
                        spoken = deps._sanitize_tts_text(line)
                        if spoken and deps._is_speakable_text(spoken):
                            segments_to_say.append({"role": "dialogue", "voice_type": fallback_voice, "text": spoken})
                        continue

                    speaker = deps._sanitize_speaker_name(m.group(1).strip())
                    speaker = speaker.strip(" \t【】[]（）()")
                    content = deps._sanitize_tts_text(m.group(2))
                    if not content or not deps._is_speakable_text(content):
                        continue

                    voice_type = ""
                    elem = resolve_element_for_speaker(speaker)
                    if isinstance(elem, dict):
                        vt = (elem.get("voice_type") or "").strip()
                        if looks_like_voice_type(vt):
                            voice_type = vt
                        else:
                            vp = (elem.get("voice_profile") or "").strip()
                            if looks_like_voice_type(vp):
                                voice_type = vp

                    if not voice_type:
                        prefer_gender = None
                        if isinstance(elem, dict):
                            g = elem.get("gender") or elem.get("sex")
                            if isinstance(g, str):
                                gl = g.strip().lower()
                                if gl in ("male", "m", "man", "boy", "男", "男性"):
                                    prefer_gender = "male"
                                elif gl in ("female", "f", "woman", "girl", "女", "女性"):
                                    prefer_gender = "female"

                        if prefer_gender is None:
                            blob = speaker
                            if isinstance(elem, dict):
                                blob = "\n".join(
                                    [
                                        speaker,
                                        str(elem.get("description") or ""),
                                        str(elem.get("voice_profile") or ""),
                                    ]
                                )
                            prefer_gender = VolcTTSService.detect_gender(blob) or VolcTTSService.detect_gender(content)

                        if prefer_gender == "male" and dialogue_voice_male:
                            voice_type = dialogue_voice_male
                        elif prefer_gender == "female" and dialogue_voice_female:
                            voice_type = dialogue_voice_female
                        elif dialogue_voice_legacy:
                            voice_type = dialogue_voice_legacy
                        elif narrator_voice:
                            voice_type = narrator_voice
                        else:
                            voice_type = VolcTTSService.auto_pick_voice_type(
                                role="dialogue",
                                name=speaker,
                                description=str(elem.get("description") or "") if isinstance(elem, dict) else "",
                                profile=str(elem.get("voice_profile") or "") if isinstance(elem, dict) else "",
                                prefer_gender=prefer_gender,
                            )

                    # 兜底：auto_pick 可能返回空，避免对白整行被跳过
                    if not voice_type:
                        voice_type = (
                            dialogue_voice_male
                            or dialogue_voice_female
                            or dialogue_voice_legacy
                            or narrator_voice
                            or auto_narrator_voice
                        )

                    if voice_type:
                        segments_to_say.append({"role": "dialogue", "voice_type": voice_type, "text": content})

            if not segments_to_say:
                skipped += 1
                results.append({"shot_id": shot_id, "status": "skipped", "message": "无有效旁白/对白文本"})
                continue

            use_pcm_concat = (not ffmpeg_ok) and (len(segments_to_say) > 1)

            try:
                def _write_audio_file(label: str, audio_bytes: bytes, ext: str) -> str:
                    fn = f"{project_id}_{shot_id}_{label}_{uuid.uuid4().hex[:8]}.{ext}"
                    fp = audio_dir / fn
                    fp.write_bytes(audio_bytes)
                    return f"/api/uploads/audio/{fn}"

                def _concat_paths_to_bytes(paths: List[Path], base_name: str) -> Tuple[bytes, str]:
                    if not paths:
                        return b"", ""
                    if len(paths) == 1:
                        return paths[0].read_bytes(), encoding

                    inputs = []
                    filter_inputs = []
                    for idx, p in enumerate(paths):
                        inputs.extend(["-i", str(p)])
                        filter_inputs.append(f"[{idx}:a]")
                    filter_complex = "".join(filter_inputs) + f"concat=n={len(paths)}:v=0:a=1[a]"

                    def _run_concat(out_ext: str, codec: str) -> bytes:
                        out_path = temp_dir / f"{base_name}.{out_ext}"
                        cmd = [
                            "ffmpeg",
                            "-y",
                            *inputs,
                            "-filter_complex",
                            filter_complex,
                            "-map",
                            "[a]",
                            "-c:a",
                            codec,
                            str(out_path),
                        ]
                        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                        if proc.returncode != 0 or not out_path.exists():
                            raise Exception(proc.stderr.decode("utf-8", errors="ignore")[:2000])
                        return out_path.read_bytes()

                    try:
                        if encoding.lower() == "mp3":
                            return _run_concat("mp3", "libmp3lame"), "mp3"
                        # 默认使用 aac（容器扩展名用 m4a 更通用）
                        out_ext = "m4a" if encoding.lower() in ("aac", "m4a") else encoding.lower()
                        return _run_concat(out_ext, "aac"), out_ext
                    except Exception:
                        return _run_concat("m4a", "aac"), "m4a"

                # --- synthesize once, then fan-out to tracks ---
                total_ms = 0
                narration_ms = 0
                dialogue_ms = 0
                mix_bytes: bytes = b""
                mix_ext = ""
                narration_bytes: bytes = b""
                narration_ext = ""
                dialogue_bytes: bytes = b""
                dialogue_ext = ""

                if use_pcm_concat:
                    # 无 FFmpeg 时，用 pcm 生成并在服务端直接拼接成 wav，避免阻塞对白+旁白的多段合成。
                    silence_ms = 200

                    role_remaining = {"narration": 0, "dialogue": 0}
                    for p in segments_to_say:
                        role = str(p.get("role") or "dialogue")
                        if role in role_remaining:
                            role_remaining[role] += 1

                    pcm_chunks: List[bytes] = []
                    pcm_by_role: Dict[str, List[bytes]] = {"narration": [], "dialogue": []}

                    for i, part in enumerate(segments_to_say):
                        text = part.get("text", "").strip()
                        if text and text[-1] not in "。！？.!?":
                            text = text + "。"

                        try:
                            audio_bytes, duration_ms = await tts_synthesize(
                                text=text,
                                voice=part.get("voice_type", ""),
                                out_encoding="pcm",
                            )
                        except Exception:
                            fallback_voice = narrator_voice or auto_narrator_voice
                            if fallback_voice and fallback_voice != part.get("voice_type", ""):
                                audio_bytes, duration_ms = await tts_synthesize(
                                    text=text,
                                    voice=fallback_voice,
                                    out_encoding="pcm",
                                )
                            else:
                                raise

                        pcm_chunks.append(audio_bytes)
                        seg_ms = int(duration_ms or 0) or estimate_pcm_duration_ms(audio_bytes, rate)
                        total_ms += max(int(seg_ms or 0), 0)

                        role = str(part.get("role") or "dialogue")
                        if role in pcm_by_role:
                            pcm_by_role[role].append(audio_bytes)
                            if role == "narration":
                                narration_ms += max(int(seg_ms or 0), 0)
                            elif role == "dialogue":
                                dialogue_ms += max(int(seg_ms or 0), 0)

                            role_remaining[role] = max(0, int(role_remaining.get(role, 0)) - 1)
                            if role_remaining.get(role, 0) > 0 and silence_ms > 0:
                                pcm_by_role[role].append(pcm_silence_bytes(silence_ms, rate))
                                if role == "narration":
                                    narration_ms += silence_ms
                                elif role == "dialogue":
                                    dialogue_ms += silence_ms

                        if i < len(segments_to_say) - 1 and silence_ms > 0:
                            pcm_chunks.append(pcm_silence_bytes(silence_ms, rate))
                            total_ms += silence_ms

                    mix_bytes = pcm_to_wav_bytes(b"".join(pcm_chunks), rate)
                    mix_ext = "wav"

                    if pcm_by_role["narration"]:
                        narration_bytes = pcm_to_wav_bytes(b"".join(pcm_by_role["narration"]), rate)
                        narration_ext = "wav"
                    if pcm_by_role["dialogue"]:
                        dialogue_bytes = pcm_to_wav_bytes(b"".join(pcm_by_role["dialogue"]), rate)
                        dialogue_ext = "wav"
                else:
                    with tempfile.TemporaryDirectory() as td:
                        temp_dir = Path(td)
                        part_files: List[Path] = []
                        role_files: Dict[str, List[Path]] = {"narration": [], "dialogue": []}

                        for i, part in enumerate(segments_to_say):
                            text = part.get("text", "").strip()
                            if text and text[-1] not in "。！？.!?":
                                text = text + "。"

                            try:
                                audio_bytes, duration_ms = await tts_synthesize(
                                    text=text,
                                    voice=part.get("voice_type", ""),
                                    out_encoding=encoding,
                                )
                            except Exception:
                                fallback_voice = narrator_voice or auto_narrator_voice
                                if fallback_voice and fallback_voice != part.get("voice_type", ""):
                                    audio_bytes, duration_ms = await tts_synthesize(
                                        text=text,
                                        voice=fallback_voice,
                                        out_encoding=encoding,
                                    )
                                else:
                                    raise

                            seg_ms = int(duration_ms or 0)
                            total_ms += max(seg_ms, 0)

                            role = str(part.get("role") or "dialogue")
                            if role == "narration":
                                narration_ms += max(seg_ms, 0)
                            elif role == "dialogue":
                                dialogue_ms += max(seg_ms, 0)

                            part_path = temp_dir / f"part_{i}.{encoding}"
                            part_path.write_bytes(audio_bytes)
                            part_files.append(part_path)
                            if role in role_files:
                                role_files[role].append(part_path)

                        mix_bytes, mix_ext = _concat_paths_to_bytes(part_files, "voice_mix")
                        if role_files["narration"]:
                            narration_bytes, narration_ext = _concat_paths_to_bytes(role_files["narration"], "voice_narration")
                        if role_files["dialogue"]:
                            dialogue_bytes, dialogue_ext = _concat_paths_to_bytes(role_files["dialogue"], "voice_dialogue")

                # 更新镜头 & 资产列表
                if request.overwrite:
                    remove_voice_assets_for_shot(shot_id)

                voice_url = ""
                narration_url = ""
                dialogue_url = ""

                if narration_bytes and not dialogue_bytes:
                    narration_url = _write_audio_file("narration", narration_bytes, narration_ext or mix_ext or encoding)
                    voice_url = narration_url
                    total_ms = narration_ms or total_ms
                    shot["narration_audio_url"] = narration_url
                    shot["narration_audio_duration_ms"] = int(narration_ms or 0)
                    shot.pop("dialogue_audio_url", None)
                    shot.pop("dialogue_audio_duration_ms", None)
                elif dialogue_bytes and not narration_bytes:
                    dialogue_url = _write_audio_file("dialogue", dialogue_bytes, dialogue_ext or mix_ext or encoding)
                    voice_url = dialogue_url
                    total_ms = dialogue_ms or total_ms
                    shot["dialogue_audio_url"] = dialogue_url
                    shot["dialogue_audio_duration_ms"] = int(dialogue_ms or 0)
                    shot.pop("narration_audio_url", None)
                    shot.pop("narration_audio_duration_ms", None)
                else:
                    if narration_bytes:
                        narration_url = _write_audio_file("narration", narration_bytes, narration_ext or mix_ext or encoding)
                        shot["narration_audio_url"] = narration_url
                        shot["narration_audio_duration_ms"] = int(narration_ms or 0)
                    else:
                        shot.pop("narration_audio_url", None)
                        shot.pop("narration_audio_duration_ms", None)
                    if dialogue_bytes:
                        dialogue_url = _write_audio_file("dialogue", dialogue_bytes, dialogue_ext or mix_ext or encoding)
                        shot["dialogue_audio_url"] = dialogue_url
                        shot["dialogue_audio_duration_ms"] = int(dialogue_ms or 0)
                    else:
                        shot.pop("dialogue_audio_url", None)
                        shot.pop("dialogue_audio_duration_ms", None)

                    if not mix_bytes:
                        raise RuntimeError("voice mix is empty")
                    voice_url = _write_audio_file("voice", mix_bytes, mix_ext or encoding)

                shot["voice_audio_url"] = voice_url
                shot["voice_audio_duration_ms"] = int(total_ms or 0)

                if narration_url:
                    audio_assets.append({
                        "id": f"narration_{shot_id}",
                        "url": narration_url,
                        "type": "narration",
                        "shot_id": shot_id,
                        "duration_ms": int(narration_ms or 0),
                    })
                if dialogue_url:
                    audio_assets.append({
                        "id": f"dialogue_{shot_id}",
                        "url": dialogue_url,
                        "type": "dialogue",
                        "shot_id": shot_id,
                        "duration_ms": int(dialogue_ms or 0),
                    })

                generated += 1
                results.append({
                    "shot_id": shot_id,
                    "status": "ok",
                    "voice_url": voice_url,
                    "narration_url": narration_url,
                    "dialogue_url": dialogue_url,
                    "voice_duration_ms": int(total_ms or 0),
                    "narration_duration_ms": int(narration_ms or 0),
                    "dialogue_duration_ms": int(dialogue_ms or 0),
                })
            except Exception as e:
                failed += 1
                results.append({"shot_id": shot_id, "status": "failed", "message": str(e)})

    project.audio_assets = audio_assets
    storage.save_agent_project(project.to_dict())

    return {"success": failed == 0, "generated": generated, "skipped": skipped, "failed": failed, "results": results}


@router.post("/projects/{project_id}/clear-audio")
async def clear_project_audio(project_id: str, request: ClearAgentAudioRequest):
    """清除 Agent 项目已生成的人声轨（旁白/对白）音频引用，并可选删除本地上传文件。"""
    from pathlib import Path

    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)

    selected_shot_ids: Optional[set[str]] = None
    if isinstance(request.shotIds, list) and request.shotIds:
        selected_shot_ids = {str(s).strip() for s in request.shotIds if isinstance(s, str) and str(s).strip()}
        if not selected_shot_ids:
            selected_shot_ids = None

    audio_dir = (Path(UPLOAD_DIR) / "audio").resolve()
    removed_urls: List[str] = []
    cleared_shots = 0

    for seg in project.segments or []:
        for shot in seg.get("shots", []) if isinstance(seg, dict) else []:
            shot_id = str(shot.get("id") or "").strip()
            if not shot_id:
                continue
            if selected_shot_ids is not None and shot_id not in selected_shot_ids:
                continue
            urls = [
                str(shot.get("voice_audio_url") or "").strip(),
                str(shot.get("narration_audio_url") or "").strip(),
                str(shot.get("dialogue_audio_url") or "").strip(),
            ]
            for u in urls:
                if u:
                    removed_urls.append(u)

            cleared_any = False
            for k in (
                "voice_audio_url",
                "voice_audio_duration_ms",
                "narration_audio_url",
                "narration_audio_duration_ms",
                "dialogue_audio_url",
                "dialogue_audio_duration_ms",
            ):
                if k in shot:
                    shot.pop(k, None)
                    cleared_any = True
            if cleared_any:
                cleared_shots += 1

    removed_assets = 0
    if isinstance(project.audio_assets, list):
        before = len(project.audio_assets)
        project.audio_assets = [
            a
            for a in project.audio_assets
            if not (
                isinstance(a, dict)
                and (a.get("type") in ("narration", "dialogue"))
                and (
                    selected_shot_ids is None
                    or str(a.get("shot_id") or "").strip() in selected_shot_ids
                )
            )
        ]
        removed_assets = before - len(project.audio_assets)

    deleted_files = 0
    if request.deleteFiles:
        for url in removed_urls:
            if not isinstance(url, str):
                continue
            if not url.startswith("/api/uploads/audio/"):
                continue
            filename = url[len("/api/uploads/audio/") :].strip().replace("/", "")
            if not filename:
                continue
            candidate = (audio_dir / filename).resolve()
            try:
                if audio_dir in candidate.parents and candidate.exists() and candidate.is_file():
                    candidate.unlink()
                    deleted_files += 1
            except Exception:
                pass

    storage.save_agent_project(project.to_dict())
    return {
        "success": True,
        "cleared_shots": cleared_shots,
        "removed_assets": removed_assets,
        "deleted_files": deleted_files,
    }


@router.get("/projects/{project_id}/audio-timeline")
async def get_project_audio_timeline(project_id: str):
    """获取项目 audio_timeline；若不存在则返回基于当前 shots 的草稿。"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    # 若已保存 timeline，直接返回
    existing = project_data.get("audio_timeline")
    if isinstance(existing, dict) and isinstance(existing.get("segments"), list):
        # 兼容：将最新的人声分轨 URL/时长回填到已保存 timeline（不落盘）。
        import copy

        tl = copy.deepcopy(existing)
        project = AgentProject.from_dict(project_data)
        shot_map: Dict[str, Dict[str, Any]] = {}
        for seg in project.segments or []:
            if not isinstance(seg, dict):
                continue
            for shot in seg.get("shots", []) if isinstance(seg.get("shots"), list) else []:
                if not isinstance(shot, dict):
                    continue
                sid = str(shot.get("id") or "").strip()
                if sid:
                    shot_map[sid] = shot

        for seg in tl.get("segments") or []:
            if not isinstance(seg, dict):
                continue
            for s in seg.get("shots") or []:
                if not isinstance(s, dict):
                    continue
                sid = str(s.get("shot_id") or "").strip()
                if not sid:
                    continue
                sh = shot_map.get(sid)
                if not isinstance(sh, dict):
                    continue

                # unified voice
                if isinstance(sh.get("voice_audio_url"), str) and sh.get("voice_audio_url"):
                    s["voice_audio_url"] = sh.get("voice_audio_url")
                try:
                    s["voice_duration_ms"] = int(sh.get("voice_audio_duration_ms") or s.get("voice_duration_ms") or 0)
                except Exception:
                    pass

                # split tracks (optional)
                if isinstance(sh.get("narration_audio_url"), str) and sh.get("narration_audio_url"):
                    s["narration_audio_url"] = sh.get("narration_audio_url")
                try:
                    s["narration_duration_ms"] = int(sh.get("narration_audio_duration_ms") or s.get("narration_duration_ms") or 0)
                except Exception:
                    pass
                if isinstance(sh.get("dialogue_audio_url"), str) and sh.get("dialogue_audio_url"):
                    s["dialogue_audio_url"] = sh.get("dialogue_audio_url")
                try:
                    s["dialogue_duration_ms"] = int(sh.get("dialogue_audio_duration_ms") or s.get("dialogue_duration_ms") or 0)
                except Exception:
                    pass

        return {"success": True, "audio_timeline": tl}

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()
    draft = executor.build_audio_timeline_from_project(project)
    return {"success": True, "audio_timeline": draft}


@router.post("/projects/{project_id}/audio-timeline")
async def save_project_audio_timeline(project_id: str, request: SaveAudioTimelineRequest):
    """保存项目 audio_timeline，并可选将 duration 写回 shots（不允许改变镜头数量）。"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    if not isinstance(request.audioTimeline, dict):
        raise HTTPException(status_code=400, detail="audioTimeline must be an object")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    # 校验并可选写回 duration
    try:
        if request.applyToProject:
            executor.apply_audio_timeline_to_project(project, request.audioTimeline, reset_videos=bool(request.resetVideos))
        else:
            # 仅校验：在临时对象上 apply，避免修改原项目
            tmp = AgentProject.from_dict(project.to_dict())
            executor.apply_audio_timeline_to_project(tmp, request.audioTimeline, reset_videos=False)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    # 写入 timeline（无论是否 applyToProject，都保存）
    tl = dict(request.audioTimeline)
    tl.setdefault("version", "v1")
    tl["updated_at"] = datetime.utcnow().isoformat() + "Z"
    project.audio_timeline = tl

    saved = storage.save_agent_project(project.to_dict())
    return {"success": True, "project": saved, "audio_timeline": tl}


@router.post("/projects/{project_id}/audio-timeline/master-audio")
async def generate_audio_timeline_master_audio(project_id: str, request: AudioTimelineMasterAudioRequest):
    """生成音频工作台预览用的 master 音轨（按当前 duration 拼接并补齐静默）。"""
    import subprocess
    from pathlib import Path

    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    def _ffmpeg_ok() -> bool:
        try:
            p = subprocess.run(["ffmpeg", "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            return p.returncode == 0
        except Exception:
            return False

    if not _ffmpeg_ok():
        raise HTTPException(status_code=400, detail="未检测到 ffmpeg：无法生成波形预览音轨（请先安装 ffmpeg）")

    timeline = executor.build_audio_timeline_from_project(project, shot_durations_override=request.shotDurations)

    modes_raw = request.modes if isinstance(request.modes, list) else []
    modes = {str(m).strip().lower() for m in modes_raw if isinstance(m, str) and str(m).strip()}
    if not modes:
        modes = {"narration", "mix"}

    want_narration = "narration" in modes
    want_mix = "mix" in modes

    # Collect per-shot inputs (paths may be None -> silence).
    audio_dir = (Path(UPLOAD_DIR) / "audio").resolve()
    audio_dir.mkdir(parents=True, exist_ok=True)

    def _local_audio_path(url: Any) -> Optional[Path]:
        if not isinstance(url, str) or not url.startswith("/api/uploads/audio/"):
            return None
        filename = url[len("/api/uploads/audio/") :].strip().replace("/", "")
        if not filename:
            return None
        fp = (audio_dir / filename).resolve()
        if audio_dir not in fp.parents or not fp.exists() or not fp.is_file():
            return None
        return fp

    shots: List[Dict[str, Any]] = []
    total_sec = 0.0
    for seg in (timeline.get("segments") or []):
        if not isinstance(seg, dict):
            continue
        for s in (seg.get("shots") or []):
            if not isinstance(s, dict):
                continue
            dur = float(s.get("duration") or 0.0)
            dur_s = max(0.0, float(dur))
            total_sec += dur_s

            # narration: prefer narration_audio_url; fallback to voice_audio_url for older projects.
            narr_url = str(s.get("narration_audio_url") or "").strip() or str(s.get("voice_audio_url") or "").strip()
            narr_path = _local_audio_path(narr_url)

            base_url = str(s.get("dialogue_audio_url") or "").strip()
            base_path = _local_audio_path(base_url)

            shots.append({"duration": dur_s, "narration": narr_path, "base": base_path})

    if not shots or total_sec <= 0.01:
        raise HTTPException(status_code=400, detail="时间轴为空，无法生成 master 音频")

    def _run(cmd_args: List[str]) -> subprocess.CompletedProcess:
        try:
            return subprocess.run(cmd_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15 * 60)
        except subprocess.TimeoutExpired as e:
            raise HTTPException(status_code=500, detail="ffmpeg 超时：建议缩短项目或仅生成旁白 master") from e

    def _render(kind: str) -> str:
        # Deduplicate file inputs.
        input_index: Dict[Path, int] = {}
        input_files: List[Path] = []
        for item in shots:
            for k in ("narration", "base"):
                p = item.get(k)
                if isinstance(p, Path) and p not in input_index:
                    input_index[p] = len(input_files)
                    input_files.append(p)

        # One silence input for missing tracks.
        silence_index = len(input_files)

        parts: List[str] = []
        concat_inputs: List[str] = []
        for i, item in enumerate(shots):
            dur_s = max(0.0, float(item.get("duration") or 0.0))
            if kind == "narration":
                src_path = item.get("narration")
                src_idx = input_index.get(src_path) if isinstance(src_path, Path) else None
                if src_idx is None:
                    src_idx = silence_index
                parts.append(
                    f"[{src_idx}:a]aresample=24000,aformat=channel_layouts=mono,apad,atrim=0:{dur_s:.3f},asetpts=N/SR/TB[a{i}]"
                )
                concat_inputs.append(f"[a{i}]")
            else:
                base_path = item.get("base")
                narr_path = item.get("narration")
                base_idx = input_index.get(base_path) if isinstance(base_path, Path) else None
                narr_idx = input_index.get(narr_path) if isinstance(narr_path, Path) else None
                if base_idx is None:
                    base_idx = silence_index
                if narr_idx is None:
                    narr_idx = silence_index
                parts.append(
                    f"[{base_idx}:a]aresample=24000,aformat=channel_layouts=mono,apad,atrim=0:{dur_s:.3f},asetpts=N/SR/TB[b{i}]"
                )
                parts.append(
                    f"[{narr_idx}:a]aresample=24000,aformat=channel_layouts=mono,apad,atrim=0:{dur_s:.3f},asetpts=N/SR/TB[n{i}]"
                )
                parts.append(f"[b{i}][n{i}]amix=inputs=2:duration=longest:dropout_transition=0[m{i}]")
                concat_inputs.append(f"[m{i}]")

        parts.append("".join(concat_inputs) + f"concat=n={len(shots)}:v=0:a=1[outa]")
        filter_complex = ";".join(parts)

        suffix = "mix" if kind == "mix" else "narration"
        out_name = f"timeline_master_{suffix}_{project_id}_{uuid.uuid4().hex[:8]}.mp3"
        out_path = (audio_dir / out_name).resolve()

        cmd = ["ffmpeg", "-y", "-nostdin", "-hide_banner", "-loglevel", "error"]
        for fp in input_files:
            cmd.extend(["-i", str(fp)])
        cmd.extend(["-f", "lavfi", "-i", "anullsrc=channel_layout=mono:sample_rate=24000"])
        cmd.extend([
            "-filter_complex",
            filter_complex,
            "-map",
            "[outa]",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "192k",
            str(out_path),
        ])

        p = _run(cmd)
        if p.returncode != 0:
            cmd2 = list(cmd)
            for j, v in enumerate(cmd2):
                if v == "libmp3lame":
                    cmd2[j] = "mp3"
            p2 = _run(cmd2)
            if p2.returncode != 0:
                raise HTTPException(status_code=500, detail=(p2.stderr or p.stderr).decode("utf-8", errors="ignore")[:2000] or "ffmpeg failed")

        return f"/api/uploads/audio/{out_name}"

    has_any_base_audio = any(isinstance(item.get("base"), Path) for item in shots)

    out: Dict[str, Any] = {"success": True, "duration_ms": int(round(total_sec * 1000.0))}

    narration_master_url: Optional[str] = None
    if want_narration or (want_mix and not has_any_base_audio):
        narration_master_url = _render("narration")
        if want_narration:
            out["master_audio_url"] = narration_master_url

    if want_mix:
        # When there's no base (video) audio at all, "mix" degenerates to narration-only.
        # Reuse the narration master to avoid redundant ffmpeg work and volume changes.
        if not has_any_base_audio and narration_master_url:
            out["master_mix_audio_url"] = narration_master_url
        else:
            out["master_mix_audio_url"] = _render("mix")
    # Back-compat: keep master_audio_url when only mix is requested.
    if "master_audio_url" not in out and "master_mix_audio_url" in out:
        out["master_audio_url"] = out["master_mix_audio_url"]
    return out


@router.post("/projects/{project_id}/audio/extract-from-videos")
async def extract_audio_from_project_videos(project_id: str, request: ExtractVideoAudioRequest):
    """Extract audio tracks from generated videos and write into shot.dialogue_audio_url.

    This is used for the "video_dialogue" workflow, where video outputs dialogue/music audio,
    and TTS only generates narration.
    """
    import subprocess
    from pathlib import Path

    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    mode = executor.resolve_audio_workflow(project)
    if mode != "video_dialogue":
        raise HTTPException(status_code=400, detail=f"当前项目 audioWorkflowResolved={mode}，仅音画同出模式可抽取视频音轨")

    def _tool_ok(name: str) -> bool:
        try:
            p = subprocess.run([name, "-version"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=5)
            return p.returncode == 0
        except Exception:
            return False

    if not _tool_ok("ffmpeg") or not _tool_ok("ffprobe"):
        raise HTTPException(status_code=400, detail="未检测到 ffmpeg/ffprobe：无法从视频抽取音轨（请先安装 ffmpeg）")

    selected: Optional[set[str]] = None
    if isinstance(request.shotIds, list) and request.shotIds:
        selected = {str(s).strip() for s in request.shotIds if isinstance(s, str) and str(s).strip()}
        if not selected:
            selected = None

    upload_video_dir = (Path(UPLOAD_DIR) / "video").resolve()
    upload_audio_dir = (Path(UPLOAD_DIR) / "audio").resolve()
    upload_audio_dir.mkdir(parents=True, exist_ok=True)

    def _resolve_video_path(video_url: str) -> Optional[Path]:
        url = (video_url or "").strip()
        if not url:
            return None
        if url.startswith("/api/uploads/video/"):
            fn = url[len("/api/uploads/video/") :].strip().replace("/", "")
            if not fn:
                return None
            fp = (upload_video_dir / fn).resolve()
            if upload_video_dir not in fp.parents or not fp.exists() or not fp.is_file():
                return None
            return fp
        return None

    def _has_audio_stream(video_path: Path) -> bool:
        try:
            p = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-select_streams",
                    "a:0",
                    "-show_entries",
                    "stream=index",
                    "-of",
                    "csv=p=0",
                    str(video_path),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20,
            )
            return p.returncode == 0 and bool((p.stdout or b"").strip())
        except Exception:
            return False

    def _probe_duration_ms(audio_path: Path) -> int:
        try:
            p = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "default=nw=1:nk=1",
                    str(audio_path),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=20,
            )
            if p.returncode != 0:
                return 0
            s = (p.stdout or b"").decode("utf-8", errors="ignore").strip()
            v = float(s) if s else 0.0
            if not math.isfinite(v) or v <= 0:
                return 0
            return int(round(v * 1000.0))
        except Exception:
            return 0

    updated: List[str] = []
    skipped_no_audio: List[str] = []
    failed: List[Dict[str, str]] = []

    # Iterate shots in order.
    for seg in project.segments or []:
        if not isinstance(seg, dict):
            continue
        for shot in (seg.get("shots") or []):
            if not isinstance(shot, dict):
                continue
            sid = str(shot.get("id") or "").strip()
            if not sid:
                continue
            if selected is not None and sid not in selected:
                continue

            if not request.overwrite:
                existing = str(shot.get("dialogue_audio_url") or "").strip()
                if existing.startswith("/api/uploads/audio/"):
                    continue

            video_url = (
                str(shot.get("cached_video_url") or "").strip()
                or str(shot.get("video_url") or "").strip()
                or str(shot.get("video_source_url") or "").strip()
            )
            if not video_url:
                continue

            try:
                local_url = video_url
                if video_url.startswith("http"):
                    cached = await executor._cache_remote_to_uploads(video_url, "video", ".mp4")
                    if isinstance(cached, str) and cached.startswith("/api/uploads/video/"):
                        local_url = cached

                vp = _resolve_video_path(local_url)
                if not vp:
                    raise ValueError("无法解析本地视频路径（请先确保视频已缓存到 /api/uploads/video/）")

                if not _has_audio_stream(vp):
                    skipped_no_audio.append(sid)
                    continue

                out_name = f"video_audio_{project_id}_{sid}_{uuid.uuid4().hex[:8]}.mp3"
                out_path = (upload_audio_dir / out_name).resolve()

                cmd = [
                    "ffmpeg",
                    "-y",
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-i",
                    str(vp),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "24000",
                    "-c:a",
                    "libmp3lame",
                    "-b:a",
                    "192k",
                    str(out_path),
                ]
                p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
                if p.returncode != 0 or not out_path.exists():
                    # fallback codec name
                    cmd2 = list(cmd)
                    for j, v in enumerate(cmd2):
                        if v == "libmp3lame":
                            cmd2[j] = "mp3"
                    p2 = subprocess.run(cmd2, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
                    if p2.returncode != 0 or not out_path.exists():
                        msg = (p2.stderr or p.stderr).decode("utf-8", errors="ignore")[:2000] or "ffmpeg failed"
                        raise RuntimeError(msg)

                dur_ms = _probe_duration_ms(out_path)
                shot["dialogue_audio_url"] = f"/api/uploads/audio/{out_name}"
                shot["dialogue_audio_duration_ms"] = int(dur_ms or 0)
                updated.append(sid)
            except Exception as e:
                failed.append({"shot_id": sid, "error": str(e)})

    saved = storage.save_agent_project(project.to_dict())
    return {
        "success": True,
        "updated_shots": updated,
        "skipped_no_audio_stream": skipped_no_audio,
        "failed": failed,
        "project": saved,
    }


@router.get("/projects/{project_id}/generate-videos-stream")
async def generate_project_videos_stream(project_id: str, resolution: str = "720p"):
    """流式生成项目的所有视频 (SSE)

    每提交一个视频任务就推送进度，然后持续轮询直到完成
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    # 若存在已确认的 audio_timeline，则在生成前应用到 shots.duration（作为视频时长约束）。
    tl = project_data.get("audio_timeline")
    if isinstance(tl, dict) and tl.get("confirmed") is True:
        try:
            executor.apply_audio_timeline_to_project(project, tl, reset_videos=False)
            storage.save_agent_project(project.to_dict())
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid audio_timeline: {str(e)}")

    async def event_generator():
        # ── Phase 4: 任务队列路径 ──
        if USE_TASK_QUEUE:
            async for chunk in _agent_generate_videos_via_queue(
                project, executor, project_id, resolution,
            ):
                yield chunk
            return

        # ── 原有路径 ──
        # 收集所有有起始帧的镜头
        all_shots = []
        for segment in project.segments:
            for shot in segment.get("shots", []):
                if shot.get("start_image_url"):
                    all_shots.append((segment["id"], shot))

        total = len(all_shots)
        submitted = 0
        completed = 0
        failed = 0
        skipped = 0
        pending_tasks = []  # 待轮询的任务

        # 发送开始事件
        yield f"data: {json.dumps({'type': 'start', 'total': total, 'percent': 0, 'phase': 'submit'})}\n\n"

        # 阶段1: 提交所有视频任务
        for i, (segment_id, shot) in enumerate(all_shots):
            current = i + 1
            submit_percent = int((current / total) * 50) if total > 0 else 50  # 提交阶段占 50%

            # 跳过已有视频的镜头
            if shot.get("video_url"):
                skipped += 1
                yield f"data: {json.dumps({'type': 'skip', 'shot_id': shot['id'], 'shot_name': shot.get('name', ''), 'current': current, 'total': total, 'percent': submit_percent, 'phase': 'submit'})}\n\n"
                continue

            try:
                # 发送提交中事件
                yield f"data: {json.dumps({'type': 'submitting', 'shot_id': shot['id'], 'shot_name': shot.get('name', ''), 'current': current, 'total': total, 'percent': submit_percent, 'phase': 'submit'})}\n\n"

                # 构建视频提示词（与起始帧提示词分离）
                video_prompt = executor._build_video_prompt_for_shot(shot, project)

                # 生成视频
                video_result = await executor.video_service.generate(
                    image_url=shot["start_image_url"],
                    prompt=video_prompt,
                    duration=shot.get("duration", 5),
                    resolution=resolution
                )

                audio_disabled = video_result.get("audio_disabled") if isinstance(video_result, dict) else None
                if isinstance(audio_disabled, bool):
                    shot["video_audio_disabled"] = bool(audio_disabled)
                    executor.record_video_audio_support(project, audio_disabled=bool(audio_disabled))

                task_id = video_result.get("task_id")
                status = video_result.get("status")

                shot["video_task_id"] = task_id
                shot["status"] = "video_processing"

                submitted += 1

                # 如果是异步任务，加入待轮询列表
                if status in ["processing", "pending", "submitted"]:
                    pending_tasks.append({
                        "shot_id": shot["id"],
                        "shot_name": shot.get("name", ""),
                        "task_id": task_id,
                        "shot": shot
                    })
                    yield f"data: {json.dumps({'type': 'submitted', 'shot_id': shot['id'], 'shot_name': shot.get('name', ''), 'task_id': task_id, 'current': current, 'total': total, 'submitted': submitted, 'percent': submit_percent, 'phase': 'submit'})}\n\n"
                elif status == "completed" or status == "succeeded":
                    # 直接完成
                    shot["video_url"] = video_result.get("video_url")
                    shot["status"] = "video_ready"
                    completed += 1

                    project.visual_assets.append({
                        "id": f"video_{shot['id']}",
                        "url": shot["video_url"],
                        "type": "video",
                        "shot_id": shot["id"],
                        "duration": shot.get("duration")
                    })

                    yield f"data: {json.dumps({'type': 'complete', 'shot_id': shot['id'], 'shot_name': shot.get('name', ''), 'video_url': shot['video_url'], 'current': current, 'total': total, 'completed': completed, 'percent': submit_percent, 'phase': 'submit'})}\n\n"

            except Exception as e:
                failed += 1
                shot["status"] = "video_failed"
                yield f"data: {json.dumps({'type': 'error', 'shot_id': shot['id'], 'shot_name': shot.get('name', ''), 'error': str(e), 'current': current, 'total': total, 'percent': submit_percent, 'phase': 'submit'})}\n\n"

        # 保存提交后的状态
        storage.save_agent_project(project.to_dict())

        # 阶段2: 轮询等待所有任务完成
        if pending_tasks:
            yield f"data: {json.dumps({'type': 'polling_start', 'pending': len(pending_tasks), 'percent': 50, 'phase': 'poll'})}\n\n"

            max_wait = 600  # 最长等待10分钟
            poll_interval = 5
            elapsed = 0

            while pending_tasks and elapsed < max_wait:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

                still_pending = []
                for task in pending_tasks:
                    try:
                        status_result = await executor.video_service.check_task_status(task["task_id"])
                        task_status = status_result.get("status")

                        if task_status in ["completed", "succeeded"]:
                            video_url = status_result.get("video_url")
                            task["shot"]["video_url"] = video_url
                            task["shot"]["status"] = "video_ready"
                            completed += 1

                            project.visual_assets.append({
                                "id": f"video_{task['shot_id']}",
                                "url": video_url,
                                "type": "video",
                                "shot_id": task["shot_id"],
                                "duration": task["shot"].get("duration")
                            })

                            # 计算进度：50% (提交) + 剩余 50% 按完成比例
                            total_to_process = len(all_shots) - skipped
                            if total_to_process > 0:
                                poll_percent = 50 + int((completed / total_to_process) * 50)
                            else:
                                poll_percent = 100
                            yield f"data: {json.dumps({'type': 'complete', 'shot_id': task['shot_id'], 'shot_name': task['shot_name'], 'video_url': video_url, 'completed': completed, 'pending': len(still_pending), 'percent': poll_percent, 'phase': 'poll'})}\n\n"

                        elif task_status in ["failed", "error"]:
                            task["shot"]["status"] = "video_failed"
                            failed += 1
                            yield f"data: {json.dumps({'type': 'error', 'shot_id': task['shot_id'], 'shot_name': task['shot_name'], 'error': status_result.get('error', '视频生成失败'), 'phase': 'poll'})}\n\n"
                        else:
                            # 仍在处理中
                            still_pending.append(task)

                    except Exception as e:
                        # 查询失败，保留在待轮询列表
                        still_pending.append(task)

                pending_tasks = still_pending

                # 发送轮询进度
                if pending_tasks:
                    total_to_process = len(all_shots) - skipped
                    if total_to_process > 0:
                        poll_percent = 50 + int(((total_to_process - len(pending_tasks)) / total_to_process) * 50)
                    else:
                        poll_percent = 100
                    yield f"data: {json.dumps({'type': 'polling', 'pending': len(pending_tasks), 'completed': completed, 'elapsed': elapsed, 'percent': poll_percent, 'phase': 'poll'})}\n\n"

            # 超时处理
            if pending_tasks:
                for task in pending_tasks:
                    task["shot"]["status"] = "video_timeout"
                    failed += 1
                yield f"data: {json.dumps({'type': 'timeout', 'pending': len(pending_tasks), 'message': '部分视频生成超时'})}\n\n"

        # 保存最终状态
        storage.save_agent_project(project.to_dict())

        # 发送结束事件
        yield f"data: {json.dumps({'type': 'done', 'completed': completed, 'failed': failed, 'skipped': skipped, 'total': total, 'percent': 100})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@router.post("/projects/{project_id}/poll-video-tasks")
async def poll_project_video_tasks(project_id: str):
    """Poll pending video tasks for a project once and persist any completed results."""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    try:
        result = await executor.poll_project_video_tasks(project)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Poll failed: {str(e)}")


@router.post("/projects/{project_id}/execute-pipeline")
async def execute_project_pipeline(project_id: str, request: ExecutePipelineRequest):
    """执行完整的生成流程
    
    Flova 风格的一键生成：
    1. 生成所有元素图片
    2. 生成所有起始帧
    3. 生成所有视频
    
    返回每个阶段的结果
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()
    
    try:
        result = await executor.execute_full_pipeline(
            project,
            visual_style=request.visualStyle,
            resolution=request.resolution
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")


@router.post("/projects/{project_id}/execute-pipeline-v2")
async def execute_project_pipeline_v2(project_id: str, request: ExecutePipelineV2Request):
    """执行完整的生成流程（音频先行约束版）。

    若项目存在已确认的 audio_timeline，则会在执行前将 timeline.duration 写回 shots 并可选重置视频引用。
    若不存在或未确认，则退化为原行为。
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = deps.get_agent_executor()

    try:
        result = await executor.execute_full_pipeline_v2(
            project,
            visual_style=request.visualStyle,
            resolution=request.resolution,
            reset_videos=bool(request.forceRegenerateVideos),
        )
        if not result.get("success") and result.get("error"):
            raise HTTPException(status_code=400, detail=str(result.get("error")))
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")


@router.get("/projects/{project_id}/status")
async def get_project_generation_status(project_id: str):
    """获取项目的生成状态统计"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    elements = project_data.get("elements", {})
    segments = project_data.get("segments", [])
    
    # 统计元素状态
    elements_total = len(elements)
    elements_with_image = sum(1 for e in elements.values() if e.get("image_url"))
    
    # 统计镜头状态
    shots_total = 0
    shots_with_frame = 0
    shots_with_video = 0
    shots_processing = 0
    
    for segment in segments:
        for shot in segment.get("shots", []):
            shots_total += 1
            if shot.get("start_image_url"):
                shots_with_frame += 1
            if shot.get("video_url"):
                shots_with_video += 1
            if shot.get("status") == "video_processing":
                shots_processing += 1
    
    return {
        "elements": {
            "total": elements_total,
            "completed": elements_with_image,
            "pending": elements_total - elements_with_image
        },
        "frames": {
            "total": shots_total,
            "completed": shots_with_frame,
            "pending": shots_total - shots_with_frame
        },
        "videos": {
            "total": shots_total,
            "completed": shots_with_video,
            "processing": shots_processing,
            "pending": shots_total - shots_with_video - shots_processing
        },
        "overall_progress": {
            "elements_percent": round(elements_with_image / elements_total * 100) if elements_total > 0 else 0,
            "frames_percent": round(shots_with_frame / shots_total * 100) if shots_total > 0 else 0,
            "videos_percent": round(shots_with_video / shots_total * 100) if shots_total > 0 else 0
        }
    }


# ==========================================================================
# Auth / Workspace / OKR / Undo-Redo
# ==========================================================================

class AuthRegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class AuthLoginRequest(BaseModel):
    email: str
    password: str


class AuthRefreshRequest(BaseModel):
    refresh_token: str


class AuthProfileUpdateRequest(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None


class AuthChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class AuthForgotPasswordRequest(BaseModel):
    email: str


class AuthResetPasswordRequest(BaseModel):
    reset_token: str
    new_password: str


class WorkspaceCreateRequest(BaseModel):
    name: str


class WorkspaceMemberCreateRequest(BaseModel):
    email: str
    role: str = "viewer"


class WorkspaceMemberUpdateRequest(BaseModel):
    role: str


class WorkspaceOKRCreateRequest(BaseModel):
    title: str
    owner_user_id: Optional[str] = None
    status: str = "active"
    risk: str = "normal"
    due_date: str = ""
    key_results: Optional[List[Dict[str, Any]]] = None
    links: Optional[List[Dict[str, Any]]] = None


class WorkspaceOKRUpdateRequest(BaseModel):
    title: Optional[str] = None
    owner_user_id: Optional[str] = None
    status: Optional[str] = None
    risk: Optional[str] = None
    due_date: Optional[str] = None
    key_results: Optional[List[Dict[str, Any]]] = None
    links: Optional[List[Dict[str, Any]]] = None


class WorkspaceUndoRedoRequest(BaseModel):
    project_scope: str = "studio:global"


class WorkspaceEpisodeAssignRequest(BaseModel):
    assigned_to: str
    note: str = ""


class WorkspaceEpisodeReviewRequest(BaseModel):
    note: str = ""


# ---------------------------------------------------------------------------
# Phase 4: Agent 任务队列路径
# ---------------------------------------------------------------------------

async def _agent_generate_frames_via_queue(
    project, executor, project_id: str, visual_style: str,
    exclude_shot_ids_str, mode: str,
):
    """通过任务队列生成帧，以 SSE 事件流形式推送进度。"""
    import os
    from services.studio.task_queue.storage import TaskStorage
    from services.studio.task_queue.types import CreateTaskInput
    from services.studio.task_queue.event_bus import TaskEventBus

    db_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "task_queue.db",
    )
    task_storage = TaskStorage(db_path)
    event_bus = TaskEventBus(task_storage)

    regenerate = (mode or "").strip().lower() in ("regenerate", "regen", "force", "all")
    excluded_shot_ids = set()
    if exclude_shot_ids_str:
        for part in exclude_shot_ids_str.split(","):
            sid = (part or "").strip()
            if sid:
                excluded_shot_ids.add(sid)

    # 收集 shots
    all_shots = []
    for segment in project.segments:
        if not isinstance(segment, dict):
            continue
        shots = segment.get("shots") or []
        if not isinstance(shots, list):
            continue
        for shot in shots:
            if isinstance(shot, dict) and isinstance(shot.get("id"), str) and shot.get("id"):
                all_shots.append(shot)

    total = len(all_shots)
    yield f"data: {json.dumps({'type': 'start', 'total': total, 'percent': 0, 'mode': 'task_queue'})}\n\n"

    task_ids = []
    for shot in all_shots:
        shot_id = shot.get("id", "")
        if shot_id in excluded_shot_ids:
            continue
        if not regenerate and shot.get("start_image_url") and executor._should_skip_existing_image(shot.get("start_image_url")):
            continue

        prompt = shot.get("prompt") if isinstance(shot.get("prompt"), str) else ""
        if not prompt.strip():
            prompt = shot.get("description") if isinstance(shot.get("description"), str) else ""

        dedupe_key = f"agent:{project_id}:{shot_id}:image_frame"
        inp = CreateTaskInput(
            type="image_frame",
            queue_type="image",
            target_type="shot",
            target_id=shot_id,
            series_id=project_id,
            episode_id=project_id,
            runtime="agent",
            priority=0,
            max_attempts=3,
            payload={
                "prompt": prompt,
                "visual_style": visual_style,
                "shot_id": shot_id,
                "width": 1280,
                "height": 720,
            },
            dedupe_key=dedupe_key,
        )
        task = task_storage.create_task(inp)
        task_ids.append(task.id)

    # 订阅事件
    sub_queue = event_bus.subscribe(project_id)
    expected = len(task_ids)
    completed = 0
    failed = 0

    try:
        timeout_count = 0
        max_idle = 1200
        while completed + failed < expected and timeout_count < max_idle:
            try:
                ev = await asyncio.wait_for(sub_queue.get(), timeout=0.5)
                timeout_count = 0
                payload = {"type": ev.event_type, "task_id": ev.task_id, **ev.payload}
                if ev.event_type == "completed":
                    completed += 1
                    payload["percent"] = int(((completed + failed) / expected) * 100) if expected else 100
                elif ev.event_type == "failed":
                    failed += 1
                    payload["percent"] = int(((completed + failed) / expected) * 100) if expected else 100
                yield f"id: {ev.id}\ndata: {json.dumps(payload)}\n\n"
            except asyncio.TimeoutError:
                timeout_count += 1
                yield ": keep-alive\n\n"
    finally:
        event_bus.unsubscribe(project_id, sub_queue)

    yield f"data: {json.dumps({'type': 'done', 'generated': completed, 'failed': failed, 'total': total, 'percent': 100, 'mode': 'task_queue'})}\n\n"


async def _agent_generate_videos_via_queue(
    project, executor, project_id: str, resolution: str,
):
    """通过任务队列生成视频，以 SSE 事件流形式推送进度。"""
    import os
    from services.studio.task_queue.storage import TaskStorage
    from services.studio.task_queue.types import CreateTaskInput
    from services.studio.task_queue.event_bus import TaskEventBus

    db_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data", "task_queue.db",
    )
    task_storage = TaskStorage(db_path)
    event_bus = TaskEventBus(task_storage)

    # 收集所有有起始帧的镜头
    all_shots = []
    for segment in project.segments:
        for shot in segment.get("shots", []):
            if shot.get("start_image_url"):
                all_shots.append(shot)

    total = len(all_shots)
    yield f"data: {json.dumps({'type': 'start', 'total': total, 'percent': 0, 'phase': 'submit', 'mode': 'task_queue'})}\n\n"

    task_ids = []
    skipped = 0
    for shot in all_shots:
        shot_id = shot.get("id", "")
        if shot.get("video_url"):
            skipped += 1
            continue

        video_prompt = executor._build_video_prompt_for_shot(shot, project) if hasattr(executor, '_build_video_prompt_for_shot') else ""
        dedupe_key = f"agent:{project_id}:{shot_id}:video_panel"

        inp = CreateTaskInput(
            type="video_panel",
            queue_type="video",
            target_type="shot",
            target_id=shot_id,
            series_id=project_id,
            episode_id=project_id,
            runtime="agent",
            priority=0,
            max_attempts=3,
            payload={
                "image_url": shot.get("start_image_url", ""),
                "prompt": video_prompt,
                "duration": shot.get("duration", 5),
                "resolution": resolution,
                "shot_id": shot_id,
            },
            dedupe_key=dedupe_key,
        )
        task = task_storage.create_task(inp)
        task_ids.append(task.id)

    # 订阅事件
    sub_queue = event_bus.subscribe(project_id)
    expected = len(task_ids)
    completed = 0
    failed = 0

    try:
        timeout_count = 0
        max_idle = 2400  # 20 分钟
        while completed + failed < expected and timeout_count < max_idle:
            try:
                ev = await asyncio.wait_for(sub_queue.get(), timeout=0.5)
                timeout_count = 0
                payload = {"type": ev.event_type, "task_id": ev.task_id, **ev.payload}
                if ev.event_type == "completed":
                    completed += 1
                    payload["percent"] = 50 + int((completed / expected) * 50) if expected else 100
                elif ev.event_type == "failed":
                    failed += 1
                    payload["percent"] = 50 + int(((completed + failed) / expected) * 50) if expected else 100
                yield f"id: {ev.id}\ndata: {json.dumps(payload)}\n\n"
            except asyncio.TimeoutError:
                timeout_count += 1
                yield ": keep-alive\n\n"
    finally:
        event_bus.unsubscribe(project_id, sub_queue)

    storage.save_agent_project(project.to_dict())
    yield f"data: {json.dumps({'type': 'done', 'completed': completed, 'failed': failed, 'skipped': skipped, 'total': total, 'percent': 100, 'mode': 'task_queue'})}\n\n"


