/**
 * TextTag — the shared drawing behind the `basic` pack.
 *
 * The pack exists for videos whose whole visual language is TEXT ON FOOTAGE:
 * no plate, no card, no chart, nothing the viewer has to read as a graphic.
 * Core cannot carry that geometry — every core overlay that places type in a
 * corner (StatTag, DateStamp) paints a chip behind it, because core assumes an
 * overlay is a THING sitting on the shot rather than a line written into it.
 *
 * This file is not registered in the catalog. The four registered entries
 * (TextTitle, TextPlace, TextName, TextHighlight) are role wrappers over it —
 * see basic.json. They differ in the props their role actually needs and in
 * where that role sits by default, which is the point: the planner picks a
 * MEANING and the placement comes free, instead of choosing a corner on every
 * overlay it writes.
 *
 * Deliberately plate-free, so it does not answer to `surface.fill` or
 * `surface.plate`. It still reads type, density, case, tracking and motion
 * from the theme — a `basic` overlay in a serif theme is set in that serif.
 */
import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastRatio,
  densityScale,
  fontStack,
  TEXT_ENTRANCES,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

/** Shared by all four entries; each role re-declares the subset it uses. */
export const POSITION = z.enum(["center", "top_left", "top_right", "bottom_left", "bottom_right"]);
export const SIZE = z.enum(["medium", "big"]);
export type Position = z.infer<typeof POSITION>;
export type Size = z.infer<typeof SIZE>;

/** Fractions of frame height. `big` is a title; `medium` is everything else. */
const SIZE_SCALE: Record<Size, number> = { medium: 0.046, big: 0.084 };

export interface TextTagProps {
  /** Catalog entry name, so `motion.per_component` can target the role. */
  component: string;
  /** The line itself. */
  lead: string;
  /** A quieter second line under it — a pronunciation, a role, a region. */
  sub?: string;
  /** A phrase inside `lead` to lift out of the rest. */
  mark?: string;
  position: Position;
  size: Size;
  theme: Theme;
  /** Type speed, in seconds for the whole line. */
  seconds?: number;
}

export function TextTag({
  component,
  lead,
  sub,
  mark,
  position,
  size,
  theme,
  seconds = 0.9,
}: TextTagProps) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const density = densityScale(theme);

  const entrance = useEntrance(theme, {
    component,
    supported: TEXT_ENTRANCES,
    // The pack's reason to exist is text that writes itself on. A theme can
    // still override to fade/rise; this is only what it does untouched.
    fallback: "typewriter",
    seconds,
  });
  const { opacity, typed } = entrance;

  // typeCase resolves to a textTransform, so the STRING is never rewritten:
  // `mark` has to keep indexing into the text the planner actually wrote.
  const casing = typeCase(theme, "none");
  const shown = typed(lead);

  // "Slow growing": a drift across the whole hold, not an arrival. It has to
  // still be moving while the narration is on the line, so it runs on the
  // sequence clock rather than on the entrance's.
  const grow = interpolate(frame, [0, durationInFrames], [1, 1.035], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const leadFont = height * SIZE_SCALE[size] * typeScale(theme, size === "big" ? "title" : "kicker");
  const subFont = leadFont * (size === "big" ? 0.34 : 0.62);

  // Over unknown footage the only thing keeping type legible is its own
  // shadow — this pack paints no plate on purpose. Which way it falls depends
  // on the ink: a light theme setting dark type needs a light halo, not a
  // darker one.
  const lightInk = contrastRatio(theme.colors.text, "#000000") > contrastRatio(theme.colors.text, "#ffffff");
  const halo = lightInk ? "0,0,0" : "255,255,255";
  const textShadow = `0 ${height * 0.0015}px ${height * 0.016}px rgba(${halo},0.55), 0 ${height * 0.0008}px ${height * 0.003}px rgba(${halo},0.38)`;

  const centred = position === "center";
  const top = position.startsWith("top");
  const left = position.endsWith("left");
  const inset = { x: width * 0.055, y: height * 0.085 * density };

  const markAt = mark ? lead.indexOf(mark) : -1;

  return (
    <div
      style={{
        position: "absolute",
        ...(centred
          ? { inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }
          : {
              top: top ? inset.y : undefined,
              bottom: top ? undefined : inset.y,
              left: left ? inset.x : undefined,
              right: left ? undefined : inset.x,
              display: "flex",
            }),
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale * grow}`,
        clipPath: entrance.clipPath,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: centred ? "center" : left ? "flex-start" : "flex-end",
          textAlign: centred ? "center" : left ? "left" : "right",
          maxWidth: centred ? width * 0.78 : width * 0.42,
          gap: subFont * 0.42 * density,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(theme.typography.display),
            fontSize: leadFont,
            fontWeight: typeWeight(theme, size === "big" ? 400 : 600),
            letterSpacing: typeTracking(theme, size === "big" ? 0.005 : 0.02),
            textTransform: casing,
            lineHeight: 1.14,
            color: theme.colors.text,
            textShadow,
          }}
        >
          {markAt >= 0 ? <Marked text={shown} from={markAt} to={markAt + mark!.length} /> : shown}
        </div>
        {sub ? (
          <div
            style={{
              fontFamily: fontStack(theme.typography.body),
              fontSize: subFont,
              fontWeight: typeWeight(theme, 400),
              letterSpacing: typeTracking(theme, 0.04),
              textTransform: casing,
              lineHeight: 1.3,
              color: theme.colors.text,
              // The hierarchy is opacity rather than a second colour: this
              // pack has no ground to pick a muted ink against.
              opacity: 0.78 * entrance.after(entrance.inDur * 0.15),
              textShadow,
            }}
          >
            {sub}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The marked phrase, applied to whatever the typewriter has revealed so far.
 * Ranges are taken from the FULL line so the emphasis does not slide as the
 * text types on; the slice is what changes, not where the phrase is.
 */
function Marked({ text, from, to }: { text: string; from: number; to: number }) {
  return (
    <>
      <span style={{ opacity: 0.62 }}>{text.slice(0, from)}</span>
      <span>{text.slice(from, to)}</span>
      <span style={{ opacity: 0.62 }}>{text.slice(to)}</span>
    </>
  );
}
