/**
 * Candlestick — open/high/low/close bars over an ordered sequence.
 *
 * OHLC is a data shape nothing in the catalog can carry: `LineChart` takes
 * `{x, y}` and a candle is four numbers per period, three of which have no
 * meaning on a line. That is the step-6 test in SKILL Part 1 firing, and it is
 * the only reason this file exists rather than a prop on LineChart.
 *
 * Direction colour comes from `seriesColors(theme)` — the ramp's warm end for
 * a period that closed up, its oxblood for one that closed down. NOT hardcoded
 * green and red: those are a convention of one market's software, they fail on
 * a paper theme, and they are illegible to the ~8% of viewers who cannot
 * separate the two. The ramp is contrast-checked for exactly this.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  chartStyle,
  densityScale,
  easingCurve,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  seriesColors,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const CandlestickProps = z.object({
  title: z.string().max(48).optional(),
  bars: z
    .array(
      z.object({
        t: z.string().max(8),
        o: z.number(),
        h: z.number(),
        l: z.number(),
        c: z.number(),
      }),
    )
    .min(3)
    .max(24),
  /** A note pinned to one period — "Lehman files", "circuit breaker". */
  annotations: z
    .array(z.object({ index: z.number().int().min(0), text: z.string().max(28) }))
    .max(2)
    .optional(),
  y_label: z.string().max(24).optional(),
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type CandlestickProps = z.infer<typeof CandlestickProps>;

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10].find((s) => f <= s + 1e-9) ?? 10) * mag;
}

export function Candlestick({ props, theme }: { props: CandlestickProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "Candlestick",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity } = entrance;

  const chart = chartStyle(theme, {
    grid: "horizontal", // its own: a price chart without a price scale is decoration
    legend: "bottom",
    markers: "none",
    stroke: Math.max(2, height * 0.003),
  });
  const ramp = seriesColors(theme);
  const upColor = props.emphasis === "neutral" ? theme.colors.neutral : ramp[0];
  const downColor = props.emphasis === "neutral" ? `${theme.colors.neutral}99` : ramp[2];

  const ground = groundStyle(theme, { radius: 14, accentRule: "none", legible: true });
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };

  const plotW = width * 0.74 * (1 + (1 - density) * 0.2);
  const plotH = height * (props.title ? 0.4 : 0.46);
  const pad = { left: width * 0.07 * density, bottom: height * 0.06 * density };

  const lows = props.bars.map((b) => b.l);
  const highs = props.bars.map((b) => b.h);
  const rawMin = Math.min(...lows);
  const rawMax = Math.max(...highs);
  // Price charts do NOT start at zero — the swing is the story, and a zero
  // baseline flattens every real series into a band at the top.
  const padY = (rawMax - rawMin) * 0.12 || 1;
  const yMin = rawMin - padY;
  const yMax = rawMin + niceCeil(rawMax + padY - yMin);
  const ySpan = yMax - yMin || 1;

  const n = props.bars.length;
  const slot = plotW / n;
  const bodyW = Math.min(slot * 0.62, width * 0.03);
  const px = (i: number) => slot * i + slot / 2;
  const py = (v: number) => plotH - ((v - yMin) / ySpan) * plotH;

  const axisDur = Math.round(fps * 0.4 * durationMul);
  const growDur = Math.round(fps * 1.3 * durationMul);
  const axisIn = interpolate(frame, [0, axisDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  // Candles arrive left to right on one clock — a market moves in time and a
  // simultaneous reveal loses the only axis that matters.
  const swept = interpolate(frame, [axisDur, axisDur + growDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  const gridValues = [yMax, (yMax + yMin) / 2, yMin];
  const tickEvery = Math.max(1, Math.ceil(n / Math.max(3, Math.round(6 / density))));

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
        {props.y_label ? (
          <div
            style={{
              width: plotW + pad.left * 2,
              paddingLeft: pad.left,
              marginBottom: height * 0.012 * density,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.02 * typeScale(theme, "kicker"),
              fontWeight: typeWeight(theme, 500),
              letterSpacing: typeTracking(theme, 0.2),
              textTransform: typeCase(theme, "uppercase"),
              color: theme.colors.neutral,
              opacity: axisIn,
            }}
          >
            {props.y_label}
          </div>
        ) : null}

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
            {gridValues.map((v, i) => (
              <g key={i}>
                <line
                  x1={0}
                  y1={py(v)}
                  x2={plotW}
                  y2={py(v)}
                  stroke={i === gridValues.length - 1 ? theme.colors.text : `${theme.colors.neutral}59`}
                  strokeWidth={
                    i === gridValues.length - 1
                      ? ruleWidth(theme, Math.max(2, height * 0.0034))
                      : ruleWidth(theme, Math.max(1, height * 0.0022))
                  }
                  strokeDasharray={plotW}
                  strokeDashoffset={plotW * (1 - axisIn)}
                />
                <text
                  x={-width * 0.01 * density}
                  y={py(v)}
                  textAnchor="end"
                  dominantBaseline="central"
                  fill={theme.colors.neutral}
                  fontFamily={fontStack(theme.typography.body)}
                  fontSize={height * 0.021 * typeScale(theme, "caption")}
                  fontWeight={typeWeight(theme, 400)}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  opacity={axisIn}
                >
                  {chart.formatNumber(v)}
                </text>
              </g>
            ))}

            {props.bars.map((b, i) => {
              const arrived = interpolate(swept, [i / n, (i + 1) / n], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              if (arrived <= 0) return null;
              const up = b.c >= b.o;
              const color = up ? upColor : downColor;
              const top = py(Math.max(b.o, b.c));
              const bottom = py(Math.min(b.o, b.c));
              const bodyH = Math.max(ruleWidth(theme, 2), bottom - top);
              return (
                <g key={i} opacity={arrived}>
                  <line
                    x1={px(i)}
                    y1={py(b.h)}
                    x2={px(i)}
                    y2={py(b.l)}
                    stroke={color}
                    strokeWidth={chart.strokeWidth}
                  />
                  <rect
                    x={px(i) - bodyW / 2}
                    y={top}
                    width={bodyW}
                    height={bodyH}
                    // A hollow body for an up period is the convention that
                    // survives losing colour; the fill is the redundant channel.
                    fill={up ? "none" : color}
                    stroke={color}
                    strokeWidth={chart.strokeWidth}
                  />
                </g>
              );
            })}

            {props.bars.map((b, i) =>
              i % tickEvery === 0 || i === n - 1 ? (
                <text
                  key={i}
                  x={px(i)}
                  y={plotH + height * 0.035}
                  textAnchor="middle"
                  fill={theme.colors.neutral}
                  fontFamily={fontStack(theme.typography.body)}
                  fontSize={height * 0.021 * typeScale(theme, "caption")}
                  fontWeight={typeWeight(theme, 400)}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  opacity={axisIn}
                >
                  {b.t}
                </text>
              ) : null,
            )}

            {(props.annotations ?? []).map((a, k) => {
              const i = Math.min(Math.max(a.index, 0), n - 1);
              const bar = props.bars[i];
              const shown = interpolate(swept, [(i + 1) / n, Math.min(1, (i + 1) / n + 0.1)], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              });
              return (
                <g key={k} opacity={shown}>
                  <line
                    x1={px(i)}
                    y1={py(bar.h) - height * 0.012}
                    x2={px(i)}
                    y2={py(bar.h) - height * 0.045}
                    stroke={theme.colors.neutral}
                    strokeWidth={ruleWidth(theme, 1)}
                  />
                  <text
                    x={px(i)}
                    y={py(bar.h) - height * 0.055}
                    textAnchor="middle"
                    fill={theme.colors.text}
                    fontFamily={fontStack(theme.typography.body)}
                    fontSize={height * 0.02 * typeScale(theme, "caption")}
                    fontWeight={typeWeight(theme, 600)}
                    letterSpacing={typeTracking(theme, 0.06)}
                    style={{ textTransform: typeCase(theme, "uppercase") }}
                  >
                    {a.text}
                  </text>
                </g>
              );
            })}
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
            color: theme.colors.neutral,
            opacity: interpolate(swept, [0.85, 1], [0, 0.9], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.source}
        </div>
      ) : null}
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
Candlestick.honors = ["typography", "surface", "chart", "motion.entrance", "motion.easing"];
