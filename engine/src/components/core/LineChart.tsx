/**
 * LineChart — up to three series revealed left-to-right over a shared axis.
 *
 * This is the MERGE of `LineChart` and `ArchiveLineChart` (D66). They drew the
 * same shape in two looks: core put its legend in a row underneath, marked only
 * where each series stopped and ruled nothing across the plot; the archive one
 * named each series at the end of its own line, dotted every vertex and ruled
 * three values across a card. Neither of those is a different chart — they are
 * `chart.legend`, `chart.markers` and `chart.grid`. So there is one file, and
 * the theme picks.
 *
 * Three decisions carried over from both, because they were right in both:
 *
 * 1. `x` is a STRING label plotted at equal index spacing ("1941", "Q3"), not a
 *    date. It's what a script actually supplies and it sidesteps date parsing.
 * 2. Series are capped at 3 and encoded by colour AND dash pattern. The ramp is
 *    `seriesColors(theme)` — engine-owned, contrast-checked against the plate
 *    and against itself under colour-blindness. A palette prop would break the
 *    semantic-props rule and look wrong the moment the theme changed.
 * 3. The reveal uses an SVG <clipPath> rect, not strokeDashoffset: dashed series
 *    already use strokeDasharray and the two uses would fight.
 *
 * Every visual decision here is either a resolver or a proportion of the frame.
 * The literals that remain (0.05 for the title ratio, 14 for the radius, 6 for
 * the x-tick target) are this component's own PROPORTIONS, which the resolvers
 * scale rather than replace — that is what keeps a theme setting no D66 token
 * rendering exactly as before.
 */
import { useId } from "react";
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  chartStyle,
  composition,
  contrastInk,
  densityScale,
  easingCurve,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  posterPad,
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
  y_label: z.string().max(24).optional(),
  x_label: z.string().max(20).optional(),
  /** Credit line along the bottom. Was ArchiveLineChart's; every chart wants it. */
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type LineChartProps = z.infer<typeof LineChartProps>;

/** Dash pattern per series index, at stroke scale 1. Index 0 is solid. */
const DASH_BASE: readonly (readonly [number, number] | null)[] = [null, [10, 6], [2, 6]];

/** Round a maximum up to a readable gridline value (1, 1.5, 2, 2.5, 3, 4, 5, 7.5 × 10ⁿ). */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  return (steps.find((s) => f <= s + 1e-9) ?? 10) * mag;
}

export function LineChart({ props, theme }: { props: LineChartProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "LineChart",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity } = entrance;

  // ---- tokens -------------------------------------------------------------
  const density = densityScale(theme);
  const baseStroke = Math.max(3, height * 0.005);
  const chart = chartStyle(theme, {
    grid: "axes",       // this component's own: a y line and an x line, nothing ruled across
    legend: "bottom",   // its own: a swatch row underneath
    markers: "ends",    // its own: one dot where each series stops
    stroke: baseStroke,
  });
  const ramp = seriesColors(theme);
  const lineColor = (i: number) =>
    props.emphasis === "neutral" ? theme.colors.neutral : ramp[i % ramp.length];
  const dashFor = (i: number) => {
    const d = DASH_BASE[i % DASH_BASE.length];
    return d ? `${d[0] * chart.strokeScale} ${d[1] * chart.strokeScale}` : undefined;
  };

  const display = fontStack(theme.typography.display);
  const body = fontStack(theme.typography.body);
  const axisRule = ruleWidth(theme, 2);
  const gridRule = ruleWidth(theme, Math.max(1, height * 0.0022));
  const baseRule = ruleWidth(theme, Math.max(2, height * 0.0034));

  // One clip id per instance: a constant would make the second chart on screen
  // reuse the first one's reveal rect.
  const clipId = `line-chart-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  // ---- plate --------------------------------------------------------------
  // The component's own panel alpha is "00": LineChart never had one, so a theme
  // that says nothing (fill defaults to `translucent` = keep your own alpha)
  // still draws none. `solid` gives it a plate; `texture` gives it a ground.
  const ground = groundStyle(theme, {
    radius: composition(theme) === "poster" ? 0 : 14,
    accentRule: "none",
  });
  // `fill: solid` is a theme that draws panels; an end-of-line badge is one.
  const pillLabels = (theme.surface?.fill ?? "translucent") === "solid";
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };

  // ---- geometry -----------------------------------------------------------
  // The same two compositions BarChart has (D70): `centered` is the card it
  // always drew, `poster` hands it the frame. A line chart earns the poster
  // more than most — its plot is the widest thing in the catalog, and a 72% box
  // centred in the frame is the shape that wastes the most of it.
  const poster = composition(theme) === "poster";
  const framePad = posterPad(theme, { width, height });
  const inlineGutter = chart.legend === "inline" ? width * 0.13 : 0;
  const pad = { left: width * 0.06 * density, bottom: height * 0.06 * density };
  // A denser theme fits a wider plot; an airy one gives the margins back.
  const plotW = poster
    ? width - framePad.x * 2 - pad.left * 2 - inlineGutter
    : width * 0.72 * (1 + (1 - density) * 0.22) - inlineGutter;
  const titleSize = height * (poster ? 0.07 : 0.05) * typeScale(theme, "title");
  const kicker = chart.legend === "inline" ? [props.y_label, props.x_label].filter(Boolean).join(" · ") : "";
  const kickerSize = height * 0.02 * typeScale(theme, "kicker");
  const titleGap = height * (poster ? 0.039 : 0.035) * density;
  /**
   * Centred, the plot is a fixed slice of the frame and the furniture arranges
   * itself around it. A poster is the other way round: the furniture is fixed
   * and the plot takes what is left, so its height has to be the frame minus
   * everything else. The SVG is a sized element rather than a flex child, so
   * this is arithmetic rather than `flex: 1`.
   */
  const plotH = poster
    ? height -
      framePad.y * 2 -
      pad.bottom -
      (props.title ? titleSize * 1.08 + titleGap : 0) -
      (kicker ? kickerSize * 1.4 + height * 0.014 * density : 0) -
      height * 0.02 -
      (props.source ? height * 0.045 * density : 0)
    : height * (props.title ? 0.4 : 0.46);
  const svgW = plotW + pad.left * 2 + inlineGutter;

  const maxLen = Math.max(...props.series.map((s) => s.points.length));
  const allY = props.series.flatMap((s) => s.points.map((p) => p.y));
  const ruled = chart.grid === "horizontal" || chart.grid === "full";
  // Ruled values have to be readable, so the domain rounds out to nice numbers.
  // Bare axes label the extremes instead, which is what the data actually says.
  const yMin = ruled ? Math.min(0, ...allY) : Math.min(...allY, 0);
  const yMax = ruled
    ? yMin < 0
      ? Math.max(...allY, 1)
      : niceCeil(Math.max(...allY, 1))
    : Math.max(...allY, 1);
  const ySpan = yMax - yMin || 1;

  const px = (i: number) => (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * plotW);
  const py = (y: number) => plotH - ((y - yMin) / ySpan) * plotH;

  const axisDur = Math.round(fps * 0.4 * durationMul);
  const revealDur = Math.round(fps * 1.4 * durationMul);
  const seriesStagger = Math.round(fps * 0.25 * durationMul);
  const ticks = props.series[0].points;
  // Tighter type fits more x labels; airier type fits fewer. 6 is this
  // component's own target, which `normal` returns untouched.
  const tickTarget = Math.max(3, Math.round(6 / density));
  const tickEvery = Math.max(1, Math.ceil(ticks.length / tickTarget));
  const axisIn = interpolate(frame, [0, axisDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const revealOf = (si: number) => {
    const start = axisDur + si * seriesStagger;
    return interpolate(frame, [start, start + revealDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.45, 0, 0.55, 1),
    });
  };

  const gridValues = ruled ? [yMax, yMin + ySpan / 2, yMin] : [yMax, yMin];
  const tickSize = height * 0.022 * typeScale(theme, "caption");

  // ---- end-of-line labels (chart.legend: inline) --------------------------
  // These ARE the legend, so two series finishing within a line of each other
  // would stack their names. Push them apart from the top down, then lift the
  // whole set if that pushed the last one under the baseline.
  const nameSize = height * 0.022 * typeScale(theme, "caption");
  const endLabels = props.series
    .map((s, si) => ({
      si,
      name: s.name,
      x: px(s.points.length - 1) + width * 0.012,
      y: py(s.points[s.points.length - 1].y),
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    endLabels[i].y = Math.max(endLabels[i].y, endLabels[i - 1].y + nameSize * 1.2);
  }
  const spill = endLabels.length > 0 ? endLabels[endLabels.length - 1].y - plotH : 0;
  if (spill > 0) for (const label of endLabels) label.y -= spill;

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
            left: poster ? 0 : plateInset.x,
            top: poster ? 0 : plateInset.y,
            width: poster ? width : width - plateInset.x * 2,
            height: poster ? height : height - plateInset.y * 2,
            ...ground,
            opacity: axisIn,
          }}
        />
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          boxSizing: "border-box",
          padding: poster ? `${framePad.y}px ${framePad.x}px` : 0,
          display: "flex",
          flexDirection: "column",
          alignItems: poster ? "flex-start" : "center",
          justifyContent: poster ? "flex-start" : "center",
        }}
      >
        {/* With no legend row underneath, the axis names ride above the plot,
            aligned to the y axis where a unit label belongs. Inside the column,
            not floated over the plate: at `airy` an absolute one collides with
            the title, and the collision is invisible at `normal`. */}
        {kicker ? (
          <div
            style={{
              width: svgW,
              paddingLeft: pad.left,
              marginBottom: height * 0.014 * density,
              fontFamily: body,
              fontSize: kickerSize,
              fontWeight: typeWeight(theme, 500),
              letterSpacing: typeTracking(theme, 0.2),
              textTransform: typeCase(theme, "uppercase"),
              color: mutedInk(theme),
              opacity: axisIn,
            }}
          >
            {kicker}
          </div>
        ) : null}

        {props.title ? (
          <div
            style={{
              marginBottom: titleGap,
              fontFamily: display,
              fontSize: titleSize,
              lineHeight: poster ? 1.08 : undefined,
              // 600 under poster: typeWeight snaps to hundreds, so a 600 base
              // is the only one a theme's `bold` can land on 800.
              fontWeight: typeWeight(theme, poster ? 600 : 700),
              letterSpacing: poster ? typeTracking(theme, -0.01) : typeTracking(theme),
              textTransform: typeCase(theme),
              color: theme.colors.text,
              maxWidth: poster ? "100%" : width * 0.8,
              textAlign: poster ? "left" : "center",
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

        {/* Centred, the canvas is symmetric slack around a centred stack and
            the extra bottom band never shows. A poster stack starts at the top,
            so the same slack becomes a strip of empty page under the x labels —
            the canvas has to be what is actually drawn on it. */}
        <svg
          width={svgW}
          height={poster ? height * 0.02 + plotH + pad.bottom : plotH + pad.bottom * 2}
        >
          <defs>
            {props.series.map((_, i) => (
              <clipPath key={i} id={`${clipId}-${i}`}>
                <rect x={0} y={-plotH} width={Math.max(0.001, plotW * revealOf(i))} height={plotH * 3} />
              </clipPath>
            ))}
          </defs>

          <g transform={`translate(${pad.left} ${height * 0.02})`}>
            {/* Axes / rules. Everything here draws before any series appears. */}
            {chart.grid === "axes" ? (
              <line
                x1={0} y1={0} x2={0} y2={plotH}
                stroke={`${theme.colors.neutral}aa`} strokeWidth={axisRule}
                strokeDasharray={plotH} strokeDashoffset={plotH * (1 - axisIn)}
              />
            ) : null}
            {ruled
              ? gridValues.slice(0, -1).map((v, i) => (
                  <line
                    key={`h${i}`}
                    x1={0} y1={py(v)} x2={plotW} y2={py(v)}
                    stroke={`${theme.colors.neutral}59`} strokeWidth={gridRule}
                    strokeDasharray={plotW} strokeDashoffset={plotW * (1 - axisIn)}
                  />
                ))
              : null}
            {chart.grid === "full"
              ? ticks.map((_, i) =>
                  i % tickEvery === 0 || i === ticks.length - 1 ? (
                    <line
                      key={`v${i}`}
                      x1={px(i)} y1={0} x2={px(i)} y2={plotH}
                      stroke={`${theme.colors.neutral}40`} strokeWidth={gridRule}
                      opacity={axisIn}
                    />
                  ) : null,
                )
              : null}
            <line
              x1={0} y1={plotH} x2={plotW} y2={plotH}
              stroke={chart.grid === "axes" ? `${theme.colors.neutral}aa` : theme.colors.text}
              strokeWidth={chart.grid === "axes" ? axisRule : baseRule}
              strokeDasharray={plotW} strokeDashoffset={plotW * (1 - axisIn)}
            />

            {/* y values: the ruled ones, or the extremes */}
            {gridValues.map((v, i) => (
              <text
                key={i}
                x={-width * 0.008 * density}
                y={py(v)}
                textAnchor="end"
                dominantBaseline="central"
                fill={chart.axisInk}
                fontFamily={body}
                fontSize={tickSize}
                fontWeight={chart.axisWeight}
                style={{ fontVariantNumeric: "tabular-nums" }}
                opacity={axisIn}
              >
                {chart.formatNumber(v)}
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
                  fill={chart.axisInk}
                  fontFamily={body}
                  fontSize={tickSize}
                  fontWeight={chart.axisWeight}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                  opacity={axisIn}
                >
                  {p.x}
                </text>
              ) : null,
            )}

            {props.series.map((s, si) => {
              const d = s.points
                .map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(2)} ${py(p.y).toFixed(2)}`)
                .join(" ");
              // Closed back along the baseline, so the fill is the area UNDER
              // the line rather than the polygon the line happens to enclose.
              const area = `${d} L${px(s.points.length - 1).toFixed(2)} ${py(yMin).toFixed(2)} L${px(0).toFixed(2)} ${py(yMin).toFixed(2)} Z`;
              return (
                <g key={si} clipPath={`url(#${clipId}-${si})`}>
                  {chart.area === "tint" ? (
                    <path d={area} fill={lineColor(si)} fillOpacity={0.16} stroke="none" />
                  ) : null}
                  <path
                    d={d}
                    fill="none"
                    stroke={lineColor(si)}
                    strokeWidth={chart.strokeWidth}
                    strokeDasharray={dashFor(si)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </g>
              );
            })}

            {/* Marks sit OUTSIDE the clip so they land crisply at the wipe edge. */}
            {chart.markers === "dot"
              ? props.series.flatMap((s, si) =>
                  s.points.map((p, i) => (
                    <circle
                      key={`${si}-${i}`}
                      cx={px(i)}
                      cy={py(p.y)}
                      r={chart.strokeWidth * 1.25}
                      fill={lineColor(si)}
                      opacity={interpolate(
                        plotW * revealOf(si),
                        [px(i) - plotW * 0.015, px(i)],
                        [0, 1],
                        { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                      )}
                    />
                  )),
                )
              : null}
            {chart.markers === "ends"
              ? props.series.map((s, si) => (
                  <circle
                    key={si}
                    cx={px(s.points.length - 1)}
                    cy={py(s.points[s.points.length - 1].y)}
                    r={height * 0.009}
                    fill={lineColor(si)}
                    opacity={interpolate(revealOf(si), [0.92, 1], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })}
                  />
                ))
              : null}

            {/* A pill when the theme fills its panels, plain type when it does
                not: a badge is a panel, and `surface.fill` is the token that
                already decides whether this theme draws them. */}
            {chart.legend === "inline" && pillLabels
              ? endLabels.map((label) => (
                  <rect
                    key={`pill-${label.si}`}
                    x={label.x - width * 0.006}
                    y={label.y - nameSize * 0.86}
                    width={label.name.length * nameSize * 0.62 + width * 0.012}
                    height={nameSize * 1.72}
                    rx={surfaceStyle(theme, { radius: 6 }).borderRadius}
                    fill={lineColor(label.si)}
                    opacity={interpolate(revealOf(label.si), [0.88, 1], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })}
                  />
                ))
              : null}
            {chart.legend === "inline"
              ? endLabels.map((label) => (
                  <text
                    key={label.si}
                    x={label.x}
                    y={label.y}
                    dominantBaseline="central"
                    fill={pillLabels ? contrastInk(theme, lineColor(label.si)) : lineColor(label.si)}
                    fontFamily={body}
                    fontSize={nameSize}
                    fontWeight={typeWeight(theme, 600)}
                    letterSpacing={typeTracking(theme)}
                    style={{ textTransform: typeCase(theme) }}
                    opacity={interpolate(revealOf(label.si), [0.88, 1], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })}
                  >
                    {label.name}
                  </text>
                ))
              : null}
          </g>
        </svg>

        {chart.legend === "bottom" ? (
          <div
            style={{
              marginTop: height * 0.01 * density,
              display: "flex",
              alignItems: "center",
              gap: width * 0.03 * density,
              fontFamily: body,
              fontSize: height * 0.024 * typeScale(theme, "caption"),
              fontWeight: typeWeight(theme, 400),
              letterSpacing: typeTracking(theme),
              textTransform: typeCase(theme),
            }}
          >
            {props.series.map((s, si) => (
              <div
                key={si}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: width * 0.008 * density,
                  color: theme.colors.text,
                  opacity: interpolate(revealOf(si), [0.8, 1], [0, 1], {
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
                    stroke={lineColor(si)}
                    strokeWidth={chart.strokeWidth}
                    strokeDasharray={dashFor(si)}
                  />
                </svg>
                <span>{s.name}</span>
              </div>
            ))}
            {props.y_label || props.x_label ? (
              <span
                style={{
                  color: mutedInk(theme),
                  letterSpacing: typeTracking(theme, 0.08),
                  textTransform: typeCase(theme, "uppercase"),
                  opacity: axisIn,
                }}
              >
                {[props.y_label, props.x_label].filter(Boolean).join(" · ")}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {props.source ? (
        <div
          style={{
            position: "absolute",
            left: (poster ? framePad.x : plateInset.x) + width * 0.035 * density,
            // Poster reserves a band for the credit inside `plotH` above, so
            // it sits just off the padding box; centred keeps its own inset.
            bottom: poster
              ? framePad.y + height * 0.005 * density
              : plateInset.y + height * 0.03 * density,
            fontFamily: body,
            fontSize: height * 0.019 * typeScale(theme, "caption"),
            fontWeight: typeWeight(theme, 400),
            letterSpacing: typeTracking(theme, 0.1),
            textTransform: typeCase(theme, "uppercase"),
            color: mutedInk(theme),
            opacity: interpolate(revealOf(props.series.length - 1), [0.88, 1], [0, 0.9], {
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
LineChart.honors = [
  "typography",
  "surface",
  "layout.composition",
  "chart",
  "motion.entrance",
  "motion.easing",
];
