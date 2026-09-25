"""The directed-edit pipeline (docs/05-roadmap/directed-edit-test.md, slice 4, D94).

Built on the script and block of the first hand run, cut with no transcript
(proportional timing) at its estimated 111 s. The headline guarantees:

- faceless_v3 is untouched: same stage list minus one, same cut without the
  manifest's switch, even with an edit_hints.json lying in the folder;
- the cut keeps every pin whole, one graphic and one shot per beat, and starts
  every emphasis graphic's beat on its phrase;
- the applied sheet passes the UNCHANGED validator, and a block that no longer
  fits fails before any model is called.
"""

from __future__ import annotations

import copy
import json

import lusora_contracts
import pytest
from lusora_contracts.pipelines import load_pipeline

from lusora_worker import edithints, validators
from lusora_worker.agents import beatcraft
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.pipeline import steps
from lusora_worker.pipeline.stages import build_stages

from test_agents import CFG, FakeDb

FIXTURES = lusora_contracts.CONTRACTS_ROOT / "fixtures"
RULES = json.loads((FIXTURES / "rules" / "edit_hints_rules.json").read_text(encoding="utf-8"))
HINTS = json.loads((FIXTURES / "edit_hints.json").read_text(encoding="utf-8"))
SCRIPT: str = RULES["script"]
DURATION = 111.0
BASIC = RULES["style"]["overlays"]["allowed_components"]


def _pack() -> dict:
    """directed-test as a video on the test channel sees it: basic's seven."""
    pack = json.loads((lusora_contracts.CONTRACTS_ROOT / "style-packs" / "directed-test.json").read_text())
    pack["overlays"]["allowed_components"] = list(BASIC)
    return pack


def _cfg(pipeline: str = "faceless_directed", llm: str = "mock") -> dict:
    cfg = copy.deepcopy(CFG)
    cfg["planner"] = {"llm": llm}
    cfg["style_pack_doc"] = _pack()
    cfg["pipeline_doc"] = load_pipeline(pipeline)
    return cfg


def _ctx(tmp_path, cfg: dict | None = None, hints: dict | None = HINTS) -> StageContext:
    (tmp_path / "script.txt").write_text(SCRIPT, encoding="utf-8")
    (tmp_path / "audio.mp3").write_bytes(b"")
    if hints is not None:
        (tmp_path / "edit_hints.json").write_text(json.dumps(hints, ensure_ascii=False), encoding="utf-8")
    return StageContext(
        video={"id": "vid_d", "channel_id": "CH", "title": "T"},
        folder=tmp_path, cfg=cfg or _cfg(), db=FakeDb(), config=None,
    )


@pytest.fixture(autouse=True)
def _real_length(monkeypatch):
    monkeypatch.setattr(steps, "probe_duration", lambda stage, path: DURATION)


def _ranges(parts) -> list[tuple[int, int]]:
    out, cursor = [], 0
    for part in parts:
        n = len(part.text.split())
        out.append((cursor, cursor + n - 1))
        cursor += n
    return out


# ---------------- the manifest ----------------


def test_the_directed_manifest_is_v3_minus_select_overlays_plus_edit_hints():
    """One variable for the A/B: who makes the edit decisions."""
    v3 = [s["name"] for s in load_pipeline("faceless_v3")["stages"]]
    directed = [s["name"] for s in load_pipeline("faceless_directed")["stages"]]
    expected = [n for n in v3 if n != "select_overlays"]
    expected.insert(expected.index("script") + 1, "edit_hints")
    assert directed == expected
    manifest = load_pipeline("faceless_directed")
    assert manifest["stability"] == "test" and manifest["bulk_production_accepted"] is False


def test_the_edit_hints_stage_runs_before_narration_and_judges_what_changed(tmp_path):
    stages = {s.name: s for s in build_stages(load_pipeline("faceless_directed"))}
    names = list(stages)
    assert names.index("edit_hints") < names.index("narration"), "a bad block must fail before paid TTS"
    stage = stages["edit_hints"]
    ctx = _ctx(tmp_path)
    assert not stage.done(ctx), "present is exactly the case that needs judging"

    # The orchestrator's own sequence: run, then re-ask the done-check to confirm
    # the stage produced its artifact. A never-true check failed here on the
    # first real video (vid_8d7284f07a23).
    stage.run(ctx)
    assert stage.done(ctx), "a block that just passed must count as done"

    changed = copy.deepcopy(HINTS)
    changed["pins"].pop()
    (tmp_path / "edit_hints.json").write_text(json.dumps(changed, ensure_ascii=False), encoding="utf-8")
    assert not stage.done(ctx), "a different block is judged again"
    stage.run(ctx)
    assert stage.done(ctx)
    (tmp_path / "script.txt").write_text(SCRIPT + " ", encoding="utf-8")
    assert not stage.done(ctx), "so is a different script"


def test_a_block_that_fails_leaves_no_stamp(tmp_path):
    broken = copy.deepcopy(HINTS)
    broken["pins"][1]["at"] = "Número cinco, a genkan"
    ctx = _ctx(tmp_path, hints=broken)
    with pytest.raises(StageError):
        steps.run_edit_hints(ctx)
    assert not (tmp_path / steps.EDIT_HINTS_STAMP).exists()
    assert not steps.edit_hints_checked(ctx)


# ---------------- nothing else changes ----------------


def test_v3_cuts_exactly_as_before_even_with_a_block_in_the_folder(tmp_path):
    """The switch is the manifest SNAPSHOT, never a stray file."""
    plain = steps.cut_script(_ctx(tmp_path / "a" if (tmp_path / "a").mkdir() is None else tmp_path,
                                  _cfg("faceless_v3"), hints=None), SCRIPT, DURATION)
    (tmp_path / "b").mkdir()
    with_file = steps.cut_script(_ctx(tmp_path / "b", _cfg("faceless_v3")), SCRIPT, DURATION)
    assert [(p.text, p.start_s, p.end_s) for p in with_file] == [(p.text, p.start_s, p.end_s) for p in plain]


def test_v3_hands_the_planner_no_menu_and_neither_does_directed(tmp_path):
    for name in ("faceless_v3", "faceless_directed"):
        assert steps._planner_menu_for(_ctx(tmp_path, _cfg(name))) == "", name
    assert steps._planner_menu_for(_ctx(tmp_path, _cfg("faceless"))) != ""


# ---------------- the cut ----------------


def test_the_directed_cut_keeps_pins_whole_and_one_graphic_per_beat(tmp_path):
    parts = steps.cut_script(_ctx(tmp_path), SCRIPT, DURATION)
    assert " ".join(p.text for p in parts).split() == SCRIPT.split(), "verbatim, in order"
    spans = edithints.pin_spans(HINTS, SCRIPT)
    ranges = _ranges(parts)
    for span in spans:
        holding = [r for r in ranges if r[0] <= span["start"] <= r[1]]
        assert len(holding) == 1 and span["end"] <= holding[0][1], f"pin {span['n']} straddles a cut"
        if span["emphasis"]:
            assert holding[0][0] == span["start"], f"emphasis pin {span['n']} does not start its beat"
    for lo, hi in ranges:
        inside = [s for s in spans if lo <= s["start"] <= hi]
        assert sum(s["graphic"] for s in inside) <= 1
        assert sum(s["shot"] for s in inside) <= 1


def test_only_the_cuts_near_a_pin_move(tmp_path):
    """The A/B compares edit decisions, so the directed cut should equal the
    control's except where a pin forced a change: a piece that moved either
    holds a pin, or is the remainder a pin's cut left beside it (an emphasis
    pin cutting mid-sentence leaves the words before it as their own beat)."""
    (tmp_path / "v3").mkdir()
    (tmp_path / "d").mkdir()
    v3 = {p.text for p in steps.cut_script(_ctx(tmp_path / "v3", _cfg("faceless_v3"), hints=None), SCRIPT, DURATION)}
    directed = [p.text for p in steps.cut_script(_ctx(tmp_path / "d"), SCRIPT, DURATION)]
    spans = edithints.pin_spans(HINTS, SCRIPT)
    ranges = _ranges_from_texts(directed)
    holds = [any(lo <= s["start"] <= hi for s in spans) for lo, hi in ranges]
    for i, text in enumerate(directed):
        if text in v3 or holds[i]:
            continue
        neighbours = holds[max(0, i - 1):i] + holds[i + 1:i + 2]
        assert any(neighbours), f"a cut far from every pin moved: {text!r}"


def _ranges_from_texts(texts):
    out, cursor = [], 0
    for text in texts:
        n = len(text.split())
        out.append((cursor, cursor + n - 1))
        cursor += n
    return out


def test_two_graphics_in_one_sentence_are_separated():
    """A sentence holding two graphic pins becomes two beats, cut at the second."""
    from lusora_worker import beatphases

    script = "In 1943 the port moved 70% of the grain and fed four million people."
    hints = {"style_pack": "directed-test", "sections": [{"from": "In 1943 the", "mood": "neutral"}],
             "pins": [
                 {"at": "70% of the grain", "anchor": {"type": "percentage", "value": 70},
                  "overlay": {"component": "TextCounter"}},
                 {"at": "four million people", "overlay": {"component": "TextTag",
                                                          "props_hint": {"text": "4 million"}}},
             ]}
    part = beatphases.Piece(script, 0.0, 6.0)
    parts = steps.respect_pins([part], edithints.pin_spans(hints, script), min_hold=2.0)
    assert [p.text for p in parts][-1].startswith("four million"), [p.text for p in parts]
    assert parts[0].start_s == 0.0 and parts[-1].end_s == 6.0
    assert all(a.end_s == b.start_s for a, b in zip(parts, parts[1:])), "the pieces still tile the span"


# ---------------- the stage ----------------


def test_a_missing_block_fails_the_stage_loudly(tmp_path):
    with pytest.raises(StageError, match="paste the script and the edit block"):
        steps.run_edit_hints(_ctx(tmp_path, hints=None))


def test_a_block_that_does_not_fit_fails_before_narration(tmp_path):
    broken = copy.deepcopy(HINTS)
    broken["pins"][1]["at"] = "Número cinco, a genkan"
    with pytest.raises(StageError, match="not in the script"):
        steps.run_edit_hints(_ctx(tmp_path, hints=broken))


def test_the_worker_catches_the_number_the_paste_box_cannot(tmp_path):
    wrong = copy.deepcopy(HINTS)
    wrong["pins"][9]["anchor"]["value"] = 70   # the narration says oitenta
    with pytest.raises(StageError, match="not the number spoken"):
        steps.run_edit_hints(_ctx(tmp_path, hints=wrong))


def test_a_good_block_passes_and_its_warnings_are_logged(tmp_path):
    ctx = _ctx(tmp_path)
    steps.run_edit_hints(ctx)
    log = (tmp_path / "production.log").read_text(encoding="utf-8")
    assert "edit block accepted: 3 sections, 15 pins (13 graphics, 9 shots)" in log
    assert "edit block warning" in log and "Número três, o ofurô" in log


# ---------------- plan_beats ----------------


def _plan(tmp_path, cfg=None, hints=HINTS) -> dict:
    ctx = _ctx(tmp_path, cfg, hints)
    steps.run_cut_beats(ctx)
    steps.run_plan_beats(ctx)
    return ctx.read_json("beats.json")


def test_the_block_lands_on_the_sheet_and_passes_the_unchanged_validator(tmp_path):
    doc = _plan(tmp_path)
    assert validators.validate_beat_sheet(doc, SCRIPT, _cfg(), DURATION) == []
    overlays = [b for b in doc["beats"] if b.get("overlay")]
    assert len(overlays) == 13
    counter = next(b for b in overlays if b["overlay"]["component"] == "TextCounter")
    anchor = counter["anchors"][counter["overlay"]["anchor_ref"]]
    # the SCRIPT's words, not the author's copy
    assert anchor["source_words"] == "Cerca de oitenta por cento"
    assert counter["overlay"]["role"] == "anchor"
    genkan = next(b for b in doc["beats"] if "genkan entryway" in b["visual_intent"])
    assert genkan["media_preference"] == "video" and genkan["queries"][0] == "Japanese genkan entrance"


def test_moods_follow_the_sections(tmp_path):
    doc = _plan(tmp_path)
    moods = [b["mood"] for b in doc["beats"]]
    first_three = next(i for i, b in enumerate(doc["beats"]) if b["script_text"].startswith("Número três"))
    first_one = next(i for i, b in enumerate(doc["beats"]) if b["script_text"].startswith("Número um"))
    assert set(moods[:first_three]) == {"playful"}
    assert set(moods[first_three:first_one]) == {"reflective"}
    assert set(moods[first_one:]) == {"hopeful"}


def test_the_planner_is_called_without_a_menu_and_its_overlays_are_dropped(tmp_path, monkeypatch):
    """DeepSeek fills no unused budget (D94): the block is the whole overlay decision."""
    seen = {}

    def fake_craft(ctx, cuts, script, audio_duration, menu="", chat_fn=None):
        seen["menu"] = menu
        doc = beatcraft.merge(cuts, {"beats": {}}, ctx.video_id)
        doc["beats"][2]["anchors"] = [{"type": "number", "value": 1, "source_words": doc["beats"][2]["script_text"].split()[0]}]
        doc["beats"][2]["overlay"] = {"component": "TextCounter", "anchor_ref": 0}
        return doc

    monkeypatch.setattr(beatcraft, "craft_beats", fake_craft)
    doc = _plan(tmp_path, _cfg(llm="deepseek"))
    assert seen["menu"] == ""
    assert sum(1 for b in doc["beats"] if b.get("overlay")) == 13, "only the block's graphics survive"


def test_a_block_over_budget_at_the_real_length_fails_before_any_model_call(tmp_path, monkeypatch):
    def boom(*a, **k):
        raise AssertionError("no model may be called for a block that cannot fit")

    monkeypatch.setattr(beatcraft, "craft_beats", boom)
    cfg = _cfg(llm="deepseek")
    cfg["style_pack_doc"]["overlays"]["emphasis"]["per_minute"] = 1  # 12 emphasis vs a ceiling of 3
    ctx = _ctx(tmp_path, cfg)
    steps.run_cut_beats(ctx)
    with pytest.raises(StageError, match="does not fit the narration as recorded"):
        steps.run_plan_beats(ctx)


def test_a_pin_straddling_two_beats_is_refused_rather_than_guessed():
    beats = {"version": "1.1", "video_id": "v", "beats": [
        {"id": "b1", "kind": "narration", "script_text": "Cerca de oitenta", "visual_intent": "x shot"},
        {"id": "b2", "kind": "narration", "script_text": "por cento.", "visual_intent": "y shot"},
    ]}
    hints = {"style_pack": "directed-test", "sections": [{"from": "Cerca de", "mood": "neutral"}],
             "pins": [{"at": "oitenta por cento", "anchor": {"type": "percentage", "value": 80},
                       "overlay": {"component": "TextCounter"}}]}
    with pytest.raises(ValueError, match="straddles"):
        edithints.apply_edit_hints(beats, "Cerca de oitenta por cento.", hints)


def test_the_directed_sheet_compiles(tmp_path):
    """The whole point: the applied sheet becomes a plan with the block's graphics on it."""
    from lusora_worker.compiler import compile_plan
    from lusora_worker.textsplit import split_sentences

    doc = _plan(tmp_path)
    sentences = split_sentences(SCRIPT)
    total = sum(len(s) for s in sentences)
    timings, cursor = [], 0.0
    for s in sentences:
        end = cursor + DURATION * len(s) / total
        timings.append({"text": s, "start_s": round(cursor, 3), "end_s": round(end, 3)})
        cursor = end
    plan = compile_plan(doc, timings, _cfg(), DURATION)
    placed = [o["component"] for o in plan["tracks"]["overlays"]]
    assert "TextCounter" in placed and "TextBanner" in placed
    assert len(placed) >= 11, placed  # the compiler may drop one squeezed below its readable minimum
