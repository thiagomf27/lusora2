/**
 * The packaged faces, mounted (D70).
 *
 * Every render tree puts one `<PackagedFonts />` at its root. Before this, a
 * theme naming `Inter` got the render machine's fallback for the sans stack —
 * DejaVu Sans here — and `Playfair Display` got DejaVu Serif, so two themes
 * that differ by their whole type voice rendered in the same two faces.
 * `fontStack()` still builds the stack, and the fallbacks still matter for a
 * family nobody packaged; this is what makes the FIRST name in the stack real.
 *
 * Lives apart from runtime.ts because it needs Remotion (delayRender) and
 * React, and runtime.ts is deliberately free of both so the platform can
 * resolve tokens outside a Remotion context — the same split as entrance.ts.
 */
import { useEffect, useState } from "react";
import { continueRender, delayRender } from "remotion";
import { FONT_FACE_CSS, PACKAGED_FAMILIES } from "./fonts.generated.ts";

/**
 * `document.fonts.ready` is not enough on its own: it resolves when nothing is
 * PENDING, and a face that has been declared but not yet demanded by a layout
 * is not pending. So demand each one explicitly, then hold the render until
 * they have all arrived. The data URIs need no network, but they still need a
 * decode, and a frame rendered mid-decode is a frame in the fallback face.
 */
export function PackagedFonts() {
  const [handle] = useState(() => delayRender("packaged fonts"));

  useEffect(() => {
    let alive = true;
    const wanted = PACKAGED_FAMILIES.flatMap((family) => [
      document.fonts.load(`300 16px "${family}"`),
      document.fonts.load(`700 16px "${family}"`),
      document.fonts.load(`900 16px "${family}"`),
    ]);
    Promise.all(wanted)
      .catch(() => undefined) // a missing weight must not wedge the render
      .then(() => {
        if (alive) continueRender(handle);
      });
    return () => {
      alive = false;
    };
  }, [handle]);

  return <style>{FONT_FACE_CSS}</style>;
}
