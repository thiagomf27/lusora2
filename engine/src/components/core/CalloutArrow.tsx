/**
 * CalloutArrow — a label plate with an arrow drawing to a point in the frame,
 * plus a pulse ring on the target.
 *
 * The 9-cell `target` enum is deliberate: naming a region of the frame keeps
 * this semantic, where a pixel coordinate prop would break the catalog's
 * "no pixel positions in props" rule.
 *
 * All three arrow styles are sampled into the same polyline, so one length sum
 * drives strokeDasharray for every style — no DOM measurement needed.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  ruleWidth,
  typeScale,
  useEntrance,
} from "../theme.ts";

export const CalloutArrowProps = z.object({
  text: z.string().max(60),
  target: z
    .enum([
      "top_left",
      "top_center",
      "top_right",
      "center_left",
      "center",
      "center_right",
      "bottom_left",
      "bottom_center",
      "bottom_right",
    ])
    .default("center"),
  from: z.enum(["left", "right", "above", "below"]).default("left"),
  style: z.enum(["curved", "straight", "elbow"]).default("curved"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type CalloutArrowProps = z.infer<typeof CalloutArrowProps>;

const COL: Record<string, number> = { left: 0.24, center: 0.5, right: 0.76 };
const ROW: Record<string, number> = { top: 0.26, center: 0.5, bottom: 0.74 };

export function CalloutArrow({ props, theme }: { props: CalloutArrowProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "CalloutArrow",
    supported: PANEL_ENTRANCES,
    fallback: "fade",
    seconds: 0.3,
  });
  const { opacity, inDur } = entrance;

  const [rowKey, colKey] = props.target.split("_");
  const tx = width * (COL[colKey] ?? 0.5);
  const ty = height * (ROW[rowKey] ?? 0.5);

  // Label anchor sits away from the target in the requested direction.
  const dx = props.from === "left" ? -width * 0.24 : props.from === "right" ? width * 0.24 : 0;
  const dy = props.from === "above" ? -height * 0.24 : props.from === "below" ? height * 0.24 : 0;
  const lx = Math.min(Math.max(tx + dx, width * 0.1), width * 0.9);
  const ly = Math.min(Math.max(ty + dy, height * 0.12), height * 0.88);

  // Stop the arrow short of the pulse ring.
  const ringR = height * 0.03;
  const gap = ringR * 1.6;
  const span = Math.hypot(tx - lx, ty - ly) || 1;
  const ex = tx - ((tx - lx) / span) * gap;
  const ey = ty - ((ty - ly) / span) * gap;

  // Sample the chosen geometry into one polyline so a single length sum works
  // for curved, straight and elbow alike.
  const N = 48;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    if (props.style === "straight") {
      pts.push({ x: lx + (ex - lx) * t, y: ly + (ey - ly) * t });
    } else if (props.style === "elbow") {
      // Travel along the dominant axis first, then turn.
      const horizontalFirst = Math.abs(ex - lx) >= Math.abs(ey - ly);
      const kx = horizontalFirst ? ex : lx;
      const ky = horizontalFirst ? ly : ey;
      if (t < 0.5) {
        const u = t / 0.5;
        pts.push({ x: lx + (kx - lx) * u, y: ly + (ky - ly) * u });
      } else {
        const u = (t - 0.5) / 0.5;
        pts.push({ x: kx + (ex - kx) * u, y: ky + (ey - ky) * u });
      }
    } else {
      // Quadratic bow, perpendicular to the label -> target line.
      const nx = -(ey - ly) / span;
      const ny = (ex - lx) / span;
      const bow = span * 0.22;
      const cx = (lx + ex) / 2 + nx * bow;
      const cy = (ly + ey) / 2 + ny * bow;
      const mt = 1 - t;
      pts.push({
        x: mt * mt * lx + 2 * mt * t * cx + t * t * ex,
        y: mt * mt * ly + 2 * mt * t * cy + t * t * ey,
      });
    }
  }
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ");
  const tail = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const angle = (Math.atan2(tail.y - prev.y, tail.x - prev.x) * 180) / Math.PI;

  const drawStart = inDur;
  const drawDur = Math.round(fps * 0.45 * durationMul);
  const outStart = durationInFrames - Math.round(fps * 0.45 * durationMul);
  // Draws in, then retracts on the way out.
  const drawn = Math.min(
    interpolate(frame, [drawStart, drawStart + drawDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: curve,
    }),
    interpolate(frame, [outStart, durationInFrames], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.45, 0, 0.55, 1),
    }),
  );

  const headStart = drawStart + drawDur * 0.85;
  const pulse = ((frame - headStart) / fps) % 1.4;
  const pulseOn = frame > headStart;
  const head = height * 0.02;
  const labelClip = interpolate(frame, [0, inDur], [100, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  const labelClose = interpolate(frame, [outStart + fps * 0.2, durationInFrames], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const clip = Math.max(labelClip, labelClose);

  return (
    <div style={{ position: "absolute", inset: 0, opacity, translate: entrance.translate, scale: `${entrance.scale}`, clipPath: entrance.clipPath }}>
      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <path
          d={d}
          fill="none"
          stroke={accent}
          strokeWidth={ruleWidth(theme, Math.max(2, height * 0.004))}
          strokeLinecap="round"
          strokeDasharray={L}
          strokeDashoffset={L * (1 - drawn)}
        />
        <polygon
          points={`0,0 ${-head * 1.4},${-head * 0.6} ${-head * 1.4},${head * 0.6}`}
          fill={accent}
          transform={`translate(${tail.x} ${tail.y}) rotate(${angle})`}
          style={{
            scale: `${interpolate(frame, [headStart, headStart + 8], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.34, 1.56, 0.64, 1),
            })}`,
          }}
        />
        {pulseOn
          ? [0, 0.7].map((offset, i) => {
              const p = (pulse + offset) % 1.4;
              return (
                <circle
                  key={i}
                  cx={tx}
                  cy={ty}
                  r={interpolate(p, [0, 1.4], [ringR * 0.4, ringR * 1.8])}
                  fill="none"
                  stroke={accent}
                  strokeWidth={ruleWidth(theme, Math.max(1.5, height * 0.0025))}
                  strokeOpacity={interpolate(p, [0, 1.4], [0.7, 0]) * drawn}
                />
              );
            })
          : null}
        <circle cx={tx} cy={ty} r={height * 0.008} fill={accent} fillOpacity={drawn} />
      </svg>

      <div
        style={{
          position: "absolute",
          left: lx,
          top: ly,
          translate: "-50% -50%",
          maxWidth: width * 0.28,
          background: `${theme.colors.bg}e6`,
          borderLeft: `${ruleWidth(theme, Math.max(3, height * 0.005))}px solid ${accent}`,
          borderRadius: "0 6px 6px 0",
          padding: `${height * 0.016 * density}px ${width * 0.016 * density}px`,
          fontFamily: fontStack(theme.typography.body),
          fontSize: height * 0.03 * typeScale(theme, "body"),
          lineHeight: 1.25,
          color: theme.colors.text,
          clipPath: `inset(0 ${clip}% 0 0)`,
        }}
      >
        {props.text}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
CalloutArrow.honors = ["typography", "surface.density", "surface.rule", "motion.entrance", "motion.easing"];
