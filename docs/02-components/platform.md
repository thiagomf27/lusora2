# Platform (web UI + API)

TypeScript. Serves the UI, the HTTP API, auth/roles, and the DB-backed
queue. Never touches video files except through well-defined API routes
that read/write specific artifacts (beat sheet, plan, thumbnails, final
video streaming).

## Roles

| Role | Scope | Can |
|---|---|---|
| Admin | everything | manage users, credentials health, all channels, all screens |
| Manager | granted channels | create/edit queue, edit channel config, view costs |
| Editor | granted channels | view videos, open editor, approve / send back, add notes |

Implementation: 3 hardcoded roles + `user_channel_grants` table. Checks
at API route level. No permission builder UI. (Auth mechanism: OQ-5.)

## Screens (v1 scope)

- **Panel** — counts by status, cost this month, failures needing action.
- **Queue** — create videos (uploads: script / audio / avatar video),
  channel picker, per-video overrides (source policy, captions, overlay
  density, max price), per-row pre-flight validation, batch send.
- **Pipeline** — live production view fed by `video_events`; per-video
  event stream; retry action (re-queue).
- **Videos** — grid (thumb, title, channel, status, price, size, date);
  video page: info, player (local file stream; YouTube embed once posted),
  review buttons (approve / send back / posted) honoring roles, notes,
  events, assets used (from plan provenance), "Open in editor".
- **Channels** — table + create/edit: identity, language, voice, video
  type, theme, style pack, source policy, component pack (by name),
  budget cap; team tab (grants); channel cost + video list.
- **Themes** — the theme documents in `contracts/themes/` (the files the
  engine resolves, snapshotted at enqueue): list, a rendered preview of
  the selected one (mock 16:9 frame, colour tokens, type specimens,
  motion feel, grain) built from the engine's theme runtime so the page
  can't drift from a render, schema violations surfaced per theme, which
  channels reference it. Create and edit in place — the preview doubles
  as the live preview of the draft; the name is fixed after creation
  (it is the filename that channels reference).
- **Style Packs** — the style pack documents in `contracts/style-packs/`
  (the behavior half of personalization, snapshotted at enqueue): list,
  create, edit in place, delete while unreferenced. Fields are pacing
  (min/avg/max hold, arc), overlay density, `allowed_packs`,
  transitions, `script_persona` and `visual_language`, plus the
  `video_type` the pack implements. The preview is not a render — a pack
  is behavior — but the numbers made concrete: a one-minute rhythm strip,
  shots and overlays per minute, and the overlay budget and beat-count
  range the worker's validator will enforce on a 10-minute video, using
  its formulas. New packs start from an existing one, which is how a
  video type is added. The name is fixed after creation (it is the
  filename channels reference).
- **Prompts** — the editable half of each agent prompt
  (`contracts/prompts/<role>/`, D42–D44): list per role (script, planner,
  chat) with who references each, create, edit, delete while unreferenced.
  The centre of the screen is the **composed preview**: the editable text
  plus the welded contract block, rendered with a real video's data (or a
  sample) through the same renderer the agents use, so what you read is
  what the model reads. The welded half is shown but never editable — it
  encodes what the validator is about to enforce. A variable palette
  inserts only the names the role declares; unknown or dropped-required
  variables are refused on save and in CI. **Test run** calls the provider
  with the composed prompt and records a cost event, so an experiment is
  costed like production. Prompts are chosen per channel (Channels
  screen), per style pack, or per video at enqueue; the resolved text is
  snapshotted, so editing here never changes a video already in
  production.
- **Overlays** — the component catalog, browsable: every pack, each entry's
  selection rules (`when_to_use` / `when_not_to_use`), anchors, props table
  (nested specs flattened, with `from_anchor` / `computed` / word caps) and
  duration hints, plus a **live Remotion preview** of the selected component
  (the engine's OverlaySolo composition in `@remotion/player`, seeded at a
  settled frame, with an editable props JSON and a theme picker). Entries in
  data packs (`contracts/component-packs/`) can be created, edited and
  deleted here; `core` is read-only because it is generated from the engine
  registry. Style-pack allowances (`overlays.allowed_packs`) are
  toggled from the same page. An entry can be pointed at an engine
  **template** (card / lower third / big number / bullet list / statement),
  which fills its props block and makes it renderable with no code —
  entries with neither a template nor a component are flagged *no renderer*
  with both routes spelled out. Whole packs can be imported (paste or
  upload the pack file), exported and deleted, so a pack moves between
  installs in one action.
- **Sounds** — the sound-pack sibling of Overlays (D48): every cue and bed
  in every pack, **playable in the browser** through
  `GET /api/sounds/{pack}/audio/{...}` (range support), with a gain slider
  set to the level a theme will actually apply — a cue judged at 100% is a
  cue judged wrong. The editable half is what the compiler reads:
  `kind`/`lead_s`/`priority`/`gain`/`fade_out_s` for a cue,
  `mood`/`loopable`/`gain` for a bed. Sounds are uploaded here, packs
  created and deleted. Three rules are enforced server-side because a form
  is the easiest place to break them: `duration_s` is always PROBED with
  ffprobe and a client-supplied value is discarded on save (the compiler
  sizes one-shot cues from it); uploads are normalized by kind (cues to
  -6 dBFS peak, beds to -24 LUFS, opt-out per upload); and deleting
  anything a theme names is refused with a 409 that lists the themes,
  because a theme pointing at a missing cue fails the next video at
  compile. Each sound shows which themes name it, and a manifest entry
  whose file is missing on disk is flagged — the same check CI runs.
- **Editor** — two levels over the same video: beat panel (Kinema-style:
  subject, on-screen text, re-roll asset, split/merge) and timeline
  (precise trims, transforms, overlay moves) rendered with the engine's
  Remotion Player for preview parity; chat agent that emits beat
  operations and plan patches (see [Edit Plan](../03-contracts/edit-plan.md)
  for the lock/provenance rule).
- **Library** — four routes over the broll library API, which the platform
  reaches only through `/api/library/[...path]` (D11): `/library` (browse +
  search, with the filter rail, sort and selection), `/library/review` (the
  approval gate and the trim workbench), `/library/ingest` (link / video file
  / image batch, plus the live serial queue) and `/library/overview` (totals,
  distributions, purge). Match strength shown to an operator is `sim`, never
  `score` (D74). Nav placement and the pending badge: D77.
- **Monitoring** — worker heartbeat, provider health (last success/error
  per provider from events), storage usage, cost/usage charts.
- **Admin** — users + grants; provider credential HEALTH (configured?
  last error?) — never the secret values (secrets live in env, OQ-6).
- **Account** — profile, password.

Deferred (decided): Tools screen (script/TTS playground) — later as a
route group calling one-off provider endpoints; not a separate repo.

## Queue mechanics

`videos` table is the queue. Status flow:
`DRAFT → QUEUED → PRODUCING → RENDERED → IN_REVIEW → APPROVED → POSTED`
plus `ERROR` (from any producing stage) and `SENT_BACK` (from review,
returns to QUEUED after edits). Worker claims rows atomically; the row is
the lock. Editor-role transitions are restricted to
RENDERED/IN_REVIEW/APPROVED/SENT_BACK/POSTED.
