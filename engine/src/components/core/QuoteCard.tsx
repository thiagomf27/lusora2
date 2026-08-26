/**
 * Example overlay for the lab. To bring your own: copy a component from the
 * engine (engine/src/components/core/<Name>.tsx) into this folder and change
 * its two imports to the lab's vendored theme:
 *     import type { Theme } from "../theme.ts";
 *     import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";
 * then register it in Root.tsx.
 */
import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, mutedInk } from "../theme.ts";

export const QuoteCardProps = z.object({
  quote: z.string(),
  attribution: z.string().optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type QuoteCardProps = z.infer<typeof QuoteCardProps>;

export function QuoteCard({ props, theme }: { props: QuoteCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, fps * 0.4), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const accent = emphasisColor(theme, props.emphasis);
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: width * 0.12,
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: fontStack(theme.typography.display),
          fontSize: height * 0.06,
          lineHeight: 1.25,
          color: theme.colors.text,
          borderLeft: `4px solid ${accent}`,
          paddingLeft: 28,
          fontStyle: "italic",
        }}
      >
        “{props.quote}”
      </div>
      {props.attribution ? (
        <div
          style={{
            marginTop: 18,
            marginLeft: 32,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.028,
            color: mutedInk(theme),
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          — {props.attribution}
        </div>
      ) : null}
    </div>
  );
}
