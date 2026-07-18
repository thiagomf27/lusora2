import { NextResponse } from "next/server";
import { canTransition, type VideoStatus } from "@lusora/contracts";
import { query } from "@/db/pool";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, enqueueVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);

  const { to, youtube_id } = (await req.json()) as { to: VideoStatus; youtube_id?: string };
  const from = video.status as VideoStatus;
  if (!to) throw new ApiError(400, "'to' status required");
  if (!canTransition(user.role, from, to)) {
    throw new ApiError(403, `transition ${from} → ${to} not allowed for role ${user.role}`);
  }

  // re-queue goes through the full enqueue path (pre-flight, snapshot kept)
  if (to === "queued") {
    const r = await enqueueVideo(video, null);
    if (!r.ok) {
      return NextResponse.json({ error: "pre-flight failed", problems: r.problems }, { status: 422 });
    }
  } else {
    await query(
      `UPDATE videos SET status = $2, youtube_id = COALESCE($3, youtube_id), updated_at = now() WHERE id = $1`,
      [id, to, youtube_id ?? null]
    );
    await query(
      `INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'review', 'done', $2)`,
      [id, `${from} → ${to} by ${user.email}`]
    );
  }
  return NextResponse.json({ ok: true, status: to });
});
