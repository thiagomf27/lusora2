/**
 * ComparisonSplit — two sides of one number, divided down the middle.
 *
 * Colour is derived, not passed: the LARGER value takes the accent, the
 * smaller takes neutral. That keeps the "which side wins" read automatic and
 * avoids a palette prop, which would break the semantic-props rule.
 * Numerals use the body face + tabular-nums so the counters don't jitter.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  chartStyle,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

const side = z.object({
  label: z.string().max(24),
  value: z.number(),
  note: z.string().max(24).optional(),
});

export const ComparisonSplitProps = z.object({
  left: side,
  right: side,
  unit: z.string().max(16).optional(),
  caption: z.string().max(64).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ComparisonSplitProps = z.infer<typeof ComparisonSplitProps>;

export function ComparisonSplit({ props, theme }: { props: ComparisonSplitProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const chart = chartStyle(theme);
  const ground = groundStyle(theme, { radius: 14, accentRule: "none" });
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "ComparisonSplit",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const dividerDur = Math.round(fps * 0.4 * durationMul);
  const outStart = durationInFrames - Math.round(fps * 0.4 * durationMul);
  const dividerScale = Math.min(
    interpolate(frame, [0, dividerDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: curve,
    }),
    interpolate(frame, [outStart, durationInFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.45, 0, 0.55, 1),
    }),
  );

  const countDur = Math.round(fps * 1.1 * durationMul);
  const numeric = fontStack(theme.typography.body);
  const halves = [
    { data: props.left, isLeft: true, start: dividerDur * 0.5 },
    { data: props.right, isLeft: false, start: dividerDur * 0.5 + Math.round(fps * 0.15 * durationMul) },
  ];

  return (
    <div style={{ position: "absolute", inset: 0, opacity, translate: entrance.translate, scale: `${entrance.scale}`, clipPath: entrance.clipPath }}>
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center" }}>
        {halves.map(({ data, isLeft, start }) => {
          const wipe = interpolate(frame, [start, start + fps * 0.5 * durationMul], [100, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          const shown = Math.round(
            interpolate(frame, [start, start + countDur], [0, data.value], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            }),
          );
          const wins = data.value >= (isLeft ? props.right.value : props.left.value);
          const color = wins ? accent : theme.colors.neutral;
          return (
            <div
              key={isLeft ? "left" : "right"}
              style={{
                flex: 1,
                height: "100%",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: height * 0.012 * density,
                padding: `0 ${width * 0.05 * density}px`,
                // Each half wipes in from its own outer edge.
                clipPath: isLeft ? `inset(0 0 0 ${wipe}%)` : `inset(0 ${wipe}% 0 0)`,
              }}
            >
              <div
                style={{
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.03 * typeScale(theme, "title"),
                  letterSpacing: typeTracking(theme, 0.18),
                  textTransform: typeCase(theme, "uppercase"),
                  color: theme.colors.text,
                  whiteSpace: "nowrap",
                }}
              >
                {data.label}
              </div>
              <div
                style={{
                  fontFamily: numeric,
                  fontSize: height * 0.115 * typeScale(theme, "number"),
                  fontWeight: typeWeight(theme, 700),
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1.05,
                  color,
                  whiteSpace: "nowrap",
                }}
              >
                {chart.formatNumber(shown)}
                {props.unit ? <span style={{ fontSize: height * 0.032 * typeScale(theme, "body"), marginLeft: width * 0.006 * density }}>{props.unit}</span> : null}
              </div>
              {data.note ? (
                <div
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.026 * typeScale(theme, "kicker"),
                    color: theme.colors.neutral,
                    whiteSpace: "nowrap",
                  }}
                >
                  {data.note}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {ground ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.05 * density,
            top: height * 0.12 * density,
            width: width - width * 0.1 * density,
            height: height - height * 0.24 * density,
            ...ground,
            zIndex: -1,
          }}
        />
      ) : null}

      {/* Divider draws top to bottom before either half arrives. */}
      <div
        style={{
          position: "absolute",
          left: width / 2 - 1,
          top: height * 0.22 * density,
          width: ruleWidth(theme, Math.max(2, width * 0.0016)),
          height: height * 0.56,
          background: `${theme.colors.neutral}99`,
          scale: `1 ${dividerScale}`,
          transformOrigin: "top center",
        }}
      />

      {props.caption ? (
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: height * 0.1 * density,
            textAlign: "center",
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.024 * typeScale(theme, "caption"),
            letterSpacing: typeTracking(theme, 0.1),
            textTransform: typeCase(theme, "uppercase"),
            color: theme.colors.neutral,
            opacity: interpolate(frame, [countDur * 0.6, countDur * 0.6 + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.caption}
        </div>
      ) : null}
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
ComparisonSplit.honors = ["typography", "surface.density", "surface.rule", "motion.entrance", "motion.easing"];
