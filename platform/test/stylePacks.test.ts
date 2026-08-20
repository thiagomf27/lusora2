import test from "node:test";
import assert from "node:assert/strict";
import {
  STYLE_PACK_NAME_RE,
  insert,
  serializeStylePack,
  spliceAllowedPacks,
  stylePackPath,
} from "../src/lib/stylePacks.ts";
import { beatRange, densityPerMinute, overlayBudget } from "../src/lib/pacing.ts";

/**
 * Style packs may still be hand-edited contract files. Toggling one pack's
 * allowance must not touch anything else in the document — re-serializing the
 * parsed JSON turns `4.0` into `4` and collapses deliberate one-liners. (The
 * Style Packs screen saves the whole document and does normalize it; that is
 * one explicit edit, not a side effect of an allowance toggle.)
 */
const MULTILINE = `{
  "name": "doc-slow",
  "pacing": {
    "avg_hold_seconds": 4.0,
    "max_hold": 8.0
  },
  "overlays": {
    "density": "normal",
    "allowed_packs": [
      "archive",
      "core"
    ]
  },
  "script_persona": "Grave."
}
`;

const ONE_LINE = `{
  "overlays": { "density": "high", "allowed_packs": ["archive", "core"] }
}
`;

test("splicing preserves the rest of the document verbatim", () => {
  const out = spliceAllowedPacks(MULTILINE, ["core", "finance", "social"])!;
  assert.ok(out.includes(`"avg_hold_seconds": 4.0`), "float formatting survived");
  assert.ok(out.includes(`"max_hold": 8.0`));
  assert.ok(out.includes(`"script_persona": "Grave."`));
  assert.deepEqual(JSON.parse(out).overlays.allowed_packs, ["core", "finance", "social"]);
  // everything outside the array is byte-identical
  const [before] = MULTILINE.split(`    "allowed_packs"`);
  assert.ok(out.startsWith(before));
  assert.ok(out.endsWith(`  },\n  "script_persona": "Grave."\n}\n`));
});

test("splicing keeps a one-line array on one line", () => {
  const out = spliceAllowedPacks(ONE_LINE, ["core"])!;
  assert.ok(out.includes(`"allowed_packs": ["core"]`), out);
  assert.equal(JSON.parse(out).overlays.density, "high");
});

test("removal down to an empty list stays valid JSON", () => {
  const out = spliceAllowedPacks(MULTILINE, [])!;
  assert.deepEqual(JSON.parse(out).overlays.allowed_packs, []);
});

test("a document without the key is reported, not guessed at", () => {
  assert.equal(spliceAllowedPacks(`{ "overlays": { "density": "low" } }`, ["X"]), null);
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

test("splicing still works on a document the screen has normalized", () => {
  // a whole-document save reserializes; the allowance toggle must survive it
  const normalized = serializeStylePack(JSON.parse(MULTILINE));
  const out = spliceAllowedPacks(normalized, ["FactCard"])!;
  assert.deepEqual(JSON.parse(out).overlays.allowed_packs, ["FactCard"]);
  assert.equal(JSON.parse(out).pacing.avg_hold_seconds, 4);
});

test("the name is the filename, so it must be a slug", () => {
  for (const bad of ["Doc-Slow", "doc slow", "../escape", "-lead", ""]) {
    assert.equal(STYLE_PACK_NAME_RE.test(bad), false, bad);
    assert.throws(() => stylePackPath(bad));
  }
  assert.ok(stylePackPath("doc-slow2").endsWith("/contracts/style-packs/doc-slow2.json"));
});

test("serializing a pack round-trips and ends in a newline", () => {
  const doc = JSON.parse(MULTILINE);
  const text = serializeStylePack(doc);
  assert.deepEqual(JSON.parse(text), doc);
  assert.ok(text.endsWith("\n"));
});

/**
 * The preview promises the operator a budget; the worker's plan validator is
 * what actually rejects a plan. These are the numbers from its validators.py —
 * if they fail, the two have drifted.
 */
test("pacing arithmetic matches the worker's validator", () => {
  assert.equal(densityPerMinute("low"), 1);
  assert.equal(densityPerMinute("normal"), 2.5);
  assert.equal(densityPerMinute("high"), 5);
  assert.equal(densityPerMinute({ per_minute: 6 }), 6);

  // ceil(per_minute * duration / 60) + 1
  assert.equal(overlayBudget({ per_minute: 6 }, 600), 61);
  assert.equal(overlayBudget("normal", 600), 26);

  // target = duration / avg_hold; [floor(t*0.5), ceil(t*1.8)+1]
  assert.deepEqual(beatRange(4, 600), [75, 271]);
  assert.deepEqual(beatRange(0, 600), [0, 0]);
});
