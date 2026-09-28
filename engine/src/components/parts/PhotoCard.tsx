/**
 * PhotoCard — one photograph on a card, as an object placed on the page.
 *
 * Unregistered drawing shared by every component that sets a picture beside
 * its own content: RankLabel and BulletList when given an `image`, and
 * PhotoRow for each of its pictures. It draws the card and three optional fixtures:
 *
 * - `tag`     a PinTag hung from the card's top-right corner
 * - `verdict` a ✓ / ✗ badge on that same corner (the two never meet: a card is
 *             either named or judged)
 * - `caption` a chip under the card
 *
 * Not FramedExhibit: an exhibit is a museum mount with a caption, the subject
 * of the frame. This is a picture in service of the text beside it.
 *
 * `image` is a path under the video dir, a still or a clip; staticFile() is
 * only called when it is set, because resolving a missing file errors the
 * render. With no asset a quiet placeholder stands in.
 */
import { Img, OffthreadVideo, interpolate, staticFile } from "remotion";
import type { Theme } from "../theme.ts";
import {
  photoMat,
  chipColor,
  blend,
  contrastInk,
  densityScale,
  elevationShadow,
  fontStack,
  plateColor,
  surfaceColor,
  surfaceStyle,
  typeScale,
  typeWeight,
  verdictColors,
} from "../theme.ts";
import { PinTag } from "./PinTag.tsx";

export type Verdict = "right" | "wrong";

export interface PhotoCardProps {
  image?: string;
  theme: Theme;
  /** Card size in px. */
  w: number;
  h: number;
  frameHeight: number;
  tag?: string;
  tagDetail?: string;
  verdict?: Verdict;
  caption?: string;
  /** 0..1 — the card has arrived; fixtures follow on their own clocks. */
  progress: number;
  /** 0..1 — the fixtures (tag, badge, caption). */
  fixtures: number;
  emphasis?: "accent" | "neutral";
}

const VIDEO = /\.(mp4|mov|webm|mkv)$/i;

export function PhotoCard(p: PhotoCardProps) {
  const { theme, w, h, frameHeight: fh, progress, fixtures } = p;
  const density = densityScale(theme);
  const radius = surfaceStyle(theme, { radius: 14 }).borderRadius;
  const mat = photoMat(theme, fh);
  const verdictInk = verdictColors(theme);

  const badgeR = fh * 0.032;
  const badgeIn = interpolate(fixtures, [0, 0.6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const captionIn = interpolate(fixtures, [0.3, 1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  const chip = chipColor(theme);
  const chipInk = contrastInk(theme, chip);

  return (
    <div style={{ position: "relative", width: w, display: "flex", flexDirection: "column", alignItems: "center" }}>
      <div
        style={{
          position: "relative",
          width: w,
          height: h,
          borderRadius: radius,
          overflow: "hidden",
          boxShadow: elevationShadow(theme, fh),
          // `surface.photo_frame: mat` (D97): a print's light border, drawn
          // inside the card's box so the card keeps the size it was given.
          ...(mat ? { boxSizing: "border-box" as const, border: `${mat.width}px solid ${mat.color}` } : {}),
          // A slow push while it holds: a still on a card should not be a
          // screenshot. Driven by the card's own clock, so it is deterministic.
          background: blend(theme.colors.neutral, surfaceColor(theme), 0.25),
        }}
      >
        {p.image ? (
          VIDEO.test(p.image) ? (
            <OffthreadVideo muted src={staticFile(p.image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
          ) : (
            <Img
              src={staticFile(p.image)}
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
                scale: `${interpolate(progress, [0, 1], [1.06, 1])}`,
              }}
            />
          )
        ) : (
          <Placeholder theme={theme} w={w} h={h} />
        )}
      </div>

      {p.verdict ? (
        <div
          style={{
            position: "absolute",
            top: -badgeR * 0.55,
            right: -badgeR * 0.55,
            width: badgeR * 2,
            height: badgeR * 2,
            borderRadius: "50%",
            background: verdictInk[p.verdict],
            boxShadow: elevationShadow(theme, fh),
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            scale: `${interpolate(badgeIn, [0, 0.7, 1], [0, 1.15, 1])}`,
          }}
        >
          <VerdictGlyph verdict={p.verdict} size={badgeR * 1.05} color={contrastInk(theme, verdictInk[p.verdict])} />
        </div>
      ) : p.tag ? (
        <PinTag
          title={p.tag}
          detail={p.tagDetail}
          theme={theme}
          x={w * 0.8}
          y={h * 0.02}
          frameHeight={fh}
          progress={fixtures}
          size="small"
        />
      ) : null}

      {p.caption ? (
        <div
          style={{
            marginTop: -fh * 0.022,
            background: chip,
            color: chipInk,
            borderRadius: surfaceStyle(theme, { radius: 6 }).borderRadius,
            boxShadow: elevationShadow(theme, fh),
            padding: `${fh * 0.01 * density}px ${fh * 0.024 * density}px`,
            fontFamily: fontStack(theme.typography.body),
            fontSize: fh * 0.024 * typeScale(theme, "caption"),
            fontWeight: typeWeight(theme, 600),
            whiteSpace: "nowrap",
            zIndex: 1,
            opacity: captionIn,
            translate: `0 ${interpolate(captionIn, [0, 1], [fh * 0.012, 0])}px`,
          }}
        >
          {p.caption}
        </div>
      ) : null}
    </div>
  );
}

/** ✓ or ✗ drawn as strokes, not glyphs: no font has to carry them. */
export function VerdictGlyph({ verdict, size, color }: { verdict: Verdict; size: number; color: string }) {
  const s = Math.max(2, size * 0.16);
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ overflow: "visible" }}>
      {verdict === "right" ? (
        <path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke={color} strokeWidth={(s * 24) / size} strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" fill="none" stroke={color} strokeWidth={(s * 24) / size} strokeLinecap="round" />
      )}
    </svg>
  );
}

/** A quiet stand-in for a missing photo — a tone and a frame mark, nothing more. */
function Placeholder({ theme, w, h }: { theme: Theme; w: number; h: number }) {
  const ground = surfaceColor(theme);
  const a = blend(theme.colors.neutral, ground, 0.18);
  const b = blend(theme.colors.neutral, ground, 0.34);
  const m = Math.min(w, h) * 0.08;
  return (
    <svg width={w} height={h}>
      <defs>
        <linearGradient id="photo-card-ph" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width={w} height={h} fill="url(#photo-card-ph)" />
      <path
        d={`M${w / 2 - m} ${h / 2 + m * 0.6} L${w / 2 - m * 0.2} ${h / 2 - m * 0.3} L${w / 2 + m * 0.3} ${h / 2 + m * 0.25} L${w / 2 + m * 0.6} ${h / 2} L${w / 2 + m} ${h / 2 + m * 0.6} Z`}
        fill={theme.colors.neutral}
        fillOpacity={0.35}
      />
    </svg>
  );
}
