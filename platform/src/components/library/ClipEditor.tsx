"use client";
/**
 * Caption / tags / licence / origin, edited in place.
 *
 * A text edit re-embeds the row server-side (PATCH /segments/{id}), which is
 * what makes a fix reach SEARCH and not just the card — the library is
 * emphatic about this, because a row edited without re-embedding keeps
 * matching the model's original wording forever while looking corrected.
 */
import { useState } from "react";
import s from "./editor.module.css";

export function ClipEditor({
  caption: caption0, tags: tags0, license: license0, sourceName: source0,
  licenses, busy, autoFocus, compact, onSave, onCancel,
}: {
  caption: string;
  tags: string[];
  license: string;
  sourceName: string | null;
  licenses: string[];
  busy?: boolean;
  autoFocus?: boolean;
  /** Review edits only the words; the Library card edits provenance too. */
  compact?: boolean;
  onSave: (patch: Record<string, unknown>) => void;
  onCancel: () => void;
}) {
  const [caption, setCaption] = useState(caption0);
  const [tags, setTags] = useState(tags0.join(", "));
  const [license, setLicense] = useState(license0);
  const [sourceName, setSourceName] = useState(source0 ?? "");

  function save() {
    const patch: Record<string, unknown> = {
      caption,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
    };
    if (!compact) {
      patch.license = license;
      patch.source_name = sourceName || null;
    }
    onSave(patch);
  }

  return (
    <div className={s.editor}>
      <textarea
        className={s.area}
        rows={3}
        value={caption}
        autoFocus={autoFocus}
        onChange={(e) => setCaption(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves, Shift-Enter breaks the line: this is a culling screen
          // and reaching for the mouse per clip is the cost being avoided.
          if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
          if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        }}
        placeholder="what this shot shows — a sentence, not keywords"
      />
      <input
        className={s.field}
        value={tags}
        onChange={(e) => setTags(e.target.value)}
        placeholder="tags, comma separated"
      />
      {!compact && (
        <div className={s.row}>
          <select className={s.field} value={license}
                  onChange={(e) => setLicense(e.target.value)}>
            {[...new Set([license, ...licenses])].map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
          <input className={s.field} value={sourceName}
                 onChange={(e) => setSourceName(e.target.value)} placeholder="origin" />
        </div>
      )}
      <div className={s.row}>
        <button className={s.primary} disabled={busy} onClick={save}>Save</button>
        <button className={s.ghost} disabled={busy} onClick={onCancel}>Cancel</button>
        <span className={s.hint}>⏎ save · esc cancel</span>
      </div>
    </div>
  );
}
