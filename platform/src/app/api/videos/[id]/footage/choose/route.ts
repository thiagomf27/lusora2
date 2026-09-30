import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handler, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { query } from "@/db/pool";
import { getVideo, pendingGate, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** D109 — at the footage gate, choose which candidate a shot uses, overriding
 *  the judge's pick (or clear the choice with candidate_id null). Written to
 *  footage_choices.json; resolve_assets places a chosen candidate first. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("admin", "manager", "editor");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (video.status !== "awaiting_approval" || pendingGate(video) !== "pick_shots") {
    throw new ApiError(409, "a candidate can be chosen only while the video waits at the footage gate (pick_shots)");
  }
  let body: { item_id?: unknown; candidate_id?: unknown; source?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "body is not valid JSON");
  }
  const itemId = typeof body.item_id === "string" ? body.item_id : "";
  if (!itemId) throw new ApiError(400, "item_id: which shot");

  const folder = videoFolder(id);
  const picks = JSON.parse(readFileSync(join(folder, "shot_picks.json"), "utf8"));
  const candidates: { id: string; source: string; provider?: string }[] = picks.items?.[itemId]?.candidates ?? [];
  const path = join(folder, "footage_choices.json");
  const doc: { choices: Record<string, unknown> } = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { choices: {} };

  if (body.candidate_id === null || body.candidate_id === undefined) {
    delete doc.choices[itemId];
  } else {
    const c = candidates.find((x) => String(x.id) === String(body.candidate_id) && (!body.source || x.source === body.source));
    if (!c) throw new ApiError(404, `shot ${itemId} has no candidate ${String(body.candidate_id)}`);
    doc.choices[itemId] = { source: c.source, provider: c.provider ?? null, id: String(c.id), by: user.email,
                            at: new Date().toISOString() };
  }
  writeFileSync(path, JSON.stringify(doc, null, 2) + "\n");
  await query(
    `INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'pick_shots', 'progress', $2)`,
    [id, body.candidate_id == null
      ? `${user.email} cleared the choice for ${itemId}`
      : `${user.email} chose ${String(body.candidate_id)} for ${itemId}`]
  );
  return NextResponse.json({ ok: true });
});
