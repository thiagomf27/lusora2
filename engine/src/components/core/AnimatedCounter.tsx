/**
 * AnimatedCounter — one number counting up, with a label and an underline
 * drawing in sync. The general-purpose counter (AnimatedPercentage is the
 * radial 0–100 variant).
 *
 * Numerals use the BODY face with tabular-nums: Playfair's old-style
 * proportional figures make a counting number shuffle sideways.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  useEntrance,
} from "../theme.ts";

export const AnimatedCounterProps = z.object({
  value: z.number(),
  label: z.string().max(56),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(16).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
  /** Prefixes the settled value with "~". */
  approximate: z.boolean().default(false),
  position: z.enum(["center", "left", "right"]).default("center"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type AnimatedCounterProps = z.infer<typeof AnimatedCounterProps>;

export function AnimatedCounter({ props, theme }: { props: AnimatedCounterProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "AnimatedCounter",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const countDur = Math.round(fps * 1.6 * durationMul);
  const progress = interpolate(frame, [0, countDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const shown = (props.value * progress).toLocaleString("en-US", {
    minimumFractionDigits: props.decimals,
    maximumFractionDigits: props.decimals,
  });

  const center = props.position === "center";
  const alignLeft = props.position === "left";
  const align = center ? "center" : alignLeft ? "flex-start" : "flex-end";
  const labelStart = Math.round(fps * 0.5 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: align,
        padding: `0 ${width * 0.1}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: width * 0.008,
          fontFamily: fontStack(theme.typography.body),
          fontVariantNumeric: "tabular-nums",
          color: accent,
        }}
      >
        {props.prefix ? <span style={{ fontSize: height * 0.06, fontWeight: 600 }}>{props.prefix}</span> : null}
        <span style={{ fontSize: height * 0.16, fontWeight: 700, lineHeight: 1 }}>
          {props.approximate && progress >= 1 ? "~" : ""}
          {shown}
        </span>
        {props.suffix ? <span style={{ fontSize: height * 0.06, fontWeight: 600 }}>{props.suffix}</span> : null}
      </div>

      <div
        style={{
          marginTop: height * 0.02,
          width: width * 0.34,
          height: Math.max(3, height * 0.006),
          background: accent,
          scale: `${progress} 1`,
          transformOrigin: center ? "center" : alignLeft ? "left center" : "right center",
        }}
      />

      <div
        style={{
          marginTop: height * 0.026,
          maxWidth: width * 0.5,
          textAlign: center ? "center" : alignLeft ? "left" : "right",
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.034,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: theme.colors.text,
          overflowWrap: "anywhere",
          opacity: interpolate(frame, [labelStart, labelStart + fps * 0.45], [0, 0.9], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
        }}
      >
        {props.label}
      </div>
    </div>
  );
}
