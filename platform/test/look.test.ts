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

/** The menu a channel with no pack installed resolves to. */
function coreMenu(): string[] {
  const s = installed(null);
  applyComponentPack(s);
  return style(s).overlays.allowed_components as string[];
}

test("no component_pack resolves to core only", () => {
  const s = installed(null);
  assert.deepEqual(applyComponentPack(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;
  assert.ok(allowed.length > 0, "core must offer something");
  assert.ok(!allowed.includes("SocialPost"), "no other pack's component survives");
});

test("a component_pack resolves to core PLUS the pack, with no duplicate names", () => {
  // Packs are additive over core (D66): a pack is a menu EXTENSION, so a
  // channel that installs one is asking for core AND those entries. Resolving
  // to the pack alone is what left a channel on a three-entry pack with no
  // counter, chart, title or lower third at all.
  const core = coreMenu();
  const s = installed("social");
  assert.deepEqual(applyComponentPack(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;

  for (const c of core) assert.ok(allowed.includes(c), `core's ${c} must survive installing a pack`);
  assert.ok(allowed.length > core.length, "the pack must add something core did not have");
  assert.ok(
    allowed.some((c) => !core.includes(c)),
    "at least one entry must come from the installed pack"
  );
  assert.equal(new Set(allowed).size, allowed.length, "no name may appear twice");
});

test("allowed_packs: the menu is core plus the installed pack", () => {
  const core = coreMenu();
  const s = installed("social");
  (s.style_pack_doc as Record<string, any>).overlays.allowed_packs = ["core", "social"];
  assert.deepEqual(applyComponentPack(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;
  assert.ok(allowed.length > core.length);
  for (const c of core) assert.ok(allowed.includes(c));
  assert.equal(new Set(allowed).size, allowed.length);
});

test("core survives a style pack whose allowed_packs omits it", () => {
  // `allowed_packs` says which EXTRA packs a style suits. It is not an opt-in
  // to the base menu, and it cannot take the base menu away — the tool for
  // "not this core component" is look.exclude.components, which runs next.
  const core = coreMenu();
  const s = installed("social");
  (s.style_pack_doc as Record<string, any>).overlays.allowed_packs = ["social"];
  assert.deepEqual(applyComponentPack(s), []);
  const allowed: string[] = style(s).overlays.allowed_components;
  for (const c of core) assert.ok(allowed.includes(c), `core's ${c} must survive`);
});

test("allowed_packs: a channel on a pack the style does not allow is refused", () => {
  const s = installed("social");
  (s.style_pack_doc as Record<string, any>).overlays.allowed_packs = ["core"];
  assert.match(applyComponentPack(s)[0], /allows core, but this channel's component_pack is 'social'/);
});

test("allowed_packs omitted means any pack", () => {
  const s = installed("social");
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
  // Still reachable even with packs additive: a channel on core alone, and a
  // style pack whose authored allow-list names only a component from some
  // other pack, leaves nothing to draw. This is what the Visual tab warns
  // about at edit time.
  const s = installed(null);
  (s.style_pack_doc as Record<string, any>).overlays.allowed_components = ["ArchiveCaption"];
  assert.match(applyComponentPack(s)[0], /offers none of the components/);
});
