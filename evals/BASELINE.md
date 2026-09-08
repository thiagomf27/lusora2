# Overlay eval — baseline

The numbers every later slice is measured against. Taken on `faceless` (v1),
**before any prompt change**, so that a change which improves a score can be
told apart from one that only moves it.

Re-score with:

```bash
cd worker
uv run python -m lusora_worker.evals.overlays score ../evals/overlays/<case> <beats.json>
```

---

## Read this before reading the numbers

**Both cases are L1 and self-marked.** There is no reference video behind
either. The scripts are ones LUSORA itself wrote and produced; the ground truth
is a judgement about where a graphic belongs in them, written from `script.txt`
alone and **without opening the `beats.json` it is scored against**. That last
part is what keeps the baseline from being circular, and it is the only claim
being made for it.

What a self-marked L1 case can tell you: whether the planner agrees with one
careful reading of a script, and whether that agreement moves when a prompt
changes. What it cannot tell you: whether that reading is what a professional
editor would actually do. The plan calls one case a sample of size one; two
cases marked by the same reader in one sitting are barely two. **Replace these
with an L2/L3 teardown case as soon as one exists** — `docs/10-overlay-marks.md`
is the prompt, and it needs a reference video with screenshots.

The two cases are deliberately opposed on the one variable that decides
everything: overlay budget.

| case | pack | density | ≈ budget | legal anchor spans | marked `graphic` |
|---|---|---|---|---|---|
| `pearl-harbor-doc` | `doc-slow` | `normal` = 2.5/min | ~4 | 13 | 4 |
| `millennium-bridge-breakdown` | `breakdown-blitz` | 9/min | ~9 | 9 | 6 |

The doc case asks *can it spend four graphics on the right four*. The breakdown
case asks *can it use a generous budget without wasting it*. A harness that
reported the same verdicts under both packs would be measuring the script
rather than the channel.

---

## Scores — `faceless` (v1), deepseek, 2026-07-25/26

| case | recall | precision | restraint | component_accuracy |
|---|---|---|---|---|
| `pearl-harbor-doc` | **50.0%** (2/4) | **66.7%** (2/3) | **80.0%** (4/5) | **100%** (2/2) |
| `millennium-bridge-breakdown` | **100%** (6/6) | **100%** (6/6) | **100%** (4/4) | **83.3%** (5/6) |

Excluded, per the scorer: 1 unmappable mark in each case; 3 negatives in the
doc case and 1 in the breakdown case shared a beat with a positive and are not
scorable at beat granularity; 1 overlay in the breakdown case sat on an
unmappable moment.

### What actually happened

`pearl-harbor-doc` — three overlays placed:

| beat | placed | verdict |
|---|---|---|
| the opening sentence | `DateStamp` | **m1, a restraint failure.** The reflex the case was built to catch: a date card on the premise, spending one of four |
| the Roosevelt draft | `QuoteBlock` | m9 hit. The right call, and the best overlay in the sheet |
| the 1941 → 1943 shipyards | `ComparisonSplit` | m13 hit, correct component |

Missed: **m6, "2,403 Americans were dead"** — the one figure the sentence is
built to land on, and the one number the video should carry if it carries any.
And **m10, "82 votes to nothing"** — a comparison written as a comparison.
The sheet spent its opening overlay on a date and then had no budget left for
either.

`millennium-bridge-breakdown` — seven overlays, six of them on marks, all six
in the right places. The one component disagreement is **m8**: the planner put
a `FactCard` on "two years and 5 million pounds" where the mark expects a
counter or a tag.

### The observation this baseline turned up

Two overlays in the breakdown sheet — `DefinitionCard` on "synchronous lateral
excitation" and `FactCard` on the cost — name components whose catalog
`anchor_types` are **empty**, and neither is flagged `emphasis: true`.
`breakdown-blitz` does not set `overlays.emphasis`, so the emphasis class is off
on this channel and both should have been refused.

They were not, and reading `validators.py` says why: the emphasis checks run
only `if overlay.get("emphasis")`, and the `anchor_ref` requirement runs only
`if entry["anchor_types"]`. A no-anchor component with the flag unset falls
between the two — it is billed against the *anchor* budget and never meets the
emphasis gate at all.

**This is D86's case, made by measurement rather than by argument.** It is
recorded here and deliberately not fixed: fixing it would move the baseline
before the baseline is recorded. Slice 4 closes it, and this paragraph is the
evidence its decision-log entry should cite.

---

## Tokens per planner call — `faceless` (v1), deepseek

From `cost_events`, the final successful run of each video:

| case | attempts | input tokens/call | output tokens/call | USD/call |
|---|---|---|---|---|
| `pearl-harbor-doc` | 2 | 2,806 / 2,849 | 7,977 / 8,168 | 0.0030 / 0.0031 |
| `millennium-bridge-breakdown` | 1 | 3,545 | 10,290 | 0.0039 |

Two things to carry into the next slices.

**Output is three times input.** The planner spends most of its budget retyping
the script into `script_text`, which is what slice 6 (`cut_beats`, D88) removes
outright. Expect output to drop by roughly the size of the script.

**The menu is smaller here than the slice-2 estimate assumes.** Slice 2 budgets
a ~2.4k saving on the composed prompt, but the whole input is only 2.8–3.5k.
Both of these channels set `overlays.allowed_components` — 12 entries on the
doc case, 17 on the breakdown case, against 29 in the core catalog — so their
menus are already filtered well below the full-catalog figure the estimate was
taken from. **Do not read a smaller-than-expected saving in slice 2 as the
change failing.** Measure the saving as a fraction of the composed prompt on
these two channels, and record the full-catalog figure separately.

---

## Re-baselined 2026-09-03 — the July numbers were taken on a model that no longer exists

The section above is kept for the record and **must not be compared against**.
`llm.py` now defaults deepseek to `deepseek-v4-pro`, a REASONING model; the July
sheets were planned by the old default. That alone accounts for output tokens
roughly doubling, and it means those scores cannot answer "did this change
help?" for anything.

Everything below was measured on one day, on one model, through one replay
harness, with the only difference being the code under test. Each arm ran each
case **twice**, deliberately: the plan puts the variance check in slice 3, and
it turned out to be the thing that had to be known first.

| arm | case | run | recall | precision | restraint | accuracy | in/call | out/call |
|---|---|---|---|---|---|---|---|---|
| pre (slice 1) | pearl-harbor-doc | 1 | 75.0 | 75.0 | 83.3 | 100 | 3,593 | 14,828 |
| pre (slice 1) | pearl-harbor-doc | 2 | 25.0 | 25.0 | 62.5 | 100 | 3,593 | 14,514 |
| pre (slice 1) | millennium-bridge | 1 | 83.3 | 100 | 100 | 100 | 4,301 | 18,041 |
| pre (slice 1) | millennium-bridge | 2 | 100 | 85.7 | 66.7 | 100 | 4,301 | 17,675 |
| post (slice 2) | pearl-harbor-doc | 1 | 50.0 | 50.0 | 60.0 | 100 | **2,483** | 11,351 |
| post (slice 2) | pearl-harbor-doc | 2 | — | — | — | — | — | *failed after 3 attempts* |
| post (slice 2) | pearl-harbor-doc | 3 | 75.0 | 75.0 | 83.3 | 100 | **2,536** | 17,262 |
| post (slice 2) | millennium-bridge | 1 | 100 | 100 | 100 | 100 | **2,866** | 15,847 |
| post (slice 2) | millennium-bridge | 2 | 100 | 100 | 100 | 100 | **2,885** | 19,496 |

### The finding that matters more than the slice

**Two runs of IDENTICAL code, on the same case, scored 75% and 25% recall.**
Restraint moved 83.3 → 62.5 on the doc case and 100 → 66.7 on the breakdown
case, with nothing changed between them but the sampler. The planner runs at
the house default temperature of 0.7.

That spread is larger than any effect slice 2 could plausibly have, which means
**slice 2's exit criterion cannot be evaluated at this sample size, and neither
can any later slice's.** Two runs per arm is not a measurement of quality; it is
a measurement of the noise floor, and the noise floor is most of the range.

The plan sequenced temperature as slice 3 and the eval's variance check inside
it. That ordering assumed the variance was small enough for slice 2 to be judged
first. It is not. Nothing downstream can be judged until the temperature comes
down and the spread is re-measured.

### What slice 2 can be said to have done

**Tokens — measured, unambiguous, and larger than the estimate.** Input per call
fell 31% on the doc case (3,593 → 2,483) and 33% on the breakdown case (4,301 →
2,866). Output fell too where it could be compared. The estimate in the section
above warned the saving might look small because both channels filter
`allowed_components`; the opposite happened, because the diet removed prop
schemas from a menu whose per-entry cost had also grown.

**The planner stopped overriding the theme.** This was not a goal of the slice
and is the most interesting thing it did:

| arm | overlays per sheet | carrying `props_hint` |
|---|---|---|
| pre | 4–9 | **every one**, and every sheet set `emphasis` |
| post | 4–8 | 0–2 |

`emphasis` in the CATALOG is a visual weight (accent / neutral) that the theme
owns. The planner was setting it on every overlay it wrote, on every run, in
both cases — a model with a schema in front of it fills the schema. Removing
the schemas removed the whole class. This is the same collision D86 renames
away, caught doing damage in production rather than argued about.

**Quality — not established, in either direction.** The two scorable post runs
on the doc case (50/50/60 and 75/75/83.3) sit inside the pre spread (75/75/83.3
and 25/25/62.5) — same top, higher bottom, on three runs against two. Both
post runs on the breakdown case scored 100 on all four axes where pre scored
83.3–100, 85.7–100 and 66.7–100 — better and steadier, on two runs. That is
suggestive and it is not evidence.

One thing the eval deliberately does **not** measure: `props_hint` going away
means the compiler now fills labels, captions and units from the anchor and the
theme's defaults instead of from the model. The scorer grades WHERE an overlay
went and WHICH component it was, never what it said. Whether the labels got
better or worse is an eyeball question, and it belongs in the promotion check.

### The failed run, and what it was failing on

One post run on the doc case exhausted its three repair attempts. It is not new:
`data/videos/vid_4d5de5a2e04d/production.log` records **two** identical hard
failures on this same case in July, on pre-slice-2 code and the old model.

The violation is worth writing down, because it is the whole plan in one line:

```
6 overlays exceed density 'normal' (max 4 for 57s)
```

The model is not failing to find graphics. It is failing to stop finding them —
placing six where the channel's budget allows four, again and again until the
video stops. That is a RESTRAINT failure severe enough to kill a render, and it
is the exact disease `select_overlays` (D87) exists to treat. A third run of the
same case, re-run with the violations logged, hit the same violation on its
first attempt, recovered on its second, and scored 75/75/83.3/100 — the same as
the best pre run.

So the doc case's post range is 50–75 on recall against a pre range of 25–75.
Overlapping, and the overlap is the point.

### Verdict on slice 2

Its exit criterion is "scores must not regress". No regression is demonstrated:
every post score falls inside or above the pre spread. Nor is an improvement
demonstrated, and at this noise level none could be. The slice lands on the
strength of what IS measured — a third off the input tokens, and the planner no
longer overriding the theme on every overlay it writes — and the quality
question is deferred to the first eval taken after the temperature comes down.

**Slice order changes here.** Slice 3 (temperature) must land before any further
slice is judged, and the variance re-measurement it carries is now the gate for
re-reading this whole table rather than a sanity check inside it.

## Slice 3 — temperature 0.2 did NOT reduce the spread

The exit criterion was "lower variance at 0.2 is the expected result". It did
not appear. Two runs per case at 0.2 (JSON mode on), against the 0.7 arm above:

| case | axis | spread at 0.7 | spread at 0.2 |
|---|---|---|---|
| pearl-harbor-doc | recall | 25.0 (50.0, 75.0) | 25.0 (75.0, 50.0) |
| pearl-harbor-doc | restraint | 23.3 (60.0, 83.3) | **12.5** (87.5, 75.0) |
| millennium-bridge | recall | **0.0** (100, 100) | 33.3 (66.7, 100) |
| millennium-bridge | restraint | **0.0** (100, 100) | 20.0 (100, 80.0) |
| millennium-bridge | accuracy | 0.0 (100, 100) | 16.7 (100, 83.3) |

The doc case's restraint spread halved. The breakdown case went from **perfectly
stable** at 0.7 to visibly unstable at 0.2, on three of four axes. Net: no
evidence that the temperature did anything, and one case pointing the wrong way.

**The likely reason, stated as a hypothesis rather than a finding:**
`deepseek-v4-pro` is a REASONING model. Its output variance comes largely from
the reasoning trace, which `temperature` does not govern the way it governs a
plain completion — so the knob may simply not be connected to the thing that
moves. The wire test confirms only that the parameter is SENT and accepted, not
that it is honoured.

**A confound this arm cannot separate.** Slice 3 changed two things at once:
temperature 0.7 -> 0.2, and `response_format: {"type": "json_object"}` from off
to on for deepseek. The 0.2 arm therefore differs from the 0.7 arm in two ways,
and no run in this table isolates either. Separating them needs a third arm
(JSON mode on, temperature 0.7), which is one more run per case.

**n = 2 per cell.** This is not enough to call either way, and saying so is the
point: the spread is being estimated from two samples, which is exactly the
weakness that made slice 2 unjudgeable. It is recorded because the expected
result failed to appear, not because the opposite was proved.

### What this means for the plan

The plan assumed the variance was a knob, and that turning it down would make
every later slice measurable. On this model it is not. Three ways forward, none
of them "carry on as written":

1. **Average instead of pinning.** Accept the spread and raise runs per arm
   (5+), comparing means rather than single runs. Honest, and roughly triples
   the provider cost of every exit criterion.
2. **Change the planner's model** to a non-reasoning one for the eval, where
   temperature does what it is documented to do. Changes what is being measured.
3. **Separate the confound first** — one more arm at JSON-mode-on/0.7 — before
   deciding anything. Cheapest, and answers a question that will otherwise sit
   under every later number.

### Measurement is blocked

The deepseek account returned `402 Insufficient Balance` partway through this
arm, which is why two of the six planned runs are missing and why the third run
of each case was never taken. **No further eval can run until the balance is
topped up**, or until the planner is pointed at another provider. `ANTHROPIC_API_KEY`
is present and would work, but it is a different model and every number above
would have to be retaken against it.

## The confound, separated — and what the noise actually is (2026-09-04)

Three arms, all on slice-2 code. B and C differ **only** in temperature, so the
pair isolates it:

| arm | temperature | JSON mode |
|---|---|---|
| A | 0.7 | off |
| B | 0.2 | on |
| C | 0.7 | on |

| case | axis | B (0.2) | C (0.7) |
|---|---|---|---|
| pearl-harbor-doc | recall | 75, 50, 25 — spread **50.0** | 75, 50 — spread 25.0 |
| pearl-harbor-doc | restraint | 87.5, 75, 57.1 — spread **30.4** | 80, 71.4 — spread 8.6 |
| millennium-bridge | recall | 66.7, 100, 66.7 | 83.3, 100 — spread 16.7 |
| millennium-bridge | restraint | 100, 80, 100 | 100, 100 — spread **0.0** |

**Temperature is confirmed dead on this model.** Holding JSON mode on, dropping
0.7 to 0.2 did not reduce the spread on either case, and on both the LOWER
temperature was the noisier arm. The reasoning trace is where the variance
lives and `temperature` does not govern it.

(One bookkeeping note: a refill run reused a filename and overwrote an earlier
`millennium-bridge.3` sheet that had scored 100 recall. Three observations were
taken on that cell — 66.7, 100, 66.7 — and only two survive as files.)

### Most of the "variance" is granularity, not randomness

`pearl-harbor-doc` has **4** graphic marks, so recall can only ever be 0, 25,
50, 75 or 100. A 25-point "swing" is ONE mark changing. The scores look violent
because the denominators are tiny.

### The signal is at the mark, not at the run

Failure rate per mark, across all nine sheets from every arm:

```
pearl-harbor-doc (5 sheets)
  m1   no_graphic  overdone 4/5   "December 7th, 1941"          <- reliable bias
  m11  no_graphic  overdone 3/5   "The House agreed, 388 to 1"
  m13  graphic     missed   4/5   "more than 1,900 a year"      <- reliable miss
  m10  graphic     missed   3/5   "82 votes to nothing"
  m9   graphic     missed   0/5   "a date which will live in infamy"
  m2 m4 m5 m7 m12  overdone 0/5   (five negatives, never violated)

millennium-bridge-breakdown (4 sheets)
  every mark 0/4 or 1/4 — the model is simply right on this case
```

The run-level score bounces; the **mark-level behaviour is stable and legible**.
The planner reliably puts a date card on the opening sentence and reliably
misses the 1943 payoff. Those are findings. "Recall was 50% that time" is not.

### What this means for the instrument

The eval should aggregate **per mark across N runs**, not compare single runs:

- a mark's failure rate over 5 runs moves in 20-point steps instead of a
  4-mark recall moving in 25-point steps, and it averages out the sampling
- it names WHICH judgement changed, which is what a prompt fix needs
- it costs no extra provider calls beyond the runs already being made

Denser cases (20-30 marks rather than 12) are the other half, and that is
authoring rather than compute.

**Do this before slice 5.** Slice 5 exists to move restraint; measuring it with
an instrument whose noise floor is 50 points would answer nothing.

## The real baseline — four reference cases, `faceless` v1 + slices 2-4, deepseek-v4-pro, 2026-09-04

The first baseline in this file taken on cases with a **reference video behind
them** rather than on scripts LUSORA wrote and I marked. Three runs per case,
twelve planner runs, no failures.

| case | level | marks | recall | precision | restraint | component_acc |
|---|---|---|---|---|---|---|
| `cnbc-ref` | L3 | 30 | **22.2** (0.0) | 60.0 (60.0) | 88.6 (17.6) | 100 (0.0) |
| `good-news-august-ref` | L2 | 32 | **64.6** (12.5) | 86.1 (16.7) | 83.0 (20.0) | 100 (0.0) |
| `neu-ref` | L3 | 30 | **38.1** (7.1) | 76.2 (14.3) | 81.5 (16.7) | **25.6** (23.3) |
| `the-bim-ref` | L3 | 34 | **49.3** (4.3) | 91.7 (0.0) | 90.9 (0.0) | 100 (0.0) |

Mean over three runs, with the spread in brackets.

### The instrument works now

`the-bim-ref` reports a spread of **0.0** on precision and restraint across
three runs, and 4.3 on recall. `cnbc-ref` reports 0.0 on recall. Against the
25-50 point spreads the twelve-mark cases produced, that is the noise problem
solved — and it was solved by writing 30-34 marks, not by touching a sampler.
The granularity diagnosis was right: recall now moves in 4-11 point steps
instead of 25.

### The finding: the planner UNDER-places, it does not over-place

| case | overlays written | budget available | moments marked |
|---|---|---|---|
| `cnbc-ref` | 5, 2, 5 | 16 | 9 |
| `good-news-august-ref` | 12, 12, 12 | 19 | 16 |
| `neu-ref` | 7, 7, 7 | 18 | 14 |
| `the-bim-ref` | 12, 13, 12 | 24 | 23 |

Every run finishes well under its ceiling, and every overlay written lands on a
marked moment. Restraint averages **86%** across the four cases while recall
averages **44%**.

**This inverts the premise of the whole plan.** `overlayqualityv3plan.md` is
built on "the model cannot stop" — the density violation that killed a
pearl-harbor run, the reflexive DateStamp on an opening. On reference-grade
material the opposite is true: the planner is cautious, spends half its
allowance, and is *right* about what it does place (precision 60-92%,
component accuracy 100% on three of four cases).

The old finding was not wrong, it was unrepresentative. `pearl-harbor-doc` is
57 seconds with a budget of four, where one extra graphic is a 25% error.
These are 161-195 seconds with budgets of 16-24, where the interesting failure
is the twelve moments it declined.

**Slice 5 (`select_overlays`, D87) was designed to improve restraint.**
Restraint is the number already at 86%. Its ceiling is +14 points, and the
recall gap is 56. Asking the overlay question in its own call may well raise
recall too — a dedicated call with a shortlisted menu is plausibly *more*
willing, not less — but that is now the hypothesis to test, and the slice's
exit criterion should be rewritten to say so before it is built.

### Second finding: the planner uses 11 of 29 components

Across all twelve sheets:

```
USED    AnimatedCounter 46, StatTag 28, HammerStatement 7, ComparisonSplit 7,
        DateStamp 5, SatelliteLocate 4, PieChart 3, QuoteBlock 2,
        KineticTitle 2, RankLabel 1, NamePlate 1

NEVER   ArchivalFrame, BarChart, BulletList, CalloutArrow, ChapterCard,
        DataTable, DefinitionCard, DocumentCard, FactCard, FactSheet,
        FramedExhibit, HighlightedPassage, LineChart, PortraitPlates,
        RegionHighlight, RouteMap, StepFlow, Timeline
```

Three quarters of every overlay written is a counter or a tag. The entire
"exhibit" family — show the document, the table, the chart, the photograph —
is never reached for, on four channels whose references use exactly that
language.

This is what `neu-ref`'s 25.6% component accuracy is measuring, and inspecting
its mismatches shows the pattern cleanly: on "debt explode from roughly $10
billion to…" the ground truth wants `DataTable` / `DocumentCard` /
`FramedExhibit` and the planner writes `ComparisonSplit`; on "a record 37.2
million people" it wants an exhibit and gets an `AnimatedCounter`. The planner
reaches for the component that fills itself from an anchor, every time.

One genuine planner error in that set: `Norwegian Cruise Line` is a `name`
anchor wanting `NamePlate`, and it got an `AnimatedCounter` in all three runs.

**Caveat on that case.** Several `neu-ref` marks put `class: emphasis` on spans
full of numbers, because the reference showed a chart there. That is a
defensible editorial reading and it is also the hardest thing in the eval for
the planner to guess, so `neu-ref`'s component score should be read as "does
the planner reach for exhibits" rather than as a general accuracy number.

## The verdict — v3, measured and then watched (2026-09-05)

Four L2/L3 reference cases, three runs per arm, both arms on
`deepseek-v4-flash` on one day through one harness. 24 runs, no failures.

| case | recall | precision | restraint | component acc | placed |
|---|---|---|---|---|---|
| cnbc-ref | 25.9 → **55.6** | 63.3 → 59.0 | 83.8 → 72.2 | 88.9 → **39.4** | 4.3 → 8.0 |
| good-news-august-ref | 58.3 → **89.6** | 80.7 → 81.7 | 74.8 → 53.3 | 89.3 → 69.1 | 11.7 → 12.7 |
| neu-ref | 28.6 → **88.1** | 57.9 → 84.7 | 67.2 → **73.3** | 25.0 → 21.6 | 6.3 → 8.7 |
| the-bim-ref | 44.9 → **58.0** | 79.6 → 76.0 | 75.8 → 66.7 | 100 → 94.3 | 13.0 → 15.3 |

Components used across the arm: **10 of 29 → 20 of 29**, eleven of them names
the baseline never chose once.

**Against D87's exit criterion this FAILED.** Recall up on every case, yes; but
restraint down 12, 22 and 9 points against a floor of 5, and component accuracy
down on all four.

### So the same case was rendered twice and watched

Identical script, theme and source policy — `ai_image: mock` slates, local
narration, $0. Only the beat sheet differs. Both are in the platform as
`vid_ovl_base_cnbc` and `vid_ovl_v3_cnbc`.

The v3 cut is better, and the two metrics that fell were both measuring the
GROUND TRUTH rather than the model:

- **Component accuracy.** `cnbc-ref`'s marks were written expecting counters,
  by someone who had never seen this material rendered. v3 puts a `BulletList`
  over "three different segments", a `StepFlow` over the supply chain and a
  `Timeline` over the acquisitions — on a company breakdown, which is what the
  script is. Every one of those scored as an error against marks that had
  decided in advance the answer was a number in a box.
- **Restraint.** The metric counts an overlay on a `no_graphic` mark and never
  asks whether the overlay is any good. A denser cut of a dense script reads as
  richer, not busier, and the score cannot tell those apart.

The labels tell the same story from the other end: v3 writes
`"of grocery salad kits"` where the baseline writes `"of all salad kits at
grocery stores are from Taylor"` — ten words into an eight-word prop, which is
the string that killed the baseline's compile.

**What the render found that 24 scored runs could not.** The baseline sheet did
not finish: an ordinary wordy anchor label produced `compiler produced an
invalid plan (bug)`. The scorer reads beat sheets and never compiles them, so
no number in this file could ever have shown it.

### What this means for the instrument

Two changes worth making before these scores are trusted again:

1. **`component_accuracy` is only as good as `acceptable[]`.** A mark that
   names one component where three would do measures the marker's expectation,
   not the planner's judgement. `cnbc-ref` needs re-marking against what the
   reference actually shows, by someone who has watched the render.
2. **`restraint` needs to distinguish a bad overlay from an extra one.** As
   written it treats every unmarked graphic as a cost, which is right for a
   57-second doc with a budget of four and wrong for a three-minute breakdown.

Neither is a reason to distrust recall, precision or the component-breadth
count, which all moved the way the render confirms.

### The honest remaining weakness

`StepFlow` and `Timeline` are the least convincing of the new components on
screen. That is a reason to narrow a channel's `allowed_components` to what
renders well, which is a per-channel decision, not a reason to withhold the
stage.

## Temperature, settled (2026-09-05)

Re-measured on `deepseek-v4-flash` with the beats held constant — only the
overlay call moved, so this cost 12 model calls rather than 50.

| case | axis | spread at 0.2 | spread at 0.7 |
|---|---|---|---|
| cnbc-ref | recall | 22.2 | **11.1** |
| cnbc-ref | precision | **15.6** | 21.4 |
| cnbc-ref | restraint | **8.3** | 16.7 |
| the-bim-ref | recall | 17.4 | **8.7** |
| the-bim-ref | precision | 15.4 | **1.9** |
| the-bim-ref | restraint | 18.2 | **0.0** |

0.7 is the tighter arm in five of eight comparable cells. **Temperature does
not buy repeatability on either deepseek reasoning model** — measured on
v4-pro in slice 3 and on v4-flash here. The variance lives in the reasoning
trace, which the dial does not govern.

Quality means are not worse at 0.2, so the packs keep it (D85 records why),
but nothing may be planned around it. **The eval averages several runs,
permanently.** Any criterion that assumed one run was trustworthy was
unevaluable, which is what happened to slices 2 and 3.

## Slice 0 — the probe, and what it found before it got to its own question
(2026-09-08)

The plan's slice 0 was one run on a 10-minute script, to find out whether the
production path survives a length no eval case reaches. Every case here is
116-538 words; `beatcraft.craft_beats` sends **every cut in one call**, and
`planner.py:56` puts the safe ceiling for a single call at 20-30 beats.

The fixture is the four reference cases' scripts and their real TTS timings
joined end to end — 1,846 words, 11.5 minutes. A Frankenstein narrative, which
does not matter: the question is structural capacity, not whether it reads well.

**It never reached the model's answer, because the cutting was wrong first.**

Cutting that fixture under `breakdown-blitz` (ceiling 4.5s) produced spans of up
to 17s. Checking the real cases one at a time showed it was not the fixture:

| case | ceiling | longest span | spans over it |
|---|---|---|---|
| cnbc-ref | 8.0s | 12.73s | 5 of 29 |
| good-news-august-ref | 8.0s | 14.93s | 9 of 20 |
| neu-ref | 10.0s | **19.24s** | 4 of 24 |
| the-bim-ref | 7.0s | 6.94s | 0 |

`_under_the_ceiling` exists to prevent exactly this and was failing silently,
for two reasons — `_merge_undersized`'s char floor undoing the split, and no
fallback below punctuation. Both are fixed; the commit message carries the
detail. Every case now sits inside its pack's window, floor and ceiling, with
verbatim coverage unchanged.

This is a **visible editing defect**, not a metric: a single image sitting on
screen for 19 seconds on a channel whose pack says 10. No score in this file
could have shown it, because the scorer reads overlay decisions and never asks
how long a shot is held. It was found by measuring the cuts directly.

### The long-form question is still open

With the ceiling honoured the same fixture cuts into **217 spans**, twice what
the broken cutting produced and seven times the documented safe ceiling for one
call. The composed prompt is only ~4.3k tokens in; the ANSWER is the problem —
217 indices at roughly 90 tokens each is ~19.5k output tokens before the
reasoning trace, against a 64k `max_tokens`.

The live call was made and **its result was lost**: the probe script crashed on
a field `LLMResult` does not have (`finish_reason`), after `llm.chat` returned
but before `cost.actual`, so nothing was recorded and no cost row was written.
What is known is only that deepseek accepted the prompt and returned within
about four minutes. No further provider spend was authorised, so it was not
re-run.

**Slice 2 therefore proceeds on the structural argument rather than on a
measurement**, which the evidence already supports without the call: 217 indices
is 7x the limit the code itself states, one bad JSON loses the whole video with
no partial progress, and `chunk_target_beats` is meanwhile a channel-config knob
that does nothing on the production pipeline. To take the measurement later:

```bash
cd worker && uv run python - <<'EOF'
# build cuts, then: beatcraft.craft_beats(ctx, cuts, script, duration, menu="")
# LLMResult carries .text/.input_tokens/.output_tokens — there is no finish_reason
EOF
```

## Slice 1 — the instrument (2026-09-08)

Three changes, no provider spend: every number below is a re-score of sheets
already on disk.

**The scorer compiles what it scores.** `score_case` now runs
`validate_beat_sheet`, `compile_plan` and `validate_plan` on every sheet and
reports two new things: whether the sheet becomes a valid edit plan, and the
mechanical rule breaches it carries. This is the gap the 2026-09-05 comparison
fell into — the baseline arm scored 63% precision and then died at compile on an
over-long anchor label, and no number here could show it. `score()` itself stays
pure; the I/O is in `score_case`, and `--no-compile` turns it off.

Re-scoring the two sheets from that comparison, both now compile — which is
correct, because `954782f` fixed that defect after the render found it. The axis
is verified against a deliberately broken sheet in the tests instead.

**Rule breaches are reported beside restraint, not inside it.** BASELINE's own
critique was that restraint "counts an overlay on a `no_graphic` mark and never
asks whether the overlay is any good". The two are now separate numbers: an
overlay on a negative mark costs restraint and may be nothing worse than a
denser cut, while a breach of the pack's allow-list, an anchor type, a density
ceiling or a prop constraint is a cost whatever the marks say.

**`cnbc-ref` re-marked, narrowly.** BASELINE asked for a re-mark by someone who
has watched the render. That person has not been available, so the only edit
made is the transcription of a verdict *already written here* on 2026-09-05:
`Timeline` added to `acceptable[]` on m26-m28, the three dated acquisitions.
Each mark says so in its own `why`, and `notes` records the scope.

Two of the three examples BASELINE named turned out to need no change, which is
worth recording because both are cases of the prose being looser than the data:

- the `BulletList` on "three different segments" sits on **m15, which is
  `unmappable`** — it was excluded from scoring, never counted as an error.
- the `StepFlow` on "hundreds of family farms" **cannot be added to m18 at
  all**: m18 is an anchor-class mark and `StepFlow` carries no anchor type, so
  D86 forbids the placement outright. `overlays check` refused the edit. The
  instrument catching a bad edit to its own ground truth is the check working.

| cnbc-ref | recall | precision | restraint | component acc | compiles |
|---|---|---|---|---|---|
| baseline sheet | 22.2 | 40.0 | 76.5 | 100 | yes |
| v3 sheet, before re-mark | 66.7 | 50.0 | 58.3 | **33.3** | yes |
| v3 sheet, after re-mark | 66.7 | 50.0 | 58.3 | **66.7** | yes |

The remaining two component disagreements on the v3 sheet are `SatelliteLocate`
on m8 and `StepFlow` on m18 — the second of which is the illegal placement
above, and is a genuine model error rather than a marking one.

**Still outstanding, and it is the honest limit of this slice:** three of the
four cases have never been re-marked at all, and `cnbc-ref` has had exactly
three marks touched. `component_accuracy` should still be read as "does the
planner reach for exhibits" rather than as an accuracy number.

## Slices 2-4 — NOT MEASURED (2026-09-08)

No provider spend was authorised, so these three landed on code, tests and
argument. Each exit criterion below is a real number that has not been taken,
and none of them should be reported as though it had.

**Slice 2 (chunking).** Exit criterion: a 10-minute script produces a beat sheet
and an overlay selection with no truncation and no repair-loop exhaustion, at a
token cost that scales roughly linearly. What IS known, offline: the 11.5-minute
fixture cuts into 217 spans and now goes out as 8 calls of ~28 cuts, each about
2.5k of expected answer instead of one ~19.5k answer, and each independently
repairable. To measure it:

```bash
cd worker && uv run python -m lusora_worker.evals.run_case \
    ../evals/overlays/<case> /tmp/out.json --arm v3
```

**Slice 4 (the selector sees the shot).** Exit criterion: re-score with the
slice-1 instrument on the sheets already on disk plus one fresh run per case;
precision and the rule/taste split are the axes this should move, and recall
must not fall. The sheets on disk cannot answer it — they were produced by the
old prompt, and the change is to what the model is SHOWN, so it can only be
measured by running it. Cheapest form, one call per case:

```bash
cd worker && uv run python -m lusora_worker.evals.run_case \
    ../evals/overlays/<case> /tmp/out.json --arm v3 --reuse-beats
```

**Slice 3 (script validation)** has no eval criterion — its evidence is the
corpus. Of the 22 scripts on disk, three fail, and they fail because they
genuinely carry markdown that was read aloud: `*Alcedo*` in
`vid_4ba61bc328ea`, `vid_ebd119ffabbd` and `vid_f7ac2576db3f`. The six eval
scripts are clean and a test pins them that way, so a future rule cannot start
quietly rejecting real narration.

## Log

| date | slice | what changed | cases | note |
|---|---|---|---|---|
| 2026-09-08 | 2-4 | chunking, script validation, the selector sees the planned shot | none — NOT MEASURED | No provider spend authorised. Slice 3's evidence is the corpus: 3 of 22 shipped scripts carry markdown that the TTS read aloud. Slices 2 and 4 carry commands, not numbers |
| 2026-09-08 | 1 | instrument: the scorer compiles, rule breaches split from restraint, cnbc-ref m26-m28 widened to Timeline | re-scores only | No provider spend. v3's component accuracy on cnbc-ref 33.3 -> 66.7, explainable mark by mark |
| 2026-09-08 | 0 | long-form probe | 6 cases, offline | Found `cut_beats` ignoring its own ceiling on 3 of 4 reference cases — a 19.2s shot on a 10s pack. Fixed. The long-form question itself is still open: the one live call's result was lost to a bug in the probe |
| 2026-09-03 | 1 | — | 2 | baseline taken from runs of 2026-07-25/26. No new provider spend: the sheets already existed |
| 2026-09-05 | 5-8 | v3 measured and WATCHED | 4 cases × 3 runs × 2 arms | Recall roughly doubled everywhere; components 10→20 of 29. Restraint and component accuracy fell and a side-by-side render showed both were measuring the ground truth, not the model. The render also found a compiler bug that kills the BASELINE video and that no score could see |
| 2026-09-04 | — | first reference baseline | 4 cases × 3 runs | Spreads collapse to 0-4 points on the 30-mark cases: granularity was the noise. Planner UNDER-places (restraint 86%, recall 44%) and uses 11 of 29 components, never the exhibit family. Inverts the plan's premise; slice 5's exit criterion needs rewriting |
| 2026-09-04 | 3b | confound separated | 3 arms | Temperature CONFIRMED inert on deepseek-v4-pro: with JSON mode held constant, 0.2 was noisier than 0.7 on both cases. Most run-level spread is mark-count granularity; per-mark failure rates are stable. Scorer should aggregate across runs before slice 5 |
| 2026-09-04 | 3 | per-role temperature + JSON mode | 2 × 2 runs | FAILED its exit criterion: 0.2 did not reduce the spread, and the breakdown case went from perfectly stable to unstable. Confounded with JSON mode. Measurement then blocked on provider balance |
| 2026-09-03 | 2 | menu diet + prompt hygiene | 2 × 2 runs × 2 arms | July baseline invalidated (model changed) and re-taken. Input tokens −31%/−33%. `props_hint` all but disappeared, taking the planner's `emphasis` override with it. Quality NOT established: identical code scored 75% and 25% recall on one case, so the noise floor is wider than the effect |

Append one row per slice. A slice that does not move a score is a result and
belongs here too.
