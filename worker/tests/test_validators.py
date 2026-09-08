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
    # D86: "drop the flag" is no longer advice that works. The class is DERIVED
    # from the catalog, so a component with no anchor type is an emphasis
    # overlay whatever the sheet says — the only repairs are a different
    # component or no overlay, and the message has to say that instead.
    assert "carries no anchor type" in violations[0]
    assert "leave the beat without an overlay" in violations[0], (
        "the repair prompt must say what to do"
    )


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


# ---------------- overlay.role replaces the boolean (slice 4, D86) ----------------


def sheet_with_role(role="emphasis", component="HammerStatement", **extra):
    sheet = good_sheet()
    sheet["version"] = "1.1"
    sheet["beats"][1]["overlay"] = {
        "component": component,
        "props_hint": {"text": "They came from everywhere"},
        "role": role,
        **extra,
    }
    return sheet


def test_a_sheet_using_the_old_emphasis_boolean_still_validates():
    """Nothing on disk breaks. Hand-written sheets are an artifact a human may
    upload (D62), and `additionalProperties: false` makes a removed field a
    hard rejection rather than a shrug."""
    assert validate_beat_sheet(sheet_with_emphasis(), SCRIPT, EMPHASIS_CFG, 10.0) == []


def test_role_and_the_boolean_are_read_identically():
    """Both paths, one behaviour — on the pack that allows the class and on the
    pack that does not."""
    off = {"style_pack_doc": {**EMPHASIS_CFG["style_pack_doc"],
                              "overlays": {**EMPHASIS_CFG["style_pack_doc"]["overlays"],
                                           "emphasis": {"enabled": False}}}}
    for cfg in (EMPHASIS_CFG, off):
        by_flag = validate_beat_sheet(sheet_with_emphasis(), SCRIPT, cfg, 10.0)
        by_role = validate_beat_sheet(sheet_with_role(), SCRIPT, cfg, 10.0)
        assert by_flag == by_role, cfg


def test_role_wins_when_both_are_present():
    """Precedence is pinned in both directions, so a sheet carrying a stale
    boletin alongside a fresh role is not read by whichever branch ran first."""
    from lusora_worker.validators import overlay_role

    assert overlay_role({"role": "emphasis", "emphasis": False}) == "emphasis"
    assert overlay_role({"role": "anchor", "emphasis": True}) == "anchor"
    assert overlay_role({"emphasis": True}) == "emphasis"
    assert overlay_role({}) == "anchor"


def test_a_fact_carrying_component_cannot_take_role_emphasis():
    """D59's rule survives the rename: emphasis lifts a moment, so a component
    that fills itself from an anchor is the wrong instrument for it."""
    sheet = sheet_with_role(role="emphasis", component="AnimatedCounter")
    sheet["beats"][1]["overlay"]["anchor_ref"] = 0
    violations = validate_beat_sheet(sheet, SCRIPT, EMPHASIS_CFG, 10.0)
    assert any("cannot take role 'emphasis'" in v for v in violations), violations


def test_a_component_with_no_anchor_type_is_emphasis_whatever_the_sheet_says():
    """The hole the baseline found, closed by construction. `validators.py` used
    to run its emphasis checks only when the flag was set and its anchor_ref
    check only when the component had anchor types — so a no-anchor component
    with no flag met NEITHER and was billed to the anchor budget."""
    from lusora_worker.validators import overlay_role

    import lusora_contracts

    hammer = lusora_contracts.catalog_component("HammerStatement")
    assert hammer["anchor_types"] == []
    # says anchor, is emphasis: the catalog decides
    assert overlay_role({"component": "HammerStatement", "role": "anchor"}, hammer) == "emphasis"
    # and says nothing at all: still emphasis
    assert overlay_role({"component": "HammerStatement"}, hammer) == "emphasis"


def test_an_undeclared_no_anchor_overlay_is_refused_when_the_pack_disables_the_class():
    """The regression the shipped run actually had: a DefinitionCard and a
    FactCard reached beats.json on a pack with the class off."""
    off = {"style_pack_doc": {**EMPHASIS_CFG["style_pack_doc"],
                              "overlays": {**EMPHASIS_CFG["style_pack_doc"]["overlays"],
                                           "emphasis": {"enabled": False}}}}
    sheet = good_sheet()
    sheet["version"] = "1.1"
    # no role, no flag — exactly the shape that used to slip through
    sheet["beats"][1]["overlay"] = {"component": "HammerStatement",
                                    "props_hint": {"text": "They came from everywhere"}}
    violations = validate_beat_sheet(sheet, SCRIPT, off, 10.0)
    assert any("this style pack does not use" in v for v in violations), violations


def test_saying_anchor_on_a_component_that_cannot_carry_one_names_both():
    """Reclassifying in silence would leave the sheet's author believing
    something false, so the violation says what it is instead."""
    sheet = sheet_with_role(role="anchor", component="HammerStatement")
    violations = validate_beat_sheet(sheet, SCRIPT, EMPHASIS_CFG, 10.0)
    assert any("cannot take role 'anchor'" in v for v in violations), violations


def test_a_timed_beats_overlay_is_outside_the_class_system():
    """D58's cold open. A timed beat carries no script_text, so it can carry no
    anchor and every overlay on one is pure text — and only ONE of the seven
    shipped packs enables the emphasis class, so gating it there would un-make
    a documented feature almost everywhere."""
    sheet = good_sheet()
    sheet["version"] = "1.1"
    sheet["beats"].insert(0, {
        "id": "b0", "kind": "timed", "timing": {"start_s": 0, "end_s": 4.5},
        "visual_intent": "slow push-in on a bombed cathedral at dawn",
        "overlay": {"component": "KineticTitle", "props_hint": {"text": "February 1945"}},
    })
    off = {"style_pack_doc": {**EMPHASIS_CFG["style_pack_doc"],
                              "overlays": {**EMPHASIS_CFG["style_pack_doc"]["overlays"],
                                           "emphasis": {"enabled": False}}}}
    assert validate_beat_sheet(sheet, SCRIPT, off, 10.0) == []


def test_the_two_budgets_stay_separate_under_role():
    """D59's accounting survives the rename: an emphasis overlay must not eat
    the anchor budget, and the derived class is what it is billed to."""
    sheet = sheet_with_role()
    violations = validate_beat_sheet(sheet, SCRIPT, EMPHASIS_CFG, 10.0)
    assert violations == [], violations


# ---------------- the rules BOTH languages enforce (slice 7) ----------------


def test_the_shared_overlay_rules_hold_on_the_python_side():
    """contracts/fixtures/rules/overlay_rules.json is the table the platform's
    editor route asserts against too (platform/test/overlayRules.test.ts).

    The worker has always applied these; the platform did not, so an overlay
    the chat agent invented reached beats.json and stopped the video at
    compile. One table, two implementations, no drift."""
    import json as _json
    from pathlib import Path

    import lusora_contracts

    table = _json.loads(
        (lusora_contracts.CONTRACTS_ROOT / "fixtures" / "rules" / "overlay_rules.json")
        .read_text(encoding="utf-8")
    )
    assert Path(lusora_contracts.CONTRACTS_ROOT, "fixtures", "rules").is_dir()

    for case in table["cases"]:
        cfg = {"style_pack_doc": {**CFG["style_pack_doc"], "overlays": {
            **CFG["style_pack_doc"]["overlays"],
            **({"allowed_components": case["allowed_components"]}
               if case.get("allowed_components") else {}),
        }}}
        # built explicitly rather than from good_sheet(), so the beats match
        # the table's own script and the platform's fixture exactly
        sheet = {
            "version": "1.1", "video_id": "vid_r", "beats": [
                {"id": "b1", "kind": "narration",
                 "script_text": "The port fed the capital.",
                 "visual_intent": "aerial harbour, 1940s"},
                {"id": "b2", "kind": "narration",
                 "script_text": "Nearly 70% of all grain passed through it.",
                 "visual_intent": "dock workers unloading sacks",
                 "anchors": [{"type": "percentage", "value": 70, "label": "of grain",
                              "source_words": "Nearly 70%"}],
                 "overlay": case["overlay"]},
            ],
        }
        violations = validate_beat_sheet(sheet, table["script"], cfg, 10.0)
        if not case["expect"]:
            assert violations == [], f"{case['name']}: {violations}"
            continue
        for needle in case["expect"]:
            assert any(needle in v for v in violations), (
                f"{case['name']}: expected a violation containing {needle!r}, got {violations}"
            )


def test_the_shared_transition_rules_hold_on_the_python_side():
    """contracts/fixtures/rules/transition_rules.json, the D89 twin of the
    overlay table: the platform's editor route asserts against the same cases
    (platform/test/transitionRules.test.ts).

    A beat names the transition it hands over WITH, so the kind has to be one
    this video's style pack allows — checked here, where the planner can still
    repair it, rather than in the renderer, which degrades what it cannot draw
    to a cut without saying so."""
    import json as _json

    import lusora_contracts

    table = _json.loads(
        (lusora_contracts.CONTRACTS_ROOT / "fixtures" / "rules" / "transition_rules.json")
        .read_text(encoding="utf-8")
    )

    for case in table["cases"]:
        allowed = case.get("allowed_transitions", table["default_allowed"])
        cfg = {"style_pack_doc": {**CFG["style_pack_doc"],
                                  "transitions": {"allowed": allowed or ["cut"],
                                                  "default": "cut"}}}
        if not allowed:
            # "an empty allow-list is not a rule": the pack is what is wrong,
            # and the compiler refuses it there. The beat is not the offender.
            cfg["style_pack_doc"]["transitions"] = {"allowed": [], "default": "cut"}
        first = {"id": "b1", "kind": "narration",
                 "script_text": "The port fed the capital.",
                 "visual_intent": "aerial harbour, 1940s"}
        if case.get("transition_out"):
            first["transition_out"] = case["transition_out"]
        sheet = {
            "version": "1.2", "video_id": "vid_r", "beats": [
                first,
                {"id": "b2", "kind": "narration",
                 "script_text": "Nearly 70% of all grain passed through it.",
                 "visual_intent": "dock workers unloading sacks"},
            ],
        }
        violations = validate_beat_sheet(sheet, table["script"], cfg, 10.0)
        if not case["expect"]:
            assert violations == [], f"{case['name']}: {violations}"
            continue
        for needle in case["expect"]:
            assert any(needle in v for v in violations), (
                f"{case['name']}: expected a violation containing {needle!r}, got {violations}"
            )
