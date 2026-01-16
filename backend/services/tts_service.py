import base64
import json
import uuid
from dataclasses import dataclass
from typing import Any, Dict, Optional, Tuple

import httpx

try:
    import ormsgpack  # type: ignore
except Exception:  # pragma: no cover
    ormsgpack = None


@dataclass(frozen=True)
class VolcTTSConfig:
    appid: str
    access_token: str
    cluster: str = "volcano_tts"
    model: str = "seed-tts-1.1"
    endpoint: str = "https://openspeech.bytedance.com/api/v1/tts"
    uid: str = "ai-storyboarder"


class VolcTTSService:
    def __init__(self, config: VolcTTSConfig):
        self.config = config

    # Curated voice library (extend as needed). These are "voice_type" IDs.
    VOICE_LIBRARY = [
        {
            "id": "zh_male_shaonianzhixin_moon_bigtts",
            "name": "少年抒辛/Bryan",
            "gender": "male",
            "tags": ["少年", "男孩", "青年", "少年感", "清爽", "bryan", "boy"],
        },
        {
            "id": "zh_female_meilinyyou_moon_bigtts",
            "name": "魅力女友",
            "gender": "female",
            "tags": ["女友", "魅力", "成熟", "亲密", "温柔", "girlfriend"],
        },
        {
            "id": "zh_male_shenyeboke_moon_bigtts",
            "name": "深夜播客",
            "gender": "male",
            "tags": ["播客", "旁白", "叙述", "深夜", "低沉", "narration", "podcast"],
        },
        {
            "id": "zh_female_sajiaonyyou_moon_bigtts",
            "name": "柔美女友",
            "gender": "female",
            "tags": ["柔美", "女友", "温柔", "甜美", "girlfriend"],
        },
        {
            "id": "zh_female_yuanqinyyou_moon_bigtts",
            "name": "撒娇学妹",
            "gender": "female",
            "tags": ["撒娇", "学妹", "元气", "活泼", "可爱", "妹妹", "junior"],
        },
        {
            "id": "zh_male_haoyuxiaoge_moon_bigtts",
            "name": "浩宇小哥",
            "gender": "male",
            "tags": ["小哥", "青年", "对话", "自然", "口语", "bro"],
        },
    ]

    @classmethod
    def detect_gender(cls, text: str) -> Optional[str]:
        t = (text or "").lower()
        female_kw = ["女", "女生", "女声", "女孩", "少女", "学妹", "姐姐", "妈妈", "妻子", "女友", "female", "girl", "woman"]
        male_kw = ["男", "男生", "男声", "男孩", "少年", "小哥", "大叔", "爸爸", "丈夫", "male", "boy", "man"]
        if any(k in t for k in female_kw) and not any(k in t for k in male_kw):
            return "female"
        if any(k in t for k in male_kw) and not any(k in t for k in female_kw):
            return "male"
        # If both present, don't guess.
        return None

    @classmethod
    def auto_pick_voice_type(
        cls,
        *,
        role: str,
        name: str = "",
        description: str = "",
        profile: str = "",
        prefer_gender: Optional[str] = None,
    ) -> str:
        """Pick a best-effort voice_type from VOICE_LIBRARY based on heuristics.

        role: narration/dialogue
        """
        role = (role or "dialogue").strip().lower()
        blob = f"{name}\n{description}\n{profile}".strip()
        blob_l = blob.lower()

        gender = prefer_gender or cls.detect_gender(blob)

        # Role preference: narration prefers podcast-like voice if possible.
        role_boost = {}
        if role == "narration":
            role_boost = {"播客": 3, "旁白": 3, "叙述": 2, "narration": 2, "podcast": 2}

        keyword_to_voice = {
            # strong matches
            "播客": "zh_male_shenyeboke_moon_bigtts",
            "旁白": "zh_male_shenyeboke_moon_bigtts",
            "深夜": "zh_male_shenyeboke_moon_bigtts",
            "学妹": "zh_female_yuanqinyyou_moon_bigtts",
            "撒娇": "zh_female_yuanqinyyou_moon_bigtts",
            "女友": "zh_female_meilinyyou_moon_bigtts",
            "柔美": "zh_female_sajiaonyyou_moon_bigtts",
            "魅力": "zh_female_meilinyyou_moon_bigtts",
            "少年": "zh_male_shaonianzhixin_moon_bigtts",
            "小哥": "zh_male_haoyuxiaoge_moon_bigtts",
            "口语": "zh_male_haoyuxiaoge_moon_bigtts",
            "对话": "zh_male_haoyuxiaoge_moon_bigtts",
            "bryan": "zh_male_shaonianzhixin_moon_bigtts",
        }

        # Direct keyword mapping wins early.
        for kw, vid in keyword_to_voice.items():
            if kw in blob_l:
                return vid

        best_id = ""
        best_score = -10_000
        for v in cls.VOICE_LIBRARY:
            score = 0
            if gender and v.get("gender") == gender:
                score += 3
            if role_boost:
                for kw, w in role_boost.items():
                    if kw in blob:
                        score += w
            for tag in v.get("tags") or []:
                if isinstance(tag, str) and tag.lower() in blob_l:
                    score += 1
            # slight preference for narration voice for narration
            if role == "narration" and v["id"] == "zh_male_shenyeboke_moon_bigtts":
                score += 2
            if score > best_score:
                best_score = score
                best_id = v["id"]

        # Fallbacks
        if best_id:
            return best_id
        if gender == "female":
            return "zh_female_meilinyyou_moon_bigtts"
        return "zh_male_haoyuxiaoge_moon_bigtts"

    @staticmethod
    def _extract_error_detail(response: httpx.Response) -> str:
        logid = response.headers.get("X-Tt-Logid") or response.headers.get("x-tt-logid") or ""
        body_text = ""
        try:
            body_text = response.text
        except Exception:
            body_text = ""
        try:
            payload = response.json()
            if isinstance(payload, dict):
                msg = payload.get("message") or payload.get("Message") or ""
                code = payload.get("code") or payload.get("Code") or ""
                if msg or code:
                    body_text = f"code={code} message={msg}".strip()
        except Exception:
            pass
        suffix = f" (X-Tt-Logid={logid})" if logid else ""
        return (body_text or "").strip() + suffix

    async def synthesize(
        self,
        text: str,
        voice_type: str,
        *,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
        rate: int = 24000,
        emotion: Optional[str] = None,
        enable_emotion: bool = False,
        emotion_scale: Optional[float] = None,
        explicit_language: Optional[str] = None,
        disable_markdown_filter: bool = True,
    ) -> Tuple[bytes, int]:
        """Synthesize text to speech via Volc OpenSpeech V1 HTTP.

        Returns (audio_bytes, duration_ms).
        """
        safe_text = (text or "").strip()
        if not safe_text:
            raise ValueError("text is empty")

        if not voice_type or not str(voice_type).strip():
            raise ValueError("voice_type is required")

        if not self.config.appid or not self.config.access_token:
            raise ValueError("missing appid/access_token")

        extra_param: Dict[str, Any] = {}
        if disable_markdown_filter:
            extra_param["disable_markdown_filter"] = True

        payload: Dict[str, Any] = {
            "app": {
                "appid": self.config.appid,
                "token": "x",  # fake token per docs (non-empty)
                "cluster": self.config.cluster,
            },
            "user": {"uid": self.config.uid},
            "audio": {
                "voice_type": voice_type,
                "encoding": encoding,
                "speed_ratio": float(speed_ratio),
                "rate": int(rate),
            },
            "request": {
                "reqid": str(uuid.uuid4()),
                "text": safe_text,
                "operation": "query",
                "model": self.config.model,
            },
        }

        if explicit_language:
            payload["audio"]["explicit_language"] = explicit_language

        if enable_emotion and emotion:
            payload["audio"]["enable_emotion"] = True
            payload["audio"]["emotion"] = emotion
            if emotion_scale is not None:
                payload["audio"]["emotion_scale"] = float(emotion_scale)

        if extra_param:
            payload["request"]["extra_param"] = json.dumps(extra_param, ensure_ascii=False)

        headers = {
            # 文档要求 Bearer 与 token 以分号分隔："Bearer;${token}"（注意不要在 token 前额外加空格）
            "Authorization": f"Bearer;{str(self.config.access_token).strip()}",
            "Content-Type": "application/json",
        }

        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            try:
                resp = await client.post(self.config.endpoint, headers=headers, json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = self._extract_error_detail(e.response)
                raise RuntimeError(f"TTS HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"TTS request failed: {e}")

            data = resp.json()

        code = int(data.get("code") or 0)
        if code != 3000:
            msg = data.get("message") or "TTS error"
            raise RuntimeError(f"TTS failed: code={code} message={msg}")

        b64 = data.get("data") or ""
        audio_bytes = base64.b64decode(b64)
        duration_ms = 0
        try:
            duration_ms = int((data.get("addition") or {}).get("duration") or 0)
        except Exception:
            duration_ms = 0
        return audio_bytes, duration_ms


@dataclass(frozen=True)
class FishTTSConfig:
    api_key: str
    base_url: str = "https://api.fish.audio"
    # Request header "model" for /v1/tts. Examples: "speech-1.5" (legacy SDK), "s1" (new SDK).
    model: str = "speech-1.5"


class FishTTSService:
    def __init__(self, config: FishTTSConfig):
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

    async def synthesize(
        self,
        text: str,
        reference_id: str,
        *,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
        rate: int = 24000,
    ) -> Tuple[bytes, int]:
        """Synthesize text to speech via Fish Audio /v1/tts (msgpack streaming).

        Returns (audio_bytes, duration_ms). duration_ms is best-effort (0 when unknown).
        """
        safe_text = (text or "").strip()
        if not safe_text:
            raise ValueError("text is empty")

        ref = (reference_id or "").strip()
        if not ref:
            raise ValueError("reference_id is required")

        api_key = str(self.config.api_key or "").strip()
        if not api_key:
            raise ValueError("missing api_key")

        fmt = (encoding or "mp3").strip().lower()
        if fmt not in ("mp3", "wav", "pcm", "opus"):
            raise ValueError(f"unsupported format: {fmt}")

        payload: Dict[str, Any] = {
            "text": safe_text,
            "format": fmt,
            "sample_rate": int(rate),
            "reference_id": ref,
            "latency": "balanced",
            "normalize": True,
            "prosody": {"speed": float(speed_ratio), "volume": 0.0},
        }

        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/msgpack",
            "model": (self.config.model or "speech-1.5").strip() or "speech-1.5",
        }

        base_url = (self.config.base_url or "https://api.fish.audio").strip().rstrip("/")
        url = f"{base_url}/v1/tts"

        async with httpx.AsyncClient(timeout=None, follow_redirects=True) as client:
            try:
                if ormsgpack is None:
                    raise RuntimeError("missing dependency: ormsgpack (pip install -r backend/requirements.txt)")
                resp = await client.post(url, headers=headers, content=ormsgpack.packb(payload))
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = self._extract_error_detail(e.response)
                raise RuntimeError(f"TTS HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"TTS request failed: {e}")

            # Fish returns streaming audio bytes as response body.
            audio_bytes = resp.content

        # Best-effort: duration is not returned by API; callers may estimate for PCM/WAV.
        return audio_bytes, 0


@dataclass(frozen=True)
class DashScopeTTSConfig:
    api_key: str
    # DashScope TTS v2 uses WebSocket by default (dashscope.base_websocket_api_url).
    # Keep configurable for proxies/self-hosted endpoints.
    base_url: str = "wss://dashscope.aliyuncs.com/api-ws/v1/inference"
    model: str = "cosyvoice-v1"
    workspace: str = ""


class DashScopeTTSService:
    def __init__(self, config: DashScopeTTSConfig):
        self.config = config

    @staticmethod
    def _to_audio_format(encoding: str, rate: int):
        try:
            from dashscope.audio import tts_v2
        except Exception as e:  # pragma: no cover
            raise RuntimeError(f"DashScope SDK not available: {e}")

        enc = (encoding or "mp3").strip().lower() or "mp3"
        sr = int(rate or 24000)

        mp3_map = {
            8000: tts_v2.AudioFormat.MP3_8000HZ_MONO_128KBPS,
            16000: tts_v2.AudioFormat.MP3_16000HZ_MONO_128KBPS,
            22050: tts_v2.AudioFormat.MP3_22050HZ_MONO_256KBPS,
            24000: tts_v2.AudioFormat.MP3_24000HZ_MONO_256KBPS,
            44100: tts_v2.AudioFormat.MP3_44100HZ_MONO_256KBPS,
            48000: tts_v2.AudioFormat.MP3_48000HZ_MONO_256KBPS,
        }
        wav_map = {
            8000: tts_v2.AudioFormat.WAV_8000HZ_MONO_16BIT,
            16000: tts_v2.AudioFormat.WAV_16000HZ_MONO_16BIT,
            22050: tts_v2.AudioFormat.WAV_22050HZ_MONO_16BIT,
            24000: tts_v2.AudioFormat.WAV_24000HZ_MONO_16BIT,
            44100: tts_v2.AudioFormat.WAV_44100HZ_MONO_16BIT,
            48000: tts_v2.AudioFormat.WAV_48000HZ_MONO_16BIT,
        }
        pcm_map = {
            8000: tts_v2.AudioFormat.PCM_8000HZ_MONO_16BIT,
            16000: tts_v2.AudioFormat.PCM_16000HZ_MONO_16BIT,
            22050: tts_v2.AudioFormat.PCM_22050HZ_MONO_16BIT,
            24000: tts_v2.AudioFormat.PCM_24000HZ_MONO_16BIT,
            44100: tts_v2.AudioFormat.PCM_44100HZ_MONO_16BIT,
            48000: tts_v2.AudioFormat.PCM_48000HZ_MONO_16BIT,
        }
        opus_map = {
            8000: tts_v2.AudioFormat.OGG_OPUS_8KHZ_MONO_32KBPS,
            16000: tts_v2.AudioFormat.OGG_OPUS_16KHZ_MONO_32KBPS,
            24000: tts_v2.AudioFormat.OGG_OPUS_24KHZ_MONO_32KBPS,
            48000: tts_v2.AudioFormat.OGG_OPUS_48KHZ_MONO_32KBPS,
        }

        if enc == "wav":
            return wav_map.get(sr, tts_v2.AudioFormat.WAV_24000HZ_MONO_16BIT)
        if enc == "pcm":
            return pcm_map.get(sr, tts_v2.AudioFormat.PCM_24000HZ_MONO_16BIT)
        if enc == "opus":
            # DashScope uses OGG/Opus variants.
            return opus_map.get(sr, tts_v2.AudioFormat.OGG_OPUS_24KHZ_MONO_32KBPS)
        return mp3_map.get(sr, tts_v2.AudioFormat.MP3_24000HZ_MONO_256KBPS)

    async def synthesize(
        self,
        *,
        text: str,
        voice: str,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
        rate: int = 24000,
    ) -> Tuple[bytes, int]:
        safe_text = (text or "").strip()
        if not safe_text:
            raise ValueError("text is empty")

        api_key = str(self.config.api_key or "").strip()
        if not api_key:
            raise ValueError("missing api_key")

        voice = (voice or "").strip()
        if not voice:
            raise ValueError("voice is required")

        try:
            import dashscope
            from dashscope.audio import tts_v2
        except Exception as e:  # pragma: no cover
            raise RuntimeError(f"DashScope SDK not available: {e}")

        audio_format = self._to_audio_format(encoding, rate)

        prev_key = getattr(dashscope, "api_key", None)
        dashscope.api_key = api_key
        try:
            from urllib.parse import urlparse

            raw_url = str(self.config.base_url or "").strip()
            ws_url: Optional[str] = None
            if raw_url:
                parsed = urlparse(raw_url)
                scheme = (parsed.scheme or "").lower()
                if scheme in {"ws", "wss"}:
                    ws_url = raw_url
                elif scheme in {"http", "https"}:
                    # Back-compat: users may paste DashScope HTTP base URL; map to SDK default websocket endpoint.
                    ws_default = str(getattr(dashscope, "base_websocket_api_url", "") or "").strip()
                    http_default = str(getattr(dashscope, "base_http_api_url", "") or "").strip().rstrip("/")
                    if http_default and raw_url.rstrip("/") == http_default and ws_default:
                        ws_url = ws_default
                    elif "dashscope.aliyuncs.com" in raw_url and ws_default:
                        ws_url = ws_default
                    else:
                        raise ValueError(
                            f"DashScope WebSocket URL must start with ws:// or wss:// (leave empty to use default), got: {raw_url}"
                        )
                else:
                    raise ValueError(
                        f"DashScope WebSocket URL scheme must be ws/wss (leave empty to use default), got: {raw_url}"
                    )

            synthesizer = tts_v2.SpeechSynthesizer(
                model=(self.config.model or "cosyvoice-v1").strip() or "cosyvoice-v1",
                voice=voice,
                format=audio_format,
                speech_rate=float(speed_ratio or 1.0),
                workspace=(self.config.workspace or None),
                url=ws_url,
            )
            import asyncio

            audio_bytes = await asyncio.to_thread(synthesizer.call, safe_text)
        finally:
            dashscope.api_key = prev_key

        return audio_bytes or b"", 0


@dataclass(frozen=True)
class OpenAITTSConfig:
    api_key: str
    base_url: str = "https://api.openai.com/v1"
    model: str = ""


class OpenAITTSService:
    def __init__(self, config: OpenAITTSConfig):
        self.config = config

    @staticmethod
    def _normalize_base_url(base_url: str) -> str:
        url = (base_url or "").strip().rstrip("/")
        if not url:
            return "https://api.openai.com/v1"
        return url

    @staticmethod
    def _to_response_format(encoding: str) -> str:
        fmt = (encoding or "mp3").strip().lower() or "mp3"
        if fmt in {"mp3", "wav", "pcm", "opus"}:
            return fmt
        # OpenAI defaults to mp3.
        return "mp3"

    async def synthesize(
        self,
        *,
        text: str,
        voice: str,
        encoding: str = "mp3",
        speed_ratio: float = 1.0,
    ) -> Tuple[bytes, int]:
        safe_text = (text or "").strip()
        if not safe_text:
            raise ValueError("text is empty")

        api_key = str(self.config.api_key or "").strip()
        if not api_key:
            raise ValueError("missing api_key")

        voice = (voice or "").strip()
        if not voice:
            raise ValueError("voice is required")

        base_url = self._normalize_base_url(self.config.base_url)
        url = f"{base_url}/audio/speech"

        payload: Dict[str, Any] = {
            "model": (self.config.model or "").strip() or "gpt-4o-mini-tts",
            "input": safe_text,
            "voice": voice,
            "response_format": self._to_response_format(encoding),
        }
        # OpenAI expects speed in [0.25, 4.0]; keep best-effort.
        if speed_ratio and abs(float(speed_ratio) - 1.0) > 1e-6:
            payload["speed"] = float(speed_ratio)

        headers = {"Authorization": f"Bearer {api_key}"}

        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            try:
                resp = await client.post(url, headers=headers, json=payload)
                resp.raise_for_status()
            except httpx.HTTPStatusError as e:
                detail = ""
                try:
                    detail = json.dumps(e.response.json(), ensure_ascii=False)
                except Exception:
                    detail = (e.response.text or "").strip()
                raise RuntimeError(f"TTS HTTP {e.response.status_code}: {detail}")
            except Exception as e:
                raise RuntimeError(f"TTS request failed: {e}")

        return resp.content or b"", 0
