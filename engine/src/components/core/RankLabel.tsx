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
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

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
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.35 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const settleDur = Math.round(fps * 0.8 * durationMul);
  const from = props.total ?? props.rank + 4;
  const shown = Math.max(
    props.rank,
    Math.round(
      interpolate(frame, [0, settleDur], [Math.max(from, props.rank), props.rank], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
        easing: Easing.bezier(0.16, 1, 0.3, 1),
      }),
    ),
  );

  const R = height * 0.075;
  const stroke = Math.max(3, height * 0.008);
  const C = 2 * Math.PI * R;
  const sweep = interpolate(frame, [0, settleDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
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
        gap: width * 0.028,
        padding: `0 ${width * 0.08}px`,
        opacity,
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
            fontWeight: 700,
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
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}% 0 0)`,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.058,
            fontWeight: 700,
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
            marginTop: height * 0.008,
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.012,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.026,
            color: theme.colors.neutral,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
          }}
        >
          {props.total ? <span style={{ fontVariantNumeric: "tabular-nums" }}>of {props.total}</span> : null}
          {props.subtitle ? <span>{props.subtitle}</span> : null}
        </div>
      </div>
    </div>
  );
}
