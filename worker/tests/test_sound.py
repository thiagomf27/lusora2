"""Sound compilation (D48): cue placement, density, mood spans, ducking.

The entrance-mirror tests exist because `sound.entrance_for` duplicates
`entranceFor` in engine/src/themes/runtime.ts. Two implementations of one rule
drift silently; these cases are the same ones engine/test/themes.test.ts pins,
so a change on either side has to be made on both.
"""

import pytest

from lusora_worker.compiler import compile_plan, sound

PACK = {
    "name": "testpack",
    "license": "cc0",
    "cues": {
        "swoosh": {"file": "sfx/swoosh.mp3", "kind": "one_shot", "duration_s": 0.4, "lead_s": 0.06, "priority": 1},
        "thud": {"file": "sfx/thud.mp3", "kind": "one_shot", "duration_s": 0.5, "priority": 3},
        "typing": {"file": "sfx/typing.mp3", "kind": "loop", "duration_s": 1.6, "fade_out_s": 0.08},
    },
    "beds": {
        "neutral-01": {"file": "beds/neutral-01.mp3", "mood": "neutral", "duration_s": 48.0, "loopable": True},
        "tense-01": {"file": "beds/tense-01.mp3", "mood": "tense", "duration_s": 48.0, "loopable": True},
        "short-01": {"file": "beds/short-01.mp3", "mood": "somber", "duration_s": 5.0, "loopable": False},
    },
}


def cfg(**over):
    base = {
        "captions": {"enabled": True},
        "output": {"fps": 30, "width": 1280, "height": 720},
        "style_pack_doc": {
            "name": "test",
            "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 6.0},
            "overlays": {"density": "normal"},
            "transitions": {"allowed": ["cut", "crossfade"], "default": "crossfade"},
            "sfx": {"enabled": True, "cues": ["entrance"], "max_per_minute": 60, "min_gap_s": 0.0},
            "music": {"enabled": True, "min_span_s": 20, "crossfade_s": 1.5},
        },
        "theme_doc": {
            "typography": {"caption_preset": "plain"},
            "sound": {
                "entrance": "swoosh",
                "per_entrance": {"typewriter": "typing", "pop": "thud"},
                "mood_beds": {"neutral": "neutral-01", "tense": "tense-01"},
                "gain": {"sfx": 0.4, "music_duck": 0.08, "music_lift": 0.22},
            },
        },
        "sound_pack_doc": PACK,
        "source_policy": {"visual": {"chain": []}},
    }
    for key, value in over.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key] = {**base[key], **value}
        else:
            base[key] = value
    return base


def timings(*pairs):
    return [{"text": t, "start_s": a, "end_s": b} for (t, a, b) in pairs]


def beats(*items):
    return {"version": "1.0", "video_id": "vid_s", "beats": list(items)}


# ---------------- entrance mirror ----------------


def test_entrance_for_mirrors_the_engine():
    # no theme preference -> the component's own choice, which lives in TSX and
    # is deliberately not guessed here
    assert sound.entrance_for({}, "FactCard", sound.PANEL_ENTRANCES) is None
    # a theme default is honoured
    assert sound.entrance_for({"motion": {"entrance": "pop"}}, "FactCard", sound.PANEL_ENTRANCES) == "pop"
    # per_component beats the theme default
    theme = {"motion": {"entrance": "pop", "per_component": {"QuoteBlock": "typewriter"}}}
    assert sound.entrance_for(theme, "QuoteBlock", sound.TEXT_ENTRANCES) == "typewriter"
    # a component the override does not name still gets the theme default
    assert sound.entrance_for(theme, "ChapterCard", sound.PANEL_ENTRANCES) == "pop"
    # ...and an entrance the component cannot draw degrades to fade, exactly as
    # entranceFor does. contracts/themes/clean-punchy.json asks ChapterCard for
    # typewriter and hits this path in production: ChapterCard is a PANEL
    # component, so it fades, and therefore it must SOUND like a fade too.
    punchy = {"motion": {"entrance": "pop", "per_component": {"ChapterCard": "typewriter"}}}
    assert sound.entrance_for(punchy, "ChapterCard", sound.PANEL_ENTRANCES) == "fade"


@pytest.mark.parametrize(
    "motion_feel,expected",
    [("slow_heavy", 0.56), ("neutral", 0.4), ("fast_light", 0.28)],
)
def test_entrance_window_scales_with_motion_feel(motion_feel, expected):
    entry = {"entrance_seconds": 0.4}
    assert sound.entrance_window(entry, {"motion_feel": motion_feel}) == pytest.approx(expected)


def test_entrance_window_defaults_to_the_useentrance_default():
    assert sound.entrance_window({}, {}) == pytest.approx(0.45)


# ---------------- cue placement ----------------


def overlay_beat(bid, text, component="KineticTitle"):
    return {
        "id": bid,
        "kind": "narration",
        "script_text": text,
        "visual_intent": "a shot",
        "overlay": {"component": component, "props_hint": {"text": "Title"}},
    }


def test_cue_lands_on_the_overlay_with_its_lead_applied():
    doc = beats(overlay_beat("b1", "First sentence here."))
    plan = compile_plan(doc, timings(("First sentence here.", 0.0, 8.0)), cfg(), 8.0)
    sfx = plan["tracks"]["audio"]["sfx"]
    assert len(sfx) == 1
    item = sfx[0]
    overlay = plan["tracks"]["overlays"][0]
    # lead_s pulls the cue EARLIER so its transient lands on the entrance
    assert item["start_s"] == pytest.approx(overlay["start_s"] - 0.06)
    assert item["origin"] == "overlay"
    assert item["origin_id"] == overlay["id"]
    assert item["beat_id"] == "b1"
    assert item["path"] == "audio/swoosh.mp3"
    assert item["gain"] == pytest.approx(0.4)
    assert item["locked"] is False


def test_typewriter_cue_spans_the_entrance_window():
    """The case that motivated declaring entrance_seconds in the catalog."""
    theme = {
        "typography": {"caption_preset": "plain"},
        "motion_feel": "slow_heavy",
        "motion": {"entrance": "typewriter"},
        "sound": {"entrance": "swoosh", "per_entrance": {"typewriter": "typing"}},
    }
    doc = beats(overlay_beat("b1", "First sentence here.", component="QuoteBlock"))
    doc["beats"][0]["anchors"] = [{"type": "quote", "value": "A quote", "source_words": "First"}]
    doc["beats"][0]["overlay"] = {
        "component": "QuoteBlock",
        "anchor_ref": 0,
        "props_hint": {"text": "A quote"},
    }
    plan = compile_plan(doc, timings(("First sentence here.", 0.0, 8.0)), cfg(theme_doc=theme), 8.0)
    item = plan["tracks"]["audio"]["sfx"][0]
    overlay = plan["tracks"]["overlays"][0]
    # QuoteBlock declares entrance_seconds 0.4; slow_heavy scales it by 1.4
    assert item["loop"] is True
    assert item["end_s"] - item["start_s"] == pytest.approx(0.4 * 1.4, abs=0.002)
    assert item["start_s"] == pytest.approx(overlay["start_s"])


def test_media_overlays_and_missing_cues_produce_nothing():
    theme = {"typography": {"caption_preset": "plain"}, "sound": {"entrance": "none"}}
    doc = beats(overlay_beat("b1", "First sentence here."))
    plan = compile_plan(doc, timings(("First sentence here.", 0.0, 8.0)), cfg(theme_doc=theme), 8.0)
    assert "sfx" not in plan["tracks"]["audio"]


def test_unknown_cue_name_fails_loud():
    theme = {"typography": {"caption_preset": "plain"}, "sound": {"entrance": "nope"}}
    doc = beats(overlay_beat("b1", "First sentence here."))
    with pytest.raises(sound.SoundError, match="does not define it"):
        compile_plan(doc, timings(("First sentence here.", 0.0, 8.0)), cfg(theme_doc=theme), 8.0)


def test_channel_switch_beats_theme_and_style_pack():
    doc = beats(overlay_beat("b1", "First sentence here."))
    off = cfg(source_policy={"visual": {"chain": []}, "sfx": {"enabled": False}, "music": {"enabled": False}})
    plan = compile_plan(doc, timings(("First sentence here.", 0.0, 8.0)), off, 8.0)
    assert "sfx" not in plan["tracks"]["audio"]
    assert "music" not in plan["tracks"]["audio"]


def test_transition_cues_are_opt_in_and_skip_cuts():
    theme = {
        "typography": {"caption_preset": "plain"},
        "sound": {"entrance": "none", "transition": "swoosh"},
    }
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "One sentence.", "visual_intent": "a"},
        {"id": "b2", "kind": "narration", "script_text": "Two sentence.", "visual_intent": "b"},
    )
    st = timings(("One sentence.", 0.0, 4.0), ("Two sentence.", 4.0, 8.0))

    # style pack has to list "transition" for any of this to fire
    plan = compile_plan(doc, st, cfg(theme_doc=theme), 8.0)
    assert "sfx" not in plan["tracks"]["audio"]

    style = {
        "name": "test",
        "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 6.0},
        "overlays": {"density": "normal"},
        "transitions": {"allowed": ["cut", "crossfade"], "default": "crossfade"},
        "sfx": {"enabled": True, "cues": ["entrance", "transition"], "max_per_minute": 60, "min_gap_s": 0.0},
        "music": {"enabled": False},
    }
    plan = compile_plan(doc, st, cfg(theme_doc=theme, style_pack_doc=style), 8.0)
    assert [i["origin"] for i in plan["tracks"]["audio"]["sfx"]] == ["transition", "transition"]

    # ...and a cut is not an event you can hear
    style["transitions"] = {"allowed": ["cut"], "default": "cut"}
    plan = compile_plan(doc, st, cfg(theme_doc=theme, style_pack_doc=style), 8.0)
    assert "sfx" not in plan["tracks"]["audio"]


# ---------------- density ----------------


def dense_candidates(n, start=0.0, step=0.3, cue="swoosh"):
    return [
        {
            "id": f"s{i}",
            "start_s": round(start + i * step, 3),
            "end_s": round(start + i * step + 0.4, 3),
            "cue": cue,
        }
        for i in range(n)
    ]


def test_min_gap_thins_a_cluster():
    kept = sound._thin_sfx(dense_candidates(10, step=0.3), {"min_gap_s": 1.2, "max_per_minute": 60}, 60.0, PACK)
    starts = [i["start_s"] for i in kept]
    assert all(b - a >= 1.2 for a, b in zip(starts, starts[1:]))


def test_min_gap_collision_keeps_the_higher_priority_cue():
    candidates = [
        {"id": "a", "start_s": 1.0, "end_s": 1.4, "cue": "swoosh"},  # priority 1
        {"id": "b", "start_s": 1.3, "end_s": 1.8, "cue": "thud"},  # priority 3
    ]
    kept = sound._thin_sfx(candidates, {"min_gap_s": 1.2, "max_per_minute": 60}, 60.0, PACK)
    assert [i["id"] for i in kept] == ["b"]


def test_per_minute_budget_caps_a_long_video():
    # 30 cues spaced 2s apart over 60s, budget 4/min -> 4 survive
    kept = sound._thin_sfx(dense_candidates(30, step=2.0), {"min_gap_s": 1.0, "max_per_minute": 4}, 60.0, PACK)
    assert len(kept) == 4
    # order on the timeline is preserved, not priority order
    assert [i["start_s"] for i in kept] == sorted(i["start_s"] for i in kept)


# ---------------- mood spans ----------------


def test_short_runs_are_absorbed_into_the_longer_neighbour():
    spans = sound.mood_spans(
        [(0.0, 30.0, "neutral"), (30.0, 34.0, "tense"), (34.0, 70.0, "neutral")], min_span_s=20
    )
    # the 4s tense blip would have restarted the bed; it is absorbed instead
    assert spans == [(0.0, 70.0, "neutral")]


def test_a_real_mood_change_survives():
    spans = sound.mood_spans(
        [(0.0, 40.0, "neutral"), (40.0, 90.0, "tense")], min_span_s=20
    )
    assert spans == [(0.0, 40.0, "neutral"), (40.0, 90.0, "tense")]


def test_adjacent_beats_of_one_mood_merge():
    spans = sound.mood_spans(
        [(0.0, 10.0, "tense"), (10.0, 25.0, "tense"), (25.0, 40.0, "tense")], min_span_s=20
    )
    assert spans == [(0.0, 40.0, "tense")]


def test_a_video_too_short_for_any_span_keeps_the_DOMINANT_mood():
    """Caught end-to-end: five moods over 16s all collapsed to the LAST one.

    When no run clears min_span_s everything cascades into a single span, and
    the surviving label has to be the mood the video is mostly about — not
    whichever happened to be absorbed last.
    """
    beats = [
        (0.0, 3.2, "neutral"),
        (3.2, 6.4, "tense"),
        (6.4, 9.6, "tense"),
        (9.6, 12.8, "urgent"),
        (12.8, 16.1, "triumphant"),
    ]
    spans = sound.mood_spans(beats, min_span_s=14)
    assert spans == [(0.0, 16.1, "tense")], spans


def test_a_short_run_between_two_long_ones_joins_the_heavier():
    spans = sound.mood_spans(
        [(0.0, 60.0, "somber"), (60.0, 64.0, "playful"), (64.0, 94.0, "tense")],
        min_span_s=20,
    )
    assert [m for _s, _e, m in spans] == ["somber", "tense"]
    # the blip is absorbed, not dropped: the timeline stays covered
    assert spans[0][0] == 0.0 and spans[-1][1] == 94.0
    assert spans[0][1] == spans[1][0]


def test_unknown_mood_degrades_to_neutral():
    assert sound.normalize_mood("ominous") == "neutral"
    assert sound.normalize_mood(None) == "neutral"
    assert sound.normalize_mood("TENSE") == "tense"


def test_music_span_uses_the_mapped_bed_and_crossfades():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "One sentence.", "visual_intent": "a", "mood": "tense"},
    )
    plan = compile_plan(doc, timings(("One sentence.", 0.0, 40.0)), cfg(), 40.0)
    music = plan["tracks"]["audio"]["music"]
    assert len(music) == 1
    assert music[0]["path"] == "audio/tense-01.mp3"
    assert music[0]["mood"] == "tense"
    assert music[0]["loop"] is True
    assert music[0]["fade_in_s"] == 1.5


def test_a_mood_with_no_bed_is_silence_not_an_error():
    theme = {
        "typography": {"caption_preset": "plain"},
        "sound": {"mood_beds": {"neutral": "neutral-01"}},  # nothing for tense
    }
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "One sentence.", "visual_intent": "a", "mood": "tense"},
    )
    plan = compile_plan(doc, timings(("One sentence.", 0.0, 40.0)), cfg(theme_doc=theme), 40.0)
    assert "music" not in plan["tracks"]["audio"]


def test_a_bed_named_but_absent_from_the_pack_fails_loud():
    theme = {
        "typography": {"caption_preset": "plain"},
        "sound": {"mood_beds": {"neutral": "missing-01"}},
    }
    doc = beats({"id": "b1", "kind": "narration", "script_text": "One sentence.", "visual_intent": "a"})
    with pytest.raises(sound.SoundError, match="does not define it"):
        compile_plan(doc, timings(("One sentence.", 0.0, 40.0)), cfg(theme_doc=theme), 40.0)


# ---------------- ducking ----------------


def test_envelope_lifts_only_in_gaps_worth_lifting_into():
    # speech 0-5 and 5.5-10 (a 0.5s breath), then a 6s hole to 16
    speech = [{"start_s": 0.0, "end_s": 5.0}, {"start_s": 5.5, "end_s": 10.0}]
    env = sound.duck_envelope(speech, 0.0, 16.0, duck=0.08, lift=0.22)
    gains = {p["t_s"]: p["gain"] for p in env}
    assert max(gains.values()) == pytest.approx(0.22)
    # the breath is left alone
    assert all(p["gain"] == pytest.approx(0.08) for p in env if 5.0 <= p["t_s"] <= 5.5)
    # the real hole is lifted into
    lifted = [p["t_s"] for p in env if p["gain"] == pytest.approx(0.22)]
    assert any(10.0 < t < 16.0 for t in lifted)


def test_envelope_returns_to_duck_before_speech_resumes():
    speech = [{"start_s": 0.0, "end_s": 2.0}, {"start_s": 8.0, "end_s": 12.0}]
    env = sound.duck_envelope(speech, 0.0, 12.0, duck=0.08, lift=0.22)
    at_speech = [p for p in env if p["t_s"] == pytest.approx(8.0)]
    assert at_speech and at_speech[0]["gain"] == pytest.approx(0.08)


def test_wall_to_wall_speech_gets_a_flat_ducked_envelope():
    speech = [{"start_s": 0.0, "end_s": 30.0}]
    env = sound.duck_envelope(speech, 0.0, 30.0, duck=0.08, lift=0.22)
    assert [p["gain"] for p in env] == [pytest.approx(0.08), pytest.approx(0.08)]


def test_envelope_is_strictly_increasing_in_time():
    speech = [{"start_s": 0.0, "end_s": 2.0}, {"start_s": 4.0, "end_s": 6.0}]
    env = sound.duck_envelope(speech, 0.0, 20.0, duck=0.08, lift=0.22)
    times = [p["t_s"] for p in env]
    assert times == sorted(times)
    assert len(set(times)) == len(times)


def test_envelope_respects_the_schema_point_cap():
    # 300 one-second sentences with two-second holes between them
    speech = [{"start_s": i * 3.0, "end_s": i * 3.0 + 1.0} for i in range(300)]
    env = sound.duck_envelope(speech, 0.0, 900.0, duck=0.08, lift=0.22)
    assert 2 <= len(env) <= 200


def test_compiled_music_carries_an_envelope():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "One. Two.", "visual_intent": "a", "mood": "tense"},
    )
    st = timings(("One.", 0.0, 3.0), ("Two.", 12.0, 30.0))
    plan = compile_plan(doc, st, cfg(), 30.0)
    env = plan["tracks"]["audio"]["music"][0]["gain_envelope"]
    assert max(p["gain"] for p in env) == pytest.approx(0.22)
    assert min(p["gain"] for p in env) == pytest.approx(0.08)
