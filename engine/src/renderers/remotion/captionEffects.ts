/**
 * Per-item caption in/out effect math (tracks.captions in_effect/out_effect)
 * as pure opacity/offset/scale values — no React, unit-testable. Ported from
 * video-engine's captionEffects.ts. Effects run for 0.25s (clamped to half
 * the item) at each end; between them the caption sits at rest.
 */

import { interpolate } from "remotion";
import type { CaptionInEffect, CaptionOutEffect } from "@lusora/contracts";

const EFFECT_SECONDS = 0.25;

export interface CaptionPose {
  opacity: number;
  /** Vertical offset as a fraction of composition height (positive = down). */
  offsetYFraction: number;
  scale: number;
}

const REST: CaptionPose = { opacity: 1, offsetYFraction: 0, scale: 1 };

export function captionPose(
  item: { in_effect?: CaptionInEffect | null; out_effect?: CaptionOutEffect | null },
  frame: number,
  durationInFrames: number,
  fps: number,
): CaptionPose {
  const effectFrames = Math.min(Math.round(EFFECT_SECONDS * fps), Math.floor(durationInFrames / 2));
  if (effectFrames < 1) return REST;

  const inEffect = item.in_effect ?? null;
  if (inEffect !== null && frame < effectFrames) {
    const progress = interpolate(frame, [0, effectFrames], [0, 1], { extrapolateRight: "clamp" });
    return inPose(inEffect, progress);
  }
  const outEffect = item.out_effect ?? null;
  const outStart = durationInFrames - effectFrames;
  if (outEffect !== null && frame >= outStart) {
    const progress = interpolate(frame, [outStart, durationInFrames - 1], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    });
    return outPose(outEffect, progress);
  }
  return REST;
}

function inPose(effect: CaptionInEffect, progress: number): CaptionPose {
  switch (effect) {
    case "fade":
      return { opacity: progress, offsetYFraction: 0, scale: 1 };
    case "pop":
      // ease-out-back: overshoots to ~1.05 then settles at 1
      return { opacity: Math.min(progress * 2, 1), offsetYFraction: 0, scale: easeOutBack(progress) };
    case "slide_up":
      return { opacity: progress, offsetYFraction: 0.03 * (1 - progress), scale: 1 };
  }
}

function outPose(effect: CaptionOutEffect, progress: number): CaptionPose {
  switch (effect) {
    case "fade":
      return { opacity: 1 - progress, offsetYFraction: 0, scale: 1 };
    case "pop":
      return { opacity: 1 - progress, offsetYFraction: 0, scale: 1 - 0.15 * progress };
    case "slide_down":
      return { opacity: 1 - progress, offsetYFraction: 0.03 * progress, scale: 1 };
  }
}

function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}
