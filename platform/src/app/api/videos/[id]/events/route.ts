import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireChannelAccess } from "@/lib/auth";
import { getVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const events = await query(
    "SELECT id, stage, status, message, ts FROM video_events WHERE video_id = $1 ORDER BY ts, id",
    [id]
  );
  return NextResponse.json(events);
});
