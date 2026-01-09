from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import os
import uuid
import base64

from services.llm_service import LLMService
from services.image_service import ImageService
from services.video_service import VideoService
from services.storage_service import storage
from services.agent_service import AgentService, AgentProject, AgentExecutor

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
storyboard_service: Optional[ImageService] = None  # 分镜专用图像服务
video_service: Optional[VideoService] = None  # 视频生成服务
agent_service: Optional[AgentService] = None  # Agent 服务

# 当前配置
current_settings = {}

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 参考图目录
REF_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "data", "images")
os.makedirs(REF_IMAGES_DIR, exist_ok=True)


def load_saved_settings():
    """启动时加载已保存的设置"""
    global llm_service, image_service, storyboard_service, video_service, agent_service, current_settings
    
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
            api_key=img_config.get('apiKey') or os.getenv("IMAGE_API_KEY", ""),
            base_url=img_config.get('baseUrl') or None,
            model=img_config.get('model') or None
        )
        print(f"[Startup] 图像服务已加载: provider={img_config.get('provider')}")
    
    # 加载分镜图像配置
    sb_config = saved.get('storyboard', {})
    if sb_config.get('provider') and sb_config.get('provider') != 'placeholder':
        if local_config.get('enabled') and sb_config.get('provider') in ['comfyui', 'sd-webui']:
            storyboard_service = ImageService(
                provider=sb_config.get('provider'),
                model=sb_config.get('model') or None,
                comfyui_url=local_config.get('comfyuiUrl', 'http://127.0.0.1:8188'),
                sd_webui_url=local_config.get('sdWebuiUrl', 'http://127.0.0.1:7860')
            )
        else:
            storyboard_service = ImageService(
                provider=sb_config.get('provider'),
                api_key=sb_config.get('apiKey') or os.getenv("STORYBOARD_API_KEY", "") or os.getenv("IMAGE_API_KEY", ""),
                base_url=sb_config.get('baseUrl') or None,
                model=sb_config.get('model') or None
            )
        print(f"[Startup] 分镜图像服务已加载: provider={sb_config.get('provider')}")
    
    # 加载视频配置
    video_config = saved.get('video', {})
    if video_config.get('provider') and video_config.get('provider') != 'none':
        video_service = VideoService(
            provider=video_config.get('provider'),
            api_key=video_config.get('apiKey') or os.getenv("VIDEO_API_KEY", ""),
            base_url=video_config.get('baseUrl') or None,
            model=video_config.get('model') or None
        )
        print(f"[Startup] 视频服务已加载: provider={video_config.get('provider')}")
    
    # 初始化 Agent 服务
    agent_service = AgentService(storage)
    print("[Startup] Agent 服务已加载")


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
    storyboard: Optional[ModelConfig] = None
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
    prompt: str = ""
    duration: float = 5.0
    motionStrength: float = 0.5
    seed: Optional[int] = None
    # 新增参数
    resolution: str = "720p"  # 720p, 1080p
    ratio: str = "16:9"  # 16:9, 9:16, 1:1
    cameraFixed: bool = False  # 是否固定镜头
    watermark: bool = False  # 是否添加水印
    generateAudio: bool = True  # 是否生成音频


class VideoTaskStatusRequest(BaseModel):
    taskId: str


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


def get_storyboard_service() -> ImageService:
    """获取分镜图像服务，如果未配置则回退到普通图像服务"""
    global storyboard_service
    if storyboard_service is not None:
        return storyboard_service
    # 回退到普通图像服务
    return get_image_service()


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
    global llm_service, image_service, storyboard_service, video_service, current_settings
    
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
    
    # 更新分镜图像服务
    if request.storyboard:
        sb_config = request.storyboard
        if local_config.enabled and sb_config.provider in ['comfyui', 'sd-webui']:
            storyboard_service = ImageService(
                provider=sb_config.provider,
                model=sb_config.model if sb_config.model else None,
                comfyui_url=local_config.comfyuiUrl,
                sd_webui_url=local_config.sdWebuiUrl
            )
        else:
            storyboard_service = ImageService(
                provider=sb_config.provider,
                api_key=sb_config.apiKey,
                base_url=sb_config.baseUrl if sb_config.baseUrl else None,
                model=sb_config.model if sb_config.model else None
            )
        print(f"[Settings] 分镜图像服务配置更新: provider={sb_config.provider}, model={sb_config.model}")
    
    # 更新视频服务
    video_config = request.video
    if video_config.provider and video_config.provider != 'none':
        video_service = VideoService(
            provider=video_config.provider,
            api_key=video_config.apiKey,
            base_url=video_config.baseUrl if video_config.baseUrl else None,
            model=video_config.model if video_config.model else None
        )
        print(f"[Settings] 视频服务配置更新: provider={video_config.provider}, model={video_config.model}")
    else:
        video_service = None
        print("[Settings] 视频服务未配置")
    
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
    img = get_storyboard_service()  # 使用分镜专用服务
    
    style_prompt = STYLE_PROMPTS.get(request.style, STYLE_PROMPTS["cinematic"])
    
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
        
        # 兼容新的返回格式
        image_url = result["url"] if isinstance(result, dict) else result
        
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
    img = get_storyboard_service()  # 使用分镜专用服务
    style_prompt = STYLE_PROMPTS.get(request.style, STYLE_PROMPTS["cinematic"])
    full_prompt = f"{request.prompt}, {style_prompt}"
    
    result = await img.generate(
        prompt=full_prompt,
        reference_image=request.referenceImage,
        style=request.style
    )
    
    # 兼容新的返回格式
    image_url = result["url"] if isinstance(result, dict) else result
    
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


# 支持的文件类型
ALLOWED_FILE_TYPES = {
    # 图片
    'image/jpeg': {'ext': '.jpg', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'image/png': {'ext': '.png', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'image/gif': {'ext': '.gif', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'image/webp': {'ext': '.webp', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    # 文档
    'application/pdf': {'ext': '.pdf', 'category': 'document', 'max_size': 50 * 1024 * 1024},
    'text/plain': {'ext': '.txt', 'category': 'document', 'max_size': 10 * 1024 * 1024},
    'text/markdown': {'ext': '.md', 'category': 'document', 'max_size': 10 * 1024 * 1024},
    'application/msword': {'ext': '.doc', 'category': 'document', 'max_size': 50 * 1024 * 1024},
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {'ext': '.docx', 'category': 'document', 'max_size': 50 * 1024 * 1024},
    # 表格
    'text/csv': {'ext': '.csv', 'category': 'spreadsheet', 'max_size': 30 * 1024 * 1024},
    'application/vnd.ms-excel': {'ext': '.xls', 'category': 'spreadsheet', 'max_size': 30 * 1024 * 1024},
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {'ext': '.xlsx', 'category': 'spreadsheet', 'max_size': 30 * 1024 * 1024},
    # 代码
    'application/json': {'ext': '.json', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'text/html': {'ext': '.html', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'text/css': {'ext': '.css', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'text/javascript': {'ext': '.js', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'application/xml': {'ext': '.xml', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    # 视频
    'video/mp4': {'ext': '.mp4', 'category': 'video', 'max_size': 100 * 1024 * 1024},
    'video/webm': {'ext': '.webm', 'category': 'video', 'max_size': 100 * 1024 * 1024},
    'video/quicktime': {'ext': '.mov', 'category': 'video', 'max_size': 100 * 1024 * 1024},
    # 音频
    'audio/mpeg': {'ext': '.mp3', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
    'audio/wav': {'ext': '.wav', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
    'audio/mp4': {'ext': '.m4a', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
    'audio/ogg': {'ext': '.ogg', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
}

# 上传文件目录
UPLOAD_DIR = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)):
    """通用文件上传接口"""
    import time
    
    # 检查文件类型
    content_type = file.content_type or 'application/octet-stream'
    
    # 根据扩展名推断类型
    ext = os.path.splitext(file.filename or '')[1].lower()
    category = 'unknown'
    max_size = 10 * 1024 * 1024  # 默认 10MB
    
    if content_type in ALLOWED_FILE_TYPES:
        file_config = ALLOWED_FILE_TYPES[content_type]
        category = file_config['category']
        max_size = file_config['max_size']
    elif content_type.startswith('image/'):
        category = 'image'
        max_size = 20 * 1024 * 1024
    elif content_type.startswith('video/'):
        category = 'video'
        max_size = 100 * 1024 * 1024
    elif content_type.startswith('audio/'):
        category = 'audio'
        max_size = 25 * 1024 * 1024
    elif content_type.startswith('text/') or ext in ['.py', '.js', '.ts', '.jsx', '.tsx', '.java', '.cpp', '.c', '.go', '.rs', '.sql', '.yaml', '.yml']:
        category = 'code'
        max_size = 10 * 1024 * 1024
    
    # 读取文件内容
    content = await file.read()
    file_size = len(content)
    
    # 检查文件大小
    if file_size > max_size:
        raise HTTPException(status_code=400, detail=f"文件过大，最大允许 {max_size // 1024 // 1024}MB")
    
    # 生成唯一文件名
    timestamp = int(time.time() * 1000)
    safe_filename = f"{timestamp}_{file.filename}"
    
    # 按类别创建子目录
    category_dir = os.path.join(UPLOAD_DIR, category)
    os.makedirs(category_dir, exist_ok=True)
    
    # 保存文件
    file_path = os.path.join(category_dir, safe_filename)
    with open(file_path, 'wb') as f:
        f.write(content)
    
    # 生成访问 URL
    file_url = f"/api/uploads/{category}/{safe_filename}"
    
    # 对于图片，也返回 base64 预览
    preview_url = None
    if category == 'image':
        base64_data = base64.b64encode(content).decode("utf-8")
        preview_url = f"data:{content_type};base64,{base64_data}"
    
    # 对于文本文件，返回内容
    text_content = None
    if category in ['code', 'document'] and file_size < 1024 * 1024:  # 小于 1MB 的文本文件
        try:
            text_content = content.decode('utf-8')
        except:
            pass
    
    # 解析 Word 文档 (.docx)
    if ext == '.docx' and text_content is None:
        try:
            from docx import Document
            from io import BytesIO
            doc = Document(BytesIO(content))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            text_content = '\n'.join(paragraphs)
            print(f"[Upload] 解析 Word 文档成功，提取 {len(paragraphs)} 段落")
        except Exception as e:
            print(f"[Upload] 解析 Word 文档失败: {e}")
    
    # 解析 PDF 文档
    if ext == '.pdf' and text_content is None:
        try:
            from PyPDF2 import PdfReader
            from io import BytesIO
            reader = PdfReader(BytesIO(content))
            pages_text = []
            for page in reader.pages:
                page_text = page.extract_text()
                if page_text:
                    pages_text.append(page_text)
            text_content = '\n\n'.join(pages_text)
            print(f"[Upload] 解析 PDF 文档成功，提取 {len(reader.pages)} 页")
        except Exception as e:
            print(f"[Upload] 解析 PDF 文档失败: {e}")
    
    print(f"[Upload] 文件已上传: {file.filename} -> {file_path} ({file_size} bytes, {category})")
    
    return {
        "success": True,
        "file": {
            "id": f"upload_{timestamp}",
            "name": file.filename,
            "size": file_size,
            "type": content_type,
            "category": category,
            "url": file_url,
            "previewUrl": preview_url,
            "content": text_content
        }
    }


@app.get("/api/uploads/{category}/{filename}")
async def get_uploaded_file(category: str, filename: str):
    """获取上传的文件"""
    file_path = os.path.join(UPLOAD_DIR, category, filename)
    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="文件不存在")
    
    # 根据扩展名确定 MIME 类型
    ext = os.path.splitext(filename)[1].lower()
    mime_types = {
        '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.gif': 'image/gif', '.webp': 'image/webp',
        '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
        '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4',
        '.pdf': 'application/pdf', '.txt': 'text/plain', '.md': 'text/markdown',
        '.json': 'application/json', '.xml': 'application/xml',
        '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
    }
    media_type = mime_types.get(ext, 'application/octet-stream')
    
    return FileResponse(file_path, media_type=media_type)


class GenerateImageRequest(BaseModel):
    prompt: str
    negativePrompt: Optional[str] = "blurry, low quality, distorted, deformed, ugly"
    width: int = 1024
    height: int = 576
    steps: int = 25
    seed: Optional[int] = None
    style: Optional[str] = None


# 风格预设
STYLE_PRESETS = {
    "cinematic": "cinematic lighting, film grain, dramatic shadows, movie scene, professional cinematography",
    "anime": "anime style, vibrant colors, cel shading, japanese animation, detailed illustration",
    "realistic": "photorealistic, highly detailed, 8k resolution, professional photography, natural lighting",
    "ink": "chinese ink painting style, traditional brush strokes, minimalist, elegant, monochrome with subtle colors",
    "fantasy": "fantasy art, magical atmosphere, ethereal lighting, detailed illustration, epic scene",
    "cyberpunk": "cyberpunk style, neon lights, futuristic city, high tech, dark atmosphere",
    "watercolor": "watercolor painting, soft colors, artistic, delicate brushstrokes, dreamy atmosphere",
    "oil_painting": "oil painting style, rich colors, textured brushstrokes, classical art, masterpiece"
}


@app.post("/api/generate-image")
async def generate_single_image(request: GenerateImageRequest):
    """单独生成一张图像"""
    global image_service
    
    # 如果没有配置过，使用默认服务
    if image_service is None:
        image_service = ImageService(provider="placeholder")
    
    # 处理风格预设
    final_prompt = request.prompt
    if request.style and request.style in STYLE_PRESETS:
        final_prompt = f"{request.prompt}, {STYLE_PRESETS[request.style]}"
    
    print(f"[API] 图像生成请求: provider={image_service.provider}, model={image_service.model}, size={request.width}x{request.height}")
    
    try:
        result = await image_service.generate(
            prompt=final_prompt,
            negative_prompt=request.negativePrompt or "",
            width=request.width,
            height=request.height,
            steps=request.steps,
            seed=request.seed
        )
        
        image_url = result["url"]
        actual_seed = result["seed"]
        
        # 保存到历史记录
        storage.save_generated_image(
            prompt=request.prompt,
            image_url=image_url,
            negative_prompt=request.negativePrompt or "",
            provider=image_service.provider,
            model=image_service.model or "",
            width=request.width,
            height=request.height,
            steps=request.steps,
            seed=actual_seed,
            style=request.style
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
        raise HTTPException(status_code=500, detail=f"图像生成失败: {error_msg}")


def get_video_service() -> VideoService:
    """获取视频服务"""
    global video_service
    if video_service is None:
        video_service = VideoService(provider="none")
    return video_service


@app.post("/api/generate-video")
async def generate_video(request: VideoRequest):
    """生成视频（从图片）"""
    service = get_video_service()
    
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
            generate_audio=request.generateAudio
        )
        
        # 保存到历史记录
        storage.save_generated_video(
            source_image=request.imageUrl,
            prompt=request.prompt,
            video_url=result.get("video_url"),
            task_id=result.get("task_id"),
            status=result.get("status"),
            provider=service.provider,
            model=service.model or "",
            duration=request.duration,
            seed=result.get("seed")
        )
        
        return {
            "taskId": result.get("task_id"),
            "status": result.get("status"),
            "videoUrl": result.get("video_url"),
            "duration": result.get("duration"),
            "seed": result.get("seed")
        }
    except Exception as e:
        error_msg = str(e)
        print(f"视频生成失败: {error_msg}")
        raise HTTPException(status_code=500, detail=f"视频生成失败: {error_msg}")


@app.post("/api/video-task-status")
async def check_video_task_status(request: VideoTaskStatusRequest):
    """检查视频生成任务状态"""
    service = get_video_service()
    
    try:
        result = await service.check_task_status(request.taskId)
        
        # 如果完成了，更新历史记录
        if result.get("status") == "completed" and result.get("video_url"):
            storage.update_video_status(
                request.taskId,
                "completed",
                result.get("video_url")
            )
        
        return {
            "taskId": request.taskId,
            "status": result.get("status"),
            "videoUrl": result.get("video_url"),
            "progress": result.get("progress", 0),
            "error": result.get("error")
        }
    except Exception as e:
        return {
            "taskId": request.taskId,
            "status": "error",
            "error": str(e)
        }


@app.get("/api/videos/history")
async def get_video_history(limit: int = 50):
    """获取视频生成历史"""
    videos = storage.list_generated_videos(limit)
    return {"videos": videos}


@app.delete("/api/videos/history/{video_id}")
async def delete_video_history(video_id: str):
    """删除单个视频历史记录"""
    success = storage.delete_generated_video(video_id)
    if not success:
        raise HTTPException(status_code=404, detail="视频记录不存在")
    return {"status": "ok"}


class DeleteVideosRequest(BaseModel):
    ids: List[str]


@app.post("/api/videos/history/delete-batch")
async def delete_videos_batch(request: DeleteVideosRequest):
    """批量删除视频历史记录"""
    deleted = storage.delete_generated_videos_batch(request.ids)
    return {"status": "ok", "deleted": deleted}


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


@app.delete("/api/images/history/{image_id}")
async def delete_image_history(image_id: str):
    """删除单个图像历史记录"""
    success = storage.delete_generated_image(image_id)
    if not success:
        raise HTTPException(status_code=404, detail="图像记录不存在")
    return {"status": "ok"}


class DeleteImagesRequest(BaseModel):
    ids: List[str]


@app.post("/api/images/history/delete-batch")
async def delete_images_batch(request: DeleteImagesRequest):
    """批量删除图像历史记录"""
    deleted = storage.delete_generated_images_batch(request.ids)
    return {"status": "ok", "deleted": deleted}


@app.get("/api/images/ref/{filename}")
async def get_reference_image(filename: str):
    """获取参考图文件"""
    filepath = os.path.join(REF_IMAGES_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(filepath, media_type="image/png")


@app.get("/api/videos/ref/{filename}")
async def get_video_reference_image(filename: str):
    """获取视频参考图文件"""
    from services.video_service import VIDEO_DIR
    filepath = os.path.join(VIDEO_DIR, filename)
    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 根据扩展名确定 MIME 类型
    ext = filename.split(".")[-1].lower()
    media_type = "image/png" if ext == "png" else "image/jpeg"
    return FileResponse(filepath, media_type=media_type)


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


@app.get("/api/proxy/download")
async def proxy_download(url: str):
    """代理下载远程文件（解决 CORS 问题）"""
    import httpx
    from fastapi.responses import Response
    
    print(f"[Proxy] 下载文件: {url[:100]}...")
    
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            response = await client.get(url)
            
            if response.status_code != 200:
                raise HTTPException(status_code=response.status_code, detail="下载失败")
            
            # 获取内容类型
            content_type = response.headers.get('content-type', 'application/octet-stream')
            
            print(f"[Proxy] 下载成功, 大小: {len(response.content)}, 类型: {content_type}")
            
            return Response(
                content=response.content,
                media_type=content_type,
                headers={
                    "Content-Disposition": "attachment"
                }
            )
    except Exception as e:
        print(f"[Proxy] 下载失败: {e}")
        raise HTTPException(status_code=500, detail=f"下载失败: {str(e)}")


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


# ========== 自定义配置预设 API ==========

class CustomProviderRequest(BaseModel):
    name: str  # 用户自定义名称，如 "我的OpenAI" 或 "自定义配置1"
    category: str  # llm / image / storyboard / video
    apiKey: str = ""
    baseUrl: str = ""
    model: str = ""
    models: List[str] = []  # 可选的模型列表


class UpdateCustomProviderRequest(BaseModel):
    name: Optional[str] = None
    apiKey: Optional[str] = None
    baseUrl: Optional[str] = None
    model: Optional[str] = None
    models: Optional[List[str]] = None


@app.get("/api/custom-providers")
async def list_custom_providers(category: Optional[str] = None):
    """获取自定义配置预设列表"""
    providers = storage.list_custom_providers(category)
    return {"providers": providers}


@app.post("/api/custom-providers")
async def add_custom_provider(request: CustomProviderRequest):
    """添加自定义配置预设
    
    用户可以添加多个自定义配置，每个配置有唯一的 id（以 custom_ 开头）和 isCustom=true 标识
    """
    if request.category not in ['llm', 'image', 'storyboard', 'video']:
        raise HTTPException(status_code=400, detail="无效的类别，必须是 llm/image/storyboard/video")
    
    config = {
        "apiKey": request.apiKey,
        "baseUrl": request.baseUrl,
        "model": request.model,
        "models": request.models
    }
    
    provider = storage.add_custom_provider(request.name, request.category, config)
    return provider


@app.get("/api/custom-providers/{provider_id}")
async def get_custom_provider(provider_id: str):
    """获取单个自定义配置预设"""
    provider = storage.get_custom_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="配置预设不存在")
    return provider


@app.put("/api/custom-providers/{provider_id}")
async def update_custom_provider(provider_id: str, request: UpdateCustomProviderRequest):
    """更新自定义配置预设"""
    updates = request.model_dump(exclude_none=True)
    provider = storage.update_custom_provider(provider_id, updates)
    if not provider:
        raise HTTPException(status_code=404, detail="配置预设不存在")
    return provider


@app.delete("/api/custom-providers/{provider_id}")
async def delete_custom_provider(provider_id: str):
    """删除自定义配置预设"""
    success = storage.delete_custom_provider(provider_id)
    if not success:
        raise HTTPException(status_code=404, detail="配置预设不存在")
    return {"status": "ok"}


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


# ========== Agent API ==========

class AgentChatRequest(BaseModel):
    message: str
    projectId: Optional[str] = None
    context: Optional[dict] = None


class AgentPlanRequest(BaseModel):
    userRequest: str
    style: str = "吉卜力2D"


class AgentElementPromptRequest(BaseModel):
    elementName: str
    elementType: str  # character / object / scene
    baseDescription: str
    visualStyle: str = "吉卜力动画风格"


class AgentShotPromptRequest(BaseModel):
    shotName: str
    shotType: str  # standard / quick / closeup / wide / montage
    shotDescription: str
    elements: List[str]
    visualStyle: str
    narration: str


class AgentProjectRequest(BaseModel):
    name: str
    creativeBrief: Optional[dict] = None


class AgentElementRequest(BaseModel):
    elementId: str
    name: str
    elementType: str
    description: str
    imageUrl: Optional[str] = None


class AgentSegmentRequest(BaseModel):
    segmentId: str
    name: str
    description: str


class AgentShotRequest(BaseModel):
    segmentId: str
    shotId: str
    name: str
    shotType: str
    description: str
    prompt: str
    narration: str
    duration: float = 5.0


def get_agent_service() -> AgentService:
    """获取 Agent 服务"""
    global agent_service
    if agent_service is None:
        agent_service = AgentService(storage)
    return agent_service


@app.post("/api/agent/chat")
async def agent_chat(request: AgentChatRequest):
    """Agent 对话接口"""
    service = get_agent_service()
    
    # 构建上下文
    context = request.context or {}
    if request.projectId:
        # 加载项目数据作为上下文
        project_data = storage.get_agent_project(request.projectId)
        if project_data:
            context["project"] = project_data
    
    result = await service.chat(request.message, context)
    return result


@app.post("/api/agent/plan")
async def agent_plan_project(request: AgentPlanRequest):
    """Agent 项目规划"""
    service = get_agent_service()
    result = await service.plan_project(request.userRequest, request.style)
    return result


@app.post("/api/agent/element-prompt")
async def agent_generate_element_prompt(request: AgentElementPromptRequest):
    """生成元素的图像提示词"""
    service = get_agent_service()
    result = await service.generate_element_prompt(
        request.elementName,
        request.elementType,
        request.baseDescription,
        request.visualStyle
    )
    return result


@app.post("/api/agent/shot-prompt")
async def agent_generate_shot_prompt(request: AgentShotPromptRequest):
    """生成镜头的视频提示词"""
    service = get_agent_service()
    result = await service.generate_shot_prompt(
        request.shotName,
        request.shotType,
        request.shotDescription,
        request.elements,
        request.visualStyle,
        request.narration
    )
    return result


@app.get("/api/agent/shot-types")
async def get_shot_types():
    """获取支持的镜头类型"""
    from services.agent_service import SHOT_TYPES
    return {"shotTypes": SHOT_TYPES}


# Agent 项目管理

@app.post("/api/agent/projects")
async def create_agent_project(request: AgentProjectRequest):
    """创建 Agent 项目"""
    project = AgentProject()
    project.name = request.name
    if request.creativeBrief:
        project.creative_brief = request.creativeBrief
    
    # 保存到存储
    storage.save_agent_project(project.to_dict())
    return project.to_dict()


@app.get("/api/agent/projects")
async def list_agent_projects(limit: int = 50):
    """获取 Agent 项目列表"""
    projects = storage.list_agent_projects(limit)
    return {"projects": projects}


@app.get("/api/agent/projects/{project_id}")
async def get_agent_project(project_id: str):
    """获取 Agent 项目详情"""
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")
    return project


@app.put("/api/agent/projects/{project_id}")
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


@app.delete("/api/agent/projects/{project_id}")
async def delete_agent_project(project_id: str):
    """删除 Agent 项目"""
    success = storage.delete_agent_project(project_id)
    if not success:
        raise HTTPException(status_code=404, detail="项目不存在")
    return {"status": "ok"}


@app.post("/api/agent/projects/{project_id}/export/assets")
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


@app.post("/api/agent/projects/{project_id}/export/video")
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


@app.post("/api/agent/projects/{project_id}/elements")
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


@app.post("/api/agent/projects/{project_id}/segments")
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


@app.post("/api/agent/projects/{project_id}/shots")
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


@app.post("/api/agent/projects/{project_id}/elements/{element_id}/favorite")
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
    image_history = element.get("image_history", [])
    
    # 找到要收藏的图片
    target_image = None
    for img in image_history:
        if img.get("id") == request.imageId:
            target_image = img
            img["is_favorite"] = True
        else:
            img["is_favorite"] = False
    
    if not target_image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 更新当前使用的图片
    element["image_url"] = target_image["url"]
    element["image_history"] = image_history
    
    # 保存项目
    storage.save_agent_project(project.to_dict())
    
    return {"success": True, "element": element}


@app.post("/api/agent/projects/{project_id}/shots/{shot_id}/favorite")
async def favorite_shot_image(project_id: str, shot_id: str, request: FavoriteImageRequest):
    """收藏镜头起始帧 - 将指定图片设为当前使用的起始帧"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    
    # 在所有段落中查找镜头
    target_shot = None
    for segment in project.segments:
        for shot in segment.get("shots", []):
            if shot.get("id") == shot_id:
                target_shot = shot
                break
        if target_shot:
            break
    
    if not target_shot:
        raise HTTPException(status_code=404, detail="镜头不存在")
    
    # 获取图片历史
    image_history = target_shot.get("start_image_history", [])
    
    # 找到要收藏的图片
    target_image = None
    for img in image_history:
        if img.get("id") == request.imageId:
            target_image = img
            img["is_favorite"] = True
        else:
            img["is_favorite"] = False
    
    if not target_image:
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 更新当前使用的起始帧
    target_shot["start_image_url"] = target_image["url"]
    target_shot["start_image_history"] = image_history
    
    # 保存项目
    storage.save_agent_project(project.to_dict())
    
    return {"success": True}


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


def get_agent_executor() -> AgentExecutor:
    """获取 Agent 执行器"""
    return AgentExecutor(
        agent_service=get_agent_service(),
        image_service=get_image_service(),
        video_service=get_video_service(),
        storage=storage
    )


from fastapi.responses import FileResponse, StreamingResponse
import json
import asyncio


@app.post("/api/agent/projects/{project_id}/generate-elements")
async def generate_project_elements(project_id: str, request: GenerateElementsRequest):
    """批量生成项目的所有元素图片
    
    Flova 风格：生成完成后返回结果，前端可以展示并让用户确认
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()
    
    try:
        result = await executor.generate_all_elements(
            project,
            visual_style=request.visualStyle
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@app.get("/api/agent/projects/{project_id}/generate-elements-stream")
async def generate_project_elements_stream(project_id: str, visualStyle: str = "吉卜力动画风格"):
    """流式生成项目的所有元素图片 (SSE)
    
    每生成一张图片就推送一次进度
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()
    
    async def event_generator():
        elements = list(project.elements.values())
        total = len(elements)
        generated = 0
        failed = 0
        
        # 发送开始事件
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        
        for i, element in enumerate(elements):
            # 跳过已有图片的元素
            if element.get("image_url"):
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
                
                image_url = image_result.get("url")
                
                # 更新元素
                project.elements[element["id"]]["image_url"] = image_url
                project.elements[element["id"]]["prompt"] = prompt
                
                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"asset_{element['id']}",
                    "url": image_url,
                    "type": "element",
                    "element_id": element["id"]
                })
                
                # 保存项目（每生成一张就保存）
                storage.save_agent_project(project.to_dict())
                
                generated += 1
                
                # 发送完成事件
                yield f"data: {json.dumps({'type': 'complete', 'element_id': element['id'], 'image_url': image_url, 'current': i + 1, 'total': total, 'generated': generated})}\n\n"
                
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


@app.post("/api/agent/projects/{project_id}/shots/{shot_id}/regenerate-frame")
async def regenerate_shot_frame(project_id: str, shot_id: str, request: RegenerateShotFrameRequest):
    """重新生成单个镜头的起始帧（带角色参考图）"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()
    
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


@app.post("/api/agent/projects/{project_id}/generate-frames")
async def generate_project_frames(project_id: str, request: GenerateFramesRequest):
    """批量生成项目的所有镜头起始帧
    
    需要先生成元素图片，起始帧会引用元素
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()
    
    try:
        result = await executor.generate_all_start_frames(
            project,
            visual_style=request.visualStyle
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@app.post("/api/agent/projects/{project_id}/generate-videos")
async def generate_project_videos(project_id: str, request: GenerateVideosRequest):
    """批量生成项目的所有视频
    
    需要先生成起始帧，视频基于起始帧生成
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")
    
    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()
    
    try:
        result = await executor.generate_all_videos(
            project,
            resolution=request.resolution
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"生成失败: {str(e)}")


@app.post("/api/agent/projects/{project_id}/poll-video-tasks")
async def poll_project_video_tasks(project_id: str):
    """Poll pending video tasks for a project once and persist any completed results."""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="Project not found")

    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()

    try:
        result = await executor.poll_project_video_tasks(project)
        return {"success": True, **result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Poll failed: {str(e)}")


@app.post("/api/agent/projects/{project_id}/execute-pipeline")
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
    executor = get_agent_executor()
    
    try:
        result = await executor.execute_full_pipeline(
            project,
            visual_style=request.visualStyle,
            resolution=request.resolution
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"执行失败: {str(e)}")


@app.get("/api/agent/projects/{project_id}/status")
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
