"""TTS provider adapters.

Contract: synthesize(ctx, script) -> writes audio.mp3 AND
tts_timings.json (exact per-sentence start/end). The transcript stage
builds subtitles.srt from those timings — no Whisper needed when the
adapter knows its own timing (free-first, Core Principle 6).

Providers:
  local — ffmpeg's flite filter (offline, $0; English voices)
  mock  — silence, estimated durations ($0; for tests/CI)
Paid APIs (elevenlabs, openai) plug in here later with the same contract.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from pathlib import Path

from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..media import probe_duration, run_ffmpeg
from ..textsplit import split_sentences

STAGE = "narration"


def synthesize(ctx: StageContext, script: str) -> None:
    provider = str(((ctx.cfg.get("voice") or {}).get("provider")) or "mock")
    sentences = split_sentences(script)
    if not sentences:
        raise StageError(STAGE, "script.txt is empty — nothing to narrate")

    with budget_gate(
        ctx,
        stage=STAGE,
        provider=provider if provider in ("local", "mock") else provider,
        operation="tts.narrate",
        estimated_units=len(script),
        details={"sentences": len(sentences)},
    ) as cost:
        if provider == "local":
            _flite(ctx, sentences)
        elif provider == "mock":
            _mock(ctx, sentences)
        else:
            raise StageError(
                STAGE,
                f"TTS provider '{provider}' is not implemented — use 'local' or 'mock', "
                "or add an adapter in providers/tts.py",
            )
        cost.actual(len(script))
    ctx.db.provider_health(f"tts.{provider}", True)


def _write_timings(ctx: StageContext, sentences: list[str], durations: list[float]) -> None:
    t = 0.0
    items = []
    for sentence, d in zip(sentences, durations):
        items.append({"text": sentence, "start_s": round(t, 3), "end_s": round(t + d, 3)})
        t += d
    ctx.write_json("tts_timings.json", {"provider_exact": True, "items": items})


def _flite(ctx: StageContext, sentences: list[str]) -> None:
    voice = str(((ctx.cfg.get("voice") or {}).get("voice_id")) or "kal16")
    if voice not in ("kal", "kal16", "awb", "rms", "slt"):
        voice = "kal16"
    tmp_dir = Path(tempfile.mkdtemp(prefix="lusora_tts_"))
    try:
        durations: list[float] = []
        wavs: list[Path] = []
        for i, sentence in enumerate(sentences):
            wav = tmp_dir / f"s{i:04d}.wav"
            # flite filter takes text inline; escape for lavfi
            text = sentence.replace("\\", " ").replace("'", "’").replace(":", ",").replace("%", " percent")
            run_ffmpeg(STAGE, [
                "-f", "lavfi", "-i", f"flite=text='{text}':voice={voice}",
                "-ar", "44100", str(wav),
            ])
            durations.append(probe_duration(STAGE, wav))
            wavs.append(wav)
        concat_list = tmp_dir / "list.txt"
        concat_list.write_text("".join(f"file '{w}'\n" for w in wavs), encoding="utf-8")
        run_ffmpeg(STAGE, [
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-acodec", "libmp3lame", "-q:a", "4", str(ctx.artifact("audio.mp3")),
        ])
        _write_timings(ctx, sentences, durations)
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _mock(ctx: StageContext, sentences: list[str]) -> None:
    durations = [max(1.2, round(len(s) * 0.055, 2)) for s in sentences]
    total = sum(durations)
    run_ffmpeg(STAGE, [
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-t", f"{total:.3f}", "-acodec", "libmp3lame", "-q:a", "9",
        str(ctx.artifact("audio.mp3")),
    ])
    _write_timings(ctx, sentences, durations)
