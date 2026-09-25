import { NextResponse } from "next/server";
import type { ChannelConfig } from "@lusora/contracts";
import { query, one } from "@/db/pool";
import { handler, requireUser, requireRole, requireChannelAccess, grantedChannelIds, ApiError } from "@/lib/auth";
import { newId } from "@/lib/ids";
import { materializeUploads, receivableForChannel, videoFolder } from "@/lib/videos";
import { checkEditPaste, logCheck, materializeEditPaste, type EditPasteCheck } from "@/lib/editPaste";
import { configForVideo, logPath, sessionId } from "@/lib/editPasteServer";

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

  // A directed-edit paste (script + block, docs/05-roadmap/directed-edit-test.md)
  // is judged BEFORE the draft row exists, so a refused paste leaves nothing
  // behind. It is judged against the merged config because that is where a
  // pinned pipeline lives — and only a pipeline running the edit_hints stage
  // may receive the block.
  const rawPaste = form.get("edit_paste");
  const editPaste = typeof rawPaste === "string" && rawPaste.trim() ? rawPaste : null;
  let directed: { check: EditPasteCheck; session: string; config: Record<string, unknown> } | null = null;
  if (editPaste) {
    const script = form.get("script");
    if (script instanceof File && script.size > 0) {
      throw new ApiError(400, "attach a script file OR paste script + edit block — not both");
    }
    const session = sessionId(form.get("paste_session"));
    const config = await configForVideo(channelId, overrides);
    const check = checkEditPaste(editPaste, config);
    if (!check.ok) {
      const problems = [...check.scriptErrors, ...check.errors];
      throw new ApiError(400, `the edit paste did not pass the check: ${problems.slice(0, 5).join("; ")}`);
    }
    const receivable = receivableForChannel(config as unknown as ChannelConfig);
    if (receivable && !["script.txt", "edit_hints.json"].every((a) => receivable.has(a))) {
      throw new ApiError(
        400,
        "this video's pipeline does not take a directed edit — pin a pipeline that runs the edit_hints stage"
      );
    }
    logCheck(logPath(), session, channelId, editPaste, check);
    directed = { check, session, config };
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
  // D62: which artifacts this channel's pipeline is willing to be handed.
  // Derived from the manifest rather than from a constant beside the route, so
  // a pipeline that adds a stage gains its upload slot with no change here.
  const channel = await one<{ config: ChannelConfig }>(
    "SELECT config FROM channels WHERE id = $1",
    [channelId]
  );
  const written = await materializeUploads(id, form, receivableForChannel(channel?.config ?? null));
  if (directed) {
    written.push(
      ...materializeEditPaste(
        videoFolder(id),
        logPath(),
        id,
        channelId,
        directed.session,
        directed.check,
        receivableForChannel(directed.config as unknown as ChannelConfig)
      )
    );
  }
  return NextResponse.json({ id, uploads: written }, { status: 201 });
});
