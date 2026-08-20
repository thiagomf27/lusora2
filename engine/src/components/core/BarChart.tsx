/**
 * BarChart — a categorical comparison with counting value labels.
 *
 * The MERGE of `BarChart` and `ArchiveBarGraph` (D66). `bars` and `series` were
 * the same array of {label, value}; the archive one added a credit line, ruled
 * the plot at round steps and set its figures compact. Those are `source`,
 * `chart.grid` and `chart.number_format`, so there is one file.
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
  chartStyle,
  contrastInk,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  surfaceColor,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const BarChartProps = z.object({
  title: z.string().max(48).optional(),
  series: z.array(z.object({ label: z.string().max(18), value: z.number() })).min(2).max(7),
  unit: z.string().max(16).optional(),
  orientation: z.enum(["vertical", "horizontal"]).default("vertical"),
  highlight_index: z.number().int().min(0).max(6).optional(),
  /** Credit line along the bottom. Was ArchiveBarGraph's; every chart wants it. */
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type BarChartProps = z.infer<typeof BarChartProps>;

/**
 * Ticks on a round STEP (1, 2, 2.5, 5 × 10ⁿ) rather than a round maximum.
 * Rounding the maximum instead gives a tidy 75K top and then quarters it into
 * 18.8K / 37.5K / 56.3K — every label but the ends unreadable. Only reached
 * when a theme asks for gridlines; bare `baseline` needs no scale at all.
 */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step * 1e-9; v += step) out.push(v);
  return out;
}

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
  const axisIn = interpolate(frame, [0, Math.round(fps * 0.35 * durationMul)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...easingCurve(theme)),
  });

  const barColor = (i: number) =>
    props.highlight_index !== undefined
      ? i === props.highlight_index
        ? accent
        : theme.colors.neutral
      : interpolateColors(i, [0, Math.max(1, props.series.length - 1)], [accent, theme.colors.neutral]);

  const density = densityScale(theme);
  const chart = chartStyle(theme, {
    grid: "baseline", // this component's own: one rule under the columns
    stroke: height * 0.026, // its own horizontal-bar thickness
  });
  const ground = groundStyle(theme, { radius: 14, accentRule: "none" });
  const barRadius = surfaceStyle(theme, { radius: 3 }).borderRadius;
  const ruled = chart.grid === "horizontal" || chart.grid === "full";
  const ticks = ruled ? niceTicks(max) : [];
  // A ruled plot is measured against its top tick, an unruled one against the
  // tallest column — otherwise gridlines and columns disagree about the scale.
  const ceiling = ruled ? ticks[ticks.length - 1] : max;

  const plotH = height * (props.title ? 0.42 : 0.5);
  const plotW = width * 0.72 * (1 + (1 - density) * 0.18);
  const numeric = fontStack(theme.typography.body);
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };

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

      {props.title ? (
        <div
          style={{
            // The ground plate is position:absolute, so it paints ABOVE every
            // in-flow sibling whatever the DOM order — CSS paints positioned
            // descendants after non-positioned ones. Anything drawn over the
            // plate has to join that layer, which is what this does. The plot
            // box below already had it, which is why the bars survived and the
            // title silently did not.
            position: "relative",
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.05 * typeScale(theme, "title"),
            fontWeight: typeWeight(theme, 700),
            color: theme.colors.text,
            marginBottom: height * 0.05 * density,
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
          position: "relative",
          width: plotW,
          height: plotH,
          display: "flex",
          flexDirection: vertical ? "row" : "column",
          alignItems: vertical ? "flex-end" : "stretch",
          justifyContent: vertical ? "space-between" : "center",
          gap: vertical ? plotW * 0.03 * density : plotH * 0.04 * density,
        }}
      >
        {/* Ruled values, when the theme asks for them. They sit BEHIND the
            columns and are measured off the same `ceiling`, so a column can
            never end between two lines that claim to bracket it. */}
        {ruled && vertical
          ? ticks.map((v) => (
              <div
                key={v}
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: (v / ceiling) * plotH * 0.78,
                  height: ruleWidth(theme, Math.max(1, height * 0.0022)),
                  background: `${theme.colors.neutral}59`,
                  transformOrigin: "left center",
                  scale: `${axisIn} 1`,
                }}
              >
                <span
                  style={{
                    position: "absolute",
                    right: "100%",
                    bottom: 0,
                    paddingRight: width * 0.012 * density,
                    fontFamily: numeric,
                    fontSize: height * 0.021 * typeScale(theme, "caption"),
                    fontWeight: typeWeight(theme, 400),
                    fontVariantNumeric: "tabular-nums",
                    color: theme.colors.neutral,
                    whiteSpace: "nowrap",
                    opacity: axisIn,
                  }}
                >
                  {chart.formatNumber(v)}
                </span>
              </div>
            ))
          : null}
        {props.series.map((s, i) => {
          const start = axisDur + i * stagger;
          const grow = interpolate(frame, [start, start + growDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          const shown = Math.round(s.value * grow);
          const fraction = s.value / ceiling;
          const labelOpacity = interpolate(frame, [start + growDur * 0.4, start + growDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const valueText = `${chart.formatNumber(shown)}${props.unit ? ` ${props.unit}` : ""}`;

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
                    fontSize: height * 0.028 * typeScale(theme, "number"),
                    fontWeight: typeWeight(theme, 700),
                    fontVariantNumeric: "tabular-nums",
                    color: theme.colors.text,
                    marginBottom: height * 0.01 * density,
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
                    borderRadius: barRadius,
                    scale: `1 ${grow}`,
                    transformOrigin: "bottom center",
                  }}
                />
                <div
                  style={{
                    marginTop: height * 0.014 * density,
                    maxWidth: "100%",
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.026 * typeScale(theme, "caption"),
                    color: theme.colors.neutral,
                    letterSpacing: typeTracking(theme, 0.06),
                    textTransform: typeCase(theme, "uppercase"),
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

          // `chart.legend: inline` puts the label and the figure INSIDE the bar,
          // which is what "inline" already means on LineChart: the series names
          // itself where it sits instead of in a row you have to look away to.
          // It only works on the horizontal orientation — a vertical column is
          // too narrow to set a word across — so a vertical chart keeps its own
          // above/below placement whatever the theme asks for.
          const inside = chart.legend === "inline";
          const barH = chart.strokeWidth;
          const insideInk = contrastInk(theme, barColor(i));
          // The value belongs at the BAR's end, not the track's: that is where
          // the quantity actually stops. It sits just inside the bar when the
          // bar is long enough to hold it and just outside when it is not, and
          // its ink follows — measured, not guessed at from a ratio, because a
          // short bar with a long figure and a long bar with a short one both
          // exist and a single threshold gets one of them wrong.
          const valueChars = valueText.length;
          const valueW = valueChars * barH * 0.62 * 0.6;
          const gap = width * 0.008 * density;
          const fitsInside = fraction * plotW - gap * 2 > valueW;
          const valueInk = fitsInside ? insideInk : contrastInk(theme, surfaceColor(theme));
          return (
            <div key={i} style={{ display: "flex", flexDirection: "column", gap: height * 0.008 * density }}>
              {inside ? null : (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.026 * typeScale(theme, "caption"),
                  color: theme.colors.text,
                }}
              >
                <span
                  style={{
                    letterSpacing: typeTracking(theme, 0.06),
                    textTransform: typeCase(theme, "uppercase"),
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
                    fontWeight: typeWeight(theme, 700),
                    fontVariantNumeric: "tabular-nums",
                    opacity: labelOpacity,
                  }}
                >
                  {valueText}
                </span>
              </div>
              )}
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: inside ? barH * 1.25 : barH,
                  background: `${theme.colors.neutral}33`,
                  borderRadius: barRadius,
                }}
              >
                <div
                  style={{
                    width: `${fraction * 100}%`,
                    height: "100%",
                    background: barColor(i),
                    borderRadius: barRadius,
                    scale: `${grow} 1`,
                    transformOrigin: "left center",
                  }}
                />
                {inside ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      fontFamily: numeric,
                      fontSize: barH * 0.62 * typeScale(theme, "caption"),
                      fontWeight: typeWeight(theme, 700),
                      fontVariantNumeric: "tabular-nums",
                      letterSpacing: typeTracking(theme),
                      textTransform: typeCase(theme),
                      opacity: labelOpacity,
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: gap,
                        top: 0,
                        bottom: 0,
                        maxWidth: `calc(${fraction * 100}% - ${gap * 2}px)`,
                        display: "flex",
                        alignItems: "center",
                        // Ink picked against THIS bar, so a muted bar and the
                        // highlighted one both stay readable.
                        color: insideInk,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.label}
                    </span>
                    <span
                      style={{
                        position: "absolute",
                        left: `${fraction * 100}%`,
                        translate: fitsInside ? "-100% 0" : "0 0",
                        marginLeft: fitsInside ? -gap : gap,
                        top: 0,
                        bottom: 0,
                        display: "flex",
                        alignItems: "center",
                        color: valueInk,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {valueText}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {/* Baseline draws left-to-right before the bars grow off it. `grid: none`
          takes it away — the columns are the mark, the rule is the convention. */}
      {vertical && chart.grid !== "none" ? (
        <div
          style={{
            position: "relative",
            width: plotW,
            height: ruleWidth(theme, Math.max(2, height * 0.003)),
            background: theme.colors.neutral,
            marginTop: height * 0.005 * density,
            scale: `${axisIn} 1`,
            transformOrigin: "left center",
          }}
        />
      ) : null}

      {props.source ? (
        <div
          style={{
            position: "absolute",
            left: plateInset.x + width * 0.035 * density,
            bottom: plateInset.y + height * 0.03 * density,
            fontFamily: numeric,
            fontSize: height * 0.019 * typeScale(theme, "caption"),
            fontWeight: typeWeight(theme, 400),
            letterSpacing: typeTracking(theme, 0.1),
            textTransform: typeCase(theme, "uppercase"),
            color: theme.colors.neutral,
            opacity: interpolate(frame, [axisDur, axisDur + growDur], [0, 0.9], {
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
BarChart.honors = ["typography", "surface", "chart", "motion.entrance", "motion.easing"];
