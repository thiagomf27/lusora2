/**
 * The single seam every catalog component imports: the Theme type plus the
 * theme runtime helpers. Components stay portable (one relative import, no
 * knowledge of where contracts or the runtime live) and appearance keeps
 * resolving in exactly one place — engine/src/themes/runtime.ts (D8).
 */
export type { Entrance, Theme } from "@lusora/contracts";
export {
  DEFAULT_THEME,
  blend,
  borderSides,
  capsTracking,
  captionStyle,
  chartStyle,
  composition,
  contrastInk,
  densityScale,
  easingCurve,
  emphasisColor,
  entranceFor,
  fadeInOutRange,
  fontStack,
  groundStyle,
  motionScale,
  mutedInk,
  paperStock,
  posterPad,
  ruleWidth,
  seriesColors,
  surfaceColor,
  surfaceStyle,
  textureLayer,
  typeCase,
  typeScale,
  typeTracking,
  typeWeight,
  type AccentRule,
  type CaptionStyle,
  type ChartBase,
  type ChartStyle,
  type Composition,
  type SurfaceStyle,
  type TypeRole,
} from "../themes/runtime.ts";
export {
  PANEL_ENTRANCES,
  TEXT_ENTRANCES,
  useEntrance,
  type EntranceState,
} from "../themes/entrance.ts";
