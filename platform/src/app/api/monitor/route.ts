import { NextResponse } from "next/server";
import { statSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { query } from "@/db/pool";
import { handler, requireUser } from "@/lib/auth";
import { videosRoot } from "@/lib/videos";

function dirSize(dir: string): number {
  let total = 0;
  if (!existsSync(dir)) return 0;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    total += st.isDirectory() ? dirSize(p) : st.size;
  }
  return total;
}

export const GET = handler(async () => {
  await requireUser();
  const workers = await query(
    `SELECT worker_id, last_seen, current_video_id,
            (now() - last_seen < interval '30 seconds') AS alive
     FROM worker_heartbeat ORDER BY worker_id`
  );
  const providers = await query(
    "SELECT provider, configured, last_success_ts, last_error_ts, last_error FROM provider_health ORDER BY provider"
  );
  const costsByDay = await query(
    `SELECT date_trunc('day', ts) AS day, sum(usd)::float AS usd, count(*)::int AS ops
     FROM cost_events WHERE status = 'completed' AND ts > now() - interval '30 days'
     GROUP BY 1 ORDER BY 1`
  );
  const costsByProvider = await query(
    `SELECT provider, sum(usd)::float AS usd, count(*)::int AS ops
     FROM cost_events WHERE status = 'completed' GROUP BY 1 ORDER BY usd DESC LIMIT 20`
  );
  const root = videosRoot();
  const folders = existsSync(root) ? readdirSync(root).length : 0;
  return NextResponse.json({
    workers,
    providers,
    costsByDay,
    costsByProvider,
    storage: { videos_root: root, folders, bytes: dirSize(root) },
  });
});
