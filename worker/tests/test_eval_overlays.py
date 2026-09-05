"""The overlay eval scorer (slice 1).

The scorer is the instrument every later slice is judged with, so these tests
are mostly about it being HONEST rather than about it working: that the metric
the work is trying to move actually moves, that the two axes are independent,
that a bug in a case is reported as a bug rather than absorbed as a bad score,
and that it cannot drift from the verbatim rule the validator enforces.
"""

import json
from pathlib import Path

import pytest
from lusora_contracts import load_schema

from lusora_worker import textsplit
from lusora_worker.evals.overlays import (
    EvalCaseError,
    load_case,
    score,
    score_case,
)

EVALS = Path(__file__).resolve().parents[2] / "evals" / "overlays"

SCRIPT = (
    "The Soviet Union built twenty-nine thousand tanks. "
    "Germany built twelve thousand. "
    "The gap was not a matter of courage. "
    "It was a matter of factories."
)


def _beat(bid, text, overlay=None):
    beat = {"id": bid, "kind": "narration", "script_text": text, "visual_intent": "a factory floor"}
    if overlay:
        beat["overlay"] = overlay
    return beat


def _sheet(*beats):
    return {"version": "1.1", "video_id": "vid_e", "beats": list(beats)}


def _marks(*marks):
    return {"version": "1.0", "case": "unit", "marks": list(marks)}


def _graphic(mid, words, acceptable, ideal=None, cls="anchor"):
    return {
        "id": mid,
        "source_words": words,
        "verdict": "graphic",
        "class": cls,
        "acceptable": list(acceptable),
        "ideal": ideal or acceptable[0],
    }


def _no_graphic(mid, words, near_miss=None):
    mark = {"id": mid, "source_words": words, "verdict": "no_graphic"}
    if near_miss:
        mark["near_miss"] = near_miss
    return mark


# ---------------- the happy path ----------------


def test_a_perfect_sheet_scores_one_on_every_axis():
    marks = _marks(
        _graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter", "StatTag"]),
        _no_graphic("m2", "a matter of courage"),
    )
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.",
              {"component": "AnimatedCounter", "anchor_ref": 0}),
        _beat("b2", "Germany built twelve thousand."),
        _beat("b3", "The gap was not a matter of courage."),
        _beat("b4", "It was a matter of factories."),
    )
    scores = score(marks, sheet, SCRIPT)
    assert (scores.recall, scores.precision, scores.restraint, scores.component_accuracy) == (
        1.0,
        1.0,
        1.0,
        1.0,
    )


# ---------------- each axis moves for its own reason ----------------


def test_an_overlay_on_a_no_graphic_mark_costs_restraint():
    """The metric the whole line of work exists to move."""
    marks = _marks(_no_graphic("m1", "a matter of courage", near_miss="number"))
    clean = _sheet(_beat("b1", SCRIPT))
    noisy = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks. Germany built twelve thousand."),
        _beat("b2", "The gap was not a matter of courage.", {"component": "StatTag"}),
        _beat("b3", "It was a matter of factories."),
    )
    assert score(marks, clean, SCRIPT).restraint == 1.0
    after = score(marks, noisy, SCRIPT)
    assert after.restraint == 0.0
    assert after.restraint_failures == ("m1",)


def test_a_missed_graphic_mark_costs_recall():
    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]))
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks."),
        _beat("b2", "Germany built twelve thousand. The gap was not a matter of courage. It was a matter of factories."),
    )
    scores = score(marks, sheet, SCRIPT)
    assert scores.recall == 0.0
    assert scores.misses == ("m1",)
    # nothing was placed, so there is no component decision to grade
    assert scores.component_accuracy is None


def test_a_right_moment_with_a_wrong_component_keeps_recall_and_loses_accuracy():
    """The two axes are independent: WHERE and WHICH are separate questions,
    and a scorer that collapsed them could not tell a restraint problem from a
    catalog-comprehension one."""
    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter", "StatTag"]))
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.",
              {"component": "QuoteBlock"}),
        _beat("b2", "Germany built twelve thousand. The gap was not a matter of courage. It was a matter of factories."),
    )
    scores = score(marks, sheet, SCRIPT)
    assert scores.recall == 1.0
    assert scores.precision == 1.0
    assert scores.component_accuracy == 0.0
    assert scores.wrong_components == (("m1", "QuoteBlock"),)


def test_an_overlay_nowhere_near_a_mark_costs_precision_but_not_restraint():
    """A beat nobody marked is not evidence either way — the marker looked at
    the reference, not at every beat our planner might invent. Only a beat
    carrying a verdict counts."""
    marks = _marks(
        _graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]),
        _no_graphic("m2", "a matter of courage"),
    )
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.", {"component": "AnimatedCounter"}),
        _beat("b2", "Germany built twelve thousand.", {"component": "StatTag"}),
        _beat("b3", "The gap was not a matter of courage."),
        _beat("b4", "It was a matter of factories."),
    )
    scores = score(marks, sheet, SCRIPT)
    assert scores.restraint == 1.0, "b2 carries no verdict; it cannot cost restraint"
    assert scores.precision == 1.0, "and it is not counted against precision either"
    assert scores.overlays_placed == 1


# ---------------- exclusions ----------------


def test_an_unmappable_mark_is_excluded_from_every_score():
    """You are not punished for capabilities you never claimed."""
    unmappable = {
        "id": "m9",
        "source_words": "a matter of factories",
        "verdict": "unmappable",
        "excluded_from_scoring": True,
    }
    base = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]))
    with_it = _marks(base["marks"][0], unmappable)
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.", {"component": "AnimatedCounter"}),
        _beat("b2", "Germany built twelve thousand. The gap was not a matter of courage."),
        _beat("b3", "It was a matter of factories.", {"component": "DocumentCard"}),
    )
    without, within = score(base, sheet, SCRIPT), score(with_it, sheet, SCRIPT)
    axes = lambda s: (s.recall, s.precision, s.restraint, s.component_accuracy)  # noqa: E731
    assert axes(within) == axes(without)
    assert within.unmappable_marks == 1
    # and the overlay sitting on it is excluded rather than counted as a miss
    assert within.unscorable_overlays == 1


def test_a_negative_sharing_a_beat_with_a_positive_is_unscorable_not_free():
    """Beat granularity's one honest limit, reported rather than absorbed: an
    overlay on that beat is attributable to the positive, so counting the
    negative either way would be inventing a result."""
    marks = _marks(
        _graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]),
        _no_graphic("m2", "The Soviet Union", near_miss="name"),
    )
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.", {"component": "AnimatedCounter"}),
        _beat("b2", "Germany built twelve thousand. The gap was not a matter of courage. It was a matter of factories."),
    )
    scores = score(marks, sheet, SCRIPT)
    assert scores.restraint is None, "there is no scorable negative left"
    assert scores.unscorable_negatives == 1
    assert scores.recall == 1.0


# ---------------- it cannot drift from the validator ----------------


def test_source_words_match_uses_the_same_normalisation_as_the_validator():
    """Asserted against textsplit.normalize directly, so the scorer cannot
    drift from the verbatim check validate_beat_sheet runs. A span the
    validator considers present must never be a span the scorer calls missing.
    """
    assert textsplit.normalize("  The   SOVIET\nUnion ") == "the soviet union"
    marks = _marks(
        # differs from the script in case and in whitespace only
        _graphic("m1", "TWENTY-NINE    thousand\n tanks", ["AnimatedCounter"])
    )
    sheet = _sheet(
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.", {"component": "AnimatedCounter"}),
        _beat("b2", "Germany built twelve thousand. The gap was not a matter of courage. It was a matter of factories."),
    )
    assert score(marks, sheet, SCRIPT).recall == 1.0


# ---------------- a broken case is reported, never scored ----------------


def test_a_mark_whose_words_are_not_in_the_script_is_a_hard_error():
    marks = _marks(_graphic("m1", "forty thousand submarines", ["AnimatedCounter"]))
    sheet = _sheet(_beat("b1", SCRIPT))
    with pytest.raises(EvalCaseError, match="does not appear in the script"):
        score(marks, sheet, SCRIPT)


def test_a_mark_whose_words_appear_twice_is_a_hard_error():
    script = "Germany built twelve thousand. Later, Germany built twelve thousand more."
    marks = _marks(_graphic("m1", "Germany built twelve thousand", ["AnimatedCounter"]))
    sheet = _sheet(_beat("b1", script))
    with pytest.raises(EvalCaseError, match="appears more than once"):
        score(marks, sheet, script)


def test_an_ideal_outside_acceptable_is_a_hard_error():
    """JSON Schema cannot express membership, so it is checked here: a best
    choice that is not an allowed choice means the mark says two things."""
    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["StatTag"], ideal="AnimatedCounter"))
    sheet = _sheet(_beat("b1", SCRIPT))
    with pytest.raises(EvalCaseError, match="is not one of acceptable"):
        score(marks, sheet, SCRIPT)


# ---------------- span-based, not index-based ----------------


def test_scores_are_stable_under_beat_reordering():
    marks = _marks(
        _graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]),
        _no_graphic("m2", "a matter of courage", near_miss="number"),
    )
    beats = [
        _beat("b1", "The Soviet Union built twenty-nine thousand tanks.", {"component": "AnimatedCounter"}),
        _beat("b2", "Germany built twelve thousand."),
        _beat("b3", "The gap was not a matter of courage."),
        _beat("b4", "It was a matter of factories."),
    ]
    forward = score(marks, _sheet(*beats), SCRIPT)
    backward = score(marks, _sheet(*reversed(beats)), SCRIPT)
    assert forward == backward


def test_a_score_with_no_marks_of_its_kind_reads_as_unanswered():
    """None, not 1.0: a case with no negatives has no restraint to report, and
    a perfect score for a question nobody asked would be read as evidence."""
    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]))
    sheet = _sheet(_beat("b1", SCRIPT, {"component": "AnimatedCounter"}))
    assert score(marks, sheet, SCRIPT).restraint is None


# ---------------- the committed case ----------------


def test_the_synthetic_case_loads_and_every_mark_finds_its_words():
    marks, script = load_case(EVALS / "_synthetic")
    # a sheet of one beat covering the whole script: every mark must locate,
    # which is the only claim this makes — the scores are meaningless here
    sheet = _sheet(_beat("b1", script))
    scores = score(marks, sheet, script)
    assert scores.graphic_marks == 4
    assert scores.unmappable_marks == 1


def test_the_synthetic_case_validates_against_its_schema():
    import jsonschema

    marks = json.loads((EVALS / "_synthetic" / "marks.json").read_text(encoding="utf-8"))
    jsonschema.validate(marks, load_schema("overlay_marks"))


def test_the_synthetic_case_carries_a_discriminating_negative():
    """A restraint metric built only on spans with no anchor in them measures
    nothing: the gate already refuses those. At least one negative must sit on
    a span a graphic would have been LEGAL on."""
    marks, _ = load_case(EVALS / "_synthetic")
    negatives = [m for m in marks["marks"] if m["verdict"] == "no_graphic"]
    assert negatives, "a case with no negatives cannot measure restraint"
    assert any(m.get("near_miss") for m in negatives)


def test_every_component_a_case_names_exists_in_the_catalog():
    """The schema cannot check component names, and a case naming a component
    that does not exist reports a wrong number rather than an error."""
    from lusora_contracts import load_catalog

    known = {c["name"] for c in load_catalog()["components"]}
    for case_dir in sorted(p for p in EVALS.iterdir() if p.is_dir()):
        marks, _ = load_case(case_dir)
        for mark in marks["marks"]:
            for name in mark.get("acceptable") or []:
                assert name in known, f"{case_dir.name}/{mark['id']}: unknown component {name!r}"


def test_no_case_marks_a_component_its_own_channel_forbids():
    """A case's cfg pins the style pack the run was scored under, and that pack
    may set overlays.allowed_components. Marking a component outside it makes a
    graphic the planner is FORBIDDEN to place, which scores as a miss it had no
    way to avoid — the same unfairness `unmappable` exists to prevent."""
    for case_dir in sorted(p for p in EVALS.iterdir() if p.is_dir()):
        cfg = json.loads((case_dir / "cfg.json").read_text(encoding="utf-8"))
        allowed = ((cfg.get("style_pack_doc") or {}).get("overlays") or {}).get(
            "allowed_components"
        )
        if not allowed:
            continue
        marks, _ = load_case(case_dir)
        for mark in marks["marks"]:
            for name in mark.get("acceptable") or []:
                assert name in allowed, (
                    f"{case_dir.name}/{mark['id']}: {name!r} is not in this case's "
                    f"allowed_components, so no run could ever place it"
                )


def test_no_case_marks_an_emphasis_graphic_its_pack_disables():
    """The emphasis class is off unless the style pack turns it on (D59), so an
    emphasis mark on a pack that does not is a graphic the planner is forbidden
    to place — the same unfairness `unmappable` exists to prevent."""
    for case_dir in sorted(p for p in EVALS.iterdir() if p.is_dir()):
        cfg = json.loads((case_dir / "cfg.json").read_text(encoding="utf-8"))
        overlays = ((cfg.get("style_pack_doc") or {}).get("overlays") or {})
        enabled = bool((overlays.get("emphasis") or {}).get("enabled", False))
        marks, _ = load_case(case_dir)
        for mark in marks["marks"]:
            if mark.get("class") == "emphasis":
                assert enabled, (
                    f"{case_dir.name}/{mark['id']}: an emphasis mark on a pack that "
                    "does not set overlays.emphasis — mark it unmappable instead"
                )


def test_a_case_whose_marks_name_another_case_is_refused(tmp_path):
    """The directory and the declared case must agree, or a number in
    BASELINE.md cannot be traced back to what produced it."""
    case = tmp_path / "somewhere"
    case.mkdir()
    (case / "script.txt").write_text(SCRIPT, encoding="utf-8")
    (case / "marks.json").write_text(
        json.dumps(_marks(_no_graphic("m1", "a matter of courage"))), encoding="utf-8"
    )
    with pytest.raises(EvalCaseError, match="must agree"):
        load_case(case)


# ---------------- the CLI ----------------


def test_the_cli_scores_a_case_and_reports_a_broken_one(tmp_path, capsys):
    from lusora_worker.evals.overlays import main

    marks, script = load_case(EVALS / "_synthetic")
    beats = tmp_path / "beats.json"
    beats.write_text(json.dumps(_sheet(_beat("b1", script))), encoding="utf-8")

    assert main(["score", str(EVALS / "_synthetic"), str(beats)]) == 0
    assert "recall" in capsys.readouterr().out

    assert main(["score", str(EVALS / "_synthetic"), str(beats), "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["case"] == "_synthetic"
    assert set(payload) >= {"recall", "precision", "restraint", "component_accuracy"}

    broken = tmp_path / "broken"
    broken.mkdir()
    (broken / "script.txt").write_text("nothing in common", encoding="utf-8")
    (broken / "marks.json").write_text(
        json.dumps({**_marks(_no_graphic("m1", "a matter of courage")), "case": "broken"}),
        encoding="utf-8",
    )
    assert main(["score", str(broken), str(beats)]) == 2
    assert "eval case error" in capsys.readouterr().err


def test_score_case_reads_the_cases_own_script_not_the_sheets(tmp_path):
    """A mark that fits the script but not this sheet is a SHEET problem, and
    passing the case's real script.txt is what makes the error say so."""
    scores = score_case(
        EVALS / "_synthetic",
        _write(tmp_path / "beats.json", _sheet(_beat("b1", load_case(EVALS / "_synthetic")[1]))),
    )
    assert scores.graphic_marks == 4


def _write(path: Path, doc) -> Path:
    path.write_text(json.dumps(doc), encoding="utf-8")
    return path


# ---------------- the authoring prompt cannot drift from the catalog ----------------


def test_the_marking_prompts_component_menu_agrees_with_the_catalog():
    """docs/10-overlay-marks.md tells a human which component takes which
    anchor type. A table that drifts from the catalog produces cases whose
    `acceptable` lists are wrong, and wrong ground truth is worse than none."""
    from lusora_contracts import load_catalog

    doc = (Path(__file__).resolve().parents[2] / "docs" / "10-overlay-marks.md").read_text(
        encoding="utf-8"
    )
    # the CORE catalog only: the doc says a pack's entries are added per case,
    # because which pack is installed is a property of the channel a case was
    # torn down from, not of the prompt
    catalog = [c for c in load_catalog()["components"] if c.get("pack") == "core"]
    for anchor_type in ("number", "percentage", "comparison", "place", "date", "name", "quote"):
        expected = sorted(c["name"] for c in catalog if anchor_type in (c.get("anchor_types") or []))
        assert f"| `{anchor_type}` | {', '.join(expected)} |" in doc, anchor_type
    unanchored = sorted(c["name"] for c in catalog if not (c.get("anchor_types") or []))
    assert ", ".join(unanchored) in doc


# ---------------- checking a case before paying for it ----------------


def _case(tmp_path, name, marks, script=SCRIPT, cfg=None):
    d = tmp_path / name
    d.mkdir()
    (d / "script.txt").write_text(script, encoding="utf-8")
    (d / "marks.json").write_text(json.dumps({**marks, "case": name}), encoding="utf-8")
    (d / "cfg.json").write_text(json.dumps(cfg or {"style_pack_doc": {"overlays": {}}}),
                                encoding="utf-8")
    return d


def test_check_passes_a_sound_case(tmp_path):
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]),
                   _no_graphic("m2", "a matter of courage", near_miss="number"))
    hard = [p for p in check_case(_case(tmp_path, "sound", marks)) if not p.startswith("ADVISORY")]
    assert hard == []


def test_check_catches_a_component_that_does_not_exist(tmp_path):
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["HoloProjector"]))
    problems = check_case(_case(tmp_path, "unknown-component", marks))
    assert any("not a component in the catalog" in p for p in problems), problems


def test_check_catches_an_anchor_mark_on_a_component_that_carries_no_fact(tmp_path):
    """D86's rule, enforced at authoring time: a bottom-row component can never
    be class 'anchor', and a case that says so would score an impossibility."""
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["HammerStatement"]))
    problems = check_case(_case(tmp_path, "wrong-class", marks))
    assert any("can never be class 'anchor'" in p for p in problems), problems


def test_check_catches_an_emphasis_mark_the_pack_forbids(tmp_path):
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["HammerStatement"],
                            cls="emphasis"))
    problems = check_case(_case(tmp_path, "no-emphasis", marks))
    assert any("does not set" in p and "emphasis" in p for p in problems), problems
    # ...and passes once the pack enables the class
    ok = check_case(_case(tmp_path, "with-emphasis", marks,
                          cfg={"style_pack_doc": {"overlays": {"emphasis": {"enabled": True}}}}))
    assert not any("emphasis.enabled" in p for p in ok), ok


def test_check_catches_a_component_outside_the_channels_allowed_list(tmp_path):
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["StatTag"]))
    cfg = {"style_pack_doc": {"overlays": {"allowed_components": ["AnimatedCounter"]}}}
    problems = check_case(_case(tmp_path, "not-allowed", marks, cfg=cfg))
    assert any("allowed_components" in p for p in problems), problems


def test_check_catches_words_that_are_not_in_the_script_or_appear_twice(tmp_path):
    from lusora_worker.evals.overlays import check_case

    missing = _marks(_graphic("m1", "forty thousand submarines", ["AnimatedCounter"]))
    assert any("is not in script.txt" in p for p in check_case(_case(tmp_path, "missing", missing)))

    twice = _marks(_graphic("m1", "Germany built twelve thousand", ["AnimatedCounter"]))
    script = "Germany built twelve thousand. Later, Germany built twelve thousand more."
    problems = check_case(_case(tmp_path, "twice", twice, script=script))
    assert any("appears more than once" in p for p in problems), problems


def test_check_reports_every_problem_rather_than_the_first(tmp_path):
    """A case is usually pasted out of a model's answer; finding one fault per
    round trip is the expensive way to fix five."""
    from lusora_worker.evals.overlays import check_case

    marks = _marks(
        _graphic("m1", "forty thousand submarines", ["HoloProjector"]),
        _graphic("m2", "twenty-nine thousand tanks", ["StatTag"], ideal="AnimatedCounter"),
    )
    problems = check_case(_case(tmp_path, "many-faults", marks))
    assert len(problems) >= 3, problems


def test_check_advises_when_a_case_is_too_small_to_measure_anything(tmp_path):
    """The lesson the real cases taught: 4 graphic marks means recall moves in
    25-point steps, and the noise swamps the effect."""
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]))
    problems = check_case(_case(tmp_path, "tiny", marks))
    assert any(p.startswith("ADVISORY") and "steps of" in p for p in problems), problems


def test_the_cli_check_exits_nonzero_only_on_a_hard_fault(tmp_path, capsys):
    """An advisory must not fail a script: a small case is worth less, not
    invalid."""
    from lusora_worker.evals.overlays import main

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]))
    assert main(["check", str(_case(tmp_path, "small", marks))]) == 0
    assert "advisory" in capsys.readouterr().out

    bad = _marks(_graphic("m1", "twenty-nine thousand tanks", ["HoloProjector"]))
    assert main(["check", str(_case(tmp_path, "broken", bad))]) == 1


def test_every_committed_case_passes_its_own_checker(tmp_path):
    """The checker and the committed cases must not disagree — one of them
    would be wrong, and the cases are what every number rests on."""
    from lusora_worker.evals.overlays import check_case

    for case_dir in sorted(p for p in EVALS.iterdir() if p.is_dir()):
        hard = [p for p in check_case(case_dir) if not p.startswith("ADVISORY")]
        assert hard == [], f"{case_dir.name}: {hard}"


def test_check_catches_a_case_that_marks_more_graphics_than_its_budget_allows(tmp_path):
    """A case whose ground truth exceeds its own density ceiling has capped its
    own recall: the validator refuses a sheet over the budget, so the planner
    cannot reach 100% however well it judges."""
    from lusora_worker.evals.overlays import check_case

    marks = _marks(*[
        _graphic(f"m{i}", w, ["AnimatedCounter"])
        for i, w in enumerate(
            ["twenty-nine thousand tanks", "Germany built twelve thousand",
             "a matter of courage", "a matter of factories"], start=1)
    ])
    case = _case(tmp_path, "over-budget", marks,
                 cfg={"style_pack_doc": {"overlays": {"density": "low"}}})
    # 60s of narration at low density = ceil(1.0 * 60/60) + 1 = 2 overlays
    (case / "subtitles.srt").write_text(
        "1\n00:00:00,000 --> 00:01:00,000\n" + SCRIPT + "\n", encoding="utf-8")
    problems = check_case(case)
    assert any("recall is capped" in p for p in problems), problems
    assert any("Raise overlays.density" in p for p in problems), problems


def test_check_says_nothing_about_budget_when_the_case_has_no_timings(tmp_path):
    """Narration length comes from subtitles.srt, and we generate that after the
    marks exist — a case mid-assembly must not be told it is over budget."""
    from lusora_worker.evals.overlays import check_case

    marks = _marks(_graphic("m1", "twenty-nine thousand tanks", ["AnimatedCounter"]))
    problems = check_case(_case(tmp_path, "no-timings", marks,
                                cfg={"style_pack_doc": {"overlays": {"density": "low"}}}))
    assert not any("budget" in p for p in problems), problems


# ---------------- the harness itself (cost visibility + the beats cache) ----------------


def test_the_beats_cache_is_keyed_by_case_arm_and_run(tmp_path):
    """Run 2 of a tuning session must reuse run 2's beats, not run 1's — the
    point is to hold the planner constant per run, not to collapse three runs
    into one and lose the spread."""
    from lusora_worker.evals.harness import BeatsCache

    v3 = BeatsCache(tmp_path, "v3")
    base = BeatsCache(tmp_path, "base")
    v3.put("cnbc", 1, {"beats": [{"id": "b1"}]})
    v3.put("cnbc", 2, {"beats": [{"id": "b2"}]})

    assert v3.get("cnbc", 1)["beats"][0]["id"] == "b1"
    assert v3.get("cnbc", 2)["beats"][0]["id"] == "b2"
    assert v3.get("cnbc", 3) is None, "an unseen run must not silently reuse another's"
    assert base.get("cnbc", 1) is None, "the arms must not share beats"
    assert v3.get("other-case", 1) is None


def test_eval_spend_is_recorded_rather_than_thrown_away(tmp_path):
    """The harness used a test double for the database, so every eval run
    discarded its cost events: the control plane recorded $0.25 across all
    history while roughly $4 had been billed. Without a DSN it still keeps the
    numbers in memory so a run can report what it spent."""
    from lusora_worker.evals.harness import EvalDb

    db = EvalDb("cnbc-ref", "v3", dsn=None)
    db.cost_event(video_id=None, channel_id=None, provider="deepseek",
                  operation="llm.select_overlays", status="completed",
                  units=1000, unit_price_usd=0.0, usd=0.25, details={})
    db.cost_event(video_id=None, channel_id=None, provider="deepseek",
                  operation="llm.select_overlays", status="reserved",
                  units=1000, unit_price_usd=0.0, usd=0.25, details={})
    assert db.spend() == 0.25, "only completed calls are spend; a reservation is not"


def test_a_call_costs_what_the_published_rates_say(tmp_path):
    """The shape that was being mis-billed: cheap input, expensive output."""
    from lusora_worker.evals.harness import call_cost

    cost = call_cost("deepseek", "llm.plan_beats", "deepseek-v4-flash", 2_000, 20_000)
    assert cost == pytest.approx(2_000 * 0.44 / 1e6 + 20_000 * 1.32 / 1e6)
    # and the model matters: v4-pro is three times the price for the same call
    assert call_cost("deepseek", "llm.plan_beats", "deepseek-v4-pro", 2_000, 20_000) > cost * 2


def test_reusing_beats_skips_the_planner_entirely(tmp_path, monkeypatch):
    """The saving is the whole point: an overlay iteration is one call, not
    four, because the overlay prompt cannot change the beats."""
    from lusora_worker.evals import run_case
    from lusora_worker.evals.harness import BeatsCache

    case = EVALS / "_synthetic"
    beats = {"version": "1.1", "video_id": "x", "beats": [
        {"id": "b1", "kind": "narration",
         "script_text": (case / "script.txt").read_text(encoding="utf-8").strip(),
         "visual_intent": "a factory floor"}]}
    BeatsCache(tmp_path, "v3").put(case.name, 1, beats)

    def explode(*a, **k):
        raise AssertionError("the planner must not run when beats are cached")

    monkeypatch.setattr(run_case.beatcraft, "craft_beats", explode)
    monkeypatch.setattr(run_case.planner_agent, "plan_beats", explode)
    monkeypatch.setattr(
        run_case.overlay_agent, "select_overlays",
        lambda ctx, b, d, chat_fn=None: {"version": "1.0", "video_id": "x", "selections": []},
    )
    assert run_case.main([
        str(case), str(tmp_path / "out.json"), "--arm", "v3", "--run", "1",
        "--reuse-beats", "--cache", str(tmp_path),
    ]) == 0
    assert json.loads((tmp_path / "out.json").read_text())["beats"]


def test_the_eval_db_covers_the_whole_control_plane_surface():
    """A case has to be runnable all the way to final.mp4, because that is
    where a compiler bug lives that the scorer cannot see — it reads beats and
    never compiles them. A missing method fails the render three stages in,
    after the money has been spent."""
    import inspect
    import re

    from lusora_worker.evals.harness import EvalDb

    source = "".join(
        inspect.getsource(m)
        for m in (
            __import__("lusora_worker.pipeline.steps", fromlist=["x"]),
            __import__("lusora_worker.providers.sources", fromlist=["x"]),
        )
    )
    needed = set(re.findall(r"ctx\.db\.([a-z_]+)", source))
    missing = sorted(n for n in needed if not hasattr(EvalDb("c", "a", dsn=None), n))
    assert missing == [], f"EvalDb cannot carry a real run: missing {missing}"
