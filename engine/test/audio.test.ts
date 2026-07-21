/**
 * Music/sfx fade-ramp math (audioVolume.ts) — pure, unit-testable. Ported
 * from video-engine's audio.test.ts, adapted to edit_plan v1.0 field names
 * (volume / fade_in_s / fade_out_s).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { audioVolumeAt } from "../src/renderers/remotion/audioVolume.ts";

const fps = 30;

test("holds the base volume with no fades", () => {
  assert.equal(audioVolumeAt({ volume: 0.5 }, 45, 300, fps), 0.5);
});

test("ramps in linearly over fade_in_s", () => {
  const item = { volume: 1, fade_in_s: 1 }; // 30 frames
  assert.equal(audioVolumeAt(item, 0, 300, fps), 0);
  assert.equal(audioVolumeAt(item, 15, 300, fps), 0.5);
  assert.equal(audioVolumeAt(item, 30, 300, fps), 1);
  assert.equal(audioVolumeAt(item, 60, 300, fps), 1); // past the ramp
});

test("ramps out linearly over fade_out_s relative to the item end", () => {
  const item = { volume: 1, fade_out_s: 1 }; // 30 frames
  const dur = 300;
  assert.equal(audioVolumeAt(item, dur, dur, fps), 0);
  assert.equal(audioVolumeAt(item, dur - 15, dur, fps), 0.5);
  assert.equal(audioVolumeAt(item, dur - 30, dur, fps), 1);
});

test("overlapping in/out fades multiply and clamp to [0,1]", () => {
  const item = { volume: 1, fade_in_s: 1, fade_out_s: 1 };
  const dur = 40; // fades overlap in a short item
  const v = audioVolumeAt(item, 20, dur, fps);
  assert.ok(v >= 0 && v <= 1);
});

test("defaults the volume when the item omits it", () => {
  assert.equal(audioVolumeAt({}, 100, 300, fps, 0.12), 0.12);
});
