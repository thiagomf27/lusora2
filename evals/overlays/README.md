# Overlay eval cases

A case is a script, the timings it was narrated with, the config it was scored
under, and a human's judgement about where a graphic belongs. Four files, no
video, no database, no provider:

```
evals/overlays/<case>/
  script.txt      the narration under test
  subtitles.srt   real timings, from the TTS that read script.txt
  cfg.json        style pack + channel rules, frozen
  marks.json      the ground truth (contracts/schemas/overlay_marks.schema.json)
```

`marks.json` declares its own `case`, and it must equal the directory name —
otherwise a number in `BASELINE.md` cannot be traced back to what produced it.

## Checking one

Before a case is worth running a video against, and before it is committed:

```bash
cd worker
uv run python -m lusora_worker.evals.overlays check ../evals/overlays/<case>
```

It reports every fault at once — unknown components, words that are not in the
script or appear twice, an `ideal` outside `acceptable`, a component the
channel forbids, an emphasis mark on a pack that disables the class — plus
advisories where the case is simply too small to measure anything.

## Scoring one

```bash
cd worker
uv run python -m lusora_worker.evals.overlays score \
    ../evals/overlays/_synthetic /path/to/beats.json
uv run python -m lusora_worker.evals.overlays score \
    ../evals/overlays/_synthetic /path/to/beats.json --json   # machine-readable
```

The scorer reads two documents and computes four numbers. It never renders,
never calls a model and never touches the database, so scoring is free and
repeatable — only *producing* the `beats.json` costs anything.

| | asks |
|---|---|
| `recall` | of the moments that should carry a graphic, how many did |
| `precision` | of the overlays placed, how many landed on such a moment |
| `restraint` | of the moments that should NOT, how many were left alone |
| `component_accuracy` | of the moments correctly carrying a graphic, how many chose a component the ground truth calls defensible |
| `compiles` | does the sheet become a valid edit plan at all |
| `rule violations` | placements that break a mechanical rule — the pack's allow-list, an anchor type, a density ceiling, a prop constraint |

The last two are slice 1's. `compiles` exists because the scorer's blindest spot
had nothing to do with judgement: the arm that produced the 2026-09-05 baseline
video scored 63% precision and then died at compile on an over-long anchor
label, and no number in `BASELINE.md` could show it. A sheet that cannot become
an edit plan is not a 63%-precision sheet, it is a dead video.

`rule violations` is reported BESIDE `restraint` and never folded into it,
because the two are different kinds of wrong. An overlay on a `no_graphic` mark
costs restraint and may be nothing worse than a denser cut than the reference
made; a rule breach is a cost whatever the marks say. Conflating them is what
made v3 read as a regression the render disagreed with.

Pass `--no-compile` to score the judgement alone. `score()` itself is still pure
and does no I/O — the compile check lives in `score_case`, which is what keeps a
score reproducible from two documents.

A score reads `n/a` when its denominator is empty; a case with no `no_graphic`
marks has no restraint to report, and printing 100% there would be an answer to
a question nobody asked.

## Why marks name words and never timestamps

The reference video's timings do not transfer. A case's `script.txt` is narrated
by *our* TTS at *our* pace, so a graphic at 01:23 in the reference has no
relationship to 01:23 in our render. Every mark instead names a verbatim span of
`script.txt` in `source_words`, and the beat covering that span is the beat the
mark is about. The normalisation is `textsplit.normalize` — the same one
`validate_beat_sheet` uses for its verbatim check, so a span the validator
considers present can never be a span the scorer considers missing.

A span must occur **exactly once** in the script. Zero or two occurrences is a
bug in the case, and the scorer refuses to score rather than recording a miss
the planner never had a chance to avoid.

## The three verdicts

- **`graphic`** — a graphic belongs here. Carries `class` (`anchor` for a fact
  the narration says, `emphasis` for pure text lifting a moment), `acceptable[]`
  and an `ideal` that must be one of them. Several acceptable components is
  normal and is the point: the question is whether the planner chose
  defensibly, not whether it read the marker's mind.
- **`no_graphic`** — it does not, and placing one costs restraint. May carry
  `near_miss`, naming an anchor type the span really does contain. **This field
  is what makes the metric mean anything**: a negative on a span with no anchor
  in it is free, because the anchor gate already refuses to decorate it. Only a
  negative on a span the pipeline *would have been allowed* to decorate is
  evidence of judgement. Write more of those than of the trivial kind.
- **`unmappable`** — the reference did something this pipeline has no field for.
  Carries `excluded_from_scoring: true` and is dropped from all four numbers.
  You are not punished for a capability you never claimed; `docs/09-video-teardown.md`
  Part H is the same list.

## The one place beat granularity shows

Scores are attributed per beat, because a beat is the unit an overlay attaches
to. When a `no_graphic` mark shares a beat with a `graphic` one, an overlay on
that beat is attributable to the positive, and the negative is reported as
**unscorable** rather than counted either way. Marking two verdicts inside one
sentence therefore buys less than it looks like it will — prefer marks that sit
in separate sentences.

## Emphasis marks need a pack that enables the class

A `graphic` mark with `class: emphasis` names a pure-text overlay, and the
emphasis class is **off unless the case's style pack sets `overlays.emphasis`**
(D59). Marking one on a pack that does not enable it guarantees a recall miss
the planner was structurally forbidden to avoid — the same unfairness
`unmappable` exists to prevent, so use `unmappable` and say so in `why`.

The same goes for `acceptable`: every component in it must be inside the pack's
`overlays.allowed_components`, where the pack sets one. A test enforces both for
every committed case.

## Adding one

`docs/10-overlay-marks.md` is the prompt: it takes a reference video and returns
a `marks.json`. It reuses the Overlay Rule and the component menu from
`docs/09-video-teardown.md` verbatim, so the teardown and the eval cannot come
to different conclusions about what an overlay is for.

Then narrate `script.txt` through the channel's TTS to get `subtitles.srt`, run
the video, and score the `beats.json` it produced.

## `_synthetic`

Hand-written, no reference, no provider. It exists so the scorer has a case to
be tested against, and so the layout above is exercised by something committed
rather than by whatever happens to be on one machine. Do not put it in
`BASELINE.md`: it measures the scorer, not the pipeline.
