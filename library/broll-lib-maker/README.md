# B-roll segment library

Ingest videos → a vision model tags every usable shot → shots are cut into
clips and indexed → you search the library by meaning ("lion sleeping",
"amish farm horses") and get ranked, ready-to-use b-roll in milliseconds.
Still images ingest too: one image = one tagged, searchable library entry.

The expensive work (download + AI tagging) happens **once per video**; every
search after that is served from the library.

## Architecture in one minute

Three storage layers, kept strictly separate:

| Layer | Holds | Where |
|---|---|---|
| Vector index | embeddings, tags, timestamps, usage counters, POINTERS to bytes | Postgres + pgvector (`segments` table) |
| Object storage | the cut clip bytes + thumbnails, nothing else | local dir `/tmp/broll_clips` (`ObjectStore` — swap `put`/`uri_for` for Drive/S3 later) |
| Source videos | **deleted** after tagging | nowhere (see gotchas) |

Two paths through the code (`broll/pipeline.py` orchestrates):

- **Hot path** — `library_search()`: pgvector similarity + usage-aware
  ranking. No model calls, no downloads. This is what the gallery hits.
- **Cold path** — `acquire()` (search-driven discovery) or `ingest_url()`
  (you provide the link): download at capped resolution → exhaustive
  GLM fine pass (chunked for long videos) → cut every segment → dedup →
  store clips + rows → delete the source.

- **Image path** — `ingest_image()` / `ingest_image_url()`: an image skips
  all the video machinery (no download-resolution logic, no clipping, no
  chunking) — one GLM image call tags it, and it lands in the same
  `segments` table as a single entry with `media_type="image"` (clips are
  `"video_clip"`). Same dedup: re-uploading a near-identical image links to
  the canonical instead of storing bytes again.

A FastAPI app (`api.py`) exposes both to the frontend, with a serial job
queue for ingests (`broll/jobs.py`).

## Gallery profiles

A **profile** is a named, self-contained gallery: its own Postgres database,
its own storage root, and its own embedding model/dimension. Embeddings from
different models are incompatible, so a gallery is only searchable with the
model that built it — opening a database with the wrong `embed_dim` fails
loudly instead of returning garbage.

- The **default** profile always mirrors the env vars (`BROLL_DATABASE_URL`,
  `BROLL_STORAGE_ROOT`, `BROLL_EMBED_MODEL`, `BROLL_EMBED_DIM`) — existing
  setups keep working with zero config.
- Named profiles live in `~/.config/broll/profiles.toml` (override the path
  with `BROLL_PROFILES_FILE`) and are managed on the UI **Settings** page —
  create one, point it at an empty database, and the schema is created on
  first connect.
- Every API endpoint takes `?profile=<name>` (default `default`); the
  Upload and Gallery pages have a sidebar profile selector; `ingest.py`
  takes `--profile`.
- Ingest jobs record their profile. There is still ONE serial worker for
  every profile — one download at a time is a global rule, not per-profile.

## Setup checklist

### 1. System packages

```bash
sudo apt install ffmpeg                 # cutting, thumbnails, chunk encoding
sudo bash setup_postgres.sh             # postgres + pgvector; creates dbs
                                        # broll + broll_test (user broll/broll)
```

### 2. Python

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

Developed on Python 3.12. The first search downloads the MiniLM embedding
model (~90 MB, one time).

### 3. Configure `.env`

`cp .env.example .env`, then fill it in. Every variable, what it's for,
where to get it:

| Variable | Required | What / where to get it |
|---|---|---|
| `ZAI_API_KEY` | **yes** | Z.ai API key for GLM-4.6V-Flash (vision tagging). https://z.ai → API keys. (`GLM_API_KEY` also accepted.) |
| `YOUTUBE_API_KEY` | **yes** | YouTube Data API v3 key for discovery — steps below. |
| `YTDLP_PROXY` | **yes** | Proxy for ALL YouTube/stock traffic, e.g. `socks5://user:pass@host:port`. Nothing downloads without it (see gotchas). Literal `direct` deliberately allows your real IP. |
| `BROLL_COOKIES_FILE` | recommended | Netscape `cookies.txt` exported from a **throwaway** YouTube account — steps below. Avoids "confirm you're not a bot" walls. |
| `BROLL_COOKIES_BROWSER` | alternative | Live browser profile instead of a file: `chrome` or `chrome:Profile 2`. The file takes precedence. Leave both unset = fully anonymous. |
| `BROLL_DATABASE_URL` | no | Postgres DSN; default `postgresql://broll:broll@localhost:5432/broll` (matches `setup_postgres.sh`). `DATABASE_URL` also read. |
| `GLM_BASE_URL` / `GLM_MODEL` | no | Default `https://api.z.ai/api/paas/v4` / `GLM-4.6V-Flash`. Point at a local vLLM to self-host. |
| `PEXELS_API_KEY` / `PIXABAY_API_KEY` | no | Optional stock-video discovery sources; skipped when unset. |
| `BROLL_MAX_RES` | no (480) | Download resolution cap, applied to the *shorter* video dimension. Permanent per video — see gotchas. Jobs can override per ingest (`max_res`). |
| `BROLL_MIN_CLIP_S` | no (4) | Segments shorter than this are never stored. Deliberately no max — length is a search-time filter. |
| `BROLL_MIN_DURATION_S` / `BROLL_MAX_DURATION_S` | no (240/900) | Discovery-only duration window; ≥240 also makes the YouTube search itself exclude Shorts. Direct `ingest.py` links are never filtered. |
| `BROLL_DEDUP_SIM` | no (0.93) | Cosine similarity above which a new segment is linked as a near-duplicate instead of stored. |
| `BROLL_JOB_MAX_ATTEMPTS` | no (2) | Ingest-job retries before a job is parked as failed. |
| `BROLL_STORAGE_ROOT` | no (`/tmp/broll_clips`) | Where the default profile's clip/thumbnail bytes live (the `ObjectStore` root). |
| `BROLL_EMBED_MODEL` / `BROLL_EMBED_DIM` | no (`all-MiniLM-L6-v2` / 384) | The default profile's embedding model and its output dimension; change both together. A dim mismatch against an existing database fails loudly. |
| `BROLL_PROFILES_FILE` | no (`~/.config/broll/profiles.toml`) | Where named gallery profiles are stored (see "Gallery profiles"). |
| `BROLL_UPLOAD_SPOOL` | no (`/tmp/broll_uploads`) | Where uploaded files (images/videos) are spooled until the worker ingests them. |
| `GLM_CHUNK_S` / `GLM_CHUNK_OVERLAP_S` | no (240/12) | Fine-pass chunking for long videos. |
| `GLM_REFINE_TRIGGER_S` | no (18) | Segments longer than this get one refinement re-tag (split a lazy blob, or confirm a real long take). |
| `GLM_GAPFILL_MIN_S` | no (45) | Unreported stretches longer than this get one re-tag call; 0 disables. |
| `GLM_FINE_MAX_TOKENS` | no (12000) | Reply-token budget for the fine pass. |
| `GLM_MIN_INTERVAL_S` / `GLM_MAX_ATTEMPTS` | no (3/7) | Client pacing + retry budget against 429s. |
| `GLM_MAX_VIDEO_MB` | no (18) | Inline video upload cap; bigger files are shrunk to 360p/8fps first. |

#### Getting the YouTube API key (~3 minutes, free)

1. https://console.cloud.google.com → project picker → **New project**.
2. **APIs & Services → Library** → search "YouTube Data API v3" → **Enable**.
3. **APIs & Services → Credentials** → **Create credentials → API key** →
   copy the `AIza...` string into `.env`.
4. Optional hardening: edit the key → API restrictions → YouTube Data API v3.

Quota note: one discovery search costs 100 of the free 10k daily units. The
library exists precisely so most queries never reach the API.

#### Exporting cookies.txt (throwaway account + incognito)

1. Create a **fresh Google account** used for nothing else — accounts used
   for automated downloads risk bans (yt-dlp wiki), and a personal account
   identifies you regardless of the proxy. Create and use it **while
   connected through the same proxy**, so it is never associated with your
   home IP.
2. Open an **incognito/private window** (isolated session — your real
   accounts can't leak into the export) and sign into youtube.com as the
   throwaway.
3. On youtube.com, export with a "Get cookies.txt LOCALLY"-style extension.
4. Save the file **outside the repo** (e.g. `~/.config/broll/cookies.txt`),
   point `BROLL_COOKIES_FILE` at it, close the window.
5. Sessions go stale after weeks. If downloads start hitting auth walls,
   re-export the same way.

### 4. Verify the proxy — before anything downloads

```bash
.venv/bin/python check_proxy.py
```

Prints your home exit IP and the exit IP through `YTDLP_PROXY`, and fails
loudly unless the proxy is live and different. Don't skip this.

(No DB migration on a fresh install — tables are created on first connect.
`migrate_lookups.py` exists only for databases predating the channel/niche
lookup tables.)

## Running it

### The UI (easiest — no separate API process needed)

```bash
.venv/bin/streamlit run broll_ui.py       # http://localhost:8501
```

Three pages: **Upload & Queue** (paste links or upload local videos/images,
pick channel/niches/resolution, watch jobs progress live), **Gallery**
(search + server-side filters, play/download clips, view images) and
**Settings** (create/edit gallery profiles). The active profile is picked in
the sidebar. The Streamlit process hosts the ingest worker itself.
(Local uploads are capped at 2 GB per file — `server.maxUploadSize` in
`.streamlit/config.toml`.)

### Or the HTTP API + worker

```bash
.venv/bin/uvicorn api:app --host 127.0.0.1 --port 8321
```

A single worker thread processes the ingest queue serially — one download at
a time through the proxy, on purpose. (Running UI and API together is safe:
jobs are claimed with SKIP LOCKED, so each is processed exactly once.)

### Enqueue ingests

```bash
curl -X POST localhost:8321/jobs -H 'content-type: application/json' -d '{
  "urls": ["https://www.youtube.com/watch?v=iSOn7NXWTbk"],
  "channel": "My Cooking Channel",
  "niches": ["cooking", "kitchen b-roll"]
}'
```

`channel` / `niches` are display **names** — the backend get-or-creates
lookup rows (normalization ignores case/whitespace/hyphens) and stores their
ids on the segments. Omit `channel` for the global shared pool. Add
`?profile=<name>` to target a named gallery (this and every endpoint below
default to the `default` profile; `GET /profiles` lists them).

Direct **image URLs** (by file extension) queue as image jobs through the
same endpoint. Local **files** — images and videos — go to the multipart
endpoint:

```bash
curl -X POST 'localhost:8321/uploads?profile=default' \
  -F files=@shot.jpg -F files=@footage.mp4 \
  -F channel="My Cooking Channel" -F niches="cooking"
```

Uploaded videos get the same exhaustive shot tagging as links, cut at their
**original** resolution (no `max_res` cap), and are content-hashed so
re-uploading identical footage is skipped instead of re-tagged.

### Watch a job

```bash
curl localhost:8321/jobs                 # newest first; filter: ?status=queued
curl localhost:8321/jobs/<job_id>
```

`status` walks `queued → downloading → tagging → cutting → storing → done`
(or `failed` after retries), with `progress` 0–1, `error`, and
`segments_created`. A 12-minute documentary takes ~10–15 min to tag
(model-dependent) and yields 50+ clips.

### Search the library

```bash
curl 'localhost:8321/search?q=lion+sleeping&top_k=10'
curl 'localhost:8321/search?q=farm&max_duration=10&niches=<niche_id>'
```

Filters: `tags`, `niches` (ids, comma-separated, any-of), `channel_id`,
`source_channel_id` (the YouTube uploader), `media_type` (`video_clip` |
`image`), `min_duration`/`max_duration`, `created_after`/`created_before`
(epoch seconds), `include_global`.
`GET /segments` browses newest-first with the same filters, no query.
Dropdown options: `GET /channels`, `GET /niches`, `GET /source-channels`.
Bytes: `GET /clips/{segment_id}` (mp4, or the original image for
`media_type=image`), `GET /thumbs/{segment_id}` (jpeg).

### CLI equivalents (no API needed)

```bash
.venv/bin/python ingest.py "https://youtu.be/VIDEO" --channel "Name" \
    --niches a,b --profile default
.venv/bin/python gallery.py     # writes /tmp/broll_clips/index.html — open it
```

### Tests

```bash
BROLL_DATABASE_URL=postgresql://broll:broll@localhost:5432/broll_test \
BROLL_EMBED_DIM=8 .venv/bin/python test_flows.py
```

## Gotchas — read before your first ingest

- **The proxy is mandatory by design.** yt-dlp does NOT inherit system proxy
  settings; every network call (downloads, storyboards, Data API, stock
  APIs, thumbnails) gets `YTDLP_PROXY` passed explicitly and **fails loudly
  when it's unset** rather than silently leaking your home IP. `direct` is
  the explicit opt-out. Re-run `check_proxy.py` after any proxy change.
- **Cookies must be a youtube.com export from the throwaway.** An export
  from another site, a personal account, or a stale session degrades to
  bot-walls (or worse, identifies you). Never point the cookie vars at your
  real browser profile.
- **Sources are deleted after tagging — resolution choices are permanent.**
  Clips are cut from the `BROLL_MAX_RES` download, then the source is
  removed. Ingest at 480p and those clips are 480p forever; redoing them
  means purge + re-ingest. (Uploaded local videos are the exception: they
  are cut at whatever resolution you hand over — no cap.)
- **Re-ingesting requires a purge first.** `ingest_url` refuses videos
  already in the library (`--force` re-tags, but old rows/clips remain). To
  redo a video cleanly: delete its `segments` rows AND their clip/thumb
  files, and check nothing else `duplicate_of`-references the purged rows.
- **Model output varies wildly between runs.** GLM-4.6V-Flash sometimes
  returns empty or lazy replies for a whole chunk; the pipeline absorbs this
  (gap-fill, refinement, salvage, frame-sampling fallback) at the cost of
  extra calls and time. A slow ingest is usually the model having a bad day,
  not a bug.
- `/tmp/broll_clips` does not survive a reboot. Point `ObjectStore` at a
  real directory before building anything durable on it.
