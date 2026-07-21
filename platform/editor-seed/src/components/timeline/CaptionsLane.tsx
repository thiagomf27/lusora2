/**
 * Captions lane: free move (body drag), retime (edge drags, snapping to
 * neighbors and cut points), double-click for inline text editing. Every
 * gesture is one undo step.
 */

import { useState } from "react";
import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";
import { retimeItem, setCaptionText } from "../../plan/mutations";
import { snapTime, startPlanDrag } from "./drag";
import { LANE_HEIGHTS } from "./Timeline";

export function CaptionsLane() {
  const captions = usePlanStore((s) => s.workingPlan?.tracks.captions ?? []);
  const pps = useUiStore((s) => s.pixelsPerSecond);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const [editing, setEditing] = useState<number | null>(null);

  const dragBody = (event: React.PointerEvent, index: number) => {
    select({ track: "captions", index });
    const item = captions[index]!;
    startPlanDrag(event, {
      label: "move caption",
      update: (plan, delta) => {
        const start = snapTime(plan, item.start + delta, pps);
        return retimeItem(plan, "captions", index, start, start + (item.end - item.start));
      },
    });
  };

  const dragEdge = (event: React.PointerEvent, index: number, edge: "start" | "end") => {
    select({ track: "captions", index });
    const item = captions[index]!;
    startPlanDrag(event, {
      label: "retime caption",
      update: (plan, delta) =>
        edge === "start"
          ? retimeItem(plan, "captions", index, snapTime(plan, item.start + delta, pps), item.end)
          : retimeItem(plan, "captions", index, item.start, snapTime(plan, item.end + delta, pps)),
    });
  };

  const commitText = (index: number, text: string) => {
    setEditing(null);
    const current = usePlanStore.getState().workingPlan?.tracks.captions[index];
    if (!current || current.text === text) return;
    usePlanStore.getState().applyEdit("edit caption text", (plan) => setCaptionText(plan, index, text));
  };

  return (
    <div style={{ height: LANE_HEIGHTS.captions }} className="relative border-b border-neutral-900">
      {captions.map((item, i) => {
        const selected = selection?.track === "captions" && selection.index === i;
        return (
          <div
            key={i}
            onPointerDown={(e) => editing !== i && dragBody(e, i)}
            onDoubleClick={() => setEditing(i)}
            style={{ left: item.start * pps, width: Math.max((item.end - item.start) * pps, 4) }}
            className={`group absolute bottom-1 top-1 cursor-grab overflow-hidden whitespace-nowrap rounded-sm border px-1 text-left text-[10px] leading-tight ${
              selected
                ? "z-10 border-sky-400 bg-sky-900/80 text-sky-100"
                : "border-sky-900 bg-sky-950/70 text-sky-300/80 hover:border-sky-700"
            }`}
            title={item.text}
          >
            {editing === i ? (
              <input
                autoFocus
                defaultValue={item.text}
                onPointerDown={(e) => e.stopPropagation()}
                onBlur={(e) => commitText(i, e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitText(i, e.currentTarget.value);
                  if (e.key === "Escape") setEditing(null);
                  e.stopPropagation();
                }}
                className="h-full w-full bg-transparent text-[10px] text-sky-100 outline-none"
              />
            ) : (
              <span className="pointer-events-none">{item.text}</span>
            )}
            <Edge side="left" onPointerDown={(e) => dragEdge(e, i, "start")} />
            <Edge side="right" onPointerDown={(e) => dragEdge(e, i, "end")} />
          </div>
        );
      })}
    </div>
  );
}

export function Edge({
  side,
  onPointerDown,
}: {
  side: "left" | "right";
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={`absolute bottom-0 top-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 ${
        side === "left" ? "left-0" : "right-0"
      } bg-white/30`}
    />
  );
}
