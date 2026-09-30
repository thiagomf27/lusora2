"""The body's rhythm (D113, documentary plan slice 8).

Dark Palace's `montar` after the hook: about one shot per five seconds (one
15 s take read as "stuck"), no still held past six, cuts on a spoken word, and
never two graphics in a row. `style_pack.pacing.rhythm` carries those numbers;
the hook keeps its own (`pacing.hook`, D106), so nothing here touches a shot
marked `hook`.

Every knob is off by default, so a pack without the block compiles
byte-identically (Principle 7).
"""

from __future__ import annotations

import bisect
import math
from typing import Any, Callable

import lusora_contracts

DEFAULTS = {
    "shot_s": 0.0,
    "max_still_s": 0.0,
    "snap_to_words": False,
    "min_graphic_gap_s": 0.0,
}
# a snapped cut moves at most this far, and never leaves a shot shorter than SHORTEST
REACH_S = 0.5
SHORTEST_S = 1.0
# a graphic that fills at least this much of the frame's height is a panel over
# the shot rather than a tag in its corner
PANEL_SHARE = 0.5


def settings(pacing: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULTS, **(pacing.get("rhythm") or {})}


def split_long(
    spans: list[tuple[float, float]], still: bool, conf: dict[str, Any], floor: float = 0.0,
) -> list[tuple[float, float]]:
    """Divide any span longer than the pack allows into equal parts.

    `shot_s` is DP's TOMADA_S: a span becomes ceil(duration / shot_s) shots.
    `max_still_s` is its PARADA_MAX_S, for a span the plan puts a photo on (a
    planned photo can still resolve to footage; then it is simply one more cut).
    No part comes out under `floor`, the pack's own hold floor.
    """
    limits = [float(conf["shot_s"] or 0)]
    if still:
        limits.append(float(conf["max_still_s"] or 0))
    limit = min((x for x in limits if x > 0), default=0.0)
    if limit <= 0:
        return spans
    out: list[tuple[float, float]] = []
    for start, end in spans:
        duration = end - start
        # a hair of slack so a span of exactly `limit` seconds is not cut in two
        parts = math.ceil(duration / limit - 0.02)
        if floor > 0:
            parts = min(parts, int(duration / floor + 1e-6))
        if parts <= 1:
            out.append((start, end))
            continue
        step = duration / parts
        for k in range(parts):
            s0 = start if k == 0 else round(start + step * k, 3)
            s1 = end if k == parts - 1 else round(start + step * (k + 1), 3)
            out.append((s0, s1))
    return out


def snap(spans: list[tuple[float, float]], onsets: list[float], floor: float = 0.0) -> list[tuple[float, float]]:
    """Move each cut INSIDE the run of spans onto the nearest word onset (DP's `_cortes`).

    The run's own start and end are the beat's and stay put; an arithmetic cut
    lands mid-word, which reads as a stumble. A cut with no onset within
    REACH_S, or whose onset would leave either side under SHORTEST_S or the
    pack's hold floor, stays.
    """
    if len(spans) < 2 or not onsets:
        return spans
    shortest = max(SHORTEST_S, floor)
    cuts = [s1 for _s0, s1 in spans[:-1]]
    bounds = [spans[0][0], *cuts, spans[-1][1]]
    for k in range(1, len(bounds) - 1):
        at = bounds[k]
        i = bisect.bisect_left(onsets, at)
        near = [onsets[j] for j in (i - 1, i) if 0 <= j < len(onsets)]
        if not near:
            continue
        best = min(near, key=lambda o: abs(o - at))
        if abs(best - at) > REACH_S:
            continue
        if best - bounds[k - 1] < shortest - 1e-6 or bounds[k + 1] - best < shortest - 1e-6:
            continue
        bounds[k] = round(best, 3)
    return [(bounds[k], bounds[k + 1]) for k in range(len(bounds) - 1)]


def _is_panel(item: dict[str, Any]) -> bool:
    if item.get("kind") != "component":
        return False
    region = (lusora_contracts.catalog_component(str(item.get("component", ""))) or {}).get("region")
    # undeclared: a corner tag (StatTag, DateStamp) — never dropped on a guess
    return bool(region) and float(region["y_max"]) - float(region["y_min"]) >= PANEL_SHARE


def space_graphics(
    overlays: list[dict[str, Any]],
    conf: dict[str, Any],
    hook_end_s: float,
    on_note: Callable[[str], None] | None = None,
) -> list[dict[str, Any]]:
    """Drop a panel graphic that follows another after the hook with less than
    `min_graphic_gap_s` of plain footage between them (DP: two graphics in a
    row held 19 s; the second became footage). The earlier one wins, as in
    `_trim_overlay_holds`. Corner tags and the hook's own graphics never count.
    """
    gap = float(conf["min_graphic_gap_s"] or 0)
    if gap <= 0:
        return overlays
    kept: list[dict[str, Any]] = []
    last_end: float | None = None
    last_name = ""
    for item in overlays:
        start = float(item["start_s"])
        if start < hook_end_s or item.get("id") == "o_hook_title" or not _is_panel(item):
            kept.append(item)
            continue
        if last_end is not None and start - last_end < gap:
            if on_note:
                on_note(f"overlay {item.get('component')} on beat {item.get('beat_id')} was dropped: "
                        f"it starts {max(0.0, start - last_end):.1f}s after {last_name} — two graphics in a row "
                        f"(min_graphic_gap_s {gap:g})")
            continue
        kept.append(item)
        last_end, last_name = float(item["end_s"]), str(item.get("component"))
    return kept
