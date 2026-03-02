"""Tests for story_state_manager.py — 11 tests."""
import pytest

from backend.services.studio.story_state_manager import StoryStateManager


def test_track_state_change(tmp_storage, sample_series, sample_episode, sample_character_element):
    mgr = StoryStateManager(tmp_storage)
    result = mgr.track_state_change(
        series_id=sample_series["id"],
        element_id=sample_character_element["id"],
        episode_id=sample_episode["id"],
        state_key="injury",
        state_value="left arm wounded",
        valid_from=1,
    )
    assert result["state_key"] == "injury"
    assert result["state_value"] == "left arm wounded"
    assert result["valid_from_episode"] == 1


def test_track_state_change_closes_previous(tmp_storage, sample_series, sample_episode, sample_character_element):
    mgr = StoryStateManager(tmp_storage)
    # First state
    mgr.track_state_change(
        series_id=sample_series["id"],
        element_id=sample_character_element["id"],
        episode_id=sample_episode["id"],
        state_key="mood",
        state_value="happy",
        valid_from=1,
    )
    # Second state for same key closes the first
    mgr.track_state_change(
        series_id=sample_series["id"],
        element_id=sample_character_element["id"],
        episode_id=sample_episode["id"],
        state_key="mood",
        state_value="sad",
        valid_from=3,
    )
    states = tmp_storage.list_character_states(sample_series["id"], sample_character_element["id"])
    # There should be at least 2 states for "mood"
    mood_states = [s for s in states if s.get("state_key") == "mood"]
    assert len(mood_states) >= 2
    # The old one should have valid_to_episode set
    closed = [s for s in mood_states if s.get("valid_to_episode") is not None]
    assert len(closed) >= 1


def test_propagate_character_states(tmp_storage, sample_series, sample_character_element):
    # Create two episodes
    ep1 = tmp_storage.create_episode(series_id=sample_series["id"], act_number=1, title="E1")
    ep2 = tmp_storage.create_episode(series_id=sample_series["id"], act_number=2, title="E2")

    mgr = StoryStateManager(tmp_storage)
    mgr.track_state_change(
        series_id=sample_series["id"],
        element_id=sample_character_element["id"],
        episode_id=ep1["id"],
        state_key="weapon",
        state_value="sword",
        valid_from=1,
    )
    propagated = mgr.propagate_character_states(sample_series["id"], ep1["id"], ep2["id"])
    assert len(propagated) >= 1
    assert propagated[0]["episode_id"] == ep2["id"]
    assert propagated[0]["state_key"] == "weapon"


def test_propagate_no_active_states(tmp_storage, sample_series):
    ep1 = tmp_storage.create_episode(series_id=sample_series["id"], act_number=1, title="E1")
    ep2 = tmp_storage.create_episode(series_id=sample_series["id"], act_number=2, title="E2")
    mgr = StoryStateManager(tmp_storage)
    propagated = mgr.propagate_character_states(sample_series["id"], ep1["id"], ep2["id"])
    assert propagated == []


def test_get_character_snapshot(tmp_storage, sample_series, sample_character_element):
    ep1 = tmp_storage.create_episode(series_id=sample_series["id"], act_number=1, title="E1")
    mgr = StoryStateManager(tmp_storage)
    mgr.track_state_change(
        series_id=sample_series["id"],
        element_id=sample_character_element["id"],
        episode_id=ep1["id"],
        state_key="hair_color",
        state_value="silver",
        valid_from=1,
    )
    snapshot = mgr.get_character_snapshot(sample_series["id"], sample_character_element["id"], 1)
    assert snapshot.get("hair_color") == "silver"


def test_get_character_snapshot_empty(tmp_storage, sample_series):
    mgr = StoryStateManager(tmp_storage)
    snapshot = mgr.get_character_snapshot(sample_series["id"], "nonexistent", 1)
    assert snapshot == {}


def test_resolve_foreshadowing(tmp_storage, sample_series, sample_episode):
    tmp_storage.create_foreshadowing({
        "id": "fs_1",
        "series_id": sample_series["id"],
        "planted_episode_id": sample_episode["id"],
        "description": "A mystery clue",
        "status": "planted",
    })

    mgr = StoryStateManager(tmp_storage)
    unresolved = mgr.get_unresolved_foreshadowing(sample_series["id"])
    assert len(unresolved) >= 1
    success = mgr.resolve_foreshadowing("fs_1", sample_episode["id"])
    assert success is True


def test_abandon_foreshadowing(tmp_storage, sample_series, sample_episode):
    tmp_storage.create_foreshadowing({
        "id": "fs_2",
        "series_id": sample_series["id"],
        "planted_episode_id": sample_episode["id"],
        "description": "Abandoned plot",
        "status": "planted",
    })

    mgr = StoryStateManager(tmp_storage)
    success = mgr.abandon_foreshadowing("fs_2")
    assert success is True


def test_check_foreshadowing_warnings(tmp_storage, sample_series, sample_episode):
    tmp_storage.create_foreshadowing({
        "id": "fs_3",
        "series_id": sample_series["id"],
        "planted_episode_id": sample_episode["id"],
        "description": "Old clue",
        "status": "planted",
    })

    mgr = StoryStateManager(tmp_storage)
    # Episode act_number=1, check at episode_number=10 with threshold=5
    warnings = mgr.check_foreshadowing_warnings(sample_series["id"], 10, warning_threshold=5)
    assert len(warnings) >= 1
    assert warnings[0]["episodes_since_planted"] >= 5


def test_get_episode_state_summary(tmp_storage, sample_series, sample_episode, sample_character_element):
    mgr = StoryStateManager(tmp_storage)
    mgr.track_state_change(
        series_id=sample_series["id"],
        element_id=sample_character_element["id"],
        episode_id=sample_episode["id"],
        state_key="location",
        state_value="forest",
        valid_from=1,
    )
    summary = mgr.get_episode_state_summary(sample_series["id"], sample_episode["id"])
    assert "episode_id" in summary
    assert "active_character_states" in summary
    assert "unresolved_foreshadowing" in summary


def test_auto_update_world_bible(tmp_storage, sample_series, sample_world_bible, sample_episode):
    mgr = StoryStateManager(tmp_storage)
    result = mgr.auto_update_world_bible(
        series_id=sample_series["id"],
        episode_data={"creative_brief": {"motifs": ["dragon symbol"]}},
        new_elements=["phoenix feather"],
    )
    motifs = result.get("recurring_motifs", "")
    assert "phoenix feather" in motifs
    assert "dragon symbol" in motifs
