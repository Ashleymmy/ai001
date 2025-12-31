from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import os
import uuid
import base64

from services.llm_service import LLMService
from services.image_service import ImageService
from services.storage_service import storage

app = FastAPI(title="AI Storyboarder Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局服务实例
llm_service: Optional[LLMService] = None
image_service: Optional[ImageService] = None

# 当前配置
current_settings = {}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)


def load_saved_settings():
    """启动时加载已保存的设置"""
    global llm_service, image_service, current_settings
    
    saved = storage.get_settings()
    if not saved:
        print("[Startup] 没有找到已保存的设置")
        return
    
    current_settings = saved
    print("[Startup] 加载已保存的设置...")
    
    # 加载 LLM 配置
    llm_config = saved.get('llm', {})
    if llm_config.get('apiKey'):
        llm_service = LLMService(
            provider=llm_config.get('provider', 'qwen'),
            api_key=llm_config.get('apiKey', ''),
            base_url=llm_config.get('baseUrl') or None,
            model=llm_config.get('model') or None
        )
        print(f"[Startup] LLM 已加载: provider={llm_config.get('provider')}")
    
    # 加载图像配置
    img_config = saved.get('image', {})
    local_config = saved.get('local', {})
    
    if local_config.get('enabled') and img_config.get('provider') in ['comfyui', 'sd-webui']:
        image_service = ImageService(
            provider=img_config.get('provider'),
            model=img_config.get('model') or None,
            comfyui_url=local_config.get('comfyuiUrl', 'http://127.0.0.1:8188'),
            sd_webui_url=local_config.get('sdWebuiUrl', 'http://127.0.0.1:7860')
        )
    elif img_config.get('provider') and img_config.get('provider') != 'placeholder':
        image_service = ImageService(
            provider=img_config.get('provider'),
            api_key=img_config.get('apiKey', ''),
            base_url=img_config.get('baseUrl') or None,
            model=img_config.get('model') or None
        )
        print(f"[Startup] 图像服务已加载: provider={img_config.get('provider')}")


# 启动时加载设置
load_saved_settings()


class ModelConfig(BaseModel):
    provider: str
    apiKey: str = ""
    baseUrl: str = ""
    model: str = ""
    customProvider: Optional[str] = None


class LocalConfig(BaseModel):
    enabled: bool = False
    comfyuiUrl: str = "http://127.0.0.1:8188"
    sdWebuiUrl: str = "http://127.0.0.1:7860"
    vramStrategy: str = "auto"


class SettingsRequest(BaseModel):
    llm: ModelConfig
    image: ModelConfig
    video: ModelConfig
    local: LocalConfig


class GenerateRequest(BaseModel):
    referenceImage: Optional[str] = None
    storyText: str
    style: str = "cinematic"
    count: int = 4


class ParseStoryRequest(BaseModel):
    storyText: str
    style: str = "cinematic"
    count: int = 4


class RegenerateRequest(BaseModel):
    prompt: str
    referenceImage: Optional[str] = None
    style: str = "cinematic"


class ChatRequest(BaseModel):
    message: str
    context: Optional[str] = None


class VideoRequest(BaseModel):
    imageUrl: str
    prompt: str


STYLE_PROMPTS = {
    "cinematic": "cinematic lighting, film grain, dramatic shadows, movie scene, professional cinematography",
    "anime": "anime style, vibrant colors, cel shading, japanese animation, detailed illustration",
    "realistic": "photorealistic, highly detailed, 8k resolution, professional photography, natural lighting",
    "ink": "chinese ink painting style, traditional brush strokes, minimalist, elegant, monochrome with subtle colors"
}


def get_llm_service() -> LLMService:
    global llm_service
    if llm_service is None:
        llm_service = LLMService(
            provider=os.getenv("LLM_PROVIDER", "qwen"),
            api_key=os.getenv("LLM_API_KEY", "")
        )
    return llm_service


def get_image_service() -> ImageService:
    global image_service
    if image_service is None:
        image_service = ImageService(
            provider=os.getenv("IMAGE_PROVIDER", "placeholder"),
            api_key=os.getenv("IMAGE_API_KEY", "")
        )
    return image_service


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "version": "1.0.0",
        "llm_configured": llm_service is not None and bool(llm_service.api_key),
        "image_configured": image_service is not None
    }


@app.post("/api/settings")
async def update_settings(request: SettingsRequest):
    """更新服务配置"""
    global llm_service, image_service, current_settings
    
    current_settings = request.model_dump()
    
    # 更新 LLM 服务
    llm_config = request.llm
    llm_service = LLMService(
        provider=llm_config.provider,
        api_key=llm_config.apiKey,
        base_url=llm_config.baseUrl if llm_config.baseUrl else None,
        model=llm_config.model if llm_config.model else None
    )
    print(f"[Settings] LLM 配置更新: provider={llm_config.provider}, model={llm_config.model}")
    
    # 更新图像服务
    img_config = request.image
    local_config = request.local
    
    if local_config.enabled and img_config.provider in ['comfyui', 'sd-webui']:
        # 使用本地服务
        image_service = ImageService(
            provider=img_config.provider,
            model=img_config.model if img_config.model else None,
            comfyui_url=local_config.comfyuiUrl,
            sd_webui_url=local_config.sdWebuiUrl
        )
        print(f"[Settings] 图像服务配置更新: 本地模式, provider={img_config.provider}")
    else:
        image_service = ImageService(
            provider=img_config.provider,
            api_key=img_config.apiKey,
            base_url=img_config.baseUrl if img_config.baseUrl else None,
            model=img_config.model if img_config.model else None
        )
        print(f"[Settings] 图像服务配置更新: API模式, provider={img_config.provider}, model={img_config.model}")
    
    # 持久化设置到文件
    storage.save_settings(current_settings)
    
    return {"status": "ok", "message": "设置已更新"}


@app.get("/api/settings")
async def get_settings():
    """获取已保存的设置"""
    saved = storage.get_settings()
    if saved:
        return saved
    return {"status": "not_configured"}


@app.post("/api/parse-story")
async def parse_story(request: ParseStoryRequest):
    service = get_llm_service()
    prompts = await service.parse_story(
        story_text=request.storyText,
        count=request.count,
        style=request.style
    )
    return {"prompts": prompts}


@app.post("/api/generate")
async def generate_storyboards(request: GenerateRequest):
    llm = get_llm_service()
    img = get_image_service()
    
    style_prompt = STYLE_PROMPTS.get(request.style, STYLE_PROMPTS["cinematic"])
    
    prompts = await llm.parse_story(
        story_text=request.storyText,
        count=request.count,
        style=request.style
    )
    
    storyboards = []
    for i, prompt in enumerate(prompts):
        full_prompt = f"{prompt}, {style_prompt}"
        
        image_url = await img.generate(
            prompt=full_prompt,
            reference_image=request.referenceImage,
            style=request.style
        )
        
        storyboards.append({
            "id": str(uuid.uuid4()),
            "index": i + 1,
            "prompt": prompt,
            "fullPrompt": full_prompt,
            "imageUrl": image_url
        })
    
    return {"storyboards": storyboards}


@app.post("/api/regenerate")
async def regenerate_image(request: RegenerateRequest):
    img = get_image_service()
    style_prompt = STYLE_PROMPTS.get(request.style, STYLE_PROMPTS["cinematic"])
    full_prompt = f"{request.prompt}, {style_prompt}"
    
    image_url = await img.generate(
        prompt=full_prompt,
        reference_image=request.referenceImage,
        style=request.style
    )
    
    return {"imageUrl": image_url}


@app.post("/api/chat")
async def chat_with_ai(request: ChatRequest):
    service = get_llm_service()
    
    try:
        reply = await service.chat(
            message=request.message,
            context=request.context
        )
        return {"reply": reply}
    except Exception as e:
        print(f"对话失败: {e}")
        return {"reply": f"抱歉，出现错误: {str(e)}"}


@app.post("/api/upload-reference")
async def upload_reference(file: UploadFile = File(...)):
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="只支持图片文件")
    
    content = await file.read()
    base64_data = base64.b64encode(content).decode("utf-8")
    mime_type = file.content_type
    
    return {
        "dataUrl": f"data:{mime_type};base64,{base64_data}",
        "filename": file.filename
    }


class GenerateImageRequest(BaseModel):
    prompt: str
    negativePrompt: Optional[str] = "blurry, low quality, distorted, deformed, ugly"


@app.post("/api/generate-image")
async def generate_single_image(request: GenerateImageRequest):
    """单独生成一张图像"""
    global image_service
    
    # 如果没有配置过，使用默认服务
    if image_service is None:
        image_service = ImageService(provider="placeholder")
    
    print(f"[API] 图像生成请求: provider={image_service.provider}, model={image_service.model}")
    
    try:
        image_url = await image_service.generate(
            prompt=request.prompt,
            negative_prompt=request.negativePrompt or ""
        )
        
        # 保存到历史记录
        storage.save_generated_image(
            prompt=request.prompt,
            image_url=image_url,
            negative_prompt=request.negativePrompt or "",
            provider=image_service.provider,
            model=image_service.model or ""
        )
        
        return {"imageUrl": image_url}
    except Exception as e:
        print(f"图像生成失败: {e}")
        # 返回占位图
        seed = abs(hash(request.prompt)) % 10000
        return {"imageUrl": f"https://picsum.photos/seed/{seed}/512/512"}


@app.post("/api/generate-video")
async def generate_video(request: VideoRequest):
    """生成视频（预留接口）"""
    # TODO: 实现视频生成
    return {
        "status": "not_implemented",
        "message": "视频生成功能开发中",
        "videoUrl": None
    }


# ========== 项目管理 API ==========

class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""


class UpdateProjectRequest(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    reference_image: Optional[str] = None
    story_text: Optional[str] = None
    style: Optional[str] = None
    status: Optional[str] = None


@app.post("/api/projects")
async def create_project(request: CreateProjectRequest):
    """创建项目"""
    project = storage.create_project(request.name, request.description)
    return project


@app.get("/api/projects")
async def list_projects(limit: int = 50, offset: int = 0):
    """获取项目列表"""
    projects = storage.list_projects(limit, offset)
    return {"projects": projects}


@app.get("/api/projects/{project_id}")
async def get_project(project_id: str):
    """获取项目详情"""
    project = storage.get_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@app.put("/api/projects/{project_id}")
async def update_project(project_id: str, request: UpdateProjectRequest):
    """更新项目"""
    updates = request.model_dump(exclude_none=True)
    project = storage.update_project(project_id, updates)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@app.delete("/api/projects/{project_id}")
async def delete_project(project_id: str):
    """删除项目"""
    success = storage.delete_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"status": "ok"}


# ========== 分镜管理 API ==========

class AddStoryboardRequest(BaseModel):
    prompt: str
    full_prompt: str = ""
    image_url: str = ""
    index: int = -1


class UpdateStoryboardRequest(BaseModel):
    prompt: Optional[str] = None
    full_prompt: Optional[str] = None
    image_url: Optional[str] = None
    status: Optional[str] = None
    index_num: Optional[int] = None


@app.post("/api/projects/{project_id}/storyboards")
async def add_storyboard(project_id: str, request: AddStoryboardRequest):
    """添加分镜"""
    storyboard = storage.add_storyboard(
        project_id, request.prompt, request.full_prompt, request.image_url, request.index
    )
    if not storyboard:
        raise HTTPException(status_code=404, detail="项目不存在")
    return storyboard


@app.put("/api/projects/{project_id}/storyboards/{storyboard_id}")
async def update_storyboard(project_id: str, storyboard_id: str, request: UpdateStoryboardRequest):
    """更新分镜"""
    updates = request.model_dump(exclude_none=True)
    storyboard = storage.update_storyboard(project_id, storyboard_id, updates)
    if not storyboard:
        raise HTTPException(status_code=404, detail="分镜不存在")
    return storyboard


@app.delete("/api/projects/{project_id}/storyboards/{storyboard_id}")
async def delete_storyboard(project_id: str, storyboard_id: str):
    """删除分镜"""
    success = storage.delete_storyboard(project_id, storyboard_id)
    if not success:
        raise HTTPException(status_code=404, detail="分镜不存在")
    return {"status": "ok"}


# ========== 剧本管理 API ==========

class SaveScriptRequest(BaseModel):
    title: str
    content: str
    project_id: Optional[str] = None


class UpdateScriptRequest(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None


@app.post("/api/scripts")
async def save_script(request: SaveScriptRequest):
    """保存剧本"""
    script = storage.save_script(request.title, request.content, request.project_id)
    return script


@app.get("/api/scripts")
async def list_scripts(project_id: Optional[str] = None, limit: int = 50):
    """获取剧本列表"""
    scripts = storage.list_scripts(project_id, limit)
    return {"scripts": scripts}


@app.get("/api/scripts/{script_id}")
async def get_script(script_id: str):
    """获取剧本"""
    script = storage.get_script(script_id)
    if not script:
        raise HTTPException(status_code=404, detail="剧本不存在")
    return script


@app.put("/api/scripts/{script_id}")
async def update_script(script_id: str, request: UpdateScriptRequest):
    """更新剧本"""
    script = storage.update_script(script_id, request.title, request.content)
    if not script:
        raise HTTPException(status_code=404, detail="剧本不存在")
    return script


@app.delete("/api/scripts/{script_id}")
async def delete_script(script_id: str):
    """删除剧本"""
    success = storage.delete_script(script_id)
    if not success:
        raise HTTPException(status_code=404, detail="剧本不存在")
    return {"status": "ok"}


# ========== 图像历史 API ==========

@app.get("/api/images/history")
async def get_image_history(limit: int = 100):
    """获取图像生成历史"""
    images = storage.list_generated_images(limit)
    return {"images": images}


# ========== 对话历史 API ==========

class SaveChatRequest(BaseModel):
    session_id: str
    module: str
    role: str
    content: str


@app.post("/api/chat/history")
async def save_chat_message(request: SaveChatRequest):
    """保存对话消息"""
    msg = storage.save_chat_message(request.session_id, request.module, request.role, request.content)
    return msg


@app.get("/api/chat/history/{session_id}")
async def get_chat_history(session_id: str, module: Optional[str] = None, limit: int = 50):
    """获取对话历史"""
    history = storage.get_chat_history(session_id, module, limit)
    return {"history": history}


@app.delete("/api/chat/history/{session_id}")
async def clear_chat_history(session_id: str, module: Optional[str] = None):
    """清除对话历史"""
    storage.clear_chat_history(session_id, module)
    return {"status": "ok"}


@app.get("/api/chat/sessions")
async def list_chat_sessions(limit: int = 50):
    """获取所有对话会话列表"""
    sessions = storage.list_chat_sessions(limit)
    return {"sessions": sessions}


# ========== 历史记录 API ==========

@app.get("/api/projects/{project_id}/history")
async def get_project_history(project_id: str):
    """获取项目历史记录"""
    history = storage.get_project_history(project_id)
    return {"history": history}


@app.get("/api/scripts/{script_id}/history")
async def get_script_history(script_id: str):
    """获取剧本历史记录"""
    history = storage.get_script_history(script_id)
    return {"history": history}


# ========== 数据导出/导入 API ==========

@app.post("/api/export/all")
async def export_all_data(include_images: bool = True):
    """导出所有数据"""
    export_path = storage.export_all(include_images)
    return {"path": export_path, "filename": os.path.basename(export_path)}


@app.get("/api/export/download/{filename}")
async def download_export(filename: str):
    """下载导出文件"""
    from services.storage_service import EXPORT_DIR
    filepath = os.path.join(EXPORT_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(filepath, filename=filename, media_type='application/zip')


@app.post("/api/export/project/{project_id}")
async def export_project(project_id: str):
    """导出单个项目"""
    export_path = storage.export_project(project_id)
    if not export_path:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"path": export_path, "filename": os.path.basename(export_path)}


@app.get("/api/exports")
async def list_exports():
    """列出所有导出文件"""
    exports = storage.list_exports()
    return {"exports": exports}


@app.post("/api/import")
async def import_data(file: UploadFile = File(...), merge: bool = True):
    """导入数据"""
    from services.storage_service import EXPORT_DIR
    
    # 保存上传的文件
    temp_path = os.path.join(EXPORT_DIR, f"import_{file.filename}")
    with open(temp_path, 'wb') as f:
        content = await file.read()
        f.write(content)
    
    # 导入数据
    result = storage.import_data(temp_path, merge)
    
    # 清理临时文件
    if os.path.exists(temp_path):
        os.remove(temp_path)
    
    return result


@app.post("/api/import/project")
async def import_project(file: UploadFile = File(...)):
    """导入单个项目"""
    from services.storage_service import EXPORT_DIR
    
    temp_path = os.path.join(EXPORT_DIR, f"import_{file.filename}")
    with open(temp_path, 'wb') as f:
        content = await file.read()
        f.write(content)
    
    project = storage.import_project(temp_path)
    
    if os.path.exists(temp_path):
        os.remove(temp_path)
    
    if not project:
        raise HTTPException(status_code=400, detail="导入失败，文件格式错误")
    
    return project


# ========== 统计 API ==========

@app.get("/api/stats")
async def get_stats():
    """获取数据统计"""
    stats = storage.get_stats()
    return stats


@app.get("/api/images/stats")
async def get_image_stats():
    """获取图像生成统计"""
    stats = storage.get_image_stats()
    return stats


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
