/**
 * `look` — the subtractive half of a channel's look, applied to the theme and
 * style pack documents already embedded in the cfg snapshot.
 *
 * The theme and the style pack say what is AVAILABLE; `look.exclude` says what
 * this channel — or this one video, since `look` deep-merges like any other
 * config field — leaves out. Narrowing HERE, once, at enqueue means the
 * planner, the compiler, the validator and both renderers all read an
 * already-narrowed pack and none of them has to know the block exists.
 *
 * Emptying a list the pipeline requires is refused rather than repaired: a
 * video that silently loses every transition is a worse outcome than one that
 * will not enqueue, with a message saying why.
 *
 * Pure on purpose — the background image is a file, so its existence check and
 * its copy into the video folder stay in the enqueue path.
 */
import type { ChannelConfig } from "@lusora/contracts";
import { loadMergedCatalog } from "./catalog.ts";

/** Every component name the merged catalog knows — what an exclusion has to
 *  subtract from when the style pack itself allows everything. */
function catalogComponentNames(): string[] {
  return loadMergedCatalog().items.map((i) => i.entry.name);
}

/**
 * Resolve the overlay menu: the style pack's ALLOWED PACKS crossed with the one
 * component pack this channel installed, written into the embedded doc as the
 * concrete `allowed_components` list every downstream stage already reads.
 *
 * Two granularities, on purpose:
 *
 *  - a style pack allows PACKS (`overlays.allowed_packs`). "This style suits
 *    the archive pack" is a statement about a body of work, and it does not go
 *    stale when a component is added to that pack.
 *  - a channel installs ONE pack (`component_pack`), and trims per component
 *    with `look.exclude.components`.
 *
 * Resolving here, once, is the same move the look block makes: the planner,
 * compiler, validator and both renderers keep reading `allowed_components` and
 * none of them learns that packs exist. It is also what keeps Principle 7 —
 * a video enqueued before this change carries a snapshot with an authored
 * `allowed_components` and no `allowed_packs`, and the branch below replays it
 * exactly as it was.
 */
export function applyComponentPack(snapshot: Record<string, unknown>): string[] {
  const pack = (snapshot.component_pack as string | null | undefined) || "core";
  const style = snapshot.style_pack_doc as Record<string, any> | undefined;
  if (!style) return [];

  const overlays = (style.overlays ??= {});
  const allowedPacks: string[] | undefined = overlays.allowed_packs;
  const authored: string[] | undefined = overlays.allowed_components;

  // An old snapshot, or a pack file not yet converted: the authored element
  // list is the menu, narrowed to what this channel installed.
  if (!allowedPacks) {
    const inPack = loadMergedCatalog()
      .items.filter((i) => i.entry.pack === pack)
      .map((i) => i.entry.name);
    const base = authored ?? catalogComponentNames();
    const next = base.filter((c) => inPack.includes(c));
    if (next.length === 0) {
      return [
        `component_pack '${pack}' offers none of the components style pack ` +
          `'${snapshot.style_pack}' allows — pick another component pack, or widen the style ` +
          `pack's allowed components`,
      ];
    }
    overlays.allowed_components = next;
    return [];
  }

  // An empty list is "no pack at all" and is a mistake worth naming; the way to
  // say "any pack" is to leave the field out.
  if (allowedPacks.length > 0 && !allowedPacks.includes(pack)) {
    return [
      `style pack '${snapshot.style_pack}' allows ${allowedPacks.join(", ")}, but this channel's ` +
        `component_pack is '${pack}' — install one of the packs the style allows, or add '${pack}' ` +
        `to the style pack's allowed packs`,
    ];
  }

  const next = loadMergedCatalog()
    .items.filter((i) => i.entry.pack === pack)
    .map((i) => i.entry.name);
  if (next.length === 0) {
    return [`component_pack '${pack}' has no components in the catalog`];
  }
  overlays.allowed_components = next;
  return [];
}

export function applyLook(snapshot: Record<string, unknown>): string[] {
  const look = snapshot.look as ChannelConfig["look"] | undefined;
  const exclude = look?.exclude;
  if (!exclude) return [];

  const problems: string[] = [];
  const style = snapshot.style_pack_doc as Record<string, any> | undefined;
  const theme = snapshot.theme_doc as Record<string, any> | undefined;

  if (style && exclude.components?.length) {
    const overlays = (style.overlays ??= {});
    // A pack with no allow-list allows the whole catalog, so an exclusion has
    // to become one. Excluding something the pack never offered is a no-op,
    // not an error: the same list is meant to survive a change of style pack.
    const base: string[] = overlays.allowed_components ?? catalogComponentNames();
    const next = base.filter((c) => !exclude.components!.includes(c));
    if (next.length === 0) {
      problems.push("look.exclude.components leaves the style pack with no overlay component at all");
    }
    overlays.allowed_components = next;
  }

  if (style?.transitions && exclude.transitions?.length) {
    const allowed = (style.transitions.allowed as string[]).filter(
      (x) => !exclude.transitions!.includes(x as never)
    );
    if (allowed.length === 0) {
      problems.push("look.exclude.transitions leaves no transition allowed — keep at least one");
    } else if (!allowed.includes(style.transitions.default)) {
      // Excluding the pack's default is a legitimate thing to want: "this
      // channel never hard-cuts" is a look, not a mistake. The default moves to
      // a survivor rather than the enqueue being refused — the compiler reads
      // `default` for every unspecified transition, so leaving it pointing at an
      // excluded kind would put back exactly what was excluded.
      style.transitions.default = allowed[0];
    }
    style.transitions.allowed = allowed;
  }

  if (style?.sfx && exclude.sfx_cues?.length) {
    const cues: string[] = style.sfx.cues ?? ["entrance"];
    style.sfx.cues = cues.filter((c) => !exclude.sfx_cues!.includes(c as never));
  }

  if (theme?.sound?.mood_beds && exclude.moods?.length) {
    for (const mood of exclude.moods) delete theme.sound.mood_beds[mood];
  }

  return problems;
}
