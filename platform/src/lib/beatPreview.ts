/**
 * The plan to mount when previewing ONE beat.
 *
 * The preview is the real composition — the same `VideoComposition` the
 * renderer runs, over the real plan — so nothing here builds a picture of a
 * beat. It does one thing: put the overlay the FORM currently holds into the
 * plan, so a component picked a second ago can be seen before a compile has
 * placed it. Everything else (the shot, its motion, the transition into the
 * next one, the captions, the voiceover, music and cues) is already in the
 * plan and is passed through untouched.
 *
 * The placement of a draft overlay mirrors `_compile_overlay`: 0.4s after the
 * beat opens, held for the catalog's own duration. The compiler can push that
 * later — up to the moment the narration actually SAYS the overlay's subject,
 * which needs the word timeline — so a draft placement is the floor, and the
 * screen says so rather than pretending the timing is settled.
 */
import type {
  Beat,
  CatalogEntry,
  EditPlan,
  OverlayItem,
  Transition,
  VisualItem,
} from "@lusora/contracts";
import { resolveOverlayProps, type ResolvedOverlayProps } from "./overlayProps.ts";

export interface BeatPreview {
  /** The plan to mount, with this beat's overlay as the form has it. */
  plan: EditPlan;
  /** The beat's span in the plan's timeline, across every item it produced. */
  window: { start_s: number; end_s: number } | null;
  /**
   * What the player should PLAY: the beat, plus the hand-off past its cut.
   *
   * A transition is drawn in the handle appended AFTER the narrative cut, so a
   * window that stops at the beat's end stops just before the one thing the
   * hand-off control changes. The tail is the transition's own length and
   * nothing more, so this is still the beat rather than the beat and its
   * neighbour.
   */
  playWindow: { start_s: number; end_s: number } | null;
  /** The hand-off this beat ends on, after the pack default and the clamp. */
  transition: Transition | null;
  /** ...and it is one WE applied, because the form disagrees with the plan. */
  transitionDraft: boolean;
  /** The overlay on screen is not the compiled one — the form has changed it. */
  overlayDraft: boolean;
  /** ...and WE had to place it in time too, so its timing is provisional. */
  timingDraft: boolean;
  /** Which props came from the anchor, which are stand-ins, what is wrong. */
  props: ResolvedOverlayProps | null;
}

/** Key-order-independent comparison, for "are these the same props". */
function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}

/**
 * Put the hand-off the FORM holds onto the beat's last shot, the way the
 * compiler would (D89).
 *
 * Mirrors `_beat_transition` and `_fit_transitions`: the kind is the beat's
 * when it names one and the pack's default otherwise; the length is the
 * pack's; it is trimmed against the shots on both sides and degrades to a cut
 * when neither can spare the footage; and the last item of the video carries
 * none at all, because it has no junction.
 */
function applyTransition(
  visual: VisualItem[],
  beat: Beat,
  seconds: number,
  fallback: Transition["type"]
): { visual: VisualItem[]; transition: Transition | null; changed: boolean } {
  const last = visual.reduce<number>((best, v, i) => (v.beat_id === beat.id ? i : best), -1);
  if (last < 0) return { visual, transition: null, changed: false };
  const was = visual[last].transition_out ?? null;

  // nothing follows the final shot, so nothing can be drawn there
  if (last === visual.length - 1) {
    if (!was) return { visual, transition: null, changed: false };
    const next = [...visual];
    next[last] = { ...next[last], transition_out: undefined };
    return { visual: next, transition: null, changed: true };
  }

  const kind = beat.transition_out ?? fallback;
  const here = visual[last].end_s - visual[last].start_s;
  const after = visual[last + 1].end_s - visual[last + 1].start_s;
  const room = Math.round((Math.min(here, after) - 0.05) * 1000) / 1000;
  const wanted: Transition =
    kind === "cut"
      ? { type: "cut", duration_s: 0.1 }
      : room < 0.1
      ? { type: "cut", duration_s: 0.1 }
      : { type: kind, duration_s: Math.min(seconds, room) };

  const same = was && was.type === wanted.type && (was.duration_s ?? 0) === wanted.duration_s;
  if (same) return { visual, transition: was, changed: false };
  const next = [...visual];
  next[last] = { ...next[last], transition_out: wanted };
  return { visual: next, transition: wanted, changed: true };
}

export function beatPreview(
  plan: EditPlan,
  beat: Beat,
  entry: CatalogEntry | null,
  options: {
    fallback?: Record<string, unknown>;
    /** The pack's own transition length (D89); the beat never sets it. */
    transitionSeconds?: number;
    /** The pack's default kind, for a beat that names none. */
    defaultTransition?: Transition["type"];
  } = {}
): BeatPreview {
  const mine = plan.tracks.visual.filter((v) => v.beat_id === beat.id);
  const window = mine.length
    ? {
        start_s: Math.min(...mine.map((v) => v.start_s)),
        end_s: Math.max(...mine.map((v) => v.end_s)),
      }
    : null;

  const handoff = applyTransition(
    plan.tracks.visual,
    beat,
    options.transitionSeconds ?? 0.5,
    options.defaultTransition ?? "cut"
  );
  // The plan every branch below builds on already carries the hand-off.
  plan = handoff.changed
    ? { ...plan, tracks: { ...plan.tracks, visual: handoff.visual } }
    : plan;
  const transition = handoff.transition;
  // Play past the cut by exactly the transition, so the hand-off is on screen.
  const playWindow =
    window && transition && transition.type !== "cut"
      ? { ...window, end_s: window.end_s + (transition.duration_s ?? 0.5) }
      : window;
  const shared = { window, playWindow, transition, transitionDraft: handoff.changed };

  const compiled = plan.tracks.overlays.filter((o) => o.beat_id === beat.id);
  const others = plan.tracks.overlays.filter((o) => o.beat_id !== beat.id);

  // No overlay on the beat: the compiled one, if any, must go — the point of
  // the preview is to show what the next render will draw.
  if (!beat.overlay || !entry) {
    if (compiled.length === 0)
      return { plan, ...shared, overlayDraft: false, timingDraft: false, props: null };
    return {
      plan: { ...plan, tracks: { ...plan.tracks, overlays: others } },
      ...shared,
      overlayDraft: true,
      timingDraft: false,
      props: null,
    };
  }

  const props = resolveOverlayProps(beat, entry, {
    captionsEnabled: plan.tracks.captions?.enabled ?? false,
    fallback: options.fallback ?? {},
  });

  // Unchanged since the compile: show what the compiler actually produced,
  // timing and all. Only a difference is worth re-deriving.
  const was = compiled.length === 1 ? compiled[0] : null;
  const same = was?.component === beat.overlay.component && stable(was.props ?? {}) === stable(props.props);
  if (same) return { plan, ...shared, overlayDraft: false, timingDraft: false, props };

  // The SAME component, with different props, keeps the timing the compiler
  // gave it. That timing is the one thing here we cannot reproduce — the
  // compiler moves an overlay onto the moment the narration says its subject,
  // which needs the word timeline — so re-deriving it because a prop changed
  // (or because the catalog gained a prop since this plan was compiled, which
  // is the common case on a plan a few days old) would replace a real answer
  // with an approximation for no reason.
  const keepsTiming = was?.component === beat.overlay.component;
  const hint = entry.duration_hint_s ?? {};
  const start = keepsTiming
    ? was.start_s
    : window
    ? Math.round((window.start_s + 0.4) * 1000) / 1000
    : 0;
  const hold = Math.max(hint.default ?? 4, hint.min ?? 1);
  const end = keepsTiming
    ? was.end_s
    : Math.max(Math.round((start + hold) * 1000) / 1000, start + 0.5);
  const item: OverlayItem = {
    id: was?.id ?? `o_${beat.id}`,
    beat_id: beat.id,
    locked: false,
    kind: "component",
    component: beat.overlay.component,
    props: props.props,
    start_s: start,
    end_s: end,
    ...(entry.template ? { template: entry.template } : {}),
  };
  return {
    plan: {
      ...plan,
      tracks: {
        ...plan.tracks,
        // start-sorted, like the compiler's own track
        overlays: [...others, item].sort((a, b) => a.start_s - b.start_s),
      },
    },
    ...shared,
    overlayDraft: true,
    timingDraft: !keepsTiming,
    props,
  };
}
