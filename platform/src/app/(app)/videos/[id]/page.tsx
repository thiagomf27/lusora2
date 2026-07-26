"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import s from "./video.module.css";

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
interface ChannelRow { id: string; name: string; language: string }

const REVIEW_ACTIONS: Record<string, { to: string; label: string; kind: "approve" | "warn" | "neutral" }[]> = {
  rendered: [
    { to: "in_review", label: "Start review", kind: "neutral" },
    { to: "approved", label: "Approve", kind: "approve" },
    { to: "sent_back", label: "Send back with notes", kind: "warn" },
  ],
  in_review: [
    { to: "approved", label: "Approve", kind: "approve" },
    { to: "sent_back", label: "Send back with notes", kind: "warn" },
  ],
  approved: [
    { to: "posted", label: "Mark as posted", kind: "approve" },
    { to: "sent_back", label: "Send back", kind: "warn" },
  ],
  sent_back: [{ to: "queued", label: "Re-queue", kind: "approve" }],
  error: [{ to: "queued", label: "Retry — re-queue video", kind: "approve" }],
};

function statusMeta(status: string): { label: string; cls: string } {
  switch (status) {
    case "producing":
    case "queued":
      return { label: status === "queued" ? "QUEUED" : "PRODUCING", cls: s.stProducing };
    case "rendered":
      return { label: "RENDERED", cls: s.stRendered };
    case "in_review":
      return { label: "IN REVIEW", cls: s.stReview };
    case "sent_back":
      return { label: "SENT BACK", cls: s.stReview };
    case "approved":
      return { label: "APPROVED", cls: s.stApproved };
    case "posted":
      return { label: "POSTED", cls: s.stPosted };
    case "error":
      return { label: "ERROR", cls: s.stError };
    default:
      return { label: status.toUpperCase(), cls: s.stMut };
  }
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

function eventColor(status: string): string {
  if (status === "failed") return "var(--danger)";
  if (status === "done" || status === "completed") return "var(--accent)";
  if (status === "started") return "#6ea8dc";
  return "var(--muted)";
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [role, setRole] = useState<string>("");
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [noteText, setNoteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const canManage = role !== "" && role !== "editor";

  const load = useCallback(async () => {
    const [v, e, n, a, me] = await Promise.all([
      fetch(`/api/videos/${id}`),
      fetch(`/api/videos/${id}/events`),
      fetch(`/api/videos/${id}/notes`),
      fetch(`/api/videos/${id}/assets`),
      fetch("/api/auth/me"),
    ]);
    if (v.ok) {
      const row: VideoRow = await v.json();
      setVideo(row);
      fetch("/api/channels")
        .then((r) => (r.ok ? r.json() : []))
        .then((cs: ChannelRow[]) => setChannel(cs.find((c) => c.id === row.channel_id) ?? null));
    }
    if (e.ok) setEvents(await e.json());
    if (n.ok) setNotes(await n.json());
    if (a.ok) setAssets(await a.json());
    if (me.ok) setRole((await me.json()).role ?? "");
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

  async function deleteVideo() {
    if (!video) return;
    if (!confirm(`Delete “${video.title}”? This removes the video and its files permanently.`)) return;
    const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/videos");
    } else {
      const body = await res.json();
      setMessage(`delete failed: ${body.error}`);
    }
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

  if (!video) return <div style={{ padding: 32, color: "var(--muted)" }}>Loading…</div>;

  const meta = statusMeta(video.status);
  const playable = ["rendered", "in_review", "approved", "posted"].includes(video.status);
  const channelName = channel?.name ?? video.channel_id;
  const channelLang = channel?.language ?? "";
  const actions = canManage ? REVIEW_ACTIONS[video.status] ?? [] : [];
  const reviewInactiveText =
    video.status === "producing" || video.status === "queued"
      ? "Review opens when the render finishes. You can already leave notes."
      : video.status === "error"
      ? canManage
        ? "Fix the failure and retry — review resumes after a successful render."
        : "Production failed. A manager needs to retry; leave a note with anything you spotted."
      : video.status === "posted"
      ? "This video is live. Further changes require a new version through the queue."
      : video.status === "draft"
      ? "Not sent to production yet."
      : "";

  const info: { k: string; v: string; mono?: boolean; color?: string }[] = [
    { k: "Channel", v: channelLang ? `${channelName} · ${channelLang}` : channelName },
    { k: "Status", v: meta.label },
    { k: "Size", v: video.size_bytes ? `${(video.size_bytes / 1e6).toFixed(1)} MB` : "—", mono: true },
    canManage
      ? { k: "Price", v: `$${Number(video.price_usd || 0).toFixed(4)}`, mono: true }
      : { k: "Price", v: "hidden for Editor role", color: "var(--muted-2)" },
    { k: "Created", v: new Date(video.created_at).toLocaleString() },
  ];
  if (video.youtube_id) info.push({ k: "YouTube", v: video.youtube_id, mono: true });

  return (
    <>
      <header className={s.header}>
        <div className={s.headLeft}>
          <a href="/videos" className={s.back}>← Videos</a>
          <div className={s.titleRow}>
            <h1 className={s.title}>{video.title}</h1>
            <span className={`${s.statusChip} ${meta.cls}`}>{meta.label}</span>
          </div>
          <div className={s.meta}>
            {video.id} · {channelName}
            {channelLang ? ` · ${channelLang}` : ""}
            {video.size_bytes ? ` · ${(video.size_bytes / 1e6).toFixed(1)} MB` : ""}
            {canManage ? ` · $${Number(video.price_usd || 0).toFixed(2)}` : ""}
          </div>
        </div>
        <div className={s.headRight}>
          <div style={{ display: "flex", gap: 8 }}>
            <a href={`/editor/${video.id}`} className={s.openEditor}>Open in editor →</a>
            {canManage && video.status !== "producing" && (
              <button className={s.deleteBtn} onClick={deleteVideo}>Delete</button>
            )}
          </div>
        </div>
      </header>

      {message && <div className={s.message}>{message}</div>}

      <div className={s.layout}>
        {/* Left column */}
        <div className={`${s.col} ${s.colLeft}`}>
          {/* Player */}
          <section className={s.player}>
            {video.youtube_id ? (
              <iframe
                className={s.embed}
                src={`https://www.youtube.com/embed/${video.youtube_id}`}
                allowFullScreen
              />
            ) : playable ? (
              <video className={s.video} src={`/api/videos/${id}/stream`} controls />
            ) : video.status === "producing" || video.status === "queued" ? (
              <div className={s.stage}>
                <div className={s.spinner} />
                <div className={s.stageText}>
                  {video.status === "queued" ? "Queued — waiting for a worker to claim" : "Producing — assembling timeline"}
                </div>
                <div className={s.progressTrack}>
                  <div className={s.progressFill} style={{ width: video.status === "producing" ? "57%" : "12%" }} />
                </div>
              </div>
            ) : video.status === "error" ? (
              <div className={s.stage} style={{ background: "#0c0709", padding: 20, textAlign: "center" }}>
                <div className={s.errIcon}>!</div>
                <div className={s.errTitle}>Production failed</div>
                {video.error_reason && <div className={s.errBox}>{video.error_reason}</div>}
                {canManage && (
                  <button className={`${s.btn} ${s.btnApprove}`} style={{ width: "auto", padding: "8px 18px" }} onClick={() => transition("queued")}>
                    Retry — re-queue video
                  </button>
                )}
              </div>
            ) : (
              <div className={s.stage}>
                <div className={s.stageText}>Not rendered yet</div>
                <div className={s.stageMono}>Send this video to production from the queue.</div>
              </div>
            )}
          </section>

          {/* Notes */}
          <section className={s.card}>
            <div className={s.cardLabel}>NOTES</div>
            <div className={s.noteList}>
              {notes.length === 0 && <div className={s.emptyLine}>No notes yet.</div>}
              {notes.map((n) => (
                <div key={n.id} className={s.note}>
                  <div className={s.avatar}>{initials(n.user_name)}</div>
                  <div className={s.noteBody}>
                    <div className={s.noteHead}>
                      <span className={s.noteAuthor}>{n.user_name}</span> · {new Date(n.ts).toLocaleString()}
                    </div>
                    <div className={s.noteText}>{n.text}</div>
                  </div>
                </div>
              ))}
            </div>
            <form onSubmit={addNote} className={s.noteForm}>
              <input
                className={s.noteInput}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note…"
              />
              <button className={s.btnNeutral} style={{ width: "auto", padding: "9px 16px" }}>Post</button>
            </form>
          </section>

          {/* Events */}
          <section className={s.card}>
            <div className={s.cardLabel}>EVENTS</div>
            <div>
              {events.length === 0 && <div className={s.emptyLine}>No events recorded.</div>}
              {events.map((ev) => (
                <div key={ev.id} className={s.eventRow}>
                  <div className={s.eventAt}>{new Date(ev.ts).toLocaleString()}</div>
                  <div className={s.eventKind} style={{ color: eventColor(ev.status) }}>{ev.stage}</div>
                  <div className={s.eventText}>
                    <b style={{ color: eventColor(ev.status) }}>{ev.status}</b>
                    {ev.message ? ` — ${ev.message}` : ""}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Right column */}
        <div className={s.col}>
          {/* Review */}
          <section className={s.card}>
            <div className={s.cardLabel}>REVIEW</div>
            {actions.length > 0 ? (
              <div className={s.reviewCol}>
                {actions.map((a) => (
                  <button
                    key={a.to}
                    className={`${s.btn} ${a.kind === "approve" ? s.btnApprove : a.kind === "warn" ? s.btnWarn : s.btnNeutral}`}
                    onClick={() => transition(a.to)}
                  >
                    {a.label}
                  </button>
                ))}
                <div className={s.reviewHint}>Actions are logged with your notes.</div>
              </div>
            ) : (
              <div className={s.emptyLine} style={{ lineHeight: 1.5 }}>
                {canManage ? reviewInactiveText : "Review actions require the Manager role — leave a note below."}
              </div>
            )}
          </section>

          {/* Info */}
          <section className={s.card}>
            <div className={s.cardLabel}>INFO</div>
            <div className={s.infoGrid}>
              {info.map((i) => (
                <div key={i.k} style={{ display: "contents" }}>
                  <div className={s.infoKey}>{i.k}</div>
                  <div className={`${s.infoVal} ${i.mono ? s.infoMono : ""}`} style={i.color ? { color: i.color } : undefined}>
                    {i.v}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* Assets */}
          <section className={s.card}>
            <div className={s.cardLabelRow}>
              <div className={s.cardLabel} style={{ marginBottom: 0 }}>ASSETS USED</div>
              <div className="muted" style={{ fontSize: 11, color: "var(--muted-2)" }}>from plan provenance</div>
            </div>
            <div className={s.assetList}>
              {assets.length === 0 && <div className={s.emptyLine}>None recorded.</div>}
              {assets.map((a, i) => (
                <div key={i} className={s.asset}>
                  <div className={s.assetThumb} />
                  <div className={s.assetBody}>
                    <div className={s.assetName}>{a.asset_id ?? a.source}</div>
                    <div className={s.assetMeta}>
                      {a.provider ?? a.source} · {a.license ?? "?"} · {a.beat_id}
                    </div>
                  </div>
                  <span className={s.assetTag}>{a.source}</span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
