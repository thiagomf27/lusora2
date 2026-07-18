"use client";
import { useEffect, useState } from "react";

interface ChannelRow {
  id: string;
  name: string;
  language: string;
  video_type: string;
  theme: string;
  style_pack: string;
  active: boolean;
}

const TEMPLATE = {
  channel_id: "MY_CHANNEL_01",
  name: "My Channel",
  language: "pt-BR",
  video_type: "doc",
  theme: "history-dark",
  style_pack: "doc-slow",
  component_pack: null,
  voice: { provider: "mock", voice_id: "default" },
  script: { generator: "simple", llm: "mock" },
  planner: { llm: "mock" },
  captions: { enabled: true },
  renderer: "auto",
  output: { fps: 30, width: 1920, height: 1080 },
  budget: { max_usd_per_video: 0.8 },
  retention: { clips: "on_render", final_mp4_days_after_posted: 30 },
  content_rules: "",
  source_policy: {
    visual: {
      chain: [
        {
          source: "library",
          media_types: ["video_clip", "image"],
          include_global: true,
          niches: [],
          tags: [],
          licenses: ["cc0", "cc-by", "owned"],
          min_score: 0.55,
        },
      ],
      max_clip_seconds: 12,
      orientation: "landscape",
    },
    music: { enabled: false },
    sfx: { enabled: false },
  },
};

export default function ChannelsPage() {
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [draft, setDraft] = useState(JSON.stringify(TEMPLATE, null, 2));
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/channels");
    if (res.ok) setChannels(await res.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setError(null);
    let body: unknown;
    try {
      body = JSON.parse(draft);
    } catch {
      setError("invalid JSON");
      return;
    }
    const res = await fetch(editing ? `/api/channels/${editing}/config` : "/api/channels", {
      method: editing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      setShowCreate(false);
      setEditing(null);
      load();
    } else setError((await res.json()).error ?? "failed");
  }

  async function edit(id: string) {
    const res = await fetch(`/api/channels/${id}/config`);
    if (res.ok) {
      setDraft(JSON.stringify(await res.json(), null, 2));
      setEditing(id);
      setShowCreate(true);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ margin: 0 }}>Channels</h1>
        <button
          className="primary"
          onClick={() => {
            setEditing(null);
            setDraft(JSON.stringify(TEMPLATE, null, 2));
            setShowCreate(!showCreate);
          }}
        >
          {showCreate ? "Close" : "New channel"}
        </button>
      </div>

      {showCreate && (
        <div className="panel" style={{ display: "grid", gap: 10 }}>
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            {editing ? `Editing config of ${editing}` : "Channel config document (schema-validated on save)"}
          </div>
          <textarea
            rows={20}
            style={{ fontFamily: "monospace", fontSize: 13 }}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          {error && <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>}
          <button className="primary" onClick={create} style={{ justifySelf: "start" }}>
            {editing ? "Save config" : "Create channel"}
          </button>
        </div>
      )}

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Language</th>
            <th>Type</th>
            <th>Theme</th>
            <th>Style pack</th>
            <th>Active</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {channels.map((c) => (
            <tr key={c.id}>
              <td>{c.id}</td>
              <td>{c.name}</td>
              <td>{c.language}</td>
              <td>{c.video_type}</td>
              <td>{c.theme}</td>
              <td>{c.style_pack}</td>
              <td>{c.active ? "✓" : "—"}</td>
              <td>
                <button onClick={() => edit(c.id)}>Edit config</button>
              </td>
            </tr>
          ))}
          {channels.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: "var(--muted)" }}>
                No channels yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
