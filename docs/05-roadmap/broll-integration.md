# Plugging broll-engine into the automation

> Written 2026-08-29. The plan for replacing the vendored
> `library/broll-lib-maker/` snapshot with the live `broll-engine` repo,
> and for closing the mismatches the swap exposes.
> Read [B-roll Library](../02-components/broll-library.md) first — the
> boundary it describes is still correct; what changed is that the code on
> both sides of it drifted.

## The situation

`library/broll-lib-maker/` is a **hand-copied snapshot** of broll-engine
(D24, one commit, `cbc5008`). Since then both sides moved, in **both
directions** — this is a fork, not a stale copy.

**broll-engine gained** (missing from the vendored copy): the review stage
(`status`, `POST /segments/approve`, `pages/3_Review.py`), uploads
(`broll/uploads.py`, `POST /uploads`, image batches as still clips), scene
detection + content-drift splitting, the frame-accurate fast cut
(`POST /segments/{id}/trim`, `ui_trim.py`), `purge.py`, multi-library
profiles, `PATCH`/`DELETE /segments`, `/sources`, `/licenses`,
`/last-ingest`, and the free-text-with-normalizer `license` model.

**The fork gained** (missing from broll-engine — lusora depends on these):

| Fork-only | Where lusora uses it |
|---|---|
| `POST /segments/{id}/mark_used` | `providers/sources.py:151` |
| `licenses` (CSV, any-of) on `/search` | `providers/sources.py:101` |
| `media_type` filter on `/search` | `providers/sources.py:107` |
| per-request `?profile=` (lazy engine-per-profile map, `_eng`) | `providers/sources.py:103` |
| `/profiles` (plural), `/source-channels` | — |

So the swap is not a file move. It is: **port the fork's four additions
upstream, then fix the six places where lusora's assumptions no longer
match what broll-engine returns.**

## Decisions taken (2026-08-29)

| # | Decision |
|---|---|
| **D71** | broll-engine enters as a **git submodule** at `library/broll-engine`, superseding the hand-vendored copy (amends D24). The "one clone, one CI" rationale survives; only the sync mechanism changes. A submodule cannot silently drift — edits must happen in broll-engine, which is what the current fork proves is needed. |
| **D72** | lusora **adopts broll-engine's licence vocabulary**, not the reverse (supersedes D33). |
| **D73** | The library runs with `BROLL_CUT_MODE=reencode` and `BROLL_MAX_RES=1080` for lusora. Both are permanent per clip. |
| **D74** | `/search` returns **raw similarity (`sim`) beside the ranked `score`**; `min_score` gates on `sim`. |
| **D75** | The **human review gate stays**. The worker only ever sees `status=approved` clips. The Review UI is rebuilt in the platform (M9) rather than sending operators to Streamlit. |
| **D76** | `source.profile` and `source.media_types` stay in `channel_config` as **inert fields** — no per-request `?profile=` is ported. One deployment = one library until a second one exists. The fork's `_eng` map is the reference implementation if that changes. |

---

## The mismatches, in severity order

### 1. `media_type` is gone from broll-engine — silent corruption (BLOCKER)

`providers/sources.py:138`:

```python
is_video = best.get("media_type") == "video_clip"
ext = "mp4" if is_video else "jpg"
```

broll-engine's `Segment` has **no `media_type` field at all** — it was
removed, and its CLAUDE.md lists the DB column as dead. `.get()` returns
`None`, so every library hit takes the image branch:

- MP4 bytes are written to `clips/<id>.jpg`
- `Resolution(media_type="image")` → the compiler attaches `ken_burns`
  motion (`sources.py:531`) to a video file
- `degrade.py:60` returns early (`media_type != "video"`), so the
  short-clip fallback never runs
- both renderers treat a clip as a still

**Fix:** delete the branch. In broll-engine *everything* is an mp4 —
an uploaded image becomes a `BROLL_IMAGE_CLIP_S` still clip, deliberately,
so that nothing downstream has to learn about a second media kind. Always
`.mp4`, always `media_type="video"`. Drop `params["media_type"]` too.

### 2. Licence vocabulary — the anti-copyright filter matches nothing

| lusora (`channel_config.schema.json:478`, D33) | broll-engine (`broll/schema.py:33`) |
|---|---|
| `cc0` `cc-by` `cc-by-sa` `unknown` | same |
| `owned` | **`own`** |
| `stock-licensed` | **`royalty-free`** / **`licensed`** |
| — | `cc-pd` `cc-by-nd` `cc-by-nc` **`restricted`** |

The filter is an exact string match (that is the entire point of
`normalize_license`). A channel configured `licenses: ["cc0", "owned"]`
gets **zero** hits on its own footage. And broll-engine has `restricted`
— "known NOT usable, kept so nobody re-ingests it" — a concept lusora
has no representation for.

**Fix (D72):** lusora adopts broll-engine's tokens. It is the richer
vocabulary, it has the normalizer, and it is the one with data behind it.
`restricted` is excluded from the schema enum entirely — a channel must
not be able to allow-list it.

### 3. `score` is a ranked score, not a similarity

`library_search` returns `rank_segments(...)` (`broll/pipeline.py:335`),
which folds in confidence (`±0.05`), per-channel overuse (`−0.06/use`),
recency (`−0.15` max), duration fit (`+0.08` max) — and **`−1.0` for a
clip already used in this project**.

lusora treats that number as a 0..1 similarity: `min_score` is
schema-bounded to 0..1 and `sources.py:132` gates on it with a `break`.

The failure is not cosmetic. On a **re-run** of a video — normal, since
`resolve_assets` checkpoints per item and orphaned `producing` rows are
re-queued — every already-marked clip carries the −1.0 block, sorts to
the bottom, and the top result falls under `min_score`. The `break` then
**abandons the whole library and falls through to stock.**

**Fix (D74):** `/search` returns `sim` (raw cosine) alongside `score`.
Order by `score`, gate on `sim`. Because the two no longer agree on
order, the walk must `continue` past sub-threshold hits rather than
`break` — bounded by `top_k`, which is what makes that safe.

### 4. Channel scoping fails open

`sources.py:113` passes lusora's `ctx.channel_id` as a **display name**
to be matched against the library's `channels` lookup table. Library
channels are created get-or-create only at `POST /jobs`. When nothing
matches, `lib_channel` is empty and both `channel_id` **and**
`include_global` are omitted — and broll-engine's `_passes_filters` only
scopes `if channel_id is not None`. The search then runs **unscoped over
every channel's private footage**.

**Fix:** fail closed. No resolved library channel ⇒ record
`provider_health("library", False, …)` and fall through to stock. The
real remedy is provisioning: Slice 5's ingest form is what creates the
library channel in the first place.

(Related, benign: `list_channels()` returns `{id, name, created_at}` with
no `normalized_name`, so the adapter's
`r.get("normalized_name") or r.get("name")` always takes the fallback. It
works only because the two normalizers happen to agree. Worth a comment.)

### 5. The platform's Library screen calls an API that never existed

`platform/src/app/(app)/library/page.tsx`:

- `:27` `GET /api/library/search?query=…&limit=24` — the params are **`q`**
  and **`top_k`** → 422
- `:45` `POST /api/library/ingest_url` — no such route; it is
  `POST /jobs` with `{urls: [...]}`
- its `Segment` interface reads `thumb_url` / `description`; the fields
  are `thumb_uri` / `caption`

This screen has never worked against either side. It is M9 work
("Library screens over the library API") that was stubbed and left.

Also: `api/library/[...path]/route.ts` exports GET/POST/PUT/DELETE — no
**PATCH**, so `PATCH /segments/{id}` (edit tags/caption) would 405.

### 6. Clip cutting: copy mode makes a clip's duration a lie

> **Corrected 2026-08-29.** This entry first claimed the ffmpeg renderer
> would show the previous shot, because it concatenates. That is wrong and
> was not checked before it was written. `renderSegment`
> (`engine/src/renderers/ffmpeg/render.ts:264`) decodes each library clip
> with a plain `-i`, and ffmpeg honours MP4 edit lists by default, so the
> extra head frames are dropped before anything is concatenated — and the
> concat at step 2 joins already-re-encoded `seg###.mp4` files, not library
> clips. Verified on a fixture: rendering a copy-mode clip whose hidden head
> frames are a different shot still produces the correct first frame. The
> recommendation below stands, but on different and weaker grounds.

`BROLL_CUT_MODE=copy` stream-copies, seeking to the keyframe at or before
the requested start, and hides the extra head frames behind an MP4 edit
list. Measured on a fixture with keyframes deliberately not aligned to the
shot change (a 6s cut at [10.5, 16.5] of a two-shot source):

| | packets in the file | first packet pts | `format=duration` | first frame, edit list ignored |
|---|---|---|---|---|
| `copy` | 8.07s worth | **-2.0** | **6.133** | the PREVIOUS shot |
| `reencode` | 6.0s worth | 0.0 | 6.000 | correct |

Nothing in lusora reads that file ignoring the edit list today. What does
bite is the fourth column: the row says `duration = 6.000` and ffprobe says
`6.133`. `degrade.py`'s short-clip fallback (D55) compares
`probe_seconds(file)` against the slot with a 0.05s tolerance, so a copy-mode
clip is systematically reported longer than the library believes it to be,
and the comparison that decides whether a slot needs a loop or a speed ramp
is made against a number the database contradicts.

Three things together decide it rather than any one of them:

1. the duration mismatch above — small, but it is exactly the input to the
   short-clip machinery
2. **the library is already mixed-mode**: `trim_segment` (the fast cut)
   ignores `BROLL_CUT_MODE` and always re-encodes, because a stream copy
   cannot do a frame-accurate head trim. Every clip a reviewer touches is
   already re-encoded
3. lusora has **three** consumers of these bytes — the ffmpeg renderer,
   Remotion's `OffthreadVideo`, and `@remotion/player` in the browser
   editor. Only the first was verified here. Frame-accurate bytes mean the
   other two never have to be

The cost is ~8x cutting time at ingest (offline, on a queue that is serial
by design) and one generation of loss at CRF 20. `reencode` costs ~8x cutting time
and one generation of loss, once, at ingest.

### 7. Clip resolution: 480p into a 1080p timeline, permanently

`BROLL_MAX_RES=480` (shorter side) against plans built at `1920x1080`
(`compiler/core.py:169`) — a 2.25x upscale. Sources are **deleted after
tagging**, so the resolution a clip is made at is irreversible. This is
the same class of decision as `embed_dim`: cheap now, a full re-ingest
later. Set it before the library grows.

### 8. Ranking is blind to the slot it is filling

`rank_segments(prefer_seconds=5.0)` is a hardcoded default, and
`library_search` never overrides it. But lusora knows the exact slot
length — `end_s - start_s` on the item being resolved. Passing it turns
the `+0.08 * duration_fit` term from noise into signal.

### 9. Port default drift

`worker/lusora_worker/config.py:49` defaults `LIBRARY_API_URL` to
`:8500`; the documented run (`docs/00-status.md:215`) uses `:8321`.

---

## Slices

Ordered so that nothing depends on work that comes later. Slices 1–2 are
**broll-engine** changes; 3–6 are **lusora**.

### Slice 0 — the swap ✅ BUILT

> Done 2026-08-29. Ran last rather than first: Slices 1–4 had to settle what
> the submodule is pinned TO. The pin is broll-engine `17cb0be`, on its
> `claude/lusora-automation-architecture-eh0hpk` branch — **re-pin to
> `master` once that merges**; an older commit does not serve this worker.

1. `git rm -r library/broll-lib-maker`; submodule added at
   `library/broll-engine`. Note broll-engine's default branch is `master`.
2. `.github/workflows/ci.yml`: `submodules: recursive` on both checkouts.
3. `deploy/library.Dockerfile` + the `library` service on port 8321, its own
   database in the shared Postgres (`deploy/postgres-init/`, which runs only
   on a fresh volume — an existing cluster needs `createdb broll` once), and
   a **named volume** for clips and staged uploads. Never a bind into `/tmp`:
   sources are deleted after tagging, so anything cleared on restart is
   footage gone with rows pointing at nothing.
4. `LIBRARY_API_URL` wired into both consumers; the `:8500`/`:8321` split
   (#9) resolved to 8321 everywhere.

**The boundary is now enforced, not just described.** `library/` used to be
a placeholder, so "no code imports across the boundary" (D11) was
unenforceable. With the package really on disk, `scripts/lint-boundaries.mjs`
fails the build on an `import broll` from the worker — verified by planting
one.

**No Streamlit service, deliberately.** The library's UI starts an ingest
worker unconditionally (`ui_common._ensure_worker`) and the API service
already runs one. Two workers on one queue is parallel yt-dlp traffic
through the proxy — the bot signature the serial queue exists to avoid.
`SKIP LOCKED` makes that correct, not unnoticeable. The compose file carries
the stop-then-run recipe instead; Slice 5 removes the need for it (D75).

~~**Known gap until Slice 5:** with only the API service running there is no
UI for approving clips.~~ **Closed** — `/library/review` in the platform now
does it, so the compose deployment needs no Streamlit at all.

### Slice 1 — port the fork's additions upstream (broll-engine) ✅ BUILT

> Done 2026-08-29, broll-engine `58501e0` on
> `claude/lusora-automation-architecture-eh0hpk`. All five suites green
> (`test_engine_api.py` is new and covers the four; `test_flows.py` ran
> against real Postgres + pgvector, which is what exercises the SQL half of
> the `licenses` filter).

On a branch in **broll-engine**, all four straight lifts or small:

1. **`POST /segments/{id}/mark_used`** — wrap the existing
   `engine.mark_used`; body `{project_id, channel_id}`; 404 on unknown id.
   Lift from the fork's `api.py:276`.
2. **`licenses` (CSV, any-of)** on `/search` and `/segments`, *alongside*
   the existing singular `license`. Add the clause to **both**
   `VectorIndex._filter_clauses` and `MemoryVectorIndex._passes_filters` —
   parity between those two is a stated invariant.
3. **`sim` in the response** (#3). `library_search` currently discards the
   cosine when it ranks; carry it through and add it to `_seg_json`.
   `score` keeps its meaning and stays the sort key.
4. **`prefer_seconds` query param** on `/search` (#8), passed into
   `rank_segments`.

Not ported: `?profile=`, `/profiles`, `/source-channels` (D76 — and
`/sources` supersedes the last one).

**Pulled forward from Slice 4:** `owned` → `own` and `stock-licensed` →
`royalty-free` went into `_LICENSE_ALIASES` here rather than waiting for the
contract change. The alias table is the right home for it either way, and it
means a channel config that has *not* been migrated yet filters correctly
instead of silently matching nothing — so Slice 4 stops being load-bearing
for correctness and becomes only a tidying of the schema enum.

**Also settled here:** both `license` and `licenses` normalize at the API
boundary now. The singular did not before, so a caller sending `CC0` was
already matching nothing — the same bug as #2, reached by a different route.

Verify with the repo's own commands: `test_flows.py` on `broll_test` at
`BROLL_EMBED_DIM=8`, plus `TestClient(create_app(start_worker=False))`
for the new endpoint. **Pin `BROLL_PROFILES_FILE`/`BROLL_DATABASE_URL`
before any `broll` import** — importing `api.py` connects to the active
profile and runs DDL.

### Slice 2 — clip cutting + resolution (config, D73) ✅ BUILT

> Done 2026-08-29. lusora `.env.example` carries both values with their
> reasoning; D73 is in the decision log. broll-engine `17cb0be` documents
> the duration cost of copy mode in its own `.env.example` and CLAUDE.md
> **without changing its default** — which mode is right depends on the
> consumer, and that is the consumer's call. `cut_clip` already supported
> both; no code changed on either side.

`BROLL_CUT_MODE=reencode`, `BROLL_MAX_RES=1080` in the library's env. They
live in lusora's `.env.example` rather than in the submodule, because they
are *this deployment's* answer, not the library's default.

Both are **permanent per clip** — sources are deleted after tagging, so
setting either one later only affects footage ingested after the change.
Re-ingest anything already in the library that matters; the old clips are
480p with copy-mode edit lists and cannot be fixed in place.

The measurement behind #6 is worth keeping: the first argument for
`reencode` was that the ffmpeg renderer would show the previous shot, and
that turned out to be false. Checking it is what turned up the duration
mismatch, which is the argument that actually holds.

### Slice 3 — fix the adapter (`worker/lusora_worker/providers/sources.py`) ✅ BUILT

> Done 2026-08-29. `worker/tests/test_sources.py` gained nine tests; eight of
> them fail against the previous adapter, which is the check that they are
> testing the change rather than passing either way. Full worker suite (265)
> and `pnpm run ci` green.

The blocker set, all in `LibraryAdapter`:

- delete the `media_type` branch; always `.mp4` / `media_type="video"` (#1)
- drop `params["media_type"]` and `params["profile"]` (D76 — they are
  inert fields now, not query params)
- `params["licenses"]` now works upstream (Slice 1.2)
- gate on `best["sim"]`, `continue` instead of `break` (#3)
- fail closed when the library channel does not resolve (#4)
- pass `prefer_seconds = end_s - start_s` (#8)

`worker/tests/test_sources.py` is the seam — the adapter is already
exercised there with a stubbed HTTP layer.

**Two things the slice had to decide that the plan left open:**

*What to do when a hit has no `sim`* (a library older than Slice 1). Falling
back to `score` would reinstate the bug silently, so: with no `min_score`
configured there is nothing to compare and the hit is taken; with one, the
adapter records `provider_health` naming the reason and falls through. That
matches D12 — an unusable source falls through, it does not guess.

*Fail-closed scoping without breaking a fresh library.* The plan said record
health and fall through when the channel does not resolve, but that would
make the library dark on any deployment that has not yet ingested under the
lusora channel's name — including the global pool, which is legitimately
searchable. Instead the unmatched name is sent AS the `channel_id`: it
matches no library channel, so `is_mine` is false for every row and
`include_global` decides. That is exactly "the global pool", it needs no
library change, and `include_global: false` correctly yields nothing rather
than everything. `mark_used` posts the same value, so the overuse counter is
read back under the key it was written under.

### Slice 4 — licence vocabulary (D72) ✅ BUILT

> Done 2026-08-29. D33 marked superseded; D71–D76 written into the decision
> log, which until now carried only D73. `pnpm run ci` and the 265-test
> worker suite green.

- `channel_config.schema.json` and `sound_pack.schema.json` → the library's
  tokens, minus `restricted`.
- `contracts/src/types.ts` (`LicenseKind`) and the three UI lists that had
  their own copies: `SourcePolicyEditor.tsx`, `ChannelConfigForm.tsx`
  (list + the new-channel default) and `sounds/page.tsx`.
- The two producers in the worker that emitted the old tokens: Pexels
  `stock-licensed` → `royalty-free`, ai_image `owned` → `own`.
- `contracts/db/0003_license_vocabulary.sql` rewrites stored channel configs.

**The enum is the library's full list, not just the two that collided.** Any
token the library can STORE but the schema cannot express is footage no
channel can ever allow, so `cc-pd`, `cc-by-nd` and `cc-by-nc` come across
too. `restricted` does not: it means "known NOT usable", which is not an
allow-list value.

**What the migration deliberately does not touch.** `videos.cfg` is the
immutable snapshot of what a video was produced with (Principle 7), and
nothing re-validates it — the platform validates the LIVE channel config at
enqueue — so an old snapshot keeps its old words and stays true.
`asset_usage.license` is provenance for footage already on disk.

The SQL rewrites `source_policy.visual.chain[].licenses` specifically,
because that is the only place `licenses` appears in the schema
(`$defs/visualSource`). Tested against a real Postgres 16 on four shapes —
mixed tokens, already-migrated, no chain, chain without licences — including
a source whose free-text `style` was `"owned look, stock-licensed feel"`,
which is exactly what a blanket search-and-replace over the document would
have corrupted. Second run reports `UPDATE 0`.

### Slice 5 — the platform's Library + Review screens (M9) ✅ BUILT

> Done 2026-08-29. Verified against a live library, not just typechecked:
> a seeded Postgres + the real `api:app`, driven through the platform in
> headless Chromium. Trim, approve and reject were exercised for real and
> their effects read back out of the database.

1. `PATCH` added to the proxy's exports (#5) — and the proxy now forwards
   headers instead of rebuilding them, because two library routes serve
   BYTES. A `<video>` scrubbing a clip issues Range requests; the old proxy
   dropped `Range` outbound and `Content-Range`/`Accept-Ranges` inbound, so
   every seek refetched the whole file. Verified: `Range: bytes=0-15` now
   returns `206` with `content-range: bytes 0-15/64`.
2. `library/page.tsx` rewritten against the real API. An empty query BROWSES
   (`GET /segments`) rather than searching for the empty string — `/search`
   embeds its `q` and ranks by distance to it, so `q=""` ranks the library
   against nothing.
3. **Ingest form** — `POST /jobs`, with the serial queue's job list beside
   it. That list is not decoration: one download at a time through the proxy
   means a link queued behind a 40-minute documentary looks broken without
   it. This form is also the only thing that creates library channels, which
   is what Slice 3's fail-closed scoping needs.
4. **Review screen** (D75) — pending grid, bulk approve/reject, inline
   caption/tag editing, and the trim workbench.

**What the card shows is `sim`, not `score`.** A "% match" built from
`score` would read as a similarity while carrying the -1.0 same-project block
(D74). The ranked score is in the tooltip.

**The trim workbench is a workbench, not a card control**, for the reason
broll-engine gives: finding the frame a bad edge ends on means scrubbing, and
a player one third of a column wide cannot be scrubbed. Wide player, bounds
beside it. A cut that would leave less than the minimum clip length is
refused before it is sent — the server refuses it too, this just says so
first.

**Editing before approving is the right order and the screen says so.** Dedup
runs at approval, not at ingest, so it compares the caption the reviewer
settled on rather than the model's first guess.

**Shared as far as the body and no further.** `ClipCard` is one component
across both screens; the actions are each page's own. That mirrors
broll-engine's own reasoning for keeping its Review page a near-copy of its
Gallery rather than a mode of it — folding them together puts review controls
on library cards.

Also: a row without bytes now renders "no preview" instead of the browser's
broken-image icon. That is a normal state, not a bug — a duplicate row holds
no bytes, and `00-status.md` records 64 rows whose clip files were lost.

### Slice 6 — tagging quality (open-ended, deliberately last)

Needs real footage to judge, so it cannot be planned in the abstract.
The measurement: sample N beats, run each `visual_intent` through
`/search`, count how many top-1 hits a human accepts.

Levers if the number is poor:
- the caption style `_FINE_INSTRUCTIONS` asks for — lusora embeds
  `" ".join(tags) + " " + caption`, and the planner writes scout-style
  sentences; whether those two describe footage the same way is an
  empirical question
- tag vocabulary normalization
- the ranking constants in `ranking.py`, now that `prefer_seconds` is real

## Also closed on the way past

**OQ-21 (VPS sizing)** becomes measurable once Slice 0's compose file
exists: one Remotion render of a representative plan, wall-clock + peak
RSS. Starting points — 4 vCPU / 8 GB / 80 GB is the floor (Remotion wants
~2 GB per concurrency slot and the library API carries torch for
`all-MiniLM-L6-v2`); 8 vCPU / 16 GB is comfortable. Every model is remote
(DeepSeek, ai33, Z.ai GLM), so there is no GPU anywhere.

---

## Slice 7 — the API the designs need (broll-engine)

Seven artboards came back from Claude Design (Library browse, Search results,
Library states, Review, Trim workbench, Ingest, Library overview). They are
mostly grounded — they respect `sim` vs `score`, the no-undo-on-delete rule,
duplicate rows holding no bytes, the serial queue, and licence permanence.

But roughly a third of what they draw has no API behind it. Rather than build
two thirds of each screen and come back, the API lands first.

### What the designs need that does not exist

| Need | Where it appears | Shape |
|---|---|---|
| `video_id` filter | Review's per-source filter; a source's clips | param on `/segments` |
| `sort` | Review "confidence: low first"; Library "newest first" | param on `/segments` |
| `offset` | Library "showing 1,892 of 3,184" | param on `/segments` |
| total count under the active filters | the same line | `X-Total-Count` header |
| tag vocabulary with counts | Library's tag filter rail | `GET /tags` |
| library totals | Library overview's five stat tiles | `GET /stats` |
| source videos with counts | Review filter, purge picker, recent ingests | `GET /videos` |
| "caption is still the model's original" | Review's bulk-bar warning | `caption_edited` flag |
| un-approve | Review's "Undo" on a just-approved card | `POST /segments/unapprove` |
| cancel / retry a job | Ingest queue | `DELETE /jobs/{id}`, `POST /jobs/{id}/retry` |

`caption_edited` is worth the column. The Review bulk bar warning — *"2
selected clips still have the model's original caption"* — is the design
enforcing the rule that dedup compares the reviewer's words, and it cannot be
done client-side because it has to survive a reload.

Un-approve is the one "undo" that is honest: approval is a status flip, not a
deletion, so unlike a delete it genuinely can be reversed.

### Dropped from the designs, deliberately

- **The near-duplicate warning before approval.** Dedup runs AT approval and
  compares the caption the reviewer settled on, so a pre-approval verdict
  would be a guess that disagrees with the real result the moment the caption
  is touched. The approve response already reports what happened
  (`approved 3 · 1 linked as duplicate`); that is where it belongs.
- **The ranking breakdown** (`fit 1.0 · reuse −.4`). `rank_segments` computes
  those terms internally and returns only the final number; exposing them
  means changing what ranking returns, and the debug line works with the
  `score` and `confidence` that are already there.
- **Job ETA and live clip counts** ("~9 min left · 128 clips so far").
  `segments_created` is written once, at the end. An ETA over a GLM pass
  whose duration varies per chunk would be a number we cannot stand behind.
- **The trim filmstrip.** Frame thumbnails along the scrubber need an API
  that renders them. The wide player, frame stepping and 0.25x playback all
  work from the `<video>` element alone, which is what makes the scrubbing
  accurate; the filmstrip is the expensive 10%.

### Slice 8 — the screens

Once the API lands and the submodule is re-pinned, the seven artboards are
buildable as drawn, minus the four items above. Order: Library + Search +
states (one screen, three artboards), then Review, then Ingest, then
Overview.
