import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_PATH,
  renderEditPassPrompt,
  renderFixture,
  resolveStyleForConfig,
} from "../src/lib/editPassPrompt.ts";
import { loadMergedCatalog } from "../src/lib/catalog.ts";
import { repoRoot } from "../src/lib/env.ts";

/**
 * The edit-pass prompt (docs/05-roadmap/directed-edit-test.md, slice 2) is
 * GENERATED from the catalog, the style pack and the block's own schema, so it
 * cannot drift from what the paste check enforces. The golden file makes any
 * change to it a reviewed diff.
 */

const coreNames = loadMergedCatalog()
  .items.filter((i) => (i.entry.pack ?? "core") === "core")
  .map((i) => i.entry.name);

/** The test channel of the A/B: basic's seven components and nothing else. */
const testChannel = {
  style_pack: "directed-test",
  component_pack: "basic",
  look: { exclude: { components: coreNames } },
};

test("the golden file matches the prompt the contracts produce today", () => {
  const golden = readFileSync(join(repoRoot(), FIXTURE_PATH), "utf8");
  assert.equal(
    renderFixture(),
    golden,
    "the edit-pass prompt changed — if that is intended, run `pnpm edit-pass-prompt --write-fixture` and review the diff"
  );
});

test("the test channel's menu is basic's seven components, resolved as enqueue resolves it", () => {
  const { style, problems } = resolveStyleForConfig(testChannel);
  assert.deepEqual(problems, []);
  assert.deepEqual(
    [...(style!.overlays!.allowed_components ?? [])].sort(),
    ["TextBanner", "TextCounter", "TextHighlight", "TextName", "TextPlace", "TextTag", "TextTitle"]
  );
  const prompt = renderEditPassPrompt({ style: style!, durationS: 111 });
  for (const name of style!.overlays!.allowed_components!) assert.ok(prompt.includes(`- ${name}`), name);
  assert.ok(!prompt.includes("AnimatedCounter ["), "a core component leaked into the menu");
});

test("a style pack's allowed_packs alone does not install a pack — the channel's component_pack does", () => {
  // applyComponentPack resolves core + the channel's component_pack; a style
  // pack naming "basic" only permits it. Pinned here because the A/B's test
  // channel depends on it.
  const { style } = resolveStyleForConfig({ style_pack: "directed-test" });
  assert.ok(!style!.overlays!.allowed_components!.includes("TextBanner"));
});

test("an uncapped pack says so instead of printing a meaningless number", () => {
  const { style } = resolveStyleForConfig(testChannel);
  const prompt = renderEditPassPrompt({ style: style!, durationS: 111 });
  assert.match(prompt, /no practical limit/);
  assert.doesNotMatch(prompt, /hard ceiling/);
});

test("a capped pack gets its budgets at the estimated duration, with the headroom named", () => {
  const { style } = resolveStyleForConfig({ style_pack: "descoberta-doc" });
  const prompt = renderEditPassPrompt({ style: style!, durationS: 20 * 60 });
  // 3/min and 0.6/min over 20 min: 90% of the estimate, then the validator's ceiling
  assert.match(prompt, /at most 54 fact graphics \(hard ceiling 61\)/);
  assert.match(prompt, /at most 10 emphasis graphics \(hard ceiling 13\)/);
});

test("the moods and the phrase rules come from the block's contract", () => {
  const { style } = resolveStyleForConfig(testChannel);
  const prompt = renderEditPassPrompt({ style: style!, durationS: 111 });
  const schema = JSON.parse(readFileSync(join(repoRoot(), "contracts/schemas/edit_hints.schema.json"), "utf8"));
  assert.ok(prompt.includes(schema.$defs.section.properties.mood.enum.join(", ")));
  assert.ok(prompt.includes('"style_pack": "directed-test"'));
  assert.ok(prompt.endsWith("THE SCRIPT:\n"));
});

test("file-path props never reach the menu — an edit pass cannot supply a file", () => {
  const { style } = resolveStyleForConfig({ style_pack: "descoberta-doc" });
  const prompt = renderEditPassPrompt({ style: style!, durationS: 600 });
  assert.doesNotMatch(prompt, /^\s+(image|plate|src)[* ]/m);
});
