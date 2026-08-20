/**
 * WebPageFrame — a screenshot inside browser chrome, with a slow push toward
 * the part that matters.
 *
 * DEPICTIVE, theme-EXEMPT (SKILL Part 3). A browser window is a real artifact;
 * rendering it in the channel's accent would say "we made this page", which is
 * the opposite of the claim. The chrome is a light window because that is what
 * a browser looks like.
 *
 * `highlight_region` is what separates this from `FramedExhibit` showing the
 * same PNG: the point of a screenshot is almost never the whole page, it is one
 * paragraph or one number, and a still of a full page at 1280 wide is
 * unreadable. The region drives a push-in, so the shot arrives showing the page
 * and ends showing the sentence.
 */
import { z } from "zod";
import { Img, interpolate, staticFile, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { Theme } from "../theme.ts";
import { PANEL_ENTRANCES, densityScale, easingCurve, useEntrance } from "../theme.ts";

export const WebPageFrameProps = z.object({
  image: z.string().optional(),
  url: z.string().max(80).optional(),
  /** Fractions of the image; the shot pushes in on this. Omitted holds the page. */
  highlight_region: z
    .object({
      x: z.number().min(0).max(1),
      y: z.number().min(0).max(1),
      w: z.number().min(0.05).max(1),
      h: z.number().min(0.05).max(1),
    })
    .optional(),
  caption: z.string().max(90).optional(),
});
export type WebPageFrameProps = z.infer<typeof WebPageFrameProps>;

/**
 * A deterministic wireframe for when no screenshot is supplied — a headline, a
 * byline, some paragraph rules. Not the satellite plate the map components use:
 * a browser window standing in with terrain in it reads as a bug, and the
 * whole value of a placeholder is that the shot still parses.
 */
function PagePlaceholder({ w, h }: { w: number; h: number }) {
  const line = (i: number) => 0.62 + ((i * 37) % 31) / 100; // fixed, not random
  return (
    <svg width={w} height={h} style={{ display: "block" }}>
      <rect width={w} height={h} fill="#ffffff" />
      <rect x={w * 0.08} y={h * 0.1} width={w * 0.52} height={h * 0.07} rx={2} fill="#d7dae0" />
      <rect x={w * 0.08} y={h * 0.22} width={w * 0.24} height={h * 0.028} rx={2} fill="#e6e9ee" />
      {Array.from({ length: 7 }, (_, i) => (
        <rect
          key={i}
          x={w * 0.08}
          y={h * (0.32 + i * 0.072)}
          width={w * 0.84 * line(i)}
          height={h * 0.026}
          rx={2}
          fill="#eceef2"
        />
      ))}
    </svg>
  );
}

const CHROME = {
  bar: "#e8eaed",
  barInk: "#3c4043",
  page: "#ffffff",
  urlField: "#ffffff",
  outline: "#dadce0",
  dots: ["#ff5f57", "#febc2e", "#28c840"],
};

export function WebPageFrame({ props, theme }: { props: WebPageFrameProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const density = densityScale(theme);
  const entrance = useEntrance(theme, {
    component: "WebPageFrame",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    seconds: 0.45,
  });
  const { opacity } = entrance;
  const curve = Easing.bezier(...easingCurve(theme));

  const winW = width * 0.7 * (1 + (density - 1) * 0.3);
  const barH = winW * 0.048;
  const pageW = winW;
  const pageH = winW * 0.56;

  // The push runs across the whole hold rather than as an entrance: it is the
  // reading gesture, not the arrival, and it has to still be moving when the
  // narration reaches the sentence it is pointing at.
  const r = props.highlight_region;
  const push = interpolate(frame, [fps * 0.6, durationInFrames - fps * 0.4], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const zoom = r ? 1 + (Math.min(1 / r.w, 1 / r.h) - 1) * 0.75 * push : 1;
  // Translate so the region's centre walks to the middle of the viewport.
  const tx = r ? (0.5 - (r.x + r.w / 2)) * pageW * zoom * push : 0;
  const ty = r ? (0.5 - (r.y + r.h / 2)) * pageH * zoom * push : 0;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
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
          width: winW,
          borderRadius: winW * 0.012,
          overflow: "hidden",
          boxShadow: "0 18px 60px rgba(0,0,0,0.45)",
          border: `1px solid ${CHROME.outline}`,
          fontFamily: "'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif",
        }}
      >
        <div
          style={{
            height: barH,
            background: CHROME.bar,
            display: "flex",
            alignItems: "center",
            gap: barH * 0.24,
            padding: `0 ${barH * 0.4}px`,
          }}
        >
          {CHROME.dots.map((d) => (
            <div key={d} style={{ width: barH * 0.2, height: barH * 0.2, borderRadius: "50%", background: d }} />
          ))}
          <div
            style={{
              marginLeft: barH * 0.4,
              flex: 1,
              height: barH * 0.58,
              borderRadius: barH * 0.29,
              background: CHROME.urlField,
              border: `1px solid ${CHROME.outline}`,
              display: "flex",
              alignItems: "center",
              padding: `0 ${barH * 0.36}px`,
              fontSize: barH * 0.32,
              color: CHROME.barInk,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {props.url ?? ""}
          </div>
        </div>

        <div style={{ position: "relative", width: pageW, height: pageH, overflow: "hidden", background: CHROME.page }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              translate: `${tx}px ${ty}px`,
              scale: `${zoom}`,
              transformOrigin: "center center",
            }}
          >
            {props.image ? (
              <Img src={staticFile(props.image)} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: "top" }} />
            ) : (
              <PagePlaceholder w={pageW} h={pageH} />
            )}
          </div>
        </div>
      </div>

      {props.caption ? (
        <div
          style={{
            marginTop: height * 0.026 * density,
            maxWidth: winW,
            textAlign: "center",
            fontFamily: "'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif",
            fontSize: height * 0.024,
            color: "#ffffff",
            textShadow: "0 2px 10px rgba(0,0,0,0.85)",
            opacity: interpolate(frame, [fps * 0.5, fps * 0.9], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.caption}
        </div>
      ) : null}
    </div>
  );
}

/** DEPICTIVE: arrival and room only. See the header. */
WebPageFrame.honors = ["motion.entrance", "surface.density"];
