# Identity — never person A's name over person B's face

When the narration is about a specific real person, the video currently shows
whoever the search happened to return, and sometimes puts that person's name on
them. This is the plan to stop it, in the order it is worth fixing.

**The rule everything here follows: the video may show whatever b-roll it can
find, and the one thing it may never do is talk about person A while presenting
a portrait of person B.**

That is narrower than "do not show what we cannot verify", and deliberately so.
A shore, a ship, a crowd, a map, a document — all fine over narration about a
person nobody has a photograph of. What is forbidden is a shot that READS AS A
PORTRAIT of a specific someone standing in for a different specific someone,
which is the only thing that makes a false claim about a real person.

So an identity beat asks two questions, not one:

1. **the identity question** — "footage of Carsten Borchgrevink". Only a source
   that could actually know him may answer it. A hit here is a real portrait and
   the video is correct.
2. **the scene question** — "rocky Antarctic shore, wooden rowboat pulled up,
   1890s". Any source may answer this, Pexels included. It is real b-roll and it
   makes no claim about anyone's identity.

When 1 misses, 2 plays. The frame is never blank, and the video never lies. The
typographic card is the LAST resort — what happens when even the scene question
comes back empty, which is the same condition that stops a video today.

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

## The card is the last resort, and it does not exist yet

An earlier draft of this plan made the card the ANSWER when a person could not
be found. That was wrong twice over — once on taste, which is the rule above,
and once on fact.

**Almost no pack configures one.** `style_pack.fallback` names the component,
and six of the seven shipped packs leave it `null` — including
`descoberta-doc`, the pack of the very video this plan reproduces. With no card
named, `degrade.to_title_card` returns `None` and keeps the weak asset.

**It has never fired.** The weak-match path is gated on
`source_policy.visual.min_score_floor`, and no `cfg.json` in `data/videos` sets
it. As far as the corpus can show, this degrade has never run in production. It
is a mechanism, not a safety net.

**And `ChapterCard` is the wrong card for a person.** Its own catalog entry says
`when_not_to_use: … a person's name (NamePlate)`. It is a full-screen act break
between sections.

**What follows.** Because the card is now the last resort rather than the plan,
none of this blocks slice 1 — the scene question is what fills the frame, and it
is served by the sources that already work. But the last resort still has to
exist: skipping a source without supplying anything makes `resolve_item` return
`False` and `run_resolve_assets` raise `source chain exhausted for beat …`, so
the video stops instead of degrading. When it is reached it should carry the
person's NAME, not `card_text`'s `queries[0]`, which on the reproduction would
have titled it "Man Jumping Rowboat Shore".

## What this plan will not do

- **No face recognition.** Verifying a face against a reference is a different
  system with different failure modes, and the honest fallback removes the need.
- **No generated likenesses of real people**, on any channel, by default. A
  convincing portrait of someone who never sat for it is the failure, not the
  fix.
- **No guessing from context.** "The only man in the shot must be him" is how
  the current bug reasons.
- **No pixel inspection.** The portrait guard in slice 1 reads what a source
  SAYS about a clip — the library's own tags and caption, a stock photo's `alt`
  text — never the image. It is a filter on metadata and will let some faces
  through; the scene question is what keeps those faces from being presented as
  anyone in particular.

---

## Slice 1 — no unverified shot is presented as a named person

> **DONE 2026-09-08 (D91).** Detection from the compiled plan, the identity
> question restricted to `source_policy.visual.identity.sources`, the scene
> question on the whole chain with `no_person` set, metadata guards on the
> library and Pexels, a welded "draw nobody" block in the image pack, and a
> built-in `NamePlate` card replacing the `source chain exhausted` error.
> Verified against the real `vid_bb05c1b483eb` plan: b61 is detected and its
> identity question now goes only to the library. Not re-rendered — no
> provider spend, and the sources it would have to call are live ones.

**Why first.** It is the whole of the forbidden case, it needs no new field, and
it can be detected for free: when a beat's own overlay is a `NamePlate` or
`PortraitPlates` filled from a `name` anchor, the sheet has already declared
that a named person belongs to that moment. No inference required.

**What changes, in three parts.**

*The identity question is asked only of sources that could answer it.*
`stock` and `ai_image` are skipped for it — Pexels does not have Borchgrevink,
and a generator does not know what he looked like, so both return a stranger
with a clear conscience. `source_policy.visual.identity.sources` names who may,
defaulting to `["library"]`; a channel wiring an editorial stock source (which
does index named people) can say so.

*When it misses, the scene question runs instead of the chain ending.* Until
slice 2 the scene query is the beat's own remaining `queries[]` — the best
material available today — and stock and AI serve it normally, because it makes
no claim about anyone. This is what keeps the frame full.

*And a portrait of somebody else is refused where a source admits to one.* A hit
for the scene question is rejected when what the source SAYS about it describes
a person as its subject: the library's `tags` and `caption`, a Pexels photo's
`alt`. Best-effort by construction — it reads metadata, never pixels — and the
library is already the better half of it, because its fine pass is told to
"exclude talking heads" at ingest.

**The NamePlate stays.** An earlier draft dropped it, which was an
over-correction: a name super over an establishing shot of the place is ordinary
documentary grammar and tells the viewer who is being discussed. It is only
wrong over a claimed portrait of the wrong person, and after this slice the shot
under it is either verified or makes no claim at all.

**Exit criterion.** Re-resolving `vid_bb05c1b483eb` b61 puts a shore, a boat or
a coastline on screen — not a stranger — with the `NamePlate` still reading
"Carsten Borchgrevink", and the event log says the identity question went
unanswered. It must work on `descoberta-doc` unchanged: that pack configures no
fallback, and a fix that needs configuring first is not on where the bug is.

**Decision-log entry.** Yes — the two-question rule, and why `ai_image` is
excluded from the identity question by default rather than by configuration.

---

## Slice 2 — the beat writes the scene question

**Why.** Slice 1's fallback is whatever `queries[]` already held, and on the
reproduction that is `"man jumping rowboat shore"` and `"explorer stepping
ashore"` — person-free of NAME, but person-shaped in every other way, so they
invite exactly the portrait the guard then has to reject. The model should write
the shot that has no one in it, because it is the only party that knows what the
moment is about.

It also covers the much larger set slice 1 cannot see: beats where the narration
is about a person, the shot is meant to be of them, and no graphic is involved.
Of 306 beats in `data/videos`, two carry a `name` anchor — so detection by
overlay alone reaches almost none of them.

**What changes.** A beat may carry `depicts`:

```json
"depicts": {
  "kind": "person",
  "name": "Carsten Borchgrevink",
  "without_them": ["antarctic rocky shore", "wooden rowboat beached", "1890s polar expedition"]
}
```

`without_them` is the scene question: two or three keyword queries for the same
moment with the person taken out of it. Three properties make this safe to ask
for:

- **`name` is validated against the span**, exactly as `anchors[].source_words`
  is — it must appear verbatim in that cut's own text, so it cannot be invented
  or borrowed from elsewhere in the script.
- **`without_them` is validated not to contain the name**, and rejected if it
  does. A fallback that names the person is not a fallback.
- **The whole field is optional and its absence means nothing.** A beat that
  omits it behaves exactly as today, so a channel that never emits one cannot
  regress.

The name is then forced into the identity query rather than left to the model's
phrasing — which is the entire difference between the two videos in the
reproduction.

**Exit criterion.** On the two person-bearing videos, every span that names a
person and describes a shot of them carries `depicts`, no span that merely
mentions one does, and every `without_them` reads as a shot with nobody in it.
Marked by hand: this is an authoring judgement and the eval has no case for it.

---

## Slice 3 — the library can answer "is this them?"

**Why.** After slices 1 and 2 an identity beat is *safe* and always answers the
scene question, because nothing can verify a library hit either — so the
identity question never hits. This is the slice that lets the video show the
person when it does have them.

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
from an empty one, and the beat falls to its scene shot.

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
person in it, a scene shot for everyone else, and no run-to-run variation in
either.

---

## Slice 5 — the human can see and fix what degraded

**Why.** A scene shot is honest, not finished — the video is talking about
someone it cannot show. That is exactly the thing a person should be shown at
the review checkpoint, and the reviewer is the one who knows the face.

**What changes.** The beat review screen marks beats whose shot degraded for
identity, says which person could not be found, and offers the upload that fixes
it — which is also the cheapest way to grow the cast list, since the person
doing the review is the one who knows the face.

**Exit criterion.** Reviewing a video with an unknown person takes one upload
and no config editing.

---

## The order, and why

1 before 2 because 1 stops the forbidden case with no new contract, using the
queries a sheet already has. 2 before 3 because the fallback should be a good
shot before the identity hit is worth chasing, and because verification needs to
know who to verify. 3 before 4 because the register is only worth building once
something enforces it. 5 last because it is the only slice that assumes the rest
works.

Note what the order buys: after slice 1 the video is never wrong. After slice 2
it is never wrong AND the fallback is a shot someone chose. Slices 3 and 4 are
what make it *right* rather than merely not-wrong, and they are the ones that
need curation rather than code.
