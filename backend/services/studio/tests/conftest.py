"""Shared fixtures for Studio test suite."""
from __future__ import annotations

import sys
import os

import pytest

# Ensure the backend package is importable regardless of working directory.
_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
if _BACKEND_DIR not in sys.path:
    sys.path.insert(0, _BACKEND_DIR)

from backend.services.studio_storage import StudioStorage
from backend.services.studio.knowledge_base import KnowledgeBase
from backend.services.studio.prompt_assembler import PromptAssembler


# ---------------------------------------------------------------------------
# Core storage fixture (isolated SQLite per test)
# ---------------------------------------------------------------------------

@pytest.fixture
def tmp_storage(tmp_path):
    """StudioStorage backed by an ephemeral SQLite in *tmp_path*."""
    db_path = str(tmp_path / "test.db")
    return StudioStorage(db_path=db_path)


# ---------------------------------------------------------------------------
# Series / Episode
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_series(tmp_storage):
    return tmp_storage.create_series(name="Test Series", description="A test series")


@pytest.fixture
def sample_episode(tmp_storage, sample_series):
    return tmp_storage.create_episode(
        series_id=sample_series["id"],
        act_number=1,
        title="EP1",
        summary="Test episode summary",
    )


# ---------------------------------------------------------------------------
# Shared elements
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_character_element(tmp_storage, sample_series):
    return tmp_storage.add_shared_element(
        series_id=sample_series["id"],
        name="Aria",
        element_type="character",
        description="银色长发，蓝色瞳孔，白皙皮肤，高大",
    )


@pytest.fixture
def sample_scene_element(tmp_storage, sample_series):
    return tmp_storage.add_shared_element(
        series_id=sample_series["id"],
        name="Palace",
        element_type="scene",
        description="宏伟的宫殿，室内，金色装饰",
    )


# ---------------------------------------------------------------------------
# Shot / Element dicts (no DB dependency)
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_shots():
    """Four shots: 3 valid + 1 empty (for missing-field tests)."""
    return [
        {
            "id": "shot_1", "name": "S1", "sort_order": 1,
            "description": "角色走过来", "prompt": "character walking",
            "shot_size": "medium", "camera_angle": "eye_level",
            "camera_movement": "push", "emotion": "tense",
            "segment_name": "seg1",
        },
        {
            "id": "shot_2", "name": "S2", "sort_order": 2,
            "description": "对话场景", "prompt": "dialogue scene",
            "shot_size": "medium_close", "camera_angle": "over_shoulder",
            "camera_movement": "fixed", "emotion": "tender",
            "segment_name": "seg1",
        },
        {
            "id": "shot_3", "name": "S3", "sort_order": 3,
            "description": "战斗", "prompt": "battle scene",
            "shot_size": "long", "camera_angle": "low_angle",
            "camera_movement": "tracking", "emotion": "cool",
            "segment_name": "seg2",
        },
        {
            "id": "shot_4", "name": "S4", "sort_order": 4,
            "description": "", "prompt": "",
            "shot_size": "", "camera_angle": "",
            "camera_movement": "", "emotion": "",
            "segment_name": "seg2",
        },
    ]


@pytest.fixture
def sample_elements():
    """Two elements for QA testing."""
    return [
        {"id": "SE_char1", "name": "小明", "type": "character", "description": "银色长发"},
        {"id": "SE_scene1", "name": "宫殿", "type": "scene", "description": "宏伟的宫殿"},
    ]


# ---------------------------------------------------------------------------
# Knowledge Base / Assembler
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_kb(tmp_storage):
    return KnowledgeBase(tmp_storage)


@pytest.fixture
def sample_assembler(sample_kb):
    return PromptAssembler(sample_kb)


# ---------------------------------------------------------------------------
# World Bible
# ---------------------------------------------------------------------------

@pytest.fixture
def sample_world_bible(tmp_storage, sample_series):
    return tmp_storage.create_world_bible(
        series_id=sample_series["id"],
        art_style="anime illustration",
        era="fantasy medieval",
        color_palette="warm tones",
        recurring_motifs="cherry blossoms, moonlight",
        forbidden_elements="modern technology, guns",
    )
