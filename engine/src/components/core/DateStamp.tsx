/**
 * DateStamp — a corner date/place slug for establishing when a shot happens.
 *
 * This is the reference skeleton for the catalog: semantic props only, every
 * size a width/height fraction, all motion from useCurrentFrame() through
 * interpolate() + Easing.bezier (never CSS transitions, never composed easing
 * presets like Easing.inOut(Easing.cubic) — those aren't Studio-editable).
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const DateStampProps = z.object({
  /** Pre-formatted for the language of the video, e.g. "31 January 1943". */
  date: z.string().max(28),
  place: z.string().max(32).optional(),
  position: z.enum(["top_left", "top_right", "bottom_left", "bottom_right"]).default("top_left"),
  variant: z.enum(["stamped", "typed"]).default("stamped"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type DateStampProps = z.infer<typeof DateStampProps>;

export function DateStamp({ props, theme }: { props: DateStampProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.4 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const top = props.position.startsWith("top");
  const left = props.position.endsWith("left");
  const stamped = props.variant === "stamped";
  const ruleDur = Math.round(fps * 0.35 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        top: top ? height * 0.1 : undefined,
        bottom: top ? undefined : height * 0.1,
        left: left ? width * 0.07 : undefined,
        right: left ? undefined : width * 0.07,
        display: "flex",
        flexDirection: "column",
        alignItems: left ? "flex-start" : "flex-end",
        opacity,
        rotate: stamped ? "-2.5deg" : "0deg",
      }}
    >
      {/* Accent hairline wipes out from the corner first. */}
      <div
        style={{
          height: Math.max(2, height * 0.005),
          background: accent,
          marginBottom: height * 0.018,
          width: interpolate(frame, [0, ruleDur], [0, width * 0.12], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          }),
        }}
      />
      <div
        style={{
          fontFamily: fontStack(theme.typography.display),
          fontSize: height * 0.052,
          fontWeight: 700,
          color: theme.colors.text,
          letterSpacing: stamped ? "0.16em" : "0.02em",
          textTransform: stamped ? "uppercase" : "none",
          whiteSpace: "nowrap",
          // "typed" reveals left-to-right; "stamped" just rises into place.
          clipPath: stamped
            ? "inset(0 0 0 0)"
            : `inset(0 ${interpolate(frame, [ruleDur * 0.5, ruleDur * 0.5 + fps * 0.6], [100, 0], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.45, 0, 0.55, 1),
              })}% 0 0)`,
          translate: `0 ${interpolate(frame, [ruleDur * 0.5, ruleDur * 0.5 + fps * 0.45], [height * 0.014, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px`,
        }}
      >
        {props.date}
      </div>
      {props.place ? (
        <div
          style={{
            marginTop: height * 0.008,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.026,
            color: theme.colors.neutral,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            opacity: interpolate(frame, [ruleDur, ruleDur + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.place}
        </div>
      ) : null}
    </div>
  );
}
