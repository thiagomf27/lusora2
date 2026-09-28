/**
 * PhotoRow — two to four photographs side by side, each with an optional
 * caption chip and verdict (✓ / ✗): the wrong way and the right way, before and
 * after, three sites that share one idea.
 *
 * Born as PhotoCompare (D96, exactly two, left/right) and widened to a row in
 * D97 before any plan used it, because three captioned pictures in a row is the
 * same geometry with a longer list — the count is the length of `photos`, not a
 * variant. ComparisonSplit sets NUMBERS against each other and PortraitPlates
 * presents PEOPLE (its names feed the identity guard, D91) — neither can carry
 * pictures of things.
 *
 * Under a full-bleed composition (`poster` / `page`) the cards sit on the
 * theme's page, edge to edge; under `centered` they float over the shot.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  densityScale,
  easingCurve,
  fontStack,
  fullBleed,
  pageGround,
  motionScale,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";
import { PhotoCard } from "../parts/PhotoCard.tsx";

const Photo = z.object({
  /** Path to a still or clip under the video dir; a placeholder stands in when absent. */
  image: z.string().max(160).optional(),
  caption: z.string().max(40).optional(),
  verdict: z.enum(["right", "wrong"]).optional(),
});

export const PhotoRowProps = z.object({
  photos: z.array(Photo).min(2).max(4),
  title: z.string().max(56).optional(),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type PhotoRowProps = z.infer<typeof PhotoRowProps>;

export function PhotoRow({ props, theme }: { props: PhotoRowProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const bleed = fullBleed(theme);
  const ground = bleed ? pageGround(theme) : null;
  const curve = Easing.bezier(...easingCurve(theme));

  const entrance = useEntrance(theme, {
    component: "PhotoRow",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    seconds: 0.45,
  });
  const { opacity, inDur } = entrance;

  const gap = width * 0.035 * density;
  const titleH = props.title ? height * 0.1 : 0;
  const n = props.photos.length;
  // Wider than tall for a pair; nearer square as the row fills, so four cards
  // still leave the caption chips room under them.
  const aspect = n <= 2 ? 1.15 : 1.05;
  const cardW = Math.min((width * 0.86 - gap * (n - 1)) / n, (height * 0.62 - titleH) * aspect);
  const cardH = cardW / aspect;

  // The second card lands a beat after the first: the contrast is read left to right.
  const stagger = Math.round(fps * 0.35 * durationMul);
  const cardDur = Math.round(fps * 0.55 * durationMul);
  const fixturesAt = inDur + stagger + Math.round(fps * 0.2 * durationMul);
  const clock = (start: number, dur: number) =>
    interpolate(frame, [start, start + dur], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: curve });

  const sides = props.photos;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {ground ? <div style={{ position: "absolute", inset: 0, ...ground }} /> : null}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: height * 0.04 * density,
        }}
      >
        {props.title ? (
          <div
            style={{
              fontFamily: fontStack(theme.typography.display),
              fontSize: height * 0.05 * typeScale(theme, "title"),
              fontWeight: typeWeight(theme, 700),
              letterSpacing: typeTracking(theme, 0),
              color: theme.colors.text,
              maxWidth: width * 0.84,
              textAlign: "center",
              opacity: clock(0, inDur),
            }}
          >
            {props.title}
          </div>
        ) : null}
        <div style={{ display: "flex", gap, alignItems: "flex-start" }}>
          {sides.map((side, i) => {
            const arrive = clock(i * stagger, cardDur);
            return (
              <div
                key={i}
                style={{
                  opacity: arrive,
                  translate: `0 ${interpolate(arrive, [0, 1], [height * 0.03, 0])}px`,
                }}
              >
                <PhotoCard
                  theme={theme}
                  image={side.image}
                  w={cardW}
                  h={cardH}
                  frameHeight={height}
                  verdict={side.verdict}
                  caption={side.caption}
                  emphasis={props.emphasis}
                  progress={arrive}
                  fixtures={clock(fixturesAt + i * stagger, Math.round(fps * 0.6 * durationMul))}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
PhotoRow.honors = [
  "typography",
  "surface",
  "surface.elevation",
  "layout.composition",
  "motion.entrance",
  "motion.easing",
];
