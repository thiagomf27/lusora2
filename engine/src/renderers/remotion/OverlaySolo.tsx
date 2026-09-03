/**
 * One catalog overlay, alone, over a themed backdrop — the composition behind
 * the platform's Overlays screen (and usable in Studio).
 *
 * It resolves the component from the SAME registry Composition.tsx uses and
 * mounts it inside a Sequence of the full duration, so the component sees the
 * frame numbers and useVideoConfig() values it would see in a real render.
 * An unregistered name renders the "no renderer" state rather than nothing,
 * which is the one place we want that failure to be visible.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AbsoluteFill, Audio, Img, Sequence, interpolate, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { COMPONENTS } from "../../components/index.ts";
import { TemplateOverlay } from "../../components/templates/TemplateOverlay.tsx";
import { isTemplateKind } from "../../components/templates/registry.ts";
import { fontStack } from "../../themes/runtime.ts";
import { PackagedFonts } from "../../themes/fonts.tsx";
import { Scrim } from "../../themes/scrim.tsx";

export interface OverlaySoloInput {
  component: string;
  props: Record<string, unknown>;
  theme: Theme;
  /** Template-backed entry: drawn by TemplateOverlay, same as in a render. */
  template?: string | null;
  /** Backdrop under the overlay: a shot stand-in, or the flat theme bg. */
  background?: "gradient" | "flat";
  /**
   * A real frame to stand the overlay on, as a URL or data URI. Wins over
   * `background` when set — the whole point of it is to answer "what does this
   * look like over actual footage", which a synthesized gradient cannot.
   */
  backdropImage?: string | null;
  /**
   * The entrance cue this overlay would fire in a real video, already resolved
   * against the theme and its sound pack — see the platform's
   * `lib/overlaySound.ts`, which mirrors the compiler that does it for real.
   *
   * Resolved OUTSIDE this composition on purpose: picking the cue needs the
   * pack manifest (a file on disk) and the catalog entry, neither of which a
   * Remotion composition can reach. Absent means the overlay has no cue on this
   * theme, which is most of them — silence is the default in D48, and a preview
   * that invented a swoosh would be lying about the video.
   */
  sound?: OverlaySoloSound | null;
}

export interface OverlaySoloSound {
  /** URL the browser can fetch — `/api/sounds/<pack>/audio/<file>` today. */
  src: string;
  /** When the cue starts, in seconds from the overlay's own start. */
  startSeconds: number;
  /** How long it plays: the cue's own length, or the window a loop fills. */
  durationSeconds: number;
  /** The theme's sfx gain times the cue's own. */
  gain: number;
  /** A loop cue (a typing bed) rather than a one-shot transient. */
  loop?: boolean;
  /** Tail on a loop, so it stops rather than being cut off. */
  fadeOutSeconds?: number;
}

/** Mix a hex colour towards another by `amount` (0..1). */
function mix(a: string, b: string, amount: number): string {
  const parse = (hex: string) => {
    const v = parseInt(hex.replace("#", ""), 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  const ch = (x: number, y: number) => Math.round(x + (y - x) * amount);
  return `rgb(${ch(r1, r2)}, ${ch(g1, g2)}, ${ch(b1, b2)})`;
}

/**
 * Props typed into a preview are arbitrary, and a component that throws would
 * otherwise leave the whole Player wedged in an error state. Remount this
 * boundary (via `key`) whenever the props change and the next attempt is clean.
 */
class PreviewBoundary extends Component<
  { children: ReactNode; fallback: (message: string) => ReactNode },
  { message: string | null }
> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: unknown) {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // preview-only: keep it out of the render path, but don't swallow it
    console.warn("overlay preview failed", error, info.componentStack);
  }

  render() {
    return this.state.message === null ? this.props.children : this.props.fallback(this.state.message);
  }
}

/**
 * The cue, on the timeline rather than on an <audio> tag beside the player, so
 * it scrubs, loops and pauses with the frame the way it will in the render.
 */
const CueTrack: React.FC<{ sound: OverlaySoloSound }> = ({ sound }) => {
  const { fps } = useVideoConfig();
  const from = Math.round(sound.startSeconds * fps);
  const frames = Math.max(1, Math.round(sound.durationSeconds * fps));
  const fade = Math.round((sound.fadeOutSeconds ?? 0) * fps);
  return (
    <Sequence from={from} durationInFrames={frames}>
      <Audio
        src={sound.src}
        loop={sound.loop}
        // A loop is cut off at the end of its window, so it needs the pack's
        // own tail; a one-shot already ends on its own and takes the flat gain.
        volume={
          fade > 0
            ? (f) =>
                sound.gain *
                interpolate(f, [frames - fade, frames], [1, 0], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                })
            : sound.gain
        }
      />
    </Sequence>
  );
};

export const OverlaySolo: React.FC<OverlaySoloInput> = ({
  component,
  props,
  theme,
  template,
  background = "gradient",
  backdropImage = null,
  sound = null,
}) => {
  const { durationInFrames, height } = useVideoConfig();
  const registered = COMPONENTS[component];
  const kind = isTemplateKind(template) ? template : null;
  const Overlay =
    registered ??
    (kind
      ? ({ props: p, theme: t }: { props: Record<string, unknown>; theme: Theme }) => (
          <TemplateOverlay template={kind} props={p} theme={t} />
        )
      : undefined);
  const backdrop =
    background === "flat"
      ? theme.colors.bg
      : `linear-gradient(135deg, ${theme.colors.bg} 0%, ${mix(
          theme.colors.bg,
          theme.colors.neutral,
          0.28
        )} 100%)`;

  const message = (text: string) => (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        color: theme.colors.neutral,
        fontFamily: fontStack(theme.typography.body),
        fontSize: height * 0.032,
        lineHeight: 1.5,
        textAlign: "center",
        padding: "0 8%",
      }}
    >
      {text}
    </AbsoluteFill>
  );

  return (
    <AbsoluteFill style={{ background: backdrop }}>
      <PackagedFonts />
      {/* Remotion's Img rather than a bare <img>: a Thumbnail paints one frame
          and does not wait for a browser image to decode, so a plain tag shows
          the gradient underneath instead of the picture. */}
      {backdropImage ? (
        <Img src={backdropImage} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : null}
      {sound ? <CueTrack sound={sound} /> : null}
      {Overlay ? (
        <PreviewBoundary
          key={JSON.stringify(props)}
          fallback={(err) => message(`${component} could not render these props — ${err}`)}
        >
          <Sequence from={0} durationInFrames={durationInFrames}>
            <Scrim theme={theme} />
            <Overlay props={props} theme={theme} />
          </Sequence>
        </PreviewBoundary>
      ) : (
        message(
          `${component} has no React component in the engine — a catalog entry alone renders nothing.`
        )
      )}
    </AbsoluteFill>
  );
};
