"""The hook's moments on screen (D107, documentary plan slice 6a).

Dark Palace's "Manchetes": the model picks two to five moments of the hook and
a form for each; code keeps only the moments that obey every rule. These pin
the rules — landing words the beat says, no number it does not, one moment per
beat, never on a graphic, never two full-frame cards in a row — and that every
kept moment compiles as an ordinary catalog component a theme can restyle.
"""

import json

import pytest

from lusora_worker.agents import hook_plan
from lusora_worker.compiler import compile_plan
from lusora_worker.providers.llm import LLMResult

BEATS = [
    {"id": "b1", "kind": "narration", "script_text": "In a quiet corner of eastern Pennsylvania, there is a town that burns."},
    {"id": "b2", "kind": "narration", "script_text": "Steam still rises from cracks in the soil."},
    {"id": "b3", "kind": "narration", "script_text": "The town of Centralia, once home to more than 1,000 people, now has just 5."},
    {"id": "b4", "kind": "narration", "script_text": "Nobody set out to destroy it."},
    {"id": "b5", "kind": "narration", "script_text": "In May 1962, the council decided to clean up the dump."},
]


def check(moments, graphic=()):
    return hook_plan.check(moments, BEATS, set(graphic))


def test_every_form_maps_to_a_catalog_component():
    kept, dropped = check([
        {"beat": "b5", "form": "headline", "says": "May 1962", "text": "May 1962"},
        {"beat": "b1", "form": "word", "says": "Pennsylvania", "word": "Pennsylvania", "caption": "a town that burns"},
        {"beat": "b3", "form": "cards", "says": "1,000 people", "title": "Centralia's people",
         "items": [{"value": "1,000", "label": "once"}, {"value": "5", "label": "now"}]},
    ])
    assert dropped == []
    forms = {m["form"]: m for m in kept}
    assert forms["headline"]["component"] == "HammerStatement"
    assert forms["word"]["props"] == {"text": "Pennsylvania", "align": "center", "emphasis": "accent",
                                      "kicker": "a town that burns"}
    assert forms["cards"]["props"]["rows"] == [{"label": "once", "value": "1,000"}, {"label": "now", "value": "5"}]
    assert [m["beat_id"] for m in kept] == ["b1", "b3", "b5"], "back in narration order"


@pytest.mark.parametrize("moment, reason", [
    ({"beat": "b5", "form": "headline", "says": "May 1962", "text": "MAY 1963"}, "number the beat does not say"),
    ({"beat": "b5", "form": "headline", "says": "in June", "text": "JUNE"}, "not said in that beat"),
    ({"beat": "b9", "form": "headline", "says": "x", "text": "X"}, "not a hook beat"),
    ({"beat": "b3", "form": "cards", "says": "just 5", "title": "People",
      "items": [{"value": "1,000", "label": "once"}, {"value": "12", "label": "now"}]}, "exactly two numbers the hook says"),
    ({"beat": "b2", "form": "phrase", "says": "Steam", "text": "Steam rises from the burning soil"}, "copied in order"),
    ({"beat": "b1", "form": "word", "says": "town", "word": "Silent Hill"}, "one word"),
])
def test_a_moment_that_breaks_a_rule_is_dropped_not_repaired(moment, reason):
    kept, dropped = check([moment])
    assert kept == [] and reason in dropped[0], dropped


def test_never_on_a_graphic_beat_never_two_cards_in_a_row_one_per_beat():
    kept, dropped = check([
        {"beat": "b3", "form": "headline", "says": "just 5", "text": "JUST 5"},
        {"beat": "b1", "form": "word", "says": "Pennsylvania", "word": "Pennsylvania"},
        {"beat": "b2", "form": "phrase", "says": "Steam", "text": "Steam still rises from cracks"},
        {"beat": "b5", "form": "headline", "says": "May 1962", "text": "MAY 1962"},
        {"beat": "b5", "form": "headline", "says": "1962", "text": "1962"},
    ], graphic={"b3"})
    assert [(m["form"], m["beat_id"]) for m in kept] == [("word", "b1"), ("headline", "b5")]
    assert any("already carries a graphic" in d for d in dropped)
    assert any("slideshow" in d for d in dropped), "b2's phrase sits next to b1's word"
    assert any("already has a moment" in d for d in dropped)


def test_a_phrase_becomes_a_quote_anchored_passage_that_compiles():
    kept, _ = check([{"beat": "b2", "form": "phrase", "says": "Steam", "text": "Steam still rises from cracks",
                      "highlight": "rises"}])
    assert kept[0]["props"]["marks"] == [{"phrase": "rises", "style": "underline"}]
    beats_doc = {"version": "1.0", "video_id": "v", "beats": [dict(b, visual_intent="shot") for b in BEATS]}
    beats_doc, selection = hook_plan.merge_into_selection(beats_doc, None, {"moments": kept})
    b2 = next(b for b in beats_doc["beats"] if b["id"] == "b2")
    assert b2["anchors"][-1] == {"type": "quote", "value": "Steam still rises from cracks",
                                 "source_words": "Steam still rises from cracks"}
    timings = [{"text": b["script_text"], "start_s": 3.0 * i, "end_s": 3.0 * (i + 1)} for i, b in enumerate(BEATS)]
    cfg = {"style_pack_doc": {"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 6},
                              "overlays": {"density": "normal"}, "transitions": {"allowed": ["cut"], "default": "cut"}},
           "output": {"fps": 30, "width": 1920, "height": 1080}}
    plan = compile_plan(beats_doc, timings, cfg, 15.0, selection)
    passage = next(o for o in plan["tracks"]["overlays"] if o["component"] == "HighlightedPassage")
    assert passage["props"]["text"] == "Steam still rises from cracks" and passage["beat_id"] == "b2"


def test_an_existing_graphic_is_never_replaced():
    selection = {"version": "1.0", "video_id": "v", "declined": [],
                 "selections": [{"beat_id": "b5", "component": "DateStamp", "props_hint": {"date": "May 1962"}}]}
    moments = [{"beat_id": "b5", "form": "headline", "says": "May 1962", "component": "HammerStatement",
                "props": {"text": "MAY 1962"}}]
    _beats, merged = hook_plan.merge_into_selection({"beats": BEATS}, selection, {"moments": moments})
    assert [s["component"] for s in merged["selections"]] == ["DateStamp"]


def test_the_plan_asks_once_and_keeps_only_the_rule_abiding(tmp_path):
    from lusora_worker.context import StageContext

    from test_agents import FakeDb

    ctx = StageContext(video={"id": "v", "channel_id": "C", "title": "T"}, folder=tmp_path,
                       cfg={"planner": {"llm": "deepseek"}, "budget": {"max_usd_per_video": 1}}, db=FakeDb(), config=None)
    users = []

    def chat(provider, model, system, user, *_):
        users.append(user)
        return LLMResult(text=json.dumps({"moments": [
            {"beat": "b5", "form": "headline", "says": "May 1962", "text": "MAY 1962"},
            {"beat": "b5", "form": "headline", "says": "May 1962", "text": "91 DAMPERS"}]}),
            input_tokens=10, output_tokens=10)

    doc = hook_plan.plan(ctx, BEATS, {"b3"}, chat_fn=chat)
    assert "[b3] (GRAPHIC — never put anything here)" in users[0]
    assert [m["props"]["text"] for m in doc["moments"]] == ["MAY 1962"]
    assert len(doc["dropped"]) == 1


def test_classic_mode_plans_nothing(tmp_path):
    from lusora_worker.context import StageContext
    from lusora_worker.pipeline import steps

    from test_agents import FakeDb

    ctx = StageContext(video={"id": "v", "channel_id": "C", "title": "T"}, folder=tmp_path,
                       cfg={"style_pack_doc": {"pacing": {"hook": {"enabled": True, "mode": "classic"}}}},
                       db=FakeDb(), config=None)
    (tmp_path / "audio.mp3").write_bytes(b"")
    import lusora_worker.pipeline.steps as s
    orig = s.probe_duration
    s.probe_duration = lambda *_a: 100.0
    try:
        steps.run_hook_plan(ctx)
    finally:
        s.probe_duration = orig
    assert json.loads((tmp_path / "hook_plan.json").read_text())["moments"] == []
