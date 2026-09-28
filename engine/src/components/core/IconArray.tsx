/**
 * IconArray — a count out of a small whole, drawn as a row of pictograms with
 * `count` of them lit: "9 of 9", "three in ten", "one in four".
 *
 * The one piece of new geometry in the D97 set. AnimatedCounter can say "9",
 * and PieChart can split a whole into parts, but neither makes the viewer COUNT
 * — and for a small whole of people the counting is the point: nine lit figures
 * out of nine lands in a way "100%" does not.
 *
 * The icon is a semantic choice (what is being counted), not a look, so it is a
 * prop. Its colours are the theme's: lit figures take the accent, the rest the
 * neutral at low strength. The figure line ("9 of 9") is set in the accent's
 * ink, which `accentInk` keeps readable on the page.
 */
import { useId } from "react";
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  accentInk,
  densityScale,
  easingCurve,
  emphasisColor,
  figureFace,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const IconArrayProps = z.object({
  /** How many are lit. May be fractional (6.7 of 10 for 67%): the last icon fills that far. */
  count: z.number().min(0).max(20),
  /** The whole: how many icons are drawn. */
  total: z.number().int().min(2).max(20),
  /** What is being counted; the planner picks the noun, not the look. */
  icon: z.enum(["dot", "person", "house"]).default("dot"),
  /** What the lit ones share: "shared the same rare maternal lineage". */
  label: z.string().max(80).optional(),
  /** Set as "9 of 9" when omitted; pass it to say "three in ten" instead. */
  figure: z.string().max(24).optional(),
  source: z.string().max(70).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type IconArrayProps = z.infer<typeof IconArrayProps>;

export function IconArray({ props, theme }: { props: IconArrayProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const uid = useId().replace(/:/g, "");
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 12, legible: true });
  const lit = emphasisColor(theme, props.emphasis);
  const curve = Easing.bezier(...easingCurve(theme));

  const entrance = useEntrance(theme, {
    component: "IconArray",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const total = Math.max(props.total, 2);
  const count = Math.min(props.count, total);
  // One row up to ten; two rows beyond, so twenty figures stay readable.
  const perRow = total > 10 ? Math.ceil(total / 2) : total;
  const iconH = Math.min(height * 0.11, (width * 0.7) / perRow / 0.62);
  // Each icon keeps its own proportions (D97): the box is the shape's aspect,
  // never a squeeze of a square one.
  const iconW = iconH * ASPECT[props.icon ?? "dot"];
  const gap = iconW * 0.45;

  // The icons pop in left to right; the lit ones fill after the row is down,
  // so the eye counts them as they light. Clamped so a long row still lands.
  const stagger = Math.min(Math.round(fps * 0.06 * durationMul), Math.floor((durationInFrames * 0.35) / total));
  const rowDone = inDur + total * stagger;
  const lightDur = Math.round(fps * 0.5 * durationMul);
  const textIn = interpolate(frame, [rowDone, rowDone + fps * 0.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // A fractional count reads as written, to one place: "6.7 of 10".
  const shownCount = Number.isInteger(count) ? String(count) : count.toFixed(1);
  const figure = props.figure ?? `${shownCount} of ${total}`;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: height * 0.025 * density,
          ...(ground ? { ...ground, padding: `${height * 0.05 * density}px ${width * 0.05 * density}px` } : {}),
        }}
      >
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap, maxWidth: perRow * (iconW + gap) }}>
          {Array.from({ length: total }, (_, i) => {
            const start = inDur * 0.5 + i * stagger;
            const pop = interpolate(frame, [start, start + fps * 0.25], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
            });
            // How much of this icon the count covers: 1 for a whole one, the
            // remainder for the last of a fractional count, 0 past it.
            const share = Math.max(0, Math.min(1, count - i));
            const on =
              share > 0
                ? interpolate(frame, [rowDone + i * stagger * 0.5, rowDone + i * stagger * 0.5 + lightDur], [0, 1], {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: curve,
                  })
                : 0;
            return (
              <div key={i} style={{ scale: `${pop}`, transformOrigin: "bottom center" }}>
                <Icon
                  id={`${uid}-${i}`}
                  kind={props.icon ?? "dot"}
                  w={iconW}
                  h={iconH}
                  off={theme.colors.neutral}
                  on={lit}
                  lit={on}
                  share={share}
                />
              </div>
            );
          })}
        </div>
        <div
          style={{
            ...figureFace(theme),
            fontSize: height * 0.075 * typeScale(theme, "number"),
            fontWeight: typeWeight(theme, 800),
            lineHeight: 1,
            letterSpacing: typeTracking(theme, -0.01),
            color: accentInk(theme, lit),
            opacity: textIn,
          }}
        >
          {figure}
        </div>
        {props.label ? (
          <div
            style={{
              maxWidth: width * 0.6,
              textAlign: "center",
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.03 * typeScale(theme, "body"),
              fontWeight: typeWeight(theme, 600),
              color: theme.colors.text,
              opacity: textIn,
            }}
          >
            {props.label}
          </div>
        ) : null}
        {props.source ? (
          <div
            style={{
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.018 * typeScale(theme, "caption"),
              color: mutedInk(theme),
              opacity: textIn,
            }}
          >
            {props.source}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Width over height of each shape, so no icon is ever squeezed into another's box. */
const ASPECT: Record<IconArrayProps["icon"], number> = { dot: 1, person: 0.46, house: 1 };

/**
 * One pictogram, drawn in its own viewBox at its own aspect. The unlit copy is
 * the neutral at low strength; the lit copy is the accent, clipped to `share`
 * of the icon's width — a whole icon, or the 0.7 of the last one in "6.7 of 10".
 */
function Icon({
  id,
  kind,
  w,
  h,
  off,
  on,
  lit,
  share,
}: {
  id: string;
  kind: IconArrayProps["icon"];
  w: number;
  h: number;
  off: string;
  on: string;
  lit: number;
  share: number;
}) {
  const vbW = kind === "person" ? 46 : 100;
  const shape = (fill: string, opacity: number) => {
    if (kind === "dot") {
      return <circle cx={50} cy={50} r={44} fill={fill} opacity={opacity} />;
    }
    if (kind === "house") {
      return <path d="M50 8 L94 44 L84 44 L84 92 L16 92 L16 44 L6 44 Z" fill={fill} opacity={opacity} />;
    }
    // A person drawn at its own 46x100 aspect: head over a rounded body.
    return (
      <g opacity={opacity}>
        <circle cx={23} cy={14} r={12} fill={fill} />
        <path d="M4 36 Q4 30 10 30 L36 30 Q42 30 42 36 L42 66 L33 66 L33 98 L13 98 L13 66 L4 66 Z" fill={fill} />
      </g>
    );
  };
  return (
    <svg width={w} height={h} viewBox={`0 0 ${vbW} 100`} style={{ overflow: "visible" }}>
      <defs>
        <clipPath id={`ia-${id}`}>
          <rect x={0} y={0} width={vbW * share} height={100} />
        </clipPath>
      </defs>
      {/* The unlit ground stays under the whole icon, so a partly lit one
          reads as partly lit rather than as a smaller icon. */}
      {shape(off, 0.3)}
      <g clipPath={`url(#ia-${id})`}>{shape(on, lit)}</g>
    </svg>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
IconArray.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
