/**
 * Time ruler: tick marks adapted to zoom; click or drag to seek (the Player
 * follows, and its frameupdate event moves the shared playhead back).
 */

import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";
import { playerRef, seekSeconds } from "../../playerRef";
import { LANE_HEIGHTS } from "./Timeline";

const TICK_STEPS = [0.5, 1, 2, 5, 10, 30, 60];

function format(t: number): string {
  const minutes = Math.floor(t / 60);
  const seconds = t - minutes * 60;
  return minutes > 0 ? `${minutes}:${seconds.toFixed(0).padStart(2, "0")}` : `${seconds}s`;
}

export function Ruler({ duration }: { duration: number }) {
  const pps = useUiStore((s) => s.pixelsPerSecond);
  const setPlayhead = useUiStore((s) => s.setPlayhead);
  const fps = usePlanStore((s) => s.workingPlan?.fps ?? 30);

  const step = TICK_STEPS.find((s) => s * pps >= 60) ?? 60;
  const ticks: number[] = [];
  for (let t = 0; t <= duration; t += step) ticks.push(t);

  const seekFromEvent = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const t = Math.min(duration, Math.max(0, (event.clientX - rect.left) / pps));
    setPlayhead(t);
    seekSeconds(t, fps);
  };

  return (
    <div
      style={{ height: LANE_HEIGHTS.ruler }}
      className="relative cursor-ew-resize border-b border-neutral-800"
      onPointerDown={(event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        playerRef.current?.pause();
        seekFromEvent(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromEvent(event);
      }}
    >
      {ticks.map((t) => (
        <div key={t} className="absolute bottom-0 top-0" style={{ left: t * pps }}>
          <div className="absolute bottom-0 h-2 w-px bg-neutral-700" />
          <span className="absolute top-1 pl-1 text-[10px] tabular-nums text-neutral-500">
            {format(t)}
          </span>
        </div>
      ))}
    </div>
  );
}
