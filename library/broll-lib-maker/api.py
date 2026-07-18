#!/usr/bin/env python
"""
api.py — the backend the gallery frontend talks to.

    .venv/bin/uvicorn api:app --host 127.0.0.1 --port 8321

Endpoints:
    POST /jobs                 {"urls": [...], "channel_id"?, "niches"?, "max_res"?}
    GET  /jobs?status=&limit=  queue listing (newest first)
    GET  /jobs/{id}            one job, with stage/progress/error
    POST /uploads              multipart upload (images/videos) -> queued jobs
    GET  /search?q=...         filtered library search (never triggers acquire)
    GET  /clips/{segment_id}   stream/download the stored bytes (mp4 or image)
    GET  /thumbs/{segment_id}  JPEG thumbnail (mid-clip frame / resized image)
    GET  /profiles             configured gallery profiles

Every endpoint accepts ?profile=<name> (default "default") and runs against
that profile's database/storage/embedder. The job queue itself lives in the
default profile's DB; each job records its profile and the single serial
worker routes it to the right engine — one download at a time GLOBALLY.
"""

from __future__ import annotations

import mimetypes
import os
import re
import shutil
import threading
import uuid

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from broll import BrollEngine, profiles
from broll.jobs import JobQueue, run_worker
from broll.pipeline import IMAGE_EXTS, VIDEO_EXTS

# uploaded files are spooled here until the serial worker ingests them
SPOOL_DIR = os.environ.get("BROLL_UPLOAD_SPOOL", "/tmp/broll_uploads")
UPLOAD_EXTS = IMAGE_EXTS | VIDEO_EXTS


class JobsIn(BaseModel):
    urls: list[str] = Field(min_length=1)
    channel: str | None = None    # display NAME — resolved/created server-side
    niches: list[str] = []        # display NAMES — resolved/created server-side
    max_res: int | None = None


def _seg_json(seg, score: float | None = None) -> dict:
    d = seg.to_row()
    d.pop("embedding", None)          # bulky and useless to a frontend
    if score is not None:
        d["score"] = round(score, 4)
    return d


def _local_path(uri: str | None) -> str | None:
    if uri and uri.startswith("file://"):
        return uri.removeprefix("file://")
    return None


def create_app(engine: BrollEngine | None = None,
               queue: JobQueue | None = None,
               start_worker: bool = True) -> FastAPI:
    # one engine per profile, built lazily; the passed-in engine (tests)
    # serves the "default" profile
    engines: dict[str, BrollEngine] = {}
    engines_lock = threading.Lock()
    if engine is not None:
        engines["default"] = engine

    def _engine(profile: str) -> BrollEngine:
        with engines_lock:
            if profile not in engines:
                engines[profile] = profiles.build_engine(
                    profiles.get_profile(profile))
            return engines[profile]

    def _eng(profile: str) -> BrollEngine:
        """HTTP-facing resolver: unknown profile -> 404, bad config -> 400."""
        try:
            return _engine(profile)
        except KeyError as e:
            raise HTTPException(404, str(e))
        except RuntimeError as e:          # e.g. embed_dim mismatch
            raise HTTPException(400, str(e))

    queue = queue or JobQueue()
    app = FastAPI(title="broll-engine")
    stop = threading.Event()

    if start_worker:
        @app.on_event("startup")
        def _start_worker() -> None:
            threading.Thread(target=run_worker,
                             args=(_engine("default"), queue),
                             kwargs={"stop": stop, "engine_for": _engine},
                             daemon=True, name="ingest-worker").start()

        @app.on_event("shutdown")
        def _stop_worker() -> None:
            stop.set()

    # ---- profiles ----
    @app.get("/profiles")
    def list_profiles() -> list[dict]:
        return [p.to_dict() for p in profiles.load_profiles().values()]

    # ---- jobs ----
    @app.post("/jobs")
    def create_jobs(body: JobsIn,
                    profile: str = Query("default")) -> list[dict]:
        # get-or-create by normalized name; jobs and segments store the IDs
        eng = _eng(profile)
        ch_id = eng.index.resolve_channel(body.channel)
        niche_ids = eng.index.resolve_niches(body.niches)
        return [queue.enqueue(u, channel_id=ch_id, niches=niche_ids,
                              max_res=body.max_res, profile=profile)
                for u in body.urls]

    @app.post("/uploads")
    def upload_files(files: list[UploadFile] = File(...),
                     channel: str | None = Form(None),
                     niches: str = Form(""),       # comma-separated NAMES
                     profile: str = Query("default")) -> list[dict]:
        """Multipart upload of local media — images AND videos. Files are
        spooled to disk and queued (kind sniffed from the extension:
        image | video_file) — the same serial worker tags/stores them, so
        the queue view tracks them like any other ingest. Uploaded videos
        get the full exhaustive fine pass at their ORIGINAL resolution."""
        eng = _eng(profile)
        for uf in files:
            ext = os.path.splitext(uf.filename or "")[1].lower()
            if ext not in UPLOAD_EXTS:
                raise HTTPException(
                    400, f"{uf.filename!r}: not an image or video "
                         f"(expected one of {sorted(UPLOAD_EXTS)})")
        ch_id = eng.index.resolve_channel(channel)
        niche_ids = eng.index.resolve_niches(
            [s.strip() for s in niches.split(",") if s.strip()])
        os.makedirs(SPOOL_DIR, exist_ok=True)
        jobs = []
        for uf in files:
            safe = re.sub(r"[^A-Za-z0-9._-]+", "_",
                          os.path.basename(uf.filename or "image"))
            dst = os.path.join(SPOOL_DIR, f"{uuid.uuid4().hex}_{safe}")
            with open(dst, "wb") as out:
                shutil.copyfileobj(uf.file, out)
            jobs.append(queue.enqueue(f"file://{dst}", channel_id=ch_id,
                                      niches=niche_ids, profile=profile))
        return jobs

    # ---- lookups (frontend dropdowns / gallery filters) ----
    @app.get("/channels")
    def list_channels(profile: str = Query("default")) -> list[dict]:
        return _eng(profile).index.list_channels()

    @app.get("/niches")
    def list_niches(profile: str = Query("default")) -> list[dict]:
        return _eng(profile).index.list_niches()

    @app.get("/source-channels")
    def list_source_channels(profile: str = Query("default")) -> list[dict]:
        """Distinct ORIGIN (uploader) channels present in the library."""
        return _eng(profile).index.list_source_channels()

    # ---- browse (no query): newest first, same filters as /search ----
    @app.get("/segments")
    def list_segments(channel_id: str | None = None,
                      include_global: bool = True,
                      tags: str | None = None,
                      niches: str | None = None,
                      source_channel_id: str | None = None,
                      media_type: str | None = None,   # video_clip | image
                      licenses: str | None = None,       # comma-separated, any-of
                      min_duration: float | None = None,
                      max_duration: float | None = None,
                      created_after: float | None = None,
                      created_before: float | None = None,
                      limit: int = Query(60, le=500),
                      profile: str = Query("default")) -> list[dict]:
        filters = {k: v for k, v in {
            "channel_id": channel_id, "include_global": include_global,
            "tags": tags.split(",") if tags else None,
            "niches": niches.split(",") if niches else None,
            "source_channel_id": source_channel_id,
            "media_type": media_type,
            "licenses": licenses.split(",") if licenses else None,
            "min_duration": min_duration, "max_duration": max_duration,
            "created_after": created_after, "created_before": created_before,
        }.items() if v is not None}
        return [_seg_json(s) for s in
                _eng(profile).index.list_segments(limit=limit, **filters)]

    @app.get("/jobs")
    def list_jobs(status: str | None = None,
                  limit: int = Query(100, le=500),
                  profile: str | None = Query(None)) -> list[dict]:
        # the queue is shared; profile here is a FILTER, not a scope switch
        return queue.list(status=status, limit=limit, profile=profile)

    @app.get("/jobs/{job_id}")
    def get_job(job_id: str) -> dict:
        job = queue.get(job_id)
        if not job:
            raise HTTPException(404, "no such job")
        return job

    # ---- search (hot path only — the gallery must never trigger acquire) ----
    @app.get("/search")
    def search(q: str,
               channel_id: str | None = None,    # channels.id (see /channels)
               include_global: bool = True,
               tags: str | None = None,          # comma-separated, any-of
               niches: str | None = None,        # comma-separated niches.id, any-of
               source_channel_id: str | None = None,
               media_type: str | None = None,     # video_clip | image
               licenses: str | None = None,       # comma-separated, any-of
               min_duration: float | None = None,
               max_duration: float | None = None,
               created_after: float | None = None,    # epoch seconds
               created_before: float | None = None,
               project_id: str | None = None,
               top_k: int = Query(24, le=200),
               profile: str = Query("default")) -> list[dict]:
        filters = {k: v for k, v in {
            "tags": tags.split(",") if tags else None,
            "niches": niches.split(",") if niches else None,
            "source_channel_id": source_channel_id,
            "media_type": media_type,
            "licenses": licenses.split(",") if licenses else None,
            "min_duration": min_duration,
            "max_duration": max_duration,
            "created_after": created_after,
            "created_before": created_before,
        }.items() if v is not None}
        hits = _eng(profile).library_search(q, project_id=project_id,
                                            channel_id=channel_id,
                                            include_global=include_global,
                                            top_k=top_k, filters=filters)
        return [_seg_json(seg, score) for seg, score in hits]

    # ---- bytes ----
    def _resolve(seg_id: str, profile: str):
        eng = _eng(profile)
        seg = eng.index.get(seg_id)
        if not seg:
            raise HTTPException(404, "no such segment")
        if seg.is_duplicate:            # duplicates carry no bytes of their own
            seg = eng.index.get(seg.duplicate_of) or seg
        return seg

    @app.get("/clips/{seg_id}")
    def get_clip(seg_id: str, profile: str = Query("default")):
        """The stored bytes for a segment — mp4 for clips, the original
        image file for media_type='image'."""
        seg = _resolve(seg_id, profile)
        path = _local_path(seg.clip_uri)
        if not path:
            raise HTTPException(404, "clip bytes not available")
        if seg.media_type == "image":
            mime = mimetypes.guess_type(path)[0] or "application/octet-stream"
            return FileResponse(path, media_type=mime,
                                filename=os.path.basename(path))
        return FileResponse(path, media_type="video/mp4",
                            filename=f"{seg.video_id}_{seg.start:.0f}s.mp4")

    class MarkUsedIn(BaseModel):
        project_id: str
        channel_id: str | None = None

    @app.post("/segments/{seg_id}/mark_used")
    def mark_used(seg_id: str, body: MarkUsedIn,
                  profile: str = Query("default")) -> dict:
        """Per-channel usage bookkeeping (overuse tracking + same-project
        hard block live in ranking). Credits the canonical on duplicates."""
        eng = _eng(profile)
        if not eng.index.get(seg_id):
            raise HTTPException(404, "no such segment")
        eng.mark_used(seg_id, project_id=body.project_id,
                      channel_id=body.channel_id)
        return {"ok": True}

    @app.get("/thumbs/{seg_id}")
    def get_thumb(seg_id: str, profile: str = Query("default")):
        seg = _resolve(seg_id, profile)
        path = _local_path(seg.thumb_uri)
        if not path:
            raise HTTPException(404, "no thumbnail")
        return FileResponse(path, media_type="image/jpeg")

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8321)
