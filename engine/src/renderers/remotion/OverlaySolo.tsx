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
import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { COMPONENTS } from "../../components/index.ts";
import { TemplateOverlay } from "../../components/templates/TemplateOverlay.tsx";
import { isTemplateKind } from "../../components/templates/registry.ts";
import { fontStack } from "../../themes/runtime.ts";

export interface OverlaySoloInput {
  component: string;
  props: Record<string, unknown>;
  theme: Theme;
  /** Template-backed entry: drawn by TemplateOverlay, same as in a render. */
  template?: string | null;
  /** Backdrop under the overlay: a shot stand-in, or the flat theme bg. */
  background?: "gradient" | "flat";
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

export const OverlaySolo: React.FC<OverlaySoloInput> = ({
  component,
  props,
  theme,
  template,
  background = "gradient",
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
      {Overlay ? (
        <PreviewBoundary
          key={JSON.stringify(props)}
          fallback={(err) => message(`${component} could not render these props — ${err}`)}
        >
          <Sequence from={0} durationInFrames={durationInFrames}>
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
