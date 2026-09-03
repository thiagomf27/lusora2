/**
 * TextBanner — one line stated flat across the shot, in a bordered bar.
 *
 * The pack's SECOND general-purpose entry. TextTag is the escape hatch for text
 * with no role, set as bare type in a corner the planner picks; this is the
 * escape hatch for text with no role that the channel states in a bar. They
 * split on FORM, not on meaning: either will carry a date, a count, a caption,
 * a claim about the footage.
 *
 * That it takes any content and still keeps a fixed placement is why it is an
 * entry rather than a position on TextTag. TextTag pays for its freedom by
 * making the planner choose a corner every time; a banner's geometry IS its
 * placement — a band off the bottom edge, left by default — so the freedom is free.
 *
 * Not drawn by TextLockup, which is a column of two lines pinned to a corner or
 * the centre. This is a strip, and the difference is the whole component: a
 * measured band, a left rule, one line, no label. What it shares with the pack is
 * the theme resolution, and it takes all of it — the two reference looks (a
 * black bar with white caps and a red rule; a paper bar with sentence case and
 * a dark rule) are this one component under two themes, and nothing but tokens
 * separates them: `surface.plate` paints the bar, `colors.accent` draws the
 * rule, `surface.rule` sets its width, `type.case` decides the caps.
 *
 * The arrival is three beats, not one: the RULE grows, the BAR slides open to
 * the right off it, and the LINE types in behind that. It leaves the same way,
 * in reverse — the bar closes back onto the rule and the rule shrinks away —
 * because a bar that arrives as a mechanism and then dissolves reads as two
 * different objects. Nothing fades: opacity is 1 for the whole hold, and the
 * clip is what starts and ends the overlay.
 *
 * Only the typing is the ENTRANCE — `typewriter`, so `motion.per_component`,
 * the compiler's entrance window and `sound.per_entrance` all still see the
 * kind they resolve today — and the rest is the component's own choreography
 * on its own clock, the way TextLockup's slow drift is. A theme that overrides
 * the entrance to something else gets exactly what it asked for: the plain
 * entrance, its fade, and none of this.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import {
  contrastInk,
  contrastRatio,
  densityScale,
  easingCurve,
  fontStack,
  ruleWidth,
  surfaceColor,
  surfaceStyle,
  TEXT_ENTRANCES,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const TextBannerProps = z.object({
  text: z.string().max(110),
  position: z
    .enum(["bottom_left", "bottom_center", "top_left", "top_center"])
    .default("bottom_left"),
});
export type TextBannerProps = z.infer<typeof TextBannerProps>;

export function TextBanner({ props, theme }: { props: TextBannerProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { width, height, durationInFrames } = useVideoConfig();
  const density = densityScale(theme);

  const entrance = useEntrance(theme, {
    component: "TextBanner",
    supported: TEXT_ENTRANCES,
    // The pack's reason to exist is text that writes itself on, and a bar is
    // still text: the box wipes open, then the line types into it.
    fallback: "typewriter",
    seconds: 1.0,
  });

  // Only when the entrance is the one this component asks for. A theme that
  // overrode it to `fade` or `wipe` has said what the arrival is, and drawing a
  // second one underneath would be the component talking over the theme.
  const choreographed = entrance.kind === "typewriter";

  // The two beats, as fractions of the entrance the theme already sizes. The
  // rule is the slower of them: it is a mark appearing out of nothing and needs
  // to be read as one before the bar uses it as a hinge. Together they finish
  // at half the entrance, so the bar is open while most of the line is still
  // typing — the text is written into a bar that is already there, rather than
  // racing its own container.
  const curve = Easing.bezier(...easingCurve(theme));
  const ruleDur = Math.max(1, Math.round(entrance.inDur * 0.28));
  const barDur = Math.max(1, Math.round(entrance.inDur * 0.22));
  const ease = { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: curve } as const;

  const ruleIn = interpolate(frame, [0, ruleDur], [0, 1], ease);
  const barIn = interpolate(frame, [ruleDur, ruleDur + barDur], [0, 1], ease);
  // The same two beats, mirrored against the end of the sequence: the bar
  // closes first, then the rule goes. `Math.min` against the entrance rather
  // than a separate branch, so a sequence too short to hold both simply never
  // reaches 1 — the overlay opens as far as it gets and closes from there.
  const outAt = durationInFrames - (ruleDur + barDur);
  const barOut = interpolate(frame, [outAt, outAt + barDur], [1, 0], ease);
  const ruleOut = interpolate(frame, [outAt + barDur, durationInFrames], [1, 0], ease);

  const barOpen = choreographed ? Math.min(barIn, barOut) : 1;
  const ruleExtent = choreographed ? Math.min(ruleIn, ruleOut) : 1;

  const font = height * 0.036 * typeScale(theme, "kicker");
  // The PAGE, not the plate. Every other panel in the catalogue answers to
  // `surface.plate`, but this bar has to leave the accent UNSPENT: the accent
  // is the rule, and a theme whose plate is the accent (`default-editorial`)
  // paints the bar yellow and leaves the one mark on it no colour to be — the
  // rule falls back to the ink and vanishes into any dark shot. A ground the
  // line is written on, with the accent beside it, is the shape this is.
  const ground = surfaceColor(theme);
  const ink = contrastInk(theme, ground);
  // One rule, down the LEFT edge, and no box around the rest: the bar is a
  // ground the line is set on, and the stripe is where it starts. Heavier than
  // a border because it is the only mark on the shape — the weight the card
  // template gives its own accent bar.
  const ruleW = ruleWidth(theme, Math.max(3, Math.round(height * 0.007)));
  // The rule is the accent — that is what makes the same bar red on one channel
  // and black on another. But a theme is free to set an accent that lands on
  // its own plate (`standard` is white on white under `plate: invert`), and a
  // rule nobody can see is not a look, it is a missing rule. 3 is the WCAG
  // floor for a non-text mark; below it the ink draws it instead.
  const accentReads = contrastRatio(theme.colors.accent, ground) >= 3;
  const ruleColor = accentReads ? theme.colors.accent : ink;
  // The rule does NOT answer to `surface.accent_rule`, which every other
  // component reads. That token moves or removes an ORNAMENT — the stripe on a
  // FactCard, the underline on a big number — and this is not one: it is the
  // bar's starting edge, the only mark on a shape that is otherwise a flat
  // ground, and a banner without it is a rectangle. `bold-editorial` says
  // `top` and `default-editorial` says `none`; honouring either would have
  // moved or deleted the thing the component is.

  const top = props.position.startsWith("top");
  const left = props.position.endsWith("left");
  const inset = width * 0.055;

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        top: top ? height * 0.1 * density : undefined,
        bottom: top ? undefined : height * 0.11 * density,
        display: "flex",
        justifyContent: left ? "flex-start" : "center",
        padding: `0 ${inset}px`,
        // No fade either way. The clip is what starts and ends this overlay,
        // and an opacity ramp on top of it reads as a third motion nobody asked
        // for. A theme that overrode the entrance keeps its own fade.
        opacity: choreographed ? 1 : entrance.opacity,
        translate: entrance.translate,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "stretch",
          maxWidth: width * 0.84,
          // Scale on the LOCKUP, not on the full-width row above it: scaling
          // the row moves a left-aligned bar off its margin.
          scale: `${entrance.scale}`,
          transformOrigin: left ? (top ? "left top" : "left bottom") : "center",
        }}
      >
        {/* The rule is its own element rather than the bar's border, because it
            has to move on its own clock: it grows before the bar exists and it
            is still there after the bar has closed. `stretch` keeps it the
            bar's height without either of them being told what that is. */}
        <div
          style={{
            flex: `0 0 ${ruleW}px`,
            background: ruleColor,
            scale: `1 ${ruleExtent}`,
          }}
        />
        <div
          style={{
            background: ground,
            borderRadius: surfaceStyle(theme, { radius: 3 }).borderRadius,
            // Padded off the type, so one bar hugs a clause and another a
            // sentence without either being measured in pixels.
            padding: `${font * 0.34 * density}px ${font * 0.6 * density}px`,
            fontFamily: fontStack(theme.typography.display),
            fontSize: font,
            fontWeight: typeWeight(theme, 700),
            letterSpacing: typeTracking(theme, 0.015),
            textTransform: typeCase(theme, "none"),
            lineHeight: 1.16,
            textAlign: left ? "left" : "center",
            color: ink,
            clipPath: choreographed
              ? `inset(0 ${(1 - barOpen) * 100}% 0 0)`
              : entrance.clipPath,
          }}
        >
          {/* The full line, invisible, holds the bar at its final width.
              Without it the box is only ever as wide as the text typed so far,
              so the bar grows sideways under the clip instead of opening. */}
          <div style={{ display: "grid" }}>
            <span style={{ gridArea: "1 / 1", visibility: "hidden" }} aria-hidden>
              {props.text}
            </span>
            <span style={{ gridArea: "1 / 1" }}>{entrance.typed(props.text)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
