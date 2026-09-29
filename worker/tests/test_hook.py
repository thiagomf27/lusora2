"""The hook tier (D106, documentary plan slice 5).

Dark Palace's hook: the opening runs faster than the rest — a cut every ~2.2 s
on a word onset — opens on footage rather than a graphic, and closes on the
video's title with a riser into a hit. In LUSORA it is a style-pack block the
compiler reads, bounded by the hook end the subjects pass already writes, so
a pack without it compiles exactly as before.
"""

import json

import pytest

from lusora_worker.compiler import compile_plan
from lusora_worker import validators

from test_sound import PACK, beats, cfg, timings

HOOK_PACK = {**PACK, "cues": {**PACK["cues"],
                              "riser": {"file": "sfx/riser.mp3", "kind": "one_shot", "duration_s": 1.8,
                                        "lead_s": 1.76, "priority": 8},
                              "hit": {"file": "sfx/hit.mp3", "kind": "one_shot", "duration_s": 1.2,
                                      "lead_s": 0.0, "priority": 10}}}

HOOK = {"enabled": True, "cut_s": 2.2, "min_hold": 1.5, "open_on": "footage",
        "title_card": {"enabled": True, "component": "KineticTitle", "seconds": 2.5,
                       "lead_cue": "riser", "hit_cue": "hit"}}


def hook_cfg(hook=HOOK):
    c = cfg(sound_pack_doc=HOOK_PACK)
    c["style_pack_doc"] = {**c["style_pack_doc"],
                           "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 6.0,
                                      "hold_floor_ratio": 1.0, "hook": hook}}
    return c


def narration(bid, text, overlay=None):
    b = {"id": bid, "kind": "narration", "script_text": text, "visual_intent": "a shot"}
    if overlay:
        b["overlay"] = overlay
    return b


SCRIPT = [
    ("In a quiet corner of eastern Pennsylvania there is a town that burns.", 0.0, 4.6),
    ("Steam still rises from the cracks in the soil.", 4.6, 8.0),
    ("It began in May of 1962 at the town dump.", 8.0, 14.0),
]


def plan_for(hook_end=8.0, c=None, overlay_on=None):
    doc = beats(*[narration(f"b{i + 1}", t, overlay_on.get(f"b{i + 1}") if overlay_on else None)
                  for i, (t, _a, _b) in enumerate(SCRIPT)])
    return compile_plan(doc, timings(*SCRIPT), c or hook_cfg(), 14.0,
                        hook={"end_s": hook_end, "title": "Centralia: The Town Burning From Below"})


def test_the_hook_cuts_faster_and_on_word_onsets():
    plan = plan_for()
    visual = plan["tracks"]["visual"]
    hook = [v for v in visual if v.get("hook")]
    rest = [v for v in visual if not v.get("hook")]
    assert [v["beat_id"] for v in hook] == ["b1", "b1", "b2", "b2"], "two ~2.2 s shots per hook beat"
    assert all(1.5 <= v["end_s"] - v["start_s"] <= 2.9 for v in hook)
    assert [v["beat_id"] for v in rest] == ["b3"], "after the hook the pack's own holds apply"
    # every cut inside a hook beat sits on a word onset (12 words over 4.6 s)
    onsets = {round(4.6 * k / 13, 3) for k in range(13)}
    assert round(hook[0]["end_s"], 3) in onsets


def test_the_hook_opens_on_footage_and_closes_on_the_title():
    plan = plan_for(overlay_on={"b1": {"component": "KineticTitle", "props_hint": {"text": "A town that burns"}}})
    overlays = plan["tracks"]["overlays"]
    first_shot_end = next(v for v in plan["tracks"]["visual"] if v.get("hook"))["end_s"]
    assert not [o for o in overlays if o["start_s"] < first_shot_end], "nothing covers the opening shot"
    card = next(o for o in overlays if o["id"] == "o_hook_title")
    assert card["start_s"] == pytest.approx(8.0) and card["end_s"] == pytest.approx(10.5)
    assert card["props"] == {"text": "Centralia: The Town Burning From Below"}
    sfx = plan["tracks"]["audio"]["sfx"]
    riser = next(s for s in sfx if s["cue"] == "riser")
    hit = next(s for s in sfx if s["cue"] == "hit")
    assert riser["start_s"] == pytest.approx(8.0 - 1.76), "the riser leads into the card"
    assert hit["start_s"] == pytest.approx(8.0)
    assert not [s for s in sfx if s["origin_id"] == "o_hook_title" and s["cue"] not in ("riser", "hit")]


def test_the_title_card_survives_a_tight_sound_budget():
    c = hook_cfg()
    c["style_pack_doc"]["sfx"] = {"enabled": True, "cues": ["entrance"], "max_per_minute": 1, "min_gap_s": 5.0}
    sfx = plan_for(c=c)["tracks"]["audio"]["sfx"]
    assert {"riser", "hit"} <= {s["cue"] for s in sfx}


def test_a_pack_without_a_hook_compiles_as_before():
    c = hook_cfg({"enabled": False})
    off = plan_for(c=c)
    assert not [v for v in off["tracks"]["visual"] if v.get("hook")]
    assert not [o for o in off["tracks"]["overlays"] if o["id"] == "o_hook_title"]


def test_the_plan_validator_holds_hook_shots_to_the_hook_floor():
    c = hook_cfg()
    visual = [{"id": "v1", "start_s": 0.0, "end_s": 1.7, "hook": True},
              {"id": "v2", "start_s": 1.7, "end_s": 3.0, "hook": True},
              {"id": "v3", "start_s": 3.0, "end_s": 4.0}]
    problems = validators._check_visual_holds(visual, c)
    assert not any("v1" in p for p in problems), "1.7 s is fine in the hook"
    assert any("v2" in p and "in the hook" in p for p in problems), "1.3 s is under the hook floor"
    assert any("v3" in p and "floor" in p for p in problems), "outside the hook the pack's floor applies"


def test_the_opening_shot_takes_footage_not_a_photo(tmp_path, monkeypatch):
    from lusora_worker.pipeline import steps
    from lusora_worker.providers import sources

    from test_gather_footage import ctx_for, write_video

    items = write_video(tmp_path, beats_subjects=("s1", "s1"))
    plan = {"tracks": {"visual": [{**items[0], "hook": True}, {**items[1], "hook": True}], "overlays": []}}
    (tmp_path / "edit_plan.json").write_text(json.dumps(plan))
    (tmp_path / "clips").mkdir()
    both = [{"source": "archive", "provider": "commons", "id": "p1", "query": "q", "rating": 5, "logo": ""},
            {"source": "youtube", "provider": "youtube", "id": "y#1", "query": "q", "rating": 4, "logo": ""}]
    (tmp_path / "shot_picks.json").write_text(json.dumps({"version": "1.0", "video_id": "vid_f", "enabled": True,
        "items": {"v0": {"candidates": both}, "v1": {"candidates": both[:1]}}}))
    fetched = []

    class Fake:
        query_kind = "keyword"

        def __init__(self, kind):
            self.kind = kind

        def fetch(self, ctx, item, candidate, source_cfg, ledger=None):
            fetched.append((item["id"], candidate["id"]))
            path = f"clips/{item['id']}.{'mp4' if self.kind == 'youtube' else 'jpg'}"
            (ctx.folder / path).write_bytes(b"x")
            return sources.Resolution(source=self.kind, id=candidate["id"], provider=candidate["provider"],
                                      license="x", path=path, score=None, query="q",
                                      media_type="video" if self.kind == "youtube" else "image")

        def resolve(self, *a, **k):
            return None

    monkeypatch.setitem(sources.ADAPTERS, "archive", Fake("archive"))
    monkeypatch.setitem(sources.ADAPTERS, "youtube", Fake("youtube"))
    monkeypatch.setenv("ASSET_PARALLELISM", "1")
    ctx = ctx_for(tmp_path, chain=[{"source": "youtube"}, {"source": "archive"}])
    ctx.cfg["source_policy"]["visual"]["pick"] = {"enabled": True}
    ctx.cfg["style_pack_doc"] = {"pacing": {"hook": {"enabled": True, "open_on": "footage"}}}
    ctx.db.provider_health = lambda *a, **k: None
    steps.run_resolve_assets(ctx)
    assert fetched == [("v0", "y#1"), ("v1", "p1")], "the opening shot skips the better-rated photo; the next may take it"


def test_the_hook_ends_at_the_subjects_cut_but_never_past_a_quarter(tmp_path):
    from lusora_worker.context import StageContext
    from lusora_worker.pipeline import steps

    from test_agents import FakeDb

    cuts = [{"index": i, "script_text": "x", "start_s": 10.0 * i, "end_s": 10.0 * (i + 1)} for i in range(10)]
    (tmp_path / "beat_cuts.json").write_text(json.dumps({"cuts": cuts}))
    (tmp_path / "subjects.json").write_text(json.dumps({"hook_end_cut": 5, "title": "The Town"}))
    ctx = StageContext(video={"id": "v", "channel_id": "C", "title": "T"}, folder=tmp_path,
                       cfg={"style_pack_doc": {"pacing": {"hook": {"enabled": True, "max_share": 0.25}}}},
                       db=FakeDb(), config=None)
    hook = steps._hook_for(ctx, 100.0)
    assert hook == {"end_s": 20.0, "title": "The Town"}, "cut 5 ends at 60 s; a quarter of 100 s is 25 s"
