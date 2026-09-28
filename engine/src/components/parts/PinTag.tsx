/**
 * PinTag — a label plate hanging from a pin: the pin, a short thread, and a
 * plate carrying a title and an optional quieter line under it.
 *
 * Unregistered drawing, like basic/TextLockup.tsx: it is not a catalog name.
 * CalloutArrow draws it for `style: "pin"` (a tag pinned to the thing in the
 * shot) and PhotoCard draws it on a card's corner (a tag pinned to a photo).
 *
 * The caller places it: (x, y) is where the PIN sits, and the plate hangs
 * below it, centred on the thread. Everything visual is a token — the plate is
 * `plateColor` (so `surface.plate: invert` gives the dark tag on a paper page),
 * the pin is the accent, the type is the body face in caps the theme may take
 * away.
 */
import { interpolate } from "remotion";
import type { Theme } from "../theme.ts";
import {
  labelFace,
  chipColor,
  capsTracking,
  contrastInk,
  densityScale,
  elevationShadow,
  fontStack,
  mutedInk,
  plateColor,
  ruleWidth,
  surfaceStyle,
  typeCase,
  typeScale,
  typeWeight,
} from "../theme.ts";

export interface PinTagProps {
  title: string;
  detail?: string;
  theme: Theme;
  /** Where the pin sits, in px inside the caller's positioned box. */
  x: number;
  y: number;
  /** Frame height: every size is a fraction of it. */
  frameHeight: number;
  /** 0..1 — the pin lands, the thread drops, then the plate swings in. */
  progress: number;
  /** A smaller tag for a card's corner; `medium` hangs over footage. */
  size?: "small" | "medium";
}

export function PinTag({ title, detail, theme, x, y, frameHeight, progress, size = "medium" }: PinTagProps) {
  const h = frameHeight;
  const density = densityScale(theme);
  const k = size === "small" ? 0.82 : 1;
  const plate = chipColor(theme);
  const ink = contrastInk(theme, plate);
  // The pin is always the accent. It is a fixture, not emphasis: a pin the
  // size of a full stop in the theme's grey is a pin nobody sees, and it sits
  // on whatever is above the tag, so it never has to read against the plate.
  const pin = theme.colors.accent;
  const pinR = h * 0.009 * k;
  const thread = h * 0.03 * k * density;

  const at = (a: number, b: number) =>
    interpolate(progress, [a, b], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pinIn = at(0, 0.3);
  const threadIn = at(0.2, 0.5);
  const plateIn = at(0.4, 1);

  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y - pinR,
        translate: "-50% 0",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          width: pinR * 2,
          height: pinR * 2,
          borderRadius: "50%",
          background: pin,
          boxShadow: `0 0 0 ${Math.max(1, pinR * 0.35)}px ${ink}33`,
          scale: `${pinIn}`,
          flexShrink: 0,
        }}
      />
      <div
        style={{
          width: ruleWidth(theme, Math.max(1.5, h * 0.0022)),
          height: thread,
          background: plate,
          scale: `1 ${threadIn}`,
          transformOrigin: "top center",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          background: plate,
          color: ink,
          borderRadius: surfaceStyle(theme, { radius: 6 }).borderRadius,
          boxShadow: elevationShadow(theme, h),
          padding: `${h * 0.014 * k * density}px ${h * 0.026 * k * density}px`,
          textAlign: "center",
          whiteSpace: "nowrap",
          opacity: plateIn,
          // The plate swings on its thread rather than sliding: it is hanging.
          rotate: `${interpolate(plateIn, [0, 1], [-7, 0])}deg`,
          transformOrigin: "top center",
        }}
      >
        <div
          style={{
            fontFamily: labelFace(theme),
            fontSize: h * 0.026 * k * typeScale(theme, "kicker"),
            fontWeight: typeWeight(theme, 800),
            letterSpacing: capsTracking(theme, 0.06),
            textTransform: typeCase(theme, "uppercase"),
            lineHeight: 1.15,
          }}
        >
          {title}
        </div>
        {detail ? (
          <div
            style={{
              marginTop: h * 0.004 * density,
              fontFamily: fontStack(theme.typography.body),
              fontSize: h * 0.018 * k * typeScale(theme, "caption"),
              fontWeight: typeWeight(theme, 400),
              color: mutedInk(theme, plate, 4.5),
              lineHeight: 1.2,
            }}
          >
            {detail}
          </div>
        ) : null}
      </div>
    </div>
  );
}
