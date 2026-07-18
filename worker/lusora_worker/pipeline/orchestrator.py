"""The deterministic orchestrator (D2): polls the queue, and for each
claimed video runs every stage whose output artifact is missing from the
folder. Stores no state of its own — resume is 'skip what exists'.
"""

from __future__ import annotations

import time
import traceback

from ..config import WorkerConfig
from ..context import StageContext
from ..db import Db
from ..errors import StageError
from .stages import STAGES, ensure_claim_materialized


def process_video(db: Db, config: WorkerConfig, video: dict) -> None:
    video_id = str(video["id"])
    folder = config.videos_root / video_id
    cfg = video.get("cfg") or {}
    ctx = StageContext(video=video, folder=folder, cfg=cfg, db=db, config=config)

    try:
        ensure_claim_materialized(ctx)
        ctx.cfg = ctx.read_json("cfg.json")  # folder is the data plane of record
        db.event(video_id, "claim", "done", f"claimed by {config.worker_id}")
        ctx.log(f"claimed by {config.worker_id}")

        for stage in STAGES:
            if stage.done(ctx):
                db.event(video_id, stage.name, "done", "output already present — skipped")
                continue
            db.event(video_id, stage.name, "started", None)
            ctx.log(f"stage {stage.name} started")
            stage.run(ctx)
            if stage.artifact is not None and not stage.done(ctx):
                raise StageError(
                    stage.name,
                    f"stage completed but expected artifact '{stage.artifact}' is missing from {folder}",
                )
            db.event(video_id, stage.name, "done", None)
            ctx.log(f"stage {stage.name} done")
            db.heartbeat(config.worker_id, video_id)

        db.set_status(video_id, "rendered")
        db.event(video_id, "pipeline", "done", "video rendered — ready for review")
        ctx.log("pipeline done")
    except StageError as e:
        db.set_status(video_id, "error", str(e))
        db.event(video_id, e.stage, "failed", e.reason)
        try:
            ctx.log(f"ERROR {e}")
        except OSError:
            pass
    except Exception as e:  # unexpected — still one actionable line
        reason = f"unexpected: {e.__class__.__name__}: {e}"
        db.set_status(video_id, "error", reason)
        db.event(video_id, "pipeline", "failed", reason)
        traceback.print_exc()


def run_forever(config: WorkerConfig) -> None:
    db = Db(config.database_url)
    print(f"[{config.worker_id}] polling every {config.poll_seconds}s — videos root {config.videos_root}")
    while True:
        try:
            db.heartbeat(config.worker_id, None)
            video = db.claim_next(config.worker_id)
            if video is not None:
                print(f"[{config.worker_id}] claimed {video['id']}")
                db.heartbeat(config.worker_id, str(video["id"]))
                process_video(db, config, video)
                db.heartbeat(config.worker_id, None)
                continue  # drain the queue before sleeping
        except Exception as e:
            print(f"[{config.worker_id}] loop error: {e}")
            time.sleep(config.poll_seconds)
        time.sleep(config.poll_seconds)
