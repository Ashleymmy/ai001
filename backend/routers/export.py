"""Export/Import routes: /api/export/*, /api/import*, /api/proxy/download."""

import os
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, Response

from services.storage_service import storage

router = APIRouter(prefix="/api", tags=["export"])


@router.post("/export/all")
async def export_all_data(include_images: bool = True):
    export_path = storage.export_all(include_images)
    return {"path": export_path, "filename": os.path.basename(export_path)}


@router.get("/proxy/download")
async def proxy_download(url: str):
    import httpx
    print(f"[Proxy] 下载文件: {url[:100]}...")
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(url)
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="下载失败")
            content_type = response.headers.get('content-type', 'application/octet-stream')
            print(f"[Proxy] 下载成功, 大小: {len(response.content)}, 类型: {content_type}")
            return Response(
                content=response.content,
                media_type=content_type,
                headers={"Content-Disposition": "attachment"}
            )
    except Exception as e:
        print(f"[Proxy] 下载失败: {e}")
        raise HTTPException(status_code=500, detail=f"下载失败: {str(e)}")


@router.get("/export/download/{filename}")
async def download_export(filename: str):
    from services.storage_service import EXPORT_DIR
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath, filename=filename, media_type='application/zip')


@router.post("/export/project/{project_id}")
async def export_project(project_id: str):
    export_path = storage.export_project(project_id)
    if not export_path:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"path": export_path, "filename": os.path.basename(export_path)}


@router.get("/exports")
async def list_exports():
    exports = storage.list_exports()
    return {"exports": exports}


@router.post("/import")
async def import_data(file: UploadFile = File(...), merge: bool = True):
    from services.storage_service import EXPORT_DIR
    temp_path = os.path.join(EXPORT_DIR, f"import_{file.filename}")
    with open(temp_path, 'wb') as f:
        content = await file.read()
        f.write(content)
    result = storage.import_data(temp_path, merge)
    if os.path.exists(temp_path):
        os.remove(temp_path)
    return result


@router.post("/import/project")
async def import_project(file: UploadFile = File(...)):
    from services.storage_service import EXPORT_DIR
    temp_path = os.path.join(EXPORT_DIR, f"import_{file.filename}")
    with open(temp_path, 'wb') as f:
        content = await file.read()
        f.write(content)
    project = storage.import_project(temp_path)
    if os.path.exists(temp_path):
        os.remove(temp_path)
    if not project:
        raise HTTPException(status_code=400, detail="导入失败")
    return project
