/**
 * MetricGrid — two to six KPI tiles, each a figure with its change.
 *
 * The nearest neighbour is `FactSheet`, and the difference is hierarchy. A
 * fact sheet sets label and value at the same weight in one column, because it
 * is a dossier and you read it top to bottom. A KPI tile inverts that: the
 * FIGURE is the object and the label is its caption, and the tiles sit in a
 * grid because they are peers rather than a sequence. Add `change_pct` — a
 * second number about the first — and the row layout stops working entirely.
 *
 * Direction is authored, not derived from the sign, because "down" is not
 * always bad and the arrow has to be able to disagree with the arithmetic:
 * casualties down 12% is a good quarter, and a component that colours the sign
 * would say the opposite.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  densityScale,
  easingCurve,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  seriesColors,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const MetricGridProps = z.object({
  title: z.string().max(48).optional(),
  metrics: z
    .array(
      z.object({
        label: z.string().max(24),
        value: z.string().max(14),
        change_pct: z.number().optional(),
        direction: z.enum(["up", "down", "flat"]).default("flat"),
      }),
    )
    .min(2)
    .max(6),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type MetricGridProps = z.infer<typeof MetricGridProps>;

const GLYPH = { up: "▲", down: "▼", flat: "—" } as const;

export function MetricGrid({ props, theme }: { props: MetricGridProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "MetricGrid",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    seconds: 0.4,
  });
  const { opacity } = entrance;
  const ramp = seriesColors(theme);
  const dirColor = (d: "up" | "down" | "flat") =>
    props.emphasis === "neutral" || d === "flat"
      ? mutedInk(theme)
      : d === "up"
        ? ramp[0]
        : ramp[2];

  const ground = groundStyle(theme, { radius: 10, alpha: "e6", legible: true });
  // The title is not inside a tile, so it carries type on the footage and needs
  // a ground of its own — the same catch every converted component needed.
  const titleGround = groundStyle(theme, { radius: 8, legible: true });
  const n = props.metrics.length;
  // Two rows at most: six tiles in one line are unreadable at 1080p and the
  // grid is what makes them peers.
  const cols = n <= 3 ? n : Math.ceil(n / 2);
  const tileW = (width * 0.8 * (1 + (1 - density) * 0.12)) / cols;
  const stagger = Math.round(fps * 0.09 * durationMul);
  const start = Math.round(fps * 0.25 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {props.title ? (
        <div
          style={{
            marginBottom: height * 0.03 * density,
            ...(titleGround
              ? { ...titleGround, padding: `${height * 0.016 * density}px ${width * 0.026 * density}px` }
              : {}),
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.045 * typeScale(theme, "title"),
            fontWeight: typeWeight(theme, 700),
            letterSpacing: typeTracking(theme),
            textTransform: typeCase(theme),
            color: theme.colors.text,
            opacity: interpolate(frame, [0, start], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            }),
          }}
        >
          {props.title}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, ${tileW}px)`,
          gap: width * 0.014 * density,
        }}
      >
        {props.metrics.map((m, i) => {
          const enter = interpolate(frame, [start + i * stagger, start + i * stagger + fps * 0.4 * durationMul], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          const color = dirColor(m.direction);
          return (
            <div
              key={i}
              style={{
                ...(ground ?? {}),
                padding: `${height * 0.026 * density}px ${width * 0.018 * density}px`,
                borderTop: `${ruleWidth(theme, Math.max(3, height * 0.005))}px solid ${color}`,
                opacity: enter,
                translate: `0 ${interpolate(enter, [0, 1], [height * 0.012, 0])}px`,
              }}
            >
              <div
                style={{
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.02 * typeScale(theme, "caption"),
                  fontWeight: typeWeight(theme, 500),
                  letterSpacing: typeTracking(theme, 0.1),
                  textTransform: typeCase(theme, "uppercase"),
                  color: mutedInk(theme),
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {m.label}
              </div>
              <div
                style={{
                  marginTop: height * 0.008 * density,
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.058 * typeScale(theme, "number"),
                  fontWeight: typeWeight(theme, 700),
                  lineHeight: 1.05,
                  color: theme.colors.text,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {m.value}
              </div>
              {m.change_pct !== undefined ? (
                <div
                  style={{
                    marginTop: height * 0.008 * density,
                    display: "flex",
                    alignItems: "baseline",
                    gap: width * 0.004 * density,
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.022 * typeScale(theme, "caption"),
                    fontWeight: typeWeight(theme, 600),
                    color,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  <span>{GLYPH[m.direction]}</span>
                  <span>
                    {/* NOT chart.formatNumber: `plain` rounds to whole numbers
                        and 8.2% is not 8%. An authored precision outranks the
                        theme's number format, exactly as AnimatedCounter's
                        `decimals` does. */}
                    {(Math.abs(m.change_pct) * enter).toFixed(
                      Number.isInteger(m.change_pct) ? 0 : 1,
                    )}
                    %
                  </span>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
MetricGrid.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
