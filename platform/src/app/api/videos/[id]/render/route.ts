import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo } from "@/lib/videos";
import { requeueForRecompile } from "@/lib/editorFiles";

type Ctx = { params: Promise<{ id: string }> };

/**
 * Render what is on disk — the manual half of the save/render split.
 *
 * `PUT .../beats` writes beats.json and stops there, so the human decides when
 * the machine spends a compile and a render. This is that decision: the same
 * re-queue an edit used to trigger on its own, keeping the video's frozen
 * snapshot (the worker recompiles only the stages the edit made stale).
 */
export const POST = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (["queued", "producing"].includes(video.status)) {
    throw new ApiError(409, `already ${video.status} — a worker is on it`);
  }
  if (!["rendered", "in_review", "sent_back", "approved", "error", "draft"].includes(video.status)) {
    throw new ApiError(409, `cannot render from status ${video.status}`);
  }
  await requeueForRecompile(video, `render requested by ${user.email}`);
  return NextResponse.json({ ok: true, status: "queued" });
});
