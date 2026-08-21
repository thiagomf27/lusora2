/**
 * RankLabel — "#3 of 20" with a slot-machine settle.
 *
 * The numeral counts DOWN from a higher start to the true rank while a ring
 * sweeps around it, then the title wipes in beside it. Numerals use the body
 * face + tabular-nums so the digits don't shuffle sideways as they change.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const RankLabelProps = z.object({
  rank: z.number().int().min(1).max(999),
  title: z.string().max(44),
  subtitle: z.string().max(36).optional(),
  /** Renders "of 20" and gives the count-down somewhere to start. */
  total: z.number().int().min(1).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type RankLabelProps = z.infer<typeof RankLabelProps>;

export function RankLabel({ props, theme }: { props: RankLabelProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 10, legible: true });
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "RankLabel",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.35,
  });
  const { opacity, inDur } = entrance;

  const settleDur = Math.round(fps * 0.8 * durationMul);
  const from = props.total ?? props.rank + 4;
  const shown = Math.max(
    props.rank,
    Math.round(
      interpolate(frame, [0, settleDur], [Math.max(from, props.rank), props.rank], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: curve,
      }),
    ),
  );

  const R = height * 0.075;
  const stroke = ruleWidth(theme, Math.max(3, height * 0.008));
  const C = 2 * Math.PI * R;
  const sweep = interpolate(frame, [0, settleDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const wipeStart = settleDur * 0.5;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${width * 0.08 * density}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {/* The ground HUGS the lockup rather than sitting behind a guessed box:
          the badge and the title are one object, and a plate that misses either
          of them is worse than no plate. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: width * 0.028 * density,
          ...(ground ? { ...ground, padding: `${height * 0.03 * density}px ${width * 0.03 * density}px` } : {}),
        }}
      >
      <div style={{ position: "relative", flexShrink: 0, width: R * 2.5, height: R * 2.5 }}>
        <svg width={R * 2.5} height={R * 2.5}>
          <circle
            cx={R * 1.25}
            cy={R * 1.25}
            r={R}
            fill="none"
            stroke={theme.colors.neutral}
            strokeOpacity={0.3}
            strokeWidth={stroke}
          />
          <circle
            cx={R * 1.25}
            cy={R * 1.25}
            r={R}
            fill="none"
            stroke={accent}
            strokeWidth={stroke}
            strokeDasharray={C}
            strokeDashoffset={C * (1 - sweep)}
            strokeLinecap="round"
            transform={`rotate(-90 ${R * 1.25} ${R * 1.25})`}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontStack(theme.typography.body),
            fontSize: R * 0.85,
            fontWeight: typeWeight(theme, 700),
            fontVariantNumeric: "tabular-nums",
            color: theme.colors.text,
          }}
        >
          {shown}
        </div>
      </div>

      <div
        style={{
          minWidth: 0,
          clipPath: `inset(0 ${interpolate(frame, [wipeStart, wipeStart + fps * 0.4 * durationMul], [100, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          })}% 0 0)`,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.058 * typeScale(theme, "number"),
            fontWeight: typeWeight(theme, 700),
            color: theme.colors.text,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {props.title}
        </div>
        <div
          style={{
            marginTop: height * 0.008 * density,
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.012 * density,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.026 * typeScale(theme, "kicker"),
            color: mutedInk(theme),
            letterSpacing: typeTracking(theme, 0.1),
            textTransform: typeCase(theme, "uppercase"),
            whiteSpace: "nowrap",
          }}
        >
          {props.total ? <span style={{ fontVariantNumeric: "tabular-nums" }}>of {props.total}</span> : null}
          {props.subtitle ? <span>{props.subtitle}</span> : null}
        </div>
      </div>
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
RankLabel.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
