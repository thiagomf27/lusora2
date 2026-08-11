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
