import { NextResponse } from "next/server";
import type { BeatSheet } from "@lusora/contracts";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo } from "@/lib/videos";
import { readBeats, validateBeats, writeBeats, requeueForRecompile } from "@/lib/editorFiles";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  return NextResponse.json(readBeats(id));
});

/** PUT validates + writes beats.json + re-queues for per-beat recompile. */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (!["rendered", "in_review", "sent_back", "approved", "error", "draft"].includes(video.status)) {
    throw new ApiError(409, `cannot edit beats while status is ${video.status}`);
  }
  const beats: BeatSheet = await req.json();
  beats.video_id = id;
  const errors = validateBeats(id, beats);
  if (errors.length) {
    return NextResponse.json({ error: "beat sheet invalid", problems: errors }, { status: 422 });
  }
  writeBeats(id, beats);
  await requeueForRecompile(video, `beats edited by ${user.email} — per-beat recompile queued`);
  return NextResponse.json({ ok: true, status: "queued" });
});
