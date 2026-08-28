/**
 * Component registry for the Remotion path. Names match the catalog
 * (engine/src/catalog/registry.ts) — the validator guarantees a plan
 * only references these.
 *
 * Implementations live in ./core for the generated `core` pack, and in
 * ./<pack> for a component pack whose entries are data
 * (contracts/component-packs/<pack>.json) but whose drawing is code —
 * ./social and ./finance are those. The `archive` pack is GONE: D66 merged
 * seven of its nine components into their core twins, and D69 retired the last
 * two — `ArchiveFrames` became core/PortraitPlates (a name that describes what
 * it draws rather than a look) and `ArchiveCaption` was deleted. What was left
 * was a look, and a look is a theme.
 *
 * ./basic is the text-only pack (D73): four role entries plus the general
 * TextTag, all over one renderer in basic/TextLockup.tsx, which is itself
 * unregistered because it is drawing rather than a catalog name.
 *
 * ./example_lib keeps the original six as reference copies and is deliberately
 * NOT registered.
 */
import type { ComponentType } from "react";
import type { Theme } from "@lusora/contracts";


import { TextCounter } from "./basic/TextCounter.tsx";
import { TextHighlight } from "./basic/TextHighlight.tsx";
import { TextName } from "./basic/TextName.tsx";
import { TextPlace } from "./basic/TextPlace.tsx";
import { TextTag } from "./basic/TextTag.tsx";
import { TextTitle } from "./basic/TextTitle.tsx";

import { Candlestick } from "./finance/Candlestick.tsx";
import { MetricGrid } from "./finance/MetricGrid.tsx";
import { WaterfallChart } from "./finance/WaterfallChart.tsx";

import { HeadlineStack } from "./social/HeadlineStack.tsx";
import { SocialPost } from "./social/SocialPost.tsx";
import { WebPageFrame } from "./social/WebPageFrame.tsx";

import { AnimatedCounter } from "./core/AnimatedCounter.tsx";
import { ArchivalFrame } from "./core/ArchivalFrame.tsx";
import { BarChart } from "./core/BarChart.tsx";
import { BulletList } from "./core/BulletList.tsx";
import { CalloutArrow } from "./core/CalloutArrow.tsx";
import { ChapterCard } from "./core/ChapterCard.tsx";
import { ComparisonSplit } from "./core/ComparisonSplit.tsx";
import { DateStamp } from "./core/DateStamp.tsx";
import { DataTable } from "./core/DataTable.tsx";
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
import { PortraitPlates } from "./core/PortraitPlates.tsx";
import { PieChart } from "./core/PieChart.tsx";
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
  Candlestick,
  ChapterCard,
  ComparisonSplit,
  DataTable,
  DateStamp,
  DefinitionCard,
  DocumentCard,
  FactCard,
  FactSheet,
  FramedExhibit,
  HammerStatement,
  HeadlineStack,
  HighlightedPassage,
  KineticTitle,
  LineChart,
  MetricGrid,
  NamePlate,
  PieChart,
  PortraitPlates,
  QuoteBlock,
  RankLabel,
  RegionHighlight,
  RouteMap,
  SatelliteLocate,
  SocialPost,
  StatTag,
  StepFlow,
  TextCounter,
  TextHighlight,
  TextName,
  TextPlace,
  TextTag,
  TextTitle,
  Timeline,
  WaterfallChart,
  WebPageFrame,
};

export {
  AnimatedCounter,
  ArchivalFrame,
  BarChart,
  BulletList,
  CalloutArrow,
  Candlestick,
  ChapterCard,
  ComparisonSplit,
  DataTable,
  DateStamp,
  DefinitionCard,
  DocumentCard,
  FactCard,
  FactSheet,
  FramedExhibit,
  HammerStatement,
  HeadlineStack,
  HighlightedPassage,
  KineticTitle,
  LineChart,
  MetricGrid,
  NamePlate,
  PieChart,
  PortraitPlates,
  QuoteBlock,
  RankLabel,
  RegionHighlight,
  RouteMap,
  SatelliteLocate,
  SocialPost,
  StatTag,
  StepFlow,
  TextCounter,
  TextHighlight,
  TextName,
  TextPlace,
  TextTag,
  TextTitle,
  Timeline,
  WaterfallChart,
  WebPageFrame,
};
