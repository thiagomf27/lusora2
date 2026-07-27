/**
 * FactCard — a side panel carrying one headline claim, a short body and a
 * source line. The workhorse card of the catalog.
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
  surfaceStyle,
  useEntrance,
} from "../theme.ts";

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

  const center = props.position === "center";
  const fromLeft = props.position === "left";
  const slideFrom = center ? 0 : fromLeft ? -width * 0.06 : width * 0.06;
  const outStart = durationInFrames - Math.round(fps * 0.5 * durationMul);

  const surface = surfaceStyle(theme, { radius: 12, alpha: "e6", accentRule: "top" });
  const entrance = useEntrance(theme, {
    component: "FactCard",
    supported: PANEL_ENTRANCES,
    fallback: "slide", // the pre-D46 horizontal slide, direction from `position`
    slide: slideFrom,
  });
  const { opacity, inDur } = entrance;

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
          background: surface.background,
          borderRadius: surface.borderRadius,
          borderLeft:
            surface.accentRule === "left"
              ? `${Math.max(3, height * 0.006)}px solid ${accent}`
              : undefined,
          padding: `${height * 0.04}px ${width * 0.028}px`,
          scale: `${entrance.scale}`,
          clipPath: entrance.clipPath,
          // The entrance transform, plus the exit drop this card has always had.
          translate: `${entrance.translateX}px ${
            entrance.translateY +
            interpolate(frame, [outStart, durationInFrames], [0, height * 0.012], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            })
          }px`,
        }}
      >
        {/* Accent rule draws across the top of the card, unless the theme moved it. */}
        {surface.accentRule === "top" ? (
          <div
            style={{
              height: Math.max(3, height * 0.006),
              background: accent,
              borderRadius: 2,
              marginBottom: height * 0.028,
              scale: `${interpolate(frame, [inDur * 0.4, inDur * 0.4 + fps * 0.5 * durationMul], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(...easingCurve(theme)),
              })} 1`,
              transformOrigin: "left center",
            }}
          />
        ) : null}
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
