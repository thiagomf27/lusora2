/**
 * First screen: the video working folders from GET /videos, with artifact
 * status chips (the folder IS the state). Click to open the editor.
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import { usePlanStore } from "../store/planStore";
import type { VideoEntry } from "../types";

const ARTIFACT_LABELS: [keyof VideoEntry["artifacts"], string][] = [
  ["script", "script"],
  ["audio", "audio"],
  ["srt", "srt"],
  ["plan", "plan"],
  ["final", "final"],
];

export function VideoPicker() {
  const [videos, setVideos] = useState<VideoEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadVideo = usePlanStore((s) => s.loadVideo);

  useEffect(() => {
    api.listVideos().then(setVideos, (err) => setError(err.message));
  }, []);

  return (
    <div className="mx-auto min-h-screen max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold text-neutral-100">Videos</h1>
      <p className="mt-1 text-sm text-neutral-400">
        Working folders under <code className="text-neutral-300">videos/</code> — pick one to edit
        its plan.
      </p>

      {error && (
        <div className="mt-8 rounded-lg border border-red-900 bg-red-950/40 p-4 text-sm text-red-300">
          {error}
        </div>
      )}
      {videos && videos.length === 0 && (
        <div className="mt-8 rounded-lg border border-neutral-800 p-8 text-center text-neutral-400">
          No video folders yet. Run the pipeline (or drop a folder under{" "}
          <code>videos/&lt;date&gt;/&lt;channel&gt;/&lt;slug&gt;/</code>) and refresh.
        </div>
      )}

      <div className="mt-6 flex flex-col gap-3">
        {videos?.map((video) => (
          <button
            key={video.id}
            disabled={!video.artifacts.plan}
            onClick={() => loadVideo(video.id, video.title)}
            className="group rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-left transition-colors hover:border-neutral-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-neutral-100">{video.title}</span>
              <span className="text-xs text-neutral-500">
                {video.date} · {video.channel}
              </span>
            </div>
            <div className="mt-2 flex gap-1.5">
              {ARTIFACT_LABELS.map(([key, label]) => (
                <span
                  key={key}
                  className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                    video.artifacts[key]
                      ? "bg-emerald-950 text-emerald-400"
                      : "bg-neutral-800 text-neutral-600"
                  }`}
                >
                  {label}
                </span>
              ))}
            </div>
            {!video.artifacts.plan && (
              <p className="mt-2 text-xs text-amber-500">
                No edit_plan.json yet — run plan_edit (or drop one in the folder) first.
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
