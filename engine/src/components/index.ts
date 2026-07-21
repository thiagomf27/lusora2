/**
 * Component registry for the Remotion path. Names match the catalog
 * (engine/src/catalog/registry.ts) — the validator guarantees a plan
 * only references these.
 */
import type { ComponentType } from "react";
import type { Theme } from "@lusora/contracts";
import { TitleCard } from "./core/TitleCard.tsx";
import { LowerThird } from "./core/LowerThird.tsx";
import { AnimatedPercentage } from "./core/AnimatedPercentage.tsx";
import { ComparisonBars } from "./core/ComparisonBars.tsx";
import { AnimatedMap } from "./core/AnimatedMap.tsx";
import { ChapterTitle } from "./core/ChapterTitle.tsx";

export interface OverlayComponentProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: any;
  theme: Theme;
}

export const COMPONENTS: Record<string, ComponentType<OverlayComponentProps>> = {
  TitleCard,
  LowerThird,
  AnimatedPercentage,
  ComparisonBars,
  AnimatedMap,
  ChapterTitle,
};

export { TitleCard, LowerThird, AnimatedPercentage, ComparisonBars, AnimatedMap, ChapterTitle };
