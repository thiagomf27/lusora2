"use client";
/**
 * Video detail — ported from VidRush.dc.html (isVideoDetail).
 *
 * The mockup's production log, media list and export rows are mock strings;
 * here they are the real video_events, asset_usage provenance and the files
 * that exist in the video folder. Its playback scrubber is replaced by the
 * browser's own controls on the streamed final.mp4.
 *
 * Notes are not in the mockup but are kept: "send back with notes" is a real
 * transition, and the notes are what it sends back.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { Button, StatusBadge, TextInput, type Tone } from "@/components/ds";
import scr from "../../screen.module.css";
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
  updated_at: string;
  /** D62 — the gates this video's own pipeline snapshot declares, in order. */
  review_gates?: string[];
  /** D62 — the one it is stopped at, when it is stopped at all. */
  pending_gate?: string | null;
  /** The frozen snapshot this video runs on (Principle 7) — null on a draft. */
  cfg?: {
    theme?: string;
    style_pack?: string;
    language?: string;
    video_type?: string;
    checkpoint_policy?: string;
    /** D60 — the stage list this video is locked to, so progress can be
     *  counted against the run that is actually happening. */
    pipeline_doc?: { name?: string; stages?: { name: string }[] } | null;
  } | null;
}
interface EventRow { id: number; stage: string; status: string; message: string | null; ts: string }
interface NoteRow { id: number; text: string; ts: string; user_name: string }
interface AssetRow { beat_id: string; source: string; asset_id: string | null; license: string | null; provider: string | null }
interface ChannelRow { id: string; name: string; language: string; video_type: string; theme: string; style_pack: string }

/** Which transitions the review flow offers from each status. */
const STATUS_ACTIONS: Record<string, { to: string; name: string; desc: string }[]> = {
  rendered: [
    { to: "in_review", name: "Start review", desc: "Claim it for a human pass before it can be approved." },
    { to: "approved", name: "Approve", desc: "Render cleared for publishing." },
    { to: "sent_back", name: "Send back with notes", desc: "Returns it to the queue with the notes below." },
  ],
  in_review: [
    { to: "approved", name: "Approve", desc: "Render cleared for publishing." },
    { to: "sent_back", name: "Send back with notes", desc: "Returns it to the queue with the notes below." },
  ],
  approved: [
    { to: "posted", name: "Mark as posted", desc: "Published. Removed from the review queue." },
    { to: "sent_back", name: "Send back", desc: "Something slipped through — return it for another pass." },
  ],
  sent_back: [{ to: "queued", name: "Re-queue", desc: "Runs pre-flight again and re-enters production." }],
  error: [{ to: "queued", name: "Retry", desc: "Re-queue after fixing whatever failed." }],
};

function toneFor(status: string): Tone {
  if (status === "posted" || status === "approved" || status === "rendered") return "success";
  if (status === "queued" || status === "producing") return "info";
  if (status === "error") return "danger";
  if (status === "in_review" || status === "sent_back" || status === "awaiting_approval") return "warning";
  return "neutral";
}

function eventStateClass(status: string): string {
  if (status === "failed") return s.stFail;
  if (status === "done" || status === "completed") return s.stDone;
  if (status === "started" || status === "running") return s.stRun;
  return s.stMut;
}

function initials(name: string): string {
  const p = name.trim().split(/\s+/).filter(Boolean);
  if (!p.length) return "?";
  return (p.length === 1 ? p[0].slice(0, 2) : p[0][0] + p[p.length - 1][0]).toUpperCase();
}

export default function VideoPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [role, setRole] = useState("");
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [channel, setChannel] = useState<ChannelRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [noteText, setNoteText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  /** The narration, read at every load so a gate can show it (D62). */
  const [script, setScript] = useState<string | null>(null);
  const [scriptDraft, setScriptDraft] = useState<string | null>(null);
  const [savingScript, setSavingScript] = useState(false);
  /** An artifact opened for READING, in place — every stage's output is a text
   *  file, and a download is no way to look at one. */
  const [viewing, setViewing] = useState<{ name: string; body: string } | null>(null);

  const canManage = role !== "" && role !== "editor";
  // D62: editors approve review-mode gates. Reviewing the script and the beat
  // sheet IS the editing job, so gating it behind manager would make review
  // mode cost a manager per video — the API takes the same view.
  const canReview = role !== "";

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
      // A gate is exactly when you want the stage log and the artifacts, so
      // open the detail rather than making a reviewer find the toggle first.
      if (row.status === "awaiting_approval") setDetailOpen(true);
      const cs = await fetch("/api/channels").then((r) => (r.ok ? r.json() : []));
      setChannel((cs as ChannelRow[]).find((c) => c.id === row.channel_id) ?? null);
    }
    if (e.ok) setEvents(await e.json());
    if (n.ok) setNotes(await n.json());
    if (a.ok) setAssets(await a.json());
    if (me.ok) setRole((await me.json()).role ?? "");
    const sc = await fetch(`/api/videos/${id}/script`);
    // 404 until the script stage has written one; that is a state, not a failure
    const text = sc.ok ? ((await sc.json()).text as string) : null;
    setScript(text);
    setScriptDraft(null);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /**
   * A worker moves this video without telling the page, so a screen opened at
   * "queued" sat on that word until someone reloaded — through the claim, the
   * whole run, and a stop at a gate. Poll the STATUS only (one small request)
   * and do the full reload when it actually changes.
   */
  useEffect(() => {
    const status = video?.status;
    if (!status || !["queued", "producing"].includes(status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/videos/${id}`);
      if (!res.ok) return;
      const row: VideoRow = await res.json();
      if (row.status !== status || row.pending_gate !== video?.pending_gate) load();
      else setEvents(await fetch(`/api/videos/${id}/events`).then((r) => (r.ok ? r.json() : [])));
    }, 3000);
    return () => clearInterval(timer);
  }, [video?.status, video?.pending_gate, id, load]);

  async function transition(to: string) {
    setMessage(null);
    const body: Record<string, string> = { to };
    if (to === "posted") {
      const yt = window.prompt("YouTube video id (optional):");
      if (yt) body.youtube_id = yt;
    }
    const res = await fetch(`/api/videos/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err.problems?.join("; ") ?? err.error ?? `transition failed (${res.status})`);
    }
    load();
  }

  async function viewArtifact(name: string, href: string) {
    if (viewing?.name === name) return setViewing(null);
    const res = await fetch(href);
    if (!res.ok) {
      setViewing({
        name,
        body:
          res.status === 404
            ? "Not written yet — the stage that produces this file has not run."
            : `could not read this file (${res.status})`,
      });
      return;
    }
    const body = await res.text();
    // pretty-print the JSON ones: a plan on one line is not readable
    try {
      setViewing({ name, body: JSON.stringify(JSON.parse(body), null, 2) });
    } catch {
      setViewing({ name, body });
    }
  }

  /** Rewrite the narration at its gate. Refused by the route once the
   *  voiceover exists, because the audio was synthesised from these words. */
  async function saveScript() {
    if (scriptDraft === null) return;
    setSavingScript(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/videos/${id}/script`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: scriptDraft }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setMessage(err.error ?? `could not save the script (${res.status})`);
        return;
      }
      setMessage("Script saved — approve the gate when it reads right.");
      load();
    } finally {
      setSavingScript(false);
    }
  }

  /** D62 — pass the gate this video is stopped at. The stage is not sent: the
   *  server derives it the same way the worker did (first gate with no
   *  approval file), so the button cannot approve a different one than the
   *  screen is showing. */
  async function approveGate() {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err.error ?? `approval failed (${res.status})`);
    }
    load();
  }

  async function saveTitle() {
    if (!titleDraft.trim()) return setEditingTitle(false);
    const res = await fetch(`/api/videos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: titleDraft.trim() }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err.error ?? `rename failed (${res.status})`);
    }
    setEditingTitle(false);
    load();
  }

  async function deleteVideo() {
    if (!video) return;
    if (!window.confirm(`Delete “${video.title}”? This removes the video and its files permanently.`)) return;
    const res = await fetch(`/api/videos/${id}`, { method: "DELETE" });
    if (res.ok) return router.push("/videos");
    const body = await res.json().catch(() => ({}));
    setMessage(`delete failed: ${body.error}`);
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

  if (!video) return <div className={scr.loading}>Loading…</div>;

  const playable = ["rendered", "in_review", "approved", "posted"].includes(video.status);
  // The script is editable only where nothing has been built from it yet.
  const atScriptGate = video.status === "awaiting_approval" && video.pending_gate === "script";

  /** Where this run actually is: the snapshot's stage list against the log. */
  const run = (() => {
    const stages = (video.cfg?.pipeline_doc?.stages ?? []).map((x) => x.name);
    const done = new Set(events.filter((e) => e.status === "done").map((e) => e.stage));
    const started = [...events].reverse().find((e) => e.status === "started");
    return {
      total: stages.length,
      doneCount: stages.filter((n) => done.has(n)).length,
      current: started && !done.has(started.stage) ? started.stage : null,
      pipeline: video.cfg?.pipeline_doc?.name ?? "pipeline",
    };
  })();
  const reviewable = video.status === "in_review" || video.status === "sent_back" || video.status === "rendered";
  const channelName = channel?.name ?? video.channel_id;
  const actions = canManage ? STATUS_ACTIONS[video.status] ?? [] : [];

  const exports: { name: string; detail: string; href: string | null; text?: boolean }[] = [
    { name: "Video · final.mp4", detail: video.size_bytes ? `${(video.size_bytes / 1e6).toFixed(1)} MB · H.264` : "not rendered yet", href: playable ? `/api/videos/${id}/stream` : null },
    { name: "Edit plan · JSON", detail: "Beat timings, media slots and overlay tracks", href: `/api/videos/${id}/files/edit_plan.json`, text: true },
    { name: "Beat sheet · JSON", detail: "The AI's output, before it was compiled", href: `/api/videos/${id}/files/beats.json`, text: true },
    { name: "Script · text", detail: "The narration the voiceover was synthesised from", href: `/api/videos/${id}/files/script.txt`, text: true },
    { name: "Captions · SRT", detail: channel?.language ?? "video language", href: `/api/videos/${id}/files/subtitles.srt`, text: true },
    { name: "Config snapshot · JSON", detail: "The immutable cfg this render was locked to", href: `/api/videos/${id}/files/cfg.json`, text: true },
    { name: "Production log · text", detail: "What the worker did, stage by stage", href: `/api/videos/${id}/files/production.log`, text: true },
  ];

  return (
    <div className={scr.screen}>
      <div className={scr.wrap}>
        <Link href="/videos" className={scr.backLink} style={{ marginBottom: 16 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5.5 8l4.5 5" />
          </svg>
          All videos
        </Link>

        <div className={scr.head} style={{ padding: "12px 0 20px" }}>
          <div className={scr.headMain}>
            {editingTitle ? (
              <div className={s.titleRow}>
                <input
                  className={s.titleEdit}
                  value={titleDraft}
                  autoFocus
                  onChange={(e) => setTitleDraft(e.currentTarget.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTitle();
                    if (e.key === "Escape") setEditingTitle(false);
                  }}
                />
                <Button size="sm" onClick={saveTitle}>Save title</Button>
                <Button size="sm" variant="ghost" onClick={() => setEditingTitle(false)}>Cancel</Button>
              </div>
            ) : (
              <div className={s.titleRow}>
                <h1 className={s.title}>{video.title}</h1>
                <StatusBadge label={video.status} tone={toneFor(video.status)} />
              </div>
            )}
            <div className={s.subtitle}>
              {video.id} · {channelName} · created {new Date(video.created_at).toLocaleDateString()} · $
              {Number(video.price_usd ?? 0).toFixed(3)}
            </div>
          </div>
          <div className={scr.headActions}>
            {canManage && !editingTitle && (
              <Button size="sm" variant="secondary"
                      onClick={() => { setTitleDraft(video.title); setEditingTitle(true); }}>
                Edit title
              </Button>
            )}
            {reviewable && (
              <Button size="sm" variant="secondary" onClick={() => router.push(`/videos/${id}/review`)}>
                Review beats
              </Button>
            )}
            <Button size="sm" variant="secondary" onClick={() => router.push(`/editor/${id}`)}>
              Open editor
            </Button>
            {canManage && video.status !== "producing" && (
              <Button size="sm" variant="danger" onClick={deleteVideo}>Delete</Button>
            )}
          </div>
        </div>

        {message && <div className={s.message}>{message}</div>}

        <div className={s.layout}>
          <div className={s.col}>
            <div className={s.player}>
              {video.youtube_id ? (
                <iframe className={s.embed} src={`https://www.youtube.com/embed/${video.youtube_id}`} allowFullScreen />
              ) : playable ? (
                <video className={s.video} src={`/api/videos/${id}/stream`} controls />
              ) : video.status === "producing" || video.status === "queued" ? (
                <div className={s.stage}>
                  <div className={s.spinner} />
                  <div className={s.stageText}>
                    {video.status === "queued"
                      ? run.doneCount > 0
                        ? "Queued — waiting for a worker to pick it up again"
                        : "Queued — waiting for a worker to claim it"
                      : run.current
                      ? `Producing — ${run.current}`
                      : "Producing — running the pipeline"}
                  </div>
                  {/* The real position in the run: stages this video's own
                      pipeline snapshot declares, against the ones its event
                      log says are done. The bar used to be a hardcoded 57%. */}
                  {run.total > 0 && (
                    <>
                      <div className={s.progressTrack}>
                        <div
                          className={s.progressFill}
                          style={{ width: `${Math.round((run.doneCount / run.total) * 100)}%` }}
                        />
                      </div>
                      <div className={s.stageMono}>
                        {run.doneCount} of {run.total} stages · {run.pipeline}
                      </div>
                    </>
                  )}
                </div>
              ) : video.status === "awaiting_approval" ? (
                <div className={s.stage}>
                  <div className={s.stageText}>
                    Review mode — waiting for approval of <strong>{video.pending_gate ?? "a stage"}</strong>
                  </div>
                  <div className={s.stageMono}>
                    Nothing after this stage runs until it is approved, so the video is not rendered
                    yet. Edit {video.pending_gate === "plan_beats" ? "the beat sheet" : "the script"} below
                    first if it needs changes — approving re-queues the video from here.
                  </div>
                  {(video.review_gates?.length ?? 0) > 1 && (
                    <div className={s.stageMono}>
                      Gates in this pipeline: {video.review_gates!.join(" → ")}
                    </div>
                  )}
                  {canReview && (
                    <Button size="sm" onClick={approveGate}>
                      Approve {video.pending_gate ?? ""} and continue
                    </Button>
                  )}
                  {video.pending_gate === "plan_beats" && (
                    <Link href={`/videos/${id}/review`} className={s.gateLink}>
                      Open the beat sheet →
                    </Link>
                  )}
                </div>
              ) : video.status === "error" ? (
                <div className={s.stage}>
                  <div className={s.errIcon}>!</div>
                  <div className={s.errTitle}>Production failed</div>
                  {video.error_reason && <div className={s.errBox}>{video.error_reason}</div>}
                  {canManage && <Button size="sm" onClick={() => transition("queued")}>Retry — re-queue</Button>}
                </div>
              ) : (
                <div className={s.stage}>
                  <div className={s.stageText}>Not rendered yet</div>
                  <div className={s.stageMono}>This video is still a draft.</div>
                </div>
              )}
            </div>

            {script !== null && (
              <div className={scr.card}>
                <div className={s.configHead}>
                  <div style={{ flex: 1 }}>
                    <h2 className={scr.h2}>Script</h2>
                    <p className={scr.cardSub}>
                      {atScriptGate
                        ? "The narration, before a word of it has been spoken. Read it, change it if it needs changing, then approve the gate — nothing downstream has run yet."
                        : "The narration the voiceover was synthesised from. Read-only: the audio, the captions and the beats are all aligned to these words."}
                    </p>
                  </div>
                  <div className={s.scriptMeta}>
                    {(scriptDraft ?? script).trim().split(/\s+/).length} words
                  </div>
                </div>
                {atScriptGate && canReview ? (
                  <>
                    <TextInput
                      multiline
                      rows={12}
                      value={scriptDraft ?? script}
                      onChange={(e) => setScriptDraft(e.currentTarget.value)}
                    />
                    <div className={s.scriptActions}>
                      <Button
                        size="sm"
                        disabled={savingScript || scriptDraft === null || scriptDraft === script}
                        onClick={saveScript}
                      >
                        {savingScript ? "Saving…" : "Save script"}
                      </Button>
                      {scriptDraft !== null && scriptDraft !== script && (
                        <Button size="sm" variant="ghost" onClick={() => setScriptDraft(null)}>
                          Discard changes
                        </Button>
                      )}
                    </div>
                  </>
                ) : (
                  <p className={s.scriptText}>{script}</p>
                )}
              </div>
            )}

            <div className={scr.card}>
              <div className={s.configHead}>
                <div style={{ flex: 1 }}>
                  <h2 className={scr.h2}>Production config</h2>
                  <p className={scr.cardSub} style={{ marginBottom: 0 }}>
                    The settings this render was produced with. Changing them means a new render.
                  </p>
                </div>
                <button type="button" className={s.disclose} onClick={() => setDetailOpen((o) => !o)}>
                  {detailOpen ? "Hide production detail" : "Show production detail"}
                  <svg className={`${s.chev}${detailOpen ? " " + s.open : ""}`} width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="var(--text-faint)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 6l4 4 4-4" />
                  </svg>
                </button>
              </div>
              <div className={scr.tileGrid}>
                {[
                  ["Channel", channelName],
                  // The SNAPSHOT, not the channel: a video runs on what was
                  // frozen at enqueue, and a per-video override (or a later
                  // edit to the channel) makes these two different answers.
                  // Showing the channel's told you what the next video would
                  // use, never what this one did.
                  ["Video type", video.cfg?.video_type ?? channel?.video_type ?? "—"],
                  ["Theme", video.cfg?.theme ?? channel?.theme ?? "—"],
                  ["Style pack", video.cfg?.style_pack ?? channel?.style_pack ?? "—"],
                  ["Language", video.cfg?.language ?? channel?.language ?? "—"],
                  ["Assets recorded", `${assets.length}`],
                ].map(([label, value]) => (
                  <div key={label} className={scr.tile}>
                    <div className={scr.tileLabel}>{label}</div>
                    <div className={scr.tileValue}>{value}</div>
                  </div>
                ))}
              </div>
            </div>

            {detailOpen && (
              <>
                <div className={scr.card}>
                  <h2 className={scr.h2}>Production log</h2>
                  <p className={scr.cardSub}>Every stage of this render, in order.</p>
                  <div>
                    {events.map((ev) => (
                      <div key={ev.id} className={s.logRow}>
                        <span className={s.logTime}>{new Date(ev.ts).toLocaleString()}</span>
                        <span className={s.logMsg}>
                          {ev.stage}
                          {ev.message ? ` · ${ev.message}` : ""}
                        </span>
                        <span className={`${s.logState} ${eventStateClass(ev.status)}`}>{ev.status}</span>
                      </div>
                    ))}
                    {events.length === 0 && <div className={scr.toggleDesc}>No events recorded.</div>}
                  </div>
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Media used</h2>
                  <p className={scr.cardSub}>
                    {assets.length} asset{assets.length === 1 ? "" : "s"} recorded with their source and licence.
                  </p>
                  <div className={s.mediaList}>
                    {assets.map((a, i) => (
                      <div key={`${a.beat_id}-${i}`} className={s.media}>
                        <span className={s.mediaThumb} />
                        <div className={s.mediaMain}>
                          <div className={s.mediaName}>{a.asset_id ?? a.source}</div>
                          <div className={s.mediaMeta}>
                            <span>{a.provider ?? a.source}</span>
                            <span>·</span>
                            <span>{a.license ?? "licence unknown"}</span>
                            <span>·</span>
                            <span>{a.beat_id}</span>
                          </div>
                        </div>
                        <StatusBadge label={a.source} tone="neutral" />
                      </div>
                    ))}
                    {assets.length === 0 && <div className={scr.toggleDesc}>None recorded.</div>}
                  </div>
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Export</h2>
                  <p className={scr.cardSub}>
                    Files served straight out of this video&apos;s folder. A missing one means the stage that
                    writes it has not run.
                  </p>
                  <div>
                    {exports.map((x) => (
                      <div key={x.name}>
                        <div className={s.exportRow}>
                          <div className={s.exportMain}>
                            <div className={s.exportName}>{x.name}</div>
                            <div className={s.exportDetail}>{x.detail}</div>
                          </div>
                          {x.href ? (
                            <>
                              {x.text && (
                                <button
                                  type="button"
                                  className={s.exportBtn}
                                  onClick={() => viewArtifact(x.name, x.href!)}
                                >
                                  {viewing?.name === x.name ? "Hide" : "View"}
                                </button>
                              )}
                              <a className={s.exportBtn} href={x.href} target="_blank" rel="noreferrer">Open</a>
                            </>
                          ) : (
                            <span className={`${s.exportBtn} ${s.off}`}>Unavailable</span>
                          )}
                        </div>
                        {viewing?.name === x.name && (
                          <pre className={s.artifact}>{viewing.body}</pre>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            <div className={scr.card}>
              <h2 className={scr.h2}>Notes</h2>
              <p className={scr.cardSub}>What a send-back carries with it.</p>
              <div className={s.noteList}>
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
                {notes.length === 0 && <div className={scr.toggleDesc}>No notes yet.</div>}
              </div>
              <form onSubmit={addNote} className={s.noteForm}>
                <input className={s.noteInput} value={noteText} placeholder="Add a note…"
                       onChange={(e) => setNoteText(e.currentTarget.value)} />
                <Button size="sm" variant="secondary" type="submit">Post</Button>
              </form>
            </div>
          </div>

          <div className={s.col}>
            <div className={`${scr.card} ${scr.cardTight}`}>
              <div className={scr.eyebrow}>Status</div>
              <div className={scr.stackTight}>
                {actions.map((a) => (
                  <button key={a.to} type="button" className={s.statusAction} onClick={() => transition(a.to)}>
                    <span className={s.statusDot}>
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3.5 8.5l3 3 6-6" />
                      </svg>
                    </span>
                    <span>
                      <span className={s.statusName}>{a.name}</span>
                      <div className={s.statusDesc}>{a.desc}</div>
                    </span>
                  </button>
                ))}
                {actions.length === 0 && (
                  <div className={scr.toggleDesc}>
                    {canManage
                      ? `Nothing to do from “${video.status}”.`
                      : "Review actions need the Manager role — leave a note instead."}
                  </div>
                )}
              </div>
            </div>

            <div className={`${scr.card} ${scr.cardTight}`}>
              <div className={scr.eyebrow}>Details</div>
              <div className={scr.stackTight}>
                <div className={scr.kv}><span>Channel</span><span>{channelName}</span></div>
                <div className={scr.kv}><span>Language</span><span>{channel?.language ?? "—"}</span></div>
                <div className={scr.kv}><span>Status</span><span>{video.status}</span></div>
                <div className={scr.kv}>
                  <span>Size</span>
                  <span className={scr.mono}>{video.size_bytes ? `${(video.size_bytes / 1e6).toFixed(1)} MB` : "—"}</span>
                </div>
                <div className={scr.kv}>
                  <span>Cost</span>
                  <span className={scr.mono}>
                    {canManage ? `$${Number(video.price_usd ?? 0).toFixed(4)}` : "hidden for Editor"}
                  </span>
                </div>
                <div className={scr.kv}>
                  <span>Created</span>
                  <span className={scr.mono}>{new Date(video.created_at).toLocaleString()}</span>
                </div>
                <div className={scr.kv}>
                  <span>Updated</span>
                  <span className={scr.mono}>{new Date(video.updated_at).toLocaleString()}</span>
                </div>
                {video.youtube_id && (
                  <div className={scr.kv}><span>YouTube</span><span className={scr.mono}>{video.youtube_id}</span></div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
