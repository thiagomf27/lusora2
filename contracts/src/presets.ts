/**
 * Channel presets (D119): `contracts/presets/<name>.json`, a PARTIAL channel
 * config plus a `description`, deep-merged over a channel's config — objects
 * merge key by key, arrays and scalars from the preset replace.
 *
 * Pure and import-free on purpose: the platform's route and channel form
 * (client side) and `scripts/validate-schemas.mjs` (plain node, which strips
 * the types) all share it, so there is one set of merge rules.
 */

/** What belongs to ONE channel and never travels in a preset. */
export const FORBIDDEN_PRESET_KEYS = [
  "channel_id",
  "name",
  "language",
  "voice.provider",
  "voice.voice_id",
  "budget",
] as const;

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The forbidden keys a preset carries, as dotted paths; [] when it is clean. */
export function forbiddenPresetKeys(preset: unknown): string[] {
  if (!isObject(preset)) return [];
  return FORBIDDEN_PRESET_KEYS.filter((path) => {
    let node: unknown = preset;
    for (const part of path.split(".")) {
      if (!isObject(node) || !(part in node)) return false;
      node = node[part];
    }
    return true;
  });
}

/** Deep merge: objects key by key, anything else from `over` replaces. */
export function deepMerge<T>(base: T, over: unknown): T {
  if (!isObject(base) || !isObject(over)) return (over === undefined ? base : over) as T;
  const out: Json = { ...base };
  for (const [key, value] of Object.entries(over)) {
    out[key] = isObject(value) && isObject(out[key]) ? deepMerge(out[key], value) : value;
  }
  return out as T;
}

/** `config` with the preset applied; its `description` is not a config field. */
export function applyPreset<T>(config: T, preset: Json): T {
  const { description: _description, ...fields } = preset;
  return deepMerge(config, fields);
}

export interface PresetOption {
  name: string;
  description: string;
  preset: Json;
}
