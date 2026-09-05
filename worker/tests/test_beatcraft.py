"""cut_beats + beatcraft: code cuts, the model decorates (slice 6, D88).

The headline is `test_verbatim_coverage_cannot_fail_on_the_indexed_path`. Every
other test here is about that guarantee holding under the ways a model actually
misbehaves — a missing index, an invented one, the narration handed back
anyway.
"""

import json

import pytest

from lusora_worker import validators
from lusora_worker.agents import beatcraft
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.pipeline import steps
from lusora_worker.providers.llm import LLMResult

from test_agents import CFG, FakeDb

SCRIPT = (
    "The port fed the capital. Nearly 70% of all grain passed through it. "
    "By 1943 the quays were working around the clock."
)

SRT = """1
00:00:00,000 --> 00:00:04,000
The port fed the capital.

2
00:00:04,000 --> 00:00:09,000
Nearly 70% of all grain passed through it.

3
00:00:09,000 --> 00:00:14,000
By 1943 the quays were working around the clock.
"""


def _ctx(tmp_path, cfg=None):
    folder = tmp_path
    (folder / "script.txt").write_text(SCRIPT, encoding="utf-8")
    (folder / "subtitles.srt").write_text(SRT, encoding="utf-8")
    return StageContext(
        video={"id": "vid_c", "channel_id": "CH", "title": "T"},
        folder=folder,
        cfg=cfg or json.loads(json.dumps(CFG)),
        db=FakeDb(),
        config=None,
    )


def _cuts(ctx):
    parts = steps.cut_script(ctx, SCRIPT, 14.0)
    return [
        {"index": i, "script_text": p.text, "start_s": round(p.start_s, 3),
         "end_s": round(p.end_s, 3)}
        for i, p in enumerate(parts)
    ]


def _craft(cuts, **over):
    answers = {
        str(c["index"]): {"visual_intent": f"a harbour at work, shot {c['index']}",
                          "queries": ["harbour 1940s"], "mood": "neutral"}
        for c in cuts
    }
    answers.update(over.pop("beats", {}))
    return {"beats": answers, **over}


def _reply(doc):
    return LLMResult(text=json.dumps(doc), input_tokens=400, output_tokens=300)


# ---------------- the cuts ----------------


def test_cut_beats_spans_concatenate_to_the_script(tmp_path):
    """The deterministic guarantee everything else rests on."""
    from lusora_worker.textsplit import normalize

    cuts = _cuts(_ctx(tmp_path))
    joined = " ".join(c["script_text"] for c in cuts)
    assert normalize(joined) == normalize(SCRIPT)


def test_cut_beats_uses_the_real_srt_timings(tmp_path):
    """The information the model never had: when each span is actually spoken."""
    cuts = _cuts(_ctx(tmp_path))
    assert cuts[0]["start_s"] == 0.0
    assert cuts[-1]["end_s"] == pytest.approx(14.0, abs=0.5)
    for a, b in zip(cuts, cuts[1:]):
        assert a["end_s"] <= b["start_s"] + 0.001, "spans must not overlap"


def test_cut_beats_respects_the_packs_hold_floor(tmp_path):
    """The style pack still governs: a pack with a long floor joins spans that
    a pack with none would leave apart."""
    loose = json.loads(json.dumps(CFG))
    loose["style_pack_doc"]["pacing"]["min_hold"] = 0.0
    tight = json.loads(json.dumps(CFG))
    tight["style_pack_doc"]["pacing"]["min_hold"] = 10.0
    assert len(_cuts(_ctx(tmp_path, tight))) < len(_cuts(_ctx(tmp_path, loose)))


def test_the_mock_planner_and_cut_beats_share_one_implementation(tmp_path):
    """No second copy of the cutting logic: the fallback planner's beats and
    the stage's cuts are the same spans, in the same order."""
    ctx = _ctx(tmp_path)
    fallback = steps._fallback_planner(ctx, SCRIPT, 14.0)
    cuts = _cuts(ctx)
    assert [b["script_text"] for b in fallback["beats"]] == [c["script_text"] for c in cuts]


def test_the_stage_writes_a_schema_valid_artifact(tmp_path, monkeypatch):
    import jsonschema
    from lusora_contracts import load_schema

    ctx = _ctx(tmp_path)
    (tmp_path / "audio.mp3").write_bytes(b"")
    monkeypatch.setattr(steps, "probe_duration", lambda stage, path: 14.0)
    steps.run_cut_beats(ctx)
    jsonschema.validate(ctx.read_json("beat_cuts.json"), load_schema("beat_cuts"))


# ---------------- the indexed call ----------------


def test_the_indexed_planner_never_echoes_script_text(tmp_path):
    """The composed prompt asks for indices, and the parsed answer carries no
    narration."""
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    seen: dict[str, str] = {}

    def chat_fn(provider, model, system, user, max_tokens, temperature=None):
        seen["system"], seen["user"] = system, user
        return _reply(_craft(cuts))

    doc = beatcraft.craft_beats(ctx, cuts, SCRIPT, 14.0, chat_fn=chat_fn)
    assert "Answer by INDEX" in seen["system"]
    assert "[0] (" in seen["user"], "the cuts must be numbered in the prompt"
    assert "script_text" not in json.dumps(_craft(cuts))
    assert [b["script_text"] for b in doc["beats"]] == [c["script_text"] for c in cuts]


def test_verbatim_coverage_cannot_fail_on_the_indexed_path(tmp_path):
    """THE headline. A deliberately sloppy answer — one index dropped, one
    invented, one handing the narration back mangled — and the merged sheet
    still covers the script exactly, because the model never owned the text."""
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    sloppy = {
        "beats": {
            "0": {"visual_intent": "a harbour", "script_text": "THE PORT FED THE CAPITOL"},
            "99": {"visual_intent": "a cut that does not exist"},
        }
    }
    doc = beatcraft.merge(cuts, sloppy, "vid_c")
    violations = validators.validate_beat_sheet(doc, SCRIPT, ctx.cfg, 14.0)
    coverage = [v for v in violations if "verbatim" in v or "cover" in v]
    assert coverage == [], violations
    assert [b["script_text"] for b in doc["beats"]] == [c["script_text"] for c in cuts]


def test_the_merged_sheet_passes_the_unchanged_validator(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    doc = beatcraft.merge(cuts, _craft(cuts), "vid_c")
    assert validators.validate_beat_sheet(doc, SCRIPT, ctx.cfg, 14.0) == []


def test_a_cut_with_no_answer_still_becomes_a_beat(tmp_path):
    """A missing index degrades ONE shot instead of failing a video: merge
    fills a visual_intent from the cut's own words."""
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    doc = beatcraft.merge(cuts, {"beats": {}}, "vid_c")
    assert len(doc["beats"]) == len(cuts)
    assert all(b["visual_intent"] for b in doc["beats"])
    assert validators.validate_beat_sheet(doc, SCRIPT, ctx.cfg, 14.0) == []


def test_an_answer_naming_an_unknown_index_is_repaired(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    violations = beatcraft._index_violations(cuts, {"beats": {"0": {}, "99": {}}})
    assert any("index 99" in v for v in violations), violations


def test_an_answer_missing_an_index_is_repaired(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    violations = beatcraft._index_violations(cuts, {"beats": {"0": {}}})
    assert any("no answer for index" in v for v in violations), violations


def test_an_answer_handing_the_narration_back_is_told_not_to(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    craft = {"beats": {str(c["index"]): {"script_text": "…"} for c in cuts}}
    violations = beatcraft._index_violations(cuts, craft)
    assert any("returned script_text" in v for v in violations), violations


def test_the_repair_loop_feeds_the_violations_back(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    seen: list[str] = []

    def chat_fn(provider, model, system, user, max_tokens, temperature=None):
        seen.append(user)
        if len(seen) == 1:
            return _reply({"beats": {"0": {"visual_intent": "only the first"}}})
        return _reply(_craft(cuts))

    beatcraft.craft_beats(ctx, cuts, SCRIPT, 14.0, chat_fn=chat_fn)
    assert "no answer for index" in seen[1]


def test_three_bad_answers_stop_with_one_reason(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    with pytest.raises(StageError, match="beat craft failed after 3 attempts"):
        beatcraft.craft_beats(
            ctx, cuts, SCRIPT, 14.0,
            chat_fn=lambda *a: _reply({"beats": {"99": {"visual_intent": "wrong"}}}),
        )


def test_the_craft_call_is_billed_under_its_own_operation(tmp_path):
    ctx = _ctx(tmp_path)
    cuts = _cuts(ctx)
    beatcraft.craft_beats(ctx, cuts, SCRIPT, 14.0, chat_fn=lambda *a: _reply(_craft(cuts)))
    completed = [e for e in ctx.db.cost_events if e["status"] == "completed"]
    assert [e["operation"] for e in completed] == ["llm.craft_beats"]


def test_the_craft_call_carries_no_menu_when_overlays_are_a_separate_stage(tmp_path):
    """Two decisions must not both pay for the catalog (D87 + D88)."""
    from lusora_contracts.pipelines import load_pipeline

    cfg = json.loads(json.dumps(CFG))
    cfg["pipeline_doc"] = load_pipeline("faceless_v3")
    ctx = _ctx(tmp_path, cfg)
    assert steps._planner_menu_for(ctx) == ""

    cfg_v1 = json.loads(json.dumps(CFG))
    cfg_v1["pipeline_doc"] = load_pipeline("faceless")
    assert "AnimatedCounter" in steps._planner_menu_for(_ctx(tmp_path, cfg_v1))


def test_faceless_still_plans_in_one_call(tmp_path, monkeypatch):
    """v1 regression guard: with no beat_cuts.json the stage takes the
    single-call path and never reaches the indexed one."""
    from lusora_worker.agents import planner as planner_agent

    ctx = _ctx(tmp_path)
    ctx.cfg["planner"] = {"llm": "deepseek"}
    (tmp_path / "audio.mp3").write_bytes(b"")
    monkeypatch.setattr(steps, "probe_duration", lambda stage, path: 14.0)

    def boom(*a, **k):
        raise AssertionError("the indexed path must not run without beat_cuts.json")

    monkeypatch.setattr(beatcraft, "craft_beats", boom)
    monkeypatch.setattr(
        planner_agent, "plan_beats",
        lambda *a, **k: {"version": "1.1", "video_id": "vid_c", "beats": [
            {"id": "b1", "kind": "narration", "script_text": SCRIPT,
             "visual_intent": "a harbour"}]},
    )
    steps.run_plan_beats(ctx)
    assert ctx.has("beats.json")
