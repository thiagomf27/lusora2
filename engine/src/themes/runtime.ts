/**
 * Theme runtime (D8): token object -> styling inside every component.
 * Components take semantic props only; ALL appearance resolves here.
 * The AI never sees this.
 *
 * Deliberately free of Remotion imports: the platform's ThemePreview and
 * ThemeFields resolve tokens outside a Remotion context. The one piece that
 * needs frames — `useEntrance` — lives next door in ./entrance.ts.
 */
import type { Entrance, Theme } from "@lusora/contracts";

export const DEFAULT_THEME: Theme = {
  name: "default",
  colors: { bg: "#101216", text: "#e8eaf0", accent: "#4a90c8", neutral: "#8a8f9a" },
  typography: { display: "Inter", body: "Inter", caption_preset: "plain" },
  motion_feel: "neutral",
  grain: "none",
};

/** motion_feel -> global duration multiplier + easing feel */
export function motionScale(theme: Theme): { durationMul: number; springDamping: number } {
  switch (theme.motion_feel ?? "neutral") {
    case "slow_heavy":
      return { durationMul: 1.4, springDamping: 200 };
    case "fast_light":
      return { durationMul: 0.7, springDamping: 30 };
    default:
      return { durationMul: 1.0, springDamping: 80 };
  }
}

/**
 * Monotonic [0, inEnd, outStart, end] inputRange for fade in/out.
 * Shrinks the fades when the overlay is shorter than in+out frames —
 * Remotion's interpolate() throws on non-monotonic ranges.
 */
export function fadeInOutRange(
  durationInFrames: number,
  inFrames: number,
  outFrames = inFrames
): [number, number, number, number] {
  const inEnd = Math.max(1, Math.min(inFrames, Math.floor(durationInFrames / 2)));
  const outStart = Math.max(inEnd + 1, durationInFrames - outFrames);
  const end = Math.max(outStart + 1, durationInFrames);
  return [0, inEnd, outStart, end];
}

/** packaged font name -> CSS stack (files-only: system fallbacks) */
export function fontStack(name: string): string {
  const serifs = ["Playfair Display", "Georgia", "Times New Roman", "Merriweather", "Lora"];
  const isSerif = serifs.some((s) => name.toLowerCase().includes(s.toLowerCase().split(" ")[0]));
  return `"${name}", ${isSerif ? "Georgia, 'DejaVu Serif', serif" : "'DejaVu Sans', Helvetica, Arial, sans-serif"}`;
}

export function emphasisColor(theme: Theme, emphasis: "accent" | "neutral" | undefined): string {
  return emphasis === "neutral" ? theme.colors.neutral : theme.colors.accent;
}

// ---------------- D46: surface + motion tokens ----------------
//
// Every resolver below takes the value the component used BEFORE D46 as its
// fallback. A theme with no `surface`/`motion` therefore renders byte-identical
// output, which is what makes converting the 26 core components a lazy,
// component-at-a-time migration instead of a flag day. `themes.test.ts` pins it.

export type AccentRule = "top" | "left" | "none";

/** radius token -> multiplier over the component's own pre-D46 radius. */
const RADIUS_SCALE: Record<NonNullable<NonNullable<Theme["surface"]>["radius"]>, number> = {
  square: 0,
  soft: 1,
  rounded: 2.3,
};

/** fill token -> alpha suffix on theme.colors.bg; `none` drops the panel. */
const FILL_ALPHA: Record<NonNullable<NonNullable<Theme["surface"]>["fill"]>, string | null> = {
  solid: "ff",
  translucent: null, // keep the component's own alpha
  none: "",
};

export interface SurfaceOptions {
  /** The component's pre-D46 `borderRadius`, in px at the 1080p reference. */
  radius?: number;
  /** The component's pre-D46 background alpha suffix, e.g. "e6". */
  alpha?: string;
  /** Where this component has always drawn its accent bar. */
  accentRule?: AccentRule;
}

export interface SurfaceStyle {
  borderRadius: number;
  background: string;
  accentRule: AccentRule;
}

/**
 * Panel shape for one overlay. `radius` scales the component's own value rather
 * than replacing it, so components that legitimately differ (a card at 12px, a
 * lower third at 8px) keep their proportions under `rounded`.
 */
export function surfaceStyle(theme: Theme, opts: SurfaceOptions = {}): SurfaceStyle {
  const { radius = 12, alpha = "e6", accentRule = "top" } = opts;
  const surface = theme.surface ?? {};

  const scale = RADIUS_SCALE[surface.radius ?? "soft"];
  const fillAlpha = FILL_ALPHA[surface.fill ?? "translucent"];

  return {
    borderRadius: Math.round(radius * scale),
    background: fillAlpha === "" ? "transparent" : `${theme.colors.bg}${fillAlpha ?? alpha}`,
    accentRule: surface.accent_rule ?? accentRule,
  };
}

/** easing token -> cubic-bezier control points. `smooth` is the pre-D46 curve. */
const EASING_CURVE: Record<
  NonNullable<NonNullable<Theme["motion"]>["easing"]>,
  [number, number, number, number]
> = {
  smooth: [0.16, 1, 0.3, 1],
  snap: [0.4, 0, 0.2, 1],
  spring: [0.34, 1.56, 0.64, 1], // back-out: overshoots, then settles
  linear: [0, 0, 1, 1],
};

export function easingCurve(theme: Theme): [number, number, number, number] {
  return EASING_CURVE[theme.motion?.easing ?? "smooth"];
}

/**
 * Which entrance this component actually plays.
 *
 * per_component override -> theme default -> the component's own pre-D46
 * entrance. An entrance the component cannot draw degrades to `fade`: a chart
 * has no text to type, and rendering it broken is worse than rendering it plain
 * (theme-and-style.md).
 */
export function entranceFor(
  theme: Theme,
  component: string,
  supported: readonly Entrance[],
  fallback: Entrance
): Entrance {
  const motion = theme.motion ?? {};
  const wanted = motion.per_component?.[component] ?? motion.entrance ?? fallback;
  return supported.includes(wanted) ? wanted : "fade";
}

export type { Entrance };

export interface CaptionStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  background: string;
  padding: string;
  borderRadius: number;
  fontStyle?: "italic" | "normal";
  letterSpacing?: string;
  textTransform?: "none" | "uppercase";
}

/** caption preset -> concrete style (sized against a 1080p reference; callers scale) */
export function captionStyle(theme: Theme, preset: string): CaptionStyle {
  switch (preset) {
    case "serif-lower-third":
      return {
        fontFamily: fontStack(theme.typography.display),
        fontSize: 40,
        color: theme.colors.text,
        background: `${theme.colors.bg}cc`,
        padding: "10px 26px",
        borderRadius: 4,
        fontStyle: "italic",
        letterSpacing: "0.01em",
      };
    case "boxed":
      return {
        fontFamily: fontStack(theme.typography.body),
        fontSize: 38,
        color: theme.colors.bg,
        background: theme.colors.text,
        padding: "8px 20px",
        borderRadius: 2,
        textTransform: "none",
      };
    default: // plain
      return {
        fontFamily: fontStack(theme.typography.body),
        fontSize: 36,
        color: "#ffffff",
        background: "rgba(0,0,0,0.45)",
        padding: "6px 18px",
        borderRadius: 4,
      };
  }
}
