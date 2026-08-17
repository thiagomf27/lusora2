/**
 * Which style pack a video type implies.
 *
 * The answer comes from `contracts/video-type-defaults.json` — one entry per
 * type, editable on the Style packs screen. It cannot live on the packs
 * themselves: `video_type` there is advisory and several packs may declare the
 * same one, so two of them could claim to be "the doc pack".
 *
 * The fallbacks below exist for a type the document does not name (a fresh
 * checkout, or a type added before someone picks its default): keep a pack that
 * already implements the type rather than moving a channel off a deliberate
 * choice, else the first match in name order so the result is at least
 * deterministic, else leave the pack alone.
 *
 * Client-safe: takes the options `/api/config-options` already returns.
 */
import type { VideoType } from "@lusora/contracts";

export interface StylePackChoice {
  name: string;
  video_type?: VideoType;
}
export type VideoTypeDefaults = Partial<Record<string, string>>;

export function stylePackForVideoType(
  videoType: string,
  current: string,
  packs: StylePackChoice[],
  defaults: VideoTypeDefaults = {}
): string {
  const configured = defaults[videoType];
  // A default naming a pack that is no longer on disk is ignored rather than
  // written into a channel; CI catches it, but a stale UI must not act on it.
  if (configured && packs.some((p) => p.name === configured)) return configured;

  const matching = packs.filter((p) => p.video_type === videoType);
  if (matching.length === 0) return current;
  if (matching.some((p) => p.name === current)) return current;
  return [...matching].sort((a, b) => a.name.localeCompare(b.name))[0].name;
}

/** The packs implementing a type — what the screen reports so "set from the
 *  video type" is not a dead end. */
export function alternativesFor(videoType: string, packs: StylePackChoice[]): string[] {
  return packs.filter((p) => p.video_type === videoType).map((p) => p.name);
}
