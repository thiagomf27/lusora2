"use client";
/**
 * Visual preview of a theme document. Every piece of appearance shown here
 * comes from the ENGINE's theme runtime (fontStack / captionStyle /
 * motionScale) so the page can't drift from what a render actually looks like.
 *
 * The mock frame is sized against the engine's 1080p reference: px values from
 * captionStyle() are converted to `cqh` against a container-query frame, which
 * is the same proportional scaling the renderer applies.
 */
import { useId } from "react";
import type { Theme } from "@lusora/contracts";
import { captionStyle, fontStack, motionScale } from "@lusora/engine/src/themes/runtime.ts";
import s from "./ThemePreview.module.css";

const REF_HEIGHT = 1080;

/** "10px 26px" -> "0.93cqh 2.41cqh" (1080p reference -> frame-relative) */
function scalePx(value: string): string {
  return value.replace(/(-?[\d.]+)px/g, (_m, n) => `${((Number(n) / REF_HEIGHT) * 100).toFixed(3)}cqh`);
}

function cqh(px: number): string {
  return `${((px / REF_HEIGHT) * 100).toFixed(3)}cqh`;
}

/** sRGB relative luminance — picks a readable ink for a swatch label. */
function isLight(hex: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return false;
  const v = parseInt(m[1], 16);
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2] > 0.35;
}

function grainOpacity(grain: Theme["grain"]): number {
  return grain === "archival" ? 0.12 : grain === "film" ? 0.07 : 0;
}

/** The same feTurbulence overlay the archival components use. */
function GrainOverlay({ grain, seed = 4 }: { grain: Theme["grain"]; seed?: number }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const opacity = grainOpacity(grain);
  if (opacity === 0) return null;
  return (
    <div className={s.grain} style={{ opacity }}>
      <svg width="100%" height="100%">
        <filter id={`grain-${id}`}>
          <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={seed} stitchTiles="stitch" />
        </filter>
        <rect width="100%" height="100%" filter={`url(#grain-${id})`} />
      </svg>
    </div>
  );
}

/**
 * A mock 16:9 frame: eyebrow, display title, accent rule, body copy, an
 * overlay card and a caption in the theme's caption preset.
 */
export function ThemeFrame({ theme, title = "The Salt Road" }: { theme: Theme; title?: string }) {
  const cs = captionStyle(theme, theme.typography.caption_preset);
  const display = fontStack(theme.typography.display);
  const body = fontStack(theme.typography.body);
  return (
    <div className={s.frame} style={{ background: theme.colors.bg }}>
      <div className={s.frameInner}>
        <div className={s.frameLeft}>
          <div
            className={s.eyebrow}
            style={{ color: theme.colors.accent, fontFamily: body, fontSize: cqh(22) }}
          >
            CHAPTER ONE
          </div>
          <div
            className={s.title}
            style={{ color: theme.colors.text, fontFamily: display, fontSize: cqh(104) }}
          >
            {title}
          </div>
          <div className={s.rule} style={{ background: theme.colors.accent, height: cqh(5), width: cqh(160) }} />
          <div
            className={s.body}
            style={{ color: theme.colors.neutral, fontFamily: body, fontSize: cqh(30) }}
          >
            Body copy in the body face — the neutral token carries secondary
            text, the accent carries emphasis.
          </div>
        </div>

        <div
          className={s.card}
          style={{
            borderColor: theme.colors.accent,
            background: `${theme.colors.text}0f`,
            padding: cqh(24),
            borderRadius: cqh(10),
          }}
        >
          <div style={{ color: theme.colors.neutral, fontFamily: body, fontSize: cqh(20), letterSpacing: "0.12em" }}>
            OVERLAY
          </div>
          <div style={{ color: theme.colors.accent, fontFamily: display, fontSize: cqh(66), lineHeight: 1.1 }}>
            1,204
          </div>
          <div style={{ color: theme.colors.text, fontFamily: body, fontSize: cqh(22) }}>tonnes / year</div>
        </div>
      </div>

      <div
        className={s.caption}
        style={{
          fontFamily: cs.fontFamily,
          fontSize: cqh(cs.fontSize),
          color: cs.color,
          background: cs.background,
          padding: scalePx(cs.padding),
          borderRadius: cqh(cs.borderRadius),
          fontStyle: cs.fontStyle,
          letterSpacing: cs.letterSpacing,
          textTransform: cs.textTransform,
        }}
      >
        …and the caption renders in the {theme.typography.caption_preset} preset.
      </div>

      <GrainOverlay grain={theme.grain} />
    </div>
  );
}

const COLOR_ROLES: { key: keyof Theme["colors"]; label: string; note: string }[] = [
  { key: "bg", label: "bg", note: "frame background" },
  { key: "text", label: "text", note: "primary copy" },
  { key: "accent", label: "accent", note: "emphasis: accent" },
  { key: "neutral", label: "neutral", note: "emphasis: neutral" },
];

export function ThemeSwatches({ theme }: { theme: Theme }) {
  return (
    <div className={s.swatches}>
      {COLOR_ROLES.map(({ key, label, note }) => {
        const hex = theme.colors[key];
        return (
          <div key={key} className={s.swatch}>
            <div
              className={s.swatchChip}
              style={{ background: hex, color: isLight(hex) ? "#0b0e13" : "#e7eaf0" }}
            >
              {hex}
            </div>
            <div className={s.swatchName}>{label}</div>
            <div className={s.swatchNote}>{note}</div>
          </div>
        );
      })}
    </div>
  );
}

export function ThemeTypography({ theme }: { theme: Theme }) {
  const cs = captionStyle(theme, theme.typography.caption_preset);
  return (
    <div className={s.typoGrid}>
      <div className={s.typoCell}>
        <div className={s.cellLabel}>DISPLAY</div>
        <div className={s.specimen} style={{ fontFamily: fontStack(theme.typography.display) }}>
          Aa
        </div>
        <div className={s.cellValue}>{theme.typography.display}</div>
        <div className={s.cellNote}>titles, chapter cards, big numbers</div>
      </div>
      <div className={s.typoCell}>
        <div className={s.cellLabel}>BODY</div>
        <div className={s.specimen} style={{ fontFamily: fontStack(theme.typography.body) }}>
          Aa
        </div>
        <div className={s.cellValue}>{theme.typography.body}</div>
        <div className={s.cellNote}>labels, lower thirds, body copy</div>
      </div>
      <div className={s.typoCell}>
        <div className={s.cellLabel}>CAPTION PRESET</div>
        <div className={s.captionSpecimen}>
          <span
            style={{
              fontFamily: cs.fontFamily,
              fontSize: Math.round(cs.fontSize * 0.42),
              color: cs.color,
              background: cs.background,
              padding: cs.padding.replace(/(-?[\d.]+)px/g, (_m, n) => `${Math.round(Number(n) * 0.42)}px`),
              borderRadius: cs.borderRadius,
              fontStyle: cs.fontStyle,
              letterSpacing: cs.letterSpacing,
              textTransform: cs.textTransform,
            }}
          >
            Spoken line
          </span>
        </div>
        <div className={s.cellValue}>{theme.typography.caption_preset}</div>
        <div className={s.cellNote}>burned-in subtitle style</div>
      </div>
    </div>
  );
}

export function ThemeMotion({ theme }: { theme: Theme }) {
  const { durationMul, springDamping } = motionScale(theme);
  const feel = theme.motion_feel ?? "neutral";
  const grain = theme.grain ?? "none";
  return (
    <div className={s.typoGrid}>
      <div className={s.typoCell}>
        <div className={s.cellLabel}>MOTION FEEL</div>
        <div className={s.bars}>
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={s.bar}
              style={{
                background: theme.colors.accent,
                animationDuration: `${(1.1 * durationMul).toFixed(2)}s`,
                animationDelay: `${(i * 0.12 * durationMul).toFixed(2)}s`,
              }}
            />
          ))}
        </div>
        <div className={s.cellValue}>{feel}</div>
        <div className={s.cellNote}>
          ×{durationMul.toFixed(2)} duration · spring damping {springDamping}
        </div>
      </div>
      <div className={s.typoCell}>
        <div className={s.cellLabel}>GRAIN</div>
        <div className={s.grainTile} style={{ background: theme.colors.bg }}>
          <GrainOverlay grain={theme.grain} seed={7} />
        </div>
        <div className={s.cellValue}>{grain}</div>
        <div className={s.cellNote}>
          {grain === "none" ? "no post-look" : `overlay at ${(grainOpacity(theme.grain) * 100).toFixed(0)}% (Remotion path)`}
        </div>
      </div>
    </div>
  );
}

/** Small colour strip used in the theme list. */
export function ThemeStrip({ theme }: { theme: Theme }) {
  return (
    <div className={s.strip}>
      {COLOR_ROLES.map(({ key }) => (
        <span key={key} className={s.stripCell} style={{ background: theme.colors[key] }} />
      ))}
    </div>
  );
}
