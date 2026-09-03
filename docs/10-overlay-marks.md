# Overlay marks — turning a reference video into an eval case

[Doc 09](09-video-teardown.md) asks a reference video *how does this channel
look*. This one asks it a narrower and harder question: **where does a graphic
belong, and — more importantly — where does one not.**

The output is a `marks.json`: a human's judgement, in the schema
`contracts/schemas/overlay_marks.schema.json`, that the scorer in
`worker/lusora_worker/evals/overlays.py` measures a beat sheet against. Nothing
in the production pipeline ever reads it. It is an instrument, and its only job
is to make "did that prompt change help?" a question with an answer.

The two prompts share the Overlay Rule and the component menu **verbatim** —
quoted below from doc 09 rather than restated — so a teardown and an eval case
cannot come to different conclusions about what an overlay is for.

## Before you start

Read [evals/overlays/README.md](../evals/overlays/README.md) for the case
layout. You need `script.txt` in hand before marking: every mark names words
from it, and a mark whose words are not in the script is a case bug the scorer
refuses to score.

Where the reference's own transcript *is* the script, use it as `script.txt`
directly — that is the cleanest case, because the marks and the narration then
describe the same sentences. Where you are marking a script your own channel
wrote, mark that one.

## What to send with it

The same evidence ladder as doc 09, and the same honesty about it:

| Level | What you attach | What the marks are worth |
| --- | --- | --- |
| **L1** | the transcript only | you can mark `graphic` / `no_graphic` from what the narration *says*, but not from what the reference *did*. That is a judgement about the script, not a measurement of a channel — say so in `source.level` and do not report `component_accuracy` from it |
| **L2** | transcript + screenshots at noted timestamps | the real thing. You can see which moments got a graphic and roughly what kind |
| **L3** | the above + a graphics list (timestamp + what it showed) for the whole video | every mark is measured, and the `no_graphic` marks become trustworthy — which matters more here than anywhere else, because a moment you simply did not see is indistinguishable from a moment the reference deliberately left alone |

**The `no_graphic` marks are the expensive half.** At L1 and L2 the temptation
is to mark only the moments you saw a graphic on, which produces a case that can
measure recall and cannot measure restraint — the one number this whole line of
work exists to move.

## The prompt

Paste everything from here to the end of this section, then attach the
evidence.

---

You are marking up a reference video's narration to build the ground truth for
an overlay eval. Return exactly one JSON document and nothing else: a
`marks.json` valid against `contracts/schemas/overlay_marks.schema.json`.

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

THE THREE VERDICTS

- `graphic` — a graphic belongs at this moment. Give `class` (`anchor` or
  `emphasis` per the rule above), `acceptable` (every component that would be a
  defensible choice), and `ideal` (the best of them, and it MUST be one of
  them). Listing several acceptable components is normal and correct: the
  question is whether the planner chose defensibly, not whether it guessed
  which one you would have picked.
- `no_graphic` — a graphic does NOT belong here, and placing one is a real
  cost. Where the span genuinely contains an anchor, say which type in
  `near_miss`.
- `unmappable` — the reference did something this pipeline has no field for.
  Set `excluded_from_scoring: true` and say what it was in `why`. The moment is
  then dropped from every score, because we are not measuring capabilities we
  never claimed.

WHAT MAKES A GOOD `no_graphic` MARK

A negative on a span with no anchor in it is FREE — the pipeline's anchor gate
already refuses to decorate it, so marking it proves nothing. The marks that
carry the whole eval are the ones where a graphic **would have been legal** and
the reference still said no. Every one of those gets `near_miss`. Reasons a
professional editor says no on a legal anchor:

- the shot already carries the fact (the ledger is on screen; do not caption it)
- a second figure in the same breath is the one the viewer must actually read
- the anchor is scene-setting the viewer will never be asked to recall
- the narration is moving too fast for anything to be read
- a graphic is already on screen and this would stack on it
- the moment is emotional and a data card would flatten it

Aim for **at least as many `no_graphic` marks as `graphic` ones**, and for at
least half of the negatives to carry `near_miss`. A case without that balance
can only measure recall.

SOURCE WORDS

Every mark names `source_words`: a verbatim, contiguous span copied from the
script, occurring **exactly once** in it. Not a timestamp — the case's script
is re-narrated by our own TTS, so the reference's timings do not transfer.

- Copy the words exactly, including punctuation and capitalisation.
- If a phrase occurs twice in the script, lengthen it until it is unique.
- Keep it to the words the graphic is ABOUT — the figure, the name, the
  statement — not the whole sentence around it.
- Put the reference's own timestamp in `at` if you have it. It is for a human
  re-checking your work; the scorer ignores it.
- Prefer marks in separate sentences. Two verdicts inside one sentence usually
  land in one beat, and a negative sharing a beat with a positive is reported
  as unscorable rather than counted.

COMPONENT MENU (choose `acceptable` and `ideal` only from this list)

| anchor type it can take | components in the core catalog |
| --- | --- |
| `number` | AnimatedCounter, RankLabel, StatTag |
| `percentage` | AnimatedCounter, PieChart, StatTag |
| `comparison` | BarChart, ComparisonSplit, PieChart |
| `place` | RouteMap, SatelliteLocate |
| `date` | DateStamp |
| `name` | NamePlate, PortraitPlates |
| `quote` | HighlightedPassage, QuoteBlock |
| none — carries no anchor, so it is only ever `class: emphasis` | ArchivalFrame, BulletList, CalloutArrow, ChapterCard, DataTable, DefinitionCard, DocumentCard, FactCard, FactSheet, FramedExhibit, HammerStatement, KineticTitle, LineChart, RegionHighlight, StepFlow, Timeline |

If a channel installs a component pack, add its entries to the table before
marking — the pack a case is scored under is pinned in the case's `cfg.json`.
If the reference's graphic matches nothing on this list, the mark is
`unmappable`, never a near-enough substitute.

OUTPUT

One JSON document, no prose around it:

```json
{"version":"1.0","case":"<the directory name you will save this under>",
 "source":{"url":"…","title":"…","level":"L2","marked_by":"…","marked_on":"YYYY-MM-DD"},
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

RULES

- Never invent a component name. The schema does not check them, but the
  scorer's numbers are worthless if `acceptable` names something that does not
  exist — cross-check every name against the menu above.
- `ideal` must be a member of `acceptable`. The scorer rejects the case if not,
  because a best choice that is not an allowed choice means the mark says two
  different things.
- Do not mark every sentence. Mark the moments a competent editor actually
  deliberated over. A case of thirty considered marks beats one of two hundred
  reflexive ones.
- Where you are guessing rather than reading, say so in `why` and lower
  `source.level`. A confident mark you could not see is worse than no mark.

---

## What to do with the output

1. Save it as `evals/overlays/<case>/marks.json`, with `case` matching the
   directory name.
2. Put the narration in `script.txt` beside it, and the frozen style pack and
   channel rules in `cfg.json`.
3. Narrate `script.txt` through the channel's TTS and save the resulting
   `subtitles.srt`. (Every shipped TTS adapter emits `tts_timings.json`, so
   this needs no Whisper pass.)
4. Run the video, then score the `beats.json`:

   ```bash
   cd worker
   uv run python -m lusora_worker.evals.overlays score ../evals/overlays/<case> <beats.json>
   ```

5. Record the four numbers in [`evals/BASELINE.md`](../evals/BASELINE.md), with
   the pipeline, the model and the date. A score with no baseline beside it
   answers nothing.
