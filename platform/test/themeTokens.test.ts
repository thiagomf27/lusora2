/**
 * D46 token-group editing. The rule under test is that ABSENCE is meaningful:
 * a theme with no `surface`/`motion` lets every component keep its own pre-D46
 * look, so the form must be able to write a token back OUT, not just set it.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Theme } from "@lusora/contracts";
import { mergeTokenGroup } from "../src/lib/themeTokens.ts";

const base: Theme = {
  name: "t",
  colors: { bg: "#000000", text: "#ffffff", accent: "#ff0000", neutral: "#888888" },
  typography: { display: "Inter", body: "Inter", caption_preset: "plain" },
};

test("setting the first token creates the group", () => {
  const next = mergeTokenGroup(base, "surface", { radius: "rounded" });
  assert.deepEqual(next.surface, { radius: "rounded" });
});

test("a second token merges rather than replacing", () => {
  const one = mergeTokenGroup(base, "surface", { radius: "rounded" });
  const two = mergeTokenGroup(one, "surface", { fill: "solid" });
  assert.deepEqual(two.surface, { radius: "rounded", fill: "solid" });
});

test("clearing one token of several keeps the group", () => {
  const both = mergeTokenGroup(
    mergeTokenGroup(base, "surface", { radius: "rounded" }),
    "surface",
    { fill: "solid" },
  );
  const cleared = mergeTokenGroup(both, "surface", { radius: undefined });
  assert.deepEqual(cleared.surface, { fill: "solid" });
});

test("clearing the LAST token removes the group, never leaves {}", () => {
  const one = mergeTokenGroup(base, "motion", { entrance: "pop" });
  const cleared = mergeTokenGroup(one, "motion", { entrance: undefined });
  assert.equal("motion" in cleared, false, "an empty group would read as a deliberate choice");
});

test("the groups are independent", () => {
  const withBoth = mergeTokenGroup(
    mergeTokenGroup(base, "surface", { radius: "square" }),
    "motion",
    { entrance: "slide" },
  );
  const cleared = mergeTokenGroup(withBoth, "motion", { entrance: undefined });
  assert.deepEqual(cleared.surface, { radius: "square" });
  assert.equal("motion" in cleared, false);
});

test("per_component survives an unrelated motion edit", () => {
  const withMap = mergeTokenGroup(base, "motion", { per_component: { ChapterCard: "typewriter" } });
  const next = mergeTokenGroup(withMap, "motion", { easing: "snap" });
  assert.deepEqual(next.motion, {
    per_component: { ChapterCard: "typewriter" },
    easing: "snap",
  });
});

test("editing never mutates the theme it was given", () => {
  const frozen = mergeTokenGroup(base, "surface", { radius: "soft" });
  mergeTokenGroup(frozen, "surface", { radius: undefined });
  assert.deepEqual(frozen.surface, { radius: "soft" });
});
