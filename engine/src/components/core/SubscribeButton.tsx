/**
 * SubscribeButton — D118, Dark Palace's `cta_widget`: when the narration says
 * "subscribe", a pill with a bell pops in at the top-right on that word and the
 * bell swings. Placed by the compiler (`compiler/cta.py`), never by a planner:
 * the catalog entry is `compiler_only`.
 *
 * Themed, not depictive: it is the CHANNEL asking, so the pill takes the
 * theme's plate, ink and accent rather than YouTube's red. The fill is always
 * opaque — a button that a `fill: none` theme dissolved into the footage would
 * not be a button — so only its corners follow `surface.radius`.
 *
 * Motion is DP's, and fixed rather than a theme entrance: a back-out scale over
 * 0.45 s, then from 0.3 s the bell swings `e^(-2.2u)·sin(20u)·18°`, landing
 * just before the bell cue the compiler pins at +0.35 s.
 */
import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastInk,
  elevationShadow,
  emphasisColor,
  labelFace,
  plateColor,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
} from "../theme.ts";

export const SubscribeButtonProps = z.object({
  label: z.string().max(24),
});
export type SubscribeButtonProps = z.infer<typeof SubscribeButtonProps>;

const POP_S = 0.45;
const SWING_FROM_S = 0.3;
const EXIT_S = 0.25;

/** easeOutBack (c1 = 1.70158): overshoots past 1, then settles — the pop. */
function backOut(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const c1 = 1.7;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

export function bellAngle(t: number): number {
  const u = Math.max(0, t - SWING_FROM_S);
  return Math.exp(-2.2 * u) * Math.sin(u * 20) * 18;
}

export function SubscribeButton({ props, theme }: { props: SubscribeButtonProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const t = frame / fps;

  const fill = plateColor(theme);
  const ink = contrastInk(theme, fill);
  const disc = emphasisColor(theme, "accent");
  const bell = contrastInk(theme, disc);
  const pillH = height * 0.072;
  const discD = height * 0.052;
  const { borderRadius } = surfaceStyle(theme, { radius: 40 });

  const exit = interpolate(frame, [durationInFrames - fps * EXIT_S, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const p = Math.min(1, t / POP_S);

  return (
    <div
      style={{
        position: "absolute",
        top: height * 0.043,
        right: width * 0.029,
        height: pillH,
        display: "flex",
        alignItems: "center",
        gap: height * 0.015,
        padding: `0 ${height * 0.028}px 0 ${(pillH - discD) / 2}px`,
        borderRadius: Math.min(borderRadius * (pillH / 80), pillH / 2),
        backgroundColor: fill,
        boxShadow: elevationShadow(theme, height),
        opacity: (p > 0 ? 1 : 0) * exit,
        scale: `${backOut(p)}`,
        transformOrigin: "80% 50%",
        whiteSpace: "nowrap",
      }}
    >
      <div
        style={{
          width: discD,
          height: discD,
          borderRadius: discD / 2,
          backgroundColor: disc,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          rotate: `${bellAngle(t)}deg`,
          transformOrigin: "50% 14%",
        }}
      >
        <svg width={discD * 0.93} height={discD * 0.93} viewBox="0 0 80 80">
          <path d="M40 18 C29 18 24 27 24 36 L24 48 L19 54 L61 54 L56 48 L56 36 C56 27 51 18 40 18 Z" fill={bell} />
          <circle cx="40" cy="60" r="6" fill={bell} />
        </svg>
      </div>
      <span
        style={{
          fontFamily: labelFace(theme),
          fontSize: height * 0.0296 * typeScale(theme, "body"),
          fontWeight: typeWeight(theme, 800),
          letterSpacing: typeTracking(theme),
          textTransform: typeCase(theme),
          color: ink,
          lineHeight: 1,
        }}
      >
        {props.label}
      </span>
    </div>
  );
}

/** Which optional token blocks this component can actually obey. */
SubscribeButton.honors = ["typography", "surface"];
