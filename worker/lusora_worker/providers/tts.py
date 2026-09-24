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

import hashlib
import os
import re
import shutil
import subprocess
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

from .. import align
from ..config import parallelism
from ..context import StageContext
from ..costs import budget_gate
from ..errors import StageError
from ..media import probe_duration, run_ffmpeg
from ..textsplit import split_sentences

STAGE = "narration"

# ai33 is a busy aggregator in front of other vendors: it answers 429 when we
# poll too fast and 5xx when a backend hiccups. Both are weather, not errors —
# failing the stage on one throws away a run that has already been paid for
# (earlier sentences are synthesized) and that a retry would complete.
_AI33_RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


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
            credits, chars = _ai33(ctx, sentences, script)
            # billed for what was synthesized THIS run; resumed parts were
            # paid for by the run that made them
            cost.actual(chars, {"sentences": len(sentences), "credits": credits})
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


PARTS_DIR = "tts_parts"


def _part_name(i: int, voice: str, sentence: str) -> str:
    """A part is named by what it SAYS and in which voice, not just its place:
    an edited script or a changed voice must not resume from audio of the old
    one. The index keeps the directory readable and the concat order obvious."""
    digest = hashlib.sha1(f"{voice}\n{sentence}".encode()).hexdigest()[:12]
    return f"{i:04d}-{digest}.mp3"


# D93: how much text one paragraph-mode request carries. Chunks break at the
# script's own paragraph breaks where they can, so the voice reads a paragraph
# in one breath and the joins fall where a pause belongs anyway.
CHUNK_CHARS = 2500


def request_unit(cfg: dict) -> str:
    unit = str(((cfg.get("voice") or {}).get("request_unit")) or "sentence")
    return unit if unit in ("sentence", "paragraph") else "sentence"


def chunk_sentences(script: str, sentences: list[str], limit: int = CHUNK_CHARS) -> list[list[int]]:
    """Group sentence indices into requests of at most `limit` characters,
    preferring the script's paragraph breaks. A single sentence longer than
    the limit is a request of its own — never split mid-sentence."""
    paragraphs = [split_sentences(p) for p in re.split(r"\n\s*\n", script) if p.strip()]
    if [x for p in paragraphs for x in p] != sentences:
        paragraphs = [sentences]  # the paragraph split disagrees: pack by sentence only
    chunks: list[list[int]] = []
    current: list[int] = []
    size = 0
    i = 0
    for para in paragraphs:
        para_idx = list(range(i, i + len(para)))
        i += len(para)
        para_len = sum(len(sentences[k]) + 1 for k in para_idx)
        if current and size + para_len > limit:
            chunks.append(current)
            current, size = [], 0
        for k in para_idx:
            if current and size + len(sentences[k]) + 1 > limit:
                chunks.append(current)
                current, size = [], 0
            current.append(k)
            size += len(sentences[k]) + 1
    if current:
        chunks.append(current)
    return chunks


def _ai33(ctx: StageContext, sentences: list[str], script: str = "") -> tuple[float, int]:
    """Synthesize through ai33 and write audio.mp3 + tts_timings.json.
    Returns (credits reported by the API, characters synthesized in THIS run).

    Two request units (D93, `voice.request_unit`):
    - `sentence` — one request per sentence; each part's length IS that
      sentence's timing, exactly.
    - `paragraph` — one request per chunk of up to CHUNK_CHARS; the voice reads
      across sentences, and sentence/word times come from align.py (local
      Whisper + pauses). Each sentence then also carries its `words`.

    Either way requests run in parallel (TTS_PARALLELISM, default 6) and each
    finished part is kept in <video>/tts_parts/ until audio.mp3 is written, so
    a run that dies midway resumes instead of paying again.
    """
    api_key = os.environ.get("AI33_API_KEY")
    if not api_key:
        raise StageError(STAGE, "voice provider ai33 needs AI33_API_KEY in .env")
    base = os.environ.get("AI33_BASE_URL", "https://api.ai33.pro").rstrip("/")
    voice = str(((ctx.cfg.get("voice") or {}).get("voice_id")) or "edge_en-US-GuyNeural")
    headers = {"xi-api-key": api_key}

    unit = request_unit(ctx.cfg)
    units = chunk_sentences(script or " ".join(sentences), sentences, CHUNK_CHARS) if unit == "paragraph" \
        else [[i] for i in range(len(sentences))]
    texts = [" ".join(sentences[i] for i in u) for u in units]

    parts_dir = ctx.folder / PARTS_DIR
    parts_dir.mkdir(exist_ok=True)
    files = [parts_dir / _part_name(n, voice, t) for n, t in enumerate(texts)]
    todo = [n for n, f in enumerate(files) if not (f.exists() and f.stat().st_size > 0)]
    if len(todo) < len(units):
        ctx.log(f"narration resumes: {len(units) - len(todo)} of {len(units)} "
                f"{unit} requests already synthesized")

    def synthesize_one(n: int) -> float:
        label = f"{unit} {n + 1}"
        body = _ai33_submit(base, headers, voice, texts[n], n + 1)
        if not body.get("success") or not body.get("task_id"):
            raise StageError(STAGE, f"ai33 rejected {label}: {body.get('message', body)}")
        audio_url, credits = _ai33_wait(base, headers, str(body["task_id"]), n + 1)
        # written beside, renamed into place: a part that exists is a whole one
        partial = files[n].with_suffix(".part")
        try:
            with httpx.stream("GET", audio_url, timeout=120, follow_redirects=True) as dl:
                dl.raise_for_status()
                with open(partial, "wb") as f:
                    for chunk in dl.iter_bytes():
                        f.write(chunk)
        except httpx.HTTPError as e:
            partial.unlink(missing_ok=True)
            raise StageError(STAGE, f"ai33 audio download failed ({label}): {e}")
        partial.replace(files[n])
        return credits

    workers = min(len(todo), parallelism("TTS_PARALLELISM", 6))
    total_credits = 0.0
    if workers <= 1:
        for n in todo:
            total_credits += synthesize_one(n)
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(synthesize_one, n) for n in todo]
            try:
                # in order, so the first failure reported is the earliest; the
                # parts that did finish stay on disk for resume
                total_credits = sum(f.result() for f in futures)
            except BaseException:
                for f in futures:
                    f.cancel()
                raise

    durations = [probe_duration(STAGE, f) for f in files]
    if unit == "paragraph":
        _write_aligned_timings(ctx, sentences, units, files, durations)
    else:
        _write_timings(ctx, sentences, durations)

    concat_list = parts_dir / "list.txt"
    concat_list.write_text("".join(f"file '{f}'\n" for f in files), encoding="utf-8")
    run_ffmpeg(STAGE, [
        "-f", "concat", "-safe", "0", "-i", str(concat_list),
        "-acodec", "libmp3lame", "-q:a", "3", str(ctx.artifact("audio.mp3")),
    ])
    shutil.rmtree(parts_dir, ignore_errors=True)
    return total_credits, sum(len(texts[n]) for n in todo)


def _write_aligned_timings(
    ctx: StageContext,
    sentences: list[str],
    units: list[list[int]],
    files: list[Path],
    durations: list[float],
) -> None:
    """Per-sentence timings for chunked narration, from align.py. The file has
    the same shape as the sentence adapter's, plus `words` on each sentence —
    so every reader of tts_timings.json keeps working, and the compiler places
    overlays on the real word rather than an even spread."""
    language = str(ctx.cfg.get("language") or "").split("-")[0].lower() or None
    items: list[dict] = []
    offset = 0.0
    unplaced = 0
    for unit, part, dur in zip(units, files, durations):
        texts = [sentences[i] for i in unit]
        timing = align.align_chunk(
            texts, align.transcribe_words(part, language), align.pause_ends(part), dur
        )
        unplaced += timing.unplaced
        bounds = timing.starts + [dur]
        for k, text in enumerate(texts):
            start, end = round(offset + bounds[k], 3), round(offset + bounds[k + 1], 3)
            words = [{**w, "start_s": round(offset + w["start_s"], 3),
                      "end_s": round(offset + w["end_s"], 3)} for w in timing.words[k]]
            if words:  # tiled to the sentence exactly, not to within a rounding
                words[0]["start_s"], words[-1]["end_s"] = start, end
            items.append({"text": text, "start_s": start, "end_s": end, "words": words})
        offset += dur
    if unplaced:
        ctx.log(f"narration timing: {unplaced} sentence(s) had no recognised word "
                "and were timed by estimate")
    ctx.write_json("tts_timings.json", {"provider_exact": False, "aligned": "whisper+pauses",
                                        "items": items})


def _ai33_submit(
    base: str, headers: dict, voice: str, sentence: str, n: int, attempts: int = 5
) -> dict:
    """Queue one sentence, riding out transient aggregator failures."""
    delay = 2.0
    last = ""
    for attempt in range(1, attempts + 1):
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
            if resp.status_code in _AI33_RETRYABLE_STATUS:
                last = f"HTTP {resp.status_code}"
            else:
                resp.raise_for_status()
                return resp.json()
        except httpx.TransportError as e:
            last = str(e) or type(e).__name__
        except httpx.HTTPError as e:
            raise StageError(STAGE, f"ai33 synthesis request failed (sentence {n}): {e}")
        if attempt < attempts:
            time.sleep(min(delay, 20))
            delay *= 1.8
    raise StageError(
        STAGE,
        f"ai33 synthesis request failed (sentence {n}) after {attempts} attempts; last response {last}",
    )


def _ai33_wait(base: str, headers: dict, task_id: str, n: int, timeout_s: float = 300) -> tuple[str, float]:
    deadline = time.time() + timeout_s
    delay = 2.0
    last_transient = ""
    while time.time() < deadline:
        try:
            resp = httpx.get(f"{base}/v3/task/{task_id}", headers=headers, timeout=30)
            if resp.status_code in _AI33_RETRYABLE_STATUS:
                last_transient = f"HTTP {resp.status_code}"
                time.sleep(min(delay, 15))
                delay *= 1.6
                continue
            resp.raise_for_status()
            data = resp.json().get("data") or {}
        except httpx.TransportError as e:  # reset/timeout mid-poll: the task is still running
            last_transient = str(e) or type(e).__name__
            time.sleep(min(delay, 15))
            delay *= 1.6
            continue
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
    raise StageError(
        STAGE,
        f"ai33 task {task_id} timed out after {timeout_s:.0f}s (sentence {n})"
        + (f"; last transient response was {last_transient}" if last_transient else ""),
    )


def _mock(ctx: StageContext, sentences: list[str]) -> None:
    durations = [max(1.2, round(len(s) * 0.055, 2)) for s in sentences]
    total = sum(durations)
    run_ffmpeg(STAGE, [
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
        "-t", f"{total:.3f}", "-acodec", "libmp3lame", "-q:a", "9",
        str(ctx.artifact("audio.mp3")),
    ])
    _write_timings(ctx, sentences, durations)
