"""TTS provider adapters.

Contract: synthesize(ctx, script) -> writes audio.mp3 AND
tts_timings.json (exact per-sentence start/end). The transcript stage
builds subtitles.srt from those timings — no Whisper needed when the
adapter knows its own timing (free-first, Core Principle 6).

Providers:
  local — ffmpeg's flite filter (offline, $0; English voices)
  mock  — silence, estimated durations ($0; for tests/CI)
  ai33  — api.ai33.pro aggregator (edge/minimax/elevenlabs/kokoro voices;
          async task API: POST /v3/text-to-speech -> task_id,
          GET /v3/task/{id} -> cdn audio_url when done)
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

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
        elif provider == "ai33":
            credits = _ai33(ctx, sentences)
            cost.actual(len(script), {"sentences": len(sentences), "credits": credits})
        else:
            raise StageError(
                STAGE,
                f"TTS provider '{provider}' is not implemented — use 'local', 'mock' or 'ai33', "
                "or add an adapter in providers/tts.py",
            )
        if provider != "ai33":
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


def _ai33(ctx: StageContext, sentences: list[str]) -> float:
    """Per-sentence synthesis for exact timings (same contract as flite).
    Returns total credits reported by the API."""
    api_key = os.environ.get("AI33_API_KEY")
    if not api_key:
        raise StageError(STAGE, "voice provider ai33 needs AI33_API_KEY in .env")
    base = os.environ.get("AI33_BASE_URL", "https://api.ai33.pro").rstrip("/")
    voice = str(((ctx.cfg.get("voice") or {}).get("voice_id")) or "edge_en-US-GuyNeural")
    headers = {"xi-api-key": api_key}

    tmp_dir = Path(tempfile.mkdtemp(prefix="lusora_ai33_"))
    total_credits = 0.0
    try:
        durations: list[float] = []
        files: list[Path] = []
        for i, sentence in enumerate(sentences):
            try:
                resp = httpx.post(
                    f"{base}/v3/text-to-speech", headers=headers,
                    files={
                        "text": (None, sentence),
                        "voice_id": (None, voice),
                        "speed": (None, "1"),
                        "with_transcript": (None, "false"),
                    },
                    timeout=60,
                )
                resp.raise_for_status()
                body = resp.json()
            except httpx.HTTPError as e:
                raise StageError(STAGE, f"ai33 synthesis request failed (sentence {i + 1}): {e}")
            if not body.get("success") or not body.get("task_id"):
                raise StageError(STAGE, f"ai33 rejected sentence {i + 1}: {body.get('message', body)}")

            audio_url, credits = _ai33_wait(base, headers, str(body["task_id"]), i + 1)
            total_credits += credits
            seg = tmp_dir / f"s{i:04d}.mp3"
            try:
                with httpx.stream("GET", audio_url, timeout=120, follow_redirects=True) as dl:
                    dl.raise_for_status()
                    with open(seg, "wb") as f:
                        for chunk in dl.iter_bytes():
                            f.write(chunk)
            except httpx.HTTPError as e:
                raise StageError(STAGE, f"ai33 audio download failed (sentence {i + 1}): {e}")
            durations.append(probe_duration(STAGE, seg))
            files.append(seg)

        concat_list = tmp_dir / "list.txt"
        concat_list.write_text("".join(f"file '{f}'\n" for f in files), encoding="utf-8")
        run_ffmpeg(STAGE, [
            "-f", "concat", "-safe", "0", "-i", str(concat_list),
            "-acodec", "libmp3lame", "-q:a", "3", str(ctx.artifact("audio.mp3")),
        ])
        _write_timings(ctx, sentences, durations)
        return total_credits
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


def _ai33_wait(base: str, headers: dict, task_id: str, n: int, timeout_s: float = 300) -> tuple[str, float]:
    deadline = time.time() + timeout_s
    delay = 2.0
    while time.time() < deadline:
        try:
            resp = httpx.get(f"{base}/v3/task/{task_id}", headers=headers, timeout=30)
            if resp.status_code == 429:  # polling rate limit — back off, not a failure
                time.sleep(min(delay, 15))
                delay *= 1.6
                continue
            resp.raise_for_status()
            data = resp.json().get("data") or {}
        except httpx.HTTPError as e:
            raise StageError(STAGE, f"ai33 task poll failed (sentence {n}): {e}")
        status = str(data.get("status") or "")
        if status == "done":
            audio_url = ((data.get("metadata") or {}).get("audio_url"))
            if not audio_url:
                raise StageError(STAGE, f"ai33 task {task_id} done but returned no audio_url")
            return str(audio_url), float(data.get("credit_cost") or 0)
        if status in ("failed", "error"):
            raise StageError(STAGE, f"ai33 task {task_id} failed: {data.get('error') or data}")
        time.sleep(min(delay, 10))
        delay *= 1.3
    raise StageError(STAGE, f"ai33 task {task_id} timed out after {timeout_s:.0f}s (sentence {n})")


def _mock(ctx: StageContext, sentences: list[str]) -> None:
    durations = [max(1.2, round(len(s) * 0.055, 2)) for s in sentences]
    total = sum(durations)
    run_ffmpeg(STAGE, [
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-t", f"{total:.3f}", "-acodec", "libmp3lame", "-q:a", "9",
        str(ctx.artifact("audio.mp3")),
    ])
    _write_timings(ctx, sentences, durations)
