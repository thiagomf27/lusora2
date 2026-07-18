"""ffmpeg/ffprobe helpers used by stages (worker side only — the engine
has its own renderer; this is for probing and small utility outputs)."""

from __future__ import annotations

import subprocess
from pathlib import Path

from .errors import StageError


def run_ffmpeg(stage: str, args: list[str]) -> None:
    proc = subprocess.run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", *args],
                          capture_output=True, text=True)
    if proc.returncode != 0:
        raise StageError(stage, f"ffmpeg failed: {proc.stderr.strip()[-400:]}")


def probe_duration(stage: str, path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        raise StageError(stage, f"ffprobe could not read {path.name}: {proc.stderr.strip()[-200:]}")
    return float(proc.stdout.strip())


def extract_audio(stage: str, video: Path, out_mp3: Path) -> None:
    run_ffmpeg(stage, ["-i", str(video), "-vn", "-acodec", "libmp3lame", "-q:a", "4", str(out_mp3)])
