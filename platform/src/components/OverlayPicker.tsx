"use client";
/**
 * Pick a beat's overlay from the components THIS VIDEO can draw, and fill in
 * the props that component declares.
 *
 * The menu is `cfg.style_pack_doc.overlays.allowed_components` — the list
 * resolved at enqueue from the style pack's allowed packs and the channel's
 * `look.exclude.components` (see lib/look.ts), and the same list the planner
 * was offered and the validator will enforce. Offering the whole catalog here
 * would let a human pick a component that fails at compile with a message
 * about a stage they never touched, which is exactly the failure
 * lib/overlayRules.ts exists to stop.
 *
 * Props come from the catalog entry rather than a JSON textarea, so the shape
 * is not something to remember: an enum is a dropdown, a number is a number,
 * and `from_anchor`/`computed` props are labelled as what the compiler fills
 * in from the beat's anchor. The JSON is still there, one toggle away — a prop
 * of type object or array is edited as JSON either way.
 */
import { useMemo, useState } from "react";
import type { Anchor, Beat, BeatOverlay, CatalogEntry, CatalogPropSpec } from "@lusora/contracts";
import { Dropdown, TextInput, Toggle } from "@/components/ds";
import scr from "@/app/(app)/screen.module.css";
import s from "./OverlayPicker.module.css";

const UNSET = "—";

function constraintNote(spec: CatalogPropSpec): string {
  const bits: string[] = [];
  if (spec.required) bits.push("required");
  if (spec.min !== undefined) bits.push(`min ${spec.min}`);
  if (spec.max !== undefined) bits.push(`max ${spec.max}`);
  if (spec.maxWords !== undefined) bits.push(`≤ ${spec.maxWords} words`);
  if (spec.default !== undefined) bits.push(`default ${JSON.stringify(spec.default)}`);
  if (spec.from_anchor) bits.push(`filled from anchor.${spec.from_anchor}`);
  if (spec.computed) bits.push(`computed: ${spec.computed}`);
  return bits.join(" · ");
}

function anchorLabel(anchor: Anchor, i: number): string {
  const value =
    anchor.value === undefined || anchor.value === null
      ? anchor.source_words
      : typeof anchor.value === "object"
      ? JSON.stringify(anchor.value)
      : String(anchor.value);
  return `${i} · ${anchor.type} — ${anchor.label ?? value}`.slice(0, 70);
}

/**
 * One prop. Structured values (array/object) keep a JSON editor of their own,
 * with the last parseable text held locally so a half-typed bracket does not
 * throw away what was there.
 */
function PropField({
  name,
  spec,
  value,
  disabled,
  onChange,
}: {
  name: string;
  spec: CatalogPropSpec;
  value: unknown;
  disabled: boolean;
  onChange: (next: unknown) => void;
}) {
  const structured = spec.type === "array" || spec.type === "object";
  const [text, setText] = useState(() =>
    structured && value !== undefined ? JSON.stringify(value, null, 2) : ""
  );
  const [error, setError] = useState<string | null>(null);
  const note = constraintNote(spec);
  // The catalog's descriptions are a sentence or two of guidance, so they go
  // UNDER the field: a label the length of a paragraph is not a label.
  const label = name;
  const help = spec.description ? (
    <div className={s.help}>{spec.description}</div>
  ) : null;

  if (spec.enum?.length) {
    const options = [
      { value: UNSET, label: "— unset —" },
      ...spec.enum.map((v) => ({ value: String(v), label: String(v) })),
    ];
    return (
      <div className={s.field}>
        <Dropdown
          label={label}
          options={options}
          value={value === undefined ? UNSET : String(value)}
          disabled={disabled}
          onChange={(v) => {
            if (v === UNSET) return onChange(undefined);
            const match = spec.enum!.find((e) => String(e) === v);
            onChange(match ?? v);
          }}
        />
        {help}
        {note && <div className={s.note}>{note}</div>}
      </div>
    );
  }

  if (spec.type === "boolean") {
    return (
      <div className={`${s.field} ${s.boolRow}`}>
        <div>
          <div className={s.boolLabel}>{label}</div>
          {help}
          {note && <div className={s.note}>{note}</div>}
        </div>
        <Toggle
          checked={value === true}
          disabled={disabled}
          onChange={(next) => onChange(next ? true : undefined)}
        />
      </div>
    );
  }

  if (spec.type === "number") {
    return (
      <div className={s.field}>
        <TextInput
          label={label}
          type="number"
          min={spec.min}
          max={spec.max}
          disabled={disabled}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            if (raw === "") return onChange(undefined);
            const n = Number(raw);
            onChange(Number.isNaN(n) ? raw : n);
          }}
        />
        {help}
        {note && <div className={s.note}>{note}</div>}
      </div>
    );
  }

  if (structured) {
    return (
      <div className={s.field}>
        <TextInput
          label={`${label} (${spec.type === "array" ? "array" : "object"} · JSON)`}
          multiline
          rows={4}
          disabled={disabled}
          error={error}
          value={text}
          onChange={(e) => {
            const raw = e.currentTarget.value;
            setText(raw);
            if (raw.trim() === "") {
              setError(null);
              return onChange(undefined);
            }
            try {
              onChange(JSON.parse(raw));
              setError(null);
            } catch {
              setError("not valid JSON yet — the last valid value is kept");
            }
          }}
        />
        {help}
        {note && <div className={s.note}>{note}</div>}
      </div>
    );
  }

  const long = (spec.maxWords ?? 0) > 10;
  return (
    <div className={s.field}>
      <TextInput
        label={label}
        multiline={long}
        rows={3}
        disabled={disabled}
        value={value === undefined || value === null ? "" : String(value)}
        onChange={(e) => {
          const raw = e.currentTarget.value;
          onChange(raw === "" ? undefined : raw);
        }}
      />
      {help}
      {note && <div className={s.note}>{note}</div>}
    </div>
  );
}

export default function OverlayPicker({
  beat,
  catalog,
  allowed,
  emphasisEnabled,
  disabled = false,
  onChange,
}: {
  beat: Beat;
  /** The whole merged catalog, so a component off the menu can still be named. */
  catalog: CatalogEntry[];
  /** This video's resolved menu; null means the snapshot named no list. */
  allowed: string[] | null;
  /** D59/D86 — whether the pure-text class is available on this style pack. */
  emphasisEnabled: boolean;
  disabled?: boolean;
  onChange: (overlay: BeatOverlay | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const [showJson, setShowJson] = useState(false);

  const menu = useMemo(() => {
    const list =
      allowed && allowed.length ? catalog.filter((e) => allowed.includes(e.name)) : catalog;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [catalog, allowed]);

  const overlay = beat.overlay;
  const entry = catalog.find((e) => e.name === overlay?.component) ?? null;
  const offMenu = !!overlay && !menu.some((e) => e.name === overlay.component);
  const anchors: Anchor[] = beat.anchors ?? [];
  // D86: a component with no anchor types carries no fact, so it is emphasis
  // whatever the sheet says — and a style pack that does not use that class
  // cannot take it.
  // A timed beat carries no narration, so it carries no anchor and every
  // overlay on one is pure text by construction: it sits outside the class
  // system entirely, the same exemption lib/overlayRules.ts makes.
  const emphasisOnly = !!entry && entry.anchor_types.length === 0 && beat.kind !== "timed";

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return menu;
    return menu.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.pack.toLowerCase().includes(q) ||
        e.when_to_use.toLowerCase().includes(q)
    );
  }, [menu, query]);

  function pick(name: string | null) {
    if (!name) return onChange(undefined);
    if (name === overlay?.component) return;
    // Props belong to the component that declared them, so a change of
    // component drops them rather than carrying an unknown prop across —
    // which is exactly what the validator rejects. The anchor is preselected
    // only when the beat actually holds one this component can take.
    const picked = catalog.find((e) => e.name === name);
    const ref = picked?.anchor_types.length
      ? anchors.findIndex((a) => picked.anchor_types.includes(a.type))
      : -1;
    onChange({ component: name, ...(ref >= 0 ? { anchor_ref: ref } : {}) });
  }

  function setProp(key: string, value: unknown) {
    if (!overlay) return;
    const props = { ...(overlay.props_hint ?? {}) };
    if (value === undefined) delete props[key];
    else props[key] = value;
    onChange({ ...overlay, props_hint: Object.keys(props).length ? props : undefined });
  }

  const propEntries = Object.entries(entry?.props ?? {});

  return (
    <div className={s.wrap}>
      {menu.length > 8 && (
        <TextInput
          placeholder={`Filter ${menu.length} components…`}
          value={query}
          disabled={disabled}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      )}

      <div className={s.menu}>
        <button
          type="button"
          disabled={disabled}
          className={`${s.option}${overlay ? "" : " " + s.on}`}
          onClick={() => pick(null)}
        >
          <span className={s.optionName}>None</span>
          <span className={s.optionMeta}>no overlay on this beat</span>
        </button>
        {visible.map((e) => (
          <button
            key={e.name}
            type="button"
            disabled={disabled}
            title={e.when_to_use}
            className={`${s.option}${overlay?.component === e.name ? " " + s.on : ""}`}
            onClick={() => pick(e.name)}
          >
            <span className={s.optionName}>{e.name}</span>
            <span className={s.optionMeta}>
              {e.pack} · {e.anchor_types.length ? e.anchor_types.join(", ") : "no anchor"}
            </span>
          </button>
        ))}
        {visible.length === 0 && <div className={s.empty}>Nothing matches “{query}”.</div>}
      </div>

      {offMenu && (
        <div className={`${scr.notice} ${scr.noticeWarn}`}>
          <span>
            <strong>{overlay!.component}</strong>{" "}
            {entry
              ? "is not in this video's component menu — the compile will refuse it. Pick one above."
              : "is not in the catalog at all — the compile will refuse it. Pick one above."}
          </span>
        </div>
      )}

      {entry && (
        <>
          <div className={s.about}>
            <div className={s.aboutRow}>
              <span className={s.aboutLabel}>Use it when</span>
              <span>{entry.when_to_use}</span>
            </div>
            <div className={s.aboutRow}>
              <span className={s.aboutLabel}>Not when</span>
              <span>{entry.when_not_to_use}</span>
            </div>
            {entry.duration_hint_s?.default !== undefined && (
              <div className={s.aboutRow}>
                <span className={s.aboutLabel}>Holds</span>
                <span>{entry.duration_hint_s.default}s by default</span>
              </div>
            )}
          </div>

          {emphasisOnly && !emphasisEnabled && (
            <div className={`${scr.notice} ${scr.noticeWarn}`}>
              <span>
                <strong>{entry.name} carries no anchor,</strong> so it can only ever be an emphasis
                overlay — and this video&apos;s style pack does not use that class.
              </span>
            </div>
          )}

          {entry.anchor_types.length > 0 && (
            <div className={s.field}>
              <Dropdown
                label="Anchor this overlay carries"
                disabled={disabled || anchors.length === 0}
                options={anchors.map((a, i) => ({ value: String(i), label: anchorLabel(a, i) }))}
                emptyNote="This beat has no anchors — the planner found no fact to carry."
                value={overlay?.anchor_ref === undefined ? null : String(overlay.anchor_ref)}
                placeholder="Pick an anchor…"
                onChange={(v) => overlay && onChange({ ...overlay, anchor_ref: Number(v) })}
              />
              <div className={s.note}>
                {anchors.length === 0
                  ? `${entry.name} needs one of ${entry.anchor_types.join(", ")} — this beat has none, so the compile will refuse it.`
                  : `Takes ${entry.anchor_types.join(", ")}.`}
              </div>
              {overlay?.anchor_ref !== undefined &&
                anchors[overlay.anchor_ref] &&
                !entry.anchor_types.includes(anchors[overlay.anchor_ref].type) && (
                  <div className={s.problem}>
                    That anchor is a {anchors[overlay.anchor_ref].type}; {entry.name} cannot attach
                    to it.
                  </div>
                )}
            </div>
          )}

          <div className={s.propsHead}>
            <span className={scr.eyebrow} style={{ marginBottom: 0 }}>
              Props · {propEntries.length}
            </span>
            <button type="button" className={s.link} onClick={() => setShowJson((v) => !v)}>
              {showJson ? "Use the fields" : "Edit as JSON"}
            </button>
          </div>

          {propEntries.length === 0 && !showJson && (
            <div className={s.empty}>{entry.name} declares no props.</div>
          )}

          {showJson ? (
            <TextInput
              label="props_hint (JSON)"
              multiline
              rows={8}
              disabled={disabled}
              value={JSON.stringify(overlay?.props_hint ?? {}, null, 2)}
              onChange={(e) => {
                const raw = e.currentTarget.value;
                try {
                  const parsed = JSON.parse(raw) as Record<string, unknown>;
                  if (overlay) onChange({ ...overlay, props_hint: parsed });
                } catch {
                  /* keep the last valid object; the field re-renders from it */
                }
              }}
            />
          ) : (
            propEntries.map(([name, spec]) => (
              <PropField
                // Remounting per component keeps a JSON field's local text from
                // outliving the props it was editing.
                key={`${beat.id}:${entry.name}:${name}`}
                name={name}
                spec={spec}
                value={overlay?.props_hint?.[name]}
                disabled={disabled}
                onChange={(v) => setProp(name, v)}
              />
            ))
          )}

          {!showJson &&
            Object.keys(overlay?.props_hint ?? {}).filter((k) => !(k in (entry.props ?? {}))).length >
              0 && (
              <div className={s.problem}>
                Props the component does not declare, which the compile will refuse:{" "}
                {Object.keys(overlay!.props_hint!)
                  .filter((k) => !(k in (entry.props ?? {})))
                  .join(", ")}
                . Switch to JSON to remove them.
              </div>
            )}
        </>
      )}
    </div>
  );
}
