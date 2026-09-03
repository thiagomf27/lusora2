/**
 * Which cue an overlay fires, for the Overlays screen's player.
 *
 * A THIRD mirror of the same resolution, and it should stay one: the renderer
 * has `entranceFor()` in engine/src/themes/runtime.ts, the compiler has
 * `_cue_for_overlay()` in the worker's sound stage, and this is the preview.
 * The compiler is the authority — what it emits is what the video actually
 * contains — so every rule below is that file's rule, including the ones that
 * produce silence.
 *
 * The two are checked against each other rather than trusted: resolving every
 * catalog component under every shipped theme through both must give the same
 * cue name for all of them.
 *
 * Silence is most of it. Only a theme with a `sound` block naming a pack has
 * cues at all, and D48 is explicit that an omitted `entrance` means no entrance
 * sfx rather than a fallback swoosh. A preview that invented one would be
 * showing a video that does not exist, so every path here returns null instead.
 */
import type { CatalogEntry, SoundPack, Theme } from "@lusora/contracts";
import type { OverlaySoloSound } from "@lusora/engine/src/renderers/remotion/OverlaySolo.tsx";

/** Mirrors PANEL_ENTRANCES / TEXT_ENTRANCES in engine/src/themes/entrance.ts. */
const PANEL_ENTRANCES = ["fade", "rise", "slide", "pop", "wipe"] as const;
const TEXT_ENTRANCES = [...PANEL_ENTRANCES, "typewriter"] as const;

/** Mirrors motionScale().durationMul. */
const DURATION_MUL: Record<string, number> = {
  slow_heavy: 1.35,
  neutral: 1,
  fast_light: 0.75,
};

/** catalog_entry.schema.json's `entrance_seconds` default. */
const DEFAULT_ENTRANCE_SECONDS = 0.45;
/** theme.schema.json's `sound.gain.sfx` default. */
const DEFAULT_SFX_GAIN = 0.35;

function durationMul(theme: Theme): number {
  return DURATION_MUL[theme.motion_feel ?? "neutral"] ?? 1;
}

/**
 * Which entrance the component will actually play — or null.
 *
 * The compiler's honest gap, kept honest here: `entranceFor()` falls back to
 * the entrance the component hardcoded, which lives in TSX and is not in the
 * catalog. When the theme expresses no preference we return null, meaning "the
 * component's own choice, unknown here", and the caller uses the theme's
 * generic cue rather than guessing a kind.
 */
function entranceKind(theme: Theme, component: string, entry: CatalogEntry): string | null {
  const motion = theme.motion ?? {};
  const wanted = motion.per_component?.[component] ?? motion.entrance;
  if (!wanted) return null;
  const supported: readonly string[] =
    entry.entrance_support === "text" ? TEXT_ENTRANCES : PANEL_ENTRANCES;
  return supported.includes(wanted) ? wanted : "fade";
}

/** `per_component` override -> `per_entrance` (when the kind is known) -> default. */
function cueName(theme: Theme, entry: CatalogEntry): string | null {
  const sound = theme.sound ?? {};
  const perComponent = sound.per_component?.[entry.name];
  if (perComponent !== undefined) return perComponent === "none" ? null : perComponent;

  const kind = entranceKind(theme, entry.name, entry);
  if (kind) {
    const byKind = (sound.per_entrance as Record<string, string> | undefined)?.[kind];
    if (byKind !== undefined) return byKind === "none" ? null : byKind;
  }

  const fallback = sound.entrance;
  return !fallback || fallback === "none" ? null : fallback;
}

/**
 * The cue for one overlay standing alone, or null for silence.
 *
 * `pack` is the manifest the theme names. A theme that names a cue the pack
 * does not define is a hard error in the compiler; here it is silence and a
 * `reason`, because the Overlays screen is where you would be editing that
 * theme and a thrown preview helps nobody.
 */
export function resolveOverlayCue(
  theme: Theme,
  entry: CatalogEntry,
  pack: SoundPack | null
): { sound: OverlaySoloSound | null; cue: string | null; reason: string | null } {
  const gain = theme.sound?.gain?.sfx ?? DEFAULT_SFX_GAIN;
  const name = cueName(theme, entry);
  if (!name) return { sound: null, cue: null, reason: null };
  if (!pack) {
    return { sound: null, cue: name, reason: `theme names no sound pack to take '${name}' from` };
  }
  const spec = pack.cues?.[name];
  if (!spec) {
    return {
      sound: null,
      cue: name,
      reason: `sound pack '${pack.name}' does not define cue '${name}'`,
    };
  }
  // A theme can turn sfx off with the mix rather than by unsetting the cue
  // (`descoberta-doc` does). Silent is silent — no element rather than one at 0.
  if (gain <= 0) return { sound: null, cue: name, reason: "theme mixes sfx to 0" };

  // The compiler's `_sfx_item` with `at_s = 0`: the overlay starts when the
  // preview does, and a cue is never dragged before 0, so its lead is spent
  // rather than played.
  const lead = spec.lead_s ?? 0;
  const loop = spec.kind === "loop";
  // A loop fills the entrance it was given plus the lead it was pulled back by;
  // a one-shot is simply its own length.
  const window = (entry.entrance_seconds ?? DEFAULT_ENTRANCE_SECONDS) * durationMul(theme);
  const durationSeconds = loop ? lead + window : spec.duration_s;

  return {
    cue: name,
    reason: null,
    sound: {
      src: `/api/sounds/${pack.name}/audio/${spec.file}`,
      startSeconds: 0,
      durationSeconds: Math.max(durationSeconds, 0.05),
      gain: gain * (spec.gain ?? 1),
      loop,
      fadeOutSeconds: spec.fade_out_s,
    },
  };
}
