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
 *
 * D70 gave the vertical orientation two compositions. `centered` is the card it
 * always drew. `poster` hands it the frame: ground edge to edge, headline in
 * the top-left, columns capped in width and centred under it. The bar heights
 * are identical between them — only the furniture around the plot moves.
 */
import { z } from "zod";
import { Easing, interpolate, interpolateColors, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  capsTracking,
  chartStyle,
  composition,
  contrastInk,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  posterPad,
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
  // A poster is only a composition for the COLUMN chart. Horizontal bars are a
  // ranked list of rows; they already fill their box and have no headline slot
  // to move, so there is nothing for `poster` to do that `density` does not.
  const poster = vertical && composition(theme) === "poster";
  const pad = posterPad(theme, { width, height });
  const ground = groundStyle(theme, { radius: poster ? 0 : 14, accentRule: "none" });
  // A poster column is a slab and carries the radius a card would; a centred
  // one is small enough that 3px is all it ever had. The poster figure is a
  // FRACTION of the frame — surfaceStyle's px are "at the 1080p reference", and
  // a corner that stays 12px while the frame halves is a corner that doubles.
  const barRadius = surfaceStyle(theme, {
    radius: poster ? height * 0.0111 : 3,
  }).borderRadius;
  /** A column grows OFF the baseline, so only its free end rounds — a rounded
   *  foot reads as a bar floating above the axis it is measured against. */
  const columnRadius = `${barRadius}px ${barRadius}px 0 0`;
  const ruled = chart.grid === "horizontal" || chart.grid === "full";
  const ticks = ruled ? niceTicks(max) : [];
  // A ruled plot is measured against its top tick, an unruled one against the
  // tallest column — otherwise gridlines and columns disagree about the scale.
  const ceiling = ruled ? ticks[ticks.length - 1] : max;

  // The tick figures hang off the plot's left edge. Centred, the 72% plot has
  // the margin to spare; a poster runs to the padding box and has to be told.
  const gutter = ruled && vertical ? width * 0.045 * density : 0;
  const plotW = poster
    ? width - pad.x * 2 - gutter
    : width * 0.72 * (1 + (1 - density) * 0.18);
  const numeric = fontStack(theme.typography.body);
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };

  const titleSize = height * (poster ? 0.07 : 0.05) * typeScale(theme, "title");
  const valueSize = height * (poster ? 0.044 : 0.028) * typeScale(theme, "number");
  const labelSize = height * (poster ? 0.037 : 0.026) * typeScale(theme, "caption");
  const valueGap = height * 0.011 * density;
  // Headroom for the value label sitting above a full-height column: it is
  // positioned OUT of the plot box, so the box has to leave it room above.
  const headroom = valueSize * 1.15 + valueGap;
  const barArea = height * (props.title ? 0.42 : 0.5) * 0.78;

  /**
   * Column geometry. A gap is a proportion of the COLUMN, not of the frame:
   * 0.42 of a bar's width is the same optical air whether there are three bars
   * or seven, where a frame fraction is a hairline at three and a canyon at
   * seven. Solving `n·w + (n-1)·r·w = plotW` for w gives the width that exactly
   * fills the plot, and the cap then stops three columns in a full-bleed poster
   * from becoming three slabs. Centred keeps the gap it always had.
   */
  const count = props.series.length;
  const gapRatio = 0.42 * density;
  const columnW = poster
    ? Math.min(width * 0.16, plotW / (count + gapRatio * (count - 1)))
    : 0;
  const columnGap = poster ? columnW * gapRatio : plotW * 0.03 * density;
  /** Poster columns are sized; centred ones share the row out between them. */
  const columnBox = poster
    ? { width: columnW, flexShrink: 0 }
    : { flex: 1, minWidth: 0 };
  const baselineH = ruleWidth(theme, Math.max(2, height * 0.003));

  const titleBlock = props.title ? (
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
        fontSize: titleSize,
        // 600 under poster, 700 centred: typeWeight snaps to hundreds, so a
        // 600 base is the only one a theme's `bold` can land on 800 — the
        // weight a headline this size wants before it turns into a slab.
        fontWeight: typeWeight(theme, poster ? 600 : 700),
        lineHeight: poster ? 1.08 : undefined,
        letterSpacing: poster ? typeTracking(theme, -0.01) : undefined,
        color: theme.colors.text,
        marginBottom: height * (poster ? 0.039 : 0.05) * density,
        maxWidth: poster ? "100%" : width * 0.8,
        textAlign: poster ? "left" : "center",
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
  ) : null;

  /**
   * The columns, the gridlines and the baseline all share ONE origin: the
   * bottom of this box. Before D70 the category labels lived inside each
   * column, so the box's floor was the bottom of the label row and every
   * gridline sat a label's height below the column it was supposed to bracket —
   * the "0" line ran through the names rather than under the bars. Labels are
   * now a sibling row below the baseline, and the bars are a straight
   * percentage of the box, so the scale is the same one twice.
   */
  const plot = (
    <div
      style={{
        position: "relative",
        width: plotW,
        height: poster ? undefined : barArea,
        flex: poster ? 1 : undefined,
        marginTop: poster ? headroom : 0,
        alignSelf: poster ? "center" : undefined,
      }}
    >
      {ruled
        ? ticks.map((v) => (
            <div
              key={v}
              style={{
                position: "absolute",
                left: 0,
                right: 0,
                bottom: `${(v / ceiling) * 100}%`,
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
                  fontWeight: chart.axisWeight,
                  fontVariantNumeric: "tabular-nums",
                  color: chart.axisInk,
                  whiteSpace: "nowrap",
                  opacity: axisIn,
                }}
              >
                {chart.formatNumber(v)}
              </span>
            </div>
          ))
        : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          // Capped columns cluster in the middle rather than spreading out with
          // canyons between them; uncapped ones fill the row and this is inert.
          justifyContent: "center",
          gap: columnGap,
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
          const fraction = s.value / ceiling;
          const labelOpacity = interpolate(frame, [start + growDur * 0.4, start + growDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          return (
            <div
              key={i}
              style={{
                // `minWidth: 0` on the centred branch: without it a nowrap
                // label makes the flex item refuse to shrink and seven bars
                // burst out of the plot.
                ...columnBox,
                height: "100%",
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${fraction * 100}%`,
                  background: barColor(i),
                  borderRadius: columnRadius,
                  scale: `1 ${grow}`,
                  transformOrigin: "bottom center",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: `calc(${fraction * 100}% + ${valueGap}px)`,
                  textAlign: "center",
                  fontFamily: numeric,
                  fontSize: valueSize,
                  lineHeight: 1.15,
                  fontWeight: typeWeight(theme, poster ? 600 : 700),
                  letterSpacing: poster ? typeTracking(theme, -0.01) : undefined,
                  fontVariantNumeric: "tabular-nums",
                  color: theme.colors.text,
                  opacity: labelOpacity,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {`${chart.formatNumber(shown)}${props.unit ? ` ${props.unit}` : ""}`}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  /** Baseline draws left-to-right before the bars grow off it. `grid: none`
   *  takes it away — the columns are the mark, the rule is the convention. */
  const baseline =
    chart.grid !== "none" ? (
      <div
        style={{
          position: "relative",
          width: plotW,
          height: baselineH,
          background: theme.colors.neutral,
          marginTop: height * 0.005 * density,
          alignSelf: poster ? "center" : undefined,
          scale: `${axisIn} 1`,
          transformOrigin: "left center",
        }}
      />
    ) : null;

  /** The category row, in the same flex geometry as the columns so a name sits
   *  under its own bar whether or not the columns are capped. */
  const categories = (
    <div
      style={{
        position: "relative",
        width: plotW,
        display: "flex",
        flexDirection: "row",
        justifyContent: "center",
        gap: columnGap,
        marginTop: height * (poster ? 0.019 : 0.014) * density,
        alignSelf: poster ? "center" : undefined,
      }}
    >
      {props.series.map((s, i) => {
        const start = axisDur + i * stagger;
        return (
          <div
            key={i}
            style={{
              ...columnBox,
              textAlign: "center",
              fontFamily: fontStack(theme.typography.body),
              fontSize: labelSize,
              lineHeight: 1.2,
              fontWeight: chart.axisWeight,
              color: chart.axisInk,
              letterSpacing: capsTracking(theme, 0.06),
              textTransform: typeCase(theme, "uppercase"),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              opacity: interpolate(
                frame,
                [start + growDur * 0.4, start + growDur],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ),
            }}
          >
            {s.label}
          </div>
        );
      })}
    </div>
  );

  const credit = props.source ? (
    <div
      style={{
        position: "absolute",
        left: (poster ? pad.x : plateInset.x) + width * 0.035 * density,
        bottom: (poster ? pad.y : plateInset.y) + height * 0.03 * density,
        fontFamily: numeric,
        fontSize: height * 0.019 * typeScale(theme, "caption"),
        fontWeight: typeWeight(theme, 400),
        letterSpacing: capsTracking(theme, 0.1),
        textTransform: typeCase(theme, "uppercase"),
        color: mutedInk(theme),
        opacity: interpolate(frame, [axisDur, axisDur + growDur], [0, 0.9], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {props.source}
    </div>
  ) : null;

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
            left: poster ? 0 : plateInset.x,
            top: poster ? 0 : plateInset.y,
            width: poster ? width : width - plateInset.x * 2,
            height: poster ? height : height - plateInset.y * 2,
            ...ground,
            opacity: axisIn,
          }}
        />
      ) : null}

      {vertical ? (
        poster ? (
          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              boxSizing: "border-box",
              paddingLeft: pad.x + gutter,
              paddingRight: pad.x,
              paddingTop: pad.y,
              paddingBottom: pad.y,
              display: "flex",
              flexDirection: "column",
              alignItems: "stretch",
            }}
          >
            {titleBlock}
            {plot}
            {baseline}
            {categories}
          </div>
        ) : (
          <>
            {titleBlock}
            {plot}
            {baseline}
            {categories}
          </>
        )
      ) : (
        <>
          {titleBlock}
          <HorizontalBars
            props={props}
            theme={theme}
            chart={chart}
            plotW={plotW}
            barRadius={barRadius}
            barColor={barColor}
            density={density}
            axisDur={axisDur}
            growDur={growDur}
            stagger={stagger}
            curve={curve}
            max={max}
          />
        </>
      )}

      {credit}
    </div>
  );
}

/**
 * The horizontal orientation: a ranked list of rows, unchanged by D70. It has
 * no separate axis to promote — the labels already sit in the text colour,
 * which is what `chart.axis: "ink"` means — and no headline slot to move, so
 * `layout.composition` has nothing to say to it.
 */
function HorizontalBars({
  props,
  theme,
  chart,
  plotW,
  barRadius,
  barColor,
  density,
  axisDur,
  growDur,
  stagger,
  curve,
  max,
}: {
  props: BarChartProps;
  theme: Theme;
  chart: ReturnType<typeof chartStyle>;
  plotW: number;
  barRadius: number | string | undefined;
  barColor: (i: number) => string;
  density: number;
  axisDur: number;
  growDur: number;
  stagger: number;
  curve: ReturnType<typeof Easing.bezier>;
  max: number;
}) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const numeric = fontStack(theme.typography.body);
  // `chart.legend: inline` puts the label and the figure INSIDE the bar, which
  // is what "inline" already means on LineChart: the series names itself where
  // it sits instead of in a row you have to look away to.
  const inside = chart.legend === "inline";
  const barH = chart.strokeWidth;

  return (
    <div
      style={{
        position: "relative",
        width: plotW,
        height: height * (props.title ? 0.42 : 0.5),
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        justifyContent: "center",
        gap: height * 0.04 * density,
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
        const valueText = `${chart.formatNumber(shown)}${props.unit ? ` ${props.unit}` : ""}`;
        const insideInk = contrastInk(theme, barColor(i));
        // The value belongs at the BAR's end, not the track's: that is where the
        // quantity actually stops. It sits just inside the bar when the bar is
        // long enough to hold it and just outside when it is not, and its ink
        // follows — measured, not guessed at from a ratio, because a short bar
        // with a long figure and a long bar with a short one both exist and a
        // single threshold gets one of them wrong.
        const valueW = valueText.length * barH * 0.62 * 0.6;
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
                    letterSpacing: capsTracking(theme, 0.06),
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
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
BarChart.honors = [
  "typography",
  "surface",
  "layout.composition",
  "chart",
  "motion.entrance",
  "motion.easing",
];
