/**
 * The arithmetic the worker applies to a style pack's numbers, mirrored so the
 * Style Packs screen can show what a pack will actually allow before a video
 * is ever queued.
 *
 * This is a deliberate duplicate of the worker's plan validator (its
 * validators.py: the density map, the overlay cap and the beat-count range).
 * If the rules move there, move them here — a preview that promises a plan the
 * validator rejects is worse than no preview at all.
 */
import type { OverlayDensity } from "@lusora/contracts";

/** validators.py: {"low": 1.0, "normal": 2.5, "high": 5.0}, dict → per_minute */
export function densityPerMinute(density: OverlayDensity): number {
  if (typeof density === "object") return Number(density.per_minute) || 0;
  return { low: 1, normal: 2.5, high: 5 }[density] ?? 2.5;
}

/** validators.py: max_overlays = ceil(per_minute * duration_s / 60) + 1 */
export function overlayBudget(density: OverlayDensity, durationS: number): number {
  return Math.ceil((densityPerMinute(density) * durationS) / 60) + 1;
}

/** validators.py: target = duration_s / avg_hold; [floor(t*0.5), ceil(t*1.8)+1] */
export function beatRange(avgHold: number, durationS: number): [number, number] {
  if (!avgHold || avgHold <= 0) return [0, 0];
  const target = durationS / avgHold;
  return [Math.floor(target * 0.5), Math.ceil(target * 1.8) + 1];
}
