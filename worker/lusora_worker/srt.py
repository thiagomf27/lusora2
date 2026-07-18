"""Minimal SRT read/write."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


@dataclass
class SrtItem:
    start_s: float
    end_s: float
    text: str


_TIME = re.compile(r"(\d+):(\d+):(\d+)[,.](\d+)")


def _parse_time(s: str) -> float:
    m = _TIME.match(s.strip())
    if not m:
        raise ValueError(f"bad SRT timestamp: {s!r}")
    h, mi, se, ms = (int(g) for g in m.groups())
    return h * 3600 + mi * 60 + se + ms / 1000


def _fmt_time(t: float) -> str:
    ms = round(t * 1000)
    h, rem = divmod(ms, 3600_000)
    mi, rem = divmod(rem, 60_000)
    se, ms = divmod(rem, 1000)
    return f"{h:02d}:{mi:02d}:{se:02d},{ms:03d}"


def read_srt(path: Path) -> list[SrtItem]:
    items: list[SrtItem] = []
    blocks = re.split(r"\n\s*\n", path.read_text(encoding="utf-8").strip())
    for block in blocks:
        lines = [l for l in block.strip().splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        # first line may be the numeric index
        ti = 1 if "-->" in (lines[1] if len(lines) > 1 else "") else 0
        if "-->" not in lines[ti]:
            continue
        start_raw, end_raw = lines[ti].split("-->")
        text = " ".join(lines[ti + 1 :]).strip()
        items.append(SrtItem(_parse_time(start_raw), _parse_time(end_raw), text))
    return items


def write_srt(path: Path, items: list[SrtItem]) -> None:
    out = []
    for i, item in enumerate(items, 1):
        out.append(f"{i}\n{_fmt_time(item.start_s)} --> {_fmt_time(item.end_s)}\n{item.text}\n")
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
