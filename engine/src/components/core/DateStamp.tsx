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
import {
  PANEL_ENTRANCES,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

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
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 6, legible: true });
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "DateStamp",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

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
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
        rotate: stamped ? "-2.5deg" : "0deg",
        ...(ground
          ? { ...ground, padding: `${height * 0.022 * density}px ${width * 0.026 * density}px` }
          : {}),
      }}
    >
      {/* Accent hairline wipes out from the corner first. */}
      <div
        style={{
          height: ruleWidth(theme, Math.max(2, height * 0.005)),
          background: accent,
          marginBottom: height * 0.018 * density,
          width: interpolate(frame, [0, ruleDur], [0, width * 0.12], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          }),
        }}
      />
      <div
        style={{
          fontFamily: fontStack(theme.typography.display),
          fontSize: height * 0.052 * typeScale(theme, "number"),
          fontWeight: typeWeight(theme, 700),
          color: theme.colors.text,
          letterSpacing: typeTracking(theme, stamped ? 0.16 : 0.02),
          textTransform: typeCase(theme, stamped ? "uppercase" : "none"),
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
            easing: curve,
          })}px`,
        }}
      >
        {props.date}
      </div>
      {props.place ? (
        <div
          style={{
            marginTop: height * 0.008 * density,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.026 * typeScale(theme, "kicker"),
            color: theme.colors.neutral,
            letterSpacing: typeTracking(theme, 0.2),
            textTransform: typeCase(theme, "uppercase"),
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

/** Which optional token blocks this component can actually obey (Part 3). */
DateStamp.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
