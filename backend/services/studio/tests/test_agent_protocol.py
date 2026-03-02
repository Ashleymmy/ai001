"""Tests for agent_protocol.py — 12 tests."""
from backend.services.studio.agent_protocol import (
    VALID_FRAMINGS,
    VALID_ANGLES,
    VALID_MOVEMENTS,
    VALID_MOODS,
    VALID_MESSAGE_TYPES,
    VALID_STATUSES,
    AgentMessage,
    AgentMessageBus,
    create_task_id,
    create_message,
    SHOT_SPEC_SCHEMA,
    _SCHEMA_REGISTRY,
)


def test_valid_framings_count():
    assert len(VALID_FRAMINGS) == 6
    assert "extreme_long" in VALID_FRAMINGS
    assert "extreme_close" in VALID_FRAMINGS


def test_valid_angles_count():
    assert len(VALID_ANGLES) == 8
    assert "eye_level" in VALID_ANGLES
    assert "over_shoulder" in VALID_ANGLES


def test_valid_movements_count():
    assert len(VALID_MOVEMENTS) == 7
    assert "fixed" in VALID_MOVEMENTS
    assert "orbit" in VALID_MOVEMENTS


def test_valid_moods_count():
    assert len(VALID_MOODS) == 8
    assert "tense" in VALID_MOODS
    assert "fear" in VALID_MOODS


def test_valid_message_types_count():
    assert len(VALID_MESSAGE_TYPES) == 6
    assert "task_assignment" in VALID_MESSAGE_TYPES
    assert "context_update" in VALID_MESSAGE_TYPES


def test_agent_message_defaults():
    msg = AgentMessage(
        task_id="t1",
        source_agent="producer",
        target_agent="world_builder",
        message_type="task_assignment",
        payload={"key": "value"},
    )
    assert msg.message_id.startswith("msg_")
    assert msg.status == "pending"
    assert msg.created_at
    assert msg.context_refs == []


def test_message_bus_send_and_retrieve():
    bus = AgentMessageBus()
    msg = create_message("producer", "world_builder", "task_assignment", {"data": 1})
    msg_id = bus.send(msg)
    assert msg_id == msg.message_id
    assert msg.status == "delivered"
    received = bus.get_messages("world_builder")
    assert len(received) == 1
    assert received[0].payload == {"data": 1}
    # Producer should get nothing (they're the sender)
    assert bus.get_messages("producer") == []


def test_message_bus_get_conversation():
    bus = AgentMessageBus()
    m1 = create_message("producer", "world_builder", "task_assignment", {"task_id": "t1"})
    m2 = create_message("world_builder", "producer", "task_result", {"task_id": "t1"})
    m3 = create_message("producer", "narrative_qa", "task_assignment", {"task_id": "t2"})
    # Manually set task_id for filtering
    m1.task_id = "t1"
    m2.task_id = "t1"
    m3.task_id = "t2"
    bus.send(m1)
    bus.send(m2)
    bus.send(m3)
    convo = bus.get_conversation("t1")
    assert len(convo) == 2
    assert all(m.task_id == "t1" for m in convo)


def test_validate_payload_valid():
    payload = {
        "episode_id": "ep1",
        "title": "Test",
        "segments": [],
        "estimated_shots": 10,
        "notes": "",
    }
    valid, errors = AgentMessageBus.validate_payload("task_assignment", payload)
    assert valid is True
    assert errors == []


def test_validate_payload_missing_fields():
    payload = {"episode_id": "ep1"}  # missing title, segments, etc.
    valid, errors = AgentMessageBus.validate_payload("task_assignment", payload)
    assert valid is False
    assert len(errors) > 0
    assert any("Missing required field" in e for e in errors)


def test_validate_payload_unknown_type():
    valid, errors = AgentMessageBus.validate_payload("unknown_type", {})
    assert valid is False
    assert any("Unknown message_type" in e for e in errors)


def test_create_task_id():
    tid = create_task_id("ep1", "seg2", 3)
    assert tid == "ep1_seg2_shot3"
