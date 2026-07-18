"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  price_usd: string;
  size_bytes: number | null;
  created_at: string;
}

const STATUSES = ["", "rendered", "in_review", "approved", "posted", "error", "producing", "queued", "draft", "sent_back"];

export default function VideosPage() {
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [channels, setChannels] = useState<{ id: string; name: string }[]>([]);
  const [channel, setChannel] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    fetch("/api/channels").then(async (r) => r.ok && setChannels(await r.json()));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams();
    if (channel) params.set("channel", channel);
    if (status) params.set("status", status);
    fetch(`/api/videos?${params}`).then(async (r) => r.ok && setVideos(await r.json()));
  }, [channel, status]);

  const fmtSize = (b: number | null) =>
    b == null ? "—" : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.round(b / 1e3)} KB`;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <h1 style={{ margin: 0, flex: 1 }}>Videos</h1>
        <select value={channel} onChange={(e) => setChannel(e.target.value)}>
          <option value="">all channels</option>
          {channels.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s || "all statuses"}</option>
          ))}
        </select>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 14 }}>
        {videos.map((v) => (
          <Link key={v.id} href={`/videos/${v.id}`} style={{ color: "inherit", textDecoration: "none" }}>
            <div className="panel" style={{ padding: 0, overflow: "hidden" }}>
              {/* thumb served through the stream route poster; fall back to a colored block */}
              <div style={{ aspectRatio: "16/9", background: "#000" }}>
                {["rendered", "in_review", "approved", "posted"].includes(v.status) ? (
                  <video src={`/api/videos/${v.id}/stream`} preload="metadata" muted
                         style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : null}
              </div>
              <div style={{ padding: 12 }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{v.title}</div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)" }}>
                  <span className={`badge ${v.status}`}>{v.status}</span>
                  <span>{v.channel_id}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                  <span>${Number(v.price_usd).toFixed(3)}</span>
                  <span>{fmtSize(v.size_bytes)}</span>
                  <span>{new Date(v.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            </div>
          </Link>
        ))}
        {videos.length === 0 && <div style={{ color: "var(--muted)" }}>No videos.</div>}
      </div>
    </div>
  );
}
