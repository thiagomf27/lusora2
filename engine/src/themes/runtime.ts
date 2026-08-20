/**
 * Theme runtime (D8): token object -> styling inside every component.
 * Components take semantic props only; ALL appearance resolves here.
 * The AI never sees this.
 *
 * Deliberately free of Remotion imports: the platform's ThemePreview and
 * ThemeFields resolve tokens outside a Remotion context. The one piece that
 * needs frames — `useEntrance` — lives next door in ./entrance.ts.
 */
import type { CSSProperties } from "react";
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
  if (family(["Oswald", "Condensed", "Narrow", "Fjalla", "Anton", "Archivo Narrow"])) {
    return `"${name}", 'Nimbus Sans Narrow', 'Liberation Sans Narrow', 'DejaVu Sans Condensed', 'Arial Narrow', Helvetica, sans-serif`;
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
 * Stock and ink for a component that DEPICTS printed matter — a directive, a
 * telegram, a page torn out of something. The four theme colours do not name
 * "paper", and adding a fifth would leave every theme authored before this
 * component without one, so it is derived: the lighter of the theme's page and
 * its ink is the stock, the darker is the type.
 *
 * That is not the same as `surfaceColor`. A panel takes the channel's ground
 * whatever its luminance; a document is dark type on light stock in every
 * channel, because that is what a document IS. Hardcoding `colors.text` as the
 * stock — which is what DocumentCard did — happens to be right on a dark theme
 * and inverts into a black directive on a paper one.
 */
export function paperStock(theme: Theme): { stock: string; ink: string } {
  return luminance(theme.colors.text) >= luminance(theme.colors.bg)
    ? { stock: theme.colors.text, ink: theme.colors.bg }
    : { stock: theme.colors.bg, ink: theme.colors.text };
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

/**
 * The accent leads the ramp WHEN IT CAN. A viewer expects the first series in a
 * channel's chart to be that channel's colour, and for most themes it is: a
 * blue accent on a light plate is a perfectly good mark.
 *
 * The exception is the one the ramp was written for. `archive`'s tan is a
 * GROUND — it exists to be typed on — and at 1.9:1 against cream it is a line
 * nobody can follow. So the accent is admitted only if it clears 3:1 against
 * the plate, the floor a non-text mark has to hold, and otherwise the engine's
 * own first hue leads and the accent stays out of the data entirely.
 *
 * Series 2 and 3 always come from the engine ramp: they have to hold contrast
 * against the plate, against series 1 and against each other under
 * colour-blindness, which is a property of the set and not of the theme.
 */
export function seriesColors(theme: Theme): readonly string[] {
  const plate = surfaceColor(theme);
  const base = luminance(plate) > 0.4 ? SERIES_ON_LIGHT : SERIES_ON_DARK;
  const bg = luminance(plate);
  const accent = luminance(theme.colors.accent);
  const ratio = (Math.max(accent, bg) + 0.05) / (Math.min(accent, bg) + 0.05);
  return ratio >= 3 ? [theme.colors.accent, base[1], base[2]] : base;
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

// ---------------- D66: typography, density, rule, texture, chart ----------------
//
// Two kinds of token, and the difference is what makes Principle 7 hold.
//
// SCALE tokens (`typography.scale|weight|case|tracking`, `surface.density|rule`,
// `chart.stroke`) have an identity element — `normal`, `regular`, `as_written`.
// The resolver takes the component's OWN value and returns it unchanged at the
// identity, exactly the way `surfaceStyle` scales a radius rather than replacing
// it. So a 700 title and a 400 label keep their relationship under `bold`, and a
// theme that sets nothing renders byte-identically.
//
// CHOICE tokens (`chart.grid|legend|markers`) have no identity element: there is
// no neutral answer to "where does the legend go". They therefore carry NO
// schema default, and the resolver falls back to the component's own choice —
// the `surface.accent_rule` precedent. That is why the resolved types below are
// WIDER than the token enums: `grid: "axes"` and `markers: "ends"` are values a
// component can hold but a theme cannot name.

type ScaleToken = NonNullable<Theme["typography"]["scale"]>;
type WeightToken = NonNullable<Theme["typography"]["weight"]>;
type TrackingToken = NonNullable<Theme["typography"]["tracking"]>;
type DensityToken = NonNullable<NonNullable<Theme["surface"]>["density"]>;
type RuleToken = NonNullable<NonNullable<Theme["surface"]>["rule"]>;
type TextureToken = NonNullable<NonNullable<Theme["surface"]>["texture"]>;

/** What a piece of type is DOING, which is what decides how far it moves. */
export type TypeRole = "title" | "number" | "kicker" | "body" | "caption";

/**
 * A type scale is not a zoom: display type moves further than a caption, or the
 * page loses its hierarchy at `compact` and its captions become unreadable at
 * `generous`. `normal` is 1 across every role, so it is the identity.
 */
const TYPE_SCALE: Record<ScaleToken, Record<TypeRole, number>> = {
  compact: { title: 0.84, number: 0.86, kicker: 0.92, body: 0.92, caption: 0.94 },
  normal: { title: 1, number: 1, kicker: 1, body: 1, caption: 1 },
  generous: { title: 1.2, number: 1.18, kicker: 1.08, body: 1.08, caption: 1.04 },
};

/** Multiplier over the component's own fontSize ratio: `height * 0.05 * typeScale(theme, "title")`. */
export function typeScale(theme: Theme, role: TypeRole = "body"): number {
  return TYPE_SCALE[theme.typography.scale ?? "normal"][role];
}

const WEIGHT_SHIFT: Record<WeightToken, number> = { light: -400, regular: 0, bold: 200 };

/**
 * Offset on the component's own weight, clamped to 300..900 and snapped to
 * hundreds. A shift, not a replacement: a 700 title goes 300/700/900 and a 400
 * label goes 300/400/600, so the two stay distinguishable at every setting.
 */
export function typeWeight(theme: Theme, base = 400): number {
  const shifted = base + WEIGHT_SHIFT[theme.typography.weight ?? "regular"];
  return Math.min(900, Math.max(300, Math.round(shifted / 100) * 100));
}

/** `as_written` keeps the component's own value — a kicker already upper stays upper. */
export function typeCase(
  theme: Theme,
  base: "none" | "uppercase" = "none"
): "none" | "uppercase" {
  return (theme.typography.case ?? "as_written") === "upper" ? "uppercase" : base;
}

const TRACKING_SHIFT: Record<TrackingToken, number> = { tight: -0.03, normal: 0, wide: 0.07 };

/**
 * Em OFFSET on the component's own letterSpacing, not a multiplier: a title at
 * 0em has to be reachable by `wide`, and 0 x anything is 0. Returns undefined
 * when the result is 0 so the component omits the property entirely and CSS
 * keeps `normal` — the pre-D66 rendering, to the pixel.
 */
export function typeTracking(theme: Theme, baseEm = 0): string | undefined {
  const em = Math.max(-0.05, baseEm + TRACKING_SHIFT[theme.typography.tracking ?? "normal"]);
  const rounded = Math.round(em * 1e4) / 1e4;
  return rounded === 0 ? undefined : `${rounded}em`;
}

const DENSITY_SCALE: Record<DensityToken, number> = { tight: 0.7, normal: 1, airy: 1.36 };

/** Multiplier on padding, gaps, margins and panel insets. */
export function densityScale(theme: Theme): number {
  return DENSITY_SCALE[theme.surface?.density ?? "normal"];
}

const RULE_SCALE: Record<RuleToken, number> = { hairline: 0.45, normal: 1, heavy: 2.4 };

/**
 * Width of one rule — an accent bar, a border, an axis, a baseline — scaled from
 * the component's own. `normal` returns `base` untouched (no rounding), which is
 * what keeps a converted component byte-identical under an untouched theme.
 */
export function ruleWidth(theme: Theme, base: number): number {
  const token = theme.surface?.rule ?? "normal";
  if (token === "normal") return base;
  return Math.max(1, Math.round(base * RULE_SCALE[token]));
}

/**
 * Deterministic ground treatment for the plate an overlay sets type on.
 *
 * Pure CSS plus one fixed-seed feTurbulence, so it is a function of nothing at
 * all — no frame, no random. Returns null for `none`, which is every shipped
 * theme, so the token is inert until someone asks for it.
 *
 * The layer carries its own bg tint because a texture with nothing under it is
 * not a texture: `paper` over raw footage would be noise, not a page.
 */
function noiseUrl(freq: number, octaves: number, opacity: number): string {
  const svg =
    `%3Csvg xmlns='http://www.w3.org/2000/svg' width='240' height='240'%3E` +
    `%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='${freq}' ` +
    `numOctaves='${octaves}' stitchTiles='stitch' seed='7'/%3E%3C/filter%3E` +
    `%3Crect width='240' height='240' filter='url(%23n)' opacity='${opacity}'/%3E%3C/svg%3E`;
  return `url("data:image/svg+xml,${svg}")`;
}

export function textureLayer(theme: Theme): CSSProperties | null {
  const token: TextureToken = theme.surface?.texture ?? "none";
  if (token === "none") return null;
  const bg = theme.colors.bg;
  switch (token) {
    case "paper":
      return {
        backgroundColor: `${bg}f7`,
        backgroundImage: noiseUrl(0.9, 4, 0.32),
        backgroundSize: "240px 240px",
        backgroundBlendMode: "multiply",
      };
    case "grain":
      return {
        backgroundColor: `${bg}e0`,
        backgroundImage: noiseUrl(1.6, 2, 0.5),
        backgroundSize: "180px 180px",
        backgroundBlendMode: "overlay",
      };
    default: // scanline
      return {
        backgroundColor: `${bg}e6`,
        backgroundImage:
          "repeating-linear-gradient(to bottom, rgba(0,0,0,0.3) 0px, rgba(0,0,0,0.3) 1px, rgba(0,0,0,0) 1px, rgba(0,0,0,0) 3px)",
      };
  }
}

/**
 * The ground an overlay sets its type on: the panel `surface.fill` resolves,
 * plus whatever `surface.texture` lays over it, in one object.
 *
 * Returns null when the theme asks for neither, which is every theme authored
 * before D66. That is what lets a component which never had a plate start
 * honouring `surface.fill` without changing under an untouched theme: pass
 * `alpha: "00"` — its own "no panel" — and `translucent` (the D46 default,
 * meaning "keep your own alpha") still resolves to nothing.
 *
 * `legible` is the safety catch, and it exists because `fill: "none"` is a
 * request a theme can make that a component cannot always honour. Over unknown
 * footage, light ink survives having its panel taken away and dark ink does
 * not — a paper theme with no plate is a black caption on a night shot. So a
 * component whose ground CARRIES TYPE passes `legible: true`, and a theme whose
 * own page is lighter than its ink gets a plate back whether it asked for one
 * or not. Same argument as `surfaceColor`: "none" there is not a lighter look,
 * it is unreadable type over moving footage.
 *
 * It costs nothing on a dark theme — light ink reads over anything, so the
 * fallback never fires and the result is still null.
 */
export interface GroundOptions extends SurfaceOptions {
  /** This ground carries type: never hand back nothing when the ink needs a plate. */
  legible?: boolean;
}

export function groundStyle(theme: Theme, opts: GroundOptions = {}): CSSProperties | null {
  const { legible = false, ...surfaceOpts } = opts;
  const surface = surfaceStyle(theme, { alpha: "00", ...surfaceOpts });
  const texture = textureLayer(theme);
  const invisible = surface.background === "transparent" || surface.background.endsWith("00");
  if (invisible && texture === null) {
    if (!legible || luminance(theme.colors.text) >= luminance(theme.colors.bg)) return null;
    return { borderRadius: surface.borderRadius, backgroundColor: surfaceColor(theme) };
  }
  return {
    borderRadius: surface.borderRadius,
    ...(invisible ? {} : { backgroundColor: surface.background }),
    ...(texture ?? {}),
  };
}

/** The component's own chart choices — what a theme that says nothing keeps. */
export interface ChartBase {
  /** Values a component can hold that no theme can name: `axes` = a y and an x
   *  line (LineChart's own), `baseline` = one rule under the marks (BarChart's,
   *  Timeline's). */
  grid?: "axes" | "baseline" | "none" | "horizontal" | "full";
  legend?: "inline" | "bottom";
  /** Whether a line encloses the space beneath it. LineChart's own is `none`. */
  area?: "none" | "tint";
  /** `ends` = a mark only where a series stops. LineChart's own. */
  markers?: "ends" | "none" | "dot";
  /** The component's own series stroke width, in px at the current frame size. */
  stroke?: number;
}

export interface ChartStyle {
  grid: "axes" | "baseline" | "none" | "horizontal" | "full";
  legend: "inline" | "bottom";
  area: "none" | "tint";
  markers: "ends" | "none" | "dot";
  /** The component's stroke, scaled by `chart.stroke`. */
  strokeWidth: number;
  /** The bare multiplier, for anything that has to keep pace with the stroke
   *  (a dash pattern at `heavy` needs longer dashes, not the same ones). */
  strokeScale: number;
  /** Axis and label figures. A counter's own `decimals` prop still wins. */
  formatNumber: (v: number) => string;
}

const STROKE_SCALE: Record<RuleToken, number> = { hairline: 0.42, normal: 1, heavy: 2.3 };

function compactNumber(v: number): string {
  const abs = Math.abs(v);
  const unit = abs >= 1e9 ? ["B", 1e9] : abs >= 1e6 ? ["M", 1e6] : abs >= 1e3 ? ["K", 1e3] : null;
  if (!unit) return Math.round(v * 10) / 10 === Math.round(v) ? String(Math.round(v)) : v.toFixed(1);
  const scaled = v / (unit[1] as number);
  const text = Math.abs(scaled) >= 100 ? String(Math.round(scaled)) : scaled.toFixed(1);
  return `${text}${unit[0]}`;
}

/**
 * Chart tokens resolved against the component's own choices. `base` is what the
 * component drew before D66; the theme overrides only what it names.
 */
export function chartStyle(theme: Theme, base: ChartBase = {}): ChartStyle {
  const chart = theme.chart ?? {};
  const strokeScale = STROKE_SCALE[chart.stroke ?? "normal"];
  const stroke = base.stroke ?? 3;
  return {
    grid: chart.grid ?? base.grid ?? "axes",
    legend: chart.legend ?? base.legend ?? "bottom",
    area: chart.area ?? base.area ?? "none",
    markers: chart.markers ?? base.markers ?? "ends",
    strokeWidth: chart.stroke === undefined || chart.stroke === "normal"
      ? stroke
      : Math.max(1, stroke * strokeScale),
    strokeScale,
    formatNumber:
      (chart.number_format ?? "plain") === "compact"
        ? compactNumber
        : (v: number) => Math.round(v).toLocaleString("en-US"),
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
