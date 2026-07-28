/**
 * D46 token-group editing, kept out of ThemeFields.tsx so it is testable —
 * node's type stripping cannot load JSX, and this rule is worth a test.
 *
 * Option lists live here too, mirrored from theme.schema.json and the engine's
 * themes/runtime.ts. Neither has an API to read them from; `themes.test.ts` in
 * the engine is what keeps the resolvers honest, and the schema is what
 * actually rejects a bad value on save.
 */
import type { Theme } from "@lusora/contracts";

/** The UI's way of writing "token absent", which is NOT one of the values. */
export const UNSET = "—";

export const RADII = ["square", "soft", "rounded"] as const;
export const FILLS = ["solid", "translucent", "none"] as const;
export const ACCENT_RULES = ["top", "left", "none"] as const;
export const ENTRANCES = ["fade", "rise", "slide", "pop", "wipe", "typewriter"] as const;
export const EASINGS = ["smooth", "snap", "spring", "linear"] as const;

/**
 * Merge into an optional D46 token group, dropping keys set back to undefined
 * and dropping the group itself once it is empty.
 *
 * The empty-group rule is the point: `"surface": {}` is schema-valid, so nothing
 * downstream would complain, but a reader — human or the next author of this
 * form — would take it as a deliberate statement rather than the absence of
 * one. Absence is meaningful here (it means "each component keeps its own
 * pre-D46 look"), so it has to be written as absence.
 */
export function mergeTokenGroup<K extends "surface" | "motion" | "sound">(
  theme: Theme,
  group: K,
  patch: Partial<Theme[K]>,
): Theme {
  const merged = { ...(theme[group] ?? {}), ...patch } as Record<string, unknown>;
  for (const [k, v] of Object.entries(merged)) if (v === undefined) delete merged[k];
  const next = { ...theme };
  if (Object.keys(merged).length === 0) delete next[group];
  else next[group] = merged as Theme[K];
  return next;
}

/** `motion.per_component` <-> one `Name: entrance` per line. */
export function parsePerComponent(raw: string): Record<string, string> | undefined {
  const next: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const [name, kind] = line.split(":").map((x) => x.trim());
    if (name && kind) next[name] = kind;
  }
  return Object.keys(next).length ? next : undefined;
}

export function formatPerComponent(value: Record<string, string> | undefined): string {
  return Object.entries(value ?? {})
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

/** D48 — the mood vocabulary, mirrored from contracts/src/types.ts MOODS. */
export const MOOD_NAMES = [
  "neutral",
  "tense",
  "somber",
  "hopeful",
  "urgent",
  "triumphant",
  "reflective",
  "playful",
] as const;

/**
 * Merge into a `key: value` map nested inside theme.sound, dropping cleared
 * entries and the map itself once empty — same reasoning as mergeTokenGroup,
 * one level deeper. `mood_beds: {}` would read as "deliberately no music"
 * rather than "not configured".
 */
export function mergeSoundMap(
  theme: Theme,
  field: "per_entrance" | "per_component" | "mood_beds" | "gain",
  patch: Record<string, string | number | undefined>,
): Theme {
  const current = (theme.sound?.[field] ?? {}) as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...current, ...patch };
  for (const [k, v] of Object.entries(merged)) if (v === undefined || v === "") delete merged[k];
  return mergeTokenGroup(theme, "sound", {
    [field]: Object.keys(merged).length ? merged : undefined,
  } as Partial<Theme["sound"]>);
}
