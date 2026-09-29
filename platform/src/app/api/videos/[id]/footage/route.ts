import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess } from "@/lib/auth";
import { getVideo } from "@/lib/videos";
import { footageView } from "@/lib/footageView";

type Ctx = { params: Promise<{ id: string }> };

/** D105 — the shot judge's candidates per shot, with links to the sources, so
 *  a footage gate can be reviewed before it is approved. 204 when the video
 *  has no judged footage (pick off, or a pipeline without pick_shots). */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const view = footageView(id);
  if (!view) return new NextResponse(null, { status: 204 });
  return NextResponse.json(view);
});
