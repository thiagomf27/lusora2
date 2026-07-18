import { NextResponse } from "next/server";
import { one, query } from "@/db/pool";
import { handler, requireUser, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const row = await one("SELECT * FROM channels WHERE id = $1", [id]);
  if (!row) throw new ApiError(404, `channel ${id} not found`);
  return NextResponse.json(row);
});

export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const body = await req.json();
  if (typeof body.active === "boolean") {
    await query("UPDATE channels SET active = $2 WHERE id = $1", [id, body.active]);
  }
  if (typeof body.name === "string" && body.name.trim()) {
    await query("UPDATE channels SET name = $2 WHERE id = $1", [id, body.name.trim()]);
  }
  const row = await one("SELECT * FROM channels WHERE id = $1", [id]);
  if (!row) throw new ApiError(404, `channel ${id} not found`);
  return NextResponse.json(row);
});
