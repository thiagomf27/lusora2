/**
 * ArchiveCaption — "Archive" pack (archival documentary).
 *
 * The other half of the pack's reference language: a ruled white box with one
 * line of typewriter mono, for dating and sourcing a piece of footage
 * ("Military parade for Afghan Independence Day, August 1966").
 *
 * It is deliberately NOT the lower third — no display face, no tan ground, no
 * hierarchy. A caption that competes with the name plate stops reading as a
 * note pinned to the film. The optional `label` is the one place a tan tab is
 * allowed, for a reel or archive mark; it is off unless asked for.
 *
 * The box is sized by its text and wipes open from the side it is anchored to,
 * so a centred caption opens from its centre rather than sliding across frame.
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

export const ArchiveCaptionProps = z.object({
  text: z.string().max(96),
  /** Short tan tab ahead of the text — a reel, a fond, a date stamp. */
  label: z.string().max(14).optional(),
  position: z.enum(["bottom_center", "bottom_left", "top_center"]).default("bottom_center"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveCaptionProps = z.infer<typeof ArchiveCaptionProps>;

export function ArchiveCaption({ props, theme }: { props: ArchiveCaptionProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  const ground = emphasisColor(theme, props.emphasis);
  const groundInk = contrastInk(theme, ground);

  const left = props.position === "bottom_left";
  const top = props.position === "top_center";
  const origin = left ? "left center" : "center";

  // Heavier than the chart cards' rule: this box is small and the frame is what
  // makes it read as a slide caption rather than as type over the picture.
  const rule = Math.max(2, Math.round(height * 0.0042));
  const inDur = Math.round(fps * 0.36 * durationMul);
  const wipeDur = Math.round(fps * 0.45 * durationMul);
  // The type waits for the box to be nearly open. A caption is one short line —
  // start it earlier and the first words hang over the footage, unboxed.
  const textAt = Math.round(fps * 0.32 * durationMul);

  const wipe = interpolate(frame, [0, wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  const textIn = interpolate(frame, [textAt, textAt + inDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: top ? height * 0.1 : undefined,
        bottom: top ? undefined : height * 0.12,
        display: "flex",
        justifyContent: left ? "flex-start" : "center",
        padding: `0 ${width * 0.07}px`,
        filter: `drop-shadow(0 ${height * 0.005}px ${height * 0.014}px rgba(0,0,0,0.38))`,
        opacity: interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div style={{ position: "relative", maxWidth: width * 0.72 }}>
        {/* Three layers: paper under the type, rule over it. Both wipe together;
            keeping the rule on top is what lets a `label` tab run flush to the
            box edge and still be framed by it. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: paper,
            transformOrigin: origin,
            scale: `${wipe} 1`,
          }}
        />
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "stretch",
            opacity: textIn,
          }}
        >
          {props.label ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                padding: `${height * 0.014}px ${width * 0.014}px`,
                backgroundColor: ground,
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.021,
                fontWeight: 600,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: groundInk,
                whiteSpace: "nowrap",
              }}
            >
              {props.label}
            </div>
          ) : null}
          <div
            style={{
              padding: `${height * 0.017}px ${width * 0.018}px`,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.027,
              fontWeight: 400,
              lineHeight: 1.3,
              letterSpacing: "0.01em",
              color: ink,
              overflowWrap: "anywhere",
            }}
          >
            {props.text}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            inset: 0,
            // border-box, or the rule sits 2px outside the paper it frames.
            boxSizing: "border-box",
            border: `${rule}px solid ${theme.colors.neutral}`,
            transformOrigin: origin,
            scale: `${wipe} 1`,
          }}
        />
      </div>
    </div>
  );
}
