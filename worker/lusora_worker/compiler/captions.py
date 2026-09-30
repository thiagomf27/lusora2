"""Captions as short phrases on the spoken word (D113, documentary plan slice 8).

A caption item used to be one timing chunk of the narration: a whole sentence,
up to seven seconds and three lines of text. Dark Palace's `_frases` cuts the
narration into phrases of a line at most (40 characters or 8 words), broken on
punctuation, each shown from its first spoken word. `style_pack.captions.chunk`
turns that on; without it every chunk stays one caption, byte-identically.
"""

from __future__ import annotations

from typing import Any

from .textmatch import tokenize

# a trailing phrase shorter than this joins the one before it (DP: "a" alone on screen)
SHORT_TAIL_CHARS = 10
# a comma ends a phrase only once it has this many words (DP)
COMMA_MIN_WORDS = 4


def phrases(words: list[str], max_chars: int, max_words: int) -> list[list[int]]:
    """Group word indexes into phrases, DP's `_frases`."""
    out: list[list[int]] = []
    cur: list[int] = []

    def length(idx: list[int]) -> int:
        return len(" ".join(words[i] for i in idx))

    for i, w in enumerate(words):
        if cur and (length(cur) + 1 + len(w) > max_chars or len(cur) >= max_words):
            out.append(cur)
            cur = []
        cur.append(i)
        if w[-1] in ".?!" or (w[-1] in ",;:" and len(cur) >= COMMA_MIN_WORDS):
            # a sentence's last word alone ("years.") finishes the phrase before it
            if w[-1] in ".?!" and out and length(cur) < SHORT_TAIL_CHARS and words[out[-1][-1]][-1] not in ".?!":
                out[-1] += cur
            else:
                out.append(cur)
            cur = []
    if cur:
        if out and length(cur) < SHORT_TAIL_CHARS:
            out[-1] += cur
        else:
            out.append(cur)
    return out


def _word_starts(item: dict[str, Any], words: list[str]) -> list[float]:
    """When each written word of one timing chunk starts, in chunk time.

    The chunk's own word timing (D93) is per `tokenize` token, and a written
    word can be several tokens ('forty-seven') or none (a lone currency sign);
    a word takes its first token's start, a word with none the next one's.
    Without word timing the chunk's span is spread evenly across the tokens,
    exactly as the compiler's word timeline does.
    """
    start_s, end_s = float(item["start_s"]), float(item["end_s"])
    counts = [len(tokenize(w)) for w in words]
    total = sum(counts)
    timed = item.get("words")
    if isinstance(timed, list) and len(timed) == total and total:
        token_starts = [float(t["start_s"]) for t in timed]
    else:
        token_starts = [start_s + (end_s - start_s) * k / max(total, 1) for k in range(total)]
    starts: list[float] = []
    k = 0
    for c in counts:
        starts.append(token_starts[k] if k < total else end_s)
        k += c
    # a tokenless word shows with the word after it
    for i in range(len(starts) - 2, -1, -1):
        if counts[i] == 0:
            starts[i] = starts[i + 1]
    return starts


def chunk_items(sentence_timings: list[dict[str, Any]], vo_start: float, chunk: dict[str, Any]) -> list[dict[str, Any]]:
    """The caption track in phrases. Each phrase shows from its first word until
    the next phrase of its chunk starts; a chunk's last phrase ends where the
    chunk did, so the captions cover exactly what the sentence captions did."""
    max_chars = int(chunk.get("max_chars") or 40)
    max_words = int(chunk.get("max_words") or 8)
    out: list[dict[str, Any]] = []
    for item in sentence_timings:
        words = str(item.get("text") or "").split()
        if not words:
            continue
        starts = _word_starts(item, words)
        groups = phrases(words, max_chars, max_words)
        # a phrase with no time of its own (words the timing squeezed together)
        # joins the next one rather than flashing for a frame
        merged: list[list[int]] = []
        for idx in groups:
            if merged and starts[idx[0]] - starts[merged[-1][0]] <= 0.01:
                merged[-1] = merged[-1] + idx
            else:
                merged.append(list(idx))
        end_s = float(item["end_s"])
        for g, idx in enumerate(merged):
            s0 = float(item["start_s"]) if g == 0 else starts[idx[0]]
            s1 = starts[merged[g + 1][0]] if g + 1 < len(merged) else end_s
            out.append({
                "start_s": round(s0 + vo_start, 3),
                "end_s": round(s1 + vo_start, 3),
                "text": " ".join(words[i] for i in idx),
            })
    return out
