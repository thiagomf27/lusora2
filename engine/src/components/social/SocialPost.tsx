/**
 * SocialPost — a YouTube comment, a tweet, or a Reddit card.
 *
 * DEPICTIVE, and therefore theme-EXEMPT (SKILL Part 3). This component draws a
 * real-world artifact, so it renders that artifact's own chrome and not the
 * channel's. Twitter blue is not the channel's accent; a YouTube comment set in
 * Playfair on a cream plate is not "on brand", it is WRONG — the whole point of
 * putting one on screen is that the viewer recognises where it came from.
 *
 * So: `honors = ["motion.entrance", "surface.density"]` and nothing else. The
 * theme gets to say how it ARRIVES and how much room it takes, and that is all.
 * Do not "fix" this later by wiring in typeScale or seriesColors.
 *
 * `platform` is a PROP, not three components. The chrome differs — an avatar
 * disc versus a rounded square, an upvote arrow versus a heart — but the shape
 * is identical: somebody said something, here is who and when and how it went
 * down. Three components would be three catalog entries with one prop
 * signature between them, which is the collision the lint exists to catch.
 */
import { z } from "zod";
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { PANEL_ENTRANCES, densityScale, useEntrance } from "../theme.ts";

export const SocialPostProps = z.object({
  platform: z.enum(["youtube", "twitter", "reddit"]).default("twitter"),
  author: z.string().max(40),
  handle: z.string().max(30).optional(),
  body: z.string().max(280),
  timestamp: z.string().max(24).optional(),
  metrics: z
    .object({ likes: z.number().min(0).optional(), replies: z.number().min(0).optional() })
    .optional(),
  avatar: z.string().optional(),
});
export type SocialPostProps = z.infer<typeof SocialPostProps>;

/**
 * Each platform's own chrome. These are LITERALS on purpose and they are the
 * one place in the engine where that is correct: they are measurements of
 * something that exists, not choices this project gets to make.
 */
const CHROME = {
  youtube: {
    card: "#ffffff",
    ink: "#0f0f0f",
    muted: "#606060",
    accent: "#065fd4",
    radius: 0.0,
    avatarRadius: 0.5,
    font: "'Roboto', 'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif",
    handlePrefix: "@",
    likeGlyph: "▲",
    replyLabel: "REPLY",
    border: null as string | null,
  },
  twitter: {
    card: "#ffffff",
    ink: "#0f1419",
    muted: "#536471",
    accent: "#1d9bf0",
    radius: 0.055,
    avatarRadius: 0.5,
    font: "'Helvetica Neue', 'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif",
    handlePrefix: "@",
    likeGlyph: "♥",
    replyLabel: "",
    border: "#cfd9de",
  },
  reddit: {
    card: "#ffffff",
    ink: "#1c1c1c",
    muted: "#7c7c7c",
    accent: "#ff4500",
    radius: 0.03,
    avatarRadius: 0.16,
    font: "'IBM Plex Sans', 'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif",
    handlePrefix: "u/",
    likeGlyph: "▲",
    replyLabel: "",
    border: "#ccc",
  },
} as const;

/** Deterministic monogram tint when no avatar file is supplied. */
const MONOGRAM = ["#8e6fb5", "#3d7a5a", "#b5603f", "#3f6bb5", "#a03f6b", "#6b6b3f"];
function monogramColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return MONOGRAM[h % MONOGRAM.length];
}

function compact(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return String(Math.round(n));
}

export function SocialPost({ props, theme }: { props: SocialPostProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  // The two tokens a depictive component takes, and no more.
  const density = densityScale(theme);
  const entrance = useEntrance(theme, {
    component: "SocialPost",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    seconds: 0.4,
  });
  const { opacity } = entrance;

  const c = CHROME[props.platform];
  const cardW = width * 0.56 * (1 + (density - 1) * 0.4);
  const pad = cardW * 0.045;
  const avatar = cardW * 0.075;
  const bodySize = cardW * 0.038;

  // The body types in over the first beat — a comment on screen reads as a
  // comment being READ, and a static block reads as a screenshot.
  const typed = props.body.slice(
    0,
    Math.ceil(
      interpolate(frame, [fps * 0.25, fps * 1.5], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }) * props.body.length,
    ),
  );

  const metricsIn = interpolate(frame, [fps * 1.5, fps * 1.9], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          width: cardW,
          background: c.card,
          borderRadius: cardW * c.radius,
          border: c.border ? `1px solid ${c.border}` : "none",
          boxShadow: "0 10px 40px rgba(0,0,0,0.35)",
          padding: pad,
          display: "flex",
          gap: pad * 0.7,
          fontFamily: c.font,
        }}
      >
        {props.avatar ? (
          <Img
            src={staticFile(props.avatar)}
            style={{
              width: avatar,
              height: avatar,
              borderRadius: avatar * c.avatarRadius,
              objectFit: "cover",
              flexShrink: 0,
            }}
          />
        ) : (
          <div
            style={{
              width: avatar,
              height: avatar,
              borderRadius: avatar * c.avatarRadius,
              background: monogramColor(props.author),
              color: "#fff",
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: avatar * 0.5,
              fontWeight: 500,
            }}
          >
            {props.author.trim().charAt(0).toUpperCase()}
          </div>
        )}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: pad * 0.3, flexWrap: "wrap" }}>
            <span style={{ fontSize: bodySize * 0.92, fontWeight: 700, color: c.ink }}>
              {props.author}
            </span>
            {props.handle ? (
              <span style={{ fontSize: bodySize * 0.88, color: c.muted }}>
                {c.handlePrefix}
                {props.handle.replace(/^[@u]\/?/, "")}
              </span>
            ) : null}
            {props.timestamp ? (
              <span style={{ fontSize: bodySize * 0.88, color: c.muted }}>· {props.timestamp}</span>
            ) : null}
          </div>

          <div
            style={{
              marginTop: pad * 0.35,
              fontSize: bodySize,
              lineHeight: 1.42,
              color: c.ink,
              overflowWrap: "anywhere",
              whiteSpace: "pre-wrap",
            }}
          >
            {typed}
          </div>

          {props.metrics ? (
            <div
              style={{
                marginTop: pad * 0.55,
                display: "flex",
                alignItems: "center",
                gap: pad * 0.9,
                fontSize: bodySize * 0.82,
                color: c.muted,
                opacity: metricsIn,
              }}
            >
              {props.metrics.likes !== undefined ? (
                <span style={{ display: "flex", alignItems: "center", gap: pad * 0.22 }}>
                  <span style={{ color: props.platform === "reddit" ? c.accent : c.muted }}>
                    {c.likeGlyph}
                  </span>
                  {compact(props.metrics.likes)}
                </span>
              ) : null}
              {props.metrics.replies !== undefined ? (
                <span>
                  {compact(props.metrics.replies)}
                  {props.platform === "reddit" ? " comments" : " replies"}
                </span>
              ) : null}
              {c.replyLabel ? (
                <span style={{ fontWeight: 700, letterSpacing: "0.02em" }}>{c.replyLabel}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * DEPICTIVE: the theme decides how it arrives and how much room it takes, and
 * nothing else. See the header — this list is deliberately short.
 */
SocialPost.honors = ["motion.entrance", "surface.density"];
