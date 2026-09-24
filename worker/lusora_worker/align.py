"""Sentence and word timing for narration synthesized in chunks (throughput
slice 5d, D93).

A chunk of several sentences comes back from the TTS as one file, so its
length no longer says where each sentence starts. Two free signals do, and each
covers the other's weakness:

- **local Whisper** (`base`, word timestamps) recognises the words, so it can
  never put a boundary in the wrong sentence — but its times are loose, up to
  ~0.6 s on a sentence start;
- **pauses** in the audio (ffmpeg silencedetect) are exact to the millisecond —
  but a comma pauses too, so on their own they slip a whole sentence.

Whisper says WHICH pause; the pause says exactly WHEN. Measured on a 60 s
elevenlabs narration against the provider's own word timestamps: every
sentence start within 78 ms (median 21 ms). Words come out ~120 ms from the
provider's, against ~300 ms for the even spread the compiler used before.

`align_chunk` is pure (script, heard words, pauses -> timings) so it is tested
without a model; `transcribe_words` and `pause_ends` are the two I/O halves.
"""

from __future__ import annotations

import difflib
import os
import re
import subprocess
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .compiler.textmatch import compare_key, tokenize
from .config import parallelism

# How far a recognised sentence start may be moved to meet a pause. Whisper's
# worst sentence start was 640 ms off on `base`; a pause further than this is
# more likely a comma's than the sentence's own.
SNAP_WINDOW_S = 0.8
# Pauses shorter than this are the gaps between words, not between phrases.
MIN_PAUSE_S = 0.12


@dataclass(frozen=True)
class Heard:
    text: str
    start: float
    end: float


@dataclass
class ChunkTiming:
    starts: list[float]                    # per sentence, relative to the chunk; [0] == 0.0
    words: list[list[dict[str, Any]]]      # per sentence: {text, start_s, end_s}, relative
    unplaced: int                          # sentences with no recognised word (timed by estimate)


def align_chunk(
    sentences: list[str], heard: list[Heard], pause_ends: list[float], duration: float
) -> ChunkTiming:
    # script tokens, as the compiler will tokenize them (so its word timeline
    # can take these times one-for-one), with the sentence each belongs to
    tokens: list[str] = []
    owner: list[int] = []
    written: list[tuple[int, str]] = []  # (index of the written word in its sentence, that word)
    for i, sentence in enumerate(sentences):
        # tokenize() works word by word over str.split(), so tokenizing each
        # written word gives the same tokens in the same order — and says
        # which written word ("forty-five") each token ("forty") came from
        for n, raw in enumerate(sentence.split()):
            for tok in tokenize(raw):
                tokens.append(tok)
                owner.append(i)
                written.append((n, raw))

    # heard words, split the same way: Whisper's "forty-five" is two script
    # tokens, sharing the heard word's span
    ears: list[tuple[str, float, float]] = []
    for w in heard:
        parts = tokenize(w.text) or []
        span = (w.end - w.start) / max(1, len(parts))
        for n, part in enumerate(parts):
            ears.append((compare_key(part), w.start + n * span, w.start + (n + 1) * span))

    at: dict[int, int] = {}
    matcher = difflib.SequenceMatcher(
        a=[compare_key(t) for t in tokens], b=[e[0] for e in ears], autojunk=False
    )
    for block in matcher.get_matching_blocks():
        for k in range(block.size):
            at[block.a + k] = block.b + k

    starts_w, ends_w = _word_times(tokens, at, ears, duration)
    # The same folding happens mid-sentence (a comma, a breath): a word whose
    # heard span contains the end of a pause really starts when the pause ends.
    for k in range(len(tokens)):
        inside = [p for p in pause_ends if starts_w[k] < p < ends_w[k]]
        if inside:
            starts_w[k] = inside[-1]

    # sentence starts: the first word as recognised, moved to the pause it sits in
    starts: list[float] = [0.0]
    unplaced = 0
    for i in range(1, len(sentences)):
        first = owner.index(i) if i in owner else None
        if first is None:  # a sentence with no tokens at all ("…")
            starts.append(starts[-1])
            continue
        if not any(at.get(k) is not None for k, o in enumerate(owner) if o == i):
            unplaced += 1
        guess = starts_w[first]
        # Whisper often folds a pause INTO the next word: at 0.7x speed it
        # heard "The" as lasting 1.04 s, starting where "workers." ended, and
        # the real pause ended 0.96 s after its guess — outside any fixed
        # window. So a pause that ends inside the first word's own span is
        # taken first (the last one there); otherwise the nearest within the
        # window either side.
        inside = [p for p in pause_ends if guess < p <= ends_w[first]]
        near = [p for p in pause_ends if abs(p - guess) <= SNAP_WINDOW_S]
        if inside:
            start = inside[-1]
        elif near:
            start = min(near, key=lambda p: abs(p - guess))
        else:
            start = guess
        if start <= starts[-1]:
            start = max(guess, starts[-1] + 0.01)
        starts.append(round(min(start, duration), 3))

    bounds = starts + [duration]
    words: list[list[dict[str, Any]]] = [[] for _ in sentences]
    for k, tok in enumerate(tokens):
        i = owner[k]
        lo, hi = bounds[i], bounds[i + 1]
        prev = words[i][-1]["start_s"] if words[i] else lo
        s = min(max(starts_w[k], lo, prev), hi)
        words[i].append({"text": tok, "start_s": round(s, 3), "end_s": 0.0,
                         "w": written[k][0], "written": written[k][1]})
    # Words TILE their sentence: the first starts where the sentence does, each
    # holds until the next one starts, the last until the next sentence. A beat
    # is timed from its first word's start to its last word's end, and the
    # compiler requires beats to meet (a gap over 0.75 s fails the plan) —
    # which the old even spread did by construction and real word ends, which
    # stop at the pause, do not. Only word STARTS carry the new precision
    # (overlay placement, a highlight), so nothing is lost.
    for i, ws in enumerate(words):
        if not ws:
            continue
        ws[0]["start_s"] = round(bounds[i], 3)
        for a, b in zip(ws, ws[1:]):
            a["end_s"] = b["start_s"]
        ws[-1]["end_s"] = round(bounds[i + 1], 3)
    return ChunkTiming(starts=starts, words=words, unplaced=unplaced)


def written_words(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Tokens back into the words as the script wrote them, for display:
    "forty" + "five" -> one "forty-five" from the first's start to the last's
    end. A timing file without the grouping keys is returned token by token."""
    out: list[dict[str, Any]] = []
    for w in words:
        if out and "w" in w and out[-1].get("w") == w["w"]:
            out[-1]["end_s"] = w["end_s"]
            continue
        out.append({"text": w.get("written", w["text"]), "start_s": w["start_s"],
                    "end_s": w["end_s"], **({"w": w["w"]} if "w" in w else {})})
    return out


def _word_times(
    tokens: list[str], at: dict[int, int], ears: list[tuple[str, float, float]], duration: float
) -> tuple[list[float], list[float]]:
    """Every script token's start and end: heard ones from Whisper, the rest
    spread by characters between their heard neighbours."""
    n = len(tokens)
    starts = [0.0] * n
    ends = [0.0] * n
    k = 0
    while k < n:
        if k in at:
            starts[k], ends[k] = ears[at[k]][1], ears[at[k]][2]
            k += 1
            continue
        run_end = k
        while run_end < n and run_end not in at:
            run_end += 1
        lo = ends[k - 1] if k > 0 else 0.0
        hi = ears[at[run_end]][1] if run_end < n else duration
        weights = [len(tokens[j]) + 1 for j in range(k, run_end)]
        total, acc = sum(weights), 0
        for j, wgt in zip(range(k, run_end), weights):
            starts[j] = lo + (hi - lo) * acc / total
            acc += wgt
            ends[j] = lo + (hi - lo) * acc / total
        k = run_end
    return starts, ends


# ---------------- I/O halves ----------------


def pause_ends(audio: Path) -> list[float]:
    """Where speech resumes after each pause (silencedetect's silence_end)."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio),
         "-af", f"silencedetect=noise=-40dB:d={MIN_PAUSE_S}", "-f", "null", "-"],
        capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"}, check=False,
    )
    return [float(x) for x in re.findall(r"silence_end: ([\d.]+)", proc.stderr)]


_MODEL: Any = None
_MODEL_LOCK = threading.Lock()


def transcribe_words(audio: Path, language: str | None) -> list[Heard]:
    """Local Whisper, word timestamps. The model is loaded once per process —
    `WHISPER_ALIGN_MODEL` (default `base`: measured as accurate as `small` once
    snapped to pauses, at 2.5x the speed) and `WHISPER_THREADS` (default 4).

    Deliberately NO initial_prompt, unlike providers/whisper.py: priming with
    the script made the same 60 s chunk take 43 s instead of 8, for identical
    timings. Spelling does not matter here — the matcher compares folded keys
    and times an unrecognised word from its neighbours."""
    global _MODEL
    from faster_whisper import WhisperModel  # type: ignore[import-not-found]

    with _MODEL_LOCK:
        if _MODEL is None:
            _MODEL = WhisperModel(
                os.environ.get("WHISPER_ALIGN_MODEL") or "base",
                device="cpu", compute_type="int8",
                cpu_threads=parallelism("WHISPER_THREADS", 4),
            )
        segments, _info = _MODEL.transcribe(
            str(audio), language=language, word_timestamps=True,
        )
        return [Heard(str(w.word).strip(), float(w.start), float(w.end))
                for s in segments for w in (s.words or []) if str(w.word).strip()]
