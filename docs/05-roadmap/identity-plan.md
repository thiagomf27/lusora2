# Identity — the shot must be the person it names

When the narration is about a specific real person, the video currently shows
whoever the search happened to return, and sometimes puts that person's name on
them. This is the plan to stop it, in the order it is worth fixing.

**The rule everything here follows: a wrong face is worse than no face, and a
wrong face with a name on it is worse than both.** Where identity cannot be
established, the video says the name in type rather than guessing at a
photograph (D55's degrade already builds that card).

---

## The reproduction

`data/videos/vid_bb05c1b483eb`, shipped. Beat b61 is about the Norwegian
explorer Carsten Borchgrevink:

```
beat b61   anchors: [name] "Carsten Borchgrevink"
  queries sent:  "man jumping rowboat shore"
                 "explorer stepping ashore"
                 "landing rocky beach historical"
  resolved:      source=stock  provider=pexels  score=None
  overlay:       NamePlate {"name": "Carsten Borchgrevink", "role": "norueguês"}
```

A modern stock photograph of an unrelated man, captioned with a real
19th-century explorer's name. Nothing in the pipeline was wrong by its own
lights: the planner wrote a fair visual description, the search returned a good
match for it, and the compiler filled the NamePlate from the anchor exactly as
designed.

The one video that got this right — `vid_481bc9d3094a`, whose queries were
`"Joseph Strauss portrait"` and `"Joseph Strauss engineer"` — got it right by
luck, because the model happened to put the name in the query. Nothing required
it to.

---

## Why this is not a search-quality problem

Three facts, each of which defeats a tempting cheap fix.

**Similarity cannot do identity.** "Man stepping ashore" is *genuinely* similar
to any man stepping ashore, so the wrong person scores high and is right to.
Raising `chain[].min_score` throws away good footage without touching the
failure.

**Two of the three sources cannot ever be right.** Pexels does not have
Borchgrevink; it has photographs of men. An image generator does not know what
he looked like; it produces a plausible stranger, which is a fabricated likeness
of a real person carrying that person's name. The chain is
`library → stock → ai_image`, so **every library miss on a person beat lands on
a wrong face** — that is a structural guarantee, not bad luck.

**The safety net cannot cover them.** D55's `min_score_floor` degrade is gated
on `score is not None`, and only the library returns a score — `stock` and `ai`
both return `None` by construction (`providers/sources.py`). The one mechanism
built to catch "technically an asset, visibly unrelated" is structurally unable
to fire on the two sources that produce this failure.

## And the pipeline mostly cannot even see the problem

Across all 306 beats in `data/videos`, **2 carry a `name` anchor.** Meanwhile
`vid_bb05c1b483eb`'s own script names Carsten Borchgrevink, Edward Bransfield,
James Clark Ross and James Cook, and `vid_05544aeb5c28` names nine such
entities. (Counted with a crude capitalised-bigram proxy, which also catches
places and companies — the exact number is not the point; the order of magnitude
is.)

So identity is not merely mishandled, it is usually **unrecorded**. Any fix that
keys only off the `name` anchor would cover a small fraction of the beats that
need it — and `name` does not distinguish a person from a company or a place
either (`Taylor Farms` and `Pearl Harbor` are `name` anchors too).

---

## What this plan will not do

- **No face recognition.** Verifying a face against a reference is a different
  system with different failure modes, and the honest fallback removes the need.
- **No generated likenesses of real people**, on any channel, by default. A
  convincing portrait of someone who never sat for it is the failure, not the
  fix.
- **No guessing from context.** "The only man in the shot must be him" is how
  the current bug reasons.

---

## Slice 1 — the sources that cannot be right are never asked

**Why first.** It is the whole of the reproduction, it needs no new field, and
it can be detected for free: when a beat's own overlay is a `NamePlate` or
`PortraitPlates` filled from a `name` anchor, that beat is *declaring* that a
named person belongs to that moment. No inference required — the sheet said so.

**What changes.** On such a beat, `resolve_assets` skips `stock` and `ai_image`
entirely and walks only the sources that could hold that person. If the chain
comes back empty, `degrade.to_title_card` draws the card, which is what the
beat's own words already say.

`source_policy.visual.identity.sources` names the sources allowed to serve one,
defaulting to `["library"]`. It is config because a channel that wires an
editorial stock source (Getty and the like, which *does* index named people)
should be able to say so — but the default is the one that cannot be wrong.

**Exit criterion.** Re-resolving `vid_bb05c1b483eb` b61 produces a card, not a
stranger, and the event log says why. No other beat in the corpus changes.

**Decision-log entry.** Yes — the rule, and why `ai_image` is excluded by
default rather than by configuration.

---

## Slice 2 — the beat says who its shot depicts

**Why.** Slice 1 covers beats that carry a name overlay. It does not cover the
much larger set where the narration is about a person, the shot is meant to be
of them, and no graphic is involved — which, on the census above, is most of
them.

**What changes.** A beat may carry `depicts`, naming the real person its shot is
of:

```json
{"id": "b61", "script_text": "…Carsten Borchgrevink saltou…",
 "visual_intent": "Carsten Borchgrevink stepping from a rowboat onto rock",
 "depicts": {"kind": "person", "name": "Carsten Borchgrevink"}}
```

Three properties make it safe to ask a model for:

- **It is validated against the span**, exactly as `anchors[].source_words` is:
  the name must appear verbatim in that cut's own text, so it cannot be invented
  or carried over from elsewhere in the script.
- **It is optional and its absence means nothing.** A beat that omits it is
  treated exactly as today, so the field cannot regress a channel that never
  emits it.
- **`kind` is a closed vocabulary** (`person` for now) and therefore welded, not
  editable — a beat claiming to depict a person is what turns the source policy
  on.

The name is then forced into the library query rather than left to the model's
phrasing, which is the difference between the two videos above.

**Exit criterion.** On the four reference cases plus the two person-bearing
videos, every span that names a person and describes a shot of them carries
`depicts`, and no span that merely mentions one does. Marked by hand — this is
an authoring judgement, and the eval has no case for it yet.

---

## Slice 3 — the library can answer "is this them?"

**Why.** After slices 1 and 2 an identity beat is *safe* and almost always a
card, because nothing verifies a library hit either. This is the slice that lets
it be a photograph.

**What changes.** A hit for an identity beat is accepted only if it actually
references the person: the name (normalised) appears in the segment's `tags`,
its `caption`, or its `source_name`. That is a hard filter applied to the
returned rows, not a similarity nudge — `library_search` ranks by cosine and
would put a stranger first with a clear conscience.

`caption_edited` is worth reading here. The library records whether a human
rewrote a caption or whether it is still the vision model's first guess, and the
tagger never names people — it emits "subject, action, setting" and a factual
sentence. So a name in a human-edited caption is a real identity claim, and a
name in a generated one is a coincidence worth distrusting. Ranking verified
hits by that flag costs nothing and is the difference between a curated library
and a lucky one.

**What this exposes.** The library cannot identify people on its own, so a
channel gets verified footage only for people someone has tagged. That is the
true shape of the problem and slice 4 is its answer — this slice makes the gap
visible instead of filling it with strangers.

**Exit criterion.** A clip tagged with a person's name is returned for that
person's beats and for no one else's; an untagged library is indistinguishable
from an empty one, and the beat degrades to its card.

---

## Slice 4 — the channel's cast list

**Why.** Identity cannot be inferred, only curated. Everything above makes the
pipeline safe and honest; this is what makes it *useful*.

**What changes.** A per-channel register of the people a channel talks about,
each with the assets approved to depict them — uploaded into the library,
tagged with the person's name, scoped to that channel. An identity beat then
resolves deterministically from the register before any search runs.

Open questions this slice has to settle, and they are the reason it is not
higher: where the register lives (channel config, a `contracts/people/` document
or purely library tags), whether one person may be shared across channels, and
what happens when a register entry and a library tag disagree.

**Exit criterion.** A channel with a cast list produces the right face for every
person in it, and a card for everyone else, with no run-to-run variation.

---

## Slice 5 — the human can see and fix what degraded

**Why.** Cards are honest, not finished. A degraded identity beat is exactly the
thing a person should be shown at the review checkpoint.

**What changes.** The beat review screen marks beats whose shot degraded for
identity, says which person could not be found, and offers the upload that fixes
it — which is also the cheapest way to grow the cast list, since the person
doing the review is the one who knows the face.

**Exit criterion.** Reviewing a video with an unknown person takes one upload
and no config editing.

---

## The order, and why

1 before 2 because 1 stops the observed damage with no new contract. 2 before 3
because verification needs to know who to verify. 3 before 4 because the
register is only worth building once something enforces it. 5 last because it is
the only slice that assumes the rest works.
