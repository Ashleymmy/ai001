"""Studio routes: /api/studio/*."""

import os
import json
import uuid
import asyncio
from typing import Optional, List, Dict, Any
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request, Header, Query
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from services.storage_service import storage
from services.studio_service import StudioServiceError
from services.studio_export_service import StudioExportService
from services.studio.prompt_sentinel import analyze_prompt_text, apply_prompt_suggestions
from services.studio.knowledge_base import KnowledgeBase
from services.studio.mood_packs import (
    list_available_moods,
    save_custom_mood_pack,
    delete_custom_mood_pack,
)
from services.studio.prompts import build_default_custom_prompts, normalize_custom_prompts
from schemas.settings import (
    StudioSeriesCreateRequest,
    StudioSeriesUpdateRequest,
    StudioEpisodeUpdateRequest,
    StudioVolumeCreateRequest,
    StudioVolumeUpdateRequest,
    StudioVolumeEpisodeCreateRequest,
    StudioVolumeStyleAnchorExtractRequest,
    StudioStyleMigrateRequest,
    StudioElementCreateRequest,
    StudioElementUpdateRequest,
    StudioShotUpdateRequest,
    StudioGenerateRequest,
    StudioInpaintRequest,
    StudioBatchGenerateRequest,
    StudioReorderShotsRequest,
    StudioElementGenerateImageRequest,
    StudioCharacterDocImportRequest,
    StudioCharacterSplitRequest,
    StudioDigitalHumanProfilesSaveRequest,
    StudioSettingsRequest,
    StudioPromptCheckRequest,
    StudioPromptOptimizeRequest,
    StudioExportToAgentRequest,
    StudioKBWorldBibleRequest,
    StudioKBMoodPackRequest,
    StudioImportFromAgentRequest,
    KBCharacterCardUpdate,
    KBSceneCardUpdate,
    KBMoodPackCreate,
    KBWorldBibleUpdate,
    KBAssemblePreviewRequest,
)
import dependencies as deps

router = APIRouter(prefix="/api/studio", tags=["studio"])


@router.post("/series")
async def studio_create_series(
    req: StudioSeriesCreateRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    try:
        workspace_id = deps._collab_pick_workspace_id(request, req.workspace_id)
        if deps.AUTH_REQUIRED and not workspace_id:
            deps._studio_raise(400, "创建系列必须指定 workspace_id", "workspace_required")
        if workspace_id:
            deps._collab_require_workspace_role(request, workspace_id, "editor", authorization)
        result = await service.create_series(
            name=req.name,
            full_script=req.script,
            preferences={
                "workspace_id": workspace_id,
                "workbench_mode": req.workbench_mode,
                "description": req.description,
                "series_bible": req.series_bible,
                "visual_style": req.visual_style,
                "target_episode_count": req.target_episode_count,
                "episode_duration_seconds": req.episode_duration_seconds,
            },
        )
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.get("/series")
async def studio_list_series(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    try:
        resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
        if deps.AUTH_REQUIRED and not resolved_workspace_id:
            deps._studio_raise(400, "读取系列列表必须指定 workspace_id", "workspace_required")
        if resolved_workspace_id:
            deps._collab_require_workspace_role(request, resolved_workspace_id, "viewer", authorization)
        return service.storage.list_series(workspace_id=resolved_workspace_id)
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.get("/series/{series_id}")
async def studio_get_series(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    detail = service.get_series_detail(series_id)
    if not detail:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace_id = str(detail.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace_id or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace_id and series_workspace_id != resolved_workspace_id:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    return detail


@router.put("/series/{series_id}")
async def studio_update_series(
    series_id: str,
    req: StudioSeriesUpdateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    before = service.storage.get_series(series_id)
    if not before:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    resolved_workspace_id = str(before.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    result = service.storage.update_series(series_id, updates)
    if not result:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    actor = deps._collab_get_current_user(request, authorization, required=False)
    deps._studio_append_collab_operation(
        workspace_id=resolved_workspace_id,
        project_scope=f"series:{series_id}",
        action="studio.series.update",
        before=before,
        after=result,
        created_by=str(actor.get("id") or ""),
    )
    return result


@router.delete("/series/{series_id}")
async def studio_delete_series(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "owner", authorization)
    ok = service.storage.delete_series(series_id)
    if not ok:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    return {"ok": True}


# --- 卷（Volume） ---

@router.get("/series/{series_id}/volumes")
async def studio_list_volumes(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    return service.storage.list_volumes(series_id)


@router.post("/series/{series_id}/volumes")
async def studio_create_volume(
    series_id: str,
    req: StudioVolumeCreateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)

    style_anchor: Dict[str, Any] = {}
    if req.inherit_previous_anchor:
        volumes = service.storage.list_volumes(series_id)
        if volumes:
            last_anchor = volumes[-1].get("style_anchor")
            if isinstance(last_anchor, dict):
                style_anchor = dict(last_anchor)
    if not style_anchor:
        base_style = str(series.get("visual_style") or "").strip()
        if base_style:
            style_anchor = {
                "visual_style": base_style,
                "source": "series_visual_style",
                "updated_at": datetime.now().isoformat(),
            }

    try:
        created = service.storage.create_volume(
            series_id=series_id,
            volume_number=req.volume_number,
            name=req.name,
            description=req.description,
            source_text=req.source_text,
            style_anchor=style_anchor,
        )
        return created
    except ValueError as e:
        deps._studio_raise(400, str(e), "volume_invalid_payload", {"series_id": series_id})


@router.put("/volumes/{volume_id}")
async def studio_update_volume(
    volume_id: str,
    req: StudioVolumeUpdateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    before = service.storage.get_volume(volume_id)
    if not before:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    series = service.storage.get_series(str(before.get("series_id") or ""))
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": before.get("series_id")})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        updated = service.storage.update_volume(volume_id, updates)
    except ValueError as e:
        deps._studio_raise(400, str(e), "volume_invalid_payload", {"volume_id": volume_id})
    if not updated:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    return updated


@router.delete("/volumes/{volume_id}")
async def studio_delete_volume(
    volume_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    volume = service.storage.get_volume(volume_id)
    if not volume:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    series = service.storage.get_series(str(volume.get("series_id") or ""))
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": volume.get("series_id")})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    ok = service.storage.delete_volume(volume_id, detach_episodes=True)
    if not ok:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    return {"ok": True}


@router.post("/volumes/{volume_id}/episodes")
async def studio_create_episode_in_volume(
    volume_id: str,
    req: StudioVolumeEpisodeCreateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    volume = service.storage.get_volume(volume_id)
    if not volume:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    series_id = str(volume.get("series_id") or "").strip()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)

    act_number = int(req.act_number or 0)
    if act_number <= 0:
        act_number = service.storage.get_next_episode_act_number(series_id)

    try:
        created = service.storage.create_episode(
            series_id=series_id,
            volume_id=volume_id,
            act_number=act_number,
            title=req.title,
            summary=req.summary,
            script_excerpt=req.script_excerpt,
            target_duration_seconds=req.target_duration_seconds,
        )
    except ValueError as e:
        deps._studio_raise(400, str(e), "volume_invalid_payload", {"volume_id": volume_id})

    if req.status and req.status != "draft":
        try:
            created = service.storage.update_episode(str(created.get("id") or ""), {"status": req.status}) or created
        except ValueError as e:
            deps._studio_raise(400, str(e), "episode_invalid_payload", {"volume_id": volume_id})
    return created


@router.post("/volumes/{volume_id}/extract-style-anchor")
async def studio_extract_volume_style_anchor(
    volume_id: str,
    req: StudioVolumeStyleAnchorExtractRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    volume = service.storage.get_volume(volume_id)
    if not volume:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    series = service.storage.get_series(str(volume.get("series_id") or ""))
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": volume.get("series_id")})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)

    style_anchor = deps._studio_build_volume_style_anchor(
        service=service,
        series=series,
        volume_id=volume_id,
        preferred_episode_id=req.preferred_episode_id or "",
    )
    updated = service.storage.update_volume(volume_id, {"style_anchor": style_anchor})
    if not updated:
        deps._studio_raise(404, "卷不存在", "volume_not_found", {"volume_id": volume_id})
    return {"ok": True, "volume": updated, "style_anchor": style_anchor}


@router.post("/series/{series_id}/migrate-style")
async def studio_migrate_style_between_volumes(
    series_id: str,
    req: StudioStyleMigrateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    resolved_workspace_id = str(series.get("workspace_id") or "").strip() or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)

    all_volumes = service.storage.list_volumes(series_id)
    source_volume_id = str(req.source_volume_id or "").strip()
    source_volume = next((item for item in all_volumes if str(item.get("id") or "") == source_volume_id), None)
    if not source_volume:
        deps._studio_raise(404, "来源卷不存在", "volume_not_found", {"volume_id": source_volume_id})

    source_anchor_raw = source_volume.get("style_anchor")
    source_anchor = dict(source_anchor_raw) if isinstance(source_anchor_raw, dict) else {}
    if not source_anchor:
        source_anchor = deps._studio_build_volume_style_anchor(service, series, source_volume_id)
        service.storage.update_volume(source_volume_id, {"style_anchor": source_anchor})

    requested_targets = [str(item or "").strip() for item in (req.target_volume_ids or []) if str(item or "").strip()]
    candidate_volumes = [item for item in all_volumes if str(item.get("id") or "") != source_volume_id]
    if requested_targets:
        requested_set = set(requested_targets)
        target_volumes = [item for item in candidate_volumes if str(item.get("id") or "") in requested_set]
        missing_target_ids = sorted(requested_set - {str(item.get("id") or "") for item in target_volumes})
    else:
        target_volumes = candidate_volumes
        missing_target_ids = []

    updated_ids: List[str] = []
    skipped_ids: List[str] = []
    for volume in target_volumes:
        target_id = str(volume.get("id") or "")
        target_anchor = volume.get("style_anchor")
        if isinstance(target_anchor, dict) and target_anchor and not req.overwrite:
            skipped_ids.append(target_id)
            continue
        updated = service.storage.update_volume(target_id, {"style_anchor": dict(source_anchor)})
        if updated:
            updated_ids.append(target_id)
        else:
            skipped_ids.append(target_id)

    return {
        "ok": True,
        "series_id": series_id,
        "source_volume_id": source_volume_id,
        "source_style_anchor": source_anchor,
        "updated_volume_ids": updated_ids,
        "skipped_volume_ids": skipped_ids,
        "missing_target_ids": missing_target_ids,
    }


# --- 分集 ---

@router.get("/series/{series_id}/episodes")
async def studio_list_episodes(
    series_id: str,
    request: Request,
    volume_id: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    return service.storage.list_episodes(series_id, volume_id=volume_id)


@router.get("/episodes/{episode_id}")
async def studio_get_episode(
    episode_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    detail = service.get_episode_detail(episode_id)
    if not detail:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(detail.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    return detail


@router.put("/episodes/{episode_id}")
async def studio_update_episode(
    episode_id: str,
    req: StudioEpisodeUpdateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    before = service.storage.get_episode(episode_id)
    if not before:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(before.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    actor_user = deps._collab_get_current_user(request, authorization, required=False)
    if resolved_workspace_id:
        actor_user = deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    try:
        result = service.storage.update_episode(episode_id, updates)
    except ValueError as e:
        deps._studio_raise(400, str(e), "episode_invalid_payload", {"episode_id": episode_id})
    if not result:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    deps._studio_append_collab_operation(
        workspace_id=resolved_workspace_id,
        project_scope=f"episode:{episode_id}",
        action="studio.episode.update",
        before=before,
        after=result,
        created_by=str(actor_user.get("id") or ""),
    )
    try:
        service.storage.record_episode_history(episode_id, "edit_episode")
    except Exception as e:
        print(f"[Studio] 记录 edit_episode 历史失败: {e}")
    return result


@router.delete("/episodes/{episode_id}")
async def studio_delete_episode(
    episode_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )
    ok = service.storage.delete_episode(episode_id)
    if not ok:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    return {"ok": True}


@router.post("/episodes/{episode_id}/plan")
async def studio_plan_episode(
    episode_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )
    try:
        result = await service.plan_episode(episode_id)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/episodes/{episode_id}/enhance")
async def studio_enhance_episode(
    episode_id: str,
    request: Request,
    mode: str = "refine",
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )
    try:
        result = await service.enhance_episode(episode_id, mode=mode)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


# --- 共享元素 ---

@router.get("/series/{series_id}/elements")
async def studio_get_elements(
    series_id: str,
    request: Request,
    element_type: Optional[str] = Query(None, alias="type"),
    favorite: Optional[bool] = Query(None),
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    normalized_type = element_type if element_type and element_type != "all" else None
    return service.storage.get_shared_elements(
        series_id,
        element_type=normalized_type,
        favorites_only=(favorite is True),
    )


@router.post("/series/{series_id}/elements")
async def studio_add_element(
    series_id: str,
    req: StudioElementCreateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    return service.storage.add_shared_element(
        series_id=series_id,
        name=req.name,
        element_type=req.type,
        description=req.description,
        voice_profile=req.voice_profile,
        is_favorite=req.is_favorite,
    )


@router.post("/series/{series_id}/character-doc/import")
async def studio_import_character_doc(
    series_id: str,
    req: StudioCharacterDocImportRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    try:
        return await service.import_character_document(
            series_id=series_id,
            document_text=req.document_text,
            save_to_elements=req.save_to_elements,
            dedupe_by_name=req.dedupe_by_name,
        )
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.get("/series/{series_id}/digital-human-profiles")
async def studio_list_digital_human_profiles(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    try:
        return {
            "series_id": series_id,
            "profiles": service.list_digital_human_profiles(series_id),
        }
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.put("/series/{series_id}/digital-human-profiles")
async def studio_save_digital_human_profiles(
    series_id: str,
    req: StudioDigitalHumanProfilesSaveRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    try:
        profiles_payload = [item.model_dump() for item in req.profiles]
        saved = service.save_digital_human_profiles(series_id, profiles_payload)
        actor = deps._collab_get_current_user(request, authorization, required=False)
        deps._studio_append_collab_operation(
            workspace_id=resolved_workspace_id,
            project_scope=f"series:{series_id}",
            action="studio.series.update",
            before={"id": series_id, "digital_human_profiles": series.get("digital_human_profiles") or []},
            after={"id": series_id, "digital_human_profiles": saved},
            created_by=str(actor.get("id") or ""),
        )
        return {
            "series_id": series_id,
            "profiles": saved,
        }
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.put("/elements/{element_id}")
async def studio_update_element(
    element_id: str,
    req: StudioElementUpdateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    before = service.storage.get_shared_element(element_id)
    if not before:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    series = service.storage.get_series(str(before.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    result = service.storage.update_shared_element(element_id, updates)
    if not result:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    actor = deps._collab_get_current_user(request, authorization, required=False)
    deps._studio_append_collab_operation(
        workspace_id=resolved_workspace_id,
        project_scope=f"series:{before['series_id']}",
        action="studio.element.update",
        before=before,
        after=result,
        created_by=str(actor.get("id") or ""),
    )
    return result


@router.delete("/elements/{element_id}")
async def studio_delete_element(
    element_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    element = service.storage.get_shared_element(element_id)
    if not element:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    series = service.storage.get_series(str(element.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    ok = service.storage.delete_shared_element(element_id)
    if not ok:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    return {"ok": True}


@router.post("/elements/{element_id}/split-by-age")
async def studio_split_character_by_age(
    element_id: str,
    req: StudioCharacterSplitRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    element = service.storage.get_shared_element(element_id)
    if not element:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    series = service.storage.get_series(str(element.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    try:
        return await service.split_character_element_by_age(
            element_id=element_id,
            replace_original=req.replace_original,
        )
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.get("/series/{series_id}/stats")
async def studio_series_stats(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    return service.storage.get_series_stats(series_id)


# --- Phase 1: 知识库 API ---

@router.post("/series/{series_id}/kb/sync")
async def studio_kb_sync_all(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """批量同步系列下所有角色和场景元素到知识库。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    kb = KnowledgeBase(service.storage)
    result = kb.sync_all_elements(series_id)
    return {"synced": result}


@router.post("/series/{series_id}/kb/sync-element/{element_id}")
async def studio_kb_sync_element(
    series_id: str,
    element_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """同步单个共享元素到知识库卡片。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    element = service.storage.get_shared_element(element_id)
    if not element:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    kb = KnowledgeBase(service.storage)
    etype = str(element.get("type") or "")
    if etype == "character":
        card = kb.sync_character_from_element(element_id)
    elif etype == "scene":
        card = kb.sync_scene_from_element(element_id)
    else:
        deps._studio_raise(400, "仅支持 character 和 scene 类型", "unsupported_element_type")
    return card


@router.get("/series/{series_id}/kb/character-cards")
async def studio_kb_list_character_cards(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """列出系列下所有角色卡片（通过 element_id 关联）。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    # Get element IDs for this series' characters
    elements = service.storage.get_shared_elements(series_id, element_type="character")
    cards = []
    for elem in elements:
        card = service.storage.get_character_card_by_element(elem["id"])
        if card:
            card["element_name"] = elem.get("name", "")
            cards.append(card)
    return cards


@router.get("/series/{series_id}/kb/scene-cards")
async def studio_kb_list_scene_cards(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """列出系列下所有场景卡片。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    elements = service.storage.get_shared_elements(series_id, element_type="scene")
    cards = []
    for elem in elements:
        card = service.storage.get_scene_card_by_element(elem["id"])
        if card:
            card["element_name"] = elem.get("name", "")
            cards.append(card)
    return cards


@router.get("/series/{series_id}/kb/world-bible")
async def studio_kb_get_world_bible(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """获取系列的世界观词典。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    bible = service.storage.get_world_bible_by_series(series_id)
    return bible or {}


@router.put("/series/{series_id}/kb/world-bible")
async def studio_kb_save_world_bible(
    series_id: str,
    req: StudioKBWorldBibleRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """创建或更新系列的世界观词典。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    existing = service.storage.get_world_bible_by_series(series_id)
    if existing:
        return service.storage.update_world_bible(existing["id"], {
            "art_style": req.art_style,
            "era": req.era,
            "color_palette": req.color_palette,
            "recurring_motifs": req.recurring_motifs,
            "forbidden_elements": req.forbidden_elements,
        })
    return service.storage.create_world_bible(
        series_id=series_id,
        art_style=req.art_style,
        era=req.era,
        color_palette=req.color_palette,
        recurring_motifs=req.recurring_motifs,
        forbidden_elements=req.forbidden_elements,
    )


@router.get("/series/{series_id}/kb/mood-packs")
async def studio_kb_list_mood_packs(
    series_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """列出系列下所有情绪氛围预制包（含内置包）。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    # KB table packs
    kb_packs = service.storage.list_mood_packs(series_id=series_id)
    # Merge with builtins from mood_packs.py
    builtin_list = list_available_moods()
    kb_keys = {p.get("mood_key") for p in kb_packs}
    for builtin in builtin_list:
        if builtin["mood_key"] not in kb_keys:
            kb_packs.append(builtin)
    return kb_packs


@router.post("/series/{series_id}/kb/mood-packs")
async def studio_kb_save_mood_pack(
    series_id: str,
    req: StudioKBMoodPackRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    """创建或更新系列的情绪氛围预制包。"""
    service = deps._studio_ensure_service_ready()
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str(series.get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    combined = req.combined_prompt
    if not combined:
        parts = [t for t in (req.color_tokens, req.line_style_tokens, req.effect_tokens) if t]
        combined = ", ".join(parts)
    return service.storage.create_mood_pack(
        mood_key=req.mood_key,
        series_id=series_id,
        color_tokens=req.color_tokens,
        line_style_tokens=req.line_style_tokens,
        effect_tokens=req.effect_tokens,
        combined_prompt=combined,
        is_builtin=req.is_builtin,
    )


# --- 镜头 ---

@router.get("/episodes/{episode_id}/shots")
async def studio_get_shots(
    episode_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    return service.storage.get_shots(episode_id)


@router.post("/episodes/{episode_id}/shots/reorder")
async def studio_reorder_shots(
    episode_id: str,
    req: StudioReorderShotsRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    ids = [sid for sid in req.shot_ids if isinstance(sid, str) and sid.strip()]
    if not ids:
        deps._studio_raise(400, "镜头排序列表不能为空", "invalid_shot_order_payload", {"episode_id": episode_id})

    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    actor = deps._collab_get_current_user(request, authorization, required=False)
    if resolved_workspace_id:
        actor = deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )

    existing = service.storage.get_shots(episode_id)
    existing_ids = [shot["id"] for shot in existing]
    if sorted(existing_ids) != sorted(ids):
        deps._studio_raise(
            400,
            "镜头排序列表与当前集镜头不一致",
            "invalid_shot_order_payload",
            {"episode_id": episode_id, "expected_count": len(existing_ids), "actual_count": len(ids)},
        )

    service.storage.reorder_shots(episode_id, ids)
    deps._studio_append_collab_operation(
        workspace_id=resolved_workspace_id,
        project_scope=f"episode:{episode_id}",
        action="studio.shot.reorder",
        before={"episode_id": episode_id, "shot_ids": existing_ids},
        after={"episode_id": episode_id, "shot_ids": ids},
        created_by=str(actor.get("id") or ""),
    )
    return {"ok": True, "shots": service.storage.get_shots(episode_id)}


@router.put("/shots/{shot_id}")
async def studio_update_shot(
    shot_id: str,
    req: StudioShotUpdateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    before = service.storage.get_shot(shot_id)
    if not before:
        deps._studio_raise(404, "镜头不存在", "shot_not_found", {"shot_id": shot_id})
    episode = service.storage.get_episode(str(before.get("episode_id") or ""))
    series = service.storage.get_series(str((episode or {}).get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    actor = deps._collab_get_current_user(request, authorization, required=False)
    if resolved_workspace_id and episode:
        actor = deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=str(episode.get("id") or ""),
            authorization=authorization,
        )
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    result = service.storage.update_shot(shot_id, updates)
    if not result:
        deps._studio_raise(404, "镜头不存在", "shot_not_found", {"shot_id": shot_id})
    deps._studio_append_collab_operation(
        workspace_id=resolved_workspace_id,
        project_scope=f"episode:{result['episode_id']}",
        action="studio.shot.update",
        before=before,
        after=result,
        created_by=str(actor.get("id") or ""),
    )
    if result.get("episode_id"):
        try:
            service.storage.record_episode_history(result["episode_id"], "edit_shot")
        except Exception as e:
            print(f"[Studio] 记录 edit_shot 历史失败: {e}")
    return result


@router.delete("/shots/{shot_id}")
async def studio_delete_shot(
    shot_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    shot = service.storage.get_shot(shot_id)
    if not shot:
        deps._studio_raise(404, "镜头不存在", "shot_not_found", {"shot_id": shot_id})
    episode = service.storage.get_episode(str(shot.get("episode_id") or ""))
    series = service.storage.get_series(str((episode or {}).get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id and episode:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=str(episode.get("id") or ""),
            authorization=authorization,
        )
    ok = service.storage.delete_shot(shot_id)
    if not ok:
        deps._studio_raise(404, "镜头不存在", "shot_not_found", {"shot_id": shot_id})
    return {"ok": True}


@router.post("/shots/{shot_id}/generate")
async def studio_generate_shot_asset(
    shot_id: str,
    req: StudioGenerateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    shot = service.storage.get_shot(shot_id)
    if not shot:
        deps._studio_raise(404, "镜头不存在", "shot_not_found", {"shot_id": shot_id})
    episode = service.storage.get_episode(str(shot.get("episode_id") or ""))
    series = service.storage.get_series(str((episode or {}).get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id and episode:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=str(episode.get("id") or ""),
            authorization=authorization,
        )
    try:
        if req.stage == "frame":
            return await service.generate_shot_frame(
                shot_id, width=req.width, height=req.height
            )
        elif req.stage == "key_frame":
            return await service.generate_shot_key_frame(
                shot_id, width=req.width, height=req.height
            )
        elif req.stage == "end_frame":
            return await service.generate_shot_end_frame(
                shot_id, width=req.width, height=req.height
            )
        elif req.stage == "video":
            return await service.generate_shot_video(
                shot_id,
                video_generate_audio=req.video_generate_audio,
            )
        elif req.stage == "audio":
            return await service.generate_shot_audio(
                shot_id, voice_type=req.voice_type
            )
        else:
            deps._studio_raise(400, f"未知的生成阶段: {req.stage}", "invalid_generation_stage")
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/shots/{shot_id}/inpaint")
async def studio_inpaint_shot_frame(
    shot_id: str,
    req: StudioInpaintRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    shot = service.storage.get_shot(shot_id)
    if not shot:
        deps._studio_raise(404, "镜头不存在", "shot_not_found", {"shot_id": shot_id})
    episode = service.storage.get_episode(str(shot.get("episode_id") or ""))
    series = service.storage.get_series(str((episode or {}).get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id and episode:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=str(episode.get("id") or ""),
            authorization=authorization,
        )
    try:
        return await service.inpaint_shot_frame(
            shot_id=shot_id,
            edit_prompt=req.edit_prompt,
            mask_data=req.mask_data,
            width=req.width,
            height=req.height,
        )
    except Exception as e:
        deps._studio_raise_from_exception(e)


# --- 元素图片生成 ---

@router.post("/elements/{element_id}/generate-image")
async def studio_generate_element_image(
    element_id: str,
    request: Request,
    req: Optional[StudioElementGenerateImageRequest] = None,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    element = service.storage.get_shared_element(element_id)
    if not element:
        deps._studio_raise(404, "元素不存在", "element_not_found", {"element_id": element_id})
    series = service.storage.get_series(str(element.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)
    try:
        payload = req or StudioElementGenerateImageRequest()
        return await service.generate_element_image(
            element_id=element_id,
            width=payload.width or 2048,
            height=payload.height or 2048,
            use_reference=bool(payload.use_reference),
            reference_mode=payload.reference_mode or "none",
            render_mode=payload.render_mode or "auto",
            max_images=payload.max_images or 1,
            steps=payload.steps or 28,
            seed=payload.seed,
        )
    except Exception as e:
        deps._studio_raise_from_exception(e)


# --- 批量生成 ---

@router.get("/episodes/{episode_id}/batch-generate-stream")
async def studio_batch_generate_stream(
    episode_id: str,
    request: Request,
    stages: Optional[str] = Query(None),
    workspace_id: Optional[str] = Query(None),
    video_generate_audio: Optional[bool] = Query(None),
    image_width: Optional[int] = Query(None, ge=128, le=4096),
    image_height: Optional[int] = Query(None, ge=128, le=4096),
    element_use_reference: Optional[bool] = Query(None),
    element_reference_mode: Optional[str] = Query("none"),
    image_max_concurrency: Optional[int] = Query(None, ge=1, le=12),
    video_max_concurrency: Optional[int] = Query(None, ge=1, le=8),
    global_max_concurrency: Optional[int] = Query(None, ge=1, le=16),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()

    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )

    default_stages = ["elements", "frames", "key_frames", "end_frames", "videos", "audio"]
    stage_list = [s.strip() for s in (stages or "").split(",") if s.strip()] or default_stages
    allowed_stages = set(default_stages)
    invalid_stages = [s for s in stage_list if s not in allowed_stages]
    if invalid_stages:
        deps._studio_raise(
            400,
            f"无效的生成阶段: {', '.join(invalid_stages)}",
            "invalid_generation_stage",
            {"invalid_stages": invalid_stages, "allowed_stages": default_stages},
        )

    parallel_cfg: Dict[str, Any] = {}
    if image_max_concurrency is not None:
        parallel_cfg["image_max_concurrency"] = image_max_concurrency
    if video_max_concurrency is not None:
        parallel_cfg["video_max_concurrency"] = video_max_concurrency
    if global_max_concurrency is not None:
        parallel_cfg["global_max_concurrency"] = global_max_concurrency

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue()

        async def on_progress(event: Dict[str, Any]) -> None:
            await queue.put(event)

        worker = asyncio.create_task(
            service.batch_generate_episode(
                episode_id=episode_id,
                stages=stage_list,
                parallel=parallel_cfg,
                video_generate_audio=video_generate_audio,
                image_width=image_width,
                image_height=image_height,
                element_use_reference=element_use_reference,
                element_reference_mode=element_reference_mode or "none",
                progress_callback=on_progress,
            )
        )

        try:
            while True:
                if worker.done() and queue.empty():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=0.5)
                    yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keep-alive\n\n"

            try:
                await worker
            except Exception as e:
                payload = e.to_payload() if isinstance(e, StudioServiceError) else deps._studio_error_payload(str(e), "studio_internal_error")
                payload["type"] = "error"
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"
        finally:
            if not worker.done():
                worker.cancel()
                try:
                    await worker
                except Exception:
                    pass

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/episodes/{episode_id}/batch-generate")
async def studio_batch_generate(
    episode_id: str,
    req: StudioBatchGenerateRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )
    default_stages = ["elements", "frames", "key_frames", "end_frames", "videos", "audio"]
    stage_list = [str(s or "").strip() for s in (req.stages or []) if str(s or "").strip()] or default_stages
    allowed_stages = set(default_stages)
    invalid_stages = [s for s in stage_list if s not in allowed_stages]
    if invalid_stages:
        deps._studio_raise(
            400,
            f"无效的生成阶段: {', '.join(invalid_stages)}",
            "invalid_generation_stage",
            {"invalid_stages": invalid_stages, "allowed_stages": default_stages},
        )
    try:
        return await service.batch_generate_episode(
            episode_id,
            stages=stage_list,
            parallel=req.parallel,
            video_generate_audio=req.video_generate_audio,
            image_width=req.image_width,
            image_height=req.image_height,
            element_use_reference=req.element_use_reference,
            element_reference_mode=req.element_reference_mode or "none",
        )
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.get("/episodes/{episode_id}/history")
async def studio_get_episode_history(
    episode_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    include_snapshot: bool = Query(False),
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    try:
        return service.get_episode_history(
            episode_id,
            limit=limit,
            include_snapshot=include_snapshot,
        )
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/episodes/{episode_id}/restore/{history_id}")
async def studio_restore_episode_history(
    episode_id: str,
    history_id: str,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )
    try:
        service.restore_episode_history(episode_id, history_id)
        detail = service.get_episode_detail(episode_id)
        return {
            "ok": True,
            "episode_id": episode_id,
            "history_id": history_id,
            "episode": detail,
            "history": service.get_episode_history(episode_id, limit=50, include_snapshot=True),
        }
    except Exception as e:
        deps._studio_raise_from_exception(e)


# --- Studio 设置 ---

@router.get("/settings")
async def studio_get_settings(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    if deps.AUTH_REQUIRED and not resolved_workspace_id:
        deps._studio_raise(400, "读取 Studio 设置必须指定 workspace_id", "workspace_required")
    if resolved_workspace_id and (deps.AUTH_REQUIRED or workspace_id):
        deps._collab_require_workspace_role(request, resolved_workspace_id, "viewer", authorization)
    return deps.studio_current_settings or {}


@router.get("/prompt-templates/defaults")
async def studio_get_prompt_templates_defaults():
    return {
        "ok": True,
        "custom_prompts": build_default_custom_prompts(),
        "variable_hints": {
            "script_split": [
                "full_script",
                "target_episode_count",
                "episode_duration_seconds",
                "visual_style",
            ],
            "element_extraction": [
                "full_script",
                "acts_summary",
                "visual_style",
            ],
            "episode_planning": [
                "series_name",
                "act_number",
                "episode_title",
                "series_bible",
                "visual_style",
                "shared_elements_list",
                "prev_summary",
                "script_excerpt",
                "next_summary",
                "target_duration_seconds",
                "suggested_shot_count",
            ],
            "episode_enhance": [
                "series_bible",
                "shared_elements_list",
                "episode_json",
                "mode",
            ],
        },
    }


@router.put("/settings")
async def studio_save_settings(
    req: StudioSettingsRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    global deps.studio_current_settings
    service = deps._studio_ensure_service_ready()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    if deps.AUTH_REQUIRED and not resolved_workspace_id:
        deps._studio_raise(400, "保存 Studio 设置必须指定 workspace_id", "workspace_required")
    if resolved_workspace_id and (deps.AUTH_REQUIRED or workspace_id):
        deps._collab_require_workspace_role(request, resolved_workspace_id, "editor", authorization)

    new_settings = {k: v for k, v in req.model_dump().items() if v is not None}
    if "custom_prompts" in new_settings:
        new_settings["custom_prompts"] = normalize_custom_prompts(new_settings["custom_prompts"])
    deps.studio_current_settings.update(new_settings)

    # 持久化到 yaml
    import yaml as _yaml
    settings_path = os.path.join(os.path.dirname(__file__), "data", "studio.settings.local.yaml")
    try:
        with open(settings_path, "w", encoding="utf-8") as f:
            _yaml.dump(deps.studio_current_settings, f, allow_unicode=True, default_flow_style=False)
    except Exception as e:
        print(f"[Studio] 保存设置失败: {e}")

    # 重新配置服务
    service.configure(deps.studio_current_settings)
    return {"ok": True, "settings": deps.studio_current_settings}


@router.post("/prompt-check")
async def studio_prompt_check(req: StudioPromptCheckRequest):
    if req.items and len(req.items) > 0:
        results: List[Dict[str, Any]] = []
        for item in req.items:
            analysis = analyze_prompt_text(item.prompt or "")
            results.append({
                "id": item.id,
                "field": item.field,
                "label": item.label,
                "prompt": item.prompt or "",
                **analysis,
            })
        return {"ok": True, "results": results}

    analysis = analyze_prompt_text(req.prompt or "")
    return {"ok": True, **analysis}


@router.post("/prompt-optimize")
async def studio_prompt_optimize(req: StudioPromptOptimizeRequest):
    service = deps._studio_ensure_service_ready()
    original = req.prompt or ""
    before = analyze_prompt_text(original)
    rule_based = apply_prompt_suggestions(original, before.get("suggestions") or [])

    optimized = rule_based
    used_llm = False
    if req.use_llm and not before.get("safe", True):
        llm_result = await service.optimize_prompt_with_llm(rule_based, before)
        candidate = (llm_result.get("optimized_prompt") or "").strip()
        if candidate:
            optimized = candidate
        used_llm = bool(llm_result.get("used_llm"))

    after = analyze_prompt_text(optimized)
    return {
        "ok": True,
        "optimized_prompt": optimized,
        "changed": optimized.strip() != original.strip(),
        "used_llm": used_llm,
        "before": before,
        "after": after,
    }


@router.get("/config-check")
async def studio_config_check(
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    if deps.AUTH_REQUIRED and not resolved_workspace_id:
        deps._studio_raise(400, "读取 Studio 配置检查必须指定 workspace_id", "workspace_required")
    if resolved_workspace_id and (deps.AUTH_REQUIRED or workspace_id):
        deps._collab_require_workspace_role(request, resolved_workspace_id, "viewer", authorization)
    service = deps._studio_ensure_service_ready()
    return service.check_config()


# --- Studio <-> Agent ---

@router.post("/episodes/{episode_id}/export-to-agent")
async def studio_export_episode_to_agent(
    episode_id: str,
    request: Request,
    req: Optional[StudioExportToAgentRequest] = None,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    payload = req or StudioExportToAgentRequest()

    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(episode["series_id"])
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": episode["series_id"]})
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )

    shots = service.storage.get_shots(episode_id)
    episode_elements = service.storage.get_episode_elements(episode_id)
    shared_elements = service.storage.get_shared_elements(series["id"]) if payload.include_shared_elements else []

    target_project_id = (payload.project_id or "").strip()
    existing_project: Optional[Dict[str, Any]] = None
    if target_project_id:
        existing_project = storage.get_agent_project(target_project_id)
        if not existing_project:
            deps._studio_raise(404, "Agent 项目不存在", "agent_project_not_found", {"project_id": target_project_id})

    now = datetime.now().isoformat()
    agent_project_id = target_project_id or f"agent_{uuid.uuid4().hex[:8]}"
    default_project_name = f"{series.get('name') or '未命名系列'} · 第{episode.get('act_number') or 0}幕 {episode.get('title') or '未命名分幕'}"
    project_name = (
        (payload.project_name or "").strip()
        or str((existing_project or {}).get("name") or "").strip()
        or default_project_name
    )

    elements: Dict[str, Dict[str, Any]] = {}

    def upsert_agent_element(source: Dict[str, Any], fallback_prefix: str) -> None:
        raw_id = str(source.get("id") or source.get("shared_element_id") or "").strip()
        fallback = f"{fallback_prefix}_{len(elements) + 1:03d}"
        element_id = deps._studio_normalize_agent_element_id(raw_id, fallback)
        existing = elements.get(element_id, {})

        image_url = str(source.get("image_url") or "").strip()
        image_history = deps._studio_history_urls_to_agent_items(source.get("image_history"))
        reference_images = source.get("reference_images")
        if not isinstance(reference_images, list):
            reference_images = []

        elements[element_id] = {
            **existing,
            "id": element_id,
            "name": str(source.get("name") or existing.get("name") or element_id),
            "type": str(source.get("type") or existing.get("type") or "character"),
            "description": str(source.get("description") or existing.get("description") or ""),
            "voice_profile": str(source.get("voice_profile") or existing.get("voice_profile") or ""),
            "image_url": image_url or str(existing.get("image_url") or ""),
            "cached_image_url": image_url or str(existing.get("cached_image_url") or ""),
            "image_history": image_history or existing.get("image_history") or [],
            "reference_images": reference_images or existing.get("reference_images") or [],
            "created_at": str(source.get("created_at") or existing.get("created_at") or now),
            "source": str(source.get("source") or existing.get("source") or "studio"),
            "source_series_id": str(series["id"]),
            "source_episode_id": str(episode_id),
            "source_studio_element_id": str(source.get("id") or source.get("shared_element_id") or ""),
        }

    for shared in shared_elements:
        if not isinstance(shared, dict):
            continue
        upsert_agent_element(
            {
                **shared,
                "source": "studio_shared",
            },
            "SE",
        )

    if payload.include_episode_elements:
        for element in episode_elements:
            if not isinstance(element, dict):
                continue
            upsert_agent_element(
                {
                    **element,
                    "source": "studio_episode",
                },
                "EE",
            )

    segments_by_name: Dict[str, Dict[str, Any]] = {}
    segment_order: List[str] = []
    timeline: List[Dict[str, Any]] = []
    visual_assets: List[Dict[str, Any]] = []
    audio_assets: List[Dict[str, Any]] = []
    cursor = 0.0

    sorted_shots = sorted(shots, key=lambda s: int(s.get("sort_order") or 0))
    for shot_index, shot in enumerate(sorted_shots):
        if not isinstance(shot, dict):
            continue
        segment_name = str(shot.get("segment_name") or "未分段")
        if segment_name not in segments_by_name:
            segment_id = f"Segment_{len(segment_order) + 1:02d}"
            segment_order.append(segment_name)
            segments_by_name[segment_name] = {
                "id": segment_id,
                "name": segment_name,
                "description": "",
                "shots": [],
                "created_at": now,
            }

        duration = max(0.1, deps._studio_parse_float(shot.get("duration"), 5.0))
        shot_id = str(shot.get("id") or f"Shot_{shot_index + 1:03d}")
        frame_history_urls = deps._studio_agent_history_to_urls(shot.get("frame_history"))
        video_history_urls = deps._studio_agent_history_to_urls(shot.get("video_history"))

        start_image_url = str(shot.get("start_image_url") or "").strip()
        if not start_image_url and frame_history_urls:
            start_image_url = frame_history_urls[-1]
        end_image_url = str(shot.get("end_image_url") or "").strip()
        video_url = str(shot.get("video_url") or "").strip()
        audio_url = str(shot.get("audio_url") or "").strip()

        agent_shot: Dict[str, Any] = {
            "id": shot_id,
            "name": str(shot.get("name") or f"镜头 {shot_index + 1}"),
            "type": str(shot.get("type") or "standard"),
            "description": str(shot.get("description") or ""),
            "prompt": str(shot.get("prompt") or ""),
            "end_prompt": str(shot.get("end_prompt") or ""),
            "video_prompt": str(shot.get("video_prompt") or ""),
            "dialogue_script": str(shot.get("dialogue_script") or ""),
            "narration": str(shot.get("narration") or ""),
            "duration": duration,
            "start_image_url": start_image_url,
            "end_image_url": end_image_url,
            "video_url": video_url,
            "voice_audio_url": audio_url,
            "audio_url": audio_url,
            "status": str(shot.get("status") or ("video_ready" if video_url else "pending")),
            "sort_order": int(shot.get("sort_order") or shot_index),
            "created_at": str(shot.get("created_at") or now),
            "updated_at": str(shot.get("updated_at") or now),
            "source_shot_id": str(shot.get("id") or ""),
            "source_episode_id": str(episode_id),
        }
        if frame_history_urls:
            agent_shot["start_image_history"] = deps._studio_history_urls_to_agent_items(frame_history_urls)
        if video_history_urls:
            agent_shot["video_history"] = deps._studio_history_urls_to_agent_items(video_history_urls)

        segments_by_name[segment_name]["shots"].append(agent_shot)
        timeline.append({
            "id": shot_id,
            "type": "shot",
            "start": round(cursor, 3),
            "duration": round(duration, 3),
        })
        cursor += duration

        if start_image_url:
            visual_assets.append({
                "id": f"asset_{shot_id}_start",
                "type": "start_frame",
                "url": start_image_url,
            })
        if end_image_url:
            visual_assets.append({
                "id": f"asset_{shot_id}_end",
                "type": "end_frame",
                "url": end_image_url,
            })
        if video_url:
            visual_assets.append({
                "id": f"asset_{shot_id}_video",
                "type": "video",
                "url": video_url,
                "duration": round(duration, 3),
            })
        if audio_url:
            audio_assets.append({
                "id": f"asset_{shot_id}_audio",
                "type": "voice",
                "url": audio_url,
            })

    segments = [segments_by_name[name] for name in segment_order]
    creative_brief = episode.get("creative_brief") if isinstance(episode.get("creative_brief"), dict) else {}
    creative_brief = {
        **creative_brief,
        "title": episode.get("title") or creative_brief.get("title") or "",
        "summary": episode.get("summary") or creative_brief.get("summary") or "",
        "series_name": series.get("name") or "",
        "series_bible": series.get("series_bible") or "",
        "visual_style": series.get("visual_style") or "",
        "episode_duration_seconds": deps._studio_parse_float(episode.get("target_duration_seconds"), 0.0),
        "source_episode_id": episode_id,
        "source_series_id": series["id"],
    }

    preserve_messages = bool(payload.preserve_existing_messages and existing_project)
    project_payload: Dict[str, Any] = {
        "id": agent_project_id,
        "name": project_name,
        "creative_brief": creative_brief,
        "elements": elements,
        "segments": segments,
        "visual_assets": visual_assets,
        "audio_assets": audio_assets,
        "audio_timeline": (existing_project or {}).get("audio_timeline", {}) if preserve_messages else {},
        "timeline": timeline,
        "messages": (existing_project or {}).get("messages", []) if preserve_messages else [],
        "agent_memory": (existing_project or {}).get("agent_memory", []) if preserve_messages else [],
        "created_at": str((existing_project or {}).get("created_at") or now),
        "updated_at": now,
        "studio_bridge": {
            "source": "studio",
            "series_id": series["id"],
            "episode_id": episode_id,
            "exported_at": now,
        },
    }

    storage.save_agent_project(project_payload)
    shots_count = sum(len(seg.get("shots", [])) for seg in segments)
    return {
        "ok": True,
        "episode_id": episode_id,
        "project_id": agent_project_id,
        "project_name": project_name,
        "created": existing_project is None,
        "elements_count": len(elements),
        "segments_count": len(segments),
        "shots_count": shots_count,
    }


@router.post("/episodes/{episode_id}/import-from-agent")
async def studio_import_episode_from_agent(
    episode_id: str,
    req: StudioImportFromAgentRequest,
    request: Request,
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = series_workspace or deps._collab_pick_workspace_id(request, workspace_id)
    if resolved_workspace_id:
        deps._collab_require_episode_write_access(
            request=request,
            workspace_id=resolved_workspace_id,
            episode_id=episode_id,
            authorization=authorization,
        )

    project_id = deps._studio_pick_agent_project_id(req)
    project = storage.get_agent_project(project_id)
    if not project:
        deps._studio_raise(404, "Agent 项目不存在", "agent_project_not_found", {"project_id": project_id})

    segments = project.get("segments")
    if not isinstance(segments, list) or len(segments) == 0:
        deps._studio_raise(400, "Agent 项目没有可导入的段落", "agent_project_invalid", {"project_id": project_id})

    shots_payload: List[Dict[str, Any]] = []
    total_duration = 0.0
    for seg_index, segment in enumerate(segments):
        if not isinstance(segment, dict):
            continue
        segment_name = str(segment.get("name") or f"段落 {seg_index + 1}")
        segment_shots = segment.get("shots")
        if not isinstance(segment_shots, list):
            continue
        for shot_index, shot in enumerate(segment_shots):
            if not isinstance(shot, dict):
                continue
            duration = max(0.1, deps._studio_parse_float(shot.get("duration"), 5.0))
            total_duration += duration

            frame_history_urls = deps._studio_agent_history_to_urls(
                shot.get("start_image_history") if shot.get("start_image_history") else shot.get("frame_history"),
            )
            video_history_urls = deps._studio_agent_history_to_urls(shot.get("video_history"))
            start_image_url = str(shot.get("start_image_url") or shot.get("cached_start_image_url") or "").strip()
            if not start_image_url and frame_history_urls:
                start_image_url = frame_history_urls[-1]
            video_url = str(shot.get("video_url") or "").strip()
            audio_url = str(
                shot.get("voice_audio_url")
                or shot.get("audio_url")
                or shot.get("narration_audio_url")
                or "",
            ).strip()

            shots_payload.append({
                "segment_name": segment_name,
                "name": str(shot.get("name") or f"镜头 {seg_index + 1}-{shot_index + 1}"),
                "type": str(shot.get("type") or "standard"),
                "duration": duration,
                "description": str(shot.get("description") or ""),
                "prompt": str(shot.get("prompt") or shot.get("video_prompt") or ""),
                "end_prompt": str(shot.get("end_prompt") or ""),
                "video_prompt": str(shot.get("video_prompt") or shot.get("prompt") or ""),
                "narration": str(shot.get("narration") or ""),
                "dialogue_script": str(shot.get("dialogue_script") or ""),
                "start_image_url": start_image_url,
                "video_url": video_url,
                "audio_url": audio_url,
                "frame_history": frame_history_urls,
                "video_history": video_history_urls,
                "status": str(shot.get("status") or ("video_ready" if video_url else "pending")),
            })

    if len(shots_payload) == 0:
        deps._studio_raise(400, "Agent 项目没有可导入的镜头", "agent_project_invalid", {"project_id": project_id})

    created_shots = service.storage.bulk_add_shots(episode_id, shots_payload)

    creative_brief = project.get("creative_brief") if isinstance(project.get("creative_brief"), dict) else {}
    creative_brief = {
        **creative_brief,
        "source_agent_project_id": project_id,
        "imported_at": datetime.now().isoformat(),
    }
    updates: Dict[str, Any] = {
        "creative_brief": creative_brief,
        "target_duration_seconds": round(total_duration, 3),
        "status": "planned",
    }
    if req.overwrite_episode_meta:
        project_name = str(project.get("name") or "").strip()
        if project_name:
            updates["title"] = project_name
        updates["summary"] = deps._studio_summarize_agent_project(project, len(shots_payload), total_duration)
    service.storage.update_episode(episode_id, updates)

    imported_elements = 0
    if req.import_elements:
        source_elements = project.get("elements")
        normalized_elements: List[Dict[str, Any]] = []
        if isinstance(source_elements, dict):
            iter_elements = source_elements.values()
        elif isinstance(source_elements, list):
            iter_elements = source_elements
        else:
            iter_elements = []

        for element in iter_elements:
            if not isinstance(element, dict):
                continue
            name = str(element.get("name") or "").strip()
            if not name:
                continue
            normalized_elements.append({
                "name": name,
                "type": str(element.get("type") or "character"),
                "description": str(element.get("description") or ""),
                "voice_profile": str(element.get("voice_profile") or ""),
                "image_url": str(element.get("image_url") or element.get("cached_image_url") or ""),
                "is_override": 1,
            })
        service.storage.replace_episode_elements(
            episode_id=episode_id,
            elements_data=normalized_elements,
            keep_shared_elements=True,
        )
        imported_elements = len(normalized_elements)

    try:
        service.storage.record_episode_history(episode_id, f"import_agent_{project_id}")
    except Exception as e:
        print(f"[Studio] 记录 import_agent 历史失败: {e}")

    detail = service.get_episode_detail(episode_id)
    return {
        "ok": True,
        "episode_id": episode_id,
        "project_id": project_id,
        "shots_imported": len(created_shots),
        "elements_imported": imported_elements,
        "episode": detail,
    }


# --- 导出 ---

@router.post("/episodes/{episode_id}/export")
async def studio_export_episode(
    episode_id: str,
    request: Request,
    mode: str = Query("assets"),
    resolution: str = Query("720p"),
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    if mode not in {"assets", "video"}:
        deps._studio_raise(400, "导出模式无效", "invalid_export_mode", {"mode": mode})
    if resolution not in {"720p", "1080p"}:
        deps._studio_raise(400, "分辨率参数无效", "invalid_export_resolution", {"resolution": resolution})
    episode = service.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = service.storage.get_series(str(episode.get("series_id") or ""))
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"episode_id": episode_id})
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})

    exporter = StudioExportService(service.storage)
    try:
        if mode == "video":
            file_path = await exporter.export_episode_merged_video(episode_id, resolution=resolution)
            media_type = "video/mp4"
        else:
            file_path = await exporter.export_episode_assets_zip(episode_id)
            media_type = "application/zip"
    except ValueError as e:
        if str(e) == "episode_not_found":
            deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
        if str(e) == "series_not_found":
            deps._studio_raise(404, "系列不存在", "series_not_found", {"episode_id": episode_id})
        deps._studio_raise(400, f"导出失败: {str(e)}", "studio_export_error")
    except Exception as e:
        deps._studio_raise(500, f"导出失败: {str(e)}", "studio_export_error")

    return FileResponse(
        file_path,
        media_type=media_type,
        filename=os.path.basename(file_path),
    )


@router.post("/series/{series_id}/export")
async def studio_export_series(
    series_id: str,
    request: Request,
    mode: str = Query("assets"),
    resolution: str = Query("720p"),
    workspace_id: Optional[str] = Query(None),
    authorization: Optional[str] = Header(None),
):
    service = deps._studio_ensure_service_ready()
    if mode not in {"assets", "video"}:
        deps._studio_raise(400, "导出模式无效", "invalid_export_mode", {"mode": mode})
    if resolution not in {"720p", "1080p"}:
        deps._studio_raise(400, "分辨率参数无效", "invalid_export_resolution", {"resolution": resolution})
    series = service.storage.get_series(series_id)
    if not series:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
    series_workspace = str((series or {}).get("workspace_id") or "").strip()
    resolved_workspace_id = deps._collab_pick_workspace_id(request, workspace_id)
    effective_workspace_id = series_workspace or resolved_workspace_id
    if effective_workspace_id and (deps.AUTH_REQUIRED or resolved_workspace_id):
        deps._collab_require_workspace_role(request, effective_workspace_id, "viewer", authorization)
    if resolved_workspace_id and series_workspace and resolved_workspace_id != series_workspace:
        deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})

    exporter = StudioExportService(service.storage)
    try:
        if mode == "video":
            file_path = await exporter.export_series_merged_video(series_id, resolution=resolution)
            media_type = "video/mp4"
        else:
            file_path = await exporter.export_series_assets_zip(series_id)
            media_type = "application/zip"
    except ValueError as e:
        if str(e) == "series_not_found":
            deps._studio_raise(404, "系列不存在", "series_not_found", {"series_id": series_id})
        deps._studio_raise(400, f"导出失败: {str(e)}", "studio_export_error")
    except Exception as e:
        deps._studio_raise(500, f"导出失败: {str(e)}", "studio_export_error")

    return FileResponse(
        file_path,
        media_type=media_type,
        filename=os.path.basename(file_path),
    )


# =====================================================================
# Phase 1: Knowledge Base API Endpoints
# =====================================================================


def deps._kb_get_instance() -> KnowledgeBase:
    """获取或创建 KnowledgeBase 实例"""
    service = deps._studio_ensure_service_ready()
    if service._knowledge_base is None:
        service._knowledge_base = KnowledgeBase(service.storage)
    return service._knowledge_base


@router.get("/kb/character-cards/{series_id}")
async def kb_list_character_cards(series_id: str):
    """获取系列下所有角色的知识库档案"""
    service = deps._studio_ensure_service_ready()
    elements = service.storage.get_shared_elements(series_id)
    characters = [e for e in elements if e.get("type") == "character"]
    cards = []
    for ch in characters:
        card = service.storage.get_character_card_by_element(ch["id"])
        if card:
            cards.append({**card, "element_name": ch.get("name", "")})
    return {"cards": cards}


@router.post("/kb/character-cards/sync/{element_id}")
async def kb_sync_character_card(element_id: str):
    """从共享元素同步/生成角色提示词档案"""
    kb = deps._kb_get_instance()
    card = kb.sync_character_from_element(element_id)
    if not card:
        deps._studio_raise(404, "元素不存在或非角色类型", "element_not_found")
    return {"card": card}


class KBCharacterCardUpdate(BaseModel):
    appearance_tokens: Optional[Dict[str, Any]] = None
    costume_tokens: Optional[Dict[str, Any]] = None
    expression_tokens: Optional[Dict[str, Any]] = None
    signature_poses: Optional[Dict[str, Any]] = None
    negative_prompts: Optional[str] = None


@router.put("/kb/character-cards/{card_id}")
async def kb_update_character_card(card_id: str, body: KBCharacterCardUpdate):
    """更新角色提示词档案"""
    service = deps._studio_ensure_service_ready()
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if not updates:
        card = service.storage.get_character_card(card_id)
        return {"card": card}
    card = service.storage.update_character_card(card_id, updates)
    if not card:
        deps._studio_raise(404, "角色档案不存在", "card_not_found")
    return {"card": card}


@router.get("/kb/scene-cards/{series_id}")
async def kb_list_scene_cards(series_id: str):
    """获取系列下所有场景的知识库档案"""
    service = deps._studio_ensure_service_ready()
    elements = service.storage.get_shared_elements(series_id)
    scenes = [e for e in elements if e.get("type") == "scene"]
    cards = []
    for sc in scenes:
        card = service.storage.get_scene_card_by_element(sc["id"])
        if card:
            cards.append({**card, "element_name": sc.get("name", "")})
    return {"cards": cards}


@router.post("/kb/scene-cards/sync/{element_id}")
async def kb_sync_scene_card(element_id: str):
    """从共享元素同步/生成场景提示词档案"""
    kb = deps._kb_get_instance()
    card = kb.sync_scene_from_element(element_id)
    if not card:
        deps._studio_raise(404, "元素不存在或非场景类型", "element_not_found")
    return {"card": card}


class KBSceneCardUpdate(BaseModel):
    base_tokens: Optional[str] = None
    time_variants: Optional[Dict[str, Any]] = None
    negative_prompts: Optional[str] = None


@router.put("/kb/scene-cards/{card_id}")
async def kb_update_scene_card(card_id: str, body: KBSceneCardUpdate):
    """更新场景提示词档案"""
    service = deps._studio_ensure_service_ready()
    updates = {k: v for k, v in body.dict().items() if v is not None}
    card = service.storage.update_scene_card(card_id, updates)
    if not card:
        deps._studio_raise(404, "场景档案不存在", "card_not_found")
    return {"card": card}


@router.get("/kb/mood-packs")
async def kb_list_mood_packs():
    """列出所有可用情绪氛围包（内置 + 自定义）"""
    packs = list_available_moods()
    return {"packs": packs}


@router.get("/kb/mood-packs/{series_id}")
async def kb_list_mood_packs_for_series(series_id: str):
    """列出系列专属情绪包（含内置）"""
    service = deps._studio_ensure_service_ready()
    builtin = list_available_moods()
    custom_rows = service.storage.list_mood_packs(series_id)
    custom = [dict(r) for r in custom_rows] if custom_rows else []
    return {"packs": builtin, "custom": custom}


class KBMoodPackCreate(BaseModel):
    series_id: str
    mood_key: str
    color_tokens: str = ""
    line_style_tokens: str = ""
    effect_tokens: str = ""
    combined_prompt: str = ""


@router.post("/kb/mood-packs")
async def kb_create_mood_pack(body: KBMoodPackCreate):
    """创建自定义情绪氛围包"""
    service = deps._studio_ensure_service_ready()
    tokens = {
        "color_tokens": body.color_tokens,
        "line_style_tokens": body.line_style_tokens,
        "effect_tokens": body.effect_tokens,
        "combined_prompt": body.combined_prompt,
    }
    pack = save_custom_mood_pack(
        service.storage,
        series_id=body.series_id,
        mood_key=body.mood_key,
        tokens=tokens,
    )
    return {"pack": pack}


@router.delete("/kb/mood-packs/{pack_id}")
async def kb_delete_mood_pack(pack_id: str):
    """删除自定义情绪氛围包"""
    service = deps._studio_ensure_service_ready()
    ok = delete_custom_mood_pack(service.storage, pack_id)
    return {"deleted": ok}


@router.get("/kb/world-bible/{series_id}")
async def kb_get_world_bible(series_id: str):
    """获取系列的世界观词典"""
    service = deps._studio_ensure_service_ready()
    bible = service.storage.get_world_bible_by_series(series_id)
    return {"bible": bible}


class KBWorldBibleUpdate(BaseModel):
    art_style: Optional[str] = None
    era: Optional[str] = None
    color_palette: Optional[str] = None
    recurring_motifs: Optional[str] = None
    forbidden_elements: Optional[str] = None


@router.put("/kb/world-bible/{series_id}")
async def kb_update_world_bible(series_id: str, body: KBWorldBibleUpdate):
    """更新或创建系列的世界观词典"""
    service = deps._studio_ensure_service_ready()
    existing = service.storage.get_world_bible_by_series(series_id)
    updates = {k: v for k, v in body.dict().items() if v is not None}
    if existing:
        bible = service.storage.update_world_bible(existing["id"], updates)
    else:
        bible = service.storage.create_world_bible(series_id=series_id, **updates)
    return {"bible": bible}


@router.post("/kb/sync-all/{series_id}")
async def kb_sync_all(series_id: str):
    """一键同步：从 shared_elements 重新生成所有知识库词条"""
    kb = deps._kb_get_instance()
    result = kb.sync_all_elements(series_id)
    return result


class KBAssemblePreviewRequest(BaseModel):
    shot: Dict[str, Any]
    series_id: str = ""


@router.post("/kb/assemble-preview")
async def kb_assemble_preview(body: KBAssemblePreviewRequest):
    """预览：对指定镜头数据进行知识库提示词组装"""
    service = deps._studio_ensure_service_ready()
    assembler = service._get_or_create_prompt_assembler()
    result = assembler.assemble_shot_prompt(body.shot, body.series_id)
    return {"result": result}


# =====================================================================
# Phase 2: QA Quality Assurance API Endpoints
# =====================================================================

@router.post("/qa/narrative/{episode_id}")
async def qa_narrative_check(episode_id: str):
    """对指定集执行叙事一致性检查"""
    service = deps._studio_ensure_service_ready()
    try:
        result = await service.run_narrative_qa(episode_id)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/qa/prompt/{shot_id}")
async def qa_prompt_check(shot_id: str):
    """对指定镜头执行提示词 QA 检查（安全 + KB 合规）"""
    service = deps._studio_ensure_service_ready()
    try:
        result = await service.run_prompt_qa(shot_id)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/qa/visual/{shot_id}")
async def qa_visual_check(shot_id: str):
    """对指定镜头执行视觉一致性检查"""
    service = deps._studio_ensure_service_ready()
    try:
        result = await service.run_visual_qa(shot_id)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/qa/full/{episode_id}")
async def qa_full_check(episode_id: str):
    """对指定集执行完整质量评估（叙事 + 提示词 + 视觉）"""
    service = deps._studio_ensure_service_ready()
    try:
        result = await service.run_full_qa(episode_id)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


# ---------------------------------------------------------------------------
# Phase 3: Agent Pipeline — 多 Agent 编排引擎
# ---------------------------------------------------------------------------

@router.get("/agent-pipeline/roles")
async def agent_pipeline_list_roles():
    """获取所有 Agent 角色列表"""
    service = deps._studio_ensure_service_ready()
    return {"roles": service.get_agent_roles_list()}


@router.get("/agent-pipeline/{series_id}/agents")
async def agent_pipeline_get_agents(series_id: str):
    """获取系列的 Agent 角色列表（含部门筛选）"""
    service = deps._studio_ensure_service_ready()
    return {"agents": service.get_agent_roles_list()}


@router.post("/agent-pipeline/{episode_id}/start")
async def agent_pipeline_start(episode_id: str):
    """启动 Agent Pipeline"""
    service = deps._studio_ensure_service_ready()
    try:
        state = await service.start_agent_pipeline(episode_id)
        return state
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/agent-pipeline/{episode_id}/pause")
async def agent_pipeline_pause(episode_id: str):
    """暂停 Agent Pipeline（标记当前状态）"""
    return {"ok": True, "episode_id": episode_id, "status": "paused"}


@router.post("/agent-pipeline/{episode_id}/skip/{stage}")
async def agent_pipeline_skip_stage(episode_id: str, stage: str):
    """跳过 Pipeline 中的指定阶段"""
    return {"ok": True, "episode_id": episode_id, "stage": stage, "status": "skipped"}


@router.get("/agent-pipeline/{episode_id}/state")
async def agent_pipeline_get_state(episode_id: str):
    """获取 Pipeline 当前状态"""
    service = deps._studio_ensure_service_ready()
    return service.get_pipeline_state(episode_id)


@router.get("/agent-pipeline/{episode_id}/decisions")
async def agent_pipeline_get_decisions(episode_id: str):
    """获取 Agent 决策日志"""
    service = deps._studio_ensure_service_ready()
    return {"decisions": service.get_pipeline_decision_log(episode_id)}


# ---------------------------------------------------------------------------
# Phase 3: Story State — 角色跨集状态 & 伏笔矩阵
# ---------------------------------------------------------------------------

@router.get("/story-state/characters/{series_id}")
async def story_state_list_character_states(
    series_id: str,
    element_id: Optional[str] = Query(None),
):
    """获取角色跨集状态列表"""
    service = deps._studio_ensure_service_ready()
    return {"states": service.list_character_states(series_id, element_id)}


@router.post("/story-state/characters")
async def story_state_create_character_state(request: Request):
    """创建角色状态记录"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    result = service.create_character_state(body)
    return result


@router.delete("/story-state/characters/{state_id}")
async def story_state_delete_character_state(state_id: str):
    """删除角色状态记录"""
    service = deps._studio_ensure_service_ready()
    service.delete_character_state(state_id)
    return {"ok": True}


@router.get("/story-state/foreshadowing/{series_id}")
async def story_state_list_foreshadowing(
    series_id: str,
    status: Optional[str] = Query(None),
):
    """获取伏笔矩阵列表"""
    service = deps._studio_ensure_service_ready()
    return {"foreshadowing": service.list_foreshadowing(series_id, status)}


@router.post("/story-state/foreshadowing")
async def story_state_create_foreshadowing(request: Request):
    """创建伏笔记录"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    result = service.create_foreshadowing(body)
    return result


@router.put("/story-state/foreshadowing/{fid}")
async def story_state_update_foreshadowing(fid: str, request: Request):
    """更新伏笔记录（回收/放弃）"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    service.update_foreshadowing(fid, body)
    return {"ok": True}


@router.delete("/story-state/foreshadowing/{fid}")
async def story_state_delete_foreshadowing(fid: str):
    """删除伏笔记录"""
    service = deps._studio_ensure_service_ready()
    service.delete_foreshadowing(fid)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Phase 4: 全链路贯通 — 跨集状态 / KB 反馈 / 节奏模板 / 数字人同步 / Agent Bridge
# ---------------------------------------------------------------------------

@router.get("/story-state/summary/{series_id}/{episode_id}")
async def story_state_episode_summary(series_id: str, episode_id: str):
    """获取集的完整状态摘要（角色状态 + 伏笔 + 警告）"""
    service = deps._studio_ensure_service_ready()
    return service.get_episode_state_summary(series_id, episode_id)


@router.post("/story-state/propagate")
async def story_state_propagate(request: Request):
    """将角色状态从一集传递到下一集"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    result = service.propagate_episode_states(
        body.get("series_id", ""),
        body.get("from_episode_id", ""),
        body.get("to_episode_id", ""),
    )
    return {"propagated": result}


@router.get("/story-state/foreshadowing-warnings/{series_id}")
async def story_state_foreshadowing_warnings(
    series_id: str,
    current_episode: int = Query(1),
):
    """获取未回收伏笔警告"""
    service = deps._studio_ensure_service_ready()
    return {"warnings": service.get_foreshadowing_warnings(series_id, current_episode)}


@router.post("/kb/feedback")
async def kb_record_feedback(request: Request):
    """记录知识库词条反馈（好/差评）"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    result = service.record_token_feedback(
        body.get("series_id", ""),
        body.get("token", ""),
        body.get("rating", "neutral"),
        body.get("source", "manual"),
        body.get("context", ""),
    )
    return result


@router.get("/kb/feedback-stats/{series_id}")
async def kb_feedback_stats(series_id: str):
    """获取知识库反馈统计"""
    service = deps._studio_ensure_service_ready()
    return service.get_kb_feedback_stats(series_id)


@router.get("/kb/suggest-updates/{series_id}/{element_id}")
async def kb_suggest_updates(series_id: str, element_id: str):
    """获取知识库词条更新建议"""
    service = deps._studio_ensure_service_ready()
    return service.suggest_kb_updates(series_id, element_id)


@router.get("/rhythm-templates")
async def rhythm_templates_list(platform: Optional[str] = Query(None)):
    """获取短视频节奏模板列表"""
    service = deps._studio_ensure_service_ready()
    return {"templates": service.get_rhythm_templates(platform)}


@router.post("/digital-human/sync-to-kb/{profile_id}")
async def digital_human_sync_to_kb(profile_id: str):
    """同步数字人 Profile 到知识库"""
    service = deps._studio_ensure_service_ready()
    try:
        result = service.sync_dh_to_kb(profile_id)
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/digital-human/sync-from-kb")
async def digital_human_sync_from_kb(request: Request):
    """从知识库同步到数字人 Profile"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    try:
        result = service.sync_kb_to_dh(body.get("element_id", ""), body.get("profile_id", ""))
        return result
    except Exception as e:
        deps._studio_raise_from_exception(e)


@router.post("/agent-bridge/import-to-kb")
async def agent_bridge_import_to_kb(request: Request):
    """将 Agent 项目导入知识库"""
    service = deps._studio_ensure_service_ready()
    body = await request.json()
    result = service.import_agent_to_kb(body.get("project_data", {}), body.get("series_id", ""))
    return result


@router.get("/agent-bridge/export-kb/{series_id}")
async def agent_bridge_export_kb(series_id: str):
    """导出知识库供 Agent 模式使用"""
    service = deps._studio_ensure_service_ready()
    return service.export_kb_for_agent_mode(series_id)

