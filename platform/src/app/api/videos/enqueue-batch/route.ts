import { NextResponse } from "next/server";
import { handler, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, enqueueVideo } from "@/lib/videos";

/** Batch enqueue: per-item results, partial success — never fails the batch. */
export const POST = handler(async (req: Request) => {
  const user = await requireRole("manager");
  const { video_ids } = (await req.json()) as { video_ids: string[] };
  if (!Array.isArray(video_ids) || video_ids.length === 0) {
    throw new ApiError(400, "video_ids array required");
  }
  const results: Record<string, { ok: boolean; problems?: string[] }> = {};
  for (const id of video_ids) {
    try {
      const video = await getVideo(id);
      await requireChannelAccess(user, video.channel_id);
      const draftCfg = video.cfg as unknown as { __draft_overrides?: Record<string, unknown> } | null;
      const r = await enqueueVideo(video, draftCfg?.__draft_overrides ?? null);
      results[id] = r.ok ? { ok: true } : { ok: false, problems: r.problems };
    } catch (e) {
      results[id] = { ok: false, problems: [e instanceof Error ? e.message : String(e)] };
    }
  }
  return NextResponse.json({ results });
});
