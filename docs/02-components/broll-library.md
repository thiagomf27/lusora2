# B-roll Library

The broll-engine service, kept as-is (own code, own API, own pgvector
data), connected over HTTP. It lives at `library/broll-engine` as a git
submodule (D71), so the code is in the tree but the boundary is unchanged. It is the system's cost advantage:
ingest + exhaustive AI tagging happen ONCE per source; every later search
is a free index hit. Library assets are preferred over stock over
generation in every default source policy.

## Boundary (Decided)

- The worker's `providers/library/` adapter and the platform's Library
  screens both call the SAME HTTP API. No code imports across the
  boundary.
- The engine never talks to the library (files-only).
- Stable contract = the pipeline method surface: `library_search`,
  `search_or_acquire`, `acquire`, `ingest_url`, `ingest_video`,
  `ingest_image`, `ingest_image_url`, `mark_used`. Extend with keyword
  args, never rename/reorder.

## How beats use it

A beat's `visual_intent` IS the search query (written scout-style: rich,
concrete visual descriptions — that's what vector search ranks well, and
the planner prompt teaches this). `resolve_assets` calls
`library_search(query, filters…)` with the channel's source-policy
filters (`tags`, `niches`, `media_type`, `max_duration`, `channel_id`,
`include_global`) and falls through to stock/AI when the best hit is
below `min_score`. On selection: `mark_used` (per-channel overuse
tracking; hard-block within the same project) and provenance recorded
into the plan.

## Library changes lusora needed — all landed

1. **`license` per segment**, filterable — the basis of the channels'
   anti-copyright rules (OQ-13/D33, and the vocabulary is now the library's
   own: D72).
2. **`sim` beside `score` in search responses.** `score` alone could not
   carry a `min_score` gate: it folds in a -1.0 block on a clip already used
   in this project, so thresholding it dropped perfect matches (D74).
3. **`licenses` any-of**, because a source policy names every copyright
   status it accepts rather than one.
4. **`POST /segments/{id}/mark_used`**, without which the overuse penalty
   and the same-project block never accumulate.
5. **`prefer_seconds`**, so ranking's duration-fit term aims at the slot
   being filled instead of its 5s default.

Everything else (profiles, dedup, the serial ingest worker, proxy rules, the
Streamlit UI as an internal tool) stays untouched. A usage-report endpoint
for the Monitoring screen is still optional and unbuilt.

`ingest_image`/`ingest_image_url` in the method list above are the old
names; the library's upload paths are `ingest_video` and `ingest_images`,
and an uploaded still becomes a short still CLIP rather than a stored image —
which is why the adapter has no image branch (D76).
