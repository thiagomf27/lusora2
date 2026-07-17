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

test("plan without overlays and plain captions routes to ffmpeg", () => {
  const plan: EditPlan = structuredClone(fixture);
  plan.tracks.overlays = [];
  plan.tracks.captions.preset = "plain";
  const r = routePlan(plan);
  assert.equal(r.renderer, "ffmpeg");
  assert.deepEqual(r.reasons, []);
});
