/** Remotion entry point: registered root reading plan + theme from inputProps. */
import { Composition, getInputProps, registerRoot } from "remotion";
import type { EditPlan, Theme } from "@lusora/contracts";
import { DEFAULT_THEME } from "../../themes/runtime.ts";
import { VideoComposition, type VideoInput } from "./Composition.tsx";

function totalDuration(plan: EditPlan): number {
  const vo = plan.tracks.audio.voiceover;
  const visualEnd = plan.tracks.visual.length
    ? plan.tracks.visual[plan.tracks.visual.length - 1].end_s
    : 0;
  return Math.max(visualEnd, (vo.start_s ?? 0) + vo.duration_s);
}

function Root() {
  const input = getInputProps() as unknown as VideoInput;
  const plan = input.plan;
  const theme = input.theme ?? DEFAULT_THEME;
  return (
    <Composition
      id="video"
      component={VideoComposition as React.ComponentType<Record<string, unknown>>}
      durationInFrames={Math.max(Math.ceil(totalDuration(plan) * plan.fps), 1)}
      fps={plan.fps}
      width={plan.resolution.width}
      height={plan.resolution.height}
      defaultProps={{ plan, theme } as unknown as Record<string, unknown>}
    />
  );
}

registerRoot(Root);
