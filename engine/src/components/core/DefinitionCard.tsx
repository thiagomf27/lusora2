/**
 * DefinitionCard — a dictionary-style gloss for a term the narration just used.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const DefinitionCardProps = z.object({
  term: z.string().max(40),
  pronunciation: z.string().max(32).optional(),
  part_of_speech: z.string().max(16).optional(),
  definition: z.string().max(180),
  origin: z.string().max(60).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type DefinitionCardProps = z.infer<typeof DefinitionCardProps>;

export function DefinitionCard({ props, theme }: { props: DefinitionCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.4 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const ruleStart = Math.round(fps * 0.25 * durationMul);
  const metaStart = ruleStart + 4;
  const defStart = ruleStart + 12;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: `0 ${width * 0.12}px`,
        opacity,
      }}
    >
      <div style={{ overflow: "hidden", paddingBottom: height * 0.008 }}>
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.09,
            fontWeight: 700,
            lineHeight: 1.08,
            color: theme.colors.text,
            overflowWrap: "anywhere",
            translate: `${interpolate(frame, [0, inDur], [-110, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}% 0`,
          }}
        >
          {props.term}
        </div>
      </div>

      <div
        style={{
          width: width * 0.5,
          height: Math.max(3, height * 0.006),
          background: accent,
          marginTop: height * 0.014,
          scale: `${interpolate(frame, [ruleStart, ruleStart + fps * 0.4 * durationMul], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })} 1`,
          transformOrigin: "left center",
        }}
      />

      {props.pronunciation || props.part_of_speech ? (
        <div
          style={{
            marginTop: height * 0.02,
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.014,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.028,
            fontStyle: "italic",
            color: theme.colors.neutral,
            opacity: interpolate(frame, [metaStart, metaStart + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.part_of_speech ? <span>{props.part_of_speech}</span> : null}
          {props.pronunciation ? <span>{props.pronunciation}</span> : null}
        </div>
      ) : null}

      <div
        style={{
          marginTop: height * 0.026,
          maxWidth: width * 0.68,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.036,
          lineHeight: 1.42,
          color: theme.colors.text,
          overflowWrap: "anywhere",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 4,
          overflow: "hidden",
          opacity: interpolate(frame, [defStart, defStart + fps * 0.5], [0, 0.92], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: `0 ${interpolate(frame, [defStart, defStart + fps * 0.5], [height * 0.014, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        {props.definition}
      </div>

      {props.origin ? (
        <div
          style={{
            marginTop: height * 0.024,
            maxWidth: width * 0.62,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.024,
            fontStyle: "italic",
            color: theme.colors.neutral,
            opacity: interpolate(frame, [defStart + 10, defStart + 10 + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.origin}
        </div>
      ) : null}
    </div>
  );
}
