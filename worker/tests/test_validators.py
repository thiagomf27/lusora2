"""Validators: collect-all behavior for beat sheets and plans."""

import json
from pathlib import Path

from lusora_worker.validators import validate_beat_sheet, validate_plan

FIXTURES = Path(__file__).resolve().parent.parent.parent / "contracts" / "fixtures"

CFG = {
    "style_pack_doc": {
        "name": "test",
        "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 8.0},
        "overlays": {"density": "normal", "allowed_components": ["AnimatedCounter", "KineticTitle"]},
        "transitions": {"allowed": ["cut"], "default": "cut"},
    },
}

SCRIPT = "By 1943, nearly 70% of the city's factories had been converted to produce aircraft parts. The workers came from every corner of the country."


def good_sheet():
    return {
        "version": "1.0",
        "video_id": "vid_t",
        "beats": [
            {
                "id": "b1",
                "kind": "narration",
                "script_text": "By 1943, nearly 70% of the city's factories had been converted to produce aircraft parts.",
                "visual_intent": "industrial district aerial",
                "anchors": [
                    {"type": "percentage", "value": 70, "label": "converted", "source_words": "nearly 70%"}
                ],
                "overlay": {"component": "AnimatedCounter", "anchor_ref": 0},
            },
            {
                "id": "b2",
                "kind": "narration",
                "script_text": "The workers came from every corner of the country.",
                "visual_intent": "train platform crowds",
            },
        ],
    }


def test_valid_sheet_passes():
    assert validate_beat_sheet(good_sheet(), SCRIPT, CFG, 10.0) == []


def test_collects_multiple_violations():
    sheet = good_sheet()
    sheet["beats"][0]["overlay"]["component"] = "GlitterBomb"      # not in catalog
    sheet["beats"][0]["anchors"][0]["source_words"] = "eighty"     # not in span
    sheet["beats"][1]["script_text"] = "Words never in the script."  # coverage broken
    violations = validate_beat_sheet(sheet, SCRIPT, CFG, 10.0)
    assert len(violations) >= 3
    joined = " ".join(violations)
    assert "GlitterBomb" in joined
    assert "source_words" in joined


def test_component_not_in_style_pack_allowed():
    sheet = good_sheet()
    sheet["beats"][1]["anchors"] = [
        {"type": "place", "value": "Berlin", "source_words": "country"}
    ]
    sheet["beats"][1]["overlay"] = {"component": "SatelliteLocate", "anchor_ref": 0}
    violations = validate_beat_sheet(sheet, SCRIPT, CFG, 10.0)
    assert any("allowed_components" in v for v in violations)


def test_plan_fixture_structurally_valid(tmp_path):
    plan = json.loads((FIXTURES / "edit_plan.json").read_text())
    violations = validate_plan(plan, tmp_path, {}, 10.2, require_assets=False)
    assert violations == []


def test_plan_missing_assets_and_bad_duration(tmp_path):
    plan = json.loads((FIXTURES / "edit_plan.json").read_text())
    violations = validate_plan(plan, tmp_path, {}, 99.0, require_assets=True)
    assert any("asset file missing" in v for v in violations)
    assert any("does not match audio" in v for v in violations)
    assert len(violations) >= 3  # all collected, not first-fail


# ---------------- per-beat hold bounds ----------------

HOLD_CFG = {
    "style_pack_doc": {
        **CFG["style_pack_doc"],
        "pacing": {**CFG["style_pack_doc"]["pacing"], "hold_floor_ratio": 1.0, "hold_ceiling_ratio": 1.5},
    }
}


def _plan_with_holds(*spans):
    items = [
        {"id": f"v_b{i + 1}", "beat_id": f"b{i + 1}", "start_s": a, "end_s": b,
         "media_type": "image", "asset": {"source": "manual", "path": ""}}
        for i, (a, b) in enumerate(spans)
    ]
    return {
        "version": "1.0", "video_id": "vid_t", "fps": 30,
        "resolution": {"width": 1920, "height": 1080},
        "tracks": {
            "visual": items, "overlays": [],
            "captions": {"enabled": False, "items": []},
            "audio": {"voiceover": {"path": "audio.mp3", "duration_s": spans[-1][1]}},
        },
    }


def test_hold_bounds_flag_a_flash_and_a_dead_hold(tmp_path):
    plan = _plan_with_holds((0.0, 0.9), (0.9, 14.9))
    violations = validate_plan(plan, tmp_path, HOLD_CFG, 14.9, require_assets=False)
    assert any("v_b1 holds 0.90s, under the 2.00s floor" in v for v in violations)
    assert any("v_b2 holds 14.00s, over the 12.00s ceiling" in v for v in violations)
    # every violation names the item, the number, the knob and the way out
    assert all("hold_floor_ratio" in v or "hold_ceiling_ratio" in v for v in violations)


def test_hold_bounds_are_silent_without_the_ratios(tmp_path):
    plan = _plan_with_holds((0.0, 0.9), (0.9, 14.9))
    assert validate_plan(plan, tmp_path, CFG, 14.9, require_assets=False) == []


def test_a_locked_item_outranks_the_style_pack(tmp_path):
    plan = _plan_with_holds((0.0, 0.9), (0.9, 5.0))
    plan["tracks"]["visual"][0]["locked"] = True
    assert validate_plan(plan, tmp_path, HOLD_CFG, 5.0, require_assets=False) == []


# ---------------- queries[] (beat sheet v1.1, D53) ----------------


def test_both_beat_sheet_versions_are_accepted():
    v10 = good_sheet()
    assert validate_beat_sheet(v10, SCRIPT, CFG, 10.0) == []
    v11 = {**good_sheet(), "version": "1.1"}
    v11["beats"][0]["queries"] = ["1943 aircraft factory", "wartime assembly line"]
    assert validate_beat_sheet(v11, SCRIPT, CFG, 10.0) == []


def test_a_query_that_is_a_sentence_is_repairably_rejected():
    sheet = {**good_sheet(), "version": "1.1"}
    sheet["beats"][0]["queries"] = [
        "aerial view of a 1940s industrial district with smokestacks and workers"
    ]
    violations = validate_beat_sheet(sheet, SCRIPT, CFG, 10.0)
    assert len(violations) == 1
    # the repair prompt has to say what to write instead, not just what is wrong
    assert "2-4 words" in violations[0] and "visual_intent" in violations[0]


# ---------------- timed beats (D58) ----------------


def timed_sheet(*timed):
    sheet = good_sheet()
    sheet["beats"] = list(timed) + sheet["beats"]
    return sheet


def test_a_cold_open_and_an_outro_both_validate():
    sheet = timed_sheet(
        {"id": "b0", "kind": "timed", "timing": {"start_s": 0, "end_s": 4.5},
         "visual_intent": "cathedral at dawn", "mood": "somber"},
        {"id": "b9", "kind": "timed", "timing": {"start_s": 900, "end_s": 905},
         "visual_intent": "the cathedral rebuilt", "mood": "reflective"},
    )
    assert validate_beat_sheet(sheet, SCRIPT, CFG, 10.0) == []


def test_a_timed_beat_with_no_duration_is_repairably_rejected():
    sheet = timed_sheet({"id": "b0", "kind": "timed", "timing": {"start_s": 4, "end_s": 4},
                         "visual_intent": "a held card over music"})
    violations = validate_beat_sheet(sheet, SCRIPT, CFG, 10.0)
    assert any("positive duration" in v for v in violations)


def test_overlapping_timed_beats_are_rejected():
    sheet = timed_sheet(
        {"id": "b0", "kind": "timed", "timing": {"start_s": 0, "end_s": 5},
         "visual_intent": "cathedral at dawn"},
        {"id": "b9", "kind": "timed", "timing": {"start_s": 3, "end_s": 8},
         "visual_intent": "the cathedral rebuilt"},
    )
    violations = validate_beat_sheet(sheet, SCRIPT, CFG, 10.0)
    assert any("overlap" in v and "b0" in v and "b9" in v for v in violations)


# ---------------- the emphasis overlay class (D59) ----------------


EMPHASIS_CFG = {
    "style_pack_doc": {
        **CFG["style_pack_doc"],
        "overlays": {
            **CFG["style_pack_doc"]["overlays"],
            "allowed_components": ["AnimatedCounter", "KineticTitle", "HammerStatement"],
            "emphasis": {"enabled": True, "per_minute": 1.0},
        },
    }
}


def sheet_with_emphasis(count=1):
    sheet = good_sheet()
    sheet["version"] = "1.1"
    sheet["beats"][1]["overlay"] = {
        "component": "HammerStatement",
        "props_hint": {"text": "They came from everywhere"},
        "emphasis": True,
    }
    return sheet


def test_with_the_flag_off_an_emphasis_overlay_is_repairably_rejected():
    off = {"style_pack_doc": {**EMPHASIS_CFG["style_pack_doc"],
                              "overlays": {**EMPHASIS_CFG["style_pack_doc"]["overlays"],
                                           "emphasis": {"enabled": False}}}}
    violations = validate_beat_sheet(sheet_with_emphasis(), SCRIPT, off, 10.0)
    assert len(violations) == 1
    assert "this style pack does not use" in violations[0]
    assert "drop the flag" in violations[0], "the repair prompt must say what to do"


def test_with_the_flag_on_it_passes():
    assert validate_beat_sheet(sheet_with_emphasis(), SCRIPT, EMPHASIS_CFG, 10.0) == []


def test_the_two_classes_are_counted_under_separate_budgets():
    """An anchor overlay and an emphasis overlay in a 30s video: each is inside
    its own budget, and neither eats the other's."""
    sheet = sheet_with_emphasis()
    assert validate_beat_sheet(sheet, SCRIPT, EMPHASIS_CFG, 10.0) == []

    # the emphasis budget ALONE is what an excess of emphasis overlays breaks:
    # a pack that allows almost none still allows its anchor overlays
    stingy = {"style_pack_doc": {**EMPHASIS_CFG["style_pack_doc"],
                                 "overlays": {**EMPHASIS_CFG["style_pack_doc"]["overlays"],
                                              "emphasis": {"enabled": True, "per_minute": 0}}}}
    many = {"version": "1.1", "video_id": "vid_t", "beats": [
        {**b, "overlay": {"component": "HammerStatement",
                          "props_hint": {"text": "A line worth landing"}, "emphasis": True}}
        for b in good_sheet()["beats"]
    ]}
    violations = validate_beat_sheet(many, SCRIPT, stingy, 10.0)
    assert any("emphasis overlays exceed" in v for v in violations)
    assert not any("anchor overlays exceed" in v for v in violations)


def test_an_anchor_component_cannot_be_an_emphasis_overlay():
    sheet = good_sheet()
    sheet["beats"][0]["overlay"]["emphasis"] = True  # AnimatedCounter carries a number
    violations = validate_beat_sheet(sheet, SCRIPT, EMPHASIS_CFG, 10.0)
    assert any("carries a fact" in v for v in violations)


def test_the_flag_off_is_byte_identical_to_before():
    """Nothing about a sheet that never mentions emphasis changes."""
    assert validate_beat_sheet(good_sheet(), SCRIPT, CFG, 10.0) == []
    assert validate_beat_sheet(good_sheet(), SCRIPT, EMPHASIS_CFG, 10.0) == []
