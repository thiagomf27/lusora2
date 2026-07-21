/**
 * Pure plan -> plan mutations — the ONLY way the UI changes the working
 * copy. Each function receives an already-cloned plan (planStore clones),
 * mutates it, and returns it. The track-model rules live here:
 *
 * - tracks.visual is contiguous/non-overlapping and its times are narrative
 *   cut points: they move ONLY via moveCutPoint (roll edit: one item
 *   shrinks, the neighbor grows) or splitVisual. No gaps, no overlaps, by
 *   construction. Items never go below MIN_VISUAL_SECONDS.
 * - captions / overlays / music+sfx move freely within [0, voiceover end].
 * - the voiceover item is locked (it defines the total duration).
 *
 * These same functions execute the chat agent's EditOps (Phase 6) — one
 * implementation for every editor of the plan on the UI side.
 */

import type { AudioItem, EditPlan, OverlayItem } from "@engine/player";
import { voiceoverDuration } from "@engine/player";

export const MIN_VISUAL_SECONDS = 0.5;
const GRID = 0.001; // keep times to ms precision — avoids float noise in JSON

function q(t: number): number {
  return Math.round(t / GRID) * GRID;
}

function clampSpan(start: number, end: number, max: number): [number, number] {
  const length = Math.max(0.1, end - start);
  const s = Math.min(Math.max(0, start), Math.max(0, max - length));
  return [q(s), q(Math.min(s + length, max))];
}

/** Move/resize a freely-movable item (captions/overlays/music/sfx). */
export function retimeItem(
  plan: EditPlan,
  track: "captions" | "overlays" | "audio",
  index: number,
  start: number,
  end: number,
): EditPlan {
  const item = plan.tracks[track][index];
  if (!item) return plan;
  if (track === "audio" && (item as AudioItem).role === "voiceover") return plan;
  const [s, e] = clampSpan(start, end, voiceoverDuration(plan));
  item.start = s;
  item.end = e;
  return plan;
}

/** ROLL EDIT: move the cut between visual[index] and visual[index+1]. */
export function moveCutPoint(plan: EditPlan, index: number, to: number): EditPlan {
  const left = plan.tracks.visual[index];
  const right = plan.tracks.visual[index + 1];
  if (!left || !right) return plan;
  const cut = q(
    Math.min(right.end - MIN_VISUAL_SECONDS, Math.max(left.start + MIN_VISUAL_SECONDS, to)),
  );
  left.end = cut;
  right.start = cut;
  return plan;
}

/** Split visual[index] at an absolute time; both halves keep asset+query. */
export function splitVisual(plan: EditPlan, index: number, at: number): EditPlan {
  const item = plan.tracks.visual[index];
  if (!item) return plan;
  const t = q(at);
  if (t < item.start + MIN_VISUAL_SECONDS || t > item.end - MIN_VISUAL_SECONDS) return plan;
  const second = structuredClone(item);
  second.start = t;
  // the new junction is a cut; the second half keeps the original transition_out
  item.end = t;
  item.transition_out = null;
  item.transition_duration = null;
  plan.tracks.visual.splice(index + 1, 0, second);
  return plan;
}

/** Delete visual[index]; the previous item (or the next, for index 0) absorbs its span. */
export function deleteVisual(plan: EditPlan, index: number): EditPlan {
  const visual = plan.tracks.visual;
  const item = visual[index];
  if (!item || visual.length < 2) return plan; // the base track may never be empty
  if (index > 0) {
    visual[index - 1]!.end = item.end;
  } else {
    visual[1]!.start = item.start;
  }
  visual.splice(index, 1);
  return plan;
}

export function setCaptionText(plan: EditPlan, index: number, text: string): EditPlan {
  const item = plan.tracks.captions[index];
  if (item) item.text = text;
  return plan;
}

export function setCaptionFields(
  plan: EditPlan,
  index: number,
  fields: Partial<Pick<EditPlan["tracks"]["captions"][number], "in_effect" | "out_effect" | "text">>,
): EditPlan {
  const item = plan.tracks.captions[index];
  if (item) Object.assign(item, fields);
  return plan;
}

export function deleteItem(
  plan: EditPlan,
  track: "captions" | "overlays" | "audio",
  index: number,
): EditPlan {
  const item = plan.tracks[track][index];
  if (!item) return plan;
  if (track === "audio" && (item as AudioItem).role === "voiceover") return plan;
  plan.tracks[track].splice(index, 1);
  return plan;
}

export function setVisualFields(
  plan: EditPlan,
  index: number,
  fields: Partial<
    Pick<
      EditPlan["tracks"]["visual"][number],
      "mode" | "motion" | "transition_out" | "transition_duration" | "media_type"
    >
  >,
): EditPlan {
  const item = plan.tracks.visual[index];
  if (item) Object.assign(item, fields);
  return plan;
}

/** Change the search/generation intent — the old asset no longer matches. */
export function setVisualQuery(
  plan: EditPlan,
  index: number,
  query: string,
  mediaType?: "video" | "image" | null,
): EditPlan {
  const item = plan.tracks.visual[index];
  if (!item) return plan;
  item.broll_query = query;
  if (mediaType !== undefined) item.media_type = mediaType;
  item.asset_path = null;
  item.asset_id = null;
  item.asset_source = null;
  return plan;
}

export function addOverlay(
  plan: EditPlan,
  component: string,
  start: number,
  end: number,
  props: Record<string, unknown>,
): EditPlan {
  const [s, e] = clampSpan(start, end, voiceoverDuration(plan));
  plan.tracks.overlays.push({ component, start: s, end: e, props } as OverlayItem);
  return plan;
}

export function setOverlayProps(
  plan: EditPlan,
  index: number,
  props: Record<string, unknown>,
): EditPlan {
  const item = plan.tracks.overlays[index];
  if (item) item.props = props;
  return plan;
}

export function addAudio(
  plan: EditPlan,
  item: Omit<AudioItem, "role"> & { role: "music" | "sfx" },
): EditPlan {
  const [s, e] = clampSpan(item.start, item.end, voiceoverDuration(plan));
  plan.tracks.audio.push({ ...item, start: s, end: e });
  return plan;
}

export function setAudioFields(
  plan: EditPlan,
  index: number,
  fields: Partial<Pick<AudioItem, "volume" | "loop" | "fade_in" | "fade_out">>,
): EditPlan {
  const item = plan.tracks.audio[index];
  if (item) Object.assign(item, fields);
  return plan;
}
