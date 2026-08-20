/**
 * DocumentCard — an order, telegram or note reproduced as paper, with lines
 * typing on and a classification stamp slamming down.
 *
 * Grain here is CLIPPED TO THE PAPER (overflow: hidden on the plate). These
 * render over live footage in the engine; a full-frame grain layer would
 * texture the underlying video instead of just the document.
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
  motionScale,
  paperStock,
  ruleWidth,
  surfaceStyle,
  textureLayer,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const DocumentCardProps = z.object({
  title: z.string().max(40).optional(),
  lines: z.array(z.string().max(90)).min(1).max(6),
  stamp: z.string().max(16).optional(),
  signature: z.string().max(32).optional(),
  variant: z.enum(["typed", "telegram", "handwritten"]).default("typed"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type DocumentCardProps = z.infer<typeof DocumentCardProps>;

export function DocumentCard({ props, theme }: { props: DocumentCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const texture = textureLayer(theme);
  // A directive is dark type on light stock in every channel; which of the
  // theme's two neutrals plays which part is a derivation, not a token.
  const { stock, ink } = paperStock(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "DocumentCard",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.6,
  });
  const { opacity, inDur } = entrance;
  const surface = surfaceStyle(theme, { radius: 3 });

  const stagger = Math.min(
    Math.round(fps * 0.35 * durationMul),
    Math.floor((durationInFrames * 0.55) / Math.max(1, props.lines.length)),
  );
  const linesStart = Math.round(fps * 0.5 * durationMul);
  const stampStart = Math.round(fps * 1.6 * durationMul);

  const telegram = props.variant === "telegram";
  const handwritten = props.variant === "handwritten";
  const grain = theme.grain ?? "none";
  const grainOpacity = grain === "archival" ? 0.14 : grain === "film" ? 0.08 : 0;
  const grainSeed = Math.floor(frame / 2) % 12;

  const plateW = width * 0.62;
  const plateH = height * 0.72;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          position: "relative",
          width: plateW,
          height: plateH,
          overflow: "hidden",
          background: `${stock}f2`,
          borderRadius: surface.borderRadius,
          // The card is the theme's INK, not its page (a document is dark type
          // on light stock whatever the channel's ground is), so the texture
          // rides on top of it rather than replacing it.
          ...(texture ? { backgroundImage: texture.backgroundImage, backgroundSize: texture.backgroundSize, backgroundBlendMode: texture.backgroundBlendMode } : {}),
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          rotate: "-1.2deg",
          scale: `${interpolate(frame, [0, inDur], [1.03, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          })}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: `${height * 0.06 * density}px ${width * 0.045 * density}px`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {props.title ? (
            <div
              style={{
                fontFamily: fontStack(theme.typography.display),
                fontSize: height * 0.042 * typeScale(theme, "title"),
                fontWeight: typeWeight(theme, 700),
                letterSpacing: typeTracking(theme, telegram ? 0.2 : 0.04),
                textTransform: typeCase(theme, telegram ? "uppercase" : "none"),
                color: ink,
                borderBottom: `${ruleWidth(theme, 2)}px solid ${ink}55`,
                paddingBottom: height * 0.016 * density,
                marginBottom: height * 0.028 * density,
                opacity: interpolate(frame, [inDur * 0.5, inDur], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {props.title}
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: height * 0.024 * density }}>
            {props.lines.map((line, i) => {
              const start = linesStart + i * stagger;
              return (
                <div
                  key={i}
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.032 * typeScale(theme, "body"),
                    lineHeight: 1.35,
                    color: ink,
                    fontStyle: handwritten ? "italic" : "normal",
                    letterSpacing: typeTracking(theme, telegram ? 0.14 : 0.01),
                    textTransform: typeCase(theme, telegram ? "uppercase" : "none"),
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2,
                    overflow: "hidden",
                    // Each line types on left-to-right.
                    clipPath: `inset(0 ${interpolate(frame, [start, start + fps * 0.45 * durationMul], [100, 0], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: Easing.bezier(0.45, 0, 0.55, 1),
                    })}% 0 0)`,
                  }}
                >
                  {line}
                </div>
              );
            })}
          </div>

          {props.signature ? (
            <div
              style={{
                marginTop: "auto",
                alignSelf: "flex-end",
                textAlign: "right",
                fontFamily: fontStack(theme.typography.display),
                fontSize: height * 0.026 * typeScale(theme, "caption"),
                fontStyle: "italic",
                color: `${ink}cc`,
                borderTop: `${ruleWidth(theme, 1)}px solid ${ink}44`,
                paddingTop: height * 0.012 * density,
                opacity: interpolate(
                  frame,
                  [linesStart + props.lines.length * stagger, linesStart + props.lines.length * stagger + fps * 0.5],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
                ),
              }}
            >
              {props.signature}
            </div>
          ) : null}
        </div>

        {/* Stamp slams down, over-rotated then settling. */}
        {props.stamp ? (
          <div
            style={{
              position: "absolute",
              right: width * 0.05 * density,
              top: height * 0.1 * density,
              padding: `${height * 0.012 * density}px ${width * 0.018 * density}px`,
              border: `${ruleWidth(theme, Math.max(3, height * 0.006))}px solid ${accent}`,
              borderRadius: surfaceStyle(theme, { radius: 4 }).borderRadius,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.04 * typeScale(theme, "kicker"),
              fontWeight: typeWeight(theme, 700),
              letterSpacing: typeTracking(theme, 0.16),
              textTransform: typeCase(theme, "uppercase"),
              color: accent,
              opacity: interpolate(frame, [stampStart, stampStart + 4], [0, 0.75], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              rotate: `${interpolate(frame, [stampStart, stampStart + 8], [-14, -9], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              })}deg`,
              scale: `${interpolate(frame, [stampStart, stampStart + 8], [1.6, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: Easing.bezier(0.34, 1.56, 0.64, 1),
              })}`,
            }}
          >
            {props.stamp}
          </div>
        ) : null}

        {/* Paper grain, clipped inside the plate. */}
        {grainOpacity > 0 ? (
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "multiply", opacity: grainOpacity, pointerEvents: "none" }}>
            <svg width={plateW} height={plateH}>
              <filter id="document-card-grain">
                <feTurbulence type="fractalNoise" baseFrequency={0.8} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect width={plateW} height={plateH} filter="url(#document-card-grain)" />
            </svg>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
DocumentCard.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
