/**
 * StepFlow — a numbered chain of stages with connectors drawing between them.
 *
 * Each connector starts drawing halfway through the previous box's entrance,
 * so the chain reads as one continuous movement rather than a set of pops.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  surfaceStyle,
  typeScale,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const StepFlowProps = z.object({
  title: z.string().max(40).optional(),
  steps: z.array(z.object({ label: z.string().max(28), detail: z.string().max(60).optional() })).min(2).max(5),
  direction: z.enum(["horizontal", "vertical"]).default("horizontal"),
  numbered: z.boolean().default(true),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type StepFlowProps = z.infer<typeof StepFlowProps>;

export function StepFlow({ props, theme }: { props: StepFlowProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "StepFlow",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;
  const surface = surfaceStyle(theme, { radius: 8, alpha: "e6" });
  // Each step box carries type, so it resolves through groundStyle rather
  // than surfaceStyle: `fill: none` on a paper theme would leave dark step
  // labels on the footage with nothing under them.
  const ground = groundStyle(theme, { radius: 8, alpha: "e6", legible: true });
  // The title sits OUTSIDE the boxes, so the lockup needs its own ground —
  // otherwise a paper theme reads three plated steps under an invisible head.
  const titleGround = groundStyle(theme, { radius: 8, legible: true });

  const stagger = Math.min(
    Math.round(fps * 0.4 * durationMul),
    Math.floor((durationInFrames * 0.55) / Math.max(1, props.steps.length)),
  );
  const stepsStart = Math.round(fps * 0.3 * durationMul);
  const boxDur = Math.round(fps * 0.45 * durationMul);
  const horizontal = props.direction === "horizontal";
  const connector = horizontal ? width * 0.035 : height * 0.05;
  const arrowLen = connector;
  // Boxes shrink as steps are added so five of them plus four connectors still
  // fit inside the frame.
  const n = props.steps.length;
  const boxW = horizontal
    ? Math.min(width * 0.17, (width * 0.86 - (n - 1) * connector) / n)
    : width * 0.42;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${width * 0.05 * density}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {props.title ? (
        <div
          style={{
            marginBottom: height * 0.05 * density,
            ...(titleGround
              ? { ...titleGround, padding: `${height * 0.018 * density}px ${width * 0.028 * density}px` }
              : {}),
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.05 * typeScale(theme, "title"),
            fontWeight: typeWeight(theme, 700),
            color: theme.colors.text,
            maxWidth: width * 0.8,
            textAlign: "center",
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
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
          display: "flex",
          flexDirection: horizontal ? "row" : "column",
          alignItems: "stretch",
          justifyContent: "center",
        }}
      >
        {props.steps.map((step, i) => {
          const start = stepsStart + i * stagger;
          const enter = interpolate(frame, [start, start + boxDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          // Connector into this step starts midway through the previous box.
          const connStart = start - boxDur * 0.5;
          const draw = interpolate(frame, [connStart, connStart + fps * 0.35 * durationMul], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.45, 0, 0.55, 1),
          });

          return (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: horizontal ? "row" : "column",
                alignItems: "center",
              }}
            >
              {i > 0 ? (
                <div
                  style={{
                    position: "relative",
                    width: horizontal ? connector : ruleWidth(theme, Math.max(2, width * 0.002)),
                    height: horizontal ? ruleWidth(theme, Math.max(2, height * 0.004)) : connector,
                    flexShrink: 0,
                  }}
                >
                  <svg
                    width={horizontal ? connector : height * 0.02}
                    height={horizontal ? height * 0.02 : connector}
                    style={{
                      position: "absolute",
                      left: horizontal ? 0 : -height * 0.01,
                      top: horizontal ? -height * 0.01 : 0,
                      overflow: "visible",
                    }}
                  >
                    <line
                      x1={horizontal ? 0 : height * 0.01}
                      y1={horizontal ? height * 0.01 : 0}
                      x2={horizontal ? connector : height * 0.01}
                      y2={horizontal ? height * 0.01 : connector}
                      stroke={accent}
                      strokeWidth={ruleWidth(theme, Math.max(2, height * 0.004))}
                      strokeDasharray={arrowLen}
                      strokeDashoffset={arrowLen * (1 - draw)}
                    />
                    <polygon
                      points={
                        horizontal
                          ? `${connector},${height * 0.01} ${connector - height * 0.014},${height * 0.004} ${connector - height * 0.014},${height * 0.016}`
                          : `${height * 0.01},${connector} ${height * 0.003},${connector - height * 0.014} ${height * 0.017},${connector - height * 0.014}`
                      }
                      fill={accent}
                      style={{
                        scale: `${interpolate(draw, [0.7, 1], [0, 1], {
                          extrapolateLeft: "clamp",
                          extrapolateRight: "clamp",
                          easing: Easing.bezier(0.34, 1.56, 0.64, 1),
                        })}`,
                        transformOrigin: horizontal ? `${connector}px ${height * 0.01}px` : `${height * 0.01}px ${connector}px`,
                      }}
                    />
                  </svg>
                </div>
              ) : null}

              <div
                style={{
                  width: boxW,
                  ...(ground ?? {}),
                  border: `${ruleWidth(theme, 1)}px solid ${theme.colors.neutral}66`,
                  padding: `${height * 0.022 * density}px ${width * 0.014 * density}px`,
                  display: "flex",
                  flexDirection: "column",
                  gap: height * 0.008 * density,
                  opacity: enter,
                  scale: `${interpolate(enter, [0, 1], [0.94, 1])}`,
                }}
              >
                {props.numbered ? (
                  <div
                    style={{
                      width: height * 0.042,
                      height: height * 0.042,
                      borderRadius: "50%",
                      background: accent,
                      color: theme.colors.bg,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: fontStack(theme.typography.body),
                      fontSize: height * 0.024 * typeScale(theme, "caption"),
                      fontWeight: typeWeight(theme, 700),
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {i + 1}
                  </div>
                ) : null}
                <div
                  style={{
                    fontFamily: fontStack(theme.typography.display),
                    fontSize: height * 0.032 * typeScale(theme, "body"),
                    fontWeight: typeWeight(theme, 600),
                    lineHeight: 1.2,
                    color: theme.colors.text,
                    overflowWrap: "anywhere",
                    display: "-webkit-box",
                    WebkitBoxOrient: "vertical",
                    WebkitLineClamp: 2,
                    overflow: "hidden",
                  }}
                >
                  {step.label}
                </div>
                {step.detail ? (
                  <div
                    style={{
                      fontFamily: fontStack(theme.typography.body),
                      fontSize: height * 0.022 * typeScale(theme, "kicker"),
                      lineHeight: 1.3,
                      color: mutedInk(theme),
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 3,
                      overflow: "hidden",
                    }}
                  >
                    {step.detail}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
StepFlow.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
