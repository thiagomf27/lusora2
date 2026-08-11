/**
 * Pure frame math for tracks.visual — no React, fully unit-testable.
 * Ported from video-engine's timeline.ts, adapted to the monorepo's
 * edit_plan v1.0 item shape (start_s/end_s, transition_out object, speed).
 *
 * TRANSITION SEMANTICS (edit-plan.md): item times are NARRATIVE CUT POINTS
 * and never move. A transition_out overlaps [cut, cut + D]: the incoming item
 * plays its real content from the cut, while the OUTGOING item extends past
 * the cut consuming HANDLES — spare media beyond its used range. Images have
 * infinite handles; a video without enough spare footage falls back to a
 * freeze-frame of its last available frame.
 *
 * SPEED (v1.0): a visual item's `speed` is a playbackRate multiplier applied
 * to video assets. It never changes the item's on-timeline (narrative)
 * duration — cut points are fixed — but it changes how much SOURCE footage a
 * slot consumes: at speed 2.0 a 5s slot eats 10s of footage, so the
 * freeze-frame threshold (availableFrames, below) shrinks proportionally.
 */

import type { EditPlan, VisualItem } from "@lusora/contracts";

/** Renderer default when a transition's duration_s is absent (edit_plan v1.0). */
export const DEFAULT_TRANSITION_SECONDS = 0.5;

/** Transition kinds that overlap two clips (i.e. everything but a hard cut). */
export type TransitionKind = "crossfade" | "fade" | "fade_to_black";

/** Per-visual-item asset info the composition needs; built node-side by buildAssetManifest. */
export interface VisualAsset {
  kind: "video" | "image" | "color";
  /** Path relative to the video dir, resolved via staticFile at render time.
   *  Null only for `color` fills (no asset) or an unresolved editor-preview item. */
  src: string | null;
  /** Probed source duration in seconds; null for images/color (infinite handles). */
  durationInSeconds: number | null;
}

export interface VisualLayout {
  /** Frames of narrative content (start_s..end_s) — cut points, never moved. */
  narrativeFrames: number;
  /** Handle frames appended past the cut, consumed by transitionOut. */
  extensionFrames: number;
  /** Transition into the NEXT item, overlapping this item's extension. */
  transitionOut: { kind: TransitionKind; durationInFrames: number } | null;
  /**
   * Video only: number of COMPOSITION frames the source can cover before the
   * freeze-frame fallback, accounting for in_offset_s and speed. Null =
   * infinite (images/color, or no probed duration).
   */
  availableFrames: number | null;
}

/**
 * Browser-safe fallback manifest (no node-side probing): derive kind from
 * media_type and treat every source as having infinite handles
 * (durationInSeconds = null) so nothing freezes. Used by the Remotion Player
 * preview (editor) and Studio, where durations cannot be probed. The CLI
 * render always supplies a real probed manifest via buildAssetManifest.
 */
export function fallbackAssets(plan: EditPlan): VisualAsset[] {
  return plan.tracks.visual.map((item) => {
    const kind: VisualAsset["kind"] =
      item.media_type === "image" ? "image" : item.media_type === "color" ? "color" : "video";
    return {
      kind,
      src: kind === "color" ? null : (item.asset?.path ?? null),
      durationInSeconds: null,
    };
  });
}

export function buildVisualTimeline(
  items: VisualItem[],
  assets: VisualAsset[],
  fps: number,
): VisualLayout[] {
  const narrative = items.map((item, i) => {
    const frames = Math.round(item.end_s * fps) - Math.round(item.start_s * fps);
    if (frames < 1) {
      throw new Error(
        `visual[${i}]: spans ${item.start_s}..${item.end_s}s, which is shorter than one frame at ${fps} fps`,
      );
    }
    return frames;
  });

  return items.map((item, i) => {
    const transitionOut = transitionAfter(item, i, narrative, fps);
    const extensionFrames = transitionOut?.durationInFrames ?? 0;
    const asset = assets[i];
    const availableFrames = availablePlaybackFrames(item, asset, fps);
    return { narrativeFrames: narrative[i]!, extensionFrames, transitionOut, availableFrames };
  });
}

/**
 * Composition frames of playback a video source supports from its trim start,
 * at the item's speed. Images/color and unprobed videos are treated as
 * infinite (null). At playbackRate s, one composition frame advances the
 * source by s frames, so a source with F frames beyond the trim start yields
 * floor(F / s) composition frames before its last decodable frame.
 */
function availablePlaybackFrames(
  item: VisualItem,
  asset: VisualAsset | undefined,
  fps: number,
): number | null {
  if (!asset || asset.kind !== "video" || asset.durationInSeconds === null) return null;
  // A looping item never runs out of footage: it starts the source again (D55).
  if (item.loop) return null;
  const speed = item.speed ?? 1;
  const inOffset = item.in_offset_s ?? 0;
  const remainingSeconds = Math.max(asset.durationInSeconds - inOffset, 0);
  return Math.floor((remainingSeconds * fps) / speed);
}

function transitionAfter(
  item: VisualItem,
  i: number,
  narrative: number[],
  fps: number,
): VisualLayout["transitionOut"] {
  // A transition_out on the last item has no junction to act on — ignore it.
  if (i >= narrative.length - 1) return null;
  const transition = item.transition_out;
  if (!transition || transition.type === "cut") return null;
  const seconds = transition.duration_s ?? DEFAULT_TRANSITION_SECONDS;
  // TransitionSeries requires a transition shorter than both neighboring
  // sequences; clamping to narrative - 1 is safe on both sides since a
  // sequence is never shorter than its narrative span.
  const durationInFrames = Math.min(
    Math.round(seconds * fps),
    narrative[i]! - 1,
    narrative[i + 1]! - 1,
  );
  if (durationInFrames < 1) return null; // no room to breathe — degrade to a hard cut
  return { kind: transition.type, durationInFrames };
}
