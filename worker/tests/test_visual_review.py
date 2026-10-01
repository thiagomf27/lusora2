"""The visual review (D121, Dark Palace's revisor): the finished video looked
at, and the shots with a problem repaired. The judge is faked; nothing here
reaches a provider."""

import copy
import json
import os
import threading
import time

import pytest

from lusora_worker.agents import visual_review as review
from lusora_worker.errors import StageError
from lusora_worker.media import run_ffmpeg
from lusora_worker.pipeline import degrade, steps
from lusora_worker.providers import sources
from lusora_worker.providers.llm import LLMResult

from test_sources import make_ctx

ON = {"enabled": True, "never_empty": True}


def plan_with_files(ctx):
    """Four shots: two cuts of one YouTube upload, a stock clip, a generated
    image; one overlay over shot 2 with its sound cue."""
    for name in ("yt1.mp4", "yt4.mp4", "stock.mp4"):
        run_ffmpeg("t", ["-f", "lavfi", "-i", "testsrc=s=320x180:r=30", "-t", "1", "-pix_fmt", "yuv420p",
                         str(ctx.folder / "clips" / name)])
    run_ffmpeg("t", ["-f", "lavfi", "-i", "color=c=gray:s=320x180", "-frames:v", "1", str(ctx.folder / "clips" / "ai.png")])
    return {
        "version": "1.0", "video_id": "vid_t", "fps": 30, "resolution": {"width": 320, "height": 180},
        "tracks": {
            "visual": [
                {"id": "v0", "beat_id": "b0", "start_s": 0, "end_s": 4, "media_type": "video",
                 "asset": {"source": "youtube", "provider": "youtube", "id": "abc#1", "path": "clips/yt1.mp4"}},
                {"id": "v1", "beat_id": "b1", "start_s": 4, "end_s": 8, "media_type": "video",
                 "asset": {"source": "stock", "provider": "pexels", "id": "777", "path": "clips/stock.mp4"}},
                {"id": "v2", "beat_id": "b2", "start_s": 8, "end_s": 12, "media_type": "video",
                 "asset": {"source": "youtube", "provider": "youtube", "id": "abc#4", "path": "clips/yt4.mp4"}},
                {"id": "v3", "beat_id": "b3", "start_s": 12, "end_s": 16, "media_type": "image",
                 "asset": {"source": "ai", "provider": "openai", "id": None, "path": "clips/ai.png"}},
            ],
            "overlays": [{"id": "o1", "kind": "component", "component": "StatTag", "props": {"value": 3, "label": "x"},
                          "start_s": 8.5, "end_s": 11.5}],
            "captions": {"enabled": True, "preset": "boxed", "items": []},
            "audio": {"voiceover": {"path": "audio.mp3", "start_s": 0, "duration_s": 16},
                      "sfx": [{"id": "s1", "cue": "pop", "start_s": 8.5, "end_s": 9, "origin_id": "o1"}]},
        },
    }


# ---------------- the answer ----------------


@pytest.mark.parametrize("answer, note", [
    ([{"item": 1, "problem": "logo"}], "no `problems` list"),
    ({"problems": "none"}, "no `problems` list"),
    ({"problems": [{"item": 9, "problem": "blank"}]}, "item 9 is not on this sheet"),
    ({"problems": [{"item": True, "problem": "blank"}]}, "is not on this sheet"),
    ({"problems": [{"item": 1, "problem": "ugly"}]}, "unknown problem 'ugly'"),
    ({"problems": [{"item": 1, "problem": "logo", "corner": "middle"}]}, "a logo with no corner"),
    ({"problems": ["blank"]}, "not an object"),
])
def test_anything_off_the_sheet_or_the_menu_is_dropped_with_a_note(answer, note):
    kept, notes = review.validate(answer, [0, 1, 2])
    assert kept == []
    assert any(note in n for n in notes), notes


def test_a_good_answer_is_kept_with_its_corner():
    kept, notes = review.validate({"problems": [
        {"item": 2, "problem": "logo", "corner": "Top-Right", "note": "a channel bug"},
        {"item": 0, "problem": "blank"},
    ]}, [0, 1, 2])
    assert notes == []
    assert kept == [{"item": 2, "problem": "logo", "corner": "top-right", "note": "a channel bug"},
                    {"item": 0, "problem": "blank", "note": ""}]


# ---------------- the repairs ----------------


def test_foreign_text_bans_the_upload_across_every_shot_that_used_it(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    out = review.repair(ctx, plan, [{"item": 0, "problem": "foreign_text"}])
    assert out["banned"] == ["abc"]
    assert out["cleared"] == ["v0", "v2"], "both cuts of the upload go"
    visual = plan["tracks"]["visual"]
    assert visual[0]["asset"]["path"] == "" and visual[2]["asset"]["path"] == ""
    assert not (tmp_path / "clips/yt1.mp4").exists() and not (tmp_path / "clips/yt4.mp4").exists()
    assert visual[1]["asset"]["path"] == "clips/stock.mp4", "other sources stay"


def test_a_logo_is_cropped_out_of_every_clip_of_its_upload(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    before = (tmp_path / "clips/yt4.mp4").stat().st_ino
    out = review.repair(ctx, plan, [{"item": 0, "problem": "logo", "corner": "top-right"}])
    visual = plan["tracks"]["visual"]
    assert visual[0]["asset"]["logo_crop"] == "top-right" and visual[2]["asset"]["logo_crop"] == "top-right"
    assert "logo_crop" not in visual[1]["asset"]
    assert out["banned"] == [] and out["cleared"] == []
    assert (tmp_path / "clips/yt4.mp4").stat().st_ino != before, "a new file, never written over (hard-linked forks)"


def test_a_cut_off_graphic_is_dropped_with_its_sound(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    out = review.repair(ctx, plan, [{"item": 2, "problem": "cut_off"}])
    assert plan["tracks"]["overlays"] == []
    assert plan["tracks"]["audio"]["sfx"] == []
    assert out["cleared"] == [] and out["banned"] == [], "the shot itself is fine"


def test_two_shots_flagged_for_one_graphic_drop_it_and_ban_nothing(tmp_path):
    """The first Centralia review: one comparison card spanned shots 8 and 9,
    both were flagged, and the second — finding the card already dropped —
    blamed its footage and banned a good upload."""
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    plan["tracks"]["overlays"][0].update(start_s=5, end_s=11.5)  # over v1 and v2
    out = review.repair(ctx, plan, [{"item": 1, "problem": "cut_off"}, {"item": 2, "problem": "cut_off"}])
    assert plan["tracks"]["overlays"] == []
    assert out["banned"] == [] and out["cleared"] == []
    assert out["done"] == ["v1: dropped o1 (its text was cut off)"]


def test_the_judge_is_told_which_graphics_are_ours():
    plan = {"tracks": {"visual": [{"start_s": 0, "end_s": 4}, {"start_s": 4, "end_s": 8}],
                       "overlays": [{"id": "o1", "component": "HighlightedPassage", "start_s": 4.5, "end_s": 7.5,
                                     "props": {"text": "the hardest and cleanest-burning coal", "emphasis": "accent"}}]}}
    assert review.describe_graphics(plan, [0, 1]) == \
        '#1: HighlightedPassage "the hardest and cleanest-burning coal"'


def test_a_cut_off_with_no_graphic_over_it_is_text_in_the_footage(tmp_path):
    """DP's rule: a shot with none of our text cannot have ours cut off."""
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    out = review.repair(ctx, plan, [{"item": 1, "problem": "cut_off"}])
    assert out["banned"] == ["stock:pexels:777"]
    assert out["cleared"] == ["v1"]


def test_a_blank_shot_is_resolved_again_without_that_asset(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    out = review.repair(ctx, plan, [{"item": 2, "problem": "blank"}])
    assert out["banned"] == ["youtube:youtube:abc#4"], "that asset, not its whole upload"
    assert out["cleared"] == ["v2"]
    assert plan["tracks"]["visual"][0]["asset"]["path"] == "clips/yt1.mp4"


def test_a_generated_image_is_only_itself(tmp_path):
    """Every generated image shares `ai:<provider>:` — banning that would clear them all."""
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    plan["tracks"]["visual"][1]["asset"] = {"source": "ai", "provider": "openai", "id": None, "path": "clips/stock.mp4"}
    out = review.repair(ctx, plan, [{"item": 3, "problem": "foreign_text"}])
    assert out["banned"] == [] and out["cleared"] == ["v3"]


def test_a_file_a_kept_shot_still_shows_is_not_deleted(tmp_path):
    """A never-empty repeat shares its neighbour's file."""
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    plan["tracks"]["visual"][1]["asset"] = dict(plan["tracks"]["visual"][0]["asset"], id="abc#1")
    plan["tracks"]["visual"][1]["asset"]["source"] = "stock"  # same file, a different source
    review.repair(ctx, plan, [{"item": 0, "problem": "blank"}])
    assert (tmp_path / "clips/yt1.mp4").exists()


# ---------------- the ledger ----------------


def test_the_ledger_refuses_a_banned_upload_and_a_banned_asset():
    ledger = sources.Ledger.from_plan({"tracks": {"visual": []}}, None, {},
                                      banned=["abc", "stock:pexels:777"])
    assert ledger.blocked("youtube", "youtube", "abc#9")
    assert ledger.blocked("stock", "pexels", "777")
    assert not ledger.blocked("stock", "pexels", "778")
    assert ledger.copy().is_banned("youtube", "youtube", "abc#2"), "a snapshot keeps the bans"


# ---------------- never an empty frame ----------------


def _place(ctx, plan, item):
    steps._place(ctx, plan, item, None, ({}, "a coal town", [], None), sources.Ledger(), threading.Lock(), 0.0)


def test_a_shot_nothing_was_found_for_takes_the_previous_shots_picture(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    ctx.cfg["source_policy"] = {"visual": {"review": ON}}
    item = plan["tracks"]["visual"][2]
    item["asset"] = {"source": "manual", "path": ""}
    _place(ctx, plan, item)
    assert item["asset"]["path"] == "clips/stock.mp4"
    assert any("showing v1's picture again" in (e[2] or "") for e in ctx.db.events)


def test_the_first_shot_takes_the_next_ones(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    ctx.cfg["source_policy"] = {"visual": {"review": ON}}
    item = plan["tracks"]["visual"][0]
    item["asset"] = {"source": "manual", "path": ""}
    _place(ctx, plan, item)
    assert item["asset"]["path"] == "clips/stock.mp4"


def test_with_the_review_off_an_empty_shot_still_stops_the_video(tmp_path):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    item = plan["tracks"]["visual"][2]
    item["asset"] = {"source": "manual", "path": ""}
    with pytest.raises(StageError, match="source chain exhausted"):
        _place(ctx, plan, item)
    assert not degrade.never_empty({"source_policy": {"visual": {"review": {"never_empty": True}}}}), \
        "the knob covers both: never_empty needs the review on"


# ---------------- looking ----------------


def test_frames_are_taken_at_a_quarter_and_three_quarters_and_a_window_shifts_them():
    plan = {"tracks": {"visual": [{"start_s": 0, "end_s": 4}, {"start_s": 4, "end_s": 12}, {"start_s": 60, "end_s": 64}]}}
    assert review.sample_times(plan, None) == {0: [1.0, 3.0], 1: [6.0, 10.0], 2: [61.0, 63.0]}
    assert review.sample_times(plan, (2.0, 40.0)) == {1: [4.0, 8.0]}, "outside the window: skipped"


def test_sheets_hold_twelve_shots_each(tmp_path):
    frame = tmp_path / "f.jpg"
    run_ffmpeg("t", ["-f", "lavfi", "-i", "color=c=gray:s=320x180", "-frames:v", "1", str(frame)])
    frames = {i: [frame, frame] for i in range(14)}
    sheets = review.build_sheets(tmp_path / "work", frames)
    assert [items for _s, items in sheets] == [list(range(12)), [12, 13]]
    assert all(s.exists() for s, _i in sheets)


# ---------------- the stage ----------------


def stage_ctx(tmp_path, monkeypatch, enabled=True):
    ctx = make_ctx(tmp_path)
    plan = plan_with_files(ctx)
    ctx.cfg["source_policy"] = {"visual": {"chain": [{"source": "stock"}], "review": {**ON, "enabled": enabled},
                                           "pick": {"llm": "mock"}}}
    ctx.write_json("edit_plan.json", plan)
    run_ffmpeg("t", ["-f", "lavfi", "-i", "testsrc=s=320x180:r=30", "-t", "16", "-pix_fmt", "yuv420p",
                     str(tmp_path / "final.mp4")])
    return ctx, plan


def test_off_makes_no_call_and_leaves_the_plan_alone(tmp_path, monkeypatch):
    ctx, plan = stage_ctx(tmp_path, monkeypatch, enabled=False)
    steps.run_visual_review(ctx, see_fn=lambda *a, **k: pytest.fail("no call when off"))
    assert ctx.read_json("visual_review.json") == {"version": "1.0", "video_id": "vid_t", "enabled": False}
    assert ctx.read_json("edit_plan.json") == plan


def test_a_found_problem_is_repaired_and_patched_and_recorded_last(tmp_path, monkeypatch):
    ctx, plan = stage_ctx(tmp_path, monkeypatch)
    calls = {}

    def see(provider, model, system, user, images, max_tokens, temperature):
        calls["user"] = user
        return LLMResult('{"problems":[{"item":2,"problem":"cut_off","note":"the tag runs off the frame"}]}', 10, 5)

    monkeypatch.setattr(steps, "run_validate", lambda ctx: None)
    monkeypatch.setattr(steps, "run_resolve_assets", lambda ctx: pytest.fail("nothing was cleared"))

    def patch_render(ctx, old, new):
        calls["patched"] = True
        time.sleep(0.02)
        os.utime(ctx.artifact("final.mp4"))  # the patch rewrote the file
        return True

    from lusora_worker.pipeline import patch
    monkeypatch.setattr(patch, "patch_render", patch_render)
    steps.run_visual_review(ctx, see_fn=see)

    assert "#0, #1, #2, #3" in calls["user"] and calls["patched"]
    assert '#2: StatTag "x"' in calls["user"], "our graphics are named to the judge"
    record = ctx.read_json("visual_review.json")
    assert record["found"] == [{"item": 2, "problem": "cut_off", "note": "the tag runs off the frame", "id": "v2"}]
    assert record["done"] == ["v2: dropped o1 (its text was cut off)"]
    assert record["patched"] == [[8.5, 11.5]] and record["audio_remixed"] is True
    assert ctx.read_json("edit_plan.before_review.json") == plan
    assert ctx.read_json("edit_plan.json")["tracks"]["overlays"] == []
    assert steps.review_fresh(ctx), "recorded after the patch, so a resume does not review again"


def test_a_cleared_shot_is_resolved_again_through_resolve_assets_with_the_bans(tmp_path, monkeypatch):
    ctx, _plan = stage_ctx(tmp_path, monkeypatch)
    seen = {}

    def resolve(ctx):
        seen["banned"] = ctx.read_json("visual_review.json")["banned"]
        plan = ctx.read_json("edit_plan.json")
        seen["pending"] = [v["id"] for v in plan["tracks"]["visual"] if not v["asset"]["path"]]
        for v in plan["tracks"]["visual"]:
            if not v["asset"]["path"]:
                v["asset"] = {"source": "stock", "provider": "pexels", "id": "900", "path": "clips/stock.mp4"}
        ctx.write_json("edit_plan.json", plan)

    monkeypatch.setattr(steps, "run_resolve_assets", resolve)
    monkeypatch.setattr(steps, "run_validate", lambda ctx: None)
    from lusora_worker.pipeline import patch
    monkeypatch.setattr(patch, "patch_render", lambda ctx, old, new: True)
    see = lambda *a, **k: LLMResult('{"problems":[{"item":0,"problem":"foreign_text"}]}', 1, 1)  # noqa: E731
    steps.run_visual_review(ctx, see_fn=see)
    assert seen == {"banned": ["abc"], "pending": ["v0", "v2"]}


def test_a_patch_that_cannot_patch_renders_the_whole_video(tmp_path, monkeypatch):
    ctx, _plan = stage_ctx(tmp_path, monkeypatch)
    rendered = []
    monkeypatch.setattr(steps, "run_validate", lambda ctx: None)
    monkeypatch.setattr(steps, "run_render", lambda ctx: rendered.append(True))
    from lusora_worker.pipeline import patch
    monkeypatch.setattr(patch, "patch_render", lambda ctx, old, new: False)
    see = lambda *a, **k: LLMResult('{"problems":[{"item":2,"problem":"cut_off"}]}', 1, 1)  # noqa: E731
    steps.run_visual_review(ctx, see_fn=see)
    assert rendered == [True]
    assert ctx.read_json("visual_review.json")["patched"] == "whole video"


def test_nothing_found_changes_nothing(tmp_path, monkeypatch):
    ctx, plan = stage_ctx(tmp_path, monkeypatch)
    steps.run_visual_review(ctx, see_fn=lambda *a, **k: LLMResult('{"problems":[]}', 1, 1))
    assert ctx.read_json("edit_plan.json") == plan
    assert not ctx.has("edit_plan.before_review.json")
    assert ctx.read_json("visual_review.json")["found"] == []


def test_a_fresh_record_skips_the_stage_and_a_newer_render_does_not(tmp_path, monkeypatch):
    ctx, _plan = stage_ctx(tmp_path, monkeypatch)
    steps.run_visual_review(ctx, see_fn=lambda *a, **k: LLMResult('{"problems":[]}', 1, 1))
    assert steps.review_fresh(ctx)
    time.sleep(0.02)
    os.utime(ctx.artifact("final.mp4"))
    assert not steps.review_fresh(ctx), "a later render is looked at again"


def test_a_judge_that_cannot_answer_costs_the_review_not_the_video(tmp_path, monkeypatch):
    ctx, plan = stage_ctx(tmp_path, monkeypatch)

    def down(*a, **k):
        raise StageError("llm", "claude_cli failed: not logged in")

    steps.run_visual_review(ctx, see_fn=down)
    record = ctx.read_json("visual_review.json")
    assert record["found"] == [] and "not logged in" in record["notes"][0]
    assert ctx.read_json("edit_plan.json") == plan
