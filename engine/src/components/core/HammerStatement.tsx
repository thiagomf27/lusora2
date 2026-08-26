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
import type { Entrance, Theme } from "../theme.ts";
import {
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const HammerStatementProps = z.object({
  text: z.string().max(90),
  kicker: z.string().max(40).optional(),
  align: z.enum(["left", "center"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type HammerStatementProps = z.infer<typeof HammerStatementProps>;

/** The words mask up by default; `slide` would fight the per-word stagger. */
const SUPPORTED: readonly Entrance[] = ["fade", "rise", "pop", "wipe", "typewriter"];

export function HammerStatement({ props, theme }: { props: HammerStatementProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 12, legible: true });
  const accent = emphasisColor(theme, props.emphasis);
  const curve = Easing.bezier(...easingCurve(theme));

  const { opacity, kind } = useEntrance(theme, {
    component: "HammerStatement",
    supported: SUPPORTED,
    fallback: "wipe", // the pre-D46 mask-up
    seconds: 0.4,
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
    fontWeight: typeWeight(theme, 700),
    validateFontIsLoaded: true,
  });
  // The fitted size is a ratio of the frame, so the scale token multiplies
  // the whole fit rather than only its floor.
  // 0.13, not 0.16: at three lines the old ceiling ran the statement edge to
  // edge and turned an overlay into a title card. This is still the largest
  // type in the catalogue — a hammer has to be the loudest thing on screen —
  // but it now leaves the frame it is set over visible around it.
  const size = Math.max(height * 0.06, Math.min(fontSize, height * 0.13)) * typeScale(theme, "title");

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
        padding: `0 ${width * 0.1 * density}px`,
        opacity,
        translate: `0 ${interpolate(frame, [durationInFrames - fps * 0.6, durationInFrames], [0, height * 0.01], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.bezier(0.45, 0, 0.55, 1),
        })}px`,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: centered ? "center" : "flex-start",
          ...(ground ? { ...ground, padding: `${height * 0.045 * density}px ${width * 0.04 * density}px` } : {}),
        }}
      >
      {props.kicker ? (
        <div
          style={{
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.026 * typeScale(theme, "kicker"),
            letterSpacing: typeTracking(theme, 0.22),
            textTransform: typeCase(theme, "uppercase"),
            color: accent,
            marginBottom: height * 0.028 * density,
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
        {words.map((word, i) => {
          const enter = interpolate(
            frame,
            [wordsStart + i * wordStagger, wordsStart + i * wordStagger + wordDur],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: curve },
          );
          return (
            // Under `wipe` each word masks up out of its own overflow-hidden
            // slot — the pre-D46 look. Other kinds move the word itself.
            <span
              key={i}
              style={{
                overflow: kind === "wipe" ? "hidden" : undefined,
                display: "block",
                paddingBottom: size * 0.06,
              }}
            >
              <span
                style={{
                  display: "block",
                  fontFamily: fontStack(theme.typography.display),
                  fontWeight: typeWeight(theme, 700),
                  fontSize: size,
                  lineHeight: 1.05,
                  color: theme.colors.text,
                  overflowWrap: "anywhere",
                  translate:
                    kind === "wipe"
                      ? `0 ${interpolate(enter, [0, 1], [110, 0])}%`
                      : kind === "rise"
                        ? `0 ${interpolate(enter, [0, 1], [height * 0.04, 0])}px`
                        : "0 0",
                  scale: kind === "pop" ? `${interpolate(enter, [0, 1], [0.86, 1])}` : "1",
                  opacity: kind === "wipe" ? 1 : kind === "typewriter" ? Math.round(enter) : enter,
                }}
              >
                {word}
              </span>
            </span>
          );
        })}
      </div>

      {/* The bar that slams in under the statement is this component's accent
          rule, so `accent_rule: "none"` takes it away — the same ornament the
          counter's underline and the lower third's stripe already answer to. */}
      {surfaceStyle(theme, { accentRule: "top" }).accentRule === "none" ? null : (
        <div
          style={{
            marginTop: height * 0.035 * density,
            width: boxWidth,
            height: ruleWidth(theme, Math.max(3, height * 0.008)),
            background: accent,
            scale: `${interpolate(frame, [ruleStart, ruleStart + Math.round(fps * 0.3 * durationMul)], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })} 1`,
            transformOrigin: centered ? "center" : "left center",
          }}
        />
      )}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
HammerStatement.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
