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

/**
 * packaged font name -> CSS stack (files-only: system fallbacks)
 *
 * The mono branch matters more than it looks: a theme naming a typewriter face
 * that fell through to the sans fallback would set a counting figure in a
 * proportional face, and the digits visibly shuffle sideways on every frame.
 */
export function fontStack(name: string): string {
  const key = name.toLowerCase();
  const family = (list: string[]) => list.some((s) => key.includes(s.toLowerCase().split(" ")[0]));
  if (family(["Courier", "Mono", "Typewriter", "Consolas", "Menlo"])) {
    return `"${name}", 'DejaVu Sans Mono', 'Liberation Mono', monospace`;
  }
  if (family(["Playfair Display", "Georgia", "Times New Roman", "Merriweather", "Lora"])) {
    return `"${name}", Georgia, 'DejaVu Serif', serif`;
  }
  return `"${name}", 'DejaVu Sans', Helvetica, Arial, sans-serif`;
}

export function emphasisColor(theme: Theme, emphasis: "accent" | "neutral" | undefined): string {
  return emphasis === "neutral" ? theme.colors.neutral : theme.colors.accent;
}

/**
 * The flat, OPAQUE colour a component paints under its own type.
 *
 * Deliberately not `surfaceStyle().background`: that resolves a panel floated
 * over the shot, so it honours `fill: "translucent" | "none"`. A plate is the
 * substrate its type is set on — "none" there is not a lighter look, it is
 * unreadable type over moving footage — so this always hands back a solid
 * colour. A paper theme (`bg` light) gets paper; a dark theme gets its ground.
 */
export function surfaceColor(theme: Theme): string {
  return theme.colors.bg;
}

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channel = (i: number) => {
    const c = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2);
}

/**
 * Type colour for text set ON a given ground: whichever of the theme's ink
 * (`text`) and its page (`bg`) reads better against it.
 *
 * A component that paints a band in `accent` and then sets `colors.text` on it
 * is fine exactly as long as the theme's accent is a GROUND colour. Pair the
 * same component with a theme whose accent is a bright mark on a dark page and
 * the label lands at 1.9:1. This picks the readable one instead, so a pack
 * built for a paper theme degrades rather than breaks on a dark one.
 */
export function contrastInk(theme: Theme, background: string): string {
  const bg = luminance(background);
  const ratio = (fg: number) => (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  return ratio(luminance(theme.colors.text)) >= ratio(luminance(theme.colors.bg))
    ? theme.colors.text
    : theme.colors.bg;
}

/**
 * The data ramp: hues for two or three series that have to be told apart.
 *
 * Not `theme.colors.accent` at three opacities, and not a theme token either
 * (OQ-10 keeps the token list closed). A ramp is not a preference: it has to
 * hold contrast against the plate it is drawn on AND against itself for a
 * viewer who cannot separate the hues, which is a property of the three
 * colours together. So the engine owns it, and picks the variant by the
 * luminance of the plate `surfaceColor` just resolved.
 *
 * Light plate: 3.2:1, 6.5:1 and 10.4:1 against #f2efe6, worst adjacent-pair
 * ΔE00 of 22.8 across simulated deuteranopia, protanopia and tritanopia.
 * Dark plate: 9.9:1, 7.4:1 and 3.3:1 against #101216, worst ΔE00 21.1. Both
 * clear the 3:1 that non-text marks need; the oxblood is the floor in each.
 */
const SERIES_ON_LIGHT = ["#b87828", "#3c5870", "#58282c"] as const;
const SERIES_ON_DARK = ["#e8b45c", "#7fa8c8", "#a34c58"] as const;

export function seriesColors(theme: Theme): readonly string[] {
  return luminance(surfaceColor(theme)) > 0.4 ? SERIES_ON_LIGHT : SERIES_ON_DARK;
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

/**
 * A panel border expressed as per-side longhands.
 *
 * React refuses to mix the `border` shorthand with a `borderLeft`-style
 * longhand in one inline style, and it is right to: when a theme change flips
 * `accent_rule`, the longhand goes `undefined` while the shorthand is rewritten,
 * and the browser keeps the stale side. Every component that draws an accent
 * rule on ONE side of an otherwise uniform border hit this — invisible until a
 * screen rendered several components and let you switch themes under them.
 *
 * Only longhands are returned, so nothing collides. `borderStyle` is a
 * shorthand but its own longhands are never set alongside it.
 */
export function borderSides(opts: {
  /** the uniform border; 0 for "no box, just the rule" */
  width?: number;
  color?: string;
  /** the side carrying the accent rule, if any */
  side?: "top" | "left" | "bottom" | "right" | "none" | null;
  ruleWidth?: number;
  ruleColor?: string;
}): {
  borderStyle: "solid";
  borderTopWidth: number; borderTopColor: string;
  borderRightWidth: number; borderRightColor: string;
  borderBottomWidth: number; borderBottomColor: string;
  borderLeftWidth: number; borderLeftColor: string;
} {
  const { width = 0, color = "transparent", side, ruleWidth = width, ruleColor = color } = opts;
  const on = (which: string) =>
    side && side !== "none" && side === which
      ? { w: ruleWidth, c: ruleColor }
      : { w: width, c: color };
  const t = on("top"), r = on("right"), b = on("bottom"), l = on("left");
  return {
    borderStyle: "solid",
    borderTopWidth: t.w, borderTopColor: t.c,
    borderRightWidth: r.w, borderRightColor: r.c,
    borderBottomWidth: b.w, borderBottomColor: b.c,
    borderLeftWidth: l.w, borderLeftColor: l.c,
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
