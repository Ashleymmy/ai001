"""跨集状态管理器 — Phase 4, Task 4.1

Cross-episode state persistence for the Studio long-form production workbench.

Responsibilities:
  - Propagate character states between episodes
  - Track the full foreshadowing lifecycle (planted -> resolved / abandoned)
  - Auto-extend the world bible with newly discovered motifs & cultural elements

The underlying CRUD is delegated to *StudioStorage* (Phase 3 tables:
``story_character_states``, ``story_foreshadowing``, ``kb_world_bible``).
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional


# ===================================================================
# StoryStateManager
# ===================================================================

class StoryStateManager:
    """跨集状态管理器 — Phase 4

    Manages character state propagation across episodes,
    foreshadowing lifecycle, and world bible evolution.
    """

    def __init__(self, storage):
        """
        Parameters
        ----------
        storage : StudioStorage
            Storage backend that exposes the Phase-3 helper methods for
            ``story_character_states`` and ``story_foreshadowing`` tables.
        """
        self.storage = storage

    # ------------------------------------------------------------------
    # Character state propagation
    # ------------------------------------------------------------------

    def propagate_character_states(
        self,
        series_id: str,
        from_episode_id: str,
        to_episode_id: str,
    ) -> List[Dict]:
        """Propagate active character states from one episode to the next.

        Only states whose ``valid_to_episode`` is ``None`` (i.e. still active)
        are considered for propagation.  Each propagated state is persisted as
        a *new* row so the destination episode carries its own records.

        Returns
        -------
        list[dict]
            The newly-created state records for *to_episode_id*.
        """
        all_states = self.storage.list_character_states(series_id)
        active_states = [
            s for s in all_states
            if s.get("episode_id") == from_episode_id
            and s.get("valid_to_episode") is None
        ]

        propagated: List[Dict] = []
        for state in active_states:
            new_state = {
                "series_id": series_id,
                "element_id": state.get("element_id", ""),
                "episode_id": to_episode_id,
                "state_key": state.get("state_key", ""),
                "state_value": state.get("state_value", ""),
                "valid_from_episode": state.get("valid_from_episode", 0),
                "valid_to_episode": None,
            }
            result = self.storage.create_character_state(new_state)
            propagated.append({**new_state, **result})

        return propagated

    def get_character_snapshot(
        self,
        series_id: str,
        element_id: str,
        episode_number: int,
    ) -> Dict:
        """Return the full state snapshot of a character at *episode_number*.

        Aggregates every active state whose ``valid_from_episode`` <=
        *episode_number* and (``valid_to_episode`` is ``None`` **or**
        ``valid_to_episode`` >= *episode_number*).

        Returns
        -------
        dict
            Mapping of ``state_key`` -> ``state_value``.  Later entries
            (higher ``valid_from_episode``) win when keys collide.
        """
        all_states = self.storage.list_character_states(series_id, element_id)

        relevant: List[Dict] = []
        for s in all_states:
            vfrom = s.get("valid_from_episode", 0) or 0
            vto = s.get("valid_to_episode")
            if vfrom <= episode_number and (vto is None or vto >= episode_number):
                relevant.append(s)

        # Sort by valid_from ascending so that later states overwrite earlier
        relevant.sort(key=lambda s: s.get("valid_from_episode", 0) or 0)

        snapshot: Dict[str, str] = {}
        for s in relevant:
            snapshot[s.get("state_key", "")] = s.get("state_value", "")
        return snapshot

    def track_state_change(
        self,
        series_id: str,
        element_id: str,
        episode_id: str,
        state_key: str,
        state_value: str,
        valid_from: int,
    ) -> Dict:
        """Record a new character state change.

        If an open-ended entry with the same *state_key* already exists
        (``valid_to_episode`` is ``None``), it is closed by setting
        ``valid_to_episode = valid_from - 1`` before the new state is
        created.

        Returns
        -------
        dict
            The newly-created state record.
        """
        existing_states = self.storage.list_character_states(series_id, element_id)

        # Close any prior open-ended entry for the same key
        for s in existing_states:
            if (
                s.get("state_key") == state_key
                and s.get("valid_to_episode") is None
            ):
                # We cannot partially update via the storage helper directly,
                # so we delete the old row and re-create it with valid_to set.
                old_id = s.get("id", "")
                self.storage.delete_character_state(old_id)
                closed = {
                    "id": old_id,
                    "series_id": s.get("series_id", ""),
                    "element_id": s.get("element_id", ""),
                    "episode_id": s.get("episode_id", ""),
                    "state_key": s.get("state_key", ""),
                    "state_value": s.get("state_value", ""),
                    "valid_from_episode": s.get("valid_from_episode", 0),
                    "valid_to_episode": valid_from - 1,
                }
                self.storage.create_character_state(closed)

        new_state = {
            "series_id": series_id,
            "element_id": element_id,
            "episode_id": episode_id,
            "state_key": state_key,
            "state_value": state_value,
            "valid_from_episode": valid_from,
            "valid_to_episode": None,
        }
        result = self.storage.create_character_state(new_state)
        return {**new_state, **result}

    # ------------------------------------------------------------------
    # Foreshadowing lifecycle
    # ------------------------------------------------------------------

    def get_unresolved_foreshadowing(self, series_id: str) -> List[Dict]:
        """Return all *planted* but unresolved foreshadowing items."""
        return self.storage.list_foreshadowing(series_id, status="planted")

    def resolve_foreshadowing(self, fid: str, resolved_episode_id: str) -> bool:
        """Mark a foreshadowing item as *resolved*.

        Parameters
        ----------
        fid : str
            Foreshadowing record ID.
        resolved_episode_id : str
            The episode in which the foreshadowing was resolved.

        Returns
        -------
        bool
            ``True`` on success.
        """
        return self.storage.update_foreshadowing(fid, {
            "status": "resolved",
            "resolved_episode_id": resolved_episode_id,
        })

    def abandon_foreshadowing(self, fid: str) -> bool:
        """Mark a foreshadowing item as *abandoned*.

        Returns
        -------
        bool
            ``True`` on success.
        """
        return self.storage.update_foreshadowing(fid, {
            "status": "abandoned",
        })

    def check_foreshadowing_warnings(
        self,
        series_id: str,
        current_episode_number: int,
        warning_threshold: int = 5,
    ) -> List[Dict]:
        """Detect foreshadowing items that have lingered beyond *warning_threshold*.

        An item triggers a warning when it has been *planted* and its
        ``planted_episode_id`` maps to an episode whose ``act_number`` is more
        than *warning_threshold* episodes before *current_episode_number*.

        Returns
        -------
        list[dict]
            Each dict carries the original foreshadowing fields plus an extra
            ``episodes_since_planted`` key.
        """
        planted = self.get_unresolved_foreshadowing(series_id)
        warnings: List[Dict] = []
        for item in planted:
            planted_ep_id = item.get("planted_episode_id", "")
            if not planted_ep_id:
                continue
            planted_ep = self.storage.get_episode(planted_ep_id)
            if planted_ep is None:
                continue
            planted_num = planted_ep.get("act_number", 0) or 0
            gap = current_episode_number - planted_num
            if gap >= warning_threshold:
                warnings.append({
                    **item,
                    "episodes_since_planted": gap,
                })
        return warnings

    # ------------------------------------------------------------------
    # Episode state summary (consumed by Agent Pipeline)
    # ------------------------------------------------------------------

    def get_episode_state_summary(
        self,
        series_id: str,
        episode_id: str,
    ) -> Dict:
        """Compile a complete state summary for an episode.

        The returned dict contains:
          - ``active_character_states`` – per-element snapshot dicts
          - ``unresolved_foreshadowing`` – list of planted items
          - ``foreshadowing_warnings`` – items exceeding the warning threshold

        This summary is designed to be injected into LLM prompts by the
        Agent Pipeline so that story-continuation is aware of accumulated
        world state.
        """
        # Determine the act_number for the target episode
        episode = self.storage.get_episode(episode_id)
        episode_number: int = 0
        if episode:
            episode_number = episode.get("act_number", 0) or 0

        # Collect all character states that are active for this series
        all_states = self.storage.list_character_states(series_id)
        # Group by element_id to produce per-character snapshots
        element_ids = sorted({s.get("element_id", "") for s in all_states})
        character_states: Dict[str, Dict] = {}
        for eid in element_ids:
            if not eid:
                continue
            snap = self.get_character_snapshot(series_id, eid, episode_number)
            if snap:
                character_states[eid] = snap

        unresolved = self.get_unresolved_foreshadowing(series_id)
        warnings = self.check_foreshadowing_warnings(series_id, episode_number)

        return {
            "episode_id": episode_id,
            "episode_number": episode_number,
            "active_character_states": character_states,
            "unresolved_foreshadowing": unresolved,
            "foreshadowing_warnings": warnings,
        }

    # ------------------------------------------------------------------
    # World bible auto-update
    # ------------------------------------------------------------------

    def auto_update_world_bible(
        self,
        series_id: str,
        episode_data: Dict,
        new_elements: Optional[List[str]] = None,
    ) -> Dict:
        """Auto-extend the world bible based on episode developments.

        Appends new recurring motifs or cultural elements discovered during
        production.  Existing entries are **never** overwritten — only
        extended.

        Parameters
        ----------
        series_id : str
            The series whose world bible should be updated.
        episode_data : dict
            Episode payload (as returned by ``get_episode``).  The method
            inspects ``summary`` and ``creative_brief`` for extractable
            motifs.
        new_elements : list[str] | None
            Explicit list of motif / cultural-element strings to append.

        Returns
        -------
        dict
            The updated world bible record.
        """
        bible = self.storage.get_world_bible_by_series(series_id)

        if bible is None:
            # Bootstrap a minimal world bible for the series
            bible = self.storage.create_world_bible(series_id=series_id)

        # ------ Gather motifs to append ------
        additions: List[str] = list(new_elements or [])

        # Try to extract motifs from episode_data
        brief = episode_data.get("creative_brief", {})
        if isinstance(brief, str):
            try:
                brief = json.loads(brief)
            except (json.JSONDecodeError, TypeError):
                brief = {}

        motifs_from_brief = brief.get("motifs", []) if isinstance(brief, dict) else []
        if isinstance(motifs_from_brief, list):
            additions.extend(str(m) for m in motifs_from_brief if m)

        cultural = brief.get("cultural_elements", []) if isinstance(brief, dict) else []
        if isinstance(cultural, list):
            additions.extend(str(c) for c in cultural if c)

        if not additions:
            return bible

        # ------ Merge with existing motifs (no duplicates) ------
        existing_raw = bible.get("recurring_motifs", "") or ""
        existing_motifs = [
            m.strip() for m in existing_raw.split(",") if m.strip()
        ]

        merged_set = set(existing_motifs)
        truly_new = [a for a in additions if a not in merged_set]
        if not truly_new:
            return bible

        merged_motifs = existing_motifs + truly_new
        updated_motifs_str = ", ".join(merged_motifs)

        result = self.storage.update_world_bible(
            bible["id"],
            {"recurring_motifs": updated_motifs_str},
        )
        return result if result is not None else bible
