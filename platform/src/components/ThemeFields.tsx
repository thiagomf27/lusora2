"use client";
/**
 * The theme document as a form. Shared by the create modal and the inline
 * editor on the Themes page. Option lists are mirrored from the engine
 * (themes/runtime.ts) and theme.schema.json — neither has an API.
 */
import type { Theme } from "@lusora/contracts";
import {
  ACCENT_RULES,
  EASINGS,
  ENTRANCES,
  FILLS,
  RADII,
  UNSET,
  formatPerComponent,
  mergeTokenGroup,
  parsePerComponent,
} from "@/lib/themeTokens";
import s from "./form.module.css";

export const CAPTION_PRESETS = ["plain", "serif-lower-third", "boxed"] as const;
export const MOTION_FEELS = ["slow_heavy", "neutral", "fast_light"] as const;
export const GRAINS = ["none", "archival", "film"] as const;

export const FONTS = [
  "Inter",
  "Playfair Display",
  "Georgia",
  "Merriweather",
  "Lora",
  "Times New Roman",
] as const;

export const THEME_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

export function newTheme(): Theme {
  return {
    name: "",
    colors: { bg: "#101216", text: "#e8eaf0", accent: "#4a90c8", neutral: "#8a8f9a" },
    typography: { display: "Inter", body: "Inter", caption_preset: "plain" },
    motion_feel: "neutral",
    grain: "none",
  };
}

/** #rrggbb only — the schema's colour pattern. The picker and the text field
 *  share one value so a pasted hex stays authoritative. */
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const valid = /^#[0-9a-fA-F]{6}$/.test(value);
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <span className={s.colorRow}>
        <input
          type="color"
          name={`${label}-picker`}
          className={s.colorPicker}
          value={valid ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          name={label}
          className={valid ? s.hexInput : `${s.hexInput} ${s.invalid}`}
          value={value}
          spellCheck={false}
          onChange={(e) => onChange(e.target.value.trim())}
        />
      </span>
    </label>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  const known = value && !options.includes(value) ? [value, ...options] : options;
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <select name={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {known.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}


/**
 * A select whose empty choice means "leave the token out of the document".
 * Writing an explicit value where the theme had none is a real change — it
 * takes the choice away from the component — so the two must stay distinct.
 */
function OptionalSelect({
  label,
  value,
  options,
  unsetNote,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly string[];
  unsetNote: string;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <select
        name={label}
        value={value ?? UNSET}
        onChange={(e) => onChange(e.target.value === UNSET ? undefined : e.target.value)}
      >
        <option value={UNSET}>{`${UNSET}  (${unsetNote})`}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * `motion.per_component` as one name-per-line editor. Kept as free text rather
 * than a picker over the catalog: the map is meant to stay short (D47), and a
 * 26-row checklist would invite exactly the per-component sprawl that roles
 * exist to prevent.
 */
function PerComponentField({
  value,
  onChange,
}: {
  value: Record<string, string> | undefined;
  onChange: (next: Record<string, string> | undefined) => void;
}) {
  const text = formatPerComponent(value);
  const entries = Object.keys(value ?? {}).length;
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>per_component</span>
      <textarea
        name="per_component"
        className={s.textarea}
        rows={3}
        spellCheck={false}
        placeholder={"ChapterCard: typewriter\nAnimatedCounter: pop"}
        value={text}
        onChange={(e) => onChange(parsePerComponent(e.target.value))}
      />
      <span className={s.hint}>
        {entries > 6
          ? `${entries} overrides — long maps are the signal to switch to motion roles (D47).`
          : "One ComponentName: entrance per line. Exceptions only."}
      </span>
    </label>
  );
}

export default function ThemeFields({
  value,
  onChange,
  mode,
}: {
  value: Theme;
  onChange: (next: Theme) => void;
  mode: "create" | "edit";
}) {
  const upColor = (key: keyof Theme["colors"], v: string) =>
    onChange({ ...value, colors: { ...value.colors, [key]: v } });
  const upType = (key: keyof Theme["typography"], v: string) =>
    onChange({ ...value, typography: { ...value.typography, [key]: v } });

  const upSurface = (patch: Partial<NonNullable<Theme["surface"]>>) =>
    onChange(mergeTokenGroup(value, "surface", patch));
  const upMotion = (patch: Partial<NonNullable<Theme["motion"]>>) =>
    onChange(mergeTokenGroup(value, "motion", patch));

  return (
    <div className={s.form}>
      <label className={s.field}>
        <span className={s.fieldLabel}>name</span>
        {mode === "create" ? (
          <input
            name="theme-name"
            value={value.name}
            placeholder="history-dark"
            spellCheck={false}
            onChange={(e) => onChange({ ...value, name: e.target.value.trim() })}
          />
        ) : (
          <input name="theme-name" value={value.name} disabled readOnly />
        )}
      </label>
      <div className={s.hint}>
        {mode === "create"
          ? "Written to contracts/themes/<name>.json"
          : "Renaming would break the channels that reference this theme."}
      </div>

      <div className={s.formLabel}>COLOURS</div>
      <ColorField label="bg" value={value.colors.bg} onChange={(v) => upColor("bg", v)} />
      <ColorField label="text" value={value.colors.text} onChange={(v) => upColor("text", v)} />
      <ColorField label="accent" value={value.colors.accent} onChange={(v) => upColor("accent", v)} />
      <ColorField label="neutral" value={value.colors.neutral} onChange={(v) => upColor("neutral", v)} />

      <div className={s.formLabel}>TYPOGRAPHY</div>
      <SelectField
        label="display"
        value={value.typography.display}
        options={FONTS}
        onChange={(v) => upType("display", v)}
      />
      <SelectField
        label="body"
        value={value.typography.body}
        options={FONTS}
        onChange={(v) => upType("body", v)}
      />
      <SelectField
        label="caption_preset"
        value={value.typography.caption_preset}
        options={CAPTION_PRESETS}
        onChange={(v) => upType("caption_preset", v)}
      />

      <div className={s.formLabel}>FEEL</div>
      <SelectField
        label="motion_feel"
        value={value.motion_feel ?? "neutral"}
        options={MOTION_FEELS}
        onChange={(v) => onChange({ ...value, motion_feel: v as Theme["motion_feel"] })}
      />
      <SelectField
        label="grain"
        value={value.grain ?? "none"}
        options={GRAINS}
        onChange={(v) => onChange({ ...value, grain: v as Theme["grain"] })}
      />

      <div className={s.formLabel}>SURFACE</div>
      <div className={s.hint}>
        The shape of an overlay panel. Components without a panel — titles,
        charts, maps — ignore these.
      </div>
      <OptionalSelect
        label="radius"
        value={value.surface?.radius}
        options={RADII}
        unsetNote="soft"
        onChange={(v) => upSurface({ radius: v as never })}
      />
      <OptionalSelect
        label="fill"
        value={value.surface?.fill}
        options={FILLS}
        unsetNote="translucent"
        onChange={(v) => upSurface({ fill: v as never })}
      />
      <OptionalSelect
        label="accent_rule"
        value={value.surface?.accent_rule}
        options={ACCENT_RULES}
        unsetNote="each component's own"
        onChange={(v) => upSurface({ accent_rule: v as never })}
      />

      <div className={s.formLabel}>MOTION</div>
      <div className={s.hint}>
        How an overlay arrives. A component that cannot draw the chosen entrance
        falls back to a fade rather than rendering wrong.
      </div>
      <OptionalSelect
        label="entrance"
        value={value.motion?.entrance}
        options={ENTRANCES}
        unsetNote="each component's own"
        onChange={(v) => upMotion({ entrance: v as never })}
      />
      <OptionalSelect
        label="easing"
        value={value.motion?.easing}
        options={EASINGS}
        unsetNote="smooth"
        onChange={(v) => upMotion({ easing: v as never })}
      />
      <PerComponentField
        value={value.motion?.per_component}
        onChange={(next) => upMotion({ per_component: next as never })}
      />
    </div>
  );
}
