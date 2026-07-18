"""Compiler v1: alignment, hold enforcement, overlay compilation."""

import pytest

from lusora_worker.compiler import compile_plan
from lusora_worker.compiler.core import CompileError

CFG = {
    "captions": {"enabled": True},
    "output": {"fps": 30, "width": 1280, "height": 720},
    "style_pack_doc": {
        "name": "test",
        "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 6.0},
        "overlays": {"density": "normal"},
        "transitions": {"allowed": ["cut", "crossfade"], "default": "crossfade"},
    },
    "theme_doc": {"typography": {"caption_preset": "plain"}},
}


def timings(*pairs):
    return [{"text": t, "start_s": a, "end_s": b} for (t, a, b) in pairs]


def beats(*items):
    return {"version": "1.0", "video_id": "vid_t", "beats": list(items)}


def test_alignment_and_captions():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "First sentence.", "visual_intent": "a"},
        {"id": "b2", "kind": "narration", "script_text": "Second one here.", "visual_intent": "b"},
    )
    st = timings(("First sentence.", 0.0, 3.0), ("Second one here.", 3.0, 6.5))
    plan = compile_plan(doc, st, CFG, 6.5)
    visual = plan["tracks"]["visual"]
    assert [v["beat_id"] for v in visual] == ["b1", "b2"]
    assert visual[0]["start_s"] == 0.0
    assert visual[0]["end_s"] == visual[1]["start_s"] == 3.0
    assert visual[1]["end_s"] == 6.5
    assert len(plan["tracks"]["captions"]["items"]) == 2
    assert plan["tracks"]["audio"]["voiceover"]["duration_s"] == 6.5


def test_beat_spanning_two_sentences():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "One. Two.", "visual_intent": "a"},
    )
    st = timings(("One.", 0.0, 2.0), ("Two.", 2.0, 4.0))
    plan = compile_plan(doc, st, CFG, 4.0)
    assert len(plan["tracks"]["visual"]) == 1
    assert plan["tracks"]["visual"][0]["end_s"] == 4.0


def test_max_hold_auto_split():
    doc = beats(
        {"id": "b1", "kind": "narration", "script_text": "A. B. C. D.", "visual_intent": "long"},
    )
    st = timings(("A.", 0, 4), ("B.", 4, 8), ("C.", 8, 12), ("D.", 12, 16))
    plan = compile_plan(doc, st, CFG, 16.0)
    visual = plan["tracks"]["visual"]
    assert len(visual) > 1, "16s beat must be split (max_hold 6)"
    for v in visual:
        assert v["end_s"] - v["start_s"] <= 6.0 + 1e-6
        assert v["beat_id"] == "b1"
    assert visual[0]["start_s"] == 0.0
    assert visual[-1]["end_s"] == 16.0
    for a, b in zip(visual, visual[1:]):
        assert a["end_s"] == b["start_s"]


def test_misaligned_beat_fails_loud():
    doc = beats({"id": "b1", "kind": "narration", "script_text": "Not in audio.", "visual_intent": "x"})
    st = timings(("Something else entirely.", 0.0, 3.0))
    with pytest.raises(CompileError):
        compile_plan(doc, st, CFG, 3.0)


def test_uncovered_narration_fails_loud():
    doc = beats({"id": "b1", "kind": "narration", "script_text": "First.", "visual_intent": "x"})
    st = timings(("First.", 0.0, 2.0), ("Uncovered tail.", 2.0, 4.0))
    with pytest.raises(CompileError):
        compile_plan(doc, st, CFG, 4.0)


def test_overlay_props_from_anchor_and_defaults():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "Nearly 70% converted.",
            "visual_intent": "factories",
            "anchors": [
                {"type": "percentage", "value": 70, "label": "converted", "source_words": "70%"}
            ],
            "overlay": {"component": "AnimatedPercentage", "anchor_ref": 0},
        },
    )
    st = timings(("Nearly 70% converted.", 0.0, 5.0))
    plan = compile_plan(doc, st, CFG, 5.0)
    overlays = plan["tracks"]["overlays"]
    assert len(overlays) == 1
    props = overlays[0]["props"]
    assert props["value"] == 70          # from_anchor: the LLM cannot get the number wrong
    assert props["label"] == "converted"  # anchor label fallback
    assert props["emphasis"] == "accent"  # default
    assert overlays[0]["end_s"] <= 5.0


def test_geocode_fills_map_props():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "The push toward Stalingrad began.",
            "visual_intent": "map",
            "anchors": [{"type": "place", "value": "Stalingrad", "source_words": "Stalingrad"}],
            "overlay": {"component": "AnimatedMap", "anchor_ref": 0},
        },
    )
    st = timings(("The push toward Stalingrad began.", 0.0, 5.0))
    plan = compile_plan(doc, st, CFG, 5.0)
    props = plan["tracks"]["overlays"][0]["props"]
    assert props["place_name"] == "Stalingrad"
    assert abs(props["lat"] - 48.708) < 0.01
    assert props["zoom"] == "region"


def test_unknown_place_fails_loud():
    doc = beats(
        {
            "id": "b1",
            "kind": "narration",
            "script_text": "The town of Xyzzyville fell.",
            "visual_intent": "map",
            "anchors": [{"type": "place", "value": "Xyzzyville", "source_words": "Xyzzyville"}],
            "overlay": {"component": "AnimatedMap", "anchor_ref": 0},
        },
    )
    st = timings(("The town of Xyzzyville fell.", 0.0, 4.0))
    with pytest.raises(CompileError, match="geocode"):
        compile_plan(doc, st, CFG, 4.0)


def test_leading_timed_beat_offsets_voiceover():
    doc = beats(
        {"id": "b1", "kind": "timed", "timing": {"start_s": 0.0, "end_s": 3.0},
         "visual_intent": "cold open"},
        {"id": "b2", "kind": "narration", "script_text": "Hello there.", "visual_intent": "x"},
    )
    st = timings(("Hello there.", 0.0, 2.0))
    plan = compile_plan(doc, st, CFG, 2.0)
    vo = plan["tracks"]["audio"]["voiceover"]
    assert vo["start_s"] == 3.0
    captions = plan["tracks"]["captions"]["items"]
    assert captions[0]["start_s"] == 3.0
    visual = plan["tracks"]["visual"]
    assert visual[0]["beat_id"] == "b1"
    assert visual[-1]["end_s"] == 5.0
