"""Compiler v1 (D5): beats + SRT/TTS timings + style pack -> strict edit plan.

Deterministic. AI never touches this: timings come from alignment, props
from anchors + catalog defaults, coordinates from geocoding. By
construction the output passes structural validation.
"""

from __future__ import annotations

from typing import Any

import lusora_contracts

from ..errors import StageError
from ..textsplit import normalize, split_sentences
from . import geo

STAGE = "compile_plan"


class CompileError(StageError):
    def __init__(self, reason: str) -> None:
        super().__init__(STAGE, reason)


def compile_plan(
    beats_doc: dict[str, Any],
    sentence_timings: list[dict[str, Any]],
    cfg: dict[str, Any],
    audio_duration_s: float,
) -> dict[str, Any]:
    """sentence_timings: [{text, start_s, end_s}] in audio time (from the
    TTS adapter or the SRT), covering the whole narration in order."""

    style = cfg.get("style_pack_doc") or {}
    pacing = style.get("pacing") or {}
    min_hold = float(pacing.get("min_hold", 2.0))
    max_hold = float(pacing.get("max_hold", 10.0))
    transitions = style.get("transitions") or {}
    default_transition = str(transitions.get("default", "cut"))
    allowed_transitions = list(transitions.get("allowed", ["cut"]))
    if default_transition not in allowed_transitions:
        raise CompileError(
            f"style pack default transition '{default_transition}' is not in allowed {allowed_transitions}"
        )
    output = cfg.get("output") or {}

    beats: list[dict[str, Any]] = beats_doc.get("beats") or []
    narration_beats = [b for b in beats if b.get("kind") == "narration"]
    timed_beats = [b for b in beats if b.get("kind") == "timed"]

    # ---- narration offset: leading timed beats delay the voiceover ----
    leading_end = 0.0
    for b in timed_beats:
        t = b.get("timing") or {}
        if float(t.get("start_s", 0)) < leading_end + 1e-6 or not narration_beats:
            leading_end = max(leading_end, float(t.get("end_s", 0)))
        else:
            raise CompileError(
                f"timed beat {b.get('id')} starts at {t.get('start_s')}s inside the narration envelope — "
                "v1 supports timed beats only before narration starts (OQ-8)"
            )
    vo_start = round(leading_end, 3)

    # ---- align narration beats to sentence timings ----
    aligned = _align_beats(narration_beats, sentence_timings, vo_start)

    # ---- visual track ----
    visual: list[dict[str, Any]] = []
    for b in timed_beats:
        t = b["timing"]
        visual.append(_visual_item(
            item_id=f"v_{b['id']}",
            beat=b,
            start=float(t["start_s"]),
            end=float(t["end_s"]),
            transition=default_transition,
        ))

    for beat, (start, end, beat_sentences) in aligned:
        spans = _split_for_max_hold(start, end, beat_sentences, min_hold, max_hold)
        for j, (s0, s1) in enumerate(spans):
            visual.append(_visual_item(
                item_id=f"v_{beat['id']}" + (f"_{j}" if len(spans) > 1 else ""),
                beat=beat,
                start=s0,
                end=s1,
                transition=default_transition,
            ))

    visual.sort(key=lambda v: v["start_s"])
    _make_contiguous(visual, total_end=vo_start + audio_duration_s)

    # ---- overlays ----
    overlays: list[dict[str, Any]] = []
    for b in timed_beats:
        item = _compile_overlay(b, float(b["timing"]["start_s"]), float(b["timing"]["end_s"]))
        if item:
            overlays.append(item)
    for beat, (start, end, _s) in aligned:
        item = _compile_overlay(beat, start, end)
        if item:
            overlays.append(item)

    # ---- captions ----
    captions_enabled = bool((cfg.get("captions") or {}).get("enabled", True))
    theme = cfg.get("theme_doc") or {}
    preset = str(((theme.get("typography") or {}).get("caption_preset")) or "plain")
    caption_items = [
        {
            "start_s": round(t["start_s"] + vo_start, 3),
            "end_s": round(t["end_s"] + vo_start, 3),
            "text": t["text"],
        }
        for t in sentence_timings
    ]

    plan: dict[str, Any] = {
        "version": "1.0",
        "video_id": str(beats_doc.get("video_id", "")),
        "fps": int(output.get("fps", 30)),
        "resolution": {
            "width": int(output.get("width", 1920)),
            "height": int(output.get("height", 1080)),
        },
        "tracks": {
            "visual": visual,
            "overlays": overlays,
            "captions": {"enabled": captions_enabled, "preset": preset, "items": caption_items},
            "audio": {
                "voiceover": {
                    "path": "audio.mp3",
                    "start_s": vo_start,
                    "duration_s": round(audio_duration_s, 3),
                    "volume": 1,
                }
            },
        },
    }
    return plan


# ---------------- helpers ----------------


def _align_beats(
    narration_beats: list[dict[str, Any]],
    sentence_timings: list[dict[str, Any]],
    vo_start: float,
) -> list[tuple[dict[str, Any], tuple[float, float, list[dict[str, Any]]]]]:
    """Match each beat's script_text (verbatim spans, in order) to the
    sentence timings. Returns (beat, (start, end, sentences)) in video time."""
    result = []
    cursor = 0
    for beat in narration_beats:
        span_norm = normalize(str(beat.get("script_text", "")))
        if not span_norm:
            raise CompileError(f"beat {beat.get('id')}: empty script_text")
        matched: list[dict[str, Any]] = []
        acc = ""
        i = cursor
        while i < len(sentence_timings):
            sent = sentence_timings[i]
            candidate = normalize((acc + " " + sent["text"]).strip())
            if span_norm.startswith(candidate) or candidate.startswith(span_norm) or _covers(span_norm, candidate):
                matched.append(sent)
                acc = (acc + " " + sent["text"]).strip()
                i += 1
                if len(normalize(acc)) >= len(span_norm):
                    break
            else:
                if matched:
                    break
                # allow the beat span to start mid-timeline only if sentences were consumed by previous beats
                raise CompileError(
                    f"beat {beat.get('id')}: script_text does not align with the narration at "
                    f"sentence {i} ({sent['text'][:60]!r}) — beats must cover the script in order"
                )
        if not matched:
            raise CompileError(f"beat {beat.get('id')}: no narration sentences matched its script_text")
        cursor = i
        start = round(matched[0]["start_s"] + vo_start, 3)
        end = round(matched[-1]["end_s"] + vo_start, 3)
        result.append((beat, (start, end, matched)))
    if cursor < len(sentence_timings):
        leftover = sentence_timings[cursor]["text"][:60]
        raise CompileError(
            f"beats do not cover the whole narration — first uncovered sentence: {leftover!r}"
        )
    return result


def _covers(span: str, candidate: str) -> bool:
    return abs(len(span) - len(candidate)) <= 3 and span[: len(candidate)] == candidate[: len(span)]


def _split_for_max_hold(
    start: float,
    end: float,
    sentences: list[dict[str, Any]],
    min_hold: float,
    max_hold: float,
) -> list[tuple[float, float]]:
    """Split a beat's span at sentence boundaries so every visual item is
    <= max_hold (and >= min_hold where possible)."""
    if end - start <= max_hold:
        return [(start, end)]
    vo_shift = start - sentences[0]["start_s"]
    spans: list[tuple[float, float]] = []
    seg_start = start
    for i, sent in enumerate(sentences):
        sent_end = sent["end_s"] + vo_shift
        is_last = i == len(sentences) - 1
        if is_last:
            spans.append((round(seg_start, 3), round(end, 3)))
        elif sent_end - seg_start >= max_hold or (
            sent_end - seg_start >= min_hold
            and (sentences[i + 1]["end_s"] + vo_shift) - seg_start > max_hold
        ):
            spans.append((round(seg_start, 3), round(sent_end, 3)))
            seg_start = sent_end
    # merge a too-short tail into its predecessor
    if len(spans) >= 2 and spans[-1][1] - spans[-1][0] < min_hold:
        prev = spans[-2]
        spans[-2:] = [(prev[0], spans[-1][1])]
    return spans


def _make_contiguous(visual: list[dict[str, Any]], total_end: float) -> None:
    """Snap items into a contiguous, non-overlapping track starting at 0."""
    if not visual:
        raise CompileError("no visual items produced — the beat sheet is empty")
    visual[0]["start_s"] = 0.0
    for i in range(1, len(visual)):
        prev, cur = visual[i - 1], visual[i]
        gap = cur["start_s"] - prev["end_s"]
        if abs(gap) > 0.75:
            raise CompileError(
                f"visual items {prev['id']} and {cur['id']} leave a {gap:.2f}s gap/overlap — "
                "beat timings are inconsistent"
            )
        cur["start_s"] = prev["end_s"]
        if cur["end_s"] <= cur["start_s"]:
            raise CompileError(f"visual item {cur['id']} has non-positive duration after snapping")
    visual[-1]["end_s"] = round(max(total_end, visual[-1]["start_s"] + 0.5), 3)


def _visual_item(
    item_id: str, beat: dict[str, Any], start: float, end: float, transition: str
) -> dict[str, Any]:
    pref = str(beat.get("media_preference") or "any")
    media_type = "video" if pref == "video" else "image"
    item: dict[str, Any] = {
        "id": item_id,
        "beat_id": str(beat["id"]),
        "locked": False,
        "start_s": round(start, 3),
        "end_s": round(end, 3),
        "media_type": media_type,
        "asset": {"source": "manual", "path": ""},  # filled by resolve_assets
        "mute": True,
        "transition_out": {"type": transition, "duration_s": 0.5 if transition != "cut" else 0.1},
    }
    if media_type == "image":
        item["motion"] = {"type": "ken_burns", "direction": "in", "pan": "center", "strength": 0.12}
    return item


def _compile_overlay(beat: dict[str, Any], start: float, end: float) -> dict[str, Any] | None:
    overlay = beat.get("overlay")
    if not overlay:
        return None
    name = str(overlay.get("component", ""))
    entry = lusora_contracts.catalog_component(name)
    if entry is None:
        raise CompileError(f"beat {beat['id']}: overlay component '{name}' is not in the catalog")

    anchors = beat.get("anchors") or []
    anchor = None
    if overlay.get("anchor_ref") is not None:
        ref = int(overlay["anchor_ref"])
        if ref >= len(anchors):
            raise CompileError(f"beat {beat['id']}: overlay anchor_ref {ref} out of range")
        anchor = anchors[ref]
    if entry["anchor_types"] and anchor is None:
        raise CompileError(
            f"beat {beat['id']}: component {name} requires an anchor of type {entry['anchor_types']}"
        )
    if anchor is not None and entry["anchor_types"] and anchor.get("type") not in entry["anchor_types"]:
        raise CompileError(
            f"beat {beat['id']}: component {name} cannot attach to anchor type '{anchor.get('type')}'"
        )

    # props: hint -> from_anchor fills -> defaults -> computed (geocode)
    props: dict[str, Any] = dict(overlay.get("props_hint") or {})
    for prop_name, spec in entry["props"].items():
        if prop_name in props:
            continue
        if anchor is not None and spec.get("from_anchor"):
            value = anchor.get(spec["from_anchor"])
            if value is not None:
                props[prop_name] = value
                continue
        if spec.get("computed") == "geocode":
            place = props.get("place_name") or (anchor.get("value") if anchor else None)
            coords = geo.lookup(str(place)) if place else None
            if coords is None:
                raise CompileError(
                    f"beat {beat['id']}: cannot geocode place '{place}' for {name} — "
                    "add it to the gazetteer or change the beat"
                )
            props["lat"], props["lng"] = coords
            continue
        if "default" in spec:
            props[prop_name] = spec["default"]
    if anchor is not None and "label" in entry["props"] and "label" not in props and anchor.get("label"):
        props["label"] = anchor["label"]

    missing = [p for p, s in entry["props"].items() if s.get("required") and p not in props]
    if missing:
        raise CompileError(f"beat {beat['id']}: {name} missing required props {missing}")

    hint = entry.get("duration_hint_s") or {}
    want = float(hint.get("default", 4.0))
    o_start = round(start + 0.4, 3)
    o_end = round(min(end, o_start + want), 3)
    if o_end - o_start < float(hint.get("min", 1.0)):
        o_end = round(min(end, o_start + float(hint.get("min", 1.0))), 3)
    return {
        "id": f"o_{beat['id']}",
        "beat_id": str(beat["id"]),
        "locked": False,
        "kind": "component",
        "component": name,
        "props": props,
        "start_s": o_start,
        "end_s": max(o_end, o_start + 0.5),
    }
