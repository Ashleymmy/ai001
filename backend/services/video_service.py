"""
视频生成服务
支持多种视频生成 API：可灵、Runway、Pika、MiniMax 等
"""
import os
import uuid
import base64
import asyncio
import aiohttp
import json
from typing import Optional, Dict, Any, List

# 视频输出目录
VIDEO_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "videos")
os.makedirs(VIDEO_DIR, exist_ok=True)


class VideoService:
    def __init__(
        self,
        provider: str = "none",
        api_key: str = "",
        base_url: str = "",
        model: str = ""
    ):
        self.provider = provider
        self.api_key = api_key
        self.base_url = base_url
        self.model = model
        
        print(f"[VideoService] 初始化: provider={provider}, model={model}")
    
    async def generate(
        self,
        image_url: str,
        prompt: str = "",
        duration: float = 5.0,
        fps: int = 24,
        aspect_ratio: str = "16:9",
        motion_strength: float = 0.5,
        seed: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        从图片生成视频
        
        Args:
            image_url: 源图片 URL 或 base64
            prompt: 运动描述提示词
            duration: 视频时长（秒）
            fps: 帧率
            aspect_ratio: 宽高比
            motion_strength: 运动强度 0-1
            seed: 随机种子
        
        Returns:
            {
                "video_url": str,
                "task_id": str,
                "status": str,
                "duration": float,
                "seed": int
            }
        """
        if self.provider == "none" or not self.api_key:
            return await self._generate_placeholder(image_url, prompt, duration)
        
        if self.provider == "kling":
            return await self._generate_kling(image_url, prompt, duration, motion_strength, seed)
        elif self.provider == "runway":
            return await self._generate_runway(image_url, prompt, duration, seed)
        elif self.provider == "minimax":
            return await self._generate_minimax(image_url, prompt, duration, seed)
        elif self.provider == "luma":
            return await self._generate_luma(image_url, prompt, duration, seed)
        elif self.provider == "qwen-video":
            return await self._generate_qwen_video(image_url, prompt, duration, seed)
        elif self.provider == "custom":
            # 检查是否是阿里云 dashscope API
            if self.base_url and "dashscope" in self.base_url:
                return await self._generate_dashscope_video(image_url, prompt, duration, seed)
            return await self._generate_custom(image_url, prompt, duration, seed)
        else:
            return await self._generate_placeholder(image_url, prompt, duration)
    
    async def check_task_status(self, task_id: str) -> Dict[str, Any]:
        """检查异步任务状态"""
        if self.provider == "kling":
            return await self._check_kling_status(task_id)
        elif self.provider == "runway":
            return await self._check_runway_status(task_id)
        elif self.provider == "minimax":
            return await self._check_minimax_status(task_id)
        elif self.provider == "luma":
            return await self._check_luma_status(task_id)
        elif self.provider == "custom" and self.base_url and "dashscope" in self.base_url:
            return await self._check_dashscope_status(task_id)
        else:
            return {"status": "completed", "video_url": None}
    
    async def _generate_placeholder(
        self,
        image_url: str,
        prompt: str,
        duration: float
    ) -> Dict[str, Any]:
        """占位符模式 - 返回示例视频"""
        await asyncio.sleep(1)  # 模拟延迟
        return {
            "video_url": "https://www.w3schools.com/html/mov_bbb.mp4",
            "task_id": str(uuid.uuid4()),
            "status": "completed",
            "duration": duration,
            "seed": abs(hash(prompt)) % 10000
        }
    
    async def _generate_kling(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        motion_strength: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """可灵 AI 视频生成"""
        url = self.base_url or "https://api.klingai.com/v1"
        
        # 处理图片
        image_data = await self._prepare_image(image_url)
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model or "kling-v1",
            "image": image_data,
            "prompt": prompt,
            "duration": min(duration, 10),  # 可灵最长10秒
            "cfg_scale": 0.5 + motion_strength * 0.5,  # 运动强度映射
        }
        
        if seed is not None:
            payload["seed"] = seed
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{url}/videos/image2video",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"可灵 API 错误: {error}")
                
                result = await resp.json()
                
                return {
                    "task_id": result.get("task_id", ""),
                    "status": "processing",
                    "video_url": None,
                    "duration": duration,
                    "seed": seed or 0
                }
    
    async def _check_kling_status(self, task_id: str) -> Dict[str, Any]:
        """检查可灵任务状态"""
        url = self.base_url or "https://api.klingai.com/v1"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{url}/videos/tasks/{task_id}",
                headers=headers
            ) as resp:
                if resp.status != 200:
                    return {"status": "error", "video_url": None}
                
                result = await resp.json()
                status = result.get("status", "unknown")
                
                if status == "completed":
                    return {
                        "status": "completed",
                        "video_url": result.get("video_url", ""),
                        "duration": result.get("duration", 5)
                    }
                elif status == "failed":
                    return {
                        "status": "error",
                        "video_url": None,
                        "error": result.get("error", "生成失败")
                    }
                else:
                    return {
                        "status": "processing",
                        "video_url": None,
                        "progress": result.get("progress", 0)
                    }
    
    async def _generate_runway(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """Runway Gen-3 视频生成"""
        url = self.base_url or "https://api.runwayml.com/v1"
        
        image_data = await self._prepare_image(image_url)
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model or "gen-3-alpha",
            "promptImage": image_data,
            "promptText": prompt,
            "duration": int(min(duration, 10)),
        }
        
        if seed is not None:
            payload["seed"] = seed
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{url}/image_to_video",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"Runway API 错误: {error}")
                
                result = await resp.json()
                
                return {
                    "task_id": result.get("id", ""),
                    "status": "processing",
                    "video_url": None,
                    "duration": duration,
                    "seed": seed or 0
                }
    
    async def _check_runway_status(self, task_id: str) -> Dict[str, Any]:
        """检查 Runway 任务状态"""
        url = self.base_url or "https://api.runwayml.com/v1"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{url}/tasks/{task_id}",
                headers=headers
            ) as resp:
                if resp.status != 200:
                    return {"status": "error", "video_url": None}
                
                result = await resp.json()
                status = result.get("status", "unknown")
                
                if status == "SUCCEEDED":
                    return {
                        "status": "completed",
                        "video_url": result.get("output", [""])[0]
                    }
                elif status == "FAILED":
                    return {
                        "status": "error",
                        "video_url": None,
                        "error": result.get("failure", "生成失败")
                    }
                else:
                    return {
                        "status": "processing",
                        "video_url": None,
                        "progress": result.get("progress", 0)
                    }
    
    async def _generate_minimax(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """MiniMax 视频生成"""
        url = self.base_url or "https://api.minimax.chat/v1"
        
        image_data = await self._prepare_image(image_url)
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model or "video-01",
            "first_frame_image": image_data,
            "prompt": prompt
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{url}/video_generation",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"MiniMax API 错误: {error}")
                
                result = await resp.json()
                
                return {
                    "task_id": result.get("task_id", ""),
                    "status": "processing",
                    "video_url": None,
                    "duration": duration,
                    "seed": seed or 0
                }
    
    async def _check_minimax_status(self, task_id: str) -> Dict[str, Any]:
        """检查 MiniMax 任务状态"""
        url = self.base_url or "https://api.minimax.chat/v1"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{url}/query/video_generation?task_id={task_id}",
                headers=headers
            ) as resp:
                if resp.status != 200:
                    return {"status": "error", "video_url": None}
                
                result = await resp.json()
                status = result.get("status", "unknown")
                
                if status == "Success":
                    return {
                        "status": "completed",
                        "video_url": result.get("file_id", "")
                    }
                elif status == "Fail":
                    return {
                        "status": "error",
                        "video_url": None
                    }
                else:
                    return {
                        "status": "processing",
                        "video_url": None
                    }
    
    async def _generate_luma(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """Luma AI Dream Machine 视频生成"""
        url = self.base_url or "https://api.lumalabs.ai/dream-machine/v1"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # Luma 需要图片 URL
        if image_url.startswith("data:"):
            # 需要先上传图片获取 URL
            raise Exception("Luma AI 需要公开可访问的图片 URL")
        
        payload = {
            "prompt": prompt,
            "keyframes": {
                "frame0": {
                    "type": "image",
                    "url": image_url
                }
            }
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{url}/generations",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status != 200 and resp.status != 201:
                    error = await resp.text()
                    raise Exception(f"Luma API 错误: {error}")
                
                result = await resp.json()
                
                return {
                    "task_id": result.get("id", ""),
                    "status": "processing",
                    "video_url": None,
                    "duration": duration,
                    "seed": seed or 0
                }
    
    async def _check_luma_status(self, task_id: str) -> Dict[str, Any]:
        """检查 Luma 任务状态"""
        url = self.base_url or "https://api.lumalabs.ai/dream-machine/v1"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.get(
                f"{url}/generations/{task_id}",
                headers=headers
            ) as resp:
                if resp.status != 200:
                    return {"status": "error", "video_url": None}
                
                result = await resp.json()
                state = result.get("state", "unknown")
                
                if state == "completed":
                    assets = result.get("assets", {})
                    return {
                        "status": "completed",
                        "video_url": assets.get("video", "")
                    }
                elif state == "failed":
                    return {
                        "status": "error",
                        "video_url": None,
                        "error": result.get("failure_reason", "生成失败")
                    }
                else:
                    return {
                        "status": "processing",
                        "video_url": None
                    }
    
    async def _generate_qwen_video(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """通义视频生成"""
        # 通义视频 API 实现
        url = self.base_url or "https://dashscope.aliyuncs.com/api/v1"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable"
        }
        
        payload = {
            "model": self.model or "wanx-v1-video",
            "input": {
                "image_url": image_url,
                "prompt": prompt
            },
            "parameters": {}
        }
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{url}/services/aigc/video-generation/generation",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"通义视频 API 错误: {error}")
                
                result = await resp.json()
                
                return {
                    "task_id": result.get("output", {}).get("task_id", ""),
                    "status": "processing",
                    "video_url": None,
                    "duration": duration,
                    "seed": seed or 0
                }
    
    async def _generate_custom(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """自定义 API 视频生成"""
        if not self.base_url:
            raise Exception("自定义模式需要配置 Base URL")
        
        image_data = await self._prepare_image(image_url)
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "model": self.model,
            "image": image_data,
            "prompt": prompt,
            "duration": duration
        }
        
        if seed is not None:
            payload["seed"] = seed
        
        async with aiohttp.ClientSession() as session:
            async with session.post(
                f"{self.base_url}/generate",
                headers=headers,
                json=payload
            ) as resp:
                if resp.status != 200:
                    error = await resp.text()
                    raise Exception(f"自定义 API 错误: {error}")
                
                result = await resp.json()
                
                # 尝试适配不同的返回格式
                video_url = result.get("video_url") or result.get("url") or result.get("output")
                task_id = result.get("task_id") or result.get("id") or str(uuid.uuid4())
                
                if video_url:
                    return {
                        "task_id": task_id,
                        "status": "completed",
                        "video_url": video_url,
                        "duration": duration,
                        "seed": seed or 0
                    }
                else:
                    return {
                        "task_id": task_id,
                        "status": "processing",
                        "video_url": None,
                        "duration": duration,
                        "seed": seed or 0
                    }
    
    async def _prepare_image(self, image_url: str) -> str:
        """准备图片数据，返回 base64 或 URL"""
        if image_url.startswith("data:"):
            # 已经是 base64
            return image_url
        elif image_url.startswith("http"):
            # 下载图片并转为 base64
            async with aiohttp.ClientSession() as session:
                async with session.get(image_url) as resp:
                    if resp.status == 200:
                        content = await resp.read()
                        b64 = base64.b64encode(content).decode("utf-8")
                        content_type = resp.headers.get("Content-Type", "image/png")
                        return f"data:{content_type};base64,{b64}"
            return image_url
        else:
            return image_url
    
    async def _save_image_for_url(self, image_data: str) -> str:
        """将 base64 图片保存到本地并返回可访问的 URL"""
        if not image_data.startswith("data:"):
            return image_data
        
        # 解析 base64
        try:
            header, b64_data = image_data.split(",", 1)
            ext = "png"
            if "jpeg" in header or "jpg" in header:
                ext = "jpg"
            
            content = base64.b64decode(b64_data)
            filename = f"{uuid.uuid4()}.{ext}"
            filepath = os.path.join(VIDEO_DIR, filename)
            
            with open(filepath, "wb") as f:
                f.write(content)
            
            # 返回本地文件路径（需要后端提供静态文件服务）
            return f"http://localhost:8000/api/videos/ref/{filename}"
        except Exception as e:
            print(f"[VideoService] 保存图片失败: {e}")
            return image_data
    
    async def _generate_dashscope_video(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """阿里云 DashScope 万相视频生成 (wanx2.1-i2v-turbo, wan2.6-i2v 等)"""
        
        model = self.model or "wanx2.1-i2v-turbo"
        
        # wan2.6 系列必须使用原生异步 API
        if "wan2.6" in model or "wan2.1" in model:
            return await self._generate_dashscope_video_native(image_url, prompt, duration, seed)
        else:
            # 尝试 OpenAI 兼容模式
            return await self._generate_dashscope_video_openai_compat(image_url, prompt, duration, seed)
    
    async def _generate_dashscope_video_openai_compat(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """使用 OpenAI 兼容模式调用万相视频"""
        
        # 如果是 base64，需要先保存到本地获取 URL
        if image_url.startswith("data:"):
            image_url = await self._save_image_for_url(image_url)
        
        url = self.base_url.rstrip("/")
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json"
        }
        
        # 构建消息 - OpenAI 兼容格式
        messages = [
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url}
                    },
                    {
                        "type": "text",
                        "text": prompt or "让图片动起来，生成自然流畅的视频"
                    }
                ]
            }
        ]
        
        payload = {
            "model": self.model or "wanx2.1-i2v-turbo",
            "messages": messages
        }
        
        print(f"[VideoService] DashScope OpenAI 兼容模式请求: model={self.model}")
        print(f"[VideoService] 图片 URL: {image_url[:100]}...")
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    f"{url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=300)
                ) as resp:
                    response_text = await resp.text()
                    print(f"[VideoService] 响应状态: {resp.status}")
                    
                    if resp.status != 200:
                        print(f"[VideoService] 错误响应: {response_text[:500]}")
                        # 尝试解析错误信息
                        try:
                            err_data = json.loads(response_text)
                            err_msg = err_data.get("error", {}).get("message", response_text[:200])
                        except:
                            err_msg = response_text[:200]
                        raise Exception(f"API 错误 ({resp.status}): {err_msg}")
                    
                    result = json.loads(response_text)
                    print(f"[VideoService] 响应数据: {json.dumps(result, ensure_ascii=False)[:500]}")
                    
                    # 解析响应
                    choices = result.get("choices", [])
                    if choices:
                        message = choices[0].get("message", {})
                        content = message.get("content", [])
                        
                        # 查找视频 URL
                        video_url = None
                        if isinstance(content, list):
                            for item in content:
                                if isinstance(item, dict):
                                    if item.get("type") == "video_url":
                                        video_url = item.get("video_url", {}).get("url")
                                        break
                                    elif item.get("type") == "video":
                                        video_url = item.get("video", {}).get("url") or item.get("video_url")
                                        break
                        elif isinstance(content, str):
                            # 可能直接返回 URL
                            if "http" in content:
                                import re
                                urls = re.findall(r'https?://[^\s<>"{}|\\^`\[\]]+', content)
                                for u in urls:
                                    if ".mp4" in u or "video" in u:
                                        video_url = u
                                        break
                        
                        if video_url:
                            print(f"[VideoService] 视频生成成功: {video_url[:100]}")
                            return {
                                "task_id": result.get("id", str(uuid.uuid4())),
                                "status": "completed",
                                "video_url": video_url,
                                "duration": duration,
                                "seed": seed or 0
                            }
                    
                    # 如果没有找到视频 URL，可能是异步任务
                    task_id = result.get("id") or result.get("request_id")
                    if task_id:
                        return {
                            "task_id": task_id,
                            "status": "processing",
                            "video_url": None,
                            "duration": duration,
                            "seed": seed or 0
                        }
                    
                    raise Exception(f"无法解析视频生成结果")
                    
        except aiohttp.ClientError as e:
            raise Exception(f"网络请求失败: {str(e)}")
    
    async def _generate_dashscope_video_native(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int]
    ) -> Dict[str, Any]:
        """使用 DashScope 原生 API 调用视频生成 (wan2.6-i2v 等)"""
        
        # 如果是 base64，需要先保存到本地获取 URL
        # 注意：阿里云需要公网可访问的 URL
        if image_url.startswith("data:"):
            # 保存到本地，但阿里云无法访问 localhost
            # 这里我们直接使用 base64 格式（如果 API 支持）
            pass
        
        model = self.model or "wan2.6-i2v"
        
        # wan2.6-i2v 使用异步任务 API
        url = "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/video-synthesis"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            "X-DashScope-Async": "enable"
        }
        
        # 构建请求体
        payload = {
            "model": model,
            "input": {
                "prompt": prompt or "让图片动起来，生成自然流畅的视频"
            },
            "parameters": {}
        }
        
        # 处理图片输入
        if image_url.startswith("data:"):
            # 提取 base64 数据
            try:
                _, b64_data = image_url.split(",", 1)
                payload["input"]["img_url"] = image_url  # 尝试直接传 data URL
            except:
                payload["input"]["img_url"] = image_url
        else:
            payload["input"]["img_url"] = image_url
        
        print(f"[VideoService] DashScope 原生 API 请求: model={model}")
        print(f"[VideoService] URL: {url}")
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.post(
                    url,
                    headers=headers,
                    json=payload,
                    timeout=aiohttp.ClientTimeout(total=60)
                ) as resp:
                    response_text = await resp.text()
                    print(f"[VideoService] 响应状态: {resp.status}")
                    print(f"[VideoService] 响应内容: {response_text[:500]}")
                    
                    if resp.status != 200:
                        try:
                            err_data = json.loads(response_text)
                            err_msg = err_data.get("message", response_text[:200])
                        except:
                            err_msg = response_text[:200]
                        raise Exception(f"API 错误 ({resp.status}): {err_msg}")
                    
                    result = json.loads(response_text)
                    
                    # 获取任务 ID
                    output = result.get("output", {})
                    task_id = output.get("task_id")
                    
                    if task_id:
                        print(f"[VideoService] 任务已提交: {task_id}")
                        return {
                            "task_id": task_id,
                            "status": "processing",
                            "video_url": None,
                            "duration": duration,
                            "seed": seed or 0
                        }
                    
                    # 如果直接返回了结果
                    video_url = output.get("video_url")
                    if video_url:
                        return {
                            "task_id": result.get("request_id", str(uuid.uuid4())),
                            "status": "completed",
                            "video_url": video_url,
                            "duration": duration,
                            "seed": seed or 0
                        }
                    
                    raise Exception(f"无法获取任务 ID: {result}")
                    
        except aiohttp.ClientError as e:
            raise Exception(f"网络请求失败: {str(e)}")
    
    async def _check_dashscope_status(self, task_id: str) -> Dict[str, Any]:
        """检查 DashScope 任务状态"""
        url = f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}"
        
        headers = {
            "Authorization": f"Bearer {self.api_key}"
        }
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, headers=headers) as resp:
                    response_text = await resp.text()
                    print(f"[VideoService] 任务状态查询: {resp.status}")
                    
                    if resp.status != 200:
                        return {"status": "error", "video_url": None, "error": f"查询失败: {resp.status}"}
                    
                    result = json.loads(response_text)
                    output = result.get("output", {})
                    task_status = output.get("task_status", "UNKNOWN")
                    
                    print(f"[VideoService] 任务 {task_id} 状态: {task_status}")
                    
                    if task_status == "SUCCEEDED":
                        video_url = output.get("video_url")
                        return {
                            "status": "completed",
                            "video_url": video_url
                        }
                    elif task_status == "FAILED":
                        return {
                            "status": "error",
                            "video_url": None,
                            "error": output.get("message", "生成失败")
                        }
                    elif task_status in ["PENDING", "RUNNING"]:
                        return {
                            "status": "processing",
                            "video_url": None,
                            "progress": 50  # DashScope 不返回具体进度
                        }
                    else:
                        return {
                            "status": "processing",
                            "video_url": None
                        }
        except Exception as e:
            print(f"[VideoService] 状态查询异常: {e}")
            return {"status": "error", "video_url": None, "error": str(e)}
    
    async def download_video(self, video_url: str) -> str:
        """下载视频到本地"""
        filename = f"{uuid.uuid4()}.mp4"
        filepath = os.path.join(VIDEO_DIR, filename)
        
        async with aiohttp.ClientSession() as session:
            async with session.get(video_url) as resp:
                if resp.status == 200:
                    with open(filepath, 'wb') as f:
                        f.write(await resp.read())
                    return filepath
        
        return video_url
