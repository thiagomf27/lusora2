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
from ..speech import review as speech_review
from ..speech import spoken
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


def voice_settings(cfg: dict) -> dict:
    """D115: how the narration is asked for. `speed` goes to the provider;
    `speakable` rewrites the text it is SENT (never the script, the captions or
    the timings) the way the voice reads it best; `review` hears every take and
    asks again, up to `takes` times, when it did not say the text."""
    voice = cfg.get("voice") or {}
    review = voice.get("review") or {}
    return {
        "speed": float(voice.get("speed", 1.0) or 1.0),
        "speakable": bool(voice.get("speakable", False)),
        "review": bool(review.get("enabled", False)),
        "takes": max(1, int(review.get("takes", 3) or 3)),
        "language": spoken.base(str(cfg.get("language") or "en")),
    }


def sent_text(cfg: dict, text: str) -> str:
    """What the provider is sent for `text`."""
    conf = voice_settings(cfg)
    return spoken.prepare(text, conf["language"]) if conf["speakable"] else text


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
            text = sent_text(ctx.cfg, sentence).replace("\\", " ").replace("'", "’").replace(":", ",").replace("%", " percent")
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
    conf = voice_settings(ctx.cfg)
    # D115: the provider reads `texts`; the timings keep the script's sentences
    texts = [sent_text(ctx.cfg, " ".join(sentences[i] for i in u)) for u in units]

    parts_dir = ctx.folder / PARTS_DIR
    parts_dir.mkdir(exist_ok=True)
    # a speed other than 1 is part of what a part IS: a resumed run never mixes paces
    voice_key = voice if conf["speed"] == 1.0 else f"{voice}@{conf['speed']:g}"
    files = [parts_dir / _part_name(n, voice_key, t) for n, t in enumerate(texts)]
    todo = [n for n, f in enumerate(files) if not (f.exists() and f.stat().st_size > 0)]
    if len(todo) < len(units):
        ctx.log(f"narration resumes: {len(units) - len(todo)} of {len(units)} "
                f"{unit} requests already synthesized")

    reviewed: dict[int, dict] = {}

    def take(n: int, into: Path) -> float:
        label = f"{unit} {n + 1}"
        body = _ai33_submit(base, headers, voice, texts[n], n + 1, speed=conf["speed"])
        if not body.get("success") or not body.get("task_id"):
            raise StageError(STAGE, f"ai33 rejected {label}: {body.get('message', body)}")
        audio_url, credits = _ai33_wait(base, headers, str(body["task_id"]), n + 1)
        try:
            with httpx.stream("GET", audio_url, timeout=120, follow_redirects=True) as dl:
                dl.raise_for_status()
                with open(into, "wb") as f:
                    for chunk in dl.iter_bytes():
                        f.write(chunk)
        except httpx.HTTPError as e:
            into.unlink(missing_ok=True)
            raise StageError(STAGE, f"ai33 audio download failed ({label}): {e}")
        return credits

    def synthesize_one(n: int) -> tuple[float, int]:
        """One part: a take, heard back when the channel asks (D115, DP's
        revisor_voz) and asked for again on a real slip; the take with the
        fewest slips stays. Returns (credits, characters) for every take."""
        # written beside, renamed into place: a part that exists is a whole one
        partial = files[n].with_suffix(".part")
        credits, chars = 0.0, 0
        best: tuple[Path, list] | None = None
        takes = conf["takes"] if conf["review"] else 1
        for k in range(1, takes + 1):
            attempt = partial.with_suffix(f".take{k}")
            credits += take(n, attempt)
            chars += len(texts[n])
            if not conf["review"]:
                best = (attempt, [])
                break
            try:
                heard = heard_text(align.transcribe_words(attempt, conf["language"]))
                problems = speech_review.slips(texts[n], heard, conf["language"])
            except Exception as e:  # noqa: BLE001 - the review never stops the narration
                ctx.log(f"narration {unit} {n + 1}: review unavailable ({type(e).__name__}); keeping the take")
                problems = []
            if best is None or len(problems) < len(best[1]):
                if best is not None:
                    best[0].unlink(missing_ok=True)
                best = (attempt, problems)
            else:
                attempt.unlink(missing_ok=True)
            if not problems:
                break
            first = problems[0]
            more = f" (+{len(problems) - 1})" if len(problems) > 1 else ""
            ctx.log(f"narration {unit} {n + 1}: heard \"{first['heard']}\" where it was \"{first['expected']}\"{more}"
                    + (f" — asking again ({k}/{takes - 1})" if k < takes else " — keeping the best take"))
        assert best is not None
        best[0].replace(files[n])
        reviewed[n] = {"part": n + 1, "takes": k, "slips": best[1]}
        return credits, chars

    workers = min(len(todo), parallelism("TTS_PARALLELISM", 6))
    results: list[tuple[float, int]] = []
    if workers <= 1:
        for n in todo:
            results.append(synthesize_one(n))
    else:
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = [pool.submit(synthesize_one, n) for n in todo]
            try:
                # in order, so the first failure reported is the earliest; the
                # parts that did finish stay on disk for resume
                results = [f.result() for f in futures]
            except BaseException:
                for f in futures:
                    f.cancel()
                raise
    total_credits = sum(c for c, _ in results)
    if conf["review"] and reviewed:
        _write_review(ctx, reviewed, len(units))

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
    return total_credits, sum(chars for _, chars in results)


def heard_text(words: list) -> str:
    """Whisper's words as one text. Its word timestamps split a number at its
    separator ("2", ",750"; "$3", ".5"), and joined with spaces that reads as
    two numbers — every take of a correct "2.750" was flagged until they were
    glued back."""
    return re.sub(r"(?<=\d) (?=[.,]\d)", "", " ".join(w.text for w in words))


def _write_review(ctx: StageContext, reviewed: dict[int, dict], parts: int) -> None:
    """narration_review.json: what the review heard, per part it synthesized."""
    rows = [reviewed[n] for n in sorted(reviewed)]
    retaken = sum(1 for r in rows if r["takes"] > 1)
    left = sum(1 for r in rows if r["slips"])
    ctx.write_json("narration_review.json", {"version": "1.0", "parts": parts, "reviewed": rows})
    ctx.log(f"narration review: {len(rows)} parts heard, {retaken} asked for again, "
            f"{left} still with a slip after the last take")


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
    base: str, headers: dict, voice: str, sentence: str, n: int, attempts: int = 5, speed: float = 1.0
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
                    "speed": (None, f"{speed:g}"),
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
