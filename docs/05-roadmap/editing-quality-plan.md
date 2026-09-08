# Editing Quality — the plan after v3

> **Status 2026-09-08:** all nine slices worked through in one pass; see the
> note under each. Two things to carry: no provider spend was authorised, so
> slices 2, 4 and 6 landed on code and argument with their exit criteria
> UNMEASURED and the commands recorded in `evals/BASELINE.md`; and slice 0
> found a defect in `cut_beats` big enough to have been worth the whole probe
> on its own.

`faceless_v3` is production (D84) and it is better than v1 on the thing that
matters: recall roughly doubled on four reference cases and the component
vocabulary went from 10 of 29 to 20. This plan is what is wrong with the
pipeline *now*, in the order it is worth fixing.

Read [LLM Usage](../02-components/llm-usage.md) for what each prompt owes its
downstream, and `evals/BASELINE.md` for every number quoted here.

---

## The ordering rule

**Nothing creative is judged before the instrument that judges it.**

This repo has already paid for that lesson twice. Slice 2 of the v3 plan landed
with "quality NOT established, in either direction" because the noise floor was
wider than any effect it could have. Slice 3 failed its exit criterion and then
turned out to be confounded. The v3 plan's whole premise — "the model cannot
stop placing overlays" — was **inverted** the day four reference cases replaced
two self-marked ones. And the defect that actually killed a video (a wordy
anchor label failing the compile) was invisible to twenty-four scored runs,
because the scorer reads beat sheets and never compiles them.

So the instrument comes first, then the structural gate, then the creative work.
A slice that moves no score is still a result and gets a row in
`evals/BASELINE.md`.

---

## Slice 0 — the probe that may reorder this plan
> **DONE 2026-09-08 — and it never reached its own question.** Cutting the fixture found `cut_beats` ignoring its own ceiling on three of the four reference cases (a 19.2s shot on a 10s pack); that is fixed and every case now sits inside its pack's window. The long-form question itself is **still open**: the one live call's result was lost to a bug in the probe script and no further provider spend was authorised. See `evals/BASELINE.md`.


**One run, no code.** Enqueue a 10-minute script on `faceless_v3` with
`breakdown-blitz` (avg hold 2.4s, ceiling 4.5s → 130–250 cuts) and watch
`plan_beats` and `select_overlays`.

Every eval case is 116–538 words. The production path has never been exercised
above about three and a half minutes, and `beatcraft.craft_beats` sends **every
cut in one call**. If that call truncates or degrades, Slice 2 is the top of
this plan and everything below it waits.

Record the outcome in `evals/BASELINE.md` either way: "it held at 250 cuts" is
as useful as the failure.

---

## Slice 1 — the instrument can tell a better cut from a busier one
> **DONE 2026-09-08, partially.** The scorer compiles what it scores and reports rule breaches beside restraint rather than inside it. `cnbc-ref` was re-marked only where BASELINE.md already recorded a watched verdict (m26-m28 → `Timeline`), which moved v3's component accuracy on that case 33.3 → 66.7. **Three cases have never been re-marked** and `cnbc-ref` has had three marks touched, so `component_accuracy` is still "does the planner reach for exhibits" rather than an accuracy number.


**Why.** `evals/BASELINE.md` says it plainly: of the four axes, two were
measuring the ground truth rather than the model when v3 was scored.
`component_accuracy` is only as good as each mark's `acceptable[]`, and
`cnbc-ref`'s marks were written by someone expecting counters, before anyone had
seen the material rendered — so `BulletList` over "three different segments" and
`StepFlow` over the supply chain scored as errors for being right.
`restraint` counts every unmarked graphic as a cost and never asks whether the
graphic is good, which is correct for a 57s doc with a budget of four and wrong
for a three-minute breakdown.

**What changes.**

1. **Re-mark `cnbc-ref`** against what the reference video actually shows, by
   someone who has watched `vid_ovl_v3_cnbc`. `acceptable[]` lists every
   component that would be a defensible cut, not the one the marker first
   thought of. `docs/10-overlay-marks.md` is the authoring prompt.
2. **The scorer compiles.** `worker/lusora_worker/evals/` runs `compile_plan`
   on every sheet it scores and reports a compile failure as its own axis. A
   sheet that cannot become an edit plan is not a 75%-recall sheet, it is a dead
   video, and no current number says so.
3. **Restraint splits in two.** Keep the count, and separate "an overlay on an
   unmarked moment" from "an overlay that breaks a rule" (budget, adjacency,
   duplicate subject). Only the second is unambiguously a cost.

**Exit criterion.** Re-score the v3 arm already on disk — no new provider spend.
The `cnbc-ref` component-accuracy number moves, and the direction is explainable
mark by mark. The compile axis reproduces the baseline video's failure.

**Decision-log entry.** Yes — what the four axes now mean, and that
`acceptable[]` is a list of defensible cuts rather than one expected answer.

---

## Slice 2 — the production path handles a long script
> **DONE 2026-09-08, NOT MEASURED.** `beatcraft` and `select_overlays` chunk on `planner.chunk_target_beats`; the 217-cut fixture goes out as 8 calls of ~28 instead of one all-or-nothing JSON. Built on the structural argument rather than on the probe, because the probe's measurement was lost. No spine pass, and the reason is recorded: the cuts are already numbered, so there is no partition left to choose.


**Why.** [planner.py:56](../../worker/lusora_worker/agents/planner.py#L56) states
the rule in the repo's own words: a single call comfortably handles 20–30 beats,
and above that you split "rather than risk truncation or degraded quality on one
huge call." `craft_beats` splits nothing. Every piece of long-form machinery
D52 built — the spine pass, `carry_forward`, `visual_ledger`,
`chunk_target_beats` — lives in `planner.py`, which v3 bypasses the moment
`beat_cuts.json` exists. `select_overlays` sends all candidates in one call too.

Two consequences, one silent: a long video is one enormous call nobody has
measured, and `channel.planner.chunk_target_beats` is a config knob that does
nothing on the production pipeline without saying so.

**What changes.** Scoped by Slice 0's result.

- *If the probe held:* record the ceiling it held to, and make the dead knob
  honest — either wire it or reject it at load with a message naming v3.
- *If the probe failed:* chunk `beatcraft` by cut index. It is a cheaper problem
  than the planner's was, because the cuts are already numbered and already
  timed: a chunk is a contiguous index range, `carry_forward` is the previous
  chunk's last two answers, and the `visual_ledger` is the intents already used.
  The spine pass has no obvious role here — the cuts are decided in code, so
  there is no partition left for it to choose — and reusing it would be
  borrowing a mechanism for a question it does not answer. Say so in the
  decision entry rather than porting it by reflex.
- Either way `select_overlays` gets the same treatment or the same recorded
  ceiling.

**Exit criterion.** A 10-minute script produces a beat sheet and an overlay
selection with no truncation, no repair-loop exhaustion, and a token cost that
scales roughly linearly with length rather than falling off a cliff.

**Decision-log entry.** Yes, if chunking lands.

---

## Slice 3 — the script's output is checked like everything else
> **DONE 2026-09-08.** `validate_script` plus one repair attempt. Its evidence is the corpus, not an eval: three shipped videos carry `*Alcedo*` in `script.txt`, so the TTS read the asterisks aloud. The six eval scripts are clean and a test pins them that way.


**Why.** [steps.py:62](../../worker/lusora_worker/pipeline/steps.py#L62) writes
the model's text straight to `script.txt` with no validation of any kind. It is
the last unguarded seam in a pipeline that validates everything else three
times, and it is the most upstream one: a stray `**bold**`, a `Narrator:` label,
a markdown heading or an emoji goes to the TTS *and* becomes the verbatim span
text every downstream stage rests on. The welded half already forbids all of it
([script.system.txt](../../contracts/prompts/welded/script.system.txt)) —
nothing checks that the model listened.

**What changes.** A `validate_script` in `validators.py` returning violation
strings in the same shape every other validator uses: no markdown emphasis or
headings, no speaker labels, no bracketed stage directions, no emoji, non-empty,
and within a generous multiple of `target_words`. Feed it through **one** repair
attempt — not three; this is a formatting slip, and a model that ignores the
correction twice is a prompt problem, not a sampling problem.

**Exit criterion.** A deliberately dirty script (headings, `Narrator:`, an
emoji) is caught and repaired on one attempt, and the existing eval scripts pass
untouched.

---

## Slice 4 — the selector can see the shot it is decorating
> **DONE 2026-09-08, NOT MEASURED.** Each candidate now names the shot planned for it and the decline rule asks about that instead of about footage that does not exist yet. The exit criterion needs a fresh run per case — the sheets on disk were made by the old prompt, and what changed is what the model is shown.


**Why.** The overlay prompt's first decline rule is *"the footage already
carries the fact — the ledger is on screen, do not caption it"*, and worked
example 2 declines a nameplate because the company name is on the plant
exterior. `select_overlays` runs **two stages before** `resolve_assets`, so no
footage exists. Worse,
[overlay.py:83](../../worker/lusora_worker/agents/overlay.py#L83) renders
`beat.get("script_text") or beat.get("visual_intent")` — a narration beat always
has `script_text`, so `visual_intent` is **never shown**. The one field that
would let the model apply its own rule is sitting in `beats.json` and withheld.
As written the rule can only be satisfied by invention.

**What changes.** Show the beat's `visual_intent` in the candidate block
alongside its span, and rewrite the decline rule to describe what is actually
knowable: the shot this beat has been *planned* to show, not footage that has
been sourced. The rule is a good rule — it is aimed at the wrong tense.

**Exit criterion.** Re-score with Slice 1's instrument on the arm already on
disk plus one fresh run per case. Precision and the split restraint number are
the axes this should move; recall should not fall.

---

## Slice 5 — an overlay never renders below its own readable minimum
> **DONE 2026-09-08.** A collision is resolved by dropping the later graphic with a logged reason rather than squeezing both; running out of video is deliberately not a collision. `validate_plan` carries the same check for hand-edited plans, scoped so it cannot fire on the compiler's own output. The minimum-SPACING question stays open, as planned, until the instrument can tell a dense cut from a busy one.


**Why.** `_trim_overlay_holds`
([core.py:665](../../worker/lusora_worker/compiler/core.py#L665)) clamps an
overlay to `next.start - 0.2` with a hard floor of `start + 0.5`, and
`validate_plan` never compares the result against the catalog's
`duration_hint_s.min`. `validate_overlay_selection` enforces a global density
budget and **no adjacency rule at all** — two consecutive beats may both be
selected. The catalog says a `DataTable` needs 4s and a `Timeline` 4s; the
compiler will happily hand either 0.5s and the plan will pass every check.

Not yet firing, and close. Across the eight shipped plans two overlays are
already trimmed, one `StatTag` to 2.63s against a minimum of 2.5 — 0.13s of
headroom. v3 roughly doubled the number of overlays placed, so the pressure is
rising toward a floor nothing is watching.

**What changes.** `validate_plan` reports an overlay held below its component's
`duration_hint_s.min`. The compiler prefers the earlier graphic when two
collide — it was chosen first and its subject is already spoken — and drops the
later one with a logged reason rather than squeezing both. Whether to add a
minimum spacing to `validate_overlay_selection` is a question for after Slice 1
can see the difference between a dense cut and a busy one.

**Exit criterion.** A synthetic sheet with two adjacent selections produces one
overlay and one logged drop, not two unreadable ones. The eight existing plans
still validate.

---

## Slice 6 — a beat may choose its transition
> **PARTIALLY DONE 2026-09-08 — mechanism only, on purpose.** `transition_out` is in `CRAFT_KEYS`, so a prompt-pack edit adding it now takes effect instead of being silently dropped. The shipped pack still does not ask for it and a test pins that: D89 keeps it human-set until an eval says the model chooses well, and D85 measured what a model does with a field it is shown but given no taste about. The ground truth that would settle it does not exist.


**Why.** This is the only item in the plan that *adds* an editorial dimension
rather than repairing one. Every video the pipeline has ever produced uses the
style pack's default transition at every junction, because D89 deliberately did
not teach the planner to emit `transition_out` — "the field is human-set until
there is an eval that says the model chooses well."

There is a second, smaller reason it is unreachable: `beatcraft.CRAFT_KEYS`
([beatcraft.py:39](../../worker/lusora_worker/agents/beatcraft.py#L39)) does not
list `transition_out`, so adding it to the beatcraft prompt pack tomorrow would
have the answer silently dropped by `merge()`. That is a prompt-pack edit that
cannot take effect, which is exactly what D43's editable/welded split promises
cannot happen. Fix that regardless of whether the model is taught the field.

**What changes.** Add `transition_out` to `CRAFT_KEYS`. Then, behind the
instrument: teach the beatcraft pack when a junction is worth more than a cut —
a section turn, a time jump, the end of the video — with the pack's `allowed`
list welded in the way the mood vocabulary is.

**Exit criterion.** A ground truth that marks section turns, and a measurable
answer to whether the model finds them. If it does not, the field stays
human-set and D89 stands — and that is a result worth a row in the log.

---

## Slice 7 — the image generator gets a real prompt
> **DONE 2026-09-08.** The `image` prompt pack, joined subject-first, carrying `visual_language` and an explicit ban on lettering. The aspect fix is narrower than this section claimed: gpt-image-1 does not sell 16:9, so it picks the nearest of its three shapes to the video's orientation and the prompt composes for a centre crop. Not eyeballed — the adapter still has no key.


**Why.** `ai_image` is the **terminal fallback in every source chain on this
machine**, so it catches every beat the library and stock miss. Its prompt is
[`f"{query}. {style}"`](../../worker/lusora_worker/providers/sources.py#L352) —
the scout sentence and a style string, no composition guidance, no negative
guidance, no `visual_language`, and `1536x1024` (≈3:2) requested against a 16:9
output. It is not a prompt pack, so improving it is a deploy.

It is this far down for one honest reason: the `openai` adapter has never been
run here (no key), so nothing about its output quality is known.

**What changes.** Make it a prompt pack with an `image` role, carrying
`visual_language` and the composition and negative guidance the OpenMontage
prompting skills already worked out. Fix the aspect ratio to match
`cfg.output`. `docs/02-components/llm-usage.md` §9 names the source material.

**Exit criterion.** One video rendered with `ai_image` first in the chain, eyeballed.

---

## Slice 8 — silent degradations say so
> **DONE 2026-09-08.** Unknown moods and fallback visual intents both report now. The compiler's drop callback generalised to `on_note`, which is the channel for anything it decides quietly.


**Why.** Two places degrade quietly and correctly, and report nothing.

`normalize_mood` maps an unrecognised mood to `neutral`
([sound.py:346](../../worker/lusora_worker/compiler/sound.py#L346)). That is the
right call and D50 argues it well — failing a video over "ominous" would be
absurd. But `mood` is not an enum in the beat schema and no validator mentions
it, so the *prompt* is the only thing holding the eight-word vocabulary. If an
edit to the beatcraft pack's editable half stops naming them, every video gets
the same music bed and nothing anywhere says why.

`_fallback_intent` in `merge()` gives a cut the model skipped a visual intent
derived from its own words. Also right, also invisible.

**What changes.** One `ctx.log` line each, and a `production.log` count. No
behaviour change.

**Exit criterion.** A sheet with a bad mood and a missing index produces two log
lines naming both.

---

## Also worth doing, not worth a slice

- `docs/02-components/llm-usage.md` §1's table predates the `research` role
  (D64) and the `beatcraft` pack's `temperature: 0.2`. The table is the thing
  people read before editing a prompt; it should not be the stale one.
- `queries[]` shipped (D53), but `preferred_sources[]` and a `hero` flag marking
  the two or three beats that deserve the best asset are still open from the
  same borrowing. `hero` is the more interesting of the two now that the
  selector is a separate call.
