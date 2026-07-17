# Core Principles

Seven rules. Every design question in this project should be answerable by
one of them.

## 1. DB is the control plane, files are the data plane

Postgres holds what must be queried and shared: queue, statuses, users,
roles, costs, events, asset usage. The video's working folder holds what
must be produced: script, audio, beats, plan, clips, final video, logs.
The worker decides "is this stage done?" by **looking at files**, and
*reports* progress to the DB as events. The DB never claims an artifact
exists; the folder never holds a user or a permission.

## 2. Contracts before code

Every data shape shared between two parts is a schema in the `contracts`
package: beat sheet, edit plan, theme, style pack, channel config, catalog
entry, renderer interface, DB migrations, API types. Both TS and Python
import from this one package. A contract change and its consumers land in
the same commit — drift is structurally impossible in a monorepo.

## 3. AI does judgment, code does arithmetic

LLMs produce: scripts, beat sheets (visual intentions, overlay
suggestions), chat-agent edit operations. Code produces: timings (SRT
alignment), geocoding, schema compliance, routing, budgets, ordering.
Never ask a model for a number code can compute; never ask code for taste.

## 4. Personalization is data, never code

Four layers, all editable without deploys: channel preset (DB) → source
policy (data) → theme + style pack (data) → component packs (the ONLY code
layer, versioned in the engine, selected by name). The same pipeline code
produces visually and tonally different channels purely from data.

## 5. Constrain, validate, repair

Every AI output is constrained by a menu (catalog, schemas, anchors),
validated by code (collect ALL violations), and repaired in a bounded loop
(max 2–3 attempts) before a human ever sees an error. Nothing unvalidated
reaches a renderer or a screen.

## 6. Cheap by default, premium by exception

ffmpeg renders unless the plan requires Remotion. Library assets before
stock before generation. Local Whisper for SRT. Cheap LLMs unless quality
is visible in the output. Every paid operation passes the budget gate
(estimate → reserve → actual) BEFORE spending.

## 7. Snapshot at enqueue

Channel config + per-video overrides merge ONCE into the video's
`cfg.json` when it enters production. Later channel edits never
retroactively change a video. Re-runs use the snapshot.
