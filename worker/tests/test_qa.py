"""Post-render QA (D57): the checks that look at the finished file.

Fixtures are built with ffmpeg, because a test that mocks ffmpeg's output
proves only that the regex works — and every failure this stage exists to catch
is a property of real bytes.
"""

from pathlib import Path

import pytest

from lusora_worker.context import StageContext
from lusora_worker.errors import StageError
from lusora_worker.media import run_ffmpeg
from lusora_worker.pipeline import qa

from test_agents import FakeDb


def make_ctx(tmp_path, **opts):
    return StageContext(
        video={"id": "vid_t", "channel_id": "CH", "title": "T"},
        folder=tmp_path,
        cfg={"qa": opts} if opts else {},
        db=FakeDb(),
        config=None,
    )


def render(path: Path, *, video: str, audio: str, seconds: float) -> Path:
    run_ffmpeg("t", ["-f", "lavfi", "-i", video, "-f", "lavfi", "-i", audio,
                     "-t", f"{seconds}", "-pix_fmt", "yuv420p", "-c:a", "aac",
                     "-shortest", str(path)])
    return path


GOOD_VIDEO = "testsrc=size=320x180:rate=30"
GOOD_AUDIO = "sine=frequency=330:sample_rate=44100"


def test_a_good_render_passes(tmp_path):
    good = render(tmp_path / "final.mp4", video=GOOD_VIDEO, audio=GOOD_AUDIO, seconds=6)
    assert qa.inspect(good, 6.0, {}) == []


def test_a_black_render_fails_with_the_check_and_a_timestamp(tmp_path):
    black = render(tmp_path / "final.mp4", video="color=c=black:s=320x180:rate=30",
                   audio=GOOD_AUDIO, seconds=6)
    problems = qa.inspect(black, 6.0, {})
    assert problems, "a black video must not ship"
    assert "sampled frames are black" in problems[0]
    assert "first at" in problems[0], "the reason has to say WHERE"


def test_a_silent_render_fails(tmp_path):
    silent = render(tmp_path / "final.mp4", video=GOOD_VIDEO,
                    audio="anullsrc=sample_rate=44100", seconds=6)
    problems = qa.inspect(silent, 6.0, {})
    assert any("no sound" in p for p in problems)


def test_a_flat_frame_is_caught_even_when_it_is_not_black(tmp_path):
    """A broken overlay painting a solid panel over the shot has a perfectly
    ordinary mean luma. Only the spread says nothing is on screen."""
    flat = render(tmp_path / "final.mp4", video="color=c=0x808080:s=320x180:rate=30",
                  audio=GOOD_AUDIO, seconds=6)
    problems = qa.inspect(flat, 6.0, {})
    assert any("flat fill" in p for p in problems)


def test_a_short_render_fails_against_the_voiceover(tmp_path):
    short = render(tmp_path / "final.mp4", video=GOOD_VIDEO, audio=GOOD_AUDIO, seconds=4)
    problems = qa.inspect(short, 9.0, {})
    assert "runs 4" in problems[0] and "voiceover is 9" in problems[0]


def test_a_hole_in_the_narration_is_caught(tmp_path):
    """Sound at both ends, five seconds of nothing in the middle: every level
    average looks fine and the video is unwatchable."""
    gap = tmp_path / "final.mp4"
    run_ffmpeg("t", [
        "-f", "lavfi", "-i", GOOD_VIDEO,
        "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=2",
        "-f", "lavfi", "-i", "anullsrc=sample_rate=44100:duration=5",
        "-f", "lavfi", "-i", "sine=frequency=330:sample_rate=44100:duration=2",
        "-filter_complex", "[1:a][2:a][3:a]concat=n=3:v=0:a=1[a]",
        "-map", "0:v", "-map", "[a]", "-t", "9", "-pix_fmt", "yuv420p", "-c:a", "aac",
        str(gap),
    ])
    problems = qa.inspect(gap, 9.0, {})
    assert any("silent stretch" in p for p in problems)


def test_the_thresholds_are_data(tmp_path):
    black = render(tmp_path / "final.mp4", video="color=c=black:s=320x180:rate=30",
                   audio=GOOD_AUDIO, seconds=6)
    # a channel that ships black frames on purpose can say so
    lenient = {"black_luma_max": 0.0, "flat_frame_range": 0}
    assert not any("black" in p for p in qa.inspect(black, 6.0, {"qa": lenient}))
    assert qa.settings({})["frame_samples"] == 12
    assert qa.settings({"qa": {"frame_samples": 3}})["frame_samples"] == 3


def test_a_fade_to_black_does_not_fail_a_video(tmp_path):
    """The tolerance exists because the last frame of a fade_to_black is
    legitimately black, and a check that fails a video for its own fade is a
    check nobody keeps."""
    faded = tmp_path / "final.mp4"
    run_ffmpeg("t", ["-f", "lavfi", "-i", GOOD_VIDEO, "-f", "lavfi", "-i", GOOD_AUDIO,
                     "-t", "6", "-vf", "fade=t=out:st=5:d=1", "-pix_fmt", "yuv420p",
                     "-c:a", "aac", "-shortest", str(faded)])
    assert qa.inspect(faded, 6.0, {}) == []


def test_check_raises_one_reason_and_records_the_rest(tmp_path):
    bad = render(tmp_path / "final.mp4", video="color=c=black:s=320x180:rate=30",
                 audio="anullsrc=sample_rate=44100", seconds=6)
    ctx = make_ctx(tmp_path)
    with pytest.raises(StageError) as raised:
        qa.check(ctx, bad, 6.0)
    assert raised.value.stage == "qa"
    assert ";" not in raised.value.reason, "one reason, not a list to triage"
    assert ctx.db.events, "the other complaints are still recorded"


def test_qa_can_be_turned_off(tmp_path):
    bad = render(tmp_path / "final.mp4", video="color=c=black:s=320x180:rate=30",
                 audio="anullsrc=sample_rate=44100", seconds=6)
    qa.check(make_ctx(tmp_path, enabled=False), bad, 6.0)  # no raise


def test_an_unreadable_file_is_a_failure_not_a_crash(tmp_path):
    (tmp_path / "final.mp4").write_bytes(b"not a video")
    problems = qa.inspect(tmp_path / "final.mp4", 6.0, {})
    assert len(problems) == 1 and "no readable duration" in problems[0]
