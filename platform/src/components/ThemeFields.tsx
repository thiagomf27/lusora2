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
  MOOD_NAMES,
  RADII,
  UNSET,
  formatPerComponent,
  mergeSoundMap,
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

/**
 * A `key: value` map as one line each — the same shape as per_component, but
 * over a CLOSED key set (entrance kinds, moods), so an unknown key is a typo
 * worth showing rather than a new entry.
 */
function MapField({
  label,
  keys,
  value,
  placeholder,
  hint,
  onChange,
}: {
  label: string;
  keys: readonly string[];
  value: Record<string, string> | undefined;
  placeholder: string;
  hint: string;
  onChange: (next: Record<string, string | undefined>) => void;
}) {
  const parsed = parsePerComponent(formatPerComponent(value)) ?? {};
  const unknown = Object.keys(parsed).filter((k) => !keys.includes(k));
  return (
    <label className={s.field}>
      <span className={s.fieldLabel}>{label}</span>
      <textarea
        name={label}
        className={s.textarea}
        rows={3}
        spellCheck={false}
        placeholder={placeholder}
        value={formatPerComponent(value)}
        onChange={(e) => {
          const next = parsePerComponent(e.target.value) ?? {};
          // keys that vanished from the text have to be sent as undefined for
          // mergeSoundMap to actually drop them
          const cleared = Object.fromEntries(
            Object.keys(value ?? {}).filter((k) => !(k in next)).map((k) => [k, undefined])
          );
          onChange({ ...cleared, ...next });
        }}
      />
      <span className={s.hint}>
        {unknown.length ? `unknown key(s): ${unknown.join(", ")} — allowed: ${keys.join(", ")}` : hint}
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
  const upSound = (patch: Partial<NonNullable<Theme["sound"]>>) =>
    onChange(mergeTokenGroup(value, "sound", patch));

  return (
    <div className={s.form}>
      <label className={s.field}>
        <span className={s.fieldLabel}>name</span>
        {mode === "create" ? (
          <input
            name="theme-name"
            value={value.name}
            placeholder="paper-print"
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

      <div className={s.formLabel}>SOUND</div>
      <div className={s.hint}>
        Which cue plays and at what level. Names come from the sound pack; the
        style pack decides how <em>often</em> they fire. Leave it all empty for a
        silent video.
      </div>
      <label className={s.field}>
        <span className={s.fieldLabel}>pack</span>
        <input
          name="sound-pack"
          value={value.sound?.pack ?? ""}
          placeholder="doc-restrained"
          spellCheck={false}
          onChange={(e) => upSound({ pack: e.target.value.trim() || undefined })}
        />
        <span className={s.hint}>A channel may override this.</span>
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>entrance</span>
        <input
          name="sound-entrance"
          value={value.sound?.entrance ?? ""}
          placeholder="swoosh-soft"
          spellCheck={false}
          onChange={(e) => upSound({ entrance: e.target.value.trim() || undefined })}
        />
        <span className={s.hint}>Default cue for an overlay entrance. Empty = silent.</span>
      </label>
      <label className={s.field}>
        <span className={s.fieldLabel}>transition</span>
        <input
          name="sound-transition"
          value={value.sound?.transition ?? ""}
          placeholder="none"
          spellCheck={false}
          onChange={(e) => upSound({ transition: e.target.value.trim() || undefined })}
        />
        <span className={s.hint}>
          Usually empty: at a 4s hold, a cue per transition is ~15 a minute.
        </span>
      </label>
      <MapField
        label="per_entrance"
        keys={ENTRANCES}
        value={value.sound?.per_entrance}
        placeholder={"typewriter: tick-typing\npop: thud-low"}
        hint="One entrance-kind: cue per line. Applies once the theme has chosen an entrance."
        onChange={(next) => onChange(mergeSoundMap(value, "per_entrance", next))}
      />
      <MapField
        label="mood_beds"
        keys={MOOD_NAMES}
        value={value.sound?.mood_beds}
        placeholder={"tense: tense-01\nsomber: somber-01"}
        hint="One mood: bed per line. A mood with no bed plays no music, which is a valid choice."
        onChange={(next) => onChange(mergeSoundMap(value, "mood_beds", next))}
      />
      <div className={s.formLabel}>SOUND GAIN</div>
      <div className={s.hint}>
        The mix. music_duck is the bed level under speech; music_lift is where it
        rises in a narration gap.
      </div>
      {(
        [
          ["sfx", 0.35],
          ["music_duck", 0.08],
          ["music_lift", 0.22],
        ] as const
      ).map(([key, fallback]) => (
        <label className={s.field} key={key}>
          <span className={s.fieldLabel}>{key}</span>
          <input
            type="number"
            min={0}
            max={1}
            step={0.01}
            value={value.sound?.gain?.[key] ?? ""}
            placeholder={String(fallback)}
            onChange={(e) =>
              onChange(
                mergeSoundMap(value, "gain", {
                  [key]: e.target.value === "" ? undefined : Number(e.target.value),
                })
              )
            }
          />
        </label>
      ))}
    </div>
  );
}
