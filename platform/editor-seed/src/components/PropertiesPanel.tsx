/**
 * Properties of the selected timeline item. Every commit goes through the
 * pure mutations (one undo step each); visual start/end are shown read-only
 * (cut points move only via the timeline's roll edit / split).
 */

import { useEffect, useState } from "react";
import type { AudioItem, CaptionItem, OverlayItem, VisualItem } from "@engine/player";
import { catalogEntry } from "../catalog";
import * as m from "../plan/mutations";
import { usePlanStore } from "../store/planStore";
import { useUiStore } from "../store/uiStore";
import { playerRef } from "../playerRef";
import { PropsForm } from "./PropsForm";

const INPUT = "w-full rounded bg-neutral-800 px-2 py-1 text-sm outline-none focus:ring-1 focus:ring-neutral-600";
const LABEL = "text-[10px] uppercase tracking-wide text-neutral-500";

function apply(label: string, fn: Parameters<ReturnType<typeof usePlanStore.getState>["applyEdit"]>[1]) {
  usePlanStore.getState().applyEdit(label, fn);
}

export function PropertiesPanel() {
  const selection = useUiStore((s) => s.selection);
  const plan = usePlanStore((s) => s.workingPlan);
  if (!selection || !plan) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-neutral-600">Select an item on the timeline.</p>
      </div>
    );
  }
  const item = plan.tracks[selection.track][selection.index];
  if (!item) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="text-sm text-neutral-600">Selection no longer exists.</p>
      </div>
    );
  }
  const key = `${selection.track}-${selection.index}`;
  return (
    <div className="flex flex-col gap-3 p-3" key={key}>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {selection.track}[{selection.index}]
      </h3>
      {selection.track === "captions" && <CaptionProps index={selection.index} item={item as CaptionItem} />}
      {selection.track === "visual" && <VisualProps index={selection.index} item={item as VisualItem} />}
      {selection.track === "overlays" && <OverlayProps index={selection.index} item={item as OverlayItem} />}
      {selection.track === "audio" && <AudioProps index={selection.index} item={item as AudioItem} />}
    </div>
  );
}

function TimeSpan({
  item,
  readOnly,
  onCommit,
}: {
  item: { start: number; end: number };
  readOnly?: boolean;
  onCommit?: (start: number, end: number) => void;
}) {
  return (
    <div className="flex gap-2">
      {(["start", "end"] as const).map((field) => (
        <label key={`${field}-${item[field]}`} className="flex-1">
          <span className={LABEL}>{field} (s)</span>
          <input
            type="number"
            step={0.1}
            min={0}
            defaultValue={Number(item[field].toFixed(3))}
            disabled={readOnly}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (!Number.isFinite(v) || v === item[field] || !onCommit) return;
              onCommit(field === "start" ? v : item.start, field === "end" ? v : item.end);
            }}
            className={`${INPUT} disabled:opacity-50`}
          />
        </label>
      ))}
    </div>
  );
}

function DeleteButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mt-1 rounded border border-red-950 px-2 py-1 text-xs text-red-400 hover:bg-red-950/40"
    >
      {label}
    </button>
  );
}

function CaptionProps({ index, item }: { index: number; item: CaptionItem }) {
  return (
    <>
      <label>
        <span className={LABEL}>text</span>
        <textarea
          defaultValue={item.text}
          rows={3}
          onBlur={(e) => e.target.value !== item.text && apply("edit caption text", (p) => m.setCaptionText(p, index, e.target.value))}
          className={INPUT}
        />
      </label>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className={LABEL}>in effect</span>
          <select
            value={item.in_effect ?? ""}
            onChange={(e) => apply("caption in effect", (p) => m.setCaptionFields(p, index, { in_effect: (e.target.value || null) as CaptionItem["in_effect"] }))}
            className={INPUT}
          >
            {["", "fade", "pop", "slide_up"].map((v) => <option key={v} value={v}>{v || "none"}</option>)}
          </select>
        </label>
        <label className="flex-1">
          <span className={LABEL}>out effect</span>
          <select
            value={item.out_effect ?? ""}
            onChange={(e) => apply("caption out effect", (p) => m.setCaptionFields(p, index, { out_effect: (e.target.value || null) as CaptionItem["out_effect"] }))}
            className={INPUT}
          >
            {["", "fade", "pop", "slide_down"].map((v) => <option key={v} value={v}>{v || "none"}</option>)}
          </select>
        </label>
      </div>
      <TimeSpan item={item} onCommit={(s, e) => apply("retime caption", (p) => m.retimeItem(p, "captions", index, s, e))} />
      <DeleteButton label="Delete caption" onClick={() => apply("delete caption", (p) => m.deleteItem(p, "captions", index))} />
    </>
  );
}

function VisualProps({ index, item }: { index: number; item: VisualItem }) {
  const setAssetSearchQuery = useUiStore((s) => s.setAssetSearchQuery);
  const playhead = useUiStore((s) => s.playhead);
  return (
    <>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className={LABEL}>mode</span>
          <select
            value={item.mode}
            onChange={(e) => apply("visual mode", (p) => m.setVisualFields(p, index, { mode: e.target.value as VisualItem["mode"] }))}
            className={INPUT}
          >
            {["broll", "avatar", "ai_image"].map((v) => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="flex-1">
          <span className={LABEL}>media type</span>
          <select
            value={item.media_type ?? ""}
            onChange={(e) => apply("visual media type", (p) => m.setVisualFields(p, index, { media_type: (e.target.value || null) as VisualItem["media_type"] }))}
            className={INPUT}
          >
            {["", "video", "image"].map((v) => <option key={v} value={v}>{v || "auto"}</option>)}
          </select>
        </label>
      </div>
      <label>
        <span className={LABEL}>b-roll query / generation prompt</span>
        <textarea
          defaultValue={item.broll_query ?? ""}
          rows={2}
          onBlur={(e) => e.target.value !== (item.broll_query ?? "") && apply("visual query", (p) => m.setVisualQuery(p, index, e.target.value))}
          className={INPUT}
        />
        <span className="text-[10px] text-neutral-600">editing the query clears the chosen asset</span>
      </label>
      <label>
        <span className={LABEL}>motion (stills only)</span>
        <select
          value={item.motion ?? ""}
          onChange={(e) => apply("visual motion", (p) => m.setVisualFields(p, index, { motion: (e.target.value || null) as VisualItem["motion"] }))}
          className={INPUT}
        >
          {["", "ken_burns_slow", "ken_burns_fast", "zoom_in", "zoom_out", "none"].map((v) => (
            <option key={v} value={v}>{v || "null"}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className={LABEL}>transition out</span>
          <select
            value={item.transition_out ?? ""}
            onChange={(e) => apply("transition", (p) => m.setVisualFields(p, index, { transition_out: (e.target.value || null) as VisualItem["transition_out"] }))}
            className={INPUT}
          >
            {["", "cut", "cross_dissolve", "fade_to_black", "wipe"].map((v) => (
              <option key={v} value={v}>{v || "null (cut)"}</option>
            ))}
          </select>
        </label>
        <label className="w-24">
          <span className={LABEL}>duration</span>
          <input
            type="number"
            step={0.1}
            min={0.1}
            max={2}
            defaultValue={item.transition_duration ?? ""}
            placeholder="0.5"
            onBlur={(e) => apply("transition duration", (p) => m.setVisualFields(p, index, { transition_duration: e.target.value === "" ? null : Number(e.target.value) }))}
            className={INPUT}
          />
        </label>
      </div>
      <p className="text-[10px] leading-snug text-neutral-600">
        Transitions consume handles and never move the cut points (v2.1).
      </p>
      <TimeSpan item={item} readOnly />
      <p className="-mt-2 text-[10px] text-neutral-600">
        Cut points move on the timeline (drag the boundary = roll edit).
      </p>
      <div className="text-xs text-neutral-500">
        asset: {item.asset_path ?? "— none —"}
        {item.asset_source ? ` (${item.asset_source})` : ""}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setAssetSearchQuery(item.broll_query ?? "")}
          className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
        >
          Replace media…
        </button>
        <button
          onClick={() => {
            playerRef.current?.pause();
            apply("split visual", (p) => m.splitVisual(p, index, playhead));
          }}
          className="rounded bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
          title="split this item at the playhead (S)"
        >
          Split at playhead
        </button>
      </div>
      <DeleteButton label="Delete (neighbor absorbs the span)" onClick={() => apply("delete visual", (p) => m.deleteVisual(p, index))} />
    </>
  );
}

function OverlayProps({ index, item }: { index: number; item: OverlayItem }) {
  const entry = catalogEntry(item.component);
  return (
    <>
      <div>
        <span className={LABEL}>component</span>
        <p className="text-sm text-neutral-200">{item.component}</p>
        {entry && <p className="text-xs text-neutral-500">{entry.description}</p>}
      </div>
      {entry ? (
        <PropsForm
          schema={entry.props}
          value={item.props}
          onCommit={(props) => apply("overlay props", (p) => m.setOverlayProps(p, index, props))}
        />
      ) : (
        <p className="text-xs text-red-400">
          '{item.component}' is not in components_catalog.json — validation will reject this plan.
        </p>
      )}
      <TimeSpan item={item} onCommit={(s, e) => apply("retime overlay", (p) => m.retimeItem(p, "overlays", index, s, e))} />
      <DeleteButton label="Delete overlay" onClick={() => apply("delete overlay", (p) => m.deleteItem(p, "overlays", index))} />
    </>
  );
}

function AudioProps({ index, item }: { index: number; item: AudioItem }) {
  const isVoiceover = item.role === "voiceover";
  const [volume, setVolume] = useState(item.volume);
  useEffect(() => setVolume(item.volume), [item.volume]);
  return (
    <>
      <div>
        <span className={LABEL}>role</span>
        <p className="text-sm text-neutral-200">
          {item.role}
          {isVoiceover && <span className="ml-2 text-xs text-amber-500">locked — defines duration</span>}
        </p>
        <p className="truncate text-xs text-neutral-500">{item.asset_path}</p>
      </div>
      <label>
        <span className={LABEL}>volume · {Math.round(volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={() => volume !== item.volume && apply("volume", (p) => m.setAudioFields(p, index, { volume }))}
          onKeyUp={() => volume !== item.volume && apply("volume", (p) => m.setAudioFields(p, index, { volume }))}
          className="w-full accent-amber-500"
        />
      </label>
      {!isVoiceover && (
        <>
          <div className="flex gap-2">
            <label className="flex-1">
              <span className={LABEL}>fade in (s)</span>
              <input
                type="number" step={0.1} min={0} defaultValue={item.fade_in ?? ""}
                onBlur={(e) => apply("fade in", (p) => m.setAudioFields(p, index, { fade_in: e.target.value === "" ? null : Number(e.target.value) }))}
                className={INPUT}
              />
            </label>
            <label className="flex-1">
              <span className={LABEL}>fade out (s)</span>
              <input
                type="number" step={0.1} min={0} defaultValue={item.fade_out ?? ""}
                onBlur={(e) => apply("fade out", (p) => m.setAudioFields(p, index, { fade_out: e.target.value === "" ? null : Number(e.target.value) }))}
                className={INPUT}
              />
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={item.loop}
              onChange={(e) => apply("loop", (p) => m.setAudioFields(p, index, { loop: e.target.checked }))}
              className="h-4 w-4 accent-neutral-300"
            />
            <span className="text-sm text-neutral-300">loop to fill the span</span>
          </label>
          <TimeSpan item={item} onCommit={(s, e) => apply("retime audio", (p) => m.retimeItem(p, "audio", index, s, e))} />
          <DeleteButton label="Delete audio item" onClick={() => apply("delete audio", (p) => m.deleteItem(p, "audio", index))} />
        </>
      )}
    </>
  );
}
