/**
 * The transition rules, on the platform side (D89).
 *
 * A beat names the transition it HANDS OVER with, and the kind has to be one
 * this video can actually draw: the compiler passes it through to the plan and
 * the renderer degrades anything it cannot draw to a hard cut — silently. So
 * an illegal kind saved from the editor is not an error anyone sees, it is a
 * video that came out wrong. Same shape and same reason as overlayRules.ts.
 *
 * `contracts/fixtures/rules/transition_rules.json` is the shared expectation
 * table: worker/tests/test_validators.py and platform/test/transitionRules.test.ts
 * assert the same cases against the two implementations, so they cannot drift.
 */
import type { Beat, TransitionType } from "@lusora/contracts";

export interface TransitionPolicy {
  /** Kinds this video's style pack allows, after look.exclude narrowed it.
   *  Null/empty means the pack said nothing and nothing is checked. */
  allowed?: TransitionType[] | null;
}

/** Read the policy out of a video's frozen cfg snapshot. */
export function transitionPolicy(cfg: unknown): TransitionPolicy {
  const transitions =
    ((cfg as { style_pack_doc?: { transitions?: { allowed?: TransitionType[] } } } | null)
      ?.style_pack_doc?.transitions ?? {}) as { allowed?: TransitionType[] };
  return { allowed: transitions.allowed ?? null };
}

/** Every problem with one beat's transition. Empty when it is legal. */
export function validateTransition(beat: Beat, policy: TransitionPolicy): string[] {
  const named = beat.transition_out;
  if (!named) return []; // the pack's default, which is what every beat had
  if (!policy.allowed || policy.allowed.length === 0) return [];
  if (policy.allowed.includes(named)) return [];
  return [
    `beat ${beat.id}: transition '${named}' is not in the style pack's allowed transitions ` +
      JSON.stringify(policy.allowed),
  ];
}

/** Every transition problem in a sheet. */
export function validateTransitions(beats: Beat[], policy: TransitionPolicy): string[] {
  return beats.flatMap((beat) => validateTransition(beat, policy));
}
