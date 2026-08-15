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

## How to run (this machine's dev setup)

No docker, no sudo used. Everything runs as the user:

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

# 3. library service (vendored broll-lib-maker, own venv)
cd library/broll-lib-maker && ./.venv/bin/python -m uvicorn api:app --host 127.0.0.1 --port 8321

# 4. worker (MUST run from worker/ — uv resolves the project by cwd)
cd worker && uv run python -m lusora_worker

# tests
pnpm run ci                                       # schemas+boundaries+ts tests+catalog drift
cd worker && uv run pytest                        # 28 tests
cd library/broll-lib-maker && BROLL_DATABASE_URL=postgresql://broll:broll@localhost:5432/broll_test \
  BROLL_EMBED_DIM=8 .venv/bin/python test_flows.py
```

`.env` at the repo root is the single shared config (D26). Set:
`DATABASE_URL` (5433 dev cluster), `SESSION_SECRET`, `VIDEOS_ROOT`,
`LIBRARY_API_URL=http://127.0.0.1:8321`, `DEEPSEEK_API_KEY`,
`AI33_API_KEY` + `AI33_BASE_URL=https://api.ai33.pro`, `PEXELS_API_KEY`.
The library keeps its own `library/broll-lib-maker/.env` (`ZAI_API_KEY`
for GLM tagging, `YTDLP_PROXY`, `BROLL_STORAGE_ROOT` — see gotchas).

## Providers wired

| Role | Providers | Notes |
|---|---|---|
| TTS | `local` (ffmpeg flite, $0, en), `mock` (silence), `ai33` (api.ai33.pro) | ai33 is async: POST `/v3/text-to-speech` (multipart, `xi-api-key` header) → `task_id`; poll GET `/v3/task/{id}` (429s are normal — backoff is implemented) → CDN `audio_url`. Voices: GET `/v3/voices?provider=edge|minimax|elevenlabs|kokoro`, ids like `edge_en-US-GuyNeural`. All TTS adapters synthesize per sentence and emit `tts_timings.json` → exact SRT without Whisper |
| LLM | `deepseek` (default), `openai`, `anthropic` | worker/providers/llm.py; injectable `chat_fn` is the test seam |
| Script/planner agents | deepseek live-tested | planner repair loop max 3 attempts, ALL violations fed back |
| Visual sources | `library` (broll-lib-maker HTTP), `stock` (Pexels, cached), `ai_image` (`mock` slates, `openai` untested) | chain semantics per D12; unavailable source falls through with provider_health record |
| Whisper | faster-whisper, optional dep, CPU | only for human audio without SRT |

## Gotchas / environment quirks

- **Library clip bytes were lost once**: `BROLL_STORAGE_ROOT` defaulted
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
- The lusora repo vendors the library **files**; the library's original
  git history is preserved at `data/broll-lib-maker.git-history-backup`
  (move it back to `library/broll-lib-maker/.git` to restore).

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
  `POST /segments/{id}/mark_used` (documented library changes, OQ-13).
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
  still splices only `allowed_components`, so it never carries that
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
  - Only 8 components take `surface` — the rest draw no panel. Bar
    rounding and dot geometry are deliberately NOT surface tokens.
  - Zero ffmpeg cost: any overlay already forces the Remotion route.
  - `contracts/themes/clean-punchy.json` is the seed second look.
  - `QuoteCard.tsx` is unconverted and is NOT in the `COMPONENTS` map —
    dead code, renders nothing; delete or register it.
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
  `overlays.allowed_components`, and `GET|POST /api/catalog/packs` +
  `GET|PUT|DELETE /api/catalog/packs/{pack}` for whole-pack
  import/export/replace/delete (import is all-or-nothing). Style-pack
  writes splice only that array so hand-formatted contract files are not
  reserialized.
- `load_catalog()` is no longer permanently memoized: it re-reads when
  catalog.json or any pack file changes (mtime+size signature). The worker
  is a `run_forever` poller, so the old `lru_cache` meant a component added
  in the UI stayed invisible until the process restarted.
- `channel_config.component_pack` is still stored-but-unread: the planner
  menu and the validator gate on the style pack's `allowed_components`
  only, so a pack name is organisational today.
- `engine/src/catalog/sample-props.json` holds the representative props per
  component, shared by `engine/preview-all.mjs` and the Overlays screen's
  live preview (`engine/src/renderers/remotion/OverlaySolo.tsx`).
  Only `core` entries live there; a pack entry's preview props are
  synthesized from its prop spec (`platform/src/lib/overlaySamples.ts`).
- **The `archive` pack (data entries + code).** `contracts/component-packs/
  archive.json` declares seven overlays drawn by React components in
  `engine/src/components/archive/`: ArchiveLowerThird, ArchiveCaption,
  ArchiveChapterTitle, ArchiveQuoteCard, ArchiveCounter, ArchiveBarGraph,
  ArchiveLineChart. One visual idea throughout — a hard-edged paper plate
  with a tan strip welded to it, both sized by their own text and opened by
  a wipe under the type rather than through it. Ships with the theme it is
  drawn for (`contracts/themes/archive.json`, a paper theme: cream `bg`,
  ink `text`, tan `accent`, typewriter `body`) and the style pack that
  offers it (`contracts/style-packs/archive-doc.json`). Three theme
  resolvers were added for it in `engine/src/themes/runtime.ts`:
  `surfaceColor` (the opaque plate colour — `surfaceStyle().background`
  honours `fill: none`, which a plate cannot), `seriesColors` (the ochre /
  slate / oxblood data ramp, one variant per plate luminance, contrast- and
  colour-blindness-checked) and `contrastInk` (type ON the accent picks
  `text` or `bg` by contrast, so the pack degrades instead of breaking on a
  dark theme). `fontStack` also grew a mono branch — a typewriter face that
  fell through to the sans fallback would set the counter in a proportional
  face and its digits would shuffle sideways every frame.
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
