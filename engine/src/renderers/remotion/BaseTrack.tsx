/**
 * BaseTrack — plays tracks.visual as a TransitionSeries. Ported from
 * video-engine's BaseTrack.tsx, adapted to edit_plan v1.0.
 *
 * Cut points are narrative and never move (see timeline.ts). Videos play from
 * their trim start (in_offset_s) at their playbackRate (speed), muted unless
 * the item opts in; when a transition needs more footage than the source has
 * — accounting for speed — the item freezes on its last available frame.
 * Stills get the item's `motion`, which keeps moving through the handle.
 *
 * D112 texture: a shot the compiler graded `vintage` plays through the theme's
 * vintage filter, footage through the theme's tape look, and a `crt` shot
 * inside an old television set; `focus_y` moves the cover crop off the centre.
 */

import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { useMemo } from "react";
import {
  AbsoluteFill,
  Freeze,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EditPlan, Theme, VisualItem } from "@lusora/contracts";
import { motionTransform } from "./motion.ts";
import { buildVisualTimeline, type VisualAsset, type VisualLayout } from "./timeline.ts";
import { presentationFor } from "./transitions.tsx";
import { CrtSet, TapeLook, shotFilter, textureOf, type TextureTokens } from "./texture.tsx";

export const BaseTrack: React.FC<{ plan: EditPlan; assets: VisualAsset[]; theme?: Theme }> = ({
  plan,
  assets,
  theme,
}) => {
  const { fps } = useVideoConfig();
  const tokens = useMemo(() => textureOf(theme ?? ({} as Theme)), [theme]);
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
            <TexturedItem item={item} asset={assets[i]!} tokens={tokens}>
              <VisualItemContent item={item} asset={assets[i]!} layout={layout} />
            </TexturedItem>
          </TransitionSeries.Sequence>,
        ];
        if (layout.transitionOut) {
          nodes.push(
            <TransitionSeries.Transition
              key={`transition-${i}`}
              presentation={presentationFor(layout.transitionOut.kind, layout.transitionOut.direction)}
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

/** The cover crop, moved off the centre when the plan says where the picture's subject is. */
function cover(item: VisualItem): React.CSSProperties {
  if (item.focus_y === undefined) return COVER;
  return { ...COVER, objectPosition: `50% ${(item.focus_y * 100).toFixed(1)}%` };
}

/** D112: the shot's grade and tape look, then the television set it may play on. */
const TexturedItem: React.FC<{
  item: VisualItem;
  asset: VisualAsset;
  tokens: TextureTokens;
  children: React.ReactNode;
}> = ({ item, asset, tokens, children }) => {
  const footage = asset.kind === "video" && asset.src !== null;
  const filter = shotFilter(item, tokens, footage);
  let out: React.ReactNode = children;
  if (filter) out = <AbsoluteFill style={{ filter }}>{out}</AbsoluteFill>;
  if (footage && tokens.tape === "vhs") out = <TapeLook seed={item.id}>{out}</TapeLook>;
  if (footage && item.crt && tokens.crt === "tube") out = <CrtSet>{out}</CrtSet>;
  return <>{out}</>;
};

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
          style={{ ...cover(item), transform: motionTransform(item.motion, frame, totalFrames) }}
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
      style={cover(item)}
    />
  );

  // A source shorter than its slot repeats instead of freezing (D55): a frozen
  // frame reads as a stall, a loop reads as a shot. Sequence-based rather than
  // <Loop>, because each pass has to restart at the item's own trim point.
  if (item.loop) {
    const inOffset = item.in_offset_s ?? 0;
    const sourceFrames = Math.max(
      Math.floor(((asset.durationInSeconds ?? 0) - inOffset) * fps / (item.speed ?? 1)),
      1,
    );
    const passes = Math.ceil(totalFrames / sourceFrames);
    return (
      <AbsoluteFill style={{ backgroundColor: "black" }}>
        {Array.from({ length: passes }, (_, pass) => (
          <Sequence key={pass} from={pass * sourceFrames} durationInFrames={sourceFrames}>
            {video}
          </Sequence>
        ))}
      </AbsoluteFill>
    );
  }

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
