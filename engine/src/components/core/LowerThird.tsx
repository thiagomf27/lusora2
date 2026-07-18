import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { emphasisColor, fontStack, motionScale } from "../../themes/runtime.ts";

export const LowerThirdProps = z.object({
  title: z.string(),
  subtitle: z.string().optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type LowerThirdProps = z.infer<typeof LowerThirdProps>;

export function LowerThird({ props, theme }: { props: LowerThirdProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const inDur = Math.round(fps * 0.5 * durationMul);
  const slide = interpolate(frame, [0, inDur], [-width * 0.3, 0], { extrapolateRight: "clamp" });
  const opacity = interpolate(
    frame,
    [0, inDur, durationInFrames - inDur, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const accent = emphasisColor(theme, props.emphasis);
  return (
    <div
      style={{
        position: "absolute",
        left: width * 0.05,
        bottom: height * 0.14,
        transform: `translateX(${slide}px)`,
        opacity,
        display: "flex",
        alignItems: "stretch",
      }}
    >
      <div style={{ width: 6, background: accent, borderRadius: 2 }} />
      <div
        style={{
          background: `${theme.colors.bg}d9`,
          padding: `${height * 0.012}px ${width * 0.018}px`,
          borderRadius: "0 4px 4px 0",
        }}
      >
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.042,
            fontWeight: 600,
            color: theme.colors.text,
          }}
        >
          {props.title}
        </div>
        {props.subtitle ? (
          <div
            style={{
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.026,
              color: theme.colors.neutral,
              marginTop: 2,
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
