"""Scripts routes: /api/scripts/*."""

from typing import Optional
from fastapi import APIRouter, HTTPException

from services.storage_service import storage
from schemas.settings import SaveScriptRequest, UpdateScriptRequest

router = APIRouter(prefix="/api", tags=["scripts"])


@router.post("/scripts")
async def save_script(request: SaveScriptRequest):
    script = storage.save_script(request.title, request.content, request.project_id)
    return script


@router.get("/scripts")
async def list_scripts(project_id: Optional[str] = None, limit: int = 50):
    scripts = storage.list_scripts(project_id, limit)
    return {"scripts": scripts}


@router.get("/scripts/{script_id}")
async def get_script(script_id: str):
    script = storage.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="剧本不存在")
    return script


@router.put("/scripts/{script_id}")
async def update_script(script_id: str, request: UpdateScriptRequest):
    script = storage.update_script(script_id, request.title, request.content)
    if not script:
        raise HTTPException(status_code=404, detail="剧本不存在")
    return script


@router.delete("/scripts/{script_id}")
async def delete_script(script_id: str):
    success = storage.delete_script(script_id)
    if not success:
        raise HTTPException(status_code=404, detail="剧本不存在")
    return {"status": "ok"}
