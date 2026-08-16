import test from "node:test";
import assert from "node:assert/strict";
import { applyLook } from "../src/lib/look.ts";

/**
 * `look` is the subtractive half of the look, applied to the docs already
 * embedded in the snapshot. These pin the two things that make it safe: the
 * narrowing really lands on the embedded docs (so no agent, compiler or
 * renderer has to know the block exists), and emptying a list the pipeline
 * needs is refused instead of silently repaired.
 */
function snapshot(look: unknown) {
  return {
    channel_id: "CH",
    look,
    style_pack_doc: {
      name: "p",
      pacing: { avg_hold_seconds: 4, min_hold: 2, max_hold: 8 },
      overlays: { density: "normal", allowed_components: ["ChapterCard", "FactCard", "KineticTitle"] },
      transitions: { allowed: ["cut", "crossfade", "fade"], default: "cut" },
      sfx: { enabled: true, cues: ["entrance", "transition"] },
    },
    theme_doc: {
      name: "t",
      sound: { pack: "doc-restrained", mood_beds: { neutral: "bed_a", tense: "bed_b", playful: "bed_c" } },
    },
  } as Record<string, unknown>;
}

const style = (s: Record<string, unknown>) => s.style_pack_doc as Record<string, any>;
const theme = (s: Record<string, unknown>) => s.theme_doc as Record<string, any>;

test("no look block leaves the embedded docs untouched", () => {
  const s = snapshot(undefined);
  assert.deepEqual(applyLook(s), []);
  assert.deepEqual(style(s).overlays.allowed_components, ["ChapterCard", "FactCard", "KineticTitle"]);
});

test("excluded components leave the style pack's allow-list", () => {
  const s = snapshot({ exclude: { components: ["KineticTitle"] } });
  assert.deepEqual(applyLook(s), []);
  assert.deepEqual(style(s).overlays.allowed_components, ["ChapterCard", "FactCard"]);
});

test("excluding a component the pack never offered is a no-op, not an error", () => {
  const s = snapshot({ exclude: { components: ["NotInThisPack"] } });
  assert.deepEqual(applyLook(s), []);
  assert.deepEqual(style(s).overlays.allowed_components, ["ChapterCard", "FactCard", "KineticTitle"]);
});

test("excluded transitions leave the allowed list", () => {
  const s = snapshot({ exclude: { transitions: ["fade"] } });
  assert.deepEqual(applyLook(s), []);
  assert.deepEqual(style(s).transitions.allowed, ["cut", "crossfade"]);
});

test("excluding the pack's default transition is refused with the reason", () => {
  const s = snapshot({ exclude: { transitions: ["cut"] } });
  const problems = applyLook(s);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /default/);
  assert.match(problems[0], /'cut'/);
});

test("excluding every transition is refused", () => {
  const s = snapshot({ exclude: { transitions: ["cut", "crossfade", "fade"] } });
  assert.match(applyLook(s)[0], /no transition allowed/);
});

test("excluding every component is refused", () => {
  const s = snapshot({ exclude: { components: ["ChapterCard", "FactCard", "KineticTitle"] } });
  assert.match(applyLook(s)[0], /no overlay component/);
});

test("excluded sfx cues and moods leave the pack and the theme", () => {
  const s = snapshot({ exclude: { sfx_cues: ["transition"], moods: ["playful"] } });
  assert.deepEqual(applyLook(s), []);
  assert.deepEqual(style(s).sfx.cues, ["entrance"]);
  assert.deepEqual(Object.keys(theme(s).sound.mood_beds), ["neutral", "tense"]);
});

test("a pack with no allow-list gets one built from the catalog minus the exclusions", () => {
  const s = snapshot({ exclude: { components: ["ChapterCard"] } });
  delete style(s).overlays.allowed_components;
  assert.deepEqual(applyLook(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;
  assert.ok(allowed.length > 1, "the catalog has more than one component");
  assert.ok(!allowed.includes("ChapterCard"));
});
