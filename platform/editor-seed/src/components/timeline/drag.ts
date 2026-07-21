/**
 * Timeline drag helpers: pointer-capture drags where the WHOLE gesture is
 * one undo step — live moves go through planStore.setTransient (no undo
 * entries), pointer-up commits against the pre-drag snapshot. Deltas are
 * computed from the drag origin, so gestures are stateless and exact.
 */

import type { EditPlan } from "@engine/player";
import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";

export interface DragGesture {
  /** Applied on every move: seconds moved since pointer-down + the pre-drag plan. */
  update: (plan: EditPlan, deltaSeconds: number, event: PointerEvent) => EditPlan;
  label: string;
}

/** Start a drag on pointer-down. Returns immediately; listeners self-clean. */
export function startPlanDrag(event: React.PointerEvent, gesture: DragGesture): void {
  event.preventDefault();
  event.stopPropagation();
  const snapshot = usePlanStore.getState().workingPlan;
  if (!snapshot) return;
  const pps = useUiStore.getState().pixelsPerSecond;
  const originX = event.clientX;
  let moved = false;

  const onMove = (moveEvent: PointerEvent) => {
    const delta = (moveEvent.clientX - originX) / pps;
    if (!moved && Math.abs(moveEvent.clientX - originX) < 3) return; // click, not drag
    moved = true;
    usePlanStore.getState().setTransient(gesture.update(structuredClone(snapshot), delta, moveEvent));
  };
  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (moved) usePlanStore.getState().commitTransient(gesture.label, snapshot);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}

/** Snap a time to nearby caption boundaries / visual cut points / origin+end. */
export function snapTime(plan: EditPlan, t: number, pps: number, thresholdPx = 8): number {
  const threshold = thresholdPx / pps;
  let best = t;
  let bestDistance = threshold;
  const consider = (target: number) => {
    const distance = Math.abs(target - t);
    if (distance < bestDistance) {
      best = target;
      bestDistance = distance;
    }
  };
  consider(0);
  for (const caption of plan.tracks.captions) {
    consider(caption.start);
    consider(caption.end);
  }
  for (const visual of plan.tracks.visual) {
    consider(visual.start);
    consider(visual.end);
  }
  return best;
}
