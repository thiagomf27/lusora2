import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../../themes/runtime.ts";

export const TitleCardProps = z.object({
  text: z.string(),
  subtext: z.string().optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type TitleCardProps = z.infer<typeof TitleCardProps>;

export function TitleCard({ props, theme }: { props: TitleCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const inDur = Math.round(fps * 0.6 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const rise = interpolate(frame, [0, inDur], [height * 0.02, 0], {
    extrapolateRight: "clamp",
  });
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        transform: `translateY(${rise}px)`,
      }}
    >
      <div
        style={{
          fontFamily: fontStack(theme.typography.display),
          fontSize: height * 0.11,
          fontWeight: 700,
          color: theme.colors.text,
          textShadow: "0 2px 24px rgba(0,0,0,0.6)",
          letterSpacing: "0.02em",
        }}
      >
        {props.text}
      </div>
      {props.subtext ? (
        <div
          style={{
            marginTop: height * 0.015,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.035,
            color: emphasisColor(theme, props.emphasis),
            letterSpacing: "0.14em",
            textTransform: "uppercase",
          }}
        >
          {props.subtext}
        </div>
      ) : null}
    </div>
  );
}
