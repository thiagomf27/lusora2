# CLAUDE.md — architecture and decisions

Context for working on this repo. Not a tutorial (that's README.md);
this is why things are the way they are, and what not to break.

## Core design

A **segment library**: the unit of everything is a `Segment`
(`broll/schema.py`) — one tagged shot of one source video, one row in
pgvector, one clip file in object storage. Tagging is exhaustive and happens
**once per source video**; searches are then pure index hits. Still images
are segments too: `media_type="image"`, one image = one row (clips are
`"video_clip"`; start/end/duration are 0 for images).

- **Profiles** (`broll/profiles.py`): a named gallery = its own
  database_url + storage_root + embed_model/embed_dim, with one cached
  engine per profile (`engine_for`). The **default profile is always
  env-derived and never persisted** to profiles.toml — that is what keeps
  pre-profile setups and tests (which override `BROLL_DATABASE_URL` /
  `BROLL_EMBED_DIM`) working; only named profiles live in the file, and a
  `[profiles.default]` section is deliberately ignored. Embedding config
  is per-profile because vectors from different models are incompatible;
  `VectorIndex.__init__` compares the profile's embed_dim against the
  DB's vector typmod and REFUSES on mismatch — don't soften that into a
  warning.
- **One job queue for all profiles**, living in the default profile's DB
  (`broll/jobs.py`); each job records its profile (+ `kind`:
  video|image|video_file) and the single serial worker resolves the
  engine per job (`run_job(engine_for=...)`). One-download-at-a-time is a
  GLOBAL rule — don't add per-profile workers.
- **One shared DB per profile, partitioned by `channel_id`** — not a DB
  per channel.
  `channel_id=NULL` = the global pool (YouTube/stock finds); uploads are
  scoped to their owning channel. Search takes `channel_id` +
  `include_global`. Amortization and global dedup depend on this being ONE
  index.
- **Per-channel usage tracking**: overuse is judged within a channel
  (`usage_by_channel`), because reusing a clip in the same channel is the
  problem; the same clip in another channel is fine. `usage_by_project` is a
  count map; ranking hard-blocks a clip already used in the current project
  (`broll/ranking.py`).
- **Dedup at ingestion** (`VectorIndex.find_near_duplicate`): caption/tag
  embedding cosine ≥ `BROLL_DEDUP_SIM` (0.93), reinforced by perceptual hash
  (phash close ⇒ sim floored at 0.95). Duplicates store a row pointing at
  the canonical (`duplicate_of`) and NO bytes. `mark_used` credits the
  canonical. Dedup is constrained to the SAME `media_type` — an image must
  never link to a clip (its bytes/URI semantics differ).
- **Images branch off early** (`BrollEngine.ingest_image` /
  `ingest_image_url`): no download-resolution logic, no clipping, no
  chunking, no MIN_CLIP_S floor. One `tag_image` GLM call, then the same
  embed → dedup → store path as clips: the stored object IS the image
  (`images/<id>.<ext>` in the ObjectStore, URI in `clip_uri`), the
  thumbnail a resized copy. Uploaded files spool via `BROLL_UPLOAD_SPOOL`
  and are consumed by the worker ON SUCCESS only, so a retry can re-read
  them.
- **Sources are deleted after tagging** (`_tag_cut_store` finally-block).
  Clips are cut from the ≤`BROLL_MAX_RES` download; resolution is permanent.
  Exhaustive tagging is what makes this safe — you never need the source
  again.
- **Clips + thumbnails live in `ObjectStore`** (local dir, `file://` URIs).
  The intended production swap (Google Drive / S3) replaces exactly two
  methods: `ObjectStore.put` and `uri_for`. Nothing else may care where
  bytes live — rows hold opaque URIs. (Drive is NOT implemented yet; if you
  see docs claiming file_id semantics, they're aspirational.)

## The two-pass GLM flow (`broll/tagging.py`)

Everything model-facing goes through `GLMClient` (OpenAI-compatible; hosted
Z.ai GLM-4.6V-Flash today, local vLLM by swapping `GLM_BASE_URL`/`GLM_MODEL`).

**Coarse (pre-download)** — `coarse_score()`: thumbnail (+ optional yt-dlp
storyboard mosaic) + title/desc → 0..1 score. This is what lets discovery
download 1–3 winners instead of 20 candidates. Images must be **base64 data
URIs** — the endpoint 400s on remote image URLs (code 1210).

**Fine (post-download)** — `fine_tag_video()`: exhaustive shot segmentation.
The pipeline is:

```
chunk (240s / 12s overlap) → merge overlaps → gap-fill holes → refine long segments
                                                            ↘ (video input failed
                                                               entirely) frame-
                                                               sampling fallback
```

**Why chunked**: the model's reply-token ceiling. Whole-video passes on
long footage truncate mid-JSON, and the same exhaustion produces empty
replies. Chunking bounds each reply; the rest of the stack exists because
GLM-4.6V-Flash reply quality varies WILDLY run to run (a chunk sometimes
returns `[]` for 4 minutes of real footage — observed live):

- **Gap-fill** (`_fill_gaps`, >45s unreported → one re-tag call) recovers
  footage a lazy chunk skipped; interviews legitimately come back empty.
  Runs BEFORE refinement so a blob returned for a gap still gets split.
- **Refinement** (`_refine_long_segments`, >18s → one re-tag of the exact
  span): ≥2 shots back = splice; 1 back = confirmed long take, keep the
  ORIGINAL. One recursive level only. This is deliberately one call on the
  whole span, not a forced halving — halving could never confirm a long take.
- **Truncation salvage** (`_salvage_objects`): brace-balanced,
  string-escape-aware scan that recovers every complete segment object from
  a truncated reply.
- **Umbrella rule** (in `_parse_segments`): a segment containing ≥2 others
  is dropped ONLY if its contents cover ≥70% of its span; otherwise it's
  kept so refinement can split it. Dropping uncovered umbrellas loses
  footage (this bug happened; don't reintroduce it).
- **Frame-sampling fallback**: if native video input fails entirely, sample
  32 timestamped frames and infer boundaries. Coarser (uniform ~23s blocks)
  but it has saved whole ingests. **It must stay.**

Model quirk (learned the hard way): with video input the model IGNORES the
system role. Fine-pass instructions live in the USER turn, after the video,
with a shot-based example (`_FINE_INSTRUCTIONS`).

**Image pass** — `tag_image()`: ONE call, no chunking/refinement/gap-fill
(nothing to segment). Instructions ride in the user turn like the fine pass,
and the image is inlined as a downscaled base64 data URI (same code-1210
rule; the ORIGINAL file is what gets stored, the downscale is only for the
model request).

## Conventions — do not "fix" these

- **Min clip length at ingest (`BROLL_MIN_CLIP_S`=4s), NO max cap.** Max
  duration is a search-time filter (`max_duration`). Capping at ingest
  destroys footage permanently; filtering at search costs nothing. The
  floor applies to clips only — images have duration 0 by design.
- **Media kind is sniffed by URL file extension** at `JobQueue.enqueue`
  (`pipeline.is_image_url` / `is_video_file_url`, also applied to `file://`
  spool paths): image ext → `image`, `file://` + video ext → `video_file`
  (uploaded local footage, ingested via `ingest_video` at its ORIGINAL
  resolution — no `max_res` cap), everything else is a video link
  validated as a YouTube id. File jobs' `video_id` is just a display
  label; stored rows are content-addressed — `"img:<sha256[:16]>"` for
  images, `"upload:<sha256[:16]>"` for uploaded videos — which is what
  lets `ingest_video` skip re-tagging identical footage (the skip only
  arms when a `video_id` is passed explicitly; bare `ingest_video` calls
  keep the old always-ingest behavior).
- **Channels and niches are lookup tables** (`channels`/`niches`: display
  name + UNIQUE normalized_name — trimmed/lowercased/whitespace+hyphens
  stripped). Segments carry **ids, not strings**: `channel_id` is a real FK;
  `niches` is `text[]` of niche ids (Postgres can't FK array elements) so
  the `&&` any-of filter works. Names are resolved get-or-create at the API
  boundary (`POST /jobs`) and in `ingest.py`.
- **Search filters are WHERE clauses in the pgvector query** (tags/niches
  overlap, durations, created_at range, source_channel_id, media_type) —
  never post-filtering in Python. The clause builders are shared so backends
  can't drift: `VectorIndex._filter_clauses` (SQL) and
  `MemoryVectorIndex._passes_filters` (predicate) feed both `search()` and
  the no-query `list_segments()` browse path.
- **The ingest queue is serial on purpose** (`broll/jobs.py`): one download
  at a time through the proxy; parallel yt-dlp traffic is the classic bot
  signature. Per-job retry up to `BROLL_JOB_MAX_ATTEMPTS`.
- **Proxy is fail-loud** (`discover.ytdlp_network_opts`,
  `_requests_proxies(require=True)`): every network touchpoint (yt-dlp,
  Data API, storyboard sprites, stock APIs, thumbnails) passes
  `YTDLP_PROXY` explicitly and raises when it's unset. `direct` is the
  explicit opt-out. Never add a silent no-proxy fallback.
- **Cookies are strictly opt-in and throwaway-only**
  (`BROLL_COOKIES_FILE` > `BROLL_COOKIES_BROWSER`, both default empty).
  Never suggest the user's real browser profile or personal accounts.
- **`source_channel_id`/`source_channel_name`** = the YouTube uploader
  (provenance). **`channel_id`** = OUR namespacing. Don't conflate.
- **DB migrations are additive** (`ALTER ... ADD COLUMN IF NOT EXISTS` in
  `_SCHEMA_SQL`); superseded columns (`niche`, `used_in_projects`) linger
  in old DBs, unreferenced. One-time data rewrites get a script
  (`migrate_lookups.py`, idempotent).

## Frontend (Streamlit, internal tool for 2 people)

`broll_ui.py` (Upload & Queue) + `pages/1_Gallery.py` +
`pages/2_Settings.py` (profiles), shared singletons in `ui_common.py`.
Decisions:

- The UI **imports the backend directly** (no HTTP hop) and its process
  hosts the same serial ingest worker `api.py` runs —
  `ui_common._queue()` is an `st.cache_resource` singleton that starts
  the worker thread once; engines are per-profile via the
  `broll.profiles.engine_for` cache (`ui_common.backend(profile)`).
  Running UI and API simultaneously is safe only because jobs are claimed
  with `SKIP LOCKED`; don't change one without the other.
- The active profile is a sidebar selectbox (`ui_common.profile_selector`)
  persisted in `st.session_state["profile"]` so it follows the user
  across pages. The Settings page edits profiles.toml only — it never
  touches databases or files, and shows "default" read-only (it mirrors
  .env).
- The HTTP API (`api.py`) must stay at feature parity with what the UI
  calls — that's the contract a future React frontend builds against.
  When the UI needs a new read (e.g. `list_source_channels`,
  `list_segments`), add it to BOTH index backends AND as an endpoint,
  never as UI-side SQL.
- Gallery filtering is server-side through the same filter kwargs as
  `/search`; the queue view polls via `@st.fragment(run_every=...)`, not
  full-page reruns. Function over polish: default dark theme
  (`.streamlit/config.toml`), no custom CSS.

## What not to break

- **`broll/pipeline.py` method signatures are the contract** the video
  engine reads through: `library_search`, `search_or_acquire`, `acquire`,
  `ingest_url`, `ingest_video`, `ingest_image`, `ingest_image_url`,
  `mark_used`, and the `VectorIndex` / `ObjectStore` / `GLMClient`
  interfaces. Extend with keyword args; don't rename/reorder.
- **`MemoryVectorIndex` must stay at parity** with `VectorIndex` (same
  methods, same filter semantics) — it's the no-Postgres test double.
- **The embed_dim mismatch check** in `VectorIndex.__init__` and the
  same-media_type constraint in `find_near_duplicate` (both backends).
- The **frame-sampling fallback** path in `fine_tag_video` (see above).
- **ffmpeg (not OpenCV) for frame grabs** (`pipeline.grab_mid_frame`):
  stream-copied cuts start mid-GOP, where cv2's ratio-seek silently returns
  nothing — phash was broken for weeks this way. cv2 is gone; keep it gone.
- Stream-copy cutting (`cut_clip`, `-c copy`) is fast but keyframe-snapped;
  frame-accurate re-encode is a known future upgrade, not a bug.
- Vertical Shorts: `height<=N` format filters match NOTHING on 1080x1920
  video. Resolution capping must use `format_sort: res:N` (shorter side).

## Tunables

All env vars, all documented with defaults in `.env.example` (which is the
source of truth). Groups: `BROLL_*` (library/download/dedup/jobs policy),
`GLM_*` (endpoint, chunking, refinement, gap-fill, pacing). Secrets live in
`.env` (git-ignored); `broll/__init__.py` loads dotenv before submodule
imports.

## Verify commands

```bash
# mocked end-to-end flows (upload, scoping, usage, ranking, profiles,
# images) on broll_test — self-generates its test video/image; the
# two-profile isolation test uses schemas on broll_test because the broll
# role can't CREATE DATABASE
BROLL_DATABASE_URL=postgresql://broll:broll@localhost:5432/broll_test \
BROLL_EMBED_DIM=8 .venv/bin/python test_flows.py

# proxy sanity (must pass before any real ingest)
.venv/bin/python check_proxy.py

# UI (also hosts the worker)
.venv/bin/streamlit run broll_ui.py           # http://localhost:8501

# API + worker
.venv/bin/uvicorn api:app --host 127.0.0.1 --port 8321

# real single-video ingest (costs GLM calls + one proxied download)
.venv/bin/python ingest.py "https://youtu.be/<id>" --niches test

# browse the library
.venv/bin/python gallery.py   # -> /tmp/broll_clips/index.html
```

There is no pytest suite yet; `test_flows.py` plus targeted inline scripts
(see git history for patterns: stub `GLMClient.complete`, monkeypatch
`pipeline.embed_text`/`fine_tag_video`/`tag_image` — the fakes must accept
the `model=` kwarg `embed_text` now takes) are how changes get verified.
Point `BROLL_PROFILES_FILE` at a throwaway path in any test touching
profiles so the user's real profiles.toml is never read or clobbered. UI
changes are smoke-tested with `streamlit.testing.v1.AppTest`
(`AppTest.from_file("broll_ui.py")`, `at.switch_page("pages/1_Gallery.py")`)
against `broll_test` with a patched `embed_text`. API changes with
`fastapi.testclient.TestClient(create_app(start_worker=False))`.
Production DB is `broll`; NEVER run tests against it — use `broll_test`
with `BROLL_EMBED_DIM=8`. Note the UI worker is live even in AppTest runs:
clean the `jobs` table after tests that enqueue.
