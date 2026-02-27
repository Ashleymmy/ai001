"""Studio 长篇制作工作台 - 核心服务层

独立于 Agent 模块，复用工具服务类（LLMService / ImageService / VideoService / TTSService），
拥有自己的实例和配置。
"""
import asyncio
import json
import math
import re
import inspect
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from .studio_storage import StudioStorage
from .studio.prompts import DEFAULT_CUSTOM_PROMPTS, normalize_custom_prompts
from .studio.prompt_sentinel import build_prompt_optimize_llm_payload
from .studio.constants import (
    CAMERA_MOVEMENTS,
    DEFAULT_NEGATIVE_PROMPT,
    get_shot_size_zh,
    get_camera_angle_zh,
    get_camera_movement_desc,
    get_emotion_intensity_zh,
)
from .llm_service import LLMService
from .image_service import ImageService
from .video_service import VideoService
from .tts_service import (
    DashScopeTTSConfig,
    DashScopeTTSService,
    FishTTSConfig,
    FishTTSService,
    OpenAITTSConfig,
    OpenAITTSService,
    VolcTTSConfig,
    VolcTTSService,
)


class StudioServiceError(Exception):
    """Studio 结构化业务错误。"""

    def __init__(
        self,
        message: str,
        error_code: str = "studio_error",
        context: Optional[Dict[str, Any]] = None,
    ):
        super().__init__(message)
        self.message = message
        self.error_code = error_code
        self.context = context or {}

    def to_payload(self) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "detail": self.message,
            "error_code": self.error_code,
        }
        if self.context:
            payload["context"] = self.context
        return payload


class StudioService:
    """长篇制作工作台核心服务"""

    def __init__(self, storage: StudioStorage):
        self.storage = storage
        # 工具服务实例（独立于 Agent / Module）
        self.llm: Optional[LLMService] = None
        self.image: Optional[ImageService] = None
        self.video: Optional[VideoService] = None
        self.tts: Optional[Any] = None
        self.tts_provider: str = "none"
        self.tts_defaults: Dict[str, Any] = {}
        self.generation_defaults: Dict[str, Any] = {}
        self.custom_prompts: Dict[str, Dict[str, str]] = {}

    # ------------------------------------------------------------------
    # 配置
    # ------------------------------------------------------------------

    def configure(self, settings: Dict[str, Any]) -> None:
        """从设置字典中初始化工具服务实例"""
        # 每次重配都先清空，避免沿用旧实例
        self.llm = None
        self.image = None
        self.video = None
        self.tts = None
        self.tts_provider = "none"
        self.tts_defaults = {}

        # LLM
        llm_cfg = settings.get("llm") or {}
        llm_api_key = str(llm_cfg.get("apiKey") or "").strip()
        if llm_api_key:
            self.llm = LLMService(
                provider=llm_cfg.get("provider", "qwen"),
                api_key=llm_api_key,
                base_url=llm_cfg.get("baseUrl"),
                model=llm_cfg.get("model"),
            )
            print(f"[Studio] LLM 已配置: {llm_cfg.get('provider')}/{llm_cfg.get('model')}")

        # Image
        img_cfg = settings.get("image") or {}
        img_provider = str(img_cfg.get("provider") or "").strip()
        img_api_key = str(img_cfg.get("apiKey") or "").strip()
        if img_provider and img_provider not in {"placeholder", "none"}:
            if img_provider in {"comfyui", "sd-webui"} or img_api_key:
                self.image = ImageService(
                    provider=img_provider,
                    api_key=img_api_key,
                    base_url=img_cfg.get("baseUrl", ""),
                    model=img_cfg.get("model", ""),
                )
            else:
                print(f"[Studio] 图像服务未激活：provider={img_provider} 缺少 API Key")

        # Video
        vid_cfg = settings.get("video") or {}
        vid_provider = str(vid_cfg.get("provider") or "").strip()
        vid_api_key = str(vid_cfg.get("apiKey") or "").strip()
        if vid_provider and vid_provider != "none":
            if vid_api_key:
                self.video = VideoService(
                    provider=vid_provider,
                    api_key=vid_api_key,
                    base_url=vid_cfg.get("baseUrl", ""),
                    model=vid_cfg.get("model", ""),
                )
            else:
                print(f"[Studio] 视频服务未激活：provider={vid_provider} 缺少 API Key")

        # TTS
        tts_cfg_raw = settings.get("tts") or {}
        tts_cfg = self._normalize_tts_settings(tts_cfg_raw)
        provider = str(tts_cfg.get("provider") or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
        self.tts_provider = provider
        self.tts_defaults = tts_cfg

        if provider == "volc_tts_v1_http":
            volc = tts_cfg.get("volc") or {}
            appid = str(volc.get("appid") or "").strip()
            access_token = str(volc.get("accessToken") or "").strip()
            if appid and access_token:
                self.tts = VolcTTSService(
                    VolcTTSConfig(
                        appid=appid,
                        access_token=access_token,
                        endpoint=str(volc.get("endpoint") or "").strip() or "https://openspeech.bytedance.com/api/v1/tts",
                        cluster=str(volc.get("cluster") or "").strip() or "volcano_tts",
                        model=str(volc.get("model") or "").strip() or "seed-tts-1.1",
                    )
                )
            else:
                print("[Studio] TTS 未激活：Volc 需要 appid + accessToken")
        elif provider.startswith("fish"):
            fish = tts_cfg.get("fish") or {}
            api_key = str(fish.get("apiKey") or "").strip()
            if api_key:
                self.tts = FishTTSService(
                    FishTTSConfig(
                        api_key=api_key,
                        base_url=str(fish.get("baseUrl") or "").strip() or "https://api.fish.audio",
                        model=str(fish.get("model") or "").strip() or "speech-1.5",
                    )
                )
            else:
                print("[Studio] TTS 未激活：Fish 需要 apiKey")
        elif provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}:
            bailian = tts_cfg.get("bailian") or {}
            api_key = str(bailian.get("apiKey") or "").strip()
            if api_key:
                self.tts = DashScopeTTSService(
                    DashScopeTTSConfig(
                        api_key=api_key,
                        base_url=str(bailian.get("baseUrl") or "").strip() or "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                        model=str(bailian.get("model") or "").strip() or "cosyvoice-v1",
                        workspace=str(bailian.get("workspace") or "").strip(),
                    )
                )
            else:
                print("[Studio] TTS 未激活：阿里百炼需要 apiKey")
        elif provider.startswith("custom_") or provider in {"custom_openai_tts", "openai_tts_compatible", "openai_tts"}:
            custom = tts_cfg.get("custom") or {}
            api_key = str(custom.get("apiKey") or "").strip()
            if api_key:
                self.tts = OpenAITTSService(
                    OpenAITTSConfig(
                        api_key=api_key,
                        base_url=str(custom.get("baseUrl") or "").strip() or "https://api.openai.com/v1",
                        model=str(custom.get("model") or "").strip() or "gpt-4o-mini-tts",
                    )
                )
            else:
                print("[Studio] TTS 未激活：自定义 TTS 需要 apiKey")
        else:
            print(f"[Studio] TTS 未激活：未知 provider={provider}")

        # 生成默认参数
        self.generation_defaults = settings.get("generation_defaults") or {}
        self.custom_prompts = normalize_custom_prompts(settings.get("custom_prompts"))

    def check_config(self) -> Dict[str, Any]:
        """返回 Studio 工具链配置自检结果。"""
        services = {
            "llm": {
                "configured": self.llm is not None,
                "message": "" if self.llm else "请先在设置中配置 LLM 服务（含 API Key）",
            },
            "image": {
                "configured": self.image is not None,
                "message": "" if self.image else "请先在设置中配置图像服务（含 API Key）",
            },
            "video": {
                "configured": self.video is not None,
                "message": "" if self.video else "请先在设置中配置视频服务（含 API Key）",
            },
            "tts": {
                "configured": self.tts is not None,
                "message": (
                    ""
                    if self.tts
                    else f"请先在设置中配置 TTS 服务（当前 provider: {self.tts_provider or 'none'}）"
                ),
            },
        }
        return {
            "ok": all(v["configured"] for v in services.values()),
            "services": services,
        }

    @staticmethod
    def _normalize_tts_settings(tts_cfg_raw: Any) -> Dict[str, Any]:
        cfg = tts_cfg_raw if isinstance(tts_cfg_raw, dict) else {}

        def as_dict(value: Any) -> Dict[str, Any]:
            return value if isinstance(value, dict) else {}

        def as_text(value: Any, default: str = "") -> str:
            text = str(value or "").strip()
            return text if text else default

        def as_int(value: Any, default: int) -> int:
            try:
                iv = int(value)
                return iv if iv > 0 else default
            except Exception:
                return default

        def as_float(value: Any, default: float) -> float:
            try:
                fv = float(value)
                return fv if fv > 0 else default
            except Exception:
                return default

        raw_provider = as_text(cfg.get("provider"), "")
        raw_base_url = as_text(cfg.get("baseUrl") or cfg.get("base_url"), "")
        raw_access = as_text(cfg.get("accessToken") or cfg.get("access_token"), "")
        raw_api_key = as_text(cfg.get("apiKey") or cfg.get("api_key"), "")
        raw_model = as_text(cfg.get("model"), "")
        raw_voice = as_text(cfg.get("voiceType"), "")

        provider = raw_provider
        if not provider:
            if raw_base_url and "fish.audio" in raw_base_url:
                provider = "fish_tts_v1"
            elif raw_base_url and "dashscope.aliyuncs.com" in raw_base_url:
                provider = "aliyun_bailian_tts_v2"
            else:
                provider = "volc_tts_v1_http"

        volc_raw = as_dict(cfg.get("volc"))
        fish_raw = as_dict(cfg.get("fish"))
        bailian_raw = as_dict(cfg.get("bailian"))
        custom_raw = as_dict(cfg.get("custom"))

        volc: Dict[str, Any] = {
            "appid": as_text(volc_raw.get("appid") or cfg.get("appid"), ""),
            "accessToken": as_text(
                volc_raw.get("accessToken")
                or (
                    raw_access
                    if provider not in {"fish_tts_v1", "aliyun_bailian_tts_v2", "dashscope_tts_v2"} and not provider.startswith("custom_")
                    else ""
                ),
                "",
            ),
            "endpoint": as_text(
                volc_raw.get("endpoint"),
                "https://openspeech.bytedance.com/api/v1/tts",
            ),
            "cluster": as_text(volc_raw.get("cluster") or cfg.get("cluster"), "volcano_tts"),
            "model": as_text(volc_raw.get("model") or raw_model, "seed-tts-1.1"),
            "encoding": as_text(volc_raw.get("encoding") or cfg.get("encoding"), "mp3"),
            "rate": as_int(volc_raw.get("rate") if "rate" in volc_raw else cfg.get("rate"), 24000),
            "speedRatio": as_float(
                volc_raw.get("speedRatio") if "speedRatio" in volc_raw else cfg.get("speedRatio"),
                1.0,
            ),
            "narratorVoiceType": as_text(
                volc_raw.get("narratorVoiceType") or cfg.get("narratorVoiceType") or raw_voice,
                "",
            ),
            "dialogueVoiceType": as_text(
                volc_raw.get("dialogueVoiceType") or cfg.get("dialogueVoiceType"),
                "",
            ),
            "dialogueMaleVoiceType": as_text(
                volc_raw.get("dialogueMaleVoiceType") or cfg.get("dialogueMaleVoiceType"),
                "",
            ),
            "dialogueFemaleVoiceType": as_text(
                volc_raw.get("dialogueFemaleVoiceType") or cfg.get("dialogueFemaleVoiceType"),
                "",
            ),
        }

        fish_model_default = "speech-1.5"
        fish_model = as_text(fish_raw.get("model") or raw_model, fish_model_default)
        if fish_model.startswith("seed-"):
            fish_model = fish_model_default
        fish: Dict[str, Any] = {
            "apiKey": as_text(
                fish_raw.get("apiKey")
                or (
                    raw_api_key
                    or (
                        raw_access
                        if provider.startswith("fish")
                        else ""
                    )
                ),
                "",
            ),
            "baseUrl": as_text(
                fish_raw.get("baseUrl")
                or (
                    raw_base_url
                    if "fish.audio" in raw_base_url or provider.startswith("fish")
                    else ""
                ),
                "https://api.fish.audio",
            ),
            "model": fish_model,
            "encoding": as_text(fish_raw.get("encoding") or cfg.get("encoding"), "mp3"),
            "rate": as_int(fish_raw.get("rate") if "rate" in fish_raw else cfg.get("rate"), 24000),
            "speedRatio": as_float(
                fish_raw.get("speedRatio") if "speedRatio" in fish_raw else cfg.get("speedRatio"),
                1.0,
            ),
            "narratorVoiceType": as_text(
                fish_raw.get("narratorVoiceType")
                or cfg.get("narratorVoiceType")
                or (raw_voice if provider.startswith("fish") else ""),
                "",
            ),
            "dialogueVoiceType": as_text(
                fish_raw.get("dialogueVoiceType") or cfg.get("dialogueVoiceType"),
                "",
            ),
            "dialogueMaleVoiceType": as_text(
                fish_raw.get("dialogueMaleVoiceType") or cfg.get("dialogueMaleVoiceType"),
                "",
            ),
            "dialogueFemaleVoiceType": as_text(
                fish_raw.get("dialogueFemaleVoiceType") or cfg.get("dialogueFemaleVoiceType"),
                "",
            ),
        }

        bailian: Dict[str, Any] = {
            "apiKey": as_text(
                bailian_raw.get("apiKey")
                or (
                    raw_api_key
                    or (
                        raw_access
                        if provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}
                        else ""
                    )
                ),
                "",
            ),
            "baseUrl": as_text(
                bailian_raw.get("baseUrl")
                or (
                    raw_base_url
                    if "dashscope.aliyuncs.com" in raw_base_url
                    else ""
                ),
                "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
            ),
            "workspace": as_text(bailian_raw.get("workspace"), ""),
            "model": as_text(bailian_raw.get("model") or raw_model, "cosyvoice-v1"),
            "encoding": as_text(bailian_raw.get("encoding") or cfg.get("encoding"), "mp3"),
            "rate": as_int(bailian_raw.get("rate") if "rate" in bailian_raw else cfg.get("rate"), 24000),
            "speedRatio": as_float(
                bailian_raw.get("speedRatio") if "speedRatio" in bailian_raw else cfg.get("speedRatio"),
                1.0,
            ),
            "narratorVoiceType": as_text(
                bailian_raw.get("narratorVoiceType")
                or cfg.get("narratorVoiceType")
                or (
                    raw_voice
                    if provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}
                    else ""
                ),
                "",
            ),
            "dialogueVoiceType": as_text(
                bailian_raw.get("dialogueVoiceType") or cfg.get("dialogueVoiceType"),
                "",
            ),
            "dialogueMaleVoiceType": as_text(
                bailian_raw.get("dialogueMaleVoiceType") or cfg.get("dialogueMaleVoiceType"),
                "",
            ),
            "dialogueFemaleVoiceType": as_text(
                bailian_raw.get("dialogueFemaleVoiceType") or cfg.get("dialogueFemaleVoiceType"),
                "",
            ),
        }

        custom: Dict[str, Any] = {
            "apiKey": as_text(custom_raw.get("apiKey") or raw_api_key, ""),
            "baseUrl": as_text(custom_raw.get("baseUrl") or raw_base_url, "https://api.openai.com/v1"),
            "model": as_text(custom_raw.get("model") or raw_model, "gpt-4o-mini-tts"),
            "encoding": as_text(custom_raw.get("encoding") or cfg.get("encoding"), "mp3"),
            "rate": as_int(custom_raw.get("rate") if "rate" in custom_raw else cfg.get("rate"), 24000),
            "speedRatio": as_float(
                custom_raw.get("speedRatio") if "speedRatio" in custom_raw else cfg.get("speedRatio"),
                1.0,
            ),
            "narratorVoiceType": as_text(
                custom_raw.get("narratorVoiceType")
                or cfg.get("narratorVoiceType")
                or (
                    raw_voice
                    if provider.startswith("custom_") or provider in {"custom_openai_tts", "openai_tts_compatible", "openai_tts"}
                    else ""
                ),
                "",
            ),
            "dialogueVoiceType": as_text(
                custom_raw.get("dialogueVoiceType") or cfg.get("dialogueVoiceType"),
                "",
            ),
            "dialogueMaleVoiceType": as_text(
                custom_raw.get("dialogueMaleVoiceType") or cfg.get("dialogueMaleVoiceType"),
                "",
            ),
            "dialogueFemaleVoiceType": as_text(
                custom_raw.get("dialogueFemaleVoiceType") or cfg.get("dialogueFemaleVoiceType"),
                "",
            ),
        }

        return {
            "provider": provider,
            "volc": volc,
            "fish": fish,
            "bailian": bailian,
            "custom": custom,
        }

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------

    @staticmethod
    def _looks_like_base64_image(value: str) -> bool:
        candidate = (value or "").strip()
        if len(candidate) < 128:
            return False
        if candidate.startswith(("http://", "https://", "data:image/")):
            return False
        if not re.fullmatch(r"[A-Za-z0-9+/=\s]+", candidate):
            return False
        # 删除空白后长度需要是 4 的倍数，尽量降低误判
        compact = re.sub(r"\s+", "", candidate)
        return len(compact) % 4 == 0

    @staticmethod
    def _is_placeholder_image_url(url: str) -> bool:
        lowered = (url or "").strip().lower()
        return "picsum.photos/" in lowered

    def _normalize_image_result_url(self, result: Dict[str, Any]) -> str:
        if not isinstance(result, dict):
            return ""

        url = str(result.get("url") or result.get("image_url") or result.get("output_url") or "").strip()
        if not url:
            b64 = str(result.get("b64_json") or "").strip()
            if b64:
                url = b64

        if not url:
            data = result.get("data")
            if isinstance(data, list) and data:
                first = data[0] if isinstance(data[0], dict) else {}
                if isinstance(first, dict):
                    url = str(
                        first.get("url")
                        or first.get("image_url")
                        or first.get("b64_json")
                        or ""
                    ).strip()

        if not url:
            return ""
        if url.startswith(("http://", "https://", "data:image/")):
            return url

        if self._looks_like_base64_image(url):
            compact = re.sub(r"\s+", "", url)
            return f"data:image/png;base64,{compact}"

        return url

    def _validate_generated_image_url(
        self,
        url: str,
        *,
        error_code_empty: str,
        context: Optional[Dict[str, Any]] = None,
    ) -> str:
        normalized = (url or "").strip()
        provider = str(getattr(self.image, "provider", "") or "")
        payload_context = {
            "provider": provider,
            **(context or {}),
        }

        if not normalized:
            raise StudioServiceError(
                "图像服务未返回有效图片，请检查模型和提示词后重试",
                error_code=error_code_empty,
                context=payload_context,
            )

        if provider and provider not in {"placeholder", "none"} and self._is_placeholder_image_url(normalized):
            raise StudioServiceError(
                "图像服务返回占位图，通常表示接口调用失败或配置无效",
                error_code="image_placeholder_result",
                context={
                    **payload_context,
                    "url_preview": normalized[:160],
                },
            )

        return normalized

    def _build_element_image_prompt(
        self,
        element: Dict[str, Any],
        series: Optional[Dict[str, Any]] = None,
    ) -> str:
        description = str(element.get("description") or "").strip()
        name = str(element.get("name") or "").strip()
        base_prompt = description or name or "角色概念设定图"

        visual_style = ""
        if isinstance(series, dict):
            visual_style = str(series.get("visual_style") or "").strip()

        style_anchor = visual_style or "国风叙事动画插画风格"
        style_clause = f"整体视觉风格：{style_anchor}。"
        element_type = str(element.get("type") or "").strip().lower()
        character_clause = ""
        mixed_variant_clause = ""
        if element_type == "character":
            character_clause = "角色图必须为单人、单版本设定（年龄/时间/剧情阶段/场景形态）；不得出现同一角色多版本拼贴或多人群像；"
            if self._contains_multi_age_signals(base_prompt):
                mixed_variant_clause = "若原描述含前期/后期等多版本词，仅渲染一个版本的人物立绘；"
        return (
            f"{base_prompt}\n"
            f"{style_clause}"
            "保持与同系列素材一致的线条、色彩、材质语言；"
            f"{character_clause}"
            f"{mixed_variant_clause}"
            "画面必须为统一的二维影视概念插画；"
            "禁止切换为写实照片风、3D渲染、Q版卡通。"
        ).strip()

    def _get_series_visual_style_for_episode(self, episode_id: str) -> str:
        episode = self.storage.get_episode(episode_id)
        if not episode:
            return ""
        volume_id = str(episode.get("volume_id") or "").strip()
        if volume_id:
            volume = self.storage.get_volume(volume_id)
            if volume:
                raw_anchor = volume.get("style_anchor")
                anchor = raw_anchor if isinstance(raw_anchor, dict) else {}
                for key in ("visual_style", "style", "anchor_text"):
                    value = str(anchor.get(key) or "").strip()
                    if value:
                        return value
        series_id = str(episode.get("series_id") or "").strip()
        if not series_id:
            return ""
        series = self.storage.get_series(series_id)
        if not series:
            return ""
        return str(series.get("visual_style") or "").strip()

    def _get_series_by_episode(self, episode_id: str) -> Optional[Dict[str, Any]]:
        episode = self.storage.get_episode(episode_id)
        if not episode:
            return None
        series_id = str(episode.get("series_id") or "").strip()
        if not series_id:
            return None
        return self.storage.get_series(series_id)

    def _extract_digital_human_profiles(self, series: Optional[Dict[str, Any]]) -> List[Dict[str, str]]:
        if not isinstance(series, dict):
            return []
        mode = str((series.get("settings") or {}).get("workbench_mode") or "").strip()
        if mode != "digital_human":
            return []

        series_id = str(series.get("id") or "").strip()
        raw_profiles: List[Dict[str, Any]] = []
        if series_id:
            try:
                db_profiles = self.storage.list_digital_human_profiles(series_id)
                if isinstance(db_profiles, list) and db_profiles:
                    raw_profiles = [item for item in db_profiles if isinstance(item, dict)]
            except Exception:
                raw_profiles = []
        if not raw_profiles:
            settings = series.get("settings")
            if isinstance(settings, dict):
                setting_profiles = settings.get("digital_human_profiles")
                if isinstance(setting_profiles, list):
                    raw_profiles = [item for item in setting_profiles if isinstance(item, dict)]
        if not raw_profiles:
            return []

        profiles: List[Dict[str, str]] = []
        for item in raw_profiles:
            base_name = str(item.get("base_name") or item.get("character_name") or item.get("name") or "").strip()
            stage_label = str(item.get("stage_label") or item.get("stage") or "").strip()
            display_name = str(item.get("display_name") or item.get("name") or "").strip()
            appearance = str(item.get("appearance") or item.get("description") or "").strip()
            voice_profile = str(item.get("voice_profile") or "").strip()
            scene_template = str(item.get("scene_template") or item.get("scene") or "").strip()
            lip_sync_style = str(item.get("lip_sync_style") or item.get("lip_sync") or "").strip()
            if not base_name and not display_name:
                continue
            profiles.append({
                "base_name": base_name or display_name,
                "stage_label": stage_label,
                "display_name": display_name or base_name,
                "appearance": appearance,
                "voice_profile": voice_profile,
                "scene_template": scene_template,
                "lip_sync_style": lip_sync_style,
            })
        return profiles

    def _build_digital_human_constraints(
        self,
        series: Optional[Dict[str, Any]],
        prompt_text: str = "",
    ) -> str:
        profiles = self._extract_digital_human_profiles(series)
        if not profiles:
            return ""

        selected: List[Dict[str, str]] = []
        probe = str(prompt_text or "").strip()
        if probe:
            for profile in profiles:
                tokens = [
                    str(profile.get("display_name") or ""),
                    str(profile.get("base_name") or ""),
                    str(profile.get("stage_label") or ""),
                ]
                if any(token and token in probe for token in tokens):
                    selected.append(profile)
            # 若文本没有命中，则回退前几项，避免约束缺失。
            if not selected:
                selected = profiles[:4]
        else:
            selected = profiles[:4]

        lines: List[str] = []
        for profile in selected:
            display_name = str(profile.get("display_name") or profile.get("base_name") or "角色").strip() or "角色"
            stage = str(profile.get("stage_label") or "").strip()
            appearance = str(profile.get("appearance") or "").strip()
            voice = str(profile.get("voice_profile") or "").strip()
            scene = str(profile.get("scene_template") or "").strip()
            lip_sync = str(profile.get("lip_sync_style") or "").strip()

            chunks: List[str] = []
            if appearance:
                chunks.append(f"形象={appearance}")
            if voice:
                chunks.append(f"音色={voice}")
            if scene:
                chunks.append(f"场景模板={scene}")
            if lip_sync:
                chunks.append(f"口型={lip_sync}")
            if not chunks:
                chunks.append("保持该角色既有设定一致")

            label = f"{display_name}（{stage}）" if stage else display_name
            lines.append(f"- {label}: {'；'.join(chunks)}")

        if not lines:
            return ""
        return (
            "数字人角色阶段约束：保持同一角色在本镜头中的身份、年龄阶段、服装与面部特征连续，"
            "不要混合不同阶段或多人脸。\n"
            + "\n".join(lines)
        )

    def _build_digital_human_constraints_for_episode(self, episode_id: str, prompt_text: str = "") -> str:
        series = self._get_series_by_episode(episode_id)
        return self._build_digital_human_constraints(series, prompt_text)

    def _build_shot_image_prompt(
        self,
        shot: Dict[str, Any],
        raw_prompt: str,
        stage: str = "start_frame",
    ) -> str:
        episode_id = str(shot.get("episode_id") or "").strip()
        resolved_prompt = self._resolve_element_refs(raw_prompt, episode_id).strip()
        style_anchor = self._get_series_visual_style_for_episode(episode_id) or "国风叙事动画插画风格"
        base_rules = (
            f"整体视觉风格：{style_anchor}。"
            "保持与同系列素材一致的角色比例、线条语言、配色与材质；"
            "这是单张关键帧构图，禁止四宫格/分屏/拼贴海报/漫画多格排版；"
            "禁止写实照片风、3D渲染实拍质感、文字水印和字幕。"
        )
        digital_constraints = self._build_digital_human_constraints_for_episode(episode_id, resolved_prompt)

        # 阶段描述（4 个 stage）
        stage_clauses = {
            "start_frame": "该画面用于镜头起始帧，展示动作发生前的初始静态状态。"
                           "聚焦角色初始姿态和场景氛围，不含任何运动。",
            "key_frame":   "该画面用于镜头关键帧，捕捉动作最激烈的高潮瞬间。"
                           "强调动态张力、情绪表达顶点，可含动作模糊效果。",
            "end_frame":   "该画面用于镜头尾帧，展示动作结束后的最终状态。"
                           "保持与起始帧的叙事连续性，聚焦动作结果。",
            "inpaint":     "在保持主体身份与场景连续性的前提下，只修改用户要求的局部区域。",
        }
        stage_clause = stage_clauses.get(stage, stage_clauses["start_frame"])

        # 注入景别/机位/情绪信息到帧提示词
        cinematography_parts = []
        shot_size = str(shot.get("shot_size") or "").strip()
        camera_angle = str(shot.get("camera_angle") or "").strip()
        emotion = str(shot.get("emotion") or "").strip()
        emotion_intensity = shot.get("emotion_intensity", 0)
        if not isinstance(emotion_intensity, (int, float)):
            try:
                emotion_intensity = int(emotion_intensity)
            except (ValueError, TypeError):
                emotion_intensity = 0

        if shot_size:
            cinematography_parts.append(f"景别：{get_shot_size_zh(shot_size)}")
        if camera_angle:
            cinematography_parts.append(f"机位：{get_camera_angle_zh(camera_angle)}")
        if emotion:
            intensity_label = get_emotion_intensity_zh(emotion_intensity)
            cinematography_parts.append(f"情绪：{emotion}（{intensity_label}）")

        cinematography_text = "；".join(cinematography_parts)

        if digital_constraints:
            base_rules = f"{base_rules}\n{digital_constraints}"

        parts = []
        if resolved_prompt:
            parts.append(resolved_prompt)
        if cinematography_text:
            parts.append(cinematography_text)
        parts.append(f"{base_rules}{stage_clause}")

        return "\n".join(parts).strip()

    def _collect_shot_ref_images(
        self,
        shot: Dict[str, Any],
        prompt_text: str,
        include_start_frame: bool = False,
        limit: int = 6,
    ) -> List[str]:
        episode_id = str(shot.get("episode_id") or "").strip()
        images: List[str] = []

        def push(url: Any) -> None:
            text = str(url or "").strip()
            if not text:
                return
            if text in images:
                return
            images.append(text)

        # 优先基于当前提示词提取显式 [SE_xxx] 引用，再退回镜头其他文本字段。
        candidates = [
            str(prompt_text or ""),
            str(shot.get("prompt") or ""),
            str(shot.get("end_prompt") or ""),
            str(shot.get("video_prompt") or ""),
            str(shot.get("description") or ""),
        ]
        for text in candidates:
            for url in self._collect_ref_images(text, episode_id):
                push(url)
                if len(images) >= limit:
                    return images[:limit]

        if include_start_frame:
            push(shot.get("start_image_url"))
            if len(images) >= limit:
                return images[:limit]

        # 若显式引用不足，回退到相邻镜头的首帧，降低同集画风漂移。
        if episode_id and len(images) < 2:
            shots = self.storage.get_shots(episode_id)
            current_id = str(shot.get("id") or "").strip()
            current_index = next(
                (idx for idx, item in enumerate(shots) if str(item.get("id") or "").strip() == current_id),
                -1,
            )
            if current_index >= 0:
                neighbor_indexes = [
                    current_index - 1,
                    current_index + 1,
                    current_index - 2,
                    current_index + 2,
                ]
                for idx in neighbor_indexes:
                    if idx < 0 or idx >= len(shots):
                        continue
                    push(shots[idx].get("start_image_url"))
                    if len(images) >= limit:
                        break

        return images[:limit]

    @staticmethod
    def _build_director_visual_action_text(visual_action: Any) -> str:
        if not isinstance(visual_action, dict):
            return ""

        generated = str(visual_action.get("generated_text") or "").strip()
        if generated:
            return generated

        subject = str(visual_action.get("subject") or "").strip() or "主体"
        blocking = visual_action.get("blocking") if isinstance(visual_action.get("blocking"), dict) else {}
        camera = visual_action.get("camera") if isinstance(visual_action.get("camera"), dict) else {}
        beats = visual_action.get("beats") if isinstance(visual_action.get("beats"), list) else []

        from_pos = str((blocking or {}).get("from") or visual_action.get("from") or "").strip() or "MC"
        to_pos = str((blocking or {}).get("to") or visual_action.get("to") or "").strip() or "TR"
        path = str((blocking or {}).get("path") or "").strip() or "直线"
        shot_size = str((camera or {}).get("shot_size") or "").strip() or "中景"
        angle = str((camera or {}).get("angle") or "").strip() or "平视"
        movement = str((camera or {}).get("movement") or visual_action.get("motion") or "").strip() or "推镜"
        lens = str((camera or {}).get("lens_mm") or "").strip() or "35"
        speed = str((camera or {}).get("speed") or "").strip() or "中"
        beat_items = [str(item).strip() for item in beats if str(item).strip()]
        beats_part = f"关键节拍：{'；'.join(beat_items)}" if beat_items else "关键节拍：无"
        return (
            f"{subject} 从画面 {from_pos} 经 {path} 走位至 {to_pos}；"
            f"运镜采用{movement}，景别{shot_size}，机位{angle}，镜头约 {lens}mm，节奏{speed}。"
            f"{beats_part}。"
        ).strip()

    @staticmethod
    def _normalize_element_base_name(name: str) -> str:
        text = str(name or "").strip()
        if not text:
            return ""
        # 去掉括号内阶段标注，如“石上麻吕（中年期）”/“石上麻吕(中年期)”
        text = re.sub(r"[（(][^（）()]{0,32}[）)]", "", text).strip()
        text = re.sub(r"\s+", "", text)
        return text

    def _collect_character_consistency_refs(
        self,
        element: Dict[str, Any],
        limit: int = 3,
    ) -> List[str]:
        series_id = str(element.get("series_id") or "").strip()
        if not series_id:
            return []
        current_id = str(element.get("id") or "").strip()
        current_name = str(element.get("name") or "").strip()
        base_name = self._normalize_element_base_name(current_name)

        refs: List[str] = []
        siblings = self.storage.get_shared_elements(series_id, element_type="character")
        for sibling in siblings:
            sibling_id = str(sibling.get("id") or "").strip()
            if not sibling_id or sibling_id == current_id:
                continue
            image_url = str(sibling.get("image_url") or "").strip()
            if not image_url:
                continue

            sibling_name = str(sibling.get("name") or "").strip()
            sibling_base = self._normalize_element_base_name(sibling_name)
            if base_name and sibling_base:
                if sibling_base != base_name and base_name not in sibling_name and sibling_base not in current_name:
                    continue
            if image_url not in refs:
                refs.append(image_url)
            if len(refs) >= max(1, int(limit)):
                break
        return refs

    @staticmethod
    def _contains_multi_age_signals(text: str) -> bool:
        candidate = str(text or "")
        if not candidate.strip():
            return False

        # 年龄标识
        age_markers = [
            "幼年", "童年", "少年", "青年", "中年", "老年", "晚年",
            "年轻时", "年老时",
        ]
        # 时间/阶段/场景形态标识
        stage_markers = [
            "前期", "中期", "后期", "初期", "末期", "早期", "晚期",
            "十年后", "多年后", "若干年后",
            "战前", "战后", "回忆", "现实", "白天", "夜晚", "雨夜", "雪夜",
        ]
        hit = [m for m in [*age_markers, *stage_markers] if m in candidate]

        # 常见“成对阶段词”同时出现，直接判定为多版本
        stage_pairs = [
            ("前期", "后期"),
            ("早期", "晚期"),
            ("战前", "战后"),
            ("白天", "夜晚"),
            ("回忆", "现实"),
        ]
        if any(a in candidate and b in candidate for a, b in stage_pairs):
            return True
        return len(set(hit)) >= 2

    @staticmethod
    def _normalize_character_profiles_payload(payload: Any) -> List[Dict[str, Any]]:
        items: Any = payload
        if isinstance(payload, dict):
            maybe = payload.get("items")
            if isinstance(maybe, list):
                items = maybe
            elif isinstance(payload.get("profiles"), list):
                items = payload.get("profiles")

        if not isinstance(items, list):
            return []

        normalized: List[Dict[str, Any]] = []
        seen_names: set[str] = set()
        for raw in items:
            if not isinstance(raw, dict):
                continue
            base_name = str(raw.get("base_name") or raw.get("baseName") or raw.get("character_name") or raw.get("name") or "").strip()
            stage_label = str(raw.get("stage_label") or raw.get("stageLabel") or "").strip()
            explicit_name = str(raw.get("name") or "").strip()
            name = explicit_name or (f"{base_name}（{stage_label}）" if base_name and stage_label else base_name)
            if not name:
                continue
            lowered = name.lower()
            if lowered in seen_names:
                continue
            seen_names.add(lowered)

            description = str(raw.get("description") or "").strip()
            voice_profile = str(raw.get("voice_profile") or raw.get("voiceProfile") or "").strip()
            keywords_raw = raw.get("keywords")
            keywords: List[str] = []
            if isinstance(keywords_raw, list):
                keywords = [str(v).strip() for v in keywords_raw if str(v).strip()]
            elif isinstance(keywords_raw, str) and keywords_raw.strip():
                keywords = [s.strip() for s in keywords_raw.split(",") if s.strip()]

            normalized.append({
                "base_name": base_name or name,
                "stage_label": stage_label,
                "name": name,
                "description": description,
                "voice_profile": voice_profile,
                "keywords": keywords,
            })
        return normalized

    def _build_existing_character_map(self, series_id: str) -> Dict[str, Dict[str, Any]]:
        existing = self.storage.get_shared_elements(series_id, element_type="character")
        result: Dict[str, Dict[str, Any]] = {}
        for item in existing:
            name = str(item.get("name") or "").strip().lower()
            if name and name not in result:
                result[name] = item
        return result

    def _upsert_character_elements(
        self,
        series_id: str,
        profiles: List[Dict[str, Any]],
        dedupe_by_name: bool,
    ) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], int]:
        created_elements: List[Dict[str, Any]] = []
        updated_elements: List[Dict[str, Any]] = []
        skipped = 0

        existing_map = self._build_existing_character_map(series_id)
        for profile in profiles:
            name = str(profile.get("name") or "").strip()
            description = str(profile.get("description") or "").strip()
            voice_profile = str(profile.get("voice_profile") or "").strip()
            if not name:
                skipped += 1
                continue

            existing = existing_map.get(name.lower()) if dedupe_by_name else None
            if existing:
                updates: Dict[str, Any] = {}
                if description:
                    updates["description"] = description
                if voice_profile:
                    updates["voice_profile"] = voice_profile
                if updates:
                    updated = self.storage.update_shared_element(existing["id"], updates)
                    if updated:
                        updated_elements.append(updated)
                else:
                    skipped += 1
                continue

            created = self.storage.add_shared_element(
                series_id=series_id,
                name=name,
                element_type="character",
                description=description,
                voice_profile=voice_profile,
            )
            created_elements.append(created)
            existing_map[name.lower()] = created

        return created_elements, updated_elements, skipped

    @staticmethod
    def _build_split_profile_candidates(
        profiles: List[Dict[str, Any]],
        resolved_map: Dict[str, Dict[str, Any]],
        old_element_id: str,
    ) -> List[Dict[str, Any]]:
        candidates: List[Dict[str, Any]] = []
        seen_ids: set[str] = set()
        for profile in profiles:
            name = str(profile.get("name") or "").strip()
            if not name:
                continue
            row = resolved_map.get(name.lower())
            if not row:
                continue
            element_id = str(row.get("id") or "").strip()
            if not element_id or element_id == old_element_id or element_id in seen_ids:
                continue
            seen_ids.add(element_id)
            keywords = profile.get("keywords")
            safe_keywords = [str(v).strip() for v in keywords] if isinstance(keywords, list) else []
            candidates.append({
                "element_id": element_id,
                "name": name,
                "stage_label": str(profile.get("stage_label") or "").strip(),
                "keywords": [k for k in safe_keywords if k],
            })
        return candidates

    @staticmethod
    def _pick_split_candidate_for_context(
        context_text: str,
        candidates: List[Dict[str, Any]],
    ) -> str:
        if not candidates:
            return ""
        lowered = str(context_text or "").lower()
        best_id = str(candidates[0].get("element_id") or "")
        best_score = -1
        for candidate in candidates:
            score = 0
            stage_label = str(candidate.get("stage_label") or "").strip().lower()
            if stage_label and stage_label in lowered:
                score += 10 + min(len(stage_label), 10)
            name = str(candidate.get("name") or "").strip().lower()
            if name and name in lowered:
                score += 6
            for kw in candidate.get("keywords") or []:
                kw_text = str(kw or "").strip().lower()
                if kw_text and kw_text in lowered:
                    score += 2
            if score > best_score:
                best_score = score
                best_id = str(candidate.get("element_id") or "")
        return best_id

    def _migrate_split_references_in_shots(
        self,
        series_id: str,
        old_element_id: str,
        candidates: List[Dict[str, Any]],
    ) -> Dict[str, Any]:
        token = f"[{old_element_id}]"
        if not candidates:
            return {"updated_shots": 0, "updated_fields": 0}

        updated_shots = 0
        updated_fields = 0
        episodes = self.storage.list_episodes(series_id)
        for episode in episodes:
            episode_id = str(episode.get("id") or "")
            if not episode_id:
                continue
            shots = self.storage.get_shots(episode_id)
            for shot in shots:
                context = " ".join([
                    str(shot.get("name") or ""),
                    str(shot.get("description") or ""),
                    str(shot.get("narration") or ""),
                    str(shot.get("dialogue_script") or ""),
                    str(shot.get("prompt") or ""),
                    str(shot.get("end_prompt") or ""),
                    str(shot.get("video_prompt") or ""),
                ])
                replacement_id = self._pick_split_candidate_for_context(context, candidates)
                if not replacement_id:
                    continue
                replacement_token = f"[{replacement_id}]"
                updates: Dict[str, Any] = {}
                for field in ("prompt", "end_prompt", "video_prompt"):
                    value = str(shot.get(field) or "")
                    if token in value:
                        replaced = value.replace(token, replacement_token)
                        if replaced != value:
                            updates[field] = replaced
                            updated_fields += 1
                if updates:
                    self.storage.update_shot(str(shot.get("id") or ""), updates)
                    updated_shots += 1

        return {"updated_shots": updated_shots, "updated_fields": updated_fields}

    async def import_character_document(
        self,
        series_id: str,
        document_text: str,
        save_to_elements: bool = True,
        dedupe_by_name: bool = True,
    ) -> Dict[str, Any]:
        series = self.storage.get_series(series_id)
        if not series:
            raise StudioServiceError(
                "系列不存在",
                error_code="series_not_found",
                context={"series_id": series_id},
            )
        if not self.llm:
            raise StudioServiceError(
                "Studio LLM 服务未配置，请先在设置中配置 LLM API Key",
                error_code="config_missing_llm",
            )

        text = str(document_text or "").strip()
        if len(text) < 20:
            raise StudioServiceError(
                "角色文档内容过短，请至少提供 20 个字符",
                error_code="character_doc_too_short",
                context={"series_id": series_id},
            )

        visual_style = str(series.get("visual_style") or "").strip() or "未指定"
        prompt = (
            "请从以下“角色设定文档”中拆分出角色清单，适用于 AI 角色立绘制作。\n\n"
            "输出规则：\n"
            "1. 一个条目只允许一个角色+一个版本（年龄/时间段/剧情阶段/关键场景形态）。\n"
            "2. 如果同一角色包含多个版本（如前期/后期、战前/战后、白天/雨夜），必须拆成多个条目。\n"
            "3. 每个条目 description 必须是单版本视觉描述，禁止写“前期/后期混合”。\n"
            "4. 仅输出 JSON，不要输出解释。\n"
            "5. 输出格式：\n"
            "[\n"
            "  {\n"
            "    \"base_name\": \"角色基础名\",\n"
            "    \"stage_label\": \"版本标签（如少年/后期/战后/雨夜，可空）\",\n"
            "    \"name\": \"元素名（建议含版本后缀）\",\n"
            "    \"description\": \"单版本外观描述\",\n"
            "    \"voice_profile\": \"可选\",\n"
            "    \"keywords\": [\"可选标签\"]\n"
            "  }\n"
            "]\n\n"
            f"系列视觉风格：{visual_style}\n"
            f"角色文档：\n{text}"
        )

        raw = await self._llm_call(
            user_prompt=prompt,
            system_prompt="你是影视角色设计总监，擅长将长文档拆分为可执行的角色设定条目。",
            max_tokens=6000,
            temperature=0.35,
        )
        parsed = self._extract_json(raw)
        profiles = self._normalize_character_profiles_payload(parsed)
        if not profiles:
            raise StudioServiceError(
                "角色文档解析失败，未提取到有效角色条目",
                error_code="character_doc_parse_failed",
                context={"series_id": series_id, "preview": (raw or "")[:500]},
            )

        created_elements: List[Dict[str, Any]] = []
        updated_elements: List[Dict[str, Any]] = []
        skipped = 0
        if save_to_elements:
            created_elements, updated_elements, skipped = self._upsert_character_elements(
                series_id=series_id,
                profiles=profiles,
                dedupe_by_name=dedupe_by_name,
            )

        return {
            "series_id": series_id,
            "items": profiles,
            "created": len(created_elements),
            "updated": len(updated_elements),
            "skipped": skipped,
            "created_elements": created_elements,
            "updated_elements": updated_elements,
        }

    async def split_character_element_by_age(
        self,
        element_id: str,
        replace_original: bool = False,
    ) -> Dict[str, Any]:
        element = self.storage.get_shared_element(element_id)
        if not element:
            raise StudioServiceError(
                "元素不存在",
                error_code="element_not_found",
                context={"element_id": element_id},
            )
        if str(element.get("type") or "") != "character":
            raise StudioServiceError(
                "仅角色类型支持按阶段拆分",
                error_code="invalid_element_type",
                context={"element_id": element_id, "type": element.get("type")},
            )
        if not self.llm:
            raise StudioServiceError(
                "Studio LLM 服务未配置，请先在设置中配置 LLM API Key",
                error_code="config_missing_llm",
            )

        base_name = str(element.get("name") or "").strip()
        description = str(element.get("description") or "").strip()
        voice_profile = str(element.get("voice_profile") or "").strip()
        series = self.storage.get_series(element.get("series_id")) if element.get("series_id") else None
        visual_style = str((series or {}).get("visual_style") or "").strip() or "未指定"

        prompt = (
            "请判断以下角色设定是否混入多个版本（年龄/时间/剧情阶段/场景形态），并按版本拆分。\n\n"
            "要求：\n"
            "1. 如果本来就是单版本，返回 need_split=false，profiles 可为空。\n"
            "2. 如果包含多个版本，返回 need_split=true，并输出 profiles。\n"
            "3. profiles 中每项必须是单角色、单版本，name 建议使用“角色名（版本）”。\n"
            "4. 只输出 JSON，格式：\n"
            "{\n"
            "  \"need_split\": true,\n"
            "  \"reason\": \"...\",\n"
            "  \"profiles\": [\n"
            "    {\"base_name\":\"...\",\"stage_label\":\"...\",\"name\":\"...\",\"description\":\"...\",\"voice_profile\":\"...\",\"keywords\":[]}\n"
            "  ]\n"
            "}\n\n"
            f"系列视觉风格：{visual_style}\n"
            f"角色名：{base_name}\n"
            f"描述：{description}\n"
            f"音色：{voice_profile}"
        )

        raw = await self._llm_call(
            user_prompt=prompt,
            system_prompt="你是角色设定编辑，擅长将混合版本设定拆分为可生成的单版本条目。",
            max_tokens=3200,
            temperature=0.25,
        )
        parsed = self._extract_json(raw)
        payload = parsed if isinstance(parsed, dict) else {"profiles": parsed}
        need_split = bool(payload.get("need_split"))
        profiles = self._normalize_character_profiles_payload(payload)

        # 兜底：LLM 未给 need_split，但文本明显多版本且拆出了 >=2 个条目，也视为可拆分
        if not need_split and len(profiles) >= 2 and self._contains_multi_age_signals(description):
            need_split = True

        if not need_split or len(profiles) < 2:
            return {
                "element_id": element_id,
                "need_split": False,
                "reason": str(payload.get("reason") or "当前角色描述已接近单版本，无需拆分"),
                "profiles": profiles,
                "created": 0,
                "updated": 0,
            }

        series_id = str(element.get("series_id") or "")
        created_elements, updated_elements, _ = self._upsert_character_elements(
            series_id=series_id,
            profiles=profiles,
            dedupe_by_name=True,
        )

        deleted_original = False
        migrated_refs: Dict[str, Any] = {"updated_shots": 0, "updated_fields": 0}
        if replace_original:
            resolved_map = self._build_existing_character_map(series_id)
            candidates = self._build_split_profile_candidates(profiles, resolved_map, element_id)
            migrated_refs = self._migrate_split_references_in_shots(
                series_id=series_id,
                old_element_id=element_id,
                candidates=candidates,
            )
            deleted_original = self.storage.delete_shared_element(element_id)

        return {
            "element_id": element_id,
            "need_split": True,
            "reason": str(payload.get("reason") or ""),
            "profiles": profiles,
            "created": len(created_elements),
            "updated": len(updated_elements),
            "deleted_original": deleted_original,
            "migrated_refs": migrated_refs,
            "created_elements": created_elements,
            "updated_elements": updated_elements,
        }

    @staticmethod
    def _normalize_video_status(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"completed", "succeeded", "success", "done", "video_ready"}:
            return "completed"
        if raw in {"processing", "pending", "submitted", "queued", "running", "in_progress", "video_processing"}:
            return "processing"
        if raw in {"failed", "error", "timeout", "cancelled", "canceled", "video_failed", "video_timeout"}:
            return "error"
        return raw or "unknown"

    @staticmethod
    def _extract_video_url(payload: Any) -> str:
        if not isinstance(payload, dict):
            return ""

        for key in ("video_url", "videoUrl", "url"):
            value = payload.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

        output = payload.get("output")
        if isinstance(output, dict):
            for key in ("video_url", "videoUrl", "url"):
                value = output.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

        data = payload.get("data")
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict):
                for key in ("video_url", "videoUrl", "url"):
                    value = first.get(key)
                    if isinstance(value, str) and value.strip():
                        return value.strip()

        return ""

    def _video_poll_interval_seconds(self) -> float:
        raw = self.generation_defaults.get("video_poll_interval_seconds", 5)
        try:
            value = float(raw)
        except Exception:
            value = 5.0
        return max(1.0, min(30.0, value))

    def _video_poll_timeout_seconds(self) -> float:
        raw = self.generation_defaults.get("video_poll_timeout_seconds", 600)
        try:
            value = float(raw)
        except Exception:
            value = 600.0
        return max(30.0, min(1800.0, value))

    async def _wait_video_result(
        self,
        shot_id: str,
        initial_result: Dict[str, Any],
    ) -> Dict[str, Any]:
        if not isinstance(initial_result, dict):
            raise StudioServiceError(
                "视频服务返回格式无效",
                error_code="video_invalid_result",
                context={"shot_id": shot_id},
            )

        task_id = str(initial_result.get("task_id") or initial_result.get("taskId") or "").strip()
        first_url = self._extract_video_url(initial_result)
        first_status = self._normalize_video_status(initial_result.get("status"))

        if first_url:
            return {
                "task_id": task_id,
                "video_url": first_url,
                "status": "completed",
                "poll_elapsed": 0.0,
                "raw": initial_result,
            }

        if first_status == "error":
            raise StudioServiceError(
                f"视频生成失败: {str(initial_result.get('error') or '未知错误')}",
                error_code="video_generation_failed",
                context={"shot_id": shot_id, "task_id": task_id or None},
            )

        if first_status == "completed" and not first_url and not task_id:
            raise StudioServiceError(
                "视频任务已完成但未返回视频地址",
                error_code="video_result_missing_url",
                context={"shot_id": shot_id},
            )

        if not task_id and first_status != "processing":
            raise StudioServiceError(
                "视频任务未返回 task_id，无法继续查询状态",
                error_code="video_missing_task_id",
                context={"shot_id": shot_id, "status": first_status},
            )

        if not task_id:
            raise StudioServiceError(
                "视频任务未返回 task_id，无法继续查询状态",
                error_code="video_missing_task_id",
                context={"shot_id": shot_id},
            )

        interval = self._video_poll_interval_seconds()
        timeout = self._video_poll_timeout_seconds()
        elapsed = 0.0
        last_error = ""

        while elapsed < timeout:
            await asyncio.sleep(interval)
            elapsed += interval

            try:
                polled = await self.video.check_task_status(task_id)
            except Exception as e:
                last_error = str(e)
                continue

            polled_status = self._normalize_video_status(polled.get("status"))
            polled_url = self._extract_video_url(polled)

            if polled_url:
                return {
                    "task_id": task_id,
                    "video_url": polled_url,
                    "status": "completed",
                    "poll_elapsed": round(elapsed, 2),
                    "raw": polled,
                }

            if polled_status == "error":
                raise StudioServiceError(
                    f"视频生成失败: {str(polled.get('error') or '未知错误')}",
                    error_code="video_generation_failed",
                    context={"shot_id": shot_id, "task_id": task_id},
                )

            if polled_status == "completed":
                raise StudioServiceError(
                    "视频任务已完成但未返回视频地址",
                    error_code="video_result_missing_url",
                    context={"shot_id": shot_id, "task_id": task_id},
                )

        raise StudioServiceError(
            "视频生成超时，请稍后重试",
            error_code="video_generation_timeout",
            context={
                "shot_id": shot_id,
                "task_id": task_id,
                "timeout_seconds": timeout,
                "last_error": last_error or None,
            },
        )

    @staticmethod
    def _extract_json(reply: str) -> Optional[Any]:
        """从 LLM 回复中提取 JSON（支持 ```json 代码块 / 裸 JSON）"""
        if not reply or not reply.strip():
            return None

        def try_load(raw: str) -> Optional[Any]:
            s = raw.strip().lstrip("\ufeff")
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                pass
            # 智能引号修复
            s = (
                s.replace("\u201c", '"').replace("\u201d", '"')
                .replace("\u201e", '"').replace("\u201f", '"')
                .replace("\u2018", "'").replace("\u2019", "'")
            )
            # 移除尾部逗号
            s = re.sub(r",\s*([}\]])", r"\1", s)
            try:
                return json.loads(s)
            except Exception:
                pass
            return None

        # 1) ```json ... ```
        m = re.search(r"```(?:json|JSON)\s*([\s\S]*?)\s*```", reply)
        if m:
            data = try_load(m.group(1))
            if data is not None:
                return data

        # 2) ``` ... ```
        m = re.search(r"```\s*([\s\S]*?)\s*```", reply)
        if m:
            data = try_load(m.group(1))
            if data is not None:
                return data

        # 3) 直接尝试整体解析
        data = try_load(reply)
        if data is not None:
            return data

        # 4) 寻找最外层 { } 或 [ ]
        for opener, closer in [("{", "}"), ("[", "]")]:
            start = reply.find(opener)
            end = reply.rfind(closer)
            if start != -1 and end > start:
                data = try_load(reply[start : end + 1])
                if data is not None:
                    return data

        return None

    async def _llm_call(
        self,
        user_prompt: str,
        system_prompt: str = "",
        max_tokens: int = 8000,
        temperature: float = 0.7,
    ) -> str:
        """调用 LLM 并返回原始文本"""
        if not self.llm:
            raise StudioServiceError(
                "Studio LLM 服务未配置，请先在设置中配置 LLM API Key",
                error_code="config_missing_llm",
            )
        return await self.llm.generate_text(
            prompt=user_prompt,
            system_prompt=system_prompt,
            temperature=temperature,
            max_tokens=max_tokens,
        )

    async def optimize_prompt_with_llm(
        self,
        prompt: str,
        analysis: Dict[str, Any],
    ) -> Dict[str, Any]:
        """调用 LLM 进行提示词安全改写，失败时返回原文。"""
        fallback = (prompt or "").strip()
        if not fallback:
            return {"optimized_prompt": fallback, "used_llm": False}
        if not self.llm:
            return {"optimized_prompt": fallback, "used_llm": False}

        system_prompt, user_prompt = build_prompt_optimize_llm_payload(fallback, analysis)
        try:
            raw = await self._llm_call(
                user_prompt=user_prompt,
                system_prompt=system_prompt,
                max_tokens=1200,
                temperature=0.35,
            )
            parsed = self._extract_json(raw)
            if isinstance(parsed, dict):
                candidate = parsed.get("optimized_prompt") or parsed.get("prompt")
                if isinstance(candidate, str) and candidate.strip():
                    return {"optimized_prompt": candidate.strip(), "used_llm": True}

            plain = (raw or "").strip()
            if plain:
                return {"optimized_prompt": plain, "used_llm": True}
        except Exception:
            pass
        return {"optimized_prompt": fallback, "used_llm": False}

    def _default_frame_size(self) -> tuple[int, int]:
        raw_w = self.generation_defaults.get("frame_width", 1280)
        raw_h = self.generation_defaults.get("frame_height", 720)
        try:
            w = max(64, int(raw_w))
        except Exception:
            w = 1280
        try:
            h = max(64, int(raw_h))
        except Exception:
            h = 720
        return w, h

    def _default_video_duration(self) -> float:
        raw = self.generation_defaults.get("video_duration_seconds", 6.0)
        try:
            return max(1.0, float(raw))
        except Exception:
            return 6.0

    def _resolve_video_generate_audio(self, override: Optional[bool] = None) -> bool:
        if isinstance(override, bool):
            return override

        raw = self.generation_defaults.get("video_generate_audio")
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, (int, float)):
            return bool(raw)
        if isinstance(raw, str):
            lowered = raw.strip().lower()
            if lowered in {"1", "true", "yes", "on"}:
                return True
            if lowered in {"0", "false", "no", "off"}:
                return False
        return True

    def _record_episode_history_safe(self, episode_id: str, action: str) -> None:
        try:
            self.storage.record_episode_history(episode_id, action)
        except Exception as e:
            print(f"[Studio] 记录历史失败（{action} / {episode_id}）: {e}")

    @staticmethod
    def _render_prompt_template(template: str, variables: Dict[str, Any]) -> str:
        """渲染 {var} 占位符，并兼容旧模板中的双花括号转义。"""
        if not isinstance(template, str):
            return ""

        def replace_match(match: re.Match[str]) -> str:
            key = match.group(1)
            if key not in variables:
                return match.group(0)
            value = variables.get(key)
            return "" if value is None else str(value)

        rendered = re.sub(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", replace_match, template)
        return rendered.replace("{{", "{").replace("}}", "}")

    def _resolve_prompt_bundle(self, module_key: str, series_id: Optional[str] = None) -> Dict[str, str]:
        """解析指定模块的系统/用户提示词（默认 -> 全局 -> 系列级覆盖）。"""
        base = DEFAULT_CUSTOM_PROMPTS.get(module_key, {})
        system_prompt = str(base.get("system", "") or "")
        user_prompt = str(base.get("user", "") or "")

        global_bundle = self.custom_prompts.get(module_key) if isinstance(self.custom_prompts, dict) else None
        if isinstance(global_bundle, dict):
            global_system = str(global_bundle.get("system", "") or "")
            global_user = str(global_bundle.get("user", "") or "")
            if global_system.strip():
                system_prompt = global_system
            if global_user.strip():
                user_prompt = global_user

        if series_id:
            series = self.storage.get_series(series_id)
            if series and isinstance(series.get("settings"), dict):
                series_custom_prompts = normalize_custom_prompts(
                    series.get("settings", {}).get("custom_prompts"),
                )
                series_bundle = series_custom_prompts.get(module_key)
                if isinstance(series_bundle, dict):
                    series_system = str(series_bundle.get("system", "") or "")
                    series_user = str(series_bundle.get("user", "") or "")
                    if series_system.strip():
                        system_prompt = series_system
                    if series_user.strip():
                        user_prompt = series_user

        return {"system": system_prompt, "user": user_prompt}

    # ------------------------------------------------------------------
    # A. 大脚本分幕拆解
    # ------------------------------------------------------------------

    async def split_script_to_acts(
        self,
        full_script: str,
        preferences: Dict[str, Any],
    ) -> List[Dict[str, Any]]:
        """LLM 分析脚本结构，识别自然分幕点。

        返回:
            [{"act_number", "title", "summary", "script_excerpt",
              "suggested_duration_seconds", "key_characters"}, ...]
        """
        target_count = preferences.get("target_episode_count", 0)
        episode_duration = preferences.get("episode_duration_seconds", 90)
        visual_style = preferences.get("visual_style", "电影级")

        prompt_bundle = self._resolve_prompt_bundle("script_split")
        user_prompt = self._render_prompt_template(
            prompt_bundle["user"],
            {
                "full_script": full_script,
                "target_episode_count": target_count,
                "episode_duration_seconds": episode_duration,
                "visual_style": visual_style,
            },
        )

        print("[Studio] 调用 LLM 进行脚本分幕拆解...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=prompt_bundle["system"],
            max_tokens=int(self.generation_defaults.get("split_max_tokens", 8000)),
            temperature=0.5,
        )

        acts = self._extract_json(raw)
        if not isinstance(acts, list) or not acts:
            raise StudioServiceError(
                "LLM 分幕结果解析失败",
                error_code="llm_invalid_split_output",
                context={"preview": raw[:500]},
            )

        # 确保格式完整
        for i, act in enumerate(acts):
            act.setdefault("act_number", i + 1)
            act.setdefault("title", f"第{i + 1}幕")
            act.setdefault("summary", "")
            act.setdefault("script_excerpt", "")
            act.setdefault("suggested_duration_seconds", episode_duration)
            act.setdefault("key_characters", [])

        print(f"[Studio] 分幕完成，共 {len(acts)} 幕")
        return acts

    # ------------------------------------------------------------------
    # B. 共享元素提取
    # ------------------------------------------------------------------

    async def extract_shared_elements(
        self,
        full_script: str,
        acts: List[Dict[str, Any]],
        visual_style: str = "",
    ) -> List[Dict[str, Any]]:
        """从完整脚本提取贯穿全剧的角色/场景/道具。

        返回:
            [{"name", "type", "description", "voice_profile", "appears_in_acts"}, ...]
        """
        acts_summary = "\n".join(
            f"幕{a.get('act_number', i+1)}「{a.get('title', '')}」: {a.get('summary', '')}"
            for i, a in enumerate(acts)
        )

        prompt_bundle = self._resolve_prompt_bundle("element_extraction")
        user_prompt = self._render_prompt_template(
            prompt_bundle["user"],
            {
                "full_script": full_script,
                "acts_summary": acts_summary,
                "visual_style": visual_style or "未指定",
            },
        )

        print("[Studio] 调用 LLM 进行共享元素提取...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=prompt_bundle["system"],
            max_tokens=8000,
            temperature=0.5,
        )

        elements = self._extract_json(raw)
        if not isinstance(elements, list):
            raise StudioServiceError(
                "LLM 元素提取结果解析失败",
                error_code="llm_invalid_elements_output",
                context={"preview": raw[:500]},
            )

        for el in elements:
            el.setdefault("name", "未知")
            el.setdefault("type", "character")
            el.setdefault("description", "")
            el.setdefault("voice_profile", "")
            el.setdefault("appears_in_acts", [])

        print(f"[Studio] 元素提取完成，共 {len(elements)} 个元素")
        return elements

    # ------------------------------------------------------------------
    # C. 创建系列（编排 A + B）
    # ------------------------------------------------------------------

    async def create_series(
        self,
        name: str,
        full_script: str,
        preferences: Dict[str, Any],
    ) -> Dict[str, Any]:
        """完整流程：分幕 → 提取元素 → 写入 SQLite → 返回系列概览"""

        # 1) 分幕
        acts = await self.split_script_to_acts(full_script, preferences)

        # 2) 提取共享元素
        visual_style = preferences.get("visual_style", "")
        elements = await self.extract_shared_elements(full_script, acts, visual_style=visual_style)

        workbench_mode = str(preferences.get("workbench_mode") or "longform").strip() or "longform"
        if workbench_mode not in {"longform", "short_video", "digital_human"}:
            workbench_mode = "longform"
        workspace_id = str(preferences.get("workspace_id") or "").strip()
        settings_payload: Dict[str, Any] = {"workbench_mode": workbench_mode}
        if isinstance(preferences.get("settings"), dict):
            settings_payload.update(preferences["settings"])
            settings_payload["workbench_mode"] = workbench_mode

        # 3) 写入数据库 —— 系列
        series = self.storage.create_series(
            name=name,
            workspace_id=workspace_id,
            description=preferences.get("description", ""),
            source_script=full_script,
            series_bible=preferences.get("series_bible", ""),
            visual_style=visual_style,
            settings=settings_payload,
        )
        series_id = series["id"]
        print(f"[Studio] 系列已创建: {series_id} ({name})")

        # 4) 写入集
        created_episodes = []
        for act in acts:
            ep = self.storage.create_episode(
                series_id=series_id,
                act_number=act["act_number"],
                title=act.get("title", ""),
                summary=act.get("summary", ""),
                script_excerpt=act.get("script_excerpt", ""),
                target_duration_seconds=act.get("suggested_duration_seconds", 90),
            )
            created_episodes.append(ep)

        # 5) 写入共享元素
        created_elements = []
        # 构建 act_number → episode_id 映射
        act_ep_map: Dict[int, str] = {
            ep["act_number"]: ep["id"] for ep in created_episodes
        }
        for el in elements:
            appears_episodes = [
                act_ep_map[an]
                for an in el.get("appears_in_acts", [])
                if an in act_ep_map
            ]
            se = self.storage.add_shared_element(
                series_id=series_id,
                name=el["name"],
                element_type=el["type"],
                description=el.get("description", ""),
                voice_profile=el.get("voice_profile", ""),
                appears_in_episodes=appears_episodes,
            )
            created_elements.append(se)

        return {
            "series": series,
            "episodes": created_episodes,
            "shared_elements": created_elements,
        }

    # ------------------------------------------------------------------
    # D. 分集规划
    # ------------------------------------------------------------------

    async def plan_episode(self, episode_id: str) -> Dict[str, Any]:
        """为单集生成详细分镜规划"""
        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )

        series = self.storage.get_series(episode["series_id"])
        if not series:
            raise StudioServiceError(
                f"系列 {episode['series_id']} 不存在",
                error_code="series_not_found",
                context={"series_id": episode["series_id"]},
            )

        # 获取共享元素
        shared_elements = self.storage.get_shared_elements(series["id"])
        elements_list = "\n".join(
            f"- [{el['id']}] {el['name']}（{el['type']}）: {el['description']}"
            + (f" | 音色: {el['voice_profile']}" if el.get("voice_profile") else "")
            for el in shared_elements
        )
        digital_human_constraints = self._build_digital_human_constraints(
            series,
            str(episode.get("script_excerpt") or ""),
        )
        shared_elements_list = elements_list or "（暂无共享元素）"
        if digital_human_constraints:
            shared_elements_list = f"{shared_elements_list}\n\n{digital_human_constraints}"

        # 获取前后集摘要
        all_episodes = self.storage.list_episodes(series["id"])
        act_num = episode["act_number"]
        prev_summary = "（这是第一集，没有前情）"
        next_summary = "（这是最后一集，没有后续）"
        for ep in all_episodes:
            if ep["act_number"] == act_num - 1:
                prev_summary = f"第{ep['act_number']}集「{ep['title']}」: {ep['summary']}"
            if ep["act_number"] == act_num + 1:
                next_summary = f"第{ep['act_number']}集「{ep['title']}」: {ep['summary']}"

        target_duration = episode.get("target_duration_seconds", 90)
        suggested_shots = max(5, math.ceil(target_duration / 7))

        prompt_bundle = self._resolve_prompt_bundle("episode_planning", series_id=series["id"])
        user_prompt = self._render_prompt_template(
            prompt_bundle["user"],
            {
                "series_name": series["name"],
                "act_number": act_num,
                "episode_title": episode.get("title", ""),
                "series_bible": series.get("series_bible", ""),
                "visual_style": series.get("visual_style", ""),
                "shared_elements_list": shared_elements_list,
                "digital_human_constraints": digital_human_constraints or "（无）",
                "prev_summary": prev_summary,
                "script_excerpt": episode.get("script_excerpt", ""),
                "next_summary": next_summary,
                "target_duration_seconds": target_duration,
                "suggested_shot_count": suggested_shots,
            },
        )

        print(f"[Studio] 调用 LLM 规划第 {act_num} 集 ({episode_id})...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=prompt_bundle["system"],
            max_tokens=int(self.generation_defaults.get("plan_max_tokens", 16000)),
            temperature=0.7,
        )

        plan = self._extract_json(raw)
        if not isinstance(plan, dict):
            raise StudioServiceError(
                "LLM 分集规划结果解析失败",
                error_code="llm_invalid_plan_output",
                context={"episode_id": episode_id, "preview": raw[:500]},
            )

        # 保存 creative_brief
        brief = plan.get("creative_brief", {})
        self.storage.update_episode(episode_id, {
            "creative_brief": brief,
            "status": "planned",
        })

        # 写入新元素到 episode_elements
        for new_el in plan.get("new_elements", []):
            self.storage.add_episode_element(
                episode_id=episode_id,
                name=new_el.get("name", ""),
                element_type=new_el.get("type", "character"),
                description=new_el.get("description", ""),
                voice_profile=new_el.get("voice_profile", ""),
            )

        # 继承共享元素到集
        self.storage.inherit_shared_elements(episode_id, series["id"])

        # 写入镜头
        shots_data = []
        sort_order = 0
        for segment in plan.get("segments", []):
            seg_name = segment.get("name", "")
            for shot in segment.get("shots", []):
                sort_order += 1
                shots_data.append({
                    "segment_name": seg_name,
                    "sort_order": sort_order,
                    "name": shot.get("name", ""),
                    "shot_type": shot.get("type", "standard"),
                    "duration": shot.get("duration", 6.0),
                    "description": shot.get("description", ""),
                    "prompt": shot.get("prompt", ""),
                    "end_prompt": shot.get("end_prompt", ""),
                    "video_prompt": shot.get("video_prompt", ""),
                    "narration": shot.get("narration", ""),
                    "dialogue_script": shot.get("dialogue_script", ""),
                    "shot_size": shot.get("shot_size", ""),
                    "camera_angle": shot.get("camera_angle", ""),
                    "camera_movement": shot.get("camera_movement", ""),
                    "emotion": shot.get("emotion", ""),
                    "emotion_intensity": shot.get("emotion_intensity", 0),
                })

        # 清空已有镜头再写入
        existing = self.storage.get_shots(episode_id)
        for s in existing:
            self.storage.delete_shot(s["id"])

        created_shots = self.storage.bulk_add_shots(episode_id, shots_data)
        print(f"[Studio] 第 {act_num} 集规划完成，共 {len(created_shots)} 个镜头")
        self._record_episode_history_safe(episode_id, "plan")

        return {
            "episode_id": episode_id,
            "creative_brief": brief,
            "new_elements": plan.get("new_elements", []),
            "shots_count": len(created_shots),
            "shots": created_shots,
        }

    # ------------------------------------------------------------------
    # E. 单集增强（Script Doctor）
    # ------------------------------------------------------------------

    async def enhance_episode(
        self,
        episode_id: str,
        mode: str = "refine",
    ) -> Dict[str, Any]:
        """对单集分镜做 Script Doctor 式增强"""
        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )

        series = self.storage.get_series(episode["series_id"])
        if not series:
            raise StudioServiceError(
                f"系列 {episode['series_id']} 不存在",
                error_code="series_not_found",
                context={"series_id": episode["series_id"]},
            )

        shared_elements = self.storage.get_shared_elements(series["id"])
        elements_list = "\n".join(
            f"- [{el['id']}] {el['name']}（{el['type']}）: {el['description']}"
            for el in shared_elements
        )
        digital_human_constraints = self._build_digital_human_constraints(
            series,
            str(episode.get("script_excerpt") or ""),
        )
        shared_elements_list = elements_list or "（暂无共享元素）"
        if digital_human_constraints:
            shared_elements_list = f"{shared_elements_list}\n\n{digital_human_constraints}"

        # 获取当前集的完整快照用于输入
        snapshot = self.storage.get_episode_snapshot(episode_id)
        episode_json = json.dumps(snapshot, ensure_ascii=False, indent=2)

        prompt_bundle = self._resolve_prompt_bundle("episode_enhance", series_id=series["id"])
        user_prompt = self._render_prompt_template(
            prompt_bundle["user"],
            {
                "series_bible": series.get("series_bible", ""),
                "shared_elements_list": shared_elements_list,
                "digital_human_constraints": digital_human_constraints or "（无）",
                "episode_json": episode_json,
                "mode": mode,
            },
        )

        print(f"[Studio] Script Doctor 增强 {episode_id}（{mode}模式）...")
        raw = await self._llm_call(
            user_prompt=user_prompt,
            system_prompt=prompt_bundle["system"],
            max_tokens=int(self.generation_defaults.get("enhance_max_tokens", 16000)),
            temperature=0.7,
        )

        patch = self._extract_json(raw)
        if not isinstance(patch, dict):
            raise StudioServiceError(
                "LLM 增强结果解析失败",
                error_code="llm_invalid_enhance_output",
                context={"episode_id": episode_id, "preview": raw[:500]},
            )

        patched_count = 0
        added_count = 0

        # 应用 shots_patch（修改已有镜头）
        for sp in patch.get("shots_patch", []):
            shot_id = sp.get("id")
            if not shot_id:
                continue
            updates = {}
            for field in ("description", "prompt", "end_prompt", "video_prompt", "narration", "dialogue_script", "duration",
                          "shot_size", "camera_angle", "camera_movement", "emotion", "emotion_intensity"):
                if field in sp:
                    updates[field] = sp[field]
            if updates:
                self.storage.update_shot(shot_id, updates)
                patched_count += 1

        # 应用 add_shots（新增镜头），仅 expand 模式
        if mode == "expand":
            existing_shots = self.storage.get_shots(episode_id)
            ordered_ids = [s["id"] for s in existing_shots]
            base_sort_order = len(existing_shots) + 1000

            for add_item in patch.get("add_shots", []):
                after_id = add_item.get("after_shot_id", "")
                shot_data = add_item.get("shot", {})
                insert_at = len(ordered_ids)
                if after_id and after_id in ordered_ids:
                    insert_at = ordered_ids.index(after_id) + 1

                created = self.storage.add_shot(
                    episode_id=episode_id,
                    segment_name=shot_data.get("segment_name", ""),
                    sort_order=base_sort_order + added_count,
                    name=shot_data.get("name", ""),
                    shot_type=shot_data.get("type", "standard"),
                    duration=shot_data.get("duration", 5.0),
                    description=shot_data.get("description", ""),
                    prompt=shot_data.get("prompt", ""),
                    video_prompt=shot_data.get("video_prompt", ""),
                    narration=shot_data.get("narration", ""),
                    dialogue_script=shot_data.get("dialogue_script", ""),
                    shot_size=shot_data.get("shot_size", ""),
                    camera_angle=shot_data.get("camera_angle", ""),
                    camera_movement=shot_data.get("camera_movement", ""),
                    emotion=shot_data.get("emotion", ""),
                    emotion_intensity=int(shot_data.get("emotion_intensity", 0) or 0),
                )
                ordered_ids.insert(insert_at, created["id"])
                added_count += 1

            if added_count > 0:
                self.storage.reorder_shots(episode_id, ordered_ids)

        print(f"[Studio] 增强完成: 修改 {patched_count} 个镜头, 新增 {added_count} 个镜头")
        self._record_episode_history_safe(episode_id, f"enhance_{mode}")
        return {
            "episode_id": episode_id,
            "mode": mode,
            "patched": patched_count,
            "added": added_count,
        }

    # ------------------------------------------------------------------
    # F. 资产生成
    # ------------------------------------------------------------------

    async def generate_element_image(
        self,
        element_id: str,
        width: int = 1024,
        height: int = 1024,
        use_reference: bool = False,
        reference_mode: str = "none",
    ) -> Dict[str, Any]:
        """为共享元素生成参考图"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        el = self.storage.get_shared_element(element_id)
        if not el:
            raise StudioServiceError(
                f"共享元素 {element_id} 不存在",
                error_code="element_not_found",
                context={"element_id": element_id},
            )

        default_w, default_h = self._default_frame_size()
        width = int(width or default_w)
        height = int(height or default_h)

        series = self.storage.get_series(el.get("series_id")) if el.get("series_id") else None
        prompt = self._build_element_image_prompt(el, series)
        element_type = str(el.get("type") or "").strip().lower()
        ref_images: List[str] = []
        mode = (reference_mode or "").strip().lower()
        if mode not in {"none", "light", "full"}:
            mode = "light" if use_reference else "none"
        if use_reference and mode == "none":
            mode = "light"

        # 限制一致性参考图：仅角色类型允许，且默认 light 模式只带 1 张图
        if element_type != "character":
            mode = "none"

        raw_refs: List[str] = []
        source_refs = el.get("reference_images") or []
        if isinstance(source_refs, list):
            raw_refs = [str(u).strip() for u in source_refs if isinstance(u, str) and str(u).strip()]
        current_image = str(el.get("image_url") or "").strip()
        sibling_refs = self._collect_character_consistency_refs(el, limit=3) if element_type == "character" else []

        if mode == "light":
            if current_image:
                ref_images = [current_image]
            elif raw_refs:
                ref_images = [raw_refs[0]]
            elif sibling_refs:
                ref_images = [sibling_refs[0]]
        elif mode == "full":
            if current_image:
                ref_images.append(current_image)
            for url in raw_refs:
                if url and url not in ref_images:
                    ref_images.append(url)
                if len(ref_images) >= 3:
                    break
            for url in sibling_refs:
                if url and url not in ref_images:
                    ref_images.append(url)
                if len(ref_images) >= 3:
                    break

        result = await self.image.generate(
            prompt=prompt,
            reference_images=ref_images if ref_images else None,
            width=width,
            height=height,
        )

        url = self._normalize_image_result_url(result)
        url = self._validate_generated_image_url(
            url,
            error_code_empty="element_image_empty_result",
            context={"element_id": element_id, "stage": "element"},
        )

        # 更新元素的 image_url 和 image_history
        history = el.get("image_history") or []
        if el.get("image_url"):
            history.append(el["image_url"])
        self.storage.update_shared_element(element_id, {
            "image_url": url,
            "image_history": history,
        })

        return {
            "element_id": element_id,
            "image_url": url,
            "reference_mode_applied": mode,
            "reference_images_used": len(ref_images),
            "result": result,
        }

    async def generate_shot_frame(
        self,
        shot_id: str,
        width: int = 1280,
        height: int = 720,
    ) -> Dict[str, Any]:
        """为镜头生成起始帧"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        default_w, default_h = self._default_frame_size()
        width = int(width or default_w)
        height = int(height or default_h)

        prompt_text = str(shot.get("prompt") or shot.get("description") or "").strip()
        if not prompt_text:
            raise StudioServiceError(
                f"镜头 {shot_id} 缺少起始帧提示词",
                error_code="shot_missing_prompt",
                context={"shot_id": shot_id},
            )

        # 解析引用并注入系列画风锚点，避免同集画风漂移。
        prompt = self._build_shot_image_prompt(shot, prompt_text, stage="start_frame")
        ref_images = self._collect_shot_ref_images(
            shot=shot,
            prompt_text=prompt_text,
            include_start_frame=False,
            limit=6,
        )

        result = await self.image.generate(
            prompt=prompt,
            negative_prompt=DEFAULT_NEGATIVE_PROMPT,
            reference_images=ref_images if ref_images else None,
            width=width,
            height=height,
        )

        url = self._normalize_image_result_url(result)
        url = self._validate_generated_image_url(
            url,
            error_code_empty="shot_frame_empty_result",
            context={"shot_id": shot_id, "stage": "frame"},
        )
        history = shot.get("frame_history") or []
        if not isinstance(history, list):
            history = []
        if shot.get("start_image_url"):
            history.append(shot["start_image_url"])
        self.storage.update_shot(shot_id, {
            "start_image_url": url,
            "frame_history": history,
        })

        return {"shot_id": shot_id, "start_image_url": url, "result": result}

    async def generate_shot_end_frame(
        self,
        shot_id: str,
        width: int = 1280,
        height: int = 720,
    ) -> Dict[str, Any]:
        """为镜头生成尾帧。"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        default_w, default_h = self._default_frame_size()
        width = int(width or default_w)
        height = int(height or default_h)

        prompt_text = (shot.get("end_prompt") or shot.get("video_prompt") or shot.get("prompt") or "").strip()
        if not prompt_text:
            raise StudioServiceError(
                f"镜头 {shot_id} 缺少尾帧提示词",
                error_code="shot_missing_end_prompt",
                context={"shot_id": shot_id},
            )
        prompt = self._build_shot_image_prompt(shot, prompt_text, stage="end_frame")
        ref_images = self._collect_shot_ref_images(
            shot=shot,
            prompt_text=prompt_text,
            include_start_frame=True,
            limit=6,
        )

        result = await self.image.generate(
            prompt=prompt,
            negative_prompt=DEFAULT_NEGATIVE_PROMPT,
            reference_images=ref_images if ref_images else None,
            width=width,
            height=height,
        )

        url = self._normalize_image_result_url(result)
        url = self._validate_generated_image_url(
            url,
            error_code_empty="shot_end_frame_empty_result",
            context={"shot_id": shot_id, "stage": "end_frame"},
        )
        self.storage.update_shot(shot_id, {"end_image_url": url})

        return {"shot_id": shot_id, "end_image_url": url, "result": result}

    async def generate_shot_key_frame(
        self,
        shot_id: str,
        width: int = 1280,
        height: int = 720,
    ) -> Dict[str, Any]:
        """为镜头生成关键帧（动作高潮瞬间）"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        default_w, default_h = self._default_frame_size()
        width = int(width or default_w)
        height = int(height or default_h)

        # 优先使用专用关键帧提示词，回退到首帧提示词
        prompt_text = str(
            shot.get("key_frame_prompt") or shot.get("prompt") or shot.get("description") or ""
        ).strip()
        if not prompt_text:
            raise StudioServiceError(
                f"镜头 {shot_id} 缺少关键帧提示词",
                error_code="shot_missing_key_frame_prompt",
                context={"shot_id": shot_id},
            )

        prompt = self._build_shot_image_prompt(shot, prompt_text, stage="key_frame")
        ref_images = self._collect_shot_ref_images(
            shot=shot,
            prompt_text=prompt_text,
            include_start_frame=True,
            limit=6,
        )

        result = await self.image.generate(
            prompt=prompt,
            negative_prompt=DEFAULT_NEGATIVE_PROMPT,
            reference_images=ref_images if ref_images else None,
            width=width,
            height=height,
        )

        url = self._normalize_image_result_url(result)
        url = self._validate_generated_image_url(
            url,
            error_code_empty="shot_key_frame_empty_result",
            context={"shot_id": shot_id, "stage": "key_frame"},
        )
        self.storage.update_shot(shot_id, {"key_frame_url": url})

        return {"shot_id": shot_id, "key_frame_url": url, "result": result}

    async def inpaint_shot_frame(
        self,
        shot_id: str,
        edit_prompt: str,
        mask_data: Optional[str] = None,
        width: Optional[int] = None,
        height: Optional[int] = None,
    ) -> Dict[str, Any]:
        """镜头首帧局部重绘（若后端不支持原生 inpaint，则回退为参考图重生成）。"""
        if not self.image:
            raise StudioServiceError(
                "Studio 图像服务未配置",
                error_code="config_missing_image",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        current_url = (shot.get("start_image_url") or "").strip()
        if not current_url:
            raise StudioServiceError(
                f"镜头 {shot_id} 尚未生成起始帧，请先生成图片",
                error_code="shot_missing_start_frame",
                context={"shot_id": shot_id},
            )

        base_prompt = (edit_prompt or "").strip()
        if not base_prompt:
            base_prompt = (shot.get("prompt") or shot.get("description") or "").strip()
        if not base_prompt:
            raise StudioServiceError(
                "局部重绘提示词不能为空",
                error_code="invalid_inpaint_prompt",
                context={"shot_id": shot_id},
            )

        default_w, default_h = self._default_frame_size()
        frame_w = int(width or default_w)
        frame_h = int(height or default_h)

        prompt = self._build_shot_image_prompt(shot, base_prompt, stage="inpaint")
        ref_images = self._collect_shot_ref_images(
            shot=shot,
            prompt_text=base_prompt,
            include_start_frame=True,
            limit=8,
        )
        if current_url:
            ref_images = [current_url, *[u for u in ref_images if u != current_url]]

        mode = "fallback_regenerate"
        note = "当前图像服务未实现 inpaint，已回退为参考图重生成"

        native_inpaint = getattr(self.image, "inpaint", None)
        if callable(native_inpaint):
            try:
                native_result = await native_inpaint(
                    image_url=current_url,
                    prompt=prompt,
                    mask_data=mask_data,
                    width=frame_w,
                    height=frame_h,
                )
                if isinstance(native_result, str):
                    result = {"url": native_result}
                elif isinstance(native_result, dict):
                    result = native_result
                else:
                    result = {}
                mode = "inpaint"
                note = ""
            except NotImplementedError:
                result = await self.image.generate(
                    prompt=prompt,
                    reference_images=ref_images if ref_images else [current_url],
                    width=frame_w,
                    height=frame_h,
                )
            except TypeError as te:
                # 兼容 inpaint 方法签名不一致的实现
                if "unexpected keyword" not in str(te):
                    raise
                result = await self.image.generate(
                    prompt=prompt,
                    reference_images=ref_images if ref_images else [current_url],
                    width=frame_w,
                    height=frame_h,
                )
            except Exception:
                raise
        else:
            result = await self.image.generate(
                prompt=prompt,
                reference_images=ref_images if ref_images else [current_url],
                width=frame_w,
                height=frame_h,
            )

        url = self._normalize_image_result_url(result)
        url = self._validate_generated_image_url(
            url,
            error_code_empty="inpaint_empty_result",
            context={"shot_id": shot_id, "mode": mode, "stage": "inpaint"},
        )

        history = shot.get("frame_history") or []
        if not isinstance(history, list):
            history = []
        if current_url:
            history.append(current_url)
        self.storage.update_shot(shot_id, {
            "start_image_url": url,
            "frame_history": history,
        })

        payload: Dict[str, Any] = {
            "shot_id": shot_id,
            "start_image_url": url,
            "mode": mode,
            "result": result,
        }
        if note:
            payload["note"] = note
        return payload

    async def generate_shot_video(
        self,
        shot_id: str,
        video_generate_audio: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """为镜头生成视频"""
        if not self.video:
            raise StudioServiceError(
                "Studio 视频服务未配置",
                error_code="config_missing_video",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )
        if not shot.get("start_image_url"):
            raise StudioServiceError(
                f"镜头 {shot_id} 尚未生成起始帧，请先生成图片",
                error_code="shot_missing_start_frame",
                context={"shot_id": shot_id},
            )

        raw_video_prompt = str(shot.get("video_prompt") or shot.get("prompt", "")).strip()
        director_text = self._build_director_visual_action_text(shot.get("visual_action"))
        if director_text:
            if raw_video_prompt:
                raw_video_prompt = f"{raw_video_prompt}\n导演运镜要求：{director_text}"
            else:
                raw_video_prompt = f"导演运镜要求：{director_text}"
        elif shot.get("camera_movement"):
            # 回退到扁平化运镜字段
            movement_desc = get_camera_movement_desc(str(shot["camera_movement"]))
            if movement_desc and raw_video_prompt:
                raw_video_prompt = f"{raw_video_prompt}\n运镜：{movement_desc}"
            elif movement_desc:
                raw_video_prompt = f"运镜：{movement_desc}"

        # 注入情绪氛围
        emotion = str(shot.get("emotion") or "").strip()
        emotion_intensity = shot.get("emotion_intensity", 0)
        if not isinstance(emotion_intensity, (int, float)):
            try:
                emotion_intensity = int(emotion_intensity)
            except (ValueError, TypeError):
                emotion_intensity = 0
        if emotion:
            intensity_label = get_emotion_intensity_zh(emotion_intensity)
            raw_video_prompt = f"{raw_video_prompt}\n情绪氛围：{emotion}（{intensity_label}）"

        # 注入时长约束
        duration = shot.get("duration", self._default_video_duration())
        raw_video_prompt = f"{raw_video_prompt}\n镜头时长严格为 {duration} 秒"

        # 禁止文字规则
        raw_video_prompt = f"{raw_video_prompt}\n画面中禁止出现任何字幕、水印、文字标识"

        digital_human_constraints = self._build_digital_human_constraints_for_episode(
            str(shot.get("episode_id") or ""),
            raw_video_prompt,
        )
        if digital_human_constraints:
            if raw_video_prompt:
                raw_video_prompt = f"{raw_video_prompt}\n{digital_human_constraints}"
            else:
                raw_video_prompt = digital_human_constraints
        video_prompt = self._resolve_element_refs(raw_video_prompt, shot["episode_id"])

        self.storage.update_shot(shot_id, {"status": "generating"})

        try:
            duration = shot.get("duration", self._default_video_duration())
            resolved_video_generate_audio = self._resolve_video_generate_audio(video_generate_audio)
            existing_video = shot.get("video_url") or ""
            video_history = shot.get("video_history") or []
            if not isinstance(video_history, list):
                video_history = []
            submit_result = await self.video.generate(
                image_url=shot["start_image_url"],
                prompt=video_prompt,
                duration=duration,
                generate_audio=resolved_video_generate_audio,
                reference_mode="first_last" if shot.get("end_image_url") else "single",
                first_frame_url=shot.get("start_image_url"),
                last_frame_url=shot.get("end_image_url"),
            )

            final_result = await self._wait_video_result(shot_id, submit_result)
            video_url = str(final_result.get("video_url") or "").strip()

            if existing_video and existing_video != video_url:
                video_history.append(existing_video)

            self.storage.update_shot(shot_id, {
                "video_url": video_url,
                "video_history": video_history,
                "status": "completed",
            })
            return {
                "shot_id": shot_id,
                "video_url": video_url,
                "task_id": final_result.get("task_id"),
                "poll_elapsed": final_result.get("poll_elapsed", 0),
                "video_generate_audio": resolved_video_generate_audio,
                "audio_disabled": bool(submit_result.get("audio_disabled")) if isinstance(submit_result, dict) and "audio_disabled" in submit_result else None,
                "result": final_result.get("raw") or submit_result,
            }

        except Exception as e:
            self.storage.update_shot(shot_id, {"status": "failed"})
            raise

    async def generate_shot_audio(
        self,
        shot_id: str,
        voice_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """为镜头生成旁白/对白音频"""
        if not self.tts:
            raise StudioServiceError(
                "Studio TTS 服务未配置",
                error_code="config_missing_tts",
            )

        shot = self.storage.get_shot(shot_id)
        if not shot:
            raise StudioServiceError(
                f"镜头 {shot_id} 不存在",
                error_code="shot_not_found",
                context={"shot_id": shot_id},
            )

        # 优先使用旁白，其次对白
        text = shot.get("narration", "").strip()
        if not text:
            text = shot.get("dialogue_script", "").strip()
        if not text:
            return {"shot_id": shot_id, "audio_url": "", "message": "无旁白/对白文本"}

        role = "narration" if str(shot.get("narration") or "").strip() else "dialogue"
        provider = str(self.tts_provider or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
        provider_defaults = self._resolve_provider_tts_defaults(provider)
        selected_voice = self._resolve_tts_voice(
            provider=provider,
            role=role,
            text=text,
            provider_defaults=provider_defaults,
            override_voice=voice_type,
        )
        encoding = self._normalize_tts_encoding(provider_defaults.get("encoding"))
        speed_ratio = self._normalize_tts_speed(provider_defaults.get("speedRatio"))
        rate = self._normalize_tts_rate(provider_defaults.get("rate"))

        audio_data, _ = await self._synthesize_with_provider_tts(
            provider=provider,
            text=text,
            voice=selected_voice,
            encoding=encoding,
            speed_ratio=speed_ratio,
            rate=rate,
        )

        # 保存音频文件
        import os
        audio_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "studio_audio")
        os.makedirs(audio_dir, exist_ok=True)
        ext = self._audio_extension_for_encoding(encoding)
        audio_path = os.path.join(audio_dir, f"{shot_id}.{ext}")
        with open(audio_path, "wb") as f:
            f.write(audio_data)

        audio_url = f"/data/studio_audio/{shot_id}.{ext}"
        self.storage.update_shot(shot_id, {"audio_url": audio_url})

        return {
            "shot_id": shot_id,
            "audio_url": audio_url,
            "provider": provider,
            "voice_type": selected_voice,
            "encoding": encoding,
        }

    def _resolve_provider_tts_defaults(self, provider: str) -> Dict[str, Any]:
        cfg = self.tts_defaults if isinstance(self.tts_defaults, dict) else {}
        if provider.startswith("fish"):
            return cfg.get("fish") or {}
        if provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}:
            return cfg.get("bailian") or {}
        if provider.startswith("custom_") or provider in {"custom_openai_tts", "openai_tts_compatible", "openai_tts"}:
            return cfg.get("custom") or {}
        return cfg.get("volc") or {}

    @staticmethod
    def _normalize_tts_encoding(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"mp3", "wav", "pcm", "opus"}:
            return raw
        return "mp3"

    @staticmethod
    def _audio_extension_for_encoding(encoding: str) -> str:
        enc = (encoding or "mp3").strip().lower()
        if enc == "opus":
            return "opus"
        if enc == "wav":
            return "wav"
        if enc == "pcm":
            return "pcm"
        return "mp3"

    @staticmethod
    def _normalize_tts_rate(value: Any) -> int:
        try:
            rate = int(value)
            return rate if rate > 0 else 24000
        except Exception:
            return 24000

    @staticmethod
    def _normalize_tts_speed(value: Any) -> float:
        try:
            speed = float(value)
            return speed if speed > 0 else 1.0
        except Exception:
            return 1.0

    def _resolve_tts_voice(
        self,
        *,
        provider: str,
        role: str,
        text: str,
        provider_defaults: Dict[str, Any],
        override_voice: Optional[str] = None,
    ) -> str:
        manual = str(override_voice or "").strip()
        if manual:
            return manual

        narrator_voice = str(provider_defaults.get("narratorVoiceType") or "").strip()
        dialogue_voice = str(provider_defaults.get("dialogueVoiceType") or "").strip()
        dialogue_male_voice = str(provider_defaults.get("dialogueMaleVoiceType") or "").strip()
        dialogue_female_voice = str(provider_defaults.get("dialogueFemaleVoiceType") or "").strip()

        selected = ""
        if role == "narration":
            selected = narrator_voice or dialogue_voice
        else:
            gender = VolcTTSService.detect_gender(text)
            if gender == "male":
                selected = dialogue_male_voice or dialogue_voice or narrator_voice
            elif gender == "female":
                selected = dialogue_female_voice or dialogue_voice or narrator_voice
            else:
                selected = dialogue_voice or narrator_voice or dialogue_male_voice or dialogue_female_voice

        if selected:
            return selected

        if provider == "volc_tts_v1_http":
            return VolcTTSService.auto_pick_voice_type(
                role=role,
                description=text,
            )

        if provider.startswith("fish"):
            raise StudioServiceError(
                "Fish TTS 未配置默认 reference_id，请在 Studio 设置里填写旁白/对白音色",
                error_code="tts_missing_voice",
                context={"provider": provider},
            )
        if provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}:
            raise StudioServiceError(
                "阿里百炼 TTS 未配置默认 voice，请在 Studio 设置里填写旁白/对白音色",
                error_code="tts_missing_voice",
                context={"provider": provider},
            )
        raise StudioServiceError(
            "自定义 TTS 未配置默认 voice，请在 Studio 设置里填写旁白/对白音色",
            error_code="tts_missing_voice",
            context={"provider": provider},
        )

    async def _synthesize_with_provider_tts(
        self,
        *,
        provider: str,
        text: str,
        voice: str,
        encoding: str,
        speed_ratio: float,
        rate: int,
    ) -> Tuple[bytes, int]:
        if provider == "volc_tts_v1_http":
            if not isinstance(self.tts, VolcTTSService):
                raise StudioServiceError(
                    "Volc TTS 服务未初始化",
                    error_code="config_missing_tts",
                    context={"provider": provider},
                )
            return await self.tts.synthesize(
                text=text,
                voice_type=voice,
                encoding=encoding,
                speed_ratio=speed_ratio,
                rate=rate,
            )

        if provider.startswith("fish"):
            if not isinstance(self.tts, FishTTSService):
                raise StudioServiceError(
                    "Fish TTS 服务未初始化",
                    error_code="config_missing_tts",
                    context={"provider": provider},
                )
            return await self.tts.synthesize(
                text=text,
                reference_id=voice,
                encoding=encoding,
                speed_ratio=speed_ratio,
                rate=rate,
            )

        if provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}:
            if not isinstance(self.tts, DashScopeTTSService):
                raise StudioServiceError(
                    "阿里百炼 TTS 服务未初始化",
                    error_code="config_missing_tts",
                    context={"provider": provider},
                )
            return await self.tts.synthesize(
                text=text,
                voice=voice,
                encoding=encoding,
                speed_ratio=speed_ratio,
                rate=rate,
            )

        if not isinstance(self.tts, OpenAITTSService):
            raise StudioServiceError(
                "自定义 TTS 服务未初始化",
                error_code="config_missing_tts",
                context={"provider": provider},
            )
        return await self.tts.synthesize(
            text=text,
            voice=voice,
            encoding=encoding,
            speed_ratio=speed_ratio,
        )

    async def batch_generate_episode(
        self,
        episode_id: str,
        stages: Optional[List[str]] = None,
        parallel: Optional[Dict[str, Any]] = None,
        video_generate_audio: Optional[bool] = None,
        progress_callback: Optional[Callable[[Dict[str, Any]], Awaitable[None] | None]] = None,
    ) -> Dict[str, Any]:
        """批量生成单集资产

        stages 可包含: "elements", "frames", "end_frames", "videos", "audio"
        默认全部执行。
        """
        if stages is None:
            stages = ["elements", "frames", "key_frames", "end_frames", "videos", "audio"]

        parallel_cfg = parallel if isinstance(parallel, dict) else {}
        resolved_video_generate_audio = self._resolve_video_generate_audio(video_generate_audio)

        def _to_limit(value: Any, fallback: int) -> int:
            try:
                parsed = int(value)
            except Exception:
                parsed = fallback
            return max(1, parsed)

        image_max_concurrency = _to_limit(parallel_cfg.get("image_max_concurrency"), 3)
        video_max_concurrency = _to_limit(parallel_cfg.get("video_max_concurrency"), 2)
        global_max_concurrency = _to_limit(parallel_cfg.get("global_max_concurrency"), 4)
        global_sem = asyncio.Semaphore(global_max_concurrency)
        counter_lock = asyncio.Lock()

        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )

        result: Dict[str, Any] = {"episode_id": episode_id, "stages": {}}

        async def emit(event: Dict[str, Any]) -> None:
            if not progress_callback:
                return
            maybe = progress_callback(event)
            if inspect.isawaitable(maybe):
                await maybe

        # 预估总任务数（用于前端进度显示）
        initial_shots = self.storage.get_shots(episode_id)
        precomputed_totals: Dict[str, int] = {}
        if "elements" in stages:
            series_id = episode["series_id"]
            precomputed_totals["elements"] = len([el for el in self.storage.get_shared_elements(series_id) if not el.get("image_url")])
        if "frames" in stages:
            precomputed_totals["frames"] = len([shot for shot in initial_shots if not shot.get("start_image_url")])
        if "key_frames" in stages:
            precomputed_totals["key_frames"] = len([shot for shot in initial_shots if shot.get("key_frame_prompt") and not shot.get("key_frame_url")])
        if "end_frames" in stages:
            precomputed_totals["end_frames"] = len([shot for shot in initial_shots if shot.get("end_prompt") and not shot.get("end_image_url")])
        if "videos" in stages:
            precomputed_totals["videos"] = len([
                shot for shot in initial_shots
                if (shot.get("start_image_url") or ("frames" in stages and not shot.get("start_image_url")))
                and not shot.get("video_url")
            ])
        if "audio" in stages:
            precomputed_totals["audio"] = len([
                shot for shot in initial_shots
                if ((shot.get("narration") or "").strip() or (shot.get("dialogue_script") or "").strip())
                and not shot.get("audio_url")
            ])
        total_assets = sum(precomputed_totals.values())
        processed_assets = 0
        failed_assets = 0

        await emit({
            "type": "start",
            "episode_id": episode_id,
            "stages": stages,
            "total": total_assets,
            "video_generate_audio": resolved_video_generate_audio,
            "parallel": {
                "image_max_concurrency": image_max_concurrency,
                "video_max_concurrency": video_max_concurrency,
                "global_max_concurrency": global_max_concurrency,
            },
        })

        def item_percent() -> int:
            if total_assets <= 0:
                return 100
            return int(round((processed_assets / total_assets) * 100))

        async def run_stage_concurrent(
            *,
            stage: str,
            items: List[Any],
            stage_limit: int,
            get_item_id: Callable[[Any], str],
            get_item_name: Callable[[Any], str],
            worker: Callable[[Any], Awaitable[Dict[str, Any]]],
        ) -> List[Dict[str, Any]]:
            nonlocal processed_assets, failed_assets
            stage_total = len(items)
            stage_sem = asyncio.Semaphore(max(1, stage_limit))
            stage_stats = {
                "queued": stage_total,
                "running": 0,
                "completed": 0,
                "failed": 0,
            }
            await emit({
                "type": "stage_start",
                "stage": stage,
                "stage_total": stage_total,
                "total": total_assets,
                **stage_stats,
            })
            if stage_total <= 0:
                return []

            async def run_one(index: int, item: Any) -> Tuple[int, Dict[str, Any]]:
                nonlocal processed_assets, failed_assets
                item_id = get_item_id(item)
                item_name = get_item_name(item)
                async with counter_lock:
                    stage_stats["queued"] = max(0, stage_stats["queued"] - 1)
                    stage_stats["running"] += 1
                    processed_snapshot = processed_assets
                    metrics_snapshot = dict(stage_stats)

                await emit({
                    "type": "item_start",
                    "stage": stage,
                    "item_id": item_id,
                    "item_name": item_name,
                    "stage_index": index,
                    "stage_total": stage_total,
                    "processed": processed_snapshot,
                    "total": total_assets,
                    "percent": item_percent(),
                    **metrics_snapshot,
                })

                ok = True
                error_message: Optional[str] = None
                payload: Dict[str, Any]
                try:
                    async with global_sem:
                        async with stage_sem:
                            payload = await worker(item)
                except Exception as e:
                    ok = False
                    error_message = str(e)
                    payload = {"error": error_message}

                async with counter_lock:
                    stage_stats["running"] = max(0, stage_stats["running"] - 1)
                    if ok:
                        stage_stats["completed"] += 1
                    else:
                        stage_stats["failed"] += 1
                        failed_assets += 1
                    processed_assets += 1
                    processed_snapshot = processed_assets
                    metrics_snapshot = dict(stage_stats)

                await emit({
                    "type": "item_complete",
                    "stage": stage,
                    "item_id": item_id,
                    "item_name": item_name,
                    "stage_index": index,
                    "stage_total": stage_total,
                    "ok": ok,
                    "error": error_message,
                    "processed": processed_snapshot,
                    "total": total_assets,
                    "percent": item_percent(),
                    **metrics_snapshot,
                })

                if ok:
                    return index, payload
                fail_key = "element_id" if stage == "elements" else "shot_id"
                return index, {
                    fail_key: item_id,
                    "error": error_message or "unknown_error",
                }

            tasks = [asyncio.create_task(run_one(index, item)) for index, item in enumerate(items, start=1)]
            pairs = await asyncio.gather(*tasks)
            pairs.sort(key=lambda pair: pair[0])
            return [item for _, item in pairs]

        # 1) 生成共享元素参考图
        if "elements" in stages:
            series_id = episode["series_id"]
            elements = self.storage.get_shared_elements(series_id)
            element_targets = [el for el in elements if not el.get("image_url")]
            elem_results = await run_stage_concurrent(
                stage="elements",
                items=element_targets,
                stage_limit=image_max_concurrency,
                get_item_id=lambda el: str(el.get("id") or ""),
                get_item_name=lambda el: str(el.get("name") or el.get("id") or "未命名元素"),
                worker=lambda el: self.generate_element_image(str(el.get("id") or "")),
            )
            result["stages"]["elements"] = elem_results

        shots = self.storage.get_shots(episode_id)

        # 2) 生成起始帧
        if "frames" in stages:
            frame_targets = [shot for shot in shots if not shot.get("start_image_url")]
            frame_results = await run_stage_concurrent(
                stage="frames",
                items=frame_targets,
                stage_limit=image_max_concurrency,
                get_item_id=lambda shot_item: str(shot_item.get("id") or ""),
                get_item_name=lambda shot_item: str(shot_item.get("name") or shot_item.get("id") or "未命名镜头"),
                worker=lambda shot_item: self.generate_shot_frame(str(shot_item.get("id") or "")),
            )
            result["stages"]["frames"] = frame_results

        # 2.3) 生成关键帧
        if "key_frames" in stages:
            shots = self.storage.get_shots(episode_id)
            key_frame_targets = [shot for shot in shots if shot.get("key_frame_prompt") and not shot.get("key_frame_url")]
            key_frame_results = await run_stage_concurrent(
                stage="key_frames",
                items=key_frame_targets,
                stage_limit=image_max_concurrency,
                get_item_id=lambda shot_item: str(shot_item.get("id") or ""),
                get_item_name=lambda shot_item: str(shot_item.get("name") or shot_item.get("id") or "未命名镜头"),
                worker=lambda shot_item: self.generate_shot_key_frame(str(shot_item.get("id") or "")),
            )
            result["stages"]["key_frames"] = key_frame_results

        # 2.5) 生成尾帧
        if "end_frames" in stages:
            end_frame_results = []
            shots = self.storage.get_shots(episode_id)
            end_frame_targets = [shot for shot in shots if shot.get("end_prompt") and not shot.get("end_image_url")]
            stage_total = len(end_frame_targets)
            await emit({"type": "stage_start", "stage": "end_frames", "stage_total": stage_total, "total": total_assets})
            for index, shot in enumerate(end_frame_targets, start=1):
                await emit({
                    "type": "item_start",
                    "stage": "end_frames",
                    "item_id": shot["id"],
                    "item_name": shot.get("name") or shot["id"],
                    "stage_index": index,
                    "stage_total": stage_total,
                    "processed": processed_assets,
                    "total": total_assets,
                    "percent": item_percent(),
                })
                ok = True
                error_message: Optional[str] = None
                try:
                    r = await self.generate_shot_end_frame(shot["id"])
                    end_frame_results.append(r)
                except Exception as e:
                    ok = False
                    error_message = str(e)
                    failed_assets += 1
                    end_frame_results.append({"shot_id": shot["id"], "error": error_message})
                processed_assets += 1
                await emit({
                    "type": "item_complete",
                    "stage": "end_frames",
                    "item_id": shot["id"],
                    "item_name": shot.get("name") or shot["id"],
                    "stage_index": index,
                    "stage_total": stage_total,
                    "ok": ok,
                    "error": error_message,
                    "processed": processed_assets,
                    "total": total_assets,
                    "percent": item_percent(),
                })
            result["stages"]["end_frames"] = end_frame_results

        # 3) 生成视频
        if "videos" in stages:
            # 刷新 shots（起始帧 URL 可能已更新）
            shots = self.storage.get_shots(episode_id)
            video_targets = [shot for shot in shots if not shot.get("video_url")]
            video_results = await run_stage_concurrent(
                stage="videos",
                items=video_targets,
                stage_limit=video_max_concurrency,
                get_item_id=lambda shot_item: str(shot_item.get("id") or ""),
                get_item_name=lambda shot_item: str(shot_item.get("name") or shot_item.get("id") or "未命名镜头"),
                worker=lambda shot_item: self.generate_shot_video(
                    str(shot_item.get("id") or ""),
                    video_generate_audio=resolved_video_generate_audio,
                ),
            )
            result["stages"]["videos"] = video_results

        # 4) 生成音频
        if "audio" in stages:
            shots = self.storage.get_shots(episode_id)
            audio_targets = [
                shot for shot in shots
                if ((shot.get("narration") or "").strip() or (shot.get("dialogue_script") or "").strip())
                and not shot.get("audio_url")
            ]
            audio_results = await run_stage_concurrent(
                stage="audio",
                items=audio_targets,
                stage_limit=max(1, image_max_concurrency),
                get_item_id=lambda shot_item: str(shot_item.get("id") or ""),
                get_item_name=lambda shot_item: str(shot_item.get("name") or shot_item.get("id") or "未命名镜头"),
                worker=lambda shot_item: self.generate_shot_audio(str(shot_item.get("id") or "")),
            )
            result["stages"]["audio"] = audio_results

        # 更新集状态
        self.storage.update_episode(episode_id, {"status": "in_progress"})
        self._record_episode_history_safe(episode_id, "batch_generate")

        await emit({
            "type": "done",
            "episode_id": episode_id,
            "processed": processed_assets,
            "failed": failed_assets,
            "total": total_assets,
            "percent": 100 if total_assets > 0 else 100,
        })

        return result

    # ------------------------------------------------------------------
    # 元素引用解析
    # ------------------------------------------------------------------

    def _resolve_element_refs(self, text: str, episode_id: str) -> str:
        """将 [SE_XXX] 引用替换为元素的实际描述"""
        if not text:
            return text

        episode = self.storage.get_episode(episode_id)
        if not episode:
            return text

        elements = self.storage.get_shared_elements(episode["series_id"])
        id_to_desc = {el["id"]: el["description"] for el in elements}

        def replacer(m: re.Match) -> str:
            eid = m.group(1)
            return id_to_desc.get(eid, m.group(0))

        return re.sub(r"\[(SE_[a-zA-Z0-9]+)\]", replacer, text)

    def _collect_ref_images(self, text: str, episode_id: str) -> List[str]:
        """从 prompt 中提取 [SE_XXX] 引用的元素参考图 URL"""
        if not text:
            return []

        episode = self.storage.get_episode(episode_id)
        if not episode:
            return []

        elements = self.storage.get_shared_elements(episode["series_id"])
        id_to_img = {el["id"]: el.get("image_url", "") for el in elements}

        refs = re.findall(r"\[(SE_[a-zA-Z0-9]+)\]", text)
        images = []
        for ref_id in refs:
            img = id_to_img.get(ref_id, "")
            if img:
                images.append(img)
        return images

    # ------------------------------------------------------------------
    # 查询/导出
    # ------------------------------------------------------------------

    def list_digital_human_profiles(self, series_id: str) -> List[Dict[str, Any]]:
        series = self.storage.get_series(series_id)
        if not series:
            raise StudioServiceError(
                f"系列 {series_id} 不存在",
                error_code="series_not_found",
                context={"series_id": series_id},
            )
        profiles = self.storage.list_digital_human_profiles(series_id)
        if profiles:
            return profiles

        # 兼容旧数据：如果历史上写在 settings 里，回填到实体表并返回。
        settings = series.get("settings") if isinstance(series.get("settings"), dict) else {}
        legacy = settings.get("digital_human_profiles") if isinstance(settings, dict) else None
        if isinstance(legacy, list) and legacy:
            normalized = [item for item in legacy if isinstance(item, dict)]
            if normalized:
                saved = self.storage.replace_digital_human_profiles(series_id, normalized)
                return saved
        return []

    def save_digital_human_profiles(self, series_id: str, profiles: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        series = self.storage.get_series(series_id)
        if not series:
            raise StudioServiceError(
                f"系列 {series_id} 不存在",
                error_code="series_not_found",
                context={"series_id": series_id},
            )
        normalized = [item for item in profiles if isinstance(item, dict)]
        saved = self.storage.replace_digital_human_profiles(series_id, normalized)

        # 同步清理 settings 中历史字段，避免双写冲突。
        settings = series.get("settings") if isinstance(series.get("settings"), dict) else {}
        if isinstance(settings, dict) and "digital_human_profiles" in settings:
            next_settings = dict(settings)
            next_settings.pop("digital_human_profiles", None)
            self.storage.update_series(series_id, {"settings": next_settings})

        return saved

    def get_series_detail(self, series_id: str) -> Optional[Dict[str, Any]]:
        """获取系列完整详情（含集列表和共享元素）"""
        series = self.storage.get_series(series_id)
        if not series:
            return None
        volumes = self.storage.list_volumes(series_id)
        episodes = self.storage.list_episodes(series_id)
        elements = self.storage.get_shared_elements(series_id)
        digital_human_profiles = self.storage.list_digital_human_profiles(series_id)
        return {
            **series,
            "volumes": volumes,
            "episodes": episodes,
            "shared_elements": elements,
            "digital_human_profiles": digital_human_profiles,
        }

    def get_episode_detail(self, episode_id: str) -> Optional[Dict[str, Any]]:
        """获取集完整详情（含镜头和集元素）"""
        episode = self.storage.get_episode(episode_id)
        if not episode:
            return None
        shots = self.storage.get_shots(episode_id)
        ep_elements = self.storage.get_episode_elements(episode_id)
        return {
            **episode,
            "shots": shots,
            "episode_elements": ep_elements,
        }

    def get_episode_history(
        self,
        episode_id: str,
        limit: int = 50,
        include_snapshot: bool = False,
    ) -> List[Dict[str, Any]]:
        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )
        return self.storage.list_episode_history(
            episode_id,
            limit=limit,
            include_snapshot=include_snapshot,
        )

    def restore_episode_history(self, episode_id: str, history_id: str) -> Dict[str, Any]:
        episode = self.storage.get_episode(episode_id)
        if not episode:
            raise StudioServiceError(
                f"集 {episode_id} 不存在",
                error_code="episode_not_found",
                context={"episode_id": episode_id},
            )
        restored = self.storage.restore_episode_from_history(episode_id, history_id)
        if not restored:
            raise StudioServiceError(
                "历史记录不存在或无法恢复",
                error_code="history_not_found",
                context={"episode_id": episode_id, "history_id": history_id},
            )
        self._record_episode_history_safe(episode_id, f"restore_{history_id}")
        return restored
