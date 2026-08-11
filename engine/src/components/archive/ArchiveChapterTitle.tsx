/**
 * ArchiveChapterTitle — "Archive" pack (archival documentary).
 *
 * The lower third's lockup, inverted and scaled up: the tan kicker bar sits ON
 * TOP of the plate here rather than under it, so a chapter card and a name
 * plate can never be mistaken for each other at a glance even though they are
 * built from the same two parts.
 *
 * The subtitle is separated by a hairline inside the plate instead of a second
 * strip — a third stacked bar turns the card into a stack of labels.
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

export const ArchiveChapterTitleProps = z.object({
  title: z.string().max(56),
  /** Tracked-out line on the tan bar above the plate. */
  kicker: z.string().max(24).optional(),
  /** Date range or place, under a hairline inside the plate. */
  subtitle: z.string().max(48).optional(),
  align: z.enum(["center", "left"]).default("center"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveChapterTitleProps = z.infer<typeof ArchiveChapterTitleProps>;

export function ArchiveChapterTitle({ props, theme }: { props: ArchiveChapterTitleProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  const ground = emphasisColor(theme, props.emphasis);
  const groundInk = contrastInk(theme, ground);

  const centered = props.align === "center";
  const origin = centered ? "center" : "left center";
  const hairline = Math.max(1, Math.round(height * 0.0022));

  const inDur = Math.round(fps * 0.42 * durationMul);
  const wipeDur = Math.round(fps * 0.55 * durationMul);
  const plateAt = Math.round(fps * 0.14 * durationMul);
  const kickerTextAt = Math.round(fps * 0.26 * durationMul);
  const titleAt = Math.round(fps * 0.42 * durationMul);
  const subAt = Math.round(fps * 0.62 * durationMul);

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const barWipe = interpolate(frame, [0, wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const plateWipe = interpolate(frame, [plateAt, plateAt + wipeDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const ruleWipe = interpolate(frame, [subAt - inDur, subAt + inDur], [0, 1], {
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
      {props.kicker ? (
        <div style={{ position: "relative", alignSelf: centered ? "center" : "flex-start" }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundColor: ground,
              transformOrigin: origin,
              scale: `${barWipe} 1`,
            }}
          />
          <div
            style={{
              position: "relative",
              padding: `${height * 0.014}px ${width * 0.024}px`,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.024,
              fontWeight: 600,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              color: groundInk,
              whiteSpace: "nowrap",
              opacity: fadeAt(kickerTextAt),
            }}
          >
            {props.kicker}
          </div>
        </div>
      ) : null}

      <div style={{ position: "relative", maxWidth: width * 0.78 }}>
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: paper,
            transformOrigin: origin,
            scale: `${plateWipe} 1`,
          }}
        />
        <div
          style={{
            position: "relative",
            padding: `${height * 0.05}px ${width * 0.045}px ${height * 0.048}px`,
            textAlign: centered ? "center" : "left",
          }}
        >
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.086,
              fontWeight: 700,
              lineHeight: 1.04,
              letterSpacing: "-0.015em",
              color: ink,
              overflowWrap: "anywhere",
              opacity: fadeAt(titleAt),
            }}
          >
            {props.title}
          </div>

          {props.subtitle ? (
            <>
              <div
                style={{
                  height: hairline,
                  margin: `${height * 0.034}px ${centered ? "auto" : "0"} ${height * 0.028}px`,
                  width: centered ? width * 0.14 : width * 0.1,
                  background: theme.colors.neutral,
                  transformOrigin: origin,
                  scale: `${ruleWipe} 1`,
                }}
              />
              <div
                style={{
                  fontFamily: fontStack(theme.typography.body),
                  fontSize: height * 0.026,
                  fontWeight: 400,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  color: theme.colors.neutral,
                  overflowWrap: "anywhere",
                  opacity: fadeAt(subAt),
                }}
              >
                {props.subtitle}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
