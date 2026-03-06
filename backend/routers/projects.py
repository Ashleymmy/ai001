"""Projects routes: /api/projects/*."""

from typing import Optional
from fastapi import APIRouter, HTTPException

from services.storage_service import storage
from schemas.settings import (
    CreateProjectRequest,
    UpdateProjectRequest,
    AddStoryboardRequest,
    UpdateStoryboardRequest,
)

router = APIRouter(prefix="/api", tags=["projects"])


@router.post("/projects")
async def create_project(request: CreateProjectRequest):
    project = storage.create_project(request.name, request.description)
    return project


@router.get("/projects")
async def list_projects(limit: int = 50, offset: int = 0):
    projects = storage.list_projects(limit, offset)
    return {"projects": projects}


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    project = storage.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.put("/projects/{project_id}")
async def update_project(project_id: str, request: UpdateProjectRequest):
    updates = request.model_dump(exclude_none=True)
    project = storage.update_project(project_id, updates)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    success = storage.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"status": "ok"}


@router.post("/projects/{project_id}/storyboards")
async def add_storyboard(project_id: str, request: AddStoryboardRequest):
    storyboard = storage.add_storyboard(
        project_id, request.prompt, request.full_prompt, request.image_url, request.index
    )
    if not storyboard:
        raise HTTPException(status_code=404, detail="项目不存在")
    return storyboard


@router.put("/projects/{project_id}/storyboards/{storyboard_id}")
async def update_storyboard(project_id: str, storyboard_id: str, request: UpdateStoryboardRequest):
    updates = request.model_dump(exclude_none=True)
    storyboard = storage.update_storyboard(project_id, storyboard_id, updates)
    if not storyboard:
        raise HTTPException(status_code=404, detail="分镜不存在")
    return storyboard


@router.delete("/projects/{project_id}/storyboards/{storyboard_id}")
async def delete_storyboard(project_id: str, storyboard_id: str):
    success = storage.delete_storyboard(project_id, storyboard_id)
    if not success:
        raise HTTPException(status_code=404, detail="分镜不存在")
    return {"status": "ok"}
