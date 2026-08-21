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
  chartStyle,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
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
  /** A second line under the label. Was ArchiveCounter's — the same slot, unnamed. */
  caption: z.string().max(64).optional(),
  position: z.enum(["center", "left", "right"]).default("center"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type AnimatedCounterProps = z.infer<typeof AnimatedCounterProps>;

export function AnimatedCounter({ props, theme }: { props: AnimatedCounterProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const chart = chartStyle(theme);
  const ground = groundStyle(theme, { radius: 12, legible: true });
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
  // `decimals` is an AUTHORED prop and outranks the theme: a figure the script
  // asked for to two places is a fact about the claim, not a look. The theme's
  // `chart.number_format` only gets to speak when the author said nothing.
  const shown =
    props.decimals === 0
      ? chart.formatNumber(props.value * progress)
      : (props.value * progress).toLocaleString("en-US", {
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
        padding: `0 ${width * 0.1 * density}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: align,
          ...(ground ? { ...ground, padding: `${height * 0.04 * density}px ${width * 0.045 * density}px` } : {}),
        }}
      >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: width * 0.008 * density,
          fontFamily: fontStack(theme.typography.body),
          fontVariantNumeric: "tabular-nums",
          color: accent,
        }}
      >
        {props.prefix ? <span style={{ fontSize: height * 0.06 * typeScale(theme, "kicker"), fontWeight: typeWeight(theme, 600) }}>{props.prefix}</span> : null}
        <span style={{ fontSize: height * 0.16 * typeScale(theme, "number"), fontWeight: typeWeight(theme, 700), lineHeight: 1 }}>
          {props.approximate && progress >= 1 ? "~" : ""}
          {shown}
        </span>
        {props.suffix ? <span style={{ fontSize: height * 0.06 * typeScale(theme, "kicker"), fontWeight: typeWeight(theme, 600) }}>{props.suffix}</span> : null}
      </div>

      {/* theme-and-style.md is explicit that `accent_rule: "none"` takes the
          underline out of a big number, not only the bar off a card's edge:
          they are the same ornament in a different place, and a theme asking
          for a figure on the page does not want a stripe under it. */}
      {surfaceStyle(theme, { accentRule: "top" }).accentRule === "none" ? null : (
        <div
          style={{
            marginTop: height * 0.02 * density,
            width: width * 0.34,
            height: ruleWidth(theme, Math.max(3, height * 0.006)),
            background: accent,
            scale: `${progress} 1`,
            transformOrigin: center ? "center" : alignLeft ? "left center" : "right center",
          }}
        />
      )}

      <div
        style={{
          marginTop: height * 0.026 * density,
          maxWidth: width * 0.5,
          textAlign: center ? "center" : alignLeft ? "left" : "right",
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.034 * typeScale(theme, "caption"),
          letterSpacing: typeTracking(theme, 0.08),
          textTransform: typeCase(theme, "uppercase"),
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

      {/* ArchiveCounter's second line: the qualification a bare label cannot
          carry ("at the 13 September count"). */}
      {props.caption ? (
        <div
          style={{
            marginTop: height * 0.012 * density,
            maxWidth: width * 0.5,
            textAlign: center ? "center" : alignLeft ? "left" : "right",
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.022 * typeScale(theme, "caption"),
            fontStyle: "italic",
            color: mutedInk(theme),
            overflowWrap: "anywhere",
            opacity: interpolate(frame, [labelStart + fps * 0.2, labelStart + fps * 0.65], [0, 0.9], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.caption}
        </div>
      ) : null}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
AnimatedCounter.honors = ["typography", "surface", "chart", "motion.entrance", "motion.easing"];
