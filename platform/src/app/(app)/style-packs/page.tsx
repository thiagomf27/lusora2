"use client";
import { useEffect, useMemo, useState } from "react";
import type { StylePack } from "@lusora/contracts";
import StylePackFields, {
  STYLE_PACK_NAME_RE,
  newStylePack,
  stylePackProblems,
  type CatalogChoice,
} from "@/components/StylePackFields";
import DocImport from "@/components/DocImport";
import {
  RhythmStrip,
  StylePackLanguage,
  StylePackStats,
  TransitionChips,
} from "@/components/StylePackPreview";
import s from "./style-packs.module.css";

/** Same list as `pipeline_manifest`-adjacent `channel_config.video_type`; the
 *  defaults document carries one entry per member. */
const VIDEO_TYPES = ["doc", "explainer", "breakdown", "listicle"];

interface PackRow {
  name: string;
  doc: StylePack | null;
  errors: string[];
  channels: { id: string; name: string }[];
}

export default function StylePacksPage() {
  const [rows, setRows] = useState<PackRow[]>([]);
  const [catalog, setCatalog] = useState<CatalogChoice[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [editing, setEditing] = useState<StylePack | null>(null);
  const [createDraft, setCreateDraft] = useState<StylePack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importing, setImporting] = useState(false);
  // D-video-type defaults: which pack each type starts from
  // (contracts/video-type-defaults.json). Lives here rather than on the packs
  // because several packs can declare the same type — see lib/videoType.ts.
  const [defaults, setDefaults] = useState<Record<string, string>>({});
  const [defaultsNote, setDefaultsNote] = useState<{ text: string; bad?: boolean } | null>(null);

  async function load(select?: string) {
    const res = await fetch("/api/style-packs");
    if (!res.ok) return;
    const data: PackRow[] = await res.json();
    setRows(data);
    setSelected((prev) => select ?? prev ?? data[0]?.name ?? null);
  }

  useEffect(() => {
    load();
    fetch("/api/style-packs/defaults")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setDefaults(d.defaults ?? {}))
      .catch(() => undefined);
    // the allowance picker offers whatever the merged catalog holds
    fetch("/api/catalog")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setCatalog(
          (data.items as { entry: { name: string; pack: string } }[]).map((i) => ({
            name: i.entry.name,
            pack: i.entry.pack,
          }))
        );
      })
      .catch(() => {});
  }, []);

  const current = useMemo(() => rows.find((r) => r.name === selected) ?? null, [rows, selected]);

  // While editing, the preview renders the draft — the strip and stats below
  // double as the live preview of the edit.
  const preview = editing ?? current?.doc ?? null;
  const dirty = Boolean(
    editing && current?.doc && JSON.stringify(editing) !== JSON.stringify(current.doc)
  );
  const problems = editing ? stylePackProblems(editing) : [];

  function select(name: string) {
    if (name === selected) return;
    if (dirty && !confirm("Discard unsaved style pack changes?")) return;
    setEditing(null);
    setError(null);
    setSelected(name);
  }

  function cancelEdit() {
    if (dirty && !confirm("Discard unsaved style pack changes?")) return;
    setEditing(null);
    setError(null);
  }

  async function save() {
    if (!editing) return;
    setError(null);
    if (problems.length) {
      setError(problems.join("; "));
      return;
    }
    setSaving(true);
    const res = await fetch(`/api/style-packs/${encodeURIComponent(editing.name)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setSaving(false);
    if (res.ok) {
      setEditing(null);
      load(editing.name);
    } else {
      setError((await res.json()).error ?? "failed");
    }
  }

  async function create() {
    if (!createDraft) return;
    setError(null);
    if (!STYLE_PACK_NAME_RE.test(createDraft.name)) {
      setError("name must be lowercase letters, digits and dashes (e.g. doc-slow)");
      return;
    }
    const bad = stylePackProblems(createDraft);
    if (bad.length) {
      setError(bad.join("; "));
      return;
    }
    setSaving(true);
    const res = await fetch("/api/style-packs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(createDraft),
    });
    setSaving(false);
    if (res.ok) {
      const name = createDraft.name;
      setCreateDraft(null);
      load(name);
    } else {
      setError((await res.json()).error ?? "failed");
    }
  }

  async function remove() {
    if (!current) return;
    if (!confirm(`Delete style pack ${current.name}? The file is removed from contracts.`)) return;
    setError(null);
    setSaving(true);
    const res = await fetch(`/api/style-packs/${encodeURIComponent(current.name)}`, {
      method: "DELETE",
    });
    setSaving(false);
    if (res.ok) {
      setEditing(null);
      setSelected(null);
      load();
    } else {
      setError((await res.json()).error ?? "failed");
    }
  }

  /** Duplicating an existing pack is the intended way to add a video type:
   *  start from the closest one and retune the numbers. */
  function startFrom(name: string) {
    const from = rows.find((r) => r.name === name)?.doc;
    setCreateDraft(from ? { ...structuredClone(from), name: "" } : newStylePack());
  }

  const inUse = rows.filter((r) => r.channels.length > 0).length;

  async function saveDefault(type: string, packName: string) {
    const next = { ...defaults };
    if (packName) next[type] = packName;
    else delete next[type];
    setDefaults(next);
    setDefaultsNote(null);
    const res = await fetch("/api/style-packs/defaults", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ defaults: next }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setDefaultsNote({ text: body.error ?? `could not save (${res.status})`, bad: true });
      // the server refused, so put the screen back on what is actually on disk
      fetch("/api/style-packs/defaults")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setDefaults(d.defaults ?? {}))
        .catch(() => undefined);
      return;
    }
    setDefaultsNote({ text: `${type} now starts from ${packName || "the first pack that implements it"}.` });
  }

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Style Packs</h1>
          <div className="pageSub">
            {rows.length} pack{rows.length === 1 ? "" : "s"} · {inUse} in use · pacing, overlay
            density and persona the planner and compiler obey; a video type is a pack with
            different numbers
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { setError(null); setImporting(true); }}>Import…</button>
          <button
            className="primary"
            onClick={() => {
              setError(null);
              setCreateDraft(newStylePack());
            }}
          >
            New style pack
          </button>
        </div>
      </div>

      <div className={s.defaults}>
        <div className={s.defaultsHead}>
          <div>
            <div className={s.defaultsTitle}>Default pack per video type</div>
            <div className={s.defaultsSub}>
              What a channel&apos;s style pack becomes when its video type changes, on the Channel
              screen and on a video&apos;s quote statement. A pack&apos;s own <code>video_type</code> is
              advisory and several packs may declare the same one, so the answer lives here —
              <code>contracts/video-type-defaults.json</code> — where a type cannot have two.
            </div>
          </div>
          {defaultsNote && (
            <div className={defaultsNote.bad ? s.defaultsBad : s.defaultsOk}>{defaultsNote.text}</div>
          )}
        </div>
        <div className={s.defaultsGrid}>
          {VIDEO_TYPES.map((type) => {
            const fit = rows.filter((r) => r.doc?.video_type === type);
            return (
              <label key={type} className={s.defaultsField}>
                <span className={s.defaultsLabel}>{type}</span>
                <select value={defaults[type] ?? ""} onChange={(e) => saveDefault(type, e.target.value)}>
                  <option value="">first pack that implements it</option>
                  {fit.map((r) => (
                    <option key={r.name} value={r.name}>{r.name}</option>
                  ))}
                </select>
                <span className={s.defaultsHint}>
                  {fit.length === 0
                    ? `no pack declares ${type}`
                    : `${fit.length} pack${fit.length === 1 ? "" : "s"} to choose from`}
                </span>
              </label>
            );
          })}
        </div>
      </div>

      <div className={s.layout}>
        <div className={s.list}>
          {rows.map((r) => (
            <button
              key={r.name}
              className={`${s.listItem}${r.name === selected ? " " + s.listActive : ""}`}
              onClick={() => select(r.name)}
            >
              {r.doc ? (
                <RhythmStrip pack={r.name === selected && preview ? preview : r.doc} small />
              ) : (
                <div className={s.stripBroken}>unreadable</div>
              )}
              <div className={s.itemName}>{r.name}</div>
              <div className={s.itemSub}>
                {r.doc
                  ? `${r.doc.video_type ?? "any"} · ${r.doc.pacing.avg_hold_seconds}s holds`
                  : "invalid"}
                {r.channels.length > 0 &&
                  ` · ${r.channels.length} channel${r.channels.length === 1 ? "" : "s"}`}
              </div>
            </button>
          ))}
          {rows.length === 0 && (
            <div className={s.empty}>No style packs in contracts/style-packs yet.</div>
          )}
        </div>

        <div className={s.detail}>
          {!current && <div className={s.empty}>Select a style pack.</div>}
          {current && !current.doc && (
            <div className={s.errors}>
              <div className={s.errTitle}>{current.name}.json could not be read</div>
              {current.errors.map((e, i) => (
                <div key={i} className={s.errLine}>
                  {e}
                </div>
              ))}
            </div>
          )}
          {current?.doc && preview && (
            <>
              <div className={s.detailHead}>
                <div>
                  <div className={s.detailTitle}>
                    {current.doc.name}
                    {preview.video_type && <span className={s.type}>{preview.video_type}</span>}
                    {dirty && <span className={s.dirty}>unsaved</span>}
                  </div>
                  <div className={s.detailSub}>contracts/style-packs/{current.name}.json</div>
                </div>
                <div className={s.headActions}>
                  {editing ? (
                    <>
                      <button onClick={cancelEdit}>Cancel</button>
                      <button className="primary" onClick={save} disabled={saving || !dirty}>
                        {saving ? "Saving…" : "Save style pack"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setShowJson((v) => !v)}>
                        {showJson ? "Hide JSON" : "View JSON"}
                      </button>
                      <button
                        onClick={remove}
                        disabled={saving || current.channels.length > 0}
                        title={
                          current.channels.length > 0
                            ? `used by ${current.channels.map((c) => c.name).join(", ")}`
                            : undefined
                        }
                      >
                        Delete
                      </button>
                      <button
                        onClick={() => {
                          setError(null);
                          setEditing(structuredClone(current.doc!));
                        }}
                      >
                        Edit
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editing && current.channels.length > 0 && (
                <div className={s.notice}>
                  {current.channels.length} channel
                  {current.channels.length === 1 ? "" : "s"} use this pack. Saving affects future
                  enqueues only — videos already queued keep their own snapshot.
                </div>
              )}

              {error && <div className={s.formError}>{error}</div>}

              {!editing && current.errors.length > 0 && (
                <div className={s.errors}>
                  <div className={s.errTitle}>Does not match style_pack.schema.json</div>
                  {current.errors.map((e, i) => (
                    <div key={i} className={s.errLine}>
                      {e}
                    </div>
                  ))}
                </div>
              )}

              <div className={editing ? s.editGrid : undefined}>
                {editing && (
                  <StylePackFields
                    value={editing}
                    onChange={setEditing}
                    mode="edit"
                    catalog={catalog}
                  />
                )}
                <div className={s.previewStack}>
                  <div className={s.section}>
                    <div className={s.sectionLabel}>ONE MINUTE OF VIDEO</div>
                    <RhythmStrip pack={preview} />
                  </div>

                  <StylePackStats pack={preview} />

                  <div className={s.section}>
                    <div className={s.sectionLabel}>
                      TRANSITIONS
                      <a className={s.sectionLink} href="/overlays">
                        overlays &amp; allowances →
                      </a>
                    </div>
                    <TransitionChips pack={preview} />
                  </div>

                  <StylePackLanguage pack={preview} />
                </div>
              </div>

              <div className={s.section}>
                <div className={s.sectionLabel}>USED BY</div>
                {current.channels.length === 0 ? (
                  <div className={s.itemSub}>No channel references this style pack.</div>
                ) : (
                  <div className={s.chips}>
                    {current.channels.map((c) => (
                      <a key={c.id} className={s.chip} href={`/channels/${c.id}`}>
                        {c.name}
                      </a>
                    ))}
                  </div>
                )}
              </div>

              {showJson && !editing && (
                <pre className={s.json}>{JSON.stringify(current.doc, null, 2)}</pre>
              )}
            </>
          )}
        </div>
      </div>

      {importing && (
        <div className={s.overlay} onClick={() => setImporting(false)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>Import style pack</div>
              <button onClick={() => setImporting(false)}>Close</button>
            </div>
            <DocImport
              kind="style-pack"
              onClose={() => setImporting(false)}
              onImported={(name) => {
                setImporting(false);
                void load(name);
              }}
            />
          </div>
        </div>
      )}

      {createDraft && (
        <div className={s.overlay} onClick={() => setCreateDraft(null)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>New style pack</div>
              <div className={s.modalHeadRight}>
                <label className={s.startFrom}>
                  start from
                  <select
                    name="start-from"
                    defaultValue=""
                    onChange={(e) => startFrom(e.target.value)}
                  >
                    <option value="">blank</option>
                    {rows
                      .filter((r) => r.doc)
                      .map((r) => (
                        <option key={r.name} value={r.name}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </label>
                <button onClick={() => setCreateDraft(null)}>Close</button>
              </div>
            </div>

            <div className={s.editGrid}>
              <StylePackFields
                value={createDraft}
                onChange={setCreateDraft}
                mode="create"
                catalog={catalog}
              />
              <div className={s.previewStack}>
                <div className={s.section}>
                  <div className={s.sectionLabel}>ONE MINUTE OF VIDEO</div>
                  <RhythmStrip pack={createDraft} />
                </div>
                <StylePackStats pack={createDraft} />
                <div className={s.section}>
                  <div className={s.sectionLabel}>TRANSITIONS</div>
                  <TransitionChips pack={createDraft} />
                </div>
                <StylePackLanguage pack={createDraft} />
              </div>
            </div>

            {error && <div className={s.formError}>{error}</div>}
            <div className={s.modalActions}>
              <button onClick={() => setCreateDraft(null)}>Cancel</button>
              <button className="primary" onClick={create} disabled={saving}>
                {saving ? "Creating…" : "Create style pack"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
