"use client";
/**
 * D105 — the shot judge's candidates, per shot, with links to where each came
 * from, so a footage gate is reviewed by looking rather than by reading a
 * report. Renders nothing for a video without judged footage.
 */
import { useEffect, useState } from "react";
import s from "./FootageReview.module.css";
import scr from "../app/(app)/screen.module.css";

interface Candidate {
  rating: number;
  desc: string;
  source: string;
  link: string | null;
  thumb: string | null;
  placed: boolean;
}
interface Row {
  item_id: string;
  beat_id: string | null;
  narration: string;
  hook: boolean;
  candidates: Candidate[];
}
interface View {
  rows: Row[];
  sheets: string[];
  unjudged: string[];
  min_rating: number;
}

const SOURCE: Record<string, string> = { youtube: "YouTube", archive: "Archive photo", stock: "Pexels", library: "Library" };

export function FootageReview({
  videoId,
  refreshKey,
  canAsk = false,
  onAsked,
}: {
  videoId: string;
  refreshKey?: string;
  /** D108: the video waits at the footage gate and this user may act on it */
  canAsk?: boolean;
  onAsked?: () => void;
}) {
  const [view, setView] = useState<View | null>(null);
  const [weakOnly, setWeakOnly] = useState(false);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // D108: ask the worker for more candidates on some shots, then it stops again
  async function askMore(itemIds: string[], query = "") {
    setBusy(true);
    setNote(null);
    const res = await fetch(`/api/videos/${videoId}/footage/more`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ item_ids: itemIds, query }),
    });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setNote(body.error ?? `could not ask for more (${res.status})`);
      return;
    }
    setNote(`Searching more for ${itemIds.length} shot${itemIds.length === 1 ? "" : "s"} — the video will stop here again with the new candidates.`);
    onAsked?.();
  }

  useEffect(() => {
    let alive = true;
    fetch(`/api/videos/${videoId}/footage`)
      .then((r) => (r.status === 200 ? r.json() : null))
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [videoId, refreshKey]);

  if (!view || view.rows.length === 0) return null;
  const isWeak = (r: Row) => !r.candidates.some((c) => c.rating >= view.min_rating);
  const weak = view.rows.filter(isWeak).length;
  const rows = weakOnly ? view.rows.filter(isWeak) : view.rows;
  const weakIds = view.rows.filter(isWeak).map((r) => r.item_id);

  return (
    <div className={scr.card}>
      <div className={s.head}>
        <h2 className={scr.h2}>Footage</h2>
        <label className={s.filter}>
          <input type="checkbox" checked={weakOnly} onChange={(e) => setWeakOnly(e.target.checked)} />
          only the {weak} weak shot{weak === 1 ? "" : "s"}
        </label>
      </div>
      <p className={scr.cardSub}>
        What the shot judge rated for each shot, best first, with a link to the source. The outlined one is
        what was placed. Weak = nothing rated {view.min_rating}+.
        {view.unjudged.length > 0 && ` Not judged: ${view.unjudged.join(", ")}.`}
      </p>
      {canAsk && (
        <div className={s.askBar}>
          <button type="button" className={s.askBtn} disabled={busy || weakIds.length === 0}
            onClick={() => askMore(weakIds)}>
            Search more for all {weakIds.length} weak shot{weakIds.length === 1 ? "" : "s"}
          </button>
          <span className={s.askHint}>or use a shot&apos;s own button to search with your words</span>
        </div>
      )}
      {note && <div className={s.askNote}>{note}</div>}
      {view.sheets.length > 0 && (
        <div className={s.sheets}>
          Contact sheets:
          {view.sheets.map((u, k) => (
            <a key={u} href={u} target="_blank" rel="noreferrer">
              {u.split("/").pop()?.replace(".jpg", "") ?? `sheet ${k + 1}`}
            </a>
          ))}
        </div>
      )}
      {rows.map((r) => (
        <div key={r.item_id} className={`${s.row}${isWeak(r) ? " " + s.weak : ""}`}>
          <div>
            <div className={s.shotId}>
              {r.item_id}
              {r.hook && <span className={s.tag}>hook</span>}
              {isWeak(r) && <span className={s.tag}>weak</span>}
            </div>
            <div className={s.narration}>{r.narration}</div>
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
          </div>
          <div className={s.cands}>
            {r.candidates.map((c, k) => (
              <div key={k} className={`${s.cand}${c.placed ? " " + s.placed : ""}`}>
                {c.thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className={s.thumb} src={c.thumb} alt={c.desc} loading="lazy" />
                ) : (
                  <div className={s.noThumb}>no preview</div>
                )}
                <div className={s.meta}>
                  <div className={s.line}>
                    <span className={`${s.rating}${c.rating < view.min_rating ? " " + s.low : ""}`}>{c.rating}/5</span>
                    <span className={s.src}>{SOURCE[c.source] ?? c.source}</span>
                    {c.link && (
                      <a className={s.link} href={c.link} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    )}
                  </div>
                  {c.desc && <div className={s.desc}>{c.desc}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
