/**
 * ArchiveCounter — "Archive" pack (archival documentary).
 *
 * A figure on a plate under a tan label strip. The number is set in the theme's
 * mono at tabular width, which is the whole reason this pack asks for a
 * typewriter face: a counting figure in a proportional face reflows on every
 * frame and the digits visibly shuffle sideways.
 *
 * Type size steps down past 8 and 11 glyphs so a long figure stays inside the
 * plate at 1280×720 — measured on the SETTLED value, never the animated one,
 * or the whole number would resize mid-count as it gains digits.
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

export const ArchiveCounterProps = z.object({
  value: z.number(),
  /** Tracked-out line on the tan strip above the plate. */
  label: z.string().max(32).optional(),
  /** Sentence under the figure, inside the plate. */
  caption: z.string().max(72).optional(),
  prefix: z.string().max(4).optional(),
  suffix: z.string().max(12).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
  /** Prefixes the settled figure with "~". */
  approximate: z.boolean().default(false),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveCounterProps = z.infer<typeof ArchiveCounterProps>;

export function ArchiveCounter({ props, theme }: { props: ArchiveCounterProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  const ground = emphasisColor(theme, props.emphasis);
  const groundInk = contrastInk(theme, ground);

  const hairline = Math.max(1, Math.round(height * 0.0022));
  const inDur = Math.round(fps * 0.4 * durationMul);
  const wipeDur = Math.round(fps * 0.5 * durationMul);
  const plateAt = Math.round(fps * 0.12 * durationMul);
  const labelAt = Math.round(fps * 0.24 * durationMul);
  const countAt = Math.round(fps * 0.4 * durationMul);
  const countDur = Math.round(fps * 1.5 * durationMul);
  const captionAt = countAt + Math.round(countDur * 0.55);

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const barWipe = interpolate(frame, [0, wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const plateWipe = interpolate(frame, [plateAt, plateAt + wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  // Decelerating count: fast off the mark, settling on the figure. No overshoot.
  const progress = interpolate(frame, [countAt, countAt + countDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const fadeAt = (at: number) =>
    interpolate(frame, [at, at + inDur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const format = (v: number) =>
    v.toLocaleString("en-US", {
      minimumFractionDigits: props.decimals,
      maximumFractionDigits: props.decimals,
    });
  const shown = format(props.value * progress);
  const glyphs = format(props.value).length + (props.approximate ? 1 : 0);
  const figureSize = height * (glyphs > 11 ? 0.1 : glyphs > 8 ? 0.12 : 0.145);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: `0 ${width * 0.07}px`,
        filter: `drop-shadow(0 ${height * 0.008}px ${height * 0.022}px rgba(0,0,0,0.42))`,
        opacity: interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: width * 0.84 }}>
        {props.label ? (
          <div style={{ position: "relative" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: ground,
                transformOrigin: "left center",
                scale: `${barWipe} 1`,
              }}
            />
            <div
              style={{
                position: "relative",
                padding: `${height * 0.013}px ${width * 0.022}px ${height * 0.014}px`,
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.023,
                fontWeight: 600,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: groundInk,
                whiteSpace: "nowrap",
                opacity: fadeAt(labelAt),
              }}
            >
              {props.label}
            </div>
          </div>
        ) : null}

        <div style={{ position: "relative", alignSelf: "stretch" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: paper,
              transformOrigin: "left center",
              scale: `${plateWipe} 1`,
            }}
          />
          <div
            style={{
              position: "relative",
              padding: `${height * 0.045}px ${width * 0.038}px ${height * 0.042}px`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: width * 0.008,
                fontFamily: fontStack(theme.typography.body),
                fontVariantNumeric: "tabular-nums",
                color: ink,
                opacity: fadeAt(countAt - inDur),
              }}
            >
              {props.prefix ? (
                <span style={{ fontSize: figureSize * 0.36, fontWeight: 400, color: theme.colors.neutral }}>
                  {props.prefix}
                </span>
              ) : null}
              {/* The settled figure, invisible, reserves the width the counting
                  one will need. Without it the plate is sized by whatever the
                  count has reached and the card grows a digit at a time. */}
              <span
                style={{
                  position: "relative",
                  display: "inline-block",
                  fontSize: figureSize,
                  fontWeight: 600,
                  lineHeight: 1.02,
                  letterSpacing: "-0.03em",
                }}
              >
                <span style={{ visibility: "hidden" }}>
                  {props.approximate ? "~" : ""}
                  {format(props.value)}
                </span>
                <span style={{ position: "absolute", left: 0, top: 0 }}>
                  {props.approximate && progress >= 1 ? "~" : ""}
                  {shown}
                </span>
              </span>
              {props.suffix ? (
                <span style={{ fontSize: figureSize * 0.36, fontWeight: 400, color: theme.colors.neutral }}>
                  {props.suffix}
                </span>
              ) : null}
            </div>

            {props.caption ? (
              <>
                <div
                  style={{
                    height: hairline,
                    width: width * 0.12,
                    margin: `${height * 0.03}px 0 ${height * 0.024}px`,
                    background: theme.colors.neutral,
                    transformOrigin: "left center",
                    scale: `${progress} 1`,
                  }}
                />
                <div
                  style={{
                    maxWidth: width * 0.6,
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.024,
                    fontWeight: 400,
                    lineHeight: 1.4,
                    color: theme.colors.neutral,
                    overflowWrap: "anywhere",
                    opacity: fadeAt(captionAt),
                  }}
                >
                  {props.caption}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
