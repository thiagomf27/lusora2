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
      problems.push(
        `look.exclude.transitions removes '${style.transitions.default}', which is the style pack's ` +
          "default transition — exclude a different one, or change the pack's default"
      );
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
