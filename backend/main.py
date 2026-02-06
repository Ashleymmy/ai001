from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List, Dict, Any, Tuple, Set
import os
import uuid
import base64
import re
import math
from urllib.parse import urlparse, parse_qs
from datetime import datetime, timezone, timedelta

from services.llm_service import LLMService
from services.image_service import ImageService
from services.video_service import VideoService
from services.storage_service import storage
from services.agent_service import AgentService, AgentProject, AgentExecutor
from services.fish_audio_service import FishAudioConfig, FishAudioService
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


class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


app = FastAPI(title="AI Storyboarder Backend", default_response_class=UTF8JSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 全局服务实例（Agent 运行时）
llm_service: Optional[LLMService] = None
image_service: Optional[ImageService] = None
storyboard_service: Optional[ImageService] = None  # 分镜专用图像服务（Agent）
video_service: Optional[VideoService] = None  # 视频生成服务（Agent）
agent_service: Optional[AgentService] = None  # Agent 服务

# 独立模块运行时（与 Agent 隔离）
module_llm_service: Optional[LLMService] = None
module_image_service: Optional[ImageService] = None
module_storyboard_service: Optional[ImageService] = None
module_video_service: Optional[VideoService] = None

video_task_services: Dict[str, VideoService] = {}  # 任务级视频服务实例（模块侧）

# 当前配置
current_settings: Dict[str, Any] = {}  # Agent settings
module_current_settings: Dict[str, Any] = {}  # Module settings

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 参考图目录
REF_IMAGES_DIR = os.path.join(os.path.dirname(__file__), "data", "images")
os.makedirs(REF_IMAGES_DIR, exist_ok=True)


def load_saved_settings():
    """启动时加载已保存的设置"""
    global llm_service, image_service, storyboard_service, video_service
    global module_llm_service, module_image_service, module_storyboard_service, module_video_service
    global agent_service, current_settings, module_current_settings

    # Agent 运行时：只读全局 settings
    agent_saved = storage.get_settings()
    if agent_saved:
        current_settings = agent_saved
        print("[Startup] 加载 Agent settings...")

        llm_config = agent_saved.get("llm", {})
        if llm_config.get("apiKey"):
            llm_service = LLMService(
                provider=llm_config.get("provider", "qwen"),
                api_key=llm_config.get("apiKey", ""),
                base_url=llm_config.get("baseUrl") or None,
                model=llm_config.get("model") or None,
            )

        img_config = agent_saved.get("image", {})
        local_config = agent_saved.get("local", {})
        if local_config.get("enabled") and img_config.get("provider") in ["comfyui", "sd-webui"]:
            image_service = ImageService(
                provider=img_config.get("provider"),
                model=img_config.get("model") or None,
                comfyui_url=local_config.get("comfyuiUrl", "http://127.0.0.1:8188"),
                sd_webui_url=local_config.get("sdWebuiUrl", "http://127.0.0.1:7860"),
            )
        elif img_config.get("provider") and img_config.get("provider") != "placeholder":
            image_service = ImageService(
                provider=img_config.get("provider"),
                api_key=img_config.get("apiKey") or os.getenv("IMAGE_API_KEY", ""),
                base_url=img_config.get("baseUrl") or None,
                model=img_config.get("model") or None,
            )

        sb_config = agent_saved.get("storyboard", {})
        if sb_config.get("provider") and sb_config.get("provider") != "placeholder":
            if local_config.get("enabled") and sb_config.get("provider") in ["comfyui", "sd-webui"]:
                storyboard_service = ImageService(
                    provider=sb_config.get("provider"),
                    model=sb_config.get("model") or None,
                    comfyui_url=local_config.get("comfyuiUrl", "http://127.0.0.1:8188"),
                    sd_webui_url=local_config.get("sdWebuiUrl", "http://127.0.0.1:7860"),
                )
            else:
                storyboard_service = ImageService(
                    provider=sb_config.get("provider"),
                    api_key=sb_config.get("apiKey") or os.getenv("STORYBOARD_API_KEY", "") or os.getenv("IMAGE_API_KEY", ""),
                    base_url=sb_config.get("baseUrl") or None,
                    model=sb_config.get("model") or None,
                )

        video_config = agent_saved.get("video", {})
        if video_config.get("provider") and video_config.get("provider") != "none":
            video_service = VideoService(
                provider=video_config.get("provider"),
                api_key=video_config.get("apiKey") or os.getenv("VIDEO_API_KEY", ""),
                base_url=video_config.get("baseUrl") or None,
                model=video_config.get("model") or None,
            )
    else:
        print("[Startup] 没有找到 Agent settings（将使用环境变量/默认值）")

    # 独立模块运行时：优先 module settings，缺失时回退旧 settings（兼容老数据）
    module_saved = storage.get_module_settings() or storage.get_settings()
    if module_saved:
        module_current_settings = module_saved
        print("[Startup] 加载 Module settings...")

        module_llm_cfg = module_saved.get("llm", {})
        if module_llm_cfg.get("apiKey"):
            module_llm_service = LLMService(
                provider=module_llm_cfg.get("provider", "qwen"),
                api_key=module_llm_cfg.get("apiKey", ""),
                base_url=module_llm_cfg.get("baseUrl") or None,
                model=module_llm_cfg.get("model") or None,
            )

        module_img_cfg = module_saved.get("image", {})
        module_local_cfg = module_saved.get("local", {})
        if module_local_cfg.get("enabled") and module_img_cfg.get("provider") in ["comfyui", "sd-webui"]:
            module_image_service = ImageService(
                provider=module_img_cfg.get("provider"),
                model=module_img_cfg.get("model") or None,
                comfyui_url=module_local_cfg.get("comfyuiUrl", "http://127.0.0.1:8188"),
                sd_webui_url=module_local_cfg.get("sdWebuiUrl", "http://127.0.0.1:7860"),
            )
        elif module_img_cfg.get("provider") and module_img_cfg.get("provider") != "placeholder":
            module_image_service = ImageService(
                provider=module_img_cfg.get("provider"),
                api_key=module_img_cfg.get("apiKey") or os.getenv("IMAGE_API_KEY", ""),
                base_url=module_img_cfg.get("baseUrl") or None,
                model=module_img_cfg.get("model") or None,
            )

        module_sb_cfg = module_saved.get("storyboard", {})
        if module_sb_cfg.get("provider") and module_sb_cfg.get("provider") != "placeholder":
            if module_local_cfg.get("enabled") and module_sb_cfg.get("provider") in ["comfyui", "sd-webui"]:
                module_storyboard_service = ImageService(
                    provider=module_sb_cfg.get("provider"),
                    model=module_sb_cfg.get("model") or None,
                    comfyui_url=module_local_cfg.get("comfyuiUrl", "http://127.0.0.1:8188"),
                    sd_webui_url=module_local_cfg.get("sdWebuiUrl", "http://127.0.0.1:7860"),
                )
            else:
                module_storyboard_service = ImageService(
                    provider=module_sb_cfg.get("provider"),
                    api_key=module_sb_cfg.get("apiKey") or os.getenv("STORYBOARD_API_KEY", "") or os.getenv("IMAGE_API_KEY", ""),
                    base_url=module_sb_cfg.get("baseUrl") or None,
                    model=module_sb_cfg.get("model") or None,
                )

        module_video_cfg = module_saved.get("video", {})
        if module_video_cfg.get("provider") and module_video_cfg.get("provider") != "none":
            module_video_service = VideoService(
                provider=module_video_cfg.get("provider"),
                api_key=module_video_cfg.get("apiKey") or os.getenv("VIDEO_API_KEY", ""),
                base_url=module_video_cfg.get("baseUrl") or None,
                model=module_video_cfg.get("model") or None,
            )
    else:
        print("[Startup] 没有找到 Module settings（将使用环境变量/默认值）")

    # 初始化 Agent 服务（仅依赖 storage，不与 module runtime 共享配置）
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
    tts: Optional["TTSConfig"] = None


class TestConnectionRequest(BaseModel):
    category: str  # llm/image/storyboard/video
    config: ModelConfig
    local: Optional[LocalConfig] = None


class VolcTTSSettings(BaseModel):
    appid: str = ""
    accessToken: str = ""
    endpoint: str = "https://openspeech.bytedance.com/api/v1/tts"
    cluster: str = "volcano_tts"
    model: str = "seed-tts-1.1"
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    # 默认音色（可被 Agent 中的具体角色覆盖）
    narratorVoiceType: str = ""
    # 兼容旧字段：dialogueVoiceType（未区分男女对白）
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class FishTTSSettings(BaseModel):
    apiKey: str = ""
    baseUrl: str = "https://api.fish.audio"
    model: str = "speech-1.5"
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class BailianTTSSettings(BaseModel):
    # 阿里百炼（DashScope 通用语音）
    apiKey: str = ""
    baseUrl: str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
    workspace: str = ""
    model: str = "cosyvoice-v1"
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class CustomTTSDefaults(BaseModel):
    # 用户自定义（OpenAI 兼容语音接口）使用的默认参数（不包含鉴权/地址/模型）
    encoding: str = "mp3"
    rate: int = 24000
    speedRatio: float = 1.0
    narratorVoiceType: str = ""
    dialogueVoiceType: str = ""
    dialogueMaleVoiceType: str = ""
    dialogueFemaleVoiceType: str = ""


class TTSConfig(BaseModel):
    provider: str = "volc_tts_v1_http"
    volc: VolcTTSSettings = Field(default_factory=VolcTTSSettings)
    fish: FishTTSSettings = Field(default_factory=FishTTSSettings)
    bailian: BailianTTSSettings = Field(default_factory=BailianTTSSettings)
    custom: CustomTTSDefaults = Field(default_factory=CustomTTSDefaults)

    # legacy flat fields (for backwards compatibility)
    appid: Optional[str] = None
    accessToken: Optional[str] = None
    baseUrl: Optional[str] = None
    cluster: Optional[str] = None
    model: Optional[str] = None
    encoding: Optional[str] = None
    rate: Optional[int] = None
    speedRatio: Optional[float] = None
    narratorVoiceType: Optional[str] = None
    dialogueVoiceType: Optional[str] = None
    dialogueMaleVoiceType: Optional[str] = None
    dialogueFemaleVoiceType: Optional[str] = None

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_payload(cls, data: Any):
        if not isinstance(data, dict):
            return data

        if any(k in data for k in ("volc", "fish", "bailian", "custom")):
            fish = data.get("fish")
            if isinstance(fish, dict) and "accessToken" in fish and "apiKey" not in fish:
                fish = {**fish, "apiKey": fish.get("accessToken") or ""}
                data = {**data, "fish": fish}
            bailian = data.get("bailian")
            if isinstance(bailian, dict):
                raw = str(bailian.get("baseUrl") or bailian.get("base_url") or "").strip()
                if raw and raw.startswith(("http://", "https://")) and "dashscope.aliyuncs.com" in raw:
                    bailian = {**bailian, "baseUrl": "wss://dashscope.aliyuncs.com/api-ws/v1/inference"}
                    data = {**data, "bailian": bailian}
            return data

        provider = str(data.get("provider") or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
        raw_base_url = str(data.get("baseUrl") or data.get("base_url") or "").strip()

        def looks_like_fish_voice_id(value: str) -> bool:
            import re

            v = (value or "").strip().lower()
            if not v:
                return False
            if re.fullmatch(r"[0-9a-f]{32}", v):
                return True
            if re.fullmatch(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", v):
                return True
            return False

        def looks_like_volc_voice_type(value: str) -> bool:
            v = (value or "").strip().lower()
            return bool(v) and (v.startswith("zh_") or v.startswith("en_"))

        legacy_voice = {
            "narratorVoiceType": str(data.get("narratorVoiceType") or "").strip(),
            "dialogueVoiceType": str(data.get("dialogueVoiceType") or "").strip(),
            "dialogueMaleVoiceType": str(data.get("dialogueMaleVoiceType") or "").strip(),
            "dialogueFemaleVoiceType": str(data.get("dialogueFemaleVoiceType") or "").strip(),
        }

        volc_voice: Dict[str, str] = {}
        fish_voice: Dict[str, str] = {}
        for k, v in legacy_voice.items():
            if looks_like_fish_voice_id(v):
                fish_voice[k] = v
            elif looks_like_volc_voice_type(v):
                volc_voice[k] = v
            else:
                (fish_voice if provider.startswith("fish") else volc_voice)[k] = v

        # Tokens: old field accessToken could be either provider; split by active provider
        legacy_access_token = str(data.get("accessToken") or data.get("access_token") or "").strip()
        volc_token = legacy_access_token if not provider.startswith("fish") else ""
        fish_key = legacy_access_token if provider.startswith("fish") else ""

        # baseUrl: historically used for fish; keep volc endpoint override only if it looks like an openspeech URL.
        volc_endpoint = ""
        fish_base_url = ""
        if raw_base_url:
            if "fish.audio" in raw_base_url:
                fish_base_url = raw_base_url
            elif "openspeech.bytedance.com" in raw_base_url or raw_base_url.endswith("/tts"):
                volc_endpoint = raw_base_url
            else:
                # Unknown URL; prefer fish to avoid breaking volc endpoint.
                fish_base_url = raw_base_url

        volc = {
            "appid": str(data.get("appid") or "").strip(),
            "accessToken": volc_token,
            "endpoint": volc_endpoint or "https://openspeech.bytedance.com/api/v1/tts",
            "cluster": str(data.get("cluster") or "volcano_tts").strip() or "volcano_tts",
            "model": str(data.get("model") or "seed-tts-1.1").strip() or "seed-tts-1.1",
            "encoding": str(data.get("encoding") or "mp3").strip() or "mp3",
            "rate": int(data.get("rate") or 24000),
            "speedRatio": float(data.get("speedRatio") or 1.0),
            **volc_voice,
        }

        fish_model = str(data.get("model") or "").strip()
        if not fish_model or fish_model.startswith("seed-"):
            fish_model = "speech-1.5"

        fish = {
            "apiKey": fish_key,
            "baseUrl": fish_base_url or "https://api.fish.audio",
            "model": fish_model,
            "encoding": str(data.get("encoding") or "mp3").strip() or "mp3",
            "rate": int(data.get("rate") or 24000),
            "speedRatio": float(data.get("speedRatio") or 1.0),
            **fish_voice,
        }

        return {
            "provider": provider,
            "volc": volc,
            "fish": fish,
            "bailian": BailianTTSSettings().model_dump(),
            "custom": CustomTTSDefaults().model_dump(),
        }


class GenerateRequest(BaseModel):
    referenceImage: Optional[str] = None
    storyText: str
    style: str = "cinematic"
    count: int = 4
    llm: Optional[ModelConfig] = None
    storyboard: Optional[ModelConfig] = None
    local: Optional[LocalConfig] = None


class ParseStoryRequest(BaseModel):
    storyText: str
    style: str = "cinematic"
    count: int = 4
    llm: Optional[ModelConfig] = None


class RegenerateRequest(BaseModel):
    prompt: str
    referenceImage: Optional[str] = None
    style: str = "cinematic"
    storyboard: Optional[ModelConfig] = None
    local: Optional[LocalConfig] = None


class ChatRequest(BaseModel):
    message: str
    context: Optional[str] = None
    llm: Optional[ModelConfig] = None


class BridgeGenerateTextRequest(BaseModel):
    prompt: str
    systemPrompt: Optional[str] = ""
    temperature: float = 0.7
    maxTokens: Optional[int] = None
    model: Optional[str] = None
    topP: Optional[float] = None


class VideoRequest(BaseModel):
    imageUrl: str
    projectId: Optional[str] = None
    scope: str = "module"  # module | agent
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
    # demo bridge 扩展：参考帧模式
    referenceMode: Optional[str] = None  # single, first_last, multiple, none
    firstFrameUrl: Optional[str] = None
    lastFrameUrl: Optional[str] = None
    referenceImageUrls: Optional[List[str]] = None
    video: Optional[ModelConfig] = None


class VideoTaskStatusRequest(BaseModel):
    taskId: str


class GenerateAgentAudioRequest(BaseModel):
    overwrite: bool = False
    includeNarration: bool = True
    includeDialogue: bool = True
    shotIds: Optional[List[str]] = None
    # 可选：覆盖默认音色
    narratorVoiceType: Optional[str] = None
    dialogueVoiceType: Optional[str] = None
    dialogueMaleVoiceType: Optional[str] = None
    dialogueFemaleVoiceType: Optional[str] = None
    speedRatio: Optional[float] = None
    rate: Optional[int] = None
    encoding: Optional[str] = None


class ClearAgentAudioRequest(BaseModel):
    shotIds: Optional[List[str]] = None
    deleteFiles: bool = True


class TestTTSRequest(BaseModel):
    tts: TTSConfig
    voiceType: Optional[str] = None
    text: Optional[str] = None
STYLE_PROMPTS = {
    "cinematic": "cinematic lighting, film grain, dramatic shadows, movie scene, professional cinematography",
    "anime": "anime style, vibrant colors, cel shading, japanese animation, detailed illustration",
    "realistic": "photorealistic, highly detailed, 8k resolution, professional photography, natural lighting",
    "ink": "chinese ink painting style, traditional brush strokes, minimalist, elegant, monochrome with subtle colors"
}


def _is_model_access_error(error_message: str) -> bool:
    """判断是否为模型/endpoint 不存在或无权限错误。"""
    msg = (error_message or "").lower()
    return (
        "model or endpoint" in msg
        and (
            "does not exist" in msg
            or "do not have access" in msg
            or "no access" in msg
            or "not found" in msg
        )
    )


def get_agent_llm_service() -> LLMService:
    """Agent 运行时 LLM 服务（全局 settings）。"""
    global llm_service
    if llm_service is None:
        llm_service = LLMService(
            provider=os.getenv("LLM_PROVIDER", "qwen"),
            api_key=os.getenv("LLM_API_KEY", "")
        )
    return llm_service


def get_module_llm_service() -> LLMService:
    """独立模块运行时 LLM 服务（module settings）。"""
    global module_llm_service
    if module_llm_service is None:
        module_llm_service = LLMService(
            provider=os.getenv("LLM_PROVIDER", "qwen"),
            api_key=os.getenv("LLM_API_KEY", "")
        )
    return module_llm_service


def get_llm_service() -> LLMService:
    """兼容历史调用：默认返回独立模块 LLM 服务。"""
    return get_module_llm_service()


def get_request_llm_service(override: Optional[ModelConfig] = None) -> LLMService:
    """按请求构建模块 LLM 服务，避免影响 Agent 运行时。"""
    if override is None:
        return get_module_llm_service()

    provider = (override.provider or "").strip() or "qwen"
    api_key = (override.apiKey or "").strip()
    base_url = (override.baseUrl or "").strip() or None
    model = (override.model or "").strip() or None

    if provider.startswith("custom_"):
        custom = storage.get_module_custom_provider(provider) or storage.get_custom_provider(provider) or {}
        if isinstance(custom, dict) and str(custom.get("category") or "") == "llm":
            api_key = str(custom.get("apiKey") or api_key).strip()
            base_url = str(custom.get("baseUrl") or (base_url or "")).strip() or None
            model = str(custom.get("model") or (model or "")).strip() or None

    # 前端未携带密钥时，回退到模块设置，保持兼容行为。
    if not api_key:
        return get_module_llm_service()

    return LLMService(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model
    )


def get_image_service() -> ImageService:
    """Agent 运行时图像服务（全局 settings）。"""
    global image_service
    if image_service is None:
        image_service = ImageService(
            provider=os.getenv("IMAGE_PROVIDER", "placeholder"),
            api_key=os.getenv("IMAGE_API_KEY", "")
        )
    return image_service


def get_storyboard_service() -> ImageService:
    """Agent 分镜图像服务；未配置则回退到 Agent 图像服务。"""
    global storyboard_service
    if storyboard_service is not None:
        return storyboard_service
    return get_image_service()


def get_module_image_service() -> ImageService:
    """独立模块图像服务（module settings）。"""
    global module_image_service
    if module_image_service is None:
        module_image_service = ImageService(
            provider=os.getenv("IMAGE_PROVIDER", "placeholder"),
            api_key=os.getenv("IMAGE_API_KEY", "")
        )
    return module_image_service


def get_module_storyboard_service() -> ImageService:
    """独立模块分镜图像服务；未配置则回退到独立模块图像服务。"""
    global module_storyboard_service
    if module_storyboard_service is not None:
        return module_storyboard_service
    return get_module_image_service()


def resolve_request_model_config(
    override: ModelConfig,
    expected_categories: Optional[Set[str]] = None,
    module_scope: bool = True
) -> Tuple[str, str, Optional[str], Optional[str]]:
    provider = (override.provider or "").strip()
    api_key = (override.apiKey or "").strip()
    base_url = (override.baseUrl or "").strip() or None
    model = (override.model or "").strip() or None

    if provider.startswith("custom_"):
        if module_scope:
            custom = storage.get_module_custom_provider(provider) or storage.get_custom_provider(provider) or {}
        else:
            custom = storage.get_custom_provider(provider) or {}
        custom_category = str(custom.get("category") or "")
        if isinstance(custom, dict) and (
            expected_categories is None or custom_category in expected_categories
        ):
            api_key = str(custom.get("apiKey") or api_key).strip()
            base_url = str(custom.get("baseUrl") or (base_url or "")).strip() or None
            model = str(custom.get("model") or (model or "")).strip() or None

    return provider, api_key, base_url, model


def get_request_image_service(
    override: Optional[ModelConfig] = None,
    local_override: Optional[LocalConfig] = None,
    mode: str = "image",
    module_scope: bool = True
) -> ImageService:
    if module_scope:
        fallback = get_module_storyboard_service() if mode == "storyboard" else get_module_image_service()
    else:
        fallback = get_storyboard_service() if mode == "storyboard" else get_image_service()
    if override is None:
        return fallback

    provider, api_key, base_url, model = resolve_request_model_config(
        override, expected_categories={"image", "storyboard"}, module_scope=module_scope
    )
    if not provider:
        return fallback
    if provider == "placeholder":
        return ImageService(provider="placeholder", model=model)

    local_cfg = local_override or LocalConfig()
    if provider in {"comfyui", "sd-webui"}:
        comfyui_url = local_cfg.comfyuiUrl
        sd_webui_url = local_cfg.sdWebuiUrl
        if base_url:
            if provider == "comfyui":
                comfyui_url = base_url
            else:
                sd_webui_url = base_url
        return ImageService(
            provider=provider,
            model=model,
            comfyui_url=comfyui_url,
            sd_webui_url=sd_webui_url
        )

    if not api_key:
        return fallback

    return ImageService(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model
    )


@app.get("/health")
async def health_check():
    module_llm = get_module_llm_service()
    module_image = get_module_image_service()
    return {
        "status": "ok",
        "version": "1.0.0",
        "llm_configured": bool(module_llm.api_key),
        "image_configured": bool(module_image.provider and module_image.provider != "placeholder")
    }


def apply_agent_runtime_settings(request: SettingsRequest) -> Dict[str, Any]:
    """应用 Agent 运行时设置（全局 settings）。"""
    global llm_service, image_service, storyboard_service, video_service

    applied_settings = request.model_dump()
    if request.tts:
        # Avoid persisting legacy flat fields (None) into YAML.
        applied_settings["tts"] = request.tts.model_dump(exclude_none=True)

    # 更新 LLM 服务
    llm_config = request.llm
    llm_service = LLMService(
        provider=llm_config.provider,
        api_key=llm_config.apiKey,
        base_url=llm_config.baseUrl if llm_config.baseUrl else None,
        model=llm_config.model if llm_config.model else None
    )
    print(f"[Settings][Agent] LLM 配置更新: provider={llm_config.provider}, model={llm_config.model}")

    # 更新图像服务
    img_config = request.image
    local_config = request.local

    if local_config.enabled and img_config.provider in ['comfyui', 'sd-webui']:
        image_service = ImageService(
            provider=img_config.provider,
            model=img_config.model if img_config.model else None,
            comfyui_url=local_config.comfyuiUrl,
            sd_webui_url=local_config.sdWebuiUrl
        )
        print(f"[Settings][Agent] 图像服务配置更新: 本地模式, provider={img_config.provider}")
    else:
        image_service = ImageService(
            provider=img_config.provider,
            api_key=img_config.apiKey,
            base_url=img_config.baseUrl if img_config.baseUrl else None,
            model=img_config.model if img_config.model else None
        )
        print(f"[Settings][Agent] 图像服务配置更新: API模式, provider={img_config.provider}, model={img_config.model}")

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
        print(f"[Settings][Agent] 分镜图像服务配置更新: provider={sb_config.provider}, model={sb_config.model}")

    # 更新视频服务
    video_config = request.video
    if video_config.provider and video_config.provider != 'none':
        video_service = VideoService(
            provider=video_config.provider,
            api_key=video_config.apiKey,
            base_url=video_config.baseUrl if video_config.baseUrl else None,
            model=video_config.model if video_config.model else None
        )
        print(f"[Settings][Agent] 视频服务配置更新: provider={video_config.provider}, model={video_config.model}")
    else:
        video_service = None
        print("[Settings][Agent] 视频服务未配置")

    # TTS 配置仅持久化（按需在调用时使用）
    if request.tts:
        tts_provider = str(request.tts.provider or "").strip() or "volc_tts_v1_http"
        print(
            "[Settings][Agent] TTS 配置已更新: "
            f"provider={tts_provider}, "
            f"volc.model={request.tts.volc.model}, "
            f"fish.model={request.tts.fish.model}"
        )

    return applied_settings


def apply_module_runtime_settings(request: SettingsRequest) -> Dict[str, Any]:
    """应用独立模块运行时设置（与 Agent 隔离）。"""
    global module_llm_service, module_image_service, module_storyboard_service, module_video_service

    applied_settings = request.model_dump()
    if request.tts:
        # Avoid persisting legacy flat fields (None) into YAML.
        applied_settings["tts"] = request.tts.model_dump(exclude_none=True)

    llm_config = request.llm
    module_llm_service = LLMService(
        provider=llm_config.provider,
        api_key=llm_config.apiKey,
        base_url=llm_config.baseUrl if llm_config.baseUrl else None,
        model=llm_config.model if llm_config.model else None
    )
    print(f"[Settings][Module] LLM 配置更新: provider={llm_config.provider}, model={llm_config.model}")

    img_config = request.image
    local_config = request.local

    if local_config.enabled and img_config.provider in ['comfyui', 'sd-webui']:
        module_image_service = ImageService(
            provider=img_config.provider,
            model=img_config.model if img_config.model else None,
            comfyui_url=local_config.comfyuiUrl,
            sd_webui_url=local_config.sdWebuiUrl
        )
        print(f"[Settings][Module] 图像服务配置更新: 本地模式, provider={img_config.provider}")
    else:
        module_image_service = ImageService(
            provider=img_config.provider,
            api_key=img_config.apiKey,
            base_url=img_config.baseUrl if img_config.baseUrl else None,
            model=img_config.model if img_config.model else None
        )
        print(f"[Settings][Module] 图像服务配置更新: API模式, provider={img_config.provider}, model={img_config.model}")

    if request.storyboard:
        sb_config = request.storyboard
        if local_config.enabled and sb_config.provider in ['comfyui', 'sd-webui']:
            module_storyboard_service = ImageService(
                provider=sb_config.provider,
                model=sb_config.model if sb_config.model else None,
                comfyui_url=local_config.comfyuiUrl,
                sd_webui_url=local_config.sdWebuiUrl
            )
        else:
            module_storyboard_service = ImageService(
                provider=sb_config.provider,
                api_key=sb_config.apiKey,
                base_url=sb_config.baseUrl if sb_config.baseUrl else None,
                model=sb_config.model if sb_config.model else None
            )
        print(f"[Settings][Module] 分镜图像服务配置更新: provider={sb_config.provider}, model={sb_config.model}")

    video_config = request.video
    if video_config.provider and video_config.provider != 'none':
        module_video_service = VideoService(
            provider=video_config.provider,
            api_key=video_config.apiKey,
            base_url=video_config.baseUrl if video_config.baseUrl else None,
            model=video_config.model if video_config.model else None
        )
        print(f"[Settings][Module] 视频服务配置更新: provider={video_config.provider}, model={video_config.model}")
    else:
        module_video_service = None
        print("[Settings][Module] 视频服务未配置")

    if request.tts:
        tts_provider = str(request.tts.provider or "").strip() or "volc_tts_v1_http"
        print(
            "[Settings][Module] TTS 配置已更新: "
            f"provider={tts_provider}, "
            f"volc.model={request.tts.volc.model}, "
            f"fish.model={request.tts.fish.model}"
        )

    return applied_settings


@app.post("/api/settings")
async def update_settings(request: SettingsRequest):
    """更新设置（兼容旧接口，仍写入全局 settings）。"""
    global current_settings
    current_settings = apply_agent_runtime_settings(request)
    storage.save_settings(current_settings)
    return {"status": "ok", "message": "设置已更新"}


@app.post("/api/module/settings")
async def update_module_settings(request: SettingsRequest):
    """更新独立模块设置（与 Agent 设置隔离）。"""
    global module_current_settings
    module_current_settings = apply_module_runtime_settings(request)
    storage.save_module_settings(module_current_settings)
    return {"status": "ok", "message": "模块设置已更新"}


@app.post("/api/test-connection")
async def test_connection(request: TestConnectionRequest):
    """测试配置连通性（不会保存配置）

    说明：不同服务商/协议差异较大，此接口优先做「鉴权探测」(如 /models)，
    若不支持则退化为「基础网络连通性」探测。
    """
    import httpx

    async def probe(url: str, headers: Optional[Dict[str, str]] = None) -> httpx.Response:
        async with httpx.AsyncClient(timeout=8.0, follow_redirects=True) as client:
            return await client.get(url, headers=headers or {})

    category = (request.category or "").strip().lower()
    cfg = request.config

    if category not in {"llm", "image", "storyboard", "video"}:
        raise HTTPException(status_code=400, detail="category must be one of: llm, image, storyboard, video")

    if (cfg.provider or "").startswith("custom_"):
        custom = storage.get_module_custom_provider(cfg.provider) or storage.get_custom_provider(cfg.provider) or {}
        category_aliases = {
            "llm": {"llm"},
            "image": {"image", "storyboard"},
            "storyboard": {"image", "storyboard"},
            "video": {"video"},
        }
        expected = category_aliases.get(category, set())
        if isinstance(custom, dict) and str(custom.get("category") or "") in expected:
            cfg = ModelConfig(
                provider=cfg.provider,
                apiKey=str(custom.get("apiKey") or cfg.apiKey or ""),
                baseUrl=str(custom.get("baseUrl") or cfg.baseUrl or ""),
                model=str(custom.get("model") or cfg.model or "")
            )

    # ========== LLM ==========
    if category == "llm":
        if not cfg.apiKey:
            return {"success": False, "level": "auth", "message": "未填写 API Key"}

        svc = LLMService(
            provider=cfg.provider,
            api_key=cfg.apiKey,
            base_url=cfg.baseUrl if cfg.baseUrl else None,
            model=cfg.model if cfg.model else None,
        )

        if not svc.client:
            return {"success": False, "level": "auth", "message": "LLM 客户端未初始化（API Key 可能为空）"}

        # 优先用 /models 探测（一般不消耗额度）
        try:
            models = await svc.client.models.list()
            count = len(getattr(models, "data", []) or [])
            return {"success": True, "level": "auth", "message": f"连接成功（models 可用：{count}）"}
        except Exception as e_models:
            # 降级：最小 chat 调用（可能消耗少量额度）
            try:
                await svc.client.chat.completions.create(
                    model=svc.model,
                    messages=[{"role": "user", "content": "ping"}],
                    max_tokens=1,
                    temperature=0,
                )
                return {"success": True, "level": "call", "message": "连接成功（chat 调用可用）"}
            except Exception as e_chat:
                return {
                    "success": False,
                    "level": "error",
                    "message": f"连接失败：{e_chat}",
                    "details": {"models_error": str(e_models)},
                }

    # ========== Image / Storyboard ==========
    if category in {"image", "storyboard"}:
        provider = cfg.provider

        if provider == "placeholder":
            return {"success": True, "level": "none", "message": "占位图无需测试"}

        # 本地服务探测（优先使用 local.enabled 的地址）
        local = request.local
        if provider in {"comfyui", "sd-webui"}:
            if local and local.enabled:
                base = (local.comfyuiUrl if provider == "comfyui" else local.sdWebuiUrl) or ""
            else:
                base = cfg.baseUrl or ("http://127.0.0.1:8188" if provider == "comfyui" else "http://127.0.0.1:7860")

            base = base.rstrip("/")

            if provider == "comfyui":
                try:
                    resp = await probe(f"{base}/system_stats")
                    if resp.status_code == 200:
                        return {"success": True, "level": "network", "message": f"连接成功（ComfyUI：{base}）"}
                except Exception:
                    pass

            if provider == "sd-webui":
                try:
                    resp = await probe(f"{base}/sdapi/v1/sd-models")
                    if resp.status_code == 200:
                        return {"success": True, "level": "network", "message": f"连接成功（SD WebUI：{base}）"}
                except Exception:
                    pass

            try:
                resp = await probe(f"{base}/")
                if 200 <= resp.status_code < 500:
                    return {"success": True, "level": "network", "message": f"地址可访问（{base}，HTTP {resp.status_code}）"}
                return {"success": False, "level": "network", "message": f"连接失败（{base}，HTTP {resp.status_code}）"}
            except Exception as e:
                return {"success": False, "level": "network", "message": f"连接失败：{e}"}

        # 远程服务：尽量用 /models 探测鉴权；若不支持则退化到基础连通性
        if not cfg.apiKey:
            return {"success": False, "level": "auth", "message": "未填写 API Key"}

        base_url = (cfg.baseUrl or "").rstrip("/")
        if not base_url:
            return {"success": False, "level": "network", "message": "未填写 Base URL"}

        headers = {"Authorization": f"Bearer {cfg.apiKey}"}
        models_url = f"{base_url}/models"

        try:
            resp = await probe(models_url, headers=headers)
            if resp.status_code == 200:
                return {"success": True, "level": "auth", "message": "连接成功（/models 可用）"}
            if resp.status_code in (401, 403):
                return {"success": False, "level": "auth", "message": f"鉴权失败（HTTP {resp.status_code}）"}
            if resp.status_code == 404:
                ping = await probe(f"{base_url}/", headers=headers)
                if ping.status_code in (401, 403):
                    return {"success": False, "level": "auth", "message": f"鉴权失败（HTTP {ping.status_code}）"}
                if 200 <= ping.status_code < 500:
                    return {"success": True, "level": "network", "message": f"地址可访问（不支持 /models 探测，HTTP {ping.status_code}）"}
                return {"success": False, "level": "network", "message": f"连接失败（HTTP {ping.status_code}）"}

            return {"success": True, "level": "network", "message": f"地址可访问（HTTP {resp.status_code}）"}
        except Exception as e:
            return {"success": False, "level": "network", "message": f"连接失败：{e}"}

    # ========== Video ==========
    if category == "video":
        provider = cfg.provider

        if provider == "none":
            return {"success": True, "level": "none", "message": "未配置视频服务，无需测试"}

        if not cfg.apiKey:
            return {"success": False, "level": "auth", "message": "未填写 API Key"}

        base_url = (cfg.baseUrl or "").rstrip("/")
        if not base_url:
            return {"success": False, "level": "network", "message": "未填写 Base URL"}

        headers = {"Authorization": f"Bearer {cfg.apiKey}"}
        try:
            # 优先用 /models 探测（对 OpenAI/Ark 兼容接口更准确）
            try:
                resp = await probe(f"{base_url}/models", headers=headers)
                if resp.status_code == 200:
                    try:
                        payload = resp.json()
                        model_ids = [
                            (m or {}).get("id")
                            for m in (payload.get("data") if isinstance(payload, dict) else []) or []
                            if isinstance(m, dict)
                        ]
                        model_ids = [mid for mid in model_ids if isinstance(mid, str) and mid.strip()]
                        selected = (cfg.model or "").strip()
                        if selected and selected not in set(model_ids):
                            # Ark(OpenAI兼容)常见需要填写 /models 返回的 id（不少场景是 ep-xxx）
                            return {
                                "success": True,
                                "level": "auth",
                                "message": f"连接成功（/models 可用），但未找到模型：{selected}（请填写 /models 返回的 id，常见为 ep-xxx）",
                                "details": {"modelFound": False, "modelsSample": model_ids[:20]},
                            }
                        return {
                            "success": True,
                            "level": "auth",
                            "message": "连接成功（/models 可用）" + ("，模型已匹配" if selected else ""),
                            "details": {"modelFound": bool(selected), "modelsSample": model_ids[:20]},
                        }
                    except Exception:
                        return {"success": True, "level": "auth", "message": "连接成功（/models 可用）"}
                if resp.status_code in (401, 403):
                    return {"success": False, "level": "auth", "message": f"鉴权失败（HTTP {resp.status_code}）"}
                # 其他状态继续尝试根路径探测
            except Exception:
                pass

            resp = await probe(f"{base_url}/", headers=headers)
            if resp.status_code in (401, 403):
                return {"success": False, "level": "auth", "message": f"鉴权失败（HTTP {resp.status_code}）"}
            if resp.status_code == 404:
                return {
                    "success": True,
                    "level": "network",
                    "message": f"主机可达，但该路径返回 404（请确认 Base URL 是否为 API 根，如 .../v1 或 .../api/v3）"
                }
            if 200 <= resp.status_code < 500:
                return {"success": True, "level": "network", "message": f"地址可访问（HTTP {resp.status_code}）"}
            return {"success": False, "level": "network", "message": f"连接失败（HTTP {resp.status_code}）"}
        except Exception as e:
            return {"success": False, "level": "network", "message": f"连接失败：{e}"}

    raise HTTPException(status_code=500, detail="unreachable")


@app.get("/api/settings")
async def get_settings():
    """获取已保存的设置"""
    saved = storage.get_settings()
    if saved:
        try:
            saved["tts"] = TTSConfig.model_validate(saved.get("tts") or {}).model_dump(exclude_none=True)
        except Exception:
            # keep legacy shape if parsing fails
            pass
        return saved
    return {"status": "not_configured"}


@app.get("/api/module/settings")
async def get_module_settings():
    """获取独立模块设置（优先 module settings，缺失时回退旧 settings）。"""
    saved = storage.get_module_settings() or storage.get_settings()
    if saved:
        try:
            saved["tts"] = TTSConfig.model_validate(saved.get("tts") or {}).model_dump(exclude_none=True)
        except Exception:
            pass
        return saved
    return {"status": "not_configured"}


@app.post("/api/tts/test")
async def test_tts(request: TestTTSRequest):
    """测试 TTS 连通性（最小合成）"""
    cfg = request.tts
    provider = str(getattr(cfg, "provider", "") or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
    text = (request.text or "测试语音合成").strip()

    if provider.startswith("fish"):
        fish_cfg = cfg.fish
        voice_type = (
            request.voiceType
            or fish_cfg.narratorVoiceType
            or fish_cfg.dialogueMaleVoiceType
            or fish_cfg.dialogueFemaleVoiceType
            or fish_cfg.dialogueVoiceType
            or ""
        ).strip()

        api_key = str(fish_cfg.apiKey or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="缺少 Fish API Key：请在设置中填写 Fish.apiKey")
        if not voice_type:
            raise HTTPException(status_code=400, detail="缺少 Fish reference_id：请填写默认旁白/对白 voice_type（用 Fish 的 voice model id）")

        base_url = str(fish_cfg.baseUrl or "").strip() or "https://api.fish.audio"
        model_hdr = str(fish_cfg.model or "").strip()
        # 避免沿用火山的默认 model（seed-tts-1.1）导致 Fish header 异常
        if not model_hdr or model_hdr.startswith("seed-"):
            model_hdr = "speech-1.5"

        tts = FishTTSService(FishTTSConfig(api_key=api_key, base_url=base_url, model=model_hdr))
        try:
            out_fmt = str(fish_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text,
                reference_id=voice_type,
                encoding=out_fmt,
                speed_ratio=float(fish_cfg.speedRatio or 1.0),
                rate=int(fish_cfg.rate or 24000),
            )
            duration_ms = 0
            if out_fmt == "pcm":
                # 16-bit mono @ sample_rate
                duration_ms = int((len(audio_bytes) // 2) * 1000 / int(fish_cfg.rate or 24000))
            return {"success": True, "message": "连接成功", "duration_ms": int(duration_ms or 0)}
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            msg = str(e)
            if msg.startswith("TTS HTTP 403:"):
                raise HTTPException(status_code=403, detail=f"TTS 鉴权/权限失败：{msg}")
            if msg.startswith("TTS HTTP 401:"):
                raise HTTPException(status_code=401, detail=f"TTS 鉴权失败：{msg}")
            raise HTTPException(status_code=500, detail=f"TTS 测试失败: {msg}")

    if provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}:
        bailian_cfg = cfg.bailian
        voice_type = (
            request.voiceType
            or bailian_cfg.narratorVoiceType
            or bailian_cfg.dialogueMaleVoiceType
            or bailian_cfg.dialogueFemaleVoiceType
            or bailian_cfg.dialogueVoiceType
            or ""
        ).strip()

        api_key = str(bailian_cfg.apiKey or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="缺少阿里百炼 API Key：请在设置中填写 Bailian.apiKey")
        if not voice_type:
            raise HTTPException(status_code=400, detail="缺少音色/voice：请填写默认旁白/对白 voice（阿里百炼 voice 名称）")

        tts = DashScopeTTSService(
            DashScopeTTSConfig(
                api_key=api_key,
                base_url=str(bailian_cfg.baseUrl or "").strip() or "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                model=str(bailian_cfg.model or "").strip() or "cosyvoice-v1",
                workspace=str(bailian_cfg.workspace or "").strip(),
            )
        )
        try:
            out_fmt = str(bailian_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text,
                voice=voice_type,
                encoding=out_fmt,
                speed_ratio=float(bailian_cfg.speedRatio or 1.0),
                rate=int(bailian_cfg.rate or 24000),
            )
            duration_ms = 0
            if out_fmt == "pcm":
                duration_ms = int((len(audio_bytes) // 2) * 1000 / int(bailian_cfg.rate or 24000))
            return {"success": True, "message": "连接成功", "duration_ms": int(duration_ms or 0)}
        except Exception as e:
            msg = str(e)
            if msg.startswith("TTS HTTP 403:"):
                raise HTTPException(status_code=403, detail=f"TTS 鉴权/权限失败：{msg}")
            if msg.startswith("TTS HTTP 401:"):
                raise HTTPException(status_code=401, detail=f"TTS 鉴权失败：{msg}")
            raise HTTPException(status_code=500, detail=f"TTS 测试失败: {msg}")

    if provider.startswith("custom_"):
        custom_provider = storage.get_module_custom_provider(provider) or storage.get_custom_provider(provider) or {}
        if not custom_provider or str(custom_provider.get("category") or "") != "tts":
            raise HTTPException(status_code=400, detail="自定义 TTS 配置不存在或类别不匹配（请先在设置里新增 tts 自定义配置）")

        custom_cfg = cfg.custom
        voice_type = (
            request.voiceType
            or custom_cfg.narratorVoiceType
            or custom_cfg.dialogueMaleVoiceType
            or custom_cfg.dialogueFemaleVoiceType
            or custom_cfg.dialogueVoiceType
            or ""
        ).strip()
        if not voice_type:
            raise HTTPException(status_code=400, detail="缺少 voice：请填写默认旁白/对白 voice（自定义 TTS 使用）")

        api_key = str(custom_provider.get("apiKey") or "").strip()
        base_url = str(custom_provider.get("baseUrl") or "").strip()
        model = str(custom_provider.get("model") or "").strip()
        if not api_key:
            raise HTTPException(status_code=400, detail="自定义 TTS 缺少 apiKey")
        if not base_url:
            raise HTTPException(status_code=400, detail="自定义 TTS 缺少 baseUrl")

        tts = OpenAITTSService(OpenAITTSConfig(api_key=api_key, base_url=base_url, model=model))
        try:
            out_fmt = str(custom_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text,
                voice=voice_type,
                encoding=out_fmt,
                speed_ratio=float(custom_cfg.speedRatio or 1.0),
            )
            return {"success": True, "message": "连接成功", "duration_ms": 0}
        except Exception as e:
            msg = str(e)
            if msg.startswith("TTS HTTP 403:"):
                raise HTTPException(status_code=403, detail=f"TTS 鉴权/权限失败：{msg}")
            if msg.startswith("TTS HTTP 401:"):
                raise HTTPException(status_code=401, detail=f"TTS 鉴权失败：{msg}")
            raise HTTPException(status_code=500, detail=f"TTS 测试失败: {msg}")

    # 默认：火山 OpenSpeech
    volc_cfg = cfg.volc
    voice_type = (
        request.voiceType
        or volc_cfg.narratorVoiceType
        or volc_cfg.dialogueMaleVoiceType
        or volc_cfg.dialogueFemaleVoiceType
        or volc_cfg.dialogueVoiceType
        or ""
    ).strip()

    appid = str(volc_cfg.appid or "").strip()
    access_token = str(volc_cfg.accessToken or "").strip()
    if not appid or not access_token:
        raise HTTPException(status_code=400, detail="缺少 appid/accessToken")

    if not voice_type:
        voice_type = VolcTTSService.auto_pick_voice_type(role="narration", name="narrator")

    tts = VolcTTSService(
        VolcTTSConfig(
            appid=appid,
            access_token=access_token,
            cluster=str(volc_cfg.cluster or "volcano_tts").strip() or "volcano_tts",
            model=str(volc_cfg.model or "seed-tts-1.1").strip() or "seed-tts-1.1",
            endpoint=str(volc_cfg.endpoint or "").strip() or "https://openspeech.bytedance.com/api/v1/tts",
        )
    )

    try:
        _, duration_ms = await tts.synthesize(
            text=text,
            voice_type=voice_type,
            encoding=str(volc_cfg.encoding or "mp3").strip() or "mp3",
            speed_ratio=float(volc_cfg.speedRatio or 1.0),
            rate=int(volc_cfg.rate or 24000),
        )
        return {"success": True, "message": "连接成功", "duration_ms": int(duration_ms or 0)}
    except Exception as e:
        msg = str(e)
        if msg.startswith("TTS HTTP 403:"):
            raise HTTPException(status_code=403, detail=f"TTS 鉴权/权限失败：{msg}")
        if msg.startswith("TTS HTTP 401:"):
            raise HTTPException(status_code=401, detail=f"TTS 鉴权失败：{msg}")
        raise HTTPException(status_code=500, detail=f"TTS 测试失败: {msg}")


def _get_fish_service_from_settings() -> FishAudioService:
    settings = storage.get_module_settings() or storage.get_settings() or {}
    cfg = TTSConfig.model_validate(settings.get("tts") or {})
    fish_cfg = cfg.fish
    api_key = str(fish_cfg.apiKey or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 Fish API Key：请在设置中填写 Fish.apiKey")

    base_url = str(fish_cfg.baseUrl or "").strip() or "https://api.fish.audio"
    return FishAudioService(FishAudioConfig(api_key=api_key, base_url=base_url))


@app.get("/api/fish/models")
async def fish_list_models(
    page_size: int = 10,
    page_number: int = 1,
    title: Optional[str] = None,
    tag: Optional[str] = None,
    self_only: bool = True,
    sort_by: str = "task_count",
    model_type: str = "tts",
):
    """列出 Fish Audio 的 voice models（默认仅返回 tts 类型）。"""
    fish = _get_fish_service_from_settings()
    try:
        return await fish.list_models(
            page_size=page_size,
            page_number=page_number,
            title=title,
            tag=tag,
            self_only=self_only,
            sort_by=sort_by,
            model_type=model_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish list models failed: {e}")


@app.get("/api/fish/models/{model_id}")
async def fish_get_model(model_id: str):
    fish = _get_fish_service_from_settings()
    try:
        return await fish.get_model(model_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish get model failed: {e}")


@app.delete("/api/fish/models/{model_id}")
async def fish_delete_model(model_id: str):
    fish = _get_fish_service_from_settings()
    try:
        await fish.delete_model(model_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish delete model failed: {e}")


@app.post("/api/fish/models")
async def fish_create_model(
    title: str = Form(...),
    description: Optional[str] = Form(None),
    visibility: str = Form("private"),
    train_mode: str = Form("fast"),
    enhance_audio_quality: bool = Form(True),
    tags: Optional[str] = Form(None),
    voices: List[UploadFile] = File(...),
    cover_image: Optional[UploadFile] = File(None),
):
    """创建 Fish Audio voice clone model（type=tts）。"""
    fish = _get_fish_service_from_settings()

    tag_list: Optional[List[str]] = None
    if isinstance(tags, str) and tags.strip():
        tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    voice_files: List[tuple[str, bytes, str]] = []
    for vf in voices:
        content = await vf.read()
        filename = vf.filename or "voice.wav"
        content_type = vf.content_type or "application/octet-stream"
        voice_files.append((filename, content, content_type))

    cover_tuple: Optional[tuple[str, bytes, str]] = None
    if cover_image is not None:
        cover_bytes = await cover_image.read()
        cover_tuple = (
            cover_image.filename or "cover.png",
            cover_bytes,
            cover_image.content_type or "application/octet-stream",
        )

    try:
        return await fish.create_tts_model(
            title=title,
            voices=voice_files,
            description=description,
            visibility=visibility,
            train_mode=train_mode,
            tags=tag_list,
            enhance_audio_quality=bool(enhance_audio_quality),
            cover_image=cover_tuple,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish create model failed: {e}")


@app.post("/api/parse-story")
async def parse_story(request: ParseStoryRequest):
    service = get_request_llm_service(request.llm)
    prompts = await service.parse_story(
        story_text=request.storyText,
        count=request.count,
        style=request.style
    )
    return {"prompts": prompts}


@app.post("/api/generate")
async def generate_storyboards(request: GenerateRequest):
    llm = get_request_llm_service(request.llm)
    img = get_request_image_service(request.storyboard, request.local, mode="storyboard")
    
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
    img = get_request_image_service(request.storyboard, request.local, mode="storyboard")
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
    service = get_request_llm_service(request.llm)
    
    try:
        reply = await service.chat(
            message=request.message,
            context=request.context
        )
        return {"reply": reply}
    except Exception as e:
        print(f"对话失败: {e}")
        return {"reply": f"抱歉，出现错误: {str(e)}"}


@app.post("/api/bridge/generate-text")
async def bridge_generate_text(request: BridgeGenerateTextRequest):
    """提供给 demo 的通用文本生成 bridge（使用独立模块 llm 配置）。"""
    service = get_llm_service()

    try:
        text = await service.generate_text(
            prompt=request.prompt,
            system_prompt=request.systemPrompt or "",
            temperature=request.temperature if request.temperature is not None else 0.7,
            max_tokens=request.maxTokens,
            model=request.model,
            top_p=request.topP,
        )
        return {"text": text}
    except Exception as e:
        print(f"[Bridge] text generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"text generation failed: {e}")


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
async def upload_file(request: Request, file: UploadFile = File(...)):
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
    absolute_url = f"{str(request.base_url).rstrip('/')}{file_url}"
    
    # 对于图片，也返回 base64 预览
    preview_url = None
    if category == 'image':
        base64_data = base64.b64encode(content).decode("utf-8")
        preview_url = f"data:{content_type};base64,{base64_data}"
    
    # 对于文本文件，返回内容（尽量解码）
    text_content = None
    if category in ['code', 'document'] and file_size < 1024 * 1024 and ext not in ['.pdf', '.docx']:  # 小于 1MB 的文本文件
        try:
            import codecs

            if content.startswith(codecs.BOM_UTF8):
                text_content = content.decode('utf-8-sig')
            elif content.startswith(codecs.BOM_UTF16_LE) or content.startswith(codecs.BOM_UTF16_BE):
                text_content = content.decode('utf-16')
            else:
                try:
                    text_content = content.decode('utf-8')
                except UnicodeDecodeError:
                    sample = content[:4096]
                    if sample and sample.count(b'\x00') / len(sample) > 0.2:
                        try:
                            text_content = content.decode('utf-16-le')
                        except UnicodeDecodeError:
                            try:
                                text_content = content.decode('utf-16-be')
                            except UnicodeDecodeError:
                                text_content = None

                    if text_content is None:
                        try:
                            text_content = content.decode('gb18030')
                        except UnicodeDecodeError:
                            try:
                                text_content = content.decode('gbk')
                            except UnicodeDecodeError:
                                text_content = content.decode('utf-8', errors='replace')
        except Exception:
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
            "absoluteUrl": absolute_url,
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
    projectId: Optional[str] = None
    scope: str = "module"  # module | agent
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
    module_scope = (request.scope or "module") != "agent"
    service = get_request_image_service(request.image, request.local, mode="image", module_scope=module_scope)
    
    # 处理风格预设
    final_prompt = request.prompt
    if request.style and request.style in STYLE_PRESETS:
        final_prompt = f"{request.prompt}, {STYLE_PRESETS[request.style]}"
    
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
        
        # 保存到历史记录
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
        if _is_model_access_error(error_msg):
            guidance = (
                "当前图像模型不可用或无权限。"
                "如果你使用火山方舟/豆包，请在设置里填写 /models 返回的 endpoint id（通常是 ep-xxx），"
                "不要填展示名。"
            )
            raise HTTPException(status_code=500, detail=f"图像生成失败: {guidance}")
        raise HTTPException(status_code=500, detail=f"图像生成失败: {error_msg}")


def get_video_service() -> VideoService:
    """Agent 运行时视频服务（全局 settings）。"""
    global video_service
    if video_service is None:
        video_service = VideoService(provider="none")
    return video_service


def get_module_video_service() -> VideoService:
    """独立模块运行时视频服务（module settings）。"""
    global module_video_service
    if module_video_service is None:
        module_video_service = VideoService(provider="none")
    return module_video_service


def get_request_video_service(override: Optional[ModelConfig] = None, module_scope: bool = True) -> VideoService:
    fallback = get_module_video_service() if module_scope else get_video_service()
    if override is None:
        return fallback

    provider, api_key, base_url, model = resolve_request_model_config(
        override, expected_categories={"video"}, module_scope=module_scope
    )
    if not provider or provider == "none":
        return VideoService(provider="none", model=model)
    if not api_key:
        return fallback

    return VideoService(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model
    )


@app.post("/api/generate-video")
async def generate_video(request: VideoRequest):
    """生成视频（从图片）"""
    module_scope = (request.scope or "module") != "agent"
    service = get_request_video_service(request.video, module_scope=module_scope)
    
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
        
        # 保存到历史记录
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
            video_task_services[task_id] = service
        
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


@app.post("/api/video-task-status")
async def check_video_task_status(request: VideoTaskStatusRequest):
    """检查视频生成任务状态"""
    service = video_task_services.get(request.taskId) or get_module_video_service()
    
    try:
        result = await service.check_task_status(request.taskId)
        
        # 如果完成了，更新历史记录
        if result.get("status") == "completed" and result.get("video_url"):
            storage.update_video_status(
                request.taskId,
                "completed",
                result.get("video_url")
            )
            video_task_services.pop(request.taskId, None)
        elif result.get("status") == "error":
            video_task_services.pop(request.taskId, None)
        
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
async def get_video_history(limit: int = 50, project_id: Optional[str] = None):
    """获取视频生成历史"""
    videos = storage.list_generated_videos(limit, project_id=project_id)
    return {"videos": videos}


@app.get("/api/agent/videos/history")
async def get_agent_video_history(limit: int = 50, project_id: Optional[str] = None):
    """获取 Agent 视频历史（用于独立模块分区展示）。"""
    videos = storage.list_agent_generated_videos(limit, project_id=project_id)
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
async def get_image_history(limit: int = 100, project_id: Optional[str] = None):
    """获取图像生成历史"""
    images = storage.list_generated_images(limit, project_id=project_id)
    return {"images": images}


@app.get("/api/agent/images/history")
async def get_agent_image_history(limit: int = 100, project_id: Optional[str] = None):
    """获取 Agent 图片历史（用于独立模块分区展示）。"""
    images = storage.list_agent_generated_images(limit, project_id=project_id)
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
async def list_chat_sessions(limit: int = 50, module: Optional[str] = None):
    """获取所有对话会话列表"""
    sessions = storage.list_chat_sessions(limit, module=module)
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


def _validate_custom_provider_category(category: str):
    if category not in ['llm', 'image', 'storyboard', 'video', 'tts']:
        raise HTTPException(status_code=400, detail="无效的类别，必须是 llm/image/storyboard/video/tts")


@app.get("/api/module/custom-providers")
async def list_module_custom_providers(category: Optional[str] = None):
    """获取独立模块自定义配置预设列表。"""
    providers = storage.list_module_custom_providers(category)
    return {"providers": providers}


@app.post("/api/module/custom-providers")
async def add_module_custom_provider(request: CustomProviderRequest):
    """添加独立模块自定义配置预设（与 Agent 隔离）。"""
    _validate_custom_provider_category(request.category)

    config = {
        "apiKey": request.apiKey,
        "baseUrl": request.baseUrl,
        "model": request.model,
        "models": request.models
    }

    provider = storage.add_module_custom_provider(request.name, request.category, config)
    return provider


@app.get("/api/module/custom-providers/{provider_id}")
async def get_module_custom_provider(provider_id: str):
    """获取单个独立模块自定义配置预设。"""
    provider = storage.get_module_custom_provider(provider_id)
    if not provider:
        raise HTTPException(status_code=404, detail="配置预设不存在")
    return provider


@app.put("/api/module/custom-providers/{provider_id}")
async def update_module_custom_provider(provider_id: str, request: UpdateCustomProviderRequest):
    """更新独立模块自定义配置预设。"""
    updates = request.model_dump(exclude_none=True)
    provider = storage.update_module_custom_provider(provider_id, updates)
    if not provider:
        raise HTTPException(status_code=404, detail="配置预设不存在")
    return provider


@app.delete("/api/module/custom-providers/{provider_id}")
async def delete_module_custom_provider(provider_id: str):
    """删除独立模块自定义配置预设。"""
    success = storage.delete_module_custom_provider(provider_id)
    if not success:
        raise HTTPException(status_code=404, detail="配置预设不存在")
    return {"status": "ok"}


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
    _validate_custom_provider_category(request.category)
    
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


class AgentScriptDoctorRequest(BaseModel):
    mode: str = "expand"  # light / expand
    apply: bool = True


class AgentAssetCompletionRequest(BaseModel):
    apply: bool = True


class AgentRefineSplitVisualsRequest(BaseModel):
    parentShotId: str


class AgentAudioCheckRequest(BaseModel):
    includeNarration: bool = True
    includeDialogue: bool = True
    speed: float = 1.0
    apply: bool = False


class AgentOperatorApplyRequest(BaseModel):
    kind: str = Field(default="actions", description="actions | patch")
    payload: Any
    executeRegenerate: bool = True


def get_agent_service() -> AgentService:
    """获取 Agent 服务"""
    global agent_service
    if agent_service is None:
        agent_service = AgentService(storage)
    return agent_service


def _extract_dialogue_text(dialogue_script: str) -> str:
    """Extract pure utterances from '角色: 台词' lines."""
    if not isinstance(dialogue_script, str) or not dialogue_script.strip():
        return ""
    lines = [ln.strip() for ln in dialogue_script.splitlines() if ln.strip()]
    utterances: List[str] = []
    for ln in lines:
        if "：" in ln:
            _, tail = ln.split("：", 1)
            utterances.append(tail.strip())
        elif ":" in ln:
            _, tail = ln.split(":", 1)
            utterances.append(tail.strip())
        else:
            utterances.append(ln)
    return " ".join([u for u in utterances if u])


def _sanitize_tts_text(text: Any) -> str:
    """Remove common non-speech metadata from text before sending to TTS."""
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if not s:
        return ""

    # Remove known element annotations like "(character)" / "(object)" / "(scene)" (including full-width parens).
    s = re.sub(r"[（(]\s*(?:character|object|scene|location|prop|bg|setting)\s*[)）]", "", s, flags=re.IGNORECASE)

    # Remove stable id markers that often leak into speech.
    s = re.sub(r"\[Element_[A-Za-z0-9_\-]+\]", "", s)
    s = re.sub(r"\bElement_[A-Za-z0-9_\-]+\b", "", s)
    s = re.sub(r"\b(?:shot|segment|character|object|scene)_[A-Za-z0-9_\-]+\b", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:id|ID)\s*[:=：]\s*[A-Za-z0-9_\-]{2,}\b", "", s)

    # Remove bracketed metadata blocks like "[id: xxx]" / "【id: xxx】".
    s = re.sub(
        r"[【\[]\s*(?:id|ID|shot_id|shotId|element|Element|character|object|scene)\s*[:=：][^】\]]{0,60}[】\]]",
        "",
        s,
    )

    # Normalize whitespace.
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _is_speakable_text(text: Any) -> bool:
    """Return True if the text likely contains pronounceable content.

    Some TTS providers reject inputs that are only punctuation/whitespace (e.g. "。").
    """
    if not isinstance(text, str):
        return False
    s = re.sub(r"\s+", "", text).strip()
    if not s:
        return False
    return bool(re.search(r"[\u4e00-\u9fffA-Za-z0-9]", s))


def _sanitize_speaker_name(name: Any) -> str:
    if not isinstance(name, str):
        return ""
    s = name.strip()
    if not s:
        return ""
    # Strip common trailing labels.
    s = re.sub(r"\s*[（(]\s*(?:character|object|scene)\s*[)）]\s*$", "", s, flags=re.IGNORECASE).strip()
    # Strip trailing bracketed ids.
    s = re.sub(r"\s*[【\[]\s*(?:id|ID)\s*[:=：][^】\]]{0,60}[】\]]\s*$", "", s).strip()
    s = re.sub(r"\s*\b(?:id|ID)\s*[:=：]\s*[A-Za-z0-9_\-]{2,}\s*$", "", s).strip()
    return s


def _parse_duration_seconds(text: Any) -> Optional[float]:
    """Parse a duration string to seconds (used for audio-driven speed fitting)."""
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s:
        return None
    raw = s
    s = s.strip().lower()

    # timecode: mm:ss or hh:mm:ss
    m = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)", s)
    if m:
        a = int(m.group(1))
        b = int(m.group(2))
        c = int(m.group(3)) if m.group(3) else None
        if c is None:
            return float(a * 60 + b)
        return float(a * 3600 + b * 60 + c)

    # Chinese: 1分30秒 / 1分钟 / 90秒
    m2 = re.search(r"(\d+(?:\.\d+)?)\s*分(?:钟)?\s*(\d+(?:\.\d+)?)\s*秒?", raw)
    if m2:
        try:
            return float(m2.group(1)) * 60.0 + float(m2.group(2))
        except Exception:
            return None

    mh = re.search(r"(\d+(?:\.\d+)?)\s*(?:小时|h|hour|hours)\b", s)
    mmn = re.search(r"(\d+(?:\.\d+)?)\s*(?:分钟|min|minute|minutes|m)\b", s)
    ms = re.search(r"(\d+(?:\.\d+)?)\s*(?:秒|s|sec|second|seconds)\b", s)

    try:
        hours = float(mh.group(1)) if mh else 0.0
        minutes = float(mmn.group(1)) if mmn else 0.0
        seconds = float(ms.group(1)) if ms else 0.0
    except Exception:
        return None

    if hours or minutes or seconds:
        return hours * 3600.0 + minutes * 60.0 + seconds
    return None


def _estimate_speech_seconds(text: str, speed: float = 1.0) -> float:
    """Heuristic duration estimate for TTS/voiceover (seconds)."""
    if not isinstance(text, str):
        return 0.0
    s = re.sub(r"\s+", " ", text).strip()
    if not s:
        return 0.0

    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    words = len(re.findall(r"[A-Za-z0-9']+", s))

    # Calibrated for typical TTS listening speed (includes usual punctuation pauses).
    cps = 3.75  # Chinese chars/sec
    wps = 2.7  # English words/sec

    base = (cjk / cps) if cjk >= max(8, words * 2) else (words / wps if words else (len(s) / 10.0))
    # Do not add generic punctuation pauses here; cps already reflects perceived speed.
    # Only keep a light penalty for long pause marks to avoid underestimation.
    pauses = s.count("…") * 0.12 + s.count("—") * 0.08
    lead = 0.0

    spd = speed if isinstance(speed, (int, float)) and speed > 0 else 1.0
    return max(0.0, (base + pauses + lead) / spd)


def _is_probably_expired_signed_url(url: Any) -> bool:
    if not isinstance(url, str) or not url.startswith("http"):
        return False
    try:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query or "")

        if "X-Tos-Date" in qs and "X-Tos-Expires" in qs:
            dt_raw = (qs.get("X-Tos-Date") or [""])[0]
            exp_raw = (qs.get("X-Tos-Expires") or ["0"])[0]
            if dt_raw and exp_raw:
                start = datetime.strptime(dt_raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                expires = int(exp_raw)
                return datetime.now(timezone.utc) > start + timedelta(seconds=max(0, expires - 30))

        if "X-Amz-Date" in qs and "X-Amz-Expires" in qs:
            dt_raw = (qs.get("X-Amz-Date") or [""])[0]
            exp_raw = (qs.get("X-Amz-Expires") or ["0"])[0]
            if dt_raw and exp_raw:
                start = datetime.strptime(dt_raw, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)
                expires = int(exp_raw)
                return datetime.now(timezone.utc) > start + timedelta(seconds=max(0, expires - 30))
    except Exception:
        return False
    return False


def _sanitize_expired_agent_media_urls(project: Dict[str, Any]) -> Dict[str, Any]:
    """Annotate obviously expired signed URLs for frontend.

    Keep history records for user visibility, but mark expired ones so UI can avoid
    trying to load them directly.
    """
    if not isinstance(project, dict):
        return project

    elements = project.get("elements") or {}
    if isinstance(elements, dict):
        for _, e in elements.items():
            if not isinstance(e, dict):
                continue
            img_url = e.get("image_url")
            e["image_url_expired"] = _is_probably_expired_signed_url(img_url)
            hist = e.get("image_history") or []
            if isinstance(hist, list):
                for img in hist:
                    if not isinstance(img, dict):
                        continue
                    img["expired"] = _is_probably_expired_signed_url(img.get("url"))
                    if "source_url" in img:
                        img["source_expired"] = _is_probably_expired_signed_url(img.get("source_url"))

    segments = project.get("segments") or []
    if isinstance(segments, list):
        for seg in segments:
            if not isinstance(seg, dict):
                continue
            for shot in (seg.get("shots") or []):
                if not isinstance(shot, dict):
                    continue
                start_url = shot.get("start_image_url")
                shot["start_image_url_expired"] = _is_probably_expired_signed_url(start_url)
                hist = shot.get("start_image_history") or []
                if isinstance(hist, list):
                    for img in hist:
                        if not isinstance(img, dict):
                            continue
                        img["expired"] = _is_probably_expired_signed_url(img.get("url"))
                        if "source_url" in img:
                            img["source_expired"] = _is_probably_expired_signed_url(img.get("source_url"))

    return project


@app.get("/api/agent/prompts")
async def get_agent_prompts(includeContent: bool = False):
    """查看后端当前启用的 system prompts 摘要（调试用）。

    默认只返回摘要与哈希；需要全文时传 includeContent=true。
    """
    service = get_agent_service()
    return service.get_prompts_debug(include_content=includeContent)


@app.post("/api/agent/chat")
async def agent_chat(request: AgentChatRequest):
    """Agent 对话接口"""
    service = get_agent_service()
    
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
    return _sanitize_expired_agent_media_urls(project)


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


@app.post("/api/agent/projects/{project_id}/operator/apply")
async def apply_agent_operator(project_id: str, request: AgentOperatorApplyRequest):
    """Apply confirmed LLM edits (actions/patch) via backend operator."""
    service = get_agent_service()
    project = storage.get_agent_project(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="项目不存在")

    executor = get_agent_executor() if request.executeRegenerate else None
    result = await service.apply_operator(project, request.kind, request.payload, executor=executor)
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=result.get("error", "Apply failed"))
    return result


@app.post("/api/agent/projects/{project_id}/script-doctor")
async def script_doctor_project(project_id: str, request: AgentScriptDoctorRequest):
    """剧本增强：补齐 hook/高潮，提升逻辑与细节（不破坏现有 ID）。"""
    service = get_agent_service()
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


@app.post("/api/agent/projects/{project_id}/complete-assets")
async def complete_assets_project(project_id: str, request: AgentAssetCompletionRequest):
    """资产补全：从分镜提取缺失的场景/道具元素，并可选补丁镜头 prompt。"""
    service = get_agent_service()
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


@app.post("/api/agent/projects/{project_id}/refine-split-visuals")
async def refine_split_visuals_project(project_id: str, request: AgentRefineSplitVisualsRequest):
    """一键精修“拆分镜头组”的画面提示词（LLM）：仅更新 description/prompt/video_prompt，不改 shot id。"""
    service = get_agent_service()
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


@app.post("/api/agent/projects/{project_id}/audio-check")
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
                    parts.append(_extract_dialogue_text(dialogue_script))
                text = " ".join([p for p in parts if p])
                est = _estimate_speech_seconds(text, speed=speed)

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
import time
from datetime import datetime


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


@app.get("/api/agent/projects/{project_id}/generate-frames-stream")
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
    executor = get_agent_executor()

    async def event_generator():
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


@app.post("/api/agent/projects/{project_id}/generate-audio")
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
            workflow = get_agent_executor().resolve_audio_workflow(project)
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
        target_seconds = _parse_duration_seconds(brief.get("duration")) if isinstance(brief.get("duration"), str) else None

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
                        parts.append(_sanitize_tts_text(narration.strip()))
                    if include_dialogue and isinstance(dialogue_script, str) and dialogue_script.strip():
                        parts.append(_sanitize_tts_text(_extract_dialogue_text(dialogue_script)))
        text = " ".join([p for p in parts if p]).strip()
        est = _estimate_speech_seconds(text, speed=1.0) if text else 0.0
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
            narration = _sanitize_tts_text(narration)

            dialogue_script = shot.get("dialogue_script") or shot.get("dialogueScript") or shot.get("dialogue")
            dialogue_script = dialogue_script if isinstance(dialogue_script, str) else ""
            dialogue_script = dialogue_script.strip()

            segments_to_say: List[Dict[str, str]] = []

            if include_narration and narration and _is_speakable_text(narration):
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
                        spoken = _sanitize_tts_text(line)
                        if spoken and _is_speakable_text(spoken):
                            segments_to_say.append({"role": "dialogue", "voice_type": fallback_voice, "text": spoken})
                        continue

                    speaker = _sanitize_speaker_name(m.group(1).strip())
                    speaker = speaker.strip(" \t【】[]（）()")
                    content = _sanitize_tts_text(m.group(2))
                    if not content or not _is_speakable_text(content):
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


@app.post("/api/agent/projects/{project_id}/clear-audio")
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


@app.get("/api/agent/projects/{project_id}/audio-timeline")
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
    executor = get_agent_executor()
    draft = executor.build_audio_timeline_from_project(project)
    return {"success": True, "audio_timeline": draft}


@app.post("/api/agent/projects/{project_id}/audio-timeline")
async def save_project_audio_timeline(project_id: str, request: SaveAudioTimelineRequest):
    """保存项目 audio_timeline，并可选将 duration 写回 shots（不允许改变镜头数量）。"""
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    if not isinstance(request.audioTimeline, dict):
        raise HTTPException(status_code=400, detail="audioTimeline must be an object")

    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()

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


@app.post("/api/agent/projects/{project_id}/audio-timeline/master-audio")
async def generate_audio_timeline_master_audio(project_id: str, request: AudioTimelineMasterAudioRequest):
    """生成音频工作台预览用的 master 音轨（按当前 duration 拼接并补齐静默）。"""
    import subprocess
    from pathlib import Path

    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()

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


@app.post("/api/agent/projects/{project_id}/audio/extract-from-videos")
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
    executor = get_agent_executor()

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


@app.get("/api/agent/projects/{project_id}/generate-videos-stream")
async def generate_project_videos_stream(project_id: str, resolution: str = "720p"):
    """流式生成项目的所有视频 (SSE)

    每提交一个视频任务就推送进度，然后持续轮询直到完成
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()

    # 若存在已确认的 audio_timeline，则在生成前应用到 shots.duration（作为视频时长约束）。
    tl = project_data.get("audio_timeline")
    if isinstance(tl, dict) and tl.get("confirmed") is True:
        try:
            executor.apply_audio_timeline_to_project(project, tl, reset_videos=False)
            storage.save_agent_project(project.to_dict())
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid audio_timeline: {str(e)}")

    async def event_generator():
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


@app.post("/api/agent/projects/{project_id}/execute-pipeline-v2")
async def execute_project_pipeline_v2(project_id: str, request: ExecutePipelineV2Request):
    """执行完整的生成流程（音频先行约束版）。

    若项目存在已确认的 audio_timeline，则会在执行前将 timeline.duration 写回 shots 并可选重置视频引用。
    若不存在或未确认，则退化为原行为。
    """
    project_data = storage.get_agent_project(project_id)
    if not project_data:
        raise HTTPException(status_code=404, detail="项目不存在")

    project = AgentProject.from_dict(project_data)
    executor = get_agent_executor()

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
    port_raw = os.getenv("AI_STORYBOARDER_PORT") or os.getenv("BACKEND_PORT") or os.getenv("PORT") or "8001"
    try:
        port = int(port_raw)
    except Exception:
        port = 8001
    uvicorn.run(app, host="0.0.0.0", port=port)
