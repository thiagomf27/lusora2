/**
 * Timeline — dated events strung along a drawing spine.
 *
 * Horizontal timelines alternate labels above and below the spine, which
 * doubles the vertical text budget and is what keeps six events legible at
 * 720p. Nodes pop as the spine reaches them.
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

export const TimelineProps = z.object({
  title: z.string().max(32).optional(),
  events: z.array(z.object({ date: z.string().max(16), label: z.string().max(48) })).min(2).max(6),
  orientation: z.enum(["horizontal", "vertical"]).default("horizontal"),
  highlight_index: z.number().int().min(0).max(5).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type TimelineProps = z.infer<typeof TimelineProps>;

export function Timeline({ props, theme }: { props: TimelineProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "Timeline",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const horizontal = props.orientation === "horizontal";
  const spineDur = Math.round(fps * 0.7 * durationMul);
  const spineProgress = interpolate(frame, [0, spineDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const n = props.events.length;
  // Label slot width. Labels alternate above/below, so same-side neighbours are
  // two node-gaps apart — the slot only has to fit within that, capped so a
  // two-event timeline doesn't get absurdly wide boxes.
  const slot = Math.min(width * 0.2, ((width * 0.72) / Math.max(1, n - 1)) * 1.8);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${width * 0.08}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {props.title ? (
        <div
          style={{
            marginBottom: height * 0.05,
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.05,
            fontWeight: 700,
            color: theme.colors.text,
            maxWidth: width * 0.8,
            textAlign: "center",
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 1,
            overflow: "hidden",
            opacity: interpolate(frame, [0, inDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.title}
        </div>
      ) : null}

      <div
        style={{
          position: "relative",
          width: horizontal ? width * 0.8 : width * 0.6,
          height: horizontal ? height * 0.42 : height * 0.6,
        }}
      >
        {/* Spine */}
        <div
          style={{
            position: "absolute",
            left: horizontal ? 0 : width * 0.06,
            top: horizontal ? "50%" : 0,
            width: horizontal ? "100%" : Math.max(2, width * 0.0022),
            height: horizontal ? Math.max(2, height * 0.004) : "100%",
            background: `${theme.colors.neutral}aa`,
            scale: horizontal ? `${spineProgress} 1` : `1 ${spineProgress}`,
            transformOrigin: horizontal ? "left center" : "top center",
          }}
        />

        {props.events.map((event, i) => {
          // Nodes are inset from the spine's ends so the first and last labels
          // — which are centred on their node — keep clear of the frame edge.
          const t = n === 1 ? 0 : i / (n - 1);
          const at = 0.05 + t * 0.9;
          const nodeStart = at * spineDur;
          const pop = interpolate(frame, [nodeStart, nodeStart + 8], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.34, 1.56, 0.64, 1),
          });
          const textIn = interpolate(frame, [nodeStart + 3, nodeStart + 3 + fps * 0.4 * durationMul], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          const isHighlight = props.highlight_index === i;
          const color = isHighlight ? accent : theme.colors.neutral;
          const above = i % 2 === 0;
          const dot = height * 0.022;

          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: horizontal ? `${at * 100}%` : width * 0.06,
                top: horizontal ? "50%" : `${at * 100}%`,
                translate: horizontal ? "-50% -50%" : "-50% -50%",
                display: "flex",
                flexDirection: horizontal ? "column" : "row",
                alignItems: "center",
              }}
            >
              {/* Text sits above or below (horizontal) / to the right (vertical). */}
              {horizontal && above ? (
                <EventText
                  event={event}
                  theme={theme}
                  color={color}
                  height={height}
                  width={width}
                  opacity={textIn}
                  offset={-height * 0.014 * (1 - textIn) - height * 0.09}
                  align="center"
                  slot={slot}
                />
              ) : null}

              <div style={{ position: "relative", width: dot * 2, height: dot * 2 }}>
                {isHighlight ? (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      border: `${Math.max(2, height * 0.003)}px solid ${accent}`,
                      opacity: 0.55,
                      scale: `${pop}`,
                    }}
                  />
                ) : null}
                <div
                  style={{
                    position: "absolute",
                    left: dot * 0.5,
                    top: dot * 0.5,
                    width: dot,
                    height: dot,
                    borderRadius: "50%",
                    background: color,
                    scale: `${pop}`,
                  }}
                />
              </div>

              {horizontal && !above ? (
                <EventText
                  event={event}
                  theme={theme}
                  color={color}
                  height={height}
                  width={width}
                  opacity={textIn}
                  offset={height * 0.014 * (1 - textIn) + height * 0.09}
                  align="center"
                  slot={slot}
                />
              ) : null}

              {horizontal ? null : (
                <EventText
                  event={event}
                  theme={theme}
                  color={color}
                  height={height}
                  width={width}
                  opacity={textIn}
                  offset={0}
                  align="left"
                  slot={slot}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EventText({
  event,
  theme,
  color,
  height,
  width,
  opacity,
  offset,
  align,
  slot,
}: {
  event: { date: string; label: string };
  theme: Theme;
  color: string;
  height: number;
  width: number;
  opacity: number;
  offset: number;
  align: "center" | "left";
  slot: number;
}) {
  const centered = align === "center";
  return (
    <div
      style={{
        position: centered ? "absolute" : "relative",
        top: centered ? offset : undefined,
        left: centered ? "50%" : undefined,
        translate: centered ? "-50% 0" : `${width * 0.016}px 0`,
        width: centered ? slot : width * 0.34,
        textAlign: align,
        opacity,
      }}
    >
      <div
        style={{
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.028,
          fontWeight: 700,
          fontVariantNumeric: "tabular-nums",
          letterSpacing: "0.06em",
          color,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {event.date}
      </div>
      <div
        style={{
          marginTop: height * 0.006,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.024,
          lineHeight: 1.3,
          color: theme.colors.text,
          overflowWrap: "anywhere",
          display: "-webkit-box",
          WebkitBoxOrient: "vertical",
          WebkitLineClamp: 2,
          overflow: "hidden",
        }}
      >
        {event.label}
      </div>
    </div>
  );
}
