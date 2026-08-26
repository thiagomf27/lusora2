/**
 * QuoteBlock — a spoken line with attribution and context.
 *
 * The quote reveals top-to-bottom with a clipPath wipe rather than per-line:
 * a true per-line reveal needs text measurement, and the wipe gets ~90% of the
 * effect with no extra dependency. Distinct from the existing QuoteCard, which
 * is a plain fade with a left rule.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  borderSides,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  ruleWidth,
  surfaceStyle,
  TEXT_ENTRANCES,
  typeCase,
  typeScale,
  typeTracking,
  useEntrance,
} from "../theme.ts";

export const QuoteBlockProps = z.object({
  quote: z.string().max(180),
  attribution: z.string().max(40).optional(),
  context: z.string().max(48).optional(),
  variant: z.enum(["mark", "rule", "boxed"]).default("mark"),
  /** Was ArchiveQuoteCard's. How much of the frame the quote is allowed to take —
   *  a decision about the LINE, not about the channel, so it stays a prop. */
  size: z.enum(["standard", "large"]).default("standard"),
  align: z.enum(["left", "center"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type QuoteBlockProps = z.infer<typeof QuoteBlockProps>;

export function QuoteBlock({ props, theme }: { props: QuoteBlockProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "QuoteBlock",
    supported: TEXT_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;
  const surface = surfaceStyle(theme, { radius: 10, alpha: "d9" });
  // `variant` decides the CHROME — a quote mark, a rule, a box. Legibility is
  // not one of the three: a `mark` quote on a paper theme still needs stock
  // under it, so the ground is resolved with this variant's own alpha and
  // `legible`, and a variant that never had a panel passes "00".
  const ground = groundStyle(theme, {
    radius: 10,
    alpha: props.variant === "boxed" ? "d9" : "00",
    legible: true,
  });

  const centered = props.align === "center";
  // `size` was ArchiveQuoteCard's: how much of the frame this quote is allowed
  // to claim. It scales the whole fit, and the type scale multiplies on top —
  // a `large` quote on a `compact` theme is still the bigger of the two quotes.
  const sizeMul = props.size === "large" ? 1.32 : 1;
  const size =
    Math.max(
      height * 0.04,
      Math.min(height * 0.075, (width * 1.55) / Math.max(1, props.quote.length * 0.52)),
    ) *
    sizeMul *
    typeScale(theme, "title");
  const attrStart = Math.round(fps * 0.9 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        padding: `0 ${width * 0.11 * density}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: width * 0.74,
          ...(ground ?? {}),
          ...borderSides(
            props.variant === "boxed"
              ? { width: 1, color: `${accent}55` }
              : props.variant === "rule"
                ? { side: "left", ruleWidth: ruleWidth(theme, Math.max(4, width * 0.004)), ruleColor: accent }
                : {}
          ),
          padding:
            props.variant === "boxed"
              ? `${height * 0.04}px ${width * 0.03}px`
              : props.variant === "rule"
                ? `0 0 0 ${width * 0.026}px`
                : 0,
        }}
      >
        {/* Oversized opening mark, ghosted behind the text. */}
        {props.variant === "mark" ? (
          <div
            style={{
              position: "absolute",
              left: -width * 0.045,
              top: -height * 0.075,
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.28 * typeScale(theme, "number"),
              lineHeight: 1,
              color: accent,
              opacity: 0.16,
              scale: `${interpolate(frame, [0, inDur * 1.4], [0.85, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: curve,
              })}`,
              transformOrigin: "left top",
            }}
          >
            “
          </div>
        ) : null}

        <div
          style={{
            position: "relative",
            fontFamily: fontStack(theme.typography.display),
            fontSize: size,
            lineHeight: 1.3,
            fontStyle: "italic",
            color: theme.colors.text,
            overflowWrap: "anywhere",
            textAlign: centered ? "center" : "left",
            clipPath: `inset(0 0 ${interpolate(frame, [0, fps * 0.7 * durationMul], [100, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })}% 0)`,
          }}
        >
          “{props.quote}”
        </div>
      </div>

      {props.attribution ? (
        <div
          style={{
            marginTop: height * 0.03 * density,
            marginLeft: centered ? 0 : width * 0.026,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.028 * typeScale(theme, "body"),
            letterSpacing: typeTracking(theme, 0.12),
            textTransform: typeCase(theme, "uppercase"),
            color: accent,
            opacity: interpolate(frame, [attrStart, attrStart + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: `${interpolate(frame, [attrStart, attrStart + fps * 0.4], [-width * 0.01, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })}px 0`,
          }}
        >
          — {props.attribution}
        </div>
      ) : null}

      {props.context ? (
        <div
          style={{
            marginTop: height * 0.01 * density,
            marginLeft: centered ? 0 : width * 0.026,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.024 * typeScale(theme, "caption"),
            fontStyle: "italic",
            color: mutedInk(theme),
            opacity: interpolate(frame, [attrStart + 8, attrStart + 8 + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.context}
        </div>
      ) : null}
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
QuoteBlock.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
