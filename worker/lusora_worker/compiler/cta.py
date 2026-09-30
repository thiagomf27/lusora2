"""The subscribe button (D118, documentary plan slice 13).

Dark Palace's `cta_widget`: when the narration says "subscribe" — in any of six
languages — a SubscribeButton pops in at the top-right on that spoken word,
and two sounds play, a pop and then a bell. `style_pack.cta` turns it on; off
by default, so a pack without the block compiles byte-identically
(Principle 7). The button is compiler-placed and never planned: its catalog
entry is `compiler_only`.
"""

from __future__ import annotations

import re
from typing import Any, Callable

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "hold_s": 4.0,
    "lead_cue": "pop",
    "bell_cue": "bell",
    "labels": {"pt": "Inscreva-se", "en": "Subscribe", "es": "Suscríbete",
               "fr": "Abonnez-vous", "de": "Abonnieren", "it": "Iscriviti"},
}

# Dark Palace's CTA_LANG, with one fix: `abonnier` is tried before `abonn[ei]`.
# In DP's order a German "abonnieren" matched the French pattern first and the
# button read "Abonnez-vous".
PATTERNS: list[tuple[str, str]] = [
    (r"inscrev", "pt"),
    (r"subscri", "en"),
    (r"suscr[ií]b", "es"),
    (r"abonnier", "de"),
    (r"abonn[ei]", "fr"),
    (r"iscriv", "it"),
]
LEAD_S = 0.15  # the button is on screen just before the word lands
EARLIEST_S = 0.1
LEAD_CUE_AT = 0.05
BELL_CUE_AT = 0.35


def settings(style: dict[str, Any]) -> dict[str, Any]:
    conf = {**DEFAULTS, **(style.get("cta") or {})}
    conf["labels"] = {**DEFAULTS["labels"], **((style.get("cta") or {}).get("labels") or {})}
    return conf


def find_hit(word_timeline: list[dict[str, Any]]) -> tuple[dict[str, Any], str] | None:
    """The first spoken word that asks to subscribe, and its language."""
    for word in word_timeline:
        text = str(word.get("word") or "")
        for pattern, lang in PATTERNS:
            if re.search(pattern, text, re.I):
                return word, lang
    return None


def place(
    overlays: list[dict[str, Any]],
    style: dict[str, Any],
    word_timeline: list[dict[str, Any]],
    vo_start: float,
    total_end: float,
    aligned: list[tuple[dict[str, Any], tuple[float, float, Any]]],
    cfg: dict[str, Any],
    on_note: Callable[[str], None] | None = None,
) -> tuple[list[dict[str, Any]], list[tuple[str, float, str]]]:
    """(overlays with the button added, cues to pin). Nothing changes when the
    block is off or the narration never asks."""
    conf = settings(style)
    if not conf["enabled"]:
        return overlays, []
    found = find_hit(word_timeline)
    if found is None:
        return overlays, []
    word, lang = found
    start = round(max(EARLIEST_S, vo_start + float(word["start_s"]) - LEAD_S), 3)
    end = round(min(start + float(conf["hold_s"]), total_end), 3)
    if end <= start:
        _note(on_note, f"the subscribe button on '{word['word']}' was dropped: it would start after the video ends")
        return overlays, []
    beat_id = next((str(b["id"]) for b, (s, e, _x) in aligned if s <= start < e), None)
    button = {"id": "o_cta", "beat_id": beat_id, "locked": False, "kind": "component",
              "component": "SubscribeButton", "props": {"label": str(conf["labels"].get(lang) or DEFAULTS["labels"][lang])},
              "start_s": start, "end_s": end}

    pinned: list[tuple[str, float, str]] = []
    cues = (cfg.get("sound_pack_doc") or {}).get("cues")
    for key, offset in (("lead_cue", LEAD_CUE_AT), ("bell_cue", BELL_CUE_AT)):
        name = conf.get(key)
        if not name or name == "none":
            continue
        if cues is not None and name not in cues:
            pack = (cfg.get("sound_pack_doc") or {}).get("name", "?")
            _note(on_note, f"the subscribe button's {key.replace('_', ' ')} '{name}' is not in sound pack '{pack}' — skipped")
            continue
        pinned.append((str(name), round(start + offset, 3), "o_cta"))
    return sorted([*overlays, button], key=lambda o: o["start_s"]), pinned


def _note(on_note: Callable[[str], None] | None, message: str) -> None:
    if on_note is not None:
        on_note(message)
