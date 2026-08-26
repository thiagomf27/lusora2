/**
 * WaterfallChart — how a total was built up or eaten away.
 *
 * `BarChart` cannot do this with a prop, and the reason is worth stating: its
 * bars are anchored to a baseline, so a bar's LENGTH is its value. A waterfall
 * bar floats at the running subtotal, so its length is a CHANGE and its
 * position carries the total so far. Adding "float" to BarChart would silently
 * change what every existing bar means.
 *
 * The first and last columns are totals and sit on the baseline; everything
 * between is a delta bridging from the previous subtotal to the next, with a
 * connector so the eye follows the arithmetic rather than trusting it.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  chartStyle,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  seriesColors,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const WaterfallChartProps = z.object({
  title: z.string().max(48).optional(),
  start: z.object({ label: z.string().max(16), value: z.number() }),
  steps: z
    .array(z.object({ label: z.string().max(16), delta: z.number() }))
    .min(1)
    .max(6),
  /** The closing total. Omitted, the component adds up the steps itself. */
  end: z.object({ label: z.string().max(16), value: z.number() }).optional(),
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type WaterfallChartProps = z.infer<typeof WaterfallChartProps>;

export function WaterfallChart({ props, theme }: { props: WaterfallChartProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "WaterfallChart",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity } = entrance;
  const chart = chartStyle(theme, { grid: "baseline", markers: "none", legend: "bottom" });
  const ramp = seriesColors(theme);
  const riseColor = props.emphasis === "neutral" ? theme.colors.neutral : ramp[0];
  const fallColor = props.emphasis === "neutral" ? `${theme.colors.neutral}aa` : ramp[2];

  const ground = groundStyle(theme, { radius: 14, accentRule: "none", legible: true });
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };
  const barRadius = surfaceStyle(theme, { radius: 3 }).borderRadius;

  // Walk the deltas once: every column knows the subtotal it starts from.
  const computedEnd = props.steps.reduce((sum, s) => sum + s.delta, props.start.value);
  const columns = [
    { label: props.start.label, from: 0, to: props.start.value, total: true },
    ...(() => {
      let running = props.start.value;
      return props.steps.map((s) => {
        const from = running;
        running += s.delta;
        return { label: s.label, from, to: running, total: false };
      });
    })(),
    {
      label: props.end?.label ?? "Total",
      from: 0,
      to: props.end?.value ?? computedEnd,
      total: true,
    },
  ];

  const values = columns.flatMap((c) => [c.from, c.to]);
  const yMin = Math.min(0, ...values);
  const yMax = Math.max(...values, 1);
  const ySpan = yMax - yMin || 1;

  const plotW = width * 0.76 * (1 + (1 - density) * 0.18);
  const plotH = height * (props.title ? 0.4 : 0.46);
  const pad = { left: width * 0.06 * density, bottom: height * 0.07 * density };
  const slot = plotW / columns.length;
  const barW = Math.min(slot * 0.58, width * 0.06);
  const py = (v: number) => plotH - ((v - yMin) / ySpan) * plotH;

  const axisDur = Math.round(fps * 0.35 * durationMul);
  const stepDur = Math.round(fps * 0.3 * durationMul);
  const axisIn = interpolate(frame, [0, axisDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  // Columns land in order: the whole point is that each one starts where the
  // last one stopped, and that reading only exists in sequence.
  const growOf = (i: number) =>
    interpolate(frame, [axisDur + i * stepDur, axisDur + i * stepDur + stepDur * 1.4], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: curve,
    });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {ground ? (
        <div
          style={{
            position: "absolute",
            left: plateInset.x,
            top: plateInset.y,
            width: width - plateInset.x * 2,
            height: height - plateInset.y * 2,
            ...ground,
            opacity: axisIn,
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {props.title ? (
          <div
            style={{
              marginBottom: height * 0.03 * density,
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.05 * typeScale(theme, "title"),
              fontWeight: typeWeight(theme, 700),
              letterSpacing: typeTracking(theme),
              textTransform: typeCase(theme),
              color: theme.colors.text,
              maxWidth: width * 0.8,
              textAlign: "center",
              opacity: axisIn,
            }}
          >
            {props.title}
          </div>
        ) : null}

        <svg width={plotW + pad.left * 2} height={plotH + pad.bottom * 2}>
          <g transform={`translate(${pad.left} ${height * 0.02})`}>
            {columns.map((col, i) => {
              const grow = growOf(i);
              const top = py(Math.max(col.from, col.to));
              const bottom = py(Math.min(col.from, col.to));
              const full = Math.max(ruleWidth(theme, 2), bottom - top);
              const h = full * grow;
              const rising = col.to >= col.from;
              const color = col.total ? accent : rising ? riseColor : fallColor;
              const x = slot * i + (slot - barW) / 2;
              // A rising bar grows upward from its own floor, a falling one
              // downward from its ceiling: the direction IS the reading.
              const y = rising ? bottom - h : top;
              const prev = columns[i - 1];
              return (
                <g key={i}>
                  {prev && !col.total ? (
                    <line
                      x1={slot * (i - 1) + (slot + barW) / 2}
                      y1={py(prev.to)}
                      x2={x}
                      y2={py(col.from)}
                      stroke={`${theme.colors.neutral}88`}
                      strokeWidth={ruleWidth(theme, 1)}
                      strokeDasharray={`${height * 0.008} ${height * 0.008}`}
                      opacity={grow}
                    />
                  ) : null}
                  <rect
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill={color}
                    rx={barRadius}
                  />
                  <text
                    x={x + barW / 2}
                    // Outside the bar normally; INSIDE it when the column is
                    // tall enough that the label would clip off the plot — a
                    // full-height opening total is the common case, not an edge.
                    y={Math.max(
                      height * 0.022,
                      (rising ? y : y + h) + (rising ? -height * 0.014 : height * 0.028),
                    )}
                    textAnchor="middle"
                    fill={theme.colors.text}
                    fontFamily={fontStack(theme.typography.body)}
                    fontSize={height * 0.022 * typeScale(theme, "caption")}
                    fontWeight={typeWeight(theme, 600)}
                    style={{ fontVariantNumeric: "tabular-nums" }}
                    opacity={grow}
                  >
                    {col.total
                      ? chart.formatNumber(col.to)
                      : `${col.to >= col.from ? "+" : "−"}${chart.formatNumber(Math.abs(col.to - col.from))}`}
                  </text>
                  <text
                    x={x + barW / 2}
                    y={plotH + height * 0.038}
                    textAnchor="middle"
                    fill={theme.colors.neutral}
                    fontFamily={fontStack(theme.typography.body)}
                    fontSize={height * 0.021 * typeScale(theme, "caption")}
                    fontWeight={typeWeight(theme, col.total ? 600 : 400)}
                    letterSpacing={typeTracking(theme, 0.06)}
                    style={{ textTransform: typeCase(theme, "uppercase") }}
                    opacity={axisIn}
                  >
                    {col.label}
                  </text>
                </g>
              );
            })}

            {chart.grid !== "none" ? (
              <line
                x1={0}
                y1={py(0)}
                x2={plotW}
                y2={py(0)}
                stroke={theme.colors.neutral}
                strokeWidth={ruleWidth(theme, Math.max(2, height * 0.003))}
                strokeDasharray={plotW}
                strokeDashoffset={plotW * (1 - axisIn)}
              />
            ) : null}
          </g>
        </svg>
      </div>

      {props.source ? (
        <div
          style={{
            position: "absolute",
            left: plateInset.x + width * 0.035 * density,
            bottom: plateInset.y + height * 0.03 * density,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.019 * typeScale(theme, "caption"),
            fontWeight: typeWeight(theme, 400),
            letterSpacing: typeTracking(theme, 0.1),
            textTransform: typeCase(theme, "uppercase"),
            color: mutedInk(theme),
            opacity: growOf(columns.length - 1),
          }}
        >
          {props.source}
        </div>
      ) : null}
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
WaterfallChart.honors = ["typography", "surface", "chart", "motion.entrance", "motion.easing"];
