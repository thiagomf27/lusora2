/**
 * PieChart — a part-of-whole split: two to six slices of one total.
 *
 * The one thing no other component in the catalog carries. `BarChart` compares
 * separate quantities and a bar's length means nothing without its neighbours'
 * axis; a pie says "these are the pieces of ONE thing", and that claim lives in
 * the geometry rather than in the label. That is why it is a component and not
 * `BarChart` with a prop: the marks are angular, the total is implied by the
 * circle closing, and a bar chart cannot say either.
 *
 * Slices are ordered as authored, never sorted: the script says "a third went
 * to the army, a quarter to the navy" in an order, and re-sorting silently
 * would make the narration point at the wrong wedge.
 *
 * Values are absolute; the component takes the share itself. Asking a script
 * for percentages that sum to 100 is asking it to do arithmetic, which is D5's
 * whole point in miniature.
 */
import { useId } from "react";
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  chartStyle,
  contrastInk,
  densityScale,
  easingCurve,
  fontStack,
  groundStyle,
  motionScale,
  seriesColors,
  surfaceColor,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const PieChartProps = z.object({
  title: z.string().max(48).optional(),
  slices: z
    .array(z.object({ label: z.string().max(20), value: z.number().min(0) }))
    .min(2)
    .max(6),
  /** The one slice the narration is about: it pulls out of the ring. */
  highlight_index: z.number().int().min(0).max(5).optional(),
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type PieChartProps = z.infer<typeof PieChartProps>;

/** A slice's mid-angle in radians, measuring clockwise from twelve o'clock. */
function midAngle(startFrac: number, endFrac: number): number {
  return ((startFrac + endFrac) / 2) * Math.PI * 2 - Math.PI / 2;
}

export function PieChart({ props, theme }: { props: PieChartProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "PieChart",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity } = entrance;

  const chart = chartStyle(theme, {
    // A pie has no axis to rule and no series to mark, so `grid` and `markers`
    // are declared as the values that mean "nothing to draw" and a theme asking
    // for gridlines is honoured by ignoring it rather than by inventing one.
    grid: "none",
    markers: "none",
    legend: "inline", // its own: every wedge names itself where it sits
    stroke: Math.max(2, height * 0.004),
  });
  const ramp = seriesColors(theme);
  const sliceColor = (i: number) =>
    props.emphasis === "neutral" ? theme.colors.neutral : ramp[i % ramp.length];

  const ground = groundStyle(theme, { radius: 14, accentRule: "none", legible: true });
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };
  const clipId = `pie-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const total = props.slices.reduce((sum, s) => sum + s.value, 0) || 1;
  const R = Math.min(width * 0.2, height * (props.title ? 0.3 : 0.34)) * (2 - density) ** 0.35;
  const box = R * 2.6; // room for the pulled-out slice and its label

  const sweepDur = Math.round(fps * 1.1 * durationMul);
  const titleIn = interpolate(frame, [0, Math.round(fps * 0.4 * durationMul)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  // One sweep around the whole circle, not a stagger per slice: the wedges are
  // parts of ONE quantity, and revealing them separately reads as a sequence.
  const sweep = interpolate(frame, [0, sweepDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  let cursor = 0;
  const wedges = props.slices.map((s, i) => {
    const startFrac = cursor;
    cursor += s.value / total;
    return { ...s, i, startFrac, endFrac: cursor, share: s.value / total };
  });

  const ringWidth = R * 0.42;
  const cx = box / 2;
  const cy = box / 2;

  /** An annular wedge, drawn as an SVG path so the hole is real geometry. */
  const wedgePath = (startFrac: number, endFrac: number, pull: number) => {
    const a0 = startFrac * Math.PI * 2 - Math.PI / 2;
    const a1 = endFrac * Math.PI * 2 - Math.PI / 2;
    const mid = midAngle(startFrac, endFrac);
    const ox = Math.cos(mid) * pull;
    const oy = Math.sin(mid) * pull;
    const rOut = R;
    const rIn = R - ringWidth;
    const large = endFrac - startFrac > 0.5 ? 1 : 0;
    const p = (r: number, a: number) => `${(cx + ox + Math.cos(a) * r).toFixed(2)} ${(cy + oy + Math.sin(a) * r).toFixed(2)}`;
    return (
      `M${p(rOut, a0)} A${rOut} ${rOut} 0 ${large} 1 ${p(rOut, a1)} ` +
      `L${p(rIn, a1)} A${rIn} ${rIn} 0 ${large} 0 ${p(rIn, a0)} Z`
    );
  };

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
            opacity: titleIn,
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
              overflowWrap: "anywhere",
              opacity: titleIn,
            }}
          >
            {props.title}
          </div>
        ) : null}

        <svg width={box} height={box}>
          <defs>
            {/* The sweep is a rotating half-plane mask: a clip rect cannot cut
                an arc, and animating each wedge's dash offset would reveal them
                one at a time, which is the reading this component exists to
                avoid. */}
            <clipPath id={clipId}>
              <path
                d={
                  sweep >= 1
                    ? `M0 0 H${box} V${box} H0 Z`
                    : `M${cx} ${cy} L${cx} ${cy - box} ` +
                      `A${box} ${box} 0 ${sweep > 0.5 ? 1 : 0} 1 ` +
                      `${(cx + Math.cos(sweep * Math.PI * 2 - Math.PI / 2) * box).toFixed(2)} ` +
                      `${(cy + Math.sin(sweep * Math.PI * 2 - Math.PI / 2) * box).toFixed(2)} Z`
                }
              />
            </clipPath>
          </defs>

          <g clipPath={`url(#${clipId})`}>
            {wedges.map((w) => {
              const lit = props.highlight_index === undefined || props.highlight_index === w.i;
              const pull =
                props.highlight_index === w.i
                  ? R * 0.09 * interpolate(sweep, [0.75, 1], [0, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                    })
                  : 0;
              return (
                <path
                  key={w.i}
                  d={wedgePath(w.startFrac, w.endFrac, pull)}
                  fill={sliceColor(w.i)}
                  fillOpacity={lit ? 1 : 0.42}
                  stroke={surfaceColor(theme)}
                  strokeWidth={chart.strokeWidth}
                  strokeLinejoin="round"
                />
              );
            })}
          </g>

          {/* Each wedge names itself on the ring — a legend key would make the
              viewer look away from the shape that carries the meaning. Wedges
              under 7% get no label rather than an unreadable one. */}
          {wedges.map((w) => {
            if (w.share < 0.07) return null;
            const mid = midAngle(w.startFrac, w.endFrac);
            const r = R - ringWidth / 2;
            const lit = props.highlight_index === undefined || props.highlight_index === w.i;
            // The label rides WITH its wedge when that wedge pulls out, or it
            // detaches and sits in the gap the pull opened.
            const pull =
              props.highlight_index === w.i
                ? R * 0.09 * interpolate(sweep, [0.75, 1], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                  })
                : 0;
            return (
              <text
                key={w.i}
                x={cx + Math.cos(mid) * (r + pull)}
                y={cy + Math.sin(mid) * (r + pull)}
                textAnchor="middle"
                dominantBaseline="central"
                fill={contrastInk(theme, sliceColor(w.i))}
                fontFamily={fontStack(theme.typography.body)}
                fontSize={height * 0.021 * typeScale(theme, "caption")}
                fontWeight={typeWeight(theme, 600)}
                letterSpacing={typeTracking(theme)}
                style={{ textTransform: typeCase(theme), fontVariantNumeric: "tabular-nums" }}
                opacity={
                  lit
                    ? interpolate(sweep, [w.endFrac, Math.min(1, w.endFrac + 0.12)], [0, 1], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                      })
                    : 0.5
                }
              >
                {w.label}
              </text>
            );
          })}

          {/* The hole carries the highlighted share, or the total. It is the
              only place a figure can sit without competing with a wedge. */}
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill={theme.colors.text}
            fontFamily={fontStack(theme.typography.body)}
            fontSize={height * 0.058 * typeScale(theme, "number")}
            fontWeight={typeWeight(theme, 700)}
            style={{ fontVariantNumeric: "tabular-nums" }}
            opacity={titleIn}
          >
            {props.highlight_index !== undefined && wedges[props.highlight_index]
              ? `${Math.round(wedges[props.highlight_index].share * sweep * 100)}%`
              : chart.formatNumber(total * sweep)}
          </text>
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
            opacity: interpolate(sweep, [0.85, 1], [0, 0.9], {
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
PieChart.honors = ["typography", "surface", "chart", "motion.entrance", "motion.easing"];
