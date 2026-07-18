/**
 * The Remotion composition: track consumers driven by the validated plan.
 * Theme injected at render time; components resolved from the registry.
 */
import {
  AbsoluteFill,
  Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import type { EditPlan, Theme, VisualItem, OverlayItem } from "@lusora/contracts";
import { COMPONENTS } from "../../components/index.ts";
import { captionStyle } from "../../themes/runtime.ts";

export interface VideoInput {
  plan: EditPlan;
  theme: Theme;
}

function KenBurnsImage({ item, fps }: { item: VisualItem; fps: number }) {
  const frame = useCurrentFrame();
  const dur = (item.end_s - item.start_s) * fps;
  const motion = item.motion;
  let transform = "none";
  if (motion?.type === "ken_burns") {
    const strength = motion.strength ?? 0.12;
    const t = Math.min(frame / Math.max(dur, 1), 1);
    const zoom =
      (motion.direction ?? "in") === "in" ? 1 + strength * t : 1 + strength * (1 - t);
    const panMap: Record<string, [number, number]> = {
      center: [0, 0],
      left: [1, 0],
      right: [-1, 0],
      up: [0, 1],
      down: [0, -1],
    };
    const [px, py] = panMap[motion.pan ?? "center"] ?? [0, 0];
    const shift = strength * 50 * t;
    transform = `scale(${zoom}) translate(${px * shift}px, ${py * shift}px)`;
  }
  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      <Img
        src={staticFile(item.asset.path)}
        style={{ width: "100%", height: "100%", objectFit: "cover", transform }}
      />
    </AbsoluteFill>
  );
}

function VisualTrack({ plan }: { plan: EditPlan }) {
  const { fps } = useVideoConfig();
  return (
    <>
      {plan.tracks.visual.map((item) => {
        const from = Math.round(item.start_s * fps);
        const durFrames = Math.max(Math.round((item.end_s - item.start_s) * fps), 1);
        const fade = item.transition_out && item.transition_out.type !== "cut";
        return (
          <Sequence key={item.id} from={from} durationInFrames={durFrames}>
            {item.media_type === "image" ? (
              <KenBurnsImage item={item} fps={fps} />
            ) : item.media_type === "color" ? (
              <AbsoluteFill style={{ background: "#000" }} />
            ) : (
              <AbsoluteFill style={{ overflow: "hidden" }}>
                <OffthreadVideo
                  src={staticFile(item.asset.path)}
                  startFrom={Math.round((item.in_offset_s ?? 0) * fps)}
                  muted={item.mute ?? true}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              </AbsoluteFill>
            )}
            {fade ? <FadeOut durFrames={durFrames} toBlack={item.transition_out!.type === "fade_to_black"} seconds={item.transition_out!.duration_s ?? 0.5} /> : null}
          </Sequence>
        );
      })}
    </>
  );
}

function FadeOut({ durFrames, toBlack, seconds }: { durFrames: number; toBlack: boolean; seconds: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fadeFrames = Math.round(seconds * fps);
  const opacity = interpolate(frame, [durFrames - fadeFrames, durFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ background: "#000", opacity: toBlack ? opacity : opacity * 0.0 }} />;
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
          if (!Component) return null;
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

function Captions({ plan, theme }: { plan: EditPlan; theme: Theme }) {
  const { fps, height } = useVideoConfig();
  const captions = plan.tracks.captions;
  if (!captions.enabled) return null;
  const style = captionStyle(theme, captions.preset ?? "plain");
  const scale = height / 1080;
  return (
    <>
      {captions.items.map((c, i) => (
        <Sequence
          key={i}
          from={Math.round(c.start_s * fps)}
          durationInFrames={Math.max(Math.round((c.end_s - c.start_s) * fps), 1)}
        >
          <div
            style={{
              position: "absolute",
              bottom: height * 0.06,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "center",
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
              {c.text}
            </span>
          </div>
        </Sequence>
      ))}
    </>
  );
}

function AudioTracks({ plan }: { plan: EditPlan }) {
  const { fps, durationInFrames } = useVideoConfig();
  const vo = plan.tracks.audio.voiceover;
  return (
    <>
      <Sequence from={Math.round((vo.start_s ?? 0) * fps)}>
        <Audio src={staticFile(vo.path)} volume={vo.volume ?? 1} />
      </Sequence>
      {(plan.tracks.audio.music ?? []).map((m, i) => (
        <Sequence key={i} from={Math.round(m.start_s * fps)}>
          <Audio
            src={staticFile(m.path)}
            volume={m.volume ?? 0.12}
            loop={m.loop ?? false}
          />
        </Sequence>
      ))}
      {durationInFrames ? null : null}
    </>
  );
}

export function VideoComposition({ plan, theme }: VideoInput) {
  return (
    <AbsoluteFill style={{ background: "#000" }}>
      <VisualTrack plan={plan} />
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
