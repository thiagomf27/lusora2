/**
 * Component registry for the Remotion path. Names match the catalog
 * (engine/src/catalog/registry.ts) — the validator guarantees a plan
 * only references these.
 *
 * Implementations live in ./core; ./example_lib keeps the original six as
 * reference copies and is deliberately NOT registered.
 */
import type { ComponentType } from "react";
import type { Theme } from "@lusora/contracts";

import { AnimatedCounter } from "./core/AnimatedCounter.tsx";
import { ArchivalFrame } from "./core/ArchivalFrame.tsx";
import { BarChart } from "./core/BarChart.tsx";
import { BulletList } from "./core/BulletList.tsx";
import { CalloutArrow } from "./core/CalloutArrow.tsx";
import { ChapterCard } from "./core/ChapterCard.tsx";
import { ComparisonSplit } from "./core/ComparisonSplit.tsx";
import { DateStamp } from "./core/DateStamp.tsx";
import { DefinitionCard } from "./core/DefinitionCard.tsx";
import { DocumentCard } from "./core/DocumentCard.tsx";
import { FactCard } from "./core/FactCard.tsx";
import { FactSheet } from "./core/FactSheet.tsx";
import { FramedExhibit } from "./core/FramedExhibit.tsx";
import { HammerStatement } from "./core/HammerStatement.tsx";
import { HighlightedPassage } from "./core/HighlightedPassage.tsx";
import { KineticTitle } from "./core/KineticTitle.tsx";
import { LineChart } from "./core/LineChart.tsx";
import { NamePlate } from "./core/NamePlate.tsx";
import { QuoteBlock } from "./core/QuoteBlock.tsx";
import { RankLabel } from "./core/RankLabel.tsx";
import { RegionHighlight } from "./core/RegionHighlight.tsx";
import { RouteMap } from "./core/RouteMap.tsx";
import { SatelliteLocate } from "./core/SatelliteLocate.tsx";
import { StatTag } from "./core/StatTag.tsx";
import { StepFlow } from "./core/StepFlow.tsx";
import { Timeline } from "./core/Timeline.tsx";

export interface OverlayComponentProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: any;
  theme: Theme;
}

export const COMPONENTS: Record<string, ComponentType<OverlayComponentProps>> = {
  AnimatedCounter,
  ArchivalFrame,
  BarChart,
  BulletList,
  CalloutArrow,
  ChapterCard,
  ComparisonSplit,
  DateStamp,
  DefinitionCard,
  DocumentCard,
  FactCard,
  FactSheet,
  FramedExhibit,
  HammerStatement,
  HighlightedPassage,
  KineticTitle,
  LineChart,
  NamePlate,
  QuoteBlock,
  RankLabel,
  RegionHighlight,
  RouteMap,
  SatelliteLocate,
  StatTag,
  StepFlow,
  Timeline,
};

export {
  AnimatedCounter,
  ArchivalFrame,
  BarChart,
  BulletList,
  CalloutArrow,
  ChapterCard,
  ComparisonSplit,
  DateStamp,
  DefinitionCard,
  DocumentCard,
  FactCard,
  FactSheet,
  FramedExhibit,
  HammerStatement,
  HighlightedPassage,
  KineticTitle,
  LineChart,
  NamePlate,
  QuoteBlock,
  RankLabel,
  RegionHighlight,
  RouteMap,
  SatelliteLocate,
  StatTag,
  StepFlow,
  Timeline,
};
