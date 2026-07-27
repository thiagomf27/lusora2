/**
 * FramedExhibit — a photograph presented as a museum exhibit: frame, slow
 * ken-burns push inside it, a hairline drawing around the perimeter and a
 * caption plate rising from beneath.
 *
 * `image` is optional and staticFile() is only called when it is set —
 * resolving a missing file errors the render. With no asset a procedural
 * plate stands in so the shot still reads.
 *
 * Grain is clipped to the picture area only (see DocumentCard for why).
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

export const FramedExhibitProps = z.object({
  /** Path under public/, e.g. "exhibits/redoctober.jpg". */
  image: z.string().max(120).optional(),
  caption: z.string().max(120),
  credit: z.string().max(48).optional(),
  frame_style: z.enum(["museum", "polaroid", "hairline"]).default("museum"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type FramedExhibitProps = z.infer<typeof FramedExhibitProps>;

export function FramedExhibit({ props, theme }: { props: FramedExhibitProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "FramedExhibit",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.5,
  });
  const { opacity, inDur } = entrance;

  const museum = props.frame_style === "museum";
  const polaroid = props.frame_style === "polaroid";
  const matPad = museum ? height * 0.028 : polaroid ? height * 0.022 : 0;

  const picW = width * 0.52;
  const picH = picW * 0.66;
  const captionStart = Math.round(fps * 0.6 * durationMul);
  const perimeter = 2 * (picW + matPad * 2 + picH + matPad * 2);

  const grain = theme.grain ?? "none";
  const grainOpacity = grain === "archival" ? 0.15 : grain === "film" ? 0.08 : 0;
  const grainSeed = Math.floor(frame / 2) % 12;

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
          position: "relative",
          padding: matPad,
          paddingBottom: polaroid ? matPad * 3 : matPad,
          background: museum ? `${theme.colors.bg}f2` : polaroid ? `${theme.colors.text}f2` : "transparent",
          border: museum ? `1px solid ${theme.colors.neutral}66` : "none",
          boxShadow: props.frame_style === "hairline" ? "none" : "0 20px 60px rgba(0,0,0,0.55)",
          scale: `${interpolate(frame, [0, inDur], [1.04, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          })}`,
        }}
      >
        <div style={{ position: "relative", width: picW, height: picH, overflow: "hidden", background: theme.colors.bg }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              // Slow push across the whole shot.
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
              <ProceduralPlate theme={theme} width={picW} height={picH} />
            )}
          </div>

          {grainOpacity > 0 ? (
            <div style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grainOpacity, pointerEvents: "none" }}>
              <svg width={picW} height={picH}>
                <filter id="framed-exhibit-grain">
                  <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
                  <feColorMatrix type="saturate" values="0" />
                </filter>
                <rect width={picW} height={picH} filter="url(#framed-exhibit-grain)" />
              </svg>
            </div>
          ) : null}
        </div>

        {/* Hairline traces the frame perimeter. */}
        <svg
          width={picW + matPad * 2}
          height={picH + matPad * 2}
          style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none" }}
        >
          <rect
            x={1}
            y={1}
            width={picW + matPad * 2 - 2}
            height={picH + matPad * 2 - 2}
            fill="none"
            stroke={accent}
            strokeWidth={Math.max(2, height * 0.003)}
            strokeDasharray={perimeter}
            strokeDashoffset={interpolate(frame, [inDur * 0.4, inDur * 0.4 + fps * 0.8 * durationMul], [perimeter, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            })}
          />
        </svg>
      </div>

      <div
        style={{
          marginTop: height * 0.03,
          maxWidth: width * 0.6,
          textAlign: "center",
          opacity: interpolate(frame, [captionStart, captionStart + fps * 0.5], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: `0 ${interpolate(frame, [captionStart, captionStart + fps * 0.5], [height * 0.02, 0], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          })}px`,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.028,
            lineHeight: 1.35,
            color: theme.colors.text,
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {props.caption}
        </div>
        {props.credit ? (
          <div
            style={{
              marginTop: height * 0.01,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.02,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: theme.colors.neutral,
            }}
          >
            {props.credit}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Seeded stand-in for a missing still — deliberately schematic. */
function ProceduralPlate({ theme, width, height }: { theme: Theme; width: number; height: number }) {
  const cols = 18;
  const rows = 12;
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
          fillOpacity={0.05 + random(`fe-plate-${i}`) * 0.12}
        />
      ))}
      <line x1={width * 0.5} y1={height * 0.42} x2={width * 0.5} y2={height * 0.58} stroke={theme.colors.neutral} strokeOpacity={0.5} />
      <line x1={width * 0.44} y1={height * 0.5} x2={width * 0.56} y2={height * 0.5} stroke={theme.colors.neutral} strokeOpacity={0.5} />
    </svg>
  );
}
