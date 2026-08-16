# Pipeline Manifest — the stage list as data

**Status: Decided (D60–D62, D64).** Schema:
`contracts/schemas/pipeline_manifest.schema.json`. Files:
`contracts/pipelines/<name>.yaml`. Shipped: `faceless.yaml` (production), `faceless_v2.yaml` (test — adds a research stage).

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
category: faceless      # the family a channel's production_style matches (D61);
                        # used by selection, never by execution
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
routes. The ladder, most specific first:

| # | Field | Wins when | Reason recorded |
|---|---|---|---|
| 1 | `pipeline` | the config pins a manifest by name | `named in the config` |
| 2 | `production_style` (D61) | a style is set and a manifest matches | `production style '<x>'` |
| 3 | — | neither is set | `default` |

Rule 2 is a **match on `category`**, not a mapping table: the channel's
`production_style` and the manifest's `category` hold the same enum, so
the resolver looks for the `stability: production` manifest carrying that
category. That is what makes adding talking-head production one `.yaml`
with `category: talking_head` and no code change here. Rule 1 stays above
it as the escape hatch — pinning is how a `stability: test` variant of a
style is run without changing what the style means.

A style with **no matching manifest is refused**, and the message lists
the categories that do exist. Falling back to `faceless` would deliver a
wrong video that looks successful, which is the failure mode this whole
split exists to prevent. `custom` is the explicit "I name the file
myself" answer, so reaching rule 2 with `custom` and no pin is refused
too. `selectPipeline` therefore returns
`{ ok: true, name, reason } | { ok: false, problem }` — the enqueue
reports the problem the way it reports a bad style pack.

The chosen manifest is embedded in the cfg snapshot as `pipeline_doc`,
the same rule the theme, the style pack and the sound pack follow
(Principle 7): editing `faceless.yaml` never changes an in-flight video,
and a re-run walks the stage list it was built with. The worker prefers
the snapshot, falls back to the named manifest on disk, then to
`faceless` — which is what keeps a hand-written `cfg.json` runnable
(manual-first).

A batch enqueue additionally refuses any manifest with
`stability: test` or `bulk_production_accepted: false`.

## Review mode (D62 — executed)

`default_checkpoint_policy` and the per-stage
`human_approval_on_review_mode` flags describe where a run waits. A video
carries its own `checkpoint_policy`, which **overrides** the manifest's:
that is what makes review mode a *policy on a pipeline* rather than a
separate pipeline, so one `faceless.yaml` runs both ways and nobody has to
fork `faceless-review.yaml`. Unreadable or absent, the policy is `auto` —
what every video did before this existed.

Under `guided` the orchestrator stops after each gated stage, sets the
video to **`awaiting_approval`** and returns. Both shipped manifests gate
in the same two places, which is where the money and the mistakes are:

| Gate | What it protects |
|---|---|
| after `script` | nothing is narrated before the words are approved |
| after `plan_beats` | nothing is **rendered** before the beat sheet is |

**An approval is a file:** `approvals/<stage>.json` in the video folder.
The folder is the data plane of record and resume is "skip what exists",
so a gate needs no new bookkeeping — on the re-claim the stage's artifact
is present (the body skips) and its approval is present (the gate passes),
and the loop carries on with no memory of having stopped. That is also why
the gate is checked **whether the stage ran or was skipped**: on the
re-claim, only the approval file can say "continue". The pending gate is
therefore *derived* — the first declared gate with no file — so no column
can drift from the truth, and a hand-run video clears a gate with `touch`.

`awaiting_approval` is its own status because the orphan sweep re-queues
anything stuck in `producing`, and a video parked on a human is not stuck.
Approving (`POST /api/videos/[id]/approve`) writes the file and returns
the video to `queued`; editors may approve, since reviewing the script and
the beat sheet is the editing job.

## Uploads (D62)

`receivable_on_upload` declares which stages a human may hand the artifact
to instead of having it produced — the manual-first rule, written down.
Faceless marks its first five stages receivable, which is what has always
been true; `resolve_assets` onward are machine products and are not.

## Deferred on purpose

- **`success_criteria` per stage** — add when a validator exists to read
  it; a criterion nothing checks is prose in a schema.
- **Substages are declarative only.** `faceless_v2` declares the six
  phases of `plan_beats` (D65) and the loader checks each against the
  worker's `SUBSTAGE_REGISTRY`, so a phase this build cannot run fails at
  load. The orchestrator does **not** walk them: they share one in-memory
  pass and emit no artifact between them, so none is resumable on its own.
  They buy a readable process and the load-time check — not execution.
- **The visual half of the beats process** — what a beat SHOWS. Waits on
  the catalog's `type_name` vocabulary (slice 2) and the style pack's
  overlay priority/density numbers (slice 4); building it against
  unsettled shapes would mean building it twice.
- **A schema for the visual ledger** — the destination map asks for one,
  but the ledger is a formatted prompt FRAGMENT, not a structure crossing
  two parts. It becomes a schema the day it is persisted or exchanged;
  until then a JSON Schema for a string is ceremony.

## Where the checks live

| Check | Where |
|---|---|
| schema, name matches filename, no duplicate stage, `requires` DAG closes | `scripts/validate-schemas.mjs` (CI) and `lusora_contracts.pipelines` (load time) |
| every stage name has a worker step | `worker/tests/test_pipelines.py` — the registry is in Python |
| faceless still equals the pre-refactor list | `worker/tests/test_pipelines.py` |
| every manifest declares a `category`, so a production style can find it | `platform/test/pipelines.test.ts` |
| the selection ladder, including the refusals | `platform/test/pipelines.test.ts` |
