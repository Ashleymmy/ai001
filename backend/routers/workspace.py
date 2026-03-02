"""Workspace routes: /api/workspaces/*, /ws/workspace/*."""

from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Request, Header, Query, WebSocket, WebSocketDisconnect

from services.ws_manager import ws_manager
import dependencies as deps
from schemas.settings import (
    WorkspaceCreateRequest,
    WorkspaceMemberCreateRequest,
    WorkspaceMemberUpdateRequest,
    WorkspaceOKRCreateRequest,
    WorkspaceOKRUpdateRequest,
    WorkspaceUndoRedoRequest,
    WorkspaceEpisodeAssignRequest,
    WorkspaceEpisodeReviewRequest,
)

router = APIRouter(tags=["workspace"])


@router.get("/api/workspaces")
async def collab_list_workspaces(request: Request, authorization: Optional[str] = Header(None)):
    user = deps._collab_get_current_user(request, authorization, required=deps.AUTH_REQUIRED)
    return deps._collab_ensure_service_ready().list_workspaces(user["id"])


@router.post("/api/workspaces")
async def collab_create_workspace(req: WorkspaceCreateRequest, request: Request, authorization: Optional[str] = Header(None)):
    user = deps._collab_get_current_user(request, authorization, required=deps.AUTH_REQUIRED)
    return deps._collab_ensure_service_ready().create_workspace(user["id"], req.name)


@router.get("/api/workspaces/{workspace_id}/members")
async def collab_list_workspace_members(workspace_id: str, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "viewer", authorization)
    return deps._collab_ensure_service_ready().list_members(workspace_id)


@router.post("/api/workspaces/{workspace_id}/members")
async def collab_add_workspace_member(workspace_id: str, req: WorkspaceMemberCreateRequest, request: Request, authorization: Optional[str] = Header(None)):
    actor = deps._collab_require_workspace_role(request, workspace_id, "owner", authorization)
    role = str(req.role or "viewer").strip() or "viewer"
    if role not in {"owner", "editor", "viewer"}:
        raise HTTPException(400, "角色无效")
    return deps._collab_ensure_service_ready().add_member(
        workspace_id=workspace_id, actor_user_id=str(actor["id"]), email=req.email, role=role,
    )


@router.patch("/api/workspaces/{workspace_id}/members/{member_id}")
async def collab_update_workspace_member(workspace_id: str, member_id: str, req: WorkspaceMemberUpdateRequest, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "owner", authorization)
    role = str(req.role or "").strip()
    if role not in {"owner", "editor", "viewer"}:
        raise HTTPException(400, "角色无效")
    ok = deps._collab_ensure_service_ready().update_member_role(workspace_id, member_id, role)
    if not ok:
        raise HTTPException(404, "成员不存在")
    return {"ok": True}


@router.delete("/api/workspaces/{workspace_id}/members/{member_id}")
async def collab_delete_workspace_member(workspace_id: str, member_id: str, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "owner", authorization)
    ok = deps._collab_ensure_service_ready().remove_member(workspace_id, member_id)
    if not ok:
        raise HTTPException(404, "成员不存在")
    return {"ok": True}


@router.get("/api/workspaces/{workspace_id}/okrs")
async def collab_list_workspace_okrs(workspace_id: str, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "viewer", authorization)
    return deps._collab_ensure_service_ready().list_okrs(workspace_id)


@router.post("/api/workspaces/{workspace_id}/okrs")
async def collab_create_workspace_okr(workspace_id: str, req: WorkspaceOKRCreateRequest, request: Request, authorization: Optional[str] = Header(None)):
    user = deps._collab_require_workspace_role(request, workspace_id, "editor", authorization)
    return deps._collab_ensure_service_ready().create_okr(
        workspace_id=workspace_id, payload=req.model_dump(), actor_user_id=user["id"],
    )


@router.patch("/api/workspaces/{workspace_id}/okrs/{okr_id}")
async def collab_update_workspace_okr(workspace_id: str, okr_id: str, req: WorkspaceOKRUpdateRequest, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "editor", authorization)
    updates = {k: v for k, v in req.model_dump().items() if v is not None}
    updated = deps._collab_ensure_service_ready().update_okr(workspace_id, okr_id, updates)
    if not updated:
        raise HTTPException(404, "OKR 不存在")
    return updated


@router.post("/api/workspaces/{workspace_id}/undo")
async def collab_workspace_undo(workspace_id: str, req: WorkspaceUndoRedoRequest, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "editor", authorization)
    service = deps._collab_ensure_service_ready()
    op = service.undo(workspace_id, req.project_scope)
    if not op:
        return {"ok": True, "operation": None, "head_index": service.get_head(workspace_id, req.project_scope)}
    applied = deps._studio_apply_collab_operation(op, "undo")
    return {
        "ok": True, "mode": "undo", "operation": op, "applied": applied,
        "head_index": service.get_head(workspace_id, req.project_scope),
    }


@router.post("/api/workspaces/{workspace_id}/redo")
async def collab_workspace_redo(workspace_id: str, req: WorkspaceUndoRedoRequest, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "editor", authorization)
    service = deps._collab_ensure_service_ready()
    op = service.redo(workspace_id, req.project_scope)
    if not op:
        return {"ok": True, "operation": None, "head_index": service.get_head(workspace_id, req.project_scope)}
    applied = deps._studio_apply_collab_operation(op, "redo")
    return {
        "ok": True, "mode": "redo", "operation": op, "applied": applied,
        "head_index": service.get_head(workspace_id, req.project_scope),
    }


@router.get("/api/workspaces/{workspace_id}/operations")
async def collab_list_operations(workspace_id: str, request: Request, project_scope: str = "studio:global", limit: int = 50, offset: int = 0, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "viewer", authorization)
    service = deps._collab_ensure_service_ready()
    return service.list_operations(workspace_id, project_scope, limit=limit, offset=offset)


@router.websocket("/ws/workspace/{workspace_id}")
async def workspace_ws(websocket: WebSocket, workspace_id: str):
    import json as _json
    token = websocket.query_params.get("access_token", "")
    if not token:
        await websocket.close(code=4001, reason="missing access_token")
        return
    try:
        service = deps._collab_ensure_service_ready()
        user = service.verify_access_token(token)
    except Exception:
        await websocket.close(code=4003, reason="invalid or expired token")
        return
    user_id = user.get("id", "")
    user_name = user.get("name", user.get("email", "unknown"))
    try:
        service.require_workspace_role(workspace_id, user_id, "viewer")
    except Exception:
        await websocket.close(code=4003, reason="not a workspace member")
        return
    client = await ws_manager.connect(websocket, workspace_id, user_id, user_name)
    try:
        while True:
            raw = await websocket.receive_text()
            try:
                msg = _json.loads(raw)
            except Exception:
                continue
            msg_type = msg.get("type", "")
            if msg_type == "heartbeat":
                ws_manager.update_heartbeat(client)
                await websocket.send_text(_json.dumps({"type": "heartbeat_ack"}))
            elif msg_type == "episode_focus":
                await ws_manager.broadcast(
                    workspace_id,
                    {"type": "episode_focus", "user_id": user_id, "user_name": user_name, "episode_id": msg.get("episode_id", "")},
                    exclude_user=user_id,
                )
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        ws_manager.disconnect(client)
        await ws_manager.broadcast_disconnect(client)


@router.get("/api/workspaces/{workspace_id}/online-members")
async def collab_get_online_members(workspace_id: str, request: Request, authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "viewer", authorization)
    return {"members": ws_manager.get_online_members(workspace_id)}


@router.get("/api/workspaces/{workspace_id}/episode-assignments")
async def collab_list_episode_assignments(workspace_id: str, request: Request, series_id: Optional[str] = Query(None), assigned_to: Optional[str] = Query(None), status: Optional[str] = Query(None), authorization: Optional[str] = Header(None)):
    deps._collab_require_workspace_role(request, workspace_id, "viewer", authorization)
    return deps._collab_ensure_service_ready().list_episode_assignments(
        workspace_id=workspace_id, series_id=str(series_id or "").strip(),
        assigned_to=str(assigned_to or "").strip(), status=str(status or "").strip(),
    )


@router.put("/api/workspaces/{workspace_id}/episodes/{episode_id}/assignment")
async def collab_assign_episode(workspace_id: str, episode_id: str, req: WorkspaceEpisodeAssignRequest, request: Request, authorization: Optional[str] = Header(None)):
    actor = deps._collab_require_workspace_role(request, workspace_id, "owner", authorization)
    studio = deps._studio_ensure_service_ready()
    episode = studio.storage.get_episode(episode_id)
    if not episode:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    series = studio.storage.get_series(str(episode.get("series_id") or ""))
    series_workspace_id = str((series or {}).get("workspace_id") or "").strip()
    if series_workspace_id and series_workspace_id != workspace_id:
        deps._studio_raise(404, "集不存在", "episode_not_found", {"episode_id": episode_id})
    collab = deps._collab_ensure_service_ready()
    try:
        assignment = collab.upsert_episode_assignment(
            workspace_id=workspace_id, episode_id=episode_id,
            assigned_to=req.assigned_to, actor_user_id=str(actor.get("id") or ""), note=req.note,
        )
        await ws_manager.broadcast(workspace_id, {
            "type": "episode_locked", "episode_id": episode_id,
            "assigned_to": req.assigned_to, "assignment": assignment,
        })
        return assignment
    except ValueError as e:
        deps._studio_raise(400, str(e), "episode_assignment_invalid", {"episode_id": episode_id})


@router.post("/api/workspaces/{workspace_id}/episodes/{episode_id}/submit")
async def collab_submit_episode_assignment(workspace_id: str, episode_id: str, req: WorkspaceEpisodeReviewRequest, request: Request, authorization: Optional[str] = Header(None)):
    user = deps._collab_require_workspace_role(request, workspace_id, "editor", authorization)
    collab = deps._collab_ensure_service_ready()
    try:
        assignment = collab.submit_episode_assignment(
            workspace_id=workspace_id, episode_id=episode_id,
            actor_user_id=str(user.get("id") or ""), note=req.note,
        )
    except ValueError as e:
        deps._studio_raise(400, str(e), "episode_assignment_invalid", {"episode_id": episode_id})
    if not assignment:
        deps._studio_raise(404, "分配记录不存在", "episode_assignment_not_found", {"episode_id": episode_id})
    await ws_manager.broadcast(workspace_id, {"type": "episode_submitted", "episode_id": episode_id, "assignment": assignment})
    return assignment


@router.post("/api/workspaces/{workspace_id}/episodes/{episode_id}/approve")
async def collab_approve_episode_assignment(workspace_id: str, episode_id: str, req: WorkspaceEpisodeReviewRequest, request: Request, authorization: Optional[str] = Header(None)):
    owner = deps._collab_require_workspace_role(request, workspace_id, "owner", authorization)
    collab = deps._collab_ensure_service_ready()
    try:
        assignment = collab.review_episode_assignment(
            workspace_id=workspace_id, episode_id=episode_id,
            reviewer_user_id=str(owner.get("id") or ""), approve=True, note=req.note,
        )
    except ValueError as e:
        deps._studio_raise(400, str(e), "episode_assignment_invalid", {"episode_id": episode_id})
    if not assignment:
        deps._studio_raise(404, "分配记录不存在", "episode_assignment_not_found", {"episode_id": episode_id})
    await ws_manager.broadcast(workspace_id, {"type": "episode_approved", "episode_id": episode_id, "assignment": assignment})
    return assignment


@router.post("/api/workspaces/{workspace_id}/episodes/{episode_id}/reject")
async def collab_reject_episode_assignment(workspace_id: str, episode_id: str, req: WorkspaceEpisodeReviewRequest, request: Request, authorization: Optional[str] = Header(None)):
    owner = deps._collab_require_workspace_role(request, workspace_id, "owner", authorization)
    collab = deps._collab_ensure_service_ready()
    try:
        assignment = collab.review_episode_assignment(
            workspace_id=workspace_id, episode_id=episode_id,
            reviewer_user_id=str(owner.get("id") or ""), approve=False, note=req.note,
        )
    except ValueError as e:
        deps._studio_raise(400, str(e), "episode_assignment_invalid", {"episode_id": episode_id})
    if not assignment:
        deps._studio_raise(404, "分配记录不存在", "episode_assignment_not_found", {"episode_id": episode_id})
    await ws_manager.broadcast(workspace_id, {"type": "episode_rejected", "episode_id": episode_id, "assignment": assignment})
    return assignment
