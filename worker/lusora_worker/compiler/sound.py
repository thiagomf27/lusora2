"""Sound compilation (D48): cues, mood beds and ducking, all as arithmetic.

Three jobs, all deterministic, all here rather than in a renderer:

  compile_sfx     overlays + transitions -> sfx items, density-governed
  compile_music   beat moods -> background bed spans
  duck_envelope   real sentence timings -> a gain curve under each bed

Why compile time and not render time: the plan is the truth (Principle 1-ish —
the folder holds what must be produced). A cue placed here is addressable by the
editor, survives a per-beat recompile under the D14 lock rules, and mixes
identically on both render paths. A cue resolved inside the Remotion composition
would be none of those, and the ffmpeg path could not see it at all.

Why no sidechain compressor: the TTS adapters already emit exact per-sentence
timings, so ducking is a curve we can COMPUTE. A compressor would be
nondeterministic, would sound different on the two paths, and would be invisible
in the plan. Code does arithmetic (Core Principle 3).

The AI never reaches any of this. Its only contribution is `mood` per beat.
"""

from __future__ import annotations

import math
from typing import Any

import lusora_contracts

from ..errors import StageError

STAGE = "compile_plan"

# Mirrors PANEL_ENTRANCES / TEXT_ENTRANCES in engine/src/themes/entrance.ts.
PANEL_ENTRANCES = ("fade", "rise", "slide", "pop", "wipe")
TEXT_ENTRANCES = (*PANEL_ENTRANCES, "typewriter")

# Mirrors motionScale() in engine/src/themes/runtime.ts.
_DURATION_MUL = {"slow_heavy": 1.4, "neutral": 1.0, "fast_light": 0.7}

# Mirrors the useEntrance default when a component passes no `seconds`.
_DEFAULT_ENTRANCE_SECONDS = 0.45

# Absolute levels applied to the pack's files, mirroring theme.schema.json.
# Tuned against the shipped packs (beds normalized to -24 LUFS, cues to -18) so
# a bed sits ~18 dB under narration and lifts to ~8 dB under it in a gap. Get
# these wrong in the quiet direction and the music is simply never heard.
_DEFAULT_GAIN = {"sfx": 0.35, "music_duck": 0.16, "music_lift": 0.5}

# Ducking ramp lengths. Asymmetric on purpose: the bed falls back under speech
# BEFORE the sentence starts (so the first syllable is never fighting it) and
# rises more gently after it ends.
_LIFT_RAMP_S = 0.35
_DUCK_RAMP_S = 0.25

# A gap shorter than this is a breath, not a hole — lifting into it produces a
# pumping bed rather than a score.
_MIN_LIFT_GAP_S = 1.2

# Schema cap (edit_plan gainEnvelope.maxItems). Coarsen rather than overflow.
_MAX_ENVELOPE_POINTS = 200


class SoundError(StageError):
    def __init__(self, reason: str) -> None:
        super().__init__(STAGE, reason)


# ---------------- theme mirrors ----------------


def motion_duration_mul(theme: dict[str, Any]) -> float:
    """Mirror of motionScale().durationMul."""
    return _DURATION_MUL.get(str(theme.get("motion_feel") or "neutral"), 1.0)


def entrance_for(
    theme: dict[str, Any], component: str, supported: tuple[str, ...]
) -> str | None:
    """Which entrance this component will actually play — or None.

    Mirror of entranceFor() in engine/src/themes/runtime.ts, with one honest
    difference: that function falls back to the entrance the component hardcoded,
    which lives in TSX and is not in the catalog. When the theme expresses no
    preference we return None, meaning "the component's own choice, unknown
    here". Callers then use the theme's generic cue rather than guessing a kind.

    Every case the THEME controls is resolved exactly, which is the same set of
    cases in which the theme also controls the sound.
    """
    motion = theme.get("motion") or {}
    wanted = (motion.get("per_component") or {}).get(component) or motion.get("entrance")
    if not wanted:
        return None
    return wanted if wanted in supported else "fade"


def entrance_window(entry: dict[str, Any], theme: dict[str, Any]) -> float:
    """How long the entrance runs, in seconds, after motion_feel scaling.

    This is what lets a typing cue span exactly the typewriter reveal instead of
    approximately it: useEntrance computes `fps * seconds * durationMul`, and
    both factors are declared data (catalog `entrance_seconds`, theme
    `motion_feel`).
    """
    seconds = float(entry.get("entrance_seconds", _DEFAULT_ENTRANCE_SECONDS))
    return seconds * motion_duration_mul(theme)


def _supported_entrances(entry: dict[str, Any]) -> tuple[str, ...]:
    return TEXT_ENTRANCES if entry.get("entrance_support") == "text" else PANEL_ENTRANCES


# ---------------- config plumbing ----------------


def _gain(theme: dict[str, Any], key: str) -> float:
    gains = (theme.get("sound") or {}).get("gain") or {}
    return float(gains.get(key, _DEFAULT_GAIN[key]))


def sound_enabled(cfg: dict[str, Any], kind: str) -> bool:
    """Whether `kind` ("sfx" or "music") may produce anything for this video.

    The channel's master switch wins over everything: a channel with sfx off
    stays silent no matter what its theme and style pack say. Per-video
    overrides ride the same field through the enqueue deep-merge, so turning
    sound off for one video needs no code.
    """
    policy = (cfg.get("source_policy") or {}).get(kind) or {}
    if not bool(policy.get("enabled", True)):
        return False
    style = (cfg.get("style_pack_doc") or {}).get(kind) or {}
    return bool(style.get("enabled", True))


def _pack(cfg: dict[str, Any]) -> dict[str, Any]:
    return cfg.get("sound_pack_doc") or {}


def _cue(cfg: dict[str, Any], name: str | None) -> tuple[str, dict[str, Any]] | None:
    """Resolve a cue name against the snapshotted pack. "none" silences."""
    if not name or name == "none":
        return None
    cue = (_pack(cfg).get("cues") or {}).get(name)
    if cue is None:
        raise SoundError(
            f"theme names cue '{name}' but sound pack "
            f"'{_pack(cfg).get('name', '?')}' does not define it"
        )
    return name, cue


# ---------------- sfx ----------------


def _cue_for_overlay(cfg: dict[str, Any], component: str) -> tuple[str, dict[str, Any]] | None:
    """per_component override -> per_entrance (when the kind is known) -> default."""
    theme = cfg.get("theme_doc") or {}
    theme_sound = theme.get("sound") or {}

    per_component = (theme_sound.get("per_component") or {}).get(component)
    if per_component is not None:
        return _cue(cfg, per_component)

    entry = lusora_contracts.catalog_component(component)
    if entry is not None:
        kind = entrance_for(theme, component, _supported_entrances(entry))
        if kind is not None:
            by_kind = (theme_sound.get("per_entrance") or {}).get(kind)
            if by_kind is not None:
                return _cue(cfg, by_kind)

    return _cue(cfg, theme_sound.get("entrance"))


def _sfx_item(
    item_id: str,
    cue_name: str,
    cue: dict[str, Any],
    at_s: float,
    *,
    origin: str,
    origin_id: str | None,
    beat_id: str | None,
    base_gain: float,
    window_s: float | None = None,
) -> dict[str, Any]:
    """One cue on the timeline.

    `at_s` is when the VISUAL happens; `lead_s` pulls the sound earlier so its
    transient lands on the visual instead of starting there. A cue can never be
    dragged before 0 — a cold open with a lead would otherwise produce a
    negative start the schema rejects.
    """
    lead = float(cue.get("lead_s", 0.0))
    start = max(round(at_s - lead, 3), 0.0)

    if cue.get("kind") == "loop" and window_s:
        # a loop fills the window it was given (a typing bed under a typewriter
        # reveal), plus the lead it was pulled back by
        end = start + lead + window_s
    else:
        end = start + float(cue["duration_s"])

    item: dict[str, Any] = {
        "id": item_id,
        "beat_id": beat_id,
        "locked": False,
        "start_s": start,
        "end_s": round(max(end, start + 0.05), 3),
        "path": f"audio/{cue_name}.mp3",
        "gain": round(base_gain * float(cue.get("gain", 1.0)), 4),
        "cue": cue_name,
        "origin": origin,
        "origin_id": origin_id,
    }
    if cue.get("kind") == "loop":
        item["loop"] = True
    if cue.get("fade_out_s"):
        item["fade_out_s"] = float(cue["fade_out_s"])
    return item


def compile_sfx(
    overlays: list[dict[str, Any]],
    visual: list[dict[str, Any]],
    cfg: dict[str, Any],
    total_duration_s: float,
) -> list[dict[str, Any]]:
    """Place cues against overlay entrances and transitions, then thin them."""
    if not sound_enabled(cfg, "sfx") or not _pack(cfg):
        return []

    theme = cfg.get("theme_doc") or {}
    style_sfx = (cfg.get("style_pack_doc") or {}).get("sfx") or {}
    allowed = set(style_sfx.get("cues") or ["entrance"])
    base_gain = _gain(theme, "sfx")
    default_gain = ((cfg.get("source_policy") or {}).get("sfx") or {}).get("default_gain")
    if default_gain is not None:
        base_gain = float(default_gain)

    candidates: list[dict[str, Any]] = []

    if "entrance" in allowed:
        for overlay in overlays:
            component = overlay.get("component")
            if not component:
                continue  # media overlays are a PiP box, not an event
            resolved = _cue_for_overlay(cfg, str(component))
            if resolved is None:
                continue
            cue_name, cue = resolved
            entry = lusora_contracts.catalog_component(str(component))
            window = entrance_window(entry, theme) if entry else _DEFAULT_ENTRANCE_SECONDS
            candidates.append(
                _sfx_item(
                    f"s_{overlay['id']}",
                    cue_name,
                    cue,
                    float(overlay["start_s"]),
                    origin="overlay",
                    origin_id=str(overlay["id"]),
                    beat_id=overlay.get("beat_id"),
                    base_gain=base_gain,
                    window_s=window,
                )
            )

    if "transition" in allowed:
        resolved = _cue(cfg, ((theme.get("sound") or {}).get("transition")))
        if resolved is not None:
            cue_name, cue = resolved
            for item in visual:
                transition = item.get("transition_out") or {}
                if not transition or transition.get("type") == "cut":
                    continue  # a cut is not an event you can hear
                candidates.append(
                    _sfx_item(
                        f"s_t_{item['id']}",
                        cue_name,
                        cue,
                        float(item["end_s"]),
                        origin="transition",
                        origin_id=str(item["id"]),
                        beat_id=item.get("beat_id"),
                        base_gain=base_gain,
                    )
                )

    kept = _thin_sfx(candidates, style_sfx, total_duration_s, _pack(cfg))
    for item in kept:
        item["end_s"] = round(min(item["end_s"], total_duration_s), 3)
    return [i for i in kept if i["end_s"] > i["start_s"]]


def _priority(item: dict[str, Any], pack: dict[str, Any]) -> int:
    cue = (pack.get("cues") or {}).get(item.get("cue"), {})
    return int(cue.get("priority", 0))


def _thin_sfx(
    candidates: list[dict[str, Any]],
    style_sfx: dict[str, Any],
    total_duration_s: float,
    pack: dict[str, Any],
) -> list[dict[str, Any]]:
    """Enforce min_gap_s, then the per-minute budget.

    This is the difference between sound design and a video that beeps. At a 4 s
    hold, a cue per overlay is ~15/minute; the default budget is 4. Both rules
    are re-checked by the validator (belt and suspenders, like overlays.density).
    """
    if not candidates:
        return []
    min_gap = float(style_sfx.get("min_gap_s", 1.2))
    max_per_minute = float(style_sfx.get("max_per_minute", 4))

    ordered = sorted(candidates, key=lambda i: (i["start_s"], i["id"]))

    # 1. spacing — on a collision the higher-priority cue survives, so a
    #    thud under a big number beats a swoosh under a label next to it
    kept: list[dict[str, Any]] = []
    for item in ordered:
        if kept and item["start_s"] - kept[-1]["start_s"] < min_gap:
            if _priority(item, pack) > _priority(kept[-1], pack):
                kept[-1] = item
            continue
        kept.append(item)

    # 2. budget — same global-budget shape the overlay density check uses
    budget = math.ceil(max_per_minute * total_duration_s / 60)
    if len(kept) > budget:
        # drop the lowest-priority cues; ties break toward keeping the earlier
        # one, so the opening of a video keeps its punctuation
        ranked = sorted(kept, key=lambda i: (-_priority(i, pack), i["start_s"]))
        keep_ids = {i["id"] for i in ranked[:budget]}
        kept = [i for i in kept if i["id"] in keep_ids]

    return kept


# ---------------- music ----------------


def normalize_mood(value: Any) -> str:
    """Unknown moods degrade to neutral.

    Deliberately not a validation failure: a planner that writes "ominous"
    instead of "tense" has made a reasonable choice of word, and failing a whole
    video over vocabulary would be absurd.
    """
    mood = str(value or "").strip().lower()
    return mood if mood in lusora_contracts.MOODS else "neutral"


def mood_spans(
    beat_times: list[tuple[float, float, str]], min_span_s: float
) -> list[tuple[float, float, str]]:
    """Contiguous beats of one mood become one span; short runs are absorbed.

    Without the floor, a two-beat mood blip restarts the bed and the score turns
    chatty — which reads as a mistake, not as intent.

    Each span carries a WEIGHT: how much time its own mood actually covers. On
    a merge the heavier mood is what survives, and its weight does not grow by
    swallowing a different mood. Using the merged span's LENGTH instead would
    be wrong in the common case of a video too short for any run to clear the
    floor: everything cascades into one span, and the label would be whichever
    mood happened to be absorbed last rather than the one the video is mostly
    about. A 16 s clip that is four beats tense and one beat triumphant scores
    as tense.
    """
    if not beat_times:
        return []

    # [start, end, mood, weight]
    spans: list[list[Any]] = []
    for start, end, mood in sorted(beat_times, key=lambda b: b[0]):
        if spans and spans[-1][2] == mood:
            spans[-1][1] = max(spans[-1][1], end)
            spans[-1][3] += end - start
        else:
            spans.append([start, end, mood, end - start])

    # absorb short runs, repeatedly: merging two neighbours can leave a third
    # run adjacent to its own twin
    changed = True
    while changed and len(spans) > 1:
        changed = False
        for i, span in enumerate(spans):
            if span[1] - span[0] >= min_span_s:
                continue
            prev_w = spans[i - 1][3] if i > 0 else -1.0
            next_w = spans[i + 1][3] if i + 1 < len(spans) else -1.0
            target = i - 1 if prev_w >= next_w else i + 1
            keep = span if span[3] > spans[target][3] else spans[target]
            spans[target] = [
                min(spans[target][0], span[0]),
                max(spans[target][1], span[1]),
                keep[2],
                keep[3],
            ]
            spans.pop(i)
            changed = True
            break

    # a same-mood pair can end up adjacent after absorption
    merged: list[list[Any]] = []
    for span in spans:
        if merged and merged[-1][2] == span[2]:
            merged[-1][1] = max(merged[-1][1], span[1])
            merged[-1][3] += span[3]
        else:
            merged.append(list(span))

    return [(round(s, 3), round(e, 3), m) for s, e, m, _w in merged]


def compile_music(
    beat_times: list[tuple[float, float, str]],
    sentence_timings: list[dict[str, Any]],
    cfg: dict[str, Any],
    total_duration_s: float,
) -> list[dict[str, Any]]:
    """One bed per mood span, ducked against the real narration."""
    if not sound_enabled(cfg, "music") or not _pack(cfg):
        return []

    theme = cfg.get("theme_doc") or {}
    sound = theme.get("sound") or {}
    mood_beds = sound.get("mood_beds") or {}
    if not mood_beds:
        return []

    style_music = (cfg.get("style_pack_doc") or {}).get("music") or {}
    min_span = float(style_music.get("min_span_s", 20))
    crossfade = float(style_music.get("crossfade_s", 1.5))

    policy = (cfg.get("source_policy") or {}).get("music") or {}
    # A TRIM, not the level: the levels are the theme's music_duck/music_lift,
    # carried in the envelope. Multiplying an absolute level by a second
    # absolute level is what buries a bed 40 dB under the voice.
    trim = float(policy.get("default_volume", 1.0))

    beds = _pack(cfg).get("beds") or {}
    duck = _gain(theme, "music_duck")
    lift = _gain(theme, "music_lift")

    out: list[dict[str, Any]] = []
    for index, (start, end, mood) in enumerate(mood_spans(beat_times, min_span)):
        bed_name = mood_beds.get(mood)
        if not bed_name or bed_name == "none":
            continue  # silence under this span is a legitimate choice
        bed = beds.get(bed_name)
        if bed is None:
            raise SoundError(
                f"theme maps mood '{mood}' to bed '{bed_name}' but sound pack "
                f"'{_pack(cfg).get('name', '?')}' does not define it"
            )

        # spans overlap by the crossfade so the beds cross rather than gap
        span_end = min(end + crossfade, total_duration_s)
        if not bool(bed.get("loopable", True)):
            span_end = min(span_end, start + float(bed["duration_s"]))
        if span_end - start < 1.0:
            continue

        item = {
            "id": f"m_{index}_{mood}",
            "path": f"audio/{bed_name}.mp3",
            "start_s": round(start, 3),
            "end_s": round(span_end, 3),
            "volume": round(trim * float(bed.get("gain", 1.0)), 4),
            "loop": bool(bed.get("loopable", True)),
            "fade_in_s": crossfade,
            "fade_out_s": crossfade,
            "mood": mood,
        }
        envelope = duck_envelope(sentence_timings, start, span_end, duck, lift)
        if envelope:
            item["gain_envelope"] = envelope
        out.append(item)

    return out


# ---------------- ducking ----------------


def duck_envelope(
    sentence_timings: list[dict[str, Any]],
    span_start: float,
    span_end: float,
    duck: float,
    lift: float,
) -> list[dict[str, Any]]:
    """A gain curve that sits under speech and rises into the silences.

    `sentence_timings` are absolute (already offset by the voiceover start). The
    output is piecewise-linear in absolute time, multiplied by `volume` at
    render. Both renderers read the same numbers, so both paths sound the same.
    """
    if span_end <= span_start or lift <= duck:
        return []

    speech = sorted(
        (
            (float(t["start_s"]), float(t["end_s"]))
            for t in sentence_timings
            if float(t["end_s"]) > span_start and float(t["start_s"]) < span_end
        ),
    )

    # gaps inside the span, including the head and tail
    gaps: list[tuple[float, float]] = []
    cursor = span_start
    for start, end in speech:
        if start - cursor >= _MIN_LIFT_GAP_S:
            gaps.append((cursor, start))
        cursor = max(cursor, end)
    if span_end - cursor >= _MIN_LIFT_GAP_S:
        gaps.append((cursor, span_end))

    if not gaps:
        return [
            {"t_s": round(span_start, 3), "gain": round(duck, 4)},
            {"t_s": round(span_end, 3), "gain": round(duck, 4)},
        ]

    # 4 points per gap plus the two span ends; drop the shortest gaps rather
    # than overflow the schema cap
    max_gaps = (_MAX_ENVELOPE_POINTS - 2) // 4
    if len(gaps) > max_gaps:
        gaps = sorted(sorted(gaps, key=lambda g: g[1] - g[0], reverse=True)[:max_gaps])

    points: list[dict[str, Any]] = [{"t_s": span_start, "gain": duck}]
    for gap_start, gap_end in gaps:
        length = gap_end - gap_start
        # ramps shrink to fit rather than overshoot into the next sentence
        up = min(_LIFT_RAMP_S, length * 0.4)
        down = min(_DUCK_RAMP_S, length * 0.4)
        points.append({"t_s": gap_start, "gain": duck})
        points.append({"t_s": gap_start + up, "gain": lift})
        points.append({"t_s": gap_end - down, "gain": lift})
        points.append({"t_s": gap_end, "gain": duck})
    points.append({"t_s": span_end, "gain": duck})

    # strictly increasing t_s: a gap starting exactly at the span start, or two
    # gaps meeting, would otherwise emit a duplicate the interpolators divide by
    cleaned: list[dict[str, Any]] = []
    for point in points:
        t = round(min(max(point["t_s"], span_start), span_end), 3)
        gain = round(min(max(point["gain"], 0.0), 1.0), 4)
        if cleaned and t <= cleaned[-1]["t_s"]:
            cleaned[-1]["gain"] = gain
            continue
        cleaned.append({"t_s": t, "gain": gain})

    return cleaned if len(cleaned) >= 2 else []
