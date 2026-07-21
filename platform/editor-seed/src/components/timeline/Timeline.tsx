/**
 * Multi-track timeline: ruler + four lanes (captions / visual / overlays /
 * audio) over a shared horizontal scroll, a playhead synced with the Player,
 * and ctrl+wheel zoom anchored at the cursor.
 */

import { useRef } from "react";
import { voiceoverDuration } from "@engine/player";
import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";
import { AudioLane } from "./AudioLane";
import { CaptionsLane } from "./CaptionsLane";
import { OverlaysLane } from "./OverlaysLane";
import { Ruler } from "./Ruler";
import { VisualLane } from "./VisualLane";

export const LANE_HEIGHTS = { ruler: 28, captions: 30, visual: 64, overlays: 30, audio: 52 };
const RIGHT_PAD_PX = 240;

const LANE_LABELS: { key: keyof typeof LANE_HEIGHTS; label: string }[] = [
  { key: "captions", label: "Captions" },
  { key: "visual", label: "Visual" },
  { key: "overlays", label: "Overlays" },
  { key: "audio", label: "Audio" },
];

export function Timeline() {
  const plan = usePlanStore((s) => s.workingPlan);
  const pps = useUiStore((s) => s.pixelsPerSecond);
  const setZoom = useUiStore((s) => s.setZoom);
  const scrollRef = useRef<HTMLDivElement>(null);

  if (!plan) return null;
  const duration = voiceoverDuration(plan);
  const contentWidth = duration * pps + RIGHT_PAD_PX;

  const onWheel = (event: React.WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const scroller = scrollRef.current;
    if (!scroller) return;
    const cursorX = event.clientX - scroller.getBoundingClientRect().left;
    const timeAtCursor = (scroller.scrollLeft + cursorX) / pps;
    const next = Math.min(400, Math.max(4, pps * Math.exp(-event.deltaY * 0.0015)));
    setZoom(next);
    // keep the time under the cursor stationary
    scroller.scrollLeft = timeAtCursor * next - cursorX;
  };

  return (
    <div className="flex shrink-0 select-none border-t border-neutral-800 bg-neutral-950">
      {/* fixed label column */}
      <div className="w-20 shrink-0 border-r border-neutral-800">
        <div style={{ height: LANE_HEIGHTS.ruler }} className="border-b border-neutral-800" />
        {LANE_LABELS.map(({ key, label }) => (
          <div
            key={key}
            style={{ height: LANE_HEIGHTS[key] }}
            className="flex items-center border-b border-neutral-900 px-2 text-[10px] font-medium uppercase tracking-wider text-neutral-500"
          >
            {label}
          </div>
        ))}
      </div>

      {/* scrollable lanes */}
      <div
        ref={scrollRef}
        onWheel={onWheel}
        className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
      >
        <div style={{ width: contentWidth }} className="relative">
          <Ruler duration={duration} />
          <CaptionsLane />
          <VisualLane />
          <OverlaysLane />
          <AudioLane />
          <Playhead />
        </div>
      </div>
    </div>
  );
}

function Playhead() {
  const playhead = useUiStore((s) => s.playhead);
  const pps = useUiStore((s) => s.pixelsPerSecond);
  return (
    <div
      className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-red-500"
      style={{ left: playhead * pps }}
    >
      <div className="absolute -left-[5px] top-0 h-0 w-0 border-x-[5px] border-t-[6px] border-x-transparent border-t-red-500" />
    </div>
  );
}
