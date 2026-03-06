"""
Prompt Loader Service

Loads .txt prompt template files from backend/data/prompts/ and applies
variable substitution using Python's str.format() method.

Directory structure:
    backend/data/prompts/
        agents/          - Agent system prompts
        functions/       - Functional prompts
"""

import logging
from pathlib import Path
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)

# Resolve the prompts directory relative to this file's location.
# In development: backend/services/prompt_loader.py -> backend/data/prompts/
# We walk up from services/ to backend/ then into data/prompts/.
_THIS_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _THIS_DIR.parent
_DEFAULT_PROMPTS_DIR = _BACKEND_DIR / "data" / "prompts"

# Allow override via environment variable for packaged/deployed scenarios.
import os
_PROMPTS_DIR = Path(os.environ.get("WAOO_PROMPTS_DIR", str(_DEFAULT_PROMPTS_DIR)))


def _get_prompts_dir() -> Path:
    """Return the prompts base directory, validating it exists."""
    if _PROMPTS_DIR.is_dir():
        return _PROMPTS_DIR
    if _DEFAULT_PROMPTS_DIR.is_dir():
        return _DEFAULT_PROMPTS_DIR
    raise FileNotFoundError(
        f"Prompts directory not found. Checked: {_PROMPTS_DIR}, {_DEFAULT_PROMPTS_DIR}"
    )


@lru_cache(maxsize=128)
def _read_template(category: str, name: str) -> str:
    """Read and cache a raw prompt template from disk."""
    prompts_dir = _get_prompts_dir()
    file_path = prompts_dir / category / f"{name}.txt"
    if not file_path.is_file():
        raise FileNotFoundError(f"Prompt template not found: {file_path}")
    return file_path.read_text(encoding="utf-8")


def load_prompt(category: str, name: str, **variables) -> str:
    """
    Load a prompt template and apply variable substitution.

    Args:
        category: Subdirectory under prompts/ (e.g. "agents", "functions").
        name: Template filename without .txt extension (e.g. "character_profile").
        **variables: Key-value pairs to substitute into the template via str.format().

    Returns:
        The prompt string with variables substituted.

    Raises:
        FileNotFoundError: If the template file does not exist.
        KeyError: If a required variable placeholder is missing from **variables.

    Example:
        >>> prompt = load_prompt("agents", "character_profile",
        ...                      character_name="Alice", story_context="...", style="anime")
    """
    template = _read_template(category, name)
    if variables:
        return template.format(**variables)
    return template


def list_prompts(category: Optional[str] = None) -> list[dict]:
    """
    List available prompt templates.

    Args:
        category: If provided, list only prompts in that category.
                  If None, list prompts across all categories.

    Returns:
        A list of dicts with keys: "category", "name", "path".
    """
    prompts_dir = _get_prompts_dir()
    results = []

    if category:
        cat_dir = prompts_dir / category
        if cat_dir.is_dir():
            for f in sorted(cat_dir.glob("*.txt")):
                results.append({
                    "category": category,
                    "name": f.stem,
                    "path": str(f),
                })
    else:
        for cat_dir in sorted(prompts_dir.iterdir()):
            if cat_dir.is_dir():
                for f in sorted(cat_dir.glob("*.txt")):
                    results.append({
                        "category": cat_dir.name,
                        "name": f.stem,
                        "path": str(f),
                    })

    return results


def clear_cache() -> None:
    """Clear the template cache. Useful after editing templates at runtime."""
    _read_template.cache_clear()
