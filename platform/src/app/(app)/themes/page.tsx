"use client";
import { useEffect, useMemo, useState } from "react";
import type { Theme } from "@lusora/contracts";
import ThemeFields, { THEME_NAME_RE, newTheme } from "@/components/ThemeFields";
import DocImport from "@/components/DocImport";
import {
  ThemeFrame,
  ThemeEntrance,
  ThemeMotion,
  ThemeStrip,
  ThemeSwatches,
  ThemeTypography,
} from "@/components/ThemePreview";
import s from "./themes.module.css";

interface ThemeRow {
  name: string;
  doc: Theme | null;
  errors: string[];
  channels: { id: string; name: string }[];
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Client-side mirror of the parts of theme.schema.json the form can violate;
 *  the API validates against the schema itself either way. */
function colorProblems(theme: Theme): string[] {
  return (Object.entries(theme.colors) as [string, string][])
    .filter(([, v]) => !HEX.test(v))
    .map(([k, v]) => `colors.${k} must be #rrggbb (got "${v}")`);
}

export default function ThemesPage() {
  const [rows, setRows] = useState<ThemeRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [editing, setEditing] = useState<Theme | null>(null);
  const [createDraft, setCreateDraft] = useState<Theme | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function load(select?: string) {
    const res = await fetch("/api/themes");
    if (!res.ok) return;
    const data: ThemeRow[] = await res.json();
    setRows(data);
    setSelected((prev) => select ?? prev ?? data[0]?.name ?? null);
  }

  useEffect(() => {
    load();
  }, []);

  const current = useMemo(() => rows.find((r) => r.name === selected) ?? null, [rows, selected]);
  const usedCount = rows.filter((r) => r.channels.length > 0).length;

  // While editing, the preview renders the draft — the frame, swatches and
  // specimens below double as the live preview of the edit.
  const preview = editing ?? current?.doc ?? null;
  const dirty = Boolean(
    editing && current?.doc && JSON.stringify(editing) !== JSON.stringify(current.doc)
  );
  const problems = editing ? colorProblems(editing) : [];

  function select(name: string) {
    if (name === selected) return;
    if (dirty && !confirm("Discard unsaved theme changes?")) return;
    setEditing(null);
    setError(null);
    setSelected(name);
  }

  function cancelEdit() {
    if (dirty && !confirm("Discard unsaved theme changes?")) return;
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
    const res = await fetch(`/api/themes/${encodeURIComponent(editing.name)}`, {
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
    if (!THEME_NAME_RE.test(createDraft.name)) {
      setError("name must be lowercase letters, digits and dashes (e.g. history-dark)");
      return;
    }
    const bad = colorProblems(createDraft);
    if (bad.length) {
      setError(bad.join("; "));
      return;
    }
    setSaving(true);
    const res = await fetch("/api/themes", {
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

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Themes</h1>
          <div className="pageSub">
            {rows.length} theme{rows.length === 1 ? "" : "s"} · {usedCount} in use · appearance
            tokens the engine resolves; the AI never sees them
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => { setError(null); setImporting(true); }}>Import…</button>
          <button
            className="primary"
            onClick={() => {
              setError(null);
              setCreateDraft(newTheme());
            }}
          >
            New theme
          </button>
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
                <ThemeStrip theme={r.name === selected && preview ? preview : r.doc} />
              ) : (
                <div className={s.stripBroken}>unreadable</div>
              )}
              <div className={s.itemName}>{r.name}</div>
              <div className={s.itemSub}>
                {r.doc ? r.doc.typography.display : "invalid"}
                {r.channels.length > 0 &&
                  ` · ${r.channels.length} channel${r.channels.length === 1 ? "" : "s"}`}
              </div>
            </button>
          ))}
          {rows.length === 0 && <div className={s.empty}>No themes in contracts/themes yet.</div>}
        </div>

        <div className={s.detail}>
          {!current && <div className={s.empty}>Select a theme.</div>}
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
                    {dirty && <span className={s.dirty}>unsaved</span>}
                  </div>
                  <div className={s.detailSub}>contracts/themes/{current.name}.json</div>
                </div>
                <div className={s.headActions}>
                  {editing ? (
                    <>
                      <button onClick={cancelEdit}>Cancel</button>
                      <button className="primary" onClick={save} disabled={saving || !dirty}>
                        {saving ? "Saving…" : "Save theme"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setShowJson((v) => !v)}>
                        {showJson ? "Hide JSON" : "View JSON"}
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
                  {current.channels.length === 1 ? "" : "s"} use this theme. Saving affects future
                  enqueues only — videos already queued keep their own snapshot.
                </div>
              )}

              {error && <div className={s.formError}>{error}</div>}

              {!editing && current.errors.length > 0 && (
                <div className={s.errors}>
                  <div className={s.errTitle}>Does not match theme.schema.json</div>
                  {current.errors.map((e, i) => (
                    <div key={i} className={s.errLine}>
                      {e}
                    </div>
                  ))}
                </div>
              )}

              <div className={editing ? s.editGrid : undefined}>
                {editing && (
                  <ThemeFields value={editing} onChange={setEditing} mode="edit" />
                )}
                <div className={s.previewStack}>
                  <ThemeFrame theme={preview} />

                  <div className={s.section}>
                    <div className={s.sectionLabel}>COLOURS</div>
                    <ThemeSwatches theme={preview} />
                  </div>

                  <div className={s.section}>
                    <div className={s.sectionLabel}>TYPOGRAPHY</div>
                    <ThemeTypography theme={preview} />
                  </div>

                  <div className={s.section}>
                    <div className={s.sectionLabel}>MOTION &amp; POST-LOOK</div>
                    <ThemeMotion theme={preview} />
                    <div className={s.sectionLabel}>ENTRANCE</div>
                    <ThemeEntrance theme={preview} />
                  </div>
                </div>
              </div>

              <div className={s.section}>
                <div className={s.sectionLabel}>USED BY</div>
                {current.channels.length === 0 ? (
                  <div className={s.itemSub}>No channel references this theme.</div>
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

              {showJson && !editing && <pre className={s.json}>{JSON.stringify(current.doc, null, 2)}</pre>}
            </>
          )}
        </div>
      </div>

      {importing && (
        <div className={s.overlay} onClick={() => setImporting(false)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>Import theme</div>
              <button onClick={() => setImporting(false)}>Close</button>
            </div>
            <DocImport
              kind="theme"
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
              <div className={s.modalTitle}>New theme</div>
              <button onClick={() => setCreateDraft(null)}>Close</button>
            </div>

            <div className={s.editGrid}>
              <ThemeFields value={createDraft} onChange={setCreateDraft} mode="create" />
              <div className={s.previewStack}>
                <ThemeFrame theme={createDraft} title={createDraft.name || "Untitled theme"} />
                <ThemeSwatches theme={createDraft} />
                <ThemeTypography theme={createDraft} />
                <ThemeMotion theme={createDraft} />
                <ThemeEntrance theme={createDraft} />
              </div>
            </div>

            {error && <div className={s.formError}>{error}</div>}
            <div className={s.modalActions}>
              <button onClick={() => setCreateDraft(null)}>Cancel</button>
              <button className="primary" onClick={create} disabled={saving}>
                {saving ? "Creating…" : "Create theme"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
