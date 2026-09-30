"""Patch render (D120, documentary plan slice 12a): what to draw again when a
plan changes, and the engine call that draws only that.

`changed_spans` compares two plans; `patch_render` runs the engine's `patch`
command for them, or returns False when the change is not a patch — the
visual track was retimed, or the plan's frame, size or rate moved — so the
caller renders the whole video instead.
"""

from __future__ import annotations

import json
import subprocess
from typing import Any

from ..context import StageContext
from ..errors import StageError

# what a visual item draws; a change to any of these redraws its span
VISUAL_FIELDS = ("asset", "media_type", "motion", "transition_out", "grade", "crt", "focus_y")
# plan-level fields the whole render depends on
PLAN_FIELDS = ("fps", "resolution")

Span = tuple[float, float]


def _by_id(items: list[dict[str, Any]] | None) -> dict[str, dict[str, Any]]:
    return {str(i.get("id")): i for i in items or []}


def _span(item: dict[str, Any]) -> Span:
    return float(item["start_s"]), float(item["end_s"])


def changed_spans(old: dict[str, Any], new: dict[str, Any]) -> tuple[list[Span], bool]:
    """(plan-second spans to draw again, whether the audio must be remixed).

    A visual item counts when it was added or removed, or any of VISUAL_FIELDS
    differs; an overlay or a caption when any field differs — over BOTH its old
    and its new time, so a graphic that moved is cleared where it was. Audio
    changes when `tracks.audio` differs, or an overlay that changed carries an
    sfx cue (its `origin_id`) in either plan."""
    spans: list[Span] = []
    o_tracks, n_tracks = old.get("tracks") or {}, new.get("tracks") or {}

    old_v, new_v = _by_id(o_tracks.get("visual")), _by_id(n_tracks.get("visual"))
    for vid in old_v.keys() | new_v.keys():
        a, b = old_v.get(vid), new_v.get(vid)
        if a is None or b is None:
            spans.append(_span(a or b))
        elif any(a.get(f) != b.get(f) for f in VISUAL_FIELDS) or _span(a) != _span(b):
            spans += list({_span(a), _span(b)})

    changed_overlays: set[str] = set()
    old_o, new_o = _by_id(o_tracks.get("overlays")), _by_id(n_tracks.get("overlays"))
    for oid in old_o.keys() | new_o.keys():
        a, b = old_o.get(oid), new_o.get(oid)
        if a != b:
            spans += list({_span(x) for x in (a, b) if x is not None})
            changed_overlays.add(oid)

    # Caption items carry no id: an item in only one plan is drawn again at
    # its time; a changed style (enabled, preset) redraws every caption.
    o_cap, n_cap = o_tracks.get("captions") or {}, n_tracks.get("captions") or {}
    o_items, n_items = o_cap.get("items") or [], n_cap.get("items") or []
    style = lambda c: {k: v for k, v in c.items() if k != "items"}  # noqa: E731
    if style(o_cap) != style(n_cap):
        spans += [_span(i) for i in (*o_items, *n_items)]
    else:
        key = lambda i: json.dumps(i, sort_keys=True)  # noqa: E731
        o_keys, n_keys = {key(i) for i in o_items}, {key(i) for i in n_items}
        spans += [_span(i) for i in o_items if key(i) not in n_keys]
        spans += [_span(i) for i in n_items if key(i) not in o_keys]

    o_audio, n_audio = o_tracks.get("audio") or {}, n_tracks.get("audio") or {}
    cued = {str(s.get("origin_id")) for s in (o_audio.get("sfx") or []) + (n_audio.get("sfx") or [])}
    audio_changed = o_audio != n_audio or bool(changed_overlays & cued)
    return sorted(spans), audio_changed


def retimed(old: dict[str, Any], new: dict[str, Any]) -> bool:
    """True when the change is not a patch: the visual track's items or their
    timings moved, or a plan-level field the whole render depends on did."""
    if any(old.get(f) != new.get(f) for f in PLAN_FIELDS):
        return True
    shape = lambda p: [(str(v.get("id")), _span(v)) for v in (p.get("tracks") or {}).get("visual") or []]  # noqa: E731
    if shape(old) != shape(new):
        return True
    vo = lambda p: {k: ((p.get("tracks") or {}).get("audio") or {}).get("voiceover", {}).get(k)  # noqa: E731
                    for k in ("start_s", "duration_s")}
    return vo(old) != vo(new)


def _sec(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def patch_render(ctx: StageContext, old_plan: dict[str, Any], new_plan: dict[str, Any]) -> bool:
    """Bring `ctx.folder`'s final.mp4 from `old_plan` to `new_plan` by drawing
    only what changed. False — nothing touched — when the change is a retime
    and the caller must render the whole video; True when final.mp4 now shows
    `new_plan` (also when nothing visible changed). An engine failure raises,
    with edit_plan.json put back so the folder still describes its final.mp4."""
    if retimed(old_plan, new_plan):
        return False
    spans, audio_changed = changed_spans(old_plan, new_plan)
    ctx.write_json("edit_plan.json", new_plan)
    if not spans and not audio_changed:
        return True
    cli = ctx.config.engine_cli
    if not cli.exists():
        raise StageError("render", f"engine CLI not found at {cli} — set ENGINE_CLI")
    args = ["node", "--experimental-strip-types", str(cli), "patch",
            "--video-dir", str(ctx.folder),
            # fixed decimals, never :g — :g keeps 6 significant digits, so a
            # 20-minute video's 1234.567 s would be sent as 1234.57
            "--spans", ",".join(f"{_sec(s)}-{_sec(e)}" for s, e in spans),
            "--audio", "remix" if audio_changed else "keep",
            "--renderer", str(ctx.cfg.get("renderer") or "auto")]
    from .steps import render_slot  # a Remotion render sizes the machine either way

    with render_slot(ctx):
        proc = subprocess.run(args, capture_output=True, text=True, timeout=1800)
    if proc.returncode != 0:
        ctx.write_json("edit_plan.json", old_plan)
        reason = (proc.stderr or proc.stdout).strip().splitlines()
        raise StageError("render", f"patch failed: {reason[-1] if reason else 'no output'}")
    try:
        info = json.loads(proc.stdout.strip().splitlines()[-1])
        ctx.log(f"patched {info.get('patched')} ({info.get('audio')} audio)")
    except (json.JSONDecodeError, IndexError):
        ctx.log("patched (engine reported no JSON summary)")
    return True
