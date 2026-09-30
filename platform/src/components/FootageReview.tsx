"use client";
/**
 * D105/D108/D109 — the shot judge's candidates, grouped by beat, with links to
 * where each came from, which one each shot will use, and — while the video
 * waits at the footage gate — "search more" and "use this". Renders nothing
 * for a video without judged footage.
 */
import { useEffect, useState } from "react";
import s from "./FootageReview.module.css";
import scr from "../app/(app)/screen.module.css";

interface Candidate {
  id: string;
  rating: number;
  desc: string;
  source: string;
  link: string | null;
  thumb: string | null;
  chosen: boolean;
  used: boolean;
}
interface Row {
  item_id: string;
  beat_id: string | null;
  narration: string;
  hook: boolean;
  start_s: number;
  end_s: number;
  shot: number;
  shots_in_beat: number;
  covered: boolean;
  candidates: Candidate[];
}
interface View {
  rows: Row[];
  sheets: string[];
  unjudged: string[];
  min_rating: number;
  resolved: boolean;
}

const SOURCE: Record<string, string> = { youtube: "YouTube", archive: "Archive photo", stock: "Pexels", library: "Library" };

function clock(t: number): string {
  const m = Math.floor(t / 60);
  const sec = t - m * 60;
  return `${m}:${sec.toFixed(1).padStart(4, "0")}`;
}

/** consecutive rows of the same beat, in plan order */
function byBeat(rows: Row[]): { beat_id: string | null; narration: string; rows: Row[] }[] {
  const groups: { beat_id: string | null; narration: string; rows: Row[] }[] = [];
  for (const r of rows) {
    const last = groups[groups.length - 1];
    if (last && last.beat_id === r.beat_id) last.rows.push(r);
    else groups.push({ beat_id: r.beat_id, narration: r.narration, rows: [r] });
  }
  return groups;
}

export function FootageReview({
  videoId,
  refreshKey,
  canAsk = false,
  defaultOpen = false,
  onAsked,
}: {
  videoId: string;
  refreshKey?: string;
  /** the video waits at the footage gate and this user may act on it */
  canAsk?: boolean;
  defaultOpen?: boolean;
  onAsked?: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [weakOnly, setWeakOnly] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => setOpen(defaultOpen), [defaultOpen]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/videos/${videoId}/footage`)
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [videoId, refreshKey, reload]);

  async function post(path: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/videos/${videoId}/footage/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) setNote(out.error ?? `request failed (${res.status})`);
    return res.ok;
  }

  // D108: more candidates on some shots; the video stops here again after
  async function askMore(itemIds: string[], query = "") {
    if (await post("more", { item_ids: itemIds, query })) {
      setNote(`Searching more for ${itemIds.length} shot${itemIds.length === 1 ? "" : "s"} — the video will stop here again with the new candidates.`);
      onAsked?.();
    }
  }

  // D109: this candidate for this shot (null clears the choice)
  async function choose(itemId: string, c: Candidate | null) {
    if (await post("choose", { item_id: itemId, candidate_id: c ? c.id : null, source: c?.source })) {
      setReload((n) => n + 1);
    }
  }

  if (!view || view.rows.length === 0) return null;
  const weakIds = view.rows.filter((r) => !r.covered).map((r) => r.item_id);
  const rows = weakOnly ? view.rows.filter((r) => !r.covered) : view.rows;
  const chosenCount = view.rows.filter((r) => r.candidates.some((c) => c.chosen)).length;

  return (
    <div className={scr.card}>
      <div className={s.head}>
        <div style={{ flex: 1 }}>
          <h2 className={scr.h2}>Footage</h2>
          <p className={scr.cardSub} style={{ marginBottom: 0 }}>
            {view.rows.length} shots · {weakIds.length} weak
            {chosenCount > 0 && ` · ${chosenCount} chosen by hand`}
            {view.resolved ? " · showing what the video uses" : " · showing what the video will use"}
          </p>
        </div>
        <button type="button" className={s.toggle} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide footage" : "Show footage"}
        </button>
      </div>

      {open && (
        <>
          <p className={s.explain}>
            The narration is cut into <b>beats</b>; a long beat is cut into several <b>shots</b>, and every shot
            shows exactly <b>one</b> clip or photo. For each shot the judge rated the candidates below (best first,
            out of 5). The one marked <b>{view.resolved ? "Used" : "Will be used"}</b> is the one that goes on screen:
            {view.resolved
              ? " what resolve placed."
              : ` your choice if you made one, otherwise the best rated ${view.min_rating}+ that no earlier shot took.`}{" "}
            A <b>weak</b> shot has nothing rated {view.min_rating}+; with no candidate marked, it takes the plain search
            at render time.
            {view.unjudged.length > 0 && ` Not judged: ${view.unjudged.join(", ")}.`}
          </p>

          <div className={s.toolbar}>
            <label className={s.filter}>
              <input type="checkbox" checked={weakOnly} onChange={(e) => setWeakOnly(e.target.checked)} />
              only the {weakIds.length} weak shot{weakIds.length === 1 ? "" : "s"}
            </label>
            {canAsk && (
              <button type="button" className={s.askBtn} disabled={busy || weakIds.length === 0}
                onClick={() => askMore(weakIds)}>
                Search more for all weak shots
              </button>
            )}
            {view.sheets.length > 0 && (
              <span className={s.sheets}>
                Contact sheets:
                {view.sheets.map((u) => (
                  <a key={u} href={u} target="_blank" rel="noreferrer">{u.split("/").pop()?.replace(".jpg", "")}</a>
                ))}
              </span>
            )}
          </div>
          {note && <div className={s.askNote}>{note}</div>}

          {byBeat(rows).map((g) => (
            <div key={`${g.beat_id}-${g.rows[0].item_id}`} className={s.beat}>
              <div className={s.beatHead}>
                <span className={s.beatId}>Beat {g.beat_id}</span>
                <span className={s.beatMeta}>
                  {clock(g.rows[0].start_s)}–{clock(g.rows[g.rows.length - 1].end_s)}
                  {g.rows[0].shots_in_beat > 1 && ` · cut into ${g.rows[0].shots_in_beat} shots`}
                  {g.rows[0].hook && " · hook"}
                </span>
                <div className={s.narration}>“{g.narration}”</div>
              </div>
              {g.rows.map((r) => (
                <div key={r.item_id} className={s.row}>
                  <div className={s.shotHead}>
                    <div className={s.shotId}>
                      {r.shots_in_beat > 1 ? `Shot ${r.shot} of ${r.shots_in_beat}` : "Shot"}
                      <span className={s.time}> · {clock(r.start_s)}–{clock(r.end_s)}</span>
                      {!r.covered && <span className={s.tag}>weak</span>}
                    </div>
                    {canAsk && (
                      <div className={s.askRow}>
                        <input
                          className={s.askInput}
                          placeholder="search words (optional)"
                          value={typed[r.item_id] ?? ""}
                          onChange={(e) => setTyped((t) => ({ ...t, [r.item_id]: e.target.value }))}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && !busy) askMore([r.item_id], typed[r.item_id] ?? "");
                          }}
                        />
                        <button type="button" className={s.askBtn} disabled={busy}
                          onClick={() => askMore([r.item_id], typed[r.item_id] ?? "")}>
                          Search more
                        </button>
                      </div>
                    )}
                    {!r.candidates.some((c) => c.used) && (
                      <div className={s.plain}>No candidate goes on screen: the plain search answers at render time.</div>
                    )}
                  </div>
                  <div className={s.cands}>
                    {r.candidates.map((c) => (
                      <div key={`${c.source}:${c.id}`} className={`${s.cand}${c.used ? " " + s.usedCand : ""}`}>
                        {c.thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img className={s.thumb} src={c.thumb} alt={c.desc} loading="lazy" />
                        ) : (
                          <div className={s.noThumb}>no preview</div>
                        )}
                        {c.used && (
                          <div className={s.badge}>{view.resolved ? "Used" : "Will be used"}{c.chosen ? " · your choice" : ""}</div>
                        )}
                        <div className={s.meta}>
                          <div className={s.line}>
                            <span className={`${s.rating}${c.rating < view.min_rating ? " " + s.low : ""}`}>{c.rating}/5</span>
                            <span className={s.src}>{SOURCE[c.source] ?? c.source}</span>
                            {c.link && (
                              <a className={s.link} href={c.link} target="_blank" rel="noreferrer">Open</a>
                            )}
                          </div>
                          {c.desc && <div className={s.desc}>{c.desc}</div>}
                          {canAsk && (
                            c.chosen ? (
                              <button type="button" className={s.useBtn} disabled={busy} onClick={() => choose(r.item_id, null)}>
                                Clear choice
                              </button>
                            ) : (
                              <button type="button" className={s.useBtn} disabled={busy || (c.used && !r.candidates.some((x) => x.chosen))}
                                onClick={() => choose(r.item_id, c)}>
                                {c.used ? "Already the pick" : "Use this"}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
