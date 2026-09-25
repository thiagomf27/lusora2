import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { checkEditPaste, logCheck } from "@/lib/editPaste";
import { configForVideo, logPath, sessionId } from "@/lib/editPasteServer";

/**
 * Check a directed-edit paste (script + block) before anything is created.
 *
 * Body: { channel_id, overrides?, text, paste_session }. Every call is judged,
 * and each DISTINCT block in a session is logged once as an attempt — the
 * round-trip count the A/B needs (docs/05-roadmap/directed-edit-test.md,
 * decision 4). Costs nothing: no model is called.
 */
export const POST = handler(async (req: Request) => {
  const user = await requireUser();
  const body = (await req.json().catch(() => null)) as {
    channel_id?: string;
    overrides?: Record<string, unknown>;
    text?: string;
    paste_session?: string;
  } | null;
  if (!body?.channel_id) throw new ApiError(400, "channel_id required");
  if (typeof body.text !== "string" || !body.text.trim()) throw new ApiError(400, "text required");
  await requireChannelAccess(user, body.channel_id);
  const session = sessionId(body.paste_session);

  const config = await configForVideo(body.channel_id, body.overrides);
  const check = checkEditPaste(body.text, config);
  const attempt = logCheck(logPath(), session, body.channel_id, body.text, check);
  // the script and the parsed block stay on the server; the screen needs the verdict
  const { script: _script, hints: _hints, ...verdict } = check;
  return NextResponse.json({ ...verdict, attempt });
});
