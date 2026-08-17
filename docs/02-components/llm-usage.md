# LLM Usage — prompts, their contracts, and where they go next

Every place a model is called, what its output must satisfy, and how the
prompts are stored.

Prompts are **data** as of M10 (D42–D45): the editable half of each agent
prompt lives in `contracts/prompts/<role>/<name>.json` and is chosen per
channel, per style pack or per video; the contract half is welded into
`contracts/prompts/welded/`. Read this before touching any prompt:
several carry invariants that the validators, the compiler and the TTS
all depend on.

---

## 1. The map — every model call in the system

| # | Prompt | Composed in | Prompt text | Provider (default) | Budget | Output must be | Validated by |
|---|---|---|---|---|---|---|---|
| 1 | Script agent | `worker/lusora_worker/agents/script.py` | `prompts/script/` + `welded/script.system.txt` | `channel.script.llm` → `deepseek` | 8000 tok (prompt may raise), temp 0.7 | plain narration text | **nothing** (gap) |
| 2 | Beat planner | `worker/lusora_worker/agents/planner.py` | `prompts/planner/` + `welded/planner.{system,user}.txt` | `channel.planner.llm` → `deepseek` | 64000 tok, ≤3 attempts | beat sheet JSON | `validators.validate_beat_sheet` + `beat_sheet.schema.json` |
| 2b | Beat planner — spine | `worker/lusora_worker/agents/planner.py` | `prompts/spine/` + `welded/spine.{system,user}.txt` | shares `channel.planner.llm` → `deepseek` | 4000 tok, one shot | `{arc, sections:[{start_sentence, summary}]}` | arithmetic: first index 0, strictly increasing, in range — anything else falls back to the word-balanced split |
| 3 | Editor chat | `platform/src/lib/chatAgent.ts` | `prompts/chat/` + `welded/chat.{system,user}.txt` | `deepseek-v4-flash`, `anthropic` fallback | 12000 tok, one shot | `{explanation, beat_ops, plan_ops}` | `beatEdit`/`planEdit` + `validateBeats` in the chat route |
| 4 | Library coarse | `library/broll-lib-maker/broll/tagging.py` | `_COARSE_SYSTEM` (in code) | GLM-4.6V (z.ai or local vLLM) | 500 tok | `{score, rough_ranges}` | clamping parser |
| 5 | Library image | same file | `_IMAGE_INSTRUCTIONS` (in code) | GLM-4.6V | — | `{tags, caption, confidence}` | field-alias parser |
| 6 | Library fine | same file | `_FINE_INSTRUCTIONS` (in code) | GLM-4.6V | 12000 tok | array of `{start,end,tags,caption,confidence}` | `_parse_segments` + truncation salvage |
| 7 | AI image | `worker/lusora_worker/providers/sources.py` | `f"{query}. {style}"` (in code) | `gpt-image-1` | 1 image | image bytes | `validate` (file exists, plan-shaped) |

Agents 1–3 are the three bounded agents of **D2**, and the only ones whose
prompts are data. 2b is not a fourth agent: it is phase 1 of the beat
planner on a long script (D52), sharing the planner's provider and model,
producing nothing that reaches an artifact, and unable to change control
flow — code cuts the sections, checks the indices, and ignores the answer
entirely when it does not describe a partition. 4–6 belong to the library service (its own boundary, its
own model, its own prompts). 7 is barely a prompt — see gaps.

---

## 2. What each prompt must guarantee

These are the invariants. Rewriting a prompt is fine; dropping one of
these breaks a downstream stage.

### Script agent

- **Plain narration only** — no markdown, headings, `Narrator:` labels,
  scene directions, emoji. Load-bearing twice: TTS speaks the output
  verbatim, and the beat planner must quote it verbatim.
- The **entire** output in `cfg.language`.
- Persona comes from `style_pack.script_persona`; content rules from
  `channel.content_rules`.
- Currently also hardcodes the target length (60–120 s / 150–300 words)
  and the hook / development / resolution shape.

### Beat planner

- Top level `{version:"1.0", video_id, beats[]}`; the schema is
  `additionalProperties: false` — **any extra key fails**.
- Beat `id` matches `^b[0-9]+$`; `kind` ∈ `narration | timed`.
- `script_text` is a **verbatim contiguous span**; the beats in order
  cover the **entire** script with no gaps and no overlap.
- `visual_intent` (≥3 chars), scout-style and concrete. **It is used raw
  as the asset search query** in `resolve_assets`.
- `anchors[].type` ∈ `percentage|number|comparison|place|date|name|quote`;
  `source_words` appears verbatim in that beat's span; a `comparison`
  value is a list of `{label, value:number}`, never bare numbers.
- `overlay.component` exists in the catalog **and** in the style pack's
  the resolved `allowed_components`; `anchor_ref` indexes that beat's anchors and the
  anchor type is in the component's `anchor_types`; `props_hint` carries
  **concrete values only**, never prop schemas.
- Beat count inside the pacing range; overlay count inside the density
  cap.
- Repair loop: all violations fed back, ≤3 attempts (Principle 5).

### Editor chat agent

- Exactly the published op vocabulary — 6 beat ops, 6 plan ops. Anything
  else is rejected by the route.
- Overlays may only attach to an existing, type-matching anchor.
- Smallest set of ops that fulfils the request; one-sentence
  `explanation`.
- The model **never applies** anything (D15): propose → validate → the
  human applies.

### Library vision prompts

Two constraints tuned against GLM-4.6V, documented in the code — keep
them if the prompts are rewritten:

- With **video input the model ignores the system role**, so the fine
  instructions live in the *user* turn, after the video.
- It defaults to per-second dense captioning unless the prompt says
  "a segment = one continuous shot" **and** shows a multi-shot example.

---

## 3. Prompt text that does not live in a prompt

Four surfaces carry model-facing English outside the prompt strings.
Improving prompts means editing these too:

| Surface | Where | Effect |
|---|---|---|
| `when_to_use` / `when_not_to_use` | `contracts/catalog.json` (generated from `engine/src/catalog/registry.ts`) + `contracts/component-packs/*.json` — both **required** fields | Injected for every component into the planner prompt. **The highest-leverage prompt text in the repo**: it is what actually decides overlay selection |
| `script_persona`, `visual_language`, `pacing.*`, `overlays.density`, `allowed_packs` | `contracts/style-packs/*.json` | Persona → script system prompt; visual language → planner; pacing → target beat count; density + allowed packs (resolved to components at enqueue) → menu filter and validator |
| `content_rules`, `overrides.instructions` | channel config / per-video overrides | Appended to both creative prompts |
| Violation strings | `worker/lusora_worker/validators.py` | Fed back verbatim as the repair prompt. A vague violation is an unrepairable one — audit them as prompts |

**Known divergence:** the planner's menu (`_catalog_menu`) includes
`when_not_to_use` and prop constraints; the platform's menu
(`componentMenu()` in `platform/src/lib/catalog.ts`) includes neither.
The chat agent is flying with less information than the planner about the
same catalog. Fix when prompt packs land.

---

## 4. Plumbing limits that constrain prompt work

`worker/lusora_worker/providers/llm.py` supports exactly one system + one
user turn. There is:

- no `response_format: json_object`, no seed;
- no assistant prefill, no multi-turn, no few-shot as real turns
  (examples must be inlined as text);
- `temperature=0.7` fixed for every caller, including the strict-JSON
  ones;
- no retry/backoff on 429/5xx;
- `finish_reason == "length"` → actionable `StageError`; see
  [Tokens & Pricing](../08-tokens-and-pricing.md) for how to raise a
  budget (reasoning models spend 4–16k tokens before the JSON starts —
  measured, and unbounded by the prompt — which is why the planner
  budget is 64000).

Any prompt improvement that needs JSON mode, prefill or real few-shot
turns requires this adapter to change first.

---

## 5. Known gaps

Closed in M10: target length is style pack data (D45); `arc` is passed to
the planner; the repair loop no longer accumulates stale violations; the
chat agent gets the same menu as the planner (`when_not_to_use` and prop
constraints included); `script.model` / `planner.model` are in the channel
config schema. Still open:

- **Script:** no forbidden-phrase list in the *default* prompt (the
  shipped `doc-grave` pack has one — that is now a prompt-authoring
  choice, not a code change); **no output validation at all** — a stray
  `**bold**` reaches both the TTS and the planner's verbatim check.
- **Planner:** `kind:"timed"` never explained to the model; no worked
  example of a good beat, only a shape skeleton. (`music[]` is no longer
  listed here: D50 replaced it with `mood` per beat, which the compiler
  groups into spans — the planner is never asked to name music.)
- **`visual_intent` serves three consumers with opposite needs**:
  semantic library search, *keyword* stock search (Pexels wants 2–4
  words, not a 30-word scout sentence) and the image-gen prompt.
- **AI image:** the prompt is `f"{query}. {style}"` — no composition or
  negative guidance, no `visual_language`, and `1536x1024` (≈3:2) against
  a 16:9 output. Not a prompt pack; still code.
- **Missing stages:** no metadata (title/description/tags), no research,
  no review pass.

---

## 6. Prompt packs — BUILT (M10, D42–D45)

**Why.** Principle 4 says personalization is data, never code. Prompts
were the most personality-bearing layer in the system and the *only* one
that needed a deploy to change. They are now named data documents
referenced by name, exactly like themes and style packs (D10).

Settled 2026-07-27 (OQ-22, OQ-23), shipped in M10.

### Shape — D42

One file per prompt, typed by role, living beside the other data
documents:

```
contracts/prompts/
  roles.json                    variable contract per role (read by BOTH sides)
  welded/script.system.txt      the contract halves — not editable in the UI
  welded/planner.system.txt
  welded/planner.user.txt
  welded/chat.system.txt
  welded/chat.user.txt
  script/default.json           the editable halves
  script/doc-grave.json
  planner/default.json
  chat/default.json
```

```json
{
  "name": "doc-grave",
  "role": "script",
  "video_type": "doc",
  "description": "Grave documentary narrator, STORYFORGE ban list, 8-12 min",
  "system": "…{{persona}}… write in {{language}}…",
  "user": "Write the narration for {{title}}. Target {{target_seconds}}s…",
  "model_hint": null,
  "max_tokens": null
}
```

`video_type` is advisory and only narrows the picker, exactly as it does
for style packs.

### Editable vs welded — D43 ⚠️

Each role's prompt splits in two, and only one half is data:

- **Editable (voice/creative):** persona, tone, structure guidance,
  forbidden phrases, worked examples, visual language.
- **Welded (contract):** the JSON shape, the HARD RULES block, the
  component menu, the op vocabulary, **the closed vocabularies** (mood,
  entrance kinds). The code always appends these and the UI never shows
  them as editable text.

Without that split, a user editing a prompt can silently break
validation, and the repair loop will burn three attempts trying to
recover. This is the single most important structural rule of the
feature.

`mood` (D50) is the worked example of where the line falls. The eight
legal words are **welded** into `planner.user.txt`, because the compiler
degrades anything else to `neutral` and a prompt that quietly stopped
naming them would give every video the same bed. *How to choose* one —
"a mood belongs to a section, not a sentence; hold it and change it only
where the story turns" — is **editable** craft in
`prompts/planner/default.json`, because that is taste and a
punchier channel may want it applied differently.

### Resolution order — D44

First hit wins, most specific first:

1. **per-video override** — `overrides.script.prompt`, deep-merged at
   enqueue;
2. **channel config** — `channel.script.prompt` / `channel.planner.prompt`
   / `channel.chat.prompt`;
3. **style pack** — `style_pack.script.prompt` (script only: a pack has a
   voice, not a planning strategy);
4. **built-in default** — `contracts/prompts/<role>/default.json`.

The resolved **text** (not the name) is snapshotted into `cfg.prompts`
at enqueue (Principle 7): editing a prompt never retroactively changes an
in-flight video, and a re-run reproduces the old words. A named prompt
that does not exist is a hard enqueue error, never a silent fallback to
another voice.

**The welded half is deliberately not snapshotted.** It encodes what
`validate_beat_sheet` and the op appliers are about to enforce, so it is
composed from the *current* contracts at call time — a snapshot would let
a tightened rule and an old prompt disagree, and the repair loop would
fight itself.

### Variables

Declared in `contracts/prompts/roles.json`, read by both the worker and
the platform, so there is no mirrored list to drift. Templates are
mustache-lite: `{{var}}` substitutes, `{{#var}}…{{/var}}` keeps its body
only when `var` is non-empty (so an optional section takes its own label
with it). Nothing else — a prompt is data, not a program.

| Role | Variables (★ = required) |
|---|---|
| script | `persona`, ★`language`, ★`title`, `target_seconds`, `target_words`, `content_rules`, `instructions` |
| planner | ★`script`, ★`audio_duration_s`, `target_beats`, `avg_hold`, `min_hold`, `max_hold`, `arc`, `density`, `visual_language`, `content_rules`, `instructions`, ★`component_menu`, ★`video_id` |
| chat | ★`component_menu`, ★`beats`, ★`plan_tracks`, ★`message` |

Unknown variables and dropped required ones are refused on save **and**
in CI (`scripts/validate-schemas.mjs`), which also checks that every role
has a `default.json` and that each file's `role` and `name` match its
path. A required variable counts as present if it survives in either
half, so `{{language}}` may live only in the welded block.

### The Prompts screen

`/prompts`, file-backed like Style Packs (git is the version history, CI
is the gate):

- list per role, with who references each prompt and which is the default;
- editor with a variable palette that inserts at the cursor and marks
  required names;
- **composed preview** — the editable text plus the welded block, rendered
  server-side through the same renderer the agents use (a second
  implementation in the browser would drift and lie), against a real
  video's data via `?video=<id>` or a built-in sample;
- **test run** — calls the provider with the composed prompt and records a
  cost event (manager-only, price from `contracts/prices.json`, unknown
  provider+operation is a hard error per D13);
- prompt pickers on the Channels screen; per-video selection rides on the
  same `script.prompt` field through `overrides`.

### What it touched

`contracts/schemas/prompt.schema.json` · `contracts/prompts/**` ·
`lusora_contracts.prompts` + `platform/src/lib/prompts.ts` (mirrored
renderers, mirrored test cases) · `style_pack.schema.json` (`script`
block, D45) · `channel_config.schema.json` (`prompt`/`model`/
`target_seconds`, plus the `prompts` snapshot and its `resolvedPrompt`
def) · `videos.ts` enqueue · both worker agents · `chatAgent.ts` ·
`catalog.ts` (`componentMenu` now matches the planner's menu) ·
`config-options` · the Channels form · `/prompts` screen + routes.

### Script target length — D45

The 60–120 s currently hardcoded in the script prompt moves into the
style pack, next to the pacing numbers it interacts with, and is
overridable per video exactly like `overlays.density`:

```json
"script": { "target_seconds": 90, "tolerance": 0.25 }
```

The prompt then receives `{{target_seconds}}` / `{{target_words}}`
instead of a fixed sentence, and long-form channels become a pack, not a
code change. `style_pack.schema.json` and
[Theme & Style Packs](../03-contracts/theme-and-style.md) both land in
M10.

---

## 7. Beyond prompts — more stages, not more autonomy

Each of these is a new stage in the existing registry behind the existing
budget gate. None of them changes the architecture or weakens D2.

- **Research stage** — a brief (facts, dates, figures, sources) before
  the script, so anchors come from something real.
- **Review pass** — a reviewer prompt scores the beat sheet against the
  style pack and feeds the *existing* repair loop. OpenMontage's
  per-stage `review_focus` / `success_criteria` lists are the model.
- **Metadata stage** — title / description / tags. A working prompt with
  a strict reply format exists in the predecessor repo
  (`~/youtube_automation/yt-video-automation/pipeline/stages/generate_metadata.py`).
- **Richer beat fields** — `queries[]` **shipped** in beat sheet v1.1
  (D53): 2–3 short keyword queries per beat, which is what fixed the
  `visual_intent`-as-search-query problem. Still open from the same
  OpenMontage `scene_plan` borrowing: `preferred_sources[]`, and a `hero`
  flag marking the 2–3 beats that deserve the best asset.
- ~~Ask for `music[]`~~ — done differently in M12: D50 makes `mood` per
  beat the model's whole contribution to sound, and the compiler derives
  the spans. Asking an LLM to name a track was the wrong shape — sound
  selection is consistent taste, which D8 already removed from its job.

---

## 8. Agentic authoring, deterministic execution

D2 stands: the orchestrator stays code, and control flow stays $0/video.
But an agent-authored beat sheet is *already* a supported input, because
the contract is the boundary — the validator does not care who wrote the
JSON.

So a future "director mode" is a **planner strategy**, not a new
architecture: `planner.llm = deepseek | mock | agent`. A Claude Code
session or a multi-call director writes `beats.json` into the video
folder; `validate_beat_sheet` judges it identically; compile, resolve,
render and deliver are untouched. Premium channels can afford an attended
director; cheap channels stay on the deterministic path; both produce the
same artifact.

The rule for any such mode: **it produces contract artifacts, it does not
drive the pipeline.**

---

## 9. Source material worth mining

Prompt content to adapt — not to copy wholesale. OpenMontage's skills are
written for an agent with a huge context window; our planner gets one
system prompt.

| Source | What to take |
|---|---|
| `github.com/calesthio/OpenMontage` → `skills/pipelines/documentary-montage/` | `scene-director.md` is the closest analogue of our beat planner: tone → avg-hold → slots-per-60s table, arc templates, scout-vs-librarian framing |
| same → `skills/pipelines/explainer/` | research-director, script-director, proposal-director — the stages we lack |
| same → `skills/creative/broll-planning.md` | stock-vs-generated matrix and **query construction rules** (2–4 keywords, lead with the subject) |
| same → `skills/creative/prompting/` (veo, sora, seedance, ltx, hunyuan, grok) | material for a real image/video generation prompt |
| same → `skills/meta/reviewer.md`, `taste-direction.md` | the review pass |
| same → `schemas/artifacts/`, `styles/*.yaml` | contract and playbook comparisons |
| `~/youtube/STORYFORGE.md`, `one-shot-storyforge.txt` | Style DNA (6 dimensions) + the forbidden-phrase ban list; the one-shot file is already shaped as a SYSTEM prompt with channel placeholders — the natural first `script/` prompt pack |
| `~/youtube/scripts_samples/` | reference scripts to extract a channel's Style DNA from |
| `~/youtube_automation/yt-video-automation/pipeline/script_generators/` | `scriptforge.py`'s outline → per-section calls with a continuity tail (the long-form structure we lack); its prompts are `TODO(port)` placeholders — STORYFORGE above is the missing content |
| `~/broll-engine/`, `~/youtube_automation/broll-lib-maker/` | older copies of the GLM tagging prompts — diff to see what tuning was lost |
