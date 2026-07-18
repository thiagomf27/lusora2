"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  price_usd: string;
  size_bytes: number | null;
  error_reason: string | null;
  youtube_id: string | null;
  created_at: string;
}
interface EventRow { id: number; stage: string; status: string; message: string | null; ts: string }
interface NoteRow { id: number; text: string; ts: string; user_name: string }
interface AssetRow { beat_id: string; source: string; asset_id: string | null; license: string | null; provider: string | null }

const REVIEW_ACTIONS: Record<string, { to: string; label: string }[]> = {
  rendered: [
    { to: "in_review", label: "Start review" },
    { to: "approved", label: "Approve" },
    { to: "sent_back", label: "Send back" },
  ],
  in_review: [
    { to: "approved", label: "Approve" },
    { to: "sent_back", label: "Send back" },
  ],
  approved: [
    { to: "posted", label: "Mark posted" },
    { to: "sent_back", label: "Send back" },
  ],
  sent_back: [{ to: "queued", label: "Re-queue" }],
  error: [{ to: "queued", label: "Re-queue" }],
};

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [noteText, setNoteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [v, e, n, a] = await Promise.all([
      fetch(`/api/videos/${id}`),
      fetch(`/api/videos/${id}/events`),
      fetch(`/api/videos/${id}/notes`),
      fetch(`/api/videos/${id}/assets`),
    ]);
    if (v.ok) setVideo(await v.json());
    if (e.ok) setEvents(await e.json());
    if (n.ok) setNotes(await n.json());
    if (a.ok) setAssets(await a.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function transition(to: string) {
    setMessage(null);
    const body: Record<string, string> = { to };
    if (to === "posted") {
      const yt = prompt("YouTube video id (optional):");
      if (yt) body.youtube_id = yt;
    }
    const res = await fetch(`/api/videos/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json();
      setMessage(err.problems?.join("; ") ?? err.error);
    }
    load();
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!noteText.trim()) return;
    await fetch(`/api/videos/${id}/notes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: noteText }),
    });
    setNoteText("");
    load();
  }

  if (!video) return <div>Loading…</div>;
  const playable = ["rendered", "in_review", "approved", "posted"].includes(video.status);

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <h1 style={{ margin: 0, flex: 1 }}>{video.title}</h1>
        <span className={`badge ${video.status}`}>{video.status}</span>
        <a href={`/editor/${video.id}`}>Open in editor</a>
      </div>

      {video.error_reason && (
        <div className="panel" style={{ color: "var(--danger)" }}>{video.error_reason}</div>
      )}
      {message && <div className="panel" style={{ color: "var(--danger)" }}>{message}</div>}

      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 16 }}>
        <div style={{ display: "grid", gap: 16 }}>
          {video.youtube_id ? (
            <iframe
              style={{ width: "100%", aspectRatio: "16/9", border: 0, borderRadius: 10 }}
              src={`https://www.youtube.com/embed/${video.youtube_id}`}
              allowFullScreen
            />
          ) : playable ? (
            <video src={`/api/videos/${id}/stream`} controls style={{ width: "100%", borderRadius: 10, background: "#000" }} />
          ) : (
            <div className="panel" style={{ aspectRatio: "16/9", display: "grid", placeItems: "center", color: "var(--muted)" }}>
              not rendered yet
            </div>
          )}

          <div style={{ display: "flex", gap: 8 }}>
            {(REVIEW_ACTIONS[video.status] ?? []).map((a) => (
              <button key={a.to} className={a.to === "approved" ? "primary" : ""} onClick={() => transition(a.to)}>
                {a.label}
              </button>
            ))}
          </div>

          <div className="panel">
            <h3 style={{ marginTop: 0 }}>Notes</h3>
            {notes.map((n) => (
              <div key={n.id} style={{ marginBottom: 8, fontSize: 14 }}>
                <span style={{ color: "var(--muted)", fontSize: 12 }}>
                  {n.user_name} · {new Date(n.ts).toLocaleString()}
                </span>
                <div>{n.text}</div>
              </div>
            ))}
            <form onSubmit={addNote} style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input style={{ flex: 1 }} value={noteText} onChange={(e) => setNoteText(e.target.value)} placeholder="add a note…" />
              <button>Add</button>
            </form>
          </div>
        </div>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div className="panel" style={{ fontSize: 13 }}>
            <div>channel: <b>{video.channel_id}</b></div>
            <div>price: <b>${Number(video.price_usd).toFixed(4)}</b></div>
            <div>size: <b>{video.size_bytes ? `${(video.size_bytes / 1e6).toFixed(1)} MB` : "—"}</b></div>
            <div>created: {new Date(video.created_at).toLocaleString()}</div>
          </div>

          <div className="panel">
            <h4 style={{ marginTop: 0 }}>Assets used</h4>
            {assets.length === 0 && <div style={{ color: "var(--muted)", fontSize: 13 }}>none recorded</div>}
            {assets.map((a, i) => (
              <div key={i} style={{ fontSize: 12, marginBottom: 4 }}>
                <span className="badge">{a.source}</span> {a.beat_id} · {a.provider ?? "—"} · {a.license ?? "?"}
                {a.asset_id ? ` · ${a.asset_id}` : ""}
              </div>
            ))}
          </div>

          <div className="panel" style={{ maxHeight: 400, overflowY: "auto" }}>
            <h4 style={{ marginTop: 0 }}>Events</h4>
            {events.map((e) => (
              <div key={e.id} style={{ fontSize: 12, marginBottom: 4 }}>
                <span style={{ color: "var(--muted)" }}>{new Date(e.ts).toLocaleTimeString()}</span>{" "}
                {e.stage} <b style={{ color: e.status === "failed" ? "var(--danger)" : undefined }}>{e.status}</b>
                {e.message ? ` — ${e.message}` : ""}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
