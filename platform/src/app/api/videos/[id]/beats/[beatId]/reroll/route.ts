import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo } from "@/lib/videos";
import { clearBeatAssets, requeueForRecompile } from "@/lib/editorFiles";

type Ctx = { params: Promise<{ id: string; beatId: string }> };

/** Re-roll: re-run asset resolution for ONE beat (locked items untouched). */
export const POST = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id, beatId } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const cleared = clearBeatAssets(id, beatId);
  if (cleared === 0) {
    throw new ApiError(404, `beat ${beatId} has no unlocked items with resolved assets`);
  }
  await requeueForRecompile(video, `re-roll of ${beatId} by ${user.email} (${cleared} item(s))`);
  return NextResponse.json({ ok: true, cleared, status: "queued" });
});
