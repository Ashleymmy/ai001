from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx


@dataclass(frozen=True)
class FishAudioConfig:
    api_key: str
    base_url: str = "https://api.fish.audio"


class FishAudioService:
    def __init__(self, config: FishAudioConfig):
        self.config = config

    @staticmethod
    def _extract_error_detail(response: httpx.Response) -> str:
        try:
            payload = response.json()
            if isinstance(payload, dict):
                msg = payload.get("message") or payload.get("detail") or ""
                code = payload.get("status") or payload.get("code") or ""
                if msg or code:
                    return f"code={code} message={msg}".strip()
        except Exception:
            pass
        try:
            return (response.text or "").strip()
        except Exception:
            return ""

    def _headers(self) -> Dict[str, str]:
        api_key = str(self.config.api_key or "").strip()
        if not api_key:
            raise ValueError("missing api_key")
        return {
            "Authorization": f"Bearer {api_key}",
            "User-Agent": "ai-storyboarder/fish-audio",
        }

    def _base_url(self) -> str:
        base_url = (self.config.base_url or "https://api.fish.audio").strip().rstrip("/")
        return base_url or "https://api.fish.audio"

    async def list_models(
        self,
        *,
        page_size: int = 10,
        page_number: int = 1,
        title: Optional[str] = None,
        tag: Optional[str] = None,
        self_only: bool = True,
        author_id: Optional[str] = None,
        language: Optional[str] = None,
        title_language: Optional[str] = None,
        sort_by: str = "task_count",
        model_type: str = "tts",
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "page_size": int(page_size),
            "page_number": int(page_number),
            "self": bool(self_only),
            "sort_by": sort_by,
        }
        if title:
            params["title"] = title
        if tag:
            params["tag"] = tag
        if author_id:
            params["author_id"] = author_id
        if language:
            params["language"] = language
        if title_language:
            params["title_language"] = title_language

        url = f"{self._base_url()}/model"

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                resp = await client.get(url, headers=self._headers(), params=params)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = self._extract_error_detail(e.response)
                raise RuntimeError(f"Fish API HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"Fish API request failed: {e}")

            data = resp.json()

        # Best-effort filtering: keep only requested type when present.
        if model_type and isinstance(data, dict) and isinstance(data.get("items"), list):
            filtered: List[Any] = []
            for item in data["items"]:
                if not isinstance(item, dict):
                    continue
                t = str(item.get("type") or "").strip()
                if not t or t == model_type:
                    filtered.append(item)
            data["items"] = filtered
        return data if isinstance(data, dict) else {"items": data}

    async def get_model(self, model_id: str) -> Dict[str, Any]:
        mid = str(model_id or "").strip()
        if not mid:
            raise ValueError("model_id is required")
        url = f"{self._base_url()}/model/{mid}"

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                resp = await client.get(url, headers=self._headers())
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = self._extract_error_detail(e.response)
                raise RuntimeError(f"Fish API HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"Fish API request failed: {e}")
            data = resp.json()
        return data if isinstance(data, dict) else {"data": data}

    async def delete_model(self, model_id: str) -> None:
        mid = str(model_id or "").strip()
        if not mid:
            raise ValueError("model_id is required")
        url = f"{self._base_url()}/model/{mid}"
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                resp = await client.delete(url, headers=self._headers())
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = self._extract_error_detail(e.response)
                raise RuntimeError(f"Fish API HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"Fish API request failed: {e}")

    async def create_tts_model(
        self,
        *,
        title: str,
        voices: Sequence[Tuple[str, bytes, str]],
        description: Optional[str] = None,
        visibility: str = "private",
        train_mode: str = "fast",
        tags: Optional[List[str]] = None,
        enhance_audio_quality: bool = True,
        cover_image: Optional[Tuple[str, bytes, str]] = None,
        texts: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        if not str(title or "").strip():
            raise ValueError("title is required")
        if not voices:
            raise ValueError("voices is required")

        data: Dict[str, Any] = {
            "visibility": str(visibility or "private"),
            "type": "tts",
            "title": str(title).strip(),
            "train_mode": str(train_mode or "fast"),
            "enhance_audio_quality": bool(enhance_audio_quality),
        }
        if description:
            data["description"] = str(description)
        if tags:
            data["tags"] = [t for t in tags if isinstance(t, str) and t.strip()]
        if texts:
            data["texts"] = [t for t in texts if isinstance(t, str) and t.strip()]

        files: List[Tuple[str, Tuple[str, bytes, str]]] = []
        for filename, content, content_type in voices:
            files.append(("voices", (filename, content, content_type)))
        if cover_image:
            files.append(("cover_image", cover_image))

        url = f"{self._base_url()}/model"

        async with httpx.AsyncClient(timeout=120.0, follow_redirects=True) as client:
            try:
                resp = await client.post(url, headers=self._headers(), data=data, files=files)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = self._extract_error_detail(e.response)
                raise RuntimeError(f"Fish API HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"Fish API request failed: {e}")

            data = resp.json()

        return data if isinstance(data, dict) else {"data": data}

