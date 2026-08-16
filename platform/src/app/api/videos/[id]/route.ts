import { rmSync } from "node:fs";
import { NextResponse } from "next/server";
import { handler, requireUser, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { query } from "@/db/pool";
import { gatedStages, getVideo, pendingGate, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  // D62: which gate this video is stopped at, and which its pipeline declares.
  // Derived from the snapshot + the folder on every read rather than stored,
  // so it cannot drift from what the worker will do on the next claim.
  return NextResponse.json({
    ...video,
    review_gates: gatedStages(video),
    pending_gate: video.status === "awaiting_approval" ? pendingGate(video) : null,
  });
});

/** Rename a video. The title is only an editorial label after enqueue — the
 *  cfg snapshot is what the render is locked to — so this is allowed in any
 *  status, and recorded as an event like every other human action. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const { title } = (await req.json()) as { title?: string };
  if (typeof title !== "string" || !title.trim()) throw new ApiError(400, "title required");
  await query("UPDATE videos SET title = $2, updated_at = now() WHERE id = $1", [id, title.trim()]);
  await query(
    "INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'review', 'done', $2)",
    [id, `renamed to "${title.trim()}" by ${user.email}`]
  );
  return NextResponse.json({ ok: true, id, title: title.trim() });
});

/** Delete a video: its files on disk + the DB row (cascades to events, notes,
 *  asset_usage; cost_events keep the record with video_id nulled). */
export const DELETE = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (video.status === "producing") {
    throw new ApiError(409, "cannot delete while producing — a worker is rendering this video");
  }
  // remove the per-video folder (best-effort — DB row is the source of truth)
  try {
    rmSync(videoFolder(id), { recursive: true, force: true });
  } catch {
    /* ignore filesystem errors — proceed to drop the row */
  }
  await query("DELETE FROM videos WHERE id = $1", [id]);
  return NextResponse.json({ ok: true, id });
});
