import { NextResponse } from "next/server";
import { handler, requireRole, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo, approveStage, pendingGate } from "@/lib/videos";

type Ctx = { params: Promise<{ id: string }> };

/** D62 — pass one review-mode gate. Editors may approve: reviewing the script
 *  and the beat sheet is the editing job, and gating it behind manager would
 *  make review mode cost a manager per video. */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireRole("admin", "manager", "editor");
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);

  const body = await req.text();
  let stage = "";
  if (body.trim()) {
    try {
      stage = String(JSON.parse(body).stage ?? "");
    } catch {
      throw new ApiError(400, "body is not valid JSON");
    }
  }
  // No stage named = approve the one it is actually stopped at. The worker
  // stops at the FIRST unapproved gate, so that answer is never ambiguous and
  // the common call needs no body.
  if (!stage) stage = pendingGate(video) ?? "";
  if (!stage) throw new ApiError(400, "which stage? pass { \"stage\": \"<name>\" }");

  const result = await approveStage(video, stage, user.email);
  if (!result.ok) throw new ApiError(409, result.problem ?? "cannot approve");
  return NextResponse.json({ ok: true, stage, status: "queued" });
});
