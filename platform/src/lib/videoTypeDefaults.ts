/**
 * Server side of `contracts/video-type-defaults.json` — which style pack each
 * video type starts from.
 *
 * Why a document of its own rather than a flag on the packs: a pack's
 * `video_type` is advisory and several packs may declare the same one (two
 * `doc` packs and two `breakdown` packs ship today), so "which doc pack" is a
 * question about the SET, not about any one member. Put the answer on the packs
 * and two of them can claim it; put it here and a type has exactly one entry by
 * construction.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { VideoType } from "@lusora/contracts";
import { repoRoot } from "./env.ts";

export type VideoTypeDefaults = Partial<Record<VideoType, string>>;

export const VIDEO_TYPES: VideoType[] = ["doc", "explainer", "breakdown", "listicle"];

export function videoTypeDefaultsPath(): string {
  return join(repoRoot(), "contracts", "video-type-defaults.json");
}

/** Missing or unreadable is not an error: with no document every type falls
 *  back to the first pack declaring it, which is what happened before this
 *  existed. */
export function loadVideoTypeDefaults(): VideoTypeDefaults {
  const path = videoTypeDefaultsPath();
  if (!existsSync(path)) return {};
  try {
    const doc = JSON.parse(readFileSync(path, "utf8")) as { defaults?: VideoTypeDefaults };
    return doc.defaults ?? {};
  } catch {
    return {};
  }
}

export function writeVideoTypeDefaults(defaults: VideoTypeDefaults): void {
  // Written in the type order the UI shows, not insertion order, so the file
  // does not churn in git when one entry is edited.
  const ordered: VideoTypeDefaults = {};
  for (const type of VIDEO_TYPES) {
    const pack = defaults[type];
    if (pack) ordered[type] = pack;
  }
  writeFileSync(videoTypeDefaultsPath(), JSON.stringify({ defaults: ordered }, null, 2) + "\n");
}
