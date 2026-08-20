/**
 * HeadlineStack — three to five press headlines arriving one after another.
 *
 * DEPICTIVE, theme-EXEMPT (SKILL Part 3). The claim a headline montage makes is
 * "the press said this, in these words, in these papers" — so the cards are
 * newsprint, the outlet is set in the outlet's own weight, and none of it is
 * the channel's accent. Set the same montage in the channel's theme and it
 * stops being evidence and becomes the channel asserting something.
 *
 * The nearest catalog neighbour is `BulletList`, and the difference is whose
 * words they are: a bullet list is the VIDEO's claims in the video's voice,
 * this is other people's, attributed. That distinction is the whole reason
 * the cards look like clippings.
 */
import { z } from "zod";
import { Easing, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { Theme } from "../theme.ts";
import { PANEL_ENTRANCES, densityScale, easingCurve, motionScale, useEntrance } from "../theme.ts";

export const HeadlineStackProps = z.object({
  items: z
    .array(
      z.object({
        headline: z.string().max(90),
        outlet: z.string().max(28).optional(),
        date: z.string().max(24).optional(),
      }),
    )
    .min(2)
    .max(5),
  kicker: z.string().max(40).optional(),
});
export type HeadlineStackProps = z.infer<typeof HeadlineStackProps>;

/** Newsprint, not the channel's page. Literals for the same reason SocialPost's are. */
const PRESS = {
  stock: "#f6f4ef",
  ink: "#14120f",
  rule: "#c9c4b8",
  outlet: "#8a1c1c",
  serif: "'Playfair Display', Georgia, 'DejaVu Serif', serif",
  sans: "'Noto Sans', 'DejaVu Sans', Helvetica, Arial, sans-serif",
};

/** Fixed per-index tilt: a montage of perfectly square clippings reads as a table. */
const TILT = [-1.4, 0.9, -0.6, 1.3, -1.0];

export function HeadlineStack({ props, theme }: { props: HeadlineStackProps; theme: Theme }) {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  const { durationMul } = motionScale(theme);
  const density = densityScale(theme);
  const entrance = useEntrance(theme, {
    component: "HeadlineStack",
    supported: PANEL_ENTRANCES,
    fallback: "rise",
    seconds: 0.4,
  });
  const { opacity } = entrance;
  const curve = Easing.bezier(...easingCurve(theme));

  const cardW = width * 0.5 * (1 + (density - 1) * 0.35);
  const gap = height * 0.022 * density;
  // Each clipping lands on its own beat: this is a montage, and simultaneous
  // arrival would make it one block of text with several fonts in it.
  const step = Math.round(fps * 0.42 * durationMul);

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap,
        opacity,
        translate: entrance.translate,
        scale: `${entrance.scale}`,
        clipPath: entrance.clipPath,
      }}
    >
      {props.kicker ? (
        <div
          style={{
            marginBottom: gap * 0.5,
            fontFamily: PRESS.sans,
            fontSize: height * 0.022,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "#ffffff",
            textShadow: "0 2px 10px rgba(0,0,0,0.8)",
            opacity: interpolate(frame, [0, fps * 0.4], [0, 0.92], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }),
          }}
        >
          {props.kicker}
        </div>
      ) : null}

      {props.items.map((item, i) => {
        const start = i * step;
        const enter = interpolate(frame, [start, start + fps * 0.32 * durationMul], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: curve,
        });
        return (
          <div
            key={i}
            style={{
              width: cardW,
              background: PRESS.stock,
              padding: `${cardW * 0.032}px ${cardW * 0.042}px`,
              boxShadow: "0 8px 26px rgba(0,0,0,0.4)",
              rotate: `${TILT[i % TILT.length]}deg`,
              opacity: enter,
              translate: `${interpolate(enter, [0, 1], [-width * 0.02, 0])}px 0`,
            }}
          >
            <div
              style={{
                fontFamily: PRESS.serif,
                fontSize: cardW * 0.052,
                fontWeight: 700,
                lineHeight: 1.16,
                color: PRESS.ink,
                overflowWrap: "anywhere",
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {item.headline}
            </div>
            {item.outlet || item.date ? (
              <div
                style={{
                  marginTop: cardW * 0.018,
                  paddingTop: cardW * 0.014,
                  borderTop: `1px solid ${PRESS.rule}`,
                  display: "flex",
                  gap: cardW * 0.02,
                  fontFamily: PRESS.sans,
                  fontSize: cardW * 0.024,
                  letterSpacing: "0.09em",
                  textTransform: "uppercase",
                }}
              >
                {item.outlet ? <span style={{ color: PRESS.outlet, fontWeight: 700 }}>{item.outlet}</span> : null}
                {item.date ? <span style={{ color: "#6f6a5f" }}>{item.date}</span> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** DEPICTIVE: arrival and room only. See the header. */
HeadlineStack.honors = ["motion.entrance", "surface.density"];
