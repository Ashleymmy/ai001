"""Auth routes: /api/auth/*."""

import os
from typing import Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Request, Header

import dependencies as deps
from schemas.settings import (
    AuthRegisterRequest,
    AuthLoginRequest,
    AuthRefreshRequest,
    AuthProfileUpdateRequest,
    AuthChangePasswordRequest,
    AuthForgotPasswordRequest,
    AuthResetPasswordRequest,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.get("/config")
async def collab_auth_config():
    return {"auth_required": deps.AUTH_REQUIRED}


@router.post("/register")
async def collab_register(req: AuthRegisterRequest):
    service = deps._collab_ensure_service_ready()
    try:
        return service.register_user(
            email=req.email, password=req.password, name=req.name, create_workspace=True,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))


@router.post("/login")
async def collab_login(req: AuthLoginRequest):
    service = deps._collab_ensure_service_ready()
    try:
        return service.login_user(req.email, req.password)
    except ValueError as e:
        raise HTTPException(401, str(e))


@router.post("/refresh")
async def collab_refresh(req: AuthRefreshRequest):
    service = deps._collab_ensure_service_ready()
    try:
        return service.refresh_access_token(req.refresh_token)
    except ValueError as e:
        raise HTTPException(401, str(e))


@router.post("/logout")
async def collab_logout(req: AuthRefreshRequest):
    service = deps._collab_ensure_service_ready()
    try:
        service.revoke_refresh_token(req.refresh_token)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/me")
async def collab_me(
    request: Request,
    authorization: Optional[str] = Header(None),
):
    user = deps._collab_get_current_user(request, authorization, required=deps.AUTH_REQUIRED)
    workspaces = deps._collab_ensure_service_ready().list_workspaces(user["id"])
    return {"user": user, "workspaces": workspaces}


@router.patch("/me")
async def collab_update_me(
    req: AuthProfileUpdateRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    user = deps._collab_get_current_user(request, authorization, required=True)
    service = deps._collab_ensure_service_ready()
    try:
        updated = service.update_user_profile(
            str(user.get("id") or ""), name=req.name, email=req.email,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    workspaces = service.list_workspaces(updated["id"])
    return {"user": updated, "workspaces": workspaces}


@router.post("/change-password")
async def collab_change_password(
    req: AuthChangePasswordRequest,
    request: Request,
    authorization: Optional[str] = Header(None),
):
    user = deps._collab_get_current_user(request, authorization, required=True)
    service = deps._collab_ensure_service_ready()
    try:
        service.change_password(str(user.get("id") or ""), req.current_password, req.new_password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}


@router.post("/forgot-password")
async def collab_forgot_password(req: AuthForgotPasswordRequest):
    service = deps._collab_ensure_service_ready()
    reset_token = service.create_password_reset_token(req.email)
    expose = os.getenv("COLLAB_EXPOSE_RESET_TOKEN", "").strip().lower() in {"1", "true", "yes", "on"}
    payload: Dict[str, Any] = {"ok": True}
    if reset_token and (expose or not deps.AUTH_REQUIRED):
        payload["reset_token"] = reset_token
    return payload


@router.post("/reset-password")
async def collab_reset_password(req: AuthResetPasswordRequest):
    service = deps._collab_ensure_service_ready()
    try:
        service.reset_password_by_token(req.reset_token, req.new_password)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"ok": True}
