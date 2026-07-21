/**
 * Right panel: tabbed Properties (selected timeline item) / Chat (AI edit
 * agent). Selecting an item on the timeline switches to Properties.
 */

import { useUiStore } from "../store/uiStore";
import { ChatPanel } from "./ChatPanel";
import { PropertiesPanel } from "./PropertiesPanel";

export function RightPanel() {
  const tab = useUiStore((s) => s.rightTab);
  const setTab = useUiStore((s) => s.setRightTab);

  return (
    <aside className="flex w-80 shrink-0 flex-col border-l border-neutral-800 bg-neutral-925">
      <div className="flex border-b border-neutral-800">
        {(["properties", "chat"] as const).map((name) => (
          <button
            key={name}
            onClick={() => setTab(name)}
            className={`flex-1 px-3 py-2 text-xs font-medium uppercase tracking-wide ${
              tab === name
                ? "border-b-2 border-neutral-200 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "properties" ? <PropertiesPanel /> : <ChatPanel />}
      </div>
    </aside>
  );
}
