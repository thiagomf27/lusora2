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

## Log

| date | slice | what changed | cases | note |
|---|---|---|---|---|
| 2026-09-03 | 1 | — | 2 | baseline taken from runs of 2026-07-25/26. No new provider spend: the sheets already existed |

Append one row per slice. A slice that does not move a score is a result and
belongs here too.
