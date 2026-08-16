"""The deterministic orchestrator (D2): polls the queue, and for each
claimed video runs every stage whose output artifact is missing from the
folder. Stores no state of its own — resume is 'skip what exists'.
"""

from __future__ import annotations

import time
import traceback

from lusora_contracts.pipelines import (
    DEFAULT_PIPELINE,
    PipelineError,
    load_pipeline,
    validate_pipeline,
)

from ..config import WorkerConfig
from ..context import StageContext
from ..db import Db
from ..errors import StageError
from . import checkpoints
from .stages import UnknownStageError, build_stages, ensure_claim_materialized


def resolve_pipeline(ctx: StageContext) -> dict:
    """Which pipeline this video runs (D60).

    Selection happened at enqueue: the platform picked a manifest and embedded
    it as `pipeline_doc`, the same snapshot rule the theme and the style pack
    follow (Principle 7) — editing a manifest never changes an in-flight video,
    and a re-run walks the stages it was built with. Falling back to the named
    manifest on disk, then to `faceless`, is what keeps manual-first true: a
    hand-written cfg.json, or one snapshotted before this existed, still runs.
    """
    doc = ctx.cfg.get("pipeline_doc")
    if isinstance(doc, dict) and doc:
        validate_pipeline(doc, where="cfg.json pipeline_doc")
        return doc
    return load_pipeline(str(ctx.cfg.get("pipeline") or DEFAULT_PIPELINE))


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

        try:
            manifest = resolve_pipeline(ctx)
            stages = build_stages(manifest)
        except (PipelineError, UnknownStageError) as e:
            raise StageError("pipeline", str(e))
        pipeline_id = f"{manifest['name']} v{manifest['version']}"
        db.event(video_id, "pipeline", "started", f"{pipeline_id} — {len(stages)} stages")

        # D62: which gates are live for THIS video. Resolved once, before the
        # loop, so a run cannot change its mind halfway down the stage list.
        policy = checkpoints.policy(ctx.cfg, manifest)
        gates = set(checkpoints.gated_stages(manifest)) if policy == checkpoints.GUIDED else set()
        if gates:
            db.event(video_id, "pipeline", "progress",
                     f"review mode — stops after {', '.join(checkpoints.gated_stages(manifest))}")
            ctx.log(f"review mode: gates after {', '.join(sorted(gates))}")
        ctx.log(f"pipeline {pipeline_id} ({', '.join(s.name for s in stages)})")

        for stage in stages:
            if stage.done(ctx):
                db.event(video_id, stage.name, "done", "output already present — skipped")
            else:
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

            # The gate fires whether the stage just ran or was skipped as
            # already-present: on the re-claim after an approval the artifact
            # exists, so only the approval file can tell the loop to carry on.
            if stage.name in gates:
                if not checkpoints.approved(ctx, stage.name):
                    db.set_status(video_id, "awaiting_approval")
                    db.event(video_id, stage.name, "progress",
                             "waiting for human approval (review mode)")
                    ctx.log(f"stopped after {stage.name} — waiting for approval")
                    return
                db.event(video_id, stage.name, "done",
                         f"gate passed — {checkpoints.approval_note(ctx, stage.name)}")

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


def retention_sweep(db: Db, config: WorkerConfig) -> None:
    """D19: final.mp4 deleted N days after POSTED; beats/plan/cfg/logs/costs
    kept forever (kilobytes; re-render and audit stay possible)."""
    rows = db.conn.execute(
        """
        SELECT id, folder_path,
               COALESCE((cfg->'retention'->>'final_mp4_days_after_posted')::int, 30) AS days
        FROM videos
        WHERE status = 'posted' AND folder_path IS NOT NULL
          AND updated_at < now() - make_interval(days =>
              COALESCE((cfg->'retention'->>'final_mp4_days_after_posted')::int, 30))
        """
    ).fetchall()
    for row in rows:
        final = config.videos_root / str(row["id"]) / "final.mp4"
        if final.exists():
            final.unlink()
            db.event(str(row["id"]), "retention", "done",
                     f"final.mp4 removed {row['days']} days after posted")


def reclaim_orphans(db: Db) -> None:
    """A killed worker leaves its video stuck in 'producing'. Any producing
    video not held by a live worker (heartbeat < 60s) goes back to 'queued' —
    the artifact-driven resume makes this free."""
    rows = db.conn.execute(
        """
        UPDATE videos SET status = 'queued', updated_at = now()
        WHERE status = 'producing' AND id NOT IN (
          SELECT current_video_id FROM worker_heartbeat
          WHERE current_video_id IS NOT NULL AND last_seen > now() - interval '60 seconds'
        )
        RETURNING id
        """
    ).fetchall()
    for row in rows:
        db.event(str(row["id"]), "claim", "progress", "orphaned claim re-queued (worker died mid-run)")


def run_forever(config: WorkerConfig) -> None:
    db = Db(config.database_url)
    print(f"[{config.worker_id}] polling every {config.poll_seconds}s — videos root {config.videos_root}")
    reclaim_orphans(db)
    last_sweep = 0.0
    while True:
        try:
            db.heartbeat(config.worker_id, None)
            if time.time() - last_sweep > 600:
                retention_sweep(db, config)
                last_sweep = time.time()
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
