import { z } from "zod";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { emphasisColor, fontStack, motionScale } from "../../themes/runtime.ts";

export const ComparisonBarsProps = z.object({
  items: z.array(z.object({ label: z.string(), value: z.number() })).min(2).max(4),
  unit: z.string().optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ComparisonBarsProps = z.infer<typeof ComparisonBarsProps>;

export function ComparisonBars({ props, theme }: { props: ComparisonBarsProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul, springDamping } = motionScale(theme);
  const max = Math.max(...props.items.map((i) => i.value), 1);
  const opacity = interpolate(
    frame,
    [0, fps * 0.3, durationInFrames - fps * 0.4, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const accent = emphasisColor(theme, props.emphasis);
  const barW = width * 0.34;
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.06,
        top: height * 0.12,
        opacity,
        background: `${theme.colors.bg}cc`,
        borderRadius: 12,
        padding: `${height * 0.025}px ${width * 0.02}px`,
        display: "flex",
        flexDirection: "column",
        gap: height * 0.018,
      }}
    >
      {props.items.map((item, i) => {
        const grow = spring({
          frame: frame - Math.round(i * fps * 0.18 * durationMul),
          fps,
          config: { damping: springDamping },
          durationInFrames: Math.round(fps * 1.0 * durationMul),
        });
        const shown = Math.round(item.value * grow);
        return (
          <div key={i}>
            <div
              style={{
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.026,
                color: theme.colors.text,
                marginBottom: 4,
                display: "flex",
                justifyContent: "space-between",
                width: barW,
              }}
            >
              <span>{item.label}</span>
              <span style={{ color: accent, fontWeight: 700 }}>
                {shown.toLocaleString()}
                {props.unit ? ` ${props.unit}` : ""}
              </span>
            </div>
            <div style={{ width: barW, height: height * 0.02, background: `${theme.colors.neutral}44`, borderRadius: 4 }}>
              <div
                style={{
                  width: barW * (item.value / max) * grow,
                  height: "100%",
                  background: i === 0 ? accent : theme.colors.neutral,
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
