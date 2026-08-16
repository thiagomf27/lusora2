import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PIPELINE,
  bulkProductionProblem,
  listPipelines,
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

test("a cfg naming no pipeline gets the default", () => {
  assert.deepEqual(selectPipeline({}), { name: DEFAULT_PIPELINE, reason: "default" });
});

test("a cfg naming a pipeline gets that one", () => {
  assert.equal(selectPipeline({ pipeline: "shorts" }).name, "shorts");
});

test("batch enqueue refuses test and non-bulk pipelines", () => {
  const base = { name: "p", version: "1.0", stages: [{ name: "validate" }] } as PipelineManifest;
  assert.equal(bulkProductionProblem(base), null);
  assert.match(bulkProductionProblem({ ...base, stability: "test" })!, /one video at a time/);
  assert.match(bulkProductionProblem({ ...base, bulk_production_accepted: false })!, /bulk production/);
});
