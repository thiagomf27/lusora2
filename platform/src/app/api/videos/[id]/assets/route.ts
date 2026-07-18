import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireChannelAccess } from "@/lib/auth";
import { getVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** "Assets used": provenance from asset_usage (license auditing). */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const rows = await query(
    `SELECT beat_id, source, asset_id, license, provider, ts
     FROM asset_usage WHERE video_id = $1 ORDER BY ts`,
    [id]
  );
  return NextResponse.json(rows);
});
