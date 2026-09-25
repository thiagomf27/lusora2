# Directed edit: a test mode where Claude makes the edit decisions

The script is written outside LUSORA (Master Script OS, visual scripting off).
After it is locked, **one extra pass in a Claude web chat** makes the decisions
that need judgment:

- sections and their mood
- the overlays, attached to verbatim phrases
- the emphasis lines
- the hook
- the handful of hero shots

The pass outputs a small block that is pasted under the script. DeepSeek keeps
the high-volume work: what each of ~300 beats shows and what to search for.

**The rule this plan follows: Claude's block is a human-provided artifact,
applied by code, like an uploaded `beats.json`.** It never drives the pipeline
(llm-usage §8), it is not a fourth agent (D2), it never names a sound (D8/D50),
and the narration is never changed. A phrase that does not match the script
fails loudly at paste time, before anything costs money.

Status: **evaluated, not built.** Verdict: **go, with changes** (below). The
test runs on 1–2 minute videos first, then one 20-minute confirmation run.

---

## Finding 0: the premise describes v2, and production is v3

The proposal assumed DeepSeek segments the script in `plan_beats` (a spine
call, then one call per ~30-beat chunk choosing segmentation, visuals, mood,
anchors and overlays). That is exactly what **`faceless_v2`** does, and
`DESCOBERTA_01` was pinned to it (`channels.config.pipeline`). It is not what
production does:

| | `faceless_v2` (the D52 planner) | `faceless_v3` (production, D84) |
|---|---|---|
| where the script is cut | DeepSeek, retyping `script_text` per beat ([planner.py:507](../../worker/lusora_worker/agents/planner.py#L507)) | **code**, `cut_beats` → [steps.py:249 `cut_script`](../../worker/lusora_worker/pipeline/steps.py#L249) (D88) |
| visuals / queries / mood / anchors | same calls | `beatcraft`, answered **by cut index**, no menu ([beatcraft.py:204](../../worker/lusora_worker/agents/beatcraft.py#L204)) |
| overlays | same calls, full component menu in every chunk | a separate stage `select_overlays` → `overlays.json` (D87, [overlay.py](../../worker/lusora_worker/agents/overlay.py)), **authoritative** in the compiler ([core.py:41-58](../../worker/lusora_worker/compiler/core.py#L41)) |

So on v3, "DeepSeek keeps segmentation" is already false, because segmentation
is deterministic. Directed mode is built on **v3 mechanics**, and the
control arm of the A/B is `faceless_v3`. All channels move to v3 (decision 2,
below).

---

## Measured: what the edit decisions cost today

Calibrated from real cost events, not guessed:

- vid_ac2fd06b90d3's first craft chunk composes to 4,928 characters and billed
  1,381 input tokens.
- Its overlay call composes to 11,356 characters and billed 2,904 tokens.
- That puts both at ~3.6–3.9 chars/token.

Prices are deepseek-v4-flash, $0.44 in / $1.32 out per 1M
(`contracts/prices.json`). The target is 2,900 words pt-BR at **142 wpm**, the
measured rate of the descoberta voice on vid_bb05c1b483eb and
vid_05544aeb5c28. That is ≈ 1,225 s, ≈ 306 cuts at a 4 s hold, and 10 chunks
of 30.

| path | calls | input tokens | output tokens | $ (flash) |
|---|---|---|---|---|
| v2 (what DESCOBERTA_01 ran) | spine 1 + 10 chunks | spine ~5.8k; chunk composes to **22.8k chars ≈ 6.8k tokens**, of which the component menu is **13.8k chars (60%)**: ~74k total | spine 9.6k + **~780/beat** (vid_bb05, 67 beats, no repair): ~250k | **≈ $0.36**, + ~$0.035 per repair |
| v3 (control) | beatcraft 10 (+~40% repairs, as measured) + select_overlays 10 | beatcraft 8.2k chars ≈ 2.4k/call: ~34k. **select_overlays: 329k chars per 30-candidate chunk ≈ 87k tokens/call**: ~870k | beatcraft **405/cut** incl. repairs (vid_ac2fd): ~124k; overlays ~10k/call: ~100k | beatcraft ≈ $0.18 + overlays ≈ **$0.51** = **≈ $0.69** |
| directed | beatcraft 10, **byte-identical prompt to v3** | ~34k | ~124k | **≈ $0.18**; the Claude web pass is $0 marginal |

The composed sizes come from calling `planner._build_prompt`,
`beatcraft._build_prompt` and `overlay._build_prompt` on real video folders.
The per-beat output figures come from 2–3 videos. pt-BR chars/token is not yet
measured, and slice 5's report measures both.

### A separate finding: `select_overlays` on descoberta-doc

D87 sized a candidate at "~400 tokens per decision". On descoberta-doc a
candidate is ~10.7k characters (~2.8k tokens). The pack enables the emphasis
class, and [`_candidate_menu`](../../worker/lusora_worker/agents/overlay.py#L60)
then adds **every** no-anchor component (~21 of them, prop shapes included) to
**every** beat. That makes every beat a candidate, and one 30-beat chunk ≈ 87k
input tokens. It is the most expensive DeepSeek step in v3 on this pack, and a
context-window risk that has not been measured. **It needs its own fix
whatever happens to directed mode**, for example a shortlist of emphasis
components per pack or per beat. Directed mode happens to remove the stage.

---

## Decisions already made (2026-09-24)

1. **Control arm = `faceless_v3`.** No v2 arm: comparing directed against v2
   would move two variables at once (the D84 argument).
2. **Every channel on v3.** Only `DESCOBERTA_01` pinned another pipeline
   (`faceless_v2`); the rest already resolve to v3 through `production_style`.
   A pasted script also makes v2's `research` stage pure waste.
3. **No cold open by default.** The hook is the first narrated line. So v1 of
   the block has no `cold_open`/`outro`; the hook is an ordinary pin on the
   opening words. A timed cold open (D58) can be added as an optional key if a
   later test asks for it.
4. **Claude round-trips: target 1, allow 1 fix, flag at 3.**
   - Normal: one edit-pass turn (~2 min to paste and wait).
   - Acceptable: one repair turn, using the ready-made message the paste check
     returns.
   - Counts against directed mode: a median above 1 repair, any video needing
     ≥ 3 round-trips, or more than ~10 minutes per video.

   These are **logged, not remembered** (slice 3).
5. **Test on 1–2 minute videos**, on a new style pack `directed-test`:
   descoberta-doc's pacing and visual language, `overlays.allowed_packs:
   ["basic"]`, and **no per-minute limit** (`density: {per_minute: 60}`,
   `emphasis: {enabled: true, per_minute: 60}`). The schema has no maximum, so
   one graphic per beat becomes the only real cap. See [the test pack](#the-test-pack).
6. **wpm = 142 with a 10% margin** for now; a per-voice setting later. With the
   test pack's budgets uncapped, wpm only affects the estimated duration shown
   at paste.
7. **Only basic.** The test menu is basic's seven components. Core is excluded
   on the test channel through `look.exclude.components`.
8. **The blind review uses the editor preview**, not the rendered MP4s.
9. **A new test channel** carries `directed-test`, so DESCOBERTA_01 is
   untouched.

---

## Part 1: evaluation

**Verdict: GO WITH CHANGES.** The changes, each argued below:

1. Build on v3 (`cut_beats` + `beatcraft`), not the v2 planner.
2. Make pins a deterministic pass inside `cut_beats`; do not ask DeepSeek to
   respect them.
3. Code writes the pins **into `beats.json`**, not into `overlays.json`.
4. No `hero` field.
5. DeepSeek does not fill the unused budget.
6. Validate twice: in the platform at paste ($0), and in a worker `edit_hints`
   stage placed **before narration**, so a bad block never reaches paid TTS.

### 1. Planner strategy or test pipeline? A test pipeline, with a manifest-read switch

It is **not** `planner.llm = agent` (llm-usage §8,
[:416](../02-components/llm-usage.md#L416)). That strategy has an agent author
the whole `beats.json`. Here Claude authors a **partial** artifact that code
merges onto the cuts, which is D88's arrangement (text and timing from code,
decisions keyed to positions) with a second author.

It does keep §8's one rule: *it produces contract artifacts, it does not drive
the pipeline.* Claude web is outside the system. `edit_hints.json` arrives the
way an uploaded `beats.json` does (D62 `receivable_on_upload`), so D2's three
bounded agents stay three, and the minimal version needs no new prompt role.

It needs a manifest for two reasons:

- the precedent (D64's `faceless_v2`, D84's `faceless_v3`): a new stage with no
  track record lands as `stability: test`, `bulk_production_accepted: false`
- the A/B needs a pinnable name

The manifest is **`contracts/pipelines/faceless_directed.yaml`**: v3's stage
list **minus `select_overlays`**, plus an **`edit_hints`** stage right after
`script` (`receivable_on_upload: true`). The body only validates, and fails
loudly when the file is missing.

The code switch is `"edit_hints" in cfg.pipeline_doc.stages`, the same
snapshot-reading pattern as
[`_planner_menu_for`](../../worker/lusora_worker/pipeline/steps.py#L195).
Every other pipeline composes and cuts byte-identically by construction. One
trap: with no `select_overlays` in the list, `_planner_menu_for` would hand
beatcraft the **full catalog menu**. The directed switch must keep it `""`.

### 2. How pins are respected: one code pass in `cut_beats`

Options (a) "tell DeepSeek not to split", (b) "code splits/merges after DeepSeek
segments" and (c) "code pre-cuts at pins" all assume a model segments. On v3
nothing does, so the three collapse into one deterministic pass,
`respect_pins(parts, pins, min_hold)`, run after `_under_the_ceiling` inside
[`cut_script`](../../worker/lusora_worker/pipeline/steps.py#L249).

Every piece `cut_script` produces is a run of whole whitespace-words:
`beatphases` splits only at `\s+` after `. ! ? … ; : ,`, and `_word_split`
slices at spaces. So a pin becomes a word-index range and the pass needs no
string matching:

1. **Heal.** A pin phrase straddling a boundary merges the two pieces.
2. **Separate.** A piece holding two overlay pins, or two hero pins, is split
   at the word boundary between them. Its time is apportioned by
   character share (`_apportion`, the rule `srt_alignment` already uses), and
   the floor is waived for that one cut.
3. **Emphasis pins start their beat.** Force a cut at the phrase's first word,
   and merge a sub-floor remainder *backward*. An anchor overlay is timed to
   its `source_words` by `_subject_start`
   ([core.py:1044](../../worker/lusora_worker/compiler/core.py#L1044)), but an
   emphasis overlay has no anchor. It falls back to its props text, which is
   rarely spoken verbatim, and then to `beat start + 0.4 s`. For the line the
   video exists for, "somewhere in this beat" is not good enough.

Why this is the safe choice:

- **Coverage is true by construction.** Pieces are only joined or divided at
  spaces, never retyped, so `validate_beat_sheet`'s verbatim, ordered, gap-free
  coverage check cannot fail for a pin.
- **There are no repair loops**, because no model is involved in cutting.
- **The cuts equal the control's everywhere except next to a pin**, which keeps
  the A/B honest; the report counts the cuts that differ.

**How this interacts with D51.** A heal can push a beat over the ceiling, and
a forced cut can leave one under the floor. Both are handled downstream
without touching the beat sheet:

- [`_enforce_hold_floor`](../../worker/lusora_worker/compiler/core.py#L446)
  merges *visual slots*, and the absorbed beat keeps its overlay and mood.
- [`_enforce_hold_ceiling`](../../worker/lusora_worker/compiler/core.py#L501)
  divides an over-long slot, and the overlay stays on its beat.
- The beat-count window in `validate_beat_sheet` moves by a handful of beats
  at most.

**Sections do not force cuts.** A beat takes the mood of the section holding
most of its words. `music.min_span_s` (25 s on descoberta) already absorbs a
one-beat slip (D50).

### 3. What the DeepSeek prompt loses, and what it saves

**Against v3 (the control): nothing changes in the beatcraft call.** Its
prompt is already menu-free wherever overlays are a separate stage, so the
directed arm sends the **same bytes**. What disappears is the whole
`select_overlays` stage: ≈ $0.51 per 20-minute descoberta video, ~74% of v3's
DeepSeek bill, and ten ~87k-token calls.

**Against v2 (what DESCOBERTA_01 ran):**

- no spine call (≈ $0.015)
- no 13.8k-character component menu in every chunk (60% of each chunk's input)
- no overlay/emphasis rules or budget in the prompt
- no retyped `script_text`

Net ≈ −$0.18 (−50%). v2's two commonest repair causes, verbatim coverage and
overlay density, also go: the first because code owns the text, the second
because the model is no longer choosing overlays.

**Still asked, and wasted in directed mode:** beatcraft answers `mood`
(overwritten by the sections) and `anchors` (unused without overlays).
Dropping them needs a slimmer prompt role and would save an estimated 10–20%
of the answer tokens. That is **deferred to slice 7** on purpose: keeping the
beatcraft call identical to the control's is worth more to the A/B than a few
cents.

### 4. Which checks run on the block alone, at paste time

Every rule `validate_beat_sheet` and `validate_overlay_selection` apply to
overlays and anchors, sorted by when they can run:

| check | at paste (platform, $0) | otherwise |
|---|---|---|
| schema, anchor type, comparison value shape `[{label, value}]` | yes | |
| anchor `source_words` inside its beat's span | yes, **reformulated**: `at` must match the script exactly once under textmatch's keys, and code then copies **the script's own substring** into `source_words`. The stricter `textsplit.normalize` check ([validators.py](../../worker/lusora_worker/validators.py) coverage/anchor loop) passes by construction | |
| component in the catalog and in the video's resolved `allowed_components` | yes: [`applyComponentPack` + `applyLook`](../../platform/src/lib/look.ts#L83) on the channel config and pack, exactly as at enqueue | re-checked by the worker stage, since the catalog may change in between (the D43 welded-half argument) |
| class derived from the catalog (D86): emphasis enabled; no `role: anchor` on a no-anchor component | yes | |
| component accepts the anchor's type (`anchor_ref` is always the injected anchor) | yes | |
| `props_hint` values ([`check_prop_value`](../../worker/lusora_worker/validators.py#L22)) | yes (TS mirror) | |
| **required props present** (hint ∪ from-anchor ∪ default) | yes. **This is new**: today only [`validate_plan`](../../worker/lusora_worker/validators.py#L467) catches it, at compile, labelled "(bug)" | |
| one graphic per beat ([validators.py:704](../../worker/lusora_worker/validators.py#L704)) | yes, as "no two pin phrases overlap"; the cut guarantees the rest | |
| budgets, anchor and emphasis ([`max_overlays_for`](../../worker/lusora_worker/validators.py#L133)) | **estimate only**: duration = words ÷ wpm | authoritative at `plan_beats` entry, with the real audio length, **before any DeepSeek call** |
| a number/percentage anchor's `value` is actually in `at` ("never invent numbers") | no: needs textmatch's number runs, which the TS subset does not port | worker `edit_hints` stage, before narration |
| geocode of place anchors (SatelliteLocate, RouteMap) | no: the gazetteer is Python ([geo.py:81](../../worker/lusora_worker/compiler/geo.py#L81)) | worker `edit_hints` stage, before narration |
| readable minimum, overlay overlap | no: needs timing | compile, as today |

**Normalization.** Phrases are located with
[`textmatch.tokenize`](../../worker/lusora_worker/compiler/textmatch.py#L82) +
[`compare_key`](../../worker/lusora_worker/compiler/textmatch.py#L75) (fold
case and diacritics, drop punctuation, split dashes, `Dr.` ↔ `doutor`). A small
TS port does the same without the number-word tables. Both languages assert
one expectation table, `contracts/fixtures/rules/edit_hints_rules.json`, the
way both already assert `overlay_rules.json`, so the two cannot drift.

### 5. `hero`: no beat-sheet field

Nothing would read it. `resolve_assets` has no "best asset" behavior to attach
it to, and `notes` and the superseded `music[]` show what an unread field
becomes. For the test, **a pin carrying `visual_intent`/`queries` is the hero
decision.** Code writes them over DeepSeek's on that beat and sets
`media_preference: "video"`. Which beats were hero stays recorded in
`edit_hints.json`, which the A/B report reads.

A v1.3 field is worth adding only if both of these hold:

- the A/B shows hero beats scoring better
- a resolver behavior is designed for them, such as library-first, more
  candidates or a stricter score floor

### 6. Unused budget: DeepSeek does nothing

Filling it would put two deciders into one arm, and the A/B could no longer say
which of them made the difference. It would also bring back the costs directed
mode removes (the menu or the candidate calls). If Claude under-spends, that is
a result: the prompt states the budget, and in the test pack there is none. A
"Claude + DeepSeek fill" arm is a separate variable for a later test.

### 7. Risks and failure modes

| risk | handling |
|---|---|
| a phrase is not found | the paste error names the phrase, shows the nearest match in the script, and asks for the exact words. Never fuzzy-applied |
| a phrase is ambiguous | the error lists every occurrence with its surrounding words: "lengthen it until it is unique" |
| Claude edits or reprints the script | the script half is what **you** pasted from Master Script OS; the block carries no script (a `script` key fails the schema); every `at` must match the pasted text; the prompt says never reprint |
| the pasted script carries markdown or asterisks | an uploaded script skips `validate_script`, so the paste check runs a TS port of its rules as **errors**: the TTS reads asterisks aloud, and three shipped videos did |
| two pins in one beat | `respect_pins` splits between them; overlapping phrases are a paste error |
| a mood change inside a beat | majority-of-words assignment; a section shorter than `music.min_span_s` is a paste warning, because the compiler would absorb it anyway |
| over budget once the real narration length is known | the prompt asks for ≤ 90% of the estimate; `plan_beats` re-checks with the real duration **before** DeepSeek and fails with a paste-back message (TTS is spent by then, the LLM is not). Moot in the uncapped test pack |
| re-run, per-beat recompile, editor edits (D14) | pins are written **into `beats.json`** (anchor, overlay, intent, queries, mood), so the editor, locks and [`_merge_recompiled`](../../worker/lusora_worker/pipeline/steps.py#L532) behave exactly as on any pipeline without `overlays.json`. Deleting `beats.json` re-applies the block deterministically |
| **existing v3 bug found during this evaluation** | the platform never reads `overlays.json` (no reference anywhere in `platform/src`), but the compiler treats it as authoritative ([core.py:41-58](../../worker/lusora_worker/compiler/core.py#L41)). **On v3, an overlay changed in the beat editor is silently ignored at recompile.** Directed avoids it by writing no `overlays.json`; the control arm has it. Out of scope here, but it needs a fix of its own |
| the catalog changes between paste and run | the worker stage re-validates against the current catalog |

---

## The edit block (format v1)

Same key names as `beats.json`, nothing the code can derive, and as few tokens
as possible for Claude to write:

```
<script text, exactly as written>

===LUSORA EDIT v1===
{
  "style_pack": "directed-test",
  "sections": [
    {"from": "<the script's opening words>", "mood": "somber"},
    {"from": "<first words of the turn>", "mood": "tense"}
  ],
  "pins": [
    {"at": "<the hook: the opening words>",
     "overlay": {"component": "TextTitle", "props_hint": {"text": "..."}},
     "visual_intent": "...", "queries": ["...", "..."]},
    {"at": "quase 70% das fábricas",
     "anchor": {"type": "percentage", "value": 70, "label": "fábricas convertidas"},
     "overlay": {"component": "TextCounter", "props_hint": {"suffix": "%"}}},
    {"at": "<the line the section turns on>",
     "overlay": {"component": "TextBanner", "props_hint": {"text": "..."}}},
    {"at": "<a key moment>", "visual_intent": "...", "queries": ["...", "..."]}
  ]
}
===END===
```

Changes from the first proposal:

- **Removed `anchor.source_words`.** It is `at`, and code copies the script's
  own words into it.
- **Removed `anchor_ref`.** It is always the anchor the pin carries.
- **Removed `role`.** The catalog derives it (D86).
- **Removed `hero`.** A pin with a `visual_intent` is the hero.
- **Removed `summary`.** Nothing reads it.
- **Removed the `broll` wrapper.** Its keys sit on the pin with their
  `beats.json` names.
- **Removed `cold_open`** (decision 3).
- **Kept `style_pack`, as an assertion.** It must equal the video's resolved
  pack, because the menu and budgets Claude was shown depend on it.
- **`sections[0].from`** must be the script's opening words.
- **`mood` is one of the eight words** in `channel_config.schema.json`. That is
  stricter than `beat.mood`, which degrades unknown words, because an attended
  author can fix a typo.
- **`additionalProperties: false` everywhere, and no sound keys** (D8/D50).

How code applies a pin to the beat containing it:

- appends `{type, value, label, source_words: <script substring>}` to its
  `anchors`
- sets `overlay = {component, anchor_ref: <that index>, props_hint}`
- replaces `visual_intent`/`queries` and sets `media_preference: "video"`
  when the pin has them
- sets every beat's `mood` from its section

Then the unchanged `validate_beat_sheet` judges the result.

---

## The test pack

`contracts/style-packs/directed-test.json` (slice 5):

- descoberta-doc's `pacing`, `visual_language`, `transitions`, `sfx` and
  `music`
- `overlays.allowed_packs: ["basic"]`
- `density: {"per_minute": 60}` and `emphasis: {"enabled": true,
  "per_minute": 60}`

What follows from it:

- **"Only basic" needs two settings on the channel** (decision 7).
  [`applyComponentPack`](../../platform/src/lib/look.ts#L83) builds the menu
  from `core` plus the **channel's** `component_pack`. The style pack's
  `allowed_packs` only *permits* a pack; it installs nothing. Slice 2 found
  this and pinned it in a test. So the test channel sets:
  - `component_pack: "basic"`
  - `look.exclude.components` = the 29 core names

  The menu is then basic's seven components and nothing else. The generator
  must resolve the menu through the channel (`--channel` or `--config`), or it
  would print core instead.
- **Every basic component except TextCounter is emphasis-class**, since none
  of them takes an anchor. Emphasis must therefore be on. There are no
  place/name anchors, so no geocode and no D91 identity question.
- **No cap means restraint is the whole test.** v3's overlay prompt tells the
  selector "YOU ARE ALMOST CERTAINLY UNDER-USING YOUR BUDGET… Spend it". With
  no budget, expect the control to decorate nearly every candidate.
  Overlays-per-minute is a headline number, and whether that is good is the
  blind review's call.
- **At 1–2 minutes a video is one beatcraft chunk.** Chunking, the 87k-token
  overlay calls and budget margins are not exercised. One 20-minute pair on
  descoberta-doc is required before promotion.

---

## Part 2: the A/B

**Arms.**

- **A** = `faceless_v3`, pinned.
- **B** = `faceless_directed`.

Both run on the `directed-test` pack, on a test channel, with the same 1–2
minute scripts.

**Same audio, nothing shared downstream.**

1. Run A to the end.
2. `pnpm ab:fork --from <vidA> --pipeline faceless_directed --edit paste.txt`
   creates B, copying **only** `script.txt`, `audio.mp3`, `subtitles.srt` and
   `tts_timings.json`.

The last file is not in `UPLOADABLE` today, and without it B would compile
from the SRT while A compiled from the TTS timings, which is a confound
nobody would see. The fork asserts the two `cfg.json` snapshots are equal
except `pipeline_doc`. The report asserts:

- the four files have equal sha256
- A has no `edit_hints.json` and B has no `overlays.json`

Nobody edits either video before it is scored.

**The table.** `uv run python -m lusora_worker.ab_report <vidA> <vidB>` prints
one table from the two folders plus `cost_events` and `video_events`. `--json`
appends a row to `evals/directed/results.jsonl`.

| group | metric | source |
|---|---|---|
| model | DeepSeek calls, repair attempts per chunk, violation strings | `cost_events.details.attempt`, `video_events` "rejected" |
| model | tokens in/out and $ per operation | `cost_events` |
| overlays | anchor / emphasis count against budget; overlays per minute | `edit_plan.json` + catalog class |
| overlays | overlays dropped below readable minimum; compile or validate failures | compile notes, stage events |
| sound | mood changes per minute; music spans | `beats.json`, `edit_plan.audio` |
| visuals | distinct visual_intents; distinct assets; fallback intents | `beats.json`, plan, events |
| time | wall time per stage | `stage_times` |
| directed only | pins applied; cuts differing from A; source of each hero beat | `edit_hints.json`, `beat_cuts.json` |
| human | round-trips, errors per paste, minutes from first check to submit | `data/edit-pass/log.jsonl` |

**Blind review, in the editor preview** (decision 8). `ab_report --blind
<pair>` flips a coin and prints two editor links labelled only **X** and
**Y**. It also writes `evals/directed/<pair>/key.json` (not to open) and a
`scores.json` template.

The preview mounts the same `VideoComposition` the render uses, over the real
plan, so overlays, timing and music are the render's own. Both videos still run
to `final.mp4`, because QA and the compile checks are part of the comparison,
but nobody has to sit through the files.

One leak to avoid: the video page shows the pipeline name. Review from the
editor link only, and open nothing else about either video until the scores
are in.

Score each video 1–5 on:

1. **overlay relevance**: does each graphic carry something worth putting on
   screen?
2. **overlay timing**: does it land on the words it is about?
3. **mood / music fit**
4. **hook**: the first line and what is on screen under it
5. **b-roll at key moments**: the pin timestamps, scored in **both** videos,
   so the control is judged on the same moments

Then answer: **which one would you publish?** `--unblind` merges the scores into
the table.

**How many.** Use **5 scripts** on different topics, one A and one B each. On
script 1, run A twice to see DeepSeek's run-to-run noise at temperature 0.2.
That is 11 videos: about 5–10 minutes of unattended render each, and a few
cents of DeepSeek.

**Adopt if all of these hold:**

- B is preferred blind on ≥ 4 of 5 scripts.
- Mean rubric ≥ +0.5 on overlay relevance or b-roll at key moments, and no
  category ≤ −0.5.
- Compile/validate failures are no higher than A's.
- The round-trip rule holds (decision 4): median ≤ 1 repair, no video at ≥ 3
  round-trips, ≤ ~10 min per video, **as logged**.

**Stop** if B wins ≤ 2 of 5. **Before any promotion:** one 20-minute pair on
descoberta-doc, to see chunking, budgets and the cost table above for real.

---

## Part 3: slices

Each slice ships on its own, and **`faceless` and `faceless_v3` stay
byte-identical in every one**. Tests follow the existing style: worker pytest
per module, platform vitest per lib, and shared fixture tables where two
languages enforce one rule.

## Slice 0: the prompt by hand ($0, no code) — DONE

> **DONE 2026-09-24.** One run on a 262-word pt-BR script ("Cinco coisas das
> casas japonesas…", ~111 s at 142 wpm) with the Appendix A prompt:
> - **0 phrase misses.** All 3 sections and 15 pins occur exactly once under
>   textmatch keys, the first section opens the script, and no pins overlap.
> - **0 correction turns.**
> - The block is the fixture `contracts/fixtures/edit_hints.json`.
>
> Two soft findings, both turned into rules in slice 1:
> - Four phrases ran past the prompt's 8 words. That is harmless, so it became
>   a **warning**.
> - Two graphics are crowded by the next pin: "acaba a fila da manhã" gets
>   ~2.1 s against TextBanner's 2.5 s, and "Número três, o ofurô" gets ~1.7 s
>   against TextTag's 2 s. The compiler would drop both, so this became a
>   **warning** that says so at paste.

Paste [the draft prompt](#appendix-a-draft-edit-pass-prompt-directed-test-12-min)
into a new Claude chat with one real 1–2 minute script. Search the script for
every `at` and count misses and duplicates.

**Exit:** a block under ~2k tokens with ≤ 1 phrase miss.

## Slice 1: the contract and its validators — DONE

> **DONE 2026-09-24.** What was built:
> - [`edit_hints.schema.json`](../../contracts/schemas/edit_hints.schema.json)
>   and its fixture (the slice 0 block).
> - [`edithints.py`](../../worker/lusora_worker/edithints.py): `locate_phrase`,
>   `script_span` and `validate_edit_hints` → `(errors, warnings)`.
> - [`editHints.ts`](../../platform/src/lib/editHints.ts), plus
>   [`textmatch.ts`](../../platform/src/lib/textmatch.ts), a port of `fold`,
>   the equivalents, dash splitting and the currency skip.
> - A 29-case table,
>   [`edit_hints_rules.json`](../../contracts/fixtures/rules/edit_hints_rules.json),
>   built on the real block. Worker: 33 tests. Platform: 30 tests plus 2 skipped
>   as worker-only.
>
> Cross-checked outside the suites: for every shared case, both languages
> produce **identical** error and warning text. The one exception is the
> schema library's own wording (jsonschema vs Ajv). The TS side adds the
> unexpected key and the legal values to those messages, so a paste-back stays
> actionable.
>
> Decided while building:
> - A number anchor whose phrase contains a **different** number is an
>   **error**. A phrase with **no** readable number is only a **warning**,
>   because textmatch cannot read every written form ("7,3 bilhões"), and a
>   false error would stop a correct video.
> - The paste check does one thing the worker's beat-sheet validator does not
>   do before compile: it requires **required props**, counting a prop the
>   anchor fills or the compiler copies from the anchor's label as present.
> - Budgets are judged at the estimated duration. Going over the ceiling is an
>   error. Going over 90% of the estimate is a warning, since narration can run
>   faster than estimated.

- `contracts/schemas/edit_hints.schema.json` + `contracts/fixtures/edit_hints.json`.
- `worker/lusora_worker/edithints.py`:
  - `locate_phrase(script, phrase)` returns word ranges, matching on textmatch
    keys.
  - `validate_edit_hints(hints, script, cfg, est_duration_s)` reuses
    `check_prop_value`, `overlay_role`, `emphasis_policy`, `max_overlays_for`
    and `catalog_component` rather than restating them.
- `platform/src/lib/editHints.ts` mirrors it, with a `textmatch` subset (fold,
  equivalents, dash split, currency skip) as in `prompts.ts` / `prompts.py`.
- `contracts/fixtures/rules/edit_hints_rules.json` is asserted by
  `worker/tests/test_edit_hints.py` and `platform/test/editHints.test.ts`.
  Cases:
  - not found; ambiguous
  - accent-folded match
  - overlapping pins
  - emphasis off
  - wrong anchor type
  - missing required prop
  - spec-echo `props_hint`
  - unknown mood; a `script` key
  - first section not at the opening

Nothing reads these files yet.

**Exit:** both suites green on the same table.

## Slice 2: the prompt generator — DONE

> **DONE 2026-09-24.** What was built:
> - [`editPassPrompt.ts`](../../platform/src/lib/editPassPrompt.ts):
>   `renderEditPassPrompt` and `resolveStyleForConfig`. It is a library rather
>   than a script, so slice 3's paste screen can offer the same prompt with a
>   copy button.
> - The CLI [`platform/scripts/edit-pass-prompt.ts`](../../platform/scripts/edit-pass-prompt.ts),
>   run as `pnpm edit-pass-prompt`.
> - The editable preamble
>   [`contracts/edit-pass/craft.md`](../../contracts/edit-pass/craft.md).
> - The golden file [`edit_pass_prompt.txt`](../../contracts/fixtures/edit_pass_prompt.txt),
>   checked by 7 tests.
> - The `directed-test` style pack, pulled forward from slice 5 because the
>   generator needs it.
>
> How the generator resolves and renders:
> - **The menu.** It resolves the channel's menu with the same
>   `applyComponentPack` + `applyLook` enqueue runs.
> - **Budgets.** An uncapped pack says "no practical limit": the ceiling is
>   treated as absent at more than one graphic every 2 s, because no catalog
>   component is readable in less. A capped pack prints 90% of the estimate and
>   the hard ceiling.
> - **Moods** are read from `edit_hints.schema.json`, so they cannot drift from
>   the validator.
> - **Props:** from-anchor, computed, `emphasis` and file-path props are left
>   out, and a repeated prop description is printed once.
> - **Sorting** is by code point, so the golden file does not depend on the
>   machine's locale.
>
> Two corrections this slice made to the plan:
> - The test channel needs `component_pack: "basic"` (see [the test pack](#the-test-pack)).
> - DESCOBERTA_01's real menu is **36** components (core + basic), not 35.
>
> ```sh
> pnpm edit-pass-prompt --channel <id> --script roteiro.txt     # the real thing
> pnpm edit-pass-prompt --style-pack directed-test --minutes 1.5
> pnpm edit-pass-prompt --write-fixture                          # after a catalog change
> ```

`pnpm edit-pass-prompt --style-pack <p> [--channel <id>] [--minutes N |
--script file] [--wpm 142]` (`scripts/edit-pass-prompt.mjs`, reusing
`lib/catalog.ts`, `lib/look.ts` and `lib/pacing.ts`). It prints:

- **The menu**, resolved for the channel when one is given. Per component:
  - its name, its anchor types (or "emphasis"), and the first clause of
    `when_to_use`
  - each hintable prop's name, enum, `maxWords`, and whether it is required,
    with nested item shapes such as `events[{date≤3w, label≤8w}]`
  - never from-anchor, computed or `emphasis` props, or file-path props
    (`image`, `plate`, `src`)
- **The budgets**: 90% of `floor(per_minute × estimated minutes)`, or "no cap".
- **The rest**: the eight moods, the phrase rules, the format and the
  self-check.

The editable part is a short craft preamble, `contracts/edit-pass/craft.md`,
included verbatim. Everything else is generated, which is the D43 welded half.

A golden file, `contracts/fixtures/edit_pass_prompt.txt` (descoberta-doc,
20 min), runs in `pnpm run ci`, so a catalog change that alters the prompt is
a diff someone sees.

**Exit:** the golden file matches, and the Appendix A prompt is reproduced by
`--style-pack directed-test --minutes 1.5`.

## Slice 3: paste, check, log — DONE

> **DONE 2026-09-24.** What was built:
> - [`editPaste.ts`](../../platform/src/lib/editPaste.ts): split, script
>   rules, check, round-trip log, write-to-folder. It is pure: paths come in as
>   arguments, so it is testable without a database.
> - [`editPasteServer.ts`](../../platform/src/lib/editPasteServer.ts): channel
>   config + overrides merged as at enqueue, and the log path.
> - Two routes, `POST /api/edit-hints/check` and `POST /api/edit-hints/prompt`.
> - `POST /api/videos` takes `edit_paste` + `paste_session`.
> - The [`EditPasteBox`](../../platform/src/components/EditPasteBox.tsx) on the
>   quote page, below "Attached files".
> - [`script_rules.json`](../../contracts/fixtures/rules/script_rules.json)
>   pins the TS port of `validate_script` to the Python one.
> - Tests: platform 21 (editPaste) and worker 10 (script rules).
>
> Run against a live dev server (on a scratch `VIDEOS_ROOT`, so the real log
> stayed clean):
> - The first hand run's paste checks `ok`, attempt 1: 3 sections, 15 pins,
>   ~1m51s.
> - The same session with one broken phrase is attempt 2, with a repair
>   request naming the fix.
> - The prompt endpoint returns the 7-component basic menu.
> - Creating the video is **refused before any draft row exists**, because no
>   pipeline runs `edit_hints` until slice 4.
> - The quote page compiles. The box itself is client-rendered and was not
>   eyeballed in a browser.
>
> Decided while building:
> - **Script problems and block problems are kept apart.** A script problem
>   (markdown, a speaker label) is shown to you and never put in the repair
>   request, because telling Claude about the narration invites it to change
>   the narration.
> - **An attempt is a distinct BLOCK in a session, not a click.** Re-checking
>   the same block, or editing only the script half, does not count. The
>   session starts with the first check and resets on Clear.
> - **Checks run on paste and on the Check button, never per keystroke.**
> - **`UPLOADABLE` did NOT gain `edit_hints`** (a change from the plan below).
>   The paste route is the only way in, because it is the only way that checks
>   the block against its script. A bare `edit_hints.json` attachment could
>   only be schema-checked, and would arrive without the phrase checks that
>   make it safe.
> - **The paste is judged against the MERGED config** (channel + this video's
>   overrides). A pinned pipeline and the test channel's menu both live there,
>   just as at enqueue.

- `lib/editPaste.ts` splits on the markers. It tolerates ``` fences and CRLF,
  and rejects a second marker or an empty script half.
- `POST /api/edit-hints/check` returns `{ok, errors, warnings, pasteBack}`.
  `pasteBack` is ready to hand to Claude: "These phrases/overlays failed the
  check: … Output the whole corrected block, nothing else."
- The quote page gets a "Script + edit block" box that checks live and on
  submit, and shows the estimated duration at 142 wpm.
- `UPLOADABLE.edit_hints = "edit_hints.json"`, accepted only where the
  manifest declares the stage (`receivableForChannel`), so no other pipeline
  sees it.
- **Round-trip log (decision 4).** Each check appends `{ts, paste_session,
  attempt, script_sha256, errors[], warnings[]}` to `data/edit-pass/log.jsonl`.
  The accepted paste writes `edit_pass.json` into the video folder, carrying
  its `paste_session`.

**Exit:** a deliberately broken block produces a pasteBack that Claude fixes in
one turn, and the log shows two attempts.

## Slice 4: the directed pipeline — DONE

> **DONE 2026-09-24, D94.** What was built:
> - [`faceless_directed.yaml`](../../contracts/pipelines/faceless_directed.yaml).
> - The `edit_hints` stage, before narration. It counts as done only while
>   `edit_hints.checked.json` matches the block, the script and the catalog it
>   judged, so any change to one of them is judged again. (It first shipped as
>   "never done". The orchestrator re-asks the done-check after a stage runs,
>   so the first real video, vid_8d7284f07a23, failed right after its block
>   passed.)
> - `respect_pins` in [`steps.py`](../../worker/lusora_worker/pipeline/steps.py),
>   with three rules: heal, emphasis starts its beat, one graphic and one shot
>   per beat.
> - The directed branch of `run_plan_beats`: re-judge at the real duration,
>   then the unchanged craft call with no menu (or the mock planner), then
>   `apply_edit_hints`, then the unchanged `validate_beat_sheet`.
> - `apply_edit_hints` + `pin_spans` + `is_directed` in
>   [`edithints.py`](../../worker/lusora_worker/edithints.py).
> - 17 tests in `test_directed.py`, ending with the applied sheet compiling
>   into a plan.
>
> On the slice-0 script (no transcript, 111 s):
> - 7 of 29 cuts differ from v3, and every one of them holds a pin or is the
>   remainder beside one.
> - The two beats squeezed under a graphic's readable minimum, "acaba a fila
>   da manhã." (1.8 s) and "Número três, o ofurô." (1.7 s), are the two the
>   paste check warned about.
> - One side effect of rule 2: an emphasis pin that starts mid-sentence leaves
>   the words before it as their own beat. "Assim, uma pessoa toma banho
>   enquanto a outra usa o vaso, e" is that beat here. Watch it in the blind
>   review; the rule can be relaxed to anchor-style timing later.
>
> Still to do before a real video can run: the test channel (slice 5). Its
> config needs `pipeline: faceless_directed`, `style_pack: directed-test`,
> `component_pack: basic`, and the 29 core names in `look.exclude.components`.

- **`contracts/pipelines/faceless_directed.yaml`**: v3 minus `select_overlays`,
  plus `edit_hints` after `script`.
- **The `edit_hints` stage** re-validates with the current catalog, the
  gazetteer and the number-in-phrase check, before narration.
- **`respect_pins`** runs in `cut_script`, only when the manifest carries the
  stage.
- **The `run_plan_beats` directed branch:**
  1. budget re-check at the real duration, before any call
  2. `craft_beats` unchanged, with menu `""`
  3. `apply_edit_hints(doc, cuts, hints)`
  4. the unchanged `validate_beat_sheet`
- **D94 decision entry**, recording what this doc argues: Claude web as a
  human-provided artifact, pins by code, into `beats.json`, no `hero` field,
  no fill, and why a manifest.

**Tests:**

- the manifest equals v3 − `select_overlays` + `edit_hints`
- v3's composed beatcraft prompt and `beat_cuts.json` are unchanged on the
  fixtures
- `respect_pins`: straddle, two in one piece, emphasis start, floor and ceiling
  together
- an applied block passes the validator
- an over-budget block fails before `chat_fn` is called
- a missing `edit_hints.json` fails loudly

**Exit:** one 1–2 minute video renders end to end on `faceless_directed`.

## Slice 5: A/B tooling — DONE

> **DONE 2026-09-24.** What was built:
> - The test channel `DIRECTED_TEST_01`, created by SQL the user ran. It is a
>   copy of DESCOBERTA_01 (same voice, sources and theme) with:
>   - `pipeline: faceless_directed`, `style_pack: directed-test` and
>     `component_pack: basic`
>   - the 29 core names in `look.exclude.components`
>   - `script.target_seconds: 90`
>
>   The edit-pass prompt for it lists basic's seven components and nothing
>   else.
> - `pnpm ab:fork` ([`ab-fork.ts`](../../platform/scripts/ab-fork.ts), with
>   its pure half in [`abFork.ts`](../../platform/src/lib/abFork.ts)). The
>   fork's snapshot is the source's own snapshot with only `pipeline` and
>   `pipeline_doc` swapped. It is not re-enqueued from the channel, so a
>   channel edit between the two runs cannot become a second variable. The
>   four narration files are copied last, byte for byte. `ab_fork.json`
>   records the pairing. `--noise yes` forks the control onto itself for the
>   noise pair.
> - `python -m lusora_worker.ab_report`
>   ([`ab_report.py`](../../worker/lusora_worker/ab_report.py)), with five
>   modes:
>   - the table
>   - `--json`
>   - `--blind`: X/Y editor links, the key-moment timestamps, `key.json` and
>     `scores.json`
>   - `--unblind`
>   - `--summary`: the adopt/stop rules over every scored pair
>
>   Without a database the model and failure rows say so, and the rest still
>   prints.
> - [`evals/directed/README.md`](../../evals/directed/README.md): the
>   procedure, the rubric and the rules.
> - Tests: platform 6 (abFork), worker 12 (ab_report).
> - `videosRoot`/`videoFolder` moved to `lib/folders.ts`, re-exported by
>   `videos.ts`. `videos.ts` imports the auth module, which a plain node
>   script cannot load.
>
> Changed from the plan:
> - **The directed arm is made first**, from the quote page, and the control
>   is forked from it (`--pipeline faceless_v3`). The paste box is where the
>   round-trips are counted, and a block pasted into a command-line fork would
>   start its session over. The fork still works the other way round with
>   `--edit`. The pair is symmetric either way: the same four files, and the
>   same snapshot except the pipeline.
> - **Compile drops are counted, not read from notes.** `compile_plan` passes
>   no `on_note`, so a dropped overlay leaves no line. The report counts the
>   overlays decided (the selection on v3, the sheet on directed) against the
>   overlays compiled.
> - **The pair folder name is the two ids sorted**, not control first, because
>   it is printed beside the blind links.
>
> **First pair, 2026-09-24:** `vid_8d7284f07a23` (directed) and
> `vid_1549eeacea78` (v3 control) on the Japanese-houses script. This is the
> slice's exit.
> - **First impression:** directed 4, control 3. The score sheet was not filled
>   in, so this is not a blind result.
> - **Why the control lost:** the difference came from two moments. On the
>   numbered list, the control put a counter on each list position, and the
>   counter showed decimals while counting up. On "80% das casas" the
>   percentage sign was missing.
>
> Two of those three causes were bugs, not planner judgment, and both are
> fixed:
> - **Decimals mid-count (engine):** a count-up to a whole number passed through
>   2.3, 3.7…, and the compact number format printed them. `countedValue` in
>   the theme runtime now counts whole targets in whole steps.
> - **Missing "%" (compiler):** a percentage anchor stores the bare figure, and
>   nothing added the sign. The compiler now gives a counter on a percentage
>   anchor the suffix "%" unless the model wrote its own.
>
> Re-rendered with both fixes, the user judged the two arms **"almost on the
> same level"**. The pre-fix control is kept as `final.before-fixes.mp4`.
>
> **Decision: faceless_directed stays a test pipeline** (`stability: test`,
> pinned by name). It is not promoted. The work goes into the default DeepSeek
> planner instead. The first item there is the third cause, which is planner
> judgment: a list position ("Número cinco") read as a quantity and given a
> counter. That is a prompt change (the counters' `when_not_to_use` and the
> beatcraft anchor rule), to be measured on the overlay eval cases before
> anyone claims it helps.

- `pnpm ab:fork`
- `lusora_worker.ab_report` (table, `--json`, `--blind`, `--unblind`)
- `contracts/style-packs/directed-test.json` and a test channel
- `evals/directed/README.md` with the rubric and the adopt/stop rules

**Exit:** one pair runs and prints the table.

## Slice 6: docs

- `llm-usage.md` §8: directed edit is its first real instance, and the
  edit-pass prompt is generated, not a prompt pack.
- `beat-sheet.md`: the block maps onto existing fields, and there is no hero
  field.
- `pipeline.md`'s manifest table.
- `00-status.md`.

## Slice 7: after the A/B, only if it says adopt

- a slim `visuals` role that stops asking beatcraft for mood and anchors
- a resolver behavior for hero beats, if the scores earn one
- the 20-minute confirmation, then promotion or retirement

**Not in this plan, but found by it:** the descoberta `select_overlays` menu
size and the editor-vs-`overlays.json` bug. Each gets its own fix.

---

## Appendix A: draft edit-pass prompt (`directed-test`, 1–2 min)

Hand-written as slice 2 should generate it. Paste it into a **new** Claude
chat, then paste the final script below it.

```
You are the editor of a short documentary video. The narration below is final
and has already been recorded. Your job is to decide what the viewer SEES on
top of it: where the mood changes, which lines get text on screen, and which
moments deserve a specific shot. Another system chooses ordinary footage for
every other moment; you only mark the moments that need an editor.

You output ONE block in the exact format at the end, and nothing else. Never
reprint, fix, translate or shorten the script.

HOW TO THINK
- The hook is the first line of narration. Decide what is on screen while it
  is spoken: a title, a shot, or both.
- A graphic earns its place by carrying something the viewer should hold on
  to: a figure, a name, a place, a line that is the point of the section. A
  line that merely continues does not need one.
- There is no per-minute limit in this style. Restraint is your call: a video
  with text on every sentence is as broken as one with none. Aim for the
  moments an editor would actually cut to.
- Mood is a property of a SECTION (it chooses the background music). Change it
  only where the story genuinely turns. Sections shorter than ~25 seconds of
  speech (~60 words) are absorbed anyway.
- A key shot ("visual_intent") is for the few moments where generic footage
  would be wrong: a specific object, place or action the line depends on.
  Describe it like a location scout: concrete, visual, specific (subject,
  era, framing, light). Never abstract.

PHRASE RULES (checked by code — a mismatch is rejected)
- "at" and "from" are copied EXACTLY from the script: same words, same order,
  same spelling, in the script's language.
- 2 to 8 words, and unique in the script. If the words occur twice, add
  words until they occur once.
- "at" is where the graphic belongs: start it at the words the graphic is
  about (for a number, the number itself).
- Two pins may not share words.

MOODS (use exactly one of these words)
neutral, tense, somber, hopeful, urgent, triumphant, reflective, playful

COMPONENTS (the only ones that exist in this style)
Fact graphic — needs an "anchor" taken from the words in "at":
- TextCounter [anchor: number | percentage] a single figure the narration
  lands on, written onto the shot and counting up.
  props: prefix (≤1 word), suffix (≤3 words), decimals (0-2), label (≤8
  words; omit when the narration names the figure in the same breath),
  position = center|top_left|top_right|bottom_left|bottom_right,
  size = medium|big
Text graphics — no anchor; "props_hint" carries the text:
- TextTitle: the one line the shot is about — an opening title, the subject
  named. props: text* (≤12 words), sub (≤8), position, size = medium|big
- TextPlace: names a location the footage already shows, as a corner label.
  props: place* (≤6), country (≤5), position, size
- TextName: introduces a person by name while the narration continues.
  props: name* (≤6), role (≤7), position, size
- TextHighlight: a line where ONE phrase is the point; "mark" is that phrase
  and must be an exact substring of "text". props: text* (≤26), mark (≤8),
  label (≤8), position, size
- TextBanner: a claim stated flat across the shot in one bar while the footage
  runs. props: text* (≤14), position = bottom_left|bottom_center|top_left|top_center
- TextTag: a short line none of the above fit (a duration, a rank, a caption).
  props: text* (≤12), label (≤8), position, size
(* = required. position = center|top_left|top_right|bottom_left|bottom_right
unless listed. Leave out any prop you have no reason to set.)

ANCHOR (only with TextCounter)
{"type": "number" | "percentage", "value": <the number as a number, e.g. 70>,
 "label": "<what it counts, ≤8 words>"}
The value must be the figure the narration says in "at". Never compute or
round a new one.

OUTPUT — exactly this, JSON between the markers, nothing before or after:
===LUSORA EDIT v1===
{
  "style_pack": "directed-test",
  "sections": [
    {"from": "<the script's first words>", "mood": "<mood>"}
  ],
  "pins": [
    {"at": "<phrase>",
     "overlay": {"component": "<name>", "props_hint": {...}},
     "visual_intent": "<optional: scout description of the key shot>",
     "queries": ["<optional: 2-4 word search>", "<2-4 words>"]},
    {"at": "<phrase with a figure>",
     "anchor": {"type": "percentage", "value": 70, "label": "..."},
     "overlay": {"component": "TextCounter", "props_hint": {"suffix": "%"}}}
  ]
}
===END===
A pin needs an "overlay", a "visual_intent" + "queries", or both.
"queries" are 2-3 keyword searches of 2-4 words (never more than 5), subject
first, most specific first — stock libraries match words, not meaning.

BEFORE YOU ANSWER, CHECK
- The first section starts at the script's very first words.
- Every "at"/"from" is copied exactly and occurs once in the script.
- No two pins share words.
- Every TextCounter has an anchor whose value is the spoken figure.
- Every required prop is present, and every text fits its word limit.
- You did not reprint the script.

THE SCRIPT:
```

## Appendix B: the same prompt at 20 minutes on descoberta-doc

For the confirmation run, the generator swaps three blocks:

- **the budget** (2,900 words at 142 wpm ≈ 20.4 min, less the 10% margin):
  "At most **55** fact graphics (hard ceiling 63) and **11** emphasis
  graphics (hard ceiling 14), counted separately." (At a round `--minutes
  20`, the golden file prints 54/61 and 10/13.)
- **the menu**: DESCOBERTA_01's resolved **36** components (core + its
  `component_pack: basic`; 14 fact, 22 emphasis), in the same compact form
  with nested shapes. The whole prompt is ≈ 26k characters (≈ 7k tokens).
- **the anchor types**: all seven (`percentage | number | comparison | place |
  date | name | quote`), a `comparison` value being
  `[{"label": "...", "value": <number>}, ...]`.

---

## Open questions

None. The last three were settled on 2026-09-24 (decisions 7–9).
