import { NextResponse } from "next/server";
import type { BeatSheet } from "@lusora/contracts";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { query } from "@/db/pool";
import { getVideo } from "@/lib/videos";
import { readBeats, validateBeats, writeBeats } from "@/lib/editorFiles";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  return NextResponse.json(readBeats(id));
});

/**
 * PUT validates + writes beats.json. It does NOT start a render.
 *
 * Saving and rendering used to be one action, so every typo fixed in a visual
 * intent spent a compile and a render before the next edit could be made. They
 * are separate now: this writes the document, and `POST .../render` is the
 * manual trigger. `render_pending` on the video row (beats.json newer than the
 * compiled plan) is how a screen knows there is something unrendered.
 */
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
  // D89 — the version marks what the document CARRIES, so a sheet that gained
  // a per-beat transition says 1.2. Derived here beside video_id rather than
  // asked of whoever is saving, for the same reason: it is not a choice.
  if (beats.beats?.some((b) => b.transition_out) && beats.version !== "1.2") {
    beats.version = "1.2";
  }
  const errors = validateBeats(id, beats);
  if (errors.length) {
    return NextResponse.json({ error: "beat sheet invalid", problems: errors }, { status: 422 });
  }
  writeBeats(id, beats);
  await query(
    `INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'editor', 'done', $2)`,
    [id, `beats edited by ${user.email} — not rendered yet`]
  );
  return NextResponse.json({ ok: true, status: video.status, render_pending: true });
});
