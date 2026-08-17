import test from "node:test";
import assert from "node:assert/strict";
import { applyComponentPack, applyLook } from "../src/lib/look.ts";

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

test("excluding the pack's default transition re-points the default", () => {
  // "this channel never hard-cuts" is a look, not a mistake. What must not
  // survive is `default` still naming the excluded kind: the compiler reads it
  // for every transition the planner leaves unspecified, so that would put back
  // exactly what was excluded.
  const s = snapshot({ exclude: { transitions: ["cut"] } });
  assert.deepEqual(applyLook(s), []);
  assert.deepEqual(style(s).transitions.allowed, ["crossfade", "fade"]);
  assert.equal(style(s).transitions.default, "crossfade");
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

/**
 * `component_pack` narrows the same list, at the same moment, for a different
 * reason: not "this channel would rather not", but "this channel has not
 * installed that". These run against the REAL merged catalog, so they assert
 * the shape of the narrowing rather than a fixed component list that would
 * break every time a pack is added.
 */
function installed(pack: string | null) {
  const s = snapshot(undefined);
  s.component_pack = pack;
  s.style_pack = "p";
  // no allow-list: the pack offers the whole catalog, so the component pack is
  // the only thing doing any narrowing
  delete (s.style_pack_doc as Record<string, any>).overlays.allowed_components;
  return s;
}

test("an unset component_pack resolves to core", () => {
  const s = installed(null);
  assert.deepEqual(applyComponentPack(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;
  assert.ok(allowed.length > 0, "core must offer something");
  assert.ok(!allowed.some((c) => c.startsWith("Archive")), "no other pack's component survives");
});

test("naming a pack REPLACES core rather than adding to it", () => {
  const core: string[] = (() => {
    const s = installed(null);
    applyComponentPack(s);
    return style(s).overlays.allowed_components;
  })();
  const s = installed("archive");
  assert.deepEqual(applyComponentPack(s), []);
  const only: string[] = style(s).overlays.allowed_components;
  assert.ok(only.length > 0, "the archive pack must offer something");
  assert.ok(only.every((c) => !core.includes(c)), "no core component may survive choosing archive");
});

test("allowed_packs: the channel's pack decides the whole menu", () => {
  const s = installed("archive");
  (s.style_pack_doc as Record<string, any>).overlays.allowed_packs = ["archive", "core"];
  assert.deepEqual(applyComponentPack(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;
  assert.ok(allowed.length > 0);
  assert.ok(allowed.every((c) => c.startsWith("Archive")), "only the installed pack's components");
});

test("allowed_packs: a channel on a pack the style does not allow is refused", () => {
  const s = installed("archive");
  (s.style_pack_doc as Record<string, any>).overlays.allowed_packs = ["core"];
  assert.match(applyComponentPack(s)[0], /allows core, but this channel's component_pack is 'archive'/);
});

test("allowed_packs omitted means any pack", () => {
  const s = installed("archive");
  delete (s.style_pack_doc as Record<string, any>).overlays.allowed_packs;
  assert.deepEqual(applyComponentPack(s), []);
  assert.ok(style(s).overlays.allowed_components.length > 0);
});

test("an old snapshot with only allowed_components still replays (Principle 7)", () => {
  // No allowed_packs anywhere: a video queued before allowance moved to packs
  // must narrow exactly as it did then.
  const s = installed(null);
  (s.style_pack_doc as Record<string, any>).overlays.allowed_components = ["ChapterCard", "FactCard"];
  assert.deepEqual(applyComponentPack(s), []);
  assert.deepEqual(style(s).overlays.allowed_components, ["ChapterCard", "FactCard"]);
});

test("a component pack sharing nothing with the style pack is refused", () => {
  // The sharp edge of one-pack-only, and the reason the Visual tab warns about
  // it at edit time: core + a style pack that only allows archive components
  // leaves nothing to draw.
  const s = installed(null);
  (s.style_pack_doc as Record<string, any>).overlays.allowed_components = ["ArchiveQuoteCard"];
  assert.match(applyComponentPack(s)[0], /offers none of the components/);
});
