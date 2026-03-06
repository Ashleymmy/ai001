"""Chat routes: /api/chat, /api/bridge/generate-text, /api/chat/history/*."""

from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from services.storage_service import storage
from services.llm_service import create_structured_sse_response
import dependencies as deps
from schemas.settings import ChatRequest, BridgeGenerateTextRequest

router = APIRouter(prefix="/api", tags=["chat"])


class SaveChatRequest(BaseModel):
    session_id: str
    module: str
    role: str
    content: str


@router.post("/chat")
async def chat_with_ai(request: ChatRequest):
    service = deps.get_request_llm_service(request.llm)
    try:
        reply = await service.chat(
            message=request.message,
            context=request.context
        )
        return {"reply": reply}
    except Exception as e:
        print(f"对话失败: {e}")
        return {"reply": f"抱歉，出现错误: {str(e)}"}


@router.post("/chat/stream")
async def chat_with_ai_stream(req: ChatRequest, request: Request):
    service = deps.get_request_llm_service(req.llm)
    stream_gen = service.stream_chat(
        message=req.message,
        context=req.context,
    )
    return create_structured_sse_response(stream_gen, request=request)


@router.post("/bridge/generate-text")
async def bridge_generate_text(request: BridgeGenerateTextRequest):
    service = deps.get_llm_service()
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


@router.post("/chat/history")
async def save_chat_message(request: SaveChatRequest):
    msg = storage.save_chat_message(request.session_id, request.module, request.role, request.content)
    return msg


@router.get("/chat/history/{session_id}")
async def get_chat_history(session_id: str, module: Optional[str] = None, limit: int = 50):
    history = storage.get_chat_history(session_id, module, limit)
    return {"history": history}


@router.delete("/chat/history/{session_id}")
async def clear_chat_history(session_id: str, module: Optional[str] = None):
    storage.clear_chat_history(session_id, module)
    return {"status": "ok"}


@router.get("/chat/sessions")
async def list_chat_sessions(limit: int = 50, module: Optional[str] = None):
    sessions = storage.list_chat_sessions(limit, module=module)
    return {"sessions": sessions}


# History routes (project / script)
@router.get("/projects/{project_id}/history")
async def get_project_history(project_id: str):
    history = storage.get_project_history(project_id)
    return {"history": history}


@router.get("/scripts/{script_id}/history")
async def get_script_history(script_id: str):
    history = storage.get_script_history(script_id)
    return {"history": history}
