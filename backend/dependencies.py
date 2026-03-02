"""Shared service instances and accessor functions extracted from main.py.

All global service variables, load_saved_settings(), get_xxx_service() helpers,
and request-scoped service builders live here so that every router can import
a single ``deps`` module instead of reaching back into ``main``.
"""

from __future__ import annotations

import os
import re
import math
from typing import Any, Dict, List, Optional, Set, Tuple
from datetime import datetime, timezone, timedelta
from urllib.parse import urlparse, parse_qs

from services.llm_service import LLMService
from services.image_service import ImageService
from services.video_service import VideoService
from services.storage_service import storage
from services.agent_service import AgentService, AgentProject, AgentExecutor
from services.api_monitor_service import api_monitor
from services.studio_storage import StudioStorage
from services.studio_service import StudioService, StudioServiceError
from services.studio_export_service import StudioExportService
from services.studio.prompt_sentinel import analyze_prompt_text, apply_prompt_suggestions
from services.studio.knowledge_base import KnowledgeBase
from services.studio.mood_packs import (
    list_available_moods,
    save_custom_mood_pack,
    delete_custom_mood_pack,
    list_custom_mood_packs,
)
from services.ws_manager import ws_manager
from services.studio.prompts import build_default_custom_prompts, normalize_custom_prompts
from services.collab_service import CollabService
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

from fastapi import HTTPException

from schemas.settings import (
    ModelConfig,
    LocalConfig,
    SettingsRequest,
    TTSConfig,
)

# ---------------------------------------------------------------------------
# Global service instances (Agent runtime)
# ---------------------------------------------------------------------------
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

# Studio 工作台（独立模块）
studio_storage: Optional[StudioStorage] = None
studio_service: Optional[StudioService] = None
studio_current_settings: Dict[str, Any] = {}
collab_service: Optional[CollabService] = None

AUTH_REQUIRED = os.getenv("AUTH_REQUIRED", "false").strip().lower() in {"1", "true", "yes", "on"}

# Phase 4: 任务队列 Feature Flag
USE_TASK_QUEUE = os.getenv("USE_TASK_QUEUE", "false").lower() == "true"

OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "outputs")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# 参考图目录
REF_IMAGES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "images")
os.makedirs(REF_IMAGES_DIR, exist_ok=True)

# 上传文件目录
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 风格预设
STYLE_PROMPTS = {
    "cinematic": "cinematic lighting, film grain, dramatic shadows, movie scene, professional cinematography",
    "anime": "anime style, vibrant colors, cel shading, japanese animation, detailed illustration",
    "realistic": "photorealistic, highly detailed, 8k resolution, professional photography, natural lighting",
    "ink": "chinese ink painting style, traditional brush strokes, minimalist, elegant, monochrome with subtle colors"
}

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

# 支持的文件类型
ALLOWED_FILE_TYPES = {
    'image/jpeg': {'ext': '.jpg', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'image/png': {'ext': '.png', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'image/gif': {'ext': '.gif', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'image/webp': {'ext': '.webp', 'category': 'image', 'max_size': 20 * 1024 * 1024},
    'application/pdf': {'ext': '.pdf', 'category': 'document', 'max_size': 50 * 1024 * 1024},
    'text/plain': {'ext': '.txt', 'category': 'document', 'max_size': 10 * 1024 * 1024},
    'text/markdown': {'ext': '.md', 'category': 'document', 'max_size': 10 * 1024 * 1024},
    'application/msword': {'ext': '.doc', 'category': 'document', 'max_size': 50 * 1024 * 1024},
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {'ext': '.docx', 'category': 'document', 'max_size': 50 * 1024 * 1024},
    'text/csv': {'ext': '.csv', 'category': 'spreadsheet', 'max_size': 30 * 1024 * 1024},
    'application/vnd.ms-excel': {'ext': '.xls', 'category': 'spreadsheet', 'max_size': 30 * 1024 * 1024},
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {'ext': '.xlsx', 'category': 'spreadsheet', 'max_size': 30 * 1024 * 1024},
    'application/json': {'ext': '.json', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'text/html': {'ext': '.html', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'text/css': {'ext': '.css', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'text/javascript': {'ext': '.js', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'application/xml': {'ext': '.xml', 'category': 'code', 'max_size': 10 * 1024 * 1024},
    'video/mp4': {'ext': '.mp4', 'category': 'video', 'max_size': 100 * 1024 * 1024},
    'video/webm': {'ext': '.webm', 'category': 'video', 'max_size': 100 * 1024 * 1024},
    'video/quicktime': {'ext': '.mov', 'category': 'video', 'max_size': 100 * 1024 * 1024},
    'audio/mpeg': {'ext': '.mp3', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
    'audio/wav': {'ext': '.wav', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
    'audio/mp4': {'ext': '.m4a', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
    'audio/ogg': {'ext': '.ogg', 'category': 'audio', 'max_size': 25 * 1024 * 1024},
}


# ---------------------------------------------------------------------------
# load_saved_settings
# ---------------------------------------------------------------------------
def load_saved_settings():
    """启动时加载已保存的设置"""
    global llm_service, image_service, storyboard_service, video_service
    global module_llm_service, module_image_service, module_storyboard_service, module_video_service
    global agent_service, current_settings, module_current_settings
    global studio_storage, studio_service, studio_current_settings, collab_service

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
        elif img_config.get("provider") and img_config.get("provider") not in {"placeholder", "none"}:
            image_service = ImageService(
                provider=img_config.get("provider"),
                api_key=img_config.get("apiKey") or os.getenv("IMAGE_API_KEY", ""),
                base_url=img_config.get("baseUrl") or None,
                model=img_config.get("model") or None,
            )

        sb_config = agent_saved.get("storyboard", {})
        if sb_config.get("provider") and sb_config.get("provider") not in {"placeholder", "none"}:
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
        elif module_img_cfg.get("provider") and module_img_cfg.get("provider") not in {"placeholder", "none"}:
            module_image_service = ImageService(
                provider=module_img_cfg.get("provider"),
                api_key=module_img_cfg.get("apiKey") or os.getenv("IMAGE_API_KEY", ""),
                base_url=module_img_cfg.get("baseUrl") or None,
                model=module_img_cfg.get("model") or None,
            )

        module_sb_cfg = module_saved.get("storyboard", {})
        if module_sb_cfg.get("provider") and module_sb_cfg.get("provider") not in {"placeholder", "none"}:
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

    # 初始化 Studio 工作台（独立模块，独立配置）
    studio_storage = StudioStorage()
    studio_service = StudioService(studio_storage)
    collab_service = CollabService()

    # Studio 设置：优先 studio.settings.local.yaml，其次复用 module settings
    import yaml as _yaml
    studio_settings_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "studio.settings.local.yaml")
    if os.path.exists(studio_settings_path):
        try:
            with open(studio_settings_path, "r", encoding="utf-8") as f:
                studio_saved = _yaml.safe_load(f) or {}
            studio_current_settings = studio_saved
            studio_service.configure(studio_saved)
            print("[Startup] Studio settings 已加载")
        except Exception as e:
            print(f"[Startup] Studio settings 加载失败: {e}")
    elif module_current_settings:
        # 回退复用 module settings
        studio_service.configure(module_current_settings)
        studio_current_settings = module_current_settings
        print("[Startup] Studio 复用 Module settings")
    else:
        print("[Startup] Studio 暂无设置（将在前端配置后激活）")


# ---------------------------------------------------------------------------
# Service accessor helpers
# ---------------------------------------------------------------------------

def _is_model_access_error(error_message: str) -> bool:
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
    global llm_service
    if llm_service is None:
        llm_service = LLMService(
            provider=os.getenv("LLM_PROVIDER", "qwen"),
            api_key=os.getenv("LLM_API_KEY", "")
        )
    return llm_service


def get_module_llm_service() -> LLMService:
    global module_llm_service
    if module_llm_service is None:
        module_llm_service = LLMService(
            provider=os.getenv("LLM_PROVIDER", "qwen"),
            api_key=os.getenv("LLM_API_KEY", "")
        )
    return module_llm_service


def get_llm_service() -> LLMService:
    return get_module_llm_service()


def get_request_llm_service(override: Optional[ModelConfig] = None) -> LLMService:
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

    if not api_key:
        return get_module_llm_service()

    return LLMService(
        provider=provider,
        api_key=api_key,
        base_url=base_url,
        model=model
    )


def get_image_service() -> ImageService:
    global image_service
    if image_service is None:
        image_service = ImageService(
            provider=os.getenv("IMAGE_PROVIDER", "none"),
            api_key=os.getenv("IMAGE_API_KEY", "")
        )
    return image_service


def get_storyboard_service() -> ImageService:
    global storyboard_service
    if storyboard_service is not None:
        return storyboard_service
    return get_image_service()


def get_module_image_service() -> ImageService:
    global module_image_service
    if module_image_service is None:
        module_image_service = ImageService(
            provider=os.getenv("IMAGE_PROVIDER", "none"),
            api_key=os.getenv("IMAGE_API_KEY", "")
        )
    return module_image_service


def get_module_storyboard_service() -> ImageService:
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
    if provider in {"placeholder", "none"}:
        return ImageService(provider="none", model=model)

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


def get_video_service() -> VideoService:
    global video_service
    if video_service is None:
        video_service = VideoService(provider="none")
    return video_service


def get_module_video_service() -> VideoService:
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


def get_agent_service() -> AgentService:
    global agent_service
    if agent_service is None:
        agent_service = AgentService(storage)
    return agent_service


def get_agent_executor() -> AgentExecutor:
    return AgentExecutor(
        agent_service=get_agent_service(),
        image_service=get_image_service(),
        video_service=get_video_service(),
        storage=storage
    )


def apply_agent_runtime_settings(request: SettingsRequest) -> Dict[str, Any]:
    global llm_service, image_service, storyboard_service, video_service

    applied_settings = request.model_dump()
    if request.tts:
        applied_settings["tts"] = request.tts.model_dump(exclude_none=True)

    llm_config = request.llm
    llm_service = LLMService(
        provider=llm_config.provider,
        api_key=llm_config.apiKey,
        base_url=llm_config.baseUrl if llm_config.baseUrl else None,
        model=llm_config.model if llm_config.model else None
    )
    print(f"[Settings][Agent] LLM 配置更新: provider={llm_config.provider}, model={llm_config.model}")

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
    global module_llm_service, module_image_service, module_storyboard_service, module_video_service

    applied_settings = request.model_dump()
    if request.tts:
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


# ---------------------------------------------------------------------------
# Agent helper functions
# ---------------------------------------------------------------------------

def _extract_dialogue_text(dialogue_script: str) -> str:
    if not isinstance(dialogue_script, str) or not dialogue_script.strip():
        return ""
    lines = [ln.strip() for ln in dialogue_script.splitlines() if ln.strip()]
    utterances: List[str] = []
    for ln in lines:
        if "\uff1a" in ln:
            _, tail = ln.split("\uff1a", 1)
            utterances.append(tail.strip())
        elif ":" in ln:
            _, tail = ln.split(":", 1)
            utterances.append(tail.strip())
        else:
            utterances.append(ln)
    return " ".join([u for u in utterances if u])


def _sanitize_tts_text(text: Any) -> str:
    if not isinstance(text, str):
        return ""
    s = text.strip()
    if not s:
        return ""
    s = re.sub(r"[\uff08(]\s*(?:character|object|scene|location|prop|bg|setting)\s*[)\uff09]", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\[Element_[A-Za-z0-9_\-]+\]", "", s)
    s = re.sub(r"\bElement_[A-Za-z0-9_\-]+\b", "", s)
    s = re.sub(r"\b(?:shot|segment|character|object|scene)_[A-Za-z0-9_\-]+\b", "", s, flags=re.IGNORECASE)
    s = re.sub(r"\b(?:id|ID)\s*[:=\uff1a]\s*[A-Za-z0-9_\-]{2,}\b", "", s)
    s = re.sub(
        r"[\u3010\[]\s*(?:id|ID|shot_id|shotId|element|Element|character|object|scene)\s*[:=\uff1a][^\u3011\]]{0,60}[\u3011\]]",
        "",
        s,
    )
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _is_speakable_text(text: Any) -> bool:
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
    s = re.sub(r"\s*[\uff08(]\s*(?:character|object|scene)\s*[)\uff09]\s*$", "", s, flags=re.IGNORECASE).strip()
    s = re.sub(r"\s*[\u3010\[]\s*(?:id|ID)\s*[:=\uff1a][^\u3011\]]{0,60}[\u3011\]]\s*$", "", s).strip()
    s = re.sub(r"\s*\b(?:id|ID)\s*[:=\uff1a]\s*[A-Za-z0-9_\-]{2,}\s*$", "", s).strip()
    return s


def _parse_duration_seconds(text: Any) -> Optional[float]:
    if not isinstance(text, str):
        return None
    s = text.strip()
    if not s:
        return None
    raw = s
    s = s.strip().lower()

    m = re.search(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)", s)
    if m:
        a = int(m.group(1))
        b = int(m.group(2))
        c = int(m.group(3)) if m.group(3) else None
        if c is None:
            return float(a * 60 + b)
        return float(a * 3600 + b * 60 + c)

    m2 = re.search(r"(\d+(?:\.\d+)?)\s*\u5206(?:\u949f)?\s*(\d+(?:\.\d+)?)\s*\u79d2?", raw)
    if m2:
        try:
            return float(m2.group(1)) * 60.0 + float(m2.group(2))
        except Exception:
            return None

    mh = re.search(r"(\d+(?:\.\d+)?)\s*(?:\u5c0f\u65f6|h|hour|hours)\b", s)
    mmn = re.search(r"(\d+(?:\.\d+)?)\s*(?:\u5206\u949f|min|minute|minutes|m)\b", s)
    ms = re.search(r"(\d+(?:\.\d+)?)\s*(?:\u79d2|s|sec|second|seconds)\b", s)

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
    if not isinstance(text, str):
        return 0.0
    s = re.sub(r"\s+", " ", text).strip()
    if not s:
        return 0.0

    cjk = len(re.findall(r"[\u4e00-\u9fff]", s))
    words = len(re.findall(r"[A-Za-z0-9']+", s))

    cps = 3.75
    wps = 2.7

    base = (cjk / cps) if cjk >= max(8, words * 2) else (words / wps if words else (len(s) / 10.0))
    pauses = s.count("\u2026") * 0.12 + s.count("\u2014") * 0.08
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


# ---------------------------------------------------------------------------
# Studio helper functions
# ---------------------------------------------------------------------------

def _studio_error_payload(
    detail: str,
    error_code: str,
    context: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"detail": detail, "error_code": error_code}
    if context:
        payload["context"] = context
    return payload


def _studio_raise(status_code: int, detail: str, error_code: str, context: Optional[Dict[str, Any]] = None):
    raise HTTPException(status_code, _studio_error_payload(detail, error_code, context))


def _studio_ensure_service_ready() -> StudioService:
    if not studio_service:
        _studio_raise(500, "Studio 服务未初始化", "studio_not_initialized")
    return studio_service


def _studio_raise_from_exception(e: Exception) -> None:
    if isinstance(e, HTTPException):
        raise e
    if isinstance(e, StudioServiceError):
        code = e.error_code or "studio_error"
        print(f"[Studio] StudioServiceError: code={code}, msg={e.message}")
        status = 400 if code in {
            "episode_not_found",
            "series_not_found",
            "shot_not_found",
            "element_not_found",
            "history_not_found",
            "shot_missing_start_frame",
            "config_missing_llm",
            "config_missing_image",
            "config_missing_video",
            "config_missing_tts",
            "invalid_inpaint_prompt",
            "context_length_exceeded",
            "character_doc_too_short",
            "character_doc_parse_failed",
        } else 500
        raise HTTPException(status, e.to_payload())
    import traceback
    print(f"[Studio] 未处理异常: {type(e).__name__}: {e}")
    traceback.print_exc()
    _studio_raise(500, str(e), "studio_internal_error")


def _studio_parse_float(value: Any, fallback: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return fallback


def _studio_build_volume_style_anchor(
    service: StudioService,
    series: Dict[str, Any],
    volume_id: str,
    preferred_episode_id: str = "",
) -> Dict[str, Any]:
    episodes = service.storage.list_episodes(str(series.get("id") or ""), volume_id=volume_id)
    target_episode: Optional[Dict[str, Any]] = None
    preferred = str(preferred_episode_id or "").strip()
    if preferred:
        target_episode = next((ep for ep in episodes if str(ep.get("id") or "") == preferred), None)
    if not target_episode and episodes:
        target_episode = episodes[0]

    target_shot: Optional[Dict[str, Any]] = None
    if target_episode:
        shots = service.storage.get_shots(str(target_episode.get("id") or ""))
        if shots:
            target_shot = shots[0]

    visual_style = str(series.get("visual_style") or "").strip()
    source = "auto_extract" if target_episode else "series_fallback"
    return {
        "visual_style": visual_style,
        "reference_episode_id": str((target_episode or {}).get("id") or ""),
        "reference_shot_id": str((target_shot or {}).get("id") or ""),
        "reference_prompt": str(
            (target_shot or {}).get("prompt")
            or (target_shot or {}).get("video_prompt")
            or (target_shot or {}).get("description")
            or ""
        ),
        "reference_frame_url": str(
            (target_shot or {}).get("start_image_url")
            or (target_shot or {}).get("key_frame_url")
            or (target_shot or {}).get("end_image_url")
            or ""
        ),
        "source": source,
        "updated_at": datetime.now().isoformat(),
    }


def _studio_normalize_agent_element_id(raw_id: str, fallback: str) -> str:
    source = str(raw_id or "").strip()
    if not source:
        source = fallback
    normalized = re.sub(r"[^0-9A-Za-z_]+", "_", source).strip("_")
    if not normalized:
        normalized = fallback
    if not normalized.startswith("Element_"):
        normalized = f"Element_{normalized}"
    return normalized


def _studio_history_urls_to_agent_items(raw: Any) -> List[Dict[str, Any]]:
    items: List[Dict[str, Any]] = []
    if not isinstance(raw, list):
        return items
    for index, value in enumerate(raw):
        if isinstance(value, str) and value.strip():
            items.append({
                "id": f"img_{index+1}",
                "url": value.strip(),
                "created_at": datetime.now().isoformat(),
                "is_favorite": False,
            })
            continue
        if isinstance(value, dict):
            url = str(value.get("url") or value.get("image_url") or "").strip()
            if not url:
                continue
            items.append({
                "id": str(value.get("id") or f"img_{index+1}"),
                "url": url,
                "created_at": str(value.get("created_at") or datetime.now().isoformat()),
                "is_favorite": bool(value.get("is_favorite", False)),
            })
    return items


def _studio_agent_history_to_urls(raw: Any) -> List[str]:
    urls: List[str] = []
    if not isinstance(raw, list):
        return urls
    for value in raw:
        if isinstance(value, str) and value.strip():
            urls.append(value.strip())
            continue
        if isinstance(value, dict):
            url = str(value.get("url") or value.get("image_url") or "").strip()
            if url:
                urls.append(url)
    return urls


def _studio_pick_agent_project_id(req) -> str:
    return str(getattr(req, 'project_id', '') or getattr(req, 'projectId', '') or "").strip()


def _studio_summarize_agent_project(project: Dict[str, Any], shots_count: int, total_duration: float) -> str:
    if isinstance(project.get("creative_brief"), dict):
        brief = project.get("creative_brief") or {}
        for key in ("summary", "logline", "hook", "title"):
            value = brief.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    return f"由 Agent 项目导入，镜头 {shots_count} 条，总时长约 {round(total_duration, 1)} 秒。"


# ---------------------------------------------------------------------------
# Collab helper functions
# ---------------------------------------------------------------------------

def _collab_ensure_service_ready() -> CollabService:
    if not collab_service:
        raise HTTPException(500, "协作服务未初始化")
    return collab_service


def _collab_extract_token(authorization: Optional[str]) -> str:
    raw = str(authorization or "").strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip()
    return raw


def _collab_get_current_user(
    request,
    authorization: Optional[str] = None,
    *,
    required: bool = True,
) -> Dict[str, Any]:
    service = _collab_ensure_service_ready()
    header_auth = authorization or request.headers.get("authorization") or request.headers.get("Authorization")
    token = _collab_extract_token(header_auth)
    if not token:
        token = _collab_extract_token(str(request.query_params.get("access_token") or ""))
    if token:
        try:
            return service.verify_access_token(token)
        except Exception as e:
            if AUTH_REQUIRED and required:
                raise HTTPException(401, f"认证失败: {str(e)}")
    if AUTH_REQUIRED and required:
        raise HTTPException(401, "未登录或令牌缺失")
    return service.ensure_local_dev_user()


def _collab_pick_workspace_id(request, explicit_workspace_id: Optional[str] = None) -> str:
    ws = str(explicit_workspace_id or "").strip()
    if ws:
        return ws
    ws = str(request.query_params.get("workspace_id") or "").strip()
    if ws:
        return ws
    ws = str(request.headers.get("x-workspace-id") or request.headers.get("X-Workspace-Id") or "").strip()
    if ws:
        return ws
    if AUTH_REQUIRED:
        return ""
    service = _collab_ensure_service_ready()
    user = service.ensure_local_dev_user()
    workspaces = service.list_workspaces(user["id"])
    return str(workspaces[0]["id"]) if workspaces else ""


def _collab_require_workspace_role(
    request,
    workspace_id: str,
    minimum_role: str = "viewer",
    authorization: Optional[str] = None,
) -> Dict[str, Any]:
    user = _collab_get_current_user(request, authorization, required=True)
    service = _collab_ensure_service_ready()
    role = service.get_member_role(workspace_id, user["id"])
    if not role:
        raise HTTPException(403, "无工作区访问权限")
    rank = {"viewer": 1, "editor": 2, "owner": 3}
    if rank.get(role, 0) < rank.get(minimum_role, 1):
        raise HTTPException(403, "工作区权限不足")
    return user


def _collab_require_episode_write_access(
    request,
    workspace_id: str,
    episode_id: str,
    authorization: Optional[str] = None,
) -> Dict[str, Any]:
    if not workspace_id:
        return _collab_get_current_user(request, authorization, required=False)

    user = _collab_require_workspace_role(request, workspace_id, "editor", authorization)
    service = _collab_ensure_service_ready()
    role = str(service.get_member_role(workspace_id, str(user.get("id") or "")) or "")
    allowed, reason, assignment = service.can_edit_episode(
        workspace_id=workspace_id,
        episode_id=episode_id,
        user_id=str(user.get("id") or ""),
        role=role,
    )
    if not allowed:
        _studio_raise(
            403,
            reason or "当前分幕处于锁定状态，无法编辑",
            "episode_assignment_locked",
            {
                "workspace_id": workspace_id,
                "episode_id": episode_id,
                "assignment": assignment or {},
            },
        )
    return user


def _studio_append_collab_operation(
    *,
    workspace_id: str,
    project_scope: str,
    action: str,
    before: Dict[str, Any],
    after: Dict[str, Any],
    created_by: str = "",
) -> None:
    if not workspace_id:
        return
    try:
        _collab_ensure_service_ready().append_operation(
            workspace_id=workspace_id,
            project_scope=project_scope,
            action=action,
            payload={
                "before": before,
                "after": after,
                "version": 1,
            },
            created_by=created_by,
        )
    except Exception as e:
        print(f"[Collab] 记录操作日志失败: {e}")

    try:
        import asyncio
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(ws_manager.broadcast(
                workspace_id,
                {
                    "type": action.replace(".", "_"),
                    "action": action,
                    "project_scope": project_scope,
                    "created_by": created_by,
                    "after": after,
                },
                exclude_user=created_by,
            ))
    except Exception:
        pass


def _studio_apply_collab_operation(op: Dict[str, Any], direction: str) -> Dict[str, Any]:
    service = _studio_ensure_service_ready()
    payload = op.get("payload")
    if not isinstance(payload, dict):
        raise HTTPException(400, "操作日志载荷无效")
    target = payload.get("before") if direction == "undo" else payload.get("after")
    if not isinstance(target, dict):
        raise HTTPException(400, "操作日志缺少 before/after")

    action = str(op.get("action") or "")
    if action == "studio.shot.update":
        shot_id = str(target.get("id") or "")
        if not shot_id:
            raise HTTPException(400, "操作日志缺少 shot.id")
        updated = service.storage.update_shot(shot_id, target)
        if not updated:
            raise HTTPException(404, "镜头不存在")
        return {"target": "shot", "id": shot_id}

    if action == "studio.shot.reorder":
        episode_id = str(target.get("episode_id") or "")
        shot_ids = target.get("shot_ids")
        if not episode_id or not isinstance(shot_ids, list):
            raise HTTPException(400, "操作日志缺少排序信息")
        normalized = [str(sid) for sid in shot_ids if str(sid).strip()]
        service.storage.reorder_shots(episode_id, normalized)
        return {"target": "episode", "id": episode_id}

    if action == "studio.episode.update":
        episode_id = str(target.get("id") or "")
        if not episode_id:
            raise HTTPException(400, "操作日志缺少 episode.id")
        updated = service.storage.update_episode(episode_id, target)
        if not updated:
            raise HTTPException(404, "分幕不存在")
        return {"target": "episode", "id": episode_id}

    if action == "studio.series.update":
        series_id = str(target.get("id") or "")
        if not series_id:
            raise HTTPException(400, "操作日志缺少 series.id")
        updated = service.storage.update_series(series_id, target)
        if not updated:
            raise HTTPException(404, "系列不存在")
        return {"target": "series", "id": series_id}

    if action == "studio.element.update":
        element_id = str(target.get("id") or "")
        if not element_id:
            raise HTTPException(400, "操作日志缺少 element.id")
        updated = service.storage.update_shared_element(element_id, target)
        if not updated:
            raise HTTPException(404, "元素不存在")
        return {"target": "element", "id": element_id}

    raise HTTPException(400, f"不支持的撤销动作: {action}")


# ---------------------------------------------------------------------------
# KB helper
# ---------------------------------------------------------------------------

def _kb_get_instance() -> KnowledgeBase:
    service = _studio_ensure_service_ready()
    kb = getattr(service, '_kb', None)
    if kb is None:
        kb = KnowledgeBase(service.storage)
        service._kb = kb
    return kb
