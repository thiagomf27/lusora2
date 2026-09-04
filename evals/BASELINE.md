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

## Log

| date | slice | what changed | cases | note |
|---|---|---|---|---|
| 2026-09-03 | 1 | — | 2 | baseline taken from runs of 2026-07-25/26. No new provider spend: the sheets already existed |
| 2026-09-04 | 3b | confound separated | 3 arms | Temperature CONFIRMED inert on deepseek-v4-pro: with JSON mode held constant, 0.2 was noisier than 0.7 on both cases. Most run-level spread is mark-count granularity; per-mark failure rates are stable. Scorer should aggregate across runs before slice 5 |
| 2026-09-04 | 3 | per-role temperature + JSON mode | 2 × 2 runs | FAILED its exit criterion: 0.2 did not reduce the spread, and the breakdown case went from perfectly stable to unstable. Confounded with JSON mode. Measurement then blocked on provider balance |
| 2026-09-03 | 2 | menu diet + prompt hygiene | 2 × 2 runs × 2 arms | July baseline invalidated (model changed) and re-taken. Input tokens −31%/−33%. `props_hint` all but disappeared, taking the planner's `emphasis` override with it. Quality NOT established: identical code scored 75% and 25% recall on one case, so the noise floor is wider than the effect |

Append one row per slice. A slice that does not move a score is a result and
belongs here too.
