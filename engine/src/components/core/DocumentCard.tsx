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
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";

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
  const accent = emphasisColor(theme, props.emphasis);

  const inDur = Math.round(fps * 0.6 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

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
      }}
    >
      <div
        style={{
          position: "relative",
          width: plateW,
          height: plateH,
          overflow: "hidden",
          background: `${theme.colors.text}f2`,
          borderRadius: 3,
          boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
          rotate: "-1.2deg",
          scale: `${interpolate(frame, [0, inDur], [1.03, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.16, 1, 0.3, 1),
          })}`,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            padding: `${height * 0.06}px ${width * 0.045}px`,
            display: "flex",
            flexDirection: "column",
          }}
        >
          {props.title ? (
            <div
              style={{
                fontFamily: fontStack(theme.typography.display),
                fontSize: height * 0.042,
                fontWeight: 700,
                letterSpacing: telegram ? "0.2em" : "0.04em",
                textTransform: telegram ? "uppercase" : "none",
                color: theme.colors.bg,
                borderBottom: `2px solid ${theme.colors.bg}55`,
                paddingBottom: height * 0.016,
                marginBottom: height * 0.028,
                opacity: interpolate(frame, [inDur * 0.5, inDur], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {props.title}
            </div>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: height * 0.024 }}>
            {props.lines.map((line, i) => {
              const start = linesStart + i * stagger;
              return (
                <div
                  key={i}
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.032,
                    lineHeight: 1.35,
                    color: theme.colors.bg,
                    fontStyle: handwritten ? "italic" : "normal",
                    letterSpacing: telegram ? "0.14em" : "0.01em",
                    textTransform: telegram ? "uppercase" : "none",
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
                fontSize: height * 0.026,
                fontStyle: "italic",
                color: `${theme.colors.bg}cc`,
                borderTop: `1px solid ${theme.colors.bg}44`,
                paddingTop: height * 0.012,
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
              right: width * 0.05,
              top: height * 0.1,
              padding: `${height * 0.012}px ${width * 0.018}px`,
              border: `${Math.max(3, height * 0.006)}px solid ${accent}`,
              borderRadius: 4,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.04,
              fontWeight: 700,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
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
