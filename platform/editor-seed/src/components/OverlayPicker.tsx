/**
 * "Add overlay" picker: lists contracts/components_catalog.json entries;
 * choosing one inserts it at the playhead with schema-default props and
 * selects it so the generated props form opens on the right.
 */

import { voiceoverDuration } from "@engine/player";
import { CATALOG_OVERLAYS } from "../catalog";
import { addOverlay } from "../plan/mutations";
import { usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";
import { defaultProps } from "./PropsForm";

const DEFAULT_OVERLAY_SECONDS = 3;

export function OverlayPicker({ onClose }: { onClose: () => void }) {
  const add = (component: string) => {
    const { applyEdit, workingPlan } = usePlanStore.getState();
    if (!workingPlan) return;
    const entry = CATALOG_OVERLAYS.find((e) => e.component === component)!;
    const start = useUiStore.getState().playhead;
    const end = Math.min(start + DEFAULT_OVERLAY_SECONDS, voiceoverDuration(workingPlan));
    applyEdit("add overlay", (plan) => addOverlay(plan, component, start, end, defaultProps(entry.props)));
    useUiStore.getState().select({
      track: "overlays",
      index: workingPlan.tracks.overlays.length, // the appended item
    });
    onClose();
  };

  return (
    <div className="absolute bottom-full right-1 z-30 mb-1 w-80 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-neutral-300">
          Add overlay <span className="text-neutral-600">(components catalog)</span>
        </span>
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">✕</button>
      </div>
      {CATALOG_OVERLAYS.map((entry) => (
        <button
          key={entry.component}
          onClick={() => add(entry.component)}
          className="block w-full rounded px-2 py-1.5 text-left hover:bg-neutral-800"
        >
          <span className="text-sm text-neutral-200">{entry.component}</span>
          <span className="block text-xs text-neutral-500">{entry.description}</span>
        </button>
      ))}
    </div>
  );
}
