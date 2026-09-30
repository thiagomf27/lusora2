import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { routePlan } from "../src/router.ts";
import type { EditPlan, Theme } from "@lusora/contracts";

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

test("the slice-2 transitions stay on ffmpeg, except whip", () => {
  const base: EditPlan = structuredClone(fixture);
  base.tracks.overlays = [];
  base.tracks.captions.preset = "plain";
  base.tracks.visual.forEach((v) => {
    v.speed = 1;
  });
  for (const type of ["push", "wipe", "flash", "zoom_through"] as const) {
    const plan = structuredClone(base);
    plan.tracks.visual[0].transition_out = { type, duration_s: 0.5 };
    assert.equal(routePlan(plan).renderer, "ffmpeg", type);
  }
  const whip = structuredClone(base);
  whip.tracks.visual[0].transition_out = { type: "whip", duration_s: 0.3, direction: "right" };
  const r = routePlan(whip);
  assert.equal(r.renderer, "remotion");
  assert.ok(r.reasons.some((reason) => reason.includes("transition whip")));
});

test("D112 texture routes to remotion: a leak, a grade, a CRT set, a theme's dust or tape", () => {
  const base: EditPlan = structuredClone(fixture);
  base.tracks.overlays = [];
  base.tracks.captions.preset = "plain";
  base.tracks.visual.forEach((v) => {
    v.speed = 1;
  });
  assert.equal(routePlan(base).renderer, "ffmpeg");

  const leak = structuredClone(base);
  leak.tracks.visual[0].transition_out = { type: "light_leak", duration_s: 0.8, placed_by: "texture" };
  assert.ok(routePlan(leak).reasons.some((r) => r.includes("transition light_leak")));

  const aged = structuredClone(base);
  aged.tracks.visual[0].grade = "vintage";
  aged.tracks.visual[1].crt = true;
  const reasons = routePlan(aged).reasons;
  assert.ok(reasons.some((r) => r.includes("vintage grade")) && reasons.some((r) => r.includes("CRT")));

  const theme: Theme = { name: "t", colors: { bg: "#000", text: "#fff", accent: "#f00", neutral: "#888" },
    typography: { display: "Inter", body: "Inter", caption_preset: "plain" } };
  assert.equal(routePlan(base, { ...theme, texture: { vintage: "sepia" } }).renderer, "ffmpeg",
    "a vintage LOOK draws nothing until the compiler marks a shot");
  assert.equal(routePlan(base, { ...theme, texture: { dust: "light" } }).renderer, "remotion");
  assert.equal(routePlan(base, { ...theme, texture: { tape: "vhs" } }).renderer, "remotion");

  // focus_y is a crop offset both renderers draw
  const framed = structuredClone(base);
  framed.tracks.visual[0].focus_y = 0.22;
  assert.equal(routePlan(framed).renderer, "ffmpeg");
});
