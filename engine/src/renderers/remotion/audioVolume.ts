/**
 * Per-frame volume for a music/sfx item: base volume shaped by fade_in_s /
 * fade_out_s ramps (both relative to the item's on-timeline span, not the
 * asset), then multiplied by the ducking envelope. Pure and unit-testable;
 * overlapping fades multiply. Ported from video-engine's audioVolume.ts,
 * adapted to edit_plan v1.0 field names.
 */
import type { GainPoint } from "@lusora/contracts";

export interface VolumeShape {
  volume?: number;
  fade_in_s?: number;
  fade_out_s?: number;
  /** D48 ducking, in ABSOLUTE seconds — not relative to the item. */
  gain_envelope?: GainPoint[];
}

export function audioVolumeAt(
  item: VolumeShape,
  frame: number,
  durationInFrames: number,
  fps: number,
  defaultVolume = 1,
  /**
   * Where this item starts on the timeline, in seconds. The envelope is
   * absolute (the compiler computed it against real sentence timings), while
   * `frame` is relative to the item's Sequence — this is what reconciles them.
   */
  startS = 0,
): number {
  let volume = item.volume ?? defaultVolume;
  const fadeInFrames = item.fade_in_s ? Math.round(item.fade_in_s * fps) : 0;
  if (fadeInFrames > 0) {
    volume *= clamp01(frame / fadeInFrames);
  }
  const fadeOutFrames = item.fade_out_s ? Math.round(item.fade_out_s * fps) : 0;
  if (fadeOutFrames > 0) {
    volume *= clamp01((durationInFrames - frame) / fadeOutFrames);
  }
  if (item.gain_envelope?.length) {
    volume *= gainAt(item.gain_envelope, startS + frame / fps);
  }
  return clamp01(volume);
}

/**
 * Piecewise-linear lookup with the ends held flat.
 *
 * Linear scan rather than a binary search on purpose: the schema caps the
 * envelope at 200 points, and this runs once per frame per music item — at
 * most a few hundred comparisons against a render that is doing real work.
 */
export function gainAt(points: GainPoint[], tS: number): number {
  if (points.length === 0) return 1;
  if (tS <= points[0].t_s) return clamp01(points[0].gain);
  const last = points[points.length - 1];
  if (tS >= last.t_s) return clamp01(last.gain);

  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (tS > b.t_s) continue;
    const a = points[i - 1];
    const span = b.t_s - a.t_s;
    // Coincident points would divide by zero. The compiler emits strictly
    // increasing times, but a hand-edited plan need not.
    if (span <= 0) return clamp01(b.gain);
    return clamp01(a.gain + ((b.gain - a.gain) * (tS - a.t_s)) / span);
  }
  return clamp01(last.gain);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
