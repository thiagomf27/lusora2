import { NextResponse } from "next/server";
import { handler, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, enqueueVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);

  let overrides: Record<string, unknown> | null = null;
  const body = await req.text();
  if (body.trim()) {
    try {
      overrides = JSON.parse(body).overrides ?? null;
    } catch {
      throw new ApiError(400, "body is not valid JSON");
    }
  }
  // overrides stashed at creation win unless the enqueue call provides its own
  const draftCfg = video.cfg as unknown as { __draft_overrides?: Record<string, unknown> } | null;
  overrides ??= draftCfg?.__draft_overrides ?? null;

  const result = await enqueueVideo(video, overrides);
  if (!result.ok) {
    return NextResponse.json({ error: "pre-flight failed", problems: result.problems }, { status: 422 });
  }
  return NextResponse.json({ ok: true, status: "queued" });
});
