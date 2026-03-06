"""Settings routes: /api/settings, /api/module/settings, /api/test-connection, /api/custom-providers."""

from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException

from services.llm_service import LLMService
from services.image_service import ImageService
from services.video_service import VideoService
from services.storage_service import storage

import dependencies as deps
from schemas.settings import (
    ModelConfig,
    LocalConfig,
    SettingsRequest,
    TestConnectionRequest,
    TTSConfig,
)

router = APIRouter(prefix="/api", tags=["settings"])


@router.post("/settings")
async def update_settings(request: SettingsRequest):
    deps.current_settings = deps.apply_agent_runtime_settings(request)
    storage.save_settings(deps.current_settings)
    return {"status": "ok", "message": "设置已更新"}


@router.post("/module/settings")
async def update_module_settings(request: SettingsRequest):
    deps.module_current_settings = deps.apply_module_runtime_settings(request)
    storage.save_module_settings(deps.module_current_settings)
    return {"status": "ok", "message": "模块设置已更新"}


@router.post("/test-connection")
async def test_connection(request: TestConnectionRequest):
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
        try:
            models = await svc.client.models.list()
            count = len(getattr(models, "data", []) or [])
            return {"success": True, "level": "auth", "message": f"连接成功（models 可用：{count}）"}
        except Exception as e_models:
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

    if category in {"image", "storyboard"}:
        provider = cfg.provider
        if provider in {"placeholder", "none", ""}:
            return {"success": False, "level": "none", "message": "未配置图像服务，请先选择 provider 并配置密钥"}
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


@router.get("/settings")
async def get_settings():
    saved = storage.get_settings()
    if saved:
        try:
            saved["tts"] = TTSConfig.model_validate(saved.get("tts") or {}).model_dump(exclude_none=True)
        except Exception:
            pass
        return saved
    return {"status": "not_configured"}


@router.get("/module/settings")
async def get_module_settings():
    saved = storage.get_module_settings() or storage.get_settings()
    if saved:
        try:
            saved["tts"] = TTSConfig.model_validate(saved.get("tts") or {}).model_dump(exclude_none=True)
        except Exception:
            pass
        return saved
    return {"status": "not_configured"}


# ---------------------------------------------------------------------------
# Custom providers (module-scoped)
# ---------------------------------------------------------------------------

@router.get("/module/custom-providers")
async def list_module_custom_providers():
    return storage.list_module_custom_providers()


@router.post("/module/custom-providers")
async def create_module_custom_provider(payload: Dict[str, Any]):
    provider_id = str(payload.get("id") or "").strip()
    if not provider_id:
        import uuid as _uuid
        provider_id = f"custom_{_uuid.uuid4().hex[:8]}"
    payload["id"] = provider_id
    storage.save_module_custom_provider(provider_id, payload)
    return payload


@router.get("/module/custom-providers/{provider_id}")
async def get_module_custom_provider(provider_id: str):
    result = storage.get_module_custom_provider(provider_id)
    if not result:
        raise HTTPException(404, "自定义配置不存在")
    return result


@router.put("/module/custom-providers/{provider_id}")
async def update_module_custom_provider(provider_id: str, payload: Dict[str, Any]):
    payload["id"] = provider_id
    storage.save_module_custom_provider(provider_id, payload)
    return payload


@router.delete("/module/custom-providers/{provider_id}")
async def delete_module_custom_provider(provider_id: str):
    storage.delete_module_custom_provider(provider_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Custom providers (agent-scoped / legacy)
# ---------------------------------------------------------------------------

@router.get("/custom-providers")
async def list_custom_providers():
    return storage.list_custom_providers()


@router.post("/custom-providers")
async def create_custom_provider(payload: Dict[str, Any]):
    provider_id = str(payload.get("id") or "").strip()
    if not provider_id:
        import uuid as _uuid
        provider_id = f"custom_{_uuid.uuid4().hex[:8]}"
    payload["id"] = provider_id
    storage.save_custom_provider(provider_id, payload)
    return payload


@router.get("/custom-providers/{provider_id}")
async def get_custom_provider(provider_id: str):
    result = storage.get_custom_provider(provider_id)
    if not result:
        raise HTTPException(404, "自定义配置不存在")
    return result


@router.put("/custom-providers/{provider_id}")
async def update_custom_provider(provider_id: str, payload: Dict[str, Any]):
    payload["id"] = provider_id
    storage.save_custom_provider(provider_id, payload)
    return payload


@router.delete("/custom-providers/{provider_id}")
async def delete_custom_provider(provider_id: str):
    storage.delete_custom_provider(provider_id)
    return {"ok": True}
