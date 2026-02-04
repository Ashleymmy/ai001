import uuid
from datetime import datetime
from typing import Dict, List, Optional


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
        self.audio_timeline: Dict = {}
        self.timeline: List[Dict] = []
        self.messages: List[Dict] = []  # 聊天记录
        # 仅供 Agent 自己回溯上下文使用的“记忆”，避免被前端保存 messages 覆盖/冲突
        self.agent_memory: List[Dict] = []
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()

    def add_element(
        self,
        element_id: str,
        name: str,
        element_type: str,
        description: str,
        image_url: Optional[str] = None,
    ) -> Dict:
        """添加元素"""
        element = {
            "id": element_id,
            "name": name,
            "type": element_type,
            "description": description,
            "image_url": image_url,
            "created_at": datetime.now().isoformat(),
        }
        self.elements[element_id] = element
        self.updated_at = datetime.now().isoformat()
        return element

    def add_segment(self, segment_id: str, name: str, description: str) -> Dict:
        """添加段落"""
        segment = {
            "id": segment_id,
            "name": name,
            "description": description,
            "shots": [],
            "created_at": datetime.now().isoformat(),
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
        duration: float = 5.0,
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
                    "created_at": datetime.now().isoformat(),
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
            "audio_timeline": self.audio_timeline,
            "timeline": self.timeline,
            "messages": self.messages,
            "agent_memory": self.agent_memory,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    @classmethod
    def from_dict(cls, data: Dict) -> "AgentProject":
        """从字典创建"""
        if not isinstance(data, dict):
            data = {}

        project = cls(data.get("id") if isinstance(data.get("id"), str) and data.get("id") else None)

        name = data.get("name")
        project.name = name if isinstance(name, str) and name.strip() else "未命名项目"

        project.creative_brief = data.get("creative_brief") if isinstance(data.get("creative_brief"), dict) else {}
        project.elements = data.get("elements") if isinstance(data.get("elements"), dict) else {}
        project.segments = data.get("segments") if isinstance(data.get("segments"), list) else []

        project.visual_assets = data.get("visual_assets") if isinstance(data.get("visual_assets"), list) else []
        project.audio_assets = data.get("audio_assets") if isinstance(data.get("audio_assets"), list) else []
        project.audio_timeline = data.get("audio_timeline") if isinstance(data.get("audio_timeline"), dict) else {}
        project.timeline = data.get("timeline") if isinstance(data.get("timeline"), list) else []

        project.messages = data.get("messages") if isinstance(data.get("messages"), list) else []
        project.agent_memory = data.get("agent_memory") if isinstance(data.get("agent_memory"), list) else []

        created_at = data.get("created_at")
        updated_at = data.get("updated_at")
        project.created_at = created_at if isinstance(created_at, str) and created_at.strip() else datetime.now().isoformat()
        project.updated_at = updated_at if isinstance(updated_at, str) and updated_at.strip() else datetime.now().isoformat()
        return project

