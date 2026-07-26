"use client";
import { useEffect, useRef, useState } from "react";
import s from "./queue.module.css";

interface ChannelRow {
  id: string;
  name: string;
  language: string;
}
interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  price_usd: string;
  error_reason: string | null;
  created_at: string;
}

/** Prominent drop slots ↔ real upload field names. The rest live under "advanced". */
const SLOTS: { field: string; label: string; hint: string }[] = [
  { field: "script", label: "Script", hint: ".md / .txt — one per video" },
  { field: "audio", label: "Voiceover audio", hint: ".wav / .mp3 — optional if channel TTS is on" },
  { field: "avatar_video", label: "Avatar video", hint: ".mp4 — required for presenter channels" },
];
const ADVANCED_FIELDS = ["subtitles", "beats", "plan"] as const;

type ChipKind = "ready" | "warn" | "blocked" | "info";
function statusMeta(status: string): { label: string; cls: string; kind: ChipKind } {
  switch (status) {
    case "draft":
      return { label: "READY", cls: s.chipOk, kind: "ready" };
    case "sent_back":
      return { label: "SENT BACK", cls: s.chipWarn, kind: "warn" };
    case "error":
      return { label: "BLOCKED", cls: s.chipErr, kind: "blocked" };
    case "queued":
      return { label: "QUEUED", cls: s.chipInfo, kind: "info" };
    case "producing":
      return { label: "PRODUCING", cls: s.chipInfo, kind: "info" };
    default:
      return { label: status.toUpperCase(), cls: s.chipMut, kind: "info" };
  }
}
/** Statuses that pre-flight + enqueue-batch will accept. */
const SENDABLE = new Set(["draft", "sent_back"]);
const ENQUEUEABLE = new Set(["draft", "sent_back", "error"]);

export default function QueuePage() {
  const [role, setRole] = useState<string>("");
  const [channels, setChannels] = useState<ChannelRow[]>([]);
  const [videos, setVideos] = useState<VideoRow[]>([]);
  const [title, setTitle] = useState("");
  const [channelId, setChannelId] = useState("");
  const [overrides, setOverrides] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const formRef = useRef<HTMLFormElement>(null);

  const canManage = role !== "" && role !== "editor";

  async function load() {
    const [meRes, cRes, vRes] = await Promise.all([
      fetch("/api/auth/me"),
      fetch("/api/channels"),
      fetch("/api/videos?status=draft,queued,producing,error,sent_back"),
    ]);
    if (meRes.ok) setRole((await meRes.json()).role ?? "");
    if (cRes.ok) {
      const cs: ChannelRow[] = await cRes.json();
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
      setOverrides("");
      setFiles({});
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

  async function deleteVideo(id: string, title: string) {
    if (!confirm(`Delete “${title}”? This removes the video and its files permanently.`)) return;
    setMessage(null);
    const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
    const body = await res.json();
    if (res.ok) {
      setExpandedId((cur) => (cur === id ? null : cur));
      setMessage(`deleted ${id}`);
    } else setMessage(`delete failed: ${body.error}`);
    load();
  }

  async function sendBatch() {
    const ids = videos.filter((v) => SENDABLE.has(v.status)).map((v) => v.id);
    if (ids.length === 0) return;
    setMessage(null);
    const res = await fetch("/api/videos/enqueue-batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video_ids: ids }),
    });
    const body = await res.json();
    const failed = Object.entries(body.results ?? {}).filter(([, r]) => !(r as { ok: boolean }).ok);
    setMessage(
      failed.length
        ? `batch: ${failed.length} failed — ` +
            failed.map(([id, r]) => `${id}: ${(r as { problems?: string[] }).problems?.join(", ")}`).join(" | ")
        : "batch: all queued"
    );
    load();
  }

  const channelName = (id: string) => channels.find((c) => c.id === id)?.name ?? id;
  const channelLang = (id: string) => channels.find((c) => c.id === id)?.language ?? "";

  const view = videos.filter((v) => filter === "all" || v.channel_id === filter);
  const ready = videos.filter((v) => v.status === "draft").length;
  const warned = videos.filter((v) => v.status === "sent_back").length;
  const blocked = videos.filter((v) => v.status === "error").length;
  const sendableCount = ready + warned;
  const sendDisabled = sendableCount === 0;
  const sendLabel = sendableCount ? `Send ${sendableCount} to production` : "Nothing to send";

  return (
    <>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Queue</h1>
          <div className={s.summary}>
            {videos.length} in queue · {ready} ready · {blocked} blocked
          </div>
        </div>
        {canManage && (
          <button
            onClick={sendBatch}
            disabled={sendDisabled}
            className={`${s.sendTop} ${sendDisabled ? s.sendDisabled : s.sendReady}`}
          >
            {sendLabel}
          </button>
        )}
      </header>

      {role === "editor" && (
        <div className={s.banner}>
          <span style={{ fontSize: 15 }}>⚠</span> Read-only — the Editor role can view the queue but can’t create
          drafts or send videos to production.
        </div>
      )}

      {canManage && (
        <form ref={formRef} onSubmit={createDraft} className={s.composer}>
          <div className={s.composerHead}>
            <div className={s.composerLabel}>ADD VIDEO</div>
            <div className={s.composerHint}>Overrides default to channel config — set per draft below</div>
          </div>
          <div className={s.composerGrid}>
            <div className={`${s.field} ${s.titleField}`}>
              <label className={s.fieldLabel}>Title</label>
              <input
                placeholder="video title / idea"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className={`${s.field} ${s.channelField}`}>
              <label className={s.fieldLabel}>Channel</label>
              <select value={channelId} onChange={(e) => setChannelId(e.target.value)}>
                {channels.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {c.language}
                  </option>
                ))}
              </select>
              <div className={s.fieldHint}>{channelLang(channelId) && `Language ${channelLang(channelId)}`}</div>
            </div>
            {SLOTS.map((u) => (
              <label key={u.field} className={s.slot}>
                <div className={s.slotLabel}>{u.label}</div>
                <div className={s.slotHint}>{u.hint}</div>
                {files[u.field] && <div className={s.slotFile}>{files[u.field]}</div>}
                <input
                  className={s.slotInput}
                  type="file"
                  name={u.field}
                  onChange={(e) =>
                    setFiles((f) => ({ ...f, [u.field]: e.target.files?.[0]?.name ?? "" }))
                  }
                />
              </label>
            ))}
            <button className={s.addBtn} disabled={!channelId}>
              Add to queue
            </button>
          </div>
          <details className={s.advanced}>
            <summary className={s.advancedSummary}>Advanced uploads & overrides</summary>
            <div className={s.advancedBody}>
              {ADVANCED_FIELDS.map((f) => (
                <label key={f} className={s.advancedRow}>
                  <span>{f}</span>
                  <input
                    type="file"
                    name={f}
                    onChange={(e) => setFiles((prev) => ({ ...prev, [f]: e.target.files?.[0]?.name ?? "" }))}
                  />
                </label>
              ))}
              <textarea
                className={s.overrides}
                placeholder='per-video overrides JSON, e.g. {"budget": {"max_usd_per_video": 2}}'
                rows={3}
                value={overrides}
                onChange={(e) => setOverrides(e.target.value)}
              />
            </div>
          </details>
        </form>
      )}

      {message && <div className={s.message}>{message}</div>}

      <div className={s.filters}>
        <button
          className={`${s.chip} ${filter === "all" ? s.active : ""}`}
          onClick={() => {
            setFilter("all");
            setExpandedId(null);
          }}
        >
          All channels · {videos.length}
        </button>
        {channels.map((c) => {
          const count = videos.filter((v) => v.channel_id === c.id).length;
          return (
            <button
              key={c.id}
              className={`${s.chip} ${filter === c.id ? s.active : ""}`}
              onClick={() => {
                setFilter(c.id);
                setExpandedId(null);
              }}
            >
              {c.name} · {count}
            </button>
          );
        })}
      </div>

      <section className={s.table}>
        <div className={s.thead}>
          <div>TITLE</div>
          <div>CHANNEL</div>
          <div>PRICE</div>
          <div>STATUS</div>
          <div />
        </div>
        {view.length === 0 && (
          <div className={s.empty}>
            <div className={s.emptyIcon}>∅</div>
            <div className={s.emptyTitle}>Nothing in the queue</div>
            <div className={s.emptyHint}>
              {canManage ? "Add a video above, or pick another channel." : "Pick another channel."}
            </div>
          </div>
        )}
        {view.map((v) => {
          const meta = statusMeta(v.status);
          const expanded = expandedId === v.id;
          return (
            <div key={v.id} className={s.rowWrap}>
              <div
                className={`${s.trow} ${expanded ? s.expanded : ""}`}
                onClick={() => setExpandedId(expanded ? null : v.id)}
              >
                <div className={s.cellTitle}>
                  <div className={s.rowTitle}>{v.title}</div>
                  <div className={s.rowId}>{v.id}</div>
                </div>
                <div className={s.rowChannel}>
                  {channelName(v.channel_id)}
                  <div className={s.rowChannelLang}>{channelLang(v.channel_id)}</div>
                </div>
                <div className={s.rowPrice}>${Number(v.price_usd || 0).toFixed(2)}</div>
                <div>
                  <span className={`${s.statusChip} ${meta.cls}`}>{meta.label}</span>
                </div>
                {canManage && v.status !== "producing" ? (
                  <button
                    className={s.removeBtn}
                    title="Delete video"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteVideo(v.id, v.title);
                    }}
                  >
                    ✕
                  </button>
                ) : (
                  <div />
                )}
              </div>
              {expanded && (
                <div className={s.detail}>
                  {v.error_reason && (
                    <div className={s.issue}>
                      <span className={s.issueTag}>{v.status.toUpperCase()}</span>
                      <span>{v.error_reason}</span>
                    </div>
                  )}
                  <div className={s.detailMeta}>
                    <div className={s.detailField}>
                      <div className={s.detailLabel}>CHANNEL</div>
                      <div className={s.detailValue}>
                        {channelName(v.channel_id)} · {channelLang(v.channel_id)}
                      </div>
                    </div>
                    <div className={s.detailField}>
                      <div className={s.detailLabel}>PRICE</div>
                      <div className={s.detailValue} style={{ fontFamily: "ui-monospace, monospace" }}>
                        ${Number(v.price_usd || 0).toFixed(4)}
                      </div>
                    </div>
                    <div className={s.detailField}>
                      <div className={s.detailLabel}>CREATED</div>
                      <div className={s.detailValue}>{new Date(v.created_at).toLocaleString()}</div>
                    </div>
                    {canManage && ENQUEUEABLE.has(v.status) && (
                      <button
                        className={s.rowSend}
                        onClick={(e) => {
                          e.stopPropagation();
                          enqueue(v.id);
                        }}
                      >
                        Send to production
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </section>

      {canManage && (
        <div className={s.sendBar}>
          <div className={s.sendCounts}>
            <span className={s.countReady}>● {ready} ready</span>
            <span className={s.countBlocked}>● {blocked} blocked</span>
            <span className={s.countWarn}>● {warned} sent back</span>
          </div>
          <div className={s.sendRight}>
            <div className={s.sendHint}>
              {blocked ? `${blocked} blocked row${blocked > 1 ? "s" : ""} will be skipped` : "All rows pass pre-flight"}
            </div>
            <button
              onClick={sendBatch}
              disabled={sendDisabled}
              className={`${s.sendBtn} ${sendDisabled ? s.sendDisabled : s.sendReady}`}
            >
              {sendLabel}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
