/**
 * RouteMap — a journey drawn stop to stop, each waypoint popping as the line
 * reaches it.
 *
 * PLATE CONVENTION — see SatelliteLocate.tsx for the full note. Same
 * equirectangular bbox contract, duplicated here so this file stays single-file
 * portable: x = ((lng - west)/(east - west)) * plateW,
 *           y = ((north - lat)/(north - south)) * plateH.
 * With no `plate` the bounds come from the stops themselves (padded, then
 * expanded to the frame's aspect ratio) and a schematic stand-in is drawn.
 * staticFile() is only called inside the `plate` branch.
 *
 * The reveal is strokeDashoffset over the summed projected polyline length —
 * exact for "march", and for "flight"/"sea" the bowed segments are sampled
 * into the same polyline so one length sum still drives everything.
 */
import { z } from "zod";
import { Easing, Img, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  surfaceColor,
  surfaceStyle,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

const plateSchema = z.object({
  src: z.string().max(120),
  west: z.number().min(-180).max(180),
  south: z.number().min(-90).max(90),
  east: z.number().min(-180).max(180),
  north: z.number().min(-90).max(90),
});

export const RouteMapProps = z.object({
  title: z.string().max(40).optional(),
  stops: z
    .array(
      z.object({
        name: z.string().max(24),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        date: z.string().max(16).optional(),
      }),
    )
    .min(2)
    .max(6),
  mode: z.enum(["march", "flight", "sea"]).default("march"),
  plate: plateSchema.optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type RouteMapProps = z.infer<typeof RouteMapProps>;

export function RouteMap({ props, theme }: { props: RouteMapProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "RouteMap",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.5,
  });
  const { opacity, inDur } = entrance;

  // Bounds from the stops, padded 20%, then widened to the frame aspect so the
  // plate fills the shot without distorting the projection.
  const lats = props.stops.map((s) => s.lat);
  const lngs = props.stops.map((s) => s.lng);
  const padLat = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.2, 1);
  const padLng = Math.max((Math.max(...lngs) - Math.min(...lngs)) * 0.2, 1);
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
  const nodes = props.stops.map((s) => ({ ...s, ...project(s.lat, s.lng) }));

  // Sample the route into one polyline; "march" is straight segments, the
  // others bow each leg into a quadratic.
  const perSegment = props.mode === "march" ? 1 : 24;
  const pts: { x: number; y: number }[] = [{ x: nodes[0].x, y: nodes[0].y }];
  const nodeAt: number[] = [0];
  for (let i = 1; i < nodes.length; i++) {
    const a = nodes[i - 1];
    const b = nodes[i];
    if (perSegment === 1) {
      pts.push({ x: b.x, y: b.y });
    } else {
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      const nx = -(b.y - a.y) / len;
      const ny = (b.x - a.x) / len;
      const bow = len * (props.mode === "flight" ? 0.18 : 0.1);
      const cx = (a.x + b.x) / 2 + nx * bow;
      const cy = (a.y + b.y) / 2 + ny * bow;
      for (let k = 1; k <= perSegment; k++) {
        const t = k / perSegment;
        const mt = 1 - t;
        pts.push({
          x: mt * mt * a.x + 2 * mt * t * cx + t * t * b.x,
          y: mt * mt * a.y + 2 * mt * t * cy + t * t * b.y,
        });
      }
    }
    nodeAt.push(pts.length - 1);
  }
  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  }
  const L = cum[cum.length - 1] || 1;
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");

  const drawStart = Math.round(fps * 0.4 * durationMul);
  const drawDur = Math.round(durationInFrames * 0.48);
  const drawn = interpolate(frame, [drawStart, drawStart + drawDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });

  const grain = theme.grain ?? "none";
  const grainOpacity = grain === "archival" ? 0.12 : grain === "film" ? 0.07 : 0;
  const grainSeed = Math.floor(frame / 2) % 12;
  const dot = plateH * 0.014;

  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity, translate: entrance.translate, scale: `${entrance.scale}`, clipPath: entrance.clipPath }}>
      <div style={{ position: "relative", width: plateW, height: plateH, overflow: "hidden", background: surfaceColor(theme) }}>
        {props.plate ? (
          <Img src={staticFile(props.plate.src)} style={{ width: "100%", height: "100%", objectFit: "fill" }} />
        ) : (
          <ProceduralPlate theme={theme} width={plateW} height={plateH} />
        )}

        {grainOpacity > 0 ? (
          <div style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grainOpacity, pointerEvents: "none" }}>
            <svg width={plateW} height={plateH}>
              <filter id="route-map-grain">
                <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
                <feColorMatrix type="saturate" values="0" />
              </filter>
              <rect width={plateW} height={plateH} filter="url(#route-map-grain)" />
            </svg>
          </div>
        ) : null}

        <svg width={plateW} height={plateH} style={{ position: "absolute", inset: 0 }}>
          <path
            d={d}
            fill="none"
            stroke={accent}
            strokeWidth={Math.max(3, plateH * 0.006)}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={L}
            strokeDashoffset={L * (1 - drawn)}
          />
          {/* Sea routes get a marching dash riding on top of the solid line. */}
          {props.mode === "sea" ? (
            <path
              d={d}
              fill="none"
              stroke={theme.colors.bg}
              strokeWidth={Math.max(2, plateH * 0.003)}
              strokeDasharray={`${plateH * 0.014} ${plateH * 0.014}`}
              strokeDashoffset={-(frame / fps) * plateH * 0.06}
              strokeOpacity={0.8 * drawn}
            />
          ) : null}

          {nodes.map((node, i) => {
            const at = cum[nodeAt[i]] / L;
            const pop = interpolate(drawn, [at, at + 0.06], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
            });
            return (
              <g key={i}>
                <circle cx={node.x} cy={node.y} r={dot * 1.9} fill={theme.colors.bg} fillOpacity={0.75 * pop} />
                <circle cx={node.x} cy={node.y} r={dot} fill={accent} style={{ scale: `${pop}`, transformOrigin: `${node.x}px ${node.y}px` }} />
              </g>
            );
          })}
        </svg>

        {nodes.map((node, i) => {
          const at = cum[nodeAt[i]] / L;
          const labelIn = interpolate(drawn, [at + 0.02, at + 0.1], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          const right = node.x > plateW * 0.72;
          return (
            <div
              key={i}
              style={{
                position: "absolute",
                left: right ? undefined : node.x + dot * 2.4,
                right: right ? plateW - node.x + dot * 2.4 : undefined,
                top: node.y - plateH * 0.03,
                textAlign: right ? "right" : "left",
                opacity: labelIn,
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  fontFamily: fontStack(theme.typography.display),
                  fontSize: plateH * 0.038 * typeScale(theme, "body"),
                  fontWeight: typeWeight(theme, 700),
                  color: theme.colors.text,
                }}
              >
                {node.name}
              </div>
              {node.date ? (
                <div
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: plateH * 0.026 * typeScale(theme, "caption"),
                    fontVariantNumeric: "tabular-nums",
                    letterSpacing: typeTracking(theme, 0.08),
                    color: mutedInk(theme),
                  }}
                >
                  {node.date}
                </div>
              ) : null}
            </div>
          );
        })}

        {props.title ? (
          <div
            style={{
              position: "absolute",
              left: plateW * 0.04,
              top: plateH * 0.06,
              fontFamily: fontStack(theme.typography.display),
              fontSize: plateH * 0.06 * typeScale(theme, "title"),
              fontWeight: typeWeight(theme, 700),
              color: theme.colors.text,
              opacity: interpolate(frame, [0, inDur], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              }),
            }}
          >
            {props.title}
          </div>
        ) : null}

        {props.plate ? null : (
          <div
            style={{
              position: "absolute",
              right: plateW * 0.02,
              bottom: plateH * 0.02,
              fontFamily: fontStack(theme.typography.body),
              fontSize: plateH * 0.026 * typeScale(theme, "caption"),
              letterSpacing: typeTracking(theme, 0.14),
              textTransform: typeCase(theme, "uppercase"),
              color: mutedInk(theme),
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
          fillOpacity={0.05 + random(`rm-plate-${i}`) * 0.1}
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

/** Which optional token blocks this component can actually obey (Part 3). */
RouteMap.honors = ["typography", "surface.density", "surface.rule", "motion.entrance"];
