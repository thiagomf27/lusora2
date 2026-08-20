/**
 * DataTable — rows by columns, with a header.
 *
 * `FactSheet` is the nearest thing and it stops at TWO columns: its rows are
 * `{label, value}`, which is a dossier about one subject. A table is the other
 * shape — several subjects compared across several attributes — and that is a
 * different data structure (`string[][]`, not `{label, value}[]`), not a prop.
 * The geometry is different too: columns need a shared width per column and a
 * per-column alignment, neither of which a two-column panel ever computes.
 *
 * Numbers right-align and text left-aligns, decided per column by looking at
 * the cells rather than by asking the script. A script asked to declare column
 * alignment will get it wrong, and it is derivable.
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
  groundStyle,
  motionScale,
  ruleWidth,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const DataTableProps = z.object({
  title: z.string().max(48).optional(),
  columns: z.array(z.string().max(18)).min(2).max(4),
  rows: z.array(z.array(z.string().max(20)).min(2).max(4)).min(2).max(6),
  /** The row the narration is about; the rest go quiet around it. */
  highlight_row: z.number().int().min(0).max(5).optional(),
  source: z.string().max(52).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type DataTableProps = z.infer<typeof DataTableProps>;

/** A cell reads as numeric if it is a figure, with or without units or signs. */
const NUMERIC = /^[+\-−]?[$£€]?[\d][\d,. ]*\s*[%kKmMbB]?\s*[a-zA-Z%°]{0,4}$/;

export function DataTable({ props, theme }: { props: DataTableProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "DataTable",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    seconds: 0.45,
  });
  const { opacity, inDur } = entrance;
  const ground = groundStyle(theme, { radius: 10, alpha: "e6", accentRule: "top", legible: true });

  const cols = props.columns.length;
  // Every row is padded or trimmed to the header's width: a ragged row would
  // silently shift every cell after it into the wrong column.
  const rows = props.rows.map((r) =>
    Array.from({ length: cols }, (_, c) => r[c] ?? ""),
  );

  /** Right-align a column when its body cells are figures. Derived, not asked for. */
  const numericCol = Array.from({ length: cols }, (_, c) =>
    rows.every((r) => r[c] === "" || NUMERIC.test(r[c].trim())) &&
    rows.some((r) => r[c].trim() !== ""),
  );
  // The first column is the row's SUBJECT and stays left even if it is a year.
  numericCol[0] = false;

  const rowStagger = Math.min(
    4,
    Math.max(2, Math.floor((durationInFrames * 0.4) / Math.max(1, rows.length))),
  );
  const bodyStart = Math.round(fps * 0.35 * durationMul);
  const headIn = interpolate(frame, [0, inDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });

  const cellPadY = height * 0.014 * density;
  const cellPadX = width * 0.014 * density;
  const headRule = ruleWidth(theme, Math.max(2, height * 0.003));
  const rowRule = ruleWidth(theme, 1);

  const cellStyle = (c: number, numeric: boolean) => ({
    padding: `${cellPadY}px ${cellPadX}px`,
    textAlign: (numericCol[c] ? "right" : "left") as "left" | "right",
    fontFamily: fontStack(theme.typography.body),
    fontVariantNumeric: "tabular-nums" as const,
    whiteSpace: "nowrap" as const,
    overflow: "hidden" as const,
    textOverflow: "ellipsis" as const,
    ...(numeric ? {} : {}),
  });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: `0 ${width * 0.06 * density}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          ...(ground ?? {}),
          padding: `${height * 0.035 * density}px ${width * 0.028 * density}px`,
          maxWidth: width * 0.82,
        }}
      >
        {props.title ? (
          <div
            style={{
              marginBottom: height * 0.022 * density,
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.042 * typeScale(theme, "title"),
              fontWeight: typeWeight(theme, 700),
              letterSpacing: typeTracking(theme),
              textTransform: typeCase(theme),
              color: theme.colors.text,
              opacity: headIn,
            }}
          >
            {props.title}
          </div>
        ) : null}

        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              {props.columns.map((c, i) => (
                <th
                  key={i}
                  style={{
                    ...cellStyle(i, false),
                    fontSize: height * 0.021 * typeScale(theme, "caption"),
                    fontWeight: typeWeight(theme, 600),
                    letterSpacing: typeTracking(theme, 0.1),
                    textTransform: typeCase(theme, "uppercase"),
                    color: theme.colors.neutral,
                    borderBottom: `${headRule}px solid ${accent}`,
                    opacity: headIn,
                  }}
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const start = bodyStart + r * rowStagger;
              const enter = interpolate(frame, [start, start + fps * 0.4 * durationMul], [0, 1], {
                extrapolateLeft: "clamp",
                extrapolateRight: "clamp",
                easing: curve,
              });
              const lit = props.highlight_row === undefined || props.highlight_row === r;
              return (
                <tr key={r}>
                  {row.map((cell, c) => (
                    <td
                      key={c}
                      style={{
                        ...cellStyle(c, numericCol[c]),
                        fontSize: height * 0.026 * typeScale(theme, "body"),
                        fontWeight: typeWeight(theme, lit && props.highlight_row !== undefined ? 700 : 400),
                        color:
                          lit && props.highlight_row !== undefined
                            ? accent
                            : c === 0
                              ? theme.colors.text
                              : theme.colors.text,
                        borderBottom: `${rowRule}px solid ${theme.colors.neutral}55`,
                        opacity: enter * (lit ? 1 : 0.45),
                      }}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {props.source ? (
          <div
            style={{
              marginTop: height * 0.018 * density,
              fontFamily: fontStack(theme.typography.body),
              fontSize: height * 0.018 * typeScale(theme, "caption"),
              fontWeight: typeWeight(theme, 400),
              letterSpacing: typeTracking(theme, 0.1),
              textTransform: typeCase(theme, "uppercase"),
              color: theme.colors.neutral,
              opacity: interpolate(
                frame,
                [bodyStart + rows.length * rowStagger, bodyStart + rows.length * rowStagger + fps * 0.4],
                [0, 0.9],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              ),
            }}
          >
            {props.source}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
DataTable.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
