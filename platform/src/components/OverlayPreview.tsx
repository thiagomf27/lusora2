"use client";
/**
 * Live preview of one catalog overlay: the engine's OverlaySolo composition in
 * @remotion/player — the same components, theme runtime and frame math the
 * renderer uses, so this is a real preview and not a mock-up.
 */
import { useMemo, useRef } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import type { Theme } from "@lusora/contracts";
import { OverlaySolo } from "@lusora/engine/src/renderers/remotion/OverlaySolo.tsx";

const FPS = 30;
const WIDTH = 1280;
const HEIGHT = 720;

export default function OverlayPreview({
  component,
  props,
  theme,
  template = null,
  durationSeconds,
  background = "gradient",
  backdropImage = null,
}: {
  component: string;
  props: Record<string, unknown>;
  theme: Theme;
  /** Template-backed entry: drawn by the engine's TemplateOverlay. */
  template?: string | null;
  durationSeconds: number;
  background?: "gradient" | "flat";
  /** A real frame to stand the overlay on; wins over `background`. */
  backdropImage?: string | null;
}) {
  const ref = useRef<PlayerRef>(null);
  const inputProps = useMemo(
    () => ({ component, props, theme, template, background, backdropImage }),
    [component, props, theme, template, background, backdropImage]
  );
  const durationInFrames = Math.max(Math.round(durationSeconds * FPS), 2);
  return (
    <Player
      ref={ref}
      component={OverlaySolo}
      inputProps={inputProps}
      durationInFrames={durationInFrames}
      // Browsers block autoplay without a user gesture, and frame 0 of an
      // overlay is mid-entrance — usually invisible. Open on the settled
      // frame (the fraction preview-all.mjs samples) so a paused player still
      // shows the component.
      initialFrame={Math.floor(durationInFrames * 0.66)}
      fps={FPS}
      compositionWidth={WIDTH}
      compositionHeight={HEIGHT}
      controls
      loop
      autoPlay
      style={{ width: "100%", aspectRatio: "16 / 9" }}
    />
  );
}
