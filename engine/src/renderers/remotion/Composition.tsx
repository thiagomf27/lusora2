/**
 * The Remotion composition: track consumers driven by the validated plan.
 * Theme injected at render time; catalog components resolved from the
 * registry. Stacking order: visual base, overlays above it, captions
 * topmost, then audio.
 *
 * The visual base is BaseTrack (a TransitionSeries with real handle
 * consumption, freeze-frame fallback, per-item speed and motion — see
 * timeline.ts / BaseTrack.tsx). Overlays, captions and audio keep the
 * monorepo's themed v1.0 consumers, now with per-item caption in/out effects
 * and music/sfx fade ramps ported from video-engine.
 */
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EditPlan, Theme, CaptionItem, OverlayItem } from "@lusora/contracts";
import { COMPONENTS } from "../../components/index.ts";
import { TemplateOverlay } from "../../components/templates/TemplateOverlay.tsx";
import { isTemplateKind } from "../../components/templates/registry.ts";
import { captionStyle } from "../../themes/runtime.ts";
import { BaseTrack } from "./BaseTrack.tsx";
import { audioVolumeAt } from "./audioVolume.ts";
import { captionPose } from "./captionEffects.ts";
import { fallbackAssets, type VisualAsset } from "./timeline.ts";

export interface VideoInput {
  plan: EditPlan;
  theme: Theme;
  /**
   * Probed visual-asset manifest (durations for the freeze/handle math). The
   * CLI render supplies it; the editor Player preview and Studio omit it and
   * fall back to infinite-handle assets derived from media_type.
   */
  assets?: VisualAsset[];
}

function Overlays({ plan, theme }: { plan: EditPlan; theme: Theme }) {
  const { fps } = useVideoConfig();
  return (
    <>
      {plan.tracks.overlays.map((item: OverlayItem) => {
        const from = Math.round(item.start_s * fps);
        const durFrames = Math.max(Math.round((item.end_s - item.start_s) * fps), 1);
        if (item.kind === "component" && item.component) {
          const Component = COMPONENTS[item.component];
          // A registered component wins; failing that, a template-backed entry
          // carries its layout in the plan (compiled in from the catalog), so
          // an overlay authored as data still draws.
          if (!Component) {
            if (!item.template || !isTemplateKind(item.template)) return null;
            return (
              <Sequence key={item.id} from={from} durationInFrames={durFrames}>
                <TemplateOverlay template={item.template} props={item.props ?? {}} theme={theme} />
              </Sequence>
            );
          }
          return (
            <Sequence key={item.id} from={from} durationInFrames={durFrames}>
              <Component props={item.props ?? {}} theme={theme} />
            </Sequence>
          );
        }
        if (item.kind === "media" && item.asset) {
          const scale = item.transform?.scale ?? 0.35;
          const position = item.transform?.position ?? "bottom_right";
          const posStyle: Record<string, React.CSSProperties> = {
            top_left: { top: "5%", left: "5%" },
            top_right: { top: "5%", right: "5%" },
            bottom_left: { bottom: "8%", left: "5%" },
            bottom_right: { bottom: "8%", right: "5%" },
            center: { top: "50%", left: "50%", transform: "translate(-50%, -50%)" },
          };
          return (
            <Sequence key={item.id} from={from} durationInFrames={durFrames}>
              <div
                style={{
                  position: "absolute",
                  width: `${scale * 100}%`,
                  borderRadius: 8,
                  overflow: "hidden",
                  boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
                  ...posStyle[position],
                }}
              >
                {item.asset.path.endsWith(".mp4") ? (
                  <OffthreadVideo src={staticFile(item.asset.path)} muted style={{ width: "100%" }} />
                ) : (
                  <Img src={staticFile(item.asset.path)} style={{ width: "100%" }} />
                )}
              </div>
            </Sequence>
          );
        }
        return null;
      })}
    </>
  );
}

/**
 * Captions yield to graphics. The compiler already keeps corner overlays out of
 * the bottom strip (_avoid_caption_band), but a component whose whole layout
 * lives down there — a lower third, a chart's own caption line — cannot be moved
 * by a prop, and nothing in the plan says which zone a component occupies. So
 * the rule is positional and needs no per-component knowledge: while any
 * component overlay is on screen, the caption steps up out of the extreme bottom.
 *
 * The lift is deliberately ONE caption-height, not more. The lower third is
 * contested from both sides: components put their own caption/credit lines at
 * the very bottom (~94% down), while lower-third footers — QuoteBlock's
 * attribution, NamePlate's role — sit around 66%. Lifting further clears the
 * first and lands on the second, which is exactly the collision this replaced.
 * A zone declared per component in the catalog would let the caption place
 * itself properly; until that exists, this threads between the two.
 */
const CAPTION_BOTTOM = 0.06;
const CAPTION_BOTTOM_LIFTED = 0.13;

function Captions({ plan, theme }: { plan: EditPlan; theme: Theme }) {
  const { fps } = useVideoConfig();
  const captions = plan.tracks.captions;
  if (!captions.enabled) return null;
  const graphics = plan.tracks.overlays.filter((o) => o.kind === "component");
  return (
    <>
      {captions.items.map((c, i) => {
        const durFrames = Math.max(Math.round((c.end_s - c.start_s) * fps), 1);
        const overlapped = graphics.some((o) => c.start_s < o.end_s && c.end_s > o.start_s);
        return (
          <Sequence key={i} from={Math.round(c.start_s * fps)} durationInFrames={durFrames}>
            <Caption
              item={c}
              theme={theme}
              preset={captions.preset ?? "plain"}
              durationInFrames={durFrames}
              bottomFraction={overlapped ? CAPTION_BOTTOM_LIFTED : CAPTION_BOTTOM}
            />
          </Sequence>
        );
      })}
    </>
  );
}

function Caption({
  item,
  theme,
  preset,
  durationInFrames,
  bottomFraction,
}: {
  item: CaptionItem;
  theme: Theme;
  preset: string;
  durationInFrames: number;
  bottomFraction: number;
}) {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const style = captionStyle(theme, preset);
  const scale = height / 1080;
  const pose = captionPose(item, frame, durationInFrames, fps);
  return (
    <div
      style={{
        position: "absolute",
        bottom: height * bottomFraction,
        left: 0,
        right: 0,
        display: "flex",
        justifyContent: "center",
        opacity: pose.opacity,
        transform: `translateY(${pose.offsetYFraction * height}px) scale(${pose.scale})`,
      }}
    >
      <span
        style={{
          fontFamily: style.fontFamily,
          fontSize: style.fontSize * scale,
          color: style.color,
          background: style.background,
          padding: style.padding,
          borderRadius: style.borderRadius,
          fontStyle: style.fontStyle ?? "normal",
          letterSpacing: style.letterSpacing,
          textTransform: style.textTransform ?? "none",
          maxWidth: "80%",
          textAlign: "center",
        }}
      >
        {item.text}
      </span>
    </div>
  );
}

function AudioTracks({ plan }: { plan: EditPlan }) {
  const { fps } = useVideoConfig();
  const vo = plan.tracks.audio.voiceover;
  const music = plan.tracks.audio.music ?? [];
  const sfx = plan.tracks.audio.sfx ?? [];
  return (
    <>
      <Sequence from={Math.round((vo.start_s ?? 0) * fps)}>
        <Audio src={staticFile(vo.path)} volume={vo.volume ?? 1} />
      </Sequence>
      {[...music, ...sfx].map((m, i) => {
        const from = Math.round(m.start_s * fps);
        const end = m.end_s ?? null;
        const durFrames = end !== null ? Math.max(Math.round((end - m.start_s) * fps), 1) : undefined;
        return (
          <Sequence key={i} from={from} durationInFrames={durFrames}>
            <Audio
              src={staticFile(m.path)}
              loop={m.loop ?? false}
              // fades are relative to the item span, not the looped asset:
              // without "extend" the volume frame restarts on every loop
              loopVolumeCurveBehavior="extend"
              volume={(frame) =>
                audioVolumeAt(m, frame, durFrames ?? Number.MAX_SAFE_INTEGER, fps, 0.12)
              }
            />
          </Sequence>
        );
      })}
    </>
  );
}

export function VideoComposition({ plan, theme, assets }: VideoInput) {
  const resolvedAssets = assets ?? fallbackAssets(plan);
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <BaseTrack plan={plan} assets={resolvedAssets} />
      <Overlays plan={plan} theme={theme} />
      <Captions plan={plan} theme={theme} />
      <AudioTracks plan={plan} />
      {theme.grain && theme.grain !== "none" ? (
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.35) 100%)",
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
}
