"use client";
/**
 * A catalog entry as a form. Shared by the Overlays screen's create modal and
 * its inline editor.
 *
 * `when_to_use` / `when_not_to_use` are the load-bearing fields: the whole
 * catalog sits in the prompt of every plan call, so they are selection rules
 * for an LLM ("what wins in the neighbouring case"), not descriptions. The
 * placeholders say so, because an entry written as a description quietly makes
 * the planner worse rather than failing.
 */
import { useEffect, useState } from "react";
import type { AnchorType, CatalogEntry } from "@lusora/contracts";
import s from "./form.module.css";

export const ANCHOR_TYPES: AnchorType[] = [
  "number",
  "percentage",
  "comparison",
  "place",
  "date",
  "name",
  "quote",
];

export const COMPONENT_NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
export const PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function newEntry(pack: string): CatalogEntry {
  return {
    name: "",
    pack,
    when_to_use: "",
    when_not_to_use: "",
    anchor_types: [],
    props: {},
    duration_hint_s: { min: 2.5, default: 4 },
    renderer: "remotion",
  };
}

function numOrUndef(v: string): number | undefined {
  if (v.trim() === "") return undefined;
  const n = Number(v);
  return Number.isNaN(n) ? undefined : n;
}

export interface TemplateChoice {
  kind: string;
  label: string;
  summary: string;
  when_to_use: string;
  when_not_to_use: string;
  props: Record<string, unknown>;
  sample: Record<string, unknown>;
  duration_hint_s: { min: number; default: number };
}

export default function CatalogEntryFields({
  value,
  onChange,
  mode,
  packs,
  templates,
}: {
  value: CatalogEntry;
  onChange: (next: CatalogEntry) => void;
  mode: "create" | "edit";
  /** Existing data packs, offered alongside "new pack…" on create. */
  packs: string[];
  /** Engine templates that can draw an entry without any new code. */
  templates: TemplateChoice[];
}) {
  // The props spec is edited as JSON: a prop-by-prop builder would hide the
  // nesting (items / properties) that the interesting components need.
  const [propsText, setPropsText] = useState(() => JSON.stringify(value.props ?? {}, null, 2));
  const [propsError, setPropsError] = useState<string | null>(null);
  const [newPack, setNewPack] = useState(mode === "create" && packs.length === 0);

  useEffect(() => {
    // reset the buffer when the form is pointed at a different entry
    setPropsText(JSON.stringify(value.props ?? {}, null, 2));
    setPropsError(null);
  }, [value.name, mode]);

  function editProps(text: string) {
    setPropsText(text);
    try {
      const parsed = JSON.parse(text);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        setPropsError("props must be a JSON object");
        return;
      }
      setPropsError(null);
      onChange({ ...value, props: parsed });
    } catch (e) {
      setPropsError(e instanceof Error ? e.message : "invalid JSON");
    }
  }

  const chosen = templates.find((t) => t.kind === value.template);

  /**
   * Switching template rewrites the props block to that template's vocabulary —
   * anything else would be rejected on save, since the template would not read
   * it. Empty rule fields get the template's seed text to sharpen.
   */
  function applyTemplate(kind: string) {
    const template = templates.find((t) => t.kind === kind);
    if (!template) {
      onChange({ ...value, template: undefined });
      return;
    }
    const next: CatalogEntry = {
      ...value,
      template: kind as CatalogEntry["template"],
      props: template.props as CatalogEntry["props"],
      when_to_use: value.when_to_use.trim() || template.when_to_use,
      when_not_to_use: value.when_not_to_use.trim() || template.when_not_to_use,
      duration_hint_s: value.duration_hint_s ?? template.duration_hint_s,
    };
    setPropsText(JSON.stringify(next.props, null, 2));
    setPropsError(null);
    onChange(next);
  }

  function toggleAnchor(anchor: AnchorType) {
    const has = value.anchor_types.includes(anchor);
    onChange({
      ...value,
      anchor_types: has
        ? value.anchor_types.filter((a) => a !== anchor)
        : [...value.anchor_types, anchor],
    });
  }

  const dur = value.duration_hint_s ?? {};
  const setDur = (key: "min" | "default" | "max", raw: string) => {
    const next = { ...dur, [key]: numOrUndef(raw) };
    for (const k of ["min", "default", "max"] as const) if (next[k] === undefined) delete next[k];
    onChange({ ...value, duration_hint_s: Object.keys(next).length ? next : undefined });
  };

  return (
    <div className={s.form}>
      <label className={s.field}>
        <span className={s.fieldLabel}>name</span>
        <input
          name="component-name"
          value={value.name}
          placeholder="FactCard"
          spellCheck={false}
          disabled={mode === "edit"}
          readOnly={mode === "edit"}
          onChange={(e) => onChange({ ...value, name: e.target.value.trim() })}
        />
      </label>
      {mode === "create" && !COMPONENT_NAME_RE.test(value.name) && value.name !== "" && (
        <div className={s.error}>PascalCase only — it is also the React component name</div>
      )}

      <label className={s.field}>
        <span className={s.fieldLabel}>pack</span>
        {mode === "edit" ? (
          <input name="pack" value={value.pack} disabled readOnly />
        ) : newPack ? (
          <input
            name="pack"
            value={value.pack}
            placeholder="history"
            spellCheck={false}
            onChange={(e) => onChange({ ...value, pack: e.target.value.trim() })}
          />
        ) : (
          <select
            name="pack"
            value={value.pack}
            onChange={(e) => {
              if (e.target.value === "__new") {
                setNewPack(true);
                onChange({ ...value, pack: "" });
              } else onChange({ ...value, pack: e.target.value });
            }}
          >
            {packs.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
            <option value="__new">new pack…</option>
          </select>
        )}
      </label>
      <div className={s.hint}>
        {mode === "edit"
          ? `contracts/component-packs/${value.pack}.json`
          : "Written to contracts/component-packs/<pack>.json — 'core' is generated from the engine registry"}
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>template</span>
        <select
          name="template"
          value={value.template ?? ""}
          onChange={(e) => applyTemplate(e.target.value)}
        >
          <option value="">none — needs a React component in the engine</option>
          {templates.map((t) => (
            <option key={t.kind} value={t.kind}>
              {t.label} ({t.kind})
            </option>
          ))}
        </select>
      </label>
      <div className={s.hint}>
        {chosen
          ? `${chosen.summary} Drawn by the engine's TemplateOverlay — no code needed, usable in the next video.`
          : "Without a template the entry is metadata only: the planner may pick it and nothing will draw."}
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>when_to_use</span>
        <textarea
          name="when-to-use"
          className={s.textarea}
          value={value.when_to_use}
          placeholder="the narration lands a single figure worth dwelling on — a count, a total ('29,000 tanks')"
          onChange={(e) => onChange({ ...value, when_to_use: e.target.value })}
        />
      </label>

      <label className={s.field}>
        <span className={s.fieldLabel}>when_not_to_use</span>
        <textarea
          name="when-not-to-use"
          className={s.textarea}
          value={value.when_not_to_use}
          placeholder="name the sibling that wins in the neighbouring case: two values compared (ComparisonSplit); a corner figure (StatTag)"
          onChange={(e) => onChange({ ...value, when_not_to_use: e.target.value })}
        />
      </label>

      <div className={s.field}>
        <span className={s.fieldLabel}>anchor_types</span>
        <div className={s.checks}>
          {ANCHOR_TYPES.map((a) => {
            const on = value.anchor_types.includes(a);
            return (
              <label key={a} className={`${s.check}${on ? " " + s.checkOn : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggleAnchor(a)} />
                {a}
              </label>
            );
          })}
        </div>
        <div className={s.hint}>none selected = pure text, attachable to any beat</div>
      </div>

      <div className={s.field}>
        <span className={s.fieldLabel}>duration_hint_s</span>
        <div className={s.triple}>
          {(["min", "default", "max"] as const).map((k) => (
            <input
              key={k}
              name={`duration-${k}`}
              placeholder={k}
              value={dur[k] ?? ""}
              inputMode="decimal"
              onChange={(e) => setDur(k, e.target.value)}
            />
          ))}
        </div>
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>props</span>
        <textarea
          name="props"
          className={`${s.textarea} ${s.code}`}
          value={propsText}
          spellCheck={false}
          onChange={(e) => editProps(e.target.value)}
        />
      </label>
      {propsError ? (
        <div className={s.error}>{propsError}</div>
      ) : (
        <div className={s.hint}>
          Semantic props only — no colours, fonts or pixel positions. Props not
          listed here are rejected as unknown at validate time.
          {chosen && ` The "${chosen.kind}" template reads ${Object.keys(chosen.props).join(", ")} — drop what you don't want the planner to set, but don't add others.`}
        </div>
      )}
    </div>
  );
}
