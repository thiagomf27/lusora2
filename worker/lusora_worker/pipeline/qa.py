"""Post-render QA (D57): look at the file before calling it finished.

Validation up to this point is structural — the plan is well formed, the assets
exist, the numbers agree. None of that notices that the render came out black,
or silent, or ninety seconds short, because none of it looks at the render.
This stage does, with ffmpeg, and fails with ONE reason naming the check and
the timestamp, exactly like every other stage (worker-pipeline.md).

Deliberately cheap and deliberately dumb: sampled frames and two audio
statistics, not a quality model. It catches the failures that are catastrophic
and invisible — the ones a human reviewer would name in the first two seconds,
and an unattended pipeline would otherwise publish.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from typing import Any

from ..errors import StageError

STAGE = "qa"

DEFAULTS = {
    "enabled": True,
    "frame_samples": 12,
    "black_luma_max": 0.06,
    "max_black_samples": 1,
    "flat_frame_range": 2,
    "silence_dbfs": -50.0,
    "max_silence_run_s": 3.0,
    "clip_dbfs": -0.1,
    "duration_tolerance_s": 1.0,
}


def settings(cfg: dict[str, Any]) -> dict[str, Any]:
    return {**DEFAULTS, **((cfg.get("qa") or {}))}


def frame_stats(path: Path, at_s: float) -> tuple[float, int] | None:
    """(mean luma 0..1, range) of one frame, sampled as an 8x8 grey thumbnail.

    The range — brightest minus darkest of the 64 cells — is what separates a
    frame from a FLAT one: a broken overlay painting a solid panel over the
    shot, or a still that never decoded, has a range of nearly zero while its
    mean says nothing is wrong.
    """
    proc = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{at_s:.3f}", "-i", str(path),
         "-frames:v", "1", "-vf", "scale=8:8,format=gray", "-f", "rawvideo", "-"],
        capture_output=True,
    )
    pixels = proc.stdout
    if len(pixels) < 64:
        return None
    cells = list(pixels[:64])
    return sum(cells) / len(cells) / 255.0, max(cells) - min(cells)


def audio_levels(path: Path) -> tuple[float, float] | None:
    """(mean dBFS, max dBFS) over the whole mix, from ffmpeg's volumedetect."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    mean = re.search(r"mean_volume:\s*(-?\d+(?:\.\d+)?) dB", proc.stderr)
    peak = re.search(r"max_volume:\s*(-?\d+(?:\.\d+)?) dB", proc.stderr)
    if not mean or not peak:
        return None
    return float(mean.group(1)), float(peak.group(1))


def silence_runs(path: Path, threshold_dbfs: float, min_run_s: float) -> list[tuple[float, float]]:
    """Runs of near-silence longer than min_run_s, as (start, duration)."""
    proc = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(path),
         "-af", f"silencedetect=noise={threshold_dbfs}dB:d={min_run_s}", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    starts = [float(m) for m in re.findall(r"silence_start:\s*(-?\d+(?:\.\d+)?)", proc.stderr)]
    durations = [float(m) for m in re.findall(r"silence_duration:\s*(\d+(?:\.\d+)?)", proc.stderr)]
    return list(zip(starts, durations))


def probe_duration(path: Path) -> float | None:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    try:
        return float(proc.stdout.strip().splitlines()[0])
    except (ValueError, IndexError):
        return None


def sample_points(duration_s: float, count: int) -> list[float]:
    """Evenly spaced instants, inset from both ends.

    The inset is not politeness: an opening fade, or a fade_to_black landing on
    the last frame, is legitimately black, and a check that fails a video for
    its own fade is a check nobody keeps.
    """
    count = max(1, int(count))
    inset = min(1.0, duration_s * 0.1)
    span = max(duration_s - 2 * inset, 0.0)
    if count == 1 or span <= 0:
        return [max(duration_s / 2, 0.0)]
    return [inset + span * i / (count - 1) for i in range(count)]


def inspect(video: Path, expected_duration_s: float | None, cfg: dict[str, Any]) -> list[str]:
    """Every complaint about the finished file. Empty = ship it."""
    opts = settings(cfg)
    problems: list[str] = []

    duration = probe_duration(video)
    if duration is None:
        return [f"{video.name} has no readable duration — the render produced an unusable file"]

    if expected_duration_s is not None:
        tolerance = float(opts["duration_tolerance_s"])
        if abs(duration - expected_duration_s) > tolerance:
            problems.append(
                f"{video.name} runs {duration:.2f}s but the voiceover is {expected_duration_s:.2f}s "
                f"(tolerance {tolerance:g}s) — the render was cut short or padded"
            )

    black: list[float] = []
    flat: list[float] = []
    unreadable: list[float] = []
    for at in sample_points(duration, int(opts["frame_samples"])):
        stats = frame_stats(video, at)
        if stats is None:
            unreadable.append(at)
            continue
        mean, spread = stats
        if mean <= float(opts["black_luma_max"]):
            black.append(at)
        elif spread <= int(opts["flat_frame_range"]):
            flat.append(at)

    if unreadable:
        problems.append(
            f"{len(unreadable)} sampled frame(s) would not decode, first at {unreadable[0]:.1f}s — "
            "the video stream is damaged"
        )
    if len(black) > int(opts["max_black_samples"]):
        problems.append(
            f"{len(black)} of {int(opts['frame_samples'])} sampled frames are black "
            f"(first at {black[0]:.1f}s, luma under {float(opts['black_luma_max']):.2f}) — "
            "an asset failed to draw, or a transition is holding on black"
        )
    if flat:
        problems.append(
            f"{len(flat)} sampled frame(s) are a flat fill with nothing on them, first at "
            f"{flat[0]:.1f}s — an overlay is covering the shot, or the asset never decoded"
        )

    levels = audio_levels(video)
    if levels is None:
        problems.append(f"{video.name} carries no readable audio track — the mix is missing")
    else:
        mean_db, peak_db = levels
        if mean_db <= float(opts["silence_dbfs"]):
            problems.append(
                f"the mix averages {mean_db:.1f} dBFS, at or under the "
                f"{float(opts['silence_dbfs']):g} dBFS silence threshold — the video has no sound"
            )
        elif peak_db >= float(opts["clip_dbfs"]):
            problems.append(
                f"the mix peaks at {peak_db:.1f} dBFS, at or over {float(opts['clip_dbfs']):g} — "
                "it is clipping, and will distort further after the platform normalises it"
            )
        runs = silence_runs(video, float(opts["silence_dbfs"]), float(opts["max_silence_run_s"]))
        if runs:
            start, length = runs[0]
            problems.append(
                f"{len(runs)} silent stretch(es) longer than {float(opts['max_silence_run_s']):g}s, "
                f"first {length:.1f}s from {start:.1f}s — the narration has a hole in it"
            )
    return problems


def check(ctx, video: Path, expected_duration_s: float | None) -> None:
    """Raise with ONE actionable reason, or return quietly."""
    opts = settings(ctx.cfg)
    if not opts.get("enabled", True):
        ctx.log("post-render QA disabled for this channel")
        return
    problems = inspect(video, expected_duration_s, ctx.cfg)
    if problems:
        # every complaint is recorded; the STATUS carries one reason (the error
        # model: which stage, which file, why — not a list to triage)
        for extra in problems[1:]:
            ctx.db.event(ctx.video_id, STAGE, "progress", extra)
        raise StageError(STAGE, problems[0])
    ctx.log(f"post-render QA passed ({int(opts['frame_samples'])} frames sampled, audio checked)")
