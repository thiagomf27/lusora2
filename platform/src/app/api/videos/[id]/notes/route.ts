import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const notes = await query(
    `SELECT n.id, n.text, n.ts, u.name AS user_name FROM notes n
     JOIN users u ON u.id = n.user_id WHERE n.video_id = $1 ORDER BY n.ts`,
    [id]
  );
  return NextResponse.json(notes);
});

export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const { text } = (await req.json()) as { text: string };
  if (!text?.trim()) throw new ApiError(400, "text required");
  await query("INSERT INTO notes (video_id, user_id, text) VALUES ($1, $2, $3)", [
    id,
    user.id,
    text.trim(),
  ]);
  return NextResponse.json({ ok: true }, { status: 201 });
});
