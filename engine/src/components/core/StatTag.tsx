/**
 * StatTag — a corner chip carrying one number and what it means.
 *
 * Numerals use the BODY face with tabular-nums, never the display face:
 * Playfair's old-style proportional figures make a counting number jitter
 * sideways as digits change. Same rule in AnimatedCounter, BarChart,
 * RankLabel and ComparisonSplit.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const StatTagProps = z.object({
  value: z.number(),
  unit: z.string().max(20).optional(),
  label: z.string().max(48),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("top_right"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type StatTagProps = z.infer<typeof StatTagProps>;

export function StatTag({ props, theme }: { props: StatTagProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.35 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const countDur = Math.round(fps * 1.0 * durationMul);
  const shown = Math.round(
    interpolate(frame, [0, countDur], [0, props.value], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    }),
  );

  const top = props.position.startsWith("top");
  const left = props.position.endsWith("left");

  return (
    <div
      style={{
        position: "absolute",
        top: top ? height * 0.11 : undefined,
        bottom: top ? undefined : height * 0.11,
        left: left ? width * 0.06 : undefined,
        right: left ? undefined : width * 0.06,
        display: "flex",
        flexDirection: "column",
        alignItems: left ? "flex-start" : "flex-end",
        background: `${theme.colors.bg}d9`,
        borderRadius: 10,
        borderTop: `${Math.max(3, height * 0.006)}px solid ${accent}`,
        padding: `${height * 0.022}px ${width * 0.024}px`,
        opacity,
        scale: `${interpolate(frame, [0, inDur], [0.8, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
        })}`,
        transformOrigin: `${left ? "left" : "right"} ${top ? "top" : "bottom"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: width * 0.008 }}>
        <span
          style={{
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.085,
            fontWeight: 700,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
            color: accent,
          }}
        >
          {shown.toLocaleString("en-US")}
        </span>
        {props.unit ? (
          <span
            style={{
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.03,
              color: theme.colors.text,
              letterSpacing: "0.06em",
            }}
          >
            {props.unit}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: height * 0.008,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.026,
          color: theme.colors.neutral,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          maxWidth: width * 0.3,
          textAlign: left ? "left" : "right",
          opacity: interpolate(frame, [inDur + 6, inDur + 6 + fps * 0.4], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {props.label}
      </div>
    </div>
  );
}
