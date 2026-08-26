/**
 * NamePlate — identifies a person: name, role, optional lifespan.
 *
 * `side` carries `center` as well as the two edges. A lower third anchored to a
 * corner and one centred under the subject are the same lockup in a different
 * place, and the choice belongs to the shot: a centred portrait wants a centred
 * name, an interview framed left does not.
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
  borderSides,
  captionStyle,
  contrastInk,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  ruleWidth,
  plateColor,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const NamePlateProps = z.object({
  name: z.string().max(36),
  role: z.string().max(56).optional(),
  /** e.g. "1896–1974" */
  lifespan: z.string().max(16).optional(),
  side: z.enum(["left", "right", "center"]).default("left"),
  variant: z.enum(["bar", "boxed", "underline"]).default("bar"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type NamePlateProps = z.infer<typeof NamePlateProps>;

export function NamePlate({ props, theme }: { props: NamePlateProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
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
  const ground = groundStyle(theme, { radius: 6, alpha: "e0", legible: true });
  // The plate this lockup actually got. `surface.fill: none` on a theme whose
  // ink is lighter than its page returns nothing at all, and the role line has
  // to know: asking contrastInk about a plate that was never painted sets the
  // ink against an imaginary background and puts black type on the footage.
  const plate = groundStyle(theme, {
    radius: 6,
    alpha: props.variant === "boxed" ? "e6" : "bf",
    legible: true,
  });

  const centred = props.side === "center";
  const left = props.side !== "right";
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
        bottom: height * 0.15 * density,
        left: centred ? 0 : left ? width * 0.06 : undefined,
        right: centred ? 0 : left ? undefined : width * 0.06,
        display: "flex",
        flexDirection: left ? "row" : "row-reverse",
        alignItems: "stretch",
        justifyContent: centred ? "center" : undefined,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {/* The stripe is this component's accent rule, in the one place a lower
          third can put one — so `accent_rule: "none"` takes it away, exactly as
          it takes the underline out from under a counter's figure. */}
      {props.variant === "bar" && surface.accentRule !== "none" ? (
        <div
          style={{
            width: ruleWidth(theme, Math.max(5, width * 0.005)),
            background: accent,
            borderRadius: surfaceStyle(theme, { radius: 2 }).borderRadius,
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
          // A lower third is the one overlay that ALWAYS sits over footage, so
          // its plate is the difference between a name and a smudge.
          ...(plate ?? {}),
          ...borderSides(
            props.variant === "boxed"
              ? { width: ruleWidth(theme, 1), color: `${accent}66` }
              : props.variant === "underline" && surface.accentRule !== "none"
                ? { side: "bottom", ruleWidth: ruleWidth(theme, Math.max(3, height * 0.006)), ruleColor: accent }
                : {}
          ),
          padding: `${height * 0.018 * density}px ${width * 0.022 * density}px`,
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
            justifyContent: centred ? "center" : undefined,
            gap: width * 0.012 * density,
            opacity: interpolate(frame, [wipeStart, wipeStart + fps * 0.35], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.05 * typeScale(theme, "title"),
              fontWeight: typeWeight(theme, 700),
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
                fontSize: height * 0.024 * typeScale(theme, "caption"),
                fontVariantNumeric: "tabular-nums",
                color: mutedInk(theme),
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
              marginTop: height * 0.006 * density,
              // captionStyle() is 1080p-referenced — scale every px it returns.
              fontFamily: cs.fontFamily,
              fontSize: cs.fontSize * scale * typeScale(theme, "caption"),
              // NOT cs.color. captionStyle() resolves type for a caption burned
              // over footage WITH its own background — the `boxed` preset pairs
              // `colors.bg` ink with a `colors.text` plate. Lift the ink out on
              // its own and a dark theme sets near-black on a near-black plate.
              color: plate ? contrastInk(theme, plateColor(theme)) : theme.colors.text,
              textAlign: centred ? "center" : undefined,
              fontStyle: cs.fontStyle,
              letterSpacing: typeTracking(theme, cs.letterSpacing ? parseFloat(cs.letterSpacing) : 0),
              textTransform: typeCase(theme, cs.textTransform === "uppercase" ? "uppercase" : "none"),
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

/** Which optional token blocks this component can actually obey (Part 3). */
NamePlate.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
