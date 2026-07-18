import { NextResponse } from "next/server";
import { query } from "@/db/pool";
import { handler, requireUser, requireChannelAccess } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

export const GET = handler(async (_req: Request, ctx: Ctx) => {
  const user = await requireUser();
  const { id } = await ctx.params;
  await requireChannelAccess(user, id);
  const byMonth = await query(
    `SELECT date_trunc('month', ts) AS month, sum(usd)::float AS usd, count(*)::int AS events
     FROM cost_events WHERE channel_id = $1 AND status = 'completed'
     GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    [id]
  );
  const byProvider = await query(
    `SELECT provider, operation, sum(usd)::float AS usd, count(*)::int AS events
     FROM cost_events WHERE channel_id = $1 AND status = 'completed'
     GROUP BY 1, 2 ORDER BY usd DESC`,
    [id]
  );
  return NextResponse.json({ byMonth, byProvider });
});
