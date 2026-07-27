/**
 * SatelliteLocate — "here is the place": a satellite plate, a crosshair drawing
 * onto the coordinate, a pulsing ring and a label wiping out from the marker.
 *
 * PLATE CONVENTION (shared verbatim by SatelliteLocate / RouteMap /
 * RegionHighlight — each file keeps its own copy so it stays single-file
 * portable):
 *
 *   A plate is an equirectangular (Plate Carrée) crop declared by its own
 *   bounds. Export from a source that reports its bbox — NASA Worldview and
 *   Visible Earth (public domain), USGS EarthExplorer / Landsat (public
 *   domain), Copernicus Browser / Sentinel-2 (CC BY-SA) — with projection set
 *   to Geographic, drop the file in public/, and pass the bbox as `plate`.
 *   Pixel mapping is then linear in both axes:
 *
 *     x = ((lng - west)  / (east - west))  * plateW
 *     y = ((north - lat) / (north - south)) * plateH
 *
 *   The plate is LETTERBOXED at its own bbox aspect ratio. Never objectFit:
 *   "cover" it into the frame — the projection would stop matching the pixels
 *   and every marker would land in the wrong place.
 *
 *   Caveat accepted, not fixed: at high latitudes Plate Carrée stretches
 *   horizontally. Correcting by cos(lat) would look nicer but would then
 *   disagree with the exported plate's own pixels. The plate's projection is
 *   ground truth.
 *
 * With no `plate` the component derives a bbox at the frame's aspect ratio and
 * draws a schematic stand-in, so it renders meaningfully with zero assets.
 * staticFile() is only ever called inside the `plate` branch — resolving a
 * missing file errors the render.
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
  surfaceStyle,
  useEntrance,
} from "../theme.ts";

const plateSchema = z.object({
  /** Path under public/, e.g. "plates/stalingrad.jpg". */
  src: z.string().max(120),
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
});

export const SatelliteLocateProps = z.object({
  place_name: z.string().max(40),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().max(40).optional(),
  country: z.string().max(32).optional(),
  zoom: z.enum(["city", "region", "country", "continent"]).default("region"),
  framing: z.enum(["full", "panel"]).default("full"),
  plate: plateSchema.optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type SatelliteLocateProps = z.infer<typeof SatelliteLocateProps>;

/** Latitude span in degrees per zoom step. Same table as the older AnimatedMap. */
const ZOOM_SPAN: Record<string, number> = { city: 4, region: 12, country: 30, continent: 70 };

export function SatelliteLocate({ props, theme }: { props: SatelliteLocateProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "SatelliteLocate",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.5,
  });
  const { opacity, inDur } = entrance;
  const surface = surfaceStyle(theme, { radius: 10 });

  const panel = props.framing === "panel";
  const boxW = panel ? width * 0.42 : width;
  const boxH = panel ? boxW * 0.7 : height;

  // Bounds: the plate's own bbox, or a derived window at the box aspect ratio.
  const latSpan = ZOOM_SPAN[props.zoom] ?? 12;
  const lngSpan = latSpan * (boxW / boxH);
  const west = props.plate ? props.plate.west : props.lng - lngSpan / 2;
  const east = props.plate ? props.plate.east : props.lng + lngSpan / 2;
  const south = props.plate ? props.plate.south : props.lat - latSpan / 2;
  const north = props.plate ? props.plate.north : props.lat + latSpan / 2;

  const plateAspect = (east - west) / (north - south);
  const plateW = Math.min(boxW, boxH * plateAspect);
  const plateH = plateW / plateAspect;
  const project = (lat: number, lng: number) => ({
    x: ((lng - west) / (east - west)) * plateW,
    y: ((north - lat) / (north - south)) * plateH,
  });
  const target = project(props.lat, props.lng);

  const grain = theme.grain ?? "none";
  const grainOpacity = grain === "archival" ? 0.14 : grain === "film" ? 0.08 : 0;
  const grainSeed = Math.floor(frame / 2) % 12;

  const crossStart = Math.round(fps * 0.4 * durationMul);
  const crossDur = Math.round(fps * 0.5 * durationMul);
  const crossLen = plateW * 0.5;
  const cross = interpolate(frame, [crossStart, crossStart + crossDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const pulse = (frame / fps) % 1.6;
  const labelStart = Math.round(fps * 1.0 * durationMul);
  const ringR = plateH * 0.03;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: panel ? "flex-end" : "center",
        padding: panel ? `0 ${width * 0.05}px` : 0,
        opacity,
      }}
    >
      <div
        style={{
          position: "relative",
          width: plateW,
          height: plateH,
          overflow: "hidden",
          borderRadius: panel ? surface.borderRadius : 0,
          border: panel ? `1px solid ${theme.colors.neutral}55` : "none",
          background: theme.colors.bg,
        }}
      >
        {/* Slow push in on the target for the whole shot. */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            transformOrigin: `${target.x}px ${target.y}px`,
            scale: `${interpolate(frame, [0, durationInFrames], [1.08, 1.0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            })}`,
          }}
        >
          {props.plate ? (
            <Img src={staticFile(props.plate.src)} style={{ width: "100%", height: "100%", objectFit: "fill" }} />
          ) : (
            <ProceduralPlate
              theme={theme}
              width={plateW}
              height={plateH}
              west={west}
              east={east}
              south={south}
              north={north}
            />
          )}
        </div>

        {grainOpacity > 0 ? (
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grainOpacity, pointerEvents: "none" }}>
            <svg width={plateW} height={plateH}>
              <filter id="satellite-locate-grain">
                <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect width={plateW} height={plateH} filter="url(#satellite-locate-grain)" />
            </svg>
          </div>
        ) : null}

        <svg width={plateW} height={plateH} style={{ position: "absolute", inset: 0 }}>
          {/* Crosshair arms draw outward from the coordinate. */}
          {[
            { x2: target.x - crossLen, y2: target.y },
            { x2: target.x + crossLen, y2: target.y },
            { x2: target.x, y2: target.y - crossLen },
            { x2: target.x, y2: target.y + crossLen },
          ].map((arm, i) => (
            <line
              key={i}
              x1={target.x}
              y1={target.y}
              x2={arm.x2}
              y2={arm.y2}
              stroke={accent}
              strokeOpacity={0.75}
              strokeWidth={Math.max(1.5, plateH * 0.0025)}
              strokeDasharray={crossLen}
              strokeDashoffset={crossLen * (1 - cross)}
            />
          ))}
          <circle
            cx={target.x}
            cy={target.y}
            r={interpolate(pulse, [0, 1.6], [ringR, ringR * 4])}
            fill="none"
            stroke={accent}
            strokeOpacity={interpolate(pulse, [0, 1.6], [0.7, 0]) * cross}
            strokeWidth={Math.max(2, plateH * 0.004)}
          />
          <circle cx={target.x} cy={target.y} r={ringR * 0.55} fill={accent} fillOpacity={cross} />
        </svg>

        {/* Label wipes out from the marker. */}
        <div
          style={{
            position: "absolute",
            left: target.x + ringR * 2,
            top: target.y - plateH * 0.045,
            maxWidth: plateW * 0.45,
            background: `${theme.colors.bg}e0`,
            borderLeft: `${Math.max(3, plateH * 0.006)}px solid ${accent}`,
            padding: `${plateH * 0.016}px ${plateW * 0.018}px`,
            clipPath: `inset(0 ${interpolate(frame, [labelStart, labelStart + fps * 0.4 * durationMul], [100, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })}% 0 0)`,
          }}
        >
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: plateH * 0.055,
              fontWeight: 700,
              color: theme.colors.text,
              whiteSpace: "nowrap",
            }}
          >
            {props.label ?? props.place_name}
          </div>
          <div
            style={{
              marginTop: plateH * 0.008,
              fontFamily: fontStack(theme.typography.body),
              fontSize: plateH * 0.028,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "0.08em",
              color: theme.colors.neutral,
              whiteSpace: "nowrap",
            }}
          >
            {props.lat.toFixed(3)}°{props.lat >= 0 ? "N" : "S"} {Math.abs(props.lng).toFixed(3)}°
            {props.lng >= 0 ? "E" : "W"}
            {props.country ? ` · ${props.country}` : ""}
          </div>
        </div>

        {props.plate ? null : (
          <div
            style={{
              position: "absolute",
              right: plateW * 0.02,
              bottom: plateH * 0.02,
              fontFamily: fontStack(theme.typography.body),
              fontSize: plateH * 0.026,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: theme.colors.neutral,
              opacity: 0.35,
            }}
          >
            schematic
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Stand-in for a missing plate: a seeded terrain mosaic, a few coastlines and
 * a graticule projected through the SAME bounds, so the geography stays
 * honest even when the imagery is fake.
 */
function ProceduralPlate({
  theme,
  width,
  height,
  west,
  east,
  south,
  north,
}: {
  theme: Theme;
  width: number;
  height: number;
  west: number;
  east: number;
  south: number;
  north: number;
}) {
  const cols = 24;
  const rows = 14;
  const cellW = width / cols;
  const cellH = height / rows;
  const lines = 6;
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
          fillOpacity={0.06 + random(`sl-plate-${i}`) * 0.1}
        />
      ))}
      {[0.32, 0.61].map((band, i) => (
        <path
          key={i}
          d={new Array(13)
            .fill(0)
            .map((_, k) => {
              const x = (k / 12) * width;
              const y = height * band + Math.sin(k * 0.8 + i * 1.7) * height * 0.05;
              return `${k === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`;
            })
            .join(" ")}
          fill="none"
          stroke={theme.colors.neutral}
          strokeOpacity={0.35}
          strokeWidth={Math.max(1, height * 0.002)}
        />
      ))}
      {new Array(lines + 1).fill(0).map((_, i) => {
        const x = (i / lines) * width;
        const y = (i / lines) * height;
        const lngAt = west + ((east - west) * i) / lines;
        const latAt = north - ((north - south) * i) / lines;
        return (
          <g key={i} stroke={theme.colors.neutral} strokeOpacity={0.18}>
            <line x1={x} y1={0} x2={x} y2={height} />
            <line x1={0} y1={y} x2={width} y2={y} />
            <text
              x={x + 4}
              y={height - 6}
              fill={theme.colors.neutral}
              fillOpacity={0.5}
              stroke="none"
              fontSize={height * 0.022}
              fontFamily={fontStack(theme.typography.body)}
            >
              {lngAt.toFixed(1)}°
            </text>
            <text
              x={4}
              y={y - 4}
              fill={theme.colors.neutral}
              fillOpacity={0.5}
              stroke="none"
              fontSize={height * 0.022}
              fontFamily={fontStack(theme.typography.body)}
            >
              {latAt.toFixed(1)}°
            </text>
          </g>
        );
      })}
    </svg>
  );
}
