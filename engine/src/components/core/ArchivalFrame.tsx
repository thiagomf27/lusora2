/**
 * ArchivalFrame — full-frame footage treatment: grain boil, vignette, dust,
 * gate flicker, optional sprocket strips and a slate line.
 *
 * This is the only component allowed to draw grain full-frame, because being
 * full-frame IS the component. Everywhere else in the catalog grain must stay
 * clipped inside a plate (paper, photo, map) — these render as overlays over
 * live footage in the engine, and an unclipped grain/vignette div would grain
 * and darken the underlying video rather than just the overlay.
 *
 * Determinism: feTurbulence's seed is an integer derived from the frame, and
 * every speck position comes from remotion's seeded random() — never
 * Math.random(), which would differ between render passes.
 *
 * `image` is optional. With no asset it draws a procedural plate so the shot
 * is still meaningful; staticFile() is only ever called inside that branch,
 * because resolving a missing file errors the render.
 */
import { z } from "zod";
import { Easing, Img, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  useEntrance,
} from "../theme.ts";

export const ArchivalFrameProps = z.object({
  /** Path under public/, e.g. "exhibits/stalingrad.jpg". Omit for a procedural plate. */
  image: z.string().max(120).optional(),
  slate: z.string().max(48).optional(),
  date: z.string().max(24).optional(),
  /** "auto" follows theme.grain; the explicit values let you preview a look without switching theme. */
  treatment: z.enum(["auto", "archival", "film", "none"]).default("auto"),
  flicker: z.boolean().default(true),
  sprocket: z.boolean().default(false),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type ArchivalFrameProps = z.infer<typeof ArchivalFrameProps>;

export function ArchivalFrame({ props, theme }: { props: ArchivalFrameProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "ArchivalFrame",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.5,
  });
  const { opacity, inDur } = entrance;

  const look = props.treatment === "auto" ? (theme.grain ?? "none") : props.treatment;
  const grainOpacity = look === "archival" ? 0.16 : look === "film" ? 0.09 : 0;
  // 15 Hz boil at 30fps, bounded to a 12-state loop so the filter result caches.
  const grainSeed = Math.floor(frame / 2) % 12;
  // Gate flicker: seeded per 2-frame bucket, so it is identical on every render.
  const gate = props.flicker && look !== "none"
    ? interpolate(random(`af-flick-${Math.floor(frame / 2)}`), [0, 1], [0.94, 1])
    : 1;

  const specks = look === "archival" ? 14 : look === "film" ? 6 : 0;
  const dustBucket = Math.floor(frame / 3);

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", opacity, translate: entrance.translate, scale: `${entrance.scale}`, clipPath: entrance.clipPath }}>
      {/* Plate: real still, or a procedural stand-in when no asset is supplied. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          opacity: gate,
          scale: `${interpolate(frame, [0, durationInFrames], [1.0, 1.06], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.45, 0, 0.55, 1),
          })}`,
        }}
      >
        {props.image ? (
          <Img src={staticFile(props.image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <ProceduralPlate theme={theme} width={width} height={height} />
        )}
      </div>

      {/* Grain: fractal noise, overlay-blended, reseeded every other frame. */}
      {grainOpacity > 0 ? (
        <div style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grainOpacity, pointerEvents: "none" }}>
          <svg width={width} height={height}>
            <filter id="archival-frame-grain">
              <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
              <feColorMatrix type="saturate" values="0" />
            </filter>
            <rect width={width} height={height} filter="url(#archival-frame-grain)" />
          </svg>
        </div>
      ) : null}

      {/* Scanlines only for the "film" look, drifting slowly downward. */}
      {look === "film" ? (
        <div
          style={{
            position: "absolute",
            inset: `-${height * 0.02}px 0`,
            pointerEvents: "none",
            opacity: 0.22,
            background: `repeating-linear-gradient(to bottom, ${theme.colors.bg} 0px, ${theme.colors.bg} 1px, transparent 1px, transparent 3px)`,
            translate: `0 ${(frame / fps) % 3}px`,
          }}
        />
      ) : null}

      {/* Dust specks and a wandering hair scratch — archival only. */}
      {specks > 0 ? (
        <svg width={width} height={height} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
          {new Array(specks).fill(0).map((_, i) => (
            <circle
              key={i}
              cx={random(`af-dust-x-${i}-${dustBucket}`) * width}
              cy={random(`af-dust-y-${i}-${dustBucket}`) * height}
              r={0.6 + random(`af-dust-r-${i}-${dustBucket}`) * (height * 0.0025)}
              fill={random(`af-dust-t-${i}-${dustBucket}`) > 0.5 ? theme.colors.text : theme.colors.bg}
              fillOpacity={0.35}
            />
          ))}
          <line
            x1={width * (0.2 + random(`af-hair-${dustBucket}`) * 0.6)}
            y1={0}
            x2={width * (0.2 + random(`af-hair-${dustBucket}`) * 0.6) + width * 0.01}
            y2={height}
            stroke={theme.colors.text}
            strokeOpacity={0.12}
            strokeWidth={1}
          />
        </svg>
      ) : null}

      {/* Vignette: a static gradient, not a CSS animation. */}
      {look !== "none" ? (
        <div
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            background: `radial-gradient(ellipse at center, transparent 45%, ${theme.colors.bg}cc 100%)`,
          }}
        />
      ) : null}

      {/* Sprocket strips down both edges. */}
      {props.sprocket
        ? [0, 1].map((side) => (
            <div
              key={side}
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: side === 0 ? 0 : undefined,
                right: side === 1 ? 0 : undefined,
                width: width * 0.035,
                background: `${theme.colors.bg}e6`,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-around",
                alignItems: "center",
                translate: `0 ${((frame / fps) * height * 0.02) % (height * 0.12)}px`,
              }}
            >
              {new Array(9).fill(0).map((_, i) => (
                <div
                  key={i}
                  style={{
                    width: width * 0.016,
                    height: height * 0.035,
                    borderRadius: 3,
                    background: theme.colors.text,
                    opacity: 0.75,
                  }}
                />
              ))}
            </div>
          ))
        : null}

      {/* Slate line. */}
      {props.slate || props.date ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.06,
            right: width * 0.06,
            bottom: height * 0.08,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: width * 0.03,
            opacity: interpolate(frame, [inDur, inDur + fps * 0.5], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.slate ? (
            <div
              style={{
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.028,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color: theme.colors.text,
                borderLeft: `${Math.max(2, height * 0.005)}px solid ${accent}`,
                paddingLeft: width * 0.014,
              }}
            >
              {props.slate}
            </div>
          ) : (
            <div />
          )}
          {props.date ? (
            <div
              style={{
                fontFamily: fontStack(theme.typography.body),
                fontSize: height * 0.024,
                fontVariantNumeric: "tabular-nums",
                color: theme.colors.neutral,
                letterSpacing: "0.1em",
                whiteSpace: "nowrap",
              }}
            >
              {props.date}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Seeded stand-in for a missing still: a neutral mosaic plus soft horizon
 * bands. Deliberately schematic so a missing asset is obvious on screen.
 */
function ProceduralPlate({ theme, width, height }: { theme: Theme; width: number; height: number }) {
  const cols = 24;
  const rows = 14;
  const cellW = width / cols;
  const cellH = height / rows;
  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.colors.bg} />
      {new Array(cols * rows).fill(0).map((_, i) => (
        <rect
          key={i}
          x={(i % cols) * cellW}
          y={Math.floor(i / cols) * cellH}
          width={cellW}
          height={cellH}
          fill={theme.colors.neutral}
          fillOpacity={0.05 + random(`af-plate-${i}`) * 0.12}
        />
      ))}
      {[0.34, 0.58, 0.78].map((band, i) => (
        <path
          key={i}
          d={new Array(13)
            .fill(0)
            .map((_, k) => {
              const x = (k / 12) * width;
              const y = height * band + Math.sin(k * 0.9 + i * 2.1) * height * 0.03;
              return `${k === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke={theme.colors.neutral}
          strokeOpacity={0.3}
          strokeWidth={Math.max(1, height * 0.002)}
        />
      ))}
    </svg>
  );
}
