"""Prompt packs — the editable half of every agent prompt (D42–D44).

Two halves, deliberately (D43):

  editable  contracts/prompts/<role>/<name>.json — voice, craft, structure.
            Resolved at enqueue and snapshotted into cfg.json as TEXT, so a
            later edit never changes an in-flight video (D44).
  welded    contracts/prompts/welded/<role>.<half>.txt — output shape, hard
            rules, component menu, op vocabulary. Composed at CALL time from
            the current contracts, never snapshotted: it has to match the
            validator that is about to judge the output, not the validator
            that existed at enqueue.

Templates are mustache-lite: `{{var}}` substitutes, `{{#var}}…{{/var}}`
keeps its body only when `var` is non-empty. Nothing else — a prompt is
data, not a program. The variable set per role is declared in
contracts/prompts/roles.json and gated in CI.
"""

from __future__ import annotations

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Any

from . import CONTRACTS_ROOT

PROMPTS_DIR = CONTRACTS_ROOT / "prompts"

ROLES = ("script", "planner", "chat")

_SECTION_RE = re.compile(r"\{\{#([a-z_][a-z0-9_]*)\}\}(.*?)\{\{/\1\}\}", re.DOTALL)
_VAR_RE = re.compile(r"\{\{([a-z_][a-z0-9_]*)\}\}")


def _stamp(path: Path) -> tuple[str, int, int]:
    """Cache key that follows the file, not the process — same reasoning as
    `_catalog_signature`: the worker runs forever and a prompt edited from the
    platform must be live for the next video."""
    try:
        st = path.stat()
    except FileNotFoundError:
        return (str(path), -1, -1)
    return (str(path), st.st_mtime_ns, st.st_size)


def load_roles() -> dict[str, Any]:
    return _load_json(_stamp(PROMPTS_DIR / "roles.json"))["roles"]


def load_prompt(role: str, name: str) -> dict[str, Any]:
    """One prompt document. Raises if the role/name pair does not exist —
    callers resolve names first (see `resolve`), so a miss here is a bug."""
    if role not in ROLES:
        raise ValueError(f"unknown prompt role {role!r} — known: {ROLES}")
    path = PROMPTS_DIR / role / f"{name}.json"
    if not path.exists():
        raise FileNotFoundError(f"prompt {role}/{name}.json not found in contracts/prompts")
    doc = _load_json(_stamp(path))
    if doc.get("role") != role:
        raise ValueError(f"prompt {path.name}: role is {doc.get('role')!r}, expected {role!r}")
    return doc


def list_prompts(role: str) -> list[dict[str, Any]]:
    directory = PROMPTS_DIR / role
    if not directory.is_dir():
        return []
    return [load_prompt(role, path.stem) for path in sorted(directory.glob("*.json"))]


def welded(role: str, half: str) -> str:
    """The contract half. Empty string when the role has none for that half."""
    return _load_text(_stamp(PROMPTS_DIR / "welded" / f"{role}.{half}.txt"))


@lru_cache(maxsize=64)
def _load_json(stamp: tuple[str, int, int]) -> dict[str, Any]:
    return json.loads(Path(stamp[0]).read_text(encoding="utf-8"))


@lru_cache(maxsize=16)
def _load_text(stamp: tuple[str, int, int]) -> str:
    path = Path(stamp[0])
    return path.read_text(encoding="utf-8") if path.exists() else ""


def render(template: str, variables: dict[str, Any]) -> str:
    """mustache-lite. Optional blocks resolve first, so `{{#x}}…{{x}}…{{/x}}`
    disappears entirely when x is empty instead of leaving its label behind.
    An unknown `{{var}}` renders as empty — CI already rejects those, and a
    literal `{{typo}}` reaching a model is worse than a gap."""

    def present(name: str) -> bool:
        value = variables.get(name)
        return value not in (None, "", [], {}, False)

    def section(match: re.Match[str]) -> str:
        return match.group(2) if present(match.group(1)) else ""

    previous = None
    text = template
    while previous != text:  # nested blocks
        previous = text
        text = _SECTION_RE.sub(section, text)

    def var(match: re.Match[str]) -> str:
        value = variables.get(match.group(1))
        if value is None or value is False:
            return ""
        if isinstance(value, float):
            return f"{value:g}"
        return str(value)

    return _VAR_RE.sub(var, text)


def compose(
    role: str,
    prompt: dict[str, Any] | None,
    variables: dict[str, Any],
) -> tuple[str, str]:
    """(system, user) for one call: the editable half rendered, then the welded
    half appended. `prompt` is the cfg.json snapshot; None falls back to the
    built-in default (videos enqueued before M10, and the worker's own tests)."""
    doc = prompt if prompt is not None else load_prompt(role, "default")
    parts = []
    for half in ("system", "user"):
        editable = render(str(doc.get(half) or ""), variables).strip()
        contract = render(welded(role, half), variables).strip()
        parts.append("\n\n".join(p for p in (editable, contract) if p))
    return parts[0], parts[1]


def resolve(cfg: dict[str, Any], role: str) -> dict[str, Any]:
    """The D44 ladder for a config that has no `prompts` snapshot yet: channel
    (`cfg[role].prompt`) → style pack (`script.prompt`) → built-in default.
    The per-video layer is applied earlier, by the platform, as an override on
    the same field. Returns the document plus the layer that won."""
    name = ((cfg.get(role) or {}).get("prompt")) or None
    source = "channel"
    if not name:
        pack = cfg.get("style_pack_doc") or {}
        name = ((pack.get("script") or {}).get("prompt")) if role == "script" else None
        source = "style_pack"
    if not name:
        name, source = "default", "default"
    try:
        doc = load_prompt(role, str(name))
    except FileNotFoundError:
        doc = load_prompt(role, "default")
        source = "default"
    return {**doc, "source": source}
