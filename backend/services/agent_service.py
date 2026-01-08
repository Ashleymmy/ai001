"""Agent 服务 - 智能视频制作助手

基于 Flova Agent 架构设计，实现：
1. 对话式 AI 助手 - 理解用户需求，制定制作方案
2. 元素引用系统 - [Element_XXX] 机制确保角色一致性
3. 分镜规划系统 - Segment → Shot 结构
4. 提示词模板系统 - 结构化提示词生成
5. 批量生成流程 - 自动化视频制作
"""
import os
import json
import uuid
import re
import asyncio
from datetime import datetime
from typing import Optional, List, Dict, Any, Callable
from openai import AsyncOpenAI
from .storage_service import StorageService

# 镜头类型定义
SHOT_TYPES = {
    "standard": {"name": "标准叙事镜头", "duration": "5-6秒", "description": "用于常规叙事"},
    "quick": {"name": "快速切换", "duration": "3-4秒", "description": "用于关键转折点"},
    "closeup": {"name": "特写镜头", "duration": "4-5秒", "description": "强调细节和情绪"},
    "wide": {"name": "远景镜头", "duration": "6-8秒", "description": "展示环境和场景"},
    "montage": {"name": "蒙太奇", "duration": "8-12秒", "description": "多画面快速切换"}
}

# Agent 系统提示词 - YuanYuan 风格
AGENT_SYSTEM_PROMPT = """你是 YuanYuan，一位专业且友好的 AI 视频制作助手。你的对话风格温暖、专业，善于用分步骤的方式解释复杂的制作流程。

## 你的人设
- 名字：YuanYuan
- 性格：专业、耐心、友好、乐于助人
- 说话风格：清晰、有条理，喜欢用「第一步」「第二步」「第三步」来解释流程
- 特点：会在关键节点等待用户确认，不会一次性做太多事情

## 你的能力
1. **需求理解**: 分析用户的故事描述，提取关键信息
2. **项目规划**: 制定完整的制作方案，包括创意简报、剧本、分镜设计
3. **角色设计**: 为故事中的角色生成详细的视觉描述
4. **分镜拆解**: 将剧本转化为具体的镜头序列
5. **提示词优化**: 生成适合 AI 图像/视频生成的提示词

## 对话风格示例
- 开始任务时：「收到！让我来分析你的需求... 🤔」
- 解释流程时：「**第一步** 我会先创建项目概要\n**第二步** 编写剧本并设计分镜\n**第三步** 生成角色设计图」
- 完成阶段时：「✅ Agent分析完成！」
- 等待确认时：「接下来，你可以选择：\n1. 先让我看看分镜\n2. 一键生成全部\n3. 先生成角色图片」

## 工作流程
1. 接收用户需求后，先分析并确认理解
2. 生成项目规划文档（Creative Brief）
3. 编写剧本并拆解为分镜
4. 设计关键角色和元素
5. 为每个镜头生成详细的提示词
6. 在关键节点等待用户确认

## 元素引用机制
使用 [Element_XXX] 格式引用预生成的角色和物品，确保视觉一致性。
例如：[Element_YOUNG_SERVANT]、[Element_WHITE_SNAKE]

## 提示词结构
[镜头类型] + [时长] + [主体动作] + [场景元素] + [光线氛围] + [画面质感] + [旁白对齐]

## 输出格式
使用 JSON 格式输出结构化数据，便于系统解析和处理。
"""

# 项目规划提示词
PROJECT_PLANNING_PROMPT = """请根据用户的需求，生成完整的项目规划。

用户需求：{user_request}

请输出以下 JSON 格式的项目规划：
```json
{{
  "creative_brief": {{
    "title": "项目标题",
    "video_type": "视频类型（Narrative Story/Commercial/Tutorial等）",
    "narrative_driver": "叙事驱动（旁白驱动/对话驱动/纯视觉）",
    "emotional_tone": "情感基调",
    "visual_style": "视觉风格",
    "duration": "预计时长",
    "aspect_ratio": "画面比例",
    "language": "语言"
  }},
  "elements": [
    {{
      "id": "Element_XXX",
      "name": "元素名称",
      "type": "character/object/scene",
      "description": "详细的视觉描述，用于图像生成"
    }}
  ],
  "segments": [
    {{
      "id": "Segment_XXX",
      "name": "段落名称",
      "description": "段落描述",
      "shots": [
        {{
          "id": "Shot_XXX",
          "name": "镜头名称",
          "type": "standard/quick/closeup/wide/montage",
          "duration": "预计时长",
          "description": "镜头描述",
          "prompt": "完整的图像/视频生成提示词",
          "narration": "对应的旁白文本"
        }}
      ]
    }}
  ],
  "cost_estimate": {{
    "elements": "元素生成预估积分",
    "shots": "镜头生成预估积分",
    "audio": "音频生成预估积分",
    "total": "总计预估积分"
  }}
}}
```

注意：
1. 元素描述要详细，适合 AI 图像生成
2. 镜头提示词要包含元素引用 [Element_XXX]
3. 每个镜头都要有对应的旁白
4. 合理估算成本
"""

# 元素生成提示词模板
ELEMENT_PROMPT_TEMPLATE = """请为以下角色/元素生成详细的图像生成提示词：

元素名称：{element_name}
元素类型：{element_type}
基础描述：{base_description}
视觉风格：{visual_style}

请输出适合 AI 图像生成的英文提示词，包含：
1. 主体描述（外貌、服装、姿态）
2. 风格描述（画风、质感）
3. 光线和氛围
4. 画面质量关键词

输出格式：
```json
{{
  "prompt": "英文提示词",
  "negative_prompt": "负面提示词",
  "recommended_resolution": "推荐分辨率"
}}
```
"""

# 镜头提示词模板
SHOT_PROMPT_TEMPLATE = """请为以下镜头生成详细的视频生成提示词：

镜头名称：{shot_name}
镜头类型：{shot_type}
镜头描述：{shot_description}
涉及元素：{elements}
视觉风格：{visual_style}
旁白内容：{narration}

请输出适合 AI 视频生成的提示词，格式：
```json
{{
  "image_prompt": "起始帧图像提示词（英文）",
  "video_prompt": "视频动态提示词（英文）",
  "camera_movement": "镜头运动描述",
  "duration_seconds": 预计秒数
}}
```
"""


class AgentService:
    """Agent 服务 - 智能视频制作助手"""
    
    def __init__(self, storage: StorageService):
        self.storage = storage
        self.client: Optional[AsyncOpenAI] = None
        self.model = "qwen-plus"
        self._init_client()
    
    def _init_client(self):
        """初始化 LLM 客户端"""
        settings = self.storage.get_settings()
        llm_config = settings.get("llm", {})
        
        api_key = llm_config.get("apiKey") or os.getenv("LLM_API_KEY", "")
        if not api_key:
            print("[Agent] 未配置 LLM API Key")
            return
        
        provider = llm_config.get("provider", "qwen")
        base_url = llm_config.get("baseUrl", "https://dashscope.aliyuncs.com/compatible-mode/v1")
        self.model = llm_config.get("model", "qwen-plus")
        
        # 处理自定义配置
        if provider.startswith("custom_"):
            custom_providers = self.storage.get_custom_providers()
            custom_config = custom_providers.get(provider, {})
            if custom_config:
                api_key = custom_config.get("apiKey", api_key)
                base_url = custom_config.get("baseUrl", base_url)
                self.model = custom_config.get("model", self.model)
        
        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url)
        print(f"[Agent] 初始化完成: model={self.model}")
    
    async def chat(self, message: str, context: Optional[Dict] = None) -> Dict[str, Any]:
        """对话接口 - 处理用户消息并返回结构化响应"""
        if not self.client:
            return {
                "type": "text",
                "content": "请先在设置中配置 LLM API Key 以启用 AI 助手功能。"
            }
        
        try:
            # 构建消息
            messages = [{"role": "system", "content": AGENT_SYSTEM_PROMPT}]
            
            # 添加上下文
            if context:
                context_str = json.dumps(context, ensure_ascii=False, indent=2)
                messages.append({
                    "role": "system",
                    "content": f"当前项目上下文：\n{context_str}"
                })
            
            messages.append({"role": "user", "content": message})
            
            # 调用 LLM
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                temperature=0.7,
                max_tokens=4000
            )
            
            reply = response.choices[0].message.content or ""
            
            # 尝试解析 JSON 响应
            parsed = self._parse_response(reply)
            return parsed
            
        except Exception as e:
            print(f"[Agent] 对话失败: {e}")
            return {
                "type": "error",
                "content": f"AI 助手调用失败: {str(e)}"
            }
    
    async def plan_project(self, user_request: str, style: str = "吉卜力2D") -> Dict[str, Any]:
        """规划项目 - 根据用户需求生成完整的项目规划"""
        if not self.client:
            return {"error": "未配置 LLM API Key"}
        
        try:
            prompt = PROJECT_PLANNING_PROMPT.format(user_request=user_request)
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": AGENT_SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.8,
                max_tokens=6000
            )
            
            reply = response.choices[0].message.content or ""
            
            # 提取 JSON
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', reply)
            if json_match:
                plan = json.loads(json_match.group(1))
                return {"success": True, "plan": plan}
            
            return {"success": False, "error": "无法解析项目规划", "raw": reply}
            
        except Exception as e:
            print(f"[Agent] 项目规划失败: {e}")
            return {"success": False, "error": str(e)}
    
    async def generate_element_prompt(
        self,
        element_name: str,
        element_type: str,
        base_description: str,
        visual_style: str = "吉卜力动画风格"
    ) -> Dict[str, Any]:
        """生成元素的图像提示词"""
        if not self.client:
            return {"error": "未配置 LLM API Key"}
        
        try:
            prompt = ELEMENT_PROMPT_TEMPLATE.format(
                element_name=element_name,
                element_type=element_type,
                base_description=base_description,
                visual_style=visual_style
            )
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一位专业的 AI 图像提示词工程师。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            reply = response.choices[0].message.content or ""
            
            # 提取 JSON
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', reply)
            if json_match:
                result = json.loads(json_match.group(1))
                return {"success": True, **result}
            
            return {"success": False, "error": "无法解析提示词", "raw": reply}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    async def generate_shot_prompt(
        self,
        shot_name: str,
        shot_type: str,
        shot_description: str,
        elements: List[str],
        visual_style: str,
        narration: str
    ) -> Dict[str, Any]:
        """生成镜头的视频提示词"""
        if not self.client:
            return {"error": "未配置 LLM API Key"}
        
        try:
            shot_type_info = SHOT_TYPES.get(shot_type, SHOT_TYPES["standard"])
            
            prompt = SHOT_PROMPT_TEMPLATE.format(
                shot_name=shot_name,
                shot_type=f"{shot_type_info['name']} ({shot_type_info['duration']})",
                shot_description=shot_description,
                elements=", ".join(elements),
                visual_style=visual_style,
                narration=narration
            )
            
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=[
                    {"role": "system", "content": "你是一位专业的 AI 视频提示词工程师。"},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.7,
                max_tokens=1000
            )
            
            reply = response.choices[0].message.content or ""
            
            # 提取 JSON
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', reply)
            if json_match:
                result = json.loads(json_match.group(1))
                return {"success": True, **result}
            
            return {"success": False, "error": "无法解析提示词", "raw": reply}
            
        except Exception as e:
            return {"success": False, "error": str(e)}
    
    def _parse_response(self, reply: str) -> Dict[str, Any]:
        """解析 LLM 响应"""
        # 尝试提取 JSON
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', reply)
        if json_match:
            try:
                data = json.loads(json_match.group(1))
                return {"type": "structured", "data": data, "content": reply}
            except json.JSONDecodeError:
                pass
        
        # 检查是否包含特定指令
        if "生成角色" in reply or "生成元素" in reply:
            return {"type": "action", "action": "generate_elements", "content": reply}
        
        if "生成分镜" in reply or "生成镜头" in reply:
            return {"type": "action", "action": "generate_shots", "content": reply}
        
        # 普通文本响应
        return {"type": "text", "content": reply}
    
    def build_shot_prompt(
        self,
        shot_type: str,
        description: str,
        elements: List[str],
        narration: str,
        style: str = "cinematic"
    ) -> str:
        """构建完整的镜头提示词"""
        shot_info = SHOT_TYPES.get(shot_type, SHOT_TYPES["standard"])
        
        # 替换元素引用
        prompt_parts = [
            f"{shot_info['name']} ({shot_info['duration']})",
            description
        ]
        
        # 添加旁白对齐
        if narration:
            prompt_parts.append(f"对齐旁白：'{narration}'")
        
        return " ".join(prompt_parts)
    
    def resolve_element_references(
        self,
        prompt: str,
        elements: Dict[str, Dict]
    ) -> str:
        """解析提示词中的元素引用，替换为实际描述"""
        def replace_element(match):
            element_id = match.group(1)
            if element_id in elements:
                return elements[element_id].get("description", element_id)
            return match.group(0)
        
        return re.sub(r'\[Element_(\w+)\]', replace_element, prompt)


class AgentProject:
    """Agent 项目数据结构"""
    
    def __init__(self, project_id: Optional[str] = None):
        self.id = project_id or f"agent_{uuid.uuid4().hex[:8]}"
        self.name = "未命名项目"
        self.creative_brief: Dict = {}
        self.elements: Dict[str, Dict] = {}
        self.segments: List[Dict] = []
        self.visual_assets: List[Dict] = []
        self.audio_assets: List[Dict] = []
        self.timeline: List[Dict] = []
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()
    
    def add_element(
        self,
        element_id: str,
        name: str,
        element_type: str,
        description: str,
        image_url: Optional[str] = None
    ) -> Dict:
        """添加元素"""
        element = {
            "id": element_id,
            "name": name,
            "type": element_type,
            "description": description,
            "image_url": image_url,
            "created_at": datetime.now().isoformat()
        }
        self.elements[element_id] = element
        self.updated_at = datetime.now().isoformat()
        return element
    
    def add_segment(
        self,
        segment_id: str,
        name: str,
        description: str
    ) -> Dict:
        """添加段落"""
        segment = {
            "id": segment_id,
            "name": name,
            "description": description,
            "shots": [],
            "created_at": datetime.now().isoformat()
        }
        self.segments.append(segment)
        self.updated_at = datetime.now().isoformat()
        return segment
    
    def add_shot(
        self,
        segment_id: str,
        shot_id: str,
        name: str,
        shot_type: str,
        description: str,
        prompt: str,
        narration: str,
        duration: float = 5.0
    ) -> Optional[Dict]:
        """添加镜头到段落"""
        for segment in self.segments:
            if segment["id"] == segment_id:
                shot = {
                    "id": shot_id,
                    "name": name,
                    "type": shot_type,
                    "description": description,
                    "prompt": prompt,
                    "narration": narration,
                    "duration": duration,
                    "start_image_url": None,
                    "video_url": None,
                    "status": "pending",
                    "created_at": datetime.now().isoformat()
                }
                segment["shots"].append(shot)
                self.updated_at = datetime.now().isoformat()
                return shot
        return None
    
    def to_dict(self) -> Dict:
        """转换为字典"""
        return {
            "id": self.id,
            "name": self.name,
            "creative_brief": self.creative_brief,
            "elements": self.elements,
            "segments": self.segments,
            "visual_assets": self.visual_assets,
            "audio_assets": self.audio_assets,
            "timeline": self.timeline,
            "created_at": self.created_at,
            "updated_at": self.updated_at
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> "AgentProject":
        """从字典创建"""
        project = cls(data.get("id"))
        project.name = data.get("name", "未命名项目")
        project.creative_brief = data.get("creative_brief", {})
        project.elements = data.get("elements", {})
        project.segments = data.get("segments", [])
        project.visual_assets = data.get("visual_assets", [])
        project.audio_assets = data.get("audio_assets", [])
        project.timeline = data.get("timeline", [])
        project.created_at = data.get("created_at", datetime.now().isoformat())
        project.updated_at = data.get("updated_at", datetime.now().isoformat())
        return project


class AgentExecutor:
    """Agent 执行器 - 负责批量生成流程
    
    参照 Flova 的渐进式确认机制：
    1. 每个阶段完成后暂停等待用户确认
    2. 支持中断和恢复
    3. 实时进度回调
    """
    
    def __init__(
        self,
        agent_service: AgentService,
        image_service,  # ImageService
        video_service,  # VideoService
        storage: StorageService
    ):
        self.agent = agent_service
        self.image_service = image_service
        self.video_service = video_service
        self.storage = storage
        self._cancelled = False
    
    def cancel(self):
        """取消执行"""
        self._cancelled = True
    
    async def generate_all_elements(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        on_progress: Optional[Callable[[str, int, int, Dict], None]] = None
    ) -> Dict[str, Any]:
        """批量生成所有元素图片
        
        Args:
            project: 项目对象
            visual_style: 视觉风格
            on_progress: 进度回调 (element_id, current, total, result)
        
        Returns:
            {success: bool, generated: int, failed: int, results: [...]}
        """
        self._cancelled = False
        elements = list(project.elements.values())
        total = len(elements)
        generated = 0
        failed = 0
        results = []
        
        for i, element in enumerate(elements):
            if self._cancelled:
                break
            
            # 跳过已有图片的元素
            if element.get("image_url"):
                results.append({
                    "element_id": element["id"],
                    "status": "skipped",
                    "message": "已有图片"
                })
                continue
            
            try:
                # 生成优化的提示词
                prompt_result = await self.agent.generate_element_prompt(
                    element["name"],
                    element["type"],
                    element["description"],
                    visual_style
                )
                
                if not prompt_result.get("success"):
                    # 使用原始描述作为提示词
                    prompt = f"{element['description']}, {visual_style}, high quality, detailed"
                    negative_prompt = "blurry, low quality, distorted"
                else:
                    prompt = prompt_result.get("prompt", element["description"])
                    negative_prompt = prompt_result.get("negative_prompt", "blurry, low quality")
                
                # 生成图片
                image_result = await self.image_service.generate(
                    prompt=prompt,
                    negative_prompt=negative_prompt,
                    width=1024,
                    height=1024
                )
                
                image_url = image_result.get("url")
                
                # 更新元素
                project.elements[element["id"]]["image_url"] = image_url
                project.elements[element["id"]]["prompt"] = prompt
                
                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"asset_{element['id']}",
                    "url": image_url,
                    "type": "element",
                    "element_id": element["id"]
                })
                
                generated += 1
                result = {
                    "element_id": element["id"],
                    "status": "success",
                    "image_url": image_url
                }
                results.append(result)
                
                if on_progress:
                    on_progress(element["id"], i + 1, total, result)
                    
            except Exception as e:
                failed += 1
                result = {
                    "element_id": element["id"],
                    "status": "failed",
                    "error": str(e)
                }
                results.append(result)
                
                if on_progress:
                    on_progress(element["id"], i + 1, total, result)
        
        # 保存项目
        self.storage.save_agent_project(project.to_dict())
        
        return {
            "success": failed == 0,
            "generated": generated,
            "failed": failed,
            "total": total,
            "results": results
        }
    
    async def generate_all_start_frames(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        on_progress: Optional[Callable[[str, int, int, Dict], None]] = None
    ) -> Dict[str, Any]:
        """批量生成所有镜头的起始帧
        
        Args:
            project: 项目对象
            visual_style: 视觉风格
            on_progress: 进度回调 (shot_id, current, total, result)
        """
        self._cancelled = False
        
        # 收集所有镜头
        all_shots = []
        for segment in project.segments:
            for shot in segment.get("shots", []):
                all_shots.append((segment["id"], shot))
        
        total = len(all_shots)
        generated = 0
        failed = 0
        results = []
        
        for i, (segment_id, shot) in enumerate(all_shots):
            if self._cancelled:
                break
            
            # 跳过已有起始帧的镜头
            if shot.get("start_image_url"):
                results.append({
                    "shot_id": shot["id"],
                    "status": "skipped",
                    "message": "已有起始帧"
                })
                continue
            
            try:
                # 解析元素引用，构建完整提示词
                prompt = shot.get("prompt", shot.get("description", ""))
                
                # 替换 [Element_XXX] 引用
                resolved_prompt = self._resolve_element_references(prompt, project.elements)
                
                # 添加风格和质量关键词
                full_prompt = f"{resolved_prompt}, {visual_style}, cinematic lighting, high quality, detailed"
                
                # 生成图片
                image_result = await self.image_service.generate(
                    prompt=full_prompt,
                    negative_prompt="blurry, low quality, distorted, deformed",
                    width=1280,
                    height=720
                )
                
                image_url = image_result.get("url")
                
                # 更新镜头
                shot["start_image_url"] = image_url
                shot["resolved_prompt"] = resolved_prompt
                shot["status"] = "frame_ready"
                
                # 添加到视觉资产
                project.visual_assets.append({
                    "id": f"frame_{shot['id']}",
                    "url": image_url,
                    "type": "start_frame",
                    "shot_id": shot["id"]
                })
                
                generated += 1
                result = {
                    "shot_id": shot["id"],
                    "status": "success",
                    "image_url": image_url
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot["id"], i + 1, total, result)
                    
            except Exception as e:
                failed += 1
                shot["status"] = "frame_failed"
                result = {
                    "shot_id": shot["id"],
                    "status": "failed",
                    "error": str(e)
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot["id"], i + 1, total, result)
        
        # 保存项目
        self.storage.save_agent_project(project.to_dict())
        
        return {
            "success": failed == 0,
            "generated": generated,
            "failed": failed,
            "total": total,
            "results": results
        }
    
    async def generate_all_videos(
        self,
        project: AgentProject,
        resolution: str = "720p",
        on_progress: Optional[Callable[[str, int, int, Dict], None]] = None,
        on_task_created: Optional[Callable[[str, str], None]] = None
    ) -> Dict[str, Any]:
        """批量生成所有镜头的视频
        
        Args:
            project: 项目对象
            resolution: 分辨率
            on_progress: 进度回调 (shot_id, current, total, result)
            on_task_created: 任务创建回调 (shot_id, task_id)
        """
        self._cancelled = False
        
        # 收集所有有起始帧的镜头
        all_shots = []
        for segment in project.segments:
            for shot in segment.get("shots", []):
                if shot.get("start_image_url"):
                    all_shots.append((segment["id"], shot))
        
        total = len(all_shots)
        generated = 0
        failed = 0
        results = []
        pending_tasks = []  # 待轮询的任务
        
        for i, (segment_id, shot) in enumerate(all_shots):
            if self._cancelled:
                break
            
            # 跳过已有视频的镜头
            if shot.get("video_url"):
                results.append({
                    "shot_id": shot["id"],
                    "status": "skipped",
                    "message": "已有视频"
                })
                continue
            
            try:
                # 构建视频提示词
                video_prompt = shot.get("resolved_prompt", shot.get("prompt", ""))
                
                # 生成视频
                video_result = await self.video_service.generate(
                    image_url=shot["start_image_url"],
                    prompt=video_prompt,
                    duration=shot.get("duration", 5),
                    resolution=resolution
                )
                
                task_id = video_result.get("task_id")
                status = video_result.get("status")
                
                shot["video_task_id"] = task_id
                shot["status"] = "video_processing"
                
                if on_task_created:
                    on_task_created(shot["id"], task_id)
                
                # 如果是异步任务，加入待轮询列表
                if status in ["processing", "pending", "submitted"]:
                    pending_tasks.append({
                        "shot_id": shot["id"],
                        "task_id": task_id,
                        "shot": shot
                    })
                elif status == "completed" or status == "succeeded":
                    shot["video_url"] = video_result.get("video_url")
                    shot["status"] = "video_ready"
                    generated += 1
                    
                    # 添加到视觉资产
                    project.visual_assets.append({
                        "id": f"video_{shot['id']}",
                        "url": shot["video_url"],
                        "type": "video",
                        "shot_id": shot["id"],
                        "duration": shot.get("duration")
                    })
                
                result = {
                    "shot_id": shot["id"],
                    "status": "submitted",
                    "task_id": task_id
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot["id"], i + 1, total, result)
                    
            except Exception as e:
                failed += 1
                shot["status"] = "video_failed"
                result = {
                    "shot_id": shot["id"],
                    "status": "failed",
                    "error": str(e)
                }
                results.append(result)
                
                if on_progress:
                    on_progress(shot["id"], i + 1, total, result)
        
        # 轮询等待所有任务完成
        if pending_tasks and not self._cancelled:
            await self._poll_video_tasks(project, pending_tasks, on_progress)
            generated = sum(1 for t in pending_tasks if t["shot"].get("video_url"))
            failed += sum(1 for t in pending_tasks if t["shot"].get("status") == "video_failed")
        
        # 保存项目
        self.storage.save_agent_project(project.to_dict())
        
        return {
            "success": failed == 0,
            "generated": generated,
            "failed": failed,
            "total": total,
            "results": results
        }
    
    async def _poll_video_tasks(
        self,
        project: AgentProject,
        pending_tasks: List[Dict],
        on_progress: Optional[Callable] = None,
        max_wait: int = 600,  # 最长等待10分钟
        poll_interval: int = 5
    ):
        """轮询视频任务状态"""
        start_time = asyncio.get_event_loop().time()
        
        while pending_tasks and not self._cancelled:
            elapsed = asyncio.get_event_loop().time() - start_time
            if elapsed > max_wait:
                print(f"[AgentExecutor] 视频生成超时，{len(pending_tasks)} 个任务未完成")
                break
            
            for task_info in pending_tasks[:]:  # 复制列表以便修改
                try:
                    result = await self.video_service.check_task_status(task_info["task_id"])
                    status = result.get("status")
                    
                    if status in ["completed", "succeeded"]:
                        shot = task_info["shot"]
                        shot["video_url"] = result.get("video_url")
                        shot["status"] = "video_ready"
                        
                        # 添加到视觉资产
                        project.visual_assets.append({
                            "id": f"video_{shot['id']}",
                            "url": shot["video_url"],
                            "type": "video",
                            "shot_id": shot["id"],
                            "duration": shot.get("duration")
                        })
                        
                        pending_tasks.remove(task_info)
                        
                        if on_progress:
                            on_progress(shot["id"], -1, -1, {
                                "status": "completed",
                                "video_url": shot["video_url"]
                            })
                    
                    elif status == "failed":
                        shot = task_info["shot"]
                        shot["status"] = "video_failed"
                        shot["error"] = result.get("error", "视频生成失败")
                        pending_tasks.remove(task_info)
                        
                        if on_progress:
                            on_progress(shot["id"], -1, -1, {
                                "status": "failed",
                                "error": shot["error"]
                            })
                            
                except Exception as e:
                    print(f"[AgentExecutor] 轮询任务 {task_info['task_id']} 失败: {e}")
            
            if pending_tasks:
                await asyncio.sleep(poll_interval)
    
    def _resolve_element_references(self, prompt: str, elements: Dict[str, Dict]) -> str:
        """解析提示词中的元素引用"""
        def replace_element(match):
            element_id = match.group(0)  # 完整匹配 [Element_XXX]
            element_key = match.group(1)  # XXX 部分
            
            # 尝试多种匹配方式
            full_id = f"Element_{element_key}"
            element = elements.get(full_id) or elements.get(element_id) or elements.get(element_key)
            
            if element:
                # 如果元素有图片，使用简短描述；否则使用完整描述
                if element.get("image_url"):
                    return element.get("name", element_key)
                return element.get("description", element_key)
            return match.group(0)
        
        return re.sub(r'\[Element_(\w+)\]', replace_element, prompt)
    
    async def execute_full_pipeline(
        self,
        project: AgentProject,
        visual_style: str = "吉卜力动画风格",
        resolution: str = "720p",
        on_stage_complete: Optional[Callable[[str, Dict], None]] = None,
        on_progress: Optional[Callable[[str, str, int, int, Dict], None]] = None
    ) -> Dict[str, Any]:
        """执行完整的生成流程
        
        Flova 风格的渐进式执行：
        1. 生成所有元素图片
        2. 生成所有起始帧
        3. 生成所有视频
        
        Args:
            project: 项目对象
            visual_style: 视觉风格
            resolution: 视频分辨率
            on_stage_complete: 阶段完成回调 (stage_name, result)
            on_progress: 进度回调 (stage, item_id, current, total, result)
        """
        self._cancelled = False
        pipeline_result = {
            "stages": {},
            "success": True,
            "total_generated": 0,
            "total_failed": 0
        }
        
        # 阶段1: 生成元素图片
        print("[AgentExecutor] 阶段1: 生成元素图片")
        elements_result = await self.generate_all_elements(
            project,
            visual_style,
            on_progress=lambda eid, cur, tot, res: on_progress("elements", eid, cur, tot, res) if on_progress else None
        )
        pipeline_result["stages"]["elements"] = elements_result
        pipeline_result["total_generated"] += elements_result["generated"]
        pipeline_result["total_failed"] += elements_result["failed"]
        
        if on_stage_complete:
            on_stage_complete("elements", elements_result)
        
        if self._cancelled:
            pipeline_result["success"] = False
            pipeline_result["cancelled_at"] = "elements"
            return pipeline_result
        
        # 阶段2: 生成起始帧
        print("[AgentExecutor] 阶段2: 生成起始帧")
        frames_result = await self.generate_all_start_frames(
            project,
            visual_style,
            on_progress=lambda sid, cur, tot, res: on_progress("frames", sid, cur, tot, res) if on_progress else None
        )
        pipeline_result["stages"]["frames"] = frames_result
        pipeline_result["total_generated"] += frames_result["generated"]
        pipeline_result["total_failed"] += frames_result["failed"]
        
        if on_stage_complete:
            on_stage_complete("frames", frames_result)
        
        if self._cancelled:
            pipeline_result["success"] = False
            pipeline_result["cancelled_at"] = "frames"
            return pipeline_result
        
        # 阶段3: 生成视频
        print("[AgentExecutor] 阶段3: 生成视频")
        videos_result = await self.generate_all_videos(
            project,
            resolution,
            on_progress=lambda sid, cur, tot, res: on_progress("videos", sid, cur, tot, res) if on_progress else None
        )
        pipeline_result["stages"]["videos"] = videos_result
        pipeline_result["total_generated"] += videos_result["generated"]
        pipeline_result["total_failed"] += videos_result["failed"]
        
        if on_stage_complete:
            on_stage_complete("videos", videos_result)
        
        pipeline_result["success"] = pipeline_result["total_failed"] == 0
        
        return pipeline_result
