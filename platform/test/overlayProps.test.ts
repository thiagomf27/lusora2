import test from "node:test";
import assert from "node:assert/strict";
import type { Beat, CatalogEntry } from "@lusora/contracts";
import { resolveOverlayProps } from "../src/lib/overlayProps.ts";
import { loadMergedCatalog } from "../src/lib/catalog.ts";

/** What the screen passes as stand-ins; `lib/overlaySamples` needs a bundler. */
const FALLBACK = { value: 42, label: "sample", headline: "sample" };

/**
 * The pre-compile overlay preview draws with props the PLATFORM resolved, and
 * it is only worth looking at if those are the props the compiler will resolve.
 * These cases are the ones worker/tests/test_compiler.py asserts against
 * `_compile_overlay` — same beat, same expected values.
 */
function entry(name: string): CatalogEntry {
  const hit = loadMergedCatalog().items.find((i) => i.entry.name === name);
  assert.ok(hit, `${name} missing from the catalog`);
  return hit.entry;
}

const counterBeat: Beat = {
  id: "b1",
  kind: "narration",
  script_text: "Nearly 70% converted.",
  visual_intent: "factories",
  anchors: [{ type: "percentage", value: 70, label: "converted", source_words: "70%" }],
  overlay: { component: "AnimatedCounter", anchor_ref: 0 },
};

test("from_anchor fills the figure, and the anchor's label fills the label", () => {
  const { props, fromAnchor, problem } = resolveOverlayProps(counterBeat, entry("AnimatedCounter"));
  assert.equal(props.value, 70);
  assert.equal(props.label, "converted");
  assert.equal(props.emphasis, "neutral"); // catalog default
  assert.ok(fromAnchor.includes("value"));
  assert.equal(problem, null);
});

test("a props_hint the planner wrote wins over the anchor", () => {
  const beat: Beat = {
    ...counterBeat,
    overlay: { component: "AnimatedCounter", anchor_ref: 0, props_hint: { label: "of the fleet" } },
  };
  const { props, fromAnchor } = resolveOverlayProps(beat, entry("AnimatedCounter"));
  assert.equal(props.label, "of the fleet");
  assert.ok(!fromAnchor.includes("label"));
});

test("an anchor-filled string is trimmed to the prop's own word limit", () => {
  const spec = entry("AnimatedCounter").props.label;
  assert.ok(spec.maxWords, "this case needs a prop with a word limit");
  const long = Array.from({ length: spec.maxWords! + 4 }, (_, i) => `w${i}`).join(" ");
  const beat: Beat = {
    ...counterBeat,
    anchors: [{ type: "percentage", value: 70, label: long, source_words: "70%" }],
  };
  const { props } = resolveOverlayProps(beat, entry("AnimatedCounter"));
  assert.equal(String(props.label).split(" ").length, spec.maxWords);
});

test("captions on lift a bottom-edge position above the band (D56)", () => {
  const beat: Beat = {
    id: "b1",
    kind: "narration",
    script_text: "On the morning of December 7th, 1941.",
    visual_intent: "harbour at dawn",
    anchors: [{ type: "date", value: "1941-12-07", label: "the attack", source_words: "December 7th, 1941" }],
    overlay: { component: "DateStamp", anchor_ref: 0, props_hint: { position: "bottom_left" } },
  };
  assert.equal(resolveOverlayProps(beat, entry("DateStamp"), { captionsEnabled: true }).props.position, "top_left");
  assert.equal(resolveOverlayProps(beat, entry("DateStamp"), { captionsEnabled: false }).props.position, "bottom_left");
});

test("a missing anchor is reported rather than drawn as an empty card", () => {
  const beat: Beat = {
    id: "b2",
    kind: "narration",
    script_text: "By nightfall it was not.",
    visual_intent: "harbour at dusk",
    overlay: { component: "AnimatedCounter" },
  };
  const { problem, standIns, props } = resolveOverlayProps(beat, entry("AnimatedCounter"), {
    fallback: FALLBACK,
  });
  assert.match(problem ?? "", /needs an anchor/);
  // still previewable: the required figure is a stand-in, and says so
  assert.ok(standIns.includes("value"));
  assert.notEqual(props.value, undefined);
});
