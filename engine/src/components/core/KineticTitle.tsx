/**
 * KineticTitle — a title that assembles itself token by token.
 *
 * Three entrances, all driven off one staggered progress per token: "mask"
 * (slides up out of an overflow-hidden slot), "rise" (fade + lift) and
 * "scale" (pop on the overshoot curve). Splitting by "char" keeps spaces as
 * un-animated gaps so word boundaries stay readable.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Entrance, Theme } from "../theme.ts";
import {
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const KineticTitleProps = z.object({
  text: z.string().max(70),
  unit: z.enum(["word", "char"]).default("word"),
  entrance: z.enum(["rise", "mask", "scale"]).default("mask"),
  align: z.enum(["left", "center"]).default("center"),
  emphasize_last: z.boolean().default(false),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type KineticTitleProps = z.infer<typeof KineticTitleProps>;

/**
 * The `entrance` PROP predates D46 and is chosen by the planner; the theme's
 * `motion` tokens are chosen by a human. The theme wins where it is set and the
 * prop is the fallback, so existing plans render exactly as before while a
 * themed channel gets one consistent title motion. (The prop is a candidate for
 * deprecation — appearance is not the LLM's job — but removing it would change
 * the catalog entry the planner reads, so that is its own decision.)
 */
const PROP_ENTRANCE: Record<KineticTitleProps["entrance"], Entrance> = {
  mask: "wipe",
  rise: "rise",
  scale: "pop",
};

/** Per-token entrances this title can draw. `slide` reads wrong word by word. */
const SUPPORTED: readonly Entrance[] = ["fade", "rise", "pop", "wipe", "typewriter"];

export function KineticTitle({ props, theme }: { props: KineticTitleProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const ground = groundStyle(theme, { radius: 12, legible: true });
  const accent = emphasisColor(theme, props.emphasis);

  // Only the frame-level opacity and the resolved kind come from the hook: the
  // per-token stagger below is this component's whole point and stays bespoke.
  const { opacity, kind } = useEntrance(theme, {
    component: "KineticTitle",
    supported: SUPPORTED,
    fallback: PROP_ENTRANCE[props.entrance],
    seconds: 0.4,
  });

  const words = props.text.split(" ").filter(Boolean);
  const tokens = props.unit === "word" ? words : Array.from(props.text);
  // Which token index counts as "the last one" for emphasize_last.
  const lastWordIndex = props.unit === "word" ? words.length - 1 : tokens.length - 1;
  const lastWordStart =
    props.unit === "word" ? lastWordIndex : props.text.length - (words[words.length - 1]?.length ?? 0);

  const stagger = Math.min(
    Math.round(fps * (props.unit === "word" ? 0.14 : 0.05) * durationMul),
    Math.max(1, Math.floor((durationInFrames * 0.5) / Math.max(1, tokens.length))),
  );
  const tokenDur = Math.round(fps * 0.5 * durationMul);
  const centered = props.align === "center";
  const size =
    Math.max(
      height * 0.05,
      Math.min(height * 0.13, (width * 0.84) / Math.max(1, props.text.length * 0.55)),
    ) * typeScale(theme, "title");

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: centered ? "center" : "flex-start",
        padding: `0 ${width * 0.08 * density}px`,
        opacity,
      }}
    >
      <div
        style={{
          display: "flex",
          ...(ground ? { ...ground, padding: `${height * 0.03 * density}px ${width * 0.035 * density}px` } : {}),
          flexWrap: "wrap",
          justifyContent: centered ? "center" : "flex-start",
          alignItems: "baseline",
          columnGap: props.unit === "word" ? size * 0.26 : 0,
          maxWidth: width * 0.84,
        }}
      >
        {tokens.map((token, i) => {
          const start = i * stagger;
          const enter = interpolate(frame, [start, start + tokenDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            // A `pop` keeps its overshoot regardless of the theme curve — that
            // overshoot IS the pop; every other kind takes the theme's easing.
            easing:
              kind === "pop" ? Easing.bezier(0.34, 1.56, 0.64, 1) : Easing.bezier(...easingCurve(theme)),
          });
          const isEmphasized =
            props.emphasize_last && (props.unit === "word" ? i === lastWordIndex : i >= lastWordStart);
          const color = isEmphasized ? accent : theme.colors.text;

          if (token === " ") {
            return <span key={i} style={{ display: "inline-block", width: size * 0.28 }} />;
          }

          const glyph = (
            <span
              style={{
                display: "block",
                fontFamily: fontStack(theme.typography.display),
                fontWeight: typeWeight(theme, 700),
                fontSize: size,
                lineHeight: 1.1,
                letterSpacing: typeTracking(theme, 0.01),
                color,
                whiteSpace: "pre",
                translate:
                  kind === "wipe"
                    ? `0 ${interpolate(enter, [0, 1], [110, 0])}%`
                    : kind === "rise"
                      ? `0 ${interpolate(enter, [0, 1], [height * 0.03, 0])}px`
                      : "0 0",
                scale: kind === "pop" ? `${interpolate(enter, [0, 1], [0.86, 1])}` : "1",
                // A wipe reveals through its slot, so the glyph itself stays
                // opaque; a typewriter is all-or-nothing per token.
                opacity: kind === "wipe" ? 1 : kind === "typewriter" ? Math.round(enter) : enter,
              }}
            >
              {token}
            </span>
          );

          return kind === "wipe" ? (
            <span key={i} style={{ overflow: "hidden", display: "block", paddingBottom: size * 0.08 }}>
              {glyph}
            </span>
          ) : (
            <span key={i} style={{ display: "block", paddingBottom: size * 0.08 }}>
              {glyph}
            </span>
          );
        })}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
KineticTitle.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
