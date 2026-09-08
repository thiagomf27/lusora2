import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import type { VisualItem } from "@lusora/contracts";
import { query } from "@/db/pool";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, videoFolder } from "@/lib/videos";
import { readPlan, writePlan } from "@/lib/editorFiles";
import { checkProbed, inspectUpload, probeVisual } from "@/lib/beatUploads";

type Ctx = { params: Promise<{ id: string; beatId: string }> };

/**
 * Hand this beat a shot of your own.
 *
 * Validated before it is written and before the plan points at it (see
 * lib/beatUploads.ts) — an upload is the one input no other stage has checked,
 * and a file the renderer cannot decode is a black shot discovered at the end
 * of a render rather than at the moment it was chosen.
 *
 * Two placement rules are load-bearing:
 *
 *  - it lands in `uploads/`, never `clips/`, because D19 retention empties
 *    `clips/` after a render — a human's own footage deleted by housekeeping,
 *    with the plan still pointing at it, is the worst version of this feature.
 *  - the item is LOCKED, because the next per-beat recompile re-resolves
 *    anything unlocked and would replace the upload with stock.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id, beatId } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (["queued", "producing"].includes(video.status)) {
    throw new ApiError(409, `cannot change assets while status is ${video.status}`);
  }

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) throw new ApiError(400, "no file");

  const buf = Buffer.from(await file.arrayBuffer());
  const check = inspectUpload(buf, file.name);
  if (check.problems.length || !check.media) {
    return NextResponse.json({ error: "file refused", problems: check.problems }, { status: 400 });
  }

  const plan = readPlan(id);
  const items = plan.tracks.visual.filter((v) => v.beat_id === beatId);
  if (items.length === 0) throw new ApiError(404, `no visual item in the plan for beat ${beatId}`);
  const hold = Math.max(...items.map((v) => v.end_s)) - Math.min(...items.map((v) => v.start_s));

  // written under a temp name first: the probe needs a real file, and a file
  // that fails it must never have existed as far as the folder is concerned
  const folder = videoFolder(id);
  mkdirSync(join(folder, "uploads"), { recursive: true });
  const name = `${beatId}-${Date.now()}${check.extension}`;
  const temp = join(folder, "uploads", `.tmp-${name}`);
  writeFileSync(temp, buf);

  const probe = probeVisual(temp);
  if (check.media === "video" && probe.width === null && probe.duration_s === null) {
    unlinkSync(temp);
    return NextResponse.json(
      {
        error: "file refused",
        problems: [
          "no video stream could be read from this file — it is not a clip the renderer can draw",
        ],
      },
      { status: 400 }
    );
  }
  const warnings = checkProbed(probe, check.media, hold, plan.resolution?.width ?? 1920);
  renameSync(temp, join(folder, "uploads", name));

  const path = `uploads/${name}`;
  const patched: VisualItem[] = plan.tracks.visual.map((v) =>
    v.beat_id === beatId
      ? {
          ...v,
          media_type: check.media!,
          locked: true,
          asset: { source: "upload", path, license: "own", provider: user.email },
          // The compiler gives every still a slow push, because a still that
          // just sits there next to moving footage reads as a mistake. Set
          // either way, never merged: replacing an image with a clip has to
          // take the move away with it, or the item keeps a pan for footage
          // that is already moving.
          motion:
            check.media === "image"
              ? { type: "ken_burns" as const, direction: "in" as const, pan: "center" as const, strength: 0.12 }
              : undefined,
        }
      : v
  );
  writePlan(id, { ...plan, tracks: { ...plan.tracks, visual: patched } });

  await query(
    "INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'editor', 'done', $2)",
    [id, `${beatId}: ${check.media} uploaded by ${user.email} (${file.name}) — item locked`]
  );
  return NextResponse.json({
    ok: true,
    path,
    media_type: check.media,
    items: items.length,
    probe,
    warnings,
  });
});
