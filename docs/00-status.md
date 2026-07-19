# Implementation Status — handoff notes

> Written 2026-07-19, after the full build. Read this FIRST when picking
> the project up in a new session/tool. The design docs (01–05) describe
> the intent; this file describes what actually exists and how to run it.

## What is built

**All milestones M0–M9 are implemented and verified** (one commit each,
see `git log`). The system produces finished MP4s end to end with real
providers. Sample runs that exist in `data/videos/`:

- ffmpeg path: flite ($0) narration → mock images → captions → final.mp4
- Remotion path: DeepSeek script + planner (repair loop observed fixing
  real violations) → ai33 narration → library photos + Pexels stock +
  mock fallthrough → themed overlays (TitleCard, AnimatedPercentage) →
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
- Cut transitions in the ffmpeg xfade chain render as an imperceptible
  0.08s blend when mixed with fades; all-cut plans use exact concat.

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
