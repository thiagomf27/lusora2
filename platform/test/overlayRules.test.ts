import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Beat } from "@lusora/contracts";
import { overlayPolicy, overlayRole, validateOverlay } from "../src/lib/overlayRules.ts";
import { componentMenu } from "../src/lib/catalog.ts";
import { repoRoot } from "../src/lib/env.ts";

/**
 * Slice 7. The worker's validator has always applied these rules; the editor
 * route did not, so an illegal overlay written by the chat agent reached
 * beats.json and stopped the video at compile.
 *
 * The cases come from contracts/fixtures/rules/overlay_rules.json and
 * worker/tests/test_validators.py asserts the same table against the Python
 * implementation, so the two cannot drift.
 */
interface RuleCase {
  name: string;
  overlay: Record<string, unknown>;
  allowed_components?: string[];
  expect: string[];
}

const rules = JSON.parse(
  readFileSync(join(repoRoot(), "contracts/fixtures/rules/overlay_rules.json"), "utf8")
) as { cases: RuleCase[] };

function beatWith(overlay: Record<string, unknown>): Beat {
  return {
    id: "b2",
    kind: "narration",
    script_text: "Nearly 70% of all grain passed through it.",
    visual_intent: "dock workers unloading sacks",
    anchors: [
      { type: "percentage", value: 70, label: "of grain", source_words: "Nearly 70%" },
    ],
    overlay,
  } as unknown as Beat;
}

for (const rule of rules.cases) {
  test(`overlay rules: ${rule.name}`, () => {
    const problems = validateOverlay(beatWith(rule.overlay), {
      allowed: rule.allowed_components ?? null,
      emphasisEnabled: false,
    });
    if (rule.expect.length === 0) {
      assert.deepEqual(problems, [], rule.name);
      return;
    }
    for (const needle of rule.expect) {
      assert.ok(
        problems.some((p) => p.includes(needle)),
        `${rule.name}: expected a violation containing "${needle}", got ${JSON.stringify(problems)}`
      );
    }
  });
}

test("an overlay naming an unknown component never reaches beats.json", () => {
  const problems = validateOverlay(beatWith({ component: "HoloProjector" }), {});
  assert.ok(problems.some((p) => p.includes("not in catalog")));
});

test("a legal chat overlay still applies — the fix must not over-reject", () => {
  const problems = validateOverlay(
    beatWith({ component: "AnimatedCounter", anchor_ref: 0, props_hint: { label: "of grain" } }),
    { allowed: ["AnimatedCounter"], emphasisEnabled: false }
  );
  assert.deepEqual(problems, []);
});

test("a timed beat's overlay is outside the class system (D86)", () => {
  // no script_text, so no anchor is possible and every overlay on one is pure
  // text by construction — gating it on the emphasis class would un-make D58's
  // cold open on six of the seven shipped packs
  const cold = {
    id: "b0",
    kind: "timed",
    timing: { start_s: 0, end_s: 4.5 },
    visual_intent: "slow push-in on a bombed cathedral",
    overlay: { component: "KineticTitle", props_hint: { text: "February 1945" } },
  } as unknown as Beat;
  assert.deepEqual(validateOverlay(cold, { emphasisEnabled: false }), []);
});

test("the class is derived from the catalog, not from what the sheet declares", () => {
  const hammer = { component: "HammerStatement", role: "anchor" as const };
  assert.equal(
    overlayRole(hammer, { name: "HammerStatement", anchor_types: [] } as never),
    "emphasis"
  );
});

test("overlayPolicy reads the frozen cfg the worker reads", () => {
  const policy = overlayPolicy({
    style_pack_doc: {
      overlays: { allowed_components: ["StatTag"], emphasis: { enabled: true } },
    },
  });
  assert.deepEqual(policy.allowed, ["StatTag"]);
  assert.equal(policy.emphasisEnabled, true);
  // a video with no snapshot must not be locked out of every component
  assert.deepEqual(overlayPolicy(null), { allowed: null, emphasisEnabled: false });
});

test("the chat menu is the channel's menu, not the whole catalog", () => {
  const channel = componentMenu(["AnimatedCounter", "StatTag"], { props: true });
  assert.ok(channel.includes("AnimatedCounter"));
  assert.ok(!channel.includes("QuoteBlock"), "a component the channel never installed");
  assert.ok(componentMenu(null, { props: true }).includes("QuoteBlock"));
});
