import test from "node:test";
import assert from "node:assert/strict";
import { insert, spliceAllowedComponents } from "../src/lib/stylePacks.ts";

/**
 * Style packs are hand-edited contract files. Toggling one component's
 * allowance must not touch anything else in the document — re-serializing the
 * parsed JSON turns `4.0` into `4` and collapses deliberate one-liners.
 */
const MULTILINE = `{
  "name": "doc-slow",
  "pacing": {
    "avg_hold_seconds": 4.0,
    "max_hold": 8.0
  },
  "overlays": {
    "density": "normal",
    "allowed_components": [
      "FactCard",
      "QuoteBlock"
    ]
  },
  "script_persona": "Grave."
}
`;

const ONE_LINE = `{
  "overlays": { "density": "high", "allowed_components": ["FactCard", "QuoteBlock"] }
}
`;

test("splicing preserves the rest of the document verbatim", () => {
  const out = spliceAllowedComponents(MULTILINE, ["FactCard", "NamePlate", "QuoteBlock"])!;
  assert.ok(out.includes(`"avg_hold_seconds": 4.0`), "float formatting survived");
  assert.ok(out.includes(`"max_hold": 8.0`));
  assert.ok(out.includes(`"script_persona": "Grave."`));
  assert.deepEqual(JSON.parse(out).overlays.allowed_components, [
    "FactCard",
    "NamePlate",
    "QuoteBlock",
  ]);
  // everything outside the array is byte-identical
  const [before] = MULTILINE.split(`    "allowed_components"`);
  assert.ok(out.startsWith(before));
  assert.ok(out.endsWith(`  },\n  "script_persona": "Grave."\n}\n`));
});

test("splicing keeps a one-line array on one line", () => {
  const out = spliceAllowedComponents(ONE_LINE, ["FactCard"])!;
  assert.ok(out.includes(`"allowed_components": ["FactCard"]`), out);
  assert.equal(JSON.parse(out).overlays.density, "high");
});

test("removal down to an empty list stays valid JSON", () => {
  const out = spliceAllowedComponents(MULTILINE, [])!;
  assert.deepEqual(JSON.parse(out).overlays.allowed_components, []);
});

test("a document without the key is reported, not guessed at", () => {
  assert.equal(spliceAllowedComponents(`{ "overlays": { "density": "low" } }`, ["X"]), null);
});

test("adding a component respects the existing order", () => {
  // alphabetical list -> stays alphabetical
  assert.deepEqual(insert(["BarChart", "FactCard", "Timeline"], "NamePlate"), [
    "BarChart",
    "FactCard",
    "NamePlate",
    "Timeline",
  ]);
  // hand-ordered list (by prominence) -> appended, nothing reshuffled
  assert.deepEqual(insert(["KineticTitle", "HammerStatement", "CalloutArrow"], "BarChart"), [
    "KineticTitle",
    "HammerStatement",
    "CalloutArrow",
    "BarChart",
  ]);
  assert.deepEqual(insert([], "FactCard"), ["FactCard"]);
});
