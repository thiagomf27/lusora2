"""Weak matches and short clips (D55): what the resolver does when the
sources come back with nothing good."""

from pathlib import Path

import pytest

from lusora_worker.context import StageContext
from lusora_worker.media import run_ffmpeg
from lusora_worker.pipeline import degrade
from lusora_worker.validators import validate_plan

from test_agents import FakeDb

STYLE = {
    "name": "t",
    "pacing": {"avg_hold_seconds": 4.0, "min_hold": 2.0, "max_hold": 8.0},
    "overlays": {"density": "normal"},
    "transitions": {"allowed": ["cut"], "default": "cut"},
    "fallback": {"component": "ChapterCard", "text_prop": "title"},
}


def make_ctx(tmp_path, **policy):
    (tmp_path / "clips").mkdir(exist_ok=True)
    return StageContext(
        video={"id": "vid_t", "channel_id": "CH", "title": "T"},
        folder=tmp_path,
        cfg={
            "style_pack_doc": STYLE,
            "output": {"width": 320, "height": 180},
            "source_policy": {"visual": {"chain": [{"source": "library"}], **policy}},
        },
        db=FakeDb(),
        config=None,
    )


def plan_with(item):
    return {
        "version": "1.0", "video_id": "vid_t", "fps": 30,
        "resolution": {"width": 1920, "height": 1080},
        "tracks": {
            "visual": [item], "overlays": [],
            "captions": {"enabled": False, "items": []},
            "audio": {"voiceover": {"path": "audio.mp3", "duration_s": item["end_s"]}},
        },
    }


def clip(path, seconds, colour="0x203040"):
    run_ffmpeg("t", ["-f", "lavfi", "-i", f"color=c={colour}:s=320x180:r=30",
                     "-t", f"{seconds}", "-pix_fmt", "yuv420p", str(path)])
    return path


# ---------------- the score floor ----------------


BEAT = {
    "id": "b1",
    "visual_intent": "aerial view of a 1940s industrial district, smokestacks",
    "queries": ["1940s aircraft factory", "wartime assembly line"],
}


def weak_item():
    return {"id": "v_b1", "beat_id": "b1", "locked": False, "start_s": 0.0, "end_s": 6.0,
            "media_type": "video", "motion": {"type": "ken_burns"},
            "asset": {"source": "library", "id": "seg_9", "path": "clips/v_b1.mp4", "score": 0.31}}


def test_a_below_floor_match_becomes_a_card_not_a_bad_clip(tmp_path):
    ctx = make_ctx(tmp_path, min_score_floor=0.5)
    item = weak_item()
    plan = plan_with(item)

    assert degrade.to_title_card(ctx, plan, item, BEAT) == "ChapterCard"
    assert item["media_type"] == "color"
    assert item["asset"]["path"] == "", "a colour fill has no file to fetch"
    assert "motion" not in item, "ken burns on a colour fill is motion on nothing"

    card = plan["tracks"]["overlays"][0]
    assert card["component"] == "ChapterCard"
    assert card["beat_id"] == "b1" and card["locked"] is False
    # the words come from the beat's own keyword query, title-cased
    assert card["props"]["title"] == "1940s Aircraft Factory"
    assert 0.0 <= card["start_s"] < card["end_s"] <= item["end_s"]


def test_the_card_falls_back_to_the_visual_intent_on_a_v1_0_beat():
    v10 = {"id": "b1", "visual_intent": "aerial view of a 1940s industrial district"}
    assert degrade.card_text(v10, 8) == "Aerial View 1940s Industrial District"


def test_a_style_pack_with_no_fallback_keeps_the_weak_asset(tmp_path):
    ctx = make_ctx(tmp_path, min_score_floor=0.5)
    ctx.cfg["style_pack_doc"] = {**STYLE, "fallback": {}}
    item = weak_item()
    assert degrade.to_title_card(ctx, plan_with(item), item, BEAT) is None
    assert item["media_type"] == "video", "a beat with nothing on it is worse"


def test_an_unknown_fallback_component_says_so_and_keeps_the_asset(tmp_path):
    ctx = make_ctx(tmp_path, min_score_floor=0.5)
    ctx.cfg["style_pack_doc"] = {**STYLE, "fallback": {"component": "NoSuchCard"}}
    item = weak_item()
    assert degrade.to_title_card(ctx, plan_with(item), item, BEAT) is None
    assert any("not in the catalog" in (m or "") for _s, _st, m in ctx.db.events)


def test_a_degraded_item_passes_full_validation(tmp_path):
    ctx = make_ctx(tmp_path, min_score_floor=0.5)
    item = weak_item()
    plan = plan_with(item)
    degrade.to_title_card(ctx, plan, item, BEAT)
    assert validate_plan(plan, tmp_path, ctx.cfg, 6.0, require_assets=True) == []


def test_the_floor_is_data(tmp_path):
    assert degrade.source_score_floor(make_ctx(tmp_path).cfg) == 0, "off by default"
    assert degrade.source_score_floor(make_ctx(tmp_path, min_score_floor=0.42).cfg) == 0.42


# ---------------- short clips ----------------


def test_short_footage_loops_rather_than_freezing(tmp_path):
    ctx = make_ctx(tmp_path)
    clip(tmp_path / "clips" / "v_b1.mp4", 2)
    item = {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 6.0, "media_type": "video",
            "asset": {"source": "stock", "path": "clips/v_b1.mp4"}}
    assert degrade.apply_short_clip_policy(ctx, item) == "loop"
    assert item["loop"] is True


def test_the_fallback_order_is_data(tmp_path):
    ctx = make_ctx(tmp_path, short_clip_fallback=["slow", "loop"])
    clip(tmp_path / "clips" / "v_b1.mp4", 3)
    item = {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 5.0, "media_type": "video",
            "asset": {"source": "stock", "path": "clips/v_b1.mp4"}}
    assert degrade.apply_short_clip_policy(ctx, item) == "slow"
    assert item["speed"] == pytest.approx(0.6, abs=0.05)
    assert "loop" not in item


def test_a_ramp_never_goes_below_half_speed(tmp_path):
    ctx = make_ctx(tmp_path, short_clip_fallback=["slow"])
    clip(tmp_path / "clips" / "v_b1.mp4", 1)
    item = {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 10.0, "media_type": "video",
            "asset": {"source": "stock", "path": "clips/v_b1.mp4"}}
    degrade.apply_short_clip_policy(ctx, item)
    assert item["speed"] == 0.5, "past this the shot looks broken, not slow"


def test_freeze_writes_nothing_down(tmp_path):
    ctx = make_ctx(tmp_path, short_clip_fallback=["freeze"])
    clip(tmp_path / "clips" / "v_b1.mp4", 2)
    item = {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 6.0, "media_type": "video",
            "asset": {"source": "stock", "path": "clips/v_b1.mp4"}}
    assert degrade.apply_short_clip_policy(ctx, item) is None
    assert "loop" not in item and "speed" not in item


def test_long_enough_footage_is_left_alone(tmp_path):
    ctx = make_ctx(tmp_path)
    clip(tmp_path / "clips" / "v_b1.mp4", 8)
    item = {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 6.0, "media_type": "video",
            "asset": {"source": "stock", "path": "clips/v_b1.mp4"}}
    assert degrade.apply_short_clip_policy(ctx, item) is None
    assert item == {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 6.0,
                    "media_type": "video", "asset": {"source": "stock", "path": "clips/v_b1.mp4"}}


def test_an_image_is_never_short(tmp_path):
    ctx = make_ctx(tmp_path)
    item = {"id": "v_b1", "beat_id": "b1", "start_s": 0.0, "end_s": 6.0, "media_type": "image",
            "asset": {"source": "stock", "path": "clips/v_b1.jpg"}}
    assert degrade.apply_short_clip_policy(ctx, item) is None
