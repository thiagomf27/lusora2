import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Beat, TransitionType } from "@lusora/contracts";
import { transitionPolicy, validateTransition } from "../src/lib/transitionRules.ts";
import { repoRoot } from "../src/lib/env.ts";

/**
 * D89. The cases come from contracts/fixtures/rules/transition_rules.json and
 * worker/tests/test_validators.py asserts the same table against the Python
 * implementation, so the editor route and the pipeline judge a transition by
 * one set of rules.
 */
interface RuleCase {
  name: string;
  transition_out?: TransitionType;
  allowed_transitions?: TransitionType[];
  expect: string[];
}

const table = JSON.parse(
  readFileSync(join(repoRoot(), "contracts/fixtures/rules/transition_rules.json"), "utf8")
) as { cases: RuleCase[]; default_allowed: TransitionType[] };

function beatWith(transition?: TransitionType): Beat {
  return {
    id: "b1",
    kind: "narration",
    script_text: "The port fed the capital.",
    visual_intent: "aerial harbour, 1940s",
    ...(transition ? { transition_out: transition } : {}),
  };
}

for (const c of table.cases) {
  // the schema case is the worker's to make: this function is handed a Beat
  if (c.expect.includes("transition_out")) continue;
  test(`shared transition rules — ${c.name}`, () => {
    const cfg = {
      style_pack_doc: {
        transitions: { allowed: c.allowed_transitions ?? table.default_allowed, default: "cut" },
      },
    };
    const problems = validateTransition(beatWith(c.transition_out), transitionPolicy(cfg));
    if (c.expect.length === 0) {
      assert.deepEqual(problems, [], c.name);
      return;
    }
    for (const needle of c.expect) {
      assert.ok(
        problems.some((p) => p.includes(needle)),
        `${c.name}: expected a problem containing "${needle}", got ${JSON.stringify(problems)}`
      );
    }
  });
}

test("a snapshot that names no transitions checks nothing", () => {
  assert.deepEqual(validateTransition(beatWith("fade_to_black"), transitionPolicy({})), []);
});
