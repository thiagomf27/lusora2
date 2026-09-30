/**
 * Film texture (D112, documentary plan slice 7) — Dark Palace's `efeitos.py`
 * and `vhs_fita.py`, drawn procedurally rather than from stock overlay files,
 * so a theme can restyle it and no clip of unknown licence ships with a video.
 *
 * What is drawn comes from the theme's `texture` tokens; WHERE the per-shot
 * looks land (`grade: vintage`, `crt`, the `light_leak` transition) is the
 * compiler's decision, written into the plan by style_pack.texture.placement.
 *
 * Everything here is a pure function of the frame: specks and wobble come
 * from remotion's seeded random(), never Math.random().
 */
import type { Theme, VisualItem } from "@lusora/contracts";
import { AbsoluteFill, random, useCurrentFrame, useVideoConfig } from "remotion";

export interface TextureTokens {
  dust: "none" | "light" | "heavy";
  tape: "none" | "vhs";
  vintage: "faded" | "sepia" | "none";
  crt: "tube" | "none";
}

/** The theme's texture with every omitted token resolved; an untouched theme draws nothing. */
export function textureOf(theme: Theme): TextureTokens {
  const t = theme.texture ?? {};
  return {
    dust: t.dust ?? "none",
    tape: t.tape ?? "none",
    vintage: t.vintage ?? "faded",
    crt: t.crt ?? "tube",
  };
}

/** DP's vintage block: less colour, warmer, a touch darker (efeitos.py). */
const VINTAGE: Record<Exclude<TextureTokens["vintage"], "none">, string> = {
  faded: "saturate(0.70) contrast(0.945) brightness(0.97) sepia(0.16)",
  sepia: "sepia(0.62) saturate(0.78) contrast(0.93) brightness(0.95)",
};

/**
 * The tape's colour (vhs_fita.cor): lifted blacks and softer whites, less
 * saturation, a warm cast and the half-resolution softness of a tape. The
 * sideways colour bleed needs per-channel offsets, which only an SVG filter
 * gives — that one runs on a cut's first frames only (TAPE_SPLIT_S).
 */
const TAPE_COLOUR = "contrast(0.96) saturate(0.82) sepia(0.07) brightness(1.02) blur(0.55px)";
const TAPE_SPLIT_S = 0.1;

/** The CSS filter a shot plays through, or undefined when the plan and theme ask for nothing. */
export function shotFilter(item: VisualItem, tokens: TextureTokens, isFootage: boolean): string | undefined {
  const parts: string[] = [];
  if (item.grade === "vintage" && tokens.vintage !== "none") parts.push(VINTAGE[tokens.vintage]);
  if (tokens.tape === "vhs" && isFootage) parts.push(TAPE_COLOUR);
  return parts.length ? parts.join(" ") : undefined;
}

/**
 * The tape's layer over one footage shot: every third line darker, soft dark
 * corners (vhs_fita.camada_css), a small side-to-side wobble and a colour
 * split on the shot's first frames. DP's users rejected a white tracking band
 * and a noisy strip at the bottom as "not VHS"; neither is drawn.
 */
export const TapeLook: React.FC<{ children: React.ReactNode; seed: string }> = ({ children, seed }) => {
  const frame = useCurrentFrame();
  const { fps, height } = useVideoConfig();
  const t = frame / fps;
  const px = height / 1080;
  const wobble = 1.4 * px * Math.sin(t * 7.3) * Math.sin(t * 1.7);
  const splitting = t < TAPE_SPLIT_S;
  const id = `tape-split-${seed}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const shift = Math.round(9 * px);
  return (
    <AbsoluteFill style={{ overflow: "hidden", backgroundColor: "black" }}>
      {splitting ? (
        <svg width={0} height={0} style={{ position: "absolute" }}>
          <filter id={id} colorInterpolationFilters="sRGB">
            <feOffset in="SourceGraphic" dx={shift} result="r0" />
            <feColorMatrix in="r0" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r" />
            <feOffset in="SourceGraphic" dx={-shift} result="gb0" />
            <feColorMatrix in="gb0" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="gb" />
            <feBlend in="r" in2="gb" mode="screen" />
          </filter>
        </svg>
      ) : null}
      <AbsoluteFill
        style={{
          // 1% over-scan so the wobble never shows an edge
          transform: `translateX(${wobble.toFixed(2)}px) scale(1.01)`,
          filter: splitting ? `url(#${id})` : undefined,
        }}
      >
        {children}
      </AbsoluteFill>
      <AbsoluteFill
        style={{
          pointerEvents: "none",
          background:
            `repeating-linear-gradient(180deg, rgba(0,0,0,0.12) 0 ${px}px, rgba(0,0,0,0.04) ${px}px ${2 * px}px, rgba(0,0,0,0) ${2 * px}px ${3 * px}px),` +
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 58%, rgba(0,0,0,0.30) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};

/**
 * An old television set (DP keyed a stock "vintage overlay" clip of one): the
 * shot shrinks into a rounded, bulging screen in a dark cabinet, with the
 * tube's lines, its dark corners, a glass reflection and a faint flicker. A
 * depicted object, so its colours are its own rather than the theme's.
 */
export const CrtSet: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const px = height / 1080;
  const flicker = 0.02 + 0.03 * random(`crt-flicker-${Math.floor(frame / 2)}`);
  const screen: React.CSSProperties = {
    position: "absolute",
    left: width * 0.14,
    right: width * 0.14,
    top: height * 0.1,
    bottom: height * 0.12,
    borderRadius: `${width * 0.045}px / ${height * 0.08}px`,
    overflow: "hidden",
    backgroundColor: "black",
  };
  return (
    <AbsoluteFill
      style={{ background: "radial-gradient(ellipse at 50% 42%, #2b2723 0%, #141210 55%, #070606 100%)" }}
    >
      {/* the cabinet */}
      <div
        style={{
          position: "absolute",
          left: width * 0.1,
          right: width * 0.1,
          top: height * 0.05,
          bottom: height * 0.06,
          borderRadius: width * 0.03,
          background: "linear-gradient(160deg, #3a332c 0%, #221e1a 45%, #15120f 100%)",
          boxShadow: `0 ${24 * px}px ${60 * px}px rgba(0,0,0,0.7), inset 0 ${2 * px}px ${3 * px}px rgba(255,255,255,0.08)`,
        }}
      />
      <div style={screen}>
        <AbsoluteFill style={{ transform: "scale(1.04)", filter: "contrast(1.1) saturate(0.85) brightness(1.06)" }}>
          {children}
        </AbsoluteFill>
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background:
              `repeating-linear-gradient(180deg, rgba(0,0,0,0.22) 0 ${px}px, rgba(0,0,0,0) ${px}px ${3 * px}px),` +
              "radial-gradient(ellipse at center, rgba(0,0,0,0) 50%, rgba(0,0,0,0.65) 100%)",
          }}
        />
        <AbsoluteFill style={{ pointerEvents: "none", backgroundColor: "white", opacity: flicker }} />
        <AbsoluteFill
          style={{
            pointerEvents: "none",
            background: "linear-gradient(155deg, rgba(255,255,255,0.13) 0%, rgba(255,255,255,0.03) 30%, rgba(255,255,255,0) 55%)",
          }}
        />
        <AbsoluteFill style={{ pointerEvents: "none", boxShadow: `inset 0 0 ${40 * px}px ${10 * px}px rgba(0,0,0,0.75)` }} />
      </div>
    </AbsoluteFill>
  );
};

const DUST = {
  light: { specks: [0, 3], hair: 0.1, scratch: 0 },
  heavy: { specks: [2, 7], hair: 0.25, scratch: 0.12 },
} as const;

/**
 * Dust over the whole picture (DP's dust over every block): specks and the
 * odd hair, redrawn every other frame like dirt on a moving print, mostly
 * dark with a few light ones. Drawn below the captions, which are not film.
 */
export const Dust: React.FC<{ level: TextureTokens["dust"] }> = ({ level }) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  if (level === "none") return null;
  const conf = DUST[level];
  const b = Math.floor(frame / 2);
  const r = (k: string) => random(`dust-${k}-${b}`);
  const [lo, hi] = conf.specks;
  const count = lo + Math.floor(r("n") * (hi - lo + 1));
  const px = height / 1080;
  const specks = Array.from({ length: count }, (_, i) => {
    const light = r(`t${i}`) > 0.75;
    return (
      <ellipse
        key={`s${i}`}
        cx={r(`x${i}`) * width}
        cy={r(`y${i}`) * height}
        rx={(1 + r(`w${i}`) * 3.2) * px}
        ry={(0.8 + r(`h${i}`) * 2.4) * px}
        fill={light ? "#f4efe4" : "#0b0a08"}
        fillOpacity={0.35 + r(`o${i}`) * 0.45}
      />
    );
  });
  let hair: React.ReactNode = null;
  if (r("hair") < conf.hair) {
    const x = r("hx") * width;
    const y = r("hy") * height;
    const len = (30 + r("hl") * 70) * px;
    hair = (
      <path
        d={`M ${x} ${y} q ${len * 0.5} ${len * (r("hc") - 0.5)} ${len} ${len * (r("hd") - 0.5) * 0.6}`}
        stroke="#0b0a08"
        strokeOpacity={0.55}
        strokeWidth={1.3 * px}
        fill="none"
      />
    );
  }
  let scratch: React.ReactNode = null;
  if (r("scratch") < conf.scratch) {
    const x = r("sx") * width;
    scratch = <line x1={x} y1={0} x2={x + 3 * px} y2={height} stroke="#f4efe4" strokeOpacity={0.14} strokeWidth={px} />;
  }
  return (
    <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {specks}
      {hair}
      {scratch}
    </svg>
  );
};

/**
 * A light leak's glow at `progress` through the transition: warm blooms that
 * drift across the frame, strongest at the midpoint where the shots swap.
 * DP dims its leak clip to 0.55; the bloom's own falloff keeps it under that
 * everywhere but the hot core.
 */
export const LeakGlow: React.FC<{ progress: number }> = ({ progress }) => {
  const peak = 1 - Math.abs(2 * progress - 1);
  const x = -15 + 130 * progress;
  return (
    <AbsoluteFill
      style={{
        pointerEvents: "none",
        mixBlendMode: "screen",
        opacity: Math.min(1, 0.2 + 0.8 * peak),
        background:
          `radial-gradient(ellipse 55% 85% at ${x}% 40%, rgba(255,214,150,0.95) 0%, rgba(255,140,60,0.7) 35%, rgba(200,50,20,0) 70%),` +
          `radial-gradient(ellipse 40% 60% at ${x + 28}% 70%, rgba(255,90,40,0.55) 0%, rgba(255,90,40,0) 70%),` +
          `radial-gradient(ellipse 35% 50% at ${x - 30}% 20%, rgba(255,235,190,0.5) 0%, rgba(255,235,190,0) 70%)`,
      }}
    />
  );
};
