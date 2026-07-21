/**
 * The editor: top bar; asset sidebar left; Remotion Player center; tabbed
 * Properties/Chat panel right; multi-track timeline bottom. Everything reads
 * the plan store's workingPlan — the Player live-previews unsaved edits.
 */

import { useEffect } from "react";
import { usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";
import { deleteItem, deleteVisual, splitVisual } from "../plan/mutations";
import { playerRef, togglePlay } from "../playerRef";
import { AssetSidebar } from "../components/AssetSidebar";
import { IssuesPanel } from "../components/IssuesPanel";
import { PreviewPlayer } from "../components/PreviewPlayer";
import { RenderModal } from "../components/RenderModal";
import { RightPanel } from "../components/RightPanel";
import { TopBar } from "../components/TopBar";
import { Timeline } from "../components/timeline/Timeline";

function isTyping(): boolean {
  const tag = document.activeElement?.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** space play/pause · ctrl+z / ctrl+shift+z / ctrl+y · S split · Delete */
function useEditorKeyboard(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping()) return;
      const { applyEdit, undo, redo, save } = usePlanStore.getState();
      const { selection, playhead, select } = useUiStore.getState();

      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyZ") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyY") {
        event.preventDefault();
        redo();
      } else if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") {
        event.preventDefault();
        void save();
      } else if (event.code === "KeyS") {
        // split the visual item under the playhead
        const plan = usePlanStore.getState().workingPlan;
        const index = plan?.tracks.visual.findIndex(
          (v) => playhead > v.start && playhead < v.end,
        );
        if (plan && index !== undefined && index >= 0) {
          playerRef.current?.pause();
          applyEdit("split visual", (p) => splitVisual(p, index, playhead));
        }
      } else if ((event.code === "Delete" || event.code === "Backspace") && selection) {
        event.preventDefault();
        const { track, index } = selection;
        if (track === "visual") {
          applyEdit("delete visual", (p) => deleteVisual(p, index));
        } else {
          applyEdit(`delete ${track}`, (p) => deleteItem(p, track, index));
        }
        select(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

export function Editor() {
  const plan = usePlanStore((s) => s.workingPlan);
  const loadError = usePlanStore((s) => s.loadError);
  const closeVideo = usePlanStore((s) => s.closeVideo);
  useEditorKeyboard();

  if (loadError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
        <div className="max-w-xl whitespace-pre-wrap rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {loadError}
        </div>
        <button
          onClick={closeVideo}
          className="rounded bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
        >
          ← Back to videos
        </button>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center text-neutral-400">
        Loading plan…
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <AssetSidebar />
        <main className="min-w-0 flex-1">
          <PreviewPlayer />
        </main>
        <RightPanel />
      </div>
      <Timeline />
      <IssuesPanel />
      <RenderModal />
    </div>
  );
}
