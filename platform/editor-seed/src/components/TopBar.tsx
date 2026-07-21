/**
 * Top bar: back to picker (guarded when dirty), title + dirty dot, the live
 * issues badge (opens the issues panel), undo/redo, Save, Render.
 */

import { isDirty, usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";

export function TopBar() {
  const title = usePlanStore((s) => s.title);
  const dirty = usePlanStore(isDirty);
  const issues = usePlanStore((s) => s.issues);
  const saving = usePlanStore((s) => s.saving);
  const saveError = usePlanStore((s) => s.saveError);
  const undoStack = usePlanStore((s) => s.undoStack);
  const redoStack = usePlanStore((s) => s.redoStack);
  const { undo, redo, save, closeVideo } = usePlanStore.getState();
  const issuesOpen = useUiStore((s) => s.issuesOpen);
  const setIssuesOpen = useUiStore((s) => s.setIssuesOpen);
  const setRenderOpen = useUiStore((s) => s.setRenderOpen);

  const back = () => {
    if (dirty && !window.confirm("Discard unsaved changes to the plan?")) return;
    closeVideo();
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-neutral-800 bg-neutral-925 px-3">
      <button
        onClick={back}
        className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 hover:text-neutral-200"
      >
        ← Videos
      </button>
      <div className="flex items-center gap-2">
        <span className="max-w-[26rem] truncate text-sm font-medium text-neutral-100">{title}</span>
        {dirty && <span className="h-2 w-2 rounded-full bg-amber-400" title="unsaved changes" />}
      </div>

      <button
        onClick={() => setIssuesOpen(!issuesOpen)}
        className={`ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          issues.length > 0
            ? "bg-red-950 text-red-400 hover:bg-red-900"
            : "bg-emerald-950 text-emerald-400"
        }`}
        title={issues.length ? "show validation issues" : "plan is valid"}
      >
        {issues.length > 0 ? `${issues.length} issue${issues.length > 1 ? "s" : ""}` : "valid"}
      </button>
      {saveError && <span className="truncate text-xs text-red-400">{saveError}</span>}

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={undo}
          disabled={undoStack.length === 0}
          title="undo (ctrl+z)"
          className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          ↺
        </button>
        <button
          onClick={redo}
          disabled={redoStack.length === 0}
          title="redo (ctrl+shift+z)"
          className="rounded px-2 py-1 text-sm text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
        >
          ↻
        </button>
        <button
          onClick={() => void save()}
          disabled={!dirty || saving}
          className="rounded bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 hover:bg-white disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => setRenderOpen(true)}
          className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500"
        >
          Render
        </button>
      </div>
    </header>
  );
}
