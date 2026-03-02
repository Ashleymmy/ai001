"""Agent 通信协议 — Phase 3, Task 3.2

定义 Agent 间结构化 JSON Schema 通信标准。所有 Agent 间的关键参数交换
必须使用此处定义的 Schema 进行校验，禁止使用自由文本传递结构化信息。

协议要素：
- AgentMessage — 标准消息信封
- SHOT_SPEC_SCHEMA — 分镜规格 Schema（核心）
- 各 Agent 输入 / 输出 Schema
- AgentMessageBus — 消息路由与校验总线
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime
import uuid

# ---------------------------------------------------------------------------
# Valid enum values — derived from constants.py & mood_packs.py
# ---------------------------------------------------------------------------

VALID_FRAMINGS = [
    "extreme_long", "long", "medium", "medium_close", "close_up", "extreme_close",
]

VALID_ANGLES = [
    "eye_level", "low_angle", "high_angle", "dutch",
    "overhead", "side", "back", "over_shoulder",
]

VALID_MOVEMENTS = [
    "fixed", "push", "pull", "pan", "follow", "tracking", "orbit",
]

VALID_MOODS = [
    "tense", "tender", "despair", "cool", "suspense", "warm", "angry", "fear",
]

VALID_MESSAGE_TYPES = [
    "task_assignment",
    "task_result",
    "review_request",
    "review_result",
    "revision_request",
    "context_update",
]

VALID_STATUSES = ["pending", "delivered", "processed", "failed"]

# ---------------------------------------------------------------------------
# AgentMessage — 标准消息信封
# ---------------------------------------------------------------------------

@dataclass
class AgentMessage:
    """Agent 间通信的标准消息信封。

    所有 Agent 间交换的数据都封装在此结构中。payload 字段承载实际
    业务数据，必须通过对应 Schema 校验后才可被消费。
    """

    task_id: str                          # e.g., "ep1_seg2_shot3"
    source_agent: str                     # role_id from agent_roles.py
    target_agent: str                     # role_id from agent_roles.py
    message_type: str                     # see VALID_MESSAGE_TYPES
    payload: Dict[str, Any]               # structured JSON, schema-validated
    context_refs: List[str] = field(default_factory=list)
    message_id: str = field(default_factory=lambda: f"msg_{uuid.uuid4().hex[:12]}")
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "pending"


# ---------------------------------------------------------------------------
# Core Schema — 分镜规格 (Shot Specification)
# ---------------------------------------------------------------------------

SHOT_SPEC_SCHEMA: Dict[str, Any] = {
    "task_id": "ep{episode}_seg{segment}_shot{index}",
    "characters": ["element_id_1", "element_id_2"],
    "location": "element_id_scene",
    "time_of_day": "sunset",
    "shot_spec": {
        "framing": "MCU",               # VALID_FRAMINGS key
        "angle": "low_angle",            # VALID_ANGLES key
        "movement": "push",              # VALID_MOVEMENTS key
        "composition": "rule_of_thirds",
    },
    "mood": "tense",                     # VALID_MOODS key
    "emotion_intensity": 2,
    "narrative_beat": "confrontation_peak",
    "state_refs": ["char_001.injured_left_arm"],
}


# ---------------------------------------------------------------------------
# Additional Agent Output Schemas
# ---------------------------------------------------------------------------

TASK_PLAN_SCHEMA: Dict[str, Any] = {
    "episode_id": "ep1",
    "title": "",
    "segments": [
        {
            "segment_id": "seg1",
            "description": "",
            "shots": [
                {
                    "shot_index": 1,
                    "task_id": "ep1_seg1_shot1",
                    "assigned_to": "storyboard_writer",
                    "priority": "high",
                    "dependencies": [],
                }
            ],
        }
    ],
    "estimated_shots": 0,
    "notes": "",
}

WORLD_CONTEXT_SCHEMA: Dict[str, Any] = {
    "world_id": "",
    "geography": {
        "regions": [],
        "landmarks": [],
        "climate": "",
    },
    "history": {
        "eras": [],
        "key_events": [],
    },
    "culture": {
        "factions": [],
        "customs": [],
        "languages": [],
    },
    "rules": {
        "magic_system": "",
        "technology_level": "",
        "constraints": [],
    },
}

CHARACTER_PROFILE_SCHEMA: Dict[str, Any] = {
    "character_id": "",
    "name": "",
    "appearance": {
        "hair": "",
        "eyes": "",
        "build": "",
        "distinctive_features": [],
        "default_outfit": "",
    },
    "personality": {
        "traits": [],
        "speech_style": "",
        "mannerisms": [],
    },
    "background": {
        "origin": "",
        "motivation": "",
        "key_events": [],
    },
    "relationships": [
        {
            "target_character_id": "",
            "relation_type": "",
            "description": "",
        }
    ],
}

DIALOGUE_BATCH_SCHEMA: Dict[str, Any] = {
    "segment_id": "",
    "dialogues": [
        {
            "shot_id": "",
            "speaker": "",
            "dialogue": "",
            "emotion": "",
        }
    ],
}

STORYBOARD_SCHEMA: Dict[str, Any] = {
    "segment_id": "",
    "shots": [
        {
            "task_id": "",
            "characters": [],
            "location": "",
            "time_of_day": "",
            "shot_spec": {
                "framing": "",
                "angle": "",
                "movement": "",
                "composition": "",
            },
            "mood": "",
            "emotion_intensity": 0,
            "narrative_beat": "",
            "state_refs": [],
        }
    ],
}

QA_RESULT_SCHEMA: Dict[str, Any] = {
    "review_id": "",
    "target_task_id": "",
    "passed": False,
    "score": 0.0,
    "issues": [
        {
            "severity": "error",
            "category": "",
            "description": "",
            "location": "",
            "suggestion": "",
        }
    ],
}

REVISION_INSTRUCTION_SCHEMA: Dict[str, Any] = {
    "source_review_id": "",
    "target_task_id": "",
    "assigned_to": "",
    "instructions": [
        {
            "field": "",
            "current_value": "",
            "required_value": "",
            "reason": "",
        }
    ],
    "deadline": "",
    "priority": "normal",
}


# ---------------------------------------------------------------------------
# Schema registry — maps message_type to expected payload schema
# ---------------------------------------------------------------------------

_SCHEMA_REGISTRY: Dict[str, Dict[str, Any]] = {
    "task_assignment": TASK_PLAN_SCHEMA,
    "task_result": STORYBOARD_SCHEMA,
    "review_request": STORYBOARD_SCHEMA,
    "review_result": QA_RESULT_SCHEMA,
    "revision_request": REVISION_INSTRUCTION_SCHEMA,
    "context_update": WORLD_CONTEXT_SCHEMA,
}


# ---------------------------------------------------------------------------
# AgentMessageBus — 消息路由与校验总线
# ---------------------------------------------------------------------------

class AgentMessageBus:
    """Agent 消息路由总线。

    负责消息的记录、路由查询和 payload 结构校验。
    所有 Agent 间通信必须经过此总线以确保协议一致性。
    """

    def __init__(self) -> None:
        self._history: List[AgentMessage] = []

    # -- Core operations ---------------------------------------------------

    def send(self, message: AgentMessage) -> str:
        """Record and route a message, returning its message_id.

        The message status is set to ``"delivered"`` upon successful
        recording. Callers should validate the payload before sending
        via :meth:`validate_payload` if strict schema checking is desired.
        """
        message.status = "delivered"
        self._history.append(message)
        return message.message_id

    def get_messages(self, agent_id: str) -> List[AgentMessage]:
        """Return all messages where *agent_id* is the target."""
        return [m for m in self._history if m.target_agent == agent_id]

    def get_conversation(self, task_id: str) -> List[AgentMessage]:
        """Return all messages associated with a given *task_id*, ordered by creation time."""
        return sorted(
            [m for m in self._history if m.task_id == task_id],
            key=lambda m: m.created_at,
        )

    # -- Validation --------------------------------------------------------

    @staticmethod
    def validate_payload(
        message_type: str,
        payload: Dict[str, Any],
    ) -> Tuple[bool, List[str]]:
        """Validate *payload* against the schema registered for *message_type*.

        Returns a ``(valid, errors)`` tuple.  The check verifies that every
        top-level key defined in the reference schema is present in the
        payload.  This is intentionally a structural (key-presence) check
        rather than a full JSON Schema validation so that the module stays
        dependency-free.
        """
        errors: List[str] = []

        if message_type not in VALID_MESSAGE_TYPES:
            errors.append(f"Unknown message_type: {message_type}")
            return False, errors

        schema = _SCHEMA_REGISTRY.get(message_type)
        if schema is None:
            # No schema registered — accept any payload
            return True, errors

        for key in schema:
            if key not in payload:
                errors.append(f"Missing required field: {key}")

        return (len(errors) == 0), errors


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def create_task_id(episode_id: str, segment: str, shot_index: int) -> str:
    """Build a canonical task ID string.

    >>> create_task_id("ep1", "seg2", 3)
    'ep1_seg2_shot3'
    """
    return f"{episode_id}_{segment}_shot{shot_index}"


def create_message(
    source: str,
    target: str,
    msg_type: str,
    payload: Dict[str, Any],
    context_refs: Optional[List[str]] = None,
) -> AgentMessage:
    """Convenience factory for :class:`AgentMessage`.

    Populates *message_id* and *created_at* automatically.
    """
    return AgentMessage(
        task_id=payload.get("task_id", ""),
        source_agent=source,
        target_agent=target,
        message_type=msg_type,
        payload=payload,
        context_refs=context_refs or [],
    )
