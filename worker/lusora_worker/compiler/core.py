"""Compiler v1 (D5): beats + SRT/TTS timings + style pack -> strict edit plan.

Deterministic. AI never touches this: timings come from alignment, props
from anchors + catalog defaults, coordinates from geocoding. By
construction the output passes structural validation.
"""

from __future__ import annotations

import re
from typing import Any

import lusora_contracts

from ..errors import StageError
from ..textsplit import split_sentences
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
    # captions_enabled is read here, not in the caption block below: it decides
    # where a corner overlay is allowed to sit (see _avoid_caption_band)
    captions_enabled = bool((cfg.get("captions") or {}).get("enabled", True))
    overlays: list[dict[str, Any]] = []
    for b in timed_beats:
        item = _compile_overlay(
            b, float(b["timing"]["start_s"]), float(b["timing"]["end_s"]), captions_enabled
        )
        if item:
            overlays.append(item)
    for beat, (start, end, _s) in aligned:
        item = _compile_overlay(beat, start, end, captions_enabled)
        if item:
            overlays.append(item)
    overlays.sort(key=lambda o: o["start_s"])
    _trim_overlay_holds(overlays, total_end=vo_start + audio_duration_s)

    # ---- captions ----
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


_WORD_CHARS = re.compile(r"[^a-z0-9]")
_NUM_CHARS = re.compile(r"[^a-z0-9-]")
_DECADE_FORM = re.compile(r"^(\d+)s$")
_ALIGN_LOOKAHEAD = 6

_ONES = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6,
    "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12,
    "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60,
    "seventy": 70, "eighty": 80, "ninety": 90,
}
_DECADE_PLURALS = {
    "twenties": 20, "thirties": 30, "forties": 40, "fifties": 50,
    "sixties": 60, "seventies": 70, "eighties": 80, "nineties": 90,
}


def _norm_word(word: str) -> str:
    """Alignment-comparison form: only the letters/digits matter. Strips
    punctuation (period vs comma is an ASR punctuation choice, not a real
    divergence) and markdown emphasis (*Alcedo* -> alcedo)."""
    return _WORD_CHARS.sub("", word.lower())


def _parse_cardinal(parts: list[str]) -> int | None:
    """Sum hyphen-joined number-word parts ('forty', 'seven' -> 47). None
    if any part isn't a recognized ones/tens word — never guesses."""
    if not parts:
        return None
    total = 0
    for p in parts:
        if p in _ONES:
            total += _ONES[p]
        elif p in _TENS:
            total += _TENS[p]
        else:
            return None
    return total


def _number_canonical(word: str) -> str | None:
    """Digit-string form of a number, spoken or written ('fifty' and '50'
    both -> '50'; 'nineteen-fifties' and '1950s' both -> '1950s'). Only
    covers 0-99 and simple decade/century-decade compounds (documentary
    narration's actual range) — deliberately not a general number parser
    (no hundreds/thousands/ordinals). Returns None for anything else, so
    it only ever adds matches, never creates a false one."""
    w = _NUM_CHARS.sub("", word.lower())
    if w.isdigit() or _DECADE_FORM.match(w):
        return w
    parts = w.split("-")
    if len(parts) >= 2 and parts[-1] in _DECADE_PLURALS:
        century = _parse_cardinal(parts[:-1])
        if century is not None:
            return f"{century * 100 + _DECADE_PLURALS[parts[-1]]}s"
    if len(parts) == 1 and parts[0] in _DECADE_PLURALS:
        return f"{_DECADE_PLURALS[parts[0]]}s"
    value = _parse_cardinal(parts)
    return str(value) if value is not None else None


def _word_timeline(sentence_timings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Flatten SRT/TTS-timed chunks into per-word timing, evenly dividing
    each chunk's duration across its words. Whoever grouped these chunks
    (a TTS adapter, Whisper, or a hand-authored caption file) may have cut
    them at points that don't respect sentence boundaries — irrelevant
    once we're matching word by word."""
    out: list[dict[str, Any]] = []
    for item in sentence_timings:
        words = str(item.get("text", "")).split()
        n = len(words)
        if n == 0:
            continue
        start_s, end_s = float(item["start_s"]), float(item["end_s"])
        span = end_s - start_s
        for i, w in enumerate(words):
            norm = _norm_word(w)
            if not norm:
                continue
            out.append({
                "word": w,
                "norm": norm,
                "num": _number_canonical(w),
                "start_s": start_s + span * i / n,
                "end_s": start_s + span * (i + 1) / n,
            })
    return out


def _consume_word(
    timeline: list[dict[str, Any]], cursor: int, target: str, target_num: str | None
) -> tuple[int, dict[str, Any] | None]:
    """Find `target` at or shortly after cursor, tolerating a few stray
    narration words in between (ASR insertions/mishears). A number word
    also matches its digit form and vice versa ('fifty' <-> '50'). Returns
    the new cursor (past the match) and the matched timing, or (cursor,
    None)."""
    for p in range(cursor, min(cursor + 1 + _ALIGN_LOOKAHEAD, len(timeline))):
        tw = timeline[p]
        if tw["norm"] == target or (target_num is not None and tw["num"] == target_num):
            return p + 1, tw
    return cursor, None


def _align_beats(
    narration_beats: list[dict[str, Any]],
    sentence_timings: list[dict[str, Any]],
    vo_start: float,
) -> list[tuple[dict[str, Any], tuple[float, float, list[dict[str, Any]]]]]:
    """Match each beat's script_text (verbatim spans, in order) to
    word-level narration timing. Word-level, punctuation-insensitive, and
    tolerant of a few stray inserted words, because the narration text
    here (Whisper transcript, hand-authored captions, or TTS timings) is
    only ever a TIMING source — the script itself is the validated source
    of truth (beat-sheet.md). Returns (beat, (start, end, sentence_spans))
    in video time; sentence_spans lets _split_for_max_hold cut long beats
    at the beat's own internal sentence boundaries."""
    timeline = _word_timeline(sentence_timings)
    if not timeline:
        raise CompileError("no narration words found in the audio timing")

    result = []
    cursor = 0
    for beat in narration_beats:
        text = str(beat.get("script_text", "")).strip()
        if not text:
            raise CompileError(f"beat {beat.get('id')}: empty script_text")

        sentence_spans: list[dict[str, Any]] = []
        beat_first: dict[str, Any] | None = None
        beat_last: dict[str, Any] | None = None
        for sentence in split_sentences(text) or [text]:
            words = [w for w in sentence.split() if _norm_word(w)]
            if not words:
                continue
            sent_first: dict[str, Any] | None = None
            sent_last: dict[str, Any] | None = None
            for w in words:
                cursor, tw = _consume_word(timeline, cursor, _norm_word(w), _number_canonical(w))
                if tw is None:
                    near = min(cursor, len(timeline) - 1)
                    context = " ".join(t["word"] for t in timeline[near : near + 8])
                    raise CompileError(
                        f"beat {beat.get('id')}: script word {w!r} does not align with the "
                        f"narration near {timeline[near]['start_s']:.1f}s (narration says "
                        f"{context!r}) — beats must cover the script in order; check the audio "
                        "actually says this (numbers, names, wording), or fix subtitles.srt"
                    )
                sent_first = sent_first or tw
                sent_last = tw
            sentence_spans.append({"start_s": sent_first["start_s"], "end_s": sent_last["end_s"]})
            beat_first = beat_first or sent_first
            beat_last = sent_last

        if beat_first is None or beat_last is None:
            raise CompileError(f"beat {beat.get('id')}: no narration words matched its script_text")
        start = round(beat_first["start_s"] + vo_start, 3)
        end = round(beat_last["end_s"] + vo_start, 3)
        result.append((beat, (start, end, sentence_spans)))

    if cursor < len(timeline):
        leftover = " ".join(t["word"] for t in timeline[cursor : cursor + 8])
        raise CompileError(
            f"beats do not cover the whole narration — first uncovered words: {leftover!r}"
        )
    return result


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


_ANCHOR_INDEXED = re.compile(r"^([a-z_]+)\[(\d+)\]$")


def _anchor_field(anchor: dict[str, Any], ref: str) -> Any:
    """Resolve a catalog `from_anchor` reference against an anchor.

    Plain field name ("value", "label"), or one element of a list-valued field
    ("value[0]") for components taking one prop per compared item — a
    comparison anchor's value is a list, and ComparisonSplit wants its two
    entries as separate `left` / `right` props. Without this the LLM would have
    to retype the numbers, which is exactly what from_anchor exists to prevent.
    """
    match = _ANCHOR_INDEXED.match(ref)
    if match is None:
        return anchor.get(ref)
    field, index = match.group(1), int(match.group(2))
    seq = anchor.get(field)
    if isinstance(seq, list) and index < len(seq):
        return seq[index]
    return None


def _trim_overlay_holds(
    overlays: list[dict[str, Any]], total_end: float, gap: float = 0.2
) -> None:
    """Bound each overlay's hold, in place, on a start-sorted list.

    An overlay may cross a visual cut, but never another overlay: two graphics
    on screen at once is a mess, and at high density the next one is close.
    Floor of 0.5s keeps a squeezed overlay from collapsing to nothing.
    """
    for i, item in enumerate(overlays):
        ceiling = total_end
        if i + 1 < len(overlays):
            ceiling = min(ceiling, float(overlays[i + 1]["start_s"]) - gap)
        end = min(float(item["end_s"]), ceiling)
        item["end_s"] = round(max(end, float(item["start_s"]) + 0.5), 3)


# A caption sits in the bottom strip of the frame, so an overlay parked in a
# bottom corner lands on top of it. Where a component offers the same slot along
# the top edge, take it — deterministic placement, code's job not the AI's.
_ABOVE_THE_CAPTIONS = {
    "bottom_left": "top_left",
    "bottom_right": "top_right",
    "bottom_center": "top_center",
}


def _avoid_caption_band(entry: dict[str, Any], props: dict[str, Any]) -> None:
    """Move any bottom-edge enum choice to its top-edge twin, in place."""
    for prop_name, spec in entry["props"].items():
        choices = spec.get("enum")
        current = props.get(prop_name)
        if not choices or not isinstance(current, str):
            continue
        alternative = _ABOVE_THE_CAPTIONS.get(current)
        if alternative is not None and alternative in choices:
            props[prop_name] = alternative


def _compile_overlay(
    beat: dict[str, Any], start: float, end: float, captions_enabled: bool = False
) -> dict[str, Any] | None:
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
            value = _anchor_field(anchor, spec["from_anchor"])
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

    # geocode_stops runs AFTER the loop above, not inside it: the list itself
    # comes from the LLM (it names the places), so the prop is already present
    # and the loop skips it — only the coordinates are ours to fill.
    for prop_name, spec in entry["props"].items():
        if spec.get("computed") != "geocode_stops":
            continue
        stops = props.get(prop_name)
        if not isinstance(stops, list):
            raise CompileError(f"beat {beat['id']}: {name}.{prop_name} must be a list of places")
        for stop in stops:
            if not isinstance(stop, dict):
                raise CompileError(f"beat {beat['id']}: {name}.{prop_name} entries must be objects")
            if stop.get("lat") is not None and stop.get("lng") is not None:
                continue
            coords = geo.lookup(str(stop.get("name", "")))
            if coords is None:
                raise CompileError(
                    f"beat {beat['id']}: cannot geocode stop '{stop.get('name')}' for {name} — "
                    "add it to the gazetteer or change the beat"
                )
            stop["lat"], stop["lng"] = coords

    if captions_enabled:
        _avoid_caption_band(entry, props)

    missing = [p for p, s in entry["props"].items() if s.get("required") and p not in props]
    if missing:
        raise CompileError(f"beat {beat['id']}: {name} missing required props {missing}")

    hint = entry.get("duration_hint_s") or {}
    want = float(hint.get("default", 4.0))
    minimum = float(hint.get("min", 1.0))
    o_start = round(start + 0.4, 3)
    # An overlay is NOT bound to its beat's cut — graphics routinely hold across
    # one, and editors expect that. Clamping the end to the beat (as this used to)
    # silently starved every component at fast pacing: a 1.4s beat gave a
    # DefinitionCard 1.3s on screen, well under the 3s the catalog says it needs
    # to be readable. Hold for the catalog's own duration; compile_plan then
    # trims against the next overlay and the end of the video.
    o_end = round(o_start + max(want, minimum), 3)
    item: dict[str, Any] = {
        "id": f"o_{beat['id']}",
        "beat_id": str(beat["id"]),
        "locked": False,
        "kind": "component",
        "component": name,
        "props": props,
        "start_s": o_start,
        "end_s": max(o_end, o_start + 0.5),
    }
    # Template-backed entries have no React component; copy the kind into the
    # plan so the renderer draws them without reading the catalog.
    if entry.get("template"):
        item["template"] = entry["template"]
    return item
