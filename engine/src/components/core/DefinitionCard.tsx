/**
 * DefinitionCard — a dictionary-style gloss for a term the narration just used.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  ruleWidth,
  TEXT_ENTRANCES,
  typeScale,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const DefinitionCardProps = z.object({
  term: z.string().max(40),
  pronunciation: z.string().max(32).optional(),
  part_of_speech: z.string().max(16).optional(),
  definition: z.string().max(180),
  origin: z.string().max(60).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type DefinitionCardProps = z.infer<typeof DefinitionCardProps>;

export function DefinitionCard({ props, theme }: { props: DefinitionCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 12, legible: true });
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
        padding: `0 ${width * 0.12 * density}px`,
        opacity,
      }}
    >
      {ground ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.06 * density,
            top: height * 0.18 * density,
            width: width - width * 0.12 * density,
            height: height - height * 0.36 * density,
            ...ground,
          }}
        />
      ) : null}

      <div style={{ position: "relative", overflow: kind === "wipe" ? "hidden" : undefined, paddingBottom: height * 0.008 * density }}>
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.09 * typeScale(theme, "number"),
            fontWeight: typeWeight(theme, 700),
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
          height: ruleWidth(theme, Math.max(3, height * 0.006)),
          background: accent,
          marginTop: height * 0.014 * density,
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
            marginTop: height * 0.02 * density,
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.014 * density,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.028 * typeScale(theme, "caption"),
            fontStyle: "italic",
            color: mutedInk(theme),
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
          marginTop: height * 0.026 * density,
          maxWidth: width * 0.68,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.036 * typeScale(theme, "body"),
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
            marginTop: height * 0.024 * density,
            maxWidth: width * 0.62,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.024 * typeScale(theme, "kicker"),
            fontStyle: "italic",
            color: mutedInk(theme),
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

/** Which optional token blocks this component can actually obey (Part 3). */
DefinitionCard.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
