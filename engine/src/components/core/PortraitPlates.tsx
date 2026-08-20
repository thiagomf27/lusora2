/**
 * PortraitPlates — one or two matted picture plates with an identity lockup.
 *
 * Was `ArchiveFrames` in the `archive` pack. It moved into core and changed
 * name for the reason the two-name test exists: `Archive` describes a LOOK, and
 * a component name has to describe what it draws. Nothing about matting a
 * portrait and setting a name beside it belongs to archival documentary — it is
 * how you put a face on screen in any channel, and the archival version of it
 * is `contracts/themes/*` plus the D66 tokens.
 *
 * This is also why neither `PortraitCard` nor `ImagePair` was ever written: one
 * plate with a name is a portrait card, two side by side under one kicker are
 * an image pair, and the count is the length of `frames` rather than a variant.
 */
import { z } from "zod";
import { Easing, Img, interpolate, random, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastInk,
  densityScale,
  emphasisColor,
  fadeInOutRange,
  fontStack,
  groundStyle,
  motionScale,
  ruleWidth,
  surfaceColor,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
} from "../theme.ts";

const FrameSpec = z.object({
  /** Path under public/, e.g. "people/mughniyeh.jpg". Omit for a stand-in plate. */
  image: z.string().max(120).optional(),
  /** The subject's name. Present it beside the plate, or beneath it. */
  label: z.string().max(40).optional(),
  /** Second line under the name: role, rank, date, place. */
  sublabel: z.string().max(56).optional(),
  /** Shape of the plate — match it to the asset you are dropping in. */
  orientation: z.enum(["portrait", "landscape", "square"]).default("portrait"),
});

export const PortraitPlatesProps = z.object({
  frames: z.array(FrameSpec).min(1).max(2),
  /** Tracked-out eyebrow in the top-left corner, above everything. */
  kicker: z.string().max(48).optional(),
  /**
   * Where a name sits relative to its plate. `beside` is the character-
   * presentation lockup and only applies to a SINGLE frame — a pair has no
   * room for it and always sets its names underneath.
   */
  label_position: z.enum(["beside", "below"]).default("beside"),
  /**
   * How the name is set. `plate` obeys the pack rule — ink on a white plate
   * over a tan sub-bar, the same lockup as ArchiveLowerThird — and is the
   * default because it survives a cut to a white sky. `bare` sets light type
   * straight onto the backdrop: correct for a DESIGNED full-frame scene, wrong
   * over unknown archive footage, where it can vanish.
   */
  label_style: z.enum(["plate", "bare"]).default("plate"),
  emphasis: z.enum(["accent", "neutral"]).default("accent"),
});
export type PortraitPlatesProps = z.infer<typeof PortraitPlatesProps>;

/**
 * w / h for each plate shape.
 *
 * Read through a fallback, not indexed straight: the Zod `.default()` on a
 * frame's `orientation` is documentation — nothing parses props through the
 * schema at render time, and the compiler fills catalog defaults for TOP-LEVEL
 * props only. A nested default therefore never lands, and a bare lookup would
 * hand `undefined` to the arithmetic and size the plate NaN x NaN.
 */
const ASPECT = { portrait: 3 / 4, landscape: 16 / 9, square: 1 } as const;
const aspectOf = (o: keyof typeof ASPECT | undefined) => ASPECT[o!] ?? ASPECT.portrait;

/** Largest box of the given aspect that fits inside boxW x boxH. */
function fitAspect(boxW: number, boxH: number, aspect: number) {
  const w = Math.min(boxW, boxH * aspect);
  return { w, h: w / aspect };
}

export function PortraitPlates({ props, theme }: { props: PortraitPlatesProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const paper = surfaceColor(theme);
  const accent = emphasisColor(theme, props.emphasis);

  const pair = props.frames.length > 1;
  const bare = props.label_style === "bare";
  const ink = theme.colors.text;
  // Type on the tan, not type on the page: the kicker bar and the sub-bar are
  // grounds, so they read their own ink rather than the theme's.
  const accentInk = contrastInk(theme, accent);
  // `beside` needs the horizontal room a pair has already spent on its second
  // plate, so a pair always sets names underneath regardless of the prop.
  const beside = !pair && props.label_position === "beside";

  const inDur = Math.round(fps * 0.42 * durationMul);
  const ease = Easing.bezier(0.16, 1, 0.3, 1);

  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // The box each plate is fitted into. A pair splits the frame; a single plate
  // with a name beside it gives up half its width to the name.
  const boxW = pair ? width * 0.38 : beside ? width * 0.4 : width * 0.62;
  const boxH = pair ? height * 0.56 : height * 0.66;

  const mat = ruleWidth(theme, Math.max(3, Math.round(height * 0.013)));
  const gap = width * 0.045;

  const grain = theme.grain ?? "none";
  const grainOpacity = grain === "archival" ? 0.15 : grain === "film" ? 0.08 : 0;
  const grainSeed = Math.floor(frame / 2) % 12;

  const kickerAt = Math.round(fps * 0.12 * durationMul);
  const kickerIn = interpolate(frame, [kickerAt, kickerAt + inDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return (
    <div style={{ position: "absolute", inset: 0, opacity }}>
      {props.kicker ? (
        <div
          style={{
            position: "absolute",
            left: width * 0.055 * density,
            top: height * 0.075 * density,
            // On a plate the eyebrow becomes the pack's tan kicker bar; bare it
            // is tan type on the backdrop, as in a designed full-frame scene.
            background: bare ? "transparent" : accent,
            padding: bare ? 0 : `${height * 0.009}px ${width * 0.014}px`,
            fontFamily: fontStack(theme.typography.body),
            fontSize: height * 0.019 * typeScale(theme, "kicker"),
            fontWeight: typeWeight(theme, 500),
            letterSpacing: typeTracking(theme, 0.2),
            textTransform: typeCase(theme, "uppercase"),
            color: bare ? accent : accentInk,
            opacity: kickerIn,
            whiteSpace: "pre-line",
            transformOrigin: "left center",
            scale: bare ? undefined : `${kickerIn} 1`,
          }}
        >
          {props.kicker}
        </div>
      ) : null}

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap,
          padding: `0 ${width * 0.055 * density}px`,
        }}
      >
        {props.frames.map((spec, i) => {
          const { w: picW, h: picH } = fitAspect(boxW, boxH, aspectOf(spec.orientation));
          // Second plate lands a beat after the first, so a pair reads as one
          // gesture with a stagger rather than two things appearing at once.
          const at = Math.round(fps * (i === 0 ? 0.0 : 0.22) * durationMul);
          const plateAt = at;
          const nameAt = at + Math.round(fps * 0.34 * durationMul);

          const wipe = interpolate(frame, [plateAt, plateAt + Math.round(fps * 0.5 * durationMul)], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: ease,
          });
          const nameIn = interpolate(frame, [nameAt, nameAt + inDur], [0, 1], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          });
          // Slow push inside the mat for the whole beat.
          const push = interpolate(frame, [0, durationInFrames], [1, 1.06], {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
            easing: Easing.bezier(0.45, 0, 0.55, 1),
          });

          const nameSize = height * (pair ? 0.036 : beside ? 0.055 : 0.044) * typeScale(theme, "title");
          const subSize = height * (pair ? 0.019 : 0.022) * typeScale(theme, "caption");

          const nameBlock = spec.label ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                // A plate lockup is sized by its own text and hangs from one
                // edge, so it stays left-aligned even when the column centres.
                alignItems: bare ? (beside ? "flex-start" : "center") : "flex-start",
                textAlign: beside || !bare ? "left" : "center",
                maxWidth: beside ? width * 0.36 : picW + mat * 2,
                marginTop: beside ? 0 : height * 0.032,
                opacity: bare ? nameIn : 1,
                translate: bare ? `0 ${(1 - nameIn) * height * 0.014}px` : undefined,
                filter: bare
                  ? undefined
                  : `drop-shadow(0 ${height * 0.006}px ${height * 0.018}px rgba(0,0,0,0.42))`,
              }}
            >
              <div style={{ position: "relative", maxWidth: "100%" }}>
                {bare ? null : (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      backgroundColor: paper,
                      transformOrigin: "left center",
                      scale: `${nameIn} 1`,
                    }}
                  />
                )}
                <div
                  style={{
                    position: "relative",
                    padding: bare ? 0 : `${height * 0.012}px ${width * 0.018}px ${height * 0.014}px`,
                    fontFamily: fontStack(theme.typography.display),
                    // The pack's name weight. Bare, the type has to be LIGHT to
                    // read on the backdrop; on a plate it is the plate's ink.
                    fontWeight: typeWeight(theme, 700),
                    fontSize: nameSize,
                    lineHeight: 1.1,
                    letterSpacing: typeTracking(theme, 0.03),
                    textTransform: typeCase(theme, "uppercase"),
                    color: bare ? paper : ink,
                    overflowWrap: "anywhere",
                    opacity: bare ? 1 : nameIn,
                  }}
                >
                  {spec.label}
                </div>
              </div>

              {spec.sublabel ? (
                <div style={{ position: "relative", maxWidth: "100%", marginTop: bare ? height * 0.014 : 0 }}>
                  {bare ? null : (
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        backgroundColor: accent,
                        transformOrigin: "left center",
                        scale: `${nameIn} 1`,
                      }}
                    />
                  )}
                  <div
                    style={{
                      position: "relative",
                      padding: bare ? 0 : `${height * 0.008}px ${width * 0.018}px ${height * 0.009}px`,
                      fontFamily: fontStack(theme.typography.body),
                      fontSize: subSize,
                      fontWeight: bare ? 400 : 600,
                      letterSpacing: typeTracking(theme, 0.14),
                      textTransform: typeCase(theme, "uppercase"),
                      // Tan is a GROUND: bare it is type on the backdrop (fine
                      // at 5.6:1 there), on a plate it is the sub-bar under ink.
                      color: bare ? accent : accentInk,
                      overflowWrap: "anywhere",
                      opacity: nameIn,
                    }}
                  >
                    {spec.sublabel}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null;

          const plate = (
            <div
              style={{
                position: "relative",
                padding: mat,
                ...(groundStyle(theme, { radius: 4, alpha: "ff", legible: true }) ?? { background: paper }),
                filter: `drop-shadow(0 ${height * 0.01}px ${height * 0.026}px rgba(0,0,0,0.5))`,
                // Hard-edged left-to-right reveal — the pack wipes, it does not
                // dissolve. Clipping the whole mat keeps the white border and
                // the picture arriving as one object.
                clipPath: `inset(0 ${(1 - wipe) * 100}% 0 0)`,
              }}
            >
              <div style={{ position: "relative", width: picW, height: picH, overflow: "hidden", background: surfaceColor(theme) }}>
                <div style={{ position: "absolute", inset: 0, scale: `${push}` }}>
                  {spec.image ? (
                    <Img src={staticFile(spec.image)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  ) : (
                    <StandInPlate theme={theme} width={picW} height={picH} seed={i} />
                  )}
                </div>

                {grainOpacity > 0 ? (
                  <div
                    style={{ position: "absolute", inset: 0, mixBlendMode: "overlay", opacity: grainOpacity, pointerEvents: "none" }}
                  >
                    <svg width={picW} height={picH}>
                      {/* Filter ids must differ per plate — two frames sharing
                          one id would both resolve to the first definition. */}
                      <filter id={`archive-frames-grain-${i}`}>
                        <feTurbulence type="fractalNoise" baseFrequency={0.9} numOctaves={3} seed={grainSeed} stitchTiles="stitch" />
                        <feColorMatrix type="saturate" values="0" />
                      </filter>
                      <rect width={picW} height={picH} filter={`url(#archive-frames-grain-${i})`} />
                    </svg>
                  </div>
                ) : null}
              </div>
            </div>
          );

          return beside ? (
            <div key={i} style={{ display: "flex", flexDirection: "row", alignItems: "center", gap }}>
              {plate}
              {nameBlock}
            </div>
          ) : (
            <div key={i} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {plate}
              {nameBlock}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Stand-in for a missing asset, so the beat blocks out before the picture exists. */
function StandInPlate({ theme, width, height, seed }: { theme: Theme; width: number; height: number; seed: number }) {
  const cols = 14;
  const rows = 18;
  const cellW = width / cols;
  const cellH = height / rows;
  return (
    <svg width={width} height={height}>
      <rect width={width} height={height} fill={theme.colors.bg} />
      {new Array(cols * rows).fill(0).map((_, i) => (
        <rect
          key={i}
          x={(i % cols) * cellW}
          y={Math.floor(i / cols) * cellH}
          width={cellW}
          height={cellH}
          fill={theme.colors.neutral}
          fillOpacity={0.05 + random(`af-plate-${seed}-${i}`) * 0.12}
        />
      ))}
      <line x1={width * 0.5} y1={height * 0.44} x2={width * 0.5} y2={height * 0.56} stroke={theme.colors.neutral} strokeOpacity={0.5} />
      <line x1={width * 0.44} y1={height * 0.5} x2={width * 0.56} y2={height * 0.5} stroke={theme.colors.neutral} strokeOpacity={0.5} />
    </svg>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
PortraitPlates.honors = ["typography", "surface", "motion.entrance", "motion.easing"];
