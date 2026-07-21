/**
 * Maps the plan's transition_out kinds onto @remotion/transitions
 * presentations. `crossfade` and `fade` are both A/B dissolves (the stock
 * fade presentation — this matches the ffmpeg path, where both map to xfade
 * "fade"); `fade_to_black` is a custom dip-to-black presentation (outgoing
 * visible behind a black veil ramping 0→1 in the first half, incoming behind
 * the veil ramping 1→0 in the second half). Ported from video-engine.
 */

import { fade } from "@remotion/transitions/fade";
import type {
  TransitionPresentation,
  TransitionPresentationComponentProps,
} from "@remotion/transitions";
import { AbsoluteFill } from "remotion";
import type { TransitionKind } from "./timeline.ts";

type Empty = Record<string, unknown>;

const DipToBlack: React.FC<TransitionPresentationComponentProps<Empty>> = ({
  children,
  presentationDirection,
  presentationProgress,
}) => {
  const secondHalf = presentationProgress >= 0.5;
  const visible = presentationDirection === "entering" ? secondHalf : !secondHalf;
  // Triangle profile: exactly 1 at the midpoint, where the sides swap.
  const veil = 1 - Math.abs(2 * presentationProgress - 1);
  return (
    <AbsoluteFill style={{ opacity: visible ? 1 : 0 }}>
      {children}
      <AbsoluteFill style={{ backgroundColor: "black", opacity: veil }} />
    </AbsoluteFill>
  );
};

function dipToBlack(): TransitionPresentation<Empty> {
  return { component: DipToBlack, props: {} };
}

export function presentationFor(kind: TransitionKind): TransitionPresentation<Empty> {
  switch (kind) {
    case "crossfade":
    case "fade":
      return fade() as TransitionPresentation<Empty>;
    case "fade_to_black":
      return dipToBlack();
  }
}
