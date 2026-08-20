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
  PANEL_ENTRANCES,
  borderSides,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  surfaceStyle,
  textureLayer,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const FactSheetProps = z.object({
  title: z.string().max(48),
  rows: z.array(z.object({ label: z.string().max(24), value: z.string().max(36) })).min(2).max(6),
  /**
   * Number the rows 1..n. With it the same panel is a RANKING — the ten
   * biggest, the five deadliest — which is the only thing a ranked list needed
   * that a dossier did not. A separate `RankingList` would have been this
   * component with an ordinal, which is a prop, not a sibling.
   */
  numbered: z.boolean().default(false),
  /** The row the narration is actually about; the rest go quiet around it. */
  highlight_index: z.number().int().min(0).max(5).optional(),
  footnote: z.string().max(80).optional(),
  position: z.enum(["left", "right"]).default("left"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type FactSheetProps = z.infer<typeof FactSheetProps>;

export function FactSheet({ props, theme }: { props: FactSheetProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
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
  const rule = ruleWidth(theme, Math.max(3, height * 0.006));

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
        padding: `0 ${width * 0.07 * density}px`,
        opacity,
      }}
    >
      <div
        style={{
          width: width * 0.42 * (1 + (density - 1) * 0.5),
          ...(groundStyle(theme, { radius: 10, alpha: "e6", accentRule: "top", legible: true }) ?? {}),
          ...borderSides({
            width: ruleWidth(theme, 1),
            color: `${theme.colors.neutral}44`,
            side: surface.accentRule,
            ruleWidth: rule,
            ruleColor: accent,
          }),
          padding: `${height * 0.032 * density}px ${width * 0.026 * density}px`,
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
            fontSize: height * 0.046 * typeScale(theme, "title"),
            fontWeight: typeWeight(theme, 700),
            color: theme.colors.text,
            marginBottom: height * 0.026 * density,
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
          // A highlighted row keeps full ink; the others recede rather than
          // disappear, because a ranking with one row visible is not a ranking.
          const lit = props.highlight_index === undefined || props.highlight_index === i;
          return (
            <div key={i} style={{ paddingTop: height * 0.014 * density, paddingBottom: height * 0.014 * density }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: width * 0.02 * density,
                  opacity: enter * (lit ? 1 : 0.45),
                }}
              >
                {props.numbered ? (
                  <span
                    style={{
                      flexShrink: 0,
                      minWidth: width * 0.028,
                      fontFamily: fontStack(theme.typography.body),
                      fontSize: height * 0.03 * typeScale(theme, "number"),
                      fontWeight: typeWeight(theme, lit ? 700 : 400),
                      fontVariantNumeric: "tabular-nums",
                      color: lit ? accent : theme.colors.neutral,
                    }}
                  >
                    {i + 1}
                  </span>
                ) : null}
                <span
                  style={{
                    flexShrink: 0,
                    maxWidth: "42%",
                    fontFamily: fontStack(theme.typography.body),
                    fontSize: height * 0.024 * typeScale(theme, "caption"),
                    letterSpacing: typeTracking(theme, 0.1),
                    textTransform: typeCase(theme, "uppercase"),
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
                    fontSize: height * 0.03 * typeScale(theme, "body"),
                    fontVariantNumeric: "tabular-nums",
                    fontWeight: typeWeight(theme, lit && props.highlight_index !== undefined ? 700 : 400),
                    color: lit && props.highlight_index !== undefined ? accent : theme.colors.text,
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
                  marginTop: height * 0.012 * density,
                  height: ruleWidth(theme, 1),
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
              marginTop: height * 0.018 * density,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.02 * typeScale(theme, "kicker"),
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

/** Which optional token blocks this component can actually obey (Part 3). */
FactSheet.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
