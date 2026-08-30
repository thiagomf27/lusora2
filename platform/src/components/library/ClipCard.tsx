"use client";
/**
 * One clip, as every library screen draws it.
 *
 * Shared as far as the BODY and no further. broll-engine keeps its Review page
 * a near-copy of its Gallery rather than a mode of it, because the two answer
 * different questions — what do I have, versus what did the tagger just do —
 * and folding them together puts review controls on library cards. Same split
 * here: the picture and the metadata are one component, the actions are the
 * caller's, passed as children.
 */
import { useRef, useState } from "react";
import { fmtAge, fmtClock, type Segment } from "./types";
import s from "./clip.module.css";

export function licenceTone(l: string): string {
  if (l === "cc0" || l === "cc-pd" || l === "own") return s.licGood;
  if (l === "unknown") return s.licUnknown;
  return s.licInfo;
}

/** A clip with no bytes is a normal state, not a bug: a duplicate holds none
 *  (it points at the canonical), and a library whose clip store was wiped has
 *  rows pointing at files that are gone. The browser's broken-image icon is a
 *  worse answer than saying so. */
function Plate({ seg, playable }: { seg: Segment; playable: boolean }) {
  const [broken, setBroken] = useState(false);
  const vid = useRef<HTMLVideoElement | null>(null);

  if (seg.duplicate_of) {
    return (
      <div className={`${s.media} ${s.noBytesPlate}`}>
        <svg width="20" height="20" viewBox="0 0 16 16" fill="none" stroke="currentColor"
             strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="4" width="8" height="8" rx="1.5" />
          <path d="M6 4V2.5h7.5V10" />
        </svg>
        <span>no media — duplicate</span>
      </div>
    );
  }
  if (playable) {
    return (
      <div className={s.media}>
        <video className={s.player} src={`/api/library/clips/${seg.id}`}
               controls preload="metadata" ref={vid} />
      </div>
    );
  }
  return (
    <div
      className={s.media}
      // Hover-to-preview rather than a grid of <video> elements: a page of
      // players fetches every clip on it before anyone asks for one.
      onMouseEnter={() => vid.current?.play().catch(() => {})}
      onMouseLeave={() => { const v = vid.current; if (v) { v.pause(); v.currentTime = 0; } }}
    >
      {broken ? (
        <span className={s.noBytes}>no preview</span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img className={s.thumb} src={`/api/library/thumbs/${seg.id}`} alt=""
             loading="lazy" onError={() => setBroken(true)} />
      )}
      <video className={s.hoverPlayer} src={`/api/library/clips/${seg.id}`}
             muted playsInline preload="none" ref={vid} />
      {seg.duration > 0 && <span className={s.dur}>{fmtClock(seg.duration)}</span>}
    </div>
  );
}

export function ClipCard({
  seg, playable = false, rank, selected, onSelect, badge, note, children,
}: {
  seg: Segment;
  /** Draw the clip itself rather than its thumbnail. Reviewing means watching. */
  playable?: boolean;
  /** Search only: position in the ranking, which is what a consumer acts on. */
  rank?: number;
  selected?: boolean;
  onSelect?: (e: React.MouseEvent) => void;
  badge?: React.ReactNode;
  note?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className={`${s.card} ${selected ? s.selected : ""}`}>
      <div className={s.plateWrap}>
        <Plate seg={seg} playable={playable} />
        {rank !== undefined && <span className={s.rank}>#{rank}</span>}
        {onSelect && (
          <button className={`${s.pick} ${selected ? s.pickOn : ""}`}
                  onClick={onSelect} aria-label="select" type="button">
            {selected && (
              <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="#fff"
                   strokeWidth="2.2" strokeLinecap="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>
            )}
          </button>
        )}
        {badge}
      </div>
      <div className={s.body}>
        <div className={s.caption} title={seg.caption}>
          {seg.caption || <span className={s.dim}>no caption</span>}
        </div>
        {!seg.duplicate_of && (
          <div className={s.tags}>
            {seg.tags.slice(0, 4).map((t) => <span key={t} className={s.tag}>{t}</span>)}
            {seg.tags.length > 4 && <span className={s.dim}>+{seg.tags.length - 4}</span>}
          </div>
        )}
        {seg.duplicate_of && (
          <div className={s.dupNote}>
            Near-duplicate. Stores no video.
          </div>
        )}
        {note}
        <div className={s.meta}>
          {seg.sim !== undefined ? (
            // sim, not score: score carries the -1.0 same-project block and is
            // not a similarity (D74). The ranked number is in the tooltip.
            <span className={`${s.pill} ${seg.sim >= 0.75 ? s.simGood : seg.sim >= 0.5 ? s.simOk : s.simWeak}`}
                  title={`ranked score ${seg.score?.toFixed(3)}`}>
              {Math.round(seg.sim * 100)}% sim
            </span>
          ) : null}
          <span className={`${s.pill} ${licenceTone(seg.license)}`}>{seg.license}</span>
          {seg.source_name && (
            <span className={s.truncate} title={seg.source_name}>{seg.source_name}</span>
          )}
          <span className={seg.usage_count >= 3 ? s.warn : s.usage}>
            used ×{seg.usage_count}
          </span>
        </div>
        {seg.sim === undefined && !seg.duplicate_of && (
          <div className={s.meta}><span className={s.dim}>{fmtAge(seg.created_at)}</span></div>
        )}
        {children && <div className={s.actions}>{children}</div>}
      </div>
    </div>
  );
}
