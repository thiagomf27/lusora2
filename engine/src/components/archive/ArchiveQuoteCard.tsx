/**
 * ArchiveQuoteCard — "Archive" pack (archival documentary).
 *
 * A testimony plate: the words at display weight 500 on white, the speaker
 * reversed onto a tan strip welded to the bottom-left corner, sized by its own
 * text. Same two parts as every other overlay in the pack, arranged so the eye
 * lands on the sentence first and the name second.
 *
 * 500, not the 700 the name plates use — a heavy grotesque at four lines reads
 * as a headline shouting, not as somebody talking.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastInk,
  emphasisColor,
  fadeInOutRange,
  fontStack,
  motionScale,
  surfaceColor,
} from "../theme.ts";

export const ArchiveQuoteCardProps = z.object({
  quote: z.string().max(180),
  attribution: z.string().max(36).optional(),
  /** Rank, role or date, under a hairline inside the plate. */
  context: z.string().max(56).optional(),
  position: z.enum(["center", "left"]).default("center"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveQuoteCardProps = z.infer<typeof ArchiveQuoteCardProps>;

export function ArchiveQuoteCard({ props, theme }: { props: ArchiveQuoteCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  const ground = emphasisColor(theme, props.emphasis);
  const groundInk = contrastInk(theme, ground);

  const centered = props.position === "center";
  const hairline = Math.max(1, Math.round(height * 0.0022));

  const inDur = Math.round(fps * 0.42 * durationMul);
  const wipeDur = Math.round(fps * 0.55 * durationMul);
  const quoteAt = Math.round(fps * 0.3 * durationMul);
  const contextAt = Math.round(fps * 0.55 * durationMul);
  const stripAt = Math.round(fps * 0.6 * durationMul);
  const nameAt = Math.round(fps * 0.82 * durationMul);

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const plateWipe = interpolate(frame, [0, wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const stripWipe = interpolate(frame, [stripAt, stripAt + wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const fadeAt = (at: number) =>
    interpolate(frame, [at, at + inDur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: centered ? "center" : "flex-start",
        padding: `0 ${width * 0.09}px`,
        filter: `drop-shadow(0 ${height * 0.008}px ${height * 0.022}px rgba(0,0,0,0.42))`,
        opacity: interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {/* Plate and strip share one shrink-to-fit column, so the strip hangs off
          the PLATE's left edge — not the frame's — when the card is centred. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", maxWidth: width * 0.74 }}>
        <div style={{ position: "relative" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: paper,
              transformOrigin: "left center",
              scale: `${plateWipe} 1`,
            }}
          />
          <div
            style={{
              position: "relative",
              padding: `${height * 0.055}px ${width * 0.045}px ${height * 0.05}px`,
            }}
          >
            <div
              style={{
                fontFamily: fontStack(theme.typography.display),
                fontSize: height * 0.055,
                fontWeight: 500,
                lineHeight: 1.24,
                letterSpacing: "-0.005em",
                color: ink,
                overflowWrap: "anywhere",
                opacity: fadeAt(quoteAt),
              }}
            >
              {props.quote}
            </div>

            {props.context ? (
              <>
                <div
                  style={{
                    height: hairline,
                    width: width * 0.09,
                    margin: `${height * 0.036}px 0 ${height * 0.026}px`,
                    background: theme.colors.neutral,
                    transformOrigin: "left center",
                    scale: `${fadeAt(contextAt)} 1`,
                  }}
                />
                <div
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.024,
                    fontWeight: 400,
                    letterSpacing: "0.1em",
                    color: theme.colors.neutral,
                    overflowWrap: "anywhere",
                    opacity: fadeAt(contextAt),
                  }}
                >
                  {props.context}
                </div>
              </>
            ) : null}
          </div>
        </div>

        {props.attribution ? (
          <div style={{ position: "relative", maxWidth: "100%" }}>
            <div
              style={{
                position: "absolute",
                inset: 0,
                backgroundColor: ground,
                transformOrigin: "left center",
                scale: `${stripWipe} 1`,
              }}
            />
            <div
              style={{
                position: "relative",
                padding: `${height * 0.013}px ${width * 0.028}px ${height * 0.014}px`,
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.023,
                fontWeight: 600,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: groundInk,
                overflowWrap: "anywhere",
                opacity: fadeAt(nameAt),
              }}
            >
              {props.attribution}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
