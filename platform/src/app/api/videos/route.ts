import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, requireChannelAccess, grantedChannelIds, ApiError } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { materializeUploads } from "@/lib/videos";

export const GET = handler(async (req: Request) => {
  const user = await requireUser();
  const url = new URL(req.url);
  const channel = url.searchParams.get("channel");
  const status = url.searchParams.get("status");
  const granted = await grantedChannelIds(user);

  const where: string[] = [];
  const params: unknown[] = [];
  if (granted !== "all") {
    params.push(granted);
    where.push(`channel_id = ANY($${params.length})`);
  }
  if (channel) {
    params.push(channel);
    where.push(`channel_id = $${params.length}`);
  }
  if (status) {
    params.push(status.split(","));
    where.push(`status = ANY($${params.length})`);
  }
  const rows = await query(
    `SELECT id, channel_id, title, status, price_usd, size_bytes, error_reason, created_at, updated_at
     FROM videos ${where.length ? "WHERE " + where.join(" AND ") : ""}
     ORDER BY created_at DESC LIMIT 500`,
    params
  );
  return NextResponse.json(rows);
});

/** Create a draft video. multipart/form-data: title, channel_id, overrides (JSON), uploads. */
export const POST = handler(async (req: Request) => {
  const user = await requireRole("manager");
  const form = await req.formData();
  const title = String(form.get("title") ?? "").trim();
  const channelId = String(form.get("channel_id") ?? "").trim();
  if (!title) throw new ApiError(400, "title required");
  if (!channelId) throw new ApiError(400, "channel_id required");
  await requireChannelAccess(user, channelId);

  let overrides: Record<string, unknown> | null = null;
  const rawOverrides = form.get("overrides");
  if (rawOverrides && typeof rawOverrides === "string" && rawOverrides.trim()) {
    try {
      overrides = JSON.parse(rawOverrides);
    } catch {
      throw new ApiError(400, "overrides is not valid JSON");
    }
  }

  const id = newId("vid");
  await query(
    `INSERT INTO videos (id, channel_id, title, status, created_by, cfg)
     VALUES ($1, $2, $3, 'draft', $4, NULL)`,
    [id, channelId, title, user.id]
  );
  if (overrides) {
    // stash overrides until enqueue snapshots them (kept in cfg slot of the draft)
    await query(`UPDATE videos SET cfg = $2 WHERE id = $1`, [
      id,
      JSON.stringify({ __draft_overrides: overrides }),
    ]);
  }
  const written = await materializeUploads(id, form);
  return NextResponse.json({ id, uploads: written }, { status: 201 });
});
