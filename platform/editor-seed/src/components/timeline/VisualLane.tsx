/**
 * Visual lane: the contiguous base track. The ONLY legal drag is the shared
 * boundary between neighbors — a roll edit (one item shrinks, the other
 * grows, both clamped to >= 0.5s). Items cannot be moved along the timeline,
 * cannot overlap, cannot leave gaps — by construction. Blocks carry
 * filmstrip thumbnails from the API.
 */

import { useEffect, useState } from "react";
import { api, fileUrl } from "../../api";
import { usePlanStore } from "../../store/planStore";
import { useUiStore } from "../../store/uiStore";
import { moveCutPoint } from "../../plan/mutations";
import { snapTime, startPlanDrag } from "./drag";
import { LANE_HEIGHTS } from "./Timeline";

const MODE_COLORS: Record<string, string> = {
  broll: "border-emerald-900 bg-emerald-950/60",
  ai_image: "border-teal-900 bg-teal-950/60",
  avatar: "border-orange-900 bg-orange-950/60",
};

export function VisualLane() {
  const visual = usePlanStore((s) => s.workingPlan?.tracks.visual ?? []);
  const pps = useUiStore((s) => s.pixelsPerSecond);
  const selection = useUiStore((s) => s.selection);
  const select = useUiStore((s) => s.select);

  const dragCut = (event: React.PointerEvent, index: number) => {
    const cut = visual[index]!.end;
    startPlanDrag(event, {
      label: "roll edit",
      update: (plan, delta) => {
        // snap to caption boundaries but never to the cut's own neighbors
        const snapped = snapTime(plan, cut + delta, pps);
        return moveCutPoint(plan, index, snapped);
      },
    });
  };

  return (
    <div style={{ height: LANE_HEIGHTS.visual }} className="relative border-b border-neutral-900">
      {visual.map((item, i) => {
        const selected = selection?.track === "visual" && selection.index === i;
        const width = Math.max((item.end - item.start) * pps, 4);
        return (
          <div
            key={i}
            onClick={() => select({ track: "visual", index: i })}
            style={{ left: item.start * pps, width }}
            className={`absolute bottom-1 top-1 cursor-pointer overflow-hidden rounded-sm border ${
              selected ? "z-10 border-emerald-400" : MODE_COLORS[item.mode] ?? "border-neutral-800 bg-neutral-900"
            }`}
            title={`${item.mode} · ${item.broll_query ?? item.asset_path ?? ""}`}
          >
            <Filmstrip assetPath={item.asset_path} width={width} />
            <span className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-1 text-[9px] leading-4 text-neutral-300">
              {item.broll_query ?? item.asset_path ?? item.mode}
            </span>
            {item.transition_out && item.transition_out !== "cut" && (
              <span
                className="absolute right-0 top-0 rounded-bl bg-indigo-500/80 px-1 text-[8px] leading-3 text-white"
                title={`${item.transition_out} (${item.transition_duration ?? 0.5}s, consumes handles)`}
              >
                ⤞
              </span>
            )}
          </div>
        );
      })}
      {/* roll-edit handles on the shared boundaries (never the outer edges) */}
      {visual.slice(0, -1).map((item, i) => (
        <div
          key={`cut-${i}`}
          onPointerDown={(event) => dragCut(event, i)}
          style={{ left: item.end * pps - 4, width: 8 }}
          className="absolute bottom-0 top-0 z-20 cursor-col-resize"
          title="roll edit: move this cut (neighbors trade duration)"
        >
          <div className="mx-auto h-full w-0.5 bg-emerald-500/0 transition-colors hover:bg-emerald-400" />
        </div>
      ))}
    </div>
  );
}

function Filmstrip({ assetPath, width }: { assetPath: string | null; width: number }) {
  const videoId = usePlanStore((s) => s.videoId);
  const [urls, setUrls] = useState<string[]>([]);
  const count = Math.max(1, Math.min(10, Math.round(width / 56)));

  useEffect(() => {
    if (!videoId || !assetPath) return;
    let cancelled = false;
    api
      .getThumbs(videoId, assetPath, count)
      .then(({ urls }) => {
        if (!cancelled) setUrls(urls);
      })
      .catch(() => setUrls([]));
    return () => {
      cancelled = true;
    };
  }, [videoId, assetPath, count]);

  if (!videoId || !assetPath || urls.length === 0) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-neutral-900/40 text-[9px] text-neutral-500">
        {assetPath ? "" : "no asset — search b-roll"}
      </div>
    );
  }
  return (
    <div className="pointer-events-none flex h-full w-full overflow-hidden">
      {urls.map((url) => (
        <img
          key={url}
          src={fileUrl(videoId, url)}
          alt=""
          draggable={false}
          className="h-full min-w-0 flex-1 object-cover"
        />
      ))}
    </div>
  );
}
