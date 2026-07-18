import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { query, one } from "@/db/pool";
import { handler, requireRole, ApiError } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  await requireRole();
  const { id } = await ctx.params;
  const user = await one("SELECT id FROM users WHERE id = $1", [id]);
  if (!user) throw new ApiError(404, "user not found");
  const body = await req.json();
  if (typeof body.active === "boolean") {
    await query("UPDATE users SET active = $2 WHERE id = $1", [id, body.active]);
  }
  if (body.role && ["admin", "manager", "editor"].includes(body.role)) {
    await query("UPDATE users SET role = $2 WHERE id = $1", [id, body.role]);
  }
  if (body.password) {
    await query("UPDATE users SET password_hash = $2 WHERE id = $1", [
      id,
      await bcrypt.hash(body.password, 10),
    ]);
  }
  if (Array.isArray(body.channels)) {
    await query("DELETE FROM user_channel_grants WHERE user_id = $1", [id]);
    for (const ch of body.channels) {
      await query(
        "INSERT INTO user_channel_grants (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [id, ch]
      );
    }
  }
  return NextResponse.json({ ok: true });
});
