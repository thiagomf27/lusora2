# Throughput — a 20-minute video in ~1.5 hours instead of ~5

The target is 5 hours of finished video a day plus about an hour of tests,
made of **20-minute videos** (the hour-long ones will run a simpler pipeline
and are out of scope here). That is ~15 videos a day. Today one of them takes
about five hours, and most of that time is spent *waiting*, not computing.

**The rule everything here follows: a stage that waits on the network must
not wait on it one thing at a time, and the stage that burns CPU (render) is
the only one allowed to decide how big the machine is.**

Nothing in this plan changes what a video looks or sounds like, except slice 5,
which changes how narration is requested and so may change its prosody — for
the better, and it is the one slice that needs a decision entry and a listen.

---

## Where the time goes today

`vid_39f574974bda` is the one clean `faceless_v3` run: 254 s of video,
53 beats, 52 visual items. Stage times below are inferred from artifact
mtimes (the log has no timestamps — slice 0 fixes that), then scaled 4.7× to a
20-minute video (~245 shots, ~250 sentences).

| stage | measured (254 s) | 20 min, today | 20 min, after this plan | bounded by |
|---|---|---|---|---|
| script + plan_beats | 34 s + 69 s | ~7 min | ~7 min | API latency (planner chunks stay sequential on purpose — they carry context) |
| **narration** | 913 s | **~72 min** | ~5–10 min | API latency, one sentence at a time |
| **select_overlays** | 15–167 s | ~2–8 min | ~1 min | API latency, chunks run in series |
| **resolve_assets** | ~2,090 s | **~2.7 h** | ~10 min (library-heavy) – 20 min (stock-heavy) | downloads + CPU transcode, one item at a time |
| **render** | ~715 s | ~56 min | ~56 min on laptop-class CPU | **CPU** — not addressed here |
| **total** | | **~5 h** | **~1.5 h** | |

After this plan render is ~60% of a video's wall time and the only CPU-bound
part — which is what makes it, and only it, the input to VPS sizing (OQ-21).

### What the code does today (the causes)

- **narration** — [tts.py `_ai33`](../../worker/lusora_worker/providers/tts.py)
  submits one sentence, polls it until done (backoff 2 s → 10 s), downloads it,
  then starts the next. ~17 s per sentence, almost all of it queue wait. Parts
  live in a `tempfile` dir that is deleted on failure, so a crash at sentence
  240 pays for all 250 again. Per-sentence was chosen because each sentence's
  audio length IS its timing (`tts_timings.json` → subtitles, `cut_beats`,
  D49 ducking) — a property inherited from the flite adapter, not something
  ai33 requires. It also costs prosody: ElevenLabs starts every sentence cold.
- **resolve_assets** — [steps.py `run_resolve_assets`](../../worker/lusora_worker/pipeline/steps.py)
  walks the visual items serially. For stock,
  [sources.py `PexelsAdapter`](../../worker/lusora_worker/providers/sources.py)
  sorts the video's files **widest first** and downloads that one (usually
  4K, the whole clip), then `normalize_video` re-encodes it to 1080p with
  libx264. A candidate later rejected is a wasted 4K download + transcode.
  The library adapter additionally looks up the channel id (and niche ids)
  over HTTP **on every item** — ~245 redundant calls per video.
- **select_overlays** — [overlay.py `select_overlays`](../../worker/lusora_worker/agents/overlay.py)
  runs its ~30-beat chunks in a `for` loop. The chunks are independent — each
  is held to its own `share` of the budget and the merge is re-validated as a
  whole — so there is no reason for them to wait on each other.

### The similarity check is not part of the problem

`perceptual_hash` is a 64-bit dHash of one frame 1 s in; `Ledger.too_similar`
rejects a clip within `min_hamming_distance` bits of one already on screen.
One ffmpeg call per candidate — cheap. It is **off** in every real channel
(`source_policy.visual.dedup` unset; only the fixture sets 6), exact-id reuse
is already blocked by the ledger and by the library's per-project block, and
the library dedups near-copies at ingest. It stays as it is. If a channel ever
turns it on, hash Pexels' preview `image` from the search response instead of
the downloaded clip, so a rejection costs a thumbnail (deferred, see end).

---

## Two settled points before slicing

**Parallelism is deployment config, not channel config.** How many requests
run at once depends on the machine and the provider's rate limits, not on
what a channel's videos should look like — the same reasoning that made
`REMOTION_CONCURRENCY` an env var. So every knob here is an env var with a
safe default, read in `config.py`, never snapshotted into `cfg.json`, and a
video re-run with different parallelism produces the same artifacts
(Principle 7 holds because parallelism never changes the OUTPUT, only when it
arrives). Record as a decision entry with slice 1.

**Parallel work commits in plan order.** Anything order-dependent — the reuse
ledger, the plan checkpoint, `mark_used`, budget accounting — is done by one
thread walking items in their original order. Workers only fetch. This is
what keeps a parallel run byte-identical to a serial one given the same
provider answers, and what makes every test below a comparison against the
serial path.

Thread safety to respect throughout: `Db` holds ONE autocommit psycopg3
connection (psycopg serialises calls on it, so sharing is correct but not
concurrent — fine for event rows). `budget_gate` reads spend-so-far and then
writes; two threads can both pass a check that together exceed the budget, so
gated calls in a parallel section take a per-video lock around the gate.

---

## Slice 0 — measure (no behaviour change) — DONE

Every later slice claims a speed-up; this is what lets it be checked.

- Every `production.log` line is prefixed with a local ISO timestamp
  (`StageContext.log`); the orchestrator writes `stage <name> done in <s>s`
  (or `failed after <s>s`), and the stage's `done` event carries
  `took <s>s` for the UI.
- `uv run python -m lusora_worker.stage_times <video_id|folder> [--all]`
  (from `worker/`) prints the per-stage table of the last run — or every run
  with `--all`. It reads the **log, not `video_events`**: the folder is the
  data plane of record, so it works with the database down or on a copied
  folder. Logs written before this slice report "no timed stages" rather
  than a guess.

Tests: `tests/test_stage_times.py`.

## Slice 1 — Pexels picks the right file — DONE

Measured on the 1,158 videos in `data/stock-cache/`: widest-first took a
rendition above 1080 for 61% of them (677 at 2160); `pick_video_file` takes
exactly 1080 for 1,141 and 720–988 for the other 17, none above. Average
download **47.6 MB → 16.8 MB (2.8× less)**, and the 1080→transcode step no
longer runs for any of them.

Rule, on the file's SHORT side (so portrait works the same):

1. a variant exactly at the target (`cfg.output.height`, 1080) → take it;
2. else the largest variant in [720, target) → take it, no transcode;
3. else the smallest variant above target → take it, `normalize_video` scales it;
4. else (only < 720 exists) → the largest one available.

`normalize_video` stays as the safety net for case 3 and for files whose
listed size lies. No new config — the rule reads `cfg.output`.

**Tests** (`test_sources.py`): fixture `video_files` lists covering each of the
four branches plus portrait; assert the chosen link. **Exit:** on a cached
search the downloaded bytes per stock item drop to the 1080 variant's size and
`normalize_video` no longer spawns ffmpeg for it.

## Slice 2 — library lookups once per stage — DONE

`/channels` and `/niches` rows are cached on the adapter for one
`resolve_assets` run: `sources.begin_run()` clears every adapter's memo at
stage entry, and the cache also drops itself when the video id changes. A
failed fetch is not cached. Fail-closed scoping is unchanged: a cached miss is
still a miss.

**Tests:** a stub library counting requests — N items → 1 channel lookup.

## Slice 3 — overlay chunks in parallel — DONE

Built as below, plus a budget-gate bug that parallelism would have turned
live: `release_reservation` refunded EVERY open reservation for the
provider+operation, so the first part to finish refunded the others' while
they were still spending. `cost_event` now returns its row id and the gate
releases only its own reservation (`event_id=`); the read-then-reserve step
runs under a process lock. `config.parallelism(name, default)` is the one
reader for every `*_PARALLELISM` env var. Two existing tests asserted call
ORDER across parts and now assert the set.

`select_overlays` submits `_select_chunk` calls to a `ThreadPoolExecutor`
(`OVERLAY_PARALLELISM`, default 4) and merges results **in chunk order**, so
`overlays.json` is identical to the serial run. Each chunk's repair loop stays
inside its own call. The final whole-video validation is unchanged. The
budget gate inside `_select_chunk` takes the per-video lock (above).

**Tests** (`test_overlay_agent.py`): a `chat_fn` that answers chunks out of
order with random delays → same document as serial; a chunk that raises fails
the stage with that chunk's reason. **Exit:** on a multi-chunk case wall time
≈ the slowest chunk, not the sum.

## Slice 4 — resolve_assets fetches in parallel, commits in order — DONE

Built as below, with two differences from the sketch. There is no
`clips/.staging/`: a fetch already writes to `clips/<item id>.*`, a path no
other item can claim, and a result that loses a conflict is deleted before
the re-fetch. And each fetch snapshots the ledger when it STARTS, not when the
stage starts, so later items see what earlier ones committed and conflicts
stay rare. `sources.resolve_item` is now `find_item` (search + download,
writes nothing else) + `commit` (item, `asset_usage`, ledger, and the
library's `mark_used`, which travels on the resolution as `_on_commit`).

Found on the way, and worth more than expected: `Ledger.remember` computed a
perceptual hash — one or two ffmpeg runs, ~0.17 s — for EVERY placed shot,
even with the similarity check off. ~40 s of a 245-shot video, for a hash
nothing read. It now hashes only when `min_hamming_distance` is set.

Tests: `tests/test_resolve_parallel.py`.

The sketch, for the record:

1. **Fetch (parallel, `ASSET_PARALLELISM`, default 4).** For each unresolved
   item, run the source chain against a *snapshot* of the ledger, downloading
   into `clips/.staging/<item_id>.*`. Returns a `Resolution` or a miss. No
   ledger writes, no `mark_used`, no plan writes.
2. **Commit (one thread, plan order).** For each item in order: if its fetched
   asset is now blocked by the live ledger (another item committed the same
   id first — the rare case, mostly two adjacent beats asking the library the
   same thing), re-resolve it **serially** against the live ledger. Otherwise
   move the file from staging into `clips/`, `remember` it, call `mark_used`
   (moved here from inside the library adapter, so a loser never marks), and
   checkpoint `edit_plan.json` exactly as today.
3. **Degrade and chain-exhausted handling** (`degrade.to_identity_card`, the
   error when nothing resolves) run in the commit pass, unchanged.
4. **Per-provider concurrency caps**, because rate limits are per provider:
   `PEXELS_CONCURRENCY` (default 2) inside the pool. Pexels' default quota is
   ~200 requests/hour (verify on the account) — 245 items × 1–3 queries is
   over that for one stock-heavy video, which is why the search cache and a
   library-first chain matter more than the thread count.
5. **Resume:** items with an `asset.path` are skipped as today; `.staging/`
   is wiped at stage start.

**Tests** (`test_sources.py` / a new `test_resolve_parallel.py`): stub adapters
with random latency — parallel plan == serial plan; two items whose top hit is
the same segment → the second commits its next candidate and `mark_used` is
called once per committed segment; kill mid-commit and resume → no refetch of
committed items.

**Exit:** on a 50-item mock/cached run, stage time ÷ ~ASSET_PARALLELISM.

## Slice 5 — narration: fewer, parallel, resumable requests

Downstream must not notice: `tts_timings.json` keeps its exact shape (one item
per sentence, `start_s`/`end_s`/`text`), so `transcript`, `cut_beats` and
ducking are untouched. That is the invariant every sub-slice is tested against.

**5a and 5b — DONE.** Parts live in `<video>/tts_parts/`, each named
`NNNN-<sha1(voice, sentence)>.mp3`, so a resume reuses only audio of THIS
sentence in THIS voice — an edited script or a new voice re-synthesizes. A part
is written to `.part` and renamed, so an existing file is a whole one. The
budget gate bills the characters synthesized in this run, not the whole
script. Tests: `tests/test_tts.py` (real ffmpeg-made parts, so durations and
order are measured, not asserted from a stub).

- **5a — resumable parts (no API question).** Parts go to
  `<video>/tts_parts/NNNN.mp3` + a small manifest instead of a tempdir, so a
  crash resumes at the first missing part and paid-for audio is never
  re-bought. Deleted after `audio.mp3` is written.
- **5b — per-sentence, in parallel.** `TTS_PARALLELISM` (default 6):
  submit/poll/download sentences concurrently, concat in order. Timings are
  exact exactly as today. This alone takes narration from ~72 to ~12 min.
  Keeps the cold-start prosody.
- **5c — probe (needs spend approval, a few cents).** One ai33 request with
  `with_transcript=true` on a two-paragraph text. Record in this file what it
  returns (word/char timestamps? format? per-request char cap for the
  elevenlabs backend?). The docs page is behind login, so this is the only
  way to know.
  **5c — DONE (2026-09-23).** `with_transcript=true` works on the
  elevenlabs backend (`eleven_multilingual_v2`). The finished task's
  `metadata` carries `audio_url`, `srt_url` and `json_url`; the JSON is a
  one-element list with `words[]` — `{text, start, end, type: word|spacing}`
  per token, seconds, plus `audio_duration_secs`. It is a TRANSCRIPTION of
  the generated audio (it wrote "American century" for "American Century"),
  so words are matched back to the script, not trusted as the script. The
  transcript cost 151 credits on a 900-char request (1,159 total; the same
  text per-sentence cost 976). The CDN refuses urllib's user agent (403);
  httpx is fine. On that text a difflib match of script words to heard words
  placed all 153 words and every sentence start — so 5d needs no Whisper.
  Side-by-side test renders: `data/tts-comparison/` (A per-sentence, B one
  request; A 61.8 s, B 59.7 s, pauses 11.4 s vs 10.6 s over 26 vs 24 gaps).

  **5d — BUILT, awaiting a listen (D93).** Paragraph requests WITHOUT
  `with_transcript` (the transcript is ~13% more credits); timings from
  `align.py`: local Whisper `base` (no initial_prompt — it made a 60 s chunk
  take 43 s instead of 8) tells which pause each sentence starts at, and the
  pause gives the exact time. Measured against the provider's word stamps:
  every sentence start ≤ 78 ms (median 21 ms); words ~120 ms vs ~300 ms for
  the old even spread. Each sentence in `tts_timings.json` carries `words`;
  the compiler's `_word_timeline` takes them one-for-one, and a
  `word`-granularity transcript is built from them with no Whisper pass.
  Approval run: the whole 3,644-char script of `vid_39f574974bda`, 2 chunks
  (49 + 38 sentences), 87 sentences / 608 words placed, none estimated, 59.8 s
  for synthesis + alignment of 246.6 s of audio, 4,073 credits.
  `data/tts-comparison/C-*` (sentence captions) and `D-*` (karaoke word
  highlight). Word cues now show the words as written ("forty-five", not
  "forty five"): each aligned token keeps the written word it came from, and
  `align.written_words()` joins them back.

  **Speed test (2026-09-23).** Same 900-char text, alignment vs the
  provider's word stamps (bought for the test only):

  | voice | words/min | sentence starts max / median | words median (p90) |
  |---|---|---|---|
  | River 0.7x | 119 | 99 / 26 ms | 160 (280) ms |
  | Roger 1.0x | 155 | 78 / 21 ms | 120 (220) ms |
  | River 1.0x | 167 | 81 / 21 ms | 100 (200) ms |
  | Liam 1.0x | 166 | 74 / 24 ms | 100 (200) ms |
  | Liam 1.2x | 196 | 90 / 14 ms | 100 (180) ms |

  0.7x first put one sentence 980 ms off: Whisper folds a pause INTO the
  next word ("The" heard as lasting 1.04 s), and the real pause ended outside
  the 0.8 s window. A pause that ends inside the first word's own span is now
  taken first, and any word containing a pause end starts at it. The word
  residue is almost all a constant offset — ours 100-160 ms EARLIER than the
  provider's, ±40-60 ms around it — two recognisers disagreeing about where
  an onset is, not drift; left uncorrected without true ground truth.
  Renders: `data/tts-comparison/E-*`, `F-*`, `G-*` (current word highlighted).

  The original sketch:

- **5d — paragraph chunks.** Split the script into chunks of whole sentences
  up to `TTS_CHUNK_CHARS` (default ~2,500 — not the 1M limit: one failure at
  minute 19 should cost one chunk, and long generations drift). Submit chunks
  in parallel. Each chunk's start is known exactly from the concat, so
  timing is only ever *inside* one chunk:
  - if 5c showed timestamps → map them onto the chunk's sentences;
  - else → faster-whisper with `word_timestamps=True` on the chunk (already a
    dependency, CPU, ~a minute per 20 minutes of audio), aligned to the KNOWN
    sentence text in order — alignment, not transcription.
  A sentence whose boundary cannot be placed falls back to proportional-by-
  characters inside its chunk and logs a warning, never fails the video.
  Whether a channel uses `sentence` or `paragraph` requests is a creative
  choice (it changes the delivery), so it is a channel field —
  `voice.request_unit`, default `sentence` so existing snapshots re-run
  identically — with a decision entry.

**Tests** (`test_tts.py`): stub ai33 with random latency and 429s — parallel
output == serial; kill after k parts → resume requests only the rest;
paragraph mode on a fixture with known word timings → per-sentence timings
within 50 ms. **Exit (5d):** listen to one real 20-minute narration in
paragraph mode against the same script per-sentence, and keep the default at
`sentence` unless paragraph is clearly better.

## Slice 6 — two workers, one render at a time

After slices 1–5 a video spends most of its non-render time waiting, and one
worker waits with the CPU idle. The claim is already `FOR UPDATE SKIP LOCKED`
([db.py](../../worker/lusora_worker/db.py)), so two workers never take the same
video. What is missing is a cap on concurrent renders — two Remotion renders
at once would double RAM on a machine sized for one:

- `run_render` takes a Postgres advisory lock from a pool of `RENDER_SLOTS`
  (default 1) before calling the engine, and releases it after. A worker
  waiting for a slot emits a `progress` event ("waiting for a render slot") so
  the UI does not look stuck, and keeps heartbeating so orphan re-queue (60 s)
  does not fire on a waiting worker.
- compose gets `worker` scaled to 2 (`deploy.replicas` or two services with
  distinct `WORKER_ID`).

**Tests:** two in-process workers against the test DB, one slot → renders
never overlap; a waiting worker's video is not re-queued.

---

## Order and what each costs

| slice | spend | depends on | gain on a 20-min video |
|---|---|---|---|
| 0 measure | $0 | — | makes the rest checkable |
| 1 Pexels variant | $0 | — | large, on stock-heavy videos |
| 2 lookup cache | $0 | — | small (~245 HTTP calls) |
| 3 overlays parallel | $0 | — | ~2–8 min → ~1 min |
| 4 assets parallel | $0 | 1, 2 | ~2.7 h → ~10–20 min (with 1) |
| 5a/5b narration | $0 | — | ~72 → ~12 min |
| 5c probe | cents, **ask first** | — | decides 5d's timing source |
| 5d paragraphs | one real 20-min narration, **ask first** | 5a, 5c | ~12 → ~5 min, better prosody |
| 6 workers | $0 | 0 | overlaps waiting with render |

Then one real 20-minute video end to end (needs approval: script + TTS +
planner) — its slice-0 table replaces the estimates at the top of this file
and is the render number OQ-21 has been waiting for.

## Deferred on purpose

- **Chunked, checkpointed render** — the next plan; it is what render needs
  and it is an engine change, not a worker one.
- **Script in sections** — a 20-minute script is ~3,000 words, inside the
  8,000-token default; it becomes necessary for the hour-long pipeline.
- **Trim before transcode** — `in_offset_s` and `loop` mean the needed span is
  not always the head of the file; after slice 1 almost nothing transcodes,
  so it is not worth the care yet.
- **Similarity from preview images** — only if a channel turns
  `min_hamming_distance` on.
- **Library supply.** A library-heavy video resolves in 1–3 s a shot against
  30–60 s for stock, so shifting the chain toward the library is the largest
  gain available — but 15 videos a day consume ~3,700 shots, and ingest is
  serial through a proxy and tagged per clip. Growing the library is an
  ingest-throughput problem, planned on its own.
