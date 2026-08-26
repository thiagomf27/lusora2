import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "@lusora/contracts";
import { emphasisColor, fadeInOutRange, fontStack, mutedInk } from "../../themes/runtime.ts";

export const AnimatedMapProps = z.object({
  place_name: z.string(),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  label: z.string().optional(),
  zoom: z.enum(["city", "region", "country", "continent"]).default("region"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type AnimatedMapProps = z.infer<typeof AnimatedMapProps>;

const ZOOM_SPAN: Record<string, number> = { city: 4, region: 12, country: 30, continent: 70 };

/**
 * Stylized offline map: dark panel, graticule, animated pulse at the
 * projected coordinate. (Files-only rule: no tiles, no network.)
 */
export function AnimatedMap({ props, theme }: { props: AnimatedMapProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const accent = emphasisColor(theme, props.emphasis);
  const opacity = interpolate(
    frame,
    fadeInOutRange(durationInFrames, fps * 0.4),
    [0, 1, 1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const W = width * 0.3;
  const H = W * 0.75;
  const span = ZOOM_SPAN[props.zoom] ?? 12;
  // window centered on the target, graticule every span/4 degrees
  const project = (lat: number, lng: number) => ({
    x: ((lng - (props.lng - span)) / (2 * span)) * W,
    y: ((props.lat + span * 0.75 - lat) / (1.5 * span)) * H,
  });
  const center = project(props.lat, props.lng);
  const pulse = (frame / fps) % 1.6;
  const pulseR = interpolate(pulse, [0, 1.6], [H * 0.03, H * 0.16]);
  const pulseOpacity = interpolate(pulse, [0, 1.6], [0.7, 0]);

  const grid: number[] = [];
  for (let g = -3; g <= 3; g++) grid.push(g);

  return (
    <div
      style={{
        position: "absolute",
        right: width * 0.05,
        bottom: height * 0.16,
        opacity,
        background: `${theme.colors.bg}e0`,
        borderRadius: 10,
        border: `1px solid ${theme.colors.neutral}55`,
        overflow: "hidden",
      }}
    >
      <svg width={W} height={H}>
        {grid.map((g) => {
          const p = project(props.lat + (g * span) / 4, props.lng + (g * span) / 4);
          return (
            <g key={g} stroke={theme.colors.neutral} strokeOpacity={0.25}>
              <line x1={0} y1={p.y} x2={W} y2={p.y} />
              <line x1={p.x} y1={0} x2={p.x} y2={H} />
            </g>
          );
        })}
        <circle cx={center.x} cy={center.y} r={pulseR} fill="none" stroke={accent} strokeOpacity={pulseOpacity} strokeWidth={2} />
        <circle cx={center.x} cy={center.y} r={H * 0.025} fill={accent} />
      </svg>
      <div
        style={{
          position: "absolute",
          left: 10,
          bottom: 8,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.024,
          color: theme.colors.text,
        }}
      >
        {props.label ?? props.place_name}
        <span style={{ color: mutedInk(theme), marginLeft: 8, fontSize: height * 0.018 }}>
          {props.lat.toFixed(2)}, {props.lng.toFixed(2)}
        </span>
      </div>
    </div>
  );
}
