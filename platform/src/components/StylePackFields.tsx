"use client";
/**
 * A style pack document as a form. Shared by the Style Packs screen's create
 * modal and its inline editor.
 *
 * The pacing numbers are constraints, not advice: the compiler clamps every
 * hold to [min_hold, max_hold] and validate rejects a beat count outside the
 * range avg_hold_seconds implies. The hints say so, because a pack edited as
 * if the numbers were suggestions fails a video several stages later.
 *
 * Option lists mirror style_pack.schema.json — there is no API for them.
 */
import type { OverlayDensity, StylePack, TransitionType, VideoType } from "@lusora/contracts";
import s from "./form.module.css";

export const VIDEO_TYPES: VideoType[] = ["doc", "explainer", "breakdown", "listicle"];
export const ARCS: NonNullable<StylePack["pacing"]["arc"]>[] = ["three_act", "linear", "listicle"];
export const TRANSITIONS: TransitionType[] = ["cut", "crossfade", "fade", "fade_to_black"];
export const NAMED_DENSITIES = ["low", "normal", "high"] as const;

export const STYLE_PACK_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function newStylePack(): StylePack {
  return {
    name: "",
    pacing: { avg_hold_seconds: 3.2, min_hold: 2, max_hold: 6, arc: "linear" },
    overlays: { density: "normal" },
    transitions: { allowed: ["cut", "crossfade", "fade_to_black"], default: "cut" },
    script_persona: "",
    visual_language: "",
  };
}

/** Client-side mirror of the parts of style_pack.schema.json this form can
 *  violate, plus the two orderings the schema cannot express. The API
 *  validates against the schema itself either way. */
export function stylePackProblems(pack: StylePack): string[] {
  const out: string[] = [];
  const { avg_hold_seconds: avg, min_hold: min, max_hold: max } = pack.pacing;
  for (const [key, v] of [
    ["avg_hold_seconds", avg],
    ["min_hold", min],
    ["max_hold", max],
  ] as const) {
    if (!Number.isFinite(v) || v <= 0) out.push(`pacing.${key} must be a number above 0`);
  }
  if (Number.isFinite(min) && Number.isFinite(avg) && min > avg) {
    out.push(`min_hold (${min}) is above avg_hold_seconds (${avg})`);
  }
  if (Number.isFinite(avg) && Number.isFinite(max) && avg > max) {
    out.push(`avg_hold_seconds (${avg}) is above max_hold (${max})`);
  }
  if (typeof pack.overlays.density === "object") {
    const per = pack.overlays.density.per_minute;
    if (!Number.isFinite(per) || per < 0) out.push("overlays.density.per_minute must be 0 or more");
  }
  if (pack.transitions.allowed.length === 0) out.push("at least one transition must be allowed");
  else if (!pack.transitions.allowed.includes(pack.transitions.default)) {
    out.push(`default transition "${pack.transitions.default}" is not in the allowed list`);
  }
  return out;
}

function numOr(raw: string, fallback: number): number {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? fallback : n;
}

export interface CatalogChoice {
  name: string;
  pack: string;
}

export default function StylePackFields({
  value,
  onChange,
  mode,
  catalog,
}: {
  value: StylePack;
  onChange: (next: StylePack) => void;
  mode: "create" | "edit";
  /** Every component in the merged catalog, for the allowance picker. */
  catalog: CatalogChoice[];
}) {
  const density: OverlayDensity = value.overlays.density;
  const custom = typeof density === "object";
  const allowed = value.overlays.allowed_components;
  const restricted = allowed !== undefined;

  const setPacing = (key: keyof StylePack["pacing"], raw: string) =>
    onChange({ ...value, pacing: { ...value.pacing, [key]: numOr(raw, 0) } });

  function setDensity(choice: string) {
    if (choice === "custom") {
      const per = typeof density === "string" ? { low: 1, normal: 2.5, high: 5 }[density] : 2.5;
      onChange({ ...value, overlays: { ...value.overlays, density: { per_minute: per ?? 2.5 } } });
    } else {
      onChange({ ...value, overlays: { ...value.overlays, density: choice as OverlayDensity } });
    }
  }

  function toggleTransition(t: TransitionType) {
    const has = value.transitions.allowed.includes(t);
    const next = has
      ? value.transitions.allowed.filter((x) => x !== t)
      : [...value.transitions.allowed, t];
    onChange({
      ...value,
      transitions: {
        allowed: next,
        // never leave `default` pointing at a transition the planner may not use
        default: next.includes(value.transitions.default) ? value.transitions.default : next[0],
      },
    });
  }

  function setRestricted(on: boolean) {
    const overlays = { ...value.overlays };
    if (on) overlays.allowed_components = catalog.map((c) => c.name).sort();
    else delete overlays.allowed_components;
    onChange({ ...value, overlays });
  }

  function toggleComponent(name: string) {
    if (!allowed) return;
    const next = allowed.includes(name)
      ? allowed.filter((c) => c !== name)
      : [...allowed, name].sort();
    onChange({ ...value, overlays: { ...value.overlays, allowed_components: next } });
  }

  const packs = [...new Set(catalog.map((c) => c.pack))].sort((a, b) =>
    a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b)
  );
  const stale = (allowed ?? []).filter((c) => !catalog.some((x) => x.name === c));

  return (
    <div className={s.form}>
      <label className={s.field}>
        <span className={s.fieldLabel}>name</span>
        <input
          name="style-pack-name"
          value={value.name}
          placeholder="doc-slow"
          spellCheck={false}
          disabled={mode === "edit"}
          readOnly={mode === "edit"}
          onChange={(e) => onChange({ ...value, name: e.target.value.trim() })}
        />
      </label>
      {mode === "create" && value.name !== "" && !STYLE_PACK_NAME_RE.test(value.name) && (
        <div className={s.error}>lowercase letters, digits and dashes — it is also the filename</div>
      )}

      <label className={s.field}>
        <span className={s.fieldLabel}>video_type</span>
        <select
          name="video-type"
          value={value.video_type ?? ""}
          onChange={(e) =>
            onChange({ ...value, video_type: (e.target.value || undefined) as VideoType })
          }
        >
          <option value="">— any —</option>
          {VIDEO_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      <div className={s.hint}>
        The video-type preset this pack implements. A channel set to this type offers it first;
        leave it blank and the pack is offered for every type.
      </div>

      <div className={s.formLabel}>PACING</div>
      <div className={s.field}>
        <span className={s.fieldLabel}>min_hold · avg_hold_seconds · max_hold</span>
        <div className={s.triple}>
          {(["min_hold", "avg_hold_seconds", "max_hold"] as const).map((k) => (
            <input
              key={k}
              name={k}
              value={value.pacing[k] ?? ""}
              inputMode="decimal"
              onChange={(e) => setPacing(k, e.target.value)}
            />
          ))}
        </div>
        <div className={s.hint}>
          Seconds per shot. avg drives the beat count the planner aims for and validate enforces;
          min/max are hard clamps in the compiler.
        </div>
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>arc</span>
        <select
          name="arc"
          value={value.pacing.arc ?? "linear"}
          onChange={(e) =>
            onChange({
              ...value,
              pacing: { ...value.pacing, arc: e.target.value as StylePack["pacing"]["arc"] },
            })
          }
        >
          {ARCS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>

      <div className={s.formLabel}>OVERLAYS</div>
      <label className={s.field}>
        <span className={s.fieldLabel}>density</span>
        <select name="density" value={custom ? "custom" : density} onChange={(e) => setDensity(e.target.value)}>
          {NAMED_DENSITIES.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
          <option value="custom">custom (per minute)…</option>
        </select>
      </label>
      {custom && (
        <label className={s.field}>
          <span className={s.fieldLabel}>density.per_minute</span>
          <input
            name="per-minute"
            value={density.per_minute ?? ""}
            inputMode="decimal"
            onChange={(e) =>
              onChange({
                ...value,
                overlays: { ...value.overlays, density: { per_minute: numOr(e.target.value, 0) } },
              })
            }
          />
        </label>
      )}
      <div className={s.hint}>The per-video more/fewer animations dial; validate caps the plan at it.</div>

      <div className={s.field}>
        <span className={s.fieldLabel}>allowed_components</span>
        <div className={s.checks}>
          <label className={`${s.check}${!restricted ? " " + s.checkOn : ""}`}>
            <input type="checkbox" checked={!restricted} onChange={(e) => setRestricted(!e.target.checked)} />
            allow every catalog component
          </label>
        </div>
        {restricted && (
          <>
            {packs.map((pack) => (
              <div key={pack} className={s.field}>
                <span className={s.hint}>{pack}</span>
                <div className={s.checks}>
                  {catalog
                    .filter((c) => c.pack === pack)
                    .map((c) => {
                      const on = allowed!.includes(c.name);
                      return (
                        <label key={c.name} className={`${s.check}${on ? " " + s.checkOn : ""}`}>
                          <input type="checkbox" checked={on} onChange={() => toggleComponent(c.name)} />
                          {c.name}
                        </label>
                      );
                    })}
                </div>
              </div>
            ))}
            {stale.length > 0 && (
              <>
                <div className={s.error}>
                  not in the catalog any more — the planner can never pick these
                </div>
                <div className={s.checks}>
                  {stale.map((c) => (
                    <label key={c} className={s.check}>
                      <input type="checkbox" checked onChange={() => toggleComponent(c)} />
                      {c}
                    </label>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className={s.formLabel}>TRANSITIONS</div>
      <div className={s.field}>
        <span className={s.fieldLabel}>allowed</span>
        <div className={s.checks}>
          {TRANSITIONS.map((t) => {
            const on = value.transitions.allowed.includes(t);
            return (
              <label key={t} className={`${s.check}${on ? " " + s.checkOn : ""}`}>
                <input type="checkbox" checked={on} onChange={() => toggleTransition(t)} />
                {t}
              </label>
            );
          })}
        </div>
      </div>

      <label className={s.field}>
        <span className={s.fieldLabel}>default</span>
        <select
          name="default-transition"
          value={value.transitions.default}
          onChange={(e) =>
            onChange({
              ...value,
              transitions: { ...value.transitions, default: e.target.value as TransitionType },
            })
          }
        >
          {value.transitions.allowed.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>

      <div className={s.formLabel}>LANGUAGE</div>
      <label className={s.field}>
        <span className={s.fieldLabel}>script_persona</span>
        <textarea
          name="script-persona"
          className={s.textarea}
          value={value.script_persona ?? ""}
          placeholder="Grave, precise documentary narrator. Short sentences. No exclamations."
          onChange={(e) => onChange({ ...value, script_persona: e.target.value })}
        />
      </label>
      <div className={s.hint}>Goes to the script agent verbatim.</div>

      <label className={s.field}>
        <span className={s.fieldLabel}>visual_language</span>
        <textarea
          name="visual-language"
          className={s.textarea}
          value={value.visual_language ?? ""}
          placeholder="Archival, desaturated, wide establishing shots; avoid modern footage."
          onChange={(e) => onChange({ ...value, visual_language: e.target.value })}
        />
      </label>
      <div className={s.hint}>Goes to the beat planner, and shapes the asset queries it writes.</div>
    </div>
  );
}
