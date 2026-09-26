"use client";
/**
 * Beat review — ported from VidRush.dc.html (isVideoReview), both its list
 * mode and its beat-edition mode.
 *
 * The mockup approves beats one by one. A beat sheet has no per-beat approval
 * field, and inventing one would put review state somewhere the worker never
 * reads — so the progress bar counts what is actually checkable: beats whose
 * visual item resolved to a real asset (D55's fallback is exactly the case a
 * human needs to see). Approval stays where the state machine has it: the
 * video-level transitions at the bottom of the bulk bar.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type {
  BeatSheet,
  Beat,
  BeatOverlay,
  CatalogEntry,
  EditPlan,
  Theme,
  TransitionType,
} from "@lusora/contracts";
import { Button, Dropdown, StatusBadge, TextInput, type Tone } from "@/components/ds";
import BeatPlayer from "@/components/BeatPlayer";
import OverlayPicker from "@/components/OverlayPicker";
import scr from "../../../screen.module.css";
import s from "./review.module.css";

interface VideoRow {
  id: string;
  channel_id: string;
  title: string;
  status: string;
  price_usd: string;
  /** The frozen snapshot. `style_pack_doc.overlays` is this video's own
   *  overlay menu, resolved at enqueue — see lib/look.ts. */
  cfg: {
    style_pack_doc?: {
      overlays?: { allowed_components?: string[] | null; emphasis?: { enabled?: boolean } };
      transitions?: { allowed?: TransitionType[]; default?: TransitionType; duration_s?: number };
    };
    theme_doc?: Theme;
  } | null;
  /** D-render-on-demand: beats.json is newer than the compiled plan, so what
   *  is on disk is not what was rendered. Server-derived, see lib/videos.ts. */
  render_pending?: boolean;
}
interface EventRow { id: number; stage: string; status: string; message: string | null; ts: string }

const MOODS = ["neutral", "tense", "somber", "hopeful", "urgent", "triumphant", "reflective", "playful"];
const MEDIA = ["any", "video", "image"];
/** D89 — how a beat hands over to the next one. */
const TRANSITION_LABEL: Record<string, string> = {
  cut: "Cut",
  crossfade: "Crossfade",
  fade: "Fade",
  fade_to_black: "Fade to black",
  flash: "Flash",
  push: "Push",
  wipe: "Wipe",
  whip: "Whip",
  zoom_through: "Zoom through",
};
const PACK_DEFAULT = "__default__";

function toneFor(status: string): Tone {
  if (status === "posted" || status === "approved" || status === "rendered") return "success";
  if (status === "queued" || status === "producing") return "info";
  if (status === "error") return "danger";
  if (status === "in_review" || status === "sent_back") return "warning";
  return "neutral";
}

const fmtTime = (sec: number) => {
  const m = Math.floor(sec / 60);
  const s2 = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s2).padStart(2, "0")}`;
};

/** Clips are deleted by retention once the render is done (D-retention:
 *  `clips: on_render`), so a resolved beat can still have no file to show.
 *  Say that, rather than drawing an empty black box. */
function BeatPlate({
  videoId,
  path,
  mediaType,
  className,
}: {
  videoId: string;
  path: string | null | undefined;
  mediaType: string | undefined;
  className: string;
}) {
  const [gone, setGone] = useState(false);
  useEffect(() => setGone(false), [path]);
  if (!path) return <div className={className}><span className={s.plateNote}>No asset resolved</span></div>;
  if (gone) return <div className={className}><span className={s.plateNote}>Clip removed by retention</span></div>;
  const src = `/api/videos/${videoId}/files/${path}`;
  return (
    <div className={className}>
      {mediaType === "image" ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img src={src} alt="" onError={() => setGone(true)} />
      ) : (
        <video src={`${src}#t=0.5`} preload="metadata" muted onError={() => setGone(true)} />
      )}
    </div>
  );
}

export default function BeatReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [video, setVideo] = useState<VideoRow | null>(null);
  const [sheet, setSheet] = useState<BeatSheet | null>(null);
  const [plan, setPlan] = useState<EditPlan | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Beat | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  /** What the last upload said about the file it accepted, or refused. */
  const [upload, setUpload] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [message, setMessage] = useState<{ text: string; ok?: boolean } | null>(null);

  const load = useCallback(async () => {
    const [v, b, p, e, cat] = await Promise.all([
      fetch(`/api/videos/${id}`),
      fetch(`/api/videos/${id}/beats`),
      fetch(`/api/videos/${id}/plan`),
      fetch(`/api/videos/${id}/events`),
      fetch("/api/catalog"),
    ]);
    if (v.ok) setVideo(await v.json());
    setSheet(b.ok ? await b.json() : null);
    setPlan(p.ok ? await p.json() : null);
    if (e.ok) setEvents(await e.json());
    if (cat.ok) {
      // /api/catalog returns the MERGED catalog: {items: [{entry, ...}]}.
      const merged = (await cat.json()) as { items?: { entry: CatalogEntry }[] };
      setCatalog((merged.items ?? []).map((i) => i.entry));
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  /** The beats are locked while a worker owns the video, so the screen has to
   *  notice when it stops owning it — otherwise "in production" outlives the
   *  run and the only way out is a reload. */
  useEffect(() => {
    const status = video?.status;
    if (!status || !["queued", "producing"].includes(status)) return;
    const timer = setInterval(async () => {
      const res = await fetch(`/api/videos/${id}`);
      if (res.ok && ((await res.json()) as VideoRow).status !== status) load();
    }, 3000);
    return () => clearInterval(timer);
  }, [video?.status, id, load]);

  const beats = sheet?.beats ?? [];

  /** beat id -> the plan's visual item for it, if any. */
  const visualByBeat = useMemo(() => {
    const map = new Map<string, EditPlan["tracks"]["visual"][number]>();
    for (const item of plan?.tracks?.visual ?? []) {
      if (item.beat_id && !map.has(item.beat_id)) map.set(item.beat_id, item);
    }
    return map;
  }, [plan]);

  /** beat id -> the transition its LAST shot hands over with, as compiled. */
  const handoffByBeat = useMemo(() => {
    const map = new Map<string, EditPlan["tracks"]["visual"][number]["transition_out"]>();
    for (const item of plan?.tracks?.visual ?? []) {
      if (item.beat_id) map.set(item.beat_id, item.transition_out);
    }
    return map;
  }, [plan]);

  const resolved = beats.filter((b) => !!visualByBeat.get(b.id)?.asset?.path).length;
  const pct = beats.length ? Math.round((resolved / beats.length) * 100) : 0;

  /** One chip per pipeline stage that has reported, newest status wins. */
  const stages = useMemo(() => {
    const seen = new Map<string, EventRow>();
    for (const ev of events) seen.set(ev.stage, ev);
    return [...seen.values()];
  }, [events]);

  async function reroll(beatId: string) {
    setBusy(beatId);
    setMessage(null);
    try {
      const res = await fetch(`/api/videos/${id}/beats/${beatId}/reroll`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ text: body.error ?? `re-roll failed (${res.status})` });
      else setMessage({ text: `Re-roll queued — ${body.cleared} item(s) will be resolved again.`, ok: true });
      load();
    } finally {
      setBusy(null);
    }
  }

  async function saveBeat() {
    if (!sheet || !draft) return;
    setBusy("save");
    setMessage(null);
    try {
      const next: BeatSheet = {
        ...sheet,
        beats: sheet.beats.map((b) => (b.id === draft.id ? draft : b)),
      };
      const res = await fetch(`/api/videos/${id}/beats`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: (body.problems ?? [body.error ?? `save failed (${res.status})`]).join("; ") });
        return;
      }
      setMessage({
        text: "Beat saved. Nothing is rendered until you click Render.",
        ok: true,
      });
      setEditing(null);
      setDraft(null);
      load();
    } finally {
      setBusy(null);
    }
  }

  /** Hand this beat a shot of your own. Validated server-side before the plan
   *  is pointed at it, and the item is locked so a recompile keeps it. */
  async function uploadAsset(beatId: string, file: File) {
    setBusy("upload");
    setMessage(null);
    setUpload(null);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/videos/${id}/beats/${beatId}/upload`, { method: "POST", body });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUpload({ ok: false, lines: out.problems ?? [out.error ?? `upload failed (${res.status})`] });
        return;
      }
      setUpload({
        ok: true,
        lines: [
          `${file.name} is now this beat's ${out.media_type}${out.items > 1 ? ` (both of its ${out.items} shots)` : ""}, and the item is locked so a recompile keeps it.`,
          ...(out.warnings ?? []),
        ],
      });
      load();
    } finally {
      setBusy(null);
    }
  }

  /** The manual half of the save/render split: compile + re-render on demand. */
  async function startRender() {
    setBusy("render");
    setMessage(null);
    try {
      const res = await fetch(`/api/videos/${id}/render`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ text: body.error ?? `render failed (${res.status})` });
      else
        setMessage({
          text: "Queued — the worker recompiles what the edits made stale and re-renders.",
          ok: true,
        });
      load();
    } finally {
      setBusy(null);
    }
  }

  async function transition(to: string) {
    setMessage(null);
    const res = await fetch(`/api/videos/${id}/transition`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage({ text: err.problems?.join("; ") ?? err.error ?? `transition failed (${res.status})` });
    }
    load();
  }

  if (!video) return <div className={scr.loading}>Loading…</div>;
  if (!sheet) {
    return (
      <div className={scr.screen}>
        <div className={scr.wrap}>
          <Link href={`/videos/${id}`} className={scr.backLink}>← Back to the video</Link>
          <div className={scr.emptyState}>
            No beat sheet on disk yet — the planner stage has not written one for this video.
          </div>
        </div>
      </div>
    );
  }

  const idx = editing ? beats.findIndex((b) => b.id === editing) : -1;
  const goBeat = (i: number) => {
    const b = beats[i];
    if (!b) return;
    setEditing(b.id);
    setDraft(structuredClone(b));
  };

  const banner =
    video.status === "producing" || video.status === "queued"
      ? { cls: scr.noticeInfo, title: "This video is in production.", body: "Beats are locked until the run finishes." }
      : video.render_pending
      ? {
          cls: scr.noticeWarn,
          title: "Saved edits are not in the render yet.",
          body: "Click Render to compile and draw them; approving now would approve the last render.",
        }
      : resolved < beats.length
      ? { cls: scr.noticeWarn, title: "Some beats have no resolved asset.", body: "Re-roll them, or edit the intent the sourcing stage searches with." }
      : { cls: scr.noticeInfo, title: "Every beat resolved.", body: "Approve the render, or send it back with notes from the video page." };

  const locked = video.status === "producing" || video.status === "queued";

  // This video's own overlay menu, resolved into the snapshot at enqueue from
  // the style pack's allowed packs and the channel's look.exclude.components.
  // Null (an old snapshot, before that resolution) means "the whole catalog".
  const snapshotOverlays = video.cfg?.style_pack_doc?.overlays ?? {};
  // An empty list is not a menu of nothing — it is a snapshot that named none,
  // which the validator also reads as "no restriction".
  const overlayMenu = snapshotOverlays.allowed_components?.length
    ? snapshotOverlays.allowed_components
    : null;
  const emphasisEnabled = Boolean(snapshotOverlays.emphasis?.enabled);

  // The transitions this video can draw, and the one a beat gets when it names
  // none — both from the same frozen snapshot the compiler and validator read.
  const snapshotTransitions = video.cfg?.style_pack_doc?.transitions ?? {};
  const transitionMenu = snapshotTransitions.allowed ?? [];
  const transitionDefault = snapshotTransitions.default ?? "cut";

  return (
    <div className={scr.screen}>
      <div className={scr.wrap}>
        <Link href={`/videos/${id}`} className={scr.backLink} style={{ marginBottom: 16 }}>
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 3L5.5 8l4.5 5" />
          </svg>
          {editing ? "All beats" : "Back to the video"}
        </Link>

        {message && <div className={message.ok ? s.okMessage : s.message}>{message.text}</div>}

        {!editing && (
          <>
            <div className={scr.head} style={{ padding: "12px 0 0" }}>
              <div className={scr.headMain}>
                <div className={s.titleRow}>
                  <h1 className={s.title}>{video.title}</h1>
                  <StatusBadge label={video.status} tone={toneFor(video.status)} />
                  <span className={s.reviewTag}>Review mode</span>
                </div>
                <div className={s.subtitle}>
                  {beats.length} beats · {resolved} resolved · ${Number(video.price_usd ?? 0).toFixed(3)} so far
                </div>
              </div>
              <div className={scr.headActions}>
                <Button size="sm" variant="ghost" onClick={() => router.push(`/videos/${id}`)}>
                  Production detail
                </Button>
              </div>
            </div>

            <div className={s.stages}>
              {stages.map((st) => (
                <div key={st.stage} className={`${s.stage} ${st.status === "failed" ? s.failed : st.status === "started" ? s.running : s.done}`}>
                  <span className={s.stageMark}>
                    {st.status === "failed" ? "!" : st.status === "started" ? "●" : "✓"}
                  </span>
                  <span>
                    <span className={s.stageName}>{st.stage}</span>
                    <div className={s.stageNote}>{st.status}</div>
                  </span>
                </div>
              ))}
              {stages.length === 0 && <div className={scr.toggleDesc}>No stage has reported yet.</div>}
            </div>

            <div className={`${scr.notice} ${banner.cls}`} style={{ marginBottom: 20 }}>
              <span><strong>{banner.title}</strong> {banner.body}</span>
            </div>

            <div className={s.bulk}>
              <div className={s.bulkMain}>
                <div className={s.bulkLabel}>{resolved} of {beats.length} beats have a resolved asset</div>
                <div className={s.bar}>
                  <div className={`${s.barFill}${pct === 100 ? " " + s.full : ""}`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className={s.bulkActions}>
                <Button
                  size="sm"
                  variant={video.render_pending ? "primary" : "secondary"}
                  disabled={locked || busy === "render"}
                  onClick={startRender}
                >
                  {busy === "render" ? "Queueing…" : "Render"}
                </Button>
                <Button size="sm" variant="secondary" disabled={locked} onClick={() => transition("sent_back")}>
                  Send back
                </Button>
                <Button size="sm" disabled={locked || pct < 100} onClick={() => transition("approved")}>
                  Approve render
                </Button>
              </div>
            </div>

            <div className={s.beats}>
              {beats.map((b) => {
                const item = visualByBeat.get(b.id);
                const asset = item?.asset;
                const hasAsset = !!asset?.path;
                return (
                  <div key={b.id} className={`${s.beat}${hasAsset ? "" : " " + s.unresolved}`}>
                    <div className={s.beatLeft}>
                      <BeatPlate videoId={id} path={hasAsset ? asset!.path : null}
                                 mediaType={item?.media_type} className={s.plate} />
                      {item && (
                        <div className={s.beatTime}>
                          {fmtTime(item.start_s)} – {fmtTime(item.end_s)}
                        </div>
                      )}
                      <div className={s.beatSource}>
                        {asset ? `${asset.source}${asset.provider ? ` · ${asset.provider}` : ""}` : "unsourced"}
                      </div>
                    </div>

                    <div className={s.beatMain}>
                      <div className={s.beatHead}>
                        <div className={s.beatLabel}>{b.id}</div>
                        <StatusBadge
                          label={hasAsset ? "Resolved" : "Needs attention"}
                          tone={hasAsset ? "success" : "warning"}
                        />
                      </div>
                      <p className={s.beatText}>{b.script_text ?? b.visual_intent}</p>
                      <div className={s.beatGrid}>
                        <div className={s.beatCell}>
                          <div className={s.beatCellLabel}>Visual intent</div>
                          <div className={s.beatCellValue}>{b.visual_intent}</div>
                        </div>
                        <div className={s.beatCell}>
                          <div className={s.beatCellLabel}>Overlay</div>
                          <div className={s.beatCellValue}>{b.overlay?.component ?? "None"}</div>
                        </div>
                        <div className={s.beatCell}>
                          <div className={s.beatCellLabel}>Mood</div>
                          <div className={s.beatCellValue}>{b.mood ?? "neutral"}</div>
                        </div>
                        <div className={s.beatCell}>
                          <div className={s.beatCellLabel}>Media</div>
                          <div className={s.beatCellValue}>{b.media_preference ?? "any"}</div>
                        </div>
                        <div className={s.beatCell}>
                          <div className={s.beatCellLabel}>Hands over</div>
                          <div className={s.beatCellValue}>
                            {(() => {
                              // D95: a beat naming none shows what the compiler placed, if it did
                              const placed = b.transition_out ? undefined : handoffByBeat.get(b.id);
                              const kind = b.transition_out ?? (placed?.placed_by ? placed.type : transitionDefault);
                              const tag = b.transition_out ? "" : placed?.placed_by ? " (auto)" : " (pack)";
                              return `${TRANSITION_LABEL[kind] ?? kind}${tag}`;
                            })()}
                          </div>
                        </div>
                        <div className={s.beatCell}>
                          <div className={s.beatCellLabel}>Licence</div>
                          <div className={s.beatCellValue}>{asset?.license ?? "—"}</div>
                        </div>
                      </div>
                      <div className={s.beatActions}>
                        <Button size="sm" variant="secondary" disabled={locked || busy === b.id}
                                onClick={() => reroll(b.id)}>
                          {busy === b.id ? "Re-rolling…" : "Re-roll asset"}
                        </Button>
                        <Button size="sm" variant="ghost" disabled={locked}
                                onClick={() => { setEditing(b.id); setDraft(structuredClone(b)); }}>
                          Edit beat
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {beats.length === 0 && <div className={scr.emptyState}>The beat sheet is empty.</div>}
            </div>
          </>
        )}

        {editing && draft && (
          <>
            <div className={s.editHead}>
              <div className={s.editMain}>
                <div className={s.titleRow}>
                  <h1 className={s.title} style={{ fontSize: 20 }}>{draft.id}</h1>
                  <StatusBadge
                    label={visualByBeat.get(draft.id)?.asset?.path ? "Resolved" : "Needs attention"}
                    tone={visualByBeat.get(draft.id)?.asset?.path ? "success" : "warning"}
                  />
                </div>
                <div className={s.editMeta}>
                  beat {idx + 1} of {beats.length} · {draft.kind}
                </div>
              </div>
              <div className={scr.headActions}>
                <Button size="sm" variant="ghost" disabled={idx <= 0} onClick={() => goBeat(idx - 1)}>Previous</Button>
                <Button size="sm" variant="ghost" disabled={idx >= beats.length - 1} onClick={() => goBeat(idx + 1)}>Next</Button>
                <Button size="sm" variant="secondary" disabled={busy === draft.id} onClick={() => reroll(draft.id)}>
                  {busy === draft.id ? "Re-rolling…" : "Re-roll asset"}
                </Button>
                <Button size="sm" disabled={busy === "save"} onClick={saveBeat}>
                  {busy === "save" ? "Saving…" : "Save beat"}
                </Button>
                <Button
                  size="sm"
                  variant={video.render_pending ? "primary" : "secondary"}
                  disabled={locked || busy === "render"}
                  onClick={startRender}
                  title="Compile and re-render what is saved on disk"
                >
                  {busy === "render" ? "Queueing…" : "Render"}
                </Button>
              </div>
            </div>

            <div className={s.editLayout}>
              <div className={scr.stack}>
                <div className={scr.card}>
                  <h2 className={scr.h2}>Player</h2>
                  <p className={scr.cardSub}>
                    The beat as the renderer will draw it — the same composition the render runs,
                    over the real plan, playing this beat&apos;s own span. An overlay you have just
                    picked is placed here before the compile places it.
                  </p>
                  <BeatPlayer
                    videoId={id}
                    beat={draft}
                    plan={plan}
                    entry={catalog.find((c) => c.name === draft.overlay?.component) ?? null}
                    theme={video.cfg?.theme_doc ?? null}
                    transitions={snapshotTransitions}
                  />
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Notes</h2>
                  <p className={scr.cardSub}>Free text carried on the beat, for whoever picks it up next.</p>
                  <TextInput
                    multiline
                    rows={4}
                    value={draft.notes ?? ""}
                    onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => (d ? { ...d, notes: v || null } : d)); }}
                  />
                </div>
              </div>

              <div className={`${scr.stack} ${s.editSide}`}>
                <div className={`${scr.card} ${s.narration}`}>
                  <div className={s.narrationHead}>
                    <span className={scr.eyebrow} style={{ marginBottom: 0 }}>Narration</span>
                    <span className={s.narrationNote}>read-only</span>
                  </div>
                  <p className={s.narrationText}>
                    {draft.script_text ?? "(timed beat — no narration)"}
                  </p>
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Sourcing</h2>
                  <p className={scr.cardSub}>What the resolve_assets stage searches with when this beat is re-rolled.</p>
                  <div className={scr.stack}>
                    <TextInput
                      label="Visual intent"
                      multiline
                      rows={3}
                      value={draft.visual_intent}
                      onChange={(e) => { const v = e.currentTarget.value; setDraft((d) => (d ? { ...d, visual_intent: v } : d)); }}
                    />
                    <TextInput
                      label="Keyword queries (comma separated)"
                      value={(draft.queries ?? []).join(", ")}
                      onChange={(e) => {
                        const v = e.currentTarget.value.split(",").map((x) => x.trim()).filter(Boolean);
                        setDraft((d) => (d ? { ...d, queries: v.length ? v : undefined } : d));
                      }}
                    />
                    <div className={scr.grid2}>
                      <Dropdown label="Mood" options={MOODS} value={draft.mood ?? "neutral"}
                                onChange={(v) => setDraft((d) => (d ? { ...d, mood: v } : d))} />
                      <Dropdown label="Media preference" options={MEDIA} value={draft.media_preference ?? "any"}
                                onChange={(v) => setDraft((d) => (d ? { ...d, media_preference: v as Beat["media_preference"] } : d))} />
                    </div>

                    <div className={s.upload}>
                      <div className={s.uploadHead}>
                        <div>
                          <div className={s.uploadTitle}>Or hand it a shot of your own</div>
                          <div className={s.uploadNote}>
                            {(() => {
                              const asset = visualByBeat.get(draft.id)?.asset;
                              return asset?.source === "upload"
                                ? `Using your upload — ${asset.path.split("/").pop()}. Re-rolling replaces it.`
                                : "Checked before it is accepted, and the item is locked afterwards so a recompile keeps it. JPG, PNG, WEBP, MP4, MOV or WEBM.";
                            })()}
                          </div>
                        </div>
                        <label className={`${s.uploadBtn}${locked || busy === "upload" ? " " + s.uploadOff : ""}`}>
                          {busy === "upload" ? "Checking…" : "Choose file"}
                          <input
                            type="file"
                            accept=".jpg,.jpeg,.png,.webp,.mp4,.mov,.webm"
                            disabled={locked || busy === "upload"}
                            onChange={(e) => {
                              const file = e.currentTarget.files?.[0];
                              e.currentTarget.value = "";
                              if (file) uploadAsset(draft.id, file);
                            }}
                          />
                        </label>
                      </div>
                      {upload && (
                        <ul className={upload.ok ? s.uploadOk : s.uploadBad}>
                          {upload.lines.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Overlay</h2>
                  <p className={scr.cardSub}>
                    {overlayMenu
                      ? `The ${overlayMenu.length} components this video's style pack allows. Pick one to fill in its props.`
                      : "This video's snapshot names no component menu, so the whole catalog is on offer."}
                  </p>
                  <OverlayPicker
                    beat={draft}
                    catalog={catalog}
                    allowed={overlayMenu}
                    emphasisEnabled={emphasisEnabled}
                    disabled={locked}
                    onChange={(overlay: BeatOverlay | undefined) =>
                      setDraft((d) => (d ? { ...d, overlay } : d))
                    }
                  />
                </div>

                <div className={scr.card}>
                  <h2 className={scr.h2}>Hand-off</h2>
                  <p className={scr.cardSub}>
                    How this beat gives way to the next one. The junction belongs to the beat that
                    ends, so this is the only place it is set — and it is only ever an override of
                    the style pack&apos;s own default.
                  </p>
                  <Dropdown
                    label="Hands over with"
                    disabled={locked || idx === beats.length - 1}
                    options={[
                      { value: PACK_DEFAULT, label: `Style pack default — ${TRANSITION_LABEL[transitionDefault] ?? transitionDefault}` },
                      ...transitionMenu.map((k) => ({ value: k, label: TRANSITION_LABEL[k] ?? k })),
                    ]}
                    value={draft.transition_out ?? PACK_DEFAULT}
                    emptyNote="This video's snapshot names no transitions."
                    onChange={(v) =>
                      setDraft((d) =>
                        d
                          ? { ...d, transition_out: v === PACK_DEFAULT ? undefined : (v as TransitionType) }
                          : d
                      )
                    }
                  />
                  <div className={s.handoffNote}>
                    {idx === beats.length - 1
                      ? "The last beat has nothing to hand over to, so the render draws no transition here."
                      : "A transition eats footage from both shots; the compile shortens it, or falls back to a cut, when a beat is too short to give it room."}
                  </div>
                </div>
              </div>
            </div>

            <div className={s.strip}>
              <div className={s.stripHead}>
                <div className={scr.eyebrow} style={{ marginBottom: 0 }}>Timeline · {beats.length} beats</div>
                <span className={s.stripNote}>Click a beat to edit it. Unsaved changes are dropped.</span>
              </div>
              <div className={s.stripRow}>
                {beats.map((b, i) => {
                  const item = visualByBeat.get(b.id);
                  return (
                    <button key={b.id} type="button"
                            className={`${s.stripItem}${b.id === editing ? " " + s.on : ""}`}
                            onClick={() => goBeat(i)}>
                      <span className={s.stripPlate}>
                        <span className={`${s.stripDot}${item?.asset?.path ? " " + s.ok : ""}`} />
                        <span className={s.stripTime}>{item ? fmtTime(item.start_s) : "—"}</span>
                      </span>
                      <span className={s.stripLabel}>{b.id}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
