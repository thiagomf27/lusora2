"use client";
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { PlayerRef } from "@remotion/player";
import type { BeatSheet, Beat, EditPlan, Theme, VisualItem, OverlayItem } from "@lusora/contracts";
import s from "./editor.module.css";

const PlanPreview = dynamic(() => import("@/components/PlanPreview"), { ssr: false });

interface ChatMsg {
  role: "user" | "agent";
  text: string;
  proposal?: { explanation: string; beat_ops: unknown[]; plan_ops: unknown[] };
  valid?: boolean;
  problems?: string[];
}

function fmt(t: number): string {
  const m = Math.floor(t / 60);
  const sec = Math.floor(t % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [role, setRole] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [mode, setMode] = useState<"beats" | "timeline">("timeline");
  const [beats, setBeats] = useState<BeatSheet | null>(null);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [status, setStatus] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageErr, setMessageErr] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [selectedBeat, setSelectedBeat] = useState<string | null>(null);
  const [assetSearch, setAssetSearch] = useState("");
  const [issuesOpen, setIssuesOpen] = useState(false);
  const [selectedTl, setSelectedTl] = useState<{ id: string; kind: "visual" | "overlay" } | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const playerControl = useRef<PlayerRef | null>(null);
  const onTime = useCallback((sec: number) => setCurrentTime(sec), []);

  const canManage = role !== "editor";

  const load = useCallback(async () => {
    const [b, p, v, me] = await Promise.all([
      fetch(`/api/videos/${id}/beats`),
      fetch(`/api/videos/${id}/plan`),
      fetch(`/api/videos/${id}`),
      fetch("/api/auth/me"),
    ]);
    if (b.ok) setBeats(await b.json());
    if (p.ok) setPlan(await p.json());
    if (v.ok) {
      const row = await v.json();
      setStatus(row.status);
      setTitle(row.title ?? "");
      setTheme(row.cfg?.theme_doc ?? null);
    }
    if (me.ok) setRole((await me.json()).role ?? "");
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // default beat selection once beats arrive
  useEffect(() => {
    if (beats && !selectedBeat && beats.beats.length) setSelectedBeat(beats.beats[0].id);
  }, [beats, selectedBeat]);

  // poll while the worker is reprocessing
  useEffect(() => {
    if (!["queued", "producing"].includes(status)) return;
    const t = setInterval(async () => {
      const v = await fetch(`/api/videos/${id}`);
      if (v.ok) {
        const st = (await v.json()).status;
        setStatus(st);
        if (!["queued", "producing"].includes(st)) load();
      }
    }, 2500);
    return () => clearInterval(t);
  }, [status, id, load]);

  function note(text: string, err = false) {
    setMessage(text);
    setMessageErr(err);
  }

  function updateBeat(beatId: string, patch: Partial<Beat>) {
    if (!beats) return;
    setBeats({ ...beats, beats: beats.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)) });
    setDirty(true);
  }

  async function saveBeats() {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/beats`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(beats),
    });
    const body = await res.json();
    if (res.ok) {
      setDirty(false);
      setStatus("queued");
      note("saved — per-beat recompile queued");
    } else note((body.problems ?? [body.error]).join("; "), true);
  }

  async function reroll(beatId: string) {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/beats/${beatId}/reroll`, { method: "POST" });
    const body = await res.json();
    if (res.ok) {
      setStatus("queued");
      note(`re-roll queued (${body.cleared} item(s))`);
    } else note(body.error, true);
  }

  async function patchPlan(ops: unknown[]) {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/plan`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ops }),
    });
    const body = await res.json();
    if (res.ok) {
      setStatus("queued");
      note(`plan updated (${body.touched.join(", ") || "no locks"}) — re-render queued`);
      load();
    } else note((body.problems ?? [body.error]).join("; "), true);
  }

  async function sendChat(e?: React.FormEvent) {
    e?.preventDefault();
    if (!chatInput.trim()) return;
    const text = chatInput.trim();
    setChat((c) => [...c, { role: "user", text }]);
    setChatInput("");
    setChatBusy(true);
    const res = await fetch(`/api/videos/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });
    const body = await res.json();
    setChatBusy(false);
    if (res.ok) {
      setChat((c) => [
        ...c,
        { role: "agent", text: body.proposal.explanation, proposal: body.proposal, valid: body.valid, problems: body.problems },
      ]);
    } else setChat((c) => [...c, { role: "agent", text: `error: ${body.error}` }]);
  }

  async function applyProposal(msg: ChatMsg) {
    if (!msg.proposal) return;
    const res = await fetch(`/api/videos/${id}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apply: { beat_ops: msg.proposal.beat_ops, plan_ops: msg.proposal.plan_ops } }),
    });
    const body = await res.json();
    if (res.ok) {
      setStatus("queued");
      note(`applied: ${body.applied.join(", ")} — reprocessing`);
      setChat((c) => [...c, { role: "agent", text: "Applied. The video is reprocessing." }]);
      load();
    } else {
      setChat((c) => [...c, { role: "agent", text: `apply rejected: ${(body.problems ?? [body.error]).join("; ")}` }]);
    }
  }

  // derived data (hooks must run before any early return)
  const visualByBeat = useMemo(() => {
    const m = new Map<string, VisualItem>();
    plan?.tracks.visual.forEach((v) => v.beat_id && m.set(v.beat_id, v));
    return m;
  }, [plan]);

  const issues = useMemo(
    () => (plan?.tracks.visual ?? []).filter((v) => !v.asset?.path),
    [plan]
  );

  const total = useMemo(() => {
    if (!plan) return 1;
    const ends = [
      ...plan.tracks.visual.map((v) => v.end_s),
      ...plan.tracks.overlays.map((o) => o.end_s),
      ...plan.tracks.captions.items.map((c) => c.end_s),
      plan.tracks.audio.voiceover?.duration_s ?? 0,
    ];
    return Math.max(1, ...ends);
  }, [plan]);

  if (!beats || !plan) {
    return (
      <div className={s.editor}>
        <header className={s.topbar}>
          <a href={`/videos/${id}`} className={s.back}>←</a>
          <div className={s.titleText}>Editor</div>
        </header>
        <div className={s.center}>
          Editor needs beats.json and edit_plan.json — produce the video first.
          {message && <div style={{ color: "var(--danger)", marginTop: 8 }}>{message}</div>}
        </div>
      </div>
    );
  }

  const reprocessing = ["queued", "producing"].includes(status);
  const selBeat = beats.beats.find((b) => b.id === selectedBeat) ?? beats.beats[0];
  const assets = plan.tracks.visual.filter((v) => {
    if (!assetSearch.trim()) return true;
    const q = assetSearch.toLowerCase();
    return (
      (v.asset?.path ?? "").toLowerCase().includes(q) ||
      (v.asset?.source ?? "").toLowerCase().includes(q) ||
      (v.beat_id ?? "").toLowerCase().includes(q)
    );
  });
  const selItem = visualByBeat.get(selBeat?.id ?? "");
  const selTlItem: VisualItem | OverlayItem | undefined =
    selectedTl?.kind === "visual"
      ? plan.tracks.visual.find((v) => v.id === selectedTl.id)
      : selectedTl
      ? plan.tracks.overlays.find((o) => o.id === selectedTl.id)
      : undefined;

  const pct = (x: number) => `${(x / total) * 100}%`;

  return (
    <div className={s.editor}>
      {/* Top bar */}
      <header className={s.topbar}>
        <a href={`/videos/${id}`} className={s.back} title="Back to video">←</a>
        <div className={s.thumb} />
        <div className={s.titleText}>
          {title || "Editor"} <span className={s.titleMuted}>· {id}</span>
        </div>
        <div className={s.topRight}>
          <span className={`badge ${status}`}>{status}</span>
          <div className={s.seg}>
            <button className={`${s.segBtn} ${mode === "beats" ? s.segActive : ""}`} onClick={() => setMode("beats")}>Beats</button>
            <button className={`${s.segBtn} ${mode === "timeline" ? s.segActive : ""}`} onClick={() => setMode("timeline")}>Timeline</button>
          </div>
          <button className={s.saveBtn} disabled={!dirty} onClick={saveBeats}>
            {canManage ? "Save & re-queue" : "Save — sends back for re-render"}
          </button>
        </div>
      </header>

      {/* Middle */}
      <div className={s.middle}>
        {/* Assets */}
        <div className={s.assets}>
          <div className={s.panelHead}>
            <div className={s.panelLabel}>ASSETS</div>
            <div className={s.panelLabel} style={{ letterSpacing: 0 }}>{plan.tracks.visual.length}</div>
          </div>
          <input
            className={s.assetSearch}
            placeholder="filter assets…"
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
          />
          {selItem && (
            <div className={s.inspector}>
              <div className={s.inspectorTop}>
                <div className={s.inspectorName}>{selItem.asset?.path?.split("/").pop() ?? "unresolved"}</div>
                {canManage && (
                  <button className={s.rerollTag} onClick={() => selBeat && reroll(selBeat.id)}>↺ Re-roll</button>
                )}
              </div>
              <div className={s.inspectorMeta}>
                {selItem.asset?.source ?? "—"}{selItem.beat_id ? ` · beat ${selItem.beat_id}` : ""}
              </div>
              <div className={s.inspectorTimes}>
                <span>In {fmt(selItem.in_offset_s ?? 0)}</span>
                <span>Out {fmt(selItem.end_s - selItem.start_s + (selItem.in_offset_s ?? 0))}</span>
              </div>
            </div>
          )}
          <div className={s.assetScroll}>
            <div className={s.assetGrid}>
              {assets.map((v) => {
                const unresolved = !v.asset?.path;
                const isSel = v.beat_id === selBeat?.id;
                return (
                  <div key={v.id} className={s.assetCell} onClick={() => v.beat_id && setSelectedBeat(v.beat_id)}>
                    {unresolved ? (
                      <div className={s.assetUnresolved}>unresolved</div>
                    ) : (
                      <div className={`${s.assetCellThumb} ${isSel ? s.assetCellSel : ""}`}>
                        <span className={s.assetSrc} style={{ color: "var(--accent)" }}>{v.asset.source}</span>
                      </div>
                    )}
                    <div className={s.assetCellName}>{v.asset?.path?.split("/").pop() ?? v.beat_id ?? v.id}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Stage */}
        <div className={s.stage}>
          <div className={s.stageBox}>
            <div className={s.stageInner}>
              <PreviewBoundary>
                <PlanPreview videoId={id} plan={plan} theme={theme} onTime={onTime} controlRef={playerControl} />
              </PreviewBoundary>
            </div>
          </div>
          {selBeat?.script_text && <div className={s.stageCaption}>“{selBeat.script_text}”</div>}
        </div>

        {/* Agent */}
        <div className={s.agent}>
          <div className={s.agentHead}>
            <div className={s.panelLabel}>AGENT</div>
          </div>
          <div className={s.agentBody}>
            {chat.length === 0 && (
              <div className={s.lockNote}>
                e.g. “make the middle faster and add a map when he mentions the route”
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} className={`${s.msg} ${m.role === "user" ? s.msgUser : s.msgAgent}`}>
                <div className={`${s.bubble} ${m.role === "user" ? s.bubbleUser : s.bubbleAgent}`}>{m.text}</div>
                {m.proposal && (
                  <>
                    <div className={s.tools}>
                      <span className={s.toolChip}>beat_ops ×{m.proposal.beat_ops.length}</span>
                      <span className={s.toolChip}>plan_ops ×{m.proposal.plan_ops.length}</span>
                    </div>
                    {m.valid ? (
                      <button className={s.applyBtn} onClick={() => applyProposal(m)}>Apply validated ops</button>
                    ) : (
                      <div className={s.invalidNote}>invalid: {m.problems?.join("; ")}</div>
                    )}
                  </>
                )}
              </div>
            ))}
            {chatBusy && <div className={s.lockNote} style={{ borderStyle: "solid" }}>thinking…</div>}
          </div>
          <form className={s.agentFoot} onSubmit={sendChat}>
            <input
              className={s.agentInput}
              placeholder="describe an edit…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
            />
            <button className={s.agentSend} disabled={chatBusy}>➤</button>
          </form>
        </div>
      </div>

      {/* Dock */}
      <div className={s.dock}>
        <div className={s.dockToolbar}>
          <div className={s.dockTitle}>{mode === "beats" ? "BEATS" : "TIMELINE"}</div>
          <div className={s.transport}>
            <button
              className={s.playBtn}
              title="Play / pause"
              onClick={() => {
                const p = playerControl.current;
                if (!p) return;
                p.isPlaying() ? p.pause() : p.play();
              }}
            >
              ▶
            </button>
            <span className={s.transportTime}>{fmt(currentTime)} / {fmt(total)}</span>
          </div>
          {reprocessing && <div className={s.message}>reprocessing… stages resume from what changed</div>}
          {message && <div className={`${s.message} ${messageErr ? s.messageErr : ""}`}>{message}</div>}
          <div className={s.dockRight}>
            <button
              className={`${s.issuesBtn} ${issues.length === 0 ? s.issuesBtnClean : ""}`}
              onClick={() => setIssuesOpen((v) => !v)}
            >
              {issues.length === 0 ? "✓ no issues" : `⚠ ${issues.length} issue${issues.length > 1 ? "s" : ""}`}
            </button>
          </div>
        </div>

        {issuesOpen && issues.length > 0 && (
          <div className={s.issuesPanel}>
            {issues.map((v) => (
              <div
                key={v.id}
                className={s.issueRow}
                onClick={() => {
                  if (v.beat_id) setSelectedBeat(v.beat_id);
                  setMode("beats");
                  setIssuesOpen(false);
                }}
              >
                <span className={s.issueTag}>ASSET</span>
                <span className={s.issueText}>Asset unresolved{v.beat_id ? ` for beat ${v.beat_id}` : ""}</span>
                <span className={s.issueAt}>{v.beat_id ?? v.id}</span>
              </div>
            ))}
          </div>
        )}

        {mode === "beats" ? (
          <div className={s.beatsRow}>
            {beats.beats.map((b) => {
              const item = visualByBeat.get(b.id);
              const unresolved = item ? !item.asset?.path : false;
              const locked = item?.locked;
              const isSel = b.id === selBeat?.id;
              const badge = unresolved
                ? { text: "⚠ asset", color: "var(--danger)" }
                : locked
                ? { text: "🔒", color: "var(--muted)" }
                : b.overlay
                ? { text: "◫ overlay", color: "#8fb8e4" }
                : { text: b.kind, color: "var(--muted-2)" };
              return (
                <div
                  key={b.id}
                  className={`${s.beatCard} ${isSel ? s.beatCardSel : ""} ${unresolved ? s.beatCardErr : ""}`}
                  onClick={() => setSelectedBeat(b.id)}
                >
                  <div className={s.beatTop}>
                    <span className={s.beatLabel}>{b.id}</span>
                    <span className={s.beatBadge} style={{ color: badge.color }}>{badge.text}</span>
                  </div>
                  <div className={`${s.beatThumb} ${unresolved ? s.beatThumbErr : ""}`} />
                  <div className={s.beatScript}>{b.script_text || "—"}</div>
                  {!isSel && <div className={s.beatIntent}>“{b.visual_intent}”</div>}
                  {isSel && (
                    <div className={s.beatEdit} onClick={(e) => e.stopPropagation()}>
                      <div>
                        <div className={s.beatFieldLabel}>VISUAL INTENT (search query)</div>
                        <textarea
                          className={s.beatField}
                          rows={2}
                          value={b.visual_intent}
                          onChange={(e) => updateBeat(b.id, { visual_intent: e.target.value })}
                        />
                      </div>
                      <div style={{ display: "flex", gap: 5 }}>
                        <div style={{ flex: 1 }}>
                          <div className={s.beatFieldLabel}>MOOD</div>
                          <input
                            className={s.beatField}
                            value={b.mood ?? ""}
                            onChange={(e) => updateBeat(b.id, { mood: e.target.value })}
                          />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div className={s.beatFieldLabel}>MEDIA</div>
                          <select
                            className={s.beatField}
                            value={b.media_preference ?? "any"}
                            onChange={(e) => updateBeat(b.id, { media_preference: e.target.value as Beat["media_preference"] })}
                          >
                            <option value="any">any</option>
                            <option value="video">video</option>
                            <option value="image">image</option>
                          </select>
                        </div>
                      </div>
                      <div className={s.beatBtns}>
                        <button className={`${s.beatBtn} ${s.beatBtnWarn}`} onClick={() => reroll(b.id)}>
                          ↺ Re-roll{canManage ? " · ~$0.02" : ""}
                        </button>
                        {item && (
                          <button
                            className={s.beatBtn}
                            onClick={() => patchPlan([{ op: "set_lock", id: item.id, locked: !item.locked }])}
                          >
                            {item.locked ? "🔒 Unlock" : "🔓 Lock"}
                          </button>
                        )}
                      </div>
                      {unresolved && (
                        <div className={`${s.beatNote} ${s.beatNoteErr}`}>
                          Asset unresolved — re-roll or the source clip is missing.
                        </div>
                      )}
                      {locked && !unresolved && (
                        <div className={s.beatNote}>Locked — recompile keeps this item as-is (provenance).</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <>
            <div className={s.timeline}>
              <div className={s.timelineInner}>
                <div
                  className={s.ruler}
                  title="Click to move the playhead"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                    setCurrentTime(frac * total);
                    playerControl.current?.seekTo(Math.round(frac * total * plan.fps));
                  }}
                >
                  {Array.from({ length: 7 }, (_, i) => (
                    <div key={i}>{fmt((total * i) / 6)}</div>
                  ))}
                </div>

                {plan.tracks.captions.items.length > 0 && (
                  <>
                    <div className={s.trackLabel}>CAPTIONS</div>
                    <div className={s.track}>
                      {plan.tracks.captions.items.map((c, i) => (
                        <div
                          key={i}
                          className={`${s.block} ${s.blockCaption}`}
                          style={{ left: pct(c.start_s), width: pct(c.end_s - c.start_s) }}
                          title={c.text}
                        >
                          Aa {c.text}
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className={s.trackLabel}>OVERLAYS</div>
                <div className={s.track}>
                  {plan.tracks.overlays.map((o) => (
                    <div
                      key={o.id}
                      className={`${s.block} ${s.blockOverlay} ${selectedTl?.id === o.id ? s.blockSel : ""}`}
                      style={{ left: pct(o.start_s), width: pct(o.end_s - o.start_s) }}
                      onClick={() => setSelectedTl({ id: o.id, kind: "overlay" })}
                      title={o.component ?? "media"}
                    >
                      ◫ {o.component ?? "media"}
                    </div>
                  ))}
                </div>

                <div className={s.trackLabel}>B-ROLL</div>
                <div className={`${s.track} ${s.trackBroll}`}>
                  {plan.tracks.visual.map((v) => {
                    const unresolved = !v.asset?.path;
                    const name = v.asset?.path?.split("/").pop() ?? "unresolved";
                    return (
                      <div
                        key={v.id}
                        className={`${s.block} ${unresolved ? s.blockClipErr : s.blockClip} ${selectedTl?.id === v.id ? s.blockSel : ""}`}
                        style={{ left: pct(v.start_s), width: pct(v.end_s - v.start_s) }}
                        onClick={() => setSelectedTl({ id: v.id, kind: "visual" })}
                        title={v.asset?.path ?? "unresolved"}
                      >
                        {!unresolved && (
                          <video
                            className={s.blockThumb}
                            src={`/api/videos/${id}/files/${v.asset.path}#t=0.5`}
                            muted
                            preload="metadata"
                            playsInline
                          />
                        )}
                        <span className={s.blockLabel}>{v.locked ? "🔒" : "▶"} {name}</span>
                      </div>
                    );
                  })}
                </div>

                {plan.tracks.audio.voiceover && (
                  <div className={s.voiceover}>♪ Voiceover · {fmt(plan.tracks.audio.voiceover.duration_s)}</div>
                )}

                <div className={s.playhead} style={{ left: pct(Math.min(currentTime, total)) }}>
                  <span className={s.playheadTime}>{fmt(currentTime)}</span>
                </div>
              </div>
            </div>

            {selTlItem && (
              <TlEditor
                key={selTlItem.id}
                item={selTlItem}
                kind={selectedTl!.kind}
                onApply={(vals) =>
                  selectedTl!.kind === "visual"
                    ? patchPlan([{ op: "set_timing", id: selTlItem.id, ...vals }])
                    : patchPlan([{ op: "move_overlay", id: selTlItem.id, start_s: vals.start_s, end_s: vals.end_s }])
                }
                onToggleLock={() => patchPlan([{ op: "set_lock", id: selTlItem.id, locked: !selTlItem.locked }])}
                onRemove={selectedTl!.kind === "overlay" ? () => patchPlan([{ op: "remove_overlay", id: selTlItem.id }]) : undefined}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Keeps a preview failure (e.g. the Remotion version mismatch) from crashing
 *  the whole editor — beats/timeline/agent stay usable. */
class PreviewBoundary extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };
  static getDerivedStateFromError(e: unknown) {
    return { err: e instanceof Error ? e.message : String(e) };
  }
  render() {
    if (this.state.err) {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 24,
            textAlign: "center",
            background: "#05070a",
            color: "var(--muted)",
            fontSize: 12,
          }}
        >
          <div style={{ color: "var(--warn)", fontWeight: 600 }}>Live preview unavailable</div>
          <div style={{ maxWidth: 420, lineHeight: 1.5 }}>{this.state.err}</div>
          <div style={{ color: "var(--muted-2)" }}>Beats, timeline, and the agent still work.</div>
        </div>
      );
    }
    return this.props.children;
  }
}

function TlEditor({
  item,
  kind,
  onApply,
  onToggleLock,
  onRemove,
}: {
  item: VisualItem | OverlayItem;
  kind: "visual" | "overlay";
  onApply: (vals: { start_s: number; end_s: number; in_offset_s?: number }) => void;
  onToggleLock: () => void;
  onRemove?: () => void;
}) {
  const [start, setStart] = useState(String(item.start_s));
  const [end, setEnd] = useState(String(item.end_s));
  const [offset, setOffset] = useState(String((item as VisualItem).in_offset_s ?? 0));
  const changed =
    Number(start) !== item.start_s ||
    Number(end) !== item.end_s ||
    (kind === "visual" && Number(offset) !== ((item as VisualItem).in_offset_s ?? 0));
  return (
    <div className={s.tlEditor}>
      <span className={s.tlEditorLabel}>
        {item.id} {kind === "overlay" ? (item as OverlayItem).component ?? "media" : ""}
      </span>
      <div className={s.tlField}>
        <span className={s.tlFieldLabel}>START</span>
        <input className={`${s.beatField} ${s.tlInput}`} value={start} onChange={(e) => setStart(e.target.value)} />
      </div>
      <div className={s.tlField}>
        <span className={s.tlFieldLabel}>END</span>
        <input className={`${s.beatField} ${s.tlInput}`} value={end} onChange={(e) => setEnd(e.target.value)} />
      </div>
      {kind === "visual" && (
        <div className={s.tlField}>
          <span className={s.tlFieldLabel}>IN-OFFSET</span>
          <input className={`${s.beatField} ${s.tlInput}`} value={offset} onChange={(e) => setOffset(e.target.value)} />
        </div>
      )}
      <button
        className={s.beatBtn}
        disabled={!changed}
        onClick={() =>
          onApply({ start_s: Number(start), end_s: Number(end), ...(kind === "visual" ? { in_offset_s: Number(offset) } : {}) })
        }
      >
        {kind === "visual" ? "Trim" : "Move"}
      </button>
      <button className={s.beatBtn} onClick={onToggleLock}>{item.locked ? "🔒 Unlock" : "🔓 Lock"}</button>
      {onRemove && <button className={`${s.beatBtn} ${s.beatBtnWarn}`} onClick={onRemove}>Remove</button>}
    </div>
  );
}
