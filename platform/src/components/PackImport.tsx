"use client";
/**
 * Import a whole component pack: paste (or pick) the same JSON shape that
 * lives in contracts/component-packs/<pack>.json, so a pack can be moved
 * between installs. Validation is all-or-nothing on the server; this only
 * catches the JSON-level problems early.
 */
import { useMemo, useRef, useState } from "react";
import type { CatalogEntry } from "@lusora/contracts";
import s from "./form.module.css";

const PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const TEMPLATE = `{
  "pack": "history",
  "components": [
    {
      "name": "WarRoomPlate",
      "pack": "history",
      "when_to_use": "a command decision needs a plate naming the room and the hour",
      "when_not_to_use": "a person speaking (NamePlate); a document (DocumentCard)",
      "anchor_types": ["date"],
      "props": {
        "room": { "type": "string", "maxWords": 5, "required": true },
        "hour": { "type": "string", "maxWords": 3, "from_anchor": "value" }
      },
      "duration_hint_s": { "min": 2, "default": 3.5 },
      "renderer": "remotion"
    }
  ]
}`;

export interface ParsedPack {
  pack: string;
  components: CatalogEntry[];
}

export default function PackImport({
  onImported,
  onClose,
}: {
  onImported: (result: { pack: string; imported: number; no_renderer: string[] }) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const parsed = useMemo((): { pack?: ParsedPack; problem?: string } => {
    if (text.trim() === "") return {};
    try {
      const doc = JSON.parse(text);
      if (typeof doc?.pack !== "string" || !PACK_NAME_RE.test(doc.pack)) {
        return { problem: "`pack` must be a lowercase slug (it becomes the filename)" };
      }
      if (doc.pack === "core") return { problem: "`core` is generated from the engine registry" };
      if (!Array.isArray(doc.components) || doc.components.length === 0) {
        return { problem: "`components` must be a non-empty array of catalog entries" };
      }
      return { pack: doc as ParsedPack };
    } catch (e) {
      return { problem: e instanceof Error ? e.message : "invalid JSON" };
    }
  }, [text]);

  async function pickFile(file: File) {
    setText(await file.text());
    setError(null);
  }

  async function submit() {
    if (!parsed.pack) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/catalog/packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed.pack),
    });
    setBusy(false);
    if (res.ok) onImported(await res.json());
    else setError((await res.json()).error ?? "failed");
  }

  const names = parsed.pack?.components.map((c) => c?.name ?? "?") ?? [];

  return (
    <>
      <div className={s.hint}>
        Paste a pack file — <code>{`{ "pack": "…", "components": [ … ] }`}</code> — or pick one from
        disk. Written to <code>contracts/component-packs/&lt;pack&gt;.json</code>; every entry is
        validated against <code>catalog_entry.schema.json</code> and nothing is written unless all
        of them pass.
      </div>

      <div className={s.checks}>
        <button onClick={() => fileRef.current?.click()}>Choose file…</button>
        <button onClick={() => setText(TEMPLATE)}>Insert example</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void pickFile(file);
          }}
        />
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>pack json</span>
        <textarea
          name="pack-json"
          className={`${s.textarea} ${s.code}`}
          style={{ minHeight: 260 }}
          spellCheck={false}
          value={text}
          placeholder={TEMPLATE}
          onChange={(e) => {
            setText(e.target.value);
            setError(null);
          }}
        />
      </label>

      {parsed.problem && <div className={s.error}>{parsed.problem}</div>}
      {parsed.pack && (
        <div className={s.hint}>
          Pack <strong>{parsed.pack.pack}</strong> · {names.length} component
          {names.length === 1 ? "" : "s"}: {names.join(", ")}
        </div>
      )}
      {error && <div className={s.error}>{error}</div>}

      <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
        <button onClick={onClose}>Cancel</button>
        <button className="primary" onClick={submit} disabled={busy || !parsed.pack}>
          {busy ? "Importing…" : "Import pack"}
        </button>
      </div>
    </>
  );
}
