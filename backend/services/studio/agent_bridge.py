"""Agent Bridge — unifies the Agent chat service (体系A) with Studio pipeline (体系B).

Provides a dispatch layer that lets the user-facing Agent service leverage
specialized Studio agent roles for domain-specific tasks without requiring
a full pipeline run.

Usage:
    from services.studio.agent_bridge import AgentBridge

    bridge = AgentBridge(llm_service)
    result = await bridge.invoke_specialist(
        role_id="cinematographer",
        context={"panels_json": ..., "panel_count": ..., ...},
    )

This module intentionally does NOT own an LLM client.  The caller (typically
``AgentService``) supplies either a callback or a shared ``llm_service``
reference so that model routing and billing remain centralised.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any, Callable, Coroutine, Dict, List, Optional

from .agent_roles import AgentRole, get_agent_role, list_roles_by_department, MODEL_TIERS
from .prompt_integration import get_agent_prompt

logger = logging.getLogger(__name__)


@dataclass
class SpecialistResult:
    """Envelope for specialist agent invocation results."""

    role_id: str
    display_name: str
    model_tier: str
    raw_output: str
    parsed: Any = None
    error: Optional[str] = None


class AgentBridge:
    """Lightweight bridge between the Agent chat service and Studio agent roles.

    The bridge resolves the correct prompt template for a given role, fills it
    with the supplied context variables, and delegates the LLM call to a
    caller-provided async function.

    Parameters
    ----------
    llm_call : async callable
        ``async def llm_call(system_prompt: str, user_prompt: str,
        model_hint: str) -> str``
        The bridge calls this to actually run inference.  ``model_hint`` is
        the ``MODEL_TIERS[role.model_tier]["recommended"]`` value, which the
        caller may override.
    """

    def __init__(
        self,
        llm_call: Callable[..., Coroutine[Any, Any, str]],
    ) -> None:
        self._llm_call = llm_call

    # ------------------------------------------------------------------
    # public API
    # ------------------------------------------------------------------

    async def invoke_specialist(
        self,
        role_id: str,
        context: Optional[Dict[str, Any]] = None,
        user_prompt: str = "",
    ) -> SpecialistResult:
        """Invoke a single specialist agent role and return its output.

        Parameters
        ----------
        role_id : str
            Must be a registered role in ``AGENT_ROLES``.
        context : dict, optional
            Template variables forwarded to the prompt template.
        user_prompt : str, optional
            Additional user-level message appended after the system prompt.

        Returns
        -------
        SpecialistResult
        """
        role = get_agent_role(role_id)
        if role is None:
            return SpecialistResult(
                role_id=role_id,
                display_name="unknown",
                model_tier="tier3",
                raw_output="",
                error=f"Unknown agent role: {role_id}",
            )

        system_prompt = get_agent_prompt(role_id, **(context or {}))
        model_hint = MODEL_TIERS.get(role.model_tier, {}).get(
            "recommended", "claude-sonnet-4-5-20250929"
        )

        try:
            raw = await self._llm_call(
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                model_hint=model_hint,
            )
        except Exception as exc:
            logger.exception("Specialist %s failed", role_id)
            return SpecialistResult(
                role_id=role_id,
                display_name=role.display_name,
                model_tier=role.model_tier,
                raw_output="",
                error=str(exc),
            )

        return SpecialistResult(
            role_id=role_id,
            display_name=role.display_name,
            model_tier=role.model_tier,
            raw_output=raw,
        )

    async def invoke_chain(
        self,
        steps: List[Dict[str, Any]],
    ) -> List[SpecialistResult]:
        """Invoke multiple specialist roles sequentially.

        Each step is a dict with keys ``role_id``, ``context`` (optional),
        and ``user_prompt`` (optional).  The output of step *N* is available
        as ``{prev_output}`` in step *N+1*'s context.
        """
        results: List[SpecialistResult] = []
        prev_output = ""

        for step in steps:
            ctx = dict(step.get("context") or {})
            ctx.setdefault("prev_output", prev_output)

            result = await self.invoke_specialist(
                role_id=step["role_id"],
                context=ctx,
                user_prompt=step.get("user_prompt", ""),
            )
            results.append(result)
            prev_output = result.raw_output

            if result.error:
                logger.warning(
                    "Chain aborted at step %s: %s", step["role_id"], result.error
                )
                break

        return results

    # ------------------------------------------------------------------
    # introspection helpers
    # ------------------------------------------------------------------

    @staticmethod
    def list_available_specialists(department: Optional[str] = None) -> List[Dict[str, str]]:
        """Return metadata for all registered specialist roles."""
        if department:
            roles = list_roles_by_department(department)
        else:
            from .agent_roles import AGENT_ROLES
            roles = list(AGENT_ROLES.values())

        return [
            {
                "role_id": r.role_id,
                "display_name": r.display_name,
                "display_name_en": r.display_name_en,
                "department": r.department,
                "model_tier": r.model_tier,
                "description": r.description,
                "has_template": r.prompt_template is not None,
            }
            for r in roles
        ]
