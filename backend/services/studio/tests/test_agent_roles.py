"""Tests for agent_roles.py — 8 tests."""
from backend.services.studio.agent_roles import (
    AgentRole,
    AGENT_ROLES,
    MODEL_TIERS,
    get_agent_role,
    list_agent_roles,
    list_roles_by_department,
)


def test_10_roles_registered():
    assert len(AGENT_ROLES) == 10
    expected = {
        "producer", "world_builder", "character_developer", "dialogue_writer",
        "storyboard_writer", "prompt_compositor", "narrative_qa", "visual_qa",
        "prompt_qa", "state_manager",
    }
    assert set(AGENT_ROLES.keys()) == expected


def test_each_role_has_required_fields():
    for role_id, role in AGENT_ROLES.items():
        assert isinstance(role, AgentRole)
        assert role.role_id == role_id
        assert role.display_name
        assert role.display_name_en
        assert role.department in ("executive", "story", "visual", "tech")
        assert role.model_tier in ("tier1", "tier2", "tier3", "tier4")
        assert role.system_prompt


def test_get_agent_role_known():
    role = get_agent_role("producer")
    assert role is not None
    assert role.role_id == "producer"
    assert role.display_name == "制片人"


def test_get_agent_role_unknown():
    assert get_agent_role("nonexistent_role") is None


def test_list_agent_roles_returns_all():
    roles = list_agent_roles()
    assert len(roles) == 10
    for r in roles:
        assert "role_id" in r
        assert "display_name" in r
        assert "department" in r


def test_list_roles_by_department_story():
    story_roles = list_roles_by_department("story")
    assert len(story_roles) == 4
    story_ids = {r.role_id for r in story_roles}
    assert story_ids == {"world_builder", "character_developer", "dialogue_writer", "storyboard_writer"}


def test_list_roles_by_department_tech():
    tech_roles = list_roles_by_department("tech")
    assert len(tech_roles) == 4
    tech_ids = {r.role_id for r in tech_roles}
    assert tech_ids == {"narrative_qa", "visual_qa", "prompt_qa", "state_manager"}


def test_model_tiers_has_4_levels():
    assert len(MODEL_TIERS) == 4
    assert set(MODEL_TIERS.keys()) == {"tier1", "tier2", "tier3", "tier4"}
    for tier_id, tier_data in MODEL_TIERS.items():
        assert "label" in tier_data
        assert "recommended" in tier_data
