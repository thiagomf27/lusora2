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
 *
 * `chart.legend` decides where a wedge is named. `inline` — the component's own
 * — writes the name on the ring, which is the reading a pie exists for: the
 * label sits on the shape that carries the meaning. `bottom` moves the names
 * into a key beside the ring, one filled row per slice carrying its share as a
 * figure. That is a genuine either/or and not a preference: on the ring the
 * name has to fit inside a wedge, so a five-word label or a 4% slice cannot be
 * written there at all, and a key is the only place those can be read.
 */
import { useId, type ReactNode } from "react";
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  blend,
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
  seriesColors,
  surfaceColor,
  surfaceStyle,
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
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type PieChartProps = z.infer<typeof PieChartProps>;

/** A slice's mid-angle in radians, measuring clockwise from twelve o'clock. */
function midAngle(startFrac: number, endFrac: number): number {
  return ((startFrac + endFrac) / 2) * Math.PI * 2 - Math.PI / 2;
}

/** How far a wedge that is not the highlighted one is faded back. */
const DIM = 0.42;

/**
 * A poster stacks from the top so the headline sits in the corner, which would
 * leave a fixed-aspect plot pinned under it with the page empty below. This
 * takes the room that is left and centres the plot in it. Inert (a passthrough)
 * for the centred composition, where the whole stack is centred already.
 */
function PosterCentre({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div
      style={{
        flex: 1,
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {children}
    </div>
  );
}

/** The ring and its key, side by side. A passthrough when there is no key. */
function KeyRow({ on, children }: { on: boolean; children: ReactNode }) {
  if (!on) return <>{children}</>;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center" }}>{children}</div>
  );
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

  // The two compositions (D70). A donut is the one chart whose plot is a fixed
  // aspect, so `poster` does not stretch it — it moves the headline into the
  // corner and lets the ring grow into the room that frees up.
  const poster = composition(theme) === "poster";
  const framePad = posterPad(theme, { width, height });
  const ground = groundStyle(theme, {
    radius: poster ? 0 : 14,
    accentRule: "none",
    legible: true,
  });
  const plateInset = { x: width * 0.05 * density, y: height * 0.07 * density };
  const clipId = `pie-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const titleSize = height * (poster ? 0.07 : 0.05) * typeScale(theme, "title");
  const titleGap = height * (poster ? 0.035 : 0.03) * density;

  /**
   * The key takes width off the ring, and only when a theme asks for one. Every
   * shipped theme names `inline`, so the two box formulas below are exactly the
   * ones PieChart has always used and no existing render moves (Principle 7).
   */
  const showKey = chart.legend === "bottom";
  const keyGap = width * 0.04 * density;
  const keyW = showKey ? Math.min(width * 0.34, (poster ? width - framePad.x * 2 : width - plateInset.x * 2) * 0.42) : 0;
  const keyTake = showKey ? keyW + keyGap : 0;

  const total = props.slices.reduce((sum, s) => sum + s.value, 0) || 1;
  // `box` is R * 2.6 — the ring plus the room a pulled-out slice and its label
  // need around it — so a poster sizes the BOX to the space below the headline
  // and works back to the radius, rather than guessing a radius and hoping.
  const posterBox = Math.min(
    Math.min(width * 0.42, width - framePad.x * 2 - keyTake),
    height - framePad.y * 2 - (props.title ? titleSize * 1.08 + titleGap : 0),
  );
  // Centred, the ring is a fixed slice of the frame and nothing checked it fit:
  // a compact, tight theme grew the box past the plate and pushed the title out
  // through the plate's top edge. The stack has to fit the plate it sits on.
  const centredBox = Math.min(
    Math.min(width * 0.2, height * (props.title ? 0.3 : 0.34)) * (2 - density) ** 0.35 * 2.6,
    height - plateInset.y * 2 - (props.title ? titleSize * 1.25 + titleGap : 0),
    width - plateInset.x * 2 - keyTake,
  );
  const R = (poster ? posterBox / 2.6 : centredBox / 2.6) * (poster ? (2 - density) ** 0.35 : 1);
  const box = R * 2.6;

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

  /**
   * The key: one filled row per slice, in that slice's colour, with the share
   * as a figure at the far end. It is a legend and a data label at once, which
   * is why the row is FILLED rather than carrying a swatch — the colour is
   * doing the cross-referencing, so a separate chip beside it would be the same
   * fact printed twice.
   *
   * Each row wipes in as the sweep passes its own wedge, so the ring and the
   * key are never telling the viewer different things at the same frame.
   */
  const keyRowGap = height * 0.022 * density;
  const keyRowH = Math.min(
    height * 0.13,
    Math.max(height * 0.05, (box - keyRowGap * (wedges.length - 1)) / wedges.length),
  );
  const keyBlock = showKey ? (
    <div
      style={{
        width: keyW,
        marginLeft: keyGap,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        gap: keyRowGap,
      }}
    >
      {wedges.map((w) => {
        const lit = props.highlight_index === undefined || props.highlight_index === w.i;
        const painted = blend(sliceColor(w.i), surfaceColor(theme), lit ? 1 : DIM);
        const appear = interpolate(sweep, [w.startFrac, Math.min(1, w.endFrac)], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        return (
          <div
            key={w.i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: keyRowH * 0.2,
              height: keyRowH,
              boxSizing: "border-box",
              padding: `0 ${keyRowH * 0.3}px`,
              // The row is PAINTED faded, never faded as a whole: an opacity on
              // the row takes the type down with the plate, and the type was
              // just contrast-picked against the faded plate. Same mistake D70
              // fixed on the wedge labels, one element along.
              background: painted,
              borderRadius: surfaceStyle(theme, { radius: 12 }).borderRadius,
              color: contrastInk(theme, painted),
              fontFamily: fontStack(theme.typography.body),
              clipPath: `inset(0 ${(1 - appear) * 100}% 0 0)`,
            }}
          >
            <span
              style={{
                minWidth: 0,
                fontSize: keyRowH * 0.34 * typeScale(theme, "caption"),
                fontWeight: typeWeight(theme, 600),
                letterSpacing: typeTracking(theme, -0.01),
                textTransform: typeCase(theme),
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {w.label}
            </span>
            <span
              style={{
                flexShrink: 0,
                fontSize: keyRowH * 0.4 * typeScale(theme, "number"),
                fontWeight: typeWeight(theme, 700),
                letterSpacing: typeTracking(theme, -0.01),
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {`${Math.round(w.share * 100)}%`}
            </span>
          </div>
        );
      })}
    </div>
  ) : null;

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
            opacity: titleIn,
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
          alignItems: "center",
          justifyContent: poster ? "flex-start" : "center",
        }}
      >
        {props.title ? (
          <div
            style={{
              marginBottom: titleGap,
              alignSelf: poster ? "flex-start" : "center",
              fontFamily: fontStack(theme.typography.display),
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
              opacity: titleIn,
            }}
          >
            {props.title}
          </div>
        ) : null}

        <PosterCentre on={poster}>
        {/* The row exists only when there IS a key. Wrapping unconditionally
            would make the svg a flex item under `inline` too, and a block-level
            svg loses the baseline descender an inline one sits on — a couple of
            pixels of vertical shift in every theme, for a branch they are not
            in. */}
        <KeyRow on={showKey}>
        {/* `flexShrink` only when the svg IS a flex item. Setting it
            unconditionally is not inert: it is a style prop on an element that
            had none, and it moved bold-editorial's ring by a fraction of a
            pixel — enough to change every antialiased edge in the frame. */}
        <svg width={box} height={box} style={showKey ? { flexShrink: 0 } : undefined}>
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
                  fillOpacity={lit ? 1 : DIM}
                  stroke={surfaceColor(theme)}
                  strokeWidth={chart.strokeWidth}
                  strokeLinejoin="round"
                />
              );
            })}
          </g>

          {/* Each wedge names itself on the ring — that is `chart.legend:
              "inline"`, and it is what a pie does when nothing says otherwise:
              a key would make the viewer look away from the shape that carries
              the meaning. Wedges under 7% get no label rather than an
              unreadable one, which is the case `bottom` exists to rescue. */}
          {wedges.map((w) => {
            if (showKey || w.share < 0.07) return null;
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
                // Against the colour the wedge is PAINTED, not the colour it
                // was given: a dimmed wedge is a different colour, and asking
                // about the full-strength one put white type on a washed-out
                // slice here and dark type on a darkened one on a dark theme.
                fill={contrastInk(theme, blend(sliceColor(w.i), surfaceColor(theme), lit ? 1 : DIM))}
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
        {keyBlock}
        </KeyRow>
        </PosterCentre>
      </div>

      {props.source ? (
        <div
          style={{
            position: "absolute",
            left: (poster ? framePad.x : plateInset.x) + width * 0.035 * density,
            bottom: (poster ? framePad.y : plateInset.y) + height * 0.03 * density,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.019 * typeScale(theme, "caption"),
            fontWeight: typeWeight(theme, 400),
            letterSpacing: typeTracking(theme, 0.1),
            textTransform: typeCase(theme, "uppercase"),
            color: mutedInk(theme),
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
PieChart.honors = [
  "typography",
  "surface",
  "layout.composition",
  "chart",
  "motion.entrance",
  "motion.easing",
];
