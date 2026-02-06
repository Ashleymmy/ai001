#!/usr/bin/env python3
# Sync AI Storyboarder settings -> Huobao Drama (demo) AI configs.
#
# Goal: preload configs into demo UI, but do NOT auto-apply them.
# Implementation: create/update a tagged ai-config record, and keep it disabled by default
# (preserve user toggle state on subsequent syncs).

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


SYNC_SOURCE = "ai-storyboarder"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_str(value: Any) -> str:
    return str(value or "").strip()


def _is_valid_url(url: str) -> bool:
    try:
        p = urlparse(url)
        return bool(p.scheme and p.netloc)
    except Exception:
        return False


def _http_json(method: str, url: str, data: Optional[dict] = None, timeout: float = 10.0) -> Any:
    headers = {"Content-Type": "application/json"}
    body: Optional[bytes] = None
    if data is not None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    req = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            if not raw:
                return None
            return json.loads(raw.decode("utf-8"))
    except HTTPError as e:
        raw = b""
        try:
            raw = e.read() or b""
        except Exception:
            pass
        msg = raw.decode("utf-8", errors="replace") if raw else str(e)
        raise RuntimeError(f"HTTP {e.code} {url}: {msg}") from e
    except URLError as e:
        raise RuntimeError(f"Network error {url}: {e}") from e


def _unwrap_demo_response(resp: Any) -> Any:
    if not isinstance(resp, dict):
        return resp
    if "success" not in resp:
        return resp
    if resp.get("success") is True:
        return resp.get("data")
    err = resp.get("error") or {}
    msg = err.get("message") or resp.get("message") or "demo request failed"
    raise RuntimeError(str(msg))


def _wait_http_ok(url: str, timeout_sec: float = 20.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            _http_json("GET", url, timeout=3.0)
            return True
        except Exception:
            time.sleep(0.5)
    return False


def _map_provider_text(source_provider: str) -> str:
    p = source_provider.lower().strip()
    if p in {"gemini", "google"}:
        return "gemini"
    if p == "chatfire":
        return "chatfire"
    return "openai"


def _map_provider_image(source_provider: str, base_url: str) -> str:
    p = source_provider.lower().strip()
    if p in {"doubao", "volcengine", "volces"}:
        return "volcengine"
    if "volces.com" in base_url or "/api/v3" in base_url:
        return "volcengine"
    if p in {"gemini", "google"}:
        return "gemini"
    if p == "chatfire":
        return "chatfire"
    if p in {"dalle", "openai"}:
        return "openai"
    return "openai"


def _map_provider_video(source_provider: str, base_url: str) -> Optional[str]:
    p = source_provider.lower().strip()
    supported = {"volces", "doubao", "volcengine", "chatfire", "openai", "minimax", "runway", "pika"}
    if p in {"doubao", "volcengine", "volces"}:
        return "volces"
    if "volces.com" in base_url or "/api/v3" in base_url:
        return "volces"
    if p in supported:
        return p
    return None


def _extract_main_cfg(settings: dict, key: str) -> Optional[dict]:
    cfg = settings.get(key)
    if not isinstance(cfg, dict):
        return None
    provider = _norm_str(cfg.get("provider"))
    api_key = _norm_str(cfg.get("apiKey") or cfg.get("api_key"))
    base_url = _norm_str(cfg.get("baseUrl") or cfg.get("base_url"))
    model = _norm_str(cfg.get("model"))
    if not provider and not api_key and not base_url and not model:
        return None
    return {"provider": provider, "api_key": api_key, "base_url": base_url, "model": model}


def _list_demo_configs(demo_base: str, service_type: str) -> List[dict]:
    url = f"{demo_base.rstrip('/')}/api/v1/ai-configs?{urlencode({'service_type': service_type})}"
    resp = _http_json("GET", url)
    data = _unwrap_demo_response(resp)
    if not isinstance(data, list):
        return []
    return [c for c in data if isinstance(c, dict)]


def _create_demo_config(demo_base: str, payload: dict) -> dict:
    url = f"{demo_base.rstrip('/')}/api/v1/ai-configs"
    resp = _http_json("POST", url, payload)
    data = _unwrap_demo_response(resp)
    if not isinstance(data, dict):
        raise RuntimeError("demo create returned unexpected payload")
    return data


def _update_demo_config(demo_base: str, config_id: int, payload: dict) -> dict:
    url = f"{demo_base.rstrip('/')}/api/v1/ai-configs/{config_id}"
    resp = _http_json("PUT", url, payload)
    data = _unwrap_demo_response(resp)
    if not isinstance(data, dict):
        raise RuntimeError("demo update returned unexpected payload")
    return data


def _parse_settings_marker(settings_value: Any) -> dict:
    if not settings_value:
        return {}
    if isinstance(settings_value, dict):
        return settings_value
    if not isinstance(settings_value, str):
        return {}
    try:
        parsed = json.loads(settings_value)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _find_existing_synced_config(configs: List[dict], sync_key: str) -> Optional[dict]:
    for c in configs:
        marker = _parse_settings_marker(c.get("settings"))
        if marker.get("sync_source") == SYNC_SOURCE and marker.get("sync_key") == sync_key:
            return c
    return None


def _upsert_one(
    demo_base: str,
    service_type: str,
    sync_key: str,
    display_name: str,
    provider: str,
    base_url: str,
    api_key: str,
    model: str,
    recommended_priority: int,
    default_disabled: bool,
) -> Tuple[str, dict]:
    configs = _list_demo_configs(demo_base, service_type)
    existing = _find_existing_synced_config(configs, sync_key)

    metadata = {
        "sync_source": SYNC_SOURCE,
        "sync_key": sync_key,
        "synced_at": _now_iso(),
        "origin": {
            "service_type": service_type,
            "provider": provider,
            "base_url": base_url,
            "model": model,
        },
    }
    metadata_str = json.dumps(metadata, ensure_ascii=False)

    if existing:
        config_id = int(existing.get("id"))
        preserve_is_active = bool(existing.get("is_active"))
        preserve_priority = int(existing.get("priority") or 0)
        payload = {
            "name": _norm_str(existing.get("name")) or display_name,
            "provider": provider,
            "base_url": base_url,
            "api_key": api_key,
            "model": [model],
            "priority": preserve_priority,
            "is_default": bool(existing.get("is_default")),
            "is_active": preserve_is_active,
            "endpoint": _norm_str(existing.get("endpoint")),
            "query_endpoint": _norm_str(existing.get("query_endpoint")),
            "settings": metadata_str,
        }
        updated = _update_demo_config(demo_base, config_id, payload)
        return ("updated", updated)

    # Create (demo API will create it active by default) then disable it immediately.
    create_payload = {
        "service_type": service_type,
        "name": display_name,
        "provider": provider,
        "base_url": base_url,
        "api_key": api_key,
        "model": [model],
        "priority": 0,
        "is_default": False,
        "settings": metadata_str,
    }
    created = _create_demo_config(demo_base, create_payload)
    config_id = int(created.get("id"))
    update_payload = {
        "name": _norm_str(created.get("name")) or display_name,
        "provider": provider,
        "base_url": base_url,
        "api_key": api_key,
        "model": [model],
        "priority": int(created.get("priority") or 0),
        "is_default": bool(created.get("is_default")),
        "is_active": bool(created.get("is_active")),
        "endpoint": _norm_str(created.get("endpoint")),
        "query_endpoint": _norm_str(created.get("query_endpoint")),
        "settings": metadata_str,
    }

    if default_disabled:
        update_payload["is_active"] = False
        update_payload["priority"] = recommended_priority

    updated = _update_demo_config(demo_base, config_id, update_payload)
    return ("created", updated)


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync AI Storyboarder settings into Huobao Drama demo (preload only).")
    parser.add_argument("--main", dest="main_base", default="http://localhost:8001", help="Main backend base URL")
    parser.add_argument("--demo", dest="demo_base", default="http://localhost:5678", help="Demo (Huobao) base URL")
    parser.add_argument("--timeout", dest="timeout", type=float, default=20.0, help="Health check timeout seconds")
    args = parser.parse_args()

    main_base = args.main_base.rstrip("/")
    demo_base = args.demo_base.rstrip("/")

    if not _wait_http_ok(f"{main_base}/health", timeout_sec=args.timeout):
        print(f"[WARN] Main backend not ready: {main_base}/health", file=sys.stderr)
        return 0
    if not _wait_http_ok(f"{demo_base}/health", timeout_sec=args.timeout):
        print(f"[WARN] Demo backend not ready: {demo_base}/health", file=sys.stderr)
        return 0

    settings = _http_json("GET", f"{main_base}/api/settings")
    if isinstance(settings, dict) and settings.get("status") == "not_configured":
        print("[INFO] Main backend settings not configured; skip sync.")
        return 0
    if not isinstance(settings, dict):
        print("[WARN] Unexpected /api/settings response; skip sync.", file=sys.stderr)
        return 0

    llm = _extract_main_cfg(settings, "llm")
    image = _extract_main_cfg(settings, "image")
    storyboard = _extract_main_cfg(settings, "storyboard")
    video = _extract_main_cfg(settings, "video")

    tasks: List[Tuple[str, str, str, str, str, str, str]] = []
    # (service_type, sync_key, display_name, provider, base_url, api_key, model)
    if llm:
        provider = _map_provider_text(llm["provider"] or "")
        tasks.append((
            "text",
            "ai_storyboarder_text",
            "本地预加载（AI Storyboarder）- 文本",
            provider,
            llm["base_url"],
            llm["api_key"],
            llm["model"],
        ))
    if image:
        provider = _map_provider_image(image["provider"] or "", image["base_url"])
        tasks.append((
            "image",
            "ai_storyboarder_image",
            "本地预加载（AI Storyboarder）- 图像",
            provider,
            image["base_url"],
            image["api_key"],
            image["model"],
        ))
    if storyboard:
        provider = _map_provider_image(storyboard["provider"] or "", storyboard["base_url"])
        tasks.append((
            "image",
            "ai_storyboarder_storyboard",
            "本地预加载（AI Storyboarder）- 分镜图像",
            provider,
            storyboard["base_url"],
            storyboard["api_key"],
            storyboard["model"],
        ))
    if video:
        source_provider = video["provider"] or ""
        if source_provider.lower().strip() not in {"", "none"}:
            provider = _map_provider_video(source_provider, video["base_url"])
            if provider:
                tasks.append((
                    "video",
                    "ai_storyboarder_video",
                    "本地预加载（AI Storyboarder）- 视频",
                    provider,
                    video["base_url"],
                    video["api_key"],
                    video["model"],
                ))
            else:
                print(f"[INFO] Skip video sync: unsupported provider '{source_provider}' for demo.")

    if not tasks:
        print("[INFO] No eligible settings found; nothing to sync.")
        return 0

    print(f"[INFO] Syncing {len(tasks)} config(s) -> demo (preload only, disabled by default)...")

    for service_type, sync_key, display_name, provider, base_url, api_key, model in tasks:
        base_url = _norm_str(base_url)
        api_key = _norm_str(api_key)
        model = _norm_str(model)
        if not base_url or not api_key or not model:
            print(f"[INFO] Skip {display_name}: missing base_url/api_key/model.")
            continue
        if not _is_valid_url(base_url):
            print(f"[INFO] Skip {display_name}: invalid base_url '{base_url}'.")
            continue

        try:
            action, cfg = _upsert_one(
                demo_base=demo_base,
                service_type=service_type,
                sync_key=sync_key,
                display_name=display_name,
                provider=provider,
                base_url=base_url,
                api_key=api_key,
                model=model,
                recommended_priority=100,
                default_disabled=True,
            )
            cfg_id = cfg.get("id")
            cfg_active = cfg.get("is_active")
            cfg_priority = cfg.get("priority")
            print(f"[OK] {action}: {display_name} (id={cfg_id}, active={cfg_active}, priority={cfg_priority})")
        except Exception as e:
            print(f"[WARN] Failed to sync {display_name}: {e}", file=sys.stderr)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
