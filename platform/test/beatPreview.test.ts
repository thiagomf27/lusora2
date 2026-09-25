import test from "node:test";
import assert from "node:assert/strict";
import type { Beat, CatalogEntry, EditPlan } from "@lusora/contracts";
import { beatPreview } from "../src/lib/beatPreview.ts";
import { loadMergedCatalog } from "../src/lib/catalog.ts";

/**
 * The beat preview mounts the REAL plan; the only thing it may change is the
 * overlay of the beat being edited, and only when the form and the compiled
 * plan disagree. These cases pin that boundary — a preview that quietly
 * re-derived a compiled overlay would be showing its own arithmetic instead of
 * the render's.
 */
function entry(name: string): CatalogEntry {
  const hit = loadMergedCatalog().items.find((i) => i.entry.name === name);
  assert.ok(hit, `${name} missing from the catalog`);
  return hit.entry;
}

const beat: Beat = {
  id: "b1",
  kind: "narration",
  script_text: "Nearly 70% converted.",
  visual_intent: "factories",
  anchors: [{ type: "percentage", value: 70, label: "converted", source_words: "70%" }],
  overlay: { component: "AnimatedCounter", anchor_ref: 0 },
};

function planWith(overlays: EditPlan["tracks"]["overlays"]): EditPlan {
  return {
    version: "1.0",
    video_id: "vid_test",
    fps: 30,
    resolution: { width: 1920, height: 1080 },
    tracks: {
      visual: [
        // a compiled plan always carries the pack's hand-off on every item but
        // the last, which has no junction — the fixture matches that
        { id: "v1", beat_id: "b1", start_s: 2, end_s: 8, media_type: "video",
          asset: { source: "stock", path: "clips/v_b1.mp4" },
          transition_out: { type: "cut", duration_s: 0.1 } },
        { id: "v2", beat_id: "b2", start_s: 8, end_s: 12, media_type: "video",
          asset: { source: "stock", path: "clips/v_b2.mp4" } },
      ],
      overlays,
      captions: { enabled: true, items: [] },
      audio: { voiceover: { path: "audio.mp3", duration_s: 12 } },
    },
  };
}

const compiledProps = {
  value: 70,
  label: "converted",
  decimals: 0,
  approximate: false,
  position: "center",
  emphasis: "neutral",
};

test("an unchanged overlay is shown exactly as the compiler placed it", () => {
  const plan = planWith([
    { id: "o_b1", beat_id: "b1", start_s: 5.9, end_s: 9.9, kind: "component",
      component: "AnimatedCounter", props: compiledProps },
  ]);
  const out = beatPreview(plan, beat, entry("AnimatedCounter"));
  assert.equal(out.overlayDraft, false);
  assert.equal(out.plan, plan, "the plan is passed through, not rebuilt");
  assert.deepEqual(out.window, { start_s: 2, end_s: 8 });
});

test("a component picked in the form is placed 0.4s into the beat", () => {
  const plan = planWith([]);
  const out = beatPreview(plan, beat, entry("AnimatedCounter"));
  assert.equal(out.overlayDraft, true);
  assert.equal(out.timingDraft, true, "nothing compiled it, so we placed it");
  const item = out.plan.tracks.overlays.find((o) => o.beat_id === "b1");
  assert.ok(item);
  assert.equal(item.start_s, 2.4);
  assert.equal(item.props?.value, 70, "anchor-filled, like the compiler");
  // held for the catalog's own duration, not the beat's
  assert.equal(item.end_s, 2.4 + (entry("AnimatedCounter").duration_hint_s?.default ?? 4));
});

test("editing the props of a compiled overlay keeps the compiler's timing", () => {
  const plan = planWith([
    { id: "o_b1", beat_id: "b1", start_s: 5.9, end_s: 9.9, kind: "component",
      component: "AnimatedCounter", props: compiledProps },
  ]);
  const edited: Beat = {
    ...beat,
    overlay: { component: "AnimatedCounter", anchor_ref: 0, props_hint: { suffix: "%" } },
  };
  const out = beatPreview(plan, edited, entry("AnimatedCounter"));
  assert.equal(out.overlayDraft, true);
  assert.equal(out.timingDraft, false, "the same component keeps where the compiler put it");
  assert.equal(out.plan.tracks.overlays[0].start_s, 5.9);
  assert.equal(out.plan.tracks.overlays[0].end_s, 9.9);
  assert.equal(out.plan.tracks.overlays[0].props?.suffix, "%");
});

test("a plan compiled before the catalog gained a prop keeps its timing too", () => {
  // the common case on a plan a few days old: the compiler filled the props it
  // knew about, and a default added since is the only difference
  const { size, ...withoutSize } = { ...compiledProps, size: "standard" };
  const plan = planWith([
    { id: "o_b1", beat_id: "b1", start_s: 5.9, end_s: 9.9, kind: "component",
      component: "AnimatedCounter", props: withoutSize },
  ]);
  const out = beatPreview(plan, beat, entry("AnimatedCounter"));
  assert.equal(out.timingDraft, false);
  assert.equal(out.plan.tracks.overlays[0].start_s, 5.9);
});

test("clearing the overlay takes the compiled one out of the preview", () => {
  const plan = planWith([
    { id: "o_b1", beat_id: "b1", start_s: 5.9, end_s: 9.9, kind: "component",
      component: "AnimatedCounter", props: compiledProps },
  ]);
  const cleared: Beat = { ...beat, overlay: undefined };
  const out = beatPreview(plan, cleared, null);
  assert.equal(out.overlayDraft, true);
  assert.equal(out.plan.tracks.overlays.length, 0);
});

test("another beat's overlay is never touched", () => {
  const plan = planWith([
    { id: "o_b2", beat_id: "b2", start_s: 8.4, end_s: 12, kind: "component",
      component: "ChapterCard", props: { title: "Two" } },
  ]);
  const out = beatPreview(plan, beat, entry("AnimatedCounter"));
  assert.ok(out.plan.tracks.overlays.some((o) => o.id === "o_b2"));
  assert.equal(out.plan.tracks.overlays.length, 2);
  assert.ok(
    out.plan.tracks.overlays[0].start_s <= out.plan.tracks.overlays[1].start_s,
    "the track stays start-sorted"
  );
});

// ---------------- the hand-off (D89) ----------------

test("the transition the form holds lands on the beat's last shot", () => {
  const plan = planWith([]);
  const out = beatPreview(plan, { ...beat, transition_out: "fade_to_black" }, entry("AnimatedCounter"), {
    transitionSeconds: 0.5,
    defaultTransition: "cut",
  });
  assert.equal(out.transitionDraft, true);
  assert.deepEqual(out.plan.tracks.visual[0].transition_out, {
    type: "fade_to_black",
    duration_s: 0.5,
  });
  assert.deepEqual(out.transition, { type: "fade_to_black", duration_s: 0.5 });
});

test("a beat that names none takes the pack's default, at the pack's length", () => {
  const out = beatPreview(planWith([]), beat, entry("AnimatedCounter"), {
    transitionSeconds: 0.8,
    defaultTransition: "crossfade",
  });
  assert.deepEqual(out.transition, { type: "crossfade", duration_s: 0.8 });
});

test("a beat that names none keeps a transition the compiler placed (D95)", () => {
  const plan = planWith([]);
  const placed = { type: "fade_to_black" as const, duration_s: 0.8, placed_by: "section_break" as const };
  plan.tracks.visual[0] = { ...plan.tracks.visual[0], transition_out: placed };
  const out = beatPreview(plan, beat, entry("AnimatedCounter"), { defaultTransition: "cut" });
  assert.equal(out.transitionDraft, false);
  assert.deepEqual(out.transition, placed);
});

test("a stale human transition the form cleared falls back to the default (D95)", () => {
  const plan = planWith([]);
  plan.tracks.visual[0] = { ...plan.tracks.visual[0], transition_out: { type: "crossfade", duration_s: 0.5 } };
  const out = beatPreview(plan, beat, entry("AnimatedCounter"), { defaultTransition: "cut" });
  assert.deepEqual(out.transition, { type: "cut", duration_s: 0.1 });
});

test("the play window runs past the cut, by exactly the transition", () => {
  const cut = beatPreview(planWith([]), beat, entry("AnimatedCounter"), { defaultTransition: "cut" });
  assert.deepEqual(cut.playWindow, cut.window, "a cut has nothing to show past it");

  const dissolve = beatPreview(
    planWith([]),
    { ...beat, transition_out: "crossfade" },
    entry("AnimatedCounter"),
    { transitionSeconds: 0.5 }
  );
  assert.equal(dissolve.window!.end_s, 8);
  assert.equal(dissolve.playWindow!.end_s, 8.5);
});

test("a transition with no room to draw degrades to a cut, as the compile would", () => {
  const plan = planWith([]);
  // b1's neighbour is only 4s; shrink it to something a 0.5s dissolve cannot fit beside
  plan.tracks.visual[1] = { ...plan.tracks.visual[1], start_s: 8, end_s: 8.12 };
  const out = beatPreview(plan, { ...beat, transition_out: "crossfade" }, entry("AnimatedCounter"), {
    transitionSeconds: 0.5,
  });
  assert.deepEqual(out.transition, { type: "cut", duration_s: 0.1 });
  assert.deepEqual(out.playWindow, out.window);
});

test("the last shot of the video carries no hand-off at all", () => {
  const plan = planWith([]);
  const lastBeat: Beat = { ...beat, id: "b2", transition_out: "crossfade" };
  const out = beatPreview(plan, lastBeat, entry("AnimatedCounter"), { transitionSeconds: 0.5 });
  assert.equal(out.transition, null);
  assert.equal(out.plan.tracks.visual[1].transition_out, undefined);
});
