"""The hook's match cut (D111, documentary plan slice 6c).

Dark Palace's match cut: real photos of one KIND of place flash one after
another, each aligned on the same screen point. The model names the kind; code
finds the photos, drops near-duplicates, and a vision judge keeps the good
ones and marks each subject — fewer than six and the hook goes without it.
MatchCut is `compiler_only`: no planner is ever offered it.
"""

import json
import subprocess
from pathlib import Path

import lusora_contracts
import pytest

from lusora_worker import validators
from lusora_worker.agents import hook_plan, match_cut, planner
from lusora_worker.providers import sources
from lusora_worker.providers.llm import LLMResult

from test_gather_footage import ctx_for


def test_no_planner_is_ever_offered_the_match_cut():
    assert lusora_contracts.catalog_component("MatchCut")["compiler_only"] is True
    assert "MatchCut" not in planner._catalog_menu(None)
    assert "MatchCut" not in planner._catalog_menu(None, props=True)
    beats = [{"id": "b1", "script_text": "Volcanoes everywhere.", "anchors": []}]
    doc = {"version": "1.0", "video_id": "v", "declined": [],
           "selections": [{"beat_id": "b1", "component": "MatchCut", "role": "emphasis", "props_hint": {}}]}
    cfg = {"style_pack_doc": {"overlays": {"emphasis": {"enabled": True, "per_minute": 4}}}}
    assert any("placed by code only" in p for p in validators.validate_overlay_selection(doc, beats, cfg))


BEATS = [{"id": "b1", "kind": "narration", "script_text": "Every lighthouse on this coast went dark that night."},
         {"id": "b2", "kind": "narration", "script_text": "Nobody knew why."}]


def test_the_rules_keep_a_match_cut_with_a_short_search():
    kept, dropped = hook_plan.check([{"beat": "b1", "form": "matchcut", "says": "lighthouse", "search": "lighthouse"}],
                                    BEATS, set())
    assert dropped == [] and kept[0]["component"] == "MatchCut" and kept[0]["search"] == "lighthouse"
    lost, why = hook_plan.check([{"beat": "b1", "form": "matchcut", "says": "lighthouse", "search": ""}], BEATS, set())
    assert lost == [] and "1-4 word search" in why[0]


def _jpg(path: Path, color: str, w=640, h=400):
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", f"color=c={color}:s={w}x{h}",
                    "-frames:v", "1", str(path)], check=True)


@pytest.fixture
def photos(monkeypatch):
    """Eight candidate photos of different colours (so none is a duplicate)."""
    colours = ["red", "blue", "green", "yellow", "white", "purple", "orange", "gray"]
    monkeypatch.setattr(match_cut, "candidates", lambda kind: [
        {"url": f"https://x/{c}.jpg", "title": f"{kind} {c}", "author": "A", "license": "CC BY 4.0",
         "page": f"https://commons/{c}"} for c in colours])

    def download(url, dest):
        _jpg(dest, url.rsplit("/", 1)[1].split(".")[0])
        return 640, 400

    monkeypatch.setattr(match_cut, "_download", download)
    monkeypatch.setattr(sources, "perceptual_hash", lambda path: hash(str(path)) & 0xFFFF_FFFF_FFFF_FFFF)
    return colours


def test_the_judge_keeps_and_marks_the_subjects(tmp_path, photos):
    ctx = ctx_for(tmp_path)
    ctx.cfg["source_policy"]["visual"]["pick"] = {"enabled": True, "llm": "claude_cli"}
    asked = []

    def see(provider, model, system, user, images, *_):
        asked.append(user)
        return LLMResult(text=json.dumps({"keep": [{"n": n, "x": 0.5, "y": 0.4, "h": 0.3} for n in (6, 0, 1, 2, 3, 4)]}),
                         input_tokens=1, output_tokens=1)

    built = match_cut.build(ctx, "lighthouse", see)
    assert "THE KIND: lighthouse" in asked[0] and "8 numbered photos" in asked[0]
    assert len(built["photos"]) == 6 and built["photos"][0]["src"].startswith("matchcut/")
    assert built["photos"][0]["ay"] == 0.4 and built["credits"][0]["license"] == "CC BY 4.0"


def test_fewer_than_six_good_photos_and_the_hook_goes_without(tmp_path, photos):
    ctx = ctx_for(tmp_path)
    ctx.cfg["source_policy"]["visual"]["pick"] = {"enabled": True}
    see = lambda *a: LLMResult(text=json.dumps({"keep": [{"n": 0, "x": 0.5, "y": 0.5, "h": 0.3}]}),
                               input_tokens=1, output_tokens=1)
    assert match_cut.build(ctx, "lighthouse", see) is None


def test_without_a_vision_judge_there_is_no_match_cut(tmp_path, photos):
    ctx = ctx_for(tmp_path)  # pick off
    assert match_cut.build(ctx, "lighthouse", lambda *a: pytest.fail("no judge")) is None


def test_a_bad_answer_is_refused():
    assert validate_ok({"keep": [{"n": 0, "x": 0.5, "y": 0.5, "h": 0.3}]}, 3)
    assert not validate_ok({"keep": [{"n": 9, "x": 0.5, "y": 0.5, "h": 0.3}]}, 3)
    assert not validate_ok({"keep": [{"n": 0, "x": 1.5, "y": 0.5, "h": 0.3}]}, 3)
    assert not validate_ok([], 3)


def validate_ok(answer, count):
    return match_cut.validate_keep(answer, count) == []


def test_the_match_cut_is_credited(tmp_path):
    from lusora_worker.agents import gather_footage

    (tmp_path / "hook_plan.json").write_text(json.dumps({"moments": [
        {"form": "matchcut", "credits": [{"title": "Lighthouse at dusk", "author": "B. C.", "license": "CC0",
                                          "page": "https://commons/l1"}]}]}))
    plan = {"tracks": {"visual": [], "overlays": [
        {"id": "o_b1", "component": "MatchCut", "props": {"photos": []}, "start_s": 1.0, "end_s": 3.0}]}}
    text = gather_footage.credits(ctx_for(tmp_path), None, plan)
    assert "Lighthouse at dusk — B. C. — CC0 — https://commons/l1" in text


def test_a_match_cut_moment_compiles_and_validates(tmp_path):
    from lusora_worker.compiler import compile_plan

    beats = [dict(b, visual_intent="shot") for b in BEATS]
    photo = {"src": "matchcut/mc_00.jpg", "w": 1600, "h": 1066, "ax": 0.5, "ay": 0.45, "th": 0.4}
    moments = [{"beat_id": "b1", "form": "matchcut", "says": "lighthouse", "component": "MatchCut",
                "props": {"photos": [photo] * 6, "says": "lighthouse"}, "search": "lighthouse"}]
    doc, selection = hook_plan.merge_into_selection({"version": "1.0", "video_id": "v", "beats": beats}, None,
                                                    {"moments": moments})
    cfg = {"style_pack_doc": {"pacing": {"avg_hold_seconds": 3, "min_hold": 2, "max_hold": 10},
                              "overlays": {"density": "normal"}, "transitions": {"allowed": ["cut"], "default": "cut"}},
           "output": {"fps": 30, "width": 1920, "height": 1080}}
    timings = [{"text": b["script_text"], "start_s": 4.0 * i, "end_s": 4.0 * (i + 1)} for i, b in enumerate(beats)]
    plan = compile_plan(doc, timings, cfg, 8.0, selection)
    cut = next(o for o in plan["tracks"]["overlays"] if o["component"] == "MatchCut")
    assert len(cut["props"]["photos"]) == 6 and cut["props"]["step_s"] == 0.14
    # "lighthouse" is the 2nd of 9 words over 4 s: said at ~0.45 s, not at the beat's top
    assert 0.2 < cut["start_s"] < 1.0, "it starts on 'lighthouse'"
    problems = validators.validate_plan(plan, tmp_path, cfg, 8.0, require_assets=False)
    assert not [p for p in problems if "MatchCut" in p or cut["id"] in p], problems
