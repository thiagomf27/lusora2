"use client";
import { useEffect, useState } from "react";

interface MonitorData {
  workers: { worker_id: string; last_seen: string; current_video_id: string | null; alive: boolean }[];
  providers: { provider: string; configured: boolean; last_success_ts: string | null; last_error_ts: string | null; last_error: string | null }[];
  costsByDay: { day: string; usd: number; ops: number }[];
  costsByProvider: { provider: string; usd: number; ops: number }[];
  storage: { videos_root: string; folders: number; bytes: number };
}

export default function MonitoringPage() {
  const [data, setData] = useState<MonitorData | null>(null);

  useEffect(() => {
    const load = () => fetch("/api/monitor").then(async (r) => r.ok && setData(await r.json()));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  if (!data) return <div className="page">Loading…</div>;
  const maxUsd = Math.max(...data.costsByDay.map((d) => d.usd), 0.0001);

  return (
    <div className="page" style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Monitoring</h1>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Workers</h3>
          {data.workers.length === 0 && <div style={{ color: "var(--muted)" }}>no heartbeats yet</div>}
          {data.workers.map((w) => (
            <div key={w.worker_id} style={{ display: "flex", gap: 10, fontSize: 14, marginBottom: 6 }}>
              <span style={{ color: w.alive ? "var(--ok)" : "var(--danger)" }}>●</span>
              <b>{w.worker_id}</b>
              <span style={{ color: "var(--muted)" }}>
                seen {new Date(w.last_seen).toLocaleTimeString()}
                {w.current_video_id ? ` · working on ${w.current_video_id}` : " · idle"}
              </span>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Storage</h3>
          <div style={{ fontSize: 14 }}>
            <div>{data.storage.videos_root}</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 6 }}>
              {(data.storage.bytes / 1e9).toFixed(2)} GB
            </div>
            <div style={{ color: "var(--muted)" }}>{data.storage.folders} video folders</div>
          </div>
        </div>
      </div>

      <div className="panel">
        <h3 style={{ marginTop: 0 }}>Provider health</h3>
        <table>
          <thead>
            <tr><th>provider</th><th>configured</th><th>last success</th><th>last error</th></tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.provider}>
                <td>{p.provider}</td>
                <td>{p.configured ? "✓" : "—"}</td>
                <td style={{ color: "var(--ok)" }}>
                  {p.last_success_ts ? new Date(p.last_success_ts).toLocaleString() : "—"}
                </td>
                <td style={{ color: "var(--danger)", maxWidth: 420, fontSize: 12 }}>
                  {p.last_error_ts ? `${new Date(p.last_error_ts).toLocaleString()} — ${p.last_error}` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>Cost per day (30d)</h3>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 120 }}>
            {data.costsByDay.map((d) => (
              <div key={d.day} title={`${d.day.slice(0, 10)}: $${d.usd.toFixed(4)} (${d.ops} ops)`}
                   style={{ flex: 1, background: "var(--accent)", opacity: 0.85,
                            height: `${Math.max((d.usd / maxUsd) * 100, 2)}%`, borderRadius: 2 }} />
            ))}
            {data.costsByDay.length === 0 && <div style={{ color: "var(--muted)" }}>no completed costs yet</div>}
          </div>
        </div>
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>By provider</h3>
          {data.costsByProvider.map((p) => (
            <div key={p.provider} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, marginBottom: 4 }}>
              <span>{p.provider}</span>
              <span>${p.usd.toFixed(4)} · {p.ops} ops</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
