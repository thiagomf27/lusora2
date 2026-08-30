# Implementation Status — handoff notes

> Written 2026-07-19, after the full build. Read this FIRST when picking
> the project up in a new session/tool. The design docs (01–05) describe
> the intent; this file describes what actually exists and how to run it.

## What is built

**All milestones M0–M12 are implemented and verified** (one commit each,
see `git log`). The system produces finished MP4s end to end with real
providers. Sample runs that exist in `data/videos/`:

- ffmpeg path: flite ($0) narration → mock images → captions → final.mp4
- Remotion path: DeepSeek script + planner (repair loop observed fixing
  real violations) → ai33 narration → library photos + Pexels stock +
  mock fallthrough → themed overlays (KineticTitle, AnimatedCounter) →
  final.mp4 at ~$0.01–0.02/video

All open questions are DECIDED except OQ-21 (VPS sizing — a measurement,
not a decision). See D21–D40 in [the Decision Log](04-decisions/decided.md).

## Platform UI — the VidRush skin (2026-08-16)

The web UI was re-skinned from the Claude Design project *Video Generation App
Template* (`VidRush.dc.html`). Eight screens, ported against real endpoints —
cells the design draws but nothing backs are dropped, not faked.

| Design screen  | Route                  | Notes |
|----------------|------------------------|-------|
| Home           | `/`                    | Composer; creates nothing, carries channel/pipeline/title to the quote |
| Quote          | `/quote`               | 4 tabs over a working copy of the channel config; approving POSTs the draft + enqueues, and reports pre-flight problems inline |
| Channels       | `/channels`            | Profile / Visual / Sourcing over one channel. **Absorbed the Brands screen** — a brand profile is the channel's config document, there is no brands table, so `/brands` is now a redirect here |
| Videos         | `/videos`              | Card grid, real frame thumbnails |
| Video detail   | `/videos/[id]`         | Player, production config, real event log, asset provenance, file exports, status transitions, notes |
| Beat review    | `/videos/[id]/review`  | Real stages from `video_events`; progress counts beats with a resolved asset (a beat sheet has no approval field); per-beat re-roll and edit |
| Settings       | `/settings`            | Account, Defaults, Members, Costs, Monitor |

Design tokens live in `platform/src/app/globals.css`: the design-system names
(`--surface-*`, `--text-*`, `--accent-*`…) are the source of truth, and the older
short names (`--bg`, `--panel`, `--accent`…) are aliases onto them so the screens
that predate the skin inherit it untouched. Shared primitives are in
`platform/src/components/ds/`.

### `look` — the subtractive half of the look

The Look tab (quote statement) and the Visual tab (Channels) share one editor —
`components/LookEditor.tsx`, whose `sections` prop is what lets one component
serve both without the cards being written twice — over a `look` block on the
channel config:

- `look.background.image` — the plate drawn behind an overlay that does not
  fill the frame, the D55 fallback card above all. Images live in a per-channel
  library on disk (`data/brand-backgrounds/<channel_id>/`, `BRAND_ASSETS_ROOT`),
  and the chosen one is **copied into the video folder at enqueue**, so the
  render resolves it like any other asset and re-uploading never alters a video
  that already shipped. `to_title_card` in the worker emits an `image` item
  pointing at it instead of a `color` fill; both renderers then need no change.
- `look.exclude.{components,transitions,sfx_cues,moods}` — the theme and style
  pack say what is AVAILABLE; this says what a channel (or one video) leaves out.
  Applied to the embedded `style_pack_doc` / `theme_doc` in `lib/look.ts` at
  enqueue, so the planner, compiler, validator and both renderers all read an
  already-narrowed pack and none of them knows the block exists.

The editor draws THREE states, not two, because "not on the list" has two very
different causes. *In use* and *excluded* are this channel's own call and are a
click; *blocked* is the style pack's or the theme's, is read-only here, and
names the document responsible. `look-options` therefore returns the whole
universe with a `blockedBy` per entry — the universes themselves read out of
`channel_config.schema.json`, so a new transition kind or mood cannot land in
the contract and stay invisible on the screen. The sound master switches lock
the same way: `sound_enabled` in the compiler ANDs the channel's switch with the
pack's, so a pack that ships silent (doc-slow) makes the channel's SFX toggle
inert, and the screen now says so instead of showing it live.

The four groups — overlays, transitions, SFX cues, music beds — are one menu
showing one group at a time. Stacked, the three short lists sat below a
scrolling grid of forty-three stills and were never on screen with the thing
they belong to. Each carries its own example: a transition animates the join it
draws (mirroring `renderers/remotion/transitions.tsx`, which is also where you
can read that `crossfade` and `fade` are the SAME dissolve today), and an SFX
cue or music bed plays the actual file from the channel's resolved sound pack.

**Overlay allowance is by PACK.** A style pack declares
`overlays.allowed_packs` (`["archive", "core"]`) instead of enumerating
component names. "This style suits the archive pack" is a statement about a body
of work that does not go stale when a component is added to that pack — the
enumerated list did, silently, every time. The six shipped packs were converted
to the packs their components already came from.

The concrete menu is RESOLVED at enqueue: `applyComponentPack` crosses
`allowed_packs` with `core` plus the channel's `component_pack` and writes the resulting
`allowed_components` array into the embedded `style_pack_doc`. So the planner,
compiler, validator and both renderers are UNCHANGED — they go on reading the
same field they always read, and a video snapshotted before this carries an
authored `allowed_components` with no `allowed_packs`, which the resolver
replays verbatim (Principle 7). Per-component taste did not disappear; it moved
to `look.exclude.components`, where the channel or a single video expresses it.

The Overlays screen's "offered in style packs" toggles now move a component's
whole pack, and say so. `setComponentAllowance` became `setPackAllowance`, and
deleting a component no longer touches any style pack — only deleting the pack
does, via `removePackEverywhere`, which refuses to empty a style pack's list
(that would silence it entirely) and reports the orphans instead.

**`component_pack` now does something.** It has been in the channel config and
typed in `contracts/src/types.ts` since the beginning with no consumer at all:
the merged catalog handed every pack to every channel, so a channel set to
"core only" could still be planned an `Archive*` overlay. `applyComponentPack`
in `lib/look.ts` resolves the menu at enqueue — the same mechanism
and the same moment as `look.exclude`, so no agent, compiler or renderer learns
a new field. It is a dropdown on the Overlays group. A card blocked in that grid
is one the style pack declines, which is worth seeing; the API keeps reporting
both reasons, and the component-pack one comes first because a style pack
declining a component is an editorial choice while the component not being
installed is a fact.

**Packs resolve ADDITIVELY over core.** A channel draws from `core` **plus** at
most one installed pack: `["core", ...(component_pack ? [component_pack] : [])]`,
deduplicated. This replaced a one-pack-only resolution that filtered
`entry.pack === pack` and so dropped core entirely the moment a channel
installed anything — a pack is a menu EXTENSION of three to six entries, so
choosing one was never meant to mean choosing it *instead of* the base menu.
The old behaviour was survivable while `archive` had nine entries and merely
bad; after the D66 merge left it with two, `AtlasDaGuerra` resolved to a menu
of `ArchiveCaption` and `ArchiveFrames` and no counter, chart, title or lower
third at all. `core` is unconditional and is not something a style pack opts
into: `allowed_packs` names the EXTRA packs a style suits, listing `core` is
redundant, and omitting it does not take the base menu away. The tool for "not
this core component" is `look.exclude.components`, which runs next.

**Excluding the style pack's default transition is allowed.** It used to be
refused at enqueue; "this channel never hard-cuts" is a look, not a mistake. The
default moves to a surviving allowed kind instead, because the compiler reads
`transitions.default` for everything the planner leaves unspecified and leaving
it pointing at an excluded kind would put back exactly what was excluded.

Overlays are drawn as cards carrying a real rendered still — `@remotion/player`'s
`Thumbnail` over the same `OverlaySolo` composition the Overlays screen
animates, themed by the channel's own theme. A still rather than a `<Player>`
per card: forty-three players on one screen is forty-three rAF loops.

### What the Channel screen leaves to the advanced form

`/channels` lands on a TABLE of channels; a row opens that channel's Profile /
Visual / Sourcing tabs, and "← All channels" goes back. `?channel=<id>` opens
straight into one, which is what the links from Home and Settings use.

It carries the decisions a human makes about a channel — name, language, voice,
production style, video type, and the whole Visual and Sourcing tabs.
`/channels/[id]` keeps everything else: packs, gains, budgets, prompts,
retention, QA, content rules. That page now reads `?tab=`, because "Advanced
config" used to land on its Videos tab — empty for most channels, which read as
a dead button — and now lands on `?tab=settings`.

The style pack is the one field that moved rather than split. It FOLLOWS the
video type on the simplified screen, and which pack a type means is a real
decision the contract now records: **`contracts/video-type-defaults.json`**, one
entry per type, edited on the Style packs screen (`PUT /api/style-packs/defaults`).

It could not live on the packs. A pack's `video_type` is advisory and several
packs may declare the same one — two `doc` packs and two `breakdown` packs ship
today — so "which doc pack" is a question about the SET, not about any member;
a flag on the packs lets two of them claim it, an entry here cannot. Writes are
checked the way CI checks the file: the pack must exist and must implement the
type it is being made the default for, because a default pointing at a
`listicle` pack is not a preference, it is a channel that changes shape the next
time someone touches its video type.

`lib/videoType.ts` holds the resolution order for both the Channel screen and
the quote statement: the configured default, else a pack that already implements
the type (never move a channel off a deliberate choice), else the first match in
name order, else leave it alone. The screen names the pack it landed on and
links to both places it can be changed.


Emptying a list the pipeline needs — every transition, every component, or the
style pack's own default transition — is refused at enqueue with an actionable
message rather than silently repaired. `GET /api/channels/[id]/look-options`
resolves what the current pack and theme offer, so the screen never shows a
hardcoded menu.

API additions this needed: `PATCH /api/videos/[id]` (rename),
`GET|POST|DELETE /api/channels/[id]/backgrounds` (+ `/[name]` to serve one),
`GET /api/channels/[id]/look-options`, and `pipelines` + `soundPacks` in
`GET /api/config-options` (`pipelines` returns manifest SUMMARIES — name,
category, stability, stage count — not bare names, so a picker can show what
a production style resolves to). `ChannelConfig` and `StylePack` in
`contracts/src/types.ts` also picked up the D54/D55/D59 fields the schemas
already had (`min_score_floor`, `short_clip_fallback`, `dedup`, `fallback`,
`overlays.emphasis`, the hold ratios).

The authoring/ops screens the design does not draw (queue, pipeline, themes,
style packs, prompts, overlays, sounds, library, panel, monitoring, admin,
editor) are unchanged and reachable from the sidebar's collapsible STUDIO group.

**The b-roll library is four screens now** (Slice 8): `/library` (browse +
search, one screen), `/library/review` (the approval gate, with the trim
workbench), `/library/ingest` (link / video file / image batch, plus the live
queue) and `/library/overview` (totals, distributions, purge). They sit in the
STUDIO group with the rest of the authoring surfaces, but the pending-review
count is a badge on the STUDIO header itself — that group is collapsed by
default, and an unreviewed clip is invisible to search AND to the worker, so
that number cannot be something you only see after opening a section. Polled
every 15s off the library's `/stats`; silent when the library is down, because
zeroing it would read as "nothing to review". Shared card/editor/rail/trim
components live in `platform/src/components/library/`.

## How to run (this machine's dev setup)

No docker, no sudo used. Everything runs as the user. **First time on a fresh
clone, do the one-time setup below first.**

```sh
# 0. one-time PATH (corepack pnpm + uv live in ~/.local/bin)
export PATH="$HOME/.local/bin:$PATH"

# 1. control-plane Postgres — a dev cluster in data/pg on port 5433
/usr/lib/postgresql/16/bin/pg_ctl -D data/pg -o "-p 5433 -k /tmp" -l data/pg.log start
# (system Postgres on 5432 hosts the library's `broll` DB, role broll/broll)

# 2. platform
pnpm install
pnpm --filter @lusora/platform run db:migrate     # idempotent
pnpm --filter @lusora/platform run dev            # http://localhost:3000
# login: admin@example.com / admin  (from .env; db:seed creates it once)

# 3. library service (broll-engine, a submodule — own venv, own DB)
cd library/broll-engine && ./.venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8321
# Library UI is now the PLATFORM's /library, /library/review, /library/ingest
# and /library/overview — broll_ui.py still works but do not run it while this
# is up: it starts a second ingest worker on the same serial queue.

# 4. worker (MUST run from worker/ — uv resolves the project by cwd)
cd worker && uv run python -m lusora_worker

# is this machine actually set up? (read-only; run it FIRST when anything 502s)
pnpm run doctor

# tests
pnpm run ci                                       # schemas+boundaries+ts tests+catalog drift
cd worker && uv run pytest                        # 28 tests
cd library/broll-engine && BROLL_DATABASE_URL=postgresql://broll:broll@localhost:5432/broll_test \
  BROLL_EMBED_DIM=8 .venv/bin/python test_flows.py   # also: test_engine_api.py
```

### One-time setup on a fresh clone

```sh
git submodule update --init --recursive          # library/ is a submodule (D71)
pnpm install

# two databases, both in the same cluster. The library creates its own
# `vector` extension and tables on first connect; it only needs the database
# to exist and its role to be allowed CREATE EXTENSION.
createdb -h 127.0.0.1 -U broll lusora
createdb -h 127.0.0.1 -U broll broll

# the library's own venv. sentence-transformers pulls torch — this is a
# multi-minute, ~2 GB install, and it is the slowest step by far.
cd library/broll-engine && python3 -m venv .venv \
  && .venv/bin/pip install -r requirements.txt && cd -

cp .env.example .env                             # then fill it in (below)
cp library/broll-engine/.env.example library/broll-engine/.env
pnpm --filter @lusora/platform run db:migrate
pnpm --filter @lusora/platform run db:seed       # creates the admin login

pnpm run doctor                                  # confirms all of the above
```

**`pnpm run doctor` is the thing to run before debugging anything.** Four
processes have to agree about two databases, one submodule, one shared `.env`
and one the submodule keeps for itself, and nearly every way that goes wrong is
silent — an empty `library/`, a `.env` a shell export is overriding, migrations
that never ran, a library pointed at the platform's database. It connects,
reads, writes nothing, and prints the command that fixes each thing it finds.
Every check in it is there because the setup failed that way at least once.

**The two things that stop a first ingest dead**, both in the library's
`.env` and neither with a usable default:

- `YTDLP_PROXY` — every network touchpoint passes it explicitly and **raises
  when it is unset**; there is deliberately no silent direct fallback.
  `YTDLP_PROXY=direct` is the explicit opt-out for local testing.
- `ZAI_API_KEY` — GLM does the tagging. `GLMClient` constructs fine without
  it and fails on the first CALL, so a keyless ingest fails partway rather
  than at startup.

An **upload** (`video_file` / `image`) never touches the proxy — the bytes are
already local — but still needs the GLM key to tag. A **link** needs both.

`.env` at the repo root is the single shared config (D26). Set:
`DATABASE_URL` (5433 dev cluster), `SESSION_SECRET`, `VIDEOS_ROOT`,
`LIBRARY_API_URL=http://127.0.0.1:8321`, `DEEPSEEK_API_KEY`,
`AI33_API_KEY` + `AI33_BASE_URL=https://api.ai33.pro`, `PEXELS_API_KEY`.
The library keeps its own `library/broll-engine/.env` (`ZAI_API_KEY`
for GLM tagging, `YTDLP_PROXY`, `BROLL_CLIP_ROOT` — see gotchas).

## Providers wired

| Role | Providers | Notes |
|---|---|---|
| TTS | `local` (ffmpeg flite, $0, en), `mock` (silence), `ai33` (api.ai33.pro) | ai33 is async: POST `/v3/text-to-speech` (multipart, `xi-api-key` header) → `task_id`; poll GET `/v3/task/{id}` (429s are normal — backoff is implemented) → CDN `audio_url`. Voices: GET `/v3/voices?provider=edge|minimax|elevenlabs|kokoro`, ids like `edge_en-US-GuyNeural`. All TTS adapters synthesize per sentence and emit `tts_timings.json` → exact SRT without Whisper |
| LLM | `deepseek` (default), `openai`, `anthropic` | worker/providers/llm.py; injectable `chat_fn` is the test seam |
| Script/planner agents | deepseek live-tested | planner repair loop max 3 attempts, ALL violations fed back |
| Visual sources | `library` (broll-engine HTTP), `stock` (Pexels, cached), `ai_image` (`mock` slates, `openai` untested) | chain semantics per D12; unavailable source falls through with provider_health record |
| Whisper | faster-whisper, optional dep, CPU | only for human audio without SRT |

## Gotchas / environment quirks

- **The library used to adopt the platform's `DATABASE_URL`** — fixed in
  broll-engine, worth knowing because the symptom was baffling. Its
  `load_dotenv()` took no argument, so it walked UP from the cwd until it
  found a `.env`; as a submodule the first one it met was lusora's. Its
  `DEFAULT_DSN` then falls back to a bare `DATABASE_URL`, so a library with
  no `.env` of its own connected to the CONTROL PLANE database and ran its
  `CREATE TABLE`s in it. The load is pinned to the library's own directory
  now. Still give it a `library/broll-engine/.env` with an explicit
  `BROLL_DATABASE_URL`: `pnpm run doctor` fails if it is missing.
- **A shell export silently beats `.env`, permanently.** `loadEnv()` skips any
  key already in `process.env` and Next reads `.env` once per process, so an
  `export LIBRARY_API_URL=…` left in a shell (or a profile) overrides the file
  for every server started from it, with nothing anywhere saying so — this cost
  an afternoon of 502s against a port nothing was listening on. `pnpm run
  doctor` reports any exported variable that disagrees with `.env`.
- **A venv never arrives with a clone** (`.venv/` is git-ignored in both
  repos), and neither does the submodule's content (`git submodule update
  --init --recursive`). Both look like "the code is broken" rather than
  "nothing is installed".

- **Library clip bytes were lost once**: the clip root (then named
  `BROLL_STORAGE_ROOT`, renamed `BROLL_CLIP_ROOT` in broll-engine) defaulted
  to `/tmp/broll_clips`, wiped on reboot. 64 pre-existing segments have
  rows but no bytes (their `/clips/{id}` 500s; the lusora adapter treats
  that as fall-through). It now points at `data/broll-store/`. To make
  the old segments usable, re-ingest their sources.
- The worker **must** be started from `worker/` (uv project resolution).
- A killed worker leaves `producing` rows; the next worker start
  re-queues orphans automatically (heartbeat-based, 60s).
- `resolve_assets` checkpoints the plan after every item, so large stock
  downloads survive a kill.
- pt-BR voices: use ai33 `edge_pt-BR-*` voices; flite is English-only.
- ai33 charges opaque "credits" (recorded in cost_event details); the
  per-char USD in `contracts/prices.json` is an estimate (OQ-15 note).
- The library is a **submodule** now (D71), pinned to a commit on
  broll-engine's `claude/lusora-automation-architecture-eh0hpk` branch —
  re-pin to `master` once that merges. An empty `library/broll-engine/`
  means `git submodule update --init --recursive` has not been run. The
  hand-vendored copy it replaced is gone; its git history backup at
  `data/broll-lib-maker.git-history-backup` is no longer needed, since the
  real history is the submodule's.

## Known gaps (intentional, small)

1. ~~Remotion Player parity preview~~ **DONE (2026-07-19)** — "Preview"
   tab in the editor mounts the SAME `VideoComposition` via
   `@remotion/player` (`platform/src/components/PlanPreview.tsx`). Plan
   asset paths are rebased onto the new
   `GET /api/videos/{id}/files/{...path}` route (range support) so
   `staticFile()` resolves in the browser. Verified via typecheck +
   page compile + files route; not yet eyeballed in a browser.
2. ~~Unlock/relock UI affordance~~ **DONE (2026-07-19)** — `set_lock`
   plan op (planEdit.ts) + 🔒/🔓 toggle on timeline/overlay rows; the
   chat agent prompt documents it too.
3. **ai_image `openai`** adapter written but never run (no key).
4. ~~Chat agent vs live LLM~~ **verified (2026-07-19)** against live
   DeepSeek at the API level (correct overlay targeted, valid op
   proposed); the UI calls the same endpoint.
5. **OQ-21**: measure render/Whisper throughput on the target VPS with
   an M3 fixture before choosing specs.
6. Deploy Dockerfiles exist but were never built here (no docker).
7. ~~Prompts are hardcoded strings~~ **DONE (2026-07-27, M10)** — prompt
   packs (D42–D45): `contracts/prompts/`, the editable/welded split, the
   resolution ladder with the resolved text snapshotted into `cfg.prompts`,
   a `/prompts` screen with a composed preview and a costed test run.
   Inventory and invariants: [LLM Usage](02-components/llm-usage.md).
   **Not yet exercised against a live DB**: `pnpm run ci`, the platform
   build and both test suites pass, but the screen and the enqueue path
   were never opened in a browser here (the dev Postgres on :5433 was
   down and starting it needs sudo). First run: check `/prompts` loads,
   then enqueue one video and confirm `cfg.json` carries `prompts`.
8. ~~`script.model` / `planner.model` missing from the channel config
   schema~~ **DONE (M10)** — both added, alongside `prompt` and
   `script.target_seconds`.

## Render stability on low-RAM machines (2026-07-19 fixes)

Two real bugs surfaced finishing `vid_bf49becb0547`:

- **Non-monotonic interpolate ranges**: overlay components computed
  `[0, in, dur-in, dur]` fade windows; a short overlay + `slow_heavy`
  theme (durationMul 1.4) made `in > dur/2` → Remotion threw
  `inputRange must be strictly monotonically increasing`. All five core
  components now use `fadeInOutRange()` from `themes/runtime.ts`,
  which shrinks fades to fit.
- **delayRender timeouts on perfectly good clips**: on this 7.5G
  machine (swap full), default concurrency (cores/2 = 4 tabs) plus an
  unbounded OffthreadVideo frame cache stalled frame extraction for
  minutes. `renderRemotion` now defaults to concurrency 2 and a 512MB
  compositor cache — override with `REMOTION_CONCURRENCY` /
  `REMOTION_OFFTHREADVIDEO_CACHE_BYTES`.

## Deviations from the draft contracts (already reflected in schemas)

- `edit_plan.audio.voiceover.start_s` added (leading timed beats /
  cold opens offset the voiceover).
- `channel_config.style_pack_doc` / `theme_doc`: the full style pack and
  theme documents are embedded into the cfg snapshot at enqueue
  (Core Principle 7). Named files live in `contracts/style-packs/` and
  `contracts/themes/`.
- The library API gained `licenses` filters and
  `POST /segments/{id}/mark_used` (documented library changes, OQ-13), then
  the browse surface the screens needed: `video_id`/`sort`/`offset` on
  `/segments` with the total in an `X-Total-Count` header,
  `include_duplicates` (default off, so the duplicate count on Overview has
  somewhere to lead), `GET /tags` `/videos` `/stats`,
  `POST /segments/unapprove`, and `DELETE|POST /jobs/{id}[/retry]`.
  `segments.caption_edited` is a real column because the Review warning
  ("still the model's original caption") has to survive a reload.
- Platform API gained `GET /api/videos/{id}/files/{...path}` (video
  folder artifacts for the editor's Player preview) and the `set_lock`
  plan op.
- Platform API gained `GET|POST /api/themes` and
  `GET|PUT /api/themes/{name}` — the Themes screen reads and writes
  `contracts/themes/*.json` directly (no themes table); writes are
  manager+ and validate against `theme.schema.json`. PUT cannot rename
  (the name is the filename channels reference); an edit only affects
  future enqueues, since queued videos carry their own `theme_doc`
  snapshot.
- Style packs are editable the same way: `GET|POST /api/style-packs` and
  `GET|PUT|DELETE /api/style-packs/{name}` back the Style Packs screen,
  writing `contracts/style-packs/*.json` (no table). PUT cannot rename;
  DELETE refuses while a channel references the pack. A whole-document
  PUT reserializes the file, so a pack saved from the screen is
  normalized once (`4.0` → `4`) — the Overlays screen's allowance toggle
  still splices only `allowed_packs`, so it never carries that
  diff noise.
- **Theme `surface` + `motion` tokens (D46, M11).** `theme.schema.json`
  gained six optional enums: `surface.{radius,fill,accent_rule}` and
  `motion.{entrance,easing,per_component}`. Resolved by
  `engine/src/themes/runtime.ts` (`surfaceStyle`, `easingCurve`,
  `entranceFor` — all Remotion-free, so the platform can import them) and
  `engine/src/themes/entrance.ts` (`useEntrance`, the frame-aware half).
  All 26 catalog components and all 5 template layouts read them;
  `engine/test/themes.test.ts` pins that a theme with none of these tokens
  resolves to exactly the pre-D46 values, which is what made the
  component-at-a-time migration safe.
  - `entrance` is a REQUEST: a component declares which entrances it can
    draw (`PANEL_ENTRANCES` / `TEXT_ENTRANCES`) and anything else degrades
    to `fade` rather than rendering wrong.
  - Absent ≠ any value. `accent_rule` and `entrance` have no schema
    default: omitted means each component keeps its own choice. Most
    components' fallback is `fade`, because pre-D46 most animated their
    internals rather than their frame — the theme now ADDS a frame-level
    entrance on top.
  - `KineticTitle`'s `entrance` PROP still works and maps into the token
    vocabulary (mask→wipe, scale→pop); the theme wins where set. The prop
    is a deprecation candidate (appearance is not the planner's job) but
    removing it changes the catalog entry the planner reads.
  - Zero ffmpeg cost: any overlay already forces the Remotion route.
  - `contracts/themes/clean-punchy.json` is the seed second look.
  - `QuoteCard.tsx` is unconverted and is NOT in the `COMPONENTS` map —
    dead code, renders nothing; delete or register it.
- **Theme `typography` + `chart` tokens, and the archive merge (D66).**
  `theme.schema.json` gained eleven more optional enums:
  `typography.{scale,weight,case,tracking}`, `surface.{density,rule,texture}`
  and a new `chart` block (`{grid,legend,markers,stroke,number_format}`).
  Resolved by `typeScale`/`typeWeight`/`typeCase`/`typeTracking`,
  `densityScale`, `ruleWidth`, `textureLayer`, `chartStyle` and
  `groundStyle` in `engine/src/themes/runtime.ts`. **All 26 core components
  now read every visual decision from a resolver** — D46's "only 8 take
  `surface`" no longer holds, because `groundStyle` gave the other 18 a
  ground to take.
  - The tokens split two ways, and that split is what made the migration
    safe. SCALE tokens (`scale, weight, case, tracking, density, rule,
    chart.stroke`) have an identity element, so the resolver returns the
    component's OWN value at the default — `typeWeight(theme, 700)` is 700
    under an untouched theme, the way `surfaceStyle` scales a radius rather
    than replacing it. CHOICE tokens (`chart.grid|legend|markers`) have no
    identity element, so they carry NO schema default and fall back to the
    component's own, the `accent_rule` precedent.
  - Because of that, the resolved chart types are WIDER than the token
    enums: `grid: "axes"` (LineChart's own) and `markers: "ends"` are values
    a component can hold that no theme can name.
  - Verified, not argued: a `git worktree` at the prior commit rendered all
    26 under `history-dark` and 25 came out pixel-identical. Only
    `LineChart` moved, deliberately, off `[accent, text, neutral]` onto the
    engine-owned `seriesColors` ramp.
  - `groundStyle(theme, { legible: true })` is the one place a theme is
    overruled. `fill: "none"` over unknown footage is survivable for light
    ink and unreadable for dark, so a ground that carries type gets a plate
    back whether the theme asked or not. It fires only on a light-page
    theme; on a dark one it returns null and nothing changes.
  - Colours stayed at four. Everything the conversion needed came out as a
    resolver — `paperStock`, `groundStyle` — never a fifth token.
  - Three themes ship as the proof: `paper-print`, `field-manual`,
    `bold-editorial` (`contracts/themes/`). `ledger` and `clean-explainer`
    from the INVENTORY are not written yet.
  - `engine/scripts/preview-batch.mjs --theme <t> --all` renders every
    catalog overlay in ONE Remotion bundle and cuts a still per component;
    `preview-overlay.mjs` re-bundles per component, which is most of its
    wall-clock. Both now seed the synthetic background gradient — ffmpeg's
    `gradients` filter randomises per run, so without a seed two renders of
    identical code differ in 93% of pixels and no before/after means
    anything.
  - `engine/src/components/core/_LineChartPreMerge.tsx` is the pre-D66 core
    LineChart, kept on disk and unregistered so the merge can be diffed.
    Delete it once the merge has settled.
- Themes and style packs can be IMPORTED as whole documents:
  `platform/src/components/DocImport.tsx` (one component, both kinds)
  posts to the existing `POST /api/themes` / `POST /api/style-packs`,
  which already schema-validate and 409 on an existing name. The Themes
  screen also plays the entrance (`ThemeEntrance`) — motion is
  unjudgeable from a still. Those CSS keyframes are a second
  implementation of `useEntrance`'s transforms, accepted over booting a
  Remotion Player for a 12-frame gesture.
- `style_pack.video_type` (optional, same enum as
  `channel_config.video_type`) records which preset a pack implements.
  Advisory only: the pipeline still reads the channel's `video_type`, and
  the field just orders the style-pack picker on the Channels screen.
  `GET /api/config-options` therefore returns `stylePacks` as
  `{name, video_type?}[]` rather than plain names.
- `platform/src/lib/pacing.ts` mirrors the density map, overlay cap and
  beat-count range from `worker/lusora_worker/validators.py` so the Style
  Packs preview shows the budget the validator will actually enforce.
  Guarded by `platform/test/stylePacks.test.ts`; if the worker's rules
  move, move these too.
- The catalog is now `contracts/catalog.json` (generated `core`) PLUS the
  data-only packs in `contracts/component-packs/*.json`, merged by
  `lusora_contracts.load_catalog()` and `platform/src/lib/catalog.ts`
  (duplicate names raise). The Overlays screen reads that merged list and
  writes the pack files: `GET|POST /api/catalog`,
  `GET|PUT|DELETE /api/catalog/{name}` (data packs only — core is
  generated), `PUT /api/catalog/{name}/style-packs` for
  `overlays.allowed_packs`, and `GET|POST /api/catalog/packs` +
  `GET|PUT|DELETE /api/catalog/packs/{pack}` for whole-pack
  import/export/replace/delete (import is all-or-nothing). Style-pack
  writes splice only that array so hand-formatted contract files are not
  reserialized.
- `load_catalog()` is no longer permanently memoized: it re-reads when
  catalog.json or any pack file changes (mtime+size signature). The worker
  is a `run_forever` poller, so the old `lru_cache` meant a component added
  in the UI stayed invisible until the process restarted.
- `channel_config.component_pack` is still stored-but-unread: the planner
  menu and the validator gate on the style pack's resolved component menu
  only, so a pack name is organisational today.
- `engine/src/catalog/sample-props.json` holds the representative props per
  component, shared by `engine/preview-all.mjs` and the Overlays screen's
  live preview (`engine/src/renderers/remotion/OverlaySolo.tsx`).
  Only `core` entries live there; a pack entry's preview props are
  synthesized from its prop spec (`platform/src/lib/overlaySamples.ts`).
- **The `social` and `finance` packs (D68).** `social` is `SocialPost`
  (`platform: youtube | twitter | reddit` — one component, not three),
  `WebPageFrame` and `HeadlineStack`; `finance` is `Candlestick`, `MetricGrid`
  and `WaterfallChart`. Three entries each, which is the shape a derived pack
  has. **`social` is DEPICTIVE and theme-exempt**: those three carry their own
  platform chrome and declare `honors: ["motion.entrance", "surface.density"]`
  and nothing else, because a YouTube comment set in the channel's serif on the
  channel's cream plate is not on-brand, it is wrong. Do not "fix" that later.
  Offered by the explainer/breakdown/listicle style packs, not the documentary
  ones — a YouTube comment in a grave archival doc is a tonal error, and
  `allowed_packs` is where that gets said.
- **The `archive` pack is GONE (D69).** D66 merged seven of its nine
  components into their core twins; D69 retired the last two. `ArchiveFrames`
  became `core/PortraitPlates` (renamed because `Archive` describes a look) and
  `ArchiveCaption` was deleted. The archival look did not go anywhere — it is a
  theme plus the D66 tokens, which was the whole argument.
  Five theme resolvers came out of that pack rather than out of a token:
  `surfaceColor`, `seriesColors`, `contrastInk`, and — from the D66 conversion —
  `paperStock` and `groundStyle`. `fontStack` grew a mono branch and a condensed
  branch.
- **Four themes, and `standard` is the house look (D69).** `standard`,
  `paper-print`, `field-manual`, `bold-editorial`. Six near-duplicates were
  deleted (`archive`, `atlas-da-guerra`, `clean-plain`, `clean-punchy`,
  `doc-minimal`, `history-dark`) — a theme nobody picks is a file that goes
  stale and a row in every picker. `standard` is the default for a new channel,
  for both preview scripts and for the fixture channel config.
- **The fonts are actually packaged now (D70).** `engine/fonts/` carries Inter,
  Playfair Display and Oswald as latin-subset variable woff2;
  `node scripts/pack-fonts.mjs` inlines them into `src/themes/fonts.generated.ts`
  as data URIs and `<PackagedFonts />` mounts that in `VideoComposition` and
  `OverlaySolo`, holding the render until the faces decode. Before this,
  `typography.display` named a family nothing on the machine had and every theme
  fell through to DejaVu — check with `fc-list : family | grep -i inter` if a
  render ever looks like the wrong face. `engine/test/fonts.test.ts` fails if a
  shipped theme names a family the directory does not carry, and if
  `fonts.generated.ts` drifts from it.
- **`layout.composition` (D70).** `standard` sets `poster`, so its charts own
  the frame — full-bleed ground, headline top-left, plot filling the rest —
  where the other three themes stay on the centred card. Only `BarChart`,
  `LineChart` and `PieChart` have a poster branch; everything else ignores the
  token. See D70 for the five deliberate pixel changes that came with it.
- **Overlay templates** (`engine/src/components/templates/`): an entry may set
  `template: card|lower_third|big_number|bullet_list|statement` instead of
  shipping a React component, and `TemplateOverlay` draws it from the theme
  runtime. `catalog_entry.schema.json` and `edit_plan.schema.json` both gained
  the optional field; the compiler copies the kind into the plan item so the
  renderer needs no catalog access; `preview-overlay.mjs --template <kind>`
  renders one from the CLI. This is what makes an overlay authored in the UI
  usable in the next video without a code change.
- Cut transitions in the ffmpeg xfade chain render as an imperceptible
  0.08s blend when mixed with fades; all-cut plans use exact concat.

- **Sound (D48–D50, M12).** The fourth data layer. `contracts/sound-packs/<name>/`
  holds `manifest.json` + `sfx/*.mp3` + `beds/*.mp3`; the theme's `sound`
  block names cues from it; the style pack's `sfx`/`music` blocks govern
  how often; `source_policy.{music,sfx}.enabled` are the master switches
  (both default TRUE now — they were false and unread before).
  - Everything is placed by the COMPILER (`worker/lusora_worker/compiler/sound.py`),
    never resolved at render time, so every cue is an addressable plan item
    the editor can move and the ffmpeg path can mix.
  - `sound.py` MIRRORS `entranceFor` and `motionScale` from
    `engine/src/themes/runtime.ts`, which is why `catalog_entry` gained
    `entrance_seconds` and `entrance_support`. That is what lets a typing
    cue span exactly the typewriter reveal. **Two implementations of one
    rule — change both.** `worker/tests/test_sound.py` pins the shared cases.
  - Ducking is a computed `gain_envelope` (absolute time, piecewise-linear)
    on each music item, derived from the real per-sentence TTS timings. No
    compressor. Remotion interpolates it in `audioVolumeAt`; ffmpeg builds
    the same curve as a `volume=…:eval=frame` expression (`envelopeExpr`).
    `engine/test/audio.test.ts` evaluates the ffmpeg expression against
    `gainAt()` to prove the two paths agree.
  - Levels: theme `gain.music_duck`/`music_lift` are ABSOLUTE levels;
    `source_policy.music.default_volume` is a TRIM (default 1). Multiplying
    two absolute levels was a real bug caught in testing — it put the bed at
    -64 LUFS against a -22 LUFS voice, i.e. inaudible.
  - `loudnorm=I=-14` on the finished mix, both paths (`renderers/loudness.ts`
    for Remotion, folded into the mux chain for ffmpeg). Measured -14.0 LUFS
    on both.
  - **The shipped audio is SYNTHESIZED placeholder material**, generated by
    `contracts/sound-packs/build.mjs` (ffmpeg formulas; beds are snapped-
    frequency sine stacks). It is deterministic, offline and $0, and it is
    not a substitute for recorded CC0 audio. Swapping real files in needs no
    code change — see `contracts/sound-packs/README.md`. Cues are peak-
    normalized (-6 dBFS) and beds loudness-normalized (-24 LUFS); that
    asymmetry is deliberate and explained there.
  - `beat_sheet.music[]` (MusicSpan) is now superseded by `beat.mood` and is
    still read by NOTHING — a deletion candidate, do not build on it.
  - **The Sounds screen** (`/sounds`) is the sound-pack sibling of Overlays:
    play any cue or bed at the gain a theme will apply, edit the metadata the
    compiler reads, upload new sounds, create/delete packs. File-backed like
    Themes and Style Packs (`/api/sounds/**`, `lib/soundPacks.ts`; no table).
    Three rules are enforced server-side because the UI is the easiest place
    to get them wrong: `duration_s` is always PROBED and a client-supplied
    value is discarded; uploads are normalized by kind (cues -6 dBFS peak,
    beds -24 LUFS); and deleting a cue, bed or pack a theme names is refused
    with a 409 naming the themes.
  - **Migration hazard for channels created before M12.** `source_policy.music.default_volume`
    changed meaning from "the music level" to "a trim on the theme's levels".
    A stored `0.12` now reads as a -18 dB trim, so such a channel gets music
    that is effectively inaudible. `HIST_BR_01` is in this state. Fix by
    clearing the field (the default is 1) on any channel that carries it.
    Channels created before M12 also have `music.enabled`/`sfx.enabled`
    explicitly `false` from the old defaults, so they stay silent until
    switched on — which is the safe direction.

## Where things live

- Per-beat recompile rule: `worker/lusora_worker/pipeline/steps.py`
  (`plan_compiled_and_fresh`, `_merge_recompiled`) — beats.json newer
  than edit_plan.json triggers it; locked items win wholesale; items
  whose beat `visual_intent` is unchanged keep their resolved asset
  (compared via `asset.query`).
- Budget gate: `worker/lusora_worker/costs.py` (estimate→reserve→actual).
- Renderer routing: `engine/src/router.ts`; ffmpeg renderer
  `engine/src/renderers/ffmpeg/render.ts`; Remotion
  `engine/src/renderers/remotion/` (bundles with the video folder as
  publicDir so `staticFile()` resolves plan asset paths).
- Editor ops: `platform/src/lib/planEdit.ts` (plan) /
  `beatEdit.ts` (beats) / `chatAgent.ts` (proposals only; apply is a
  second call).
- Stage list: `contracts/pipelines/faceless.yaml` (D60) — the ORDER and
  the artifacts. The bodies and their done-checks are the step registry in
  `worker/lusora_worker/pipeline/stages.py` (`STEP_REGISTRY`); the
  orchestrator walks `cfg.pipeline_doc`, falling back to `faceless`.
  Selection happens once, at enqueue, in
  `platform/src/lib/pipelines.ts` (`selectPipeline`), down the D61 ladder:
  a pinned `pipeline` name, else the manifest whose `category` matches the
  channel's `production_style`, else `faceless`. A style with no matching
  manifest fails the enqueue instead of defaulting — so adding talking-head
  production means one `.yaml` with `category: talking_head`, and the
  Channels screen offers it the moment the file exists.
- Review mode (D62): a video with `cfg.checkpoint_policy: guided` stops after
  every stage the manifest flags, sets status `awaiting_approval` and waits.
  Approving is `POST /api/videos/[id]/approve` (editors may), which writes
  `approvals/<stage>.json` into the video folder and re-queues it. Both
  shipped manifests gate after `script` and after `plan_beats`, so nothing is
  rendered before the beat sheet is approved. Needs migration
  `contracts/db/0002_awaiting_approval.sql` — run `npm run db:migrate` in
  platform/ before using it.
- Subtitle cue size (D63): `cfg.transcript.granularity` — `sentence`
  (default, free, from the TTS adapter's per-sentence timings), `word`
  (always costs a whisper pass; needs `faster-whisper` installed) or
  `segment`.
- Beats phases (D65): `worker/lusora_worker/beatphases.py` holds
  `script_split` / `srt_alignment` / `beat_parts`. The deterministic planner
  uses them, so beat boundaries follow `style_pack.pacing.min_hold` and the
  real `subtitles.srt` instead of a sentence count. `faceless_v2` declares the
  six phases as substages; they are declarative (the orchestrator never walks
  them) but a phase with no implementation fails at load.
- `faceless_v2` (D64) is a `stability: test` pipeline: faceless plus a
  `research` stage that writes `research.md` before the script. Research is
  phase 0 of the SCRIPT agent (shares `script.llm`/`model`, configured under
  `script.research`), so it is still three bounded agents. Not selectable by
  `production_style` and excluded from batch — pin it with `pipeline:
  faceless_v2`.
