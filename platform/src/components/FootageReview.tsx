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

export function FootageReview({ videoId, refreshKey }: { videoId: string; refreshKey?: string }) {
  const [view, setView] = useState<View | null>(null);
  const [weakOnly, setWeakOnly] = useState(false);

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
