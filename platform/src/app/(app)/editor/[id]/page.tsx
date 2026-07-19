"use client";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import type { BeatSheet, Beat, EditPlan, Theme } from "@lusora/contracts";

const PlanPreview = dynamic(() => import("@/components/PlanPreview"), { ssr: false });

interface ChatMsg {
  role: "user" | "agent";
  text: string;
  proposal?: { explanation: string; beat_ops: unknown[]; plan_ops: unknown[] };
  valid?: boolean;
  problems?: string[];
}

export default function EditorPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<"beats" | "timeline" | "preview" | "chat">("beats");
  const [beats, setBeats] = useState<BeatSheet | null>(null);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [theme, setTheme] = useState<Theme | null>(null);
  const [status, setStatus] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  const load = useCallback(async () => {
    const [b, p, v] = await Promise.all([
      fetch(`/api/videos/${id}/beats`),
      fetch(`/api/videos/${id}/plan`),
      fetch(`/api/videos/${id}`),
    ]);
    if (b.ok) setBeats(await b.json());
    if (p.ok) setPlan(await p.json());
    if (v.ok) {
      const row = await v.json();
      setStatus(row.status);
      setTheme(row.cfg?.theme_doc ?? null);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // poll while the worker is reprocessing
  useEffect(() => {
    if (!["queued", "producing"].includes(status)) return;
    const t = setInterval(async () => {
      const v = await fetch(`/api/videos/${id}`);
      if (v.ok) {
        const s = (await v.json()).status;
        setStatus(s);
        if (!["queued", "producing"].includes(s)) load();
      }
    }, 2500);
    return () => clearInterval(t);
  }, [status, id, load]);

  function updateBeat(beatId: string, patch: Partial<Beat>) {
    if (!beats) return;
    setBeats({
      ...beats,
      beats: beats.beats.map((b) => (b.id === beatId ? { ...b, ...patch } : b)),
    });
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
      setMessage("saved — per-beat recompile queued");
    } else setMessage((body.problems ?? [body.error]).join("; "));
  }

  async function reroll(beatId: string) {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/beats/${beatId}/reroll`, { method: "POST" });
    const body = await res.json();
    setMessage(res.ok ? `re-roll queued (${body.cleared} item(s))` : body.error);
    if (res.ok) setStatus("queued");
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
      setMessage(`plan updated (${body.touched.join(", ") || "no locks"}) — re-render queued`);
      load();
    } else setMessage((body.problems ?? [body.error]).join("; "));
  }

  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
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
        {
          role: "agent",
          text: body.proposal.explanation,
          proposal: body.proposal,
          valid: body.valid,
          problems: body.problems,
        },
      ]);
    } else {
      setChat((c) => [...c, { role: "agent", text: `error: ${body.error}` }]);
    }
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
      setMessage(`applied: ${body.applied.join(", ")} — reprocessing`);
      setChat((c) => [...c, { role: "agent", text: "Applied. The video is reprocessing." }]);
      load();
    } else {
      setChat((c) => [...c, { role: "agent", text: `apply rejected: ${(body.problems ?? [body.error]).join("; ")}` }]);
    }
  }

  if (!beats || !plan) {
    return (
      <div className="panel">
        Editor needs beats.json and edit_plan.json — produce the video first.
        {message && <div style={{ color: "var(--danger)" }}>{message}</div>}
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <h1 style={{ margin: 0, flex: 1 }}>Editor</h1>
        <span className={`badge ${status}`}>{status}</span>
        <a href={`/videos/${id}`}>Back to video</a>
      </div>

      {["queued", "producing"].includes(status) && (
        <div className="panel" style={{ color: "var(--accent)" }}>reprocessing… stages resume from what changed</div>
      )}
      {message && <div className="panel" style={{ fontSize: 13 }}>{message}</div>}

      <div style={{ display: "flex", gap: 8 }}>
        {(["beats", "timeline", "preview", "chat"] as const).map((t) => (
          <button key={t} className={tab === t ? "primary" : ""} onClick={() => setTab(t)}>
            {t === "beats" ? "Beat panel" : t === "timeline" ? "Timeline" : t === "preview" ? "Preview" : "Chat"}
          </button>
        ))}
        {tab === "beats" && (
          <button style={{ marginLeft: "auto" }} className="primary" disabled={!dirty} onClick={saveBeats}>
            Save beats → recompile
          </button>
        )}
      </div>

      {tab === "beats" && (
        <div style={{ display: "grid", gap: 10 }}>
          {beats.beats.map((b) => (
            <div key={b.id} className="panel" style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <b>{b.id}</b>
                <span className="badge">{b.kind}</span>
                {b.overlay && <span className="badge" style={{ color: "var(--accent)" }}>{b.overlay.component}</span>}
                <span style={{ flex: 1 }} />
                <button onClick={() => reroll(b.id)}>Re-roll asset</button>
              </div>
              {b.script_text && (
                <div style={{ fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>“{b.script_text}”</div>
              )}
              <label style={{ fontSize: 12, color: "var(--muted)" }}>
                visual intent (the search query)
                <textarea
                  rows={2}
                  style={{ width: "100%", marginTop: 4 }}
                  value={b.visual_intent}
                  onChange={(e) => updateBeat(b.id, { visual_intent: e.target.value })}
                />
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <select
                  value={b.media_preference ?? "any"}
                  onChange={(e) => updateBeat(b.id, { media_preference: e.target.value as Beat["media_preference"] })}
                >
                  <option value="any">any media</option>
                  <option value="video">prefer video</option>
                  <option value="image">prefer image</option>
                </select>
                <input
                  placeholder="mood"
                  value={b.mood ?? ""}
                  onChange={(e) => updateBeat(b.id, { mood: e.target.value })}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {tab === "timeline" && (
        <div style={{ display: "grid", gap: 14 }}>
          <div className="panel">
            <h4 style={{ marginTop: 0 }}>Visual track (trims lock items; recompile skips locked)</h4>
            <table>
              <thead>
                <tr><th>item</th><th>beat</th><th>start</th><th>end</th><th>in-offset</th><th>asset</th><th /></tr>
              </thead>
              <tbody>
                {plan.tracks.visual.map((v) => (
                  <TimelineRow
                    key={v.id}
                    item={v}
                    onSave={(vals) => patchPlan([{ op: "set_timing", id: v.id, ...vals }])}
                    onToggleLock={() => patchPlan([{ op: "set_lock", id: v.id, locked: !v.locked }])}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel">
            <h4 style={{ marginTop: 0 }}>Overlays</h4>
            <table>
              <thead><tr><th>item</th><th>component</th><th>start</th><th>end</th><th /></tr></thead>
              <tbody>
                {plan.tracks.overlays.map((o) => (
                  <OverlayRow
                    key={o.id}
                    item={o}
                    onMove={(s, e) => patchPlan([{ op: "move_overlay", id: o.id, start_s: s, end_s: e }])}
                    onRemove={() => patchPlan([{ op: "remove_overlay", id: o.id }])}
                    onToggleLock={() => patchPlan([{ op: "set_lock", id: o.id, locked: !o.locked }])}
                  />
                ))}
                {plan.tracks.overlays.length === 0 && (
                  <tr><td colSpan={5} style={{ color: "var(--muted)" }}>no overlays</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "preview" && (
        <div className="panel" style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 12, color: "var(--muted)" }}>
            Live parity preview — the current edit plan rendered by the same composition the
            Remotion renderer uses. Edits show here before a re-render.
          </div>
          <PlanPreview videoId={id} plan={plan} theme={theme} />
        </div>
      )}

      {tab === "chat" && (
        <div className="panel" style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 8, maxHeight: 420, overflowY: "auto" }}>
            {chat.length === 0 && (
              <div style={{ color: "var(--muted)", fontSize: 13 }}>
                e.g. “make the middle faster and add a map when he mentions the route”
              </div>
            )}
            {chat.map((m, i) => (
              <div key={i} style={{ justifySelf: m.role === "user" ? "end" : "start", maxWidth: "85%" }}>
                <div className="panel" style={{ padding: 10, fontSize: 14 }}>
                  {m.text}
                  {m.proposal && (
                    <div style={{ marginTop: 8, fontSize: 12 }}>
                      <pre style={{ whiteSpace: "pre-wrap", color: "var(--muted)", maxHeight: 160, overflowY: "auto" }}>
                        {JSON.stringify({ beat_ops: m.proposal.beat_ops, plan_ops: m.proposal.plan_ops }, null, 1)}
                      </pre>
                      {m.valid ? (
                        <button className="primary" onClick={() => applyProposal(m)}>Apply validated ops</button>
                      ) : (
                        <div style={{ color: "var(--danger)" }}>invalid: {m.problems?.join("; ")}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chatBusy && <div style={{ color: "var(--muted)" }}>thinking…</div>}
          </div>
          <form onSubmit={sendChat} style={{ display: "flex", gap: 8 }}>
            <input style={{ flex: 1 }} value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                   placeholder="describe the change…" />
            <button className="primary" disabled={chatBusy}>Send</button>
          </form>
        </div>
      )}
    </div>
  );
}

function LockToggle({ locked, onToggle }: { locked?: boolean; onToggle: () => void }) {
  return (
    <button
      title={locked ? "Unlock — recompile may replace this item again" : "Lock — recompile keeps this item as-is"}
      style={{ padding: "2px 6px" }}
      onClick={onToggle}
    >
      {locked ? "🔒" : "🔓"}
    </button>
  );
}

function TimelineRow({
  item,
  onSave,
  onToggleLock,
}: {
  item: EditPlan["tracks"]["visual"][number];
  onSave: (vals: { start_s: number; end_s: number; in_offset_s?: number }) => void;
  onToggleLock: () => void;
}) {
  const [start, setStart] = useState(String(item.start_s));
  const [end, setEnd] = useState(String(item.end_s));
  const [offset, setOffset] = useState(String(item.in_offset_s ?? 0));
  const changed =
    Number(start) !== item.start_s || Number(end) !== item.end_s || Number(offset) !== (item.in_offset_s ?? 0);
  return (
    <tr>
      <td style={{ fontFamily: "monospace", fontSize: 12 }}>
        {item.id} <LockToggle locked={item.locked} onToggle={onToggleLock} />
      </td>
      <td>{item.beat_id ?? "manual"}</td>
      <td><input style={{ width: 70 }} value={start} onChange={(e) => setStart(e.target.value)} /></td>
      <td><input style={{ width: 70 }} value={end} onChange={(e) => setEnd(e.target.value)} /></td>
      <td><input style={{ width: 70 }} value={offset} onChange={(e) => setOffset(e.target.value)} /></td>
      <td style={{ fontSize: 12, color: "var(--muted)" }}>
        {item.asset.source}{item.asset.path ? ` · ${item.asset.path}` : " · unresolved"}
      </td>
      <td>
        <button disabled={!changed}
                onClick={() => onSave({ start_s: Number(start), end_s: Number(end), in_offset_s: Number(offset) })}>
          Trim
        </button>
      </td>
    </tr>
  );
}

function OverlayRow({
  item,
  onMove,
  onRemove,
  onToggleLock,
}: {
  item: EditPlan["tracks"]["overlays"][number];
  onMove: (s: number, e: number) => void;
  onRemove: () => void;
  onToggleLock: () => void;
}) {
  const [start, setStart] = useState(String(item.start_s));
  const [end, setEnd] = useState(String(item.end_s));
  const changed = Number(start) !== item.start_s || Number(end) !== item.end_s;
  return (
    <tr>
      <td style={{ fontFamily: "monospace", fontSize: 12 }}>{item.id} <LockToggle locked={item.locked} onToggle={onToggleLock} /></td>
      <td>{item.kind === "component" ? item.component : "media (PiP)"}</td>
      <td><input style={{ width: 70 }} value={start} onChange={(e) => setStart(e.target.value)} /></td>
      <td><input style={{ width: 70 }} value={end} onChange={(e) => setEnd(e.target.value)} /></td>
      <td style={{ display: "flex", gap: 6 }}>
        <button disabled={!changed} onClick={() => onMove(Number(start), Number(end))}>Move</button>
        <button onClick={onRemove}>Remove</button>
      </td>
    </tr>
  );
}
