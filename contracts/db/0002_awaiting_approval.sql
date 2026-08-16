-- D62: review mode. A video stopped at a manifest gate is neither producing
-- (no worker holds it — reclaim_orphans must not re-queue it) nor queued (no
-- worker may claim it until a human approves), so it needs its own state.
--
-- Note for the orphan sweep: it only ever touches 'producing', so a video
-- parked here is safe indefinitely.
ALTER TYPE video_status ADD VALUE IF NOT EXISTS 'awaiting_approval' AFTER 'producing';

-- Safe inside migrate.ts's BEGIN/COMMIT: since PG12, ADD VALUE may run in a
-- transaction block provided the new value is not USED before it commits,
-- which is why this file only declares it. (deploy pins pgvector/pgvector:pg16.)
