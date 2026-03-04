"""Prompt Integration — bridges agent roles with prompt_loader templates.

Provides a single entry point to resolve the full prompt for an agent role:
if the role has a ``prompt_template`` defined, loads and formats the template
via ``prompt_loader``; otherwise falls back to the role's ``system_prompt``.
"""

from __future__ import annotations

import logging
from typing import Optional

from ..prompt_loader import load_prompt
from .agent_roles import AgentRole, get_agent_role

logger = logging.getLogger(__name__)


def get_agent_prompt(role_id: str, **context) -> str:
    """Return the resolved prompt string for *role_id*.

    If the role defines a ``prompt_template``, the template is loaded from
    disk via :func:`prompt_loader.load_prompt` and *context* kwargs are
    substituted into it.  Otherwise the role's static ``system_prompt`` is
    returned as-is.

    Args:
        role_id: Identifier of the agent role (must exist in AGENT_ROLES).
        **context: Variable substitutions forwarded to the prompt template.

    Returns:
        The fully resolved prompt string.

    Raises:
        ValueError: If *role_id* is not a registered agent role.
    """
    role = get_agent_role(role_id)
    if role is None:
        raise ValueError(f"Unknown agent role: {role_id}")

    if role.prompt_template is not None:
        try:
            return load_prompt(
                role.prompt_template.category,
                role.prompt_template.name,
                **context,
            )
        except FileNotFoundError:
            logger.warning(
                "Prompt template %s/%s not found for role %s; falling back to system_prompt",
                role.prompt_template.category,
                role.prompt_template.name,
                role_id,
            )
        except KeyError as exc:
            logger.warning(
                "Missing variable %s in template %s/%s for role %s; falling back to system_prompt",
                exc,
                role.prompt_template.category,
                role.prompt_template.name,
                role_id,
            )

    return role.system_prompt


def get_role_prompt_template(role_id: str) -> Optional[dict]:
    """Return the prompt_template metadata for a role, or None."""
    role = get_agent_role(role_id)
    if role is None or role.prompt_template is None:
        return None
    return {
        "category": role.prompt_template.category,
        "name": role.prompt_template.name,
    }
