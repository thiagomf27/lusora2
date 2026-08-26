/**
 * HighlightedPassage — a block of text with hand-drawn marks landing on chosen
 * phrases, one after another, the way you'd annotate a document on camera.
 *
 * NOTE: this is one of only two catalog components with a fourth import —
 * it depends on @remotion/rough-notation. The engine needs that package
 * before this file is copied back.
 *
 * Phrases are matched against the text and any that aren't found are skipped
 * silently, so editing `text` in Studio can never crash the render. Overlapping
 * matches are dropped. Each annotation gets a FIXED integer seed so the
 * hand-drawn scribble is identical on every render pass.
 *
 * Two compositions (D70). `centered` is the card it always drew, floated over
 * the shot. `poster` is the passage AS the page: ground edge to edge, the text
 * set to the padding box and ranged left the way a printed column is, which is
 * what a theme means when it says every other overlay owns the frame. The marks
 * are unchanged between the two — they are drawn around the glyphs wherever the
 * glyphs land.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { Box, Bracket, Circle, Highlight, StrikeThrough, Underline } from "@remotion/rough-notation";
import type { Theme } from "../theme.ts";
import {
  TEXT_ENTRANCES,
  composition,
  densityScale,
  easingCurve,
  emphasisColor,
  fontStack,
  groundStyle,
  motionScale,
  posterPad,
  ruleWidth,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const HighlightedPassageProps = z.object({
  text: z.string().max(200),
  marks: z
    .array(
      z.object({
        phrase: z.string().max(40),
        style: z.enum(["highlight", "circle", "underline", "box", "bracket", "strike"]).default("highlight"),
      }),
    )
    .max(3)
    .default([]),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type HighlightedPassageProps = z.infer<typeof HighlightedPassageProps>;

export function HighlightedPassage({ props, theme }: { props: HighlightedPassageProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const poster = composition(theme) === "poster";
  const framePad = posterPad(theme, { width, height });
  const ground = groundStyle(theme, { radius: poster ? 0 : 12, legible: true });
  const accent = emphasisColor(theme, props.emphasis);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "HighlightedPassage",
    supported: TEXT_ENTRANCES,
    fallback: "rise",
    rise: height * 0.014, // the passage block's pre-D46 lift
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  // Resolve each phrase to a text range; drop misses and overlaps.
  const found = props.marks
    .map((mark, order) => ({ mark, order, at: props.text.indexOf(mark.phrase) }))
    .filter((m) => m.at >= 0 && m.mark.phrase.length > 0)
    .sort((a, b) => a.at - b.at);

  const ranges: { start: number; end: number; style: string; order: number }[] = [];
  for (const m of found) {
    const start = m.at;
    const end = m.at + m.mark.phrase.length;
    if (ranges.length > 0 && start < ranges[ranges.length - 1].end) continue;
    ranges.push({ start, end, style: m.mark.style, order: m.order });
  }

  // Split the passage into alternating plain / marked segments.
  const segments: { text: string; style: string | null; order: number }[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) segments.push({ text: props.text.slice(cursor, r.start), style: null, order: -1 });
    segments.push({ text: props.text.slice(r.start, r.end), style: r.style, order: r.order });
    cursor = r.end;
  }
  if (cursor < props.text.length) segments.push({ text: props.text.slice(cursor), style: null, order: -1 });

  const marksStart = Math.round(fps * 0.7 * durationMul);
  const markStagger = Math.round(fps * 0.5 * durationMul);
  const markDur = Math.round(fps * 0.5 * durationMul);
  // A page can carry bigger type than a card can, because it is not competing
  // with the footage around it for the reader's attention — it has replaced it.
  const size =
    Math.max(
      height * (poster ? 0.05 : 0.038),
      Math.min(
        height * (poster ? 0.11 : 0.07),
        (width * (poster ? 2.4 : 1.5)) / Math.max(1, props.text.length * 0.5),
      ),
    ) * typeScale(theme, "title");
  const strokeWidth = ruleWidth(theme, Math.max(2, height * 0.004));

  const progressFor = (order: number) =>
    interpolate(frame, [marksStart + order * markStagger, marksStart + order * markStagger + markDur], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.45, 0, 0.55, 1),
    });

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: poster ? 0 : `0 ${width * 0.11 * density}px`,
        opacity,
      }}
    >
      {/* On a poster the ground is the FRAME, so it cannot be the text block's
          own background — a plate that hugs three lines of type is a card, which
          is the composition this branch exists to leave behind. */}
      {poster && ground ? (
        <div style={{ position: "absolute", inset: 0, ...ground }} />
      ) : null}
      <div
        style={{
          // A block, not a flex column: the children are the inline runs of one
          // paragraph, and making them flex items would set every marked phrase
          // on a line of its own. The outer container already centres this.
          ...(poster
            ? { boxSizing: "border-box", width: "100%", padding: `${framePad.y}px ${framePad.x}px` }
            : ground
              ? { ...ground, padding: `${height * 0.04 * density}px ${width * 0.04 * density}px` }
              : {}),
          fontFamily: fontStack(theme.typography.display),
          fontSize: size,
          fontWeight: poster ? typeWeight(theme, 600) : undefined,
          letterSpacing: poster ? typeTracking(theme, -0.01) : undefined,
          lineHeight: poster ? 1.28 : 1.55,
          color: theme.colors.text,
          overflowWrap: "anywhere",
          maxWidth: poster ? "100%" : width * 0.78,
          opacity: interpolate(frame, [0, inDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          }),
          translate: entrance.translate,
          scale: `${entrance.scale}`,
          clipPath: entrance.clipPath,
        }}
      >
        {segments.map((seg, i) => {
          if (seg.style === null) return <span key={i}>{seg.text}</span>;
          const progress = progressFor(seg.order);
          const inner = <span style={{ whiteSpace: "pre-wrap" }}>{seg.text}</span>;
          // Each style has its own config shape, so they branch rather than
          // sharing one spread. `seed` is fixed per mark for determinism.
          switch (seg.style) {
            case "circle":
              return (
                <Circle key={i} progress={progress} seed={7 + seg.order} color={accent} strokeWidth={strokeWidth}>
                  {inner}
                </Circle>
              );
            case "underline":
              return (
                <Underline key={i} progress={progress} seed={7 + seg.order} color={accent} strokeWidth={strokeWidth}>
                  {inner}
                </Underline>
              );
            case "box":
              return (
                <Box key={i} progress={progress} seed={7 + seg.order} color={accent} strokeWidth={strokeWidth}>
                  {inner}
                </Box>
              );
            case "bracket":
              return (
                <Bracket key={i} progress={progress} seed={7 + seg.order} color={accent} strokeWidth={strokeWidth}>
                  {inner}
                </Bracket>
              );
            case "strike":
              return (
                <StrikeThrough key={i} progress={progress} seed={7 + seg.order} color={accent} strokeWidth={strokeWidth}>
                  {inner}
                </StrikeThrough>
              );
            default:
              // Highlight draws BEHIND the glyphs, so it needs a translucent fill.
              return (
                <Highlight key={i} progress={progress} seed={7 + seg.order} color={`${accent}59`}>
                  {inner}
                </Highlight>
              );
          }
        })}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
HighlightedPassage.honors = [
  "typography",
  "surface",
  "layout.composition",
  "motion.entrance",
];
