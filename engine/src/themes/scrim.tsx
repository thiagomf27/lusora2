/**
 * The wash a theme lays over the frame while an overlay is on screen (D79).
 *
 * Lives here rather than in any component because it is not a component's
 * business: every overlay would otherwise have to draw the same rectangle, and
 * thirty copies of one idea is thirty places for it to drift. The two HOSTS
 * mount it — `Composition.tsx` for a real render and `OverlaySolo.tsx` for the
 * platform's preview — inside the same Sequence as the overlay, so it is timed
 * to that overlay without being told anything about it.
 *
 * It fades on its own curve rather than the component's. A component's entrance
 * is a move (a rise, a wipe); the shot going down is a light cue, and it has to
 * lead slightly or the first frames of the graphic land on undimmed footage.
 *
 * Two overlays that overlap in time each mount one, so their scrims compound.
 * That is the honest reading — two graphics up at once IS more to separate from
 * the shot — and the pipeline puts one overlay on screen at a time anyway.
 */
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { fadeInOutRange, motionScale, scrimAlpha } from "./runtime.ts";

export function Scrim({ theme }: { theme: Theme }) {
  const alpha = scrimAlpha(theme);
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  // Inert unless a theme asks: no element at all, so a theme from before D79
  // renders the same DOM it always did.
  if (alpha === 0) return null;

  // Slightly faster in than out: the dip should be there before the graphic is,
  // and should outlast it rather than snapping the shot back to full brightness
  // under the tail of an exit.
  const inFrames = Math.max(1, Math.round(fps * 0.22 * durationMul));
  const outFrames = Math.max(1, Math.round(fps * 0.36 * durationMul));
  const opacity = interpolate(
    frame,
    fadeInOutRange(durationInFrames, inFrames, outFrames),
    [0, alpha, alpha, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return <AbsoluteFill style={{ backgroundColor: "#000000", opacity, pointerEvents: "none" }} />;
}
