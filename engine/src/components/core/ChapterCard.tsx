/**
 * ChapterCard — a full-screen section break: a ghosted chapter numeral behind,
 * hairlines opening outward from centre, and the title masking up between them.
 *
 * Distinct from the existing ChapterTitle (a simple fade at centre or lower
 * third) — this one is the "act break" shot with numeral, rules and subtitle.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Entrance, Theme } from "../theme.ts";
import { easingCurve, emphasisColor, fontStack, motionScale, useEntrance } from "../theme.ts";

export const ChapterCardProps = z.object({
  chapter_label: z.string().max(24).optional(),
  chapter_number: z.number().int().min(1).max(99).optional(),
  title: z.string().max(60),
  subtitle: z.string().max(40).optional(),
  rule: z.enum(["over", "under", "both", "none"]).default("both"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ChapterCardProps = z.infer<typeof ChapterCardProps>;

/** The title masks up between the rules by default. */
const SUPPORTED: readonly Entrance[] = ["fade", "rise", "pop", "wipe", "typewriter"];

export function ChapterCard({ props, theme }: { props: ChapterCardProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);
  const curve = Easing.bezier(...easingCurve(theme));

  const { opacity, kind } = useEntrance(theme, {
    component: "ChapterCard",
    supported: SUPPORTED,
    fallback: "wipe", // the pre-D46 mask-up
    seconds: 0.5,
  });
  const inDur = Math.round(fps * 0.5 * durationMul);

  const ruleDur = Math.round(fps * 0.5 * durationMul);
  const outStart = durationInFrames - Math.round(fps * 0.5 * durationMul);
  // Rules expand from centre, hold, then retract.
  const ruleWidth = Math.min(
    interpolate(frame, [0, ruleDur], [0, width * 0.6], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: curve,
    }),
    interpolate(frame, [outStart, durationInFrames], [width * 0.6, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.45, 0, 0.55, 1),
    }),
  );

  const titleStart = Math.round(fps * 0.3 * durationMul);
  const size = Math.max(
    height * 0.055,
    Math.min(height * 0.1, (width * 0.72) / Math.max(1, props.title.length * 0.52)),
  );
  const showOver = props.rule === "over" || props.rule === "both";
  const showUnder = props.rule === "under" || props.rule === "both";

  // The title enters AFTER the rules open, so a typewriter has to run on the
  // title's own clock — the hook's `typed` starts at frame 0 and would be
  // finished before the title appeared.
  const title =
    kind === "typewriter"
      ? props.title.slice(
          0,
          Math.ceil(
            interpolate(frame, [titleStart, titleStart + fps * 0.9 * durationMul], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            }) * props.title.length,
          ),
        )
      : props.title;

  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {/* Ghost numeral drifting behind everything for the whole shot. */}
      {props.chapter_number !== undefined ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.5,
            fontWeight: 700,
            lineHeight: 1,
            color: theme.colors.text,
            opacity: 0.12,
            scale: `${interpolate(frame, [0, durationInFrames], [1.06, 1.0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            })}`,
          }}
        >
          {props.chapter_number}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: height * 0.03,
          padding: `0 ${width * 0.1}px`,
        }}
      >
        {props.chapter_label ? (
          <div
            style={{
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.026,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: accent,
              opacity: interpolate(frame, [0, inDur], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {props.chapter_label}
          </div>
        ) : null}

        {showOver ? <div style={{ width: ruleWidth, height: Math.max(1, height * 0.002), background: `${theme.colors.text}66` }} /> : null}

        <div style={{ overflow: kind === "wipe" ? "hidden" : undefined, paddingBottom: size * 0.08 }}>
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: size,
              fontWeight: 700,
              lineHeight: 1.12,
              textAlign: "center",
              overflowWrap: "anywhere",
              maxWidth: width * 0.8,
              color: theme.colors.text,
              translate:
                kind === "wipe"
                  ? `0 ${interpolate(frame, [titleStart, titleStart + fps * 0.55 * durationMul], [110, 0], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: curve,
                    })}%`
                  : kind === "rise"
                    ? `0 ${interpolate(frame, [titleStart, titleStart + fps * 0.55 * durationMul], [height * 0.04, 0], {
                        extrapolateLeft: "clamp",
                        extrapolateRight: "clamp",
                        easing: curve,
                      })}px`
                    : "0 0",
              scale:
                kind === "pop"
                  ? `${interpolate(frame, [titleStart, titleStart + fps * 0.55 * durationMul], [0.86, 1], {
                      extrapolateLeft: "clamp",
                      extrapolateRight: "clamp",
                      easing: curve,
                    })}`
                  : "1",
            }}
          >
            {title}
          </div>
        </div>

        {showUnder ? <div style={{ width: ruleWidth, height: Math.max(1, height * 0.002), background: `${theme.colors.text}66` }} /> : null}

        {props.subtitle ? (
          <div
            style={{
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.03,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: theme.colors.neutral,
              opacity: interpolate(frame, [titleStart + fps * 0.4, titleStart + fps * 0.9], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {props.subtitle}
          </div>
        ) : null}
      </div>
    </div>
  );
}
