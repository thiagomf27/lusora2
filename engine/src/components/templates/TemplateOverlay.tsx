/**
 * TemplateOverlay — draws a template-backed catalog entry (see registry.ts).
 *
 * One component, five layouts, all appearance from the theme runtime and all
 * sizes relative to useVideoConfig(), exactly like the hand-written components
 * in ../core. Props arrive already validated against the entry's own spec, so
 * this only has to fall back for the optional ones.
 *
 * D46: shape comes from `surfaceStyle` and the entrance from `useEntrance`, so
 * a theme restyles every UI-authored overlay without touching this file. Each
 * layout passes the values it used BEFORE D46 as its fallbacks — an untouched
 * theme renders exactly what it rendered before.
 */
import type { Theme } from "../theme.ts";
import {
  PANEL_ENTRANCES,
  TEXT_ENTRANCES,
  emphasisColor,
  fontStack,
  surfaceStyle,
  useEntrance,
} from "../theme.ts";
import { useVideoConfig } from "remotion";
import { TEMPLATES, type TemplateKind } from "./registry.ts";

type Props = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && !Number.isNaN(v) ? v : undefined);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

/**
 * What each template could draw before D46, and what it can draw now. The
 * `entrance` here is the no-theme fallback, so these values are the pre-D46
 * behaviour written down: the card slid in, the lower third and statement rose,
 * the big number popped, the bullet list slid its title.
 */
const TEMPLATE_MOTION: Record<
  TemplateKind,
  { entrance: "slide" | "rise" | "pop"; supported: readonly string[] }
> = {
  card: { entrance: "slide", supported: TEXT_ENTRANCES },
  lower_third: { entrance: "rise", supported: TEXT_ENTRANCES },
  // the figure counts up; typing a number fights that, so panel entrances only
  big_number: { entrance: "pop", supported: PANEL_ENTRANCES },
  // items already stagger; a typewriter on top would read as a stutter
  bullet_list: { entrance: "slide", supported: PANEL_ENTRANCES },
  statement: { entrance: "rise", supported: TEXT_ENTRANCES },
};

export function TemplateOverlay({
  template,
  component,
  props,
  theme,
}: {
  template: TemplateKind;
  /** Catalog entry name, so `motion.per_component` can target this overlay. */
  component?: string;
  props: Props;
  theme: Theme;
}) {
  const { width, height } = useVideoConfig();
  const accent = emphasisColor(
    theme,
    props.emphasis === "neutral" ? "neutral" : "accent"
  );

  const display = fontStack(theme.typography.display);
  const body = fontStack(theme.typography.body);
  const rule = Math.max(3, height * 0.006);
  // The accent bar of `card`/`lower_third` and the underlines of `big_number`/
  // `statement` are the same ornament in different places, so one token removes
  // all four: a theme asking for `accent_rule: "none"` wants text on the
  // background, not text on the background with a stripe under it. Themes that
  // leave the token unset resolve to their component default and are unchanged.
  const ornament = surfaceStyle(theme, { accentRule: "left" }).accentRule !== "none";

  // Slide direction is the card's `position` prop — semantic, so it stays a
  // prop and only the DISTANCE is handed to the entrance resolver.
  const cardPosition =
    props.position === "left" ? "left" : props.position === "center" ? "center" : "right";
  const slideDistance =
    template === "card"
      ? cardPosition === "center"
        ? 0
        : cardPosition === "left"
          ? -width * 0.06
          : width * 0.06
      : template === "bullet_list"
        ? -width * 0.02
        : undefined;

  const motion = TEMPLATE_MOTION[template];
  const entrance = useEntrance(theme, {
    component: component ?? template,
    supported: motion.supported as never,
    fallback: motion.entrance,
    slide: slideDistance,
    rise: template === "lower_third" ? height * 0.02 : height * 0.015,
    popFrom: template === "big_number" ? 0.94 : undefined,
  });
  const { after, progress: rise, typed } = entrance;
  /** The big number's own clock: twice the entrance, whatever the entrance is. */
  const countUp = entrance.ramp(entrance.inDur * 2);

  const frameStyle: React.CSSProperties = {
    position: "absolute",
    inset: 0,
    opacity: entrance.opacity,
  };
  /** Panel transform + clip, applied to whatever box the layout considers "the panel". */
  const panel: React.CSSProperties = {
    translate: entrance.translate,
    scale: `${entrance.scale}`,
    clipPath: entrance.clipPath,
  };

  if (template === "card") {
    const center = cardPosition === "center";
    const surface = surfaceStyle(theme, { radius: 12, alpha: "e6", accentRule: "left" });
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: center ? "center" : cardPosition === "left" ? "flex-start" : "flex-end",
          padding: `0 ${width * 0.06}px`,
        }}
      >
        <div
          style={{
            ...panel,
            width: center ? width * 0.62 : width * 0.38,
            background: surface.background,
            borderRadius: surface.borderRadius,
            borderLeft:
              surface.accentRule === "left" ? `${rule}px solid ${accent}` : undefined,
            borderTop: surface.accentRule === "top" ? `${rule}px solid ${accent}` : undefined,
            padding: `${height * 0.04}px ${width * 0.028}px`,
          }}
        >
          <div
            style={{
              fontFamily: display,
              fontSize: height * 0.055,
              fontWeight: 700,
              lineHeight: 1.15,
              color: theme.colors.text,
              overflowWrap: "anywhere",
            }}
          >
            {typed(str(props.title) ?? "")}
          </div>
          {str(props.body) ? (
            <div
              style={{
                marginTop: height * 0.024,
                fontFamily: body,
                fontSize: height * 0.032,
                lineHeight: 1.4,
                color: theme.colors.text,
                opacity: after(4) * 0.88,
                overflowWrap: "anywhere",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 5,
                overflow: "hidden",
              }}
            >
              {str(props.body)}
            </div>
          ) : null}
          {str(props.footnote) ? (
            <div
              style={{
                marginTop: height * 0.026,
                fontFamily: body,
                fontSize: height * 0.022,
                letterSpacing: "0.1em",
                textTransform: "uppercase",
                color: theme.colors.neutral,
                opacity: after(12),
              }}
            >
              {str(props.footnote)}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  if (template === "lower_third") {
    const right = props.side === "right";
    const surface = surfaceStyle(theme, { radius: 8, alpha: "e0", accentRule: "left" });
    // The bar's SIDE stays the `side` prop (semantic); the theme only gets to
    // remove it, via surface.accent_rule = "none".
    const bar = surface.accentRule !== "none" && (
      <div
        style={{
          width: rule,
          background: accent,
          borderRadius: 2,
          scale: `1 ${rise}`,
          transformOrigin: "bottom center",
        }}
      />
    );
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: right ? "flex-end" : "flex-start",
          padding: `0 ${width * 0.06}px ${height * 0.1}px`,
        }}
      >
        <div style={{ display: "flex", alignItems: "stretch", gap: width * 0.014 }}>
          {!right && bar}
          <div
            style={{
              ...panel,
              background: surface.background,
              padding: `${height * 0.022}px ${width * 0.022}px`,
              borderRadius: surface.borderRadius,
              textAlign: right ? "right" : "left",
            }}
          >
            <div
              style={{
                fontFamily: display,
                fontSize: height * 0.046,
                fontWeight: 600,
                color: theme.colors.text,
                lineHeight: 1.2,
              }}
            >
              {typed(str(props.text) ?? "")}
            </div>
            {str(props.subtext) ? (
              <div
                style={{
                  marginTop: height * 0.01,
                  fontFamily: body,
                  fontSize: height * 0.026,
                  color: theme.colors.neutral,
                  opacity: after(4),
                }}
              >
                {str(props.subtext)}
              </div>
            ) : null}
          </div>
          {right && bar}
        </div>
      </div>
    );
  }

  if (template === "big_number") {
    const target = num(props.value) ?? 0;
    // Count up over twice the entrance, then hold the settled value. Driven by
    // `countUp` rather than `progress` so the figure keeps counting even when
    // the theme picks an instant entrance like `fade`.
    const shown = target * countUp;
    const decimals = Number.isInteger(target) ? 0 : 1;
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            ...panel,
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.006,
            fontFamily: display,
            color: accent,
            fontWeight: 700,
            lineHeight: 1,
          }}
        >
          {str(props.prefix) ? <span style={{ fontSize: height * 0.06 }}>{str(props.prefix)}</span> : null}
          <span style={{ fontSize: height * 0.19, fontVariantNumeric: "tabular-nums" }}>
            {shown.toFixed(decimals)}
          </span>
          {str(props.suffix) ? <span style={{ fontSize: height * 0.07 }}>{str(props.suffix)}</span> : null}
        </div>
        {ornament ? (
          <div
            style={{
              marginTop: height * 0.022,
              width: width * 0.22 * rise,
              height: rule,
              background: accent,
              borderRadius: 2,
            }}
          />
        ) : null}
        <div
          style={{
            marginTop: height * 0.024,
            fontFamily: body,
            fontSize: height * 0.034,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: theme.colors.text,
            opacity: after(6),
            textAlign: "center",
            maxWidth: width * 0.7,
          }}
        >
          {str(props.label) ?? ""}
        </div>
      </div>
    );
  }

  if (template === "bullet_list") {
    const items = list(props.items).slice(0, 6);
    const marker =
      props.marker === "number"
        ? "number"
        : props.marker === "rule"
          ? "rule"
          : props.marker === "none"
            ? "none"
            : "dot";
    const stagger = entrance.frames(0.22);
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: `0 ${width * 0.09}px`,
        }}
      >
        {str(props.title) ? (
          <div
            style={{
              ...panel,
              fontFamily: display,
              fontSize: height * 0.056,
              fontWeight: 700,
              color: theme.colors.text,
              marginBottom: height * 0.035,
            }}
          >
            {str(props.title)}
          </div>
        ) : null}
        {items.map((item, i) => {
          const appear = after(i * stagger, 0.35);
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: marker === "none" ? 0 : width * 0.016,
                marginBottom: height * 0.026,
                opacity: appear,
                translate: `${-width * 0.015 * (1 - appear)}px 0px`,
              }}
            >
              {marker === "none" ? null : marker === "number" ? (
                <span
                  style={{
                    fontFamily: display,
                    fontSize: height * 0.034,
                    color: accent,
                    minWidth: width * 0.022,
                  }}
                >
                  {i + 1}
                </span>
              ) : marker === "rule" ? (
                <span
                  style={{ width: width * 0.022, height: rule, background: accent, borderRadius: 2 }}
                />
              ) : (
                <span
                  style={{
                    width: height * 0.016,
                    height: height * 0.016,
                    borderRadius: 999,
                    background: accent,
                  }}
                />
              )}
              <span
                style={{
                  fontFamily: body,
                  fontSize: height * 0.038,
                  lineHeight: 1.35,
                  color: theme.colors.text,
                  overflowWrap: "anywhere",
                }}
              >
                {item}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // statement
  const align = props.align === "left" ? "left" : "center";
  return (
    <div
      style={{
        ...frameStyle,
        display: "flex",
        flexDirection: "column",
        alignItems: align === "left" ? "flex-start" : "center",
        justifyContent: "center",
        padding: `0 ${width * 0.1}px`,
        textAlign: align,
      }}
    >
      {str(props.kicker) ? (
        <div
          style={{
            fontFamily: body,
            fontSize: height * 0.026,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: accent,
            marginBottom: height * 0.028,
            opacity: after(0, 0.3),
          }}
        >
          {str(props.kicker)}
        </div>
      ) : null}
      <div
        style={{
          ...panel,
          fontFamily: display,
          fontSize: height * 0.085,
          fontWeight: 700,
          lineHeight: 1.12,
          color: theme.colors.text,
          overflowWrap: "anywhere",
        }}
      >
        {typed(str(props.text) ?? "")}
      </div>
      {ornament ? (
        <div
          style={{
            marginTop: height * 0.03,
            width: width * 0.16 * after(6, 0.5),
            height: rule,
            background: accent,
            borderRadius: 2,
          }}
        />
      ) : null}
    </div>
  );
}

/** Duration the catalog should suggest for a template, if the entry has none. */
export function templateDuration(kind: TemplateKind) {
  return TEMPLATES[kind].duration_hint_s;
}
