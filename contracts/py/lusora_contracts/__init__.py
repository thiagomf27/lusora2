"""lusora contracts — Python side.

Loads the JSON Schemas, catalog, price table and status rules from the
contracts package. The JSON files are the source of truth; this module
only locates and parses them.
"""

from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTRACTS_ROOT = Path(__file__).resolve().parent.parent.parent
SCHEMAS_DIR = CONTRACTS_ROOT / "schemas"
COMPONENT_PACKS_DIR = CONTRACTS_ROOT / "component-packs"
SOUND_PACKS_DIR = CONTRACTS_ROOT / "sound-packs"

SCHEMA_NAMES = [
    "beat_sheet",
    "edit_plan",
    "theme",
    "style_pack",
    "channel_config",
    "catalog_entry",
    "cost_event",
    "prompt",
    "sound_pack",
    "pipeline_manifest",
]

# Mirrors MOODS in contracts/src/types.ts and the enum in sound_pack.schema.json.
# `Beat.mood` stays a free string on purpose: an unknown mood degrades to
# "neutral" in the compiler rather than failing a video over a word choice.
MOODS = (
    "neutral",
    "tense",
    "somber",
    "hopeful",
    "urgent",
    "triumphant",
    "reflective",
    "playful",
)

# Mirrors contracts/src/status.ts — keep in sync (tested by fixture in CI).
VIDEO_STATUS_TRANSITIONS: dict[str, list[str]] = {
    "draft": ["queued"],
    "queued": ["producing", "draft"],
    "producing": ["rendered", "error"],
    "rendered": ["in_review", "approved", "sent_back"],
    "in_review": ["approved", "sent_back"],
    "approved": ["posted", "sent_back"],
    "sent_back": ["queued", "in_review"],
    "posted": [],
    "error": ["queued", "draft"],
}

EDITOR_ALLOWED_STATUSES = ["rendered", "in_review", "approved", "sent_back", "posted"]


def load_schema(name: str) -> dict[str, Any]:
    """Load a JSON Schema by short name (e.g. 'beat_sheet').

    Re-read when the file changes: the worker runs forever, and a schema edited
    while it is up would otherwise be ignored until a restart (see
    `_catalog_signature` for the same reasoning about the catalog).
    """
    path = SCHEMAS_DIR / f"{name}.schema.json"
    st = path.stat()
    return _load_schema(str(path), st.st_mtime_ns, st.st_size)


@lru_cache(maxsize=32)
def _load_schema(path: str, _mtime_ns: int, _size: int) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def _catalog_signature() -> tuple[tuple[str, int, int], ...]:
    """(path, mtime_ns, size) per catalog file — the cache key.

    The worker is a long-lived `run_forever` poller, so a permanently cached
    catalog would ignore a component added through the platform until someone
    restarted the process. Stat calls are cheap; a stale component menu is not.
    """
    paths = [CONTRACTS_ROOT / "catalog.json"]
    if COMPONENT_PACKS_DIR.is_dir():
        paths.extend(sorted(COMPONENT_PACKS_DIR.glob("*.json")))
    out = []
    for path in paths:
        try:
            st = path.stat()
        except FileNotFoundError:
            continue
        out.append((str(path), st.st_mtime_ns, st.st_size))
    return tuple(out)


def load_catalog() -> dict[str, Any]:
    """The `core` catalog (generated from the engine registry) merged with the
    data-only packs in contracts/component-packs/.

    Reparsed whenever any of those files changes on disk (see
    `_catalog_signature`), so a newly added component is live for the next
    video without restarting the worker.

    A duplicate name raises: the catalog exists so that a component the
    planner may choose is exactly a component the renderer can draw, and a
    silently shadowed entry would break that in the least visible way.
    """
    return _load_catalog(_catalog_signature())


@lru_cache(maxsize=4)
def _load_catalog(_signature: tuple[tuple[str, int, int], ...]) -> dict[str, Any]:
    catalog = json.loads((CONTRACTS_ROOT / "catalog.json").read_text(encoding="utf-8"))
    components: list[dict[str, Any]] = list(catalog["components"])
    origin = {entry["name"]: "catalog.json" for entry in components}

    paths = sorted(COMPONENT_PACKS_DIR.glob("*.json")) if COMPONENT_PACKS_DIR.is_dir() else []
    for path in paths:
        pack = json.loads(path.read_text(encoding="utf-8"))
        declared = pack.get("pack")
        if declared != path.stem:
            raise ValueError(f"component pack {path.name}: 'pack' is {declared!r}, expected {path.stem!r}")
        if declared == "core":
            raise ValueError(f"component pack {path.name}: 'core' is generated from the engine registry")
        for entry in pack.get("components", []):
            name = entry.get("name")
            if entry.get("pack") != declared:
                raise ValueError(f"component pack {path.name}: entry {name!r} declares pack {entry.get('pack')!r}")
            if name in origin:
                raise ValueError(f"component pack {path.name}: {name!r} already defined in {origin[name]}")
            origin[name] = path.name
            components.append(entry)

    return {**catalog, "components": components}


# keep the memoization API callers (and tests) already use
load_catalog.cache_clear = _load_catalog.cache_clear  # type: ignore[attr-defined]
load_schema.cache_clear = _load_schema.cache_clear  # type: ignore[attr-defined]


@lru_cache(maxsize=None)
def load_prices() -> dict[str, Any]:
    return json.loads((CONTRACTS_ROOT / "prices.json").read_text(encoding="utf-8"))


def sound_pack_dir(name: str) -> Path:
    """Folder holding a sound pack's manifest and its audio files."""
    return SOUND_PACKS_DIR / name


def load_sound_pack(name: str) -> dict[str, Any]:
    """Load a sound pack manifest by name (D48).

    Same freshness reasoning as load_schema: the worker runs forever, so a pack
    edited while it is up must not be cached until a restart.
    """
    path = sound_pack_dir(name) / "manifest.json"
    st = path.stat()
    return _load_sound_pack(str(path), st.st_mtime_ns, st.st_size)


@lru_cache(maxsize=8)
def _load_sound_pack(path: str, _mtime_ns: int, _size: int) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def list_sound_packs() -> list[str]:
    if not SOUND_PACKS_DIR.is_dir():
        return []
    return sorted(p.name for p in SOUND_PACKS_DIR.iterdir() if (p / "manifest.json").is_file())


def catalog_component(name: str) -> dict[str, Any] | None:
    for entry in load_catalog()["components"]:
        if entry["name"] == name:
            return entry
    return None


def can_transition(role: str, frm: str, to: str) -> bool:
    if to not in VIDEO_STATUS_TRANSITIONS.get(frm, []):
        return False
    if role == "editor":
        return frm in EDITOR_ALLOWED_STATUSES and to in EDITOR_ALLOWED_STATUSES
    return True
