/**
 * Render flow: save-gated (the renderer reads the folder), POST /render,
 * poll status with the log tail, and play final.mp4 inline (files API,
 * Range-capable) on success.
 */

import { useEffect, useRef, useState } from "react";
import { api, ApiError, fileUrl } from "../api";
import { isDirty, usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";
import type { RenderStatus } from "../types";

export function RenderModal() {
  const open = useUiStore((s) => s.renderOpen);
  const setOpen = useUiStore((s) => s.setRenderOpen);
  const videoId = usePlanStore((s) => s.videoId);
  const dirty = usePlanStore(isDirty);
  const saving = usePlanStore((s) => s.saving);
  const [status, setStatus] = useState<RenderStatus | null>(null);
  const [error, setError] = useState<string | string[] | null>(null);
  const [starting, setStarting] = useState(false);
  const logRef = useRef<HTMLPreElement>(null);

  // poll while open; keeps working across re-opens and page refreshes
  useEffect(() => {
    if (!open || !videoId) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const s = await api.renderStatus(videoId);
        if (!cancelled) setStatus(s);
      } catch {
        /* transient — next tick retries */
      }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [open, videoId]);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [status?.log_tail]);

  if (!open || !videoId) return null;

  const start = async () => {
    setError(null);
    setStarting(true);
    try {
      await api.startRender(videoId);
      setStatus({ state: "running", log_tail: [], exit_code: null, final_exists: false });
    } catch (err) {
      setError(err instanceof ApiError ? err.detail : String(err));
    } finally {
      setStarting(false);
    }
  };

  const running = status?.state === "running";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6">
      <div className="flex max-h-full w-[42rem] flex-col rounded-lg border border-neutral-700 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
          <span className="text-sm font-medium">
            Render{" "}
            {status && (
              <span
                className={
                  status.state === "done"
                    ? "text-emerald-400"
                    : status.state === "failed"
                      ? "text-red-400"
                      : status.state === "running"
                        ? "text-amber-400"
                        : "text-neutral-500"
                }
              >
                · {status.state}
              </span>
            )}
          </span>
          <button onClick={() => setOpen(false)} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {dirty && (
            <div className="mb-3 rounded border border-amber-900 bg-amber-950/40 p-2 text-xs text-amber-400">
              Unsaved changes — the renderer reads edit_plan.json from disk.{" "}
              <button
                onClick={() => void usePlanStore.getState().save()}
                disabled={saving}
                className="underline hover:text-amber-300"
              >
                {saving ? "Saving…" : "Save now"}
              </button>
            </div>
          )}
          {error && (
            <div className="mb-3 whitespace-pre-wrap rounded border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
              {Array.isArray(error) ? error.map((e) => `• ${e}`).join("\n") : error}
            </div>
          )}

          {status?.state === "done" && (
            <video
              controls
              src={fileUrl(videoId, "final.mp4")}
              className="mb-3 w-full rounded bg-black"
            />
          )}

          {status && status.log_tail.length > 0 && (
            <pre
              ref={logRef}
              className="max-h-56 overflow-y-auto rounded bg-neutral-950 p-2 text-[10px] leading-relaxed text-neutral-400"
            >
              {status.log_tail.join("\n")}
            </pre>
          )}
          {status?.state === "idle" && !status.final_exists && (
            <p className="text-sm text-neutral-500">
              No render yet. The renderer runs the video-engine CLI on this video folder
              (validated first — full level, assets included).
            </p>
          )}
          {status?.state === "idle" && status.final_exists && (
            <video controls src={fileUrl(videoId, "final.mp4")} className="mb-3 w-full rounded bg-black" />
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-neutral-800 px-4 py-2.5">
          <button
            onClick={() => setOpen(false)}
            className="rounded px-3 py-1 text-sm text-neutral-400 hover:bg-neutral-800"
          >
            Close
          </button>
          <button
            onClick={() => void start()}
            disabled={running || starting || dirty}
            className="rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            title={dirty ? "save first" : undefined}
          >
            {running ? "Rendering…" : status?.final_exists ? "Re-render" : "Start render"}
          </button>
        </div>
      </div>
    </div>
  );
}
