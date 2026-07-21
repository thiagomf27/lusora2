/**
 * AI chat panel. The agent sees the SAVED plan (the server prompts from
 * disk), so sending is gated on a clean working copy; its validated ops are
 * applied to the working plan as ONE undo step and saved like any edit.
 */

import { useEffect, useRef, useState } from "react";
import { create } from "zustand";
import { api, ApiError } from "../api";
import { applyEditOps } from "../plan/editOps";
import { isDirty, usePlanStore } from "../store/planStore";
import type { ChatMessage, EditOp } from "../types";

interface Turn extends ChatMessage {
  ops?: EditOp[];
  errors?: string[];
}

interface ChatStore {
  videoId: string | null;
  turns: Turn[];
  pending: boolean;
  push: (turn: Turn) => void;
  reset: (videoId: string) => void;
  setPending: (pending: boolean) => void;
}

const useChatStore = create<ChatStore>((set) => ({
  videoId: null,
  turns: [],
  pending: false,
  push: (turn) => set((s) => ({ turns: [...s.turns, turn] })),
  reset: (videoId) => set({ videoId, turns: [], pending: false }),
  setPending: (pending) => set({ pending }),
}));

export function ChatPanel() {
  const videoId = usePlanStore((s) => s.videoId);
  const savedHash = usePlanStore((s) => s.savedHash);
  const dirty = usePlanStore(isDirty);
  const saving = usePlanStore((s) => s.saving);
  const { turns, pending } = useChatStore();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (videoId && useChatStore.getState().videoId !== videoId) {
      useChatStore.getState().reset(videoId);
    }
  }, [videoId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, pending]);

  const send = async () => {
    const text = input.trim();
    if (!text || !videoId || pending || dirty) return;
    const store = useChatStore.getState();
    store.push({ role: "user", content: text });
    setInput("");
    store.setPending(true);
    try {
      const history = useChatStore
        .getState()
        .turns.map(({ role, content }) => ({ role, content }));
      const response = await api.chat(videoId, history, savedHash);
      store.push({
        role: "assistant",
        content: response.reply,
        ops: response.operations,
        errors: response.errors,
      });
      if (response.operations.length > 0) {
        // one undo step for the whole chat turn, then persist like any edit
        usePlanStore.getState().applyEdit(`chat: ${text.slice(0, 40)}`, (plan) =>
          applyEditOps(plan, response.operations),
        );
        await usePlanStore.getState().save();
      }
    } catch (err) {
      const stale = err instanceof ApiError && err.status === 409;
      store.push({
        role: "assistant",
        content: stale
          ? "The plan changed on disk since it was loaded — reload the video and re-send."
          : `Request failed: ${err instanceof Error ? err.message : String(err)}`,
        errors: [],
      });
    } finally {
      store.setPending(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {turns.length === 0 && (
          <p className="mt-8 text-center text-xs leading-relaxed text-neutral-600">
            Describe an edit — “make the intro caption punchier”,
            “cross-dissolve between the first two clips”,
            “add a chapter title at 12s”.
            <br />
            Every change is validated before it touches the plan.
          </p>
        )}
        <div className="flex flex-col gap-3">
          {turns.map((turn, i) => (
            <TurnBubble key={i} turn={turn} />
          ))}
          {pending && <p className="text-xs text-neutral-500">thinking…</p>}
        </div>
        <div ref={bottomRef} />
      </div>

      {dirty && (
        <div className="border-t border-neutral-800 bg-amber-950/30 px-3 py-2 text-xs text-amber-400">
          Unsaved changes — the agent reads the saved plan.{" "}
          <button
            onClick={() => void usePlanStore.getState().save()}
            disabled={saving}
            className="underline hover:text-amber-300"
          >
            {saving ? "Saving…" : "Save now"}
          </button>
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
        className="flex gap-2 border-t border-neutral-800 p-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={dirty ? "save first…" : "Ask for an edit…"}
          disabled={pending || dirty}
          className="min-w-0 flex-1 rounded bg-neutral-800 px-2.5 py-1.5 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-neutral-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={pending || dirty || !input.trim()}
          className="rounded bg-neutral-100 px-3 py-1 text-sm font-medium text-neutral-900 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}

function TurnBubble({ turn }: { turn: Turn }) {
  if (turn.role === "user") {
    return (
      <div className="self-end rounded-lg bg-neutral-800 px-3 py-1.5 text-sm text-neutral-200">
        {turn.content}
      </div>
    );
  }
  const failed = (turn.errors?.length ?? 0) > 0;
  return (
    <div className="self-start rounded-lg border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300">
      <p>{turn.content}</p>
      {turn.ops && turn.ops.length > 0 && (
        <details className="mt-1.5">
          <summary className="cursor-pointer text-xs text-emerald-500">
            used {turn.ops.length} op{turn.ops.length > 1 ? "s" : ""}
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-neutral-950 p-2 text-[10px] text-neutral-400">
            {JSON.stringify(turn.ops, null, 1)}
          </pre>
        </details>
      )}
      {failed && (
        <details className="mt-1.5" open>
          <summary className="cursor-pointer text-xs text-red-400">
            no changes applied — {turn.errors!.length} validation error
            {turn.errors!.length > 1 ? "s" : ""}
          </summary>
          <ul className="mt-1 list-inside list-disc text-[11px] text-red-300">
            {turn.errors!.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
