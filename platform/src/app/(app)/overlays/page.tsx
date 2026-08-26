"use client";
import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { AnchorType, CatalogEntry, CatalogPropSpec, Theme } from "@lusora/contracts";
import CatalogEntryFields, {
  COMPONENT_NAME_RE,
  PACK_NAME_RE,
  newEntry,
} from "@/components/CatalogEntryFields";
import type { TemplateChoice } from "@/components/CatalogEntryFields";
import PackImport from "@/components/PackImport";
import { hasHandWrittenSample, previewDuration, sampleProps } from "@/lib/overlaySamples";
import { fileToBackdrop, useBackdrop } from "@/lib/backdrop";
import s from "./overlays.module.css";

const OverlayPreview = dynamic(() => import("@/components/OverlayPreview"), { ssr: false });

interface CatalogItem {
  entry: CatalogEntry;
  source: string;
  editable: boolean;
  renderedBy: "component" | "template" | null;
  implemented: boolean;
  errors: string[];
}

interface StylePackRow {
  name: string;
  /** undefined = this style allows every component pack. */
  allowedPacks?: string[];
}

interface CatalogResponse {
  version: string;
  items: CatalogItem[];
  dataPacks: string[];
  loadErrors: string[];
  stylePacks: StylePackRow[];
  templates: TemplateChoice[];
}

interface ThemeRow {
  name: string;
  doc: Theme | null;
}

/** One row of the props table, flattened so nested item/object specs show. */
function propRows(
  props: Record<string, CatalogPropSpec>,
  prefix = ""
): { key: string; spec: CatalogPropSpec }[] {
  return Object.entries(props).flatMap(([key, spec]) => {
    const here = { key: prefix + key, spec };
    if (spec.items?.properties) {
      return [here, ...propRows(spec.items.properties, `${prefix}${key}[].`)];
    }
    if (spec.properties) return [here, ...propRows(spec.properties, `${prefix}${key}.`)];
    return [here];
  });
}

function typeLabel(spec: CatalogPropSpec): string {
  if (spec.enum) return spec.enum.map((v) => String(v)).join(" | ");
  if (spec.type === "array") return `array${spec.items?.type ? ` of ${spec.items.type}` : ""}`;
  return spec.type ?? "—";
}

function constraints(spec: CatalogPropSpec): string {
  const bits: string[] = [];
  if (spec.min !== undefined) bits.push(`min ${spec.min}`);
  if (spec.max !== undefined) bits.push(`max ${spec.max}`);
  if (spec.maxWords !== undefined) bits.push(`≤ ${spec.maxWords} words`);
  if (spec.default !== undefined) bits.push(`default ${JSON.stringify(spec.default)}`);
  if (spec.from_anchor) bits.push(`from anchor.${spec.from_anchor}`);
  if (spec.computed) bits.push(`computed: ${spec.computed}`);
  return bits.join(" · ");
}

export default function OverlaysPage() {
  const [data, setData] = useState<CatalogResponse | null>(null);
  const [themes, setThemes] = useState<ThemeRow[]>([]);
  const [themeName, setThemeName] = useState<string>("");
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [packFilter, setPackFilter] = useState<string>("all");
  /**
   * Props for the preview. Held per component name and resolved during render,
   * never in an effect: an effect would let one paint through with the
   * previous component's props, which throws inside the player.
   */
  const [override, setOverride] = useState<{
    name: string;
    text: string;
    parsed: Record<string, unknown> | null;
    error: string | null;
  } | null>(null);
  const [showJson, setShowJson] = useState(false);
  const [editing, setEditing] = useState<CatalogEntry | null>(null);
  const [createDraft, setCreateDraft] = useState<CatalogEntry | null>(null);
  const [allowance, setAllowance] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The still every preview on this screen stands on, shared with the Look grid.
  const { image: backdrop, setImage: setBackdrop } = useBackdrop();
  const [backdropError, setBackdropError] = useState<string | null>(null);

  async function load(select?: string) {
    const res = await fetch("/api/catalog");
    if (!res.ok) {
      setError((await res.json()).error ?? "failed to load the catalog");
      return;
    }
    const body: CatalogResponse = await res.json();
    setData(body);
    setSelected((prev) => select ?? prev ?? body.items[0]?.entry.name ?? null);
  }

  useEffect(() => {
    load();
    fetch("/api/themes")
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: ThemeRow[]) => {
        setThemes(rows);
        setThemeName((prev) => prev || rows.find((r) => r.doc)?.name || "");
      })
      .catch(() => {});
  }, []);

  const current = useMemo(
    () => data?.items.find((i) => i.entry.name === selected) ?? null,
    [data, selected]
  );
  const theme = themes.find((t) => t.name === themeName)?.doc ?? null;

  // Sample props recomputed with the selection, so the props handed to the
  // player always belong to the component being rendered.
  const sample = useMemo(() => {
    if (!current) return {};
    // a template-backed entry has no hand-written sample; the template's own
    // sample shows it at its best, narrowed to the props the entry declares
    if (current.renderedBy === "template") {
      const def = data?.templates.find((x) => x.kind === current.entry.template);
      if (def) {
        const declared = Object.keys(current.entry.props ?? {});
        return Object.fromEntries(
          Object.entries(def.sample).filter(([k]) => declared.length === 0 || declared.includes(k))
        );
      }
    }
    return sampleProps(current.entry);
  }, [current?.entry.name, current?.entry.props, current?.renderedBy, data?.templates]);
  const forThis = override?.name === current?.entry.name ? override : null;
  const propsText = forThis?.text ?? JSON.stringify(sample, null, 2);
  const previewProps = forThis?.parsed ?? sample;
  const propsError = forThis?.error ?? null;

  // Per-selection UI state that IS safe to reset in an effect (nothing renders
  // off it before the effect runs)
  useEffect(() => {
    setEditing(null);
    setShowJson(false);
    setError(null);
    setAllowance(null);
  }, [current?.entry.name]);

  const packs = useMemo(() => {
    const names = new Set((data?.items ?? []).map((i) => i.entry.pack));
    return ["all", ...[...names].sort()];
  }, [data]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.items ?? []).filter(({ entry }) => {
      if (packFilter !== "all" && entry.pack !== packFilter) return false;
      if (!q) return true;
      return (
        entry.name.toLowerCase().includes(q) ||
        entry.when_to_use.toLowerCase().includes(q) ||
        entry.anchor_types.some((a) => a.includes(q))
      );
    });
  }, [data, query, packFilter]);

  const grouped = useMemo(() => {
    const out = new Map<string, CatalogItem[]>();
    for (const item of visible) {
      const list = out.get(item.entry.pack) ?? [];
      list.push(item);
      out.set(item.entry.pack, list);
    }
    return [...out.entries()].sort(([a], [b]) => (a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b)));
  }, [visible]);

  const unimplemented = (data?.items ?? []).filter((i) => !i.implemented).length;

  // Which style packs currently offer the selected component. Allowance is by
  // PACK, so this is really "which styles allow the pack this component is in" —
  // toggling one moves every sibling in that pack with it, which the hint says.
  const allowingPacks = useMemo(() => {
    if (!current || !data) return [];
    return data.stylePacks
      .filter((p) => p.allowedPacks?.includes(current.entry.pack))
      .map((p) => p.name);
  }, [current, data]);
  const allowanceDraft = allowance ?? allowingPacks;
  const allowanceDirty =
    allowance !== null &&
    JSON.stringify([...allowance].sort()) !== JSON.stringify([...allowingPacks].sort());

  /** Edit the preview props; the last parseable value keeps rendering. */
  function editPropsText(text: string) {
    if (!current) return;
    const name = current.entry.name;
    const keep = forThis?.parsed ?? sample;
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setOverride({ name, text, parsed: keep, error: "props must be a JSON object" });
        return;
      }
      setOverride({ name, text, parsed: parsed as Record<string, unknown>, error: null });
    } catch (e) {
      setOverride({ name, text, parsed: keep, error: e instanceof Error ? e.message : "invalid JSON" });
    }
  }

  async function saveAllowance() {
    if (!current || allowance === null) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/catalog/${current.entry.name}/style-packs`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ packs: allowance }),
    });
    setBusy(false);
    if (res.ok) {
      setAllowance(null);
      load(current.entry.name);
    } else setError((await res.json()).error ?? "failed");
  }

  async function saveEntry() {
    if (!editing) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/catalog/${editing.name}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setBusy(false);
    if (res.ok) {
      setEditing(null);
      load(editing.name);
    } else setError((await res.json()).error ?? "failed");
  }

  async function removeEntry() {
    if (!current) return;
    if (!confirm(`Delete ${current.entry.name} from ${current.source}?`)) return;
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/catalog/${current.entry.name}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      setSelected(null);
      load();
    } else setError((await res.json()).error ?? "failed");
  }

  async function deletePack() {
    const count = (data?.items ?? []).filter((i) => i.entry.pack === packFilter).length;
    if (!confirm(`Delete pack "${packFilter}" and its ${count} component entr${count === 1 ? "y" : "ies"}?`)) {
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/catalog/packs/${packFilter}`, { method: "DELETE" });
    setBusy(false);
    if (res.ok) {
      const body = await res.json();
      setNotice(`Deleted pack "${body.pack}" (${body.removed} entries).`);
      setPackFilter("all");
      setSelected(null);
      load();
    } else setError((await res.json()).error ?? "failed");
  }

  async function createEntry() {
    if (!createDraft) return;
    setError(null);
    if (!COMPONENT_NAME_RE.test(createDraft.name)) {
      setError("name must be PascalCase (e.g. FactCard)");
      return;
    }
    if (!PACK_NAME_RE.test(createDraft.pack) || createDraft.pack === "core") {
      setError("pack must be a lowercase slug and cannot be 'core'");
      return;
    }
    setBusy(true);
    const res = await fetch("/api/catalog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pack: createDraft.pack, entry: createDraft }),
    });
    setBusy(false);
    if (res.ok) {
      const name = createDraft.name;
      setCreateDraft(null);
      load(name);
    } else setError((await res.json()).error ?? "failed");
  }

  const entryForPreview = editing ?? current?.entry ?? null;

  return (
    <div className="page">
      <div className="pageHead">
        <div>
          <h1 className="pageTitle">Overlays</h1>
          <div className="pageSub">
            {data ? data.items.length : "…"} components · {packs.length - 1} pack
            {packs.length === 2 ? "" : "s"}
            {unimplemented > 0 && ` · ${unimplemented} with no renderer`} · the only effects a
            plan may reference
          </div>
        </div>
        <div className={s.headActions}>
          <button
            onClick={() => {
              setError(null);
              setNotice(null);
              setShowImport(true);
            }}
          >
            Import pack
          </button>
          <button
            className="primary"
            onClick={() => {
              setError(null);
              setCreateDraft(newEntry(data?.dataPacks[0] ?? ""));
            }}
          >
            New overlay
          </button>
        </div>
      </div>

      {notice && <div className={s.okNotice}>{notice}</div>}

      {data?.loadErrors.length ? (
        <div className={s.errors}>
          <div className={s.errTitle}>Component pack problems</div>
          {data.loadErrors.map((e, i) => (
            <div key={i} className={s.errLine}>
              {e}
            </div>
          ))}
        </div>
      ) : null}

      <div className={s.layout}>
        <div className={s.sidebar}>
          <input
            className={s.search}
            name="search"
            placeholder="Search name or use…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className={s.packTabs}>
            {packs.map((p) => (
              <button
                key={p}
                className={`${s.packTab}${packFilter === p ? " " + s.packTabOn : ""}`}
                onClick={() => setPackFilter(p)}
              >
                {p}
              </button>
            ))}
          </div>

          {packFilter !== "all" && packFilter !== "core" && (
            <div className={s.packBar}>
              <a
                className={s.packLink}
                href={`/api/catalog/packs/${packFilter}`}
                download={`${packFilter}.json`}
              >
                export
              </a>
              <button className={s.packLink} onClick={deletePack} disabled={busy}>
                delete pack
              </button>
            </div>
          )}

          <div className={s.list}>
            {grouped.map(([pack, items]) => (
              <div key={pack}>
                <div className={s.groupLabel}>
                  {pack} · {items.length}
                </div>
                {items.map((item) => (
                  <button
                    key={item.entry.name}
                    className={`${s.listItem}${item.entry.name === selected ? " " + s.listActive : ""}`}
                    onClick={() => setSelected(item.entry.name)}
                  >
                    <span className={s.itemName}>{item.entry.name}</span>
                    <span className={s.itemMeta}>
                      {item.entry.anchor_types.length
                        ? item.entry.anchor_types.join(" · ")
                        : "pure text"}
                    </span>
                    {!item.implemented && <span className={s.warnDot} title="no renderer" />}
                  </button>
                ))}
              </div>
            ))}
            {visible.length === 0 && <div className={s.empty}>Nothing matches.</div>}
          </div>
        </div>

        <div className={s.detail}>
          {!current && <div className={s.empty}>Select a component.</div>}
          {current && entryForPreview && (
            <>
              <div className={s.detailHead}>
                <div>
                  <div className={s.detailTitle}>
                    {current.entry.name}
                    <span className={s.badge}>{current.entry.pack}</span>
                    {current.renderedBy === "template" && (
                      <span className={s.badgeOk}>template · {current.entry.template}</span>
                    )}
                    {!current.implemented && <span className={s.badgeWarn}>no renderer</span>}
                    {editing && <span className={s.badgeWarn}>editing</span>}
                  </div>
                  <div className={s.detailSub}>
                    {current.editable
                      ? `contracts/component-packs/${current.source}`
                      : "engine/src/catalog/registry.ts → contracts/catalog.json"}
                  </div>
                </div>
                <div className={s.headActions}>
                  {editing ? (
                    <>
                      <button onClick={() => setEditing(null)}>Cancel</button>
                      <button className="primary" onClick={saveEntry} disabled={busy}>
                        {busy ? "Saving…" : "Save entry"}
                      </button>
                    </>
                  ) : (
                    <>
                      <button onClick={() => setShowJson((v) => !v)}>
                        {showJson ? "Hide JSON" : "View JSON"}
                      </button>
                      {current.editable && (
                        <>
                          <button onClick={() => setEditing(structuredClone(current.entry))}>
                            Edit
                          </button>
                          <button onClick={removeEntry} disabled={busy}>
                            Delete
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              </div>

              {error && <div className={s.formError}>{error}</div>}

              {current.errors.length > 0 && (
                <div className={s.errors}>
                  <div className={s.errTitle}>Does not match catalog_entry.schema.json</div>
                  {current.errors.map((e, i) => (
                    <div key={i} className={s.errLine}>
                      {e}
                    </div>
                  ))}
                </div>
              )}

              {!current.implemented && (
                <div className={s.notice}>
                  <strong>Nothing draws this entry yet.</strong> A catalog entry is metadata: the
                  planner may choose it and the validator accepts it, but the overlay renders empty.
                  Two ways out —
                  <ol className={s.recipe}>
                    <li>
                      <strong>No code:</strong> press <em>Edit</em> and pick a{" "}
                      <code>template</code> ({(data?.templates ?? []).map((t) => t.kind).join(", ")}
                      ). The engine draws it from your props, and it is usable in the next video
                      once a style pack below offers it.
                    </li>
                    <li>
                      <strong>Its own component:</strong> add{" "}
                      <code>engine/src/components/core/{current.entry.name}.tsx</code> taking{" "}
                      <code>{"{ props, theme }"}</code> (appearance from the theme runtime, sizes
                      relative to <code>useVideoConfig()</code>), register it in{" "}
                      <code>engine/src/components/index.ts</code>, and leave this entry as it is.
                    </li>
                  </ol>
                </div>
              )}

              <div className={s.previewRow}>
                <div className={s.previewBox}>
                  {theme ? (
                    <OverlayPreview
                      component={current.entry.name}
                      props={previewProps}
                      theme={theme}
                      template={entryForPreview.template ?? null}
                      durationSeconds={previewDuration(entryForPreview)}
                      backdropImage={backdrop}
                    />
                  ) : (
                    <div className={s.empty}>No theme to preview with.</div>
                  )}
                </div>
                <div className={s.previewSide}>
                  <div className={s.sideField}>
                    <span className={s.sideLabel}>
                      BACKDROP
                      {backdrop && (
                        <button className={s.reset} onClick={() => setBackdrop(null)}>
                          clear
                        </button>
                      )}
                    </span>
                    <label className={s.backdropDrop}>
                      <input
                        type="file"
                        name="preview-backdrop"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          // Clear the input either way: picking the SAME file
                          // twice fires no change event otherwise, so a failed
                          // decode could never be retried.
                          e.target.value = "";
                          if (!file) return;
                          setBackdropError(null);
                          try {
                            setBackdrop(await fileToBackdrop(file));
                          } catch (err) {
                            setBackdropError(
                              err instanceof Error ? err.message : "could not read that file"
                            );
                          }
                        }}
                      />
                      {backdrop ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className={s.backdropThumb} src={backdrop} alt="" />
                      ) : (
                        <span className={s.backdropHint}>choose a frame…</span>
                      )}
                    </label>
                    {backdropError ? (
                      <span className={s.formError}>{backdropError}</span>
                    ) : (
                      <span className={s.sideHint}>
                        a real frame to stand the overlay on — stays in this browser, and
                        the Look grid uses it too
                      </span>
                    )}
                  </div>
                  <label className={s.sideField}>
                    <span className={s.sideLabel}>THEME</span>
                    <select
                      name="preview-theme"
                      value={themeName}
                      onChange={(e) => setThemeName(e.target.value)}
                    >
                      {themes
                        .filter((t) => t.doc)
                        .map((t) => (
                          <option key={t.name} value={t.name}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <div className={s.sideField}>
                    <span className={s.sideLabel}>
                      PROPS
                      <button className={s.reset} onClick={() => setOverride(null)}>
                        reset
                      </button>
                    </span>
                    <textarea
                      name="preview-props"
                      className={s.propsEditor}
                      value={propsText}
                      spellCheck={false}
                      onChange={(e) => editPropsText(e.target.value)}
                    />
                    {propsError ? (
                      <span className={s.formError}>{propsError}</span>
                    ) : (
                      <span className={s.sideHint}>
                        {hasHandWrittenSample(current.entry.name)
                          ? "engine sample props — edit to try values"
                          : "synthesized from the props spec — edit to try values"}
                      </span>
                    )}
                  </div>
                  <div className={s.sideHint}>
                    {previewDuration(entryForPreview)}s at 30fps ·{" "}
                    {current.entry.duration_hint_s
                      ? `hint ${current.entry.duration_hint_s.min ?? "—"}–${
                          current.entry.duration_hint_s.max ?? "∞"
                        }s`
                      : "no duration hint"}
                  </div>
                </div>
              </div>

              {editing ? (
                <div className={s.section}>
                  <div className={s.sectionLabel}>ENTRY</div>
                  <CatalogEntryFields
                    value={editing}
                    onChange={setEditing}
                    mode="edit"
                    packs={data?.dataPacks ?? []}
                    templates={data?.templates ?? []}
                  />
                </div>
              ) : (
                <>
                  <div className={s.rules}>
                    <div className={s.ruleCard}>
                      <div className={s.ruleLabel}>WHEN TO USE</div>
                      <div className={s.ruleText}>{current.entry.when_to_use}</div>
                    </div>
                    <div className={`${s.ruleCard} ${s.ruleCardNot}`}>
                      <div className={s.ruleLabel}>WHEN NOT TO USE</div>
                      <div className={s.ruleText}>{current.entry.when_not_to_use}</div>
                    </div>
                  </div>

                  <div className={s.section}>
                    <div className={s.sectionLabel}>ANCHORS</div>
                    <div className={s.chips}>
                      {current.entry.anchor_types.length ? (
                        current.entry.anchor_types.map((a: AnchorType) => (
                          <span key={a} className={s.chip}>
                            {a}
                          </span>
                        ))
                      ) : (
                        <span className={s.chipMuted}>pure text — attachable to any beat</span>
                      )}
                    </div>
                  </div>

                  <div className={s.section}>
                    <div className={s.sectionLabel}>PROPS</div>
                    <div className={s.propsTable}>
                      <div className={s.propsHead}>
                        <div>PROP</div>
                        <div>TYPE</div>
                        <div>RULES</div>
                      </div>
                      {propRows(current.entry.props).map(({ key, spec }) => (
                        <div key={key} className={s.propRow}>
                          <div className={s.propName}>
                            {key}
                            {spec.required && <span className={s.req}>required</span>}
                          </div>
                          <div className={s.propType}>{typeLabel(spec)}</div>
                          <div className={s.propRules}>
                            {constraints(spec)}
                            {spec.description && (
                              <div className={s.propDesc}>{spec.description}</div>
                            )}
                          </div>
                        </div>
                      ))}
                      {Object.keys(current.entry.props).length === 0 && (
                        <div className={s.empty}>No props.</div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <div className={s.section}>
                <div className={s.sectionLabel}>
                  STYLE PACKS ALLOWING THIS COMPONENT&apos;S PACK
                  {allowanceDirty && (
                    <button className={s.saveAllow} onClick={saveAllowance} disabled={busy}>
                      {busy ? "Saving…" : "Save allowances"}
                    </button>
                  )}
                </div>
                <div className={s.chips}>
                  {(data?.stylePacks ?? []).map((p) => {
                    if (p.allowedPacks === undefined) {
                      return (
                        <span key={p.name} className={s.chipMuted}>
                          {p.name} · allows every pack
                        </span>
                      );
                    }
                    const on = allowanceDraft.includes(p.name);
                    return (
                      <label key={p.name} className={`${s.toggle}${on ? " " + s.toggleOn : ""}`}>
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() =>
                            setAllowance(
                              on
                                ? allowanceDraft.filter((n) => n !== p.name)
                                : [...allowanceDraft, p.name]
                            )
                          }
                        />
                        {p.name}
                      </label>
                    );
                  })}
                </div>
                <div className={s.sideHint}>
                  Allowance is by <strong>component pack</strong>, so these toggle whether each style
                  allows <strong>{current.entry.pack}</strong> — every component in that pack moves
                  together. A style that does not allow the pack is never offered its components, and
                  the validator rejects them in a plan. Edit a style&apos;s pacing and density on{" "}
                  <a href="/style-packs">Style Packs</a>.
                </div>
              </div>

              {showJson && (
                <pre className={s.json}>{JSON.stringify(current.entry, null, 2)}</pre>
              )}
            </>
          )}
        </div>
      </div>

      {showImport && (
        <div className={s.overlay} onClick={() => setShowImport(false)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>Import component pack</div>
              <button onClick={() => setShowImport(false)}>Close</button>
            </div>
            <PackImport
              onClose={() => setShowImport(false)}
              onImported={(result) => {
                setShowImport(false);
                setNotice(
                  `Imported ${result.imported} component${result.imported === 1 ? "" : "s"} into "${
                    result.pack
                  }".` +
                    (result.no_renderer.length
                      ? ` ${result.no_renderer.length} need an engine component: ${result.no_renderer.join(", ")}.`
                      : "") +
                    " Tick the style packs that should offer them."
                );
                setPackFilter(result.pack);
                load(result.no_renderer[0] ?? undefined);
              }}
            />
          </div>
        </div>
      )}

      {createDraft && (
        <div className={s.overlay} onClick={() => setCreateDraft(null)}>
          <div className={s.modal} onClick={(e) => e.stopPropagation()}>
            <div className={s.modalHead}>
              <div className={s.modalTitle}>New overlay</div>
              <button onClick={() => setCreateDraft(null)}>Close</button>
            </div>
            <div className={s.notice}>
              This writes a catalog <em>entry</em> — the planner menu and validator side. The
              animation itself is a React component in the engine; until it exists the entry shows
              as <strong>no renderer</strong> and draws nothing.
            </div>
            <CatalogEntryFields
              value={createDraft}
              onChange={setCreateDraft}
              mode="create"
              packs={data?.dataPacks ?? []}
              templates={data?.templates ?? []}
            />
            {error && <div className={s.formError}>{error}</div>}
            <div className={s.modalActions}>
              <button onClick={() => setCreateDraft(null)}>Cancel</button>
              <button className="primary" onClick={createEntry} disabled={busy}>
                {busy ? "Creating…" : "Create entry"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
