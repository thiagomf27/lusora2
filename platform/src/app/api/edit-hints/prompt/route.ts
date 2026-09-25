import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { DEFAULT_WPM } from "@/lib/editHints";
import { renderEditPassPrompt, resolveStyleForConfig } from "@/lib/editPassPrompt";
import { configForVideo } from "@/lib/editPasteServer";

/**
 * The edit-pass prompt for a video on this channel, to paste into a Claude
 * chat. Body: { channel_id, overrides?, words? }. `words` is the script's word
 * count when it is known — the budgets are then printed for its estimated
 * length; without it they are per minute. Same generator as
 * `pnpm edit-pass-prompt`, so the screen and the CLI cannot disagree.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => null)) as {
    channel_id?: string;
    overrides?: Record<string, unknown>;
    words?: number;
  } | null;
  if (!body?.channel_id) throw new ApiError(400, "channel_id required");
  await requireChannelAccess(user, body.channel_id);

  const { style, problems } = resolveStyleForConfig(await configForVideo(body.channel_id, body.overrides));
  if (!style || problems.length) throw new ApiError(400, problems.join("; "));
  const words = Number(body.words) || 0;
  const durationS = words > 0 ? (words * 60) / DEFAULT_WPM : null;
  return NextResponse.json({
    prompt: renderEditPassPrompt({ style, durationS }),
    style_pack: style.name,
    components: style.overlays?.allowed_components?.length ?? null,
  });
});
