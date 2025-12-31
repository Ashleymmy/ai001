"""LLM 服务 - 支持多种大模型提供商"""
import os
import re
from typing import Optional
from openai import AsyncOpenAI

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
        self.api_key = api_key or os.getenv("LLM_API_KEY", "")
        
        # 获取配置
        config = PROVIDER_CONFIGS.get(provider, {})
        self.base_url = base_url or config.get("base_url", "https://api.openai.com/v1")
        self.model = model or config.get("default_model", "gpt-4o-mini")
        
        self.client = None
        if self.api_key:
            self.client = AsyncOpenAI(
                api_key=self.api_key,
                base_url=self.base_url
            )
            print(f"[LLM] 初始化: provider={provider}, model={self.model}, base_url={self.base_url[:50]}...")

    async def parse_story(
        self,
        story_text: str,
        count: int = 4,
        style: str = "cinematic"
    ) -> list[str]:
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

    def _get_style_description(self, style: str) -> str:
        styles = {
            "cinematic": "cinematic lighting, film grain, dramatic shadows, movie scene",
            "anime": "anime style, vibrant colors, cel shading, japanese animation",
            "realistic": "photorealistic, highly detailed, 8k resolution, professional photography",
            "ink": "chinese ink painting style, traditional brush strokes, minimalist"
        }
        return styles.get(style, styles["cinematic"])

    def _simple_parse(self, story_text: str, count: int, style: str = "cinematic") -> list[str]:
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
