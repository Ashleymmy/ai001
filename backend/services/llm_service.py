"""LLM 服务 - 基于 OpenAI 原生 SDK 的多服务商/中转渠道适配。"""
import os
import re
import json
import asyncio
from typing import Optional, List, Dict, Any, AsyncGenerator
from openai import AsyncOpenAI
from fastapi.responses import StreamingResponse

# 预设的提供商配置
PROVIDER_CONFIGS = {
    "qwen": {
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
        "default_model": "qwen-plus"
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o"
    },
    # OpenAI 兼容中转/聚合渠道（通过 OpenAI 原生 SDK + base_url 接入）
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "default_model": "openai/gpt-4o-mini"
    },
    "oneapi": {
        "base_url": "https://your-oneapi-domain/v1",
        "default_model": "gpt-4o-mini"
    },
    "newapi": {
        "base_url": "https://your-newapi-domain/v1",
        "default_model": "gpt-4o-mini"
    },
    "siliconflow": {
        "base_url": "https://api.siliconflow.cn/v1",
        "default_model": "Qwen/Qwen2.5-72B-Instruct"
    },
    "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "default_model": "deepseek-chat"
    },
    "zhipu": {
        "base_url": "https://open.bigmodel.cn/api/paas/v4",
        "default_model": "glm-4-flash"
    },
    "moonshot": {
        "base_url": "https://api.moonshot.cn/v1",
        "default_model": "moonshot-v1-8k"
    },
    "baichuan": {
        "base_url": "https://api.baichuan-ai.com/v1",
        "default_model": "Baichuan4"
    },
    "yi": {
        "base_url": "https://api.lingyiwanwu.com/v1",
        "default_model": "yi-large"
    },
    "doubao": {
        "base_url": "https://ark.cn-beijing.volces.com/api/v3",
        "default_model": "doubao-pro-4k"
    },
    "custom": {
        "base_url": "https://api.openai.com/v1",
        "default_model": "gpt-4o-mini"
    }
}

STORYBOARD_SYSTEM_PROMPT = """你是一位专业的影视分镜师。根据用户提供的剧情描述，将其拆解为具体的分镜画面描述。

每个分镜描述应包含：
1. 画面内容（人物动作、表情、位置）
2. 镜头语言（特写/中景/远景/俯拍/仰拍等）
3. 光影氛围（明暗、色调、时间）
4. 环境细节

要求：
- 直接输出英文描述，用于图像生成
- 每个分镜用 ||| 分隔
- 描述要具体、可视化，适合 AI 绘图
- 保持叙事连贯性

示例输出：
A young woman in a red dress enters a dimly lit room, medium shot, warm golden light from a window, vintage furniture, cinematic atmosphere ||| Close-up of her hand reaching for an envelope on an antique wooden desk, soft focus background, dramatic shadows ||| ..."""


class LLMService:
    def __init__(
        self,
        provider: str = "qwen",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None
    ):
        self.provider = provider
        self.api_key = (
            (api_key or "").strip()
            or os.getenv("LLM_API_KEY", "").strip()
            or os.getenv("OPENAI_API_KEY", "").strip()
        )
        
        # 获取配置
        config = PROVIDER_CONFIGS.get(provider, {})
        env_base_url = os.getenv("LLM_BASE_URL", "").strip() or os.getenv("OPENAI_BASE_URL", "").strip()
        self.base_url = self._normalize_base_url(
            base_url or env_base_url or config.get("base_url", "https://api.openai.com/v1")
        )
        self.model = model or config.get("default_model", "gpt-4o-mini")
        
        self.client = None
        if self.api_key:
            self.client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url
            )
            print(f"[LLM] 初始化: provider={provider}, model={self.model}, base_url={self.base_url[:50]}...")

    @staticmethod
    def _normalize_base_url(base_url: Optional[str]) -> str:
        """统一处理 base_url，避免尾随 / 导致的路径拼接问题。"""
        raw = (base_url or "").strip()
        if not raw:
            return "https://api.openai.com/v1"
        return raw.rstrip("/")

    async def parse_story(
        self,
        story_text: str,
        count: int = 4,
        style: str = "cinematic"
    ) -> List[str]:
        """将剧情拆解为分镜描述"""
        if not self.client:
            print("[LLM] 未配置 API Key，使用降级方案")
            return self._simple_parse(story_text, count, style)
        
        try:
            user_prompt = f"""请将以下剧情拆解为 {count} 个分镜画面描述：

剧情：{story_text}

风格要求：{self._get_style_description(style)}

请直接输出 {count} 个英文分镜描述，用 ||| 分隔。"""

            print(f"[LLM] 调用 {self.provider}/{self.model} 拆解剧本...")
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": STORYBOARD_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                temperature=0.8,
                max_tokens=2000
            )
            
            result = response.choices[0].message.content or ""
            prompts = [p.strip() for p in result.split("|||") if p.strip()]
            
            while len(prompts) < count:
                prompts.append(f"Continuation scene, {self._get_style_description(style)}")
            
            print(f"[LLM] 成功生成 {len(prompts)} 个分镜描述")
            return prompts[:count]
            
        except Exception as e:
            print(f"[LLM] 调用失败: {e}")
            return self._simple_parse(story_text, count, style)

    async def chat(self, message: str, context: Optional[str] = None) -> str:
        """通用对话接口"""
        print(f"[Chat] 收到消息: {message[:50]}...")
        print(f"[Chat] API Key: {'已配置' if self.api_key else '未配置'}, Provider: {self.provider}")
        
        if not self.client:
            print("[Chat] 客户端未初始化，使用降级回复")
            return self._simple_chat(message)
        
        try:
            system_prompt = """你是一位专业的影视分镜助手，擅长：
1. 优化和改进剧情描述
2. 提供分镜创意和建议
3. 解释镜头语言和画面构图
4. 帮助用户完善视频脚本

请用简洁、专业的语言回答用户问题。"""

            messages = [{"role": "system", "content": system_prompt}]
            
            if context:
                messages.append({
                    "role": "system",
                    "content": f"当前项目上下文：{context}"
                })
            
            messages.append({"role": "user", "content": message})

            print(f"[Chat] 调用 {self.provider}/{self.model}...")
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=1000
            )
            
            reply = response.choices[0].message.content or "抱歉，我没有理解你的问题。"
            print(f"[Chat] 成功获取回复")
            return reply
            
        except Exception as e:
            print(f"[Chat] 调用失败: {e}")
            return f"调用 {self.provider} API 失败: {str(e)}\n\n请检查 API Key 和网络连接。"

    async def generate_text(
        self,
        prompt: str,
        system_prompt: str = "",
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
        model: Optional[str] = None,
        top_p: Optional[float] = None,
    ) -> str:
        """通用文本生成（支持自定义 system prompt），用于 bridge 调用。"""
        if not self.client:
            return self._simple_chat(prompt)

        messages: List[Dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        kwargs: Dict[str, Any] = {
            "model": model or self.model,
            "messages": messages,
            "temperature": float(temperature),
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = int(max_tokens)
        if top_p is not None:
            kwargs["top_p"] = float(top_p)

        response = await self.client.chat.completions.create(**kwargs)
        return response.choices[0].message.content or ""

    async def stream_structured_output(
        self,
        prompt: str,
        system_prompt: str = "",
        model_config: dict = None,
        response_schema: dict = None,
    ) -> AsyncGenerator[dict, None]:
        """Stream structured JSON output similar to Vercel AI SDK's streamObject.

        Yields dicts with one of the following shapes:
        - {"type": "delta", "content": str, "accumulated": str}
        - {"type": "progress", "percentage": float}
        - {"type": "complete", "content": str, "parsed": dict}
        - {"type": "error", "message": str}

        The caller can break out of the generator at any time to cancel.
        """
        if not self.client:
            yield {"type": "error", "message": "LLM client not initialised (missing API key)"}
            return

        messages: List[Dict[str, Any]] = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        cfg = model_config or {}
        model = cfg.get("model") or self.model
        temperature = float(cfg.get("temperature", 0.7))
        max_tokens = cfg.get("max_tokens")

        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": messages,
            "temperature": temperature,
            "stream": True,
        }
        if max_tokens is not None:
            kwargs["max_tokens"] = int(max_tokens)

        # Request JSON-formatted output when a schema hint is provided.
        if response_schema is not None:
            kwargs["response_format"] = {"type": "json_object"}
            # Embed the schema description into the system prompt so the model
            # knows the expected shape even for providers that ignore the
            # response_format parameter.
            schema_hint = (
                "\n\nIMPORTANT: You MUST reply with a single valid JSON object "
                "matching this schema:\n" + json.dumps(response_schema, ensure_ascii=False)
            )
            if messages and messages[0]["role"] == "system":
                messages[0]["content"] += schema_hint
            else:
                messages.insert(0, {"role": "system", "content": schema_hint.strip()})

        accumulated = ""
        try:
            stream = await self.client.chat.completions.create(**kwargs)

            async for chunk in stream:
                choice = chunk.choices[0] if chunk.choices else None
                if choice is None:
                    continue

                delta_content = choice.delta.content if choice.delta else None
                if delta_content:
                    accumulated += delta_content
                    yield {
                        "type": "delta",
                        "content": delta_content,
                        "accumulated": accumulated,
                    }

                # Emit a rough progress estimate based on accumulated length vs
                # max_tokens (if known).  This is purely informational.
                if max_tokens and accumulated:
                    pct = min(len(accumulated) / (max_tokens * 4) * 100, 99.0)
                    yield {"type": "progress", "percentage": round(pct, 1)}

                if choice.finish_reason is not None:
                    break

            # Try to parse the accumulated text as JSON.
            parsed = None
            if response_schema is not None and accumulated:
                try:
                    parsed = json.loads(accumulated)
                except json.JSONDecodeError:
                    # The model may have wrapped JSON in markdown fences.
                    import re as _re
                    m = _re.search(r"```(?:json)?\s*([\s\S]*?)```", accumulated)
                    if m:
                        try:
                            parsed = json.loads(m.group(1))
                        except json.JSONDecodeError:
                            pass

            yield {
                "type": "complete",
                "content": accumulated,
                "parsed": parsed,
            }

        except asyncio.CancelledError:
            # The caller cancelled the generator (e.g. client disconnected).
            yield {
                "type": "complete",
                "content": accumulated,
                "parsed": None,
            }
        except Exception as exc:
            yield {"type": "error", "message": str(exc)}

    def _get_style_description(self, style: str) -> str:
        styles = {
            "cinematic": "cinematic lighting, film grain, dramatic shadows, movie scene",
            "anime": "anime style, vibrant colors, cel shading, japanese animation",
            "realistic": "photorealistic, highly detailed, 8k resolution, professional photography",
            "ink": "chinese ink painting style, traditional brush strokes, minimalist"
        }
        return styles.get(style, styles["cinematic"])

    def _simple_parse(self, story_text: str, count: int, style: str = "cinematic") -> List[str]:
        """降级方案：简单文本拆分"""
        sentences = re.split(r'[。，！？,.!?]', story_text)
        sentences = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 2]
        
        style_desc = self._get_style_description(style)
        prompts = []
        
        for i in range(count):
            if i < len(sentences):
                prompts.append(f"Scene: {sentences[i]}, {style_desc}")
            else:
                prompts.append(f"Continuation of the story, {style_desc}")
        
        return prompts

    def _simple_chat(self, message: str) -> str:
        """降级回复"""
        message_lower = message.lower()
        
        if any(word in message_lower for word in ['分镜', '镜头', 'shot', 'scene']):
            return """分镜是将剧本转化为视觉画面的过程。常用镜头类型：
- 特写 (Close-up): 突出表情或细节
- 中景 (Medium shot): 展示上半身
- 远景 (Wide shot): 展示环境
- 俯拍/仰拍: 改变视角

请配置 API Key 以获得更智能的回复。"""
        
        if any(word in message_lower for word in ['风格', 'style', '画风']):
            return """支持的画面风格：
- 电影感: 专业电影级光影
- 动漫: 日式动画风格
- 写实: 照片级真实感
- 水墨: 中国传统水墨画"""
        
        return "我是 AI 分镜助手。请在设置中配置 API Key 以启用完整功能。"


# ---------------------------------------------------------------------------
# Standalone helper: wrap a structured stream into a FastAPI SSE response
# ---------------------------------------------------------------------------

def create_structured_sse_response(
    stream_generator: AsyncGenerator[dict, None],
    request=None,
) -> StreamingResponse:
    """Wrap a ``stream_structured_output`` async generator into a FastAPI
    ``StreamingResponse`` that emits Server-Sent Events.

    Each yielded dict is serialised as ``data: {json}\n\n``.

    If *request* is provided (a Starlette ``Request``), the generator will
    stop early when the client disconnects.
    """

    async def _event_source():
        try:
            async for event in stream_generator:
                # Honour client disconnect when a Request is available.
                if request is not None and await request.is_disconnected():
                    break
                yield f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        _event_source(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
