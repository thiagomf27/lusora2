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
- **Overlays** — the component catalog, browsable: every pack, each entry's
  selection rules (`when_to_use` / `when_not_to_use`), anchors, props table
  (nested specs flattened, with `from_anchor` / `computed` / word caps) and
  duration hints, plus a **live Remotion preview** of the selected component
  (the engine's OverlaySolo composition in `@remotion/player`, seeded at a
  settled frame, with an editable props JSON and a theme picker). Entries in
  data packs (`contracts/component-packs/`) can be created, edited and
  deleted here; `core` is read-only because it is generated from the engine
  registry. Style-pack allowances (`overlays.allowed_components`) are
  toggled from the same page. An entry can be pointed at an engine
  **template** (card / lower third / big number / bullet list / statement),
  which fills its props block and makes it renderable with no code —
  entries with neither a template nor a component are flagged *no renderer*
  with both routes spelled out. Whole packs can be imported (paste or
  upload the pack file), exported and deleted, so a pack moves between
  installs in one action.
- **Editor** — two levels over the same video: beat panel (Kinema-style:
  subject, on-screen text, re-roll asset, split/merge) and timeline
  (precise trims, transforms, overlay moves) rendered with the engine's
  Remotion Player for preview parity; chat agent that emits beat
  operations and plan patches (see [Edit Plan](../03-contracts/edit-plan.md)
  for the lock/provenance rule).
- **Library** — grid + filters over the broll library API; ingest form;
  ingest job progress. (Reuses the library's existing API 1:1.)
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
