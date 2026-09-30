"""Film texture placement (D112, documentary plan slice 7).

Dark Palace's `efeitos.py`: a light leak straddles the cut into a story turn,
flashback passages get an aged grade, and the first footage of a flashback
plays on an old CRT set. The THEME's `texture` says what those look like (and
draws dust and tape everywhere on its own); this module only decides WHERE,
from `style_pack.texture.placement`:

- `narrative`: from marks.json (the narrative_marks stage) — a leak on the cut
  into each turn beat, the grade over every flashback beat's shots, a CRT set
  on the first footage shot of each flashback run.
- `count`: DP's fixed rhythm for a script with no story shape — a leak on every
  `leak_every`th picture cut, the grade on every `vintage_every`th shot.
- `off` (the default): nothing, so a pack without the block compiles
  byte-identically.

Both modes leave the hook alone (it has its own pacing, title card and
moments), keep leaks `leak_min_gap_s` apart, cap the grade at
`vintage_max_share` of the picture shots, and never replace a transition a
human, a section break or an overlay chose — only a cut or a filler one.
"""

from __future__ import annotations

from typing import Any, Callable

PICTURE = ("video", "image")
DEFAULTS = {
    "placement": "off",
    "light_leak": True,
    "leak_min_gap_s": 12.0,
    "leak_duration_s": 0.8,
    "vintage_max_share": 0.33,
    "leak_every": 3,
    "vintage_every": 7,
}


def settings(style: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULTS, **(style.get("texture") or {})}


def _runs(visual: list[dict[str, Any]]) -> list[list[int]]:
    """Consecutive aged shots, as index runs."""
    runs: list[list[int]] = []
    for i, item in enumerate(visual):
        if item.get("grade") != "vintage":
            continue
        if runs and runs[-1][-1] == i - 1:
            runs[-1].append(i)
        else:
            runs.append([i])
    return runs


def settle_crt(visual: list[dict[str, Any]]) -> int:
    """Put the CRT set on the first FOOTAGE shot of each aged run, in place.

    The compiler calls it with the media it planned; resolve_assets calls it
    again once the shots are real, because a planned photo can resolve to
    footage and back. A run with no footage has no set. Returns how many.
    """
    count = 0
    for run in _runs(visual):
        first = next((i for i in run if visual[i].get("media_type") == "video"), None)
        for i in run:
            visual[i].pop("crt", None)
        if first is not None:
            visual[first]["crt"] = True
            count += 1
    return count


def place_texture(
    visual: list[dict[str, Any]],
    style: dict[str, Any],
    marks: dict[str, Any] | None,
    on_note: Callable[[str], None] | None = None,
) -> None:
    """Mark leaks, grades and CRT sets on the visual track, in place.

    Runs after the D95 placement and before `_fit_transitions`, so a leak is
    trimmed against its neighbours like any other transition.
    """
    conf = settings(style)
    mode = str(conf["placement"])
    if mode == "off" or not visual:
        return
    if mode == "narrative" and not marks:
        if on_note:
            on_note("texture: narrative placement but no marks.json — nothing placed")
        return
    body = [i for i, v in enumerate(visual) if not v.get("hook")]
    pictures = [i for i in body if visual[i].get("media_type") in PICTURE]

    # ---- the aged grade ----
    if mode == "narrative":
        back = {str(b) for b in (marks or {}).get("flashback") or []}
        aged = [i for i in pictures if str(visual[i].get("beat_id")) in back]
    else:
        every = int(conf["vintage_every"])
        aged = [i for n, i in enumerate(pictures, start=1) if n % every == 0]
    cap = int(float(conf["vintage_max_share"]) * len(pictures))
    if len(aged) > cap and on_note:
        on_note(f"texture: {len(aged)} shots to age, capped at {cap} "
                f"({float(conf['vintage_max_share']):.0%} of {len(pictures)} picture shots)")
    aged = aged[:cap]
    for i in aged:
        visual[i]["grade"] = "vintage"
    # a flashback opens on an old television, it does not stay on one
    crt = settle_crt(visual)

    # ---- light leaks ----
    leaks = 0
    if conf["light_leak"]:
        # junction j is the cut from shot j to shot j+1; the cut OUT of the hook
        # counts (DP: the first paragraph after the hook is a turn)
        junctions = [i - 1 for i in body if i > 0
                     and visual[i - 1].get("media_type") in PICTURE
                     and visual[i].get("media_type") in PICTURE]
        if mode == "narrative":
            turns = {str(b) for b in (marks or {}).get("turns") or []}
            # the first shot of a turn beat: a beat absorbed under another shot has no cut of its own
            wanted = [j for j in junctions
                      if str(visual[j + 1].get("beat_id")) in turns
                      and visual[j + 1].get("beat_id") != visual[j].get("beat_id")]
        else:
            every = int(conf["leak_every"])
            counted = [j for j in junctions if not visual[j].get("hook")]  # the rhythm starts after the hook
            wanted = [j for n, j in enumerate(counted, start=1) if n % every == 0]
        gap = float(conf["leak_min_gap_s"])
        transitions = style.get("transitions") or {}
        plain = {"type": str(transitions.get("default") or "cut"), "duration_s": float(transitions.get("duration_s", 0.5))}
        last = float("-inf")
        for j in wanted:
            transition = visual[j].get("transition_out") or {}
            if (transition.get("type") or "cut") != "cut" and transition.get("placed_by") != "filler":
                continue  # a human's, a section break's or an overlay's choice stands
            at = float(visual[j]["end_s"])
            if at - last < gap:
                continue
            visual[j]["transition_out"] = {"type": "light_leak", "duration_s": float(conf["leak_duration_s"]),
                                           "placed_by": "texture"}
            # filler is never next to another animated junction (D95); the leak outranks it
            for n in (j - 1, j + 1):
                if 0 <= n < len(visual) - 1 and (visual[n].get("transition_out") or {}).get("placed_by") == "filler":
                    visual[n]["transition_out"] = dict(plain)
            last = at
            leaks += 1

    if on_note:
        on_note(f"texture ({mode}): {leaks} light leaks, {len(aged)} aged shots, {crt} on a CRT set")
