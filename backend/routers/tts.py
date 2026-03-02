"""TTS routes: /api/tts/*, /api/fish/*."""

from typing import Optional, List, Dict, Any
import io
from fastapi import APIRouter, HTTPException, UploadFile, File, Form
from fastapi.responses import StreamingResponse

from services.storage_service import storage
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

from schemas.settings import TTSConfig, TestTTSRequest

router = APIRouter(prefix="/api", tags=["tts"])


def _get_fish_service_from_settings() -> FishAudioService:
    settings = storage.get_module_settings() or storage.get_settings() or {}
    cfg = TTSConfig.model_validate(settings.get("tts") or {})
    fish_cfg = cfg.fish
    api_key = str(fish_cfg.apiKey or "").strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="缺少 Fish API Key：请在设置中填写 Fish.apiKey")
    base_url = str(fish_cfg.baseUrl or "").strip() or "https://api.fish.audio"
    return FishAudioService(FishAudioConfig(api_key=api_key, base_url=base_url))


@router.post("/tts/test")
async def test_tts(request: TestTTSRequest):
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
        if not model_hdr or model_hdr.startswith("seed-"):
            model_hdr = "speech-1.5"
        tts = FishTTSService(FishTTSConfig(api_key=api_key, base_url=base_url, model=model_hdr))
        try:
            out_fmt = str(fish_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text, reference_id=voice_type, encoding=out_fmt,
                speed_ratio=float(fish_cfg.speedRatio or 1.0), rate=int(fish_cfg.rate or 24000),
            )
            duration_ms = 0
            if out_fmt == "pcm":
                duration_ms = int((len(audio_bytes) // 2) * 1000 / int(fish_cfg.rate or 24000))
            return {"success": True, "message": "连接成功", "duration_ms": int(duration_ms or 0)}
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
            request.voiceType or bailian_cfg.narratorVoiceType
            or bailian_cfg.dialogueMaleVoiceType or bailian_cfg.dialogueFemaleVoiceType
            or bailian_cfg.dialogueVoiceType or ""
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
                text=text, voice=voice_type, encoding=out_fmt,
                speed_ratio=float(bailian_cfg.speedRatio or 1.0), rate=int(bailian_cfg.rate or 24000),
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
            request.voiceType or custom_cfg.narratorVoiceType
            or custom_cfg.dialogueMaleVoiceType or custom_cfg.dialogueFemaleVoiceType
            or custom_cfg.dialogueVoiceType or ""
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
                text=text, voice=voice_type, encoding=out_fmt,
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
        request.voiceType or volc_cfg.narratorVoiceType
        or volc_cfg.dialogueMaleVoiceType or volc_cfg.dialogueFemaleVoiceType
        or volc_cfg.dialogueVoiceType or ""
    ).strip()
    appid = str(volc_cfg.appid or "").strip()
    access_token = str(volc_cfg.accessToken or "").strip()
    if not appid or not access_token:
        raise HTTPException(status_code=400, detail="缺少 appid/accessToken")
    if not voice_type:
        voice_type = VolcTTSService.auto_pick_voice_type(role="narration", name="narrator")
    tts = VolcTTSService(
        VolcTTSConfig(
            appid=appid, access_token=access_token,
            cluster=str(volc_cfg.cluster or "volcano_tts").strip() or "volcano_tts",
            model=str(volc_cfg.model or "seed-tts-1.1").strip() or "seed-tts-1.1",
            endpoint=str(volc_cfg.endpoint or "").strip() or "https://openspeech.bytedance.com/api/v1/tts",
        )
    )
    try:
        _, duration_ms = await tts.synthesize(
            text=text, voice_type=voice_type,
            encoding=str(volc_cfg.encoding or "mp3").strip() or "mp3",
            speed_ratio=float(volc_cfg.speedRatio or 1.0), rate=int(volc_cfg.rate or 24000),
        )
        return {"success": True, "message": "连接成功", "duration_ms": int(duration_ms or 0)}
    except Exception as e:
        msg = str(e)
        if msg.startswith("TTS HTTP 403:"):
            raise HTTPException(status_code=403, detail=f"TTS 鉴权/权限失败：{msg}")
        if msg.startswith("TTS HTTP 401:"):
            raise HTTPException(status_code=401, detail=f"TTS 鉴权失败：{msg}")
        raise HTTPException(status_code=500, detail=f"TTS 测试失败: {msg}")


@router.post("/tts/preview")
async def preview_tts(request: TestTTSRequest):
    cfg = request.tts
    provider = str(getattr(cfg, "provider", "") or "volc_tts_v1_http").strip() or "volc_tts_v1_http"
    text = (request.text or "你好，这是一段语音试听示例。").strip()
    audio_bytes = b""
    out_fmt = "mp3"

    try:
        if provider.startswith("fish"):
            fish_cfg = cfg.fish
            voice_type = (
                request.voiceType or fish_cfg.narratorVoiceType
                or fish_cfg.dialogueMaleVoiceType or fish_cfg.dialogueFemaleVoiceType
                or fish_cfg.dialogueVoiceType or ""
            ).strip()
            api_key = str(fish_cfg.apiKey or "").strip()
            if not api_key:
                raise HTTPException(status_code=400, detail="缺少 Fish API Key：请在设置中配置 TTS 服务")
            if not voice_type:
                raise HTTPException(status_code=400, detail="缺少 Fish reference_id：请先配置音色")
            base_url = str(fish_cfg.baseUrl or "").strip() or "https://api.fish.audio"
            model_hdr = str(fish_cfg.model or "").strip()
            if not model_hdr or model_hdr.startswith("seed-"):
                model_hdr = "speech-1.5"
            tts = FishTTSService(FishTTSConfig(api_key=api_key, base_url=base_url, model=model_hdr))
            out_fmt = str(fish_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text, reference_id=voice_type, encoding=out_fmt,
                speed_ratio=float(fish_cfg.speedRatio or 1.0), rate=int(fish_cfg.rate or 24000),
            )

        elif provider in {"aliyun_bailian_tts_v2", "dashscope_tts_v2"}:
            bailian_cfg = cfg.bailian
            voice_type = (
                request.voiceType or bailian_cfg.narratorVoiceType
                or bailian_cfg.dialogueMaleVoiceType or bailian_cfg.dialogueFemaleVoiceType
                or bailian_cfg.dialogueVoiceType or ""
            ).strip()
            api_key = str(bailian_cfg.apiKey or "").strip()
            if not api_key:
                raise HTTPException(status_code=400, detail="缺少阿里百炼 API Key：请在设置中配置 TTS 服务")
            if not voice_type:
                raise HTTPException(status_code=400, detail="缺少音色/voice：请先配置音色")
            tts = DashScopeTTSService(
                DashScopeTTSConfig(
                    api_key=api_key,
                    base_url=str(bailian_cfg.baseUrl or "").strip() or "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                    model=str(bailian_cfg.model or "").strip() or "cosyvoice-v1",
                    workspace=str(bailian_cfg.workspace or "").strip(),
                )
            )
            out_fmt = str(bailian_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text, voice=voice_type, encoding=out_fmt,
                speed_ratio=float(bailian_cfg.speedRatio or 1.0), rate=int(bailian_cfg.rate or 24000),
            )

        elif provider.startswith("custom_"):
            custom_provider = storage.get_module_custom_provider(provider) or storage.get_custom_provider(provider) or {}
            if not custom_provider or str(custom_provider.get("category") or "") != "tts":
                raise HTTPException(status_code=400, detail="自定义 TTS 配置不存在：请先在设置中配置 TTS 服务")
            custom_cfg = cfg.custom
            voice_type = (
                request.voiceType or custom_cfg.narratorVoiceType
                or custom_cfg.dialogueMaleVoiceType or custom_cfg.dialogueFemaleVoiceType
                or custom_cfg.dialogueVoiceType or ""
            ).strip()
            if not voice_type:
                raise HTTPException(status_code=400, detail="缺少 voice：请先配置音色")
            api_key = str(custom_provider.get("apiKey") or "").strip()
            base_url = str(custom_provider.get("baseUrl") or "").strip()
            model = str(custom_provider.get("model") or "").strip()
            if not api_key or not base_url:
                raise HTTPException(status_code=400, detail="自定义 TTS 缺少 apiKey 或 baseUrl")
            tts = OpenAITTSService(OpenAITTSConfig(api_key=api_key, base_url=base_url, model=model))
            out_fmt = str(custom_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text, voice=voice_type, encoding=out_fmt,
                speed_ratio=float(custom_cfg.speedRatio or 1.0),
            )

        else:
            volc_cfg = cfg.volc
            voice_type = (
                request.voiceType or volc_cfg.narratorVoiceType
                or volc_cfg.dialogueMaleVoiceType or volc_cfg.dialogueFemaleVoiceType
                or volc_cfg.dialogueVoiceType or ""
            ).strip()
            appid = str(volc_cfg.appid or "").strip()
            access_token = str(volc_cfg.accessToken or "").strip()
            if not appid or not access_token:
                raise HTTPException(status_code=400, detail="缺少 appid/accessToken：请在设置中配置 TTS 服务")
            if not voice_type:
                voice_type = VolcTTSService.auto_pick_voice_type(role="narration", name="narrator")
            tts = VolcTTSService(
                VolcTTSConfig(
                    appid=appid, access_token=access_token,
                    cluster=str(volc_cfg.cluster or "volcano_tts").strip() or "volcano_tts",
                    model=str(volc_cfg.model or "seed-tts-1.1").strip() or "seed-tts-1.1",
                    endpoint=str(volc_cfg.endpoint or "").strip() or "https://openspeech.bytedance.com/api/v1/tts",
                )
            )
            out_fmt = str(volc_cfg.encoding or "mp3").strip().lower() or "mp3"
            audio_bytes, _ = await tts.synthesize(
                text=text, voice_type=voice_type, encoding=out_fmt,
                speed_ratio=float(volc_cfg.speedRatio or 1.0), rate=int(volc_cfg.rate or 24000),
            )

        if not audio_bytes:
            raise HTTPException(status_code=500, detail="TTS 合成返回空音频")

        content_type = "audio/mpeg" if out_fmt == "mp3" else f"audio/{out_fmt}"
        return StreamingResponse(
            io.BytesIO(audio_bytes),
            media_type=content_type,
            headers={"Content-Disposition": f"inline; filename=preview.{out_fmt}"},
        )

    except HTTPException:
        raise
    except Exception as e:
        msg = str(e)
        if "403" in msg:
            raise HTTPException(status_code=403, detail=f"TTS 鉴权/权限失败：{msg}")
        if "401" in msg:
            raise HTTPException(status_code=401, detail=f"TTS 鉴权失败：{msg}")
        raise HTTPException(status_code=500, detail=f"TTS 试听失败: {msg}")


# ---------------------------------------------------------------------------
# Fish Audio model management
# ---------------------------------------------------------------------------

@router.get("/fish/models")
async def fish_list_models(
    page_size: int = 10,
    page_number: int = 1,
    title: Optional[str] = None,
    tag: Optional[str] = None,
    self_only: bool = True,
    sort_by: str = "task_count",
    model_type: str = "tts",
):
    fish = _get_fish_service_from_settings()
    try:
        return await fish.list_models(
            page_size=page_size, page_number=page_number, title=title, tag=tag,
            self_only=self_only, sort_by=sort_by, model_type=model_type,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish list models failed: {e}")


@router.get("/fish/models/{model_id}")
async def fish_get_model(model_id: str):
    fish = _get_fish_service_from_settings()
    try:
        return await fish.get_model(model_id)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish get model failed: {e}")


@router.delete("/fish/models/{model_id}")
async def fish_delete_model(model_id: str):
    fish = _get_fish_service_from_settings()
    try:
        await fish.delete_model(model_id)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish delete model failed: {e}")


@router.post("/fish/models")
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
            title=title, voices=voice_files, description=description,
            visibility=visibility, train_mode=train_mode, tags=tag_list,
            enhance_audio_quality=bool(enhance_audio_quality), cover_image=cover_tuple,
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Fish create model failed: {e}")
