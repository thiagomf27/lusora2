"""The beats process, as named phases (destination-map slice 5, front half).

`plan_beats` used to be one opaque step. These are the phases it is actually
made of, split out so each can be read, tested and swapped on its own:

    script_split  -> where the narration may be cut
    srt_alignment -> when each of those pieces is spoken
    beat_parts    -> which pieces join into one beat

They are deliberately the DETERMINISTIC half. Deciding what a beat SHOWS
(visual intent, queries, overlays) depends on the component catalog's
`type_name` vocabulary and the style pack's overlay priority/density numbers,
neither of which is settled — so that half stays where it is, and this module
stops at text and timing.

Why code and not the model: a beat's boundary is arithmetic over the SRT and
the style pack's hold window. A model asked to do arithmetic gets it subtly
wrong and there is no cheap check; code gets it right every time and the model
is left doing the part it is actually good at.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .srt import SrtItem
from .textsplit import normalize, split_sentences

# Break candidates, strongest first. A sentence end is always a good place to
# cut; a clause end is acceptable when a sentence would otherwise overrun the
# hold ceiling; a comma is the last resort before giving up and holding a long
# shot, which is why it is only reached when `max_chars` is already exceeded.
_STRONG = re.compile(r"(?<=[.!?…])\s+")
_CLAUSE = re.compile(r"(?<=[;:])\s+")
_WEAK = re.compile(r"(?<=,)\s+")

DEFAULT_MIN_CHARS = 24
DEFAULT_MAX_CHARS = 240


@dataclass(frozen=True)
class Piece:
    """One span of narration, and when it is spoken once aligned."""

    text: str
    start_s: float = 0.0
    end_s: float = 0.0

    @property
    def duration(self) -> float:
        return max(0.0, self.end_s - self.start_s)


def _resplit(text: str, pattern: re.Pattern[str], max_chars: int) -> list[str]:
    """Break `text` further only where it is still over the ceiling."""
    if len(text) <= max_chars:
        return [text]
    parts = [p.strip() for p in pattern.split(text) if p.strip()]
    return parts if len(parts) > 1 else [text]


def script_split(
    script: str,
    srt: list[SrtItem] | None = None,
    granularity: str = "sentence",
    min_chars: int = DEFAULT_MIN_CHARS,
    max_chars: int = DEFAULT_MAX_CHARS,
) -> list[str]:
    """Where the narration may be cut.

    With `segment` cues the SRT already carries someone's answer — the ASR's
    own chunking — so the breaks come straight from it rather than being
    invented a second time. Otherwise the script is cut at punctuation,
    strongest mark first, descending only where a piece is still too long: a
    comma is a worse cut than a full stop and is taken only when the
    alternative is a shot held past the ceiling.
    """
    if granularity == "segment" and srt:
        pieces = [item.text.strip() for item in srt if item.text.strip()]
        if pieces:
            return _merge_undersized(pieces, min_chars)

    pieces: list[str] = []
    for sentence in split_sentences(script):
        for clause in _resplit(sentence, _CLAUSE, max_chars):
            pieces.extend(_resplit(clause, _WEAK, max_chars))
    return _merge_undersized([p for p in pieces if p], min_chars)


def _merge_undersized(pieces: list[str], min_chars: int) -> list[str]:
    """A three-word fragment is not a shot. Fold anything under the floor into
    its neighbour — forward normally, backward for a trailing scrap, which is
    the only case with nothing ahead of it to join."""
    out: list[str] = []
    for piece in pieces:
        if out and len(out[-1]) < min_chars:
            out[-1] = f"{out[-1]} {piece}"
        else:
            out.append(piece)
    if len(out) > 1 and len(out[-1]) < min_chars:
        tail = out.pop()
        out[-1] = f"{out[-1]} {tail}"
    return out


def srt_alignment(pieces: list[str], srt: list[SrtItem], audio_duration: float) -> list[Piece]:
    """When each piece is spoken.

    Walks the cues in order and consumes them until the piece's own words are
    accounted for, so it works for word cues (many per piece) and sentence
    cues (one, usually) without knowing which it was given. Position in the
    transcript is the only signal used — matching on text would fail on every
    ASR spelling difference, and the transcript is the same narration in the
    same order by construction.
    """
    if not pieces:
        return []
    if not srt:
        return _proportional(pieces, audio_duration)

    cues = [c for c in srt if c.text.strip()]
    if not cues:
        return _proportional(pieces, audio_duration)

    # How many transcript CHARACTERS each piece should account for. Character
    # share tracks speaking time far better than piece count does.
    total = sum(len(normalize(p)) for p in pieces) or 1
    cue_chars = [len(normalize(c.text)) for c in cues]
    total_cue_chars = sum(cue_chars) or 1

    out: list[Piece] = []
    cursor = 0
    consumed = 0
    for index, piece in enumerate(pieces):
        share = len(normalize(piece)) / total
        target = consumed + share * total_cue_chars
        start_cue = min(cursor, len(cues) - 1)
        while cursor < len(cues) - 1 and consumed + cue_chars[cursor] < target:
            consumed += cue_chars[cursor]
            cursor += 1
        end_cue = min(cursor, len(cues) - 1)
        if index == len(pieces) - 1:
            end_cue = len(cues) - 1
        start = cues[start_cue].start_s
        end = max(cues[end_cue].end_s, start)
        out.append(Piece(piece, round(start, 3), round(end, 3)))
        if cursor < len(cues) - 1:
            consumed += cue_chars[cursor]
            cursor += 1

    return _monotonic(out, audio_duration)


def _proportional(pieces: list[str], audio_duration: float) -> list[Piece]:
    """No transcript: share the audio out by character count. The honest
    degrade — every piece still gets a slot, none of them exact."""
    total = sum(len(p) for p in pieces) or 1
    out: list[Piece] = []
    t = 0.0
    for piece in pieces:
        span = audio_duration * (len(piece) / total)
        out.append(Piece(piece, round(t, 3), round(t + span, 3)))
        t += span
    return out


def _monotonic(pieces: list[Piece], audio_duration: float) -> list[Piece]:
    """Timings must never go backwards or overlap: the compiler lays these out
    end to end, and one inverted span silently eats its neighbour."""
    out: list[Piece] = []
    prev_end = 0.0
    for i, p in enumerate(pieces):
        start = max(p.start_s, prev_end)
        end = max(p.end_s, start)
        if i == len(pieces) - 1 and audio_duration > 0:
            end = max(end, audio_duration)
        out.append(Piece(p.text, round(start, 3), round(end, 3)))
        prev_end = end
    return out


def beat_parts(
    pieces: list[Piece],
    min_hold: float,
) -> list[Piece]:
    """Which pieces join into one beat.

    One rule, driven by the style pack's hold window rather than by a piece
    count: join forward while a beat is under the floor, because a 0.4s shot
    flashes by and reads as a mistake.

    The CEILING is deliberately not handled here. The compiler already divides
    an over-long slot (`pacing.hold_ceiling_ratio`) and can do it without
    inventing beats — a beat needs `script_text` that is a verbatim contiguous
    span of the script, so splitting one on time alone would either duplicate
    the text or leave a beat with none. Cutting a shot is a timeline concern;
    this function's job is which WORDS belong together.
    """
    if not pieces:
        return []

    joined: list[Piece] = []
    for piece in pieces:
        if joined and joined[-1].duration < min_hold:
            prev = joined[-1]
            joined[-1] = Piece(f"{prev.text} {piece.text}", prev.start_s, piece.end_s)
        else:
            joined.append(piece)
    # a trailing beat under the floor has nothing ahead of it to absorb it
    if len(joined) > 1 and joined[-1].duration < min_hold:
        tail = joined.pop()
        prev = joined[-1]
        joined[-1] = Piece(f"{prev.text} {tail.text}", prev.start_s, tail.end_s)
    return joined
