/**
 * useEntrance (D46) — the frame-aware half of the theme runtime.
 *
 * Every overlay used to compute its own entrance by hand: an `inDur`, a
 * `fadeInOutRange`, a hardcoded `Easing.bezier(0.16, 1, 0.3, 1)` and a translate
 * interpolation. All of that collapses into one hook, so the theme's `motion`
 * tokens are read in exactly one place (D8: appearance resolves once).
 *
 * Kept apart from ./runtime.ts because that file must stay importable outside a
 * Remotion context (the platform's ThemePreview resolves tokens in the browser).
 */
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Entrance, Theme } from "@lusora/contracts";
import { easingCurve, entranceFor, fadeInOutRange, motionScale } from "./runtime.ts";

/** Entrances that move a whole panel — the set most components support. */
export const PANEL_ENTRANCES: readonly Entrance[] = ["fade", "rise", "slide", "pop", "wipe"];

/** Panel entrances plus typewriter, for components whose payload is text. */
export const TEXT_ENTRANCES: readonly Entrance[] = [...PANEL_ENTRANCES, "typewriter"];

export interface EntranceOptions {
  /** Catalog name, so `motion.per_component` can target this component. */
  component: string;
  /** Entrances this component can actually draw; anything else becomes `fade`. */
  supported: readonly Entrance[];
  /** What this component did before D46 — the no-theme fallback. */
  fallback: Entrance;
  /** Signed horizontal offset for `slide`, in px. Defaults to 6% of width. */
  slide?: number;
  /** Vertical offset for `rise`, in px. Defaults to 1.5% of height. */
  rise?: number;
  /** Scale a `pop` starts from. Components with a subtler pop pass their own. */
  popFrom?: number;
  /** Entrance length in seconds, before motion_feel scaling. */
  seconds?: number;
}

export interface EntranceState {
  /** The entrance actually playing, after support + override resolution. */
  kind: Entrance;
  /** Fade in AND out, ready to drop on the outermost element. */
  opacity: number;
  /** 0 -> 1 across the entrance, eased by the theme's curve. */
  progress: number;
  /** CSS `translate` value for the resolved entrance ("0px 0px" when static). */
  translate: string;
  /** The same offsets in px, for components composing their own exit transform. */
  translateX: number;
  translateY: number;
  /** CSS `scale` value; 1 except during a `pop`. */
  scale: number;
  /** Set only for `wipe`; undefined otherwise. */
  clipPath: string | undefined;
  /** Entrance length in frames — for staggering children behind the entrance. */
  inDur: number;
  /** Seconds -> frames, scaled by motion_feel. For stagger gaps and holds. */
  frames: (seconds: number) => number;
  /** 0 -> 1 for something landing `delayFrames` after the entrance. */
  after: (delayFrames: number, seconds?: number) => number;
  /**
   * Eased 0 -> 1 over `frames` from the overlay's start, independent of the
   * entrance kind — for content that animates on its own clock (a figure
   * counting up, a bar growing) and must keep doing so under `fade`.
   */
  ramp: (frames: number) => number;
  /** Progressive reveal for `typewriter`; the full string for every other kind. */
  typed: (text: string) => string;
}

export function useEntrance(theme: Theme, opts: EntranceOptions): EntranceState {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);

  const kind = entranceFor(theme, opts.component, opts.supported, opts.fallback);
  const easing = Easing.bezier(...easingCurve(theme));
  const inDur = Math.round(fps * (opts.seconds ?? 0.45) * durationMul);

  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Always the eased ramp, including under `fade`: components use `progress`
  // for internal reveals too (an underline growing, a rule scaling in), and
  // those must keep animating whatever the panel itself does.
  const progress = interpolate(frame, [0, Math.max(inDur, 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing,
  });

  const slideBy = opts.slide ?? width * 0.06;
  const riseBy = opts.rise ?? height * 0.015;
  const popFrom = opts.popFrom ?? 0.8;

  const translateX = kind === "slide" ? slideBy * (1 - progress) : 0;
  const translateY = kind === "rise" ? riseBy * (1 - progress) : 0;

  const ramp = (frames: number) =>
    interpolate(frame, [0, Math.max(frames, 1)], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing,
    });

  const after = (delayFrames: number, seconds = 0.4) =>
    interpolate(
      frame,
      [inDur + delayFrames, inDur + delayFrames + fps * seconds * durationMul],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing }
    );

  return {
    kind,
    opacity,
    progress,
    translate: `${translateX}px ${translateY}px`,
    translateX,
    translateY,
    scale: kind === "pop" ? popFrom + (1 - popFrom) * progress : 1,
    clipPath: kind === "wipe" ? `inset(0 ${(1 - progress) * 100}% 0 0)` : undefined,
    inDur,
    frames: (seconds: number) => Math.round(fps * seconds * durationMul),
    after,
    ramp,
    typed: (text: string) =>
      kind === "typewriter" ? text.slice(0, Math.ceil(progress * text.length)) : text,
  };
}
