/**
 * HammerStatement — one blunt claim, sized to fill the frame, with the words
 * masking up from below and an accent rule slamming in underneath.
 *
 * NOTE: this is one of only two catalog components with a fourth import —
 * it depends on @remotion/layout-utils (fitText). "Fill the frame" is the
 * spec here, so measurement is not a workaround. The engine needs that
 * package before this file is copied back.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fitText } from "@remotion/layout-utils";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const HammerStatementProps = z.object({
  text: z.string().max(90),
  kicker: z.string().max(40).optional(),
  align: z.enum(["left", "center"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type HammerStatementProps = z.infer<typeof HammerStatementProps>;

export function HammerStatement({ props, theme }: { props: HammerStatementProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.4 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const words = props.text.split(" ").filter(Boolean);
  const centered = props.align === "center";
  const boxWidth = width * 0.8;

  // Measure with the same family/weight we render with, then bound the result:
  // a two-word statement would otherwise size to a full-frame billboard.
  const { fontSize } = fitText({
    text: props.text,
    withinWidth: boxWidth * 1.9, // allow ~2 lines' worth of glyphs
    fontFamily: fontStack(theme.typography.display),
    fontWeight: 700,
    validateFontIsLoaded: true,
  });
  const size = Math.max(height * 0.06, Math.min(fontSize, height * 0.16));

  const kickerIn = Math.round(fps * 0.15 * durationMul);
  const wordsStart = props.kicker ? Math.round(fps * 0.45 * durationMul) : kickerIn;
  const wordStagger = Math.min(
    2,
    Math.max(1, Math.floor((durationInFrames * 0.35) / Math.max(1, words.length))),
  );
  const wordDur = Math.round(fps * 0.5 * durationMul);
  const ruleStart = wordsStart + words.length * wordStagger + Math.round(fps * 0.2 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        padding: `0 ${width * 0.1}px`,
        opacity,
        translate: `0 ${interpolate(frame, [durationInFrames - fps * 0.6, durationInFrames], [0, height * 0.01], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.45, 0, 0.55, 1),
        })}px`,
      }}
    >
      {props.kicker ? (
        <div
          style={{
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.026,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: accent,
            marginBottom: height * 0.028,
            opacity: interpolate(frame, [kickerIn, kickerIn + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.kicker}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: centered ? "center" : "flex-start",
          columnGap: size * 0.26,
          maxWidth: boxWidth,
        }}
      >
        {words.map((word, i) => (
          // Each word masks up out of its own overflow-hidden slot.
          <span key={i} style={{ overflow: "hidden", display: "block", paddingBottom: size * 0.06 }}>
            <span
              style={{
                display: "block",
                fontFamily: fontStack(theme.typography.display),
                fontWeight: 700,
                fontSize: size,
                lineHeight: 1.05,
                color: theme.colors.text,
                overflowWrap: "anywhere",
                translate: `0 ${interpolate(
                  frame,
                  [wordsStart + i * wordStagger, wordsStart + i * wordStagger + wordDur],
                  [110, 0],
                  {
                    extrapolateLeft: "clamp",
                    extrapolateRight: "clamp",
                    easing: Easing.bezier(0.16, 1, 0.3, 1),
                  },
                )}%`,
              }}
            >
              {word}
            </span>
          </span>
        ))}
      </div>

      <div
        style={{
          marginTop: height * 0.035,
          width: boxWidth,
          height: Math.max(3, height * 0.008),
          background: accent,
          scale: `${interpolate(frame, [ruleStart, ruleStart + Math.round(fps * 0.3 * durationMul)], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })} 1`,
          transformOrigin: centered ? "center" : "left center",
        }}
      />
    </div>
  );
}
