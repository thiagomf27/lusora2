"use client";
import { useEffect, useRef, useState } from "react";

interface ChannelRow {
  id: string;
  name: string;
}
interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  error_reason: string | null;
  created_at: string;
}

const UPLOAD_FIELDS = ["script", "audio", "avatar_video", "subtitles", "beats", "plan"] as const;

export default function QueuePage() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");
  const [overrides, setOverrides] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);

  async function load() {
    const [cRes, vRes] = await Promise.all([
      fetch("/api/channels"),
      fetch("/api/videos?status=draft,queued,error,sent_back"),
    ]);
    if (cRes.ok) {
      const cs = await cRes.json();
      setChannels(cs);
      if (cs.length && !channelId) setChannelId(cs[0].id);
    }
    if (vRes.ok) setVideos(await vRes.json());
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function createDraft(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const form = new FormData(formRef.current!);
    form.set("title", title);
    form.set("channel_id", channelId);
    if (overrides.trim()) form.set("overrides", overrides);
    const res = await fetch("/api/videos", { method: "POST", body: form });
    const body = await res.json();
    if (res.ok) {
      setMessage(`draft created: ${body.id}${body.uploads?.length ? ` (uploads: ${body.uploads.join(", ")})` : ""}`);
      setTitle("");
      formRef.current!.reset();
      load();
    } else setMessage(`error: ${body.error}`);
  }

  async function enqueue(id: string) {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/enqueue`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) setMessage(`pre-flight ${id}: ${(body.problems ?? [body.error]).join("; ")}`);
    load();
  }

  async function enqueueBatch() {
    if (selected.size === 0) return;
    const res = await fetch("/api/videos/enqueue-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_ids: [...selected] }),
    });
    const body = await res.json();
    const failed = Object.entries(body.results ?? {}).filter(([, r]) => !(r as { ok: boolean }).ok);
    setMessage(
      failed.length
        ? `batch: ${failed.length} failed — ` +
            failed.map(([id, r]) => `${id}: ${(r as { problems?: string[] }).problems?.join(", ")}`).join(" | ")
        : "batch: all queued"
    );
    setSelected(new Set());
    load();
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <h1 style={{ margin: 0 }}>Queue</h1>

      <form ref={formRef} onSubmit={createDraft} className="panel" style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            style={{ flex: 1 }}
            placeholder="video title / idea"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
          <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <details>
          <summary style={{ color: "var(--muted)", cursor: "pointer" }}>
            Uploads (manual-first: any provided artifact skips its stage) & overrides
          </summary>
          <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
            {UPLOAD_FIELDS.map((f) => (
              <label key={f} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13 }}>
                <span style={{ width: 110, color: "var(--muted)" }}>{f}</span>
                <input type="file" name={f} />
              </label>
            ))}
            <textarea
              placeholder='per-video overrides JSON, e.g. {"budget": {"max_usd_per_video": 2}}'
              rows={3}
              style={{ fontFamily: "monospace", fontSize: 13 }}
              value={overrides}
              onChange={(e) => setOverrides(e.target.value)}
            />
          </div>
        </details>
        <button className="primary" style={{ justifySelf: "start" }} disabled={!channelId}>
          Create draft
        </button>
      </form>

      {message && <div className="panel" style={{ fontSize: 13 }}>{message}</div>}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0 }}>Drafts & queue</h3>
        <button onClick={enqueueBatch} disabled={selected.size === 0}>
          Send {selected.size || ""} to production
        </button>
      </div>
      <table>
        <thead>
          <tr>
            <th />
            <th>ID</th>
            <th>Title</th>
            <th>Channel</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {videos.map((v) => (
            <tr key={v.id}>
              <td>
                {["draft", "error", "sent_back"].includes(v.status) && (
                  <input
                    type="checkbox"
                    checked={selected.has(v.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(v.id);
                      else next.delete(v.id);
                      setSelected(next);
                    }}
                  />
                )}
              </td>
              <td style={{ fontFamily: "monospace", fontSize: 12 }}>{v.id}</td>
              <td>{v.title}</td>
              <td>{v.channel_id}</td>
              <td>
                <span className={`badge ${v.status}`}>{v.status}</span>
                {v.error_reason && (
                  <div style={{ color: "var(--danger)", fontSize: 12 }}>{v.error_reason}</div>
                )}
              </td>
              <td>
                {["draft", "error", "sent_back"].includes(v.status) && (
                  <button onClick={() => enqueue(v.id)}>Send to production</button>
                )}
              </td>
            </tr>
          ))}
          {videos.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: "var(--muted)" }}>
                Nothing in the queue.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
