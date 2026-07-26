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
