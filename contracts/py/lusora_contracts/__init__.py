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

SCHEMA_NAMES = [
    "beat_sheet",
    "edit_plan",
    "theme",
    "style_pack",
    "channel_config",
    "catalog_entry",
    "cost_event",
]

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


@lru_cache(maxsize=None)
def load_schema(name: str) -> dict[str, Any]:
    """Load a JSON Schema by short name (e.g. 'beat_sheet')."""
    path = SCHEMAS_DIR / f"{name}.schema.json"
    return json.loads(path.read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def load_catalog() -> dict[str, Any]:
    return json.loads((CONTRACTS_ROOT / "catalog.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=None)
def load_prices() -> dict[str, Any]:
    return json.loads((CONTRACTS_ROOT / "prices.json").read_text(encoding="utf-8"))


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
