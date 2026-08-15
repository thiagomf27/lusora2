/**
 * ArchiveBarGraph — "Archive" pack (archival documentary).
 *
 * Columns on the pack's ruled white card. The title is set in the display face
 * on a tan strip welded to the card's top-left corner, so a chart is stamped
 * the same way a name plate is.
 *
 * Bars are the SERIES ramp's ochre, not `theme.colors.accent`. The tan accent
 * is a ground colour — 1.9:1 against the card, fine under dark type and
 * illegal as a mark on it. The ochre is the same hue at 3.2:1, so the columns
 * read as data rather than as decoration that happens to be near data.
 *
 * One hue for the whole series, never the ramp: a single-series bar chart
 * encodes MAGNITUDE and the ramp encodes identity. `highlight_index` mutes the
 * others instead of recolouring them.
 */
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

export const ArchiveBarGraphProps = z.object({
  title: z.string().max(44),
  bars: z.array(z.object({ label: z.string().max(14), value: z.number() })).min(2).max(6),
  /** Index of the one column keeping full ink; the rest go muted. */
  highlight_index: z.number().int().min(0).max(5).optional(),
  /** Credit line along the bottom of the card. */
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type ArchiveBarGraphProps = z.infer<typeof ArchiveBarGraphProps>;

/**
 * Ticks on a round STEP (1, 2, 2.5, 5 × 10ⁿ) rather than a round maximum.
 * Rounding the maximum instead gives a tidy 75K top and then quarters it into
 * 18.8K / 37.5K / 56.3K — every label but the ends unreadable.
 */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step * 1e-9; v += step) out.push(v);
  return out;
}

function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (a >= 1000) return `${(v / 1000).toFixed(1)}K`;
  return String(Math.round(v));
}

export function ArchiveBarGraph({ props, theme }: { props: ArchiveBarGraphProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const paper = surfaceColor(theme);
  const ink = theme.colors.text;
  const ground = theme.colors.accent;
  const bandInk = contrastInk(theme, ground);
  const mark = props.emphasis === "neutral" ? theme.colors.neutral : seriesColors(theme)[0];
  const muted = `${theme.colors.neutral}8c`;

  const rule = Math.max(2, Math.round(height * 0.0034));
  const hairline = Math.max(1, Math.round(height * 0.0022));
  const mono = fontStack(theme.typography.body);

  const card = { x: width * 0.05, y: height * 0.08, w: width * 0.9, h: height * 0.84 };
  const padX = width * 0.035;
  const padY = height * 0.05;
  // The header band is a fixed height rather than padding around the type, so
  // the plot box below it is known before the title is laid out. A title at the
  // schema's 44-character maximum still sets on one line at this size.
  const bandH = height * 0.088;
  const left = card.x + padX + width * 0.05;
  const right = card.x + card.w - padX;
  const top = card.y + bandH + height * 0.085;
  const bottom = card.y + card.h - padY - height * 0.07;
  const plotW = right - left;
  const plotH = bottom - top;

  const n = props.bars.length;
  const ticks = niceTicks(Math.max(...props.bars.map((b) => Math.abs(b.value)), 1));
  const yMax = ticks[ticks.length - 1];
  const slot = plotW / n;
  const barW = Math.min(slot * 0.5, width * 0.07);

  const inDur = Math.round(fps * 0.42 * durationMul);
  const cardDur = Math.round(fps * 0.5 * durationMul);
  const stripDur = Math.round(fps * 0.55 * durationMul);
  const titleAt = Math.round(fps * 0.24 * durationMul);
  const growDur = Math.round(fps * 0.75 * durationMul);
  const firstAt = Math.round(fps * 0.55 * durationMul);
  // Clamp the stagger so the last column has settled by ~55% of the shot even
  // at history-dark's durationMul = 1.4.
  const budget = Math.max(0, durationInFrames * 0.55 - growDur - firstAt);
  const stagger = n > 1 ? Math.min(Math.round(fps * 0.12 * durationMul), budget / (n - 1)) : 0;

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
      {/* The card fades rather than wipes: at this size a wipe reads as a swipe
          transition, and the pack's wipes belong to the type lockups. */}
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

      {/* Tan header band, edge to edge across the card. The rule is drawn after
          everything else so it frames the band instead of butting into it. */}
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
      <div
        style={{
          position: "absolute",
          left: card.x,
          top: card.y,
          width: card.w,
          height: card.h,
          // border-box, or the rule sits 2px outside the fill it is framing.
          boxSizing: "border-box",
          border: `${rule}px solid ${theme.colors.neutral}`,
          opacity: cardIn,
        }}
      />

      <svg width={width} height={height} style={{ position: "absolute", inset: 0 }}>
        {ticks.map((v, i) => {
          const y = bottom - (v / yMax) * plotH;
          return (
            <g key={i}>
              <line
                x1={left}
                y1={y}
                x2={right}
                y2={y}
                stroke={i === 0 ? ink : `${theme.colors.neutral}59`}
                strokeWidth={i === 0 ? rule : hairline}
                strokeDasharray={plotW}
                strokeDashoffset={plotW * (1 - cardIn)}
              />
              <text
                x={left - width * 0.014}
                y={y}
                textAnchor="end"
                dominantBaseline="central"
                fill={theme.colors.neutral}
                fontFamily={mono}
                fontSize={height * 0.022}
                style={{ fontVariantNumeric: "tabular-nums" }}
                opacity={cardIn}
              >
                {compact(v)}
              </text>
            </g>
          );
        })}
      </svg>

      {props.bars.map((bar, i) => {
        const start = firstAt + i * stagger;
        const grow = interpolate(frame, [start, start + growDur], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: ease,
        });
        const lit = props.highlight_index === undefined || props.highlight_index === i;
        const full = (Math.abs(bar.value) / yMax) * plotH;
        const cx = left + slot * (i + 0.5);
        return (
          <div key={i} style={{ position: "absolute", left: cx - barW / 2, top, width: barW, height: plotH }}>
            <div
              style={{
                position: "absolute",
                left: 0,
                bottom: 0,
                width: barW,
                height: full,
                backgroundColor: lit ? mark : muted,
                transformOrigin: "bottom center",
                scale: `1 ${grow}`,
              }}
            />
            {/* The figure waits for its own bar to settle — a number counting
                beside a moving column is two animations reading as one wrong. */}
            <div
              style={{
                position: "absolute",
                left: -barW * 0.6,
                bottom: full + height * 0.016,
                width: barW * 2.2,
                textAlign: "center",
                fontFamily: mono,
                fontSize: height * 0.025,
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                color: lit ? ink : theme.colors.neutral,
                opacity: interpolate(grow, [0.8, 1], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {compact(bar.value)}
            </div>
            <div
              style={{
                position: "absolute",
                left: -barW * 0.6,
                top: plotH + height * 0.022,
                width: barW * 2.2,
                textAlign: "center",
                fontFamily: mono,
                fontSize: height * 0.021,
                fontWeight: 400,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: lit ? ink : theme.colors.neutral,
                overflowWrap: "anywhere",
                opacity: interpolate(frame, [start, start + inDur], [0, 1], {
                  extrapolateLeft: "clamp",
                  extrapolateRight: "clamp",
                }),
              }}
            >
              {bar.label}
            </div>
          </div>
        );
      })}

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
            opacity: interpolate(frame, [firstAt + growDur, firstAt + growDur + inDur], [0, 0.9], {
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
