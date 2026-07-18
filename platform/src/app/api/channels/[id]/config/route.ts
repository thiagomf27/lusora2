import { NextResponse } from "next/server";
import type { ChannelConfig } from "@lusora/contracts";
import { one, query } from "@/db/pool";
import { handler, requireUser, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { validateAgainst } from "@/lib/validate";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const row = await one<{ config: ChannelConfig }>("SELECT config FROM channels WHERE id = $1", [id]);
  if (!row) throw new ApiError(404, `channel ${id} not found`);
  return NextResponse.json(row.config);
});

export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("manager");
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const config: ChannelConfig = await req.json();
  const check = validateAgainst("channel_config", config);
  if (!check.ok) throw new ApiError(400, `channel config invalid: ${check.errors.join("; ")}`);
  if (config.channel_id !== id) throw new ApiError(400, "channel_id in config must match the URL");
  const result = await query(
    `UPDATE channels SET config = $2, name = $3, language = $4, video_type = $5,
       theme = $6, style_pack = $7, component_pack = $8 WHERE id = $1 RETURNING id`,
    [
      id,
      JSON.stringify(config),
      config.name,
      config.language,
      config.video_type,
      config.theme,
      config.style_pack,
      config.component_pack ?? null,
    ]
  );
  if (result.length === 0) throw new ApiError(404, `channel ${id} not found`);
  return NextResponse.json(config);
});
