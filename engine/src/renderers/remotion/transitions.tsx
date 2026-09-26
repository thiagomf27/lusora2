/**
 * Maps the plan's transition_out kinds onto @remotion/transitions
 * presentations. `crossfade` and `fade` are both A/B dissolves (the stock
 * fade presentation — this matches the ffmpeg path, where both map to xfade
 * "fade"); `fade_to_black` is a custom dip-to-black presentation (outgoing
 * visible behind a black veil ramping 0→1 in the first half, incoming behind
 * the veil ramping 1→0 in the second half). Ported from video-engine.
 *
 * The slice-2 kinds (transitions plan): `push` and `wipe` are the stock CSS
 * `slide()` and `wipe()`; `flash`, `zoom_through` and `whip` are custom and
 * CSS-only, like the dip. The package's shader presentations (crossZoom,
 * linearBlur, zoomBlur) would draw a zoom or a whip more convincingly, but
 * they render through the experimental HTML-in-canvas path, and renders here
 * run on software GL (swiftshader) — a transition must never be the thing that
 * makes a render slow or fail.
 */

import { fade } from "@remotion/transitions/fade";
import { slide, type SlideDirection } from "@remotion/transitions/slide";
import { wipe, type WipeDirection } from "@remotion/transitions/wipe";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";
import type { TransitionDirection } from "@lusora/contracts";
import { AbsoluteFill, Easing } from "remotion";
import type { TransitionKind } from "./timeline.ts";

type Empty = Record<string, unknown>;
type Props = TransitionPresentationComponentProps<Empty>;

/** 0 at both ends, 1 at the midpoint — where the two sides swap. */
const peak = (p: number) => 1 - Math.abs(2 * p - 1);

/** Outgoing in the first half, incoming in the second, behind a veil of `color`. */
function dipTo(color: string, curve: (veil: number) => number): React.FC<Props> {
  const Dip: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
    const secondHalf = presentationProgress >= 0.5;
    const visible = presentationDirection === "entering" ? secondHalf : !secondHalf;
    return (
      <AbsoluteFill style={{ opacity: visible ? 1 : 0 }}>
        {children}
        <AbsoluteFill style={{ backgroundColor: color, opacity: curve(peak(presentationProgress)) }} />
      </AbsoluteFill>
    );
  };
  return Dip;
}

const DipToBlack = dipTo("black", (v) => v);
// A flash is a burst, not a dip: the white arrives fast and leaves fast, so
// the veil is near-full for most of the transition instead of only at its peak.
const Flash = dipTo("white", (v) => Math.sqrt(v));

/** The old shot punches in and dissolves while the new one settles from a little past full frame. */
const ZoomThrough: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
  const p = Easing.inOut(Easing.cubic)(presentationProgress);
  const exiting = presentationDirection === "exiting";
  const scale = exiting ? 1 + 0.35 * p : 1.15 - 0.15 * p;
  return (
    <AbsoluteFill
      style={{
        transform: `scale(${scale})`,
        opacity: exiting ? 1 : p,
        filter: `blur(${(6 * peak(presentationProgress)).toFixed(2)}px)`,
      }}
    >
      {children}
    </AbsoluteFill>
  );
};

/** Unit vector the picture moves along, in screen axes (y down). */
const MOTION: Record<TransitionDirection, [number, number]> = {
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
  down: [0, 1],
};

/**
 * A fast pan across both shots with the blur a real whip would leave. The
 * easing puts nearly all the travel in the middle, which is what makes it read
 * as a camera flick rather than a slide. CSS blur is isotropic — a directional
 * smear needs a shader — so the blur is kept to the middle where the motion
 * hides that.
 */
function whipIn(direction: TransitionDirection): React.FC<Props> {
  const [dx, dy] = MOTION[direction];
  const Whip: React.FC<Props> = ({ children, presentationDirection, presentationProgress }) => {
    const p = Easing.inOut(Easing.exp)(presentationProgress);
    // exiting travels 0 → one frame along the motion; entering arrives from one frame behind
    const shift = presentationDirection === "exiting" ? p : p - 1;
    return (
      <AbsoluteFill
        style={{
          transform: `translate(${(dx * shift * 100).toFixed(3)}%, ${(dy * shift * 100).toFixed(3)}%)`,
          filter: `blur(${(18 * peak(presentationProgress)).toFixed(2)}px)`,
        }}
      >
        {children}
      </AbsoluteFill>
    );
  };
  return Whip;
}

// Built once: presentationFor runs on every render, and a component type made
// per call would remount both shots — and their <Video> elements — every frame.
const WHIPS: Record<TransitionDirection, React.FC<Props>> = {
  left: whipIn("left"),
  right: whipIn("right"),
  up: whipIn("up"),
  down: whipIn("down"),
};

/** Remotion names the edge the new shot comes FROM; the plan names where the picture goes. */
const FROM: Record<TransitionDirection, SlideDirection & WipeDirection> = {
  left: "from-right",
  right: "from-left",
  up: "from-bottom",
  down: "from-top",
};

function custom(component: React.FC<Props>): TransitionPresentation<Empty> {
  return { component, props: {} };
}

export function presentationFor(
  kind: TransitionKind,
  direction: TransitionDirection = "left",
): TransitionPresentation<Empty> {
  switch (kind) {
    case "crossfade":
    case "fade":
      return fade() as TransitionPresentation<Empty>;
    case "fade_to_black":
      return custom(DipToBlack);
    case "flash":
      return custom(Flash);
    case "zoom_through":
      return custom(ZoomThrough);
    case "whip":
      return custom(WHIPS[direction]);
    case "push":
      return slide({ direction: FROM[direction] }) as TransitionPresentation<Empty>;
    case "wipe":
      return wipe({ direction: FROM[direction] }) as TransitionPresentation<Empty>;
  }
}
