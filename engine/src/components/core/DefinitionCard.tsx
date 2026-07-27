/**
 * DefinitionCard — a dictionary-style gloss for a term the narration just used.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  TEXT_ENTRANCES,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  useEntrance,
} from "../theme.ts";

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

  const curve = Easing.bezier(...easingCurve(theme));
  // The term wipes in sideways out of its own slot — this component's signature.
  const { opacity, kind, progress, typed } = useEntrance(theme, {
    component: "DefinitionCard",
    supported: TEXT_ENTRANCES,
    fallback: "wipe",
    seconds: 0.4,
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
      <div style={{ overflow: kind === "wipe" ? "hidden" : undefined, paddingBottom: height * 0.008 }}>
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.09,
            fontWeight: 700,
            lineHeight: 1.08,
            color: theme.colors.text,
            overflowWrap: "anywhere",
            translate:
              kind === "wipe"
                ? `${interpolate(progress, [0, 1], [-110, 0])}% 0`
                : kind === "slide"
                  ? `${interpolate(progress, [0, 1], [-width * 0.05, 0])}px 0`
                  : kind === "rise"
                    ? `0 ${interpolate(progress, [0, 1], [height * 0.03, 0])}px`
                    : "0 0",
            scale: kind === "pop" ? `${interpolate(progress, [0, 1], [0.88, 1])}` : "1",
          }}
        >
          {typed(props.term)}
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
            easing: curve,
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
            easing: curve,
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
