/**
 * Asset sidebar: b-roll search through the Python adapters + sqlite cache
 * (thumbnails only — the heavy file is downloaded ONLY when a result is
 * chosen for the selected visual item, via POST /assets/download).
 */

import { useEffect, useState } from "react";
import { api } from "../api";
import { usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";
import type { Candidate } from "../types";

export function AssetSidebar() {
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState<"video" | "image">("video");
  const [results, setResults] = useState<Candidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null); // candidate id being downloaded
  const [error, setError] = useState<string | null>(null);

  const videoId = usePlanStore((s) => s.videoId);
  const selection = useUiStore((s) => s.selection);
  const prefill = useUiStore((s) => s.assetSearchQuery);
  const setAssetSearchQuery = useUiStore((s) => s.setAssetSearchQuery);

  const selectedVisual = selection?.track === "visual" ? selection.index : null;

  const search = async (q: string, type: "video" | "image") => {
    if (!q.trim()) return;
    setError(null);
    setResults(null);
    try {
      const { candidates } = await api.searchAssets(q.trim(), type);
      setResults(candidates);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // "replace media" on a visual item pre-fills and runs the search
  useEffect(() => {
    if (prefill === null) return;
    setQuery(prefill);
    void search(prefill, mediaType);
    setAssetSearchQuery(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const use = async (candidate: Candidate) => {
    if (videoId === null || selectedVisual === null) return;
    setBusy(candidate.id);
    setError(null);
    try {
      const payload = await api.downloadAsset(videoId, candidate, selectedVisual);
      usePlanStore.getState().adoptServerPlan(payload.plan, payload.plan_version_hash);
      await usePlanStore.getState().refreshManifest();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <aside className="flex w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-925">
      <div className="border-b border-neutral-800 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void search(query, mediaType);
          }}
          className="flex flex-col gap-2"
        >
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search b-roll…"
            className="w-full rounded bg-neutral-800 px-2.5 py-1.5 text-sm outline-none placeholder:text-neutral-500 focus:ring-1 focus:ring-neutral-600"
          />
          <div className="flex gap-1">
            {(["video", "image"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setMediaType(type)}
                className={`rounded px-2 py-0.5 text-xs ${
                  mediaType === type
                    ? "bg-neutral-200 text-neutral-900"
                    : "bg-neutral-800 text-neutral-400 hover:bg-neutral-700"
                }`}
              >
                {type}
              </button>
            ))}
            <button
              type="submit"
              className="ml-auto rounded bg-neutral-700 px-2.5 py-0.5 text-xs hover:bg-neutral-600"
            >
              Search
            </button>
          </div>
        </form>
        {selectedVisual === null && results && results.length > 0 && (
          <p className="mt-2 text-[11px] leading-snug text-neutral-500">
            Select a visual item on the timeline to use a result.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error && (
          <div className="mb-2 whitespace-pre-wrap rounded border border-red-900 bg-red-950/40 p-2 text-xs text-red-300">
            {error}
          </div>
        )}
        {results === null && !error && (
          <p className="mt-8 text-center text-xs text-neutral-600">
            Search stock footage and images.
            <br />
            Results come from the pipeline's providers (cache-first).
          </p>
        )}
        {results?.length === 0 && (
          <p className="mt-8 text-center text-xs text-neutral-600">No results for that query.</p>
        )}
        <div className="grid grid-cols-2 gap-2">
          {results?.map((candidate) => (
            <button
              key={`${candidate.source}-${candidate.id}`}
              disabled={selectedVisual === null || busy !== null}
              onClick={() => void use(candidate)}
              title={
                selectedVisual === null
                  ? "select a visual item first"
                  : `use for visual[${selectedVisual}]`
              }
              className="group relative overflow-hidden rounded border border-neutral-800 bg-neutral-900 disabled:cursor-not-allowed"
            >
              <img
                src={candidate.thumbnail_url}
                alt=""
                loading="lazy"
                className="aspect-video w-full object-cover transition-opacity group-hover:opacity-75"
              />
              <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1 text-[10px] text-neutral-300">
                {candidate.source}
                {candidate.duration ? ` · ${Math.round(candidate.duration)}s` : ""}
              </span>
              {busy === candidate.id && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/60 text-xs">
                  downloading…
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </aside>
  );
}
