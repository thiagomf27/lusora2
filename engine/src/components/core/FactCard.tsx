/**
 * FactCard — a side panel carrying one headline claim, a short body and a
 * source line. The workhorse card of the catalog.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

export const FactCardProps = z.object({
  headline: z.string().max(60),
  body: z.string().max(220),
  source: z.string().max(48).optional(),
  position: z.enum(["left", "right", "center"]).default("right"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type FactCardProps = z.infer<typeof FactCardProps>;

export function FactCard({ props, theme }: { props: FactCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.45 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const center = props.position === "center";
  const fromLeft = props.position === "left";
  const slideFrom = center ? 0 : fromLeft ? -width * 0.06 : width * 0.06;
  const outStart = durationInFrames - Math.round(fps * 0.5 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: center ? "center" : fromLeft ? "flex-start" : "flex-end",
        padding: `0 ${width * 0.06}px`,
        opacity,
      }}
    >
      <div
        style={{
          width: center ? width * 0.62 : width * 0.38,
          background: `${theme.colors.bg}e6`,
          borderRadius: 12,
          padding: `${height * 0.04}px ${width * 0.028}px`,
          translate: `${interpolate(frame, [0, inDur], [slideFrom, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}px ${interpolate(frame, [outStart, durationInFrames], [0, height * 0.012], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.45, 0, 0.55, 1),
          })}px`,
        }}
      >
        {/* Accent rule draws across the top of the card. */}
        <div
          style={{
            height: Math.max(3, height * 0.006),
            background: accent,
            borderRadius: 2,
            marginBottom: height * 0.028,
            scale: `${interpolate(frame, [inDur * 0.4, inDur * 0.4 + fps * 0.5 * durationMul], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.16, 1, 0.3, 1),
            })} 1`,
            transformOrigin: "left center",
          }}
        />
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.055,
            fontWeight: 700,
            lineHeight: 1.15,
            color: theme.colors.text,
            overflowWrap: "anywhere",
          }}
        >
          {props.headline}
        </div>
        <div
          style={{
            marginTop: height * 0.024,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.032,
            lineHeight: 1.4,
            color: theme.colors.text,
            overflowWrap: "anywhere",
            opacity: interpolate(frame, [inDur + 5, inDur + 5 + fps * 0.45], [0, 0.88], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 5,
            overflow: "hidden",
          }}
        >
          {props.body}
        </div>
        {props.source ? (
          <div
            style={{
              marginTop: height * 0.026,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.022,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              color: theme.colors.neutral,
              opacity: interpolate(frame, [inDur + 14, inDur + 14 + fps * 0.4], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {props.source}
          </div>
        ) : null}
      </div>
    </div>
  );
}
