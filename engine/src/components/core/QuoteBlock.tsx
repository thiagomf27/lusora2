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
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const QuoteBlockProps = z.object({
  quote: z.string().max(180),
  attribution: z.string().max(40).optional(),
  context: z.string().max(48).optional(),
  variant: z.enum(["mark", "rule", "boxed"]).default("mark"),
  align: z.enum(["left", "center"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type QuoteBlockProps = z.infer<typeof QuoteBlockProps>;

export function QuoteBlock({ props, theme }: { props: QuoteBlockProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.4 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const centered = props.align === "center";
  const size = Math.max(
    height * 0.04,
    Math.min(height * 0.075, (width * 1.55) / Math.max(1, props.quote.length * 0.52)),
  );
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
        padding: `0 ${width * 0.11}px`,
        opacity,
      }}
    >
      <div
        style={{
          position: "relative",
          maxWidth: width * 0.74,
          background: props.variant === "boxed" ? `${theme.colors.bg}d9` : "transparent",
          border: props.variant === "boxed" ? `1px solid ${accent}55` : "none",
          borderRadius: props.variant === "boxed" ? 10 : 0,
          borderLeft: props.variant === "rule" ? `${Math.max(4, width * 0.004)}px solid ${accent}` : undefined,
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
              fontSize: height * 0.28,
              lineHeight: 1,
              color: accent,
              opacity: 0.16,
              scale: `${interpolate(frame, [0, inDur * 1.4], [0.85, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.16, 1, 0.3, 1),
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
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}% 0)`,
          }}
        >
          “{props.quote}”
        </div>
      </div>

      {props.attribution ? (
        <div
          style={{
            marginTop: height * 0.03,
            marginLeft: centered ? 0 : width * 0.026,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.028,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: accent,
            opacity: interpolate(frame, [attrStart, attrStart + fps * 0.4], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: `${interpolate(frame, [attrStart, attrStart + fps * 0.4], [-width * 0.01, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })}px 0`,
          }}
        >
          — {props.attribution}
        </div>
      ) : null}

      {props.context ? (
        <div
          style={{
            marginTop: height * 0.01,
            marginLeft: centered ? 0 : width * 0.026,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.024,
            fontStyle: "italic",
            color: theme.colors.neutral,
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
