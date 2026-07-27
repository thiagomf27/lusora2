/**
 * LineChart — up to three series revealed left-to-right over a shared axis.
 *
 * Two deliberate design decisions:
 *
 * 1. `x` is a STRING label plotted at equal index spacing ("1941", "Q3"),
 *    not a date. It's what a script actually supplies and it sidesteps date
 *    parsing entirely.
 * 2. Series are capped at 3 and encoded by colour AND dash pattern. A theme
 *    carries four colours; it cannot carry a fourth distinguishable series,
 *    and a palette prop would break the semantic-props rule and look wrong the
 *    moment the theme changes.
 *
 * The reveal uses an SVG <clipPath> rect, not strokeDashoffset: dashed series
 * already use strokeDasharray, and the two uses would fight.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  useEntrance,
} from "../theme.ts";

export const LineChartProps = z.object({
  title: z.string().max(48).optional(),
  series: z
    .array(
      z.object({
        name: z.string().max(20),
        points: z.array(z.object({ x: z.string().max(8), y: z.number() })).min(2).max(24),
      }),
    )
    .min(1)
    .max(3),
  y_label: z.string().max(20).optional(),
  x_label: z.string().max(20).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type LineChartProps = z.infer<typeof LineChartProps>;

const DASH = ["", "10 6", "2 6"];

export function LineChart({ props, theme }: { props: LineChartProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "LineChart",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const seriesColor = [accent, theme.colors.text, theme.colors.neutral];
  const plotW = width * 0.72;
  const plotH = height * (props.title ? 0.4 : 0.46);
  const pad = { left: width * 0.06, bottom: height * 0.06 };

  const maxLen = Math.max(...props.series.map((s) => s.points.length));
  const allY = props.series.flatMap((s) => s.points.map((p) => p.y));
  const yMax = Math.max(...allY, 1);
  const yMin = Math.min(...allY, 0);
  const ySpan = yMax - yMin || 1;

  const px = (i: number) => (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * plotW);
  const py = (y: number) => plotH - ((y - yMin) / ySpan) * plotH;

  const axisDur = Math.round(fps * 0.4 * durationMul);
  const revealDur = Math.round(fps * 1.4 * durationMul);
  const seriesStagger = Math.round(fps * 0.25 * durationMul);
  const ticks = props.series[0].points;
  const tickEvery = Math.max(1, Math.ceil(ticks.length / 6));
  const axisIn = interpolate(frame, [0, axisDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });

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
            marginBottom: height * 0.035,
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.05,
            fontWeight: 700,
            color: theme.colors.text,
            maxWidth: width * 0.8,
            textAlign: "center",
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 1,
            overflow: "hidden",
            opacity: axisIn,
          }}
        >
          {props.title}
        </div>
      ) : null}

      <svg width={plotW + pad.left * 2} height={plotH + pad.bottom * 2}>
        <defs>
          {props.series.map((_, i) => {
            const start = axisDur + i * seriesStagger;
            const reveal = interpolate(frame, [start, start + revealDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            });
            return (
              <clipPath key={i} id={`line-chart-reveal-${i}`}>
                <rect x={0} y={-plotH} width={Math.max(0.001, plotW * reveal)} height={plotH * 3} />
              </clipPath>
            );
          })}
        </defs>

        <g transform={`translate(${pad.left} ${height * 0.02})`}>
          {/* Axes draw before any series appears. */}
          <line x1={0} y1={0} x2={0} y2={plotH} stroke={`${theme.colors.neutral}aa`} strokeWidth={2}
            strokeDasharray={plotH} strokeDashoffset={plotH * (1 - axisIn)} />
          <line x1={0} y1={plotH} x2={plotW} y2={plotH} stroke={`${theme.colors.neutral}aa`} strokeWidth={2}
            strokeDasharray={plotW} strokeDashoffset={plotW * (1 - axisIn)} />

          {/* y extremes */}
          {[yMax, yMin].map((v, i) => (
            <text
              key={i}
              x={-width * 0.008}
              y={py(v)}
              textAnchor="end"
              dominantBaseline="central"
              fill={theme.colors.neutral}
              fontFamily={fontStack(theme.typography.body)}
              fontSize={height * 0.022}
              opacity={axisIn}
            >
              {Math.round(v).toLocaleString("en-US")}
            </text>
          ))}

          {/* x ticks: first, last, and every nth */}
          {ticks.map((p, i) =>
            i % tickEvery === 0 || i === ticks.length - 1 ? (
              <text
                key={i}
                x={px(i)}
                y={plotH + height * 0.035}
                textAnchor="middle"
                fill={theme.colors.neutral}
                fontFamily={fontStack(theme.typography.body)}
                fontSize={height * 0.022}
                opacity={axisIn}
              >
                {p.x}
              </text>
            ) : null,
          )}

          {props.series.map((s, si) => {
            const start = axisDur + si * seriesStagger;
            const reveal = interpolate(frame, [start, start + revealDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            });
            const d = s.points
              .map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(2)} ${py(p.y).toFixed(2)}`)
              .join(" ");
            const last = s.points[s.points.length - 1];
            return (
              <g key={si} clipPath={`url(#line-chart-reveal-${si})`}>
                <path
                  d={d}
                  fill="none"
                  stroke={seriesColor[si]}
                  strokeWidth={Math.max(3, height * 0.005)}
                  strokeDasharray={DASH[si] || undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle
                  cx={px(s.points.length - 1)}
                  cy={py(last.y)}
                  r={height * 0.009}
                  fill={seriesColor[si]}
                  opacity={interpolate(reveal, [0.92, 1], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })}
                />
              </g>
            );
          })}
        </g>
      </svg>

      {/* Legend + axis names */}
      <div
        style={{
          marginTop: height * 0.01,
          display: "flex",
          alignItems: "center",
          gap: width * 0.03,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.024,
        }}
      >
        {props.series.map((s, si) => {
          const start = axisDur + si * seriesStagger;
          return (
            <div
              key={si}
              style={{
                display: "flex",
                alignItems: "center",
                gap: width * 0.008,
                color: theme.colors.text,
                opacity: interpolate(frame, [start + revealDur * 0.8, start + revealDur], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              <svg width={width * 0.028} height={height * 0.012}>
                <line
                  x1={0}
                  y1={height * 0.006}
                  x2={width * 0.028}
                  y2={height * 0.006}
                  stroke={seriesColor[si]}
                  strokeWidth={Math.max(3, height * 0.005)}
                  strokeDasharray={DASH[si] || undefined}
                />
              </svg>
              <span>{s.name}</span>
            </div>
          );
        })}
        {props.y_label || props.x_label ? (
          <span style={{ color: theme.colors.neutral, letterSpacing: "0.08em", textTransform: "uppercase", opacity: axisIn }}>
            {[props.y_label, props.x_label].filter(Boolean).join(" · ")}
          </span>
        ) : null}
      </div>
    </div>
  );
}
