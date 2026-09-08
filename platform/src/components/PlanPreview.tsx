"use client";
/**
 * Parity preview: the SAME VideoComposition the Remotion renderer uses,
 * mounted in @remotion/player. Plan asset paths are rebased onto the
 * per-video files API so staticFile() resolves in the browser.
 */
import { useEffect, useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { EditPlan, Theme, AssetProvenance } from "@lusora/contracts";
import { BeatWindow } from "@lusora/engine/src/renderers/remotion/BeatWindow.tsx";
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
  onTime,
  controlRef,
  window: playWindow = null,
  openAt = null,
  loop = false,
}: {
  videoId: string;
  plan: EditPlan;
  theme?: Theme | null;
  /** Called with the playhead position in seconds as playback advances. */
  onTime?: (seconds: number) => void;
  /** Populated with the underlying player so callers can seek. */
  controlRef?: { current: PlayerRef | null };
  /**
   * Play only this slice of the video, in seconds. The whole plan is still
   * mounted — a beat's transition into the next shot is drawn by the items on
   * either side of the cut, so previewing one beat means WINDOWING the real
   * timeline, never rebuilding a shorter one out of it.
   */
  window?: { start_s: number; end_s: number } | null;
  /** Where to park the playhead before anyone presses play, in seconds. */
  openAt?: number | null;
  loop?: boolean;
}) {
  const rebased = useMemo(() => rebasePlan(plan, videoId), [plan, videoId]);
  const ref = useRef<PlayerRef>(null);
  const fps = plan.fps;
  const fullFrames = Math.max(Math.ceil(totalDuration(plan) * fps), 1);
  const offsetFrames = playWindow ? Math.max(Math.floor(playWindow.start_s * fps), 0) : 0;
  // The player's timeline IS the window: its length, its timecode, its scrub.
  const frames = playWindow
    ? Math.max(Math.round((playWindow.end_s - playWindow.start_s) * fps), 1)
    : fullFrames;
  const inputProps = useMemo(
    () => ({ plan: rebased, theme: theme ?? DEFAULT_THEME, offsetFrames, fullFrames }),
    [rebased, theme, offsetFrames, fullFrames]
  );
  useEffect(() => {
    const p = ref.current;
    if (!p) return;
    if (controlRef) controlRef.current = p;
    const handler = (e: { detail: { frame: number } }) => onTime?.(e.detail.frame / fps);
    p.addEventListener("frameupdate", handler);
    return () => p.removeEventListener("frameupdate", handler);
  }, [onTime, controlRef, fps]);
  return (
    <Player
      ref={ref}
      component={BeatWindow}
      inputProps={inputProps}
      durationInFrames={frames}
      fps={plan.fps}
      compositionWidth={plan.resolution.width}
      compositionHeight={plan.resolution.height}
      initialFrame={
        openAt === null ? 0 : Math.min(Math.max(Math.round(openAt * fps) - offsetFrames, 0), frames - 1)
      }
      loop={loop}
      controls
      style={{ width: "100%", height: "100%" }}
    />
  );
}
