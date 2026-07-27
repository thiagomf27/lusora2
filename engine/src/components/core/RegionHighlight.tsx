/**
 * RegionHighlight — a territory outlined, filled and labelled from its centroid.
 *
 * PLATE CONVENTION — see SatelliteLocate.tsx for the full note. Same
 * equirectangular bbox contract, duplicated here so this file stays single-file
 * portable: x = ((lng - west)/(east - west)) * plateW,
 *           y = ((north - lat)/(north - south)) * plateH.
 * With no `plate` the bounds come from the polygon (padded, then expanded to
 * the frame's aspect ratio) and a schematic stand-in is drawn. staticFile() is
 * only called inside the `plate` branch.
 *
 * Record the source and effective date of contested or custom borders in
 * `annotation` — a highlighted region is a claim, and the shot should say when
 * it was true.
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

const plateSchema = z.object({
  src: z.string().max(120),
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
});

export const RegionHighlightProps = z.object({
  region_name: z.string().max(40),
  polygon: z
    .array(z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }))
    .min(3)
    .max(64),
  label: z.string().max(40).optional(),
  annotation: z.string().max(40).optional(),
  plate: plateSchema.optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type RegionHighlightProps = z.infer<typeof RegionHighlightProps>;

export function RegionHighlight({ props, theme }: { props: RegionHighlightProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "RegionHighlight",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.5,
  });
  const { opacity, inDur } = entrance;

  const lats = props.polygon.map((p) => p.lat);
  const lngs = props.polygon.map((p) => p.lng);
  const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.25, 1);
  const padLng = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.25, 1);
  let west = Math.min(...lngs) - padLng;
  let east = Math.max(...lngs) + padLng;
  let south = Math.min(...lats) - padLat;
  let north = Math.max(...lats) + padLat;
  const frameAspect = width / height;
  if ((east - west) / (north - south) < frameAspect) {
    const want = (north - south) * frameAspect;
    const mid = (east + west) / 2;
    west = mid - want / 2;
    east = mid + want / 2;
  } else {
    const want = (east - west) / frameAspect;
    const mid = (north + south) / 2;
    south = mid - want / 2;
    north = mid + want / 2;
  }
  if (props.plate) {
    west = props.plate.west;
    east = props.plate.east;
    south = props.plate.south;
    north = props.plate.north;
  }

  const plateAspect = (east - west) / (north - south);
  const plateW = Math.min(width, height * plateAspect);
  const plateH = plateW / plateAspect;
  const project = (lat: number, lng: number) => ({
    x: ((lng - west) / (east - west)) * plateW,
    y: ((north - lat) / (north - south)) * plateH,
  });

  const ring = props.polygon.map((p) => project(p.lat, p.lng));
  const d = `${ring.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ")} Z`;
  let perimeter = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    perimeter += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const centroid = {
    x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
    y: ring.reduce((sum, p) => sum + p.y, 0) / ring.length,
  };

  const outlineDur = Math.round(fps * 1.0 * durationMul);
  const outline = interpolate(frame, [inDur * 0.5, inDur * 0.5 + outlineDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const fillStart = inDur * 0.5 + outlineDur * 0.7;
  const outStart = durationInFrames - Math.round(fps * 0.5 * durationMul);
  // Fill fades in behind the outline, and fades out before it on the way back.
  const fill = Math.min(
    interpolate(frame, [fillStart, fillStart + fps * 0.6 * durationMul], [0, 0.22], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
    interpolate(frame, [outStart, outStart + fps * 0.3], [0.22, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    }),
  );
  const labelStart = Math.round(fps * 1.3 * durationMul);
  const leaderEnd = { x: centroid.x + plateW * 0.14, y: centroid.y - plateH * 0.12 };
  const leaderLen = Math.hypot(leaderEnd.x - centroid.x, leaderEnd.y - centroid.y);

  const grain = theme.grain ?? "none";
  const grainOpacity = grain === "archival" ? 0.12 : grain === "film" ? 0.07 : 0;
  const grainSeed = Math.floor(frame / 2) % 12;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity, translate: entrance.translate, scale: `${entrance.scale}`, clipPath: entrance.clipPath }}>
      <div style={{ position: "relative", width: plateW, height: plateH, overflow: "hidden", background: theme.colors.bg }}>
        {props.plate ? (
          <Img src={staticFile(props.plate.src)} style={{ width: "100%", height: "100%", objectFit: "fill" }} />
        ) : (
          <ProceduralPlate theme={theme} width={plateW} height={plateH} />
        )}

        {grainOpacity > 0 ? (
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grainOpacity, pointerEvents: "none" }}>
            <svg width={plateW} height={plateH}>
              <filter id="region-highlight-grain">
                <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect width={plateW} height={plateH} filter="url(#region-highlight-grain)" />
            </svg>
          </div>
        ) : null}

        <svg width={plateW} height={plateH} style={{ position: "absolute", inset: 0 }}>
          <path d={d} fill={accent} fillOpacity={fill} stroke="none" />
          <path
            d={d}
            fill="none"
            stroke={accent}
            strokeWidth={Math.max(3, plateH * 0.005)}
            strokeLinejoin="round"
            strokeDasharray={perimeter}
            strokeDashoffset={perimeter * (1 - outline)}
          />
          {/* Second, drifting dashed stroke — reads as "contested / approximate". */}
          <path
            d={d}
            fill="none"
            stroke={theme.colors.text}
            strokeOpacity={0.35 * outline}
            strokeWidth={Math.max(1.5, plateH * 0.002)}
            strokeDasharray={`${plateH * 0.02} ${plateH * 0.02}`}
            strokeDashoffset={-(frame / fps) * plateH * 0.05}
          />
          <line
            x1={centroid.x}
            y1={centroid.y}
            x2={leaderEnd.x}
            y2={leaderEnd.y}
            stroke={accent}
            strokeWidth={Math.max(2, plateH * 0.003)}
            strokeDasharray={leaderLen}
            strokeDashoffset={leaderLen * (1 - interpolate(frame, [labelStart, labelStart + fps * 0.35 * durationMul], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            }))}
          />
          <circle cx={centroid.x} cy={centroid.y} r={plateH * 0.008} fill={accent} fillOpacity={outline} />
        </svg>

        <div
          style={{
            position: "absolute",
            left: leaderEnd.x,
            top: leaderEnd.y - plateH * 0.06,
            maxWidth: plateW * 0.4,
            background: `${theme.colors.bg}e0`,
            borderBottom: `${Math.max(3, plateH * 0.005)}px solid ${accent}`,
            padding: `${plateH * 0.016}px ${plateW * 0.018}px`,
            clipPath: `inset(0 ${interpolate(frame, [labelStart + 6, labelStart + 6 + fps * 0.4 * durationMul], [100, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: curve,
            })}% 0 0)`,
          }}
        >
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: plateH * 0.05,
              fontWeight: 700,
              color: theme.colors.text,
              whiteSpace: "nowrap",
            }}
          >
            {props.label ?? props.region_name}
          </div>
          {props.annotation ? (
            <div
              style={{
                marginTop: plateH * 0.008,
                fontFamily: fontStack(theme.typography.body),
                fontSize: plateH * 0.028,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: theme.colors.neutral,
                whiteSpace: "nowrap",
              }}
            >
              {props.annotation}
            </div>
          ) : null}
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

/** Seeded stand-in for a missing plate — deliberately schematic. */
function ProceduralPlate({ theme, width, height }: { theme: Theme; width: number; height: number }) {
  const cols = 26;
  const rows = 15;
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
          fillOpacity={0.05 + random(`rh-plate-${i}`) * 0.1}
        />
      ))}
      {new Array(7).fill(0).map((_, i) => (
        <g key={i} stroke={theme.colors.neutral} strokeOpacity={0.16}>
          <line x1={(i / 6) * width} y1={0} x2={(i / 6) * width} y2={height} />
          <line x1={0} y1={(i / 6) * height} x2={width} y2={(i / 6) * height} />
        </g>
      ))}
    </svg>
  );
}
