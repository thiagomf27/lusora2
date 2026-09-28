/**
 * Callouts — several labels on one shot, each with a mark on the thing it
 * names: a ring round a kiva, a box on the stacked rooms, a dot on a wall, an
 * arrow, or a pin. CalloutArrow draws this when given `callouts` (D97).
 *
 * Where a label sits is WHERE THE THING IS IN THE FOOTAGE, and the planner
 * cannot see footage. So a callout carries two ways to say where: `target`, the
 * nine-cell grid the planner can use for "top right", and `point`, fractions of
 * the frame set by a human in the editor for "that kiva". `point` wins.
 *
 * The label is a chip (`chipColor`, ink by contrast); the mark and its leader
 * are the accent — like PinTag's pin, a mark is a fixture rather than emphasis,
 * and a grey ring on footage is a ring nobody finds.
 */
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  labelFace,
  capsTracking,
  chipColor,
  contrastInk,
  densityScale,
  easingCurve,
  elevationShadow,
  fontStack,
  motionScale,
  mutedInk,
  ruleWidth,
  surfaceStyle,
  typeCase,
  typeScale,
  typeWeight,
} from "../theme.ts";
import { PinTag } from "./PinTag.tsx";

export type Mark = "arrow" | "circle" | "box" | "dot" | "pin";
export type Cell =
  | "top_left" | "top_center" | "top_right"
  | "center_left" | "center" | "center_right"
  | "bottom_left" | "bottom_center" | "bottom_right";

export interface CalloutSpec {
  text: string;
  detail?: string;
  target?: Cell;
  point?: { x: number; y: number };
  mark?: Mark;
  size?: "small" | "medium" | "large";
  from?: "left" | "right" | "above" | "below";
}

const COL: Record<string, number> = { left: 0.24, center: 0.5, right: 0.76 };
const ROW: Record<string, number> = { top: 0.26, center: 0.5, bottom: 0.74 };
const SIZE = { small: 0.05, medium: 0.085, large: 0.13 } as const;

/** Where the thing is, in px: the editor's point if set, else the grid cell. */
function locate(c: CalloutSpec, width: number, height: number): { x: number; y: number } {
  if (c.point) return { x: c.point.x * width, y: c.point.y * height };
  const [row, col] = (c.target ?? "center").split("_");
  return { x: width * (COL[col] ?? 0.5), y: height * (ROW[row] ?? 0.5) };
}

/**
 * Which way the label goes when the callout does not say: away from the
 * nearer vertical edge for a point high or low in the frame, else sideways
 * toward the open half — so a label never runs off the side it is nearest.
 */
function defaultFrom(x: number, y: number, width: number, height: number): NonNullable<CalloutSpec["from"]> {
  if (y < height * 0.3) return "below";
  if (y > height * 0.7) return "above";
  return x > width / 2 ? "left" : "right";
}

export function Callouts({ callouts, theme }: { callouts: CalloutSpec[]; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const curve = Easing.bezier(...easingCurve(theme));
  const mark = theme.colors.accent;
  const chip = chipColor(theme);
  const ink = contrastInk(theme, chip);
  const line = ruleWidth(theme, Math.max(2, height * 0.0035));
  const stagger = Math.round(fps * 0.35 * durationMul);
  const drawDur = Math.round(fps * 0.45 * durationMul);

  return (
    <>
      {callouts.map((c, i) => {
        const at = locate(c, width, height);
        const start = Math.round(fps * 0.15) + i * stagger;
        const draw = interpolate(frame, [start, start + drawDur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: curve,
        });
        const labelIn = interpolate(frame, [start + drawDur * 0.6, start + drawDur * 1.3], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: curve,
        });
        const kind: Mark = c.mark ?? "arrow";

        if (kind === "pin") {
          return (
            <PinTag
              key={i}
              title={c.text}
              detail={c.detail}
              theme={theme}
              x={Math.min(Math.max(at.x, width * 0.1), width * 0.9)}
              y={Math.min(at.y, height * 0.72)}
              frameHeight={height}
              progress={interpolate(frame, [start, start + drawDur * 1.6], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}
            />
          );
        }

        // The mark's own reach, so the leader stops at its edge.
        const r = height * SIZE[c.size ?? "medium"];
        const reach = kind === "circle" ? r : kind === "box" ? r * 0.9 : kind === "dot" ? height * 0.012 : 0;
        const from = c.from ?? defaultFrom(at.x, at.y, width, height);
        const away = height * 0.13 + reach;
        const dir = { left: [-1, 0], right: [1, 0], above: [0, -1], below: [0, 1] }[from];
        const lx = Math.min(Math.max(at.x + dir[0] * (away + width * 0.02), width * 0.08), width * 0.92);
        const ly = Math.min(Math.max(at.y + dir[1] * away, height * 0.08), height * 0.9);
        // Leader from the mark's edge to the label's near edge.
        const sx = at.x + dir[0] * reach;
        const sy = at.y + dir[1] * reach;
        const ex = lx - dir[0] * width * 0.01;
        const ey = ly - dir[1] * height * 0.025;
        const len = Math.hypot(ex - sx, ey - sy) || 1;

        return (
          <div key={i} style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
            <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
              {kind === "circle" ? (
                <>
                  <circle cx={at.x} cy={at.y} r={r} fill={mark} fillOpacity={0.22 * draw} />
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={r}
                    fill="none"
                    stroke={mark}
                    strokeWidth={line * 1.3}
                    strokeDasharray={2 * Math.PI * r}
                    strokeDashoffset={2 * Math.PI * r * (1 - draw)}
                    transform={`rotate(-90 ${at.x} ${at.y})`}
                  />
                </>
              ) : null}
              {kind === "box" ? (
                <rect
                  x={at.x - r * 1.3}
                  y={at.y - r * 0.8}
                  width={r * 2.6}
                  height={r * 1.6}
                  rx={surfaceStyle(theme, { radius: 4 }).borderRadius}
                  fill={mark}
                  fillOpacity={0.18 * draw}
                  stroke={mark}
                  strokeWidth={line * 1.3}
                  strokeDasharray={r * 8.4}
                  strokeDashoffset={r * 8.4 * (1 - draw)}
                />
              ) : null}
              {kind === "dot" ? (
                <>
                  <circle cx={at.x} cy={at.y} r={height * 0.009} fill={mark} opacity={draw} />
                  <circle
                    cx={at.x}
                    cy={at.y}
                    r={height * (0.012 + 0.02 * ((frame / fps) % 1.2))}
                    fill="none"
                    stroke={mark}
                    strokeWidth={line}
                    opacity={(1 - ((frame / fps) % 1.2) / 1.2) * draw}
                  />
                </>
              ) : null}
              <line
                x1={sx}
                y1={sy}
                x2={ex}
                y2={ey}
                stroke={mark}
                strokeWidth={line}
                strokeDasharray={len}
                strokeDashoffset={len * (1 - draw)}
              />
              {kind === "arrow" ? (
                <polygon
                  points={`0,0 ${-height * 0.024},${-height * 0.011} ${-height * 0.024},${height * 0.011}`}
                  fill={mark}
                  opacity={draw}
                  transform={`translate(${sx} ${sy}) rotate(${(Math.atan2(sy - ey, sx - ex) * 180) / Math.PI})`}
                />
              ) : null}
            </svg>
            <div
              style={{
                position: "absolute",
                left: lx,
                top: ly,
                translate: `${from === "left" ? "-100%" : from === "right" ? "0" : "-50%"} ${from === "above" ? "-100%" : from === "below" ? "0" : "-50%"}`,
                background: chip,
                color: ink,
                borderRadius: surfaceStyle(theme, { radius: 4 }).borderRadius,
                boxShadow: elevationShadow(theme, height),
                padding: `${height * 0.009 * density}px ${height * 0.016 * density}px`,
                whiteSpace: "nowrap",
                opacity: labelIn,
                scale: `${interpolate(labelIn, [0, 1], [0.9, 1])}`,
              }}
            >
              <div
                style={{
                  fontFamily: labelFace(theme),
                  fontSize: height * 0.022 * typeScale(theme, "kicker"),
                  fontWeight: typeWeight(theme, 800),
                  letterSpacing: capsTracking(theme, 0.06),
                  textTransform: typeCase(theme, "uppercase"),
                }}
              >
                {c.text}
              </div>
              {c.detail ? (
                <div
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.017 * typeScale(theme, "caption"),
                    color: mutedInk(theme, chip, 4.5),
                  }}
                >
                  {c.detail}
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
