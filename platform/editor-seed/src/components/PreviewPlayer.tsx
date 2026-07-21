/**
 * Live preview: the Remotion <Player> rendering the SAME MainComposition the
 * CLI render uses, wrapped in an AssetSourceContext that loads assets from
 * the UI API's Range-capable /files/ endpoint. inputProps mirror the render
 * CLI exactly: { plan, assets, captionsEnabled, captionsStyle }.
 */

import { useEffect, useMemo } from "react";
import { Player } from "@remotion/player";
import {
  AssetSourceContext,
  MainComposition,
  parseResolution,
  voiceoverDuration,
  type AssetSource,
} from "@engine/player";
import { fileUrl } from "../api";
import { playerRef } from "../playerRef";
import { usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";

export function PreviewPlayer() {
  const videoId = usePlanStore((s) => s.videoId);
  const plan = usePlanStore((s) => s.workingPlan);
  const cfg = usePlanStore((s) => s.cfg);
  const assets = usePlanStore((s) => s.assets);
  const setPlayhead = useUiStore((s) => s.setPlayhead);
  const setPlaying = useUiStore((s) => s.setPlaying);

  const source: AssetSource = useMemo(
    () => ({ resolve: (relPath) => fileUrl(videoId!, relPath) }),
    [videoId],
  );

  const inputProps = useMemo(
    () =>
      plan && cfg
        ? {
            plan,
            assets,
            captionsEnabled: cfg.captions_enabled,
            captionsStyle: cfg.captions_style,
          }
        : null,
    [plan, cfg, assets],
  );

  // mirror the Player's position/state into the ui store for the timeline
  useEffect(() => {
    const player = playerRef.current;
    if (!player || !plan) return;
    const onFrame = (e: { detail: { frame: number } }) => setPlayhead(e.detail.frame / plan.fps);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    player.addEventListener("frameupdate", onFrame);
    player.addEventListener("play", onPlay);
    player.addEventListener("pause", onPause);
    return () => {
      player.removeEventListener("frameupdate", onFrame);
      player.removeEventListener("play", onPlay);
      player.removeEventListener("pause", onPause);
    };
  }, [plan, setPlayhead, setPlaying]);

  if (!plan || !cfg || !inputProps) return null;
  const { width, height } = parseResolution(plan.resolution);
  const durationInFrames = Math.max(1, Math.round(voiceoverDuration(plan) * plan.fps));

  return (
    <AssetSourceContext.Provider value={source}>
      <div className="flex h-full items-center justify-center bg-black/60 p-4">
        <Player
          ref={playerRef}
          component={MainComposition}
          inputProps={inputProps}
          durationInFrames={durationInFrames}
          compositionWidth={width}
          compositionHeight={height}
          fps={plan.fps}
          style={{ width: "100%", maxHeight: "100%", aspectRatio: `${width} / ${height}` }}
          controls
          doubleClickToFullscreen
          spaceKeyToPlayOrPause={false}
        />
      </div>
    </AssetSourceContext.Provider>
  );
}
