/**
 * Theme runtime (D8): token object -> styling inside every component.
 * Components take semantic props only; ALL appearance resolves here.
 * The AI never sees this.
 */
import type { Theme } from "@lusora/contracts";

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
