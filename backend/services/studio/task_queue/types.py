"""任务队列数据类型定义"""
from enum import Enum
from dataclasses import dataclass, field
from typing import Optional, Dict, Any


class TaskStatus(str, Enum):
    QUEUED = "queued"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    DISMISSED = "dismissed"


class TaskType(str, Enum):
    IMAGE_FRAME = "image_frame"
    VIDEO_PANEL = "video_panel"
    VOICE_LINE = "voice_line"
    LLM_TEXT = "llm_text"
    PIPELINE_STAGE = "pipeline_stage"


class QueueType(str, Enum):
    IMAGE = "image"
    VIDEO = "video"
    VOICE = "voice"
    TEXT = "text"


@dataclass
class TaskJobData:
    id: str
    series_id: str
    episode_id: str
    type: str
    queue_type: str
    runtime: str
    target_type: str
    target_id: str
    status: str = TaskStatus.QUEUED.value
    priority: int = 0
    progress: int = 0
    stage: Optional[str] = None
    attempt: int = 0
    max_attempts: int = 3
    payload: Dict[str, Any] = field(default_factory=dict)
    result: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    external_id: Optional[str] = None
    dedupe_key: Optional[str] = None
    heartbeat_at: Optional[str] = None
    queued_at: str = ""
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    created_at: str = ""
    updated_at: str = ""


@dataclass
class TaskEvent:
    id: int
    task_id: str
    episode_id: str
    event_type: str
    payload: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""


@dataclass
class PipelineRun:
    id: str
    series_id: str
    episode_id: str
    runtime: str = "studio"
    status: str = TaskStatus.QUEUED.value
    current_stage: Optional[str] = None
    input_json: Dict[str, Any] = field(default_factory=dict)
    output_json: Dict[str, Any] = field(default_factory=dict)
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    last_seq: int = 0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    created_at: str = ""


@dataclass
class PipelineStep:
    id: str
    run_id: str
    step_key: str
    status: str = "pending"
    attempt: int = 0
    started_at: Optional[str] = None
    finished_at: Optional[str] = None
    error_code: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str = ""


@dataclass
class Checkpoint:
    id: str
    run_id: str
    node_key: str
    version: int = 1
    state_json: Dict[str, Any] = field(default_factory=dict)
    created_at: str = ""


@dataclass
class CreateTaskInput:
    type: str
    queue_type: str
    target_type: str
    target_id: str
    series_id: str = ""
    episode_id: str = ""
    runtime: str = "studio"
    priority: int = 0
    max_attempts: int = 3
    payload: Dict[str, Any] = field(default_factory=dict)
    dedupe_key: Optional[str] = None
