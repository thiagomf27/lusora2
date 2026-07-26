import { rmSync } from "node:fs";
import { NextResponse } from "next/server";
import { handler, requireUser, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { query } from "@/db/pool";
import { getVideo, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  return NextResponse.json(video);
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
