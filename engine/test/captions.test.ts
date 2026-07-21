/**
 * Caption in/out effect math (captionEffects.ts) — pure poses (opacity /
 * offset / scale), unit-testable. Ported from video-engine's captions.test.ts,
 * adapted to edit_plan v1.0 (in_effect / out_effect).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { captionPose } from "../src/renderers/remotion/captionEffects.ts";

const fps = 30; // effect window = round(0.25 * 30) = 8 frames

test("sits at rest with no effects", () => {
  const pose = captionPose({}, 30, 120, fps);
  assert.deepEqual(pose, { opacity: 1, offsetYFraction: 0, scale: 1 });
});

test("fade in ramps opacity 0 -> 1 over the window, then rests", () => {
  const item = { in_effect: "fade" as const };
  assert.equal(captionPose(item, 0, 120, fps).opacity, 0);
  assert.ok(captionPose(item, 4, 120, fps).opacity > 0.4);
  assert.equal(captionPose(item, 8, 120, fps).opacity, 1);
  assert.equal(captionPose(item, 40, 120, fps).opacity, 1); // at rest
});

test("fade out ramps opacity 1 -> 0 near the end", () => {
  const item = { out_effect: "fade" as const };
  const dur = 120;
  assert.equal(captionPose(item, dur - 8, dur, fps).opacity, 1);
  assert.ok(captionPose(item, dur - 1, dur, fps).opacity < 0.2);
});

test("slide_up starts below rest and rises into place", () => {
  const item = { in_effect: "slide_up" as const };
  assert.ok(captionPose(item, 0, 120, fps).offsetYFraction > 0);
  assert.equal(captionPose(item, 8, 120, fps).offsetYFraction, 0);
});

test("pop overshoots scale above 1 during entry", () => {
  const item = { in_effect: "pop" as const };
  const scales = [1, 2, 3, 4, 5, 6, 7].map((f) => captionPose(item, f, 120, fps).scale);
  assert.ok(Math.max(...scales) > 1); // ease-out-back overshoot
});

test("collapses to rest when the item is too short to host effects", () => {
  const pose = captionPose({ in_effect: "fade" }, 0, 1, fps);
  assert.deepEqual(pose, { opacity: 1, offsetYFraction: 0, scale: 1 });
});
