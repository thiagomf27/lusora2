"""
schema.py — the data model for the b-roll library.

THREE STORAGE LAYERS (never mix them):

  1. Vector DB      -> embeddings + metadata + counters + a POINTER to bytes.
                       Few KB per segment. This is an INDEX, not a file store.
  2. Object storage -> the actual cut clip bytes (local dir / S3 / R2).
                       Small clips only. Source videos are deleted after tagging.
  3. (optional) Cold storage -> source videos with a TTL, only if you did NOT
                       tag exhaustively. Most builds skip this.

A `Segment` is the unit of everything: one row in the vector DB, one small file
in object storage. Tagging a video writes N segments (exhaustive tagging).
"""

from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field, asdict


LICENSES = ("cc0", "cc-by", "cc-by-sa", "owned", "stock-licensed", "unknown")


def default_license(source: str) -> str:
    """License inferred from where the footage came from. Stock APIs grant
    a usage license; user uploads are owned; scraped video is unknown
    until a human says otherwise."""
    if source in ("pexels", "pixabay"):
        return "stock-licensed"
    if source in ("upload", "image_url", "image"):
        return "owned"
    return "unknown"


def _new_id() -> str:
    return uuid.uuid4().hex


@dataclass
class Segment:
    # --- identity ---
    id: str = field(default_factory=_new_id)
    video_id: str = ""                 # source YouTube id / stock id
    source: str = "youtube"            # "youtube" | "pexels" | "pixabay" | ...
    # usage license, captured at ingest from the source (filterable in
    # search — the basis of channels' anti-copyright source policies):
    # cc0 | cc-by | cc-by-sa | owned | stock-licensed | unknown
    license: str = "unknown"
    # where the footage came from (the UPLOADER's channel on YouTube) —
    # NOT our namespacing field `channel_id` below, which scopes ownership
    # inside this library
    source_channel_id: str | None = None
    source_channel_name: str | None = None

    # --- what & where in the source ---
    media_type: str = "video_clip"     # "video_clip" | "image" (start/end/
                                       # duration are 0 for images)
    tags: list[str] = field(default_factory=list)   # ["lion", "sleeping", "savanna"]
    caption: str = ""                                # free-form GLM description
    start: float = 0.0                               # seconds into source
    end: float = 0.0
    confidence: float = 0.0                          # GLM's confidence 0..1

    # --- retrieval ---
    embedding: list[float] | None = None             # text embedding of tags+caption
    phash: str | None = None                         # perceptual hash of a keyframe (dedup)

    # --- the actual bytes live here, NOT in the vector db ---
    clip_uri: str | None = None                      # e.g. "s3://broll/clips/<id>.mp4"
    thumb_uri: str | None = None
    duration: float = 0.0                            # end - start
    width: int = 0
    height: int = 0

    # --- namespacing (ONE db, partitioned) ---
    # "stock" and "youtube" clips are global; user uploads are tagged with the
    # owning channel so a search can be scoped to "stock + this channel".
    channel_id: str | None = None                    # None = global/shared pool
    niches: list[str] = field(default_factory=list)  # optional coarse groupings

    # --- usage / lifecycle ---
    usage_count: int = 0                             # total across everything
    usage_by_channel: dict[str, int] = field(default_factory=dict)  # overuse is per-channel
    usage_by_project: dict[str, int] = field(default_factory=dict)
    last_used: float | None = None
    duplicate_of: str | None = None                  # if this is a near-dupe, points to canonical
    created_at: float = field(default_factory=time.time)

    def to_row(self) -> dict:
        return asdict(self)

    @property
    def is_duplicate(self) -> bool:
        return self.duplicate_of is not None


@dataclass
class Candidate:
    """A video we are considering during the coarse (pre-download) pass."""
    video_id: str
    source: str
    title: str = ""
    description: str = ""
    source_channel_id: str | None = None    # uploader's channel (YouTube)
    source_channel_name: str | None = None
    thumb_uri: str | None = None
    storyboard_uri: str | None = None      # yt-dlp storyboard mosaic (cheap low-res frames)
    coarse_score: float = 0.0              # GLM's rough "does this contain the query" score
    rough_ranges: list[tuple[float, float]] = field(default_factory=list)  # rough guesses
