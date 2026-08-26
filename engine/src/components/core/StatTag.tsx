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
import {
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const StatTagProps = z.object({
  value: z.number(),
  unit: z.string().max(20).optional(),
  label: z.string().max(48),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("top_right"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type StatTagProps = z.infer<typeof StatTagProps>;

export function StatTag({ props, theme }: { props: StatTagProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "StatTag",
    supported: PANEL_ENTRANCES,
    fallback: "pop",  // the corner tag has always popped in
    seconds: 0.35,
  });
  const { opacity, inDur } = entrance;
  const surface = surfaceStyle(theme, { radius: 10, alpha: "d9", accentRule: "top" });
  const ground = groundStyle(theme, { radius: 10, alpha: "d9", accentRule: "top", legible: true });
  const rule = ruleWidth(theme, Math.max(3, height * 0.006));

  const countDur = Math.round(fps * 1.0 * durationMul);
  const shown = Math.round(
    interpolate(frame, [0, countDur], [0, props.value], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: curve,
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
        ...(ground ?? {}),
        borderTop: surface.accentRule === "top" ? `${rule}px solid ${accent}` : undefined,
        borderLeft: surface.accentRule === "left" ? `${rule}px solid ${accent}` : undefined,
        padding: `${height * 0.022 * density}px ${width * 0.024 * density}px`,
        opacity,
        // A pop keeps its own overshoot curve — that overshoot IS the pop.
        scale:
          entrance.kind === "pop"
            ? `${interpolate(frame, [0, inDur], [0.8, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              })}`
            : "1",
        translate: entrance.translate,
        clipPath: entrance.clipPath,
        transformOrigin: `${left ? "left" : "right"} ${top ? "top" : "bottom"}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: width * 0.008 * density }}>
        <span
          style={{
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.085 * typeScale(theme, "number"),
            fontWeight: typeWeight(theme, 700),
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
              fontSize: height * 0.03 * typeScale(theme, "body"),
              color: theme.colors.text,
              letterSpacing: typeTracking(theme, 0.06),
            }}
          >
            {props.unit}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: height * 0.008 * density,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.026 * typeScale(theme, "caption"),
          color: mutedInk(theme),
          letterSpacing: typeTracking(theme, 0.08),
          textTransform: typeCase(theme, "uppercase"),
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

/** Which optional token blocks this component can actually obey (Part 3). */
StatTag.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
