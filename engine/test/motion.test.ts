/**
 * Ken Burns / zoom transform math (motion.ts) — deterministic, unit-testable.
 * Ported/adapted from video-engine's motion.test.ts for the v1.0 motion
 * object (type / direction / pan / strength).
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Motion } from "@lusora/contracts";
import { motionTransform } from "../src/renderers/remotion/motion.ts";

test("null / none motion is a no-op transform", () => {
  assert.equal(motionTransform(null, 0, 100), "none");
  assert.equal(motionTransform({ type: "none" }, 50, 100), "none");
});

test("ken_burns 'in' zooms up from 1.0 over the full stretch", () => {
  const motion: Motion = { type: "ken_burns", direction: "in", pan: "center", strength: 0.2 };
  const start = motionTransform(motion, 0, 101);
  const end = motionTransform(motion, 100, 101);
  assert.match(start, /^scale\(1\)/); // progress 0 -> zoom 1.0
  assert.match(end, /^scale\(1\.2\)/); // progress 1 -> zoom 1 + strength
});

test("ken_burns 'out' zooms down toward 1.0", () => {
  const motion: Motion = { type: "ken_burns", direction: "out", pan: "center", strength: 0.2 };
  assert.match(motionTransform(motion, 0, 101), /^scale\(1\.2\)/);
  assert.match(motionTransform(motion, 100, 101), /^scale\(1\)/);
});

test("pan direction moves the translate term the expected way", () => {
  const strength = 0.2;
  const at = (pan: NonNullable<Motion["pan"]>) =>
    motionTransform({ type: "ken_burns", direction: "in", pan, strength }, 100, 101);
  // shift = strength * 50 * progress = 10px at progress 1
  assert.match(at("left"), /translate\(10px, 0px\)/); // px unit [1,0]
  assert.match(at("right"), /translate\(-10px, 0px\)/); // [-1,0]
  assert.match(at("up"), /translate\(0px, 10px\)/); // [0,1]
  assert.match(at("center"), /translate\(0px, 0px\)/);
});

test("progress is clamped and safe for a single-frame stretch", () => {
  const motion: Motion = { type: "ken_burns", direction: "in", pan: "center", strength: 0.2 };
  assert.equal(motionTransform(motion, 0, 1), "scale(1) translate(0px, 0px)");
});
