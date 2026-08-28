/**
 * TextLockup — the shared drawing behind the `basic` pack.
 *
 * The pack exists for videos whose whole visual language is TEXT ON FOOTAGE:
 * no plate, no card, no chart, nothing the viewer has to read as a graphic.
 * Core cannot carry that geometry — every core overlay that places type in a
 * corner (StatTag, DateStamp) paints a chip behind it, because core assumes an
 * overlay is a THING sitting on the shot rather than a line written into it.
 *
 * This file is not registered in the catalog. The four registered entries
 * (TextTitle, TextPlace, TextName, TextHighlight, TextTag) are wrappers over it —
 * see basic.json. They differ in the props their role actually needs and in
 * where that role sits by default, which is the point: the planner picks a
 * MEANING and the placement comes free, instead of choosing a corner on every
 * overlay it writes.
 *
 * Whether there is a box at all is the `background` PROP, for the same reason
 * `emphasis` is a prop: it is a per-overlay decision the planner makes about
 * one line ("this one is a chip"). When the overlay says nothing, the theme's
 * `surface.text_plate` answers, and omitting both leaves the type bare. WHICH colour the chip is, once asked for, is the
 * theme's `surface.plate` — `accent` is the tag idiom, a coloured chip with the
 * label on a quieter chip of page colour beneath it. Type, density, case,
 * tracking and motion come from the theme either way, so a `basic` overlay in a
 * serif theme is set in that serif.
 */
import { z } from "zod";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Entrance, Theme } from "../theme.ts";
import {
  contrastInk,
  contrastRatio,
  densityScale,
  plateColor,
  fontStack,
  TEXT_ENTRANCES,
  typeCase,
  typeScale,
  surfaceColor,
  surfaceStyle,
  textPlate,
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

export interface TextLockupProps {
  /** Catalog entry name, so `motion.per_component` can target the role. */
  component: string;
  /** The line itself. */
  lead: string;
  /** A quieter second line under it — a pronunciation, a role, a region, a label. */
  sub?: string;
  /** A phrase inside `lead` to lift out of the rest. */
  mark?: string;
  position: Position;
  size: Size;
  /**
   * The `background` prop. `undefined` means the overlay did not say, and the
   * theme's `surface.text_plate` answers instead.
   */
  plated?: boolean;
  /**
   * Whether this role takes the theme's `text_plate` default at all. A title
   * opts out: it is the subject of the frame rather than a label on it, and a
   * theme that wants its labels chipped rarely wants its titles boxed. An
   * explicit `background` still wins for every role.
   */
  followsThemePlate?: boolean;
  theme: Theme;
  /** Type speed, in seconds for the whole line. */
  seconds?: number;
  /**
   * Entrances this lockup can draw. Defaults to the text set; a counter passes
   * the panel set, because the figure is already animating and typing a number
   * on top of a count-up reads as a stutter (the same call TemplateOverlay
   * makes for `big_number`).
   */
  supported?: readonly Entrance[];
  /**
   * Set the lead in the BODY face with tabular figures. The pack otherwise sets
   * its lead in the display face, but a counting number in a display face jumps
   * sideways as its digits change — Playfair's proportional old-style figures
   * are the worst case, and it is why AnimatedCounter, StatTag, BarChart and
   * RankLabel all set numerals in the body face too.
   */
  numeric?: boolean;
}

export function TextLockup({
  component,
  lead,
  sub,
  mark,
  position,
  size,
  plated: platedProp,
  followsThemePlate = true,
  theme,
  seconds = 0.9,
  supported = TEXT_ENTRANCES,
  numeric = false,
}: TextLockupProps) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const density = densityScale(theme);

  const entrance = useEntrance(theme, {
    component,
    supported,
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

  const plated = platedProp ?? (followsThemePlate && textPlate(theme));
  const leadPlate = plateColor(theme);
  // The sub sits on the quieter chip: the page, under the loud plate above it.
  const subPlate = surfaceColor(theme);
  const leadInk = plated ? contrastInk(theme, leadPlate) : theme.colors.text;
  const subInk = plated ? contrastInk(theme, subPlate) : theme.colors.text;

  // Bare over unknown footage, the only thing keeping type legible is its own
  // shadow; which way it falls depends on the ink, since a light theme setting
  // dark type needs a light halo rather than a darker one. On a plate the box
  // is already doing that job and a halo only smears the edge.
  const lightInk = contrastRatio(theme.colors.text, "#000000") > contrastRatio(theme.colors.text, "#ffffff");
  const halo = lightInk ? "0,0,0" : "255,255,255";
  const textShadow = plated
    ? undefined
    : `0 ${height * 0.0015}px ${height * 0.016}px rgba(${halo},0.55), 0 ${height * 0.0008}px ${height * 0.003}px rgba(${halo},0.38)`;

  // A tag is padded off its own type, so one chip hugs a word and another a
  // sentence without either being measured in pixels.
  const pad = (font: number) => `${font * 0.26}px ${font * 0.44}px`;
  const radius = surfaceStyle(theme, { radius: 6 }).borderRadius;

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
          gap: (plated ? subFont * 0.16 : subFont * 0.42) * density,
        }}
      >
        <div
          style={{
            fontFamily: fontStack(
              numeric ? theme.typography.body : theme.typography.display
            ),
            ...(numeric ? { fontVariantNumeric: "tabular-nums" as const } : null),
            fontSize: leadFont,
            fontWeight: typeWeight(theme, size === "big" ? 400 : 600),
            letterSpacing: typeTracking(theme, size === "big" ? 0.005 : 0.02),
            textTransform: casing,
            lineHeight: 1.14,
            color: leadInk,
            textShadow,
            ...(plated
              ? { background: leadPlate, padding: pad(leadFont), borderRadius: radius }
              : null),
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
              color: subInk,
              // Bare, the hierarchy is opacity, because there is no ground to
              // pick a muted ink against. On a plate the two chips already
              // separate them, so the sub keeps its full contrast.
              opacity: (plated ? 1 : 0.78) * entrance.after(entrance.inDur * 0.15),
              textShadow,
              ...(plated
                ? { background: subPlate, padding: pad(subFont), borderRadius: radius }
                : null),
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
