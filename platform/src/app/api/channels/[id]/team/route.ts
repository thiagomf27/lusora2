import { NextResponse } from "next/server";
import { query, one } from "@/db/pool";
import { handler, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const rows = await query(
    `SELECT u.id, u.email, u.name, u.role FROM user_channel_grants g
     JOIN users u ON u.id = g.user_id WHERE g.channel_id = $1 ORDER BY u.email`,
    [id]
  );
  return NextResponse.json(rows);
});

export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const { user_ids } = (await req.json()) as { user_ids: string[] };
  if (!Array.isArray(user_ids)) throw new ApiError(400, "user_ids array required");
  const channel = await one("SELECT 1 FROM channels WHERE id = $1", [id]);
  if (!channel) throw new ApiError(404, `channel ${id} not found`);
  await query("DELETE FROM user_channel_grants WHERE channel_id = $1", [id]);
  for (const uid of user_ids) {
    await query(
      "INSERT INTO user_channel_grants (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [uid, id]
    );
  }
  return NextResponse.json({ ok: true });
});
