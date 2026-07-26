/**
 * KineticTitle — a title that assembles itself token by token.
 *
 * Three entrances, all driven off one staggered progress per token: "mask"
 * (slides up out of an overflow-hidden slot), "rise" (fade + lift) and
 * "scale" (pop on the overshoot curve). Splitting by "char" keeps spaces as
 * un-animated gaps so word boundaries stay readable.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const KineticTitleProps = z.object({
  text: z.string().max(70),
  unit: z.enum(["word", "char"]).default("word"),
  entrance: z.enum(["rise", "mask", "scale"]).default("mask"),
  align: z.enum(["left", "center"]).default("center"),
  emphasize_last: z.boolean().default(false),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type KineticTitleProps = z.infer<typeof KineticTitleProps>;

export function KineticTitle({ props, theme }: { props: KineticTitleProps; theme: Theme }) {
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
  const tokens = props.unit === "word" ? words : Array.from(props.text);
  // Which token index counts as "the last one" for emphasize_last.
  const lastWordIndex = props.unit === "word" ? words.length - 1 : tokens.length - 1;
  const lastWordStart =
    props.unit === "word" ? lastWordIndex : props.text.length - (words[words.length - 1]?.length ?? 0);

  const stagger = Math.min(
    Math.round(fps * (props.unit === "word" ? 0.14 : 0.05) * durationMul),
    Math.max(1, Math.floor((durationInFrames * 0.5) / Math.max(1, tokens.length))),
  );
  const tokenDur = Math.round(fps * 0.5 * durationMul);
  const centered = props.align === "center";
  const size = Math.max(
    height * 0.05,
    Math.min(height * 0.13, (width * 0.84) / Math.max(1, props.text.length * 0.55)),
  );

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: centered ? "center" : "flex-start",
        padding: `0 ${width * 0.08}px`,
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: centered ? "center" : "flex-start",
          alignItems: "baseline",
          columnGap: props.unit === "word" ? size * 0.26 : 0,
          maxWidth: width * 0.84,
        }}
      >
        {tokens.map((token, i) => {
          const start = i * stagger;
          const enter = interpolate(frame, [start, start + tokenDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing:
              props.entrance === "scale" ? Easing.bezier(0.34, 1.56, 0.64, 1) : Easing.bezier(0.16, 1, 0.3, 1),
          });
          const isEmphasized =
            props.emphasize_last && (props.unit === "word" ? i === lastWordIndex : i >= lastWordStart);
          const color = isEmphasized ? accent : theme.colors.text;

          if (token === " ") {
            return <span key={i} style={{ display: "inline-block", width: size * 0.28 }} />;
          }

          const glyph = (
            <span
              style={{
                display: "block",
                fontFamily: fontStack(theme.typography.display),
                fontWeight: 700,
                fontSize: size,
                lineHeight: 1.1,
                letterSpacing: "0.01em",
                color,
                whiteSpace: "pre",
                translate:
                  props.entrance === "mask"
                    ? `0 ${interpolate(enter, [0, 1], [110, 0])}%`
                    : props.entrance === "rise"
                      ? `0 ${interpolate(enter, [0, 1], [height * 0.03, 0])}px`
                      : "0 0",
                scale: props.entrance === "scale" ? `${interpolate(enter, [0, 1], [0.86, 1])}` : "1",
                opacity: props.entrance === "mask" ? 1 : enter,
              }}
            >
              {token}
            </span>
          );

          return props.entrance === "mask" ? (
            <span key={i} style={{ overflow: "hidden", display: "block", paddingBottom: size * 0.08 }}>
              {glyph}
            </span>
          ) : (
            <span key={i} style={{ display: "block", paddingBottom: size * 0.08 }}>
              {glyph}
            </span>
          );
        })}
      </div>
    </div>
  );
}
