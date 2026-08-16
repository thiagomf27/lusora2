import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PIPELINE,
  bulkProductionProblem,
  listPipelineSummaries,
  listPipelines,
  receivableArtifacts,
  loadPipeline,
  selectPipeline,
} from "../src/lib/pipelines.ts";
import type { PipelineManifest } from "@lusora/contracts";

/**
 * Selection is the platform's whole share of D60: pick a manifest at enqueue,
 * embed it, and let the worker walk it. These tests pin the picking rules and
 * the fact that a shipped manifest actually parses and validates.
 */

test("the shipped faceless manifest loads and validates", () => {
  const res = loadPipeline("faceless");
  assert.ok(res.ok, res.ok ? "" : res.problem);
  const manifest = res.manifest;
  assert.equal(manifest.name, "faceless");
  assert.equal(manifest.stages[0].name, "script");
  assert.equal(manifest.stages.at(-1)!.name, "finalize");
  // bootstrap is a precondition, never a stage
  assert.ok(!manifest.stages.some((s) => s.name === "claim"));
});

test("every manifest in contracts/pipelines is valid", () => {
  const names = listPipelines();
  assert.ok(names.includes(DEFAULT_PIPELINE));
  for (const name of names) {
    const res = loadPipeline(name);
    assert.ok(res.ok, res.ok ? "" : res.problem);
  }
});

test("a missing pipeline reports the ones that exist", () => {
  const res = loadPipeline("nope");
  assert.equal(res.ok, false);
  assert.match((res as { problem: string }).problem, /faceless/);
});

test("a cfg naming no pipeline and no style gets the default", () => {
  assert.deepEqual(selectPipeline({}), { ok: true, name: DEFAULT_PIPELINE, reason: "default" });
});

test("a cfg naming a pipeline gets that one", () => {
  const sel = selectPipeline({ pipeline: "shorts" });
  assert.ok(sel.ok);
  assert.equal(sel.name, "shorts");
});

/* ---- D61: production style resolves to a manifest by category ---- */

test("a production style resolves to the shipped manifest of that category", () => {
  const sel = selectPipeline({ production_style: "faceless" });
  assert.ok(sel.ok, sel.ok ? "" : sel.problem);
  assert.equal(sel.name, "faceless");
  assert.match(sel.reason, /production style 'faceless'/);
});

test("a pinned pipeline overrides the production style", () => {
  // The escape hatch: this is how a `stability: test` variant of a style runs
  // without changing what the style itself means.
  const sel = selectPipeline({ pipeline: "faceless_v2", production_style: "faceless" });
  assert.ok(sel.ok);
  assert.equal(sel.name, "faceless_v2");
  assert.equal(sel.reason, "named in the config");
});

test("a style with no manifest is refused, not silently defaulted", () => {
  // The whole point: a talking-head channel must never quietly make a faceless
  // video because the manifest is missing.
  const sel = selectPipeline({ production_style: "talking_head" });
  assert.equal(sel.ok, false);
  assert.match((sel as { problem: string }).problem, /talking_head/);
});

test("custom demands an explicit pipeline", () => {
  const sel = selectPipeline({ production_style: "custom" });
  assert.equal(sel.ok, false);
  assert.match((sel as { problem: string }).problem, /named explicitly/);
});

test("summaries carry what a picker and the resolver need", () => {
  const faceless = listPipelineSummaries().find((p) => p.name === "faceless");
  assert.ok(faceless);
  assert.equal(faceless.category, "faceless");
  assert.equal(faceless.stability, "production");
  assert.equal(faceless.bulk_production_accepted, true);
  assert.ok(faceless.stage_count > 0);
  assert.equal(faceless.problem, undefined);
});

test("every shipped manifest declares a category, so a style can find it", () => {
  for (const p of listPipelineSummaries()) {
    assert.ok(!p.problem, p.problem);
    assert.ok(p.category, `pipeline '${p.name}' declares no category — no production style can select it`);
  }
});

test("batch enqueue refuses test and non-bulk pipelines", () => {
  const base = { name: "p", version: "1.0", stages: [{ name: "validate" }] } as PipelineManifest;
  assert.equal(bulkProductionProblem(base), null);
  assert.match(bulkProductionProblem({ ...base, stability: "test" })!, /one video at a time/);
  assert.match(bulkProductionProblem({ ...base, bulk_production_accepted: false })!, /bulk production/);
});


/* ---- D62: the upload allow-list is derived, not hardcoded ---- */

test("a pipeline's receivable artifacts come from its own stages", () => {
  const res = loadPipeline("faceless_v2");
  assert.ok(res.ok, res.ok ? "" : res.problem);
  const allowed = receivableArtifacts(res.manifest);
  // declared receivable
  assert.ok(allowed.has("script.txt"));
  assert.ok(allowed.has("beats.json"));
  assert.ok(allowed.has("research.md"));
  // a bootstrap input no stage produces is still uploadable
  assert.ok(allowed.has("avatar.mp4"));
  // outputs of stages that judge or render are not something to hand in
  assert.ok(!allowed.has("final.mp4"));
  assert.ok(!allowed.has("thumb.jpg"));
});

test("a stage not marked receivable is refused even though it produces", () => {
  const manifest = {
    name: "strict",
    version: "1.0",
    stages: [
      { name: "research", produces: ["research.md"] },
      { name: "script", produces: ["script.txt"], receivable_on_upload: true },
    ],
  } as PipelineManifest;
  const allowed = receivableArtifacts(manifest);
  assert.ok(allowed.has("script.txt"));
  assert.ok(!allowed.has("research.md"), "a pipeline whose research must be generated should refuse one");
});

test("faceless v1 still accepts everything the old constant did", () => {
  // The hardcoded UPLOADABLE list this replaced: script, audio, avatar,
  // subtitles, beats, plan. Losing one would silently break manual-first.
  const res = loadPipeline("faceless");
  assert.ok(res.ok, res.ok ? "" : res.problem);
  const allowed = receivableArtifacts(res.manifest);
  for (const f of ["script.txt", "audio.mp3", "avatar.mp4", "subtitles.srt", "beats.json", "edit_plan.json"]) {
    assert.ok(allowed.has(f), `${f} is no longer uploadable`);
  }
});

test("faceless_v2 is a test pipeline, so bulk enqueue refuses it", () => {
  const res = loadPipeline("faceless_v2");
  assert.ok(res.ok, res.ok ? "" : res.problem);
  assert.match(bulkProductionProblem(res.manifest)!, /one video at a time/);
  // ...and it must not steal the production style from the shipped faceless
  const sel = selectPipeline({ production_style: "faceless" });
  assert.ok(sel.ok);
  assert.equal(sel.name, "faceless");
});
