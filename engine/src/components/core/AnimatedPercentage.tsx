import { z } from "zod";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../../themes/runtime.ts";

export const AnimatedPercentageProps = z.object({
  value: z.number().min(0).max(100),
  label: z.string(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type AnimatedPercentageProps = z.infer<typeof AnimatedPercentageProps>;

export function AnimatedPercentage({ props, theme }: { props: AnimatedPercentageProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul, springDamping } = motionScale(theme);
  const progress = spring({
    frame,
    fps,
    config: { damping: springDamping, mass: 1 },
    durationInFrames: Math.round(fps * 1.4 * durationMul),
  });
  const shown = Math.round(props.value * progress);
  const opacity = interpolate(
    frame,
    fadeInOutRange(durationInFrames, fps * 0.3, fps * 0.4),
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const accent = emphasisColor(theme, props.emphasis);
  const R = height * 0.13;
  const stroke = height * 0.016;
  const C = 2 * Math.PI * R;
  return (
    <div
      style={{
        position: "absolute",
        right: width * 0.06,
        top: height * 0.12,
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        background: `${theme.colors.bg}cc`,
        borderRadius: 12,
        padding: height * 0.025,
      }}
    >
      <svg width={R * 2.4} height={R * 2.4}>
        <circle
          cx={R * 1.2} cy={R * 1.2} r={R}
          fill="none" stroke={theme.colors.neutral} strokeOpacity={0.35} strokeWidth={stroke}
        />
        <circle
          cx={R * 1.2} cy={R * 1.2} r={R}
          fill="none" stroke={accent} strokeWidth={stroke}
          strokeDasharray={C}
          strokeDashoffset={C * (1 - (props.value / 100) * progress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${R * 1.2} ${R * 1.2})`}
        />
        <text
          x="50%" y="50%" dominantBaseline="central" textAnchor="middle"
          fill={theme.colors.text}
          fontFamily={fontStack(theme.typography.display)}
          fontSize={R * 0.62} fontWeight={700}
        >
          {shown}%
        </text>
      </svg>
      <div
        style={{
          marginTop: 4,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.028,
          color: theme.colors.text,
          maxWidth: R * 2.6,
          textAlign: "center",
        }}
      >
        {props.label}
      </div>
    </div>
  );
}
