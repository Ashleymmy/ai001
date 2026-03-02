"""AI Storyboarder Backend – Application entry-point.

After Phase 0 refactoring, all route handlers live under ``routers/`` and
shared helpers / service instances live in ``dependencies.py``.  This file
only creates the FastAPI app, registers middleware, includes routers,
runs startup initialisation, and launches uvicorn.
"""

import os
from typing import Optional
from time import perf_counter

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from services.api_monitor_service import api_monitor
import dependencies as deps

# ── routers ──────────────────────────────────────────────────────────
from routers import (
    health,
    settings,
    tts,
    generation,
    projects,
    scripts,
    media,
    chat,
    export,
    monitor,
    agent,
    auth,
    workspace,
    studio,
)

# ── UTF-8 JSON response class ───────────────────────────────────────

class UTF8JSONResponse(JSONResponse):
    media_type = "application/json; charset=utf-8"


# ── App creation ─────────────────────────────────────────────────────

app = FastAPI(title="AI Storyboarder Backend", default_response_class=UTF8JSONResponse)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── API metrics middleware ───────────────────────────────────────────

@app.middleware("http")
async def collect_api_usage_metrics(request: Request, call_next):
    path = request.url.path
    tracked = api_monitor.mark_request_started(path)
    start = perf_counter()
    status_code = 500
    error_detail: Optional[str] = None
    try:
        response = await call_next(request)
        status_code = int(getattr(response, "status_code", 200))
        return response
    except Exception as e:
        error_detail = str(e)
        raise
    finally:
        if tracked:
            duration_ms = (perf_counter() - start) * 1000.0
            api_monitor.mark_request_finished(
                method=request.method,
                path=path,
                status_code=status_code,
                duration_ms=duration_ms,
                error=error_detail,
            )


# ── Register routers ────────────────────────────────────────────────

app.include_router(health.router)
app.include_router(settings.router)
app.include_router(tts.router)
app.include_router(generation.router)
app.include_router(projects.router)
app.include_router(scripts.router)
app.include_router(media.router)
app.include_router(chat.router)
app.include_router(export.router)
app.include_router(monitor.router)
app.include_router(agent.router)
app.include_router(auth.router)
app.include_router(workspace.router)
app.include_router(studio.router)


# ── Startup / shutdown ──────────────────────────────────────────────

@app.on_event("startup")
async def startup_event():
    deps.load_saved_settings()


# ── Entry-point ─────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    port_raw = os.getenv("AI_STORYBOARDER_PORT") or os.getenv("BACKEND_PORT") or os.getenv("PORT") or "8001"
    try:
        port = int(port_raw)
    except Exception:
        port = 8001
    uvicorn.run(app, host="0.0.0.0", port=port)
