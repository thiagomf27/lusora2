/**
 * Overlays lane: free move/resize (overlaps allowed by contract). The +
 * button opens the catalog picker — components outside
 * components_catalog.json are impossible by construction.
 */

import { useState } from "react";
import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";
import { retimeItem } from "../../plan/mutations";
import { OverlayPicker } from "../OverlayPicker";
import { Edge } from "./CaptionsLane";
import { snapTime, startPlanDrag } from "./drag";
import { LANE_HEIGHTS } from "./Timeline";

export function OverlaysLane() {
  const overlays = usePlanStore((s) => s.workingPlan?.tracks.overlays ?? []);
  const pps = useUiStore((s) => s.pixelsPerSecond);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const [pickerOpen, setPickerOpen] = useState(false);

  const dragBody = (event: React.PointerEvent, index: number) => {
    select({ track: "overlays", index });
    const item = overlays[index]!;
    startPlanDrag(event, {
      label: "move overlay",
      update: (plan, delta) => {
        const start = snapTime(plan, item.start + delta, pps);
        return retimeItem(plan, "overlays", index, start, start + (item.end - item.start));
      },
    });
  };

  const dragEdge = (event: React.PointerEvent, index: number, edge: "start" | "end") => {
    select({ track: "overlays", index });
    const item = overlays[index]!;
    startPlanDrag(event, {
      label: "resize overlay",
      update: (plan, delta) =>
        edge === "start"
          ? retimeItem(plan, "overlays", index, snapTime(plan, item.start + delta, pps), item.end)
          : retimeItem(plan, "overlays", index, item.start, snapTime(plan, item.end + delta, pps)),
    });
  };

  return (
    <div style={{ height: LANE_HEIGHTS.overlays }} className="relative border-b border-neutral-900">
      {overlays.map((item, i) => {
        const selected = selection?.track === "overlays" && selection.index === i;
        return (
          <div
            key={i}
            onPointerDown={(e) => dragBody(e, i)}
            style={{ left: item.start * pps, width: Math.max((item.end - item.start) * pps, 4) }}
            className={`group absolute bottom-1 top-1 cursor-grab overflow-hidden whitespace-nowrap rounded-sm border px-1 text-left text-[10px] leading-tight ${
              selected
                ? "z-10 border-fuchsia-400 bg-fuchsia-900/80 text-fuchsia-100"
                : "border-fuchsia-900 bg-fuchsia-950/70 text-fuchsia-300/80 hover:border-fuchsia-700"
            }`}
            title={`${item.component} ${item.start.toFixed(1)}–${item.end.toFixed(1)}s`}
          >
            <span className="pointer-events-none">{item.component}</span>
            <Edge side="left" onPointerDown={(e) => dragEdge(e, i, "start")} />
            <Edge side="right" onPointerDown={(e) => dragEdge(e, i, "end")} />
          </div>
        );
      })}
      <button
        onClick={() => setPickerOpen(true)}
        title="add overlay (components catalog)"
        className="absolute right-1 top-1 z-10 rounded bg-neutral-800 px-1.5 text-[10px] leading-4 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      >
        +
      </button>
      {pickerOpen && <OverlayPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
