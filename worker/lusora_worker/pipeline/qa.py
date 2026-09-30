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

import json
import re
import subprocess
from collections.abc import Callable
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


# A source frame at or under this mean luma is DARK footage (night, dusk,
# archive): a render that comes out near-black over it is showing the shot,
# not failing to draw it. Well above black_luma_max, because the theme's grade
# (desaturation, a vignette) darkens what it is given.
DARK_SOURCE_LUMA_MAX = 0.15

# video time -> (the file the plan shows there, the moment within it); None
# where the plan shows no file (a colour card) or the caller has no plan
SourceAt = Callable[[float], "tuple[Path, float] | None"]

# video time -> the transition kind drawing a SOLID FILL there (the white of a
# flash, the black of a dip), or None. A declared fill is the plan working, not
# the render failing, so a sample inside one is excused rather than counted.
FillAt = Callable[[float], "str | None"]

# The transitions that pass through a solid frame on purpose (transitions plan).
FILL_TRANSITIONS = ("flash", "fade_to_black")


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


def inspect(
    video: Path,
    expected_duration_s: float | None,
    cfg: dict[str, Any],
    source_at: SourceAt | None = None,
    excused: list[str] | None = None,
    fill_at: FillAt | None = None,
) -> list[str]:
    """Every complaint about the finished file. Empty = ship it.

    With `source_at`, a black sample is checked against the footage the plan
    put there: if that source frame is itself dark, the render is showing a
    night shot, not failing to draw one, and the sample is excused (and
    described in `excused`). The first real 5-minute test stopped on two
    such frames — a night aerial and a dusk aerial, both exactly as shot."""
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
        is_black = mean <= float(opts["black_luma_max"])
        if is_black or spread <= int(opts["flat_frame_range"]):
            fill = fill_at(at) if fill_at else None
            if fill is not None:
                if excused is not None:
                    excused.append(f"{at:.1f}s (inside a {fill})")
                continue
        if is_black:
            source = source_at(at) if source_at else None
            origin = frame_stats(source[0], source[1]) if source else None
            if origin is not None and origin[0] <= DARK_SOURCE_LUMA_MAX:
                if excused is not None:
                    excused.append(f"{at:.1f}s ({source[0].name}, source luma {origin[0]:.2f})")
                continue
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


DECODE_EDGE_S = 8.0


def _decodes(path: Path, start_s: float | None) -> bool:
    """ffmpeg reads DECODE_EDGE_S seconds from `start_s` (or the start) with
    no error at all — exit 0 and an empty stderr."""
    argv = ["ffmpeg", "-v", "error", "-nostdin"]
    if start_s is not None:
        argv += ["-ss", f"{start_s:.3f}"]
    argv += ["-i", str(path), "-t", f"{DECODE_EDGE_S:g}", "-f", "null", "-"]
    proc = subprocess.run(argv, capture_output=True, text=True, timeout=300)
    return proc.returncode == 0 and not proc.stderr.strip()


def container_problems(path: Path, plan: dict[str, Any] | None) -> list[str]:
    """The finished MP4 checked as a FILE (D118, Dark Palace's `confere`):
    an H.264 picture at the plan's resolution, an audio track, and a clean
    decode of the first and last eight seconds. The sampled-frame checks below
    look at the picture; this catches the file a player refuses — a missing
    moov atom, a truncated tail, a stream the encoder never wrote."""
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", str(path)],
        capture_output=True, text=True, timeout=120,
    )
    try:
        probe = json.loads(proc.stdout or "{}")
    except ValueError:
        probe = {}
    streams = probe.get("streams") or []
    if proc.returncode != 0 or not streams:
        return [f"{path.name} is not a readable MP4 (ffprobe: {(proc.stderr or 'no streams').strip()[:160]})"]
    problems: list[str] = []
    video = [s for s in streams if s.get("codec_type") == "video"]
    want = (plan or {}).get("resolution") or {}
    if not video:
        problems.append(f"{path.name} has no video stream")
    else:
        v = video[0]
        if v.get("codec_name") != "h264":
            problems.append(f"{path.name}'s picture is {v.get('codec_name')}, not H.264")
        if want and (v.get("width"), v.get("height")) != (want.get("width"), want.get("height")):
            problems.append(f"{path.name} is {v.get('width')}x{v.get('height')}, "
                            f"not the plan's {want.get('width')}x{want.get('height')}")
    if not any(s.get("codec_type") == "audio" for s in streams):
        problems.append(f"{path.name} has no audio stream")
    try:
        duration = float((probe.get("format") or {}).get("duration") or 0)
    except ValueError:
        duration = 0.0
    if not _decodes(path, None):
        problems.append(f"{path.name} does not decode cleanly in its first {DECODE_EDGE_S:g} s")
    if not _decodes(path, max(0.0, duration - DECODE_EDGE_S)):
        problems.append(f"{path.name} does not decode cleanly in its last {DECODE_EDGE_S:g} s")
    return problems


def check(ctx, video: Path, expected_duration_s: float | None,
          source_at: SourceAt | None = None, fill_at: FillAt | None = None,
          plan: dict[str, Any] | None = None) -> None:
    """Raise with ONE actionable reason, or return quietly."""
    # D118: a property of any deliverable, so not behind the QA switch
    problems = container_problems(video, plan)
    if problems:
        for extra in problems[1:]:
            ctx.db.event(ctx.video_id, STAGE, "progress", extra)
        raise StageError(STAGE, problems[0])
    opts = settings(ctx.cfg)
    if not opts.get("enabled", True):
        ctx.log("post-render QA disabled for this channel")
        return
    excused: list[str] = []
    problems = inspect(video, expected_duration_s, ctx.cfg, source_at, excused, fill_at)
    if excused:
        ctx.log(f"QA: {len(excused)} frame(s) excused — dark footage, or a flash or dip the "
                "plan declared: " + "; ".join(excused))
    if problems:
        # every complaint is recorded; the STATUS carries one reason (the error
        # model: which stage, which file, why — not a list to triage)
        for extra in problems[1:]:
            ctx.db.event(ctx.video_id, STAGE, "progress", extra)
        raise StageError(STAGE, problems[0])
    ctx.log(f"post-render QA passed ({int(opts['frame_samples'])} frames sampled, audio checked)")
