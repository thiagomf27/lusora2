/**
 * FactSheet — a label/value dossier panel, the "infobox" of the catalog.
 *
 * Rows stagger in, each with its own baseline hairline drawing left-to-right.
 * Labels get a nowrap + ellipsis backstop under the schema's .max() limits so
 * a long label can never push the value column off the panel.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  borderSides,
  PANEL_ENTRANCES,
  easingCurve,
  emphasisColor,
  fontStack,
  motionScale,
  surfaceStyle,
  useEntrance,
} from "../theme.ts";

export const FactSheetProps = z.object({
  title: z.string().max(48),
  rows: z.array(z.object({ label: z.string().max(24), value: z.string().max(36) })).min(2).max(6),
  footnote: z.string().max(80).optional(),
  position: z.enum(["left", "right"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type FactSheetProps = z.infer<typeof FactSheetProps>;

export function FactSheet({ props, theme }: { props: FactSheetProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const surface = surfaceStyle(theme, { radius: 10, alpha: "e6", accentRule: "top" });
  const entrance = useEntrance(theme, {
    component: "FactSheet",
    supported: PANEL_ENTRANCES,
    fallback: "wipe",
    seconds: 0.5,
  });
  const { opacity, kind, progress } = entrance;
  const rule = Math.max(3, height * 0.006);

  const stagger = Math.min(
    4,
    Math.max(2, Math.floor((durationInFrames * 0.45) / Math.max(1, props.rows.length))),
  );
  const rowsStart = Math.round(fps * 0.35 * durationMul);
  const left = props.position === "left";
  const outStart = durationInFrames - Math.round(fps * 0.4 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: left ? "flex-start" : "flex-end",
        padding: `0 ${width * 0.07}px`,
        opacity,
      }}
    >
      <div
        style={{
          width: width * 0.42,
          background: surface.background,
          ...borderSides({
            width: 1,
            color: `${theme.colors.neutral}44`,
            side: surface.accentRule,
            ruleWidth: rule,
            ruleColor: accent,
          }),
          borderRadius: surface.borderRadius,
          padding: `${height * 0.032}px ${width * 0.026}px`,
          // This panel's own wipe opens DOWNWARD (the hook's is horizontal) —
          // a dossier unrolling is the whole gesture, so it stays bespoke.
          clipPath:
            kind === "wipe"
              ? `inset(0 0 ${interpolate(progress, [0, 1], [100, 0])}% 0)`
              : undefined,
          scale: `${entrance.scale}`,
          translate: `${entrance.translateX}px ${
            entrance.translateY +
            interpolate(frame, [outStart, durationInFrames], [0, -height * 0.008], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.bezier(0.45, 0, 0.55, 1),
            })
          }px`,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: height * 0.046,
            fontWeight: 700,
            color: theme.colors.text,
            marginBottom: height * 0.026,
            overflowWrap: "anywhere",
            display: "-webkit-box",
            WebkitBoxOrient: "vertical",
            WebkitLineClamp: 2,
            overflow: "hidden",
          }}
        >
          {props.title}
        </div>

        {props.rows.map((row, i) => {
          const start = rowsStart + i * stagger;
          const enter = interpolate(frame, [start, start + fps * 0.4 * durationMul], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: curve,
          });
          return (
            <div key={i} style={{ paddingTop: height * 0.014, paddingBottom: height * 0.014 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: width * 0.02,
                  opacity: enter,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    maxWidth: "42%",
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.024,
                    letterSpacing: "0.1em",
                    textTransform: "uppercase",
                    color: theme.colors.neutral,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.label}
                </span>
                <span
                  style={{
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.03,
                    fontVariantNumeric: "tabular-nums",
                    color: theme.colors.text,
                    textAlign: "right",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {row.value}
                </span>
              </div>
              <div
                style={{
                  marginTop: height * 0.012,
                  height: 1,
                  background: `${theme.colors.neutral}66`,
                  scale: `${enter} 1`,
                  transformOrigin: "left center",
                }}
              />
            </div>
          );
        })}

        {props.footnote ? (
          <div
            style={{
              marginTop: height * 0.018,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.02,
              fontStyle: "italic",
              color: theme.colors.neutral,
              overflowWrap: "anywhere",
              display: "-webkit-box",
              WebkitBoxOrient: "vertical",
              WebkitLineClamp: 2,
              overflow: "hidden",
              opacity: interpolate(
                frame,
                [rowsStart + props.rows.length * stagger, rowsStart + props.rows.length * stagger + fps * 0.4],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ),
            }}
          >
            {props.footnote}
          </div>
        ) : null}
      </div>
    </div>
  );
}
