import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess } from "@/lib/auth";
import { getVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  return NextResponse.json(video);
});
