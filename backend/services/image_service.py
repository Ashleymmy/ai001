"""图像生成服务 - 支持多种后端"""
import os
import json
import uuid
import asyncio
import base64
import random
from typing import Optional, Dict, Any
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
        negative_prompt: str = "blurry, low quality, distorted, deformed, ugly",
        width: int = 1024,
        height: int = 576,
        steps: int = 25,
        seed: Optional[int] = None
    ) -> Dict[str, Any]:
        """生成图像，返回包含 URL 和参数的字典"""
        actual_seed = seed if seed is not None else random.randint(0, 2147483647)
        print(f"[Image] 生成请求: provider={self.provider}, prompt={prompt[:50]}..., size={width}x{height}, steps={steps}, seed={actual_seed}")
        
        result = {
            "url": "",
            "seed": actual_seed,
            "width": width,
            "height": height,
            "steps": steps
        }
        
        try:
            if self.provider == "placeholder":
                result["url"] = self._placeholder(prompt, actual_seed)
            elif self.provider == "comfyui":
                result["url"] = await self._call_comfyui(prompt, reference_image, negative_prompt, width, height, steps, actual_seed)
            elif self.provider == "sd-webui":
                result["url"] = await self._call_sd_webui(prompt, reference_image, negative_prompt, width, height, steps, actual_seed)
            elif self.provider == "qwen-image":
                result["url"] = await self._call_qwen_image(prompt, reference_image, width, height)
            elif self.provider == "dalle":
                result["url"] = await self._call_dalle(prompt, width, height)
            elif self.provider == "stability":
                result["url"] = await self._call_stability(prompt, negative_prompt, width, height, steps, actual_seed)
            elif self.provider == "flux":
                result["url"] = await self._call_flux(prompt, width, height)
            elif self.provider == "custom":
                result["url"] = await self._call_custom(prompt, negative_prompt, width, height)
            else:
                result["url"] = await self._call_openai_compatible(prompt, width, height)
        except Exception as e:
            print(f"[Image] 生成失败: {e}")
            result["url"] = self._placeholder(prompt, actual_seed)
        
        return result
    
    def _placeholder(self, prompt: str, seed: int = None) -> str:
        """返回占位图"""
        if seed is None:
            seed = abs(hash(prompt)) % 10000
        return f"https://picsum.photos/seed/{seed}/1024/576"
    
    async def _call_custom(self, prompt: str, negative_prompt: str = "", width: int = 1024, height: int = 1024) -> str:
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
    
    async def _call_openai_compatible(self, prompt: str, width: int = 1024, height: int = 1024) -> str:
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
                    "size": f"{width}x{height}"
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
        negative_prompt: str = "",
        width: int = 1024,
        height: int = 576,
        steps: int = 25,
        seed: int = 0
    ) -> str:
        """调用本地 ComfyUI"""
        try:
            workflow = self._get_comfyui_workflow(prompt, negative_prompt, width, height, steps, seed)
            
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
                
                return self._placeholder(prompt, seed)
        except Exception as e:
            print(f"[ComfyUI] 错误: {e}")
            return self._placeholder(prompt, seed)
    
    def _get_comfyui_workflow(self, prompt: str, negative_prompt: str, width: int = 1024, height: int = 576, steps: int = 25, seed: int = 0) -> dict:
        """基础 SDXL 工作流"""
        return {
            "3": {
                "class_type": "KSampler",
                "inputs": {
                    "seed": seed,
                    "steps": steps, "cfg": 7.5,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal", "denoise": 1.0,
                    "model": ["4", 0], "positive": ["6", 0],
                    "negative": ["7", 0], "latent_image": ["5", 0]
                }
            },
            "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "sd_xl_base_1.0.safetensors"}},
            "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
            "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
            "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative_prompt, "clip": ["4", 1]}},
            "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
            "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "storyboard", "images": ["8", 0]}}
        }
    
    async def _call_sd_webui(self, prompt: str, reference_image: Optional[str] = None, negative_prompt: str = "", width: int = 1024, height: int = 576, steps: int = 25, seed: int = -1) -> str:
        """调用 SD WebUI API"""
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                payload = {"prompt": prompt, "negative_prompt": negative_prompt, "steps": steps, "width": width, "height": height, "cfg_scale": 7.5, "seed": seed}
                response = await client.post(f"{self.sd_webui_url}/sdapi/v1/txt2img", json=payload)
                if response.status_code == 200:
                    data = response.json()
                    images = data.get("images", [])
                    if images:
                        return f"data:image/png;base64,{images[0]}"
                return self._placeholder(prompt, seed)
        except Exception as e:
            print(f"[SD-WebUI] 错误: {e}")
            return self._placeholder(prompt, seed)
    
    async def _call_qwen_image(self, prompt: str, reference_image: Optional[str] = None, width: int = 1024, height: int = 576) -> str:
        """调用通义万相 API - 支持参考图"""
        if not self.api_key:
            print("[Qwen-Image] 缺少 API Key")
            return self._placeholder(prompt)
        
        # 尝试使用 DashScope SDK（支持本地文件上传）
        try:
            from dashscope import ImageSynthesis
            from http import HTTPStatus
            
            model = self.model or "wanx-v1"
            size_str = f"{width}*{height}"
            
            # 准备参数
            kwargs = {
                "api_key": self.api_key,
                "model": model,
                "prompt": prompt,
                "n": 1,
                "size": size_str
            }
            
            # 处理参考图
            ref_file_path = None
            if reference_image:
                if reference_image.startswith('http://') or reference_image.startswith('https://'):
                    kwargs["ref_img"] = reference_image
                    kwargs["ref_mode"] = "refonly"
                    kwargs["ref_strength"] = 0.7
                    print(f"[Qwen-Image] 使用参考图 URL")
                elif reference_image.startswith('data:image'):
                    # base64 图片，保存到本地文件
                    try:
                        import base64 as b64
                        header, data = reference_image.split(',', 1)
                        image_data = b64.b64decode(data)
                        
                        images_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "images")
                        os.makedirs(images_dir, exist_ok=True)
                        
                        ref_file_path = os.path.join(images_dir, f"ref_{uuid.uuid4().hex[:8]}.png")
                        with open(ref_file_path, 'wb') as f:
                            f.write(image_data)
                        
                        # 使用 sketch_image_url 参数传入本地文件路径
                        kwargs["sketch_image_url"] = ref_file_path
                        kwargs["ref_mode"] = "refonly"
                        kwargs["ref_strength"] = 0.7
                        print(f"[Qwen-Image] 使用本地参考图: {ref_file_path}")
                    except Exception as e:
                        print(f"[Qwen-Image] 处理参考图失败: {e}")
            
            print(f"[Qwen-Image] SDK 调用: model={model}, has_ref={bool(reference_image)}")
            
            # 同步调用 SDK
            rsp = ImageSynthesis.call(**kwargs)
            
            if rsp.status_code == HTTPStatus.OK:
                results = rsp.output.results
                if results:
                    url = results[0].url
                    print(f"[Qwen-Image] 生成成功: {url[:50]}...")
                    return url
            else:
                print(f"[Qwen-Image] SDK 调用失败: {rsp.status_code}, {rsp.code}, {rsp.message}")
            
            return self._placeholder(prompt)
            
        except ImportError:
            print("[Qwen-Image] DashScope SDK 未安装，使用 HTTP API")
            # 回退到 HTTP API（不支持本地文件）
            return await self._call_qwen_image_http(prompt, reference_image, width, height)
        except Exception as e:
            print(f"[Qwen-Image] SDK 错误: {e}")
            return self._placeholder(prompt)
    
    async def _call_qwen_image_http(self, prompt: str, reference_image: Optional[str] = None, width: int = 1024, height: int = 576) -> str:
        """调用通义万相 HTTP API（不支持本地文件参考图）"""
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                headers = {
                    "Authorization": f"Bearer {self.api_key}", 
                    "Content-Type": "application/json",
                    "X-DashScope-Async": "enable"
                }
                model = self.model or "wanx-v1"
                size_str = f"{width}*{height}"
                
                input_data = {"prompt": prompt}
                parameters = {"size": size_str, "n": 1}
                
                if reference_image and (reference_image.startswith('http://') or reference_image.startswith('https://')):
                    input_data["ref_img"] = reference_image
                    parameters["ref_mode"] = "refonly"
                    parameters["ref_strength"] = 0.7
                
                payload = {"model": model, "input": input_data, "parameters": parameters}
                
                print(f"[Qwen-Image] HTTP API 调用: model={model}")
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
    
    async def _call_dalle(self, prompt: str, width: int = 1792, height: int = 1024) -> str:
        """调用 DALL·E API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
                model = self.model or "dall-e-3"
                # DALL-E 支持的尺寸: 1024x1024, 1792x1024, 1024x1792
                size = f"{width}x{height}"
                if size not in ["1024x1024", "1792x1024", "1024x1792"]:
                    size = "1792x1024"  # 默认横版
                payload = {"model": model, "prompt": prompt, "n": 1, "size": size, "quality": "standard"}
                
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
    
    async def _call_stability(self, prompt: str, negative_prompt: str = "", width: int = 1024, height: int = 576, steps: int = 30, seed: int = 0) -> str:
        """调用 Stability AI API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=120.0) as client:
                headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
                payload = {
                    "text_prompts": [{"text": prompt, "weight": 1}, {"text": negative_prompt, "weight": -1}],
                    "cfg_scale": 7, "height": height, "width": width, "samples": 1, "steps": steps, "seed": seed
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
    
    async def _call_flux(self, prompt: str, width: int = 1024, height: int = 576) -> str:
        """调用 Flux (via Replicate) API"""
        if not self.api_key:
            return self._placeholder(prompt)
        
        try:
            async with httpx.AsyncClient(timeout=180.0) as client:
                headers = {"Authorization": f"Token {self.api_key}", "Content-Type": "application/json"}
                model = self.model or "flux-schnell"
                # 计算宽高比
                aspect = "16:9" if width > height else ("9:16" if height > width else "1:1")
                payload = {
                    "version": f"black-forest-labs/{model}",
                    "input": {"prompt": prompt, "aspect_ratio": aspect, "output_format": "webp"}
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
