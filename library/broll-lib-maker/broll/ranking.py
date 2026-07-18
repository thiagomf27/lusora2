"""
ranking.py — how the library page orders results.

Pure semantic similarity is not enough for B-roll: a clip you've already used
in 4 videos is a bad suggestion even if it matches perfectly. Final rank folds
in usage (freshness), confidence, and duration suitability.
"""

from __future__ import annotations

import time
from .schema import Segment


def rank_segments(
    scored: list[tuple[Segment, float]],
    *,
    current_project_id: str | None = None,
    channel_id: str | None = None,
    prefer_seconds: float = 5.0,
    usage_penalty: float = 0.06,     # per prior use IN THIS CHANNEL
    recency_halflife_days: float = 30.0,
) -> list[tuple[Segment, float]]:
    """
    Re-rank vector-search hits. `scored` is [(segment, similarity), ...].
    Overuse is judged against `channel_id`: reusing a clip within one channel
    is the problem; the same clip in another channel is fine.
    """
    now = time.time()
    out = []
    for seg, sim in scored:
        score = sim

        # confidence: trust well-tagged segments a bit more
        score += 0.10 * (seg.confidence - 0.5)

        # overuse penalty: count uses IN THIS CHANNEL, not globally
        if channel_id is not None:
            uses = seg.usage_by_channel.get(channel_id, 0)
        else:
            uses = seg.usage_count
        score -= usage_penalty * uses

        # recency: a clip used very recently is even less desirable right now
        if seg.last_used:
            days = (now - seg.last_used) / 86400.0
            decay = 0.5 ** (days / recency_halflife_days)   # 1.0 just-used -> 0 old
            score -= 0.15 * decay

        # duration fit: prefer clips near the desired b-roll length
        if seg.duration:
            fit = 1.0 - min(abs(seg.duration - prefer_seconds) / prefer_seconds, 1.0)
            score += 0.08 * fit

        # hard rule: never suggest a clip already placed in THIS project
        if current_project_id and current_project_id in seg.usage_by_project:
            score -= 1.0

        out.append((seg, score))

    out.sort(key=lambda t: t[1], reverse=True)
    return out


def overuse_flag(seg: Segment, threshold: int = 3) -> str | None:
    """UI badge helper: warn when a clip is getting stale from reuse."""
    if seg.usage_count >= threshold:
        return f"used in {seg.usage_count} projects"
    return None
