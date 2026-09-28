/**
 * KineticTitle — a title that assembles itself token by token.
 *
 * Three entrances, all driven off one staggered progress per token: "mask"
 * (slides up out of an overflow-hidden slot), "rise" (fade + lift) and
 * "scale" (pop on the overshoot curve). Splitting by "char" keeps spaces as
 * un-animated gaps so word boundaries stay readable.
 *
 * D96: an optional `kicker` chip over the title — the section or series
 * eyebrow ("CASA POR DENTRO") — set on the accent, and, when the theme asks for
 * `surface.title_rule: under`, a short accent rule under the last line. With
 * neither, the tree is exactly the one it always was.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Entrance, Theme } from "../theme.ts";
import {
  labelFace,
  capsTracking,
  contrastInk,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  surfaceStyle,
  titleOnShot,
  titleRule,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const KineticTitleProps = z.object({
  text: z.string().max(70),
  /** A short eyebrow chip over the title: the series, the section. */
  kicker: z.string().max(32).optional(),
  unit: z.enum(["word", "char"]).default("word"),
  entrance: z.enum(["rise", "mask", "scale"]).default("mask"),
  align: z.enum(["left", "center"]).default("center"),
  /**
   * The word or phrase that takes the emphasis colour (D97), verbatim from
   * `text` — any word, not only the last. Unmatched, nothing is emphasised.
   */
  emphasize: z.string().max(40).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
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
  // D96 `title_ground: shot` writes the title on the scrimmed footage in the
  // theme's lighter colour; otherwise it takes its plate, and its ink is asked
  // against that plate — `plate: invert` paints it in the theme's own ink.
  const onShot = titleOnShot(theme);
  const ground = onShot.onShot ? null : groundStyle(theme, { radius: 12, legible: true });
  const plateInk = ground?.backgroundColor ? contrastInk(theme, String(ground.backgroundColor).slice(0, 7)) : theme.colors.text;
  const ink = onShot.onShot ? onShot.ink : plateInk;
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
  // The emphasised span, as character offsets into `text` (case-insensitive,
  // so a planner that capitalised differently still lands), and each word's
  // own offsets so a word token knows whether it falls inside it.
  const markFrom = props.emphasize ? props.text.toLowerCase().indexOf(props.emphasize.toLowerCase().trim()) : -1;
  const markTo = markFrom >= 0 ? markFrom + props.emphasize!.trim().length : -1;
  const wordStarts: number[] = [];
  {
    let at = 0;
    for (const w of words) {
      const found = props.text.indexOf(w, at);
      wordStarts.push(found);
      at = found + w.length;
    }
  }
  const emphasised = (i: number) => {
    if (markFrom < 0) return false;
    if (props.unit === "char") return i >= markFrom && i < markTo;
    const start = wordStarts[i] ?? -1;
    const end = start + (words[i]?.length ?? 0);
    return start < markTo && end > markFrom;
  };

  const stagger = Math.min(
    Math.round(fps * (props.unit === "word" ? 0.14 : 0.05) * durationMul),
    Math.max(1, Math.floor((durationInFrames * 0.5) / Math.max(1, tokens.length))),
  );
  const tokenDur = Math.round(fps * 0.5 * durationMul);
  const centered = props.align === "center";
  // A title written on the shot is set on a narrower measure — a block of two
  // or three lines in the corner of the picture, not a banner across it — so
  // it is sized for three lines of that measure rather than one of the frame.
  const measure = onShot.onShot ? width * 0.6 : width * 0.84;
  const lines = onShot.onShot ? 3 : 1;
  const size =
    Math.max(
      height * 0.05,
      Math.min(onShot.onShot ? height * 0.1 : height * 0.13, (measure * lines) / Math.max(1, props.text.length * 0.55)),
    ) * typeScale(theme, "title");

  const rule = titleRule(theme);
  const framed = Boolean(props.kicker) || rule;
  const ornamentIn = interpolate(frame, [tokens.length * stagger, tokens.length * stagger + tokenDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(...easingCurve(theme)),
  });

  const title = (
      <div
        style={{
          display: "flex",
          ...(ground ? { ...ground, padding: `${height * 0.03 * density}px ${width * 0.035 * density}px` } : {}),
          flexWrap: "wrap",
          justifyContent: centered ? "center" : "flex-start",
          alignItems: "baseline",
          columnGap: props.unit === "word" ? size * 0.26 : 0,
          maxWidth: measure,
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
          const isEmphasized = emphasised(i);
          // The chosen word always takes the accent: naming it IS the request
          // for emphasis, so the `emphasis` prop (which defaults to neutral)
          // must not turn it grey.
          const color = isEmphasized ? theme.colors.accent : ink;

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
  );

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
      {framed ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: centered ? "center" : "flex-start" }}>
          {props.kicker ? (
            <div
              style={{
                marginBottom: height * 0.022 * density,
                background: theme.colors.accent,
                color: contrastInk(theme, theme.colors.accent),
                borderRadius: surfaceStyle(theme, { radius: 4 }).borderRadius,
                padding: `${height * 0.006 * density}px ${height * 0.014 * density}px`,
                fontFamily: labelFace(theme),
                fontSize: height * 0.022 * typeScale(theme, "kicker"),
                fontWeight: typeWeight(theme, 700),
                letterSpacing: capsTracking(theme, 0.08),
                textTransform: typeCase(theme, "uppercase"),
                opacity: interpolate(frame, [0, tokenDur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
              }}
            >
              {props.kicker}
            </div>
          ) : null}
          {title}
          {rule ? (
            <div
              style={{
                marginTop: height * 0.012 * density,
                width: width * 0.1,
                height: ruleWidth(theme, Math.max(3, height * 0.005)),
                background: accent,
                scale: `${ornamentIn} 1`,
                transformOrigin: centered ? "center" : "left center",
              }}
            />
          ) : null}
        </div>
      ) : (
        title
      )}
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
KineticTitle.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
