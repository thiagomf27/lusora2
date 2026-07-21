/**
 * The one PlayerRef shared by the preview and the timeline: the timeline
 * seeks/toggles through it, the Player reports frame updates back into the
 * ui store. A module-level ref avoids threading it through every component.
 */

import { createRef } from "react";
import type { PlayerRef } from "@remotion/player";

export const playerRef = createRef<PlayerRef>();

export function seekSeconds(seconds: number, fps: number): void {
  playerRef.current?.seekTo(Math.max(0, Math.round(seconds * fps)));
}

export function togglePlay(): void {
  playerRef.current?.toggle();
}
