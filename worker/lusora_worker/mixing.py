"""The sound mix, Dark Palace's `musica.py` (D114, documentary plan slice 9).

Four jobs, all plain ffmpeg + numpy:

  speech_windows  where the narrator is actually speaking, read off the voice's
                  waveform in 10 ms blocks (the compiler ducks the bed from it)
  lufs            a file's integrated loudness
  craft_bed       a bed of exactly the length a span needs: loudness-matched,
                  its own fade-in and dying tail cut away, looped through long
                  equal-power crossfades so no seam is ever heard
  normalize_voice the narration brought to a set loudness before anything is
                  mixed against it

Deterministic: the same files in give the same files out.
"""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Any

import numpy as np

SR = 48000
BED_LUFS = -20.0      # DP's BASE_LUFS: every bed is brought here, so the compiler knows its level
BLOCK_S = 0.01        # DP: 10 ms blocks
SPEECH_REL_DB = -24.0  # a block within this of the voice's loud blocks is speech
SPEECH_HOLD_S = 0.35   # held this long, so the gaps between words do not pump the bed
_READ_SR = 8000        # only the voice's timing matters


class MixError(RuntimeError):
    pass


def _run(cmd: list[str]) -> subprocess.CompletedProcess:
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise MixError(proc.stderr.decode("utf-8", "replace").strip().splitlines()[-1:] or ["ffmpeg failed"])
    return proc


def _mono(path: Path, sr: int) -> np.ndarray:
    raw = _run(["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]).stdout
    return np.frombuffer(raw, np.float32)


def speech_windows(voice: Path) -> list[list[float]]:
    """[[start_s, end_s], ...] where the voice is speaking, in the file's own time.

    DP's `respiro`: RMS per 10 ms block; speech is any block within
    SPEECH_REL_DB of the 95th-percentile block, held SPEECH_HOLD_S so the
    breaths between words stay under the duck.
    """
    x = _mono(voice, _READ_SR)
    b = int(_READ_SR * BLOCK_S)
    n = len(x) // b
    if n == 0:
        return []
    rms = np.sqrt(np.mean(x[: n * b].reshape(n, b) ** 2, axis=1) + 1e-12)
    loud = np.percentile(rms, 95)
    talking = 20 * np.log10(rms / loud) > SPEECH_REL_DB
    hold = max(1, int(round(SPEECH_HOLD_S / BLOCK_S)))
    talking = np.convolve(talking.astype(np.float32), np.ones(hold), mode="full")[:n] > 0
    windows: list[list[float]] = []
    start = None
    for k, on in enumerate(talking):
        if on and start is None:
            start = k
        elif not on and start is not None:
            windows.append([round(start * BLOCK_S, 3), round(k * BLOCK_S, 3)])
            start = None
    if start is not None:
        windows.append([round(start * BLOCK_S, 3), round(n * BLOCK_S, 3)])
    return windows


def lufs(path: Path) -> float:
    err = _run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "loudnorm=print_format=json",
                "-f", "null", "-"]).stderr.decode("utf-8", "replace")
    value = json.loads(err[err.rindex("{"): err.rindex("}") + 1])["input_i"]
    if value in ("-inf", "inf"):
        raise MixError(f"{path.name} is silent")
    return float(value)


def duration(path: Path) -> float:
    out = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).stdout
    return float(out.decode().strip())


def body(path: Path, drop_db: float = 8.0) -> tuple[float, float]:
    """(start, end) of a track with its own fade-in and dying tail cut away (DP's
    `miolo`): a crossfade into a tail that has already faded leaves a hole."""
    x = _mono(path, 8000)
    n = len(x) // 4000
    if n == 0:
        return 0.0, len(x) / 8000
    db = 20 * np.log10(np.sqrt(np.mean(x[: n * 4000].reshape(n, 4000) ** 2, axis=1)) + 1e-9)  # every 0.5 s
    ok = np.where(db > np.median(db) - drop_db)[0]
    return (float(ok[0]) * 0.5, float(ok[-1] + 1) * 0.5) if len(ok) else (0.0, len(x) / 8000)


def craft_bed(track: Path, total_s: float, out: Path, crossfade_s: float = 7.0) -> Path:
    """`total_s` seconds of `track` at BED_LUFS, looped without a seam (DP's `cama`).

    The loop unit is the track's body from x to its end, its last x seconds
    crossfading into its own first x: played over and over it never jumps,
    because each repeat starts exactly where the crossfade left off. No fades
    at the ends — the plan's fade_in_s / fade_out_s draw those.
    """
    work = out.parent
    gain = BED_LUFS - lufs(track)
    a, b = body(track)
    chain = work / f".{out.stem}.chain.wav"
    unit = work / f".{out.stem}.unit.wav"
    try:
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(track), "-af",
              f"atrim={a:.2f}:{b:.2f},asetpts=PTS-STARTPTS,aformat=sample_fmts=fltp:sample_rates={SR}:"
              f"channel_layouts=stereo,volume={gain:.2f}dB", "-c:a", "pcm_s16le", str(chain)])
        d = duration(chain)
        x = min(crossfade_s, d / 4)
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(chain), "-filter_complex",
              f"[0:a]asplit[a][b];[a]atrim={x:.3f}:{d:.3f},asetpts=PTS-STARTPTS,"
              f"afade=t=out:st={d - 2 * x:.3f}:d={x:.3f}:curve=qsin[body];"
              f"[b]atrim=0:{x:.3f},asetpts=PTS-STARTPTS,afade=t=in:d={x:.3f}:curve=qsin,"
              f"adelay={int((d - 2 * x) * 1000)}:all=1[head];"
              "[body][head]amix=inputs=2:normalize=0:duration=first[u]",
              "-map", "[u]", "-c:a", "pcm_s16le", str(unit)])
        loops = int(math.ceil(total_s / (d - x))) + 1
        _run(["ffmpeg", "-v", "error", "-y", "-i", str(chain), "-stream_loop", str(loops), "-i", str(unit),
              "-filter_complex", f"[0:a]atrim=0:{x:.3f}[s];[s][1:a]concat=n=2:v=0:a=1,atrim=0:{total_s:.3f}[m]",
              "-map", "[m]", "-c:a", "libmp3lame", "-b:a", "192k", str(out)])
    finally:
        chain.unlink(missing_ok=True)
        unit.unlink(missing_ok=True)
    return out


def normalize_voice(src: Path, out: Path, target_lufs: float) -> dict[str, Any]:
    """Two-pass loudnorm of the narration (measure, then a linear gain to the
    target with a -1.5 dBTP ceiling), so what the bed and cues are balanced
    against is a known level. Returns the measurement."""
    err = _run(["ffmpeg", "-hide_banner", "-i", str(src), "-af",
                f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"]).stderr
    text = err.decode("utf-8", "replace")
    m = json.loads(text[text.rindex("{"): text.rindex("}") + 1])
    _run(["ffmpeg", "-v", "error", "-y", "-i", str(src), "-af",
          f"loudnorm=I={target_lufs}:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:"
          f"measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:"
          f"linear=true,aresample={SR}", "-c:a", "libmp3lame", "-b:a", "192k", str(out)])
    return m
