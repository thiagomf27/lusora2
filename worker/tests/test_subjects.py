"""The subjects pass (D102, documentary plan slice 2).

Run 01 of the Centralia benchmark: each span was searched as its own words, so
"for almost 20 years, the town lived with it" became "1970s street children",
and a long beat split into five shots searched "abandoned town grassy streets"
five times. These tests pin the three pieces that remove both failures: the
subjects document, beat craft naming a subject per beat, and each shot of a
beat rotating through its beat's and its subject's searches.
"""

import json

import pytest

from lusora_worker import validators
from lusora_worker.agents import beatcraft
from lusora_worker.agents import subjects as subjects_agent
from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.providers.llm import LLMResult
from lusora_worker.providers.sources import shot_queries

from test_agents import CFG, FakeDb

CUTS = [
    {"index": 0, "script_text": "In a quiet corner of Pennsylvania, the ground is burning.", "start_s": 0.0, "end_s": 4.0},
    {"index": 1, "script_text": "Steam still rises from cracks in the soil.", "start_s": 4.0, "end_s": 7.5},
    {"index": 2, "script_text": "In the late 1800s, Centralia was a busy coal town.", "start_s": 7.5, "end_s": 11.0},
    {"index": 3, "script_text": "For almost 20 years, the town lived with it.", "start_s": 11.0, "end_s": 14.0},
]


def good_doc(**over):
    doc = {
        "version": "1.0",
        "video_id": "vid_s",
        "main_idea": "A Pennsylvania coal town emptied by a mine fire that still burns underground.",
        "visual_thread": ["underground coal fire", "abandoned coal town"],
        "subjects": [
            {"id": "s1", "name": "the mine fire", "queries": ["smoke rising from ground", "underground coal fire"], "first_cut": 0},
            {"id": "s2", "name": "Centralia, coal town", "queries": ["1890s coal town", "anthracite miners"], "first_cut": 2},
        ],
        "hook_end_cut": 1,
        "title": "The Town That Is Still Burning",
    }
    doc.update(over)
    return doc


def ctx_for(tmp_path, **cfg_over):
    cfg = json.loads(json.dumps(CFG))
    cfg.update(cfg_over)
    return StageContext(
        video={"id": "vid_s", "channel_id": "CH", "title": "Centralia"},
        folder=tmp_path, cfg=cfg, db=FakeDb(), config=None,
    )


def reply(doc):
    return LLMResult(text=json.dumps(doc), input_tokens=800, output_tokens=300)


# ---------------- the document ----------------


def test_a_good_subjects_doc_passes():
    assert validators.validate_subjects(good_doc(), len(CUTS)) == []


@pytest.mark.parametrize("change, expected", [
    ({"visual_thread": ["a very long sentence that is not a search at all", "coal fire"]}, "is 11 words"),
    ({"hook_end_cut": 9}, "hook_end_cut 9 is not a cut"),
    ({"subjects": [{"id": "s2", "name": "x", "queries": ["a b", "c d"], "first_cut": 0}]}, "ids run s1, s2"),
    ({"subjects": [{"id": "s1", "name": "x", "queries": ["a b", "c d"], "first_cut": 7}]}, "first_cut 7 is not a cut"),
    ({"subjects": [{"id": "s1", "name": "x", "queries": ["coal fire", "Coal fire"], "first_cut": 0}]}, "repeats a query"),
])
def test_what_the_schema_cannot_say_is_still_refused(change, expected):
    problems = validators.validate_subjects(good_doc(**change), len(CUTS))
    assert any(expected in p for p in problems), problems


def test_the_shape_is_checked_before_the_content():
    problems = validators.validate_subjects({"version": "1.0"}, len(CUTS))
    assert problems and all("hook_end_cut" not in p or "required" in p for p in problems)


# ---------------- the call ----------------


def test_a_rejected_answer_is_repaired_with_every_violation(tmp_path):
    ctx = ctx_for(tmp_path)
    users = []
    answers = [good_doc(hook_end_cut=40), good_doc()]

    def chat(provider, model, system, user, max_tokens, temperature):
        users.append(user)
        return reply(answers.pop(0))

    doc = subjects_agent.find_subjects(ctx, CUTS, 14.0, chat_fn=chat)
    assert doc["subjects"][1]["id"] == "s2"
    assert doc["video_id"] == "vid_s", "the id is ours, not the model's"
    assert "hook_end_cut 40 is not a cut" in users[1]
    assert "[3] (3.0s) For almost 20 years" in users[0], "the model reads every cut, numbered"


def test_three_bad_answers_stop_the_stage(tmp_path):
    ctx = ctx_for(tmp_path)

    def chat(*_args):
        return LLMResult(text="not json", input_tokens=1, output_tokens=1)

    with pytest.raises(StageError, match="subjects failed after 3 attempts"):
        subjects_agent.find_subjects(ctx, CUTS, 14.0, chat_fn=chat)


def test_the_mock_path_writes_a_valid_document(tmp_path):
    doc = subjects_agent.fallback_subjects(ctx_for(tmp_path), CUTS)
    assert validators.validate_subjects(doc, len(CUTS)) == []


# ---------------- beat craft ----------------


def test_beat_craft_sees_the_subjects_only_when_the_stage_ran(tmp_path):
    ctx = ctx_for(tmp_path)
    _, without = beatcraft._build_prompt(ctx, CUTS, 14.0, "")
    assert "WHAT THIS VIDEO IS ABOUT" not in without, "every other pipeline composes the old prompt"

    ctx.write_json("subjects.json", good_doc())
    _, with_subjects = beatcraft._build_prompt(ctx, CUTS, 14.0, "")
    assert "MAIN IDEA: A Pennsylvania coal town" in with_subjects
    assert "s2: Centralia, coal town (from cut 2; searches: 1890s coal town, anthracite miners)" in with_subjects
    assert '"subject"' in with_subjects


def test_beat_craft_must_name_a_known_subject_for_every_span(tmp_path):
    ctx = ctx_for(tmp_path)
    ctx.write_json("subjects.json", good_doc())
    craft = {"beats": {"0": {"subject": "s1"}, "1": {}, "2": {"subject": "s9"}, "3": {"subject": "s2"}}}
    problems = beatcraft._subject_violations(ctx, CUTS, craft)
    assert any(p.startswith("cut 1: no `subject`") for p in problems)
    assert any("cut 2: subject 's9' is not one of s1, s2" in p for p in problems)
    assert len(problems) == 2


def test_without_subjects_nobody_is_asked_for_one(tmp_path):
    ctx = ctx_for(tmp_path)
    assert beatcraft._subject_violations(ctx, CUTS, {"beats": {"0": {}}}) == []


def test_subject_survives_the_merge():
    doc = beatcraft.merge(CUTS[:1], {"beats": {"0": {"visual_intent": "smoke", "subject": "s1"}}}, "vid_s")
    assert doc["beats"][0]["subject"] == "s1"


# ---------------- the searches ----------------


def test_each_shot_of_a_beat_asks_a_different_question():
    beat = ["abandoned town grassy streets", "empty coal town"]
    subject = ["smoke rising from ground", "underground coal fire"]
    thread = ["coal mine fire"]
    firsts = [shot_queries(beat, subject, thread, k)[0] for k in range(4)]
    assert firsts == ["abandoned town grassy streets", "empty coal town",
                      "smoke rising from ground", "underground coal fire"]


def test_the_thread_is_the_last_resort_and_nothing_repeats():
    queries = shot_queries(["coal fire", "empty town"], ["Coal Fire", "burning ground"], ["empty town", "coal town"], 0)
    assert queries == ["coal fire", "empty town", "burning ground", "coal town"]


def test_a_span_that_names_nothing_still_searches_the_story():
    assert shot_queries([], [], ["underground coal fire"], 3) == ["underground coal fire"]


# ---------------- resolve_assets, end to end ----------------


class RecordingStock:
    """A stand-in keyword source: records which query each shot asked FIRST."""

    query_kind = "keyword"

    def __init__(self):
        self.first_query: dict[str, str] = {}

    def resolve(self, ctx, item, query, source_cfg, ledger=None):
        from lusora_worker.providers import sources

        self.first_query.setdefault(item["id"], query)
        path = f"clips/{item['id']}.jpg"
        (ctx.folder / path).write_bytes(item["id"].encode())
        return sources.Resolution(source="stock", id=item["id"], provider="pexels", license="cc0",
                                  path=path, score=0.9, query=query, media_type="image")


def _resolve_video(tmp_path, with_subjects):
    from lusora_worker.pipeline import steps

    (tmp_path / "clips").mkdir()
    # b1 is one long beat the compiler split into three shots; b2 names nothing
    items = [{"id": f"v{i}", "beat_id": b, "start_s": 3.0 * i, "end_s": 3.0 * (i + 1), "asset": {}}
             for i, b in enumerate(["b1", "b1", "b1", "b2"])]
    (tmp_path / "edit_plan.json").write_text(json.dumps({"tracks": {"visual": items, "overlays": []}}))
    (tmp_path / "beats.json").write_text(json.dumps({"beats": [
        {"id": "b1", "visual_intent": "empty streets", "queries": ["abandoned town streets"], "subject": "s1"},
        {"id": "b2", "visual_intent": "the town lived with it", "queries": [], "subject": "s2"},
    ]}))
    if with_subjects:
        (tmp_path / "subjects.json").write_text(json.dumps(good_doc()))
    db = FakeDb()
    db.asset_usage = lambda *a: None
    db.provider_health = lambda *a, **k: None
    ctx = StageContext(video={"id": "vid_s", "channel_id": "CH", "title": "T"}, folder=tmp_path,
                       cfg={"source_policy": {"visual": {"chain": [{"source": "stock"}]}},
                            "budget": {"max_usd_per_video": 1}},
                       db=db, config=None)
    return steps, ctx


def test_resolve_rotates_split_shots_and_anchors_empty_spans(tmp_path, monkeypatch):
    from lusora_worker.providers import sources

    monkeypatch.setenv("ASSET_PARALLELISM", "1")
    saved = dict(sources.ADAPTERS)
    try:
        sources.ADAPTERS["stock"] = stock = RecordingStock()
        steps, ctx = _resolve_video(tmp_path, with_subjects=True)
        steps.run_resolve_assets(ctx)
    finally:
        sources.ADAPTERS.clear()
        sources.ADAPTERS.update(saved)
    assert [stock.first_query[f"v{i}"] for i in range(3)] == [
        "abandoned town streets", "smoke rising from ground", "underground coal fire",
    ], "three shots of one beat, three different questions"
    assert stock.first_query["v3"] == "1890s coal town", "a span naming nothing searches its subject"


def test_without_subjects_resolve_asks_what_it_always_did(tmp_path, monkeypatch):
    from lusora_worker.providers import sources

    monkeypatch.setenv("ASSET_PARALLELISM", "1")
    saved = dict(sources.ADAPTERS)
    try:
        sources.ADAPTERS["stock"] = stock = RecordingStock()
        steps, ctx = _resolve_video(tmp_path, with_subjects=False)
        steps.run_resolve_assets(ctx)
    finally:
        sources.ADAPTERS.clear()
        sources.ADAPTERS.update(saved)
    assert [stock.first_query[f"v{i}"] for i in range(3)] == ["abandoned town streets"] * 3
