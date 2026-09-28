/**
 * AnimatedCounter — one number counting up, with a label and an underline
 * drawing in sync. The general-purpose counter (AnimatedPercentage is the
 * radial 0–100 variant).
 *
 * Numerals use the BODY face with tabular-nums: Playfair's old-style
 * proportional figures make a counting number shuffle sideways.
 *
 * Centred, the figure sits in a BOX and its label is set bare underneath. The
 * box is the component's own and does not answer to `surface.fill` — `fill` is
 * whether the THEME puts a panel behind an overlay, and this is the overlay's
 * own shape, the same way PortraitPlates sets its names on a plate whatever the
 * theme says. The label carries no ground of its own: one plate is the emphasis,
 * and a second one under it competes with the figure rather than supporting it.
 *
 * `label` is optional. A counter with no label is a bare figure — the thing the
 * narration is already naming out loud — and that is a legitimate overlay, not a
 * half-filled one.
 *
 * The figure's ink comes from the plate it is standing on, never from the accent.
 * `emphasis: "accent"` is the opt-in that tints it; the default is no tint.
 *
 * Two compositions (D70). `centered` is the card it always drew: the figure,
 * its rule and its label stacked in the middle of the shot. `poster` hands it
 * the frame, and for a counter that is not a bigger card — it is a different
 * lockup. The LABEL becomes the headline in the top-left, the way a chart's
 * title does, and the figure takes every pixel underneath, measured rather
 * than guessed at so a seven-digit total and a two-digit one both fill the
 * page without either overflowing it.
 *
 * D96 added a third, `page`: the poster's full-bleed ground under the centred
 * stack — a big figure, its rule and a sentence-case label under it, set on
 * paper like an editorial slide. There the figure is bare (the page is its
 * ground; a box on it would be a second one) and `source` sits at the foot of
 * the frame. `source` is a credit line in every composition.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { fitText } from "@remotion/layout-utils";
import type { Theme } from "../theme.ts";
import {
  figureFrame,
  chipColor,
  accentInk,
  chartStyle,
  countedValue,
  composition,
  contrastInk,
  contrastRatio,
  densityScale,
  easingCurve,
  emphasisColor,
  figureFace,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  PANEL_ENTRANCES,
  pageGround,
  paperStock,
  plateColor,
  posterPad,
  ruleWidth,
  surfaceColor,
  surfaceStyle,
  textureLayer,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  useEntrance,
} from "../theme.ts";

export const AnimatedCounterProps = z.object({
  value: z.number(),
  /** Optional: the narration often names the figure already. */
  label: z.string().max(56).optional(),
  prefix: z.string().max(8).optional(),
  suffix: z.string().max(16).optional(),
  decimals: z.number().int().min(0).max(2).default(0),
  /** Prefixes the settled value with "~". */
  approximate: z.boolean().default(false),
  /** A second line under the label. Was ArchiveCounter's — the same slot, unnamed. */
  caption: z.string().max(64).optional(),
  /** Credit line: where the figure comes from. */
  source: z.string().max(64).optional(),
  position: z.enum(["center", "left", "right"]).default("center"),
  emphasis: z.enum(["accent", "neutral"]).default("neutral"),
});
export type AnimatedCounterProps = z.infer<typeof AnimatedCounterProps>;

export function AnimatedCounter({ props, theme }: { props: AnimatedCounterProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const chart = chartStyle(theme);
  const accent = emphasisColor(theme, props.emphasis);

  // The two compositions (D70). `centered` is the card; `poster` is the page.
  const poster = composition(theme) === "poster";
  const page = composition(theme) === "page";
  /**
   * The box is whatever a plate is painted, and its ink is asked against that
   * box rather than assumed — which is what puts black type on the white plate
   * `surface.plate: invert` asks for, and white type on the dark one `page`
   * gives. `emphasis: "accent"` is the opt-in that tints the figure instead.
   */
  const boxGround = chipColor(theme);
  // `emphasis: "accent"` is a REQUEST for the tint, not a guarantee it is
  // legible: an achromatic theme names white as its accent, `plate: invert`
  // paints the box in the ink, and the two meet as a white figure on a white
  // box — the whole overlay reduced to an empty rectangle with its label
  // underneath. Same guard DocumentCard's stamp takes against its paper stock
  // (D78); 3:1 because the figure is display-sized type.
  const boxInk =
    props.emphasis === "accent" && contrastRatio(accent, boxGround) >= 3
      ? accent
      : contrastInk(theme, boxGround);
  const boxTexture = textureLayer(theme);

  const framePad = posterPad(theme, { width, height });
  /**
   * A centred counter draws ONE background, and it is the box around the
   * figure. It does not ALSO take the theme's generic overlay card: a theme's
   * `fill` and `texture` are honoured by the box itself, so a second panel
   * around the whole lockup says the same thing twice and turns a small graphic
   * into a slab — which is what `field-manual`'s grain card was doing.
   *
   * One exception, and it is the case `groundStyle`'s `legible` flag exists
   * for. A theme whose ink is DARKER than its page sets dark type over unknown
   * footage, and the LABEL sits outside the box where nothing protects it. Those
   * themes keep the plate; every other theme gets the box alone.
   *
   * A poster is untouched — there the ground is the full-bleed page, which is
   * the whole point of that composition.
   */
  const lightInk = paperStock(theme).stock === theme.colors.text;
  const ground = page
    ? pageGround(theme)
    : poster
    ? groundStyle(theme, { radius: 0, legible: true })
    : lightInk
      ? null
      : groundStyle(theme, { radius: 12, legible: true });

  /**
   * A box the same colour as the plate it is standing on is not a box, it is an
   * edge. Under `plate: page` a theme whose `fill` (or whose legibility
   * fallback) already gave this lockup a ground paints both in the same colour,
   * and the result is two nested rectangles with a seam between them. The bar
   * used to hide that; without it the box has to earn itself.
   *
   * Compared on the first seven characters because a ground carries an alpha
   * suffix (`#f2efe6ff`) and a plate colour does not.
   */
  const groundPaint = (ground?.backgroundColor as string | undefined)?.slice(0, 7);
  const boxIsRedundant = groundPaint !== undefined && groundPaint === boxGround.slice(0, 7);

  const curve = Easing.bezier(...easingCurve(theme));
  const entrance = useEntrance(theme, {
    component: "AnimatedCounter",
    supported: PANEL_ENTRANCES,
    fallback: "fade", // its frame did not move before D46
    seconds: 0.4,
  });
  const { opacity, inDur } = entrance;

  const countDur = Math.round(fps * 1.6 * durationMul);
  const progress = interpolate(frame, [0, countDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: curve,
  });
  // `decimals` is an AUTHORED prop and outranks the theme: a figure the script
  // asked for to two places is a fact about the claim, not a look. The theme's
  // `chart.number_format` only gets to speak when the author said nothing.
  const figureAt = (v: number) =>
    props.decimals === 0
      ? chart.formatNumber(v)
      : v.toLocaleString("en-US", {
          minimumFractionDigits: props.decimals,
          maximumFractionDigits: props.decimals,
        });
  const shown = figureAt(countedValue(props.value, progress));

  const center = props.position === "center";
  const alignLeft = props.position === "left";
  const align = center ? "center" : alignLeft ? "flex-start" : "flex-end";
  const textAlign = center ? "center" : alignLeft ? "left" : "right";
  const labelStart = Math.round(fps * 0.5 * durationMul);

  // ---- poster geometry ----------------------------------------------------
  // A poster counter is the label as a headline and the figure taking the rest
  // of the page, so the figure has to be MEASURED. Guessing a ratio gets one of
  // the two cases wrong every time: `1.4M` at a size that fills the frame turns
  // `1,438,502` into a figure running off both edges.
  const posterLabelSize = height * 0.05 * typeScale(theme, "title");
  const posterCaptionSize = height * 0.024 * typeScale(theme, "caption");
  const figureBox =
    height -
    framePad.y * 2 -
    (props.label ? posterLabelSize * 1.15 : 0) -
    height * 0.02 * density -
    (props.caption ? posterCaptionSize * 1.5 : 0);
  // The settled lockup, not the counting one: measuring `shown` would resize
  // the figure on every frame as digits arrive.
  const settled = `${props.prefix ?? ""}${props.approximate ? "~" : ""}${figureAt(props.value)}${props.suffix ?? ""}`;
  const posterNumber = poster
    ? Math.min(
        fitText({
          text: settled,
          withinWidth: width - framePad.x * 2,
          fontFamily: figureFace(theme).fontFamily,
          fontWeight: typeWeight(theme, 700),
          // Not validated: <PackagedFonts> holds the CAPTURE until the faces
    // decode, but not React's first render, and the Player preview does not
    // wait at all — so the check threw there ("font is not loaded"). The
    // measure re-runs every frame; by the first captured frame it is exact.
    validateFontIsLoaded: false,
        }).fontSize,
        // The scale token moves the HEIGHT budget rather than the fitted size.
        // Multiplying the fit the way HammerStatement does would let `generous`
        // push a width-limited figure back off the page it was just fitted to.
        Math.max(height * 0.1, figureBox * 0.82) * typeScale(theme, "number"),
      )
    // 0.105, not the 0.16 a bare figure had: putting the figure in a box adds
    // the weight the extra size used to carry, and a 0.16 numeral inside a plate
    // is a slab. The reference sets its box at ~0.13 of the frame and the figure
    // fills it, which is what these two numbers together produce.
    : page
      ? Math.min(
          height * 0.2,
          fitText({
            text: settled,
            withinWidth: width * 0.8,
            fontFamily: figureFace(theme).fontFamily,
            fontWeight: typeWeight(theme, 700),
            // Not validated: <PackagedFonts> holds the CAPTURE until the faces
    // decode, but not React's first render, and the Player preview does not
    // wait at all — so the check threw there ("font is not loaded"). The
    // measure re-runs every frame; by the first captured frame it is exact.
    validateFontIsLoaded: false,
          }).fontSize,
        ) * typeScale(theme, "number")
      : height * 0.105 * typeScale(theme, "number");
  // prefix and suffix keep the ratio they have always had to the figure.
  // On a page the affix is part of the figure ("80%"), not a unit beside it.
  const affixSize = poster ? posterNumber * 0.375 : page ? posterNumber * 0.8 : height * 0.06 * typeScale(theme, "kicker");

  const groundIn = interpolate(frame, [0, Math.max(1, inDur)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const figure = (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: width * 0.008 * density,
        ...figureFace(theme),
        // On a poster the figure is set straight on the page, so it takes the
        // accent when asked for one and the page's ink otherwise. Centred it is
        // standing on the box, and the box decides.
        // Standing on the box when there is one, and on whatever is behind the
        // lockup when there is not — a poster sets the figure straight on the
        // page, and a redundant box has just been dropped.
        color:
          poster || page || boxIsRedundant || (!poster && !page && figureFrame(theme) === "ring")
            ? props.emphasis === "accent"
              ? accentInk(theme, accent, groundPaint ?? surfaceColor(theme))
              : contrastInk(theme, groundPaint ?? surfaceColor(theme))
            : boxInk,
      }}
    >
      {props.prefix ? (
        <span style={{ fontSize: affixSize, fontWeight: typeWeight(theme, 600) }}>{props.prefix}</span>
      ) : null}
      <span
        style={{
          fontSize: posterNumber,
          fontWeight: typeWeight(theme, 700),
          lineHeight: 1,
          // Only the poster figure tracks. At this size the type needs it and
          // the theme owns how far; the centred figure is small enough that it
          // never had a letterSpacing, and giving it one now would move every
          // existing render for no reason (Principle 7).
          letterSpacing: poster || page ? typeTracking(theme, -0.02) : undefined,
        }}
      >
        {props.approximate && progress >= 1 ? "~" : ""}
        {shown}
      </span>
      {props.suffix ? (
        <span style={{ fontSize: affixSize, fontWeight: typeWeight(theme, 600) }}>{props.suffix}</span>
      ) : null}
    </div>
  );

  /**
   * The box. Centred only: a poster hands the component the frame and a plate
   * hugging the figure in the middle of it would be the card the composition
   * exists to leave behind.
   *
   * Padding is a fraction of the FIGURE, not of the frame, so the box keeps its
   * proportions when `typography.scale` moves the numeral inside it.
   */
  // `surface.figure_frame: ring` (D97): the figure bare inside an accent ring
  // that sweeps closed as it counts. Sized off the settled lockup so a long
  // figure gets a wider ring rather than spilling out of it.
  const ringD = Math.max(posterNumber * 2.3, settled.length * posterNumber * 0.6 + posterNumber * 0.9);
  const ringStroke = ruleWidth(theme, Math.max(3, height * 0.007));
  const ringC = Math.PI * (ringD - ringStroke);
  const ringed = !poster && !page && figureFrame(theme) === "ring";
  const box = ringed ? (
    <div style={{ position: "relative", width: ringD, height: ringD, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={ringD} height={ringD} style={{ position: "absolute", inset: 0 }}>
        <circle
          cx={ringD / 2}
          cy={ringD / 2}
          r={(ringD - ringStroke) / 2}
          fill="none"
          stroke={theme.colors.accent}
          strokeWidth={ringStroke}
          strokeDasharray={ringC}
          strokeDashoffset={ringC * (1 - progress)}
          strokeLinecap="round"
          transform={`rotate(-90 ${ringD / 2} ${ringD / 2})`}
        />
      </svg>
      <div style={{ color: props.emphasis === "accent" ? accent : theme.colors.text }}>{figure}</div>
    </div>
  ) : poster || page || boxIsRedundant ? (
    figure
  ) : (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        padding: `${posterNumber * 0.17}px ${posterNumber * 0.3}px`,
        background: boxGround,
        // The texture rides ON the plate rather than replacing it, the way
        // DocumentCard lays grain over its stock: the box is now the only
        // background this component has, so a theme that asked for grain has to
        // get it here or not at all.
        ...(boxTexture
          ? {
              backgroundImage: boxTexture.backgroundImage,
              backgroundSize: boxTexture.backgroundSize,
              backgroundBlendMode: boxTexture.backgroundBlendMode,
            }
          : {}),
        borderRadius: surfaceStyle(theme, { radius: 8 }).borderRadius,
      }}
    >
      {figure}
    </div>
  );

  // theme-and-style.md is explicit that `accent_rule: "none"` takes the
  // underline out of a big number, not only the bar off a card's edge: they are
  // the same ornament in a different place, and a theme asking for a figure on
  // the page does not want a stripe under it.
  const rule =
    ringed || surfaceStyle(theme, { accentRule: "top" }).accentRule === "none" ? null : (
      <div
        style={{
          marginTop: height * 0.02 * density,
          width: width * 0.34,
          height: ruleWidth(theme, Math.max(3, height * 0.006)),
          background: accent,
          scale: `${progress} 1`,
          transformOrigin: center ? "center" : alignLeft ? "left center" : "right center",
        }}
      />
    );

  const labelSize = poster
    ? posterLabelSize
    : page
      ? height * 0.036 * typeScale(theme, "body")
      : height * 0.028 * typeScale(theme, "caption");
  const label = !props.label ? null : (
    <div
      style={{
        // Centred, the label is bare type under the box, so it carries its own
        // gap. On a poster it is the headline the figure answers, so it takes
        // the display face and the title role — the same slot a chart's title
        // occupies, and the stack above it already spaces it.
        marginTop: poster ? 0 : height * 0.018 * density,
        maxWidth: poster ? "100%" : page ? width * 0.7 : width * 0.5,
        textAlign,
        fontFamily: fontStack(poster ? theme.typography.display : theme.typography.body),
        fontSize: labelSize,
        lineHeight: poster ? 1.08 : page ? 1.25 : undefined,
        fontWeight: poster || page ? typeWeight(theme, 600) : undefined,
        // A page label is a sentence under the figure, not a legend: no caps,
        // no caps tracking.
        letterSpacing: poster ? typeTracking(theme, -0.01) : page ? typeTracking(theme, 0) : typeTracking(theme, 0.08),
        textTransform: poster || page ? typeCase(theme) : typeCase(theme, "uppercase"),
        color: theme.colors.text,
        overflowWrap: "anywhere",
        whiteSpace: poster || page ? undefined : "nowrap",
        opacity: interpolate(frame, [labelStart, labelStart + fps * 0.45], [0, poster ? 1 : 0.9], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {props.label}
    </div>
  );



  // ArchiveCounter's second line: the qualification a bare label cannot carry
  // ("at the 13 September count").
  const caption = props.caption ? (
    <div
      style={{
        marginTop: height * 0.012 * density,
        maxWidth: poster ? "100%" : width * 0.5,
        textAlign,
        fontFamily: fontStack(theme.typography.body),
        fontSize: poster ? posterCaptionSize : height * 0.022 * typeScale(theme, "caption"),
        fontStyle: "italic",
        color: mutedInk(theme),
        overflowWrap: "anywhere",
        opacity: interpolate(frame, [labelStart + fps * 0.2, labelStart + fps * 0.65], [0, 0.9], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {props.caption}
    </div>
  ) : null;

  const sourceLine = props.source ? (
    <div
      style={{
        fontFamily: fontStack(theme.typography.body),
        fontSize: height * 0.018 * typeScale(theme, "caption"),
        color: mutedInk(theme),
        letterSpacing: typeTracking(theme, 0),
        textAlign,
        opacity: interpolate(frame, [labelStart + fps * 0.3, labelStart + fps * 0.8], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        }),
      }}
    >
      {props.source}
    </div>
  ) : null;

  if (page) {
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
        {ground ? <div style={{ position: "absolute", inset: 0, ...ground, opacity: groundIn }} /> : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: align,
            padding: `0 ${width * 0.1 * density}px`,
          }}
        >
          {figure}
          {rule}
          {label}
          {caption}
        </div>
        {sourceLine ? (
          <div
            style={{
              position: "absolute",
              left: framePad.x,
              right: framePad.x,
              bottom: framePad.y,
              display: "flex",
              justifyContent: align,
            }}
          >
            {sourceLine}
          </div>
        ) : null}
      </div>
    );
  }

  if (poster) {
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
        {ground ? (
          <div style={{ position: "absolute", inset: 0, ...ground, opacity: groundIn }} />
        ) : null}
        <div
          style={{
            position: "absolute",
            inset: 0,
            boxSizing: "border-box",
            padding: `${framePad.y}px ${framePad.x}px`,
            display: "flex",
            flexDirection: "column",
            alignItems: align,
          }}
        >
          {label}
          {/* The figure takes the room the headline and the credit leave, and
              is centred in it — the same shape PieChart's PosterCentre has. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              width: "100%",
              display: "flex",
              flexDirection: "column",
              alignItems: align,
              justifyContent: "center",
            }}
          >
            {figure}
            {rule}
          </div>
          {caption}
          {sourceLine}
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: align,
        padding: `0 ${width * 0.1 * density}px`,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: align,
          ...(ground ? { ...ground, padding: `${height * 0.04 * density}px ${width * 0.045 * density}px` } : {}),
        }}
      >
        {box}
        {rule}
        {label}
        {caption}
        {sourceLine ? <div style={{ marginTop: height * 0.012 * density }}>{sourceLine}</div> : null}
      </div>
    </div>
  );
}

/** Which optional token blocks this component can actually obey (Part 3). */
AnimatedCounter.honors = [
  "typography",
  "surface",
  "layout.composition",
  "chart",
  "motion.entrance",
  "motion.easing",
];
