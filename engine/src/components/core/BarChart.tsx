/**
 * BarChart — a categorical comparison with counting value labels.
 *
 * Series colours are DERIVED, never passed in: a theme only carries accent /
 * neutral / text, so a palette prop would both break the semantic-props rule
 * and look wrong the moment the theme changes. With `highlight_index` set it's
 * one accent bar against neutral; otherwise bars ramp accent -> neutral by
 * index via interpolateColors (already exported by remotion, no extra dep).
 *
 * All numerals render in the BODY face, never the display face: Playfair's
 * old-style proportional numerals make counting labels jitter horizontally.
 */
import { z } from "zod";
import { Easing, interpolate, interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  useEntrance,
} from "../theme.ts";

export const BarChartProps = z.object({
  title: z.string().max(48).optional(),
  series: z.array(z.object({ label: z.string().max(18), value: z.number() })).min(2).max(7),
  unit: z.string().max(16).optional(),
  orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
  highlight_index: z.number().int().min(0).max(6).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type BarChartProps = z.infer<typeof BarChartProps>;

export function BarChart({ props, theme }: { props: BarChartProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "BarChart",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const stagger = Math.min(
    Math.round(fps * 0.18 * durationMul),
    Math.floor((durationInFrames * 0.45) / Math.max(1, props.series.length)),
  );
  const axisDur = Math.round(fps * 0.35 * durationMul);
  const growDur = Math.round(fps * 0.6 * durationMul);
  const max = Math.max(...props.series.map((s) => s.value), 1);
  const vertical = props.orientation === "vertical";

  const barColor = (i: number) =>
    props.highlight_index !== undefined
      ? i === props.highlight_index
        ? accent
        : theme.colors.neutral
      : interpolateColors(i, [0, Math.max(1, props.series.length - 1)], [accent, theme.colors.neutral]);

  const plotH = height * (props.title ? 0.42 : 0.5);
  const plotW = width * 0.72;
  const numeric = fontStack(theme.typography.body);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {props.title ? (
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.05,
            fontWeight: 700,
            color: theme.colors.text,
            marginBottom: height * 0.05,
            maxWidth: width * 0.8,
            textAlign: "center",
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            opacity: interpolate(frame, [0, inDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.title}
        </div>
      ) : null}

      <div
        style={{
          width: plotW,
          height: plotH,
          display: "flex",
          flexDirection: vertical ? "row" : "column",
          alignItems: vertical ? "flex-end" : "stretch",
          justifyContent: vertical ? "space-between" : "center",
          gap: vertical ? plotW * 0.03 : plotH * 0.04,
        }}
      >
        {props.series.map((s, i) => {
          const start = axisDur + i * stagger;
          const grow = interpolate(frame, [start, start + growDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          const shown = Math.round(s.value * grow);
          const fraction = s.value / max;
          const labelOpacity = interpolate(frame, [start + growDur * 0.4, start + growDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const valueText = `${shown.toLocaleString("en-US")}${props.unit ? ` ${props.unit}` : ""}`;

          if (vertical) {
            return (
              <div
                key={i}
                style={{
                  flex: 1,
                  // Without minWidth: 0 a nowrap label makes the flex item
                  // refuse to shrink, and seven bars burst out of the plot.
                  minWidth: 0,
                  height: "100%",
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  alignItems: "center",
                }}
              >
                <div
                  style={{
                    maxWidth: "100%",
                    fontFamily: numeric,
                    fontSize: height * 0.028,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    color: theme.colors.text,
                    marginBottom: height * 0.01,
                    opacity: labelOpacity,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {valueText}
                </div>
                <div
                  style={{
                    width: "100%",
                    height: plotH * 0.78 * fraction,
                    background: barColor(i),
                    borderRadius: 3,
                    scale: `1 ${grow}`,
                    transformOrigin: "bottom center",
                  }}
                />
                <div
                  style={{
                    marginTop: height * 0.014,
                    maxWidth: "100%",
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.026,
                    color: theme.colors.neutral,
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    opacity: labelOpacity,
                  }}
                >
                  {s.label}
                </div>
              </div>
            );
          }

          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: height * 0.008 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.026,
                  color: theme.colors.text,
                }}
              >
                <span
                  style={{
                    letterSpacing: "0.06em",
                    textTransform: "uppercase",
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {s.label}
                </span>
                <span
                  style={{
                    flexShrink: 0,
                    fontFamily: numeric,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                    opacity: labelOpacity,
                  }}
                >
                  {valueText}
                </span>
              </div>
              <div style={{ width: "100%", height: height * 0.026, background: `${theme.colors.neutral}33`, borderRadius: 3 }}>
                <div
                  style={{
                    width: `${fraction * 100}%`,
                    height: "100%",
                    background: barColor(i),
                    borderRadius: 3,
                    scale: `${grow} 1`,
                    transformOrigin: "left center",
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Baseline draws left-to-right before the bars grow off it. */}
      {vertical ? (
        <div
          style={{
            width: plotW,
            height: Math.max(2, height * 0.003),
            background: theme.colors.neutral,
            marginTop: height * 0.005,
            scale: `${interpolate(frame, [0, axisDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })} 1`,
            transformOrigin: "left center",
          }}
        />
      ) : null}
    </div>
  );
}
