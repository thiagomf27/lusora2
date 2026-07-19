"use client";
/**
 * Parity preview: the SAME VideoComposition the Remotion renderer uses,
 * mounted in @remotion/player. Plan asset paths are rebased onto the
 * per-video files API so staticFile() resolves in the browser.
 */
import { useMemo } from "react";
import { Player } from "@remotion/player";
import type { EditPlan, Theme, AssetProvenance } from "@lusora/contracts";
import { VideoComposition } from "@lusora/engine/src/renderers/remotion/Composition.tsx";
import { DEFAULT_THEME } from "@lusora/engine/src/themes/runtime.ts";

function rebaseAsset(asset: AssetProvenance, base: string): AssetProvenance {
  return asset.path ? { ...asset, path: base + asset.path } : asset;
}

function rebasePlan(plan: EditPlan, videoId: string): EditPlan {
  const base = `api/videos/${videoId}/files/`;
  const audio = plan.tracks.audio;
  return {
    ...plan,
    tracks: {
      ...plan.tracks,
      visual: plan.tracks.visual.map((v) => ({ ...v, asset: rebaseAsset(v.asset, base) })),
      overlays: plan.tracks.overlays.map((o) =>
        o.asset ? { ...o, asset: rebaseAsset(o.asset, base) } : o
      ),
      audio: {
        ...audio,
        voiceover: { ...audio.voiceover, path: base + audio.voiceover.path },
        music: (audio.music ?? []).map((m) => ({ ...m, path: base + m.path })),
        sfx: (audio.sfx ?? []).map((s) => ({ ...s, path: base + s.path })),
      },
    },
  };
}

function totalDuration(plan: EditPlan): number {
  const vo = plan.tracks.audio.voiceover;
  const visualEnd = plan.tracks.visual.length
    ? plan.tracks.visual[plan.tracks.visual.length - 1].end_s
    : 0;
  return Math.max(visualEnd, (vo.start_s ?? 0) + vo.duration_s);
}

export default function PlanPreview({
  videoId,
  plan,
  theme,
}: {
  videoId: string;
  plan: EditPlan;
  theme?: Theme | null;
}) {
  const rebased = useMemo(() => rebasePlan(plan, videoId), [plan, videoId]);
  const inputProps = useMemo(
    () => ({ plan: rebased, theme: theme ?? DEFAULT_THEME }),
    [rebased, theme]
  );
  return (
    <Player
      component={VideoComposition}
      inputProps={inputProps}
      durationInFrames={Math.max(Math.ceil(totalDuration(plan) * plan.fps), 1)}
      fps={plan.fps}
      compositionWidth={plan.resolution.width}
      compositionHeight={plan.resolution.height}
      controls
      style={{ width: "100%", aspectRatio: `${plan.resolution.width} / ${plan.resolution.height}` }}
    />
  );
}
