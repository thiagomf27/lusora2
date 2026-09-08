/**
 * The whole video, SHIFTED so that one window of it begins at frame 0.
 *
 * For previewing a SLICE — one beat in the platform's beat review screen —
 * where the player's own timeline should be that slice: six seconds long,
 * scrubbing six seconds, showing 0:00–0:06, rather than a sliver of a
 * fifty-six second bar.
 *
 * The plan is never cut down to the slice to achieve that, and the difference
 * matters: a transition is drawn by the items on BOTH sides of a cut, a
 * shortened source freezes on a handle computed from the whole timeline, and a
 * music bed's ducking envelope is absolute-time. Cutting would quietly change
 * all three, which is the opposite of what a parity preview is for. So the
 * plan stays whole and a negative-offset Sequence moves it under the window
 * instead: everything inside sees the frame numbers it would see in a real
 * render, and only the player's view of them has moved.
 *
 * Lives in the engine rather than in the platform because it is composition
 * code — it needs `remotion` itself, which the platform does not depend on
 * (importing it there loads a second copy of the library and Remotion refuses
 * to run). Same reason OverlaySolo lives here.
 */
import { Sequence } from "remotion";
import { VideoComposition, type VideoInput } from "./Composition.tsx";

export interface BeatWindowInput extends VideoInput {
  /** Frames to shift the video back by — the window's start. 0 draws it whole. */
  offsetFrames: number;
  /** The video's own length, so the shifted composition still spans it all. */
  fullFrames: number;
}

export function BeatWindow({ offsetFrames, fullFrames, ...rest }: BeatWindowInput) {
  if (!offsetFrames) return <VideoComposition {...rest} />;
  return (
    <Sequence from={-offsetFrames} durationInFrames={fullFrames}>
      <VideoComposition {...rest} />
    </Sequence>
  );
}
