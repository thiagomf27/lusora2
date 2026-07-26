/**
 * TemplateOverlay — draws a template-backed catalog entry (see registry.ts).
 *
 * One component, five layouts, all appearance from the theme runtime and all
 * sizes relative to useVideoConfig(), exactly like the hand-written components
 * in ../core. Props arrive already validated against the entry's own spec, so
 * this only has to fall back for the optional ones.
 */
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { emphasisColor, fadeInOutRange, fontStack, motionScale } from "../theme.ts";
import { TEMPLATES, type TemplateKind } from "./registry.ts";

type Props = Record<string, unknown>;

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v : undefined;
const num = (v: unknown): number | undefined => (typeof v === "number" && !Number.isNaN(v) ? v : undefined);
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function TemplateOverlay({
  template,
  props,
  theme,
}: {
  template: TemplateKind;
  props: Props;
  theme: Theme;
}) {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const accent = emphasisColor(
    theme,
    props.emphasis === "neutral" ? "neutral" : "accent"
  );

  const inDur = Math.round(fps * 0.45 * durationMul);
  const opacity = interpolate(frame, fadeInOutRange(durationInFrames, inDur), [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  /** 0 → 1 over the entrance, eased out. */
  const rise = interpolate(frame, [0, inDur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.16, 1, 0.3, 1),
  });
  /** 0 → 1 for something that lands `delay` frames after the entrance. */
  const after = (delayFrames: number, seconds = 0.4) =>
    interpolate(frame, [inDur + delayFrames, inDur + delayFrames + fps * seconds * durationMul], [0, 1], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });

  const display = fontStack(theme.typography.display);
  const body = fontStack(theme.typography.body);
  const rule = Math.max(3, height * 0.006);

  const frameStyle: React.CSSProperties = { position: "absolute", inset: 0, opacity };

  if (template === "card") {
    const position = props.position === "left" ? "left" : props.position === "center" ? "center" : "right";
    const center = position === "center";
    const slide = center ? 0 : position === "left" ? -width * 0.06 : width * 0.06;
    return (
      <div
        style={{
          ...frameStyle,
          display: "flex",
          alignItems: "center",
          justifyContent: center ? "center" : position === "left" ? "flex-start" : "flex-end",
          padding: `0 ${width * 0.06}px`,
        }}
      >
        <div
          style={{
            width: center ? width * 0.62 : width * 0.38,
            background: `${theme.colors.bg}e6`,
            borderRadius: 12,
            borderLeft: `${rule}px solid ${accent}`,
            padding: `${height * 0.04}px ${width * 0.028}px`,
            translate: `${slide * (1 - rise)}px 0px`,
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
            {str(props.title) ?? ""}
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
          {!right && (
            <div
              style={{
                width: rule,
                background: accent,
                borderRadius: 2,
                scale: `1 ${rise}`,
                transformOrigin: "bottom center",
              }}
            />
          )}
          <div
            style={{
              background: `${theme.colors.bg}e0`,
              padding: `${height * 0.022}px ${width * 0.022}px`,
              borderRadius: 8,
              translate: `0px ${height * 0.02 * (1 - rise)}px`,
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
              {str(props.text) ?? ""}
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
          {right && (
            <div
              style={{
                width: rule,
                background: accent,
                borderRadius: 2,
                scale: `1 ${rise}`,
                transformOrigin: "bottom center",
              }}
            />
          )}
        </div>
      </div>
    );
  }

  if (template === "big_number") {
    const target = num(props.value) ?? 0;
    // count up over the entrance, then hold the settled value
    const shown = interpolate(frame, [0, Math.max(inDur * 2, 1)], [0, target], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.bezier(0.16, 1, 0.3, 1),
    });
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
            display: "flex",
            alignItems: "baseline",
            gap: width * 0.006,
            fontFamily: display,
            color: accent,
            fontWeight: 700,
            lineHeight: 1,
            scale: `${0.94 + 0.06 * rise}`,
          }}
        >
          {str(props.prefix) ? <span style={{ fontSize: height * 0.06 }}>{str(props.prefix)}</span> : null}
          <span style={{ fontSize: height * 0.19, fontVariantNumeric: "tabular-nums" }}>
            {shown.toFixed(decimals)}
          </span>
          {str(props.suffix) ? <span style={{ fontSize: height * 0.07 }}>{str(props.suffix)}</span> : null}
        </div>
        <div
          style={{
            marginTop: height * 0.022,
            width: width * 0.22 * rise,
            height: rule,
            background: accent,
            borderRadius: 2,
          }}
        />
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
    const marker = props.marker === "number" ? "number" : props.marker === "rule" ? "rule" : "dot";
    const stagger = Math.round(fps * 0.22 * durationMul);
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
              fontFamily: display,
              fontSize: height * 0.056,
              fontWeight: 700,
              color: theme.colors.text,
              marginBottom: height * 0.035,
              translate: `${-width * 0.02 * (1 - rise)}px 0px`,
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
                gap: width * 0.016,
                marginBottom: height * 0.026,
                opacity: appear,
                translate: `${-width * 0.015 * (1 - appear)}px 0px`,
              }}
            >
              {marker === "number" ? (
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
          fontFamily: display,
          fontSize: height * 0.085,
          fontWeight: 700,
          lineHeight: 1.12,
          color: theme.colors.text,
          translate: `0px ${height * 0.015 * (1 - rise)}px`,
          overflowWrap: "anywhere",
        }}
      >
        {str(props.text) ?? ""}
      </div>
      <div
        style={{
          marginTop: height * 0.03,
          width: width * 0.16 * after(6, 0.5),
          height: rule,
          background: accent,
          borderRadius: 2,
        }}
      />
    </div>
  );
}

/** Duration the catalog should suggest for a template, if the entry has none. */
export function templateDuration(kind: TemplateKind) {
  return TEMPLATES[kind].duration_hint_s;
}
