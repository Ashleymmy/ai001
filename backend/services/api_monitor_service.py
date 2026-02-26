"""Runtime API monitor for usage statistics and provider quota probing."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import os
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any, Deque, Dict, List, Optional, Tuple
from urllib.parse import quote

import httpx
import yaml


DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
MONITOR_FILE = os.path.join(DATA_DIR, "api_monitor.local.yaml")


def _now_iso(ts: Optional[float] = None) -> str:
    dt = datetime.fromtimestamp(ts or time.time())
    return dt.isoformat(timespec="seconds")


class APIMonitorService:
    """Collects backend API usage and probes upstream provider rate-limit headers."""

    BUDGET_KEYS = ("llm", "image", "storyboard", "video", "tts")
    ALL_CATEGORY_KEYS = ("llm", "image", "storyboard", "video", "tts", "agent", "system")
    DEFAULT_PROBE_CONFIG = {
        "volcengine": {
            "access_key": "",
            "secret_key": "",
            "region": "cn-beijing",
            "provider_code": "",
            "quota_code": "",
        }
    }
    VOLC_QUOTA_HOST = "quota.volcengineapi.com"
    VOLC_QUOTA_SERVICE = "quota"
    VOLC_QUOTA_VERSION = "2022-07-01"
    VOLC_QUOTA_CACHE_SECONDS = 25.0

    def __init__(self, data_file: str = MONITOR_FILE, max_events: int = 8000):
        self._lock = threading.Lock()
        self._events: Deque[Dict[str, Any]] = deque(maxlen=max_events)
        self._in_flight = 0
        self._started_at = time.time()
        self._data_file = data_file
        self._budgets: Dict[str, int] = {k: 0 for k in self.BUDGET_KEYS}
        self._probe_config: Dict[str, Any] = {
            "volcengine": dict(self.DEFAULT_PROBE_CONFIG["volcengine"]),
        }
        self._volc_quota_lock = threading.Lock()
        self._volc_quota_cache_key = ""
        self._volc_quota_cache_expire_at = 0.0
        self._volc_quota_cache_data: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not os.path.exists(self._data_file):
            return
        try:
            with open(self._data_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
            budgets = data.get("budgets") or {}
            if isinstance(budgets, dict):
                for key in self.BUDGET_KEYS:
                    raw = budgets.get(key)
                    if raw is None:
                        continue
                    try:
                        self._budgets[key] = max(0, int(raw))
                    except Exception:
                        continue

            volc_cfg = ((data.get("config") or {}).get("volcengine") or {})
            if isinstance(volc_cfg, dict):
                merged = dict(self.DEFAULT_PROBE_CONFIG["volcengine"])
                for key in merged.keys():
                    if key not in volc_cfg:
                        continue
                    merged[key] = str(volc_cfg.get(key) or "").strip()
                if not merged.get("region"):
                    merged["region"] = "cn-beijing"
                self._probe_config["volcengine"] = merged
        except Exception as e:
            print(f"[APIMonitor] Failed to load config: {e}")

    def _save(self) -> None:
        os.makedirs(os.path.dirname(self._data_file), exist_ok=True)
        payload = {
            "updated_at": _now_iso(),
            "budgets": dict(self._budgets),
            "config": {
                "volcengine": dict(self._probe_config.get("volcengine") or {}),
            },
        }
        with open(self._data_file, "w", encoding="utf-8") as f:
            yaml.safe_dump(payload, f, allow_unicode=True, sort_keys=False)

    @staticmethod
    def _should_track(path: str) -> bool:
        return path.startswith("/api/") and not path.startswith("/api/monitor")

    @staticmethod
    def _classify_path(path: str) -> str:
        p = path.lower()

        if (
            p.startswith("/api/generate-video")
            or p.startswith("/api/video-task-status")
            or "/generate-videos" in p
            or "/poll-video-tasks" in p
        ):
            return "video"

        if p.startswith("/api/tts/") or "/generate-audio" in p or "/clear-audio" in p:
            return "tts"

        if "/generate-elements" in p or "/generate-frames" in p or "/regenerate-frame" in p:
            return "storyboard"

        if p.startswith("/api/generate-image") or p.startswith("/api/regenerate"):
            return "image"

        if p.startswith("/api/generate"):
            return "storyboard"

        if (
            p.startswith("/api/parse-story")
            or p.startswith("/api/bridge/generate-text")
            or p.startswith("/api/agent/chat")
            or p.startswith("/api/agent/plan")
            or p.startswith("/api/agent/element-prompt")
            or p.startswith("/api/agent/shot-prompt")
        ):
            return "llm"

        if p.startswith("/api/chat") and not p.startswith("/api/chat/history") and not p.startswith("/api/chat/sessions"):
            return "llm"

        if any(marker in p for marker in ("/script-doctor", "/complete-assets", "/refine-split-visuals", "/audio-check")):
            return "agent"

        if p.startswith("/api/agent/"):
            return "agent"

        return "system"

    def mark_request_started(self, path: str) -> bool:
        if not self._should_track(path):
            return False
        with self._lock:
            self._in_flight += 1
        return True

    def mark_request_finished(
        self,
        method: str,
        path: str,
        status_code: int,
        duration_ms: float,
        error: Optional[str] = None,
    ) -> None:
        if not self._should_track(path):
            return
        event = {
            "ts": time.time(),
            "method": method.upper(),
            "path": path,
            "category": self._classify_path(path),
            "status_code": int(status_code),
            "duration_ms": round(float(duration_ms), 2),
            "error": (error or "").strip()[:500],
        }
        with self._lock:
            self._in_flight = max(0, self._in_flight - 1)
            self._events.append(event)

    def get_budgets(self) -> Dict[str, int]:
        with self._lock:
            return dict(self._budgets)

    def update_budgets(self, budgets: Dict[str, int]) -> Dict[str, int]:
        if not isinstance(budgets, dict):
            return self.get_budgets()

        with self._lock:
            for key in self.BUDGET_KEYS:
                if key not in budgets:
                    continue
                try:
                    self._budgets[key] = max(0, int(budgets[key]))
                except Exception:
                    continue
            snapshot = dict(self._budgets)

        self._save()
        return snapshot

    @staticmethod
    def _mask_secret(value: str) -> str:
        raw = str(value or "").strip()
        if not raw:
            return ""
        if len(raw) <= 8:
            return "*" * len(raw)
        return f"{raw[:4]}{'*' * (len(raw) - 8)}{raw[-4:]}"

    def _get_raw_volc_probe_config(self) -> Dict[str, str]:
        with self._lock:
            config = dict(self._probe_config.get("volcengine") or {})
        merged = dict(self.DEFAULT_PROBE_CONFIG["volcengine"])
        for key in merged.keys():
            if key in config:
                merged[key] = str(config.get(key) or "").strip()
        if not merged.get("region"):
            merged["region"] = "cn-beijing"
        return merged

    def get_probe_config(self) -> Dict[str, Any]:
        volc = self._get_raw_volc_probe_config()
        access_key = str(volc.get("access_key") or "").strip()
        secret_key = str(volc.get("secret_key") or "").strip()
        return {
            "volcengine": {
                "access_key_masked": self._mask_secret(access_key),
                "secret_key_masked": self._mask_secret(secret_key),
                "has_access_key": bool(access_key),
                "has_secret_key": bool(secret_key),
                "region": str(volc.get("region") or "cn-beijing"),
                "provider_code": str(volc.get("provider_code") or ""),
                "quota_code": str(volc.get("quota_code") or ""),
            }
        }

    def update_probe_config(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            return self.get_probe_config()

        volc_updates = payload.get("volcengine")
        should_save = False

        if isinstance(volc_updates, dict):
            with self._lock:
                current = dict(self._probe_config.get("volcengine") or self.DEFAULT_PROBE_CONFIG["volcengine"])
                for key in ("access_key", "secret_key", "region", "provider_code", "quota_code"):
                    if key not in volc_updates:
                        continue
                    raw = volc_updates.get(key)
                    if raw is None:
                        continue
                    value = str(raw).strip()
                    if key == "region":
                        current[key] = value or "cn-beijing"
                    else:
                        current[key] = value
                    should_save = True
                self._probe_config["volcengine"] = current

        if should_save:
            with self._volc_quota_lock:
                self._volc_quota_cache_key = ""
                self._volc_quota_cache_expire_at = 0.0
                self._volc_quota_cache_data = {}
            self._save()
        return self.get_probe_config()

    @staticmethod
    def _is_success(status_code: int) -> bool:
        return 200 <= int(status_code) < 400

    def get_usage_snapshot(self, window_minutes: int = 60) -> Dict[str, Any]:
        try:
            window = max(1, min(24 * 60, int(window_minutes)))
        except Exception:
            window = 60

        now_ts = time.time()
        cutoff = now_ts - window * 60
        day_start = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp()

        with self._lock:
            events = list(self._events)
            in_flight = self._in_flight
            budgets = dict(self._budgets)
            started_at = self._started_at

        window_events = [e for e in events if float(e.get("ts", 0)) >= cutoff]
        day_events = [e for e in events if float(e.get("ts", 0)) >= day_start]

        summary = {
            "total": len(window_events),
            "success": 0,
            "error": 0,
            "success_rate": 100.0,
            "avg_latency_ms": 0.0,
        }
        by_category: Dict[str, Dict[str, Any]] = {
            k: {"total": 0, "success": 0, "error": 0, "avg_latency_ms": 0.0}
            for k in self.ALL_CATEGORY_KEYS
        }
        latency_sums = {k: 0.0 for k in self.ALL_CATEGORY_KEYS}

        for event in window_events:
            cat = str(event.get("category") or "system")
            if cat not in by_category:
                cat = "system"
            ok = self._is_success(int(event.get("status_code", 500)))
            latency = float(event.get("duration_ms", 0.0))

            by_category[cat]["total"] += 1
            if ok:
                by_category[cat]["success"] += 1
                summary["success"] += 1
            else:
                by_category[cat]["error"] += 1
                summary["error"] += 1
            latency_sums[cat] += latency

        if summary["total"] > 0:
            summary["success_rate"] = round(summary["success"] * 100.0 / summary["total"], 2)
            summary["avg_latency_ms"] = round(
                sum(float(e.get("duration_ms", 0.0)) for e in window_events) / summary["total"],
                2,
            )
        else:
            summary["success_rate"] = 100.0
            summary["avg_latency_ms"] = 0.0

        for cat, stats in by_category.items():
            if stats["total"] > 0:
                stats["avg_latency_ms"] = round(latency_sums[cat] / stats["total"], 2)

        recent_errors: List[Dict[str, Any]] = []
        for event in reversed(window_events):
            if self._is_success(int(event.get("status_code", 500))):
                continue
            recent_errors.append(
                {
                    "timestamp": _now_iso(float(event.get("ts", now_ts))),
                    "category": event.get("category"),
                    "path": event.get("path"),
                    "status_code": event.get("status_code"),
                    "duration_ms": event.get("duration_ms"),
                    "error": event.get("error") or "",
                }
            )
            if len(recent_errors) >= 20:
                break

        day_counts = {k: 0 for k in self.BUDGET_KEYS}
        for event in day_events:
            cat = str(event.get("category") or "")
            if cat in day_counts:
                day_counts[cat] += 1

        daily_items: Dict[str, Dict[str, Any]] = {}
        for cat in self.BUDGET_KEYS:
            limit = int(budgets.get(cat, 0))
            used = int(day_counts.get(cat, 0))
            if limit > 0:
                remaining = max(0, limit - used)
                remaining_ratio = round(remaining * 100.0 / limit, 2)
            else:
                remaining = None
                remaining_ratio = None
            daily_items[cat] = {
                "used": used,
                "limit": limit if limit > 0 else None,
                "remaining": remaining,
                "remaining_ratio": remaining_ratio,
            }

        return {
            "generated_at": _now_iso(now_ts),
            "started_at": _now_iso(started_at),
            "window_minutes": window,
            "in_flight": in_flight,
            "summary": summary,
            "by_category": by_category,
            "recent_errors": recent_errors,
            "daily_usage": {
                "date": datetime.now().strftime("%Y-%m-%d"),
                "items": daily_items,
            },
            "events_retained": len(events),
        }

    @staticmethod
    def _resolve_custom_model_config(
        provider: str,
        module_scope: bool,
        expected_categories: Tuple[str, ...],
    ) -> Dict[str, Any]:
        if not provider.startswith("custom_"):
            return {}
        from services.storage_service import storage

        custom = None
        if module_scope:
            custom = storage.get_module_custom_provider(provider)
        if not custom:
            custom = storage.get_custom_provider(provider)
        if not isinstance(custom, dict):
            return {}
        if str(custom.get("category") or "") not in expected_categories:
            return {}
        return custom

    @staticmethod
    def _pick_header(headers: httpx.Headers, keys: List[str]) -> Optional[str]:
        for key in keys:
            value = headers.get(key)
            if value is not None:
                text = str(value).strip()
                if text:
                    return text
        return None

    def _extract_rate_limit(self, headers: httpx.Headers) -> Optional[Dict[str, Any]]:
        req_limit = self._pick_header(
            headers,
            [
                "x-ratelimit-limit-requests",
                "ratelimit-limit-requests",
                "x-ratelimit-limit",
                "ratelimit-limit",
            ],
        )
        req_remaining = self._pick_header(
            headers,
            [
                "x-ratelimit-remaining-requests",
                "ratelimit-remaining-requests",
                "x-ratelimit-remaining",
                "ratelimit-remaining",
            ],
        )
        req_reset = self._pick_header(
            headers,
            [
                "x-ratelimit-reset-requests",
                "ratelimit-reset-requests",
                "x-ratelimit-reset",
                "ratelimit-reset",
            ],
        )
        tok_limit = self._pick_header(
            headers,
            [
                "x-ratelimit-limit-tokens",
                "ratelimit-limit-tokens",
            ],
        )
        tok_remaining = self._pick_header(
            headers,
            [
                "x-ratelimit-remaining-tokens",
                "ratelimit-remaining-tokens",
            ],
        )
        tok_reset = self._pick_header(
            headers,
            [
                "x-ratelimit-reset-tokens",
                "ratelimit-reset-tokens",
            ],
        )
        if not any((req_limit, req_remaining, req_reset, tok_limit, tok_remaining, tok_reset)):
            return None

        raw_headers = {
            key: value
            for key, value in headers.items()
            if "ratelimit" in key.lower()
        }
        return {
            "requests": {
                "limit": req_limit,
                "remaining": req_remaining,
                "reset": req_reset,
            },
            "tokens": {
                "limit": tok_limit,
                "remaining": tok_remaining,
                "reset": tok_reset,
            },
            "raw_headers": raw_headers,
        }

    @staticmethod
    def _is_volc_provider(provider: str, base_url: str) -> bool:
        p = str(provider or "").strip().lower()
        b = str(base_url or "").strip().lower()
        return (
            "volces.com" in b
            or "volcengineapi.com" in b
            or p in {"doubao", "volc", "volcengine"}
            or p.startswith("doubao")
            or "doubao" in p
            or ("ark" in b and "volc" in b)
        )

    @staticmethod
    def _to_number(value: Any) -> Optional[float]:
        if value is None:
            return None
        text = str(value).strip().replace(",", "")
        if not text:
            return None
        try:
            return float(text)
        except Exception:
            return None

    @staticmethod
    def _normalize_number(value: Optional[float]) -> Optional[Any]:
        if value is None:
            return None
        if abs(value - round(value)) < 1e-9:
            return int(round(value))
        return round(value, 6)

    @staticmethod
    def _percent_encode(value: str) -> str:
        return quote(value, safe="-_.~")

    @classmethod
    def _build_canonical_query(cls, params: Dict[str, Any]) -> str:
        items: List[Tuple[str, str]] = []
        for key, value in params.items():
            if value is None:
                continue
            if isinstance(value, (list, tuple)):
                for entry in value:
                    if entry is None:
                        continue
                    items.append((str(key), str(entry)))
            else:
                items.append((str(key), str(value)))

        items.sort(key=lambda kv: (kv[0], kv[1]))
        return "&".join(f"{cls._percent_encode(k)}={cls._percent_encode(v)}" for k, v in items)

    @staticmethod
    def _sha256_hex(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    @staticmethod
    def _hmac_sha256_bytes(key: bytes, text: str) -> bytes:
        return hmac.new(key, text.encode("utf-8"), hashlib.sha256).digest()

    async def _volc_signed_get(
        self,
        action: str,
        params: Dict[str, Any],
        access_key: str,
        secret_key: str,
        region: str,
    ) -> Dict[str, Any]:
        query: Dict[str, Any] = {
            "Action": action,
            "Version": self.VOLC_QUOTA_VERSION,
        }
        query.update({k: v for k, v in params.items() if v is not None})

        canonical_query = self._build_canonical_query(query)
        x_date = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        short_date = x_date[:8]
        signed_headers = "host;x-date"
        canonical_headers = f"host:{self.VOLC_QUOTA_HOST}\n" + f"x-date:{x_date}\n"
        payload_hash = self._sha256_hex("")
        canonical_request = "\n".join(
            [
                "GET",
                "/",
                canonical_query,
                canonical_headers,
                signed_headers,
                payload_hash,
            ]
        )
        credential_scope = f"{short_date}/{region}/{self.VOLC_QUOTA_SERVICE}/request"
        string_to_sign = "\n".join(
            [
                "HMAC-SHA256",
                x_date,
                credential_scope,
                self._sha256_hex(canonical_request),
            ]
        )

        k_date = self._hmac_sha256_bytes(secret_key.encode("utf-8"), short_date)
        k_region = self._hmac_sha256_bytes(k_date, region)
        k_service = self._hmac_sha256_bytes(k_region, self.VOLC_QUOTA_SERVICE)
        k_signing = self._hmac_sha256_bytes(k_service, "request")
        signature = self._hmac_sha256_bytes(k_signing, string_to_sign).hex()

        authorization = (
            "HMAC-SHA256 "
            f"Credential={access_key}/{credential_scope}, "
            f"SignedHeaders={signed_headers}, "
            f"Signature={signature}"
        )

        headers = {
            "Host": self.VOLC_QUOTA_HOST,
            "X-Date": x_date,
            "Authorization": authorization,
        }
        timeout = httpx.Timeout(10.0, connect=6.0)
        url = f"https://{self.VOLC_QUOTA_HOST}/?{canonical_query}"
        async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
            resp = await client.get(url, headers=headers)

        try:
            payload = resp.json()
        except Exception:
            payload = {"raw_text": (resp.text or "")[:1000]}

        return {
            "http_status": int(resp.status_code),
            "payload": payload if isinstance(payload, dict) else {},
        }

    @staticmethod
    def _volc_extract_error(payload: Dict[str, Any]) -> str:
        metadata = payload.get("ResponseMetadata") or {}
        if not isinstance(metadata, dict):
            return ""
        error = metadata.get("Error") or {}
        if not isinstance(error, dict):
            return ""
        code = str(error.get("Code") or "").strip()
        message = str(error.get("Message") or "").strip()
        if code and message:
            return f"{code}: {message}"
        return code or message

    @staticmethod
    def _volc_product_score(product: Dict[str, Any]) -> int:
        provider_code = str(product.get("ProviderCode") or "").strip()
        provider_name = str(product.get("ProviderName") or "").strip()
        category_name = str(product.get("CategoryName") or "").strip()
        text_lower = f"{provider_code} {provider_name} {category_name}".lower()
        text_raw = f"{provider_code} {provider_name} {category_name}"

        score = 0
        if provider_code == "vei_api":
            score += 1000
        if "ark" in text_lower:
            score += 420
        if "doubao" in text_lower:
            score += 420
        if "gateway" in text_lower:
            score += 300
        if "token" in text_lower:
            score += 220
        if "ai" in text_lower:
            score += 90
        if "方舟" in text_raw:
            score += 500
        if "豆包" in text_raw:
            score += 500
        if "边缘" in text_raw:
            score += 260
        if "大模型" in text_raw:
            score += 280
        return score

    @staticmethod
    def _volc_quota_score(quota: Dict[str, Any], quota_code_hint: str = "") -> int:
        code = str(quota.get("QuotaCode") or quota.get("Code") or "").strip()
        desc = str(quota.get("Description") or quota.get("QuotaName") or "").strip()
        usage = quota.get("TotalUsage") or {}
        unit = ""
        if isinstance(usage, dict):
            unit = str(usage.get("Unit") or "").strip()
        if not unit:
            unit = str(quota.get("QuotaUnit") or "").strip()

        code_lower = code.lower()
        desc_lower = desc.lower()
        unit_lower = unit.lower()
        hint_lower = quota_code_hint.lower().strip()

        score = 0
        if hint_lower:
            if code_lower == hint_lower:
                score += 2200
            elif hint_lower in code_lower:
                score += 900
        if code_lower == "ai-gateway-token-limit":
            score += 1600
        if "token" in code_lower:
            score += 500
        if "gateway" in code_lower or "ark" in code_lower or "doubao" in code_lower:
            score += 220
        if any(k in code_lower for k in ("limit", "quota", "usage", "remain", "balance")):
            score += 80
        if unit_lower in {"token", "tokens"}:
            score += 260
        if "token" in desc_lower:
            score += 200
        if "免费" in desc:
            score += 80
        if not code:
            score -= 200
        return score

    @classmethod
    def _pick_volc_provider_codes(cls, products: List[Dict[str, Any]], max_count: int = 6) -> List[str]:
        scored: List[Tuple[int, str]] = []
        for product in products:
            if not isinstance(product, dict):
                continue
            code = str(product.get("ProviderCode") or "").strip()
            if not code:
                continue
            scored.append((cls._volc_product_score(product), code))

        scored.sort(key=lambda item: item[0], reverse=True)
        picked: List[str] = []
        for score, code in scored:
            if code in picked:
                continue
            if score <= 0 and picked:
                continue
            picked.append(code)
            if len(picked) >= max_count:
                break

        if not picked:
            for _, code in scored[:max_count]:
                if code not in picked:
                    picked.append(code)

        if "vei_api" not in picked:
            for _, code in scored:
                if code == "vei_api":
                    picked.insert(0, "vei_api")
                    break
        return picked[:max_count]

    @staticmethod
    def _volc_extract_usage_value(total_usage: Any) -> Any:
        if isinstance(total_usage, dict):
            return total_usage.get("Value")
        return total_usage

    def _build_volc_token_quota(self, provider_code: str, quota: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(quota, dict):
            return None

        quota_code = str(quota.get("QuotaCode") or quota.get("Code") or "").strip()
        total_raw = quota.get("TotalQuota")
        used_raw = self._volc_extract_usage_value(quota.get("TotalUsage"))
        total = self._to_number(total_raw)
        used = self._to_number(used_raw)
        remaining: Optional[float] = None
        if total is not None and used is not None:
            remaining = max(0.0, total - used)

        usage = quota.get("TotalUsage") or {}
        unit = ""
        if isinstance(usage, dict):
            unit = str(usage.get("Unit") or "").strip()
        if not unit:
            unit = str(quota.get("QuotaUnit") or "token").strip() or "token"

        return {
            "source": "volc_quota_openapi",
            "provider_code": provider_code,
            "quota_code": quota_code or None,
            "description": str(quota.get("Description") or quota.get("QuotaName") or "").strip() or None,
            "total": self._normalize_number(total),
            "used": self._normalize_number(used),
            "remaining": self._normalize_number(remaining),
            "unit": unit,
            "updated_at": _now_iso(),
        }

    async def _query_volc_token_quota(
        self,
        access_key: str,
        secret_key: str,
        region: str,
        provider_hint: str,
        quota_hint: str,
    ) -> Dict[str, Any]:
        provider_codes: List[str] = []
        if provider_hint:
            provider_codes = [provider_hint]
        else:
            products_resp = await self._volc_signed_get(
                action="ListProducts",
                params={"MaxResults": 100},
                access_key=access_key,
                secret_key=secret_key,
                region=region,
            )
            if int(products_resp.get("http_status", 500)) != 200:
                return {
                    "available": False,
                    "message": f"官方配额查询失败（ListProducts HTTP {products_resp.get('http_status')}）",
                }

            products_payload = products_resp.get("payload") or {}
            products_error = self._volc_extract_error(products_payload)
            if products_error:
                return {"available": False, "message": f"官方配额查询失败（{products_error}）"}

            products_result = products_payload.get("Result") or {}
            products = (
                products_result.get("ProductInfo")
                or products_result.get("Products")
                or []
            )
            if not isinstance(products, list):
                products = []
            provider_codes = self._pick_volc_provider_codes(products)

        if not provider_codes:
            return {
                "available": False,
                "message": "未找到可用 ProviderCode（可设置 VOLCENGINE_QUOTA_PROVIDER_CODE）",
            }

        best_quota: Optional[Dict[str, Any]] = None
        best_score = -10**9
        last_error = ""

        for provider_code in provider_codes[:8]:
            next_token = ""
            for _ in range(8):
                params: Dict[str, Any] = {
                    "ProviderCode": provider_code,
                    "MaxResults": 100,
                }
                if quota_hint:
                    params["QuotaCode"] = quota_hint
                if next_token:
                    params["NextToken"] = next_token

                quotas_resp = await self._volc_signed_get(
                    action="ListProductQuotas",
                    params=params,
                    access_key=access_key,
                    secret_key=secret_key,
                    region=region,
                )
                http_status = int(quotas_resp.get("http_status", 500))
                if http_status != 200:
                    last_error = f"ListProductQuotas HTTP {http_status}"
                    break

                payload = quotas_resp.get("payload") or {}
                api_error = self._volc_extract_error(payload)
                if api_error:
                    last_error = api_error
                    break

                result = payload.get("Result") or {}
                quotas = result.get("Quotas") or result.get("ProductQuotas") or []
                if not isinstance(quotas, list):
                    quotas = []

                for quota in quotas:
                    if not isinstance(quota, dict):
                        continue
                    score = self._volc_quota_score(quota, quota_code_hint=quota_hint)
                    if score <= best_score:
                        continue
                    candidate = self._build_volc_token_quota(provider_code=provider_code, quota=quota)
                    if not candidate:
                        continue
                    best_score = score
                    best_quota = candidate

                next_token = str(result.get("NextToken") or "").strip()
                if not next_token:
                    break

            if quota_hint and best_quota:
                matched = str(best_quota.get("quota_code") or "").lower()
                if matched == quota_hint.lower().strip():
                    break

        if best_quota:
            return {
                "available": True,
                "message": "已接入火山官方配额中心",
                "token_quota": best_quota,
            }

        if last_error:
            return {"available": False, "message": f"官方 token 配额查询失败（{last_error}）"}
        return {
            "available": False,
            "message": "未匹配到 token 配额项（可设置 VOLCENGINE_QUOTA_PROVIDER_CODE / VOLCENGINE_QUOTA_CODE）",
        }

    async def _probe_volc_token_quota(self) -> Dict[str, Any]:
        stored = self._get_raw_volc_probe_config()
        access_key = (
            stored.get("access_key")
            or os.getenv("VOLCENGINE_ACCESS_KEY")
            or os.getenv("VOLC_ACCESS_KEY")
            or ""
        ).strip()
        secret_key = (
            stored.get("secret_key")
            or os.getenv("VOLCENGINE_SECRET_KEY")
            or os.getenv("VOLC_SECRET_KEY")
            or ""
        ).strip()
        region = (
            stored.get("region")
            or os.getenv("VOLCENGINE_QUOTA_REGION")
            or os.getenv("VOLC_REGION")
            or "cn-beijing"
        ).strip() or "cn-beijing"
        provider_hint = (
            stored.get("provider_code")
            or os.getenv("VOLCENGINE_QUOTA_PROVIDER_CODE")
            or os.getenv("VOLC_QUOTA_PROVIDER_CODE")
            or ""
        ).strip()
        quota_hint = (
            stored.get("quota_code")
            or os.getenv("VOLCENGINE_QUOTA_CODE")
            or os.getenv("VOLC_QUOTA_CODE")
            or ""
        ).strip()

        if not access_key or not secret_key:
            return {
                "available": False,
                "message": "未配置 VOLCENGINE_ACCESS_KEY / VOLCENGINE_SECRET_KEY",
            }

        cache_key = self._sha256_hex(f"{access_key}|{region}|{provider_hint}|{quota_hint}")
        now_ts = time.time()
        with self._volc_quota_lock:
            if (
                self._volc_quota_cache_data
                and self._volc_quota_cache_key == cache_key
                and now_ts < self._volc_quota_cache_expire_at
            ):
                return dict(self._volc_quota_cache_data)

        result = await self._query_volc_token_quota(
            access_key=access_key,
            secret_key=secret_key,
            region=region,
            provider_hint=provider_hint,
            quota_hint=quota_hint,
        )

        with self._volc_quota_lock:
            self._volc_quota_cache_key = cache_key
            self._volc_quota_cache_data = dict(result)
            self._volc_quota_cache_expire_at = now_ts + self.VOLC_QUOTA_CACHE_SECONDS

        return result

    def _should_probe_volc_quota(self, settings: Dict[str, Any], module_scope: bool) -> bool:
        for category in ("llm", "image", "storyboard", "video"):
            config = settings.get(category) or {}
            if not isinstance(config, dict):
                continue
            provider = str(config.get("provider") or "").strip()
            base_url = str(config.get("baseUrl") or "").strip()
            model = str(config.get("model") or "").strip()

            custom = self._resolve_custom_model_config(
                provider=provider,
                module_scope=module_scope,
                expected_categories=("llm",) if category == "llm" else ("image", "storyboard", "video"),
            )
            if custom:
                provider = str(custom.get("id") or provider).strip()
                base_url = str(custom.get("baseUrl") or base_url).strip()
                model = str(custom.get("model") or model).strip()

            if self._is_volc_provider(provider=provider, base_url=base_url):
                return True
            if "doubao" in model.lower():
                return True
        return False

    async def _probe_model_service(
        self,
        category: str,
        config: Dict[str, Any],
        module_scope: bool,
        shared_volc_quota: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        provider = str(config.get("provider") or "").strip()
        api_key = str(config.get("apiKey") or "").strip()
        base_url = str(config.get("baseUrl") or "").strip()
        model = str(config.get("model") or "").strip()

        custom = self._resolve_custom_model_config(
            provider=provider,
            module_scope=module_scope,
            expected_categories=("llm",) if category == "llm" else ("image", "storyboard", "video"),
        )
        if custom:
            api_key = str(custom.get("apiKey") or api_key).strip()
            base_url = str(custom.get("baseUrl") or base_url).strip()
            model = str(custom.get("model") or model).strip()

        is_volc = self._is_volc_provider(provider=provider, base_url=base_url) or ("doubao" in model.lower())
        volc_token_quota: Optional[Dict[str, Any]] = None
        volc_quota_note = ""
        if is_volc and isinstance(shared_volc_quota, dict):
            if bool(shared_volc_quota.get("available")) and isinstance(shared_volc_quota.get("token_quota"), dict):
                volc_token_quota = dict(shared_volc_quota.get("token_quota") or {})
            else:
                volc_quota_note = str(shared_volc_quota.get("message") or "").strip()

        if category in {"image", "storyboard"} and provider in {"none", "placeholder", ""}:
            return {
                "category": category,
                "provider": provider or "none",
                "model": model,
                "base_url": base_url,
                "configured": False,
                "status": "not_configured",
                "message": "未配置图像服务",
                "rate_limit": None,
                "token_quota": None,
                "checked_at": _now_iso(),
            }

        if category in {"image", "storyboard"} and provider in {"comfyui", "sd-webui"}:
            return {
                "category": category,
                "provider": provider,
                "model": model,
                "base_url": base_url,
                "configured": True,
                "status": "local",
                "message": "本地服务，无远程配额概念",
                "rate_limit": None,
                "token_quota": None,
                "checked_at": _now_iso(),
            }

        if category == "video" and provider in {"none"}:
            return {
                "category": category,
                "provider": provider,
                "model": model,
                "base_url": base_url,
                "configured": False,
                "status": "not_configured",
                "message": "未配置视频服务",
                "rate_limit": None,
                "token_quota": None,
                "checked_at": _now_iso(),
            }

        if not provider:
            return {
                "category": category,
                "provider": "",
                "model": "",
                "base_url": "",
                "configured": False,
                "status": "not_configured",
                "message": "未配置 provider",
                "rate_limit": None,
                "token_quota": None,
                "checked_at": _now_iso(),
            }

        if not api_key or not base_url:
            message = "缺少 API Key 或 Base URL"
            if is_volc and volc_quota_note:
                message = f"{message}（{volc_quota_note}）"
            return {
                "category": category,
                "provider": provider,
                "model": model,
                "base_url": base_url,
                "configured": False,
                "status": "not_configured",
                "message": message,
                "rate_limit": None,
                "token_quota": volc_token_quota,
                "checked_at": _now_iso(),
            }

        url = f"{base_url.rstrip('/')}/models"
        headers = {"Authorization": f"Bearer {api_key}"}

        try:
            timeout = httpx.Timeout(8.0, connect=6.0)
            async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
                resp = await client.get(url, headers=headers)
            rate_limit = self._extract_rate_limit(resp.headers)

            if resp.status_code == 200:
                status = "ok"
                message = "连接正常"
                if rate_limit is None:
                    message = "连接正常（服务未返回标准 rate-limit 头）"
            elif resp.status_code in (401, 403):
                status = "auth_error"
                message = f"鉴权失败（HTTP {resp.status_code}）"
            elif resp.status_code == 404:
                status = "reachable"
                message = "主机可达，但 /models 不可用"
            else:
                status = "error"
                message = f"请求失败（HTTP {resp.status_code}）"

            if is_volc:
                if volc_token_quota:
                    message = f"{message}（已接入官方 token 配额）"
                elif volc_quota_note:
                    message = f"{message}（{volc_quota_note}）"

            return {
                "category": category,
                "provider": provider,
                "model": model,
                "base_url": base_url,
                "configured": True,
                "status": status,
                "http_status": resp.status_code,
                "message": message,
                "rate_limit": rate_limit,
                "token_quota": volc_token_quota,
                "checked_at": _now_iso(),
            }
        except Exception as e:
            message = f"网络错误：{str(e)[:200]}"
            if is_volc and volc_quota_note:
                message = f"{message}（{volc_quota_note}）"
            return {
                "category": category,
                "provider": provider,
                "model": model,
                "base_url": base_url,
                "configured": True,
                "status": "network_error",
                "message": message,
                "rate_limit": None,
                "token_quota": volc_token_quota,
                "checked_at": _now_iso(),
            }

    async def _probe_tts(self, settings: Dict[str, Any], module_scope: bool) -> Dict[str, Any]:
        tts = settings.get("tts") or {}
        provider = str(tts.get("provider") or "volc_tts_v1_http").strip() or "volc_tts_v1_http"

        def _status(configured: bool, message: str) -> Dict[str, Any]:
            return {
                "category": "tts",
                "provider": provider,
                "model": "",
                "base_url": "",
                "configured": configured,
                "status": "configured" if configured else "not_configured",
                "message": message,
                "rate_limit": None,
                "checked_at": _now_iso(),
            }

        if provider.startswith("fish"):
            fish = tts.get("fish") or {}
            key = str(fish.get("apiKey") or "").strip()
            return _status(bool(key), "Fish TTS 未提供统一余量探测接口")

        if provider == "aliyun_bailian_tts_v2":
            bailian = tts.get("bailian") or {}
            key = str(bailian.get("apiKey") or "").strip()
            return _status(bool(key), "Bailian TTS 为 WebSocket 协议，暂不做统一余量探测")

        if provider.startswith("custom_"):
            from services.storage_service import storage

            custom = storage.get_module_custom_provider(provider) if module_scope else None
            if not custom:
                custom = storage.get_custom_provider(provider)
            configured = bool(str((custom or {}).get("apiKey") or "").strip())
            return _status(configured, "自定义 TTS 接口差异较大，暂不做统一余量探测")

        volc = tts.get("volc") or {}
        appid = str(volc.get("appid") or "").strip()
        token = str(volc.get("accessToken") or "").strip()
        return _status(bool(appid and token), "火山 TTS 暂无通用余额查询接口")

    async def probe_providers(self, settings: Dict[str, Any], scope: str = "module") -> Dict[str, Any]:
        module_scope = scope != "agent"
        if not isinstance(settings, dict):
            settings = {}

        shared_volc_quota: Optional[Dict[str, Any]] = None
        if self._should_probe_volc_quota(settings=settings, module_scope=module_scope):
            shared_volc_quota = await self._probe_volc_token_quota()

        model_tasks = [
            self._probe_model_service("llm", settings.get("llm") or {}, module_scope, shared_volc_quota),
            self._probe_model_service("image", settings.get("image") or {}, module_scope, shared_volc_quota),
            self._probe_model_service("storyboard", settings.get("storyboard") or {}, module_scope, shared_volc_quota),
            self._probe_model_service("video", settings.get("video") or {}, module_scope, shared_volc_quota),
            self._probe_tts(settings, module_scope),
        ]
        providers = await asyncio.gather(*model_tasks, return_exceptions=False)

        return {
            "scope": scope,
            "generated_at": _now_iso(),
            "providers": providers,
        }


api_monitor = APIMonitorService()
