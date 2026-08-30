"use client";
/**
 * The states a grid spends most of its life in. Drawn as real components
 * because "loading" and "nothing matched" are where a search tool is judged.
 */
import { useState } from "react";
import s from "./states.module.css";

/** Keeps grid geometry so results do not jump when they land. */
export function SkeletonGrid({ count = 8 }: { count?: number }) {
  return (
    <div className={s.grid}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={s.skel}>
          <div className={s.skelPlate} />
          <div className={s.skelBody}>
            <div className={s.bar} style={{ width: "100%" }} />
            <div className={s.bar} style={{ width: `${55 + (i % 3) * 12}%` }} />
            <div className={s.barThin} style={{ width: "40%" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function EmptyLibrary({ onIngest }: { onIngest: () => void }) {
  return (
    <div className={s.empty}>
      <svg width="26" height="26" viewBox="0 0 16 16" fill="none" stroke="currentColor"
           strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
        <line x1="2.5" y1="6.5" x2="13.5" y2="6.5" />
      </svg>
      <div className={s.emptyTitle}>No clips yet</div>
      <p className={s.emptyBody}>
        Ingest a source video and the tagger will cut it into clips. Tagging
        takes minutes to tens of minutes per source.
      </p>
      <button className={s.primary} onClick={onIngest}>Ingest footage</button>
    </div>
  );
}

export function NoResults({
  query, activeFilters, pending, onClear,
}: {
  query: string;
  activeFilters: number;
  pending: number;
  onClear: () => void;
}) {
  return (
    <div className={s.noResults}>
      <div className={s.emptyTitle}>Nothing matched “{query}”</div>
      <p className={s.emptyBody}>
        Search matches meaning, not keywords. A full sentence describing the
        shot works better.
      </p>
      <div className={s.suggest}>
        Try: <span className={s.suggestStrong}>
          “aerial view of a 1940s harbour, cranes in fog”
        </span>
      </div>
      <div className={s.footnote}>
        {activeFilters > 0 && (
          <>
            {activeFilters} filter{activeFilters === 1 ? "" : "s"} active.{" "}
            <button className={s.link} onClick={onClear}>Clear filters</button>
            {pending > 0 && " · "}
          </>
        )}
        {pending > 0 && `${pending} pending clip${pending === 1 ? "" : "s"} are excluded from search.`}
      </div>
    </div>
  );
}

/**
 * Deleting is genuinely unrecoverable — the source video was deleted after
 * tagging, so there is nothing to restore from. That earns a typed
 * confirmation rather than an "are you sure", and no undo is offered because
 * none exists.
 */
export function ConfirmDelete({
  count, busy, onConfirm, onCancel,
}: {
  count: number;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const phrase = `delete ${count} clip${count === 1 ? "" : "s"}`;
  const [typed, setTyped] = useState("");
  return (
    <div className={s.backdrop} onClick={onCancel}>
      <div className={s.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={s.dialogTitle}>Delete {count} clip{count === 1 ? "" : "s"} permanently</div>
        <p className={s.emptyBody}>
          The source videos were deleted after tagging, so these clips cannot be
          recovered. Getting them back means re-ingesting each source from
          scratch.
        </p>
        <label className={s.confirmLabel}>
          Type <span className={s.mono}>{phrase}</span> to confirm
          <input className={s.confirmInput} value={typed} autoFocus
                 onChange={(e) => setTyped(e.target.value)}
                 onKeyDown={(e) => {
                   if (e.key === "Enter" && typed === phrase && !busy) onConfirm();
                   if (e.key === "Escape") onCancel();
                 }} />
        </label>
        <div className={s.dialogActions}>
          <button className={s.ghost} onClick={onCancel} disabled={busy}>Cancel</button>
          <button className={s.danger} disabled={busy || typed !== phrase} onClick={onConfirm}>
            Delete permanently
          </button>
        </div>
        <div className={s.footnote}>No undo is offered because none exists.</div>
      </div>
    </div>
  );
}
