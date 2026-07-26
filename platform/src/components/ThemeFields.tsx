"use client";
/**
 * The theme document as a form. Shared by the create modal and the inline
 * editor on the Themes page. Option lists are mirrored from the engine
 * (themes/runtime.ts) and theme.schema.json — neither has an API.
 */
import type { Theme } from "@lusora/contracts";
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
    </div>
  );
}
