"""Patch render, the worker half (D120): what to draw again when a plan changes."""

import copy
import json
import subprocess
from pathlib import Path

import pytest

from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.pipeline import patch

from test_agents import FakeDb

PLAN = {
    "version": "1.0", "video_id": "v", "fps": 30, "resolution": {"width": 1920, "height": 1080},
    "tracks": {
        "visual": [
            {"id": "v1", "start_s": 0, "end_s": 4, "media_type": "image", "asset": {"path": "clips/a.jpg"}},
            {"id": "v2", "start_s": 4, "end_s": 8, "media_type": "video", "asset": {"path": "clips/b.mp4"},
             "transition_out": {"type": "crossfade", "duration_s": 0.5}},
            {"id": "v3", "start_s": 8, "end_s": 12, "media_type": "image", "asset": {"path": "clips/c.jpg"}},
        ],
        "overlays": [
            {"id": "o1", "kind": "component", "component": "StatTag", "props": {"value": 3, "label": "x"},
             "start_s": 1, "end_s": 3},
            {"id": "o_cta", "kind": "component", "component": "SubscribeButton", "props": {"label": "Subscribe"},
             "start_s": 9, "end_s": 11},
        ],
        "captions": {"enabled": True, "preset": "boxed", "items": [
            {"text": "Hello there", "start_s": 0, "end_s": 2},
            {"text": "General Kenobi", "start_s": 2, "end_s": 4},
        ]},
        "audio": {
            "voiceover": {"path": "audio.mp3", "start_s": 0, "duration_s": 12},
            "sfx": [{"id": "s1", "cue": "pop", "start_s": 9.05, "end_s": 9.5, "origin_id": "o_cta"}],
        },
    },
}


def edited(fn):
    plan = copy.deepcopy(PLAN)
    fn(plan)
    return plan


def test_an_identical_plan_draws_nothing():
    assert patch.changed_spans(PLAN, copy.deepcopy(PLAN)) == ([], False)
    assert not patch.retimed(PLAN, copy.deepcopy(PLAN))


def test_a_swapped_asset_draws_its_shot_only():
    new = edited(lambda p: p["tracks"]["visual"][1].update(asset={"path": "clips/z.mp4"}))
    assert patch.changed_spans(PLAN, new) == ([(4.0, 8.0)], False)
    assert not patch.retimed(PLAN, new)


@pytest.mark.parametrize("field, value", [
    ("motion", {"type": "ken_burns"}), ("grade", "vintage"), ("crt", True), ("focus_y", 0.22),
    ("transition_out", {"type": "cut"}), ("media_type", "video"),
])
def test_every_field_a_shot_draws_with_counts(field, value):
    new = edited(lambda p: p["tracks"]["visual"][2].update({field: value}))
    assert patch.changed_spans(PLAN, new)[0] == [(8.0, 12.0)]


def test_a_changed_overlay_prop_draws_its_time():
    new = edited(lambda p: p["tracks"]["overlays"][0]["props"].update(value=7))
    assert patch.changed_spans(PLAN, new) == ([(1.0, 3.0)], False)


def test_a_moved_overlay_is_drawn_where_it_was_and_where_it_is():
    new = edited(lambda p: p["tracks"]["overlays"][0].update(start_s=5, end_s=7))
    assert patch.changed_spans(PLAN, new) == ([(1.0, 3.0), (5.0, 7.0)], False)
    assert not patch.retimed(PLAN, new), "a graphic moving is not the video's timing moving"


def test_a_changed_caption_draws_its_time():
    """Caption items carry no id, so they are compared as a set."""
    new = edited(lambda p: p["tracks"]["captions"]["items"][0].update(text="Hello"))
    assert patch.changed_spans(PLAN, new) == ([(0.0, 2.0), (0.0, 2.0)], False)


def test_a_changed_caption_style_redraws_every_caption():
    new = edited(lambda p: p["tracks"]["captions"].update(preset="karaoke"))
    assert sorted(set(patch.changed_spans(PLAN, new)[0])) == [(0.0, 2.0), (2.0, 4.0)]


def test_an_overlay_with_a_sound_cue_remixes_the_audio():
    new = edited(lambda p: p["tracks"]["overlays"][1]["props"].update(label="Inscreva-se"))
    assert patch.changed_spans(PLAN, new) == ([(9.0, 11.0)], True)


def test_a_changed_audio_track_remixes_with_no_picture():
    new = edited(lambda p: p["tracks"]["audio"].update(music=[{"path": "m.mp3", "start_s": 0, "end_s": 12}]))
    assert patch.changed_spans(PLAN, new) == ([], True)


@pytest.mark.parametrize("edit", [
    lambda p: p["tracks"]["visual"][1].update(end_s=7.5),                           # a shot retimed
    lambda p: p["tracks"]["visual"].pop(),                                          # a shot removed
    lambda p: p.update(fps=25),                                                     # the frame rate
    lambda p: p["tracks"]["audio"]["voiceover"].update(start_s=1.0),                # a cold open added
])
def test_a_retimed_plan_is_not_a_patch(edit):
    assert patch.retimed(PLAN, edited(edit))


# ---------------- patch_render ----------------


class Config:
    def __init__(self, cli: Path):
        self.engine_cli = cli


@pytest.fixture
def ctx(tmp_path):
    cli = tmp_path / "cli.ts"
    cli.write_text("// fake")
    c = StageContext(video={"id": "vid_p", "channel_id": "CH", "title": "T"}, folder=tmp_path,
                     cfg={"renderer": "auto"}, db=FakeDb(), config=Config(cli))
    c.db.try_render_slot = lambda slots: 1
    c.db.release_render_slot = lambda slot: None
    c.write_json("edit_plan.json", PLAN)
    return c


def test_a_retime_touches_nothing_and_asks_for_a_full_render(ctx, monkeypatch):
    monkeypatch.setattr(patch, "_run_engine", lambda *a, **k: pytest.fail("the engine must not run"))
    new = edited(lambda p: p["tracks"]["visual"][1].update(end_s=7.5))
    assert patch.patch_render(ctx, PLAN, new) is False
    assert ctx.read_json("edit_plan.json") == PLAN


def test_a_content_change_calls_the_engine_with_its_spans(ctx, monkeypatch):
    calls = []

    def run(args, timeout):
        calls.append(args)
        return subprocess.CompletedProcess(args, 0, json.dumps({"patched": [[3.5, 8.5]], "ok": True}), "")

    monkeypatch.setattr(patch, "_run_engine", run)
    new = edited(lambda p: p["tracks"]["visual"][1].update(asset={"path": "clips/z.mp4"}))
    assert patch.patch_render(ctx, PLAN, new) is True
    (args,) = calls
    assert args[3] == "patch"
    assert args[args.index("--spans") + 1] == "4-8"
    assert args[args.index("--audio") + 1] == "keep"
    assert ctx.read_json("edit_plan.json") == new, "the engine reads the NEW plan"


def test_long_video_seconds_keep_their_precision():
    assert patch._sec(1234.567) == "1234.567"
    assert patch._sec(4.0) == "4"
    assert patch._sec(27.193) == "27.193"


def test_an_engine_failure_puts_the_old_plan_back(ctx, monkeypatch):
    monkeypatch.setattr(patch, "_run_engine",
                        lambda args, timeout: subprocess.CompletedProcess(args, 1, "", "final.mp4 has 900 frames"))
    new = edited(lambda p: p["tracks"]["overlays"][0]["props"].update(value=9))
    with pytest.raises(StageError, match="900 frames"):
        patch.patch_render(ctx, PLAN, new)
    assert ctx.read_json("edit_plan.json") == PLAN, "the folder still describes its final.mp4"


def test_a_patch_that_times_out_puts_the_old_plan_back(ctx, monkeypatch):
    monkeypatch.setattr(patch, "_run_engine", lambda args, timeout: None)
    new = edited(lambda p: p["tracks"]["overlays"][0]["props"].update(value=9))
    with pytest.raises(StageError, match="no answer"):
        patch.patch_render(ctx, PLAN, new)
    assert ctx.read_json("edit_plan.json") == PLAN


def test_a_timed_out_engine_is_stopped_with_its_children():
    """`subprocess.run(timeout=)` kills only the node process and orphans the
    browser; the whole process group goes."""
    import time as _time

    started = _time.monotonic()
    assert patch._run_engine(["bash", "-c", "sleep 30 & sleep 30; wait"], timeout=0.5) is None
    assert _time.monotonic() - started < 10, "the child sleep did not keep it alive"


def test_a_change_the_audio_hears_is_a_full_render(ctx, monkeypatch):
    """Remixing costs a whole render (Remotion walks every frame for sound):
    measured 905 s for the audio of a 60 s window."""
    monkeypatch.setattr(patch, "_run_engine", lambda *a, **k: pytest.fail("no patch when the audio changes"))
    new = edited(lambda p: p["tracks"]["overlays"][1]["props"].update(label="Iscriviti"))
    assert patch.patch_render(ctx, PLAN, new) is False
    assert ctx.read_json("edit_plan.json") == PLAN


def test_a_changed_shot_that_plays_its_own_sound_changes_the_audio():
    old = edited(lambda p: p["tracks"]["visual"][1].update(mute=False))
    new = edited(lambda p: p["tracks"]["visual"][1].update(mute=False, asset={"path": "clips/z.mp4"}))
    assert patch.changed_spans(old, new) == ([(4.0, 8.0)], True)
    muted = edited(lambda p: p["tracks"]["visual"][1].update(asset={"path": "clips/z.mp4"}))
    assert patch.changed_spans(PLAN, muted) == ([(4.0, 8.0)], False), "a muted clip is only picture"


# ---------------- the render timeout (deployment config) ----------------


@pytest.mark.parametrize("raw, expected", [(None, 1800.0), ("7200", 7200.0), ("nonsense", 1800.0), ("5", 1800.0)])
def test_the_render_timeout_is_machine_config(monkeypatch, raw, expected):
    from lusora_worker.config import render_timeout_s

    if raw is None:
        monkeypatch.delenv("RENDER_TIMEOUT_S", raising=False)
    else:
        monkeypatch.setenv("RENDER_TIMEOUT_S", raw)
    assert render_timeout_s() == expected


def test_a_whole_render_that_times_out_says_which_knob(ctx, monkeypatch):
    from lusora_worker.pipeline import steps

    seen = {}

    def engine(args, timeout):
        seen["timeout"] = timeout
        return None

    monkeypatch.setenv("RENDER_TIMEOUT_S", "7200")
    monkeypatch.setattr(patch, "_run_engine", engine)
    with pytest.raises(StageError, match="RENDER_TIMEOUT_S"):
        steps.run_render(ctx)
    assert seen["timeout"] == 7200.0
