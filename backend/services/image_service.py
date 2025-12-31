"""图像生成服务 - 支持多种后端"""
import os
import json
import uuid
import asyncio
import base64
from typing import Optional
import httpx


class ImageService:
    def __init__(
        self,
        provider: str = "placeholder",
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        comfyui_url: str = "http://127.0.0.1:8188",
        sd_webui_url: str = "http://127.0.0.1:7860"
    ):
        self.provider = provider
        self.api_key = api_key or os.getenv("IMAGE_API_KEY", "")
        self.base_url = base_url or ""
        self.model = model or ""
        self.comfyui_url = comfyui_url
        self.sd_webui_url = sd_webui_url
        
        print(f"[Image] 初始化: provider={provider}, model={model}, base_url={base_url}")
    
    async def generate(
        self,
        prompt: str,
        reference_image: Optional[str] = None,
        style: str = "cinematic",
        negative_prompt: str = "blurry, low quality, distorted, deformed, ugly"
    ) -> str:
        """生成图像，返回图像 URL"""
        print(f"[Image] 生成请求: provider={self.provider}, prompt={prompt[:50]}...")
        
        try:
            if self.provider == "placeholder":
                return self._placeholder(prompt)
            elif self.provider == "comfyui":
                return await self._call_comfyui(prompt, reference_image, negative_prompt)
            elif self.provider == "sd-webui":
                return await self._call_sd_webui(prompt, reference_image, negative_prompt)
            elif self.provider == "qwen-image":
                return await self._call_qwen_image(prompt, reference_image)
            elif self.provider == "dalle":
                return await self._call_dalle(prompt)
            elif self.provider == "stability":
                return await self._call_stability(prompt, negative_prompt)
            elif self.provider == "flux":
                return await self._call_flux(prompt)
            elif self.provider == "custom":
                return await self._call_custom(prompt, negative_prompt)
            else:
                # 尝试作为 OpenAI 兼容 API 调用
                return await self._call_openai_compatible(prompt)
        except Exception as e:
            print(f"[Image] 生成失败: {e}")
            return self._placeholder(prompt)
    
    def _placeholder(self, prompt: str) -> str:
        """返回占位图"""
        seed = abs(hash(prompt)) % 10000
        return f"https://picsum.photos/seed/{seed}/1024/576"
    
    async def _call_custom(self, prompt: str, negative_prompt: str = "") -> str:
        """调用自定义 API（OpenAI 兼容格式）"""
        if not self.api_key or not self.base_url:
            print("[Custom] 缺少 API Key 或 Base URL")
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                
                # 尝试 OpenAI 格式
                payload = {
                    "model": self.model or "dall-e-3",
                    "prompt": prompt,
                    "n": 1,
                    "size": "1024x1024"
                }
                
                url = self.base_url.rstrip('/') + '/images/generations'
                print(f"[Custom] 调用: {url}")
                
                response = await client.post(url, headers=headers, json=payload)
                print(f"[Custom] 响应状态: {response.status_code}")
                
                if response.status_code == 200:
                    data = response.json()
                    # OpenAI 格式
                    if "data" in data and len(data["data"]) > 0:
                        return data["data"][0].get("url") or data["data"][0].get("b64_json", "")
                    # 其他格式
                    if "url" in data:
                        return data["url"]
                    if "image" in data:
                        return data["image"]
                else:
                    print(f"[Custom] 错误响应: {response.text[:200]}")
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[Custom] 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_openai_compatible(self, prompt: str) -> str:
        """调用 OpenAI 兼容的图像 API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        base_url = self.base_url or "https://api.openai.com/v1"
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": self.model or "dall-e-3",
                    "prompt": prompt,
                    "n": 1,
                    "size": "1024x1024"
                }
                
                response = await client.post(
                    f"{base_url.rstrip('/')}/images/generations",
                    headers=headers,
                    json=payload
                )
                
                if response.status_code == 200:
                    data = response.json()
                    if "data" in data and len(data["data"]) > 0:
                        return data["data"][0].get("url", self._placeholder(prompt))
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[OpenAI-Compatible] 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_comfyui(
        self,
        prompt: str,
        reference_image: Optional[str] = None,
        negative_prompt: str = ""
    ) -> str:
        """调用本地 ComfyUI"""
        try:
            workflow = self._get_comfyui_workflow(prompt, negative_prompt)
            
            async with httpx.AsyncClient(timeout=120.0) as client:
                response = await client.post(
                    f"{self.comfyui_url}/prompt",
                    json={"prompt": workflow, "client_id": str(uuid.uuid4())}
                )
                
                if response.status_code == 200:
                    result = response.json()
                    prompt_id = result.get("prompt_id")
                    await asyncio.sleep(10)
                    history = await client.get(f"{self.comfyui_url}/history/{prompt_id}")
                    if history.status_code == 200:
                        data = history.json()
                        outputs = data.get(prompt_id, {}).get("outputs", {})
                        for node_id, output in outputs.items():
                            images = output.get("images", [])
                            if images:
                                filename = images[0].get("filename")
                                return f"{self.comfyui_url}/view?filename={filename}"
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[ComfyUI] 错误: {e}")
            return self._placeholder(prompt)
    
    def _get_comfyui_workflow(self, prompt: str, negative_prompt: str) -> dict:
        """基础 SDXL 工作流"""
        return {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": abs(hash(prompt)) % 1000000,
                    "steps": 25, "cfg": 7.5,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal", "denoise": 1.0,
                    "model": ["4", 0], "positive": ["6", 0],
                    "negative": ["7", 0], "latent_image": ["5", 0]
                }
            },
            "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
            "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 576, "batch_size": 1}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative_prompt, "clip": ["4", 1]}},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "storyboard", "images": ["8", 0]}}
        }
    
    async def _call_sd_webui(self, prompt: str, reference_image: Optional[str] = None, negative_prompt: str = "") -> str:
        """调用 SD WebUI API"""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                payload = {"prompt": prompt, "negative_prompt": negative_prompt, "steps": 25, "width": 1024, "height": 576, "cfg_scale": 7.5}
                response = await client.post(f"{self.sd_webui_url}/sdapi/v1/txt2img", json=payload)
                if response.status_code == 200:
                    data = response.json()
                    images = data.get("images", [])
                    if images:
                        return f"data:image/png;base64,{images[0]}"
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[SD-WebUI] 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_qwen_image(self, prompt: str, reference_image: Optional[str] = None) -> str:
        """调用通义万相 API"""
        if not self.api_key:
            print("[Qwen-Image] 缺少 API Key")
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                headers = {
                    "Authorization": f"Bearer {self.api_key}", 
                    "Content-Type": "application/json",
                    "X-DashScope-Async": "enable"  # 必须启用异步模式
                }
                model = self.model or "wanx-v1"
                payload = {
                    "model": model, 
                    "input": {"prompt": prompt}, 
                    "parameters": {"size": "1024*576", "n": 1}
                }
                
                print(f"[Qwen-Image] 提交任务: model={model}")
                response = await client.post(
                    "https://dashscope.aliyuncs.com/api/v1/services/aigc/text2image/image-synthesis",
                    headers=headers, json=payload
                )
                
                print(f"[Qwen-Image] 响应状态: {response.status_code}")
                result = response.json()
                print(f"[Qwen-Image] 响应内容: {result}")
                
                if response.status_code == 200:
                    task_id = result.get("output", {}).get("task_id")
                    if not task_id:
                        print(f"[Qwen-Image] 未获取到 task_id")
                        return self._placeholder(prompt)
                    
                    print(f"[Qwen-Image] 任务已提交: task_id={task_id}")
                    
                    # 轮询任务状态
                    for i in range(90):  # 最多等待 3 分钟
                        await asyncio.sleep(2)
                        status_resp = await client.get(
                            f"https://dashscope.aliyuncs.com/api/v1/tasks/{task_id}", 
                            headers={"Authorization": f"Bearer {self.api_key}"}
                        )
                        if status_resp.status_code == 200:
                            status_data = status_resp.json()
                            task_status = status_data.get("output", {}).get("task_status")
                            print(f"[Qwen-Image] 任务状态 ({i+1}): {task_status}")
                            
                            if task_status == "SUCCEEDED":
                                results = status_data.get("output", {}).get("results", [])
                                if results:
                                    url = results[0].get("url")
                                    print(f"[Qwen-Image] 生成成功: {url[:50]}...")
                                    return url
                            elif task_status == "FAILED":
                                print(f"[Qwen-Image] 任务失败: {status_data}")
                                break
                        else:
                            print(f"[Qwen-Image] 查询状态失败: {status_resp.status_code}")
                else:
                    print(f"[Qwen-Image] 请求失败: {result}")
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[Qwen-Image] 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_dalle(self, prompt: str) -> str:
        """调用 DALL·E API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
                model = self.model or "dall-e-3"
                payload = {"model": model, "prompt": prompt, "n": 1, "size": "1792x1024", "quality": "standard"}
                
                response = await client.post("https://api.openai.com/v1/images/generations", headers=headers, json=payload)
                
                if response.status_code == 200:
                    data = response.json()
                    images = data.get("data", [])
                    if images:
                        return images[0].get("url", self._placeholder(prompt))
                else:
                    print(f"[DALL-E] 错误: {response.text[:200]}")
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[DALL-E] 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_stability(self, prompt: str, negative_prompt: str = "") -> str:
        """调用 Stability AI API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
                payload = {
                    "text_prompts": [{"text": prompt, "weight": 1}, {"text": negative_prompt, "weight": -1}],
                    "cfg_scale": 7, "height": 576, "width": 1024, "samples": 1, "steps": 30
                }
                
                model = self.model or "stable-diffusion-xl-1024-v1-0"
                response = await client.post(f"https://api.stability.ai/v1/generation/{model}/text-to-image", headers=headers, json=payload)
                
                if response.status_code == 200:
                    data = response.json()
                    artifacts = data.get("artifacts", [])
                    if artifacts:
                        b64 = artifacts[0].get("base64")
                        return f"data:image/png;base64,{b64}"
                else:
                    print(f"[Stability] 错误: {response.text[:200]}")
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[Stability] 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_flux(self, prompt: str) -> str:
        """调用 Flux (via Replicate) API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                headers = {"Authorization": f"Token {self.api_key}", "Content-Type": "application/json"}
                model = self.model or "flux-schnell"
                payload = {
                    "version": f"black-forest-labs/{model}",
                    "input": {"prompt": prompt, "aspect_ratio": "16:9", "output_format": "webp"}
                }
                
                response = await client.post("https://api.replicate.com/v1/predictions", headers=headers, json=payload)
                
                if response.status_code in [200, 201]:
                    data = response.json()
                    prediction_url = data.get("urls", {}).get("get")
                    
                    for _ in range(60):
                        await asyncio.sleep(2)
                        status_resp = await client.get(prediction_url, headers=headers)
                        if status_resp.status_code == 200:
                            status_data = status_resp.json()
                            if status_data.get("status") == "succeeded":
                                output = status_data.get("output")
                                if output:
                                    return output[0] if isinstance(output, list) else output
                            elif status_data.get("status") == "failed":
                                break
                
                return self._placeholder(prompt)
        except Exception as e:
            print(f"[Flux] 错误: {e}")
            return self._placeholder(prompt)
