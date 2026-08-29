"use client";
/**
 * One clip, as both library screens draw it.
 *
 * Shared as far as the BODY and no further. broll-engine keeps its Review page
 * a near-copy of its Gallery rather than a mode of it, because the two answer
 * different questions — what do I have, versus what did the tagger just do —
 * and folding them together puts review controls on library cards. Same split
 * here: the picture and the metadata are one component, the actions are the
 * caller's, passed as children.
 */
import { useState } from "react";
import { StatusBadge } from "@/components/ds";
import { fmtAge, fmtDuration, type Segment } from "./types";
import s from "./clip.module.css";

export function ClipCard({
  seg,
  playable = false,
  children,
}: {
  seg: Segment;
  /** Draw the clip itself rather than its thumbnail. Reviewing means watching;
   *  browsing a hundred rows does not, and a grid of <video> elements fetches
   *  every clip on the page. */
  playable?: boolean;
  children?: React.ReactNode;
}) {
  // A row without bytes is a normal state, not a bug: a duplicate holds none
  // (it points at the canonical), and a library whose clip store was wiped has
  // rows pointing at files that are gone. Either way /thumbs 404s or 500s, and
  // the browser's broken-image icon is a worse answer than saying so.
  const [broken, setBroken] = useState(false);
  return (
    <div className={s.card}>
      <div className={s.media}>
        {playable ? (
          <video className={s.player} src={`/api/library/clips/${seg.id}`} controls preload="metadata" />
        ) : broken ? (
          <span className={s.noBytes}>no preview</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className={s.thumb}
            src={`/api/library/thumbs/${seg.id}`}
            alt=""
            loading="lazy"
            onError={() => setBroken(true)}
          />
        )}
      </div>
      <div className={s.body}>
        <div className={s.caption} title={seg.caption}>
          {seg.caption || <span className={s.dim}>no caption</span>}
        </div>
        <div className={s.tags}>
          {seg.tags.slice(0, 6).map((t) => (
            <span key={t} className={s.tag}>{t}</span>
          ))}
          {seg.tags.length > 6 && <span className={s.dim}>+{seg.tags.length - 6}</span>}
        </div>
        <div className={s.meta}>
          <span>{fmtDuration(seg.duration)}</span>
          <span className={s.dim}>·</span>
          <span>{seg.license}</span>
          {seg.source_name && (
            <>
              <span className={s.dim}>·</span>
              <span className={s.truncate} title={seg.source_name}>{seg.source_name}</span>
            </>
          )}
        </div>
        <div className={s.meta}>
          {seg.sim !== undefined ? (
            // sim, not score: score carries the -1.0 same-project block and is
            // not a similarity (D74). Showing it as a match % would mislead.
            <span title={`ranked score ${seg.score?.toFixed(3)}`}>
              {Math.round(seg.sim * 100)}% match
            </span>
          ) : (
            <span className={s.dim}>{fmtAge(seg.created_at)}</span>
          )}
          {seg.usage_count > 0 && (
            <>
              <span className={s.dim}>·</span>
              <span className={seg.usage_count >= 3 ? s.warn : undefined}>
                used {seg.usage_count}×
              </span>
            </>
          )}
          {seg.duplicate_of && <StatusBadge label="duplicate" tone="warning" />}
        </div>
        {children && <div className={s.actions}>{children}</div>}
      </div>
    </div>
  );
}

/** Caption / tags / licence / origin, edited in place. A text edit re-embeds
 *  the row server-side (PATCH /segments/{id}), which is what makes a fix reach
 *  SEARCH and not just the card — the library is emphatic about this, because
 *  a row edited without re-embedding keeps matching the model's original
 *  wording forever while looking corrected. */
export function ClipEditor({
  seg,
  licenses,
  onSave,
  onCancel,
  busy,
}: {
  seg: Segment;
  licenses: string[];
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  const [caption, setCaption] = useState(seg.caption);
  const [tags, setTags] = useState(seg.tags.join(", "));
  const [license, setLicense] = useState(seg.license);
  const [sourceName, setSourceName] = useState(seg.source_name ?? "");

  return (
    <div className={s.editor}>
      <textarea
        className={s.editArea}
        rows={3}
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        placeholder="what this shot shows"
      />
      <input
        className={s.editField}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="tags, comma separated"
      />
      <div className={s.editRow}>
        <select className={s.editField} value={license} onChange={(e) => setLicense(e.target.value)}>
          {[...new Set([license, ...licenses])].map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
        <input
          className={s.editField}
          value={sourceName}
          onChange={(e) => setSourceName(e.target.value)}
          placeholder="origin"
        />
      </div>
      <div className={s.editRow}>
        <button
          className={s.primaryBtn}
          disabled={busy}
          onClick={() =>
            onSave({
              caption,
              tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
              license,
              source_name: sourceName || null,
            })
          }
        >
          Save
        </button>
        <button className={s.ghostBtn} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
