/**
 * BulletList — a staggered list of short claims.
 *
 * Reference implementation for every multi-item overlay in the catalog: the
 * stagger is CLAMPED so the last item still lands by ~55% of the shot even at
 * history-dark's durationMul = 1.4. Without the clamp a slow theme leaves the
 * final item entering while the whole block is already fading out.
 *
 * D96 added three things, all props of the same list rather than siblings:
 * `marker: "check"` (a ticked checklist — the tick takes `verdictColors`, not
 * the accent, because a tick means "yes" in every channel), an `image` set on a
 * photo card beside the list, and a `footnote` under it. Under a full-bleed
 * composition the list with a photo sits on the page.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  accentInk,
  PANEL_ENTRANCES,
  contrastInk,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  fullBleed,
  groundStyle,
  motionScale,
  mutedInk,
  pageGround,
  ruleWidth,
  typeScale,
  typeWeight,
  useEntrance,
  verdictColors,
} from "../theme.ts";
import { PhotoCard, VerdictGlyph } from "../parts/PhotoCard.tsx";

export const BulletListProps = z.object({
  title: z.string().max(48).optional(),
  items: z.array(z.string().max(90)).min(2).max(5),
  marker: z.enum(["dot", "rule", "number", "check", "none"]).default("rule"),
  align: z.enum(["left", "center"]).default("left"),
  /** Path to a still or clip under the video dir, set on a card beside the list. */
  image: z.string().max(160).optional(),
  /** A quiet qualifying line under the list: "(rules vary by city)". */
  footnote: z.string().max(90).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type BulletListProps = z.infer<typeof BulletListProps>;

export function BulletList({ props, theme }: { props: BulletListProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 12, legible: true });
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
  // With a photo the list is the right half of a slide, so it is always
  // left-set and narrower; the card takes the left.
  const withPhoto = Boolean(props.image);
  const bleed = withPhoto && fullBleed(theme);
  const listGround = bleed ? null : ground;
  const tick = verdictColors(theme).right;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered || withPhoto ? "center" : "flex-start",
        padding: `0 ${width * 0.1 * density}px`,
        opacity,
      }}
    >
      {bleed ? (
        <div style={{ position: "absolute", inset: 0, ...pageGround(theme) }} />
      ) : null}
      <div
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          gap: width * 0.05 * density,
          ...(withPhoto && listGround ? { ...listGround, padding: `${height * 0.05 * density}px ${width * 0.04 * density}px` } : {}),
        }}
      >
      {withPhoto ? (
        <PhotoCard
          theme={theme}
          image={props.image}
          w={height * 0.52}
          h={height * 0.7}
          frameHeight={height}
          progress={interpolate(frame, [0, inDur * 1.5], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })}
          fixtures={0}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: centered && !withPhoto ? "center" : "flex-start",
          ...(!withPhoto && ground ? { ...ground, padding: `${height * 0.05 * density}px ${width * 0.045 * density}px` } : {}),
        }}
      >
      {props.title ? (
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.055 * typeScale(theme, "title"),
            fontWeight: typeWeight(theme, 700),
            color: theme.colors.text,
            marginBottom: height * 0.045 * density,
            maxWidth: withPhoto ? width * 0.42 : width * 0.8,
            textAlign: centered && !withPhoto ? "center" : "left",
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
          gap: height * 0.028 * density,
          maxWidth: withPhoto ? width * 0.42 : width * 0.78,
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
                alignItems: props.marker === "check" ? "center" : "baseline",
                gap: width * 0.016 * density,
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
                        height: ruleWidth(theme, Math.max(2, height * 0.004)),
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
                  {props.marker === "check" ? (
                    <div
                      style={{
                        width: height * 0.04,
                        height: height * 0.04,
                        borderRadius: "50%",
                        background: tick,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        scale: `${interpolate(frame, [start, start + Math.round(fps * 0.3 * durationMul)], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
                        })}`,
                      }}
                    >
                      <VerdictGlyph verdict="right" size={height * 0.026} color={contrastInk(theme, tick)} />
                    </div>
                  ) : null}
                  {props.marker === "number" ? (
                    <span
                      style={{
                        fontFamily: fontStack(theme.typography.body),
                        fontSize: height * 0.028 * typeScale(theme, "caption"),
                        fontWeight: typeWeight(theme, 700),
                        color: accentInk(theme, accent),
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
                  fontSize: height * 0.038 * typeScale(theme, "body"),
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
      {props.footnote ? (
        <div
          style={{
            marginTop: height * 0.035 * density,
            maxWidth: withPhoto ? width * 0.42 : width * 0.78,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.022 * typeScale(theme, "caption"),
            color: mutedInk(theme),
            opacity: interpolate(
              frame,
              [firstItem + props.items.length * stagger, firstItem + props.items.length * stagger + itemDur],
              [0, 1],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
            ),
          }}
        >
          {props.footnote}
        </div>
      ) : null}
      </div>
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
BulletList.honors = [
  "typography",
  "surface",
  "surface.elevation",
  "layout.composition",
  "motion.entrance",
  "motion.easing",
];
