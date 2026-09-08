import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, pendingGate, videoFolder } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

function scriptPath(id: string): string {
  return join(videoFolder(id), "script.txt");
}

/** The narration, as text — so a gate can show it rather than download it. */
export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const path = scriptPath(id);
  if (!existsSync(path)) throw new ApiError(404, "no script.txt in the video folder yet");
  return NextResponse.json({ text: readFileSync(path, "utf8") });
});

/**
 * Rewrite the narration — the editing half of D62's script gate.
 *
 * Refused once `audio.mp3` exists, and that is the whole safety rule: the
 * voiceover is synthesised FROM this text and the beats are aligned to that
 * audio, so a script edited after narration would leave every downstream
 * artifact describing words nobody says. At the gate the stage has not run
 * yet, which is exactly why the gate is placed there.
 *
 * An editor may do it: reviewing the script IS the editing job (the same
 * reasoning the approve route uses for its role check).
 */
export const PUT = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("admin", "manager", "editor");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);

  const { text } = (await req.json()) as { text?: string };
  if (typeof text !== "string" || !text.trim()) throw new ApiError(400, "text required");

  const folder = videoFolder(id);
  if (existsSync(join(folder, "audio.mp3"))) {
    throw new ApiError(
      409,
      "the voiceover has already been synthesised from this script — editing it now would " +
        "leave the audio, the captions and the beats describing words nobody says. Send the " +
        "video back and re-run narration to change the script."
    );
  }
  if (!existsSync(join(folder, "script.txt"))) {
    throw new ApiError(404, "no script.txt in the video folder yet");
  }

  writeFileSync(join(folder, "script.txt"), text.trim() + "\n");
  await query(
    "INSERT INTO video_events (video_id, stage, status, message) VALUES ($1, 'script', 'done', $2)",
    [id, `script edited at the ${pendingGate(video) ?? "script"} gate by ${user.email}`]
  );
  return NextResponse.json({ ok: true });
});
