"""Deterministic sentence splitting — shared by TTS, transcript and the
compiler so their boundaries always agree."""

from __future__ import annotations

import re

_SENTENCE_END = re.compile(r"(?<=[.!?…])\s+")


def split_sentences(text: str) -> list[str]:
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []
    return [s.strip() for s in _SENTENCE_END.split(text) if s.strip()]


def normalize(text: str) -> str:
    """Whitespace/case-insensitive form used for span matching."""
    return re.sub(r"\s+", " ", text).strip().lower()
