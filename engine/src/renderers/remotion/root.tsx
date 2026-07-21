/** Remotion entry point: registered root reading plan + theme + assets from inputProps. */
import { Composition, getInputProps, registerRoot } from "remotion";
import type { EditPlan, Theme } from "@lusora/contracts";
import { DEFAULT_THEME } from "../../themes/runtime.ts";
import { VideoComposition, type VideoInput } from "./Composition.tsx";
import { fallbackAssets } from "./timeline.ts";

function totalDuration(plan: EditPlan): number {
  const vo = plan.tracks.audio.voiceover;
  const visualEnd = plan.tracks.visual.length
    ? plan.tracks.visual[plan.tracks.visual.length - 1].end_s
    : 0;
  return Math.max(visualEnd, (vo.start_s ?? 0) + vo.duration_s);
}

function Root() {
  const input = getInputProps() as unknown as Partial<VideoInput>;
  const plan = input.plan as EditPlan;
  const theme = (input.theme as Theme) ?? DEFAULT_THEME;
  const assets = input.assets ?? fallbackAssets(plan);
  return (
    <Composition
      id="video"
      component={VideoComposition as unknown as React.ComponentType<Record<string, unknown>>}
      durationInFrames={Math.max(Math.ceil(totalDuration(plan) * plan.fps), 1)}
      fps={plan.fps}
      width={plan.resolution.width}
      height={plan.resolution.height}
      defaultProps={{ plan, theme, assets } as unknown as Record<string, unknown>}
    />
  );
}

registerRoot(Root);
