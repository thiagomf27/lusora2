import { NextResponse } from "next/server";
import type { ChannelConfig } from "@lusora/contracts";
import { query, one } from "@/db/pool";
import { handler, requireUser, requireRole, grantedChannelIds, ApiError } from "@/lib/auth";
import { validateAgainst } from "@/lib/validate";

export const GET = handler(async () => {
  const user = await requireUser();
  const granted = await grantedChannelIds(user);
  const rows =
    granted === "all"
      ? await query("SELECT id, name, language, video_type, theme, style_pack, component_pack, active, created_at FROM channels ORDER BY created_at")
      : await query(
          "SELECT id, name, language, video_type, theme, style_pack, component_pack, active, created_at FROM channels WHERE id = ANY($1) ORDER BY created_at",
          [granted]
        );
  return NextResponse.json(rows);
});

export const POST = handler(async (req: Request) => {
  const user = await requireRole("manager");
  const config: ChannelConfig = await req.json();
  const check = validateAgainst("channel_config", config);
  if (!check.ok) throw new ApiError(400, `channel config invalid: ${check.errors.join("; ")}`);

  const existing = await one("SELECT 1 FROM channels WHERE id = $1", [config.channel_id]);
  if (existing) throw new ApiError(409, `channel ${config.channel_id} already exists`);

  await query(
    `INSERT INTO channels (id, name, language, video_type, theme, style_pack, component_pack, config)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      config.channel_id,
      config.name,
      config.language,
      config.video_type,
      config.theme,
      config.style_pack,
      config.component_pack ?? null,
      JSON.stringify(config),
    ]
  );
  // managers automatically get a grant on channels they create
  if (user.role === "manager") {
    await query(
      "INSERT INTO user_channel_grants (user_id, channel_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [user.id, config.channel_id]
    );
  }
  return NextResponse.json({ id: config.channel_id }, { status: 201 });
});
