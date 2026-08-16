# Pipeline Manifest — the stage list as data

**Status: Decided (D60).** Schema:
`contracts/schemas/pipeline_manifest.schema.json`. Files:
`contracts/pipelines/<name>.yaml`. Shipped: `faceless.yaml`.

A manifest is the ordered list of stages a video goes through. It replaced
the `STAGES` constant that lived in the worker, so adding a pipeline is a
file, not a deploy — the same move prompts (D42), themes and component
packs already made.

## Policy vs. mechanism — the one rule to keep

| The manifest declares | The worker owns |
|---|---|
| which stages run, in what order | what the stage NAME does (`STEP_REGISTRY`) |
| what each stage `produces` | how a stage decides it is already done |
| where a guided run would gate | the loop, the events, the error handling |

"Done" is **mechanism**, and it is not uniform: `script` is done when
`script.txt` exists, but `compile_plan` is done only when `edit_plan.json`
is *newer than* `beats.json`, and `render` when `final.mp4` is newer than
the plan. A manifest that tried to say that would be encoding code in
YAML. A stage name with no registry entry is a **load-time error** —
raised before the first stage runs, when the reason is still "the manifest
and this worker disagree" rather than a failure nine stages in.

The reverse leak is just as deliberate: the registry never encodes an
order. It is a dictionary, not a list.

## The file

```yaml
name: faceless          # == the filename; cfg.pipeline references it
version: "1.0"          # bump on any stage-list change; snapshotted at enqueue
category: faceless      # coarse family, used by selection, never by execution
stability: production   # 'test' pipelines are excluded from bulk production
default_checkpoint_policy: auto
bulk_production_accepted: true

stages:
  - name: script
    produces: [script.txt]
    human_approval_on_review_mode: true
  - name: narration
    requires: [script.txt]
    produces: [audio.mp3]
  ...
  - name: validate        # no `produces` — judges rather than emits, so always runs
    requires: [edit_plan.json]
```

- **`produces`** is what the orchestrator asserts after the stage body
  returns, and (with the registry's done-check) what makes resume work:
  skip what exists. A stage with **no** `produces` — `validate`, `qa` —
  judges rather than emits and therefore always runs. That is exactly what
  makes `qa` a gate rather than a report (D57).
- **`requires`** is **advisory at run time** in v1: the orchestrator runs
  stages in manifest order and each stage reads what it needs. It is
  validated at load — every required artifact must be produced by an
  earlier stage or provided at bootstrap (`cfg.json` and the manual-first
  uploads) — so a manifest whose DAG does not close is rejected before a
  video, not during one.
- **Bootstrap is not a stage.** Claiming the video and materializing
  `cfg.json` is the precondition for the loop, not a step it can skip, so
  no manifest lists it.

## Selection and the snapshot

Selection happens **once, at enqueue, in one function**
(`platform/src/lib/pipelines.ts: selectPipeline`). Everything that could
ever pick a pipeline — the video's format, the model behind it, review
mode, what the human uploaded — belongs there rather than spread across
routes. Today one rule fires, because one pipeline exists: a config that
names `pipeline` gets it, anything else gets `faceless`.

The chosen manifest is embedded in the cfg snapshot as `pipeline_doc`,
the same rule the theme, the style pack and the sound pack follow
(Principle 7): editing `faceless.yaml` never changes an in-flight video,
and a re-run walks the stage list it was built with. The worker prefers
the snapshot, falls back to the named manifest on disk, then to
`faceless` — which is what keeps a hand-written `cfg.json` runnable
(manual-first).

A batch enqueue additionally refuses any manifest with
`stability: test` or `bulk_production_accepted: false`.

## Checkpoints (declared, not yet executed)

`default_checkpoint_policy: guided` and the per-stage
`human_approval_on_review_mode` flags describe a review mode that pauses
after the script and after the beat sheet. **Nothing executes them yet** —
today every pipeline runs under `auto`, which is what every video has
always done. They are in the schema because review mode is a *policy on a
pipeline*, not a separate pipeline, and knowing that shape now is what
stops someone forking `faceless-review.yaml` later. See OQ-28.

## Deferred on purpose

- **`success_criteria` per stage** — add when a validator exists to read
  it; a criterion nothing checks is prose in a schema.
- **`substages`** — the slot is in the schema, and the beats process
  (spine → chunk → beat writing) is the obvious first user. Faceless
  declares none: model the flat reality until the beats restructure lands
  (slice 5 of the destination map).

## Where the checks live

| Check | Where |
|---|---|
| schema, name matches filename, no duplicate stage, `requires` DAG closes | `scripts/validate-schemas.mjs` (CI) and `lusora_contracts.pipelines` (load time) |
| every stage name has a worker step | `worker/tests/test_pipelines.py` — the registry is in Python |
| faceless still equals the pre-refactor list | `worker/tests/test_pipelines.py` |
