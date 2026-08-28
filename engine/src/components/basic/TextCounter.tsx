/**
 * TextCounter — one figure counting up, written onto the shot.
 *
 * The core twin is AnimatedCounter, and the relationship is the same one
 * TextName has with NamePlate: AnimatedCounter is a GRAPHIC — a box lockup with
 * a plate, a rule and a ground — while this is the number set on the footage
 * with nothing behind it unless `background` asks. Pick the pack, not the
 * overlay: a channel wants one or the other, never both.
 *
 * Panel entrances only. The figure is already animating, and typing a number on
 * top of a count-up reads as a stutter rather than as two effects — the same
 * call TemplateOverlay makes for `big_number`.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { chartStyle, easingCurve, motionScale, PANEL_ENTRANCES } from "../theme.ts";
import { POSITION, SIZE, TextLockup } from "./TextLockup.tsx";

export const TextCounterProps = z.object({
  value: z.number(),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(24).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
  label: z.string().max(60).optional(),
  position: POSITION.default("center"),
  size: SIZE.default("big"),
  background: z.boolean().optional(),
});
export type TextCounterProps = z.infer<typeof TextCounterProps>;

export function TextCounter({ props, theme }: { props: TextCounterProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const chart = chartStyle(theme, {});

  const countDur = Math.round(fps * 1.6 * durationMul);
  const progress = interpolate(frame, [0, countDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...easingCurve(theme)),
  });

  // `decimals` is an AUTHORED prop and outranks the theme, exactly as in
  // AnimatedCounter: a figure the script asked for to two places is a fact
  // about the claim, not a look. `chart.number_format` speaks only when the
  // author said nothing.
  const v = props.value * progress;
  const figure =
    props.decimals === 0
      ? chart.formatNumber(v)
      : v.toLocaleString("en-US", {
          minimumFractionDigits: props.decimals,
          maximumFractionDigits: props.decimals,
        });

  // A prefix is part of the number ("$7.9"); a suffix is a word after it
  // ("7.9 Trillion") unless it is a sign, which belongs tight ("70%").
  const suffix = props.suffix
    ? `${/^[A-Za-z]/.test(props.suffix) ? " " : ""}${props.suffix}`
    : "";
  const lead = `${props.prefix ?? ""}${figure}${suffix}`;

  return (
    <TextLockup
      component="TextCounter"
      lead={lead}
      sub={props.label}
      position={props.position}
      size={props.size}
      plated={props.background}
      theme={theme}
      seconds={0.5}
      supported={PANEL_ENTRANCES}
      numeric
    />
  );
}
