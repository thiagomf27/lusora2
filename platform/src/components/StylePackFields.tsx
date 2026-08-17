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

/** For OPTIONAL numbers: an emptied field drops the key so the schema default
 *  applies, rather than pinning today's default into the document. */
function optNum(raw: string): number | undefined {
  const n = Number(raw);
  return raw.trim() === "" || Number.isNaN(n) ? undefined : n;
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
  const allowedPacks = value.overlays.allowed_packs;
  const restricted = allowedPacks !== undefined;

  const setPacing = (key: keyof StylePack["pacing"], raw: string) =>
    onChange({ ...value, pacing: { ...value.pacing, [key]: numOr(raw, 0) } });

  // D48 sound governance. Cleared fields drop out so the pack's JSON keeps
  // saying only what its author meant, and defaults stay in the schema.
  const upGroup = <K extends "sfx" | "music">(group: K, patch: Partial<StylePack[K]>) => {
    const merged = { ...(value[group] ?? {}), ...patch } as Record<string, unknown>;
    for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
    const next = { ...value };
    if (Object.keys(merged).length === 0) delete next[group];
    else next[group] = merged as StylePack[K];
    onChange(next);
  };
  const upSfx = (patch: Partial<NonNullable<StylePack["sfx"]>>) => upGroup("sfx", patch);
  const upMusic = (patch: Partial<NonNullable<StylePack["music"]>>) => upGroup("music", patch);

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
    if (on) overlays.allowed_packs = packs.slice();
    else delete overlays.allowed_packs;
    onChange({ ...value, overlays });
  }

  function togglePack(name: string) {
    if (!allowedPacks) return;
    const next = allowedPacks.includes(name)
      ? allowedPacks.filter((c) => c !== name)
      : [...allowedPacks, name].sort();
    // An empty list would allow nothing at all; "allow every pack" is the
    // absent key, which is what the checkbox above sets.
    if (next.length === 0) return;
    onChange({ ...value, overlays: { ...value.overlays, allowed_packs: next } });
  }

  const packs = [...new Set(catalog.map((c) => c.pack))].sort((a, b) =>
    a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b)
  );
  const stale = (allowedPacks ?? []).filter((p) => !packs.includes(p));

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
        <span className={s.fieldLabel}>allowed_packs</span>
        <div className={s.hint}>
          Which component packs this style draws from. A channel installs exactly one pack, so this
          is what decides whether a style and a channel can work together at all. Per-component
          trimming belongs to the channel, on its Visual tab.
        </div>
        <div className={s.checks}>
          <label className={`${s.check}${!restricted ? " " + s.checkOn : ""}`}>
            <input type="checkbox" checked={!restricted} onChange={(e) => setRestricted(!e.target.checked)} />
            allow every component pack
          </label>
        </div>
        {restricted && (
          <>
            <div className={s.checks}>
              {packs.map((pack) => {
                const on = allowedPacks!.includes(pack);
                const count = catalog.filter((c) => c.pack === pack).length;
                return (
                  <label key={pack} className={`${s.check}${on ? " " + s.checkOn : ""}`}>
                    <input type="checkbox" checked={on} onChange={() => togglePack(pack)} />
                    {pack} ({count})
                  </label>
                );
              })}
            </div>
            {stale.length > 0 && (
              <>
                <div className={s.error}>
                  no component pack on disk any more — a channel can never install these
                </div>
                <div className={s.checks}>
                  {stale.map((p) => (
                    <label key={p} className={s.check}>
                      <input type="checkbox" checked onChange={() => togglePack(p)} />
                      {p}
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

      <div className={s.formLabel}>SOUND</div>
      <div className={s.hint}>
        How often cues fire and how music is shaped. Which sounds play is the
        theme&apos;s job; the channel can switch either off entirely.
      </div>
      <label className={s.checkRow}>
        <input
          type="checkbox"
          checked={value.sfx?.enabled ?? true}
          onChange={(e) => upSfx({ enabled: e.target.checked })}
        />
        Sound effects
      </label>
      <div className={s.field}>
        <span className={s.fieldLabel}>max_per_minute · min_gap_s</span>
        <div className={s.triple}>
          <input
            name="max_per_minute"
            value={value.sfx?.max_per_minute ?? ""}
            placeholder="4"
            inputMode="decimal"
            onChange={(e) => upSfx({ max_per_minute: optNum(e.target.value) })}
          />
          <input
            name="min_gap_s"
            value={value.sfx?.min_gap_s ?? ""}
            placeholder="1.2"
            inputMode="decimal"
            onChange={(e) => upSfx({ min_gap_s: optNum(e.target.value) })}
          />
        </div>
        <div className={s.hint}>
          The compiler drops the lowest-priority cues to stay inside both, and
          validate re-checks. At a {value.pacing.avg_hold_seconds || 4}s hold an
          ungoverned cue per overlay would be about{" "}
          {(60 / (value.pacing.avg_hold_seconds || 4)).toFixed(0)} a minute.
        </div>
      </div>
      <div className={s.field}>
        <span className={s.fieldLabel}>cues</span>
        <div className={s.checkRow}>
          {(["entrance", "transition"] as const).map((c) => (
            <label key={c} className={s.checkRow}>
              <input
                type="checkbox"
                checked={(value.sfx?.cues ?? ["entrance"]).includes(c)}
                onChange={(e) => {
                  const current = value.sfx?.cues ?? ["entrance"];
                  upSfx({
                    cues: e.target.checked
                      ? [...new Set([...current, c])]
                      : current.filter((x) => x !== c),
                  });
                }}
              />
              {c}
            </label>
          ))}
        </div>
        <div className={s.hint}>Transitions are opt-in: most packs want entrances only.</div>
      </div>

      <label className={s.checkRow}>
        <input
          type="checkbox"
          checked={value.music?.enabled ?? true}
          onChange={(e) => upMusic({ enabled: e.target.checked })}
        />
        Background music
      </label>
      <div className={s.field}>
        <span className={s.fieldLabel}>min_span_s · crossfade_s</span>
        <div className={s.triple}>
          <input
            name="min_span_s"
            value={value.music?.min_span_s ?? ""}
            placeholder="20"
            inputMode="decimal"
            onChange={(e) => upMusic({ min_span_s: optNum(e.target.value) })}
          />
          <input
            name="crossfade_s"
            value={value.music?.crossfade_s ?? ""}
            placeholder="1.5"
            inputMode="decimal"
            onChange={(e) => upMusic({ crossfade_s: optNum(e.target.value) })}
          />
        </div>
        <div className={s.hint}>
          A run of beats sharing a mood shorter than min_span_s is absorbed into
          its neighbour, so a one-beat mood blip cannot restart the bed.
        </div>
      </div>
    </div>
  );
}
