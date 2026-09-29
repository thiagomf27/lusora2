import { NextResponse } from "next/server";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { handler, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { query } from "@/db/pool";
import { getVideo, pendingGate, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** D108 — at the footage gate, ask for more candidates on some shots instead
 *  of approving what is there. Writes footage_requests.json into the folder
 *  and re-queues the video; the worker's pick_shots judges more for those
 *  shots only and stops again for review. `query` = words to search as typed
 *  (stock, and one new YouTube video for the beat's subject). */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("admin", "manager", "editor");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (video.status !== "awaiting_approval" || pendingGate(video) !== "pick_shots") {
    throw new ApiError(409, "more footage can be asked for only while the video waits at the footage gate (pick_shots)");
  }
  let body: { item_ids?: unknown; query?: unknown };
  try {
    body = await req.json();
  } catch {
    throw new ApiError(400, "body is not valid JSON");
  }
  const ids = Array.isArray(body.item_ids) ? body.item_ids.map(String).filter(Boolean) : [];
  if (ids.length === 0) throw new ApiError(400, "item_ids: which shots to search more for");
  const typed = typeof body.query === "string" ? body.query.trim().slice(0, 80) : "";

  const path = join(videoFolder(id), "footage_requests.json");
  const pending: { requests: { item_id: string; query?: string; by: string; at: string }[] } = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf8"))
    : { requests: [] };
  const at = new Date().toISOString();
  for (const itemId of ids) {
    pending.requests = pending.requests.filter((r) => r.item_id !== itemId);
    pending.requests.push({ item_id: itemId, ...(typed ? { query: typed } : {}), by: user.email, at });
  }
  writeFileSync(path, JSON.stringify(pending, null, 2) + "\n");

  await query(`UPDATE videos SET status = 'queued', error_reason = NULL, updated_at = now() WHERE id = $1`, [id]);
  await query(
    `INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'pick_shots', 'progress', $2)`,
    [id, `${user.email} asked for more footage on ${ids.length} shot${ids.length === 1 ? "" : "s"}` +
      (typed ? ` — "${typed}"` : "") + " — re-queued"]
  );
  return NextResponse.json({ ok: true, shots: ids.length, status: "queued" });
});
