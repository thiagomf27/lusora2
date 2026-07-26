/**
 * The single seam every catalog component imports: the Theme type plus the
 * theme runtime helpers. Components stay portable (one relative import, no
 * knowledge of where contracts or the runtime live) and appearance keeps
 * resolving in exactly one place — engine/src/themes/runtime.ts (D8).
 */
export type { Theme } from "@lusora/contracts";
export {
  DEFAULT_THEME,
  captionStyle,
  emphasisColor,
  fadeInOutRange,
  fontStack,
  motionScale,
  type CaptionStyle,
} from "../themes/runtime.ts";
