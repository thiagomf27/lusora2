"""
jobs.py — Postgres-backed ingest queue, processed SERIALLY.

One worker, one download at a time through the proxy — that's deliberate:
parallel yt-dlp traffic is the classic bot signature. Job lifecycle:

    queued -> downloading -> tagging -> cutting -> storing -> done
                                                          \\-> failed

`status` walks those stages (as the frontend polls it); `stage` holds the
last stage entered. A failed job is re-queued until it has burned
BROLL_JOB_MAX_ATTEMPTS attempts, then parked as failed with the error.
"""

from __future__ import annotations

import os
import time
import traceback
import uuid

import psycopg

from .storage import DEFAULT_DSN
from .pipeline import (parse_youtube_id, is_image_url, is_video_file_url,
                       file_sha256)

JOB_MAX_ATTEMPTS = int(os.environ.get("BROLL_JOB_MAX_ATTEMPTS", "2"))

_JOBS_SQL = """
CREATE TABLE IF NOT EXISTS jobs (
    id               text PRIMARY KEY,
    url              text NOT NULL,
    video_id         text,
    status           text NOT NULL DEFAULT 'queued',
    stage            text,
    progress         real NOT NULL DEFAULT 0,
    error            text,
    segments_created integer NOT NULL DEFAULT 0,
    channel_id       text,
    niches           text[] NOT NULL DEFAULT '{}',
    max_res          integer,
    attempts         integer NOT NULL DEFAULT 0,
    created_at       double precision NOT NULL,
    updated_at       double precision NOT NULL,
    finished_at      double precision,
    profile          text NOT NULL DEFAULT 'default',
    kind             text NOT NULL DEFAULT 'video'
);
CREATE INDEX IF NOT EXISTS jobs_status_idx ON jobs (status, created_at);
-- additive migrations for queues created before these columns existed
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS profile text NOT NULL DEFAULT 'default';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'video';
"""

_FIELDS = ("id, url, video_id, status, stage, progress, error, "
           "segments_created, channel_id, niches, max_res, attempts, "
           "created_at, updated_at, finished_at, profile, kind")


def _row_to_job(row) -> dict:
    d = dict(zip((f.strip() for f in _FIELDS.split(",")), row))
    d["niches"] = list(d["niches"] or [])
    return d


class JobQueue:
    def __init__(self, dsn: str | None = None):
        self._conn = psycopg.connect(dsn or DEFAULT_DSN, autocommit=True)
        self._conn.execute(_JOBS_SQL)

    def enqueue(self, url: str, channel_id: str | None = None,
                niches: list[str] | None = None,
                max_res: int | None = None,
                profile: str = "default") -> dict:
        """Validate the URL up front: an unparseable link fails immediately
        instead of occupying the queue. Media kind is sniffed by file
        extension: image URLs (including file:// spooled uploads) become
        kind='image' jobs, file:// video files kind='video_file' — for
        both, the job's video_id is just a display label."""
        from urllib.parse import urlparse
        job_id = uuid.uuid4().hex
        now = time.time()
        if is_image_url(url):
            kind = "image"
            video_id = os.path.basename(urlparse(url).path) or "image"
            status, error = "queued", None
        elif url.startswith("file://") and is_video_file_url(url):
            kind = "video_file"
            video_id = os.path.basename(urlparse(url).path) or "video"
            status, error = "queued", None
        else:
            kind = "video"
            try:
                video_id = parse_youtube_id(url)
                status, error = "queued", None
            except ValueError as e:
                video_id, status, error = None, "failed", str(e)
        self._conn.execute(
            f"INSERT INTO jobs ({_FIELDS}) VALUES "
            f"(%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, "
            f"%s, %s)",
            (job_id, url, video_id, status, None, 0.0, error, 0,
             channel_id, list(niches or []), max_res, 0, now, now,
             now if status == "failed" else None, profile, kind),
        )
        return self.get(job_id)

    def get(self, job_id: str) -> dict | None:
        row = self._conn.execute(
            f"SELECT {_FIELDS} FROM jobs WHERE id = %s", (job_id,)).fetchone()
        return _row_to_job(row) if row else None

    def list(self, status: str | None = None, limit: int = 100,
             profile: str | None = None) -> list[dict]:
        where, params = [], []
        if status:
            where.append("status = %s")
            params.append(status)
        if profile:
            where.append("profile = %s")
            params.append(profile)
        rows = self._conn.execute(
            f"SELECT {_FIELDS} FROM jobs "
            f"{('WHERE ' + ' AND '.join(where)) if where else ''} "
            f"ORDER BY created_at DESC LIMIT %s", [*params, limit]).fetchall()
        return [_row_to_job(r) for r in rows]

    def update(self, job_id: str, **fields) -> None:
        fields["updated_at"] = time.time()
        cols = ", ".join(f"{k} = %s" for k in fields)
        self._conn.execute(
            f"UPDATE jobs SET {cols} WHERE id = %s",
            [*fields.values(), job_id])

    def claim_next(self) -> dict | None:
        """Atomically claim the oldest queued job (SKIP LOCKED so a second
        worker never double-claims, even though we run one on purpose)."""
        with self._conn.transaction():
            row = self._conn.execute(
                f"""
                UPDATE jobs SET status = 'downloading', stage = 'downloading',
                                attempts = attempts + 1, updated_at = %s
                WHERE id = (SELECT id FROM jobs WHERE status = 'queued'
                            ORDER BY created_at LIMIT 1
                            FOR UPDATE SKIP LOCKED)
                RETURNING {_FIELDS}
                """, (time.time(),)).fetchone()
        return _row_to_job(row) if row else None


def run_job(engine, queue: JobQueue, job: dict, engine_for=None) -> None:
    """Execute one claimed job against ITS profile's engine, mirroring
    ingest stages into the row. `engine` serves the "default" profile;
    other profiles resolve through `engine_for(name)` (falls back to the
    broll.profiles registry). A bad profile fails the job, loudly."""
    def on_progress(stage: str, frac: float) -> None:
        queue.update(job["id"], status=stage, stage=stage, progress=frac)

    try:
        profile = job.get("profile") or "default"
        if profile != "default":
            if engine_for is None:
                from . import profiles
                engine_for = profiles.engine_for
            engine = engine_for(profile)
        if job.get("kind") == "image":
            url = job["url"]
            if url.startswith("file://"):     # spooled upload: consume it
                segs = engine.ingest_image(
                    url.removeprefix("file://"),
                    channel_id=job["channel_id"], niches=job["niches"],
                    keep_source=False, on_progress=on_progress)
            else:
                segs = engine.ingest_image_url(
                    url, channel_id=job["channel_id"],
                    niches=job["niches"], on_progress=on_progress)
        elif job.get("kind") == "video_file":
            # spooled local video: content-hash id so re-uploading the same
            # footage is skipped instead of re-tagged; consumed on success
            path = job["url"].removeprefix("file://")
            segs = engine.ingest_video(
                path, channel_id=job["channel_id"], niches=job["niches"],
                video_id=f"upload:{file_sha256(path)}",
                on_progress=on_progress)
            if os.path.exists(path):
                os.remove(path)
        else:
            segs = engine.ingest_url(
                job["url"], channel_id=job["channel_id"],
                niches=job["niches"], max_res=job["max_res"],
                on_progress=on_progress)
        queue.update(job["id"], status="done", progress=1.0,
                     segments_created=len(segs), error=None,
                     finished_at=time.time())
    except Exception as e:
        if job["attempts"] < JOB_MAX_ATTEMPTS:
            queue.update(job["id"], status="queued", stage=None, progress=0.0,
                         error=f"attempt {job['attempts']} failed: {e}")
        else:
            queue.update(job["id"], status="failed",
                         error=traceback.format_exc(limit=5),
                         finished_at=time.time())


def run_worker(engine, queue: JobQueue, poll_s: float = 3.0,
               stop=None, engine_for=None) -> None:
    """Serial worker loop: one job at a time, forever (or until `stop`
    threading.Event is set). ONE worker serves every profile — the
    one-download-at-a-time rule is global, not per-profile."""
    while stop is None or not stop.is_set():
        job = queue.claim_next()
        if job is None:
            time.sleep(poll_s)
            continue
        print(f"[jobs] running {job['id'][:8]} ({job['url']}) "
              f"attempt {job['attempts']} profile {job.get('profile')}")
        run_job(engine, queue, job, engine_for=engine_for)
