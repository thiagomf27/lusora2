/**
 * Frame math for the Remotion base track (ported from video-engine's
 * timeline.test.ts, adapted to edit_plan v1.0): narrative cut points never
 * move, transitions consume handles as extensions on the OUTGOING item, and
 * the freeze-frame threshold accounts for the probed source duration, the
 * item's in_offset_s trim, and its playback speed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { VisualItem } from "@lusora/contracts";
import { buildVisualTimeline, type VisualAsset } from "../src/renderers/remotion/timeline.ts";

function item(partial: Partial<VisualItem> & { start_s: number; end_s: number }): VisualItem {
  return {
    id: "x",
    media_type: "video",
    asset: { source: "manual", path: "clips/x.mp4" },
    ...partial,
  } as VisualItem;
}

const video = (durationInSeconds: number): VisualAsset => ({
  kind: "video",
  src: "clips/v.mp4",
  durationInSeconds,
});
const image = (): VisualAsset => ({ kind: "image", src: "clips/i.png", durationInSeconds: null });

test("maps narrative spans to frames without rounding drift", () => {
  const items = [
    item({ start_s: 0, end_s: 4.8, transition_out: { type: "crossfade" } }),
    item({ start_s: 4.8, end_s: 9.5 }),
  ];
  const [a, b] = buildVisualTimeline(items, [video(6), image()], 30);
  assert.equal(a!.narrativeFrames, 144);
  assert.equal(b!.narrativeFrames, 141);
  assert.equal(a!.narrativeFrames + b!.narrativeFrames, Math.round(9.5 * 30));
});

test("gives a transition its default 0.5s and extends only the outgoing item", () => {
  const items = [
    item({ start_s: 0, end_s: 4.8, transition_out: { type: "crossfade" } }),
    item({ start_s: 4.8, end_s: 9.5 }),
  ];
  const [a, b] = buildVisualTimeline(items, [video(6), image()], 30);
  assert.deepEqual(a!.transitionOut, { kind: "crossfade", durationInFrames: 15 });
  assert.equal(a!.extensionFrames, 15);
  assert.equal(b!.extensionFrames, 0);
});

test("honors an explicit transition duration_s", () => {
  const items = [
    item({ start_s: 0, end_s: 4, transition_out: { type: "fade_to_black", duration_s: 1.0 } }),
    item({ start_s: 4, end_s: 8 }),
  ];
  assert.deepEqual(buildVisualTimeline(items, [image(), image()], 30)[0]!.transitionOut, {
    kind: "fade_to_black",
    durationInFrames: 30,
  });
});

test("treats cut and null as plain cuts, and ignores transition_out on the last item", () => {
  const items = [
    item({ start_s: 0, end_s: 2, transition_out: { type: "cut" } }),
    item({ start_s: 2, end_s: 4 }),
    item({ start_s: 4, end_s: 6, transition_out: { type: "crossfade" } }), // last: nothing follows
  ];
  const layouts = buildVisualTimeline(items, [image(), image(), image()], 30);
  assert.deepEqual(layouts.map((l) => l.transitionOut), [null, null, null]);
  assert.deepEqual(layouts.map((l) => l.extensionFrames), [0, 0, 0]);
});

test("clamps a transition to fit both neighbors' narrative spans", () => {
  const items = [
    item({ start_s: 0, end_s: 8, transition_out: { type: "crossfade", duration_s: 2.0 } }),
    item({ start_s: 8, end_s: 8.6 }), // 18 frames @30 — can't host a 60-frame dissolve
  ];
  const [a] = buildVisualTimeline(items, [image(), image()], 30);
  assert.equal(a!.transitionOut!.durationInFrames, 17);
});

test("degrades to a cut when there is no room for even one overlap frame", () => {
  const items = [
    item({ start_s: 0, end_s: 5, transition_out: { type: "crossfade" } }),
    item({ start_s: 5, end_s: 5.034 }), // ~1 frame @30fps
  ];
  const [a] = buildVisualTimeline(items, [image(), image()], 30);
  assert.equal(a!.transitionOut, null);
  assert.equal(a!.extensionFrames, 0);
});

test("computes the freeze-frame threshold from the probed video duration", () => {
  const items = [
    item({ start_s: 0, end_s: 4.8, transition_out: { type: "crossfade" } }),
    item({ start_s: 4.8, end_s: 9.5 }),
  ];
  // source exactly as long as the narrative span: 144 playable comp frames,
  // but narrative + extension = 159 > 144, so the freeze covers the extension
  const [a] = buildVisualTimeline(items, [video(4.8), image()], 30);
  assert.equal(a!.availableFrames, 144);
  assert.equal(a!.extensionFrames, 15);
});

test("reports no freeze threshold for images (infinite handles)", () => {
  const items = [item({ start_s: 0, end_s: 3 }), item({ start_s: 3, end_s: 6 })];
  const layouts = buildVisualTimeline(items, [image(), video(10)], 30);
  assert.equal(layouts[0]!.availableFrames, null);
  assert.equal(layouts[1]!.availableFrames, 300);
});

test("speed shrinks availableFrames so freeze kicks in sooner", () => {
  const base = { start_s: 0, end_s: 4.8, transition_out: { type: "crossfade" as const } };
  const next = { start_s: 4.8, end_s: 9.5 };
  // narrative 144 + extension 15 = 159 comp frames needed from a 6s (180-frame) source
  const at1x = buildVisualTimeline([item({ ...base, speed: 1 }), item(next)], [video(6), image()], 30);
  assert.equal(at1x[0]!.availableFrames, 180); // 180 >= 159 -> no freeze
  const at2x = buildVisualTimeline([item({ ...base, speed: 2 }), item(next)], [video(6), image()], 30);
  assert.equal(at2x[0]!.availableFrames, 90); // floor(6*30/2) = 90 < 159 -> freeze
});

test("in_offset_s reduces the playable source before speed is applied", () => {
  const items = [
    item({ start_s: 0, end_s: 4, in_offset_s: 2, speed: 1, transition_out: { type: "cut" } }),
    item({ start_s: 4, end_s: 8 }),
  ];
  // (6 - 2) * 30 / 1 = 120 comp frames playable from the trim start
  const [a] = buildVisualTimeline(items, [video(6), image()], 30);
  assert.equal(a!.availableFrames, 120);
});

test("rejects items shorter than one frame with an actionable error", () => {
  const items = [item({ start_s: 0, end_s: 0.01 }), item({ start_s: 0.01, end_s: 5 })];
  assert.throws(
    () => buildVisualTimeline(items, [image(), image()], 30),
    /visual\[0\].*shorter than one frame at 30 fps/,
  );
});
