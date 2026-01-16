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
import httpx
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
        seed: Optional[int] = None,
        resolution: str = "720p",
        ratio: str = "16:9",
        camera_fixed: bool = False,
        watermark: bool = False,
        generate_audio: bool = True
    ) -> Dict[str, Any]:
        """
        从图片生成视频
        
        Args:
            image_url: 源图片 URL 或 base64
            prompt: 运动描述提示词
            duration: 视频时长（秒）
            fps: 帧率
            aspect_ratio: 宽高比 (旧参数，保留兼容)
            motion_strength: 运动强度 0-1
            seed: 随机种子
            resolution: 分辨率 720p/1080p
            ratio: 宽高比 16:9/9:16/1:1
            camera_fixed: 是否固定镜头
            watermark: 是否添加水印
            generate_audio: 是否生成音频
        
        Returns:
            {
                "video_url": str,
                "task_id": str,
                "status": str,
                "duration": float,
                "seed": int
            }
        """
        # 检查是否配置了 API
        if self.provider == "none" or not self.api_key:
            raise Exception("视频服务未配置，请在设置中配置视频生成 API")
        
        # 检查是否是自定义配置（以 custom_ 开头）
        if self.provider.startswith("custom_"):
            return await self._call_custom_provider(
                image_url, prompt, duration, seed,
                resolution=resolution, ratio=ratio,
                camera_fixed=camera_fixed, watermark=watermark,
                generate_audio=generate_audio
            )
        
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
            raise Exception(f"不支持的视频服务提供商: {self.provider}")
    
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
        elif self.provider.startswith("custom_"):
            # 自定义配置，根据 base_url 判断
            if self.base_url and ("dashscope" in self.base_url):
                return await self._check_dashscope_status(task_id)
            elif self.base_url and ("volces.com" in self.base_url or "ark.cn" in self.base_url):
                return await self._check_volcengine_status(task_id)
            # 其他自定义 API 暂不支持状态查询
            return {"status": "completed", "video_url": None}
        else:
            return {"status": "completed", "video_url": None}
    
    async def _call_custom_provider(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int],
        resolution: str = "720p",
        ratio: str = "16:9",
        camera_fixed: bool = False,
        watermark: bool = False,
        generate_audio: bool = True
    ) -> Dict[str, Any]:
        """调用自定义配置的视频生成 API - 自动检测 API 格式"""
        if not self.api_key or not self.base_url:
            raise Exception("缺少 API Key 或 Base URL，请在设置中配置")
        
        base_url = self.base_url.rstrip('/')
        
        # 检测是否是阿里云 DashScope API
        if 'dashscope.aliyuncs.com' in base_url or 'dashscope' in base_url:
            return await self._generate_dashscope_video(image_url, prompt, duration, seed)
        
        # 检测是否是火山引擎 API
        if 'volces.com' in base_url or 'ark.cn' in base_url:
            return await self._generate_volcengine_video(
                image_url, prompt, duration, seed,
                resolution=resolution, ratio=ratio,
                camera_fixed=camera_fixed, watermark=watermark,
                generate_audio=generate_audio
            )
        
        # 默认尝试通用自定义格式
        return await self._generate_custom(image_url, prompt, duration, seed)
    
    async def _generate_volcengine_video(
        self,
        image_url: str,
        prompt: str,
        duration: float,
        seed: Optional[int],
        resolution: str = "720p",
        ratio: str = "16:9",
        camera_fixed: bool = False,
        watermark: bool = False,
        generate_audio: bool = True
    ) -> Dict[str, Any]:
        """调用火山引擎视频生成 API（Ark /contents/generations/tasks）

        说明：这里改为 HTTP 直连，避免 SDK 在部分 Python 版本上兼容性问题。
        """
        
        # 处理图片：火山引擎需要公网可访问的 URL 或 base64
        # 如果是 localhost URL，需要转换为 base64
        if image_url.startswith("http://localhost") or image_url.startswith("http://127.0.0.1"):
            try:
                async with aiohttp.ClientSession() as session:
                    async with session.get(image_url) as resp:
                        if resp.status == 200:
                            content = await resp.read()
                            b64 = base64.b64encode(content).decode("utf-8")
                            content_type = resp.headers.get("Content-Type", "image/jpeg")
                            image_url = f"data:{content_type};base64,{b64}"
                            print(f"[VideoService] 已将本地图片转换为 base64")
            except Exception as e:
                print(f"[VideoService] 转换本地图片失败: {e}")
        
        model = self.model or "doubao-seaweed-241128"
        base_url = (self.base_url or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        
        # 火山引擎 seedance 模型支持的时长: 5秒或6秒
        # 将时长限制在支持的范围内
        supported_duration = 5 if duration <= 5 else 6
        
        # 构建参数字符串
        # 支持的参数: --duration, --resolution, --ratio, --camerafixed, --watermark
        params = f"--duration {supported_duration}"
        params += f" --resolution {resolution}"
        params += f" --ratio {ratio}"
        params += f" --camerafixed {'true' if camera_fixed else 'false'}"
        params += f" --watermark {'true' if watermark else 'false'}"
        
        # 构建 content
        content = [
            {
                "type": "text",
                "text": f"{prompt or '让图片动起来，生成自然流畅的视频'} {params}"
            },
            {
                "type": "image_url",
                "image_url": {
                    "url": image_url
                }
            }
        ]
        
        print(f"[VideoService] 火山引擎 HTTP 调用: model={model}")
        print(f"[VideoService] 参数: duration={supported_duration} (原始: {duration}), resolution={resolution}, ratio={ratio}, camera_fixed={camera_fixed}, watermark={watermark}")
        print(f"[VideoService] 图片格式: {'base64' if image_url.startswith('data:') else 'URL'}")
        
        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": model,
            "content": content,
        }
        if generate_audio:
            payload["generate_audio"] = True

        def _is_generate_audio_invalid(resp: httpx.Response) -> bool:
            if resp.status_code != 400:
                return False
            try:
                data = resp.json()
                err = data.get("error") if isinstance(data, dict) else None
                if isinstance(err, dict):
                    if str(err.get("param") or "").strip() == "generate_audio":
                        return True
                    msg = str(err.get("message") or "").lower()
                    if "generate_audio" in msg:
                        return True
            except Exception:
                pass
            # fallback: text sniff
            try:
                return "generate_audio" in (resp.text or "").lower()
            except Exception:
                return False

        try:
            audio_disabled = False
            async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
                resp = await client.post(f"{base_url}/contents/generations/tasks", headers=headers, json=payload)
                if resp.status_code >= 400 and generate_audio and _is_generate_audio_invalid(resp):
                    # 兼容：部分模型（如 seedance-1-0-pro）不支持 generate_audio 参数；自动降级为“无音轨视频”
                    print("[VideoService] 该模型不支持 generate_audio，自动降级为无音频生成")
                    payload_no_audio = {"model": model, "content": content}
                    resp = await client.post(f"{base_url}/contents/generations/tasks", headers=headers, json=payload_no_audio)
                    audio_disabled = True

                if resp.status_code >= 400:
                    raise Exception(f"HTTP {resp.status_code}: {(resp.text or '')[:2000]}")
                data = resp.json()

            task_id = data.get("id") or data.get("task_id") or data.get("taskId")
            if not task_id:
                raise Exception(f"未返回 task_id: {json.dumps(data, ensure_ascii=False)[:2000]}")

            print(f"[VideoService] 火山引擎任务已提交: {task_id}")
            return {
                "task_id": str(task_id),
                "status": "processing",
                "video_url": None,
                "duration": duration,
                "seed": seed or 0,
                "audio_disabled": bool(audio_disabled),
            }
        except Exception as e:
            error_msg = str(e)
            print(f"[VideoService] 火山引擎 HTTP 错误: {error_msg}")
            raise Exception(f"火山引擎调用失败: {error_msg}")
    
    async def _check_volcengine_status(self, task_id: str) -> Dict[str, Any]:
        """检查火山引擎视频生成任务状态（Ark /contents/generations/tasks/{task_id}）"""
        base_url = (self.base_url or "https://ark.cn-beijing.volces.com/api/v3").rstrip("/")
        headers = {"Authorization": f"Bearer {self.api_key}"}

        try:
            async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
                resp = await client.get(f"{base_url}/contents/generations/tasks/{task_id}", headers=headers)
                if resp.status_code >= 400:
                    return {
                        "status": "error",
                        "video_url": None,
                        "error": f"HTTP {resp.status_code}: {(resp.text or '')[:2000]}",
                    }
                data = resp.json()

            status = (data.get("status") or "").strip().lower()
            if not status:
                return {"status": "processing", "video_url": None, "progress": 50}

            print(f"[VideoService] 火山引擎任务 {task_id} 状态: {status}")

            if status in ("succeeded", "completed", "success"):
                content = data.get("content") or {}
                video_url = None
                if isinstance(content, dict):
                    video_url = content.get("video_url") or content.get("videoUrl")
                elif isinstance(content, list):
                    for item in content:
                        if isinstance(item, dict):
                            if item.get("video_url") or item.get("videoUrl"):
                                video_url = item.get("video_url") or item.get("videoUrl")
                                break
                return {"status": "completed", "video_url": video_url}

            if status in ("failed", "error"):
                err = data.get("error") or {}
                if isinstance(err, dict):
                    msg = err.get("message") or err.get("msg") or json.dumps(err, ensure_ascii=False)
                else:
                    msg = str(err) if err else "生成失败"
                return {"status": "error", "video_url": None, "error": msg}

            progress = data.get("progress")
            if isinstance(progress, (int, float)):
                progress_val = int(progress)
            else:
                progress_val = 50
            return {"status": "processing", "video_url": None, "progress": progress_val}

        except Exception as e:
            print(f"[VideoService] 火山引擎状态查询异常: {e}")
            return {"status": "error", "video_url": None, "error": str(e)}
    
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
