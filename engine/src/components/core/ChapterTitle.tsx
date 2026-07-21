import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../../themes/runtime.ts";

/**
 * ChapterTitle — an animated section/chapter title that fades in and out, at
 * screen center or as a lower third. Ported from video-engine's ChapterTitle;
 * its raw light/dark palette is dropped in favour of the theme runtime so it
 * obeys the catalog's semantic-props-only rule (appearance resolves here).
 */
export const ChapterTitleProps = z.object({
  text: z.string(),
  position: z.enum(["center", "lower_third"]).default("center"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type ChapterTitleProps = z.infer<typeof ChapterTitleProps>;

export function ChapterTitle({ props, theme }: { props: ChapterTitleProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const fadeDur = Math.round(fps * 0.4 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, fadeDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const accent = emphasisColor(theme, props.position === "lower_third" ? props.emphasis : undefined);
  const centered = props.position === "center";

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        justifyContent: centered ? "center" : "flex-end",
        alignItems: "center",
        flexDirection: "column",
        paddingBottom: centered ? 0 : height * 0.12,
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: fontStack(theme.typography.display),
          fontWeight: 700,
          fontSize: height * (centered ? 0.06 : 0.045),
          letterSpacing: "0.04em",
          textAlign: "center",
          color: theme.colors.text,
          background: `${theme.colors.bg}8c`,
          padding: `${height * 0.018}px ${height * 0.045}px`,
          borderRadius: 8,
          borderBottom: centered ? "none" : `4px solid ${accent}`,
          maxWidth: "80%",
          textShadow: "0 2px 24px rgba(0,0,0,0.6)",
        }}
      >
        {props.text}
      </div>
    </div>
  );
}
