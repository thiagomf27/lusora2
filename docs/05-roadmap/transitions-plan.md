# Transitions — from 100% cuts to a placed mix

Today every junction in every video is a hard cut. All six style packs set
`transitions.default: cut`, the planner is deliberately not taught to emit
`transition_out` (D89), and the only way to get anything else is a human
choosing it per beat on the Review screen. The menu is also narrow: `cut`,
`crossfade`, `fade`, `fade_to_black` — and `crossfade` and `fade` draw the same
thing on both renderers, so it is three looks, all of them soft.

The reference point is VidRush's "~70/30 cuts to animated transitions". The
ratio is the easy half. What makes it read as editing rather than decoration is
**where** the 30% land: on the joints of the story, with the rest spread evenly
and never bunched.

**The rule everything here follows: the style pack declares the mix, the
compiler places it, arithmetically and deterministically. No model chooses a
transition** — D89 stands, and a human's `transition_out` on a beat always
wins.

Every new field is optional and its absence is today's behaviour, so a
snapshot taken before this plan re-runs byte-identically (Principle 7). Nothing
changes what a shipped channel produces until slice 4 turns it on per pack.

---

## The contract (settled before slicing)

`style_pack.transitions` grows five optional fields:

```jsonc
"transitions": {
  "allowed": ["cut", "crossfade", "whip", "fade_to_black", "wipe"],
  "default": "cut",
  "duration_s": 0.5,                            // existing (D89): fallback length
  "animated_share": 0.3,                        // NEW: target share of non-cut junctions
  "mix": { "whip": 3, "crossfade": 1 },         // NEW: weights for FILLER transitions
  "section_break": "fade_to_black",             // NEW: what a section change gets
  "durations": { "whip": 0.25, "fade_to_black": 0.8 },  // NEW: per-kind length
  "per_component": { "ChapterCard": "wipe" }    // NEW (slice 3): transition INTO an overlay's shot
}
```

Load-time rules (worker and platform, from one fixture table as
`transition_rules.json` already does):

- every kind named in `mix`, `section_break`, `durations` and `per_component`
  must be in `allowed`;
- `animated_share` is in `[0, 0.6]` — past ~60% a mix stops being a mix, and a
  cap is cheaper than an argument;
- `animated_share` without `mix` is refused: a share with nothing to fill it
  with is a pack bug, not a silent zero.

`look.exclude.transitions` (channel/video) already narrows `allowed` at
enqueue, and excluding the pack's `default` re-points it to a survivor rather
than refusing ("this channel never hard-cuts" is a look, not a mistake). The
placement fields follow the same rule: an excluded kind DROPS out of `mix`,
`section_break` and `durations` (and later `per_component`), and a mix left
empty takes `animated_share` with it.

### Placement order (the compiler, per junction)

A junction is the end of every visual item except the last. For each, the
first rule that fires wins:

1. **Human** — the beat's `transition_out` (D89), on the last shot of that
   beat. Unchanged.
2. **Overlay-tied** (slice 3) — `per_component` names the component of an
   overlay that starts at the NEXT shot's start (within 0.3 s). The transition
   INTO a shot is the previous item's `transition_out`, so that is where it is
   written — one owner per junction, as D89 requires.
3. **Section break** — `section_break`, on the beat-final junction nearest
   (within 1 s) to where the music's mood span changes (see "the section
   signal" below).
4. **Filler** — from `mix`, until the animated count reaches
   `round(animated_share × junctions)`.
5. Everything else is `default`.

Rules 1–3 count toward the share; filler only tops up. If 1–3 already exceed
the target, no filler is placed and nothing is removed.

**Filler placement** is deterministic and even, with no RNG:

- eligible junctions: beat-final (cuts inside one beat stay cuts — a split beat
  is one thought, and D89 already keeps those on the default), not already
  fixed by 1–3, not adjacent to an animated junction, and both neighbours long
  enough to hold the kind's duration without `_fit_transitions` degrading it
  (duration + 0.15 s);
- selection: spread `remaining` picks across the eligible list by error
  diffusion (pick when `floor((i+1)·remaining/len)` steps), skipping any pick
  the adjacency rule has since blocked;
- kind: smooth weighted round-robin over `mix` (the nginx upstream scheme), so
  the counts match the weights to within one and the heavy kind is spread out.
  Hashing each shot's id was tried first and dropped: over ~30 picks it turned
  a 1:1 mix into 10:19 and ran six of one kind together. A "no repeat" rule
  was dropped too — any such rule caps the heavy kind, so the weights stop
  meaning anything.

**The section signal.** `faceless_v3` persists no sections: `cut_beats` +
`beatcraft` never produce any, and the planner spine only exists in the older
pipelines. What every beat does carry is `mood`, and the music bed switches
where the mood SPAN changes (D48). The breaks use exactly those spans —
`sound.mood_spans` with the pack's `music.min_span_s` — so a transition lands
with the music, and a one-beat mood blip (which the music absorbs) does not
make two breaks. In `faceless_directed`, `edit_hints.sections` already become
moods, so the same signal covers it. Moods go through `sound.normalize_mood`,
so an unknown word never manufactures a break.

**Where it is written.** The compiler writes the edit plan's
`visual[].transition_out`, never `beats.json`: the beat field stays the human
override it is today. A placed transition carries `placed_by`
(`section_break` | `filler`) in the plan, which renderers ignore. The Review
screen reads it: "Hands over" says "(auto)" for a placed transition, and the
beat preview keeps a placed one instead of re-deriving the default — without
it, the preview showed a cut on every placed junction and could not tell a
placed transition from a stale human one the form had cleared.

---

## Slice 1 — the contract and placement, existing kinds only — DONE

> **DONE 2026-09-25 (D95).** Built as below, with three changes found on the
> way: `look.exclude` drops excluded kinds rather than refusing; filler kinds
> use weighted round-robin, not a hash; and the plan carries `placed_by` so
> the Review preview stops showing placed transitions as cuts. No shipped pack
> sets the new fields yet, so no production output changed. Not yet checked
> on a real render: the Style Packs form fields were typechecked, not clicked
> through.

Proves the mechanism with the three kinds both renderers already draw, before
any engine work.

- `contracts/schemas/style_pack.schema.json` — the five fields (without
  `per_component` yet), with descriptions carrying the rules above.
- `contracts/src/types.ts`, `contracts/fixtures/style_pack.json`.
- `contracts/fixtures/rules/transition_rules.json` — pack-level cases (share
  without mix, a mix kind outside `allowed`, section_break excluded by `look`).
- `worker/lusora_worker/compiler/transitions.py` (new) —
  `place_transitions(visual, beats_by_id, beat_times, style, on_note)`. Pure, like
  the rest of the compiler.
- `worker/lusora_worker/compiler/core.py` — `_visual_item` keeps writing the
  default and the human override; `place_transitions` runs after overlays are
  compiled, and **`_fit_transitions` moves after it** (today it runs before
  overlays exist, line ~147). Per-kind `durations` are applied there.
- `worker/lusora_worker/validators.py` + `platform/test/transitionRules.test.ts`
  — the new rules.
- `platform/src/components/StylePackFields.tsx` — share slider, mix weights,
  section_break select, per-kind durations.
- A plan-level stat, `animated_share_achieved`, as a compiler note and in
  `ab_report.py`: the share asked for and the share delivered differ (short
  shots degrade to cuts), and the gap is what tells an author their pack is
  too fast for its own mix.

Tests (`worker/tests/test_transitions.py`): absent fields → identical
plan to today; share hit within ±1 junction on a 60-junction fixture; never
two animated junctions adjacent; human override beats everything; section
break on every mood change and nowhere else; recompile of the same input is
byte-identical; a too-short neighbour never receives filler.

## Slice 2 — five new kinds

`whip`, `zoom_through`, `push`, `wipe`, `flash`, with an optional
`direction` (`left | right | up | down`) on the edit plan's transition object.

| kind | Remotion | ffmpeg `xfade` |
|---|---|---|
| `push` | stock `slide()` | `slideleft` / `slideright` / … |
| `wipe` | stock `wipe()` | `wipeleft` / … |
| `flash` | custom, same pattern as `fade_to_black` (dip to white) | `fadewhite` |
| `zoom_through` | custom: outgoing scales up and fades, incoming settles from 1.1 | `zoomin` |
| `whip` | custom: horizontal translate + directional blur on both sides | **none** — Remotion-only |

`whip` has no faithful ffmpeg equivalent (`smoothleft`/`hblur` read as a
smear, not a whip), so it is registered Remotion-only in `engine/src/router.ts`
rather than approximated. In practice this costs nothing: any plan with a
catalog overlay already routes to Remotion, so the ffmpeg path only draws
overlay-free plans.

**Direction** is the compiler's, not the pack's: `push` and `whip` alternate
left/right per use (a run of three pushes the same way reads like a slideshow);
`wipe` keeps `left`. A human can still set it in the editor.

Files: the kind enum in `style_pack`, `beat_sheet`, `edit_plan`,
`channel_config` (`look.exclude`) and `renderer_interface.json`;
`contracts/src/types.ts`; `engine/src/renderers/remotion/timeline.ts`
(`TransitionKind`), `transitions.tsx`, `engine/src/renderers/ffmpeg/render.ts`
(the xfade map), `engine/src/router.ts` (`FFMPEG_TRANSITIONS`);
`platform/src/components/LookThumbs.tsx` (a drawn thumb per kind),
`review/page.tsx` (`TRANSITION_LABEL`), `editor-seed/.../PropertiesPanel.tsx`.

Checks: `engine/test/timeline.test.ts` per kind; one fixture plan with every
kind rendered on both paths and compared frame-by-frame at the midpoint of each
transition (not pixel-equal — same shape); `pipeline/qa.py` run on it, since
`flash` produces white frames and a 0.8 s `fade_to_black` holds black longer
than today's 0.5 s — the black-hold check (qa.py ~184) must not fire on a
transition the plan declared.

## Slice 3 — overlay-tied transitions and per-transition sound

- `style_pack.transitions.per_component` (rule 2 above). An overlay that
  starts mid-shot gets nothing and a compiler note says so ("ChapterCard at
  41.2 s starts 1.8 s into v_b12; per_component wipe not applied"), so an
  author sees why. Cutting the shot at the overlay's start instead is the more
  powerful answer and is deferred (below).
- `theme.sound.per_transition` — kind → cue, falling back to
  `sound.transition`, then to none. Mirrors `per_entrance`. In
  `worker/lusora_worker/compiler/sound.py` `compile_sfx` resolves the cue by
  `transition_out.type`. The existing density thinning (`_thin_sfx`) keeps a
  30% share from becoming a whoosh every ten seconds.
- `docs/03-contracts/sound.md`, `theme-and-style.md`.

## Slice 4 — turn it on in the shipped packs

The only slice that changes what a production channel renders, so it goes
last, one pack at a time, each with a rendered check.

| pack | share | mix | section_break |
|---|---|---|---|
| `doc-slow`, `archive-doc` | 0.15 | crossfade | fade_to_black |
| `descoberta-doc` | 0.2 | crossfade 2, push 1 | fade_to_black |
| `listicle-fast` | 0.35 | whip 2, push 1 | wipe |
| `breakdown-blitz` | 0.3 | zoom_through 2, whip 1 | flash |
| `directed-test` | — unchanged | | |

`directed-test` stays untouched: it is one arm of an A/B (D94), and changing
it mid-test invalidates the comparison. The table is the adopted starting
point (settled below); each pack is then judged by eye on a render, not tuned
in the abstract.

---

## Decision entry

One new Decision Log entry (D95) at slice 1, extended at slices 2 and 3:
transitions are placed by the compiler from the pack's declared mix; the
section signal is a mood change; `per_component` lives on the style pack (the
pack owns the transition menu), not the theme (which owns an overlay's own
entrance, `motion.per_component` — already able to make a ChapterCard wipe
in).

## Order and cost

| slice | size | changes production output? |
|---|---|---|
| 1 — contract + placement | ~1 day | no (all fields optional) |
| 2 — five new kinds | ~1.5 days (three custom presentations) | no |
| 3 — overlay-tied + sound | ~0.5 day | no |
| 4 — enable per pack | ~0.5 day + renders | **yes** |

## Deferred on purpose

- **A model choosing transitions.** D89's condition still holds: no ground
  truth says a model chooses well, and D85 measured what a model does with a
  field it has no taste for.
- **Cutting a shot at an overlay's start** so any overlay can own a transition.
  Changes shot boundaries, which moves asset resolution and the hold rules.
- **`glitch`, `iris`, `cube`, `flip`, `spin`.** Dated or gimmicky; every kind
  in `allowed` is one more thing a pack author can misuse.
- **Ken Burns variety.** Every still gets `ken_burns in center 0.12`
  (`core.py` `_visual_item`). Same shape of fix — a pack-declared motion mix,
  placed deterministically — but a separate plan.

## Settled (2026-09-25)

1. **A mood change is the section signal.** No `section_start` field from
   `beatcraft`: the plan stays free of model output.
2. **The slice 4 table is the starting point.** Adopted as written, then
   judged by eye on each pack's render; a number moves only on what a render
   shows.
