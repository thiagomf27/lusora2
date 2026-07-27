"use client";
/**
 * Import a whole theme or style pack: paste (or pick) the same JSON that lives
 * in contracts/themes/<name>.json or contracts/style-packs/<name>.json, so a
 * look can be moved between installs instead of retyped field by field.
 *
 * Deliberately one component for both: they are the same document shape from
 * the UI's point of view — a named JSON file, POSTed whole, validated
 * server-side against its schema. The only differences are the endpoint, the
 * directory in the copy, and the example. Mirrors PackImport for component
 * packs; validation here is only the JSON-level pass so problems surface before
 * a round trip, and the server stays the authority.
 */
import { useMemo, useRef, useState } from "react";
import s from "./form.module.css";

const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

type Kind = "theme" | "style-pack";

const SPEC: Record<Kind, { label: string; dir: string; schema: string; endpoint: string; template: string }> = {
  theme: {
    label: "theme",
    dir: "contracts/themes",
    schema: "theme.schema.json",
    endpoint: "/api/themes",
    template: `{
  "name": "clean-punchy",
  "colors": {
    "bg": "#0b1220",
    "text": "#f2f5fa",
    "accent": "#3ddc97",
    "neutral": "#7b8798"
  },
  "typography": {
    "display": "Inter",
    "body": "Inter",
    "caption_preset": "boxed"
  },
  "motion_feel": "fast_light",
  "grain": "none",
  "surface": { "radius": "rounded", "fill": "solid", "accent_rule": "top" },
  "motion": {
    "entrance": "pop",
    "easing": "spring",
    "per_component": { "ChapterCard": "typewriter" }
  }
}`,
  },
  "style-pack": {
    label: "style pack",
    dir: "contracts/style-packs",
    schema: "style_pack.schema.json",
    endpoint: "/api/style-packs",
    template: `{
  "name": "explainer-punchy",
  "video_type": "explainer",
  "pacing": { "avg_hold_seconds": 3.2, "min_hold": 2.0, "max_hold": 6.0, "arc": "three_act" },
  "overlays": { "density": "high", "allowed_components": ["KineticTitle", "FactCard", "AnimatedCounter"] },
  "transitions": { "allowed": ["cut", "crossfade"], "default": "cut" },
  "script_persona": "Brisk, plain-spoken explainer. Short sentences.",
  "visual_language": "Bright, modern, high-contrast footage."
}`,
  },
};

export default function DocImport({
  kind,
  onImported,
  onClose,
}: {
  kind: Kind;
  onImported: (name: string) => void;
  onClose: () => void;
}) {
  const spec = SPEC[kind];
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo((): { doc?: { name: string }; problem?: string } => {
    if (text.trim() === "") return {};
    try {
      const doc = JSON.parse(text);
      if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
        return { problem: `a ${spec.label} is a JSON object` };
      }
      if (typeof doc.name !== "string" || !NAME_RE.test(doc.name)) {
        return { problem: "`name` must be a lowercase slug (it becomes the filename)" };
      }
      return { doc: doc as { name: string } };
    } catch (e) {
      return { problem: e instanceof Error ? e.message : "invalid JSON" };
    }
  }, [text, spec.label]);

  async function submit() {
    if (!parsed.doc) return;
    setBusy(true);
    setError(null);
    const res = await fetch(spec.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.doc),
    });
    setBusy(false);
    if (res.ok) {
      onImported(parsed.doc.name);
      return;
    }
    const body = await res.json().catch(() => ({}));
    // The POST routes answer with `problems` (a schema violation list) or a
    // single `error`; showing all of them beats "failed".
    setError(
      Array.isArray(body.problems) && body.problems.length
        ? body.problems.join("; ")
        : (body.error ?? `import failed (${res.status})`),
    );
  }

  return (
    <>
      <div className={s.hint}>
        Paste a {spec.label} document, or pick one from disk. Written to{" "}
        <code>
          {spec.dir}/&lt;name&gt;.json
        </code>{" "}
        and validated server-side against <code>{spec.schema}</code> — nothing is written unless it
        passes. A name that already exists is rejected rather than overwritten.
      </div>

      <div className={s.checks}>
        <button onClick={() => fileRef.current?.click()}>Choose file…</button>
        <button onClick={() => setText(spec.template)}>Insert example</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setText(await file.text());
            setError(null);
          }}
        />
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>{spec.label} json</span>
        <textarea
          name={`${kind}-json`}
          className={`${s.textarea} ${s.code}`}
          style={{ minHeight: 260 }}
          spellCheck={false}
          value={text}
          placeholder={spec.template}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </label>

      {parsed.problem && <div className={s.error}>{parsed.problem}</div>}
      {parsed.doc && (
        <div className={s.hint}>
          Will create <strong>{parsed.doc.name}</strong>.
        </div>
      )}
      {error && <div className={s.error}>{error}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={submit} disabled={busy || !parsed.doc}>
          {busy ? "Importing…" : `Import ${spec.label}`}
        </button>
      </div>
    </>
  );
}
