/**
 * Still-image motion (tracks.visual `motion`) as a CSS transform. Pure and
 * unit-testable. Ported from video-engine's motion.ts and adapted to the
 * monorepo's motion object (type / direction / pan / strength) — here the pan
 * direction is explicit in the plan, not seeded-random.
 *
 * The transform runs over the item's FULL stretch (narrative + extension), so
 * the motion keeps going through a transition handle, as an image's infinite
 * handles imply.
 */

import type { Motion } from "@lusora/contracts";

const PAN_UNIT: Record<NonNullable<Motion["pan"]>, [number, number]> = {
  center: [0, 0],
  left: [1, 0],
  right: [-1, 0],
  up: [0, 1],
  down: [0, -1],
};

const DEFAULT_STRENGTH = 0.15;

/** Transform for a still at local `frame` of a `totalFrames`-long stretch. */
export function motionTransform(
  motion: Motion | null | undefined,
  frame: number,
  totalFrames: number,
): string {
  if (!motion || motion.type === "none") return "none";

  const progress = totalFrames <= 1 ? 0 : Math.min(frame / (totalFrames - 1), 1);
  const strength = motion.strength ?? DEFAULT_STRENGTH;
  const direction = motion.direction ?? "in";
  // "in" zooms from 1 toward 1+strength; "out" reverses it.
  const zoom = direction === "in" ? 1 + strength * progress : 1 + strength * (1 - progress);
  const [px, py] = PAN_UNIT[motion.pan ?? "center"];
  const shift = strength * 50 * progress; // pixels, matched to the M6 renderer
  return `scale(${round3(zoom)}) translate(${round3(px * shift)}px, ${round3(py * shift)}px)`;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
