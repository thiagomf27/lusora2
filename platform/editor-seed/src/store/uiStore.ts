/**
 * Editor UI state: selection, playhead, timeline zoom, right-panel tab.
 * Kept separate from the plan store — none of this is part of the document.
 */

import { create } from "zustand";

export type TrackName = "captions" | "visual" | "overlays" | "audio";

export interface Selection {
  track: TrackName;
  index: number;
}

interface UiStore {
  selection: Selection | null;
  playhead: number; // seconds, mirrored from the Player
  playing: boolean;
  pixelsPerSecond: number;
  rightTab: "properties" | "chat";
  issuesOpen: boolean;
  renderOpen: boolean;
  assetSearchQuery: string | null; // non-null opens the sidebar search pre-filled

  select: (selection: Selection | null) => void;
  setPlayhead: (seconds: number) => void;
  setPlaying: (playing: boolean) => void;
  setZoom: (pixelsPerSecond: number) => void;
  setRightTab: (tab: "properties" | "chat") => void;
  setIssuesOpen: (open: boolean) => void;
  setRenderOpen: (open: boolean) => void;
  setAssetSearchQuery: (query: string | null) => void;
}

export const MIN_PPS = 4;
export const MAX_PPS = 400;

export const useUiStore = create<UiStore>((set) => ({
  selection: null,
  playhead: 0,
  playing: false,
  pixelsPerSecond: 40,
  rightTab: "properties",
  issuesOpen: false,
  renderOpen: false,
  assetSearchQuery: null,

  select: (selection) => set({ selection, rightTab: "properties" }),
  setPlayhead: (seconds) => set({ playhead: Math.max(0, seconds) }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (pps) => set({ pixelsPerSecond: Math.min(MAX_PPS, Math.max(MIN_PPS, pps)) }),
  setRightTab: (rightTab) => set({ rightTab }),
  setIssuesOpen: (issuesOpen) => set({ issuesOpen }),
  setRenderOpen: (renderOpen) => set({ renderOpen }),
  setAssetSearchQuery: (assetSearchQuery) => set({ assetSearchQuery }),
}));
