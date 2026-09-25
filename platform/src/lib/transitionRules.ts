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
import type { Beat, StylePack, TransitionType } from "@lusora/contracts";

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

/**
 * What is wrong with a style pack's transitions block beyond what the schema
 * can say (D95): every kind a mix, section break or duration names must be
 * allowed, and a share needs a mix to fill it. The worker's
 * `compiler/transitions.pack_problems` is the twin, and the `pack_cases` in
 * transition_rules.json hold both to the same answers.
 */
export function transitionPackProblems(transitions: StylePack["transitions"]): string[] {
  const allowed: string[] = transitions.allowed ?? [];
  const problems: string[] = [];
  const fmt = JSON.stringify(allowed);
  const def = transitions.default ?? "cut";
  if (allowed.length && !allowed.includes(def)) {
    problems.push(`default transition '${def}' is not in allowed ${fmt}`);
  }
  const mix = transitions.mix ?? {};
  if (transitions.animated_share && Object.keys(mix).length === 0) {
    problems.push("animated_share needs a mix to fill it — name at least one kind in transitions.mix");
  }
  for (const kind of Object.keys(mix)) {
    if (!allowed.includes(kind)) problems.push(`transitions.mix names '${kind}', which is not in allowed ${fmt}`);
  }
  const section = transitions.section_break;
  if (section && !allowed.includes(section)) {
    problems.push(`transitions.section_break '${section}' is not in allowed ${fmt}`);
  }
  for (const kind of Object.keys(transitions.durations ?? {})) {
    if (!allowed.includes(kind)) {
      problems.push(`transitions.durations names '${kind}', which is not in allowed ${fmt}`);
    }
  }
  return problems;
}

/**
 * D95 — carry a narrowed `allowed` into the placement fields, by the same rule
 * look.ts applies to the default: excluding a kind is a look, so the fields
 * that NAME it drop it rather than the enqueue being refused. An excluded mix kind leaves the mix;
 * a mix left empty takes the share with it (a share with nothing to fill it is
 * a pack the compiler refuses); an excluded section break means section
 * changes get the default like any other junction. Used by `applyLook` at
 * enqueue and by the Style Packs form when a kind is unticked.
 */
export function narrowTransitionPlacement(transitions: Record<string, any>, allowed: string[]): void {
  if (transitions.mix) {
    const mix = Object.fromEntries(
      Object.entries(transitions.mix).filter(([kind]) => allowed.includes(kind))
    );
    if (Object.keys(mix).length) {
      transitions.mix = mix;
    } else {
      delete transitions.mix;
      delete transitions.animated_share;
    }
  }
  if (transitions.section_break && !allowed.includes(transitions.section_break)) {
    delete transitions.section_break;
  }
  if (transitions.durations) {
    for (const kind of Object.keys(transitions.durations)) {
      if (!allowed.includes(kind)) delete transitions.durations[kind];
    }
    if (Object.keys(transitions.durations).length === 0) delete transitions.durations;
  }
}
