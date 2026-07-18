import { query } from "@/db/pool";

export const dynamic = "force-dynamic";

export default async function PanelPage() {
  const counts = await query<{ status: string; n: number }>(
    "SELECT status::text, count(*)::int AS n FROM videos GROUP BY status"
  );
  const cost = await query<{ usd: number | null }>(
    `SELECT sum(usd)::float AS usd FROM cost_events
     WHERE status = 'completed' AND ts >= date_trunc('month', now())`
  );
  const failures = await query<{ id: string; title: string; error_reason: string | null }>(
    "SELECT id, title, error_reason FROM videos WHERE status = 'error' ORDER BY updated_at DESC LIMIT 10"
  );

  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c.n]));
  const order = ["draft", "queued", "producing", "rendered", "in_review", "approved", "sent_back", "posted", "error"];

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <h1 style={{ margin: 0 }}>Panel</h1>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        {order.map((s) => (
          <div key={s} className="panel" style={{ minWidth: 110, textAlign: "center" }}>
            <div style={{ fontSize: 26, fontWeight: 700 }}>{byStatus[s] ?? 0}</div>
            <span className={`badge ${s}`}>{s}</span>
          </div>
        ))}
        <div className="panel" style={{ minWidth: 140, textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700 }}>${(cost[0]?.usd ?? 0).toFixed(2)}</div>
          <span className="badge">cost this month</span>
        </div>
      </div>
      {failures.length > 0 && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Failures needing action</h3>
          <table>
            <tbody>
              {failures.map((f) => (
                <tr key={f.id}>
                  <td>
                    <a href={`/videos/${f.id}`}>{f.title}</a>
                  </td>
                  <td style={{ color: "var(--danger)" }}>{f.error_reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
