# Overlay eval cases — turning a reference video into one

[Doc 09](09-video-teardown.md) asks a reference video *how does this channel
look*, and returns a channel you can run. This one asks a narrower and harder
question — **where does a graphic belong, and where does one not** — and returns
an *instrument*: a case the scorer measures our planner against.

The output is a directory:

```
evals/overlays/<case>/
  script.txt      the narration under test
  cfg.json        the style pack and channel rules, frozen
  marks.json      the ground truth
  subtitles.srt   real timings — WE generate this, not the AI (see below)
```

Nothing in the production pipeline ever reads a case. It exists so that "did
that prompt change help?" has an answer.

The prompt below produces the first three files in one pass. **`cfg.json` is not
optional bookkeeping** — it carries the overlay budget, and the budget is what
makes the marks mean anything. A case that says "a graphic belongs here" without
saying how many graphics the channel can afford has not asked a question.

## Before you start

Read [evals/overlays/README.md](../evals/overlays/README.md) for the layout and
the scorer's four axes.

**We generate `subtitles.srt`, not the AI.** A case's script is re-narrated by
*our* TTS at *our* pace, so the reference video's timings do not transfer. Once
`script.txt` exists, narrating it through the channel's voice produces
`tts_timings.json` and the SRT falls out — no Whisper pass needed.

**Write more marks than feels necessary.** Measured, not guessed: a case with
4 graphic marks can only score recall at 0, 25, 50, 75 or 100, so one beat
changing its mind moves the number 25 points and run-to-run noise swamps any
real effect. **Aim for 25–40 marks.** The scorer's useful output is a per-mark
failure rate across several runs ("the opening date card is overdone 4 times in
5"), and that needs marks to average over.

## What to send with it

| Level | What you attach | What the marks are worth |
| --- | --- | --- |
| **L1** | the transcript only | you can mark `graphic` / `no_graphic` from what the narration *says*, but not from what the reference *did*. A judgement about the script, not a measurement of a channel — say so in `source.level` |
| **L2** | transcript + screenshots at noted timestamps | the real thing. You can see which moments got a graphic and roughly what kind |
| **L3** | the above + a graphics list (timestamp + what it showed) for the whole video, and a shot list for one 90s window | every mark is measured, and the `no_graphic` marks become trustworthy — which matters more here than anywhere, because a moment you did not see is indistinguishable from one the reference deliberately left alone |

**The `no_graphic` marks are the expensive half.** At L1 and L2 the temptation
is to mark only the moments you saw a graphic on, which produces a case that
measures recall and cannot measure restraint — the one number this whole line of
work exists to move.

---

## The prompt

Paste everything between the rules, then attach the evidence.

---

You are building an evaluation case from a reference video. Return **three
files**, each in its own fenced block labelled with its filename, and nothing
else between them.

### File 1 — `script.txt`

The narration, as plain prose. Take the reference's transcript and clean it:
drop sponsor reads, channel promo, "like and subscribe", stutters and filler.
Keep the sentences the video is actually made of, in order, with normal
punctuation. No timestamps, no speaker labels, no markdown.

This is the script our pipeline will be asked to plan against, so it must read
as something a narrator would say start to finish. Use the section of the
reference you can mark most densely — 400–900 words makes a good case. Put the
word count and the reference's spoken duration for that section in File 2's
`_comment`, not in this file.

### File 2 — `cfg.json`

The channel half, frozen. **This sets the overlay budget, which is the single
number deciding whether a mark is a fair question.**

```json
{
  "_comment": "reference: <url or title>; section used: <mm:ss-mm:ss>; ~<N> words, ~<M>s spoken; density counted as <X> fact-graphics over <Y> minutes",
  "language": "en",
  "video_type": "doc | explainer | breakdown | listicle",
  "style_pack": "<slug you would give this channel>",
  "style_pack_doc": {
    "name": "<same slug>",
    "video_type": "<same as above>",
    "pacing": {
      "avg_hold_seconds": 4.0,
      "min_hold": 2.5,
      "max_hold": 8.0,
      "arc": "three_act | linear | listicle"
    },
    "overlays": {
      "density": "low | normal | high",
      "allowed_components": ["…"],
      "emphasis": { "enabled": false, "per_minute": 1.0 }
    }
  },
  "content_rules": "<one line, or omit>"
}
```

How to fill the parts that matter:

- **`pacing.avg_hold_seconds`** — how long the BASE shot holds before it
  changes. Count changes of footage or image, not overlays appearing, and not
  camera moves within one shot. Average over a 90s window. `min_hold` and
  `max_hold` are the shortest and longest you saw.
- **`overlays.density`** — count only **fact-carrying** graphics (the Overlay
  Rule below) over a known number of minutes, and divide. Then map: `low` =
  1/min, `normal` = 2.5/min, `high` = 5/min. If none of those is within about
  30% of what you counted, write `{"per_minute": <your number>}` instead. **Put
  the raw count and the minutes in `_comment`.** This number decides how many
  graphics are legal: the ceiling the validator applies is
  `ceil(per_minute × seconds / 60) + 1`.
- **`overlays.emphasis`** — count *pure-text* cards (titles, statements, chapter
  breaks) separately. If the reference uses them, set `enabled: true` with their
  own per-minute rate. If it does not, set `enabled: false`. **This is
  load-bearing: with it false, a `class: emphasis` mark is a graphic our planner
  is structurally forbidden to place, and scoring one would be unfair.**
- **`overlays.allowed_components`** — the subset of the menu below this channel
  would actually install. Omit the field entirely to allow all of them. Every
  component you name in a mark's `acceptable` must appear here.

### File 3 — `marks.json`

The ground truth, valid against `contracts/schemas/overlay_marks.schema.json`.

THE OVERLAY RULE — read this before counting graphics. An overlay may exist for
exactly two reasons:
  (a) it carries a FACT the narration actually says — an anchor: a percentage,
      a number, a comparison, a place, a date, a name, a quote. The number on
      screen is filled from the script, so the model cannot get it wrong.
  (b) it is pure text lifting a moment — a title card, a statement, a chapter
      break. This is the "emphasis" class, it is OFF by default, and it is
      counted under its own separate budget.
A graphic that is neither — a decorative sticker, an arrow drawn on a face, a
meme cutaway — has no way into the pipeline. Count those separately and report
them in Part H. Do not inflate the density number with them.

(In THIS prompt, "Part H" means: mark it `unmappable`.)

**THE THREE VERDICTS**

- **`graphic`** — a graphic belongs at this moment. Give `class` (`anchor` or
  `emphasis` per the rule above), `acceptable` (every component that would be a
  defensible choice) and `ideal` (the best of them, and it MUST be one of them).
  Listing several acceptable components is normal and correct: the question is
  whether the planner chose defensibly, not whether it guessed which one you
  would have picked.
- **`no_graphic`** — a graphic does NOT belong here, and placing one is a real
  cost. Where the span genuinely contains an anchor, name its type in
  `near_miss`.
- **`unmappable`** — the reference did something this pipeline has no field for.
  Set `excluded_from_scoring: true` and say what it was in `why`. The moment is
  dropped from every score, because we do not measure capabilities we never
  claimed.

**WHAT MAKES A GOOD `no_graphic` MARK**

A negative on a span with no anchor in it is FREE — the pipeline's anchor gate
already refuses to decorate it, so marking it proves nothing. The marks that
carry the whole eval are the ones where a graphic **would have been legal** and
the reference still said no. Every one of those gets `near_miss`. Reasons an
editor says no on a legal anchor:

- the shot already carries the fact (the ledger is on screen; do not caption it)
- a second figure in the same breath is the one the viewer must actually read
- the anchor is scene-setting the viewer will never be asked to recall
- the narration is moving too fast for anything to be read
- a graphic is already on screen and this would stack on it
- the moment is emotional and a data card would flatten it

**Target: 25–40 marks, at least half of them `no_graphic`, and at least half of
THOSE carrying `near_miss`.** A case without that balance can only measure
recall, and recall is not the problem.

**SOURCE WORDS**

Every mark names `source_words`: a verbatim, contiguous span copied from
`script.txt`, occurring **exactly once** in it. Never a timestamp.

- Copy the words exactly, including punctuation and capitalisation.
- If a phrase occurs twice in the script, lengthen it until it is unique.
- Keep it to the words the graphic is ABOUT — the figure, the name, the
  statement — not the whole sentence around it.
- Put the reference's own timestamp in `at` if you have it. It is for a human
  re-checking your work; the scorer ignores it.
- **Prefer marks in separate sentences.** Scoring is attributed per beat, and
  two verdicts inside one sentence usually land in one beat — where a negative
  sharing a beat with a positive is reported as unscorable and counts for
  nothing.

**COMPONENT MENU** (choose `acceptable` and `ideal` only from this list)

| anchor type it can take | components |
| --- | --- |
| `number` | AnimatedCounter, RankLabel, StatTag |
| `percentage` | AnimatedCounter, PieChart, StatTag |
| `comparison` | BarChart, ComparisonSplit, PieChart |
| `place` | RouteMap, SatelliteLocate |
| `date` | DateStamp |
| `name` | NamePlate, PortraitPlates |
| `quote` | HighlightedPassage, QuoteBlock |
| none — carries no anchor, so it is only ever `class: emphasis` | ArchivalFrame, BulletList, CalloutArrow, ChapterCard, DataTable, DefinitionCard, DocumentCard, FactCard, FactSheet, FramedExhibit, HammerStatement, KineticTitle, LineChart, RegionHighlight, StepFlow, Timeline |

A component in the bottom row can NEVER be `class: anchor` — it carries no fact
by construction. If the reference's graphic matches nothing on this list, the
mark is `unmappable`, never a near-enough substitute.

**SHAPE**

```json
{"version":"1.0","case":"<directory-name-you-are-proposing>",
 "source":{"url":"…","title":"…","level":"L2","marked_by":"…","marked_on":"YYYY-MM-DD"},
 "notes":"<what you could and could not see, in one paragraph>",
 "marks":[
   {"id":"m1","at":"00:00:31","source_words":"twenty-nine thousand tanks",
    "verdict":"graphic","class":"anchor",
    "acceptable":["AnimatedCounter","StatTag"],"ideal":"AnimatedCounter",
    "why":"the figure is the sentence"},
   {"id":"m2","at":"00:01:02","source_words":"In 1943",
    "verdict":"no_graphic","near_miss":"date",
    "why":"a real date anchor, and it would compete with the figure beside it"},
   {"id":"m3","at":"00:01:40","source_words":"the map redraws itself",
    "verdict":"unmappable","excluded_from_scoring":true,
    "why":"animated borders over a held map; no field carries a change"}
 ]}
```

Ids are `m1`, `m2`, … in script order. Write `why` for every mark: it is
unscored and it is the most useful field in the file six months later, when a
score moves and nobody can remember what the mark meant.

**SELF-CHECK before you answer.** Each of these is enforced by a test, and a
case that fails one is rejected rather than scored:

1. Every `source_words` appears in `script.txt` **exactly once**, character for
   character after collapsing whitespace.
2. `ideal` is a member of `acceptable`, on every `graphic` mark.
3. Every name in `acceptable` is in the component menu above **and** in
   `cfg.json`'s `allowed_components` (if you set that field).
4. No `class: emphasis` mark unless `cfg.json` sets
   `overlays.emphasis.enabled: true`.
5. No `class: anchor` mark whose `acceptable` contains a bottom-row component.
6. `case` is the directory name you propose: lowercase, hyphens or underscores.
7. Every `unmappable` mark carries `excluded_from_scoring: true`, and no other
   verdict carries it.
8. `graphic` marks carry no `near_miss`; `no_graphic` marks carry no `class`,
   `acceptable` or `ideal`.

**RULES**

- Never invent a field. Every document here is `additionalProperties: false`;
  an unknown key is a hard rejection, not a warning.
- Do not mark every sentence. Mark the moments a competent editor actually
  deliberated over — but mark enough of them (25–40) that one changed mind does
  not move the score by a quarter.
- Where you are guessing rather than reading, say so in `why` and lower
  `source.level`. A confident mark you could not see is worse than no mark.

---

## What to do with the output

1. `mkdir evals/overlays/<case>/` and save the three files into it, with `case`
   in `marks.json` matching the directory name.
2. Narrate `script.txt` through the channel's TTS and save the resulting
   `subtitles.srt` beside them.
3. Check the case before spending anything on it. Offline, instant, free:

   ```bash
   cd worker && uv run python -m lusora_worker.evals.overlays check ../evals/overlays/<case>
   ```

   It runs the eight self-checks above and reports **all** the faults at once,
   not the first — a case is usually pasted out of a model's answer, and one
   fault per round trip is the expensive way to fix five. It also warns when a
   case is too small to measure anything. Exit code is non-zero only on a real
   fault; an advisory means the case is valid and worth less.

   `cd worker && uv run pytest -q tests/test_eval_overlays.py` then holds every
   committed case to the same rules in CI.

4. Run the video, then score the `beats.json` it produced:

   ```bash
   uv run python -m lusora_worker.evals.overlays score ../evals/overlays/<case> <beats.json>
   ```

5. Record the numbers in [`evals/BASELINE.md`](../evals/BASELINE.md), with the
   pipeline, the model and the date. **Run it more than once**: a single run's
   score is mostly noise, and the useful reading is which MARKS fail repeatedly.
