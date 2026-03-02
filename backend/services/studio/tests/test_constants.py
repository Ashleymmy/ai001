"""Tests for constants.py — 10 tests."""
from backend.services.studio.constants import (
    SHOT_SIZE_STANDARDS,
    CAMERA_MOVEMENTS,
    CAMERA_ANGLES,
    EMOTION_INTENSITY,
    EMOTION_INTENSITY_LABEL_ZH,
    DEFAULT_NEGATIVE_PROMPT,
    get_shot_size_zh,
    get_camera_movement_zh,
    get_camera_movement_desc,
    get_camera_angle_zh,
    get_emotion_intensity_zh,
)


def test_shot_size_standards_has_6_entries():
    assert len(SHOT_SIZE_STANDARDS) == 6
    expected_keys = {"extreme_long", "long", "medium", "medium_close", "close_up", "extreme_close"}
    assert set(SHOT_SIZE_STANDARDS.keys()) == expected_keys


def test_camera_movements_has_7_entries():
    assert len(CAMERA_MOVEMENTS) == 7
    expected_keys = {"fixed", "push", "pull", "pan", "follow", "tracking", "orbit"}
    assert set(CAMERA_MOVEMENTS.keys()) == expected_keys


def test_camera_angles_has_8_entries():
    assert len(CAMERA_ANGLES) == 8
    expected_keys = {"eye_level", "low_angle", "high_angle", "dutch", "overhead", "side", "back", "over_shoulder"}
    assert set(CAMERA_ANGLES.keys()) == expected_keys


def test_emotion_intensity_has_5_levels():
    assert len(EMOTION_INTENSITY) == 5
    assert set(EMOTION_INTENSITY.keys()) == {3, 2, 1, 0, -1}


def test_default_negative_prompt_not_empty():
    assert len(DEFAULT_NEGATIVE_PROMPT) > 0
    assert "blurry" in DEFAULT_NEGATIVE_PROMPT
    assert "low quality" in DEFAULT_NEGATIVE_PROMPT


def test_get_shot_size_zh_known_key():
    assert get_shot_size_zh("extreme_long") == "大远景"
    assert get_shot_size_zh("close_up") == "近景/特写"
    assert get_shot_size_zh("medium") == "中景"


def test_get_shot_size_zh_unknown_key():
    assert get_shot_size_zh("nonexistent") == "nonexistent"


def test_get_camera_movement_zh_and_desc():
    assert get_camera_movement_zh("push") == "推镜"
    assert get_camera_movement_zh("orbit") == "环绕"
    assert get_camera_movement_desc("push") == "接近主体，增强紧张感"
    assert get_camera_movement_desc("nonexistent") == ""


def test_get_camera_angle_zh():
    assert get_camera_angle_zh("eye_level") == "平视"
    assert get_camera_angle_zh("dutch") == "荷兰角"
    assert get_camera_angle_zh("nonexistent") == "nonexistent"


def test_get_emotion_intensity_zh():
    assert get_emotion_intensity_zh(3) == "极强"
    assert get_emotion_intensity_zh(0) == "平稳"
    assert get_emotion_intensity_zh(-1) == "弱"
    # Unknown level defaults to "中"
    assert get_emotion_intensity_zh(99) == "中"
