# Video teardown — turning a reference YouTube video into a channel

The other authoring prompts ([07](07-authoring.md)) start from a description
of what you want. This one starts from a video that already exists: you hand
Claude a reference (or several from the same channel) and it returns the four
data documents that make LUSORA produce videos in that style — a style pack, a
theme, a script prompt pack and a channel config fragment — plus an honest list
of what the pipeline **cannot** imitate.

It is a separate prompt because it is a different job. Authoring asks "what do
I want"; a teardown asks "what is actually on screen, how often, and which of
our fields carries it". Everything in the output has to land in a field that
exists — a teardown that returns `"zoom_punch_transitions": true` has produced
a nice essay and nothing the compiler can read.

## What to send with it

Claude cannot watch a YouTube link. The quality of the answer is set entirely
by the evidence you attach, so the prompt asks for a confidence label on every
number and the labels are only as good as this list:

| Level | What you attach | What you get |
| --- | --- | --- |
| **L1** | the URL and the auto-transcript | script voice and length are real; every pacing and overlay number is a guess |
| **L2** | transcript + 15–25 screenshots at noted timestamps, sampled across the video | colors, overlay style and rough density are real; shot lengths still estimated |
| **L3** | the above + a shot list (timestamp of every cut for one 90s window) and a graphics list (timestamp + what it showed) | every number in the style pack is measured |

L3 is an hour of work for a channel you intend to run for a year, and it is the
difference between a pack that feels like the reference and one that feels
adjacent to it. `ffmpeg -i ref.mp4 -vf "select='gt(scene,0.4)',showinfo" -f null -`
gets you most of the shot list; the graphics list is manual.

Send **three videos from the same channel** where you can. One video is a
sample of size one — the prompt asks for the per-video numbers *and* the merged
pack precisely so the spread becomes the channel's range instead of noise.

## The prompt

Everything the model needs is inlined — the closed vocabularies, the component
menu, the six shipped packs — so it works in a fresh conversation on claude.ai
with nothing attached but your videos.

```text
You are doing a STYLE TEARDOWN of a reference video for LUSORA, an automated
faceless-video pipeline. Your output is not an essay: it is a set of data
documents the pipeline will execute, plus an honest account of what it cannot
reproduce.

INPUTS
- Reference video(s): [URLs]
- Evidence attached: [transcript / screenshots at timestamps / shot list / graphics list / nothing]
- Channel language: [e.g. pt-BR]
- Slug to use for the new documents (kebab-case): [e.g. tecno-breakdown]

HOW LUSORA WORKS (you may only produce values these documents accept)

A video is: one narration script -> a beat sheet (the AI's judgment: what to
show, per span of script) -> a compiled timeline -> a render. Personality lives
in four data documents and NOWHERE else:

1. STYLE PACK — the rhythm. Hold lengths, overlay density, allowed transitions,
   script length and persona, how often sound cues fire. Read by the beat
   planner (an LLM) and the compiler.
2. THEME — the look. Four colors, two fonts, corner/fill/entrance/easing
   tokens, grain, which sound cue plays, mood -> music bed, the mix. The AI
   NEVER sees it; only the renderer does.
3. COMPONENT PACK — the menu of overlays that exist. A channel installs exactly
   ONE pack.
4. SOUND PACK — the menu of audio files that exist.

Plus a CHANNEL CONFIG (language, voice, video type, where footage comes from)
and a SCRIPT PROMPT PACK (how the narration is written).

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

CLOSED VOCABULARIES (anything outside these is invalid; if the reference needs
something not on a list, that goes in Part H, never in the JSON)

- video_type: doc | explainer | breakdown | listicle
- arc: three_act | linear | listicle
- transitions: cut | crossfade | fade | fade_to_black
  (crossfade and fade are the same dissolve in the engine today)
- mood (8, chooses the music bed for a SECTION, never one beat):
  neutral, tense, somber, hopeful, urgent, triumphant, reflective, playful
- media_preference: video | image | any
- anchor types: percentage, number, comparison, place, date, name, quote
- caption_preset: plain | boxed | serif-lower-third
- motion_feel: slow_heavy | neutral | fast_light
- grain: none | archival | film
- surface.radius: square | soft | rounded
- surface.fill: solid | translucent | none
- surface.accent_rule: top | left | none
- motion.entrance: fade | rise | slide | pop | wipe | typewriter
- motion.easing: smooth | snap | spring | linear
- production_style: faceless | talking_head | animation | shorts | ultra_longform | custom
- orientation: landscape | portrait | square
- short_clip_fallback: loop | slow | freeze
- fonts: named by string, resolved to a family — anything containing Courier /
  Mono / Consolas / Menlo -> monospace; Playfair Display / Georgia / Times New
  Roman / Merriweather / Lora -> serif; everything else -> sans (Inter is the
  house default). Do not name a font outside those groups.

THE COMPONENT MENU (a channel installs ONE pack)

core (26) — anchor gate in brackets, [] means pure text:
  Titles & statements: KineticTitle[], ChapterCard[], HammerStatement[]
  Cards & lists: FactCard[], FactSheet[], DefinitionCard[], BulletList[],
    StepFlow[], CalloutArrow[]
  Quantities: AnimatedCounter[number,percentage], StatTag[number,percentage],
    BarChart[comparison], LineChart[], ComparisonSplit[comparison],
    RankLabel[number]
  Sources & exhibits: QuoteBlock[quote], HighlightedPassage[quote],
    DocumentCard[], FramedExhibit[], ArchivalFrame[]
  Time & place: DateStamp[date], Timeline[], NamePlate[name],
    SatelliteLocate[place], RouteMap[place], RegionHighlight[] (editor-only,
    the planner never picks it)
archive (7) — hard-edged paper plate + tan strip, for archival documentary:
  ArchiveLowerThird, ArchiveCaption, ArchiveChapterTitle, ArchiveQuoteCard,
  ArchiveCounter, ArchiveBarGraph, ArchiveLineChart
doc-minimal (8) — stripped-back versions: MinimalArchivalFrame,
  MinimalChapterCard, MinimalAnimatedCounter, MinimalDateStamp,
  MinimalDocumentCard, MinimalFramedExhibit, MinimalNamePlate,
  MinimalDefinitionCard

New overlays are cheap ONLY if they fit one of five template shapes — card,
lower_third, big_number, bullet_list, statement — which are data-only, no code.
Anything with its own geometry or data drawing (maps, charts, mark-ups,
annotations) needs a React component written by hand. Say which, per graphic.

THE SOUND MENU
- pack doc-restrained — cues: swoosh-soft, thud-low, chime-soft, tick-typing
- pack punchy — cues: swoosh-bright, pop-tight, riser-short, thud-low, tick-typing
- both ship one bed per mood: neutral-01, tense-01, somber-01, hopeful-01,
  urgent-01, triumphant-01, reflective-01, playful-01
A sound outside these lists means a new sound pack (files, licensing) — Part H.

THE SIX SHIPPED STYLE PACKS — if the reference lands within ~15% of one of
these on hold length AND overlay density, say so and recommend using it as-is
with an override, rather than shipping a near-duplicate seventh pack:

| pack | type | avg_hold | min | max | arc | density/min | packs |
|---|---|---|---|---|---|---|---|
| doc-slow | doc | 4.0 | 2.5 | 8.0 | three_act | normal (2.5) | archive, core |
| archive-doc | doc | 4.5 | 2.5 | 9.0 | three_act | low (1.0) | archive, core |
| explainer-medium | explainer | 3.2 | 2.0 | 6.0 | three_act | normal (2.5) | core |
| breakdown-fast | breakdown | 2.6 | 1.6 | 5.0 | linear | high (5.0) | core |
| breakdown-blitz | breakdown | 2.4 | 1.4 | 4.5 | linear | 9 | core |
| listicle-fast | listicle | 2.2 | 1.4 | 4.5 | listicle | high (5.0) | core |

MEASUREMENT PROTOCOL — follow it in order, show the arithmetic

1. Sample windows. Measure the first 30s separately from a representative 60–90s
   window in the body. Openings are almost always faster than bodies; a single
   average over both describes neither.
2. Pacing. Count changes of the BASE shot (footage/image swaps), not overlay
   changes. shots_per_minute -> avg_hold_seconds = 60 / shots_per_minute.
   min_hold = shortest hold you actually saw; max_hold = longest. Set
   hold_floor_ratio 1.0 and hold_ceiling_ratio 1.5 unless the reference
   deliberately holds one image for a minute (then raise the ceiling).
3. Overlay density. Count only fact-carrying graphics (rule above) -> set
   overlays.density.per_minute. Count pure-text lift cards separately -> if
   >0, set overlays.emphasis.enabled true and its per_minute. Report the
   uncountable third category as a number too, so I can see what I am losing.
4. Transitions. Tally the joins. Most frequent -> transitions.default; the set
   you saw -> transitions.allowed. Map anything exotic to the nearest of the
   four and flag it in Part H.
5. Script. words / minutes from the transcript -> words per minute. Confirm
   against 2.5 words/second, which is what the pipeline assumes. Total speech
   duration -> script.target_seconds. Keep tolerance 0.25 unless the channel is
   visibly rigid about length.
6. Sound. Is there a bed at all? Does it change at section turns (-> how long a
   typical section runs, which sets music.min_span_s) or run unbroken (->
   min_span_s longer than the video)? Do cues fire on graphic entrances, on
   cuts, or never? cues/minute -> sfx.max_per_minute; closest two cues ->
   sfx.min_gap_s. Cues on every transition at a 3s hold is 20/minute — if the
   reference does that, say so explicitly, because it is unusual.
7. Look. From frames: background, body text, accent, and a muted neutral, as
   hex. Corner treatment, panel fill, whether an accent bar/rule appears and
   where. How graphics arrive (entrance) and how sharply (easing). Grain.
8. Captions. Burned-in or none? Which preset is closest? Sentence-at-a-time,
   word-at-a-time, or chunks?
9. Voice. Describe register, pace, and delivery in a sentence — the pipeline
   cannot select a voice from a description, so this is a shopping note for me,
   not a config value.
10. Sourcing. Where does the footage come from — stock, archival, AI-generated
    stills, screen recordings, the creator's own? Longest single continuous
    source shot -> max_clip_seconds. That becomes the source chain, in
    preference order.

OUTPUT — exactly these parts, in this order

A. VERDICT. One paragraph. The three mechanisms that actually make this video
   feel the way it does, ranked. Not a summary of the content.

B. MEASUREMENTS. A table: metric | observed value | evidence (timestamps) |
   confidence (measured / estimated / guessed). One row per number that ends up
   in Part C or D. "Guessed" is an acceptable answer; a measured-looking number
   with no evidence is not.

C. STYLE PACK. Complete JSON for contracts/style-packs/<slug>.json. Keys are
   closed (additionalProperties: false) — only: name, video_type, pacing
   {avg_hold_seconds, min_hold, max_hold, arc, hold_floor_ratio,
   hold_ceiling_ratio}, overlays {density, allowed_packs, emphasis
   {enabled, per_minute}}, transitions {allowed, default}, script_persona,
   visual_language, script {target_seconds, tolerance, prompt}, fallback
   {component, text_prop}, sfx {enabled, cues, max_per_minute, min_gap_s},
   music {enabled, min_span_s, crossfade_s}.
   - script_persona and visual_language are read by the AI. Write them as
     instructions to a writer and a location scout, not as adjectives.
   - allowed_packs names PACKS, never components. `fallback.component` must be
     in one of them.
D. THEME. Complete JSON for contracts/themes/<slug>.json: name, colors
   {bg, text, accent, neutral}, typography {display, body, caption_preset},
   motion_feel, grain, surface {...}, motion {entrance, easing, per_component},
   sound {pack, entrance, per_entrance, transition, mood_beds, gain
   {sfx, music_duck, music_lift}}. Keep motion.per_component sparse — three
   entries at most, exceptions only.
E. CHANNEL CONFIG FRAGMENT. YAML, only the fields that differ from defaults:
   video_type, production_style, theme, style_pack, component_pack, language,
   captions, output, content_rules, and source_policy.visual.chain in
   preference order with max_clip_seconds / orientation / min_score_floor.
F. SCRIPT PROMPT PACK. Complete JSON for contracts/prompts/script/<slug>.json:
   {name, role: "script", video_type, description, system, user}. Derive the
   ban list from tics you actually observed in the transcript, quoting them.
   The system half must NOT restate output format or language rules — those are
   welded in already. Wire it by setting script.prompt to <slug> in Part C.
G. OVERLAY MAP. A table: timestamp | what was on screen | what it carried
   (fact type, or "pure text", or "decorative") | LUSORA component, or "new:
   template <kind>", or "new: needs React". Cover every distinct graphic KIND,
   not every instance.
H. NOT REPLICABLE. Each item: what the reference does, why no field carries it,
   and the closest thing we can do. Check this list explicitly and say
   "not present" where it does not apply: talking head or face cam; speed ramps
   (only a flat 0.5x slow-down exists); zoom/whip/glitch transitions; motion
   tracking or annotation stuck to a moving subject; hand-drawn markup; meme
   cutaways with their own audio; picture-in-picture (only a corner-placed
   media overlay at <=1.0 scale exists); per-word caption animation; control of
   the Ken Burns push on stills (it is automatic on every image, always a
   centered 12% push in, and not authorable); multi-column layouts; anything
   that reacts to a beat in the music.

RULES
- Never invent a field. Every document listed is additionalProperties: false;
  an unknown key fails validation at enqueue. If the reference needs something
  with no field, it belongs in Part H.
- Keep the layers separate. Colors, fonts and entrances are THEME and the AI
  never sees them, so no color words in visual_language. Hold lengths, density
  and persona are STYLE PACK and the renderer never sees them.
- The density words map to numbers: low = 1.0, normal = 2.5, high = 5.0 per
  minute. If your measurement is not one of those, write the numeric form.
- Do not write an `allowed_components` list — it is superseded by
  allowed_packs.
- A channel installs exactly ONE component pack, so allowed_packs must include
  the pack you put in the config fragment. Do not propose a combination whose
  intersection is empty.
- Multiple reference videos: give Part B per video, then ONE merged Part C/D,
  and state where the videos disagreed. Disagreement is the channel's range —
  it belongs in min_hold/max_hold, not averaged away.
- If the evidence cannot support a number, say what to send: the exact
  timestamps or frames that would settle it.
```

## What to do with the output

1. Save Parts C, D and F to the paths they name, then `pnpm run validate:schemas`.
   The schemas are the real check; a document that validates will at least
   enqueue.
2. Point a channel at them — Part E is the fragment. Verify the intersection
   rule the prompt warns about: the channel's `component_pack` must be one of
   the style pack's `allowed_packs`, or nothing will draw.
3. Run one video and compare it against the reference side by side. The two
   numbers that miss most often are `avg_hold_seconds` (scene detection counts
   camera moves as cuts, so it reads low) and overlay density (the planner only
   places an overlay where there is a fact, so a script with few numbers lands
   under its own budget — that is the anchor rule doing its job, not a bug).
4. Iterate on the style pack, not the code. Everything in Parts C–F is
   snapshotted into `cfg.json` at enqueue, so edits never disturb an in-flight
   video and a re-run reproduces the old numbers.

Part H is the part worth re-reading before you commit to a channel. A reference
whose whole identity is speed ramps and tracked annotations is not a channel
this pipeline can run — better to learn that from a table than from six videos
that came out almost right.
