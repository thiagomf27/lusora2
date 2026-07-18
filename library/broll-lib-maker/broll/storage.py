"""
storage.py — the library. Vector index + object storage, kept strictly separate.

VectorIndex is pgvector-backed: one table, an HNSW index on `embedding`,
plain columns for channel_id/tags/usage/duplicate_of. MemoryVectorIndex is
the old in-memory stand-in, kept for tests that must run without Postgres.
ObjectStore is local-dir; swap for S3/R2 in production.

Env: BROLL_DATABASE_URL (or DATABASE_URL) — default
postgresql://broll:broll@localhost:5432/broll — and BROLL_EMBED_DIM
(default 384 = all-MiniLM-L6-v2). Table + indexes are created on connect.
"""

from __future__ import annotations

import json
import os
import math
import re
import shutil
import time
import uuid

from .schema import Segment


def normalize_name(name: str) -> str:
    """Lookup key for channels/niches: trimmed, lowercased, whitespace and
    hyphens stripped — "Cooking Shorts" == " cooking-shorts "."""
    return re.sub(r"[\s\-]+", "", (name or "").strip().lower())

# cosine similarity above which a new segment is linked as a near-duplicate
# instead of stored again (phash near-match reinforces to 0.95)
DEDUP_SIM = float(os.environ.get("BROLL_DEDUP_SIM", "0.93"))


# --------------------------------------------------------------------------- #
#  Object storage  (bytes only — never in the vector db)
# --------------------------------------------------------------------------- #
DEFAULT_STORAGE_ROOT = os.environ.get("BROLL_STORAGE_ROOT", "/tmp/broll_clips")


class ObjectStore:
    """Local-dir clip store. Replace put/get with boto3 for S3 or R2."""

    def __init__(self, root: str = DEFAULT_STORAGE_ROOT):
        self.root = root
        os.makedirs(root, exist_ok=True)

    def put(self, local_path: str, key: str) -> str:
        dst = os.path.join(self.root, key)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy(local_path, dst)
        return f"file://{dst}"

    def uri_for(self, key: str) -> str:
        return f"file://{os.path.join(self.root, key)}"


# --------------------------------------------------------------------------- #
#  Vector index  (embeddings + metadata + counters + POINTERS only)
# --------------------------------------------------------------------------- #
def _cos(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1e-9
    nb = math.sqrt(sum(y * y for y in b)) or 1e-9
    return dot / (na * nb)


class MemoryVectorIndex:
    """
    In-memory stand-in for the real vector DB. Stores Segment rows keyed by id.
    Same interface as the pgvector VectorIndex below; nothing holds video bytes.
    """

    def __init__(self):
        self._rows: dict[str, Segment] = {}

    # ---- writes ----
    def upsert(self, seg: Segment) -> None:
        self._rows[seg.id] = seg

    def get(self, seg_id: str) -> Segment | None:
        return self._rows.get(seg_id)

    def has_video(self, video_id: str) -> bool:
        """True if any segment from this source video is already stored."""
        return any(s.video_id == video_id for s in self._rows.values())

    # ---- channel / niche lookups (parity with VectorIndex) ----
    def _resolve_lookup(self, store: dict, name: str) -> str | None:
        import time as _t
        import uuid as _u
        norm = normalize_name(name)
        if not norm:
            return None
        if norm not in store:
            store[norm] = {"id": _u.uuid4().hex, "name": name.strip(),
                           "created_at": _t.time()}
        return store[norm]["id"]

    def resolve_channel(self, name: str | None) -> str | None:
        if not hasattr(self, "_channels"):
            self._channels, self._niches = {}, {}
        return self._resolve_lookup(self._channels, name) if name else None

    def resolve_niches(self, names: list[str] | None) -> list[str]:
        if not hasattr(self, "_channels"):
            self._channels, self._niches = {}, {}
        out = []
        for n in names or []:
            nid = self._resolve_lookup(self._niches, n)
            if nid and nid not in out:
                out.append(nid)
        return out

    def list_channels(self) -> list[dict]:
        return sorted(getattr(self, "_channels", {}).values(),
                      key=lambda d: d["name"])

    def list_niches(self) -> list[dict]:
        return sorted(getattr(self, "_niches", {}).values(),
                      key=lambda d: d["name"])

    # ---- dedup at ingestion ----
    def find_near_duplicate(
        self, seg: Segment, sim_threshold: float = DEDUP_SIM
    ) -> Segment | None:
        """
        Before storing a new segment, check if a near-identical one already
        exists (same stock shot appearing across different videos). Compare
        embeddings; optionally also compare perceptual hashes.
        """
        if seg.embedding is None:
            return None
        best, best_sim = None, 0.0
        for other in self._rows.values():
            if other.embedding is None or other.is_duplicate:
                continue
            if other.media_type != seg.media_type:   # an image can't be a
                continue                             # duplicate of a clip
            sim = _cos(seg.embedding, other.embedding)
            if seg.phash and other.phash and _phash_close(seg.phash, other.phash):
                sim = max(sim, 0.95)  # visual near-match reinforces
            if sim > best_sim:
                best, best_sim = other, sim
        return best if best_sim >= sim_threshold else None

    # ---- search (the library-page query) ----
    def search(
        self, query_embedding: list[float], top_k: int = 20,
        **filters,
    ) -> list[tuple[Segment, float]]:
        """
        One shared index, optionally scoped. With `channel_id` set and
        `include_global=True` you get: this channel's uploads + all global
        (stock/youtube) clips — the recommended default. Set include_global
        False to see only this channel's own footage. The metadata filters
        (tags/niches = any-of) narrow the candidate set BEFORE ranking.
        """
        scored = []
        for seg in self._rows.values():
            if seg.embedding is None:
                continue
            if not self._passes_filters(seg, **filters):
                continue
            scored.append((seg, _cos(query_embedding, seg.embedding)))
        scored.sort(key=lambda t: t[1], reverse=True)
        return scored[:top_k]

    def _passes_filters(self, seg: Segment,
                        exclude_duplicates: bool = True,
                        channel_id: str | None = None,
                        include_global: bool = True,
                        tags: list[str] | None = None,
                        niches: list[str] | None = None,
                        source_channel_id: str | None = None,
                        media_type: str | None = None,
                        licenses: list[str] | None = None,
                        min_duration: float | None = None,
                        max_duration: float | None = None,
                        created_after: float | None = None,
                        created_before: float | None = None) -> bool:
        if exclude_duplicates and seg.is_duplicate:
            return False
        if media_type and seg.media_type != media_type:
            return False
        if licenses and seg.license not in licenses:
            return False
        if channel_id is not None:
            is_mine = seg.channel_id == channel_id
            is_global = seg.channel_id is None
            if not (is_mine or (include_global and is_global)):
                return False
        if tags and not set(tags) & set(seg.tags):
            return False
        if niches and not set(niches) & set(seg.niches):
            return False
        if source_channel_id and seg.source_channel_id != source_channel_id:
            return False
        if min_duration is not None and seg.duration < min_duration:
            return False
        if max_duration is not None and seg.duration > max_duration:
            return False
        if created_after is not None and seg.created_at < created_after:
            return False
        if created_before is not None and seg.created_at > created_before:
            return False
        return True

    def list_segments(self, limit: int = 60, **filters) -> list[Segment]:
        """Browse without a query: newest first, same filters as search()."""
        segs = [s for s in self._rows.values()
                if self._passes_filters(s, **filters)]
        segs.sort(key=lambda s: s.created_at, reverse=True)
        return segs[:limit]

    def list_source_channels(self) -> list[dict]:
        """Distinct ORIGIN (uploader) channels — gallery filter options."""
        seen = {}
        for s in self._rows.values():
            if s.source_channel_id:
                seen[s.source_channel_id] = (s.source_channel_name
                                             or s.source_channel_id)
        return [{"id": i, "name": n}
                for i, n in sorted(seen.items(), key=lambda t: t[1])]

    def all(self) -> list[Segment]:
        return list(self._rows.values())


def _phash_close(a: str, b: str, max_hamming: int = 6) -> bool:
    """Hamming distance on hex perceptual hashes."""
    if len(a) != len(b):
        return False
    ia, ib = int(a, 16), int(b, 16)
    return bin(ia ^ ib).count("1") <= max_hamming


# --------------------------------------------------------------------------- #
#  pgvector-backed VectorIndex — what the engine actually uses
# --------------------------------------------------------------------------- #
DEFAULT_DSN = (os.environ.get("BROLL_DATABASE_URL")
               or os.environ.get("DATABASE_URL")
               or "postgresql://broll:broll@localhost:5432/broll")
EMBED_DIM = int(os.environ.get("BROLL_EMBED_DIM", "384"))

_SCHEMA_SQL = """
CREATE EXTENSION IF NOT EXISTS vector;
-- lookup tables (created BEFORE segments so the FK below can reference them)
CREATE TABLE IF NOT EXISTS channels (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    normalized_name text NOT NULL UNIQUE,
    created_at      double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS niches (
    id              text PRIMARY KEY,
    name            text NOT NULL,
    normalized_name text NOT NULL UNIQUE,
    created_at      double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS segments (
    id               text PRIMARY KEY,
    video_id         text NOT NULL DEFAULT '',
    source           text NOT NULL DEFAULT 'youtube',
    tags             text[] NOT NULL DEFAULT '{{}}',
    caption          text NOT NULL DEFAULT '',
    start_s          double precision NOT NULL DEFAULT 0,
    end_s            double precision NOT NULL DEFAULT 0,
    confidence       double precision NOT NULL DEFAULT 0,
    embedding        vector({dim}),
    phash            text,
    clip_uri         text,
    thumb_uri        text,
    duration         double precision NOT NULL DEFAULT 0,
    width            integer NOT NULL DEFAULT 0,
    height           integer NOT NULL DEFAULT 0,
    channel_id       text REFERENCES channels(id),
    niches           text[] NOT NULL DEFAULT '{{}}',  -- niche IDs (arrays can't FK)
    usage_count      integer NOT NULL DEFAULT 0,
    usage_by_channel jsonb NOT NULL DEFAULT '{{}}',
    usage_by_project jsonb NOT NULL DEFAULT '{{}}',
    last_used        double precision,
    duplicate_of     text,
    created_at       double precision NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS segments_embedding_hnsw
    ON segments USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS segments_channel_idx ON segments (channel_id);
CREATE INDEX IF NOT EXISTS segments_video_idx ON segments (video_id);
CREATE INDEX IF NOT EXISTS segments_created_idx ON segments (created_at);
-- migrations for tables created before these columns existed (additive only;
-- superseded columns like `niche`/`used_in_projects` are left in place)
ALTER TABLE segments ADD COLUMN IF NOT EXISTS source_channel_id text;
ALTER TABLE segments ADD COLUMN IF NOT EXISTS source_channel_name text;
ALTER TABLE segments ADD COLUMN IF NOT EXISTS niches text[] NOT NULL DEFAULT '{{}}';
ALTER TABLE segments ADD COLUMN IF NOT EXISTS usage_by_project jsonb NOT NULL DEFAULT '{{}}';
-- the DEFAULT migrates all pre-existing rows to video_clip
ALTER TABLE segments ADD COLUMN IF NOT EXISTS media_type text NOT NULL DEFAULT 'video_clip';
-- usage license captured at ingest (cc0|cc-by|cc-by-sa|owned|stock-licensed|unknown)
ALTER TABLE segments ADD COLUMN IF NOT EXISTS license text NOT NULL DEFAULT 'unknown';
"""

_COLUMNS = ("id, video_id, source, tags, caption, start_s, end_s, confidence, "
            "embedding, phash, clip_uri, thumb_uri, duration, width, height, "
            "channel_id, niches, usage_count, usage_by_channel, "
            "usage_by_project, last_used, duplicate_of, created_at, "
            "source_channel_id, source_channel_name, media_type, license")


def _row_to_segment(row) -> Segment:
    (id_, video_id, source, tags, caption, start_s, end_s, confidence,
     embedding, phash, clip_uri, thumb_uri, duration, width, height,
     channel_id, niches, usage_count, usage_by_channel,
     usage_by_project, last_used, duplicate_of, created_at,
     source_channel_id, source_channel_name, media_type, license) = row
    return Segment(
        id=id_, video_id=video_id, source=source, tags=list(tags or []),
        caption=caption, start=start_s, end=end_s, confidence=confidence,
        embedding=embedding.to_list() if embedding is not None else None,
        phash=phash, clip_uri=clip_uri, thumb_uri=thumb_uri,
        duration=duration, width=width, height=height,
        channel_id=channel_id, niches=list(niches or []),
        usage_count=usage_count,
        usage_by_channel=dict(usage_by_channel or {}),
        usage_by_project=dict(usage_by_project or {}), last_used=last_used,
        duplicate_of=duplicate_of, created_at=created_at,
        source_channel_id=source_channel_id,
        source_channel_name=source_channel_name,
        media_type=media_type or "video_clip",
        license=license or "unknown",
    )


class VectorIndex:
    """
    pgvector-backed index. One shared table partitioned by `channel_id`
    (NULL = global pool), HNSW on `embedding` for cosine search. Same
    interface as MemoryVectorIndex; nothing here holds video bytes.
    """

    def __init__(self, dsn: str | None = None, embed_dim: int = EMBED_DIM):
        import psycopg
        from pgvector.psycopg import register_vector
        self._conn = psycopg.connect(dsn or DEFAULT_DSN, autocommit=True)
        self._conn.execute(_SCHEMA_SQL.format(dim=embed_dim))
        register_vector(self._conn)
        # vectors from different embedding models are incompatible: refuse to
        # open a database built with another dimension (pgvector stores the
        # declared dim in atttypmod). CREATE TABLE IF NOT EXISTS above
        # silently no-ops on an existing table, so this is the only guard.
        row = self._conn.execute(
            "SELECT atttypmod FROM pg_attribute "
            "WHERE attrelid = 'segments'::regclass AND attname = 'embedding'"
        ).fetchone()
        db_dim = row[0] if row else -1
        if db_dim not in (-1, embed_dim):
            raise RuntimeError(
                f"embedding dimension mismatch: this database was built with "
                f"vector({db_dim}) but the profile expects vector({embed_dim})"
                f" — a gallery is only searchable with the embedding model "
                f"that built it; fix the profile's embed_model/embed_dim")

    # ---- writes ----
    def upsert(self, seg: Segment) -> None:
        from pgvector import Vector
        emb = Vector(seg.embedding) if seg.embedding is not None else None
        self._conn.execute(
            f"""
            INSERT INTO segments ({_COLUMNS})
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    %s)
            ON CONFLICT (id) DO UPDATE SET
                video_id = EXCLUDED.video_id, source = EXCLUDED.source,
                tags = EXCLUDED.tags, caption = EXCLUDED.caption,
                start_s = EXCLUDED.start_s, end_s = EXCLUDED.end_s,
                confidence = EXCLUDED.confidence,
                embedding = EXCLUDED.embedding, phash = EXCLUDED.phash,
                clip_uri = EXCLUDED.clip_uri, thumb_uri = EXCLUDED.thumb_uri,
                duration = EXCLUDED.duration, width = EXCLUDED.width,
                height = EXCLUDED.height, channel_id = EXCLUDED.channel_id,
                niches = EXCLUDED.niches, usage_count = EXCLUDED.usage_count,
                usage_by_channel = EXCLUDED.usage_by_channel,
                usage_by_project = EXCLUDED.usage_by_project,
                last_used = EXCLUDED.last_used,
                duplicate_of = EXCLUDED.duplicate_of,
                created_at = EXCLUDED.created_at,
                source_channel_id = EXCLUDED.source_channel_id,
                source_channel_name = EXCLUDED.source_channel_name,
                media_type = EXCLUDED.media_type,
                license = EXCLUDED.license
            """,
            (seg.id, seg.video_id, seg.source, seg.tags, seg.caption,
             seg.start, seg.end, seg.confidence, emb, seg.phash,
             seg.clip_uri, seg.thumb_uri, seg.duration, seg.width,
             seg.height, seg.channel_id, seg.niches, seg.usage_count,
             json.dumps(seg.usage_by_channel),
             json.dumps(seg.usage_by_project), seg.last_used,
             seg.duplicate_of, seg.created_at,
             seg.source_channel_id, seg.source_channel_name,
             seg.media_type, seg.license),
        )

    def get(self, seg_id: str) -> Segment | None:
        cur = self._conn.execute(
            f"SELECT {_COLUMNS} FROM segments WHERE id = %s", (seg_id,))
        row = cur.fetchone()
        return _row_to_segment(row) if row else None

    def has_video(self, video_id: str) -> bool:
        """True if any segment from this source video is already stored."""
        cur = self._conn.execute(
            "SELECT 1 FROM segments WHERE video_id = %s LIMIT 1", (video_id,))
        return cur.fetchone() is not None

    # ---- channel / niche lookups (get-or-create by normalized name) ----
    def _resolve_lookup(self, table: str, name: str) -> str | None:
        assert table in ("channels", "niches")
        norm = normalize_name(name)
        if not norm:
            return None
        # no-op DO UPDATE so RETURNING fires on conflict too
        row = self._conn.execute(
            f"""
            INSERT INTO {table} (id, name, normalized_name, created_at)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (normalized_name)
            DO UPDATE SET normalized_name = EXCLUDED.normalized_name
            RETURNING id
            """,
            (uuid.uuid4().hex, name.strip(), norm, time.time())).fetchone()
        return row[0]

    def resolve_channel(self, name: str | None) -> str | None:
        return self._resolve_lookup("channels", name) if name else None

    def resolve_niches(self, names: list[str] | None) -> list[str]:
        out = []
        for n in names or []:
            nid = self._resolve_lookup("niches", n)
            if nid and nid not in out:
                out.append(nid)
        return out

    def _list_lookup(self, table: str) -> list[dict]:
        assert table in ("channels", "niches")
        rows = self._conn.execute(
            f"SELECT id, name, created_at FROM {table} ORDER BY name").fetchall()
        return [{"id": i, "name": n, "created_at": c} for i, n, c in rows]

    def list_channels(self) -> list[dict]:
        return self._list_lookup("channels")

    def list_niches(self) -> list[dict]:
        return self._list_lookup("niches")

    # ---- dedup at ingestion ----
    def find_near_duplicate(
        self, seg: Segment, sim_threshold: float = DEDUP_SIM
    ) -> Segment | None:
        """
        Nearest non-duplicate rows by cosine (HNSW does the work); phash
        near-match reinforces, mirroring MemoryVectorIndex semantics.
        """
        if seg.embedding is None:
            return None
        from pgvector import Vector
        cur = self._conn.execute(
            f"""
            SELECT {_COLUMNS}, 1 - (embedding <=> %s) AS sim
            FROM segments
            WHERE embedding IS NOT NULL AND duplicate_of IS NULL AND id != %s
              AND media_type = %s
            ORDER BY embedding <=> %s
            LIMIT 8
            """,
            (Vector(seg.embedding), seg.id, seg.media_type,
             Vector(seg.embedding)),
        )
        best, best_sim = None, 0.0
        for row in cur.fetchall():
            other, sim = _row_to_segment(row[:-1]), float(row[-1])
            if seg.phash and other.phash and _phash_close(seg.phash, other.phash):
                sim = max(sim, 0.95)
            if sim > best_sim:
                best, best_sim = other, sim
        return best if best_sim >= sim_threshold else None

    # ---- search (the library-page query) ----
    @staticmethod
    def _filter_clauses(
        exclude_duplicates: bool = True,
        channel_id: str | None = None,
        include_global: bool = True,
        tags: list[str] | None = None,
        niches: list[str] | None = None,
        source_channel_id: str | None = None,
        media_type: str | None = None,
        licenses: list[str] | None = None,
        min_duration: float | None = None,
        max_duration: float | None = None,
        created_after: float | None = None,
        created_before: float | None = None,
    ) -> tuple[list[str], list]:
        """Shared WHERE builder for search() and list_segments()."""
        where: list[str] = []
        params: list = []
        if exclude_duplicates:
            where.append("duplicate_of IS NULL")
        if media_type:
            where.append("media_type = %s")
            params.append(media_type)
        if licenses:
            where.append("license = ANY(%s)")
            params.append(list(licenses))
        if channel_id is not None:
            if include_global:
                where.append("(channel_id = %s OR channel_id IS NULL)")
            else:
                where.append("channel_id = %s")
            params.append(channel_id)
        if tags:
            where.append("tags && %s")
            params.append(list(tags))
        if niches:
            where.append("niches && %s")
            params.append(list(niches))
        if source_channel_id:
            where.append("source_channel_id = %s")
            params.append(source_channel_id)
        if min_duration is not None:
            where.append("duration >= %s")
            params.append(min_duration)
        if max_duration is not None:
            where.append("duration <= %s")
            params.append(max_duration)
        if created_after is not None:
            where.append("created_at >= %s")
            params.append(created_after)
        if created_before is not None:
            where.append("created_at <= %s")
            params.append(created_before)
        return where, params

    def search(
        self, query_embedding: list[float], top_k: int = 20,
        **filters,
    ) -> list[tuple[Segment, float]]:
        """
        Same contract as MemoryVectorIndex.search. Metadata filters become
        WHERE clauses combined with the vector ORDER BY — Postgres filters
        BEFORE the similarity limit, not as a post-pass. tags/niches = any-of
        (array overlap); date bounds are epoch seconds on created_at.
        """
        from pgvector import Vector
        q = Vector(query_embedding)
        where, params = self._filter_clauses(**filters)
        where = ["embedding IS NOT NULL", *where]
        cur = self._conn.execute(
            f"""
            SELECT {_COLUMNS}, 1 - (embedding <=> %s) AS sim
            FROM segments
            WHERE {' AND '.join(where)}
            ORDER BY embedding <=> %s
            LIMIT %s
            """,
            [q, *params, q, top_k],
        )
        return [(_row_to_segment(r[:-1]), float(r[-1])) for r in cur.fetchall()]

    def list_segments(self, limit: int = 60, **filters) -> list[Segment]:
        """Browse without a query: newest first, same filters as search()."""
        where, params = self._filter_clauses(**filters)
        cur = self._conn.execute(
            f"""
            SELECT {_COLUMNS} FROM segments
            {('WHERE ' + ' AND '.join(where)) if where else ''}
            ORDER BY created_at DESC
            LIMIT %s
            """,
            [*params, limit],
        )
        return [_row_to_segment(r) for r in cur.fetchall()]

    def list_source_channels(self) -> list[dict]:
        """Distinct ORIGIN (uploader) channels — gallery filter options."""
        rows = self._conn.execute(
            "SELECT DISTINCT source_channel_id, source_channel_name "
            "FROM segments WHERE source_channel_id IS NOT NULL "
            "ORDER BY source_channel_name").fetchall()
        return [{"id": i, "name": n or i} for i, n in rows]

    def all(self) -> list[Segment]:
        cur = self._conn.execute(f"SELECT {_COLUMNS} FROM segments")
        return [_row_to_segment(r) for r in cur.fetchall()]
