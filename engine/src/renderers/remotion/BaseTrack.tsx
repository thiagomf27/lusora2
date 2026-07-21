/**
 * BaseTrack — plays tracks.visual as a TransitionSeries. Ported from
 * video-engine's BaseTrack.tsx, adapted to edit_plan v1.0.
 *
 * Cut points are narrative and never move (see timeline.ts). Videos play from
 * their trim start (in_offset_s) at their playbackRate (speed), muted unless
 * the item opts in; when a transition needs more footage than the source has
 * — accounting for speed — the item freezes on its last available frame.
 * Stills get the item's `motion`, which keeps moving through the handle.
 */

import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EditPlan, VisualItem } from "@lusora/contracts";
import { motionTransform } from "./motion.ts";
import { buildVisualTimeline, type VisualAsset, type VisualLayout } from "./timeline.ts";
import { presentationFor } from "./transitions.tsx";

export const BaseTrack: React.FC<{ plan: EditPlan; assets: VisualAsset[] }> = ({
  plan,
  assets,
}) => {
  const { fps } = useVideoConfig();
  const items = plan.tracks.visual;
  const layouts = useMemo(() => buildVisualTimeline(items, assets, fps), [items, assets, fps]);

  return (
    <TransitionSeries>
      {items.flatMap((item, i) => {
        const layout = layouts[i]!;
        const nodes = [
          <TransitionSeries.Sequence
            key={`visual-${i}`}
            durationInFrames={layout.narrativeFrames + layout.extensionFrames}
          >
            <VisualItemContent item={item} asset={assets[i]!} layout={layout} />
          </TransitionSeries.Sequence>,
        ];
        if (layout.transitionOut) {
          nodes.push(
            <TransitionSeries.Transition
              key={`transition-${i}`}
              presentation={presentationFor(layout.transitionOut.kind)}
              timing={linearTiming({ durationInFrames: layout.transitionOut.durationInFrames })}
            />,
          );
        }
        return nodes;
      })}
    </TransitionSeries>
  );
};

const COVER: React.CSSProperties = { width: "100%", height: "100%", objectFit: "cover" };

const VisualItemContent: React.FC<{
  item: VisualItem;
  asset: VisualAsset;
  layout: VisualLayout;
}> = ({ item, asset, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const totalFrames = layout.narrativeFrames + layout.extensionFrames;

  if (asset.kind === "color" || asset.src === null) {
    return <AbsoluteFill style={{ backgroundColor: "black" }} />;
  }

  if (asset.kind === "image") {
    return (
      <AbsoluteFill style={{ backgroundColor: "black", overflow: "hidden" }}>
        <Img
          src={staticFile(asset.src)}
          style={{ ...COVER, transform: motionTransform(item.motion, frame, totalFrames) }}
        />
      </AbsoluteFill>
    );
  }

  const video = (
    <OffthreadVideo
      muted={item.mute ?? true}
      src={staticFile(asset.src)}
      startFrom={Math.round((item.in_offset_s ?? 0) * fps)}
      playbackRate={item.speed ?? 1}
      style={COVER}
    />
  );
  const available = layout.availableFrames;
  if (available === null || available >= totalFrames) {
    return <AbsoluteFill style={{ backgroundColor: "black" }}>{video}</AbsoluteFill>;
  }
  // Not enough spare footage at this speed: freeze on the last composition
  // frame the source can cover so OffthreadVideo is never asked to seek past
  // the end of the source.
  const lastFrame = Math.max(available - 1, 0);
  return (
    <AbsoluteFill style={{ backgroundColor: "black" }}>
      <Freeze frame={lastFrame} active={(f) => f >= lastFrame}>
        {video}
      </Freeze>
    </AbsoluteFill>
  );
};
