/**
 * BulletList — a staggered list of short claims.
 *
 * Reference implementation for every multi-item overlay in the catalog: the
 * stagger is CLAMPED so the last item still lands by ~55% of the shot even at
 * history-dark's durationMul = 1.4. Without the clamp a slow theme leaves the
 * final item entering while the whole block is already fading out.
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

export const BulletListProps = z.object({
  title: z.string().max(48).optional(),
  items: z.array(z.string().max(90)).min(2).max(5),
  marker: z.enum(["dot", "rule", "number", "none"]).default("rule"),
  align: z.enum(["left", "center"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type BulletListProps = z.infer<typeof BulletListProps>;

export function BulletList({ props, theme }: { props: BulletListProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "BulletList",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    rise: height * 0.02, // the title's pre-D46 lift
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  // Clamp the stagger so the last item always lands by 55% of the shot.
  const stagger = Math.min(
    Math.round(fps * 0.3 * durationMul),
    Math.floor((durationInFrames * 0.55) / Math.max(1, props.items.length)),
  );
  const firstItem = Math.round(fps * 0.45 * durationMul);
  const centered = props.align === "center";
  const itemDur = Math.round(fps * 0.5 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        padding: `0 ${width * 0.1}px`,
        opacity,
      }}
    >
      {props.title ? (
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.055,
            fontWeight: 700,
            color: theme.colors.text,
            marginBottom: height * 0.045,
            maxWidth: width * 0.8,
            textAlign: centered ? "center" : "left",
            // A single unbroken 48-char title is wider than the frame at this
            // size; break it rather than letting it run off the edge.
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
            opacity: interpolate(frame, [0, inDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
            translate: entrance.translate,
            scale: `${entrance.scale}`,
            clipPath: entrance.clipPath,
          }}
        >
          {props.title}
        </div>
      ) : null}

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: height * 0.028,
          maxWidth: width * 0.78,
        }}
      >
        {props.items.map((item, i) => {
          const start = firstItem + i * stagger;
          const enter = interpolate(frame, [start, start + itemDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: width * 0.016,
                justifyContent: centered ? "center" : "flex-start",
                opacity: enter,
                translate: `${interpolate(enter, [0, 1], [-width * 0.014, 0])}px 0`,
              }}
            >
              {props.marker === "none" ? null : (
                <div
                  style={{
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: props.marker === "number" ? "flex-start" : "center",
                    width: props.marker === "rule" ? width * 0.028 : height * 0.04,
                    height: height * 0.04,
                  }}
                >
                  {props.marker === "rule" ? (
                    <div
                      style={{
                        height: Math.max(2, height * 0.004),
                        width: "100%",
                        background: accent,
                        scale: `${interpolate(frame, [start, start + Math.round(fps * 0.3 * durationMul)], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: curve,
                        })} 1`,
                        transformOrigin: "left center",
                      }}
                    />
                  ) : null}
                  {props.marker === "dot" ? (
                    <div
                      style={{
                        width: height * 0.014,
                        height: height * 0.014,
                        borderRadius: "50%",
                        background: accent,
                        scale: `${interpolate(frame, [start, start + Math.round(fps * 0.3 * durationMul)], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
                        })}`,
                      }}
                    />
                  ) : null}
                  {props.marker === "number" ? (
                    <span
                      style={{
                        fontFamily: fontStack(theme.typography.body),
                        fontSize: height * 0.028,
                        fontWeight: 700,
                        color: accent,
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      {i + 1}.
                    </span>
                  ) : null}
                </div>
              )}
              <div
                style={{
                  minWidth: 0,
                  overflowWrap: "anywhere",
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.038,
                  lineHeight: 1.35,
                  color: theme.colors.text,
                  display: "-webkit-box",
                  WebkitBoxOrient: "vertical",
                  WebkitLineClamp: 2,
                  overflow: "hidden",
                }}
              >
                {item}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
