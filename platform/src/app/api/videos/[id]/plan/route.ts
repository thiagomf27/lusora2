import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo } from "@/lib/videos";
import { readPlan, writePlan, requeueForRecompile } from "@/lib/editorFiles";
import { applyPlanOps, type PlanOp } from "@/lib/planEdit";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  return NextResponse.json(readPlan(id));
});

/** PATCH applies validated ops; manual edits set locked; re-render queued. */
export const PATCH = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  if (!["rendered", "in_review", "sent_back", "approved", "error"].includes(video.status)) {
    throw new ApiError(409, `cannot edit the plan while status is ${video.status}`);
  }
  const { ops } = (await req.json()) as { ops: PlanOp[] };
  if (!Array.isArray(ops) || ops.length === 0) throw new ApiError(400, "ops array required");

  const plan = readPlan(id);
  const result = applyPlanOps(plan, ops);
  if (!result.ok) {
    return NextResponse.json({ error: "plan ops rejected", problems: result.errors }, { status: 422 });
  }
  writePlan(id, result.plan!);
  await requeueForRecompile(
    video,
    `plan edited by ${user.email} (${result.touched.length ? "locked: " + result.touched.join(", ") : "volume only"}) — re-render queued`
  );
  return NextResponse.json({ ok: true, touched: result.touched, status: "queued" });
});
