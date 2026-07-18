"use client";
import { useEffect, useState, useCallback } from "react";

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  error_reason: string | null;
  updated_at: string;
}
interface EventRow {
  id: number;
  stage: string;
  status: string;
  message: string | null;
  ts: string;
}

export default function PipelinePage() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);

  const load = useCallback(async () => {
    const res = await fetch("/api/videos?status=queued,producing,error,rendered");
    if (res.ok) setVideos(await res.json());
  }, []);

  const loadEvents = useCallback(async (id: string) => {
    const res = await fetch(`/api/videos/${id}/events`);
    if (res.ok) setEvents(await res.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => {
      load();
      if (openId) loadEvents(openId);
    }, 2000);
    return () => clearInterval(t);
  }, [load, loadEvents, openId]);

  async function requeue(id: string) {
    await fetch(`/api/videos/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to: "queued" }),
    });
    load();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Pipeline</h1>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Title</th>
            <th>Channel</th>
            <th>Status</th>
            <th>Updated</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id}>
              <td style={{ fontFamily: "monospace", fontSize: 12 }}>{v.id}</td>
              <td>
                <a
                  style={{ cursor: "pointer" }}
                  onClick={() => {
                    setOpenId(openId === v.id ? null : v.id);
                    if (openId !== v.id) loadEvents(v.id);
                  }}
                >
                  {v.title}
                </a>
              </td>
              <td>{v.channel_id}</td>
              <td>
                <span className={`badge ${v.status}`}>{v.status}</span>
                {v.error_reason && (
                  <div style={{ color: "var(--danger)", fontSize: 12 }}>{v.error_reason}</div>
                )}
              </td>
              <td style={{ fontSize: 12, color: "var(--muted)" }}>
                {new Date(v.updated_at).toLocaleTimeString()}
              </td>
              <td>{v.status === "error" && <button onClick={() => requeue(v.id)}>Re-queue</button>}</td>
            </tr>
          ))}
          {videos.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--muted)" }}>
                Nothing in production.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {openId && (
        <div className="panel">
          <h3 style={{ marginTop: 0 }}>
            Events — <span style={{ fontFamily: "monospace" }}>{openId}</span>
          </h3>
          <table>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
                    {new Date(e.ts).toLocaleTimeString()}
                  </td>
                  <td>{e.stage}</td>
                  <td>
                    <span
                      className="badge"
                      style={{
                        color: e.status === "failed" ? "var(--danger)" : e.status === "done" ? "var(--ok)" : undefined,
                      }}
                    >
                      {e.status}
                    </span>
                  </td>
                  <td style={{ fontSize: 13 }}>{e.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
