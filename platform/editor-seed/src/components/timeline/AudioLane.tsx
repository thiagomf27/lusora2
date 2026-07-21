/**
 * Audio lane: the locked voiceover (defines total duration) with its
 * waveform; music/sfx items move/resize freely. The + button lists the
 * audio library (video folder + repo library via the API).
 */

import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";
import { addAudio, retimeItem } from "../../plan/mutations";
import { Edge } from "./CaptionsLane";
import { snapTime, startPlanDrag } from "./drag";
import { LANE_HEIGHTS } from "./Timeline";

export function AudioLane() {
  const audio = usePlanStore((s) => s.workingPlan?.tracks.audio ?? []);
  const pps = useUiStore((s) => s.pixelsPerSecond);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);
  const [pickerOpen, setPickerOpen] = useState(false);

  const half = (LANE_HEIGHTS.audio - 8) / 2;

  const dragBody = (event: React.PointerEvent, index: number) => {
    select({ track: "audio", index });
    const item = audio[index]!;
    if (item.role === "voiceover") return; // locked
    startPlanDrag(event, {
      label: "move audio",
      update: (plan, delta) => {
        const start = snapTime(plan, item.start + delta, pps);
        return retimeItem(plan, "audio", index, start, start + (item.end - item.start));
      },
    });
  };

  const dragEdge = (event: React.PointerEvent, index: number, edge: "start" | "end") => {
    select({ track: "audio", index });
    const item = audio[index]!;
    if (item.role === "voiceover") return;
    startPlanDrag(event, {
      label: "resize audio",
      update: (plan, delta) =>
        edge === "start"
          ? retimeItem(plan, "audio", index, snapTime(plan, item.start + delta, pps), item.end)
          : retimeItem(plan, "audio", index, item.start, snapTime(plan, item.end + delta, pps)),
    });
  };

  return (
    <div style={{ height: LANE_HEIGHTS.audio }} className="relative border-b border-neutral-900">
      {audio.map((item, i) => {
        const selected = selection?.track === "audio" && selection.index === i;
        const isVoiceover = item.role === "voiceover";
        return (
          <div
            key={i}
            onPointerDown={(e) => dragBody(e, i)}
            style={{
              left: item.start * pps,
              width: Math.max((item.end - item.start) * pps, 4),
              top: isVoiceover ? 4 : 4 + half,
              height: half,
            }}
            className={`group absolute overflow-hidden rounded-sm border ${
              isVoiceover ? "cursor-pointer" : "cursor-grab"
            } ${
              selected
                ? "z-10 border-amber-400 bg-amber-950/70"
                : isVoiceover
                  ? "border-amber-900 bg-amber-950/50"
                  : "border-violet-900 bg-violet-950/60 hover:border-violet-700"
            }`}
            title={`${item.role} · ${item.asset_path}${isVoiceover ? " (locked — defines duration)" : ""}`}
          >
            {isVoiceover ? (
              <VoiceoverWave />
            ) : (
              <>
                <span className="pointer-events-none block truncate px-1 text-[9px] leading-4 text-violet-300/90">
                  {item.role} · {item.asset_path.split("/").pop()} · {Math.round(item.volume * 100)}%
                  {item.fade_in ? ` · in ${item.fade_in}s` : ""}
                  {item.fade_out ? ` · out ${item.fade_out}s` : ""}
                </span>
                <Edge side="left" onPointerDown={(e) => dragEdge(e, i, "start")} />
                <Edge side="right" onPointerDown={(e) => dragEdge(e, i, "end")} />
              </>
            )}
          </div>
        );
      })}
      <button
        onClick={() => setPickerOpen(true)}
        title="add music/sfx from the audio library"
        className="absolute right-1 top-1 z-10 rounded bg-neutral-800 px-1.5 text-[10px] leading-4 text-neutral-400 hover:bg-neutral-700 hover:text-neutral-200"
      >
        +
      </button>
      {pickerOpen && <LibraryPicker onClose={() => setPickerOpen(false)} />}
    </div>
  );
}

function LibraryPicker({ onClose }: { onClose: () => void }) {
  const videoId = usePlanStore((s) => s.videoId);
  const [files, setFiles] = useState<{ name: string; path: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!videoId) return;
    api.listLibrary(videoId).then(({ files }) => setFiles(files), (err) => setError(err.message));
  }, [videoId]);

  const add = (path: string) => {
    usePlanStore.getState().applyEdit("add music", (plan) =>
      addAudio(plan, {
        role: "music",
        asset_path: path,
        start: 0,
        end: plan.tracks.audio.find((a) => a.role === "voiceover")?.end ?? 10,
        volume: 0.15,
        loop: true,
        fade_in: 1.0,
        fade_out: 2.0,
      }),
    );
    onClose();
  };

  return (
    <div className="absolute bottom-full right-1 z-30 mb-1 w-72 rounded-lg border border-neutral-700 bg-neutral-900 p-2 shadow-xl">
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-xs font-medium text-neutral-300">Audio library</span>
        <button onClick={onClose} className="text-neutral-500 hover:text-neutral-300">✕</button>
      </div>
      {error && <p className="p-2 text-xs text-red-400">{error}</p>}
      {files?.length === 0 && (
        <p className="p-2 text-xs text-neutral-500">
          Library is empty — drop mp3s into assets/audio_library/ (automation repo).
        </p>
      )}
      {files?.map((file) => (
        <button
          key={file.path}
          onClick={() => add(file.path)}
          className="block w-full rounded px-2 py-1 text-left text-xs text-neutral-300 hover:bg-neutral-800"
        >
          {file.name}
        </button>
      ))}
    </div>
  );
}

function VoiceoverWave() {
  const videoId = usePlanStore((s) => s.videoId);
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    if (!videoId) return;
    api.getWaveform(videoId, "audio.mp3", 1000).then(
      (waveform) => setPeaks(waveform.peaks),
      () => setPeaks(null),
    );
  }, [videoId]);

  const path = useMemo(() => {
    if (!peaks || peaks.length === 0) return "";
    const w = 1000;
    const parts = peaks.map((p, i) => {
      const x = (i / (peaks.length - 1)) * w;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${(50 - p * 46).toFixed(1)}`;
    });
    const back = [...peaks]
      .reverse()
      .map((p, i) => {
        const x = ((peaks.length - 1 - i) / (peaks.length - 1)) * w;
        return `L${x.toFixed(1)},${(50 + p * 46).toFixed(1)}`;
      });
    return `${parts.join("")}${back.join("")}Z`;
  }, [peaks]);

  if (!path) {
    return (
      <span className="block truncate px-1 text-[9px] leading-4 text-amber-300/80">voiceover</span>
    );
  }
  return (
    <svg viewBox="0 0 1000 100" preserveAspectRatio="none" className="pointer-events-none h-full w-full">
      <path d={path} fill="rgb(217 119 6 / 0.55)" />
    </svg>
  );
}
