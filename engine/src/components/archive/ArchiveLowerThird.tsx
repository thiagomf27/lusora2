/**
 * ArchiveLowerThird — "Archive" pack (archival documentary).
 *
 * The pack's signature lockup: a hard-edged white plate carrying the name in a
 * heavy grotesque, welded to a tan sub-bar carrying the role in tracked-out
 * mono. Both strips are sized by their own text, which is what gives the pair
 * its stepped look — the sub-bar is never padded out to match the name.
 *
 * Each strip's fill is a layer *under* its text, so the wipe never stretches a
 * glyph. The drop shadow is a `drop-shadow()` filter on the wrapper rather than
 * a `box-shadow` per strip: the strips are flush, so per-strip shadows would
 * paint the plate's shadow across the tan bar instead of lifting the lockup off
 * the footage as one object.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastInk,
  emphasisColor,
  fadeInOutRange,
  fontStack,
  motionScale,
  surfaceColor,
} from "../theme.ts";

export const ArchiveLowerThirdProps = z.object({
  title: z.string().max(44),
  subtitle: z.string().max(56).optional(),
  position: z.enum(["bottom_left", "bottom_right"]).default("bottom_left"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveLowerThirdProps = z.infer<typeof ArchiveLowerThirdProps>;

export function ArchiveLowerThird({ props, theme }: { props: ArchiveLowerThirdProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  // The sub-bar is a GROUND with dark type on it, not a mark — the tan reads at
  // 8.3:1 under ink. `neutral` swaps in a grey ground of the same weight.
  const ground = emphasisColor(theme, props.emphasis);
  // Type on the tan, not type on the page: read the ground, not the theme's ink.
  const groundInk = contrastInk(theme, ground);

  const right = props.position === "bottom_right";
  const origin = right ? "right center" : "left center";

  const inDur = Math.round(fps * 0.4 * durationMul);
  const wipeDur = Math.round(fps * 0.5 * durationMul);
  const barWipeAt = Math.round(fps * 0.16 * durationMul);
  const titleAt = Math.round(fps * 0.2 * durationMul);
  const subAt = Math.round(fps * 0.36 * durationMul);

  const plateWipe = interpolate(frame, [0, wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const barWipe = interpolate(frame, [barWipeAt, barWipeAt + wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const fadeAt = (at: number) =>
    interpolate(frame, [at, at + inDur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        left: right ? undefined : width * 0.07,
        right: right ? width * 0.07 : undefined,
        bottom: height * 0.12,
        display: "flex",
        flexDirection: "column",
        alignItems: right ? "flex-end" : "flex-start",
        maxWidth: width * 0.62,
        filter: `drop-shadow(0 ${height * 0.006}px ${height * 0.018}px rgba(0,0,0,0.42))`,
        opacity: interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div style={{ position: "relative" }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: paper,
            transformOrigin: origin,
            scale: `${plateWipe} 1`,
          }}
        />
        <div
          style={{
            position: "relative",
            padding: `${height * 0.022}px ${width * 0.028}px ${height * 0.024}px`,
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.062,
            fontWeight: 700,
            lineHeight: 1.06,
            letterSpacing: "-0.01em",
            color: ink,
            textAlign: right ? "right" : "left",
            overflowWrap: "anywhere",
            opacity: fadeAt(titleAt),
          }}
        >
          {props.title}
        </div>
      </div>

      {props.subtitle ? (
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: ground,
              transformOrigin: origin,
              scale: `${barWipe} 1`,
            }}
          />
          <div
            style={{
              position: "relative",
              padding: `${height * 0.013}px ${width * 0.028}px ${height * 0.014}px`,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.023,
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: groundInk,
              textAlign: right ? "right" : "left",
              overflowWrap: "anywhere",
              opacity: fadeAt(subAt),
            }}
          >
            {props.subtitle}
          </div>
        </div>
      ) : null}
    </div>
  );
}
