/**
 * NamePlate — identifies a person: name, role, optional lifespan.
 *
 * The one component that uses captionStyle(). That helper returns absolute px
 * "sized against a 1080p reference; callers scale" — so every size it hands
 * back is multiplied by height / 1080 here. Forgetting that renders the role
 * line ~50% oversized at 720p.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  easingCurve,
  captionStyle,
  emphasisColor,
  fontStack,
  motionScale,
  surfaceStyle,
  useEntrance,
} from "../theme.ts";

export const NamePlateProps = z.object({
  name: z.string().max(36),
  role: z.string().max(56).optional(),
  /** e.g. "1896–1974" */
  lifespan: z.string().max(16).optional(),
  side: z.enum(["left", "right"]).default("left"),
  variant: z.enum(["bar", "boxed", "underline"]).default("bar"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type NamePlateProps = z.infer<typeof NamePlateProps>;

export function NamePlate({ props, theme }: { props: NamePlateProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "NamePlate",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.3,
  });
  const { opacity, inDur } = entrance;
  const surface = surfaceStyle(theme, { radius: 6 });

  const left = props.side === "left";
  const barDur = Math.round(fps * 0.3 * durationMul);
  const wipeStart = barDur * 0.6;
  const wipeDur = Math.round(fps * 0.45 * durationMul);
  const outStart = durationInFrames - Math.round(fps * 0.35 * durationMul);

  // Panel opens from the bar's edge, then closes from the opposite edge.
  const openPct = interpolate(frame, [wipeStart, wipeStart + wipeDur], [100, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const closePct = interpolate(frame, [outStart, durationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  const scale = height / 1080;
  const cs = captionStyle(theme, theme.typography.caption_preset);

  return (
    <div
      style={{
        position: "absolute",
        bottom: height * 0.15,
        left: left ? width * 0.06 : undefined,
        right: left ? undefined : width * 0.06,
        display: "flex",
        flexDirection: left ? "row" : "row-reverse",
        alignItems: "stretch",
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {props.variant === "bar" ? (
        <div
          style={{
            width: Math.max(5, width * 0.005),
            background: accent,
            borderRadius: 2,
            scale: `1 ${interpolate(frame, [0, barDur], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })}`,
            transformOrigin: "bottom center",
          }}
        />
      ) : null}

      <div
        style={{
          background: props.variant === "boxed" ? `${theme.colors.bg}e6` : `${theme.colors.bg}bf`,
          border: props.variant === "boxed" ? `1px solid ${accent}66` : "none",
          borderBottom: props.variant === "underline" ? `${Math.max(3, height * 0.006)}px solid ${accent}` : undefined,
          padding: `${height * 0.018}px ${width * 0.022}px`,
          borderRadius:
            props.variant === "bar"
              ? `0 ${surface.borderRadius}px ${surface.borderRadius}px 0`
              : surface.borderRadius,
          clipPath: left
            ? `inset(0 ${Math.max(openPct, closePct)}% 0 0)`
            : `inset(0 0 0 ${Math.max(openPct, closePct)}%)`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.012,
            opacity: interpolate(frame, [wipeStart, wipeStart + fps * 0.35], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.05,
              fontWeight: 700,
              color: theme.colors.text,
              whiteSpace: "nowrap",
            }}
          >
            {props.name}
          </div>
          {props.lifespan ? (
            <div
              style={{
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.024,
                fontVariantNumeric: "tabular-nums",
                color: theme.colors.neutral,
                whiteSpace: "nowrap",
              }}
            >
              {props.lifespan}
            </div>
          ) : null}
        </div>

        {props.role ? (
          <div
            style={{
              marginTop: height * 0.006,
              // captionStyle() is 1080p-referenced — scale every px it returns.
              fontFamily: cs.fontFamily,
              fontSize: cs.fontSize * scale,
              color: cs.color,
              fontStyle: cs.fontStyle,
              letterSpacing: cs.letterSpacing,
              textTransform: cs.textTransform,
              opacity: interpolate(frame, [wipeStart + fps * 0.1, wipeStart + fps * 0.45], [0, 0.9], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: width * 0.5,
            }}
          >
            {props.role}
          </div>
        ) : null}
      </div>
    </div>
  );
}
