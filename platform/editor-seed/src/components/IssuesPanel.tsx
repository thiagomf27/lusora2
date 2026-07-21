/**
 * Issues panel: the live validation errors behind the top-bar badge — the
 * same strings pipeline/stages/validate_plan.py produces. Clicking an issue
 * that names a track item (e.g. "visual[2]: …") selects it on the timeline.
 */

import { usePlanStore } from "../store/planStore";
import { useUiStore, type TrackName } from "../store/uiStore";

const ITEM_REF = /^(captions|visual|overlays|audio)\[(\d+)\]/;

export function IssuesPanel() {
  const open = useUiStore((s) => s.issuesOpen);
  const setOpen = useUiStore((s) => s.setIssuesOpen);
  const select = useUiStore((s) => s.select);
  const issues = usePlanStore((s) => s.issues);

  if (!open) return null;

  const jump = (issue: string) => {
    const match = ITEM_REF.exec(issue);
    if (!match) return;
    select({ track: match[1] as TrackName, index: Number(match[2]) });
    setOpen(false);
  };

  return (
    <div className="absolute right-3 top-14 z-30 flex max-h-96 w-[28rem] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-xl">
      <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-2">
        <span className="text-sm font-medium">
          {issues.length > 0 ? `${issues.length} validation issue${issues.length > 1 ? "s" : ""}` : "Plan is valid"}
        </span>
        <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-300">
          ✕
        </button>
      </div>
      <div className="min-h-0 overflow-y-auto p-2">
        {issues.length === 0 && (
          <p className="p-3 text-sm text-neutral-500">
            Every check in validate_plan passes. Save away.
          </p>
        )}
        {issues.map((issue, i) => (
          <button
            key={i}
            onClick={() => jump(issue)}
            className={`block w-full rounded px-2 py-1.5 text-left text-xs leading-snug text-red-300 ${
              ITEM_REF.test(issue) ? "hover:bg-neutral-800" : "cursor-default"
            }`}
          >
            {issue}
          </button>
        ))}
      </div>
    </div>
  );
}
