/**
 * ArchiveLineChart — "Archive" pack (archival documentary).
 *
 * Up to three series on the same ruled white card as the bar graph, revealed by
 * one left-to-right wipe, each series named at the end of its own line so there
 * is no legend to cross-reference.
 *
 * Lines come from the theme's `series` ramp — ochre / slate / oxblood, checked
 * against this card at 3.2:1, 6.5:1 and 10.4:1 with a worst adjacent-pair
 * ΔE00 of 22.8 under simulated deuteranopia, protanopia and tritanopia. The tan
 * accent is deliberately not in the ramp: it is a ground for dark type, and at
 * 1.9:1 a tan line on cream is a line nobody can follow.
 *
 * Two things carried over from the other line charts here, because they're
 * right: `x` is a STRING label at equal index spacing ("1941", "Q3"), not a
 * date, and the reveal is an SVG <clipPath> rect, not strokeDashoffset.
 */
import { useId } from "react";
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastInk,
  fadeInOutRange,
  fontStack,
  motionScale,
  seriesColors,
  surfaceColor,
} from "../theme.ts";

export const ArchiveLineChartProps = z.object({
  title: z.string().max(44),
  series: z
    .array(
      z.object({
        name: z.string().max(12),
        points: z.array(z.object({ x: z.string().max(8), y: z.number() })).min(2).max(24),
      }),
    )
    .min(1)
    .max(3),
  /** Tracked-out unit line inside the card, above the plot. */
  y_label: z.string().max(24).optional(),
  /** Credit line along the bottom of the card. */
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveLineChartProps = z.infer<typeof ArchiveLineChartProps>;

/** Round a maximum up to a readable gridline value (1, 1.5, 2, 2.5, 3, 4, 5, 7.5 × 10ⁿ). */
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / mag;
  const steps = [1, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  return (steps.find((s) => f <= s + 1e-9) ?? 10) * mag;
}

function formatTick(v: number): string {
  return Math.abs(v) >= 1000
    ? Math.round(v).toLocaleString("en-US")
    : v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export function ArchiveLineChart({ props, theme }: { props: ArchiveLineChartProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  const ground = theme.colors.accent;
  const bandInk = contrastInk(theme, ground);
  // One clip id per instance: a constant would make the second chart on screen
  // reuse the first one's reveal rect. useId's ":r1:" form is stripped — the
  // colons are legal in a fragment URL but not in every consumer of an id.
  const clipId = `archive-line-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const ramp = seriesColors(theme);
  const lineColor = (i: number) => (props.emphasis === "neutral" ? theme.colors.neutral : ramp[i % ramp.length]);

  const rule = Math.max(2, Math.round(height * 0.0034));
  const hairline = Math.max(1, Math.round(height * 0.0022));
  const stroke = Math.max(2, height * 0.0038);
  const mono = fontStack(theme.typography.body);

  const card = { x: width * 0.05, y: height * 0.08, w: width * 0.9, h: height * 0.84 };
  const padX = width * 0.035;
  const padY = height * 0.05;
  const bandH = height * 0.088;
  const left = card.x + padX + width * 0.055;
  // Room at the right for the end-of-line series names. A mono face is the
  // reason this gutter is wide: 12 characters at a fixed 0.6em advance is 115px
  // at 1280×720, and a name that runs past the card's rule is worse than a
  // slightly narrower plot.
  const right = card.x + card.w - padX - width * 0.115;
  const top = card.y + bandH + height * (props.y_label ? 0.09 : 0.055);
  const bottom = card.y + card.h - padY - height * 0.06;
  const plotW = right - left;
  const plotH = bottom - top;

  const maxLen = Math.max(...props.series.map((s) => s.points.length));
  const allY = props.series.flatMap((s) => s.points.map((p) => p.y));
  const yMin = Math.min(0, ...allY);
  const yMax = yMin < 0 ? Math.max(...allY, 1) : niceCeil(Math.max(...allY, 1));
  const ySpan = yMax - yMin || 1;
  const gridValues = [yMax, yMin + ySpan / 2, yMin];

  const px = (i: number) => left + (maxLen <= 1 ? 0 : (i / (maxLen - 1)) * plotW);
  const py = (y: number) => bottom - ((y - yMin) / ySpan) * plotH;

  const inDur = Math.round(fps * 0.42 * durationMul);
  const cardDur = Math.round(fps * 0.5 * durationMul);
  const stripDur = Math.round(fps * 0.55 * durationMul);
  const titleAt = Math.round(fps * 0.24 * durationMul);
  const drawAt = Math.round(fps * 0.5 * durationMul);
  const drawDur = Math.round(fps * 1.8 * durationMul);

  const ease = Easing.bezier(0.16, 1, 0.3, 1);
  const cardIn = interpolate(frame, [0, cardDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const stripWipe = interpolate(frame, [0, stripDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: ease,
  });
  const titleIn = interpolate(frame, [titleAt, titleAt + inDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  // One wipe for every series: they are being compared, so they arrive
  // together — a per-series stagger reads as a ranking that isn't in the data.
  const reveal = interpolate(frame, [drawAt, drawAt + drawDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.45, 0, 0.55, 1),
  });
  const revealX = left + plotW * reveal;
  const tickEvery = Math.max(1, Math.ceil(maxLen / 6));

  // The end-of-line names ARE the legend, so two series finishing within a line
  // of each other (39,807 and 40,300 aircraft) would stack their names on top
  // of one another. Push them apart from the top down, then lift the whole set
  // if that pushed the last one under the card's baseline.
  const nameSize = height * 0.022;
  const endLabels = props.series
    .map((s, si) => ({
      si,
      name: s.name,
      x: px(s.points.length - 1) + width * 0.012,
      y: py(s.points[s.points.length - 1].y),
    }))
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < endLabels.length; i++) {
    endLabels[i].y = Math.max(endLabels[i].y, endLabels[i - 1].y + nameSize * 1.2);
  }
  const spill = endLabels.length > 0 ? endLabels[endLabels.length - 1].y - bottom : 0;
  if (spill > 0) for (const label of endLabels) label.y -= spill;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity: interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      <div
        style={{
          position: "absolute",
          left: card.x,
          top: card.y,
          width: card.w,
          height: card.h,
          backgroundColor: paper,
          boxShadow: `0 ${height * 0.01}px ${height * 0.026}px rgba(0,0,0,0.4)`,
          opacity: cardIn,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: card.x,
          top: card.y,
          width: card.w,
          height: bandH,
          backgroundColor: ground,
          transformOrigin: "left center",
          scale: `${stripWipe} 1`,
          opacity: cardIn,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: card.x + padX,
          top: card.y,
          width: card.w - padX * 2,
          height: bandH,
          display: "flex",
          alignItems: "center",
          fontFamily: fontStack(theme.typography.display),
          fontSize: height * 0.042,
          fontWeight: 700,
          lineHeight: 1.06,
          letterSpacing: "-0.01em",
          color: bandInk,
          whiteSpace: "nowrap",
          overflow: "hidden",
          opacity: titleIn,
        }}
      >
        {props.title}
      </div>

      {props.y_label ? (
        <div
          style={{
            position: "absolute",
            left: card.x + padX,
            top: card.y + bandH + height * 0.028,
            fontFamily: mono,
            fontSize: height * 0.02,
            fontWeight: 500,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: theme.colors.neutral,
            opacity: titleIn,
          }}
        >
          {props.y_label}
        </div>
      ) : null}

      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        <defs>
          <clipPath id={clipId}>
            <rect x={left} y={0} width={Math.max(0.001, plotW * reveal)} height={height} />
          </clipPath>
        </defs>

        {gridValues.map((v, i) => (
          <g key={i}>
            <line
              x1={left}
              y1={py(v)}
              x2={right}
              y2={py(v)}
              stroke={i === gridValues.length - 1 ? ink : `${theme.colors.neutral}59`}
              strokeWidth={i === gridValues.length - 1 ? rule : hairline}
              strokeDasharray={plotW}
              strokeDashoffset={plotW * (1 - cardIn)}
            />
            <text
              x={left - width * 0.014}
              y={py(v)}
              textAnchor="end"
              dominantBaseline="central"
              fill={theme.colors.neutral}
              fontFamily={mono}
              fontSize={height * 0.021}
              style={{ fontVariantNumeric: "tabular-nums" }}
              opacity={cardIn}
            >
              {formatTick(v)}
            </text>
          </g>
        ))}

        {/* x labels appear as the wipe passes them. */}
        {props.series[0].points.map((p, i) =>
          i % tickEvery === 0 || i === props.series[0].points.length - 1 ? (
            <text
              key={i}
              x={px(i)}
              y={bottom + height * 0.04}
              textAnchor="middle"
              fill={theme.colors.neutral}
              fontFamily={mono}
              fontSize={height * 0.021}
              style={{ fontVariantNumeric: "tabular-nums" }}
              opacity={interpolate(revealX, [px(i) - plotW * 0.04, px(i)], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}
            >
              {p.x}
            </text>
          ) : null,
        )}

        <g clipPath={`url(#${clipId})`}>
          {props.series.map((s, si) => (
            <path
              key={si}
              d={s.points.map((p, i) => `${i === 0 ? "M" : "L"}${px(i).toFixed(2)} ${py(p.y).toFixed(2)}`).join(" ")}
              fill="none"
              stroke={lineColor(si)}
              strokeWidth={stroke}
              strokeLinecap="butt"
              strokeLinejoin="round"
            />
          ))}
        </g>

        {/* Vertex dots sit outside the clip so they land crisply at the wipe edge. */}
        {props.series.map((s, si) =>
          s.points.map((p, i) => (
            <circle
              key={`${si}-${i}`}
              cx={px(i)}
              cy={py(p.y)}
              r={stroke * 1.25}
              fill={lineColor(si)}
              opacity={interpolate(revealX, [px(i) - plotW * 0.015, px(i)], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
              })}
            />
          )),
        )}

        {endLabels.map((label) => (
          <text
            key={label.si}
            x={label.x}
            y={label.y}
            dominantBaseline="central"
            fill={lineColor(label.si)}
            fontFamily={mono}
            fontSize={nameSize}
            fontWeight={600}
            letterSpacing={height * 0.0022}
            opacity={interpolate(reveal, [0.88, 1], [0, 1], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}
          >
            {label.name}
          </text>
        ))}
      </svg>

      <div
        style={{
          position: "absolute",
          left: card.x,
          top: card.y,
          width: card.w,
          height: card.h,
          boxSizing: "border-box",
          border: `${rule}px solid ${theme.colors.neutral}`,
          opacity: cardIn,
        }}
      />

      {props.source ? (
        <div
          style={{
            position: "absolute",
            left: card.x + padX,
            top: card.y + card.h - padY * 0.9,
            fontFamily: mono,
            fontSize: height * 0.019,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: theme.colors.neutral,
            opacity: interpolate(reveal, [0.88, 1], [0, 0.9], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.source}
        </div>
      ) : null}
    </div>
  );
}
