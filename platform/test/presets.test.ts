import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/lib/env.ts";
import { applyPreset, deepMerge, forbiddenPresetKeys, listPresets } from "../src/lib/presets.ts";
import { validateAgainst } from "../src/lib/validate.ts";

const fixture = () =>
  JSON.parse(readFileSync(join(repoRoot(), "contracts", "fixtures", "channel_config.json"), "utf8"));

test("every preset merged onto the fixture is a valid channel config", () => {
  const presets = listPresets(repoRoot());
  assert.ok(presets.some((p) => p.name === "documentary"), "the documentary preset ships");
  for (const { name, description, preset } of presets) {
    assert.ok(description.trim(), `${name} says what it sets`);
    assert.deepEqual(forbiddenPresetKeys(preset), [], `${name} carries nothing of one channel's`);
    const result = validateAgainst("channel_config", applyPreset(fixture(), preset));
    assert.ok(result.ok, `${name}: ${result.errors.join("; ")}`);
  }
});

test("a preset carrying a channel's own voice id is rejected", () => {
  assert.deepEqual(forbiddenPresetKeys({ description: "x", voice: { voice_id: "abc", speed: 0.9 } }), ["voice.voice_id"]);
  assert.deepEqual(forbiddenPresetKeys({ description: "x", budget: { max_usd_per_video: 5 }, name: "n" }), ["name", "budget"]);
  assert.deepEqual(forbiddenPresetKeys({ description: "x", voice: { speed: 0.9 } }), []);
});

test("the documentary preset keeps the channel's own identity, voice and sources", () => {
  const base = fixture();
  const preset = listPresets(repoRoot()).find((p) => p.name === "documentary")!.preset;
  const merged = applyPreset(base, preset);
  assert.equal(merged.channel_id, base.channel_id);
  assert.equal(merged.language, base.language);
  assert.deepEqual(merged.budget, base.budget);
  assert.equal(merged.voice.provider, base.voice.provider);
  assert.equal(merged.voice.voice_id, base.voice.voice_id);
  assert.deepEqual(merged.source_policy.visual.chain, base.source_policy.visual.chain, "sources are a licensing choice");
  assert.equal(merged.voice.speed, 0.9);
  assert.equal(merged.pipeline, "documentary");
  assert.equal("description" in merged, false, "the description is not a config field");
});

test("objects merge key by key; arrays and scalars replace", () => {
  const merged = deepMerge(
    { a: { keep: 1, change: 1 }, list: [1, 2, 3], s: "old" },
    { a: { change: 2, add: 3 }, list: [9], s: "new" },
  );
  assert.deepEqual(merged, { a: { keep: 1, change: 2, add: 3 }, list: [9], s: "new" });
});
