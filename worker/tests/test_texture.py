"""Film texture (D112, documentary plan slice 7).

Dark Palace's `efeitos.py`: a light leak on the cut into a story turn, an aged
grade over a flashback, the first footage of a flashback on an old CRT set,
and dust and tape everywhere (the theme's, drawn by the engine). The model only
MARKS turns and flashbacks; these pin where the compiler puts the texture from
those marks, the fallback when there are none, and that a pack without the
block compiles exactly as before.
"""

import json
import subprocess

import pytest

from lusora_worker import validators
from lusora_worker.agents import narrative_marks
from lusora_worker.compiler import compile_plan
from lusora_worker.compiler.texture import place_texture
from lusora_worker.pipeline import steps
from lusora_worker.providers.llm import LLMResult

from test_gather_footage import ctx_for

SCRIPT = """In a quiet corner of Pennsylvania, a town burns. Steam rises.

Nobody set out to destroy it.

Back in 1890, the town was full of miners. They dug deep.

Then, in May 1962, the council lit the dump."""

CUTS = [
    {"index": 0, "script_text": "In a quiet corner of Pennsylvania, a town burns.", "start_s": 0.0, "end_s": 3.0},
    {"index": 1, "script_text": "Steam rises.", "start_s": 3.0, "end_s": 5.0},
    {"index": 2, "script_text": "Nobody set out to destroy it.", "start_s": 5.0, "end_s": 8.0},
    {"index": 3, "script_text": "Back in 1890, the town was full of miners.", "start_s": 8.0, "end_s": 12.0},
    {"index": 4, "script_text": "They dug deep.", "start_s": 12.0, "end_s": 14.0},
    {"index": 5, "script_text": "Then, in May 1962, the council lit the dump.", "start_s": 14.0, "end_s": 18.0},
]
BEATS = [{"id": f"b{c['index'] + 1}", "kind": "narration", "script_text": c["script_text"]} for c in CUTS]


def test_paragraph_starts_are_found_by_walking_the_script():
    assert narrative_marks.paragraph_starts(SCRIPT, CUTS) == {2, 3, 5}


def texture_ctx(tmp_path, placement="narrative", planner="deepseek"):
    ctx = ctx_for(tmp_path, planner=planner)
    ctx.cfg["style_pack_doc"] = {"texture": {"placement": placement}}
    return ctx


def answer(text):
    return lambda *a: LLMResult(text=text, input_tokens=10, output_tokens=5)


def test_any_other_placement_makes_no_call(tmp_path):
    doc = narrative_marks.mark(texture_ctx(tmp_path, "count"), BEATS, CUTS, SCRIPT, None,
                               chat_fn=lambda *a: pytest.fail("no call"))
    assert doc["source"] == "off" and doc["turns"] == [] and doc["flashback"] == []
    assert validators.validate_marks(doc) == []


def test_without_a_model_the_turns_are_the_paragraph_starts_after_the_hook(tmp_path):
    doc = narrative_marks.mark(texture_ctx(tmp_path, planner="mock"), BEATS, CUTS, SCRIPT, 6.0)
    assert doc["source"] == "fallback" and doc["flashback"] == []
    assert doc["turns"] == ["b4", "b6"], "b3 opens a paragraph inside the hook (ends 6 s)"
    doc = narrative_marks.mark(texture_ctx(tmp_path, planner="mock"), BEATS, CUTS, SCRIPT, None)
    assert doc["turns"] == ["b3", "b4", "b6"], "no hook: every paragraph start but the first beat"


def test_the_models_marks_join_the_paragraph_turns(tmp_path):
    asked = []

    def chat(provider, model, system, user, *rest):
        asked.append(user)
        return LLMResult(text=json.dumps({"flashback": ["b5", "b4"], "turns": ["b2"]}), input_tokens=1, output_tokens=1)

    doc = narrative_marks.mark(texture_ctx(tmp_path), BEATS, CUTS, SCRIPT, 6.0, chat_fn=chat)
    assert "[b4] Back in 1890, the town was full of miners." in asked[0]
    assert doc["source"] == "model"
    assert doc["turns"] == ["b2", "b4", "b6"] and doc["flashback"] == ["b4", "b5"], "in narration order"
    assert validators.validate_marks(doc) == []


@pytest.mark.parametrize("text, why", [
    ("not json at all", "not JSON"),
    (json.dumps({"flashback": ["b99"], "turns": []}), "do not exist"),
    (json.dumps({"turns": ["b2"]}), "`flashback` must be a list"),
])
def test_a_bad_answer_falls_back_to_the_paragraph_turns(tmp_path, text, why):
    doc = narrative_marks.mark(texture_ctx(tmp_path), BEATS, CUTS, SCRIPT, 6.0, chat_fn=answer(text))
    assert doc["source"] == "fallback" and doc["turns"] == ["b4", "b6"] and why in doc["note"]


def test_a_provider_that_cannot_answer_costs_the_marks_not_the_video(tmp_path):
    from lusora_worker.errors import StageError

    def down(*a):
        raise StageError("narrative_marks", "provider down")

    doc = narrative_marks.mark(texture_ctx(tmp_path), BEATS, CUTS, SCRIPT, 6.0, chat_fn=down)
    assert doc["source"] == "fallback" and "provider down" in doc["note"]


# ---------------- placement ----------------


def shots(kinds, beat_ids=None, hold=5.0):
    """One shot per kind ('v' video, 'i' image, 'c' colour), each `hold` seconds."""
    beat_ids = beat_ids or [f"b{n + 1}" for n in range(len(kinds))]
    media = {"v": "video", "i": "image", "c": "color"}
    return [{"id": f"v{n}", "beat_id": b, "start_s": hold * n, "end_s": hold * (n + 1), "media_type": media[k],
             "asset": {"source": "stock", "id": str(n), "provider": "x", "license": "x", "path": f"clips/{n}"},
             "transition_out": {"type": "cut", "duration_s": 0.1}}
            for n, (k, b) in enumerate(zip(kinds, beat_ids))]


def pack(**texture):
    return {"texture": {"placement": "narrative", **texture}, "transitions": {"default": "cut"}}


def kinds_of(visual):
    return [(v.get("transition_out") or {}).get("type") for v in visual[:-1]]


def test_a_turn_gets_a_leak_on_the_cut_into_it():
    visual = shots("vvvvvv")
    place_texture(visual, pack(), {"turns": ["b4"], "flashback": []})
    assert kinds_of(visual) == ["cut", "cut", "light_leak", "cut", "cut"]
    assert visual[2]["transition_out"] == {"type": "light_leak", "duration_s": 0.8, "placed_by": "texture"}


def test_leaks_keep_their_distance():
    visual = shots("vvvvvvvv", hold=4.0)
    place_texture(visual, pack(), {"turns": ["b2", "b4", "b6", "b8"], "flashback": []})
    # cuts at 4, 12, 20, 28 s: 12 s apart is fine, 8 s is not
    assert kinds_of(visual) == ["light_leak", "cut", "cut", "cut", "light_leak", "cut", "cut"]


def test_a_leak_never_replaces_a_choice_but_outranks_filler():
    visual = shots("vvvvvv")
    visual[1]["transition_out"] = {"type": "fade_to_black", "duration_s": 0.8, "placed_by": "section_break"}
    visual[3]["transition_out"] = {"type": "crossfade", "duration_s": 0.5, "placed_by": "filler"}
    visual[4]["transition_out"] = {"type": "crossfade", "duration_s": 0.5, "placed_by": "filler"}
    place_texture(visual, pack(leak_min_gap_s=0), {"turns": ["b3", "b5"], "flashback": []})
    assert visual[1]["transition_out"]["type"] == "fade_to_black", "a section break stands"
    assert visual[3]["transition_out"]["type"] == "light_leak", "a filler crossfade gives way"
    assert visual[4]["transition_out"] == {"type": "cut", "duration_s": 0.5}, "and no filler sits next to a leak"


def test_leaks_only_join_two_pictures_outside_the_hook():
    visual = shots("vvcvvv")
    visual[0]["hook"] = visual[1]["hook"] = True
    place_texture(visual, pack(leak_min_gap_s=0), {"turns": ["b2", "b3", "b4", "b5"], "flashback": []})
    assert kinds_of(visual) == ["cut", "cut", "cut", "light_leak", "cut"]


def test_a_flashback_is_aged_and_opens_on_a_crt_set():
    visual = shots("vvivvvvvvvvv")
    place_texture(visual, pack(vintage_max_share=0.5), {"turns": [], "flashback": ["b3", "b4", "b5", "b9"]})
    assert [n for n, v in enumerate(visual) if v.get("grade") == "vintage"] == [2, 3, 4, 8]
    # the run b3-b5 opens on a photo, so its first FOOTAGE plays on the set
    assert [n for n, v in enumerate(visual) if v.get("crt")] == [3, 8]


def test_the_grade_is_capped_at_a_share_of_the_pictures():
    visual = shots("vvvvvvvvvv")
    notes = []
    place_texture(visual, pack(vintage_max_share=0.2), {"turns": [], "flashback": [f"b{n}" for n in range(1, 11)]},
                  notes.append)
    assert sum(1 for v in visual if v.get("grade")) == 2
    assert any("capped at 2" in n for n in notes)


def test_count_mode_is_a_fixed_rhythm():
    visual = shots("v" * 15, hold=5.0)
    visual[0]["hook"] = True
    place_texture(visual, {"texture": {"placement": "count", "leak_every": 3, "vintage_every": 7}}, None)
    assert [n for n, v in enumerate(visual) if v.get("grade")] == [7, 14]
    assert [n for n, v in enumerate(visual) if v.get("crt")] == [7, 14], "an aged shot is a run of one"
    assert [n for n, t in enumerate(kinds_of(visual)) if t == "light_leak"] == [3, 6, 9, 12]


def test_leaks_can_be_switched_off_while_the_grade_stays():
    visual = shots("vvvvvv")
    place_texture(visual, pack(light_leak=False), {"turns": ["b4"], "flashback": ["b2"]})
    assert "light_leak" not in kinds_of(visual) and visual[1]["grade"] == "vintage"


def test_off_places_nothing():
    visual = shots("vvvvvv")
    before = json.dumps(visual)
    place_texture(visual, {}, {"turns": ["b3"], "flashback": ["b2"]})
    place_texture(visual, {"texture": {"placement": "off"}}, {"turns": ["b3"], "flashback": ["b2"]})
    assert json.dumps(visual) == before


def compile_with(style_extra, marks, speech_windows=None, sound_pack=None, theme=None):
    beats = [dict(b, visual_intent="shot", mood="somber") for b in BEATS]
    cfg = {"style_pack_doc": {"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 10},
                              "overlays": {"density": "normal"},
                              "transitions": {"allowed": ["cut"], "default": "cut"}, **style_extra},
           "output": {"fps": 30, "width": 1920, "height": 1080}}
    if sound_pack is not None:
        cfg["sound_pack_doc"] = sound_pack
    if theme is not None:
        cfg["theme_doc"] = theme
    timings = [{"text": c["script_text"], "start_s": c["start_s"], "end_s": c["end_s"]} for c in CUTS]
    doc = {"version": "1.0", "video_id": "v", "beats": beats}
    return compile_plan(doc, timings, cfg, 18.0, marks=marks, speech_windows=speech_windows), cfg


def test_a_textured_plan_compiles_and_validates(tmp_path):
    plan, cfg = compile_with({"texture": {"placement": "narrative", "leak_min_gap_s": 0}},
                             {"turns": ["b4"], "flashback": ["b4", "b5"]})
    visual = plan["tracks"]["visual"]
    assert any((v.get("transition_out") or {}).get("type") == "light_leak" for v in visual)
    assert [v["beat_id"] for v in visual if v.get("grade") == "vintage"] == ["b4"], "capped at a third of 6"
    assert validators.validate_plan(plan, tmp_path, cfg, 18.0, require_assets=False) == []


def test_a_pack_without_texture_compiles_byte_identically():
    plain, _ = compile_with({}, None)
    marked, _ = compile_with({}, {"turns": ["b4"], "flashback": ["b4", "b5"]})
    assert json.dumps(plain, sort_keys=True) == json.dumps(marked, sort_keys=True)


# ---------------- portrait framing ----------------


def _jpg(path, w, h):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c=gray:s={w}x{h}",
                    "-frames:v", "1", str(path)], check=True)


def test_a_standing_photo_is_framed_on_its_top_third(tmp_path):
    (tmp_path / "clips").mkdir()
    _jpg(tmp_path / "clips" / "tall.jpg", 600, 800)
    _jpg(tmp_path / "clips" / "wide.jpg", 800, 500)
    _jpg(tmp_path / "clips" / "set.jpg", 600, 800)
    plan = {"tracks": {"visual": [
        {"id": "a", "media_type": "image", "asset": {"path": "clips/tall.jpg"}},
        {"id": "b", "media_type": "image", "asset": {"path": "clips/wide.jpg"}},
        {"id": "c", "media_type": "image", "asset": {"path": "clips/set.jpg"}, "focus_y": 0.6},
    ]}}
    steps._frame_portraits(ctx_for(tmp_path), plan)
    a, b, c = plan["tracks"]["visual"]
    assert a["focus_y"] == 0.22 and "focus_y" not in b and c["focus_y"] == 0.6


def test_the_cut_out_of_the_hook_can_take_a_leak():
    visual = shots("vvvvv")
    visual[0]["hook"] = visual[1]["hook"] = True
    place_texture(visual, pack(), {"turns": ["b2", "b3"], "flashback": []})
    assert kinds_of(visual) == ["cut", "light_leak", "cut", "cut"], "into b3, the first shot after the hook"


def test_the_crt_set_follows_what_the_shots_resolved_to():
    from lusora_worker.compiler.texture import settle_crt

    visual = shots("ivvv")
    place_texture(visual, pack(vintage_max_share=1), {"turns": [], "flashback": ["b1", "b2", "b3"]})
    assert [n for n, v in enumerate(visual) if v.get("crt")] == [1]
    # resolve_assets found footage for the planned photo, and a photo for the planned footage
    visual[0]["media_type"], visual[1]["media_type"] = "video", "image"
    assert settle_crt(visual) == 1
    assert [n for n, v in enumerate(visual) if v.get("crt")] == [0]
    visual[0]["media_type"] = visual[2]["media_type"] = "image"
    settle_crt(visual)
    assert not any(v.get("crt") for v in visual), "a run with no footage has no set"
