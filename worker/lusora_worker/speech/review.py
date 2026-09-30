"""Did the voice say the text? (D115; Dark Palace's `revisor_voz.confere`)

A TTS model slips now and then even on a clean text (Dark Palace measured the
same "R$ 1,5 milhão" come out right once and garbled once). The narration stage
hears each take with local Whisper and compares both in spoken form; a real
slip — a phrase skipped or added, an abbreviation read letter by letter, a
garbled number — makes it ask for the take again.

Whisper slips too ("muay" for "moai", "mil" for "1.000"), so the comparison
forgives: one word spelled another way, numbers said or written another way, a
word split or joined, a short word dropped, and words Whisper invents at the
very start or end of the audio.
"""

from __future__ import annotations

import difflib
from typing import Any

from .spoken import is_number, spoken_form

# "mil e duzentos" / "mil duzentos": the same number
_CONNECTORS = {"e", "y", "and", "et", "und", "i", "en", "og", "och", "ve"}


def _alike(a: str, b: str, threshold: float, lang: str | None = None) -> bool:
    """Two real number words never look alike: "duzentos" and "cento" are 1250
    and 1150 (a take said 1150 and a loose check let it pass). Only a word that
    is not a number ("dezentos") gets the benefit."""
    if lang and a != b and is_number(a, lang) and is_number(b, lang):
        return False
    return difflib.SequenceMatcher(None, a, b).ratio() >= threshold


def slips(expected: str, heard: str, lang: str | None) -> list[dict[str, Any]]:
    """The real slips between what had to be said and what was heard, as
    [{"expected": ..., "heard": ...}]; empty = the voice said the text."""
    a, b = spoken_form(expected, lang), spoken_form(heard, lang)
    if not a:
        return []
    if not b:
        return [{"expected": " ".join(a[:12]), "heard": "(nothing)"}]
    found = []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if op == "equal":
            continue
        A, B = a[i1:i2], b[j1:j2]
        if op == "insert" and (i1 == 0 or i1 == len(a)):
            continue  # Whisper invents at the edges ("Subtitles by the community")
        numbers = [t for t in A + B if is_number(t, lang)]
        if A and B and not numbers and _alike("".join(A), "".join(B), 0.8):
            continue  # a word split, joined or spelled differently
        if op == "replace" and len(A) == len(B) and all(_alike(x, y, 0.5, lang) for x, y in zip(A, B)):
            continue  # foreign names, plurals: "moai"/"muay", "pedra"/"pedras"
        if op == "replace" and len(A) == len(B) == 1 and min(len(A[0]), len(B[0])) <= 3 and not numbers:
            continue  # "as"/"a", "de"/"do": Whisper's small words (never a number)
        if op in ("delete", "insert") and len(A + B) == 1 and len((A + B)[0]) <= 3 and \
                (not numbers or (A + B)[0] in _CONNECTORS):
            continue  # one small word dropped or added by Whisper ("mil" is not small)
        found.append({"expected": " ".join(a[max(0, i1 - 2):i2 + 1]) or "(nothing)",
                      "heard": " ".join(b[max(0, j1 - 2):j2 + 1]) or "(nothing)"})
    return found
