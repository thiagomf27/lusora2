import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routePlan } from "../src/router.ts";
import type { EditPlan } from "@lusora/contracts";

const here = dirname(fileURLToPath(import.meta.url));
const fixture: EditPlan = JSON.parse(
  readFileSync(join(here, "../../contracts/fixtures/edit_plan.json"), "utf8")
);

test("fixture plan with components routes to remotion", () => {
  const r = routePlan(fixture);
  assert.equal(r.renderer, "remotion");
  assert.ok(r.reasons.length >= 2);
});

test("plan without overlays, plain captions and normal speed routes to ffmpeg", () => {
  const plan: EditPlan = structuredClone(fixture);
  plan.tracks.overlays = [];
  plan.tracks.captions.preset = "plain";
  plan.tracks.visual.forEach((v) => {
    v.speed = 1;
  });
  const r = routePlan(plan);
  assert.equal(r.renderer, "ffmpeg");
  assert.deepEqual(r.reasons, []);
});

test("a speed != 1 visual item forces the remotion path", () => {
  const plan: EditPlan = structuredClone(fixture);
  plan.tracks.overlays = [];
  plan.tracks.captions.preset = "plain";
  plan.tracks.visual.forEach((v) => {
    v.speed = 1;
  });
  plan.tracks.visual[1].speed = 2.0;
  const r = routePlan(plan);
  assert.equal(r.renderer, "remotion");
  assert.ok(r.reasons.some((reason) => reason.includes("speed")));
});
