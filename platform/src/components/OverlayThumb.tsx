"use client";
/**
 * One catalog overlay drawn as a still, for a grid of them.
 *
 * @remotion/player's Thumbnail renders a SINGLE frame of the same OverlaySolo
 * composition the Overlays screen animates — same components, same theme
 * runtime, same frame math — so a card shows what the renderer would draw
 * rather than an icon standing in for it. A full <Player> per card would mount
 * a media stack and a rAF loop each; twenty-six of those on one screen is what
 * this exists to avoid.
 *
 * The frame sampled is the same 0.66 fraction the interactive preview opens on:
 * far enough past the entrance that the component has settled.
 */
import { Thumbnail } from "@remotion/player";
import type { Theme } from "@lusora/contracts";
import { OverlaySolo } from "@lusora/engine/src/renderers/remotion/OverlaySolo.tsx";

const FPS = 30;

export default function OverlayThumb({
  component,
  props,
  theme,
  template = null,
  durationSeconds,
  backdropImage = null,
}: {
  component: string;
  props: Record<string, unknown>;
  theme: Theme;
  template?: string | null;
  durationSeconds: number;
  /** A real frame to stand the overlay on; wins over the gradient. */
  backdropImage?: string | null;
}) {
  const durationInFrames = Math.max(Math.round(durationSeconds * FPS), 2);
  return (
    <Thumbnail
      component={OverlaySolo}
      // `as const` on purpose: Thumbnail infers its Props from this literal, and
      // a widened `background: string` no longer matches OverlaySolo's union.
      inputProps={{
        component,
        props,
        theme,
        template,
        background: "gradient" as const,
        backdropImage,
      }}
      durationInFrames={durationInFrames}
      frameToDisplay={Math.floor(durationInFrames * 0.66)}
      fps={FPS}
      compositionWidth={1280}
      compositionHeight={720}
      style={{ width: "100%", height: "100%" }}
      errorFallback={() => null}
    />
  );
}
