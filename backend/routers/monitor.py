"""Monitor routes: /api/stats, /api/images/stats, /api/monitor/*."""

from typing import Dict, Any
from fastapi import APIRouter

from services.storage_service import storage
from services.api_monitor_service import api_monitor
import dependencies as deps
from schemas.settings import ApiMonitorBudgetRequest, ApiMonitorConfigRequest

router = APIRouter(prefix="/api", tags=["monitor"])


@router.get("/stats")
async def get_stats():
    stats = storage.get_stats()
    return stats


@router.get("/images/stats")
async def get_image_stats():
    stats = storage.get_image_stats()
    return stats


@router.get("/monitor/usage")
async def get_api_monitor_usage(window_minutes: int = 60):
    return api_monitor.get_usage_snapshot(window_minutes=window_minutes)


@router.get("/monitor/budget")
async def get_api_monitor_budget():
    return {"budgets": api_monitor.get_budgets()}


@router.post("/monitor/budget")
async def update_api_monitor_budget(request: ApiMonitorBudgetRequest):
    budgets = api_monitor.update_budgets(request.budgets)
    return {"status": "ok", "budgets": budgets}


@router.get("/monitor/config")
async def get_api_monitor_config():
    return api_monitor.get_probe_config()


@router.post("/monitor/config")
async def update_api_monitor_config(request: ApiMonitorConfigRequest):
    payload: Dict[str, Any] = {}
    volc_payload = request.volcengine.model_dump(exclude_none=True)
    if volc_payload:
        payload["volcengine"] = volc_payload
    config = api_monitor.update_probe_config(payload)
    return {"status": "ok", "config": config}


@router.get("/monitor/providers")
async def get_api_monitor_providers(scope: str = "module"):
    selected_scope = "agent" if str(scope).strip().lower() == "agent" else "module"
    settings = deps.current_settings if selected_scope == "agent" else deps.module_current_settings
    return await api_monitor.probe_providers(settings=settings, scope=selected_scope)
