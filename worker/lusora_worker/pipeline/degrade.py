"""What to do when the sources come back with nothing good (D55).

Two failures the resolver used to hide:

  weak match   the chain's best answer scored 0.31 — technically an asset,
               visibly unrelated. It was placed anyway, because a score below
               a source's own `min_score` falls through but a score above it
               is accepted whatever it is.
  short clip   the footage is 3s and the beat holds 7s. Both renderers froze
               on the last frame, which reads as a stall, not as a shot.

Both are answered here rather than inside an adapter: they are judgements about
the RESULT of the whole chain, and the chain is what resolve_assets owns.
"""

from __future__ import annotations

import subprocess
from typing import Any

import lusora_contracts

from ..context import StageContext

# A card needs SOME words. These are the ones that carry no subject, so
# dropping them leaves the shot's noun standing.
_CARD_DROP = {"a", "an", "the", "of", "in", "on", "at", "to", "and", "or", "with"}


def source_score_floor(cfg: dict[str, Any]) -> float:
    return float((((cfg.get("source_policy") or {}).get("visual") or {}).get("min_score_floor")) or 0)


def short_clip_fallback(cfg: dict[str, Any]) -> list[str]:
    policy = ((cfg.get("source_policy") or {}).get("visual") or {})
    return [str(s) for s in (policy.get("short_clip_fallback") or ["loop", "freeze"])]


def probe_seconds(path: Any) -> float | None:
    """Source duration, or None when it cannot be read. Never raises: an
    unreadable probe means no OPINION about length, and `validate` is what
    judges whether the file is usable at all."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(proc.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return None


def apply_short_clip_policy(ctx: StageContext, item: dict[str, Any]) -> str | None:
    """Cover a slot longer than its footage. Returns the strategy applied.

    The fallback ORDER is config because the right answer is a channel's taste:
    a loop is invisible on a locked-off shot and obvious on a pan, a speed ramp
    is elegant at 0.8x and syrup at 0.3x, and a freeze is honest but cheap.
    """
    if item.get("media_type") != "video":
        return None
    path = str((item.get("asset") or {}).get("path") or "")
    if not path:
        return None
    source_s = probe_seconds(ctx.folder / path)
    slot_s = float(item["end_s"]) - float(item["start_s"])
    if source_s is None or source_s <= 0 or source_s >= slot_s - 0.05:
        return None

    for strategy in short_clip_fallback(ctx.cfg):
        if strategy == "loop":
            item["loop"] = True
            return "loop"
        if strategy == "slow":
            # Never below 0.5x: past that the motion stops reading as motion
            # and the shot looks broken rather than slow.
            speed = max(source_s / slot_s, 0.5)
            if speed >= 0.99:
                continue
            item["speed"] = round(speed, 3)
            return "slow"
        if strategy == "freeze":
            return None  # the renderers' own behaviour; nothing to write down
    return None


def card_text(beat: dict[str, Any], max_words: int) -> str:
    """The words for a fallback card, from the beat the shot was for.

    Its own keyword query first (v1.1 beats have one, written to be short and
    subject-first — exactly what a card wants), else the content words of the
    visual_intent. Title case, because this is a title."""
    source = str((beat.get("queries") or [None])[0] or beat.get("visual_intent") or "")
    words = [w.strip(".,;:!?\"'()") for w in source.split()]
    kept = [w for w in words if w and w.lower() not in _CARD_DROP][:max_words]
    return " ".join(w if w.isupper() or w[:1].isdigit() else w.capitalize() for w in kept)


def to_title_card(
    ctx: StageContext, plan: dict[str, Any], item: dict[str, Any], beat: dict[str, Any]
) -> str | None:
    """Replace a weak asset with a clean typographic card.

    A card that says what the beat is about is honest; a clip that is nearly
    unrelated is a lie the viewer notices and cannot name. The item becomes a
    plain colour fill (both renderers draw it with no file, which is why the
    validator lets a colour item carry no asset) and the theme's own card
    component is placed over it.

    Returns the component used, or None when the style pack names no card —
    in which case the weak clip stays, because a beat with nothing on it is
    worse than a beat with the wrong thing on it.
    """
    fallback = ((ctx.cfg.get("style_pack_doc") or {}).get("fallback")) or {}
    name = str(fallback.get("component") or "")
    if not name:
        return None
    entry = lusora_contracts.catalog_component(name)
    if entry is None:
        ctx.db.event(ctx.video_id, "resolve_assets", "progress",
                     f"style pack fallback component '{name}' is not in the catalog — keeping the weak asset")
        return None

    text_prop = str(fallback.get("text_prop") or "title")
    spec = entry["props"].get(text_prop)
    if spec is None:
        ctx.db.event(ctx.video_id, "resolve_assets", "progress",
                     f"fallback component '{name}' has no prop '{text_prop}' — keeping the weak asset")
        return None

    props: dict[str, Any] = {}
    for prop_name, prop_spec in entry["props"].items():
        if "default" in prop_spec:
            props[prop_name] = prop_spec["default"]
    props[text_prop] = card_text(beat, int(spec.get("maxWords") or 8))
    missing = [p for p, s in entry["props"].items() if s.get("required") and p not in props]
    if missing:
        ctx.db.event(ctx.video_id, "resolve_assets", "progress",
                     f"fallback component '{name}' needs props {missing} nothing can fill — keeping the weak asset")
        return None

    item["media_type"] = "color"
    item["asset"] = {"source": "manual", "path": ""}
    item.pop("motion", None)
    item.pop("loop", None)
    item.pop("speed", None)

    hint = entry.get("duration_hint_s") or {}
    start = round(float(item["start_s"]) + 0.2, 3)
    end = min(float(item["end_s"]), start + float(hint.get("default", 4.0)))
    overlay = {
        "id": f"o_{item['id']}_card",
        "beat_id": item.get("beat_id"),
        "locked": False,
        "kind": "component",
        "component": name,
        "props": props,
        "start_s": start,
        "end_s": round(max(end, start + float(hint.get("min", 1.0))), 3),
    }
    if entry.get("template"):
        overlay["template"] = entry["template"]

    overlays = plan["tracks"]["overlays"]
    overlays.append(overlay)
    overlays.sort(key=lambda o: float(o["start_s"]))
    _keep_apart(overlays)
    return name


def _keep_apart(overlays: list[dict[str, Any]], gap: float = 0.2) -> None:
    """Two graphics at once is a mess — the same rule the compiler applies when
    it lays overlays down (`_trim_overlay_holds`), reapplied because a card is
    inserted after that pass has run."""
    for i, item in enumerate(overlays[:-1]):
        ceiling = float(overlays[i + 1]["start_s"]) - gap
        item["end_s"] = round(max(min(float(item["end_s"]), ceiling), float(item["start_s"]) + 0.5), 3)
