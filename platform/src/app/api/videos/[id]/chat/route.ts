import { NextResponse } from "next/server";
import { handler, requireUser, requireChannelAccess, ApiError } from "@/lib/auth";
import { getVideo } from "@/lib/videos";
import { readBeats, readPlan, validateBeats, writeBeats, writePlan, requeueForRecompile } from "@/lib/editorFiles";
import { applyBeatOps, type BeatOp } from "@/lib/beatEdit";
import { applyPlanOps, type PlanOp } from "@/lib/planEdit";
import { propose } from "@/lib/chatAgent";

type Ctx = { params: Promise<{ id: string }> };

interface ChatBody {
  message?: string;
  apply?: { beat_ops: BeatOp[]; plan_ops: PlanOp[] };
}

/**
 * D15: `{message}` returns a proposal + validation result (nothing
 * applied). `{apply}` applies previously returned ops — the human is the
 * final gate.
 */
export const POST = handler(async (req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  const video = await getVideo(id);
  await requireChannelAccess(user, video.channel_id);
  const body: ChatBody = await req.json();

  const beats = readBeats(id);
  const plan = readPlan(id);

  if (body.message) {
    const proposal = await propose(
      beats,
      plan,
      body.message,
      video.cfg as Parameters<typeof propose>[3]
    );
    // dry-run validation of the proposal
    const problems: string[] = [];
    let previewBeats = beats;
    if (proposal.beat_ops.length) {
      const r = applyBeatOps(beats, proposal.beat_ops);
      if (!r.ok) problems.push(...r.errors);
      else {
        previewBeats = r.beats!;
        problems.push(...validateBeats(id, previewBeats));
      }
    }
    if (proposal.plan_ops.length) {
      const r = applyPlanOps(plan, proposal.plan_ops);
      if (!r.ok) problems.push(...r.errors);
    }
    return NextResponse.json({ proposal, valid: problems.length === 0, problems });
  }

  if (body.apply) {
    const { beat_ops = [], plan_ops = [] } = body.apply;
    if (!beat_ops.length && !plan_ops.length) throw new ApiError(400, "nothing to apply");
    const applied: string[] = [];
    if (plan_ops.length) {
      const r = applyPlanOps(plan, plan_ops);
      if (!r.ok) {
        return NextResponse.json({ error: "plan ops rejected", problems: r.errors }, { status: 422 });
      }
      writePlan(id, r.plan!);
      applied.push(`${plan_ops.length} plan op(s)`);
    }
    if (beat_ops.length) {
      const r = applyBeatOps(beats, beat_ops);
      if (!r.ok) {
        return NextResponse.json({ error: "beat ops rejected", problems: r.errors }, { status: 422 });
      }
      const problems = validateBeats(id, r.beats!);
      if (problems.length) {
        return NextResponse.json({ error: "beat sheet invalid after ops", problems }, { status: 422 });
      }
      writeBeats(id, r.beats!);
      applied.push(`${beat_ops.length} beat op(s)`);
    }
    await requeueForRecompile(video, `chat agent ops applied by ${user.email}: ${applied.join(", ")}`);
    return NextResponse.json({ ok: true, applied, status: "queued" });
  }

  throw new ApiError(400, "send {message} to propose or {apply} to apply");
});
